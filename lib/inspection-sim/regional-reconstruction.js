import jpeg from "jpeg-js";
import { fetchTerrain, isMeasured } from "./regional-data.js";
import { pointInPolygon, polygonBounds } from "./mission-geometry.js";

const intersects = (a, b) => a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;

function blit(dest, destW, destH, src, x, y, w, h) {
  for (let row = 0; row < h; row++) {
    const sy = Math.min(src.height - 1, Math.max(0, Math.floor((row + 0.5) * src.height / h)));
    const dy = Math.floor(y + row);
    if (dy < 0 || dy >= destH) continue;
    for (let col = 0; col < w; col++) {
      const sx = Math.min(src.width - 1, Math.max(0, Math.floor((col + 0.5) * src.width / w)));
      const dx = Math.floor(x + col);
      if (dx < 0 || dx >= destW) continue;
      const si = (sy * src.width + sx) * 4;
      dest.set(src.data.subarray(si, si + 4), (dy * destW + dx) * 4);
    }
  }
}

async function loadJpeg(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Mosaic imagery: HTTP ${response.status}`);
  return jpeg.decode(Buffer.from(await response.arrayBuffer()), { useTArray: true, formatAsRGBA: true });
}

export async function createRegionalReconstruction(regionUrl, manifest, plan, onProgress = () => {}) {
  if (plan.mode !== "inspection" || !plan.polygon) return null;
  const bounds = polygonBounds(plan.polygon);
  const resolution = Math.max(5, Math.ceil(Math.max(bounds.east - bounds.west, bounds.north - bounds.south) / 1200));
  const cols = Math.ceil((bounds.east - bounds.west) / resolution);
  const rows = Math.ceil((bounds.north - bounds.south) / resolution);
  const count = rows * cols;
  if (count > 1_500_000) throw new Error("Inspection mosaic exceeds the grid limit; use a smaller area.");
  const url = regionUrl.endsWith("/") ? regionUrl : `${regionUrl}/`;
  const tiles = manifest.tiles.filter((tile) => intersects(bounds, { west: tile.west, east: tile.west + tile.size, south: tile.north - tile.size, north: tile.north }));
  const terrain = new Map();
  const sourcePixels = new Uint8Array(cols * rows * 4);
  let completed = 0;
  const queue = [...tiles];
  const load = async () => {
    while (queue.length) {
      const tile = queue.shift();
      const [data, image] = await Promise.all([
        fetchTerrain(`${url}tiles/${tile.id}/5/terrain.bin.gz`),
        loadJpeg(`${url}tiles/${tile.id}/aerial-5m.jpg`),
      ]);
      const x = (tile.west - bounds.west) / resolution;
      const y = (bounds.north - tile.north) / resolution;
      const size = tile.size / resolution;
      blit(sourcePixels, cols, rows, image, x, y, size, size);
      terrain.set(tile.id, { tile, data });
      completed++;
      onProgress({ stage: "mosaic", completed, total: tiles.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, load));
  const mask = new Uint8Array(count);
  const classes = new Uint8Array(count);
  const measured = new Uint8Array(count);
  const elevation = new Float32Array(count).fill(NaN);
  let totalCells = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const e = bounds.west + (c + 0.5) * resolution;
      const n = bounds.north - (r + 0.5) * resolution;
      if (!pointInPolygon([e, n], plan.polygon)) continue;
      mask[i] = 1;
      totalCells++;
      const tc = Math.floor((e + manifest.size / 2) / 500);
      const tr = Math.floor((manifest.size / 2 - n) / 500);
      const entry = terrain.get(`${tr}-${tc}`);
      if (!entry) continue;
      const lc = Math.max(0, Math.min(99, Math.floor((e - entry.tile.west) / 5)));
      const lr = Math.max(0, Math.min(99, Math.floor((entry.tile.north - n) / 5)));
      const j = lr * 100 + lc;
      classes[i] = entry.data.codes[j];
      measured[i] = isMeasured(entry.data, j) ? 1 : 0;
      if (measured[i]) elevation[i] = entry.data.heights[j];
    }
  }
  const data = {
    version: 2, revision: 0, simulated: true, mode: "inspection", crs: manifest.crs, verticalCrs: "EPSG:5703",
    origin: [manifest.origin.utm_m[0] + bounds.west, manifest.origin.utm_m[1] + bounds.north],
    bounds, resolution, rows, cols, polygon: plan.polygon, order: "row-major, north to south; west to east",
    mask, totalCells, coveredCells: 0, captures: [], coverage: new Uint16Array(count),
    elevation, measured, classes, rgba: new Uint8Array(count * 4),
    firstSeenSeconds: new Float64Array(count).fill(NaN), lastSeenSeconds: new Float64Array(count).fill(NaN),
    sources: { color: "NYS spring 2023 orthophoto", elevation: "2020 maximum-return display terrain", note: "Simulated capture reveal; not photogrammetric reconstruction" },
  };
  const seen = new Set();
  const footprint = Math.max(15, plan.options.trackSpacing);
  return {
    data,
    capture({ id, position, time }) {
      if (seen.has(id)) return;
      seen.add(id);
      const [x, y] = position;
      const half = footprint / 2;
      const c0 = Math.max(0, Math.floor((x - half - bounds.west) / resolution));
      const c1 = Math.min(cols - 1, Math.floor((x + half - bounds.west) / resolution));
      const r0 = Math.max(0, Math.floor((bounds.north - y - half) / resolution));
      const r1 = Math.min(rows - 1, Math.floor((bounds.north - y + half) / resolution));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          if (!mask[i]) continue;
          if (!data.coverage[i]) {
            data.coveredCells++;
            data.firstSeenSeconds[i] = time;
            data.rgba.set(sourcePixels.subarray(i * 4, i * 4 + 4), i * 4);
            data.rgba[i * 4 + 3] = 255;
          }
          data.coverage[i] = Math.min(65535, data.coverage[i] + 1);
          data.lastSeenSeconds[i] = time;
        }
      }
      data.captures.push({ id, time, position: position.slice(), footprintMeters: [footprint, footprint] });
      data.revision++;
    },
  };
}
