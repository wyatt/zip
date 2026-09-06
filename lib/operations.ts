/** Protocol-neutral flight data. Distances are meters; altitudes are relative to home. */
export type GeoPoint = { lat: number; lon: number };
export type RoutePoint = GeoPoint & { elev?: number };
export type Environment = "simulated" | "aircraft";
export type ControlMode = "autonomous" | "manual";
export type ControlOwner = "none" | "autonomy" | "remote" | "computer";
export type JobKind = "flight_check" | "search" | "inspection" | "deliver";
export type Capability = "takeoff" | "hover" | "land" | "position" | "autonomous" | "manual_remote" | "manual_computer" | "camera" | "payload";
export type OperationState = "assigned" | "ready" | "starting" | "active" | "taking_over" | "manual" | "returning" | "landing" | "completed" | "cancelled" | "attention";
export type CommandKind = "start" | "takeover" | "hold" | "return" | "land";
export type PlanStep = { kind: "takeoff" | "waypoint" | "hover" | "land" | "survey" | "deliver" | "search"; label: string; position: GeoPoint; altitudeM: number; durationSec: number };
export type FlightPlan = { version: number; home: GeoPoint; mode: ControlMode; steps: PlanStep[]; cruiseSpeedMps: number; maxAltitudeM: number; radiusM: number; maxDurationSec: number; minimumBatteryPct: number };
/** Convex may reorder object keys in transit. Hash plan values in a fixed order. */
export function serializeFlightPlan(plan: FlightPlan): string {
  const point = (value: GeoPoint) => ({ lat: value.lat, lon: value.lon });
  return JSON.stringify({
    version: plan.version, home: point(plan.home), mode: plan.mode,
    steps: plan.steps.map(step => ({ kind: step.kind, label: step.label, position: point(step.position), altitudeM: step.altitudeM, durationSec: step.durationSec })),
    cruiseSpeedMps: plan.cruiseSpeedMps, maxAltitudeM: plan.maxAltitudeM, radiusM: plan.radiusM,
    maxDurationSec: plan.maxDurationSec, minimumBatteryPct: plan.minimumBatteryPct,
  });
}
export type AircraftSample = {
  sequence: number;
  capturedAt: number;
  position: GeoPoint | null;
  altitudeM: number | null;
  batteryPct: number | null;
  headingDeg: number | null;
  speedMps: number | null;
  connected: boolean;
  armed: boolean | null;
  airborne: boolean | null;
  navigationHealthy: boolean;
  controlOwner: ControlOwner;
  flightMode: string;
  faults: string[];
  mission?: {
    mode: Exclude<JobKind, "flight_check">;
    phase: string;
    elapsed: number;
    battery: number;
    predictedArrivalBattery: number;
    photos: number;
    totalPhotos: number;
    sorties: number;
    returns: number;
    multiplier: number;
    distance: number;
    reason: string;
    terrainKey: string;
    result?: { type: string; lat: number; lon: number; foundAt: number };
    path?: GeoPoint[];
  };
};
export type MissionSnapshot = NonNullable<AircraftSample["mission"]>;

export const TELEMETRY_STALE_MS = 2000;
export const SESSION_LEASE_MS = 10000;
export const COMMAND_TTL_MS = 8000;
export const WAITING_FLEET_RADIUS_M = 8000;
export const JOB_LABELS: Record<JobKind, string> = { flight_check: "Flight check", search: "Search & Rescue", inspection: "Inspection", deliver: "Delivery" };
export const REQUEST_MODES = [
  { kind: "deliver" as const, label: "Delivery", summary: "Fly A → B, deliver, and return to A.", frame: 0 },
  { kind: "inspection" as const, label: "Inspection", summary: "Sweep a site with a camera.", frame: 1 },
  { kind: "search" as const, label: "Search & Rescue", summary: "Search an area for a person or object.", frame: 2 },
];
export type RequestKind = (typeof REQUEST_MODES)[number]["kind"];
export const OPERATION_LABELS: Record<OperationState, string> = { assigned: "Preparing flight", ready: "Ready for departure", starting: "Awaiting aircraft", active: "In flight", taking_over: "Transferring control", manual: "Operator in control", returning: "Returning home", landing: "Landing", completed: "Completed", cancelled: "Cancelled", attention: "Attention required" };

