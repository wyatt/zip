import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { PNG } from "pngjs";
import type { GeoPoint } from "./operations";
import { fromLocal, metersPerDegree } from "./geo-local";

export const TERRAIN_CACHE_ROOT = join(process.cwd(), "data", "terrain-cache");
const TILE = 500;
const OVERVIEW = 25;
const DETAIL = 5;
const HEIGHT_SCALE = 0.05;
const CACHE_CAP = 2 * 1024 ** 3;
const FAA_FACILITY = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/FAA_UAS_FacilityMap_Data/FeatureServer/0/query";
const FAA_NSFR = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/DoD_Mar_13/FeatureServer/0/query";

export type TerrainRegion = {
  key: string;
  dir: string;
  size: number;
  origin: GeoPoint;
  zMin: number;
  zMax: number;
};

function snap(value: number, step: number) {
  return Math.round(value / step) * step;
}

export function regionKey(center: GeoPoint, size = 2000) {
  const origin = { lat: snap(center.lat, 0.002), lon: snap(center.lon, 0.002) };
  const payload = JSON.stringify({ origin, size, v: 1 });
  return { key: createHash("sha256").update(payload).digest("hex").slice(0, 16), origin, size };
}

function encodeRt16(heights: Float32Array, codes: Uint8Array, known: Uint8Array, rows: number, cols: number) {
  let min = Infinity;
  for (let i = 0; i < heights.length; i++) if (Number.isFinite(heights[i]) && heights[i]! < min) min = heights[i]!;
  const base = Number.isFinite(min) ? Math.floor(min / HEIGHT_SCALE) * HEIGHT_SCALE : 0;
  const quantized = Buffer.alloc(rows * cols * 2);
  for (let i = 0; i < heights.length; i++) {
    const z = heights[i]!;
    const q = Number.isFinite(z) ? Math.min(65534, Math.max(0, Math.ceil((z - base) / HEIGHT_SCALE - 1e-6))) : 65535;
    quantized.writeUInt16LE(q, i * 2);
  }
  const mask = Buffer.alloc(Math.ceil(rows * cols / 8));
  for (let i = 0; i < known.length; i++) if (known[i]) mask[i >> 3]! |= 1 << (i & 7);
  const header = Buffer.alloc(24);
  header.write("RT16", 0, 4, "ascii");
  header.writeUInt8(1, 4);
  header.writeUInt8(1, 5);
  header.writeUInt16LE(rows, 6);
  header.writeUInt16LE(cols, 8);
  header.writeFloatLE(base, 10);
  header.writeFloatLE(HEIGHT_SCALE, 14);
  header.writeUInt32LE(rows * cols, 18);
  return gzipSync(Buffer.concat([header, quantized, Buffer.from(codes), mask]), { level: 6 });
}

function lonLatToTile(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y, n };
}

function terrariumHeight(r: number, g: number, b: number) {
  return r * 256 + g + b / 256 - 32768;
}

async function fetchPng(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Terrain source HTTP ${response.status}`);
  return PNG.sync.read(Buffer.from(await response.arrayBuffer()));
}

const pngCache = new Map<string, PNG>();
async function terrariumTile(z: number, x: number, y: number) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const hit = pngCache.get(url);
  if (hit) return hit;
  const png = await fetchPng(url);
  pngCache.set(url, png);
  return png;
}

function sampleTerrarium(png: PNG, lat: number, lon: number, z: number, tileX: number, tileY: number) {
  const n = 2 ** z;
  const fx = ((lon + 180) / 360) * n - tileX;
  const latRad = (lat * Math.PI) / 180;
  const fy = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n - tileY;
  const px = Math.min(png.width - 1, Math.max(0, Math.floor(fx * png.width)));
  const py = Math.min(png.height - 1, Math.max(0, Math.floor(fy * png.height)));
  const i = (png.width * py + px) << 2;
  return terrariumHeight(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
}

async function fillGrid(origin: GeoPoint, west: number, north: number, cell: number, rows: number, cols: number, z: number) {
  const heights = new Float32Array(rows * cols);
  const codes = new Uint8Array(rows * cols);
  const known = new Uint8Array(rows * cols);
  const geos: GeoPoint[] = [];
  const needed = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const geo = fromLocal(origin, { east: west + (c + 0.5) * cell, north: north - (r + 0.5) * cell });
      geos.push(geo);
      const tile = lonLatToTile(geo.lat, geo.lon, z);
      needed.add(`${tile.x}/${tile.y}`);
    }
  }
  await Promise.all([...needed].map(id => {
    const [x, y] = id.split("/").map(Number);
    return terrariumTile(z, x!, y!);
  }));
  for (let i = 0; i < geos.length; i++) {
    const geo = geos[i]!;
    const tile = lonLatToTile(geo.lat, geo.lon, z);
    const png = pngCache.get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tile.x}/${tile.y}.png`);
    const elev = png ? sampleTerrarium(png, geo.lat, geo.lon, z, tile.x, tile.y) : Number.NaN;
    if (Number.isFinite(elev) && elev > -500) {
      heights[i] = elev;
      known[i] = 1;
      codes[i] = elev < 1 ? 0 : 27;
    } else heights[i] = Number.NaN;
  }
  return { heights, codes, known };
}

