import {
  Box3,
  BoxGeometry,
  Color,
  DataTexture,
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  NearestFilter,
  Plane,
  Quaternion,
  RedFormat,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Camera,
  type Material,
  type Scene,
} from "three";
import { fetchTerrain, isMeasured } from "./regional-data";
import { createPhotoMaterial } from "./photo-material";
import { regionalCoverStyle } from "./surface-colors";

export type RegionTile = { id: string; west: number; north: number; size: number; measuredCells: number };
export type FocusBounds = { west: number; east: number; south: number; north: number };

export function tilesCovering(tiles: RegionTile[], bounds: FocusBounds) {
  return tiles.filter((tile) =>
    tile.west < bounds.east &&
    tile.west + tile.size > bounds.west &&
    tile.north > bounds.south &&
    tile.north - tile.size < bounds.north
  );
}

export function unionTileBounds(tiles: RegionTile[]): FocusBounds | null {
  if (!tiles.length) return null;
  return {
    west: Math.min(...tiles.map((tile) => tile.west)),
    east: Math.max(...tiles.map((tile) => tile.west + tile.size)),
    south: Math.min(...tiles.map((tile) => tile.north - tile.size)),
    north: Math.max(...tiles.map((tile) => tile.north)),
  };
}
export type RegionMeta = {
  version: number;
  size: number;
  tileSize: number;
  overviewResolution: number;
  zMin: number;
  zMax: number;
  tiles: RegionTile[];
  legend?: Record<string, string>;
};

export async function loadRegionManifest(url: string) {
  const response = await fetch(`${url}manifest.json`);
  if (!response.ok) throw new Error(`Regional map: HTTP ${response.status}. Generate the Ithaca 5 km package first.`);
  const meta = await response.json() as RegionMeta;
  if (![1, 2].includes(meta.version) || meta.size !== 5000 || meta.tileSize !== 500 || meta.tiles.length !== 100 || meta.overviewResolution !== 25) {
    throw new Error("Unsupported regional map manifest");
  }
  return meta;
}

type TileEntry = {
  mesh: InstancedMesh;
  texture: { dispose: () => void };
  level: number;
};

