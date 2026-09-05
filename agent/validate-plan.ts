import { assertGeo, metersBetween, type FlightPlan } from "../lib/operations";
import type { AdapterIdentity, DroneAdapter } from "./drone-adapter";

/** Validate before Ready, including optional methods needed by this particular plan. */
export function validateAdapterPlan(plan: FlightPlan, identity: AdapterIdentity, adapter: DroneAdapter) {
  if (plan.version !== 1 || !["autonomous", "manual"].includes(plan.mode)) throw new Error("Unsupported flight plan version or control mode.");
  assertGeo(plan.home);
  if (!Array.isArray(plan.steps) || plan.steps.length < 3 || plan.steps.length > 54 || plan.steps[0].kind !== "takeoff" || plan.steps.at(-1)?.kind !== "land") throw new Error("Flight plan must begin with takeoff and end with landing.");
  if (![plan.radiusM, plan.maxAltitudeM, plan.maxDurationSec, plan.minimumBatteryPct, plan.cruiseSpeedMps].every(Number.isFinite) || plan.radiusM < 5 || plan.radiusM > 3000 || plan.maxAltitudeM < 2 || plan.maxAltitudeM > 35 || plan.maxDurationSec <= 0 || plan.maxDurationSec > 900 || plan.minimumBatteryPct < 30 || plan.minimumBatteryPct > 100 || plan.cruiseSpeedMps <= 0) throw new Error("Invalid flight plan limits.");
  for (const capability of ["takeoff", "hover", "land", "position"] as const) {
    if (!identity.capabilities.includes(capability)) throw new Error(`Aircraft cannot execute this plan: ${capability} is unsupported.`);
  }
  if (plan.mode === "autonomous" && !identity.capabilities.includes("autonomous")) throw new Error("Aircraft does not support autonomous flight.");
  for (const [index, step] of plan.steps.entries()) {
    assertGeo(step.position);
    if (!["takeoff", "waypoint", "hover", "land"].includes(step.kind) || !Number.isFinite(step.altitudeM) || !Number.isFinite(step.durationSec) || step.durationSec < 0 || step.altitudeM < 0 || step.altitudeM > plan.maxAltitudeM || metersBetween(plan.home, step.position) > plan.radiusM) throw new Error("Flight step exceeds the plan's limits.");
    if (step.kind === "takeoff" && index !== 0 || step.kind === "land" && index !== plan.steps.length - 1) throw new Error("Flight plan contains an unexpected takeoff or landing.");
    if (step.kind === "waypoint" && typeof adapter.goTo !== "function") throw new Error("Aircraft adapter does not support geographic waypoints.");
    if (step.kind === "hover" && (step.durationSec < 5 || step.durationSec > 120)) throw new Error("Invalid hover duration.");
  }
}
