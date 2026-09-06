/** Protocol-neutral flight data. Distances are meters; altitudes are relative to home. */
export type GeoPoint = { lat: number; lon: number };
export type Environment = "simulated" | "aircraft";
export type ControlMode = "autonomous" | "manual";
export type ControlOwner = "none" | "autonomy" | "remote" | "computer";
export type JobKind = "flight_check" | "search" | "inspection" | "deliver";
export type Capability = "takeoff" | "hover" | "land" | "position" | "autonomous" | "manual_remote" | "manual_computer" | "camera" | "payload";
export type OperationState = "assigned" | "ready" | "starting" | "active" | "taking_over" | "manual" | "returning" | "landing" | "completed" | "cancelled" | "attention";
export type CommandKind = "start" | "takeover" | "hold" | "return" | "land";
export type PlanStep = { kind: "takeoff" | "waypoint" | "hover" | "land"; label: string; position: GeoPoint; altitudeM: number; durationSec: number };
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
};

export const TELEMETRY_STALE_MS = 2000;
export const SESSION_LEASE_MS = 10000;
export const COMMAND_TTL_MS = 8000;
export const JOB_LABELS: Record<JobKind, string> = { flight_check: "Flight check", search: "Search & Rescue", inspection: "Inspection", deliver: "Delivery" };
export const REQUEST_MODES = [
  { kind: "deliver" as const, label: "Delivery", summary: "Carry a payload to a drop-off.", frame: 0 },
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
  const required = vehicle.environment === "simulated"
    ? input.required.filter(capability => capability !== "camera" && capability !== "payload")
    : input.required;
  return operator.approved && operator.acceptingJobs && operator.qualifications.includes(input.kind)
    && metersBetween(operator.base, input.location) <= operator.serviceRadiusM
    && vehicle.environment === input.environment && vehicle.available
    && (vehicle.environment === "simulated" || vehicle.integrationApproved)
    && input.payloadKg <= vehicle.maxPayloadKg && required.every(cap => vehicle.capabilities.includes(cap));
}

export function createFlightPlan(input: { kind: JobKind; location: GeoPoint; destinations: GeoPoint[]; mode: ControlMode; home: GeoPoint; altitudeM: number; hoverSec: number; maxRadiusM: number }): FlightPlan {
  for (const point of [input.home, input.location, ...input.destinations]) assertGeo(point);
  if (!Number.isFinite(input.altitudeM) || input.altitudeM < 2 || input.altitudeM > 30) throw new Error("Choose an altitude between 2 and 30 meters.");
  if (!Number.isFinite(input.hoverSec) || input.hoverSec < 5 || input.hoverSec > 120) throw new Error("Hover duration must be between 5 and 120 seconds.");
  if (!Number.isFinite(input.maxRadiusM) || input.maxRadiusM < 5 || input.maxRadiusM > 100000) throw new Error("Invalid flight boundary.");
  if (metersBetween(input.home, input.location) > input.maxRadiusM) throw new Error("The request is outside this aircraft's flight boundary.");
  const destinations = input.kind === "flight_check" ? [] : input.destinations;
  if (input.kind !== "flight_check" && (destinations.length < 1 || destinations.length > 50)) throw new Error("Select a route with 1–50 waypoints.");
  if (destinations.some(p => metersBetween(input.home, p) > input.maxRadiusM)) throw new Error("A waypoint is outside the aircraft's flight boundary.");
  const steps: PlanStep[] = [{ kind: "takeoff", label: "Take off", position: input.home, altitudeM: input.altitudeM, durationSec: 0 }];
  destinations.forEach((position, i) => steps.push({ kind: "waypoint", label: `Waypoint ${i + 1}`, position, altitudeM: input.altitudeM, durationSec: 0 }));
  steps.push({ kind: "hover", label: input.kind === "flight_check" ? "Hover check" : "Hold at task location", position: destinations.at(-1) ?? input.home, altitudeM: input.altitudeM, durationSec: input.hoverSec });
  if (destinations.length) steps.push({ kind: "waypoint", label: "Return home", position: input.home, altitudeM: input.altitudeM, durationSec: 0 });
  steps.push({ kind: "land", label: "Land and disarm", position: input.home, altitudeM: 0, durationSec: 0 });
  const distance = steps.slice(1).reduce((total, s, i) => total + metersBetween(steps[i].position, s.position), 0);
  const cruiseSpeedMps = 2;
  const maxDurationSec = Math.ceil(distance / cruiseSpeedMps + input.altitudeM * 2 + input.hoverSec + 60);
  if (maxDurationSec > 900) throw new Error("This route exceeds the 15-minute flight budget. Shorten the route.");
  return { version: 1, home: input.home, mode: input.mode, steps, cruiseSpeedMps, maxAltitudeM: input.altitudeM + 5, radiusM: input.maxRadiusM, maxDurationSec, minimumBatteryPct: 30 };
}

export function validateSample(sample: AircraftSample, now: number) {
  if (!Number.isSafeInteger(sample.sequence) || sample.sequence < 0) throw new Error("Invalid telemetry sequence.");
  if (!Number.isFinite(sample.capturedAt) || sample.capturedAt > now + 1000 || sample.capturedAt < now - 10000) throw new Error("Telemetry timestamp is stale or in the future.");
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
  if (metersBetween(sample.position, step.position) > 2 || Math.abs(sample.altitudeM - step.altitudeM) > .5) return false;
  return step.kind === "land" ? sample.airborne === false && sample.armed === false : sample.airborne === true && sample.armed === true;
}