export function assertGeo(point: GeoPoint) {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) throw new Error("Invalid geographic coordinates.");
}
export function metersBetween(a: GeoPoint, b: GeoPoint) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function pathLengthM(points: GeoPoint[]) {
  return points.slice(1).reduce((total, point, index) => total + metersBetween(points[index]!, point), 0);
}
function appendDistinct(path: GeoPoint[], point: GeoPoint) {
  const last = path.at(-1);
  if (!last || metersBetween(last, point) > 1) path.push(point);
}
/** Pickup A and drop-off B. A single stored point is treated as B from the aircraft home. */
export function deliveryEndpoints(input: { location: GeoPoint; destinations: GeoPoint[]; home?: GeoPoint }): { a: GeoPoint; b: GeoPoint } {
  const b = input.destinations.at(-1) ?? input.location;
  if (metersBetween(input.location, b) >= 10) return { a: input.location, b };
  return { a: input.home ?? input.location, b };
}
/** Planned route and duration shown before an operator accepts. */
export function previewAcceptedFlight(input: {
  kind: JobKind;
  location: GeoPoint;
  destinations: GeoPoint[];
  home: GeoPoint;
  altitudeM: number;
  hoverSec: number;
}): { path: GeoPoint[]; durationSec: number; cruiseSpeedMps: number } {
  const cruiseSpeedMps = input.kind === "flight_check" ? 2 : 5;
  const path: GeoPoint[] = [];
  appendDistinct(path, input.home);
  if (input.kind === "deliver") {
    const { a, b } = deliveryEndpoints({ ...input, home: input.home });
    appendDistinct(path, a);
    appendDistinct(path, b);
    appendDistinct(path, a);
  } else if (input.kind !== "flight_check") {
    appendDistinct(path, input.location);
    for (const dest of input.destinations) appendDistinct(path, dest);
    appendDistinct(path, input.home);
  }
  const durationSec = Math.ceil(pathLengthM(path) / cruiseSpeedMps + input.altitudeM * 2 + input.hoverSec + 60);
  return { path, durationSec, cruiseSpeedMps };
}
export function requiredCapabilities(kind: JobKind): Capability[] {
  const base: Capability[] = ["takeoff", "hover", "land", "position"];
  if (kind === "inspection" || kind === "search") base.push("camera");
  if (kind === "deliver") base.push("payload");
  return base;
}
export function matchesRequirements(input: {
  kind: JobKind; environment: Environment; location: GeoPoint; required: Capability[]; payloadKg: number;
}, operator: { approved: boolean; acceptingJobs: boolean; qualifications: JobKind[]; base: GeoPoint; serviceRadiusM: number }, vehicle: {
  environment: Environment; capabilities: Capability[]; maxPayloadKg: number; available: boolean; integrationApproved: boolean;
}) {
  const required = input.required.filter(capability => capability !== "camera" && capability !== "payload");
  return operator.approved && operator.acceptingJobs && operator.qualifications.includes(input.kind)
    && metersBetween(operator.base, input.location) <= operator.serviceRadiusM
    && vehicle.available
    && input.payloadKg <= vehicle.maxPayloadKg && required.every(cap => vehicle.capabilities.includes(cap));
}