export async function createRegionalTerrain(
  scene: Scene,
  {
    url,
    meta,
    baseline,
    requestRender,
    onStatus = () => undefined,
  }: {
    url: string;
    meta: RegionMeta;
    baseline: number;
    requestRender: () => void;
    onStatus?: (message: string) => void;
  },
) {
  let disposed = false, activeLoads = 0, timer = 0;
  let focus: FocusBounds | null = null;
  let pathTiles = new Set<string>();
  const corridor = new Uint8Array(200 * 200);
  let focusPlanes: Plane[] | null = null;
  let lastCamera: { camera: Camera & { zoom: number; left: number; right: number }; width: number; target: Vector3; signature: string } | null = null;
  const group = new Group();
  scene.add(group);
  const maskBytes = new Uint8Array(10 * 10);
  const mask = new DataTexture(maskBytes, 10, 10, RedFormat);
  mask.flipY = false;
  mask.magFilter = NearestFilter;
  mask.minFilter = NearestFilter;
  mask.needsUpdate = true;
  const resident = new Map<string, TileEntry>();
  const cache = new Map<string, TileEntry>();
  const pending = new Map<string, AbortController>();
  const failed = new Set<string>();
  const tileById = new Map(meta.tiles.map((tile) => [tile.id, tile]));
  let desired = new Map<string, { tile: RegionTile; level: number }>();
  const CACHE_LIMIT = 24;
  const textureLoader = new TextureLoader();
  const frustum = new Frustum();
  const proj = new Matrix4();

  function intersectsFocus(tile?: RegionTile) {
    if (!focus || !tile) return !focus;
    return tile.west < focus.east && tile.west + tile.size > focus.west && tile.north > focus.south && tile.north - tile.size < focus.north;
  }
  function applyClip(mesh: InstancedMesh) {
    const material = mesh.material as Material;
    material.clippingPlanes = focusPlanes;
    material.needsUpdate = true;
  }
  function material(texture: import("three").Texture, overview: boolean, size: number) {
    const m = createPhotoMaterial(texture, size, size);
    m.clippingPlanes = focusPlanes;
    const uniforms = { regionMask: { value: mask }, isOverview: { value: overview } };
    const compilePhoto = m.onBeforeCompile;
    const photoKey = m.customProgramCacheKey;
    m.userData.uniforms = uniforms;
    m.onBeforeCompile = (shader) => {
      compilePhoto(shader, {} as import("three").WebGLRenderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 regionalWorld;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nregionalWorld=(modelMatrix*instanceMatrix*vec4(position,1.0)).xyz;")
        .replace("vOuterSide = max(", "vOuterSide = 0.0 * max(");
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
        varying vec3 regionalWorld; uniform sampler2D regionMask; uniform bool isOverview;
      `).replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
          if(isOverview && texture2D(regionMask,(regionalWorld.xz+vec2(2500.0))/5000.0).r>0.5) discard;
        `);
    };
    m.customProgramCacheKey = () => `${photoKey()}-regional-columns-v2`;
    return m;
  }

  function columnMesh(tile: { size: number; west: number; north: number }, level: number, heights: Float32Array, codes: Uint8Array, texture: import("three").Texture, overview: boolean) {
    const geometry = new BoxGeometry(level, level, level);
    const mesh = new InstancedMesh(geometry, material(texture, overview, tile.size), heights.length);
    const n = tile.size / level;
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const rotation = new Quaternion();
    const color = new Color();
    let instance = 0;
    for (let i = 0; i < heights.length; i++) {
      if (!Number.isFinite(heights[i])) continue;
      const r = Math.floor(i / n), c = i % n;
      if (focus) {
        const east = tile.west + (c + 0.5) * level, north = tile.north - (r + 0.5) * level;
        if (east < focus.west || east > focus.east || north < focus.south || north > focus.north) continue;
        if (level === 1) {
          const col = Math.max(0, Math.min(199, Math.floor((east + 2500) / 25)));
          const row = Math.max(0, Math.min(199, Math.floor((2500 - north) / 25)));
          if (!corridor[row * 200 + col]) continue;
        }
      }
      const height = Math.max(0.01, heights[i]! - baseline);
      position.set((c + 0.5) * level - tile.size / 2, height / 2, (r + 0.5) * level - tile.size / 2);
      scale.set(1, height / level, 1);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(instance, matrix);
      color.setRGB(regionalCoverStyle(codes[i]!), codes[i] === 21 ? 1 : 0, 0);
      mesh.setColorAt(instance, color);
      instance++;
    }
    mesh.count = instance;
    mesh.position.set(tile.west + tile.size / 2, 0, -tile.north + tile.size / 2);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  function free(tile: TileEntry) {
    group.remove(tile.mesh);
    tile.mesh.geometry.dispose();
    (tile.mesh.material as import("three").Material).dispose();
    tile.texture.dispose();
  }
  function detach(tile: TileEntry) { group.remove(tile.mesh); }
  function cacheTile(id: string, tile: TileEntry) {
    const previous = cache.get(id);
    if (previous && previous !== tile) free(previous);
    cache.delete(id);
    cache.set(id, tile);
    while (cache.size > CACHE_LIMIT) {
      const stale = [...cache].find(([key]) => !resident.has(key));
      if (!stale) break;
      cache.delete(stale[0]);
      free(stale[1]);
    }
  }
  function updateMask() {
    maskBytes.fill(0);
    for (const [id] of resident) {
      const [r, c] = id.split("-").map(Number);
      maskBytes[r! * 10 + c!] = 255;
    }
    mask.needsUpdate = true;
  }

  async function load(tile: { id?: string; size: number; west: number; north: number }, level: number, overview = false, signal?: AbortSignal): Promise<TileEntry> {
    const folder = overview ? `${url}overview/` : `${url}tiles/${tile.id}/${level}/`;
    const texturePath = overview ? `${folder}aerial.jpg` : `${url}tiles/${tile.id}/${level === 1 ? "aerial.jpg" : "aerial-5m.jpg"}`;
    let texture: import("three").Texture | undefined;
    const terrainPromise = fetchTerrain(`${folder}terrain.bin.gz`, signal);
    const results = await Promise.allSettled([terrainPromise, textureLoader.loadAsync(texturePath)]);
    if (results[1].status === "fulfilled") texture = results[1].value;
    const error = results.find((result) => result.status === "rejected");
    if (error || disposed || signal?.aborted) {
      texture?.dispose();
      throw error && error.status === "rejected" ? error.reason : new Error("Regional load cancelled");
    }
    const data = (results[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof fetchTerrain>>>).value;
    const { heights, codes } = data;
    const n = tile.size / level;
    if (data.rows !== n || data.cols !== n || heights.length !== n * n || codes.length !== n * n) {
      texture!.dispose();
      throw new Error("Regional tile buffers are misaligned");
    }
    texture!.colorSpace = SRGBColorSpace;
    texture!.anisotropy = 4;
    const mesh = columnMesh(tile, level, heights, codes, texture!, overview);
    mesh.userData.regional = { tile, level, heights, codes, measured: data.measured, measuredPacked: data.measuredPacked };
    return { mesh, texture: texture!, level };
  }

  const overview = await load({ size: 5000, west: -2500, north: 2500 }, 25, true);
  group.add(overview.mesh);
  const overviewHeights = overview.mesh.userData.regional.heights as Float32Array;

  function report() {
    onStatus(failed.size ? "Some detail tiles failed; overview remains available" : `${resident.size} detail tiles loaded${activeLoads ? " · Loading detail…" : ""}`);
  }
  function pump() {
    if (disposed) return;
    const work = [...desired].sort(([a], [b]) => Number(resident.has(a)) - Number(resident.has(b)));
    for (const [id, wanted] of work) {
      if (activeLoads >= 4) break;
      if (resident.get(id)?.level === wanted.level || pending.has(id)) continue;
      const cached = cache.get(id);
      if (cached && (cached.level === wanted.level || (wanted.level === 1 && cached.level === 5 && !resident.has(id)))) {
        const previous = resident.get(id);
        if (previous && previous !== cached) detach(previous);
        resident.set(id, cached);
        group.add(cached.mesh);
        cache.delete(id);
        cache.set(id, cached);
        updateMask();
        requestRender();
        if (cached.level === wanted.level) continue;
      }
      const level = wanted.level === 1 && !resident.has(id) ? 5 : wanted.level;
      if (failed.has(`${id}/${level}`)) continue;
      const controller = new AbortController();
      pending.set(id, controller);
      activeLoads++;
      load(wanted.tile, level, false, controller.signal).then((result) => {
        const current = desired.get(id);
        if (disposed || !current || (current.level !== result.level && !(current.level === 1 && result.level === 5))) {
          free(result);
          return;
        }
        const previous = resident.get(id);
        if (previous && previous !== result) detach(previous);
        resident.set(id, result);
        group.add(result.mesh);
        cacheTile(id, result);
        updateMask();
        requestRender();
      }).catch((error: unknown) => {
        if (!disposed && !controller.signal.aborted) {
          failed.add(`${id}/${level}`);
          console.warn(error instanceof Error ? error.message : error);
        }
      }).finally(() => {
        pending.delete(id);
        activeLoads--;
        if (!disposed) { report(); pump(); }
      });
    }
    report();
  }

  function select() {
    timer = 0;
    if (!lastCamera || disposed) return;
    const { camera, width, target } = lastCamera;
    camera.updateMatrixWorld();
    proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(proj);
    const worldPerPixel = (camera.right - camera.left) / (camera.zoom * width);
    const candidates = meta.tiles.filter((tile) => {
      if (focus) return pathTiles.has(tile.id) && intersectsFocus(tile);
      return frustum.intersectsBox(new Box3(
        new Vector3(tile.west, meta.zMin - baseline, -tile.north),
        new Vector3(tile.west + tile.size, meta.zMax - baseline, -tile.north + tile.size),
      ));
    }).sort((a, b) =>
      Math.hypot(a.west + a.size / 2 - target.x, -a.north + a.size / 2 - target.z) -
      Math.hypot(b.west + b.size / 2 - target.x, -b.north + b.size / 2 - target.z)
    );
    const manyRouteTiles = Boolean(focus && candidates.length > 2);
    const budget = focus ? Math.min(candidates.length, 16) : 8;
    const hiResCount = manyRouteTiles ? 0 : (focus || worldPerPixel < 2.5) ? (focus ? 2 : 4) : 0;
    const wanted = candidates.slice(0, budget).map((tile, i) => ({
      tile,
      level: i < hiResCount ? 1 : 5,
    }));
    desired = new Map(wanted.map((value) => [value.tile.id, value]));
    for (const [id, entry] of resident) if (!desired.has(id)) { detach(entry); resident.delete(id); }
    for (const [id, controller] of pending) if (!desired.has(id)) controller.abort();
    updateMask();
    pump();
    requestRender();
  }

  return {
    group,
    overviewHeights,
    setFocus(bounds: FocusBounds | null) {
      focus = bounds ? { ...bounds } : null;
      focusPlanes = focus ? [
        new Plane(new Vector3(1, 0, 0), -focus.west),
        new Plane(new Vector3(-1, 0, 0), focus.east),
        new Plane(new Vector3(0, 0, 1), focus.north),
        new Plane(new Vector3(0, 0, -1), -focus.south),
      ] : null;
      overview.mesh.visible = !focus;
      applyClip(overview.mesh);
      for (const entry of cache.values()) applyClip(entry.mesh);
      if (focus) {
        for (const [id, entry] of [...cache]) {
          if (!intersectsFocus(tileById.get(id))) {
            cache.delete(id);
            resident.delete(id);
            free(entry);
          }
        }
        for (const [id, controller] of pending) {
          if (!intersectsFocus(tileById.get(id))) controller.abort();
        }
      } else {
        for (const [id, entry] of [...cache]) {
          if (entry.level !== 1) continue;
          cache.delete(id);
          resident.delete(id);
          free(entry);
        }
      }
      updateMask();
      if (lastCamera) {
        lastCamera.signature = "";
        clearTimeout(timer);
        timer = window.setTimeout(select, 0);
      }
      requestRender();
    },
    setPath(points: { east: number; north: number }[]) {
      corridor.fill(0);
      pathTiles = new Set();
      const mark = (east: number, north: number) => {
        const col = Math.floor((east + 2500) / 25);
        const row = Math.floor((2500 - north) / 25);
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const r = row + dr, c = col + dc;
            if (r < 0 || r > 199 || c < 0 || c > 199) continue;
            corridor[r * 200 + c] = 1;
            pathTiles.add(`${Math.floor(r / 20)}-${Math.floor(c / 20)}`);
          }
        }
      };
      for (let i = 0; i < points.length; i++) {
        const point = points[i]!;
        mark(point.east, point.north);
        const next = points[i + 1];
        if (!next) continue;
        const steps = Math.ceil(Math.hypot(next.east - point.east, next.north - point.north) / 20);
        for (let step = 1; step < steps; step++) {
          mark(point.east + (next.east - point.east) * step / steps, point.north + (next.north - point.north) * step / steps);
        }
      }
      if (lastCamera) {
        lastCamera.signature = "";
        clearTimeout(timer);
        timer = window.setTimeout(select, 0);
      }
    },
    heightAt(east: number, north: number, fallback: number) {
      const res = meta.overviewResolution;
      const half = meta.size / 2;
      const col = Math.max(0, Math.min(199, Math.floor((east + half) / res)));
      const row = Math.max(0, Math.min(199, Math.floor((half - north) / res)));
      const z = overviewHeights[row * 200 + col];
      return Number.isFinite(z) ? z! : fallback;
    },
    update(camera: Camera & { zoom: number; left: number; right: number }, width: number, target: Vector3) {
      const signature = [camera.zoom, camera.position.x, camera.position.y, camera.position.z, target.x, target.y, target.z, width].join(",");
      if (lastCamera?.signature === signature) return;
      lastCamera = { camera, width, target, signature };
      clearTimeout(timer);
      timer = window.setTimeout(select, 0);
    },
    hover(raycaster: import("three").Raycaster) {
      const hit = raycaster.intersectObjects(group.children, false)[0];
      if (!hit) return null;
      const data = hit.object.userData.regional as { tile: RegionTile; level: number; heights: Float32Array; codes: Uint8Array; measured: Uint8Array; measuredPacked: boolean };
      const { tile, level, heights, codes } = data;
      const n = tile.size / level;
      const c = Math.min(n - 1, Math.max(0, Math.floor((hit.point.x - tile.west) / level)));
      const r = Math.min(n - 1, Math.max(0, Math.floor((hit.point.z + tile.north) / level)));
      const i = r * n + c;
      return { x: hit.point.x, y: -hit.point.z, elevation: heights[i], code: codes[i], measured: isMeasured(data, i) };
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      pending.forEach((controller) => controller.abort());
      free(overview);
      cache.forEach(free);
      cache.clear();
      resident.clear();
      mask.dispose();
      scene.remove(group);
    },
  };
}
