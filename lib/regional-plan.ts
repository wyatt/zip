import type { SurveyArea } from "./areas";
import { fromLocal, ringFromArea, toLocal } from "./geo-local";
import { ITHACA_REGION_API } from "./ithaca";
import { planRegionalMission } from "./inspection-sim/regional-mission-planner.js";
import { deliveryEndpoints, previewAcceptedFlight, type GeoPoint, type JobKind, type RoutePoint } from "./operations";

export type RegionalMissionConfig = {
  mode: "delivery" | "inspection" | "search";
  a: number[];
  b?: number[];
  home?: number[];
  polygon?: number[][][];
  settings?: { seed: number };
};

export type RoutePreview = {
  path: RoutePoint[];
  durationSec: number;
  cruiseSpeedMps: number;
  planned: boolean;
};

export type RegionalJobInput = {
  kind: JobKind;
  home: GeoPoint;
  location: GeoPoint;
  destinations: GeoPoint[];
  area?: SurveyArea;
  altitudeM: number;
  hoverSec: number;
};

function hashSeed(point: GeoPoint) {
  return Math.abs(Math.floor(point.lat * 1e6 + point.lon * 1e5)) || 1;
}

function boxAround(home: GeoPoint, point: GeoPoint): SurveyArea {
  const lat = [home.lat, point.lat];
  const lon = [home.lon, point.lon];
  return {
    northWest: { lat: Math.max(...lat) + 0.001, lon: Math.min(...lon) - 0.001 },
    southEast: { lat: Math.min(...lat) - 0.001, lon: Math.max(...lon) + 0.001 },
  };
}

/** Local metres relative to the aircraft home, so any fleet can fly on Ithaca terrain. */
export function regionalMissionConfig(input: {
  kind: JobKind;
  home: GeoPoint;
  location: GeoPoint;
  destinations: GeoPoint[];
  area?: SurveyArea;
}): RegionalMissionConfig | null {
  if (input.kind === "flight_check") return null;
  const a = toLocal(input.home, input.home);
  if (input.kind === "deliver") {
    const ends = deliveryEndpoints(input);
    const pad = toLocal(input.home, input.home);
    const start = toLocal(input.home, ends.a);
    const b = toLocal(input.home, ends.b);
    return {
      mode: "delivery",
      home: [pad.east, pad.north],
      a: [start.east, start.north],
      b: [b.east, b.north],
    };
  }
  return {
    mode: input.kind === "search" ? "search" : "inspection",
    a: [a.east, a.north],
    polygon: [ringFromArea(input.area ?? boxAround(input.home, input.location), input.home)],
    settings: { seed: hashSeed(input.home) },
  };
}

function toRoutePoint(origin: GeoPoint, east: number, north: number, elev?: number): RoutePoint {
  const point = fromLocal(origin, { east, north });
  return elev == null ? point : { ...point, elev };
}

function downsampleTasks(
  origin: GeoPoint,
  start: number[] | undefined,
  tasks: { point: number[] }[],
  maxPoints = 400,
): RoutePoint[] {
  const stride = Math.max(1, Math.floor(tasks.length / maxPoints));
  const path: RoutePoint[] = [];
  if (start && start.length >= 2) {
    path.push(toRoutePoint(origin, start[0]!, start[1]!, start[2]));
  }
  for (const [index, task] of tasks.entries()) {
    if (index % stride !== 0 && index !== tasks.length - 1) continue;
    path.push(toRoutePoint(origin, task.point[0]!, task.point[1]!, task.point[2]));
  }
  return path;
}

export type SyntheticRegionalPlan = {
  version: number;
  mode: "delivery" | "inspection" | "search";
  simulated: true;
  start: number[];
  tasks: { point: number[]; kind: string; photo: number | null }[];
  photoCount: number;
  polygon: number[][][] | null;
  target: number[] | null;
  options: { speed: number; climbSpeed: number; flightMinutes: number; arrivalReserve: number; trackSpacing: number; captureSpacing: number; detectionRadius: number };
  flightSeconds: number;
  requiredBattery: number;
};

