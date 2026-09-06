"use client";
import { useEffect, useRef } from "react";
import type { AircraftSample, GeoPoint, RoutePoint } from "@/lib/operations";
import type { SurveyArea } from "@/lib/areas";
import { toLocal } from "@/lib/geo-local";
import { ITHACA_REGION_API, ITHACA_SIZE_M } from "@/lib/ithaca";
import { createRegionalTerrain, loadRegionManifest, tilesCovering, unionTileBounds } from "@/lib/ithaca-map/regional-terrain";

type ViewMode = "top" | "orbit";

function pixelDroneTexture(THREE: typeof import("three")) {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const px = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  px(3, 3, 6, 6, "#11140f");
  px(23, 3, 6, 6, "#11140f");
  px(3, 23, 6, 6, "#11140f");
  px(23, 23, 6, 6, "#11140f");
  px(4, 4, 4, 4, "#fff5d0");
  px(24, 4, 4, 4, "#fff5d0");
  px(4, 24, 4, 4, "#fff5d0");
  px(24, 24, 4, 4, "#fff5d0");
  px(7, 7, 18, 2, "#ffb850");
  px(7, 23, 18, 2, "#ffb850");
  px(7, 7, 2, 18, "#ffb850");
  px(23, 7, 2, 18, "#ffb850");
  px(12, 11, 8, 10, "#11140f");
  px(13, 12, 6, 8, "#fff5d0");
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function MissionScene({
  sample,
  home,
  viewMode = "top",
  area,
  destinations,
  previewPosition,
  spriteSrc,
}: {
  sample?: AircraftSample;
  home: GeoPoint;
  viewMode?: ViewMode;
  terrainKey?: string;
  area?: SurveyArea;
  destinations?: RoutePoint[];
  previewPosition?: GeoPoint;
  spriteSrc?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  const pathRef = useRef(destinations);
  pathRef.current = destinations;
  const previewRef = useRef(previewPosition);
  previewRef.current = previewPosition;
  const applyView = useRef<(mode: ViewMode) => void>(() => undefined);
  const kickRender = useRef<() => void>(() => undefined);
  const pathKey = (destinations ?? []).map((point) => `${point.lat.toFixed(6)},${point.lon.toFixed(6)},${point.elev?.toFixed(1) ?? ""}`).join(";");
  const previewKey = previewPosition
    ? `${previewPosition.lat.toFixed(6)},${previewPosition.lon.toFixed(6)}`
    : "";
  useEffect(() => { applyView.current(viewMode); }, [viewMode]);
  useEffect(() => { kickRender.current(); }, [sample, pathKey, previewKey]);
  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let renderer: import("three").WebGLRenderer | undefined;
    let scheduled = 0;
    let observer: ResizeObserver | undefined;
    let controls: { dispose: () => void } | undefined;
    let regional: Awaited<ReturnType<typeof createRegionalTerrain>> | undefined;
    void (async () => {
      const [THREE, orbitMod, line2Mod, lineGeomMod, lineMatMod, meta] = await Promise.all([
        import("three"),
        import("three/addons/controls/OrbitControls.js"),
        import("three/addons/lines/Line2.js"),
        import("three/addons/lines/LineGeometry.js"),
        import("three/addons/lines/LineMaterial.js"),
        loadRegionManifest(ITHACA_REGION_API),
      ]);
      if (disposed || !host.current) return;
      const size = ITHACA_SIZE_M;
      const origin = home;
      const baseline = Math.floor(meta.zMin) - 3;

      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(1);
      renderer.localClippingEnabled = true;
      renderer.setClearColor(0x111c24, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x111c24);
      const worldSpan = size;
      const radius = Math.max(worldSpan / 2, 400);
      const half = radius * 1.28;
      const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, Math.max(3000, worldSpan * 3));
      let drawImpl = (_time: number) => undefined;
      const requestRender = () => {
        if (disposed || scheduled) return;
        scheduled = requestAnimationFrame((time) => {
          scheduled = 0;
          drawImpl(time);
        });
      };
      kickRender.current = requestRender;
      const lineResolution = new THREE.Vector2(1, 1);
      const lineMaterials: InstanceType<typeof lineMatMod.LineMaterial>[] = [];
      const resize = () => {
        if (!host.current || !renderer) return;
        const width = Math.max(16, host.current.clientWidth);
        const height = Math.max(16, host.current.clientHeight);
        const aspect = width / height;
        camera.left = -half * Math.max(1, aspect);
        camera.right = -camera.left;
        camera.top = half * Math.max(1, 1 / aspect);
        camera.bottom = -camera.top;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        lineResolution.set(width, height);
        for (const material of lineMaterials) material.resolution.copy(lineResolution);
        requestRender();
      };
      resize();
      host.current.appendChild(renderer.domElement);
      const observerLocal = new ResizeObserver(resize);
      observer = observerLocal;
      observerLocal.observe(host.current);

      const orbit = new orbitMod.OrbitControls(camera, renderer.domElement);
      controls = orbit;
      orbit.enableDamping = false;
      orbit.minZoom = 0.4;
      orbit.maxZoom = 64;
      orbit.maxPolarAngle = Math.PI * 0.485;
      orbit.screenSpacePanning = true;
      orbit.addEventListener("change", requestRender);

      scene.add(new THREE.HemisphereLight(0xe3f0f5, 0x46553b, 1.5));
      const sun = new THREE.DirectionalLight(0xffefd5, 2.3);
      sun.position.set(-worldSpan * 0.7, worldSpan * 1.2, worldSpan * 0.47);
      scene.add(sun);
      regional = await createRegionalTerrain(scene, {
        url: ITHACA_REGION_API,
        meta,
        baseline,
        requestRender,
        detailLevel: 5,
      });
      if (disposed) { regional.dispose(); return; }

      const spriteTex = await new THREE.TextureLoader()
        .loadAsync(spriteSrc ?? "/drones/dji-mini-4k.png")
        .catch(() => pixelDroneTexture(THREE));
      if (disposed) return;
      spriteTex.colorSpace = THREE.SRGBColorSpace;
      spriteTex.magFilter = THREE.NearestFilter;
      spriteTex.minFilter = THREE.NearestFilter;
      spriteTex.generateMipmaps = false;
      const drone = new THREE.Sprite(new THREE.SpriteMaterial({
        map: spriteTex,
        color: 0xffffff,
        depthTest: false,
        transparent: true,
        alphaTest: 0.15,
        toneMapped: false,
      }));
      drone.center.set(0.5, 0.5);
      drone.renderOrder = 30;
      drone.visible = false;
      scene.add(drone);

      const trailMaterial = new lineMatMod.LineMaterial({
        color: 0xffe36d,
        linewidth: 5,
        worldUnits: false,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.95,
        alphaToCoverage: true,
      });
      trailMaterial.resolution.copy(lineResolution);
      lineMaterials.push(trailMaterial);
      let trail: InstanceType<typeof line2Mod.Line2> | undefined;
      let lastPathKey = "";
      if (area) {
        const corners = [
          area.northWest,
          { lat: area.northWest.lat, lon: area.southEast.lon },
          area.southEast,
          { lat: area.southEast.lat, lon: area.northWest.lon },
          area.northWest,
        ].map((point) => {
          const loc = toLocal(origin, point);
          const ground = regional!.heightAt(loc.east, loc.north, meta.zMin) - baseline + 2;
          return new THREE.Vector3(loc.east, ground, -loc.north);
        });
        const geometry = new lineGeomMod.LineGeometry();
        geometry.setPositions(corners.flatMap((point) => [point.x, point.y, point.z]));
        const material = new lineMatMod.LineMaterial({
          color: 0x9ef2f8,
          linewidth: 7,
          worldUnits: false,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.95,
          alphaToCoverage: true,
        });
        material.resolution.copy(lineResolution);
        lineMaterials.push(material);
        const box = new line2Mod.Line2(geometry, material);
        box.computeLineDistances();
        box.renderOrder = 18;
        scene.add(box);
      }

      const groundY = (meta.zMax - baseline) / 2;
      let mode: ViewMode = "top";
      let transition: {
        from: import("three").Spherical;
        to: import("three").Spherical;
        fromTarget: import("three").Vector3;
        toTarget: import("three").Vector3;
        fromZoom: number;
        toZoom: number;
        started: number;
        duration: number;
      } | null = null;

      const jobPoints = () => [
        home,
        ...(previewRef.current ? [previewRef.current] : []),
        ...(area ? [
          area.northWest,
          { lat: area.northWest.lat, lon: area.southEast.lon },
          area.southEast,
          { lat: area.southEast.lat, lon: area.northWest.lon },
        ] : []),
        ...(pathRef.current ?? []),
      ].map((point) => toLocal(origin, point));
      const jobBounds = () => {
        const pts = jobPoints();
        const mapHalf = size / 2;
        const buffer = 80;
        const west = Math.max(-mapHalf, Math.min(...pts.map((p) => p.east)) - buffer);
        const east = Math.min(mapHalf, Math.max(...pts.map((p) => p.east)) + buffer);
        const south = Math.max(-mapHalf, Math.min(...pts.map((p) => p.north)) - buffer);
        const north = Math.min(mapHalf, Math.max(...pts.map((p) => p.north)) + buffer);
        return {
          west, east, south, north,
          width: Math.max(420, east - west),
          height: Math.max(420, north - south),
        };
      };
      const focus = unionTileBounds(tilesCovering(meta.tiles, jobBounds()));
      const zoomToFit = (widthM: number, heightM: number, pad: number) => Math.min(
        orbit.maxZoom,
        Math.max(
          orbit.minZoom,
          Math.min(
            (camera.right - camera.left) / (Math.max(150, widthM) * pad),
            (camera.top - camera.bottom) / (Math.max(150, heightM) * pad),
          ),
        ),
      );

      const setView = (name: ViewMode, animate = true) => {
        const map = name === "top";
        mode = name;
        regional!.setFocus(map ? null : focus);
        scene.background = map ? new THREE.Color(0x111c24) : null;
        renderer!.setClearColor(0x111c24, map ? 1 : 0);
        if (host.current) host.current.classList.toggle("is-orbit", !map);
        orbit.enableRotate = !map;
        orbit.mouseButtons.LEFT = map ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
        orbit.touches.ONE = map ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
        orbit.touches.TWO = THREE.TOUCH.DOLLY_PAN;
        const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(orbit.target));
        const toOffset = map
          ? new THREE.Vector3(0, Math.max(400, worldSpan * 1.4), 0.001)
          : new THREE.Vector3(worldSpan * 0.52, worldSpan * 0.46, worldSpan * 0.60);
        const to = new THREE.Spherical().setFromVector3(toOffset);
        to.theta = from.theta + Math.atan2(Math.sin(to.theta - from.theta), Math.cos(to.theta - from.theta));
        const job = jobBounds();
        const frame = !map && focus ? focus : job;
        const toTarget = new THREE.Vector3(
          (frame.west + frame.east) / 2,
          groundY,
          -(frame.south + frame.north) / 2,
        );
        const toZoom = !map && focus
          ? zoomToFit(focus.east - focus.west, focus.north - focus.south, 1.45)
          : zoomToFit(job.width, job.height, 1.45);
        if (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          transition = {
            from, to,
            fromTarget: orbit.target.clone(),
            toTarget,
            fromZoom: camera.zoom,
            toZoom,
            started: performance.now(),
            duration: 900,
          };
          orbit.enabled = false;
        } else {
          transition = null;
          orbit.enabled = true;
          orbit.target.copy(toTarget);
          camera.position.copy(toTarget).add(new THREE.Vector3().setFromSpherical(to));
          camera.zoom = toZoom;
          camera.updateProjectionMatrix();
          orbit.update();
        }
        requestRender();
      };
      applyView.current = (name) => { if (name !== mode) setView(name); };

      drawImpl = (time: number) => {
        if (disposed) return;
        const snap = sampleRef.current;
        const point = snap?.position ?? previewRef.current;
        drone.visible = !!point;
        if (point) {
          const local = toLocal(origin, point);
          const groundZ = regional!.heightAt(local.east, local.north, meta.zMin) - baseline;
          const flying = !!snap && (snap.altitudeM ?? 0) > 0.5;
          const agl = flying ? Math.max(0, snap.altitudeM ?? 0) : 0;
          drone.center.set(0.5, flying ? 0.5 : 0.08);
          drone.position.set(local.east, groundZ + agl, -local.north);
          const meters = THREE.MathUtils.clamp(90 / camera.zoom, 22, 160);
          drone.scale.set(meters, meters, 1);
        }

        const pts = (snap?.mission?.path ?? pathRef.current ?? []) as RoutePoint[];
        const pathKey = pts.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)},${p.elev?.toFixed(1) ?? ""}`).join(";");
        if (pathKey !== lastPathKey) {
          lastPathKey = pathKey;
          if (pts.length > 1) {
            const geometry = new lineGeomMod.LineGeometry();
            geometry.setPositions(pts.flatMap((p) => {
              const loc = toLocal(origin, p);
              const groundZ = regional!.heightAt(loc.east, loc.north, meta.zMin) - baseline;
              return [loc.east, p.elev == null ? groundZ + 3 : p.elev - baseline, -loc.north];
            }));
            if (!trail) {
              trail = new line2Mod.Line2(geometry, trailMaterial);
              trail.renderOrder = 20;
              scene.add(trail);
            } else {
              trail.geometry.dispose();
              trail.geometry = geometry;
            }
            trail.computeLineDistances();
            trail.visible = true;
          } else if (trail) {
            trail.visible = false;
          }
        }

        if (transition) {
          const t = Math.min(1, (time - transition.started) / transition.duration);
          const ease = t * t * (3 - 2 * t);
          const spherical = new THREE.Spherical(
            THREE.MathUtils.lerp(transition.from.radius, transition.to.radius, ease),
            THREE.MathUtils.lerp(transition.from.phi, transition.to.phi, ease),
            THREE.MathUtils.lerp(transition.from.theta, transition.to.theta, ease),
          );
          orbit.target.lerpVectors(transition.fromTarget, transition.toTarget, ease);
          camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(spherical));
          camera.zoom = THREE.MathUtils.lerp(transition.fromZoom, transition.toZoom, ease);
          camera.updateProjectionMatrix();
          orbit.update();
          if (t === 1) { transition = null; orbit.enabled = true; }
          else requestRender();
        }
        if (host.current) regional!.update(camera, host.current.clientWidth, orbit.target);
        renderer!.render(scene, camera);
      };
      const start = jobBounds();
      orbit.target.set((start.west + start.east) / 2, groundY, -(start.south + start.north) / 2);
      camera.position.set(0, Math.max(400, worldSpan * 1.4), 0.001);
      camera.zoom = 1;
      setView("top", false);
      applyView.current(viewMode);
      requestRender();
    })().catch((error) => {
      console.error(error);
      if (host.current && !disposed) {
        host.current.dataset.error = error instanceof Error ? error.message : "Terrain failed to load";
        host.current.textContent = "Ithaca 5 km terrain is still generating. Reload this job when acquisition finishes.";
      }
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      cancelAnimationFrame(scheduled);
      kickRender.current = () => undefined;
      controls?.dispose();
      regional?.dispose();
      applyView.current = () => undefined;
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, [home.lat, home.lon, area?.northWest.lat, area?.northWest.lon, area?.southEast.lat, area?.southEast.lon, spriteSrc]);
  return <div ref={host} className="mission-scene" data-testid="mission-scene" aria-label="Ithaca mission map" />;
}