export function createFlightPlan(input: { kind: JobKind; location: GeoPoint; destinations: GeoPoint[]; mode: ControlMode; home: GeoPoint; altitudeM: number; hoverSec: number; maxRadiusM: number }): FlightPlan {
  for (const point of [input.home, input.location, ...input.destinations]) assertGeo(point);
  if (!Number.isFinite(input.maxRadiusM) || input.maxRadiusM < 5 || input.maxRadiusM > 100000) throw new Error("Invalid flight boundary.");
  if (metersBetween(input.home, input.location) > input.maxRadiusM) throw new Error("The request is outside this aircraft's flight boundary.");
  if (input.kind === "flight_check") {
    if (!Number.isFinite(input.altitudeM) || input.altitudeM < 2 || input.altitudeM > 30) throw new Error("Choose an altitude between 2 and 30 meters.");
    if (!Number.isFinite(input.hoverSec) || input.hoverSec < 5 || input.hoverSec > 120) throw new Error("Hover duration must be between 5 and 120 seconds.");
    const steps: PlanStep[] = [
      { kind: "takeoff", label: "Take off", position: input.home, altitudeM: input.altitudeM, durationSec: 0 },
      { kind: "hover", label: "Hover check", position: input.home, altitudeM: input.altitudeM, durationSec: input.hoverSec },
      { kind: "land", label: "Land and disarm", position: input.home, altitudeM: 0, durationSec: 0 },
    ];
    const maxDurationSec = Math.ceil(input.altitudeM * 2 + input.hoverSec + 60);
    return { version: 1, home: input.home, mode: input.mode, steps, cruiseSpeedMps: 2, maxAltitudeM: input.altitudeM + 5, radiusM: input.maxRadiusM, maxDurationSec, minimumBatteryPct: 30 };
  }
  const destinations = input.destinations;
  if (destinations.length < 1 || destinations.length > 50) throw new Error("Select a route with 1–50 waypoints.");
  if (destinations.some(p => metersBetween(input.home, p) > input.maxRadiusM)) throw new Error("A waypoint is outside the aircraft's flight boundary.");
  if (input.kind === "deliver" && metersBetween(input.home, input.location) > input.maxRadiusM) throw new Error("Pickup is outside the aircraft's flight boundary.");
  const taskKind = input.kind === "deliver" ? "deliver" as const : input.kind === "search" ? "search" as const : "survey" as const;
  const taskLabel = input.kind === "deliver" ? "Deliver package" : input.kind === "search" ? "Search area" : "Inspect area";
  const ends = input.kind === "deliver" ? deliveryEndpoints(input) : null;
  const taskAt = ends?.b ?? destinations[0]!;
  const landAt = ends?.a ?? input.home;
  const cruise = 30;
  const steps: PlanStep[] = [
    { kind: "takeoff", label: "Take off", position: input.home, altitudeM: cruise, durationSec: 0 },
    { kind: taskKind, label: taskLabel, position: taskAt, altitudeM: cruise, durationSec: 0 },
    { kind: "land", label: "Land and disarm", position: landAt, altitudeM: 0, durationSec: 0 },
  ];
  return { version: 1, home: input.home, mode: input.mode, steps, cruiseSpeedMps: 5, maxAltitudeM: 200, radiusM: input.maxRadiusM, maxDurationSec: 3600, minimumBatteryPct: 10 };
}

export function validateSample(sample: AircraftSample, now: number) {
  if (!Number.isSafeInteger(sample.sequence) || sample.sequence < 0) throw new Error("Invalid telemetry sequence.");
  if (!Number.isFinite(sample.capturedAt) || sample.capturedAt > now + 60000 || sample.capturedAt < now - 60000) throw new Error("Telemetry timestamp is stale or in the future.");
  if (sample.position) assertGeo(sample.position);
  for (const [name, value, low, high] of [
    ["altitude", sample.altitudeM, -100, 10000], ["battery", sample.batteryPct, 0, 100],
    ["heading", sample.headingDeg, 0, 360], ["speed", sample.speedMps, 0, 200],
  ] as const) if (value !== null && (!Number.isFinite(value) || value < low || value > high)) throw new Error(`Invalid ${name} measurement.`);
  if (sample.faults.length > 20 || sample.faults.some(f => f.length > 200) || sample.flightMode.length > 80) throw new Error("Invalid aircraft status.");
  if (sample.airborne === true && sample.armed === false) throw new Error("Inconsistent armed and airborne state.");
}