async function writeJpeg(path: string, lat: number, lon: number, zoom: number) {
  const tile = lonLatToTile(lat, lon, zoom);
  const sub = (tile.x % 4).toString();
  const url = `https://mt${sub}.google.com/vt/lyrs=s&x=${tile.x}&y=${tile.y}&z=${zoom}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Imagery HTTP ${response.status}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

async function queryFaa(url: string, west: number, south: number, east: number, north: number) {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ xmin: west, ymin: south, xmax: east, ymax: north, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    f: "geojson",
  });
  const response = await fetch(`${url}?${params}`);
  if (!response.ok) return { type: "FeatureCollection", features: [] };
  return response.json() as Promise<{ type: string; features: unknown[] }>;
}

async function cacheSize(root: string) {
  let total = 0;
  async function walk(dir: string) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else total += (await stat(path)).size;
    }
  }
  await walk(root);
  return total;
}

async function evict(root: string, keep: string) {
  const dirs = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter(d => d.isDirectory() && d.name !== keep);
  const ranked = await Promise.all(dirs.map(async d => {
    const path = join(root, d.name);
    return { path, mtime: (await stat(path)).mtimeMs };
  }));
  ranked.sort((a, b) => a.mtime - b.mtime);
  for (const item of ranked) {
    if (await cacheSize(root) < CACHE_CAP) break;
    await rm(item.path, { recursive: true, force: true });
  }
}

const inflight = new Map<string, Promise<TerrainRegion>>();

export async function ensureTerrainRegion(center: GeoPoint, size = 2000): Promise<TerrainRegion> {
  const { key, origin } = regionKey(center, size);
  const pending = inflight.get(key);
  if (pending) return pending;
  const work = loadOrAcquire(key, origin, size);
  inflight.set(key, work);
  try { return await work; } finally { inflight.delete(key); }
}

async function loadOrAcquire(key: string, origin: GeoPoint, size: number): Promise<TerrainRegion> {
  const dir = join(TERRAIN_CACHE_ROOT, key);
  const manifestPath = join(dir, "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { size: number; origin: { wgs84: number[] }; zMin: number; zMax: number };
    await utimes(dir, new Date(), new Date()).catch(() => undefined);
    return { key, dir, size: manifest.size, origin: { lat: manifest.origin.wgs84[1]!, lon: manifest.origin.wgs84[0]! }, zMin: manifest.zMin, zMax: manifest.zMax };
  } catch {
    /* acquire */
  }
  const half = size / 2;
  const grid = size / TILE;
  const m = metersPerDegree(origin.lat);
  const westLon = origin.lon - half / m.east, eastLon = origin.lon + half / m.east;
  const southLat = origin.lat - half / m.north, northLat = origin.lat + half / m.north;
  const tiles: Array<{ id: string; west: number; north: number; size: number; measuredCells: number }> = [];
  let zMin = Infinity, zMax = -Infinity, measured = 0;
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      const west = -half + c * TILE, north = half - r * TILE;
      const id = `${r}-${c}`;
      const detail = await fillGrid(origin, west, north, DETAIL, TILE / DETAIL, TILE / DETAIL, 14);
      for (const z of detail.heights) {
        if (!Number.isFinite(z)) continue;
        measured++;
        zMin = Math.min(zMin, z);
        zMax = Math.max(zMax, z);
      }
      const folder5 = join(dir, "tiles", id, "5");
      await mkdir(folder5, { recursive: true });
      await writeFile(join(folder5, "terrain.bin.gz"), encodeRt16(detail.heights, detail.codes, detail.known, TILE / DETAIL, TILE / DETAIL));
      const centerGeo = fromLocal(origin, { east: west + TILE / 2, north: north - TILE / 2 });
      await writeJpeg(join(dir, "tiles", id, "aerial.jpg"), centerGeo.lat, centerGeo.lon, 16);
      await writeJpeg(join(dir, "tiles", id, "aerial-5m.jpg"), centerGeo.lat, centerGeo.lon, 15);
      tiles.push({ id, west, north, size: TILE, measuredCells: measured });
    }
  }
  const overview = await fillGrid(origin, -half, half, OVERVIEW, size / OVERVIEW, size / OVERVIEW, 12);
  await mkdir(join(dir, "overview"), { recursive: true });
  await writeFile(join(dir, "overview", "terrain.bin.gz"), encodeRt16(overview.heights, overview.codes, overview.known, size / OVERVIEW, size / OVERVIEW));
  await writeJpeg(join(dir, "overview", "aerial.jpg"), origin.lat, origin.lon, 14);
  const [facility, nsfr] = await Promise.all([
    queryFaa(FAA_FACILITY, westLon, southLat, eastLon, northLat),
    queryFaa(FAA_NSFR, westLon, southLat, eastLon, northLat),
  ]);
  await writeFile(join(dir, "faa.json"), JSON.stringify({ facility, nsfr }));
  if (!Number.isFinite(zMin)) { zMin = 0; zMax = 1; }
  const manifest = {
    version: 2, size, tileSize: TILE, overviewResolution: OVERVIEW, levels: [5],
    origin: { wgs84: [origin.lon, origin.lat], utm_m: [0, 0] },
    crs: "EPSG:4326", verticalReference: "ellipsoidal/terrarium metres",
    zMin, zMax, tiles, measuredCells: measured, totalCells: (size / DETAIL) ** 2,
    terrainEncoding: { format: "RT16+gzip", height: "uint16", heightScale: HEIGHT_SCALE, missingHeight: 65535, measured: "little-endian bitset" },
    note: "Programmatic demo terrain. Not a certified DSM or flight-ready surface.",
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
  await evict(TERRAIN_CACHE_ROOT, key);
  pngCache.clear();
  console.log(`Acquired terrain region ${key} (${size} m)`);
  return { key, dir, size, origin, zMin, zMax };
}

export async function readCachedFaa(key: string) {
  return JSON.parse(await readFile(join(TERRAIN_CACHE_ROOT, key, "faa.json"), "utf8")) as {
    facility: { type: string; features: unknown[] };
    nsfr: { type: string; features: unknown[] };
  };
}