/** Geometric coverage when the 5 km terrain planner cannot place the job. */
export function syntheticRegionalPlan(input: {
  kind: Exclude<JobKind, "flight_check">;
  home: GeoPoint;
  location: GeoPoint;
  destinations: GeoPoint[];
  area?: SurveyArea;
}): SyntheticRegionalPlan {
  const options = { speed: 5, climbSpeed: 2, flightMinutes: 46.5, arrivalReserve: 10, trackSpacing: 30, captureSpacing: 15, detectionRadius: 50 };
  const cruise = 30;
  const start = [0, 0, 0];
  const tasks: SyntheticRegionalPlan["tasks"] = [];
  let photo = 0;
  const mode = input.kind === "deliver" ? "delivery" as const : input.kind === "search" ? "search" as const : "inspection" as const;
  let polygon: number[][][] | null = null;
  let target: number[] | null = null;
  if (mode === "delivery") {
    const ends = deliveryEndpoints(input);
    const startLocal = toLocal(input.home, ends.a);
    const dest = toLocal(input.home, ends.b);
    if (Math.hypot(startLocal.east, startLocal.north) > 1) {
      tasks.push({ point: [startLocal.east, startLocal.north, cruise], kind: "outbound", photo: null });
    }
    tasks.push({ point: [dest.east, dest.north, cruise], kind: "outbound", photo: null });
    tasks.push({ point: [dest.east, dest.north, cruise], kind: "deliver", photo: null });
    tasks.push({ point: [startLocal.east, startLocal.north, cruise], kind: "return", photo: null });
  } else {
    polygon = [ringFromArea(input.area ?? boxAround(input.home, input.location), input.home)];
    const ring = polygon[0]!;
    const easts = ring.map(point => point[0]!);
    const norths = ring.map(point => point[1]!);
    const west = Math.min(...easts), east = Math.max(...easts);
    const south = Math.min(...norths), north = Math.max(...norths);
    const spacing = mode === "search" ? options.trackSpacing * 2 : options.trackSpacing;
    let row = 0;
    for (let y = south; y <= north + 1e-6; y += spacing, row++) {
      const left = row % 2 === 0;
      const x0 = left ? west : east;
      const x1 = left ? east : west;
      const step = left ? options.captureSpacing : -options.captureSpacing;
      for (let x = x0; left ? x <= x1 + 1e-6 : x >= x1 - 1e-6; x += step) {
        const photoId = mode === "inspection" ? photo++ : null;
        tasks.push({ point: [x, y, cruise], kind: mode, photo: photoId });
      }
    }
    if (mode === "search") {
      const seed = hashSeed(input.home);
      const mid = tasks[Math.min(tasks.length - 1, seed % Math.max(1, tasks.length))];
      if (mid) {
        mid.kind = "found";
        target = mid.point.slice();
      }
    }
    tasks.push({ point: [0, 0, cruise], kind: "return", photo: null });
  }
  if (mode !== "delivery") tasks.push({ point: start.slice(), kind: "return", photo: null });
  let previous = start, flightSeconds = 0;
  for (const task of tasks) {
    flightSeconds += Math.max(Math.hypot(task.point[0]! - previous[0]!, task.point[1]! - previous[1]!) / options.speed, Math.abs(task.point[2]! - previous[2]!) / options.climbSpeed);
    previous = task.point;
  }
  return {
    version: 1, mode, simulated: true, start, tasks, photoCount: photo, polygon, target, options, flightSeconds,
    requiredBattery: flightSeconds / (options.flightMinutes * 60) * 100 + options.arrivalReserve,
  };
}

/** 25 m A* + 5 m terrain-following profile from the regional planner. */
export async function planAcceptedRoute(
  input: RegionalJobInput,
  regionUrl = ITHACA_REGION_API,
): Promise<RoutePreview> {
  const config = regionalMissionConfig(input);
  if (!config) return { ...previewAcceptedFlight(input), planned: false };
  try {
    const planned = await planRegionalMission({ regionUrl, config }) as {
      start?: number[];
      tasks: { point: number[] }[];
      flightSeconds: number;
      options?: { speed?: number };
    };
    return {
      path: downsampleTasks(input.home, planned.start, planned.tasks),
      durationSec: Math.ceil(planned.flightSeconds),
      cruiseSpeedMps: planned.options?.speed ?? 5,
      planned: true,
    };
  } catch {
    if (input.kind === "flight_check") return { ...previewAcceptedFlight(input), planned: false };
    const planned = syntheticRegionalPlan({
      kind: input.kind,
      home: input.home,
      location: input.location,
      destinations: input.destinations,
      area: input.area,
    });
    return {
      path: downsampleTasks(input.home, planned.start, planned.tasks),
      durationSec: Math.ceil(planned.flightSeconds),
      cruiseSpeedMps: planned.options.speed,
      planned: false,
    };
  }
}