export function preflightProblems(sample: AircraftSample | null, plan: FlightPlan, now: number): string[] {
  if (!sample || now - sample.capturedAt > TELEMETRY_STALE_MS) return ["Waiting for fresh aircraft telemetry"];
  const problems: string[] = [];
  if (!sample.connected) problems.push("Aircraft disconnected");
  if (!sample.navigationHealthy || !sample.position) problems.push("Navigation is not ready");
  if (sample.batteryPct === null || sample.batteryPct < plan.minimumBatteryPct) problems.push("Insufficient battery or battery unknown");
  if (sample.armed !== false || sample.airborne !== false) problems.push("Aircraft must be grounded and disarmed");
  if (sample.position && metersBetween(sample.position, plan.home) > 5) problems.push("Aircraft is not at the planned launch point");
  if (sample.altitudeM === null || Math.abs(sample.altitudeM) > 1) problems.push("Ground altitude is not established");
  return [...problems, ...sample.faults];
}

export function stepSatisfied(step: PlanStep, sample: AircraftSample): boolean {
  if (!sample.connected || !sample.position || sample.altitudeM === null || !sample.navigationHealthy) return false;
  if (step.kind === "survey" || step.kind === "deliver" || step.kind === "search") {
    return sample.flightMode === "mission_complete" || sample.mission?.phase === "complete";
  }
  if (metersBetween(sample.position, step.position) > 2 || Math.abs(sample.altitudeM - step.altitudeM) > .5) return false;
  return step.kind === "land" ? sample.airborne === false && sample.armed === false : sample.airborne === true && sample.armed === true;
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function missionProgressPct(input: {
  state: OperationState;
  steps: PlanStep[];
  currentStep: number;
  verifiedSteps: number[];
  sample?: AircraftSample | null;
  dwellMs?: number;
}): number {
  if (input.state === "completed") return 100;
  if (input.state === "cancelled" || input.steps.length === 0) return 0;
  const verified = new Set(input.verifiedSteps);
  let units = 0;
  for (let index = 0; index < input.steps.length; index++) {
    const step = input.steps[index]!;
    if (verified.has(index) || index < input.currentStep) {
      units += 1;
      continue;
    }
    if (index !== input.currentStep) continue;
    units += currentStepFraction(step, input.steps[index - 1], input.sample ?? null, input.dwellMs ?? 0);
  }
  return Math.round(clamp01(units / input.steps.length) * 100);
}

function currentStepFraction(step: PlanStep, previous: PlanStep | undefined, sample: AircraftSample | null, dwellMs: number) {
  if (!sample?.connected) return 0;
  if (step.kind === "takeoff") {
    if (sample.altitudeM === null || step.altitudeM <= 0) return 0;
    return clamp01(sample.altitudeM / step.altitudeM);
  }
  if (step.kind === "hover") {
    if (step.durationSec <= 0) return stepSatisfied(step, sample) ? 1 : 0;
    return clamp01(dwellMs / (step.durationSec * 1000));
  }
  if (step.kind === "land") {
    if (sample.armed === false && sample.airborne === false) return 1;
    const ceiling = Math.max(previous?.altitudeM ?? 3, 1);
    if (sample.altitudeM === null) return 0;
    return clamp01(1 - sample.altitudeM / ceiling);
  }
  if (!sample.position) return 0;
  const from = previous?.position ?? step.position;
  const total = metersBetween(from, step.position);
  if (total < 1) return metersBetween(sample.position, step.position) <= 2 ? 1 : 0;
  return clamp01(1 - metersBetween(sample.position, step.position) / total);
}

const IN_FLIGHT: OperationState[] = [
  "starting", "active", "taking_over", "manual", "returning", "landing",
];

export function remainingFlightSec(input: {
  state: OperationState;
  maxDurationSec: number;
  startedAt?: number;
  now: number;
}) {
  if (input.state === "completed" || input.state === "cancelled") return 0;
  if (!input.startedAt || !IN_FLIGHT.includes(input.state)) return input.maxDurationSec;
  return Math.max(0, input.maxDurationSec - Math.floor((input.now - input.startedAt) / 1000));
}

export function formatDurationSec(sec: number) {
  if (sec <= 0) return "0s";
  if (sec < 60) return `${sec}s`;
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function operationStatusPending(state: OperationState) {
  return !["completed", "cancelled", "attention"].includes(state);
}
