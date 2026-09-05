import { setTimeout as delay } from "node:timers/promises";
import { metersBetween, stepSatisfied, TELEMETRY_STALE_MS, type FlightPlan } from "../lib/operations";
import type { CommandContext, DroneAdapter } from "./drone-adapter";

import { executeAdapterCommand } from "./adapter-command";

export class MissionExecutor {
  constructor(private readonly adapter: DroneAdapter) {}
  async run(plan: FlightPlan, commandId: string, generation: number, signal: AbortSignal) {
    const deadline = Date.now() + plan.maxDurationSec * 1000;
    for (let index = 0; index < plan.steps.length; index++) {
      if (signal.aborted) throw new Error("Execution cancelled.");
      const step = plan.steps[index];
      const context: CommandContext = { commandId: `${commandId}:step:${index}`, generation, expiresAt: Date.now() + 2000, signal };
      if (step.kind === "takeoff") await executeAdapterCommand(context, command => this.adapter.takeoff(step.altitudeM, command));
      else if (step.kind === "land") await executeAdapterCommand(context, command => this.adapter.land(command));
      else if (step.kind === "waypoint") {
        if (!this.adapter.goTo) throw new Error("Adapter does not support geographic waypoints.");
        await executeAdapterCommand(context, command => this.adapter.goTo!(step.position, step.altitudeM, command));
      } else await executeAdapterCommand(context, command => this.adapter.stop(command));
      let dwellMs = 0, previousCapturedAt = 0;
      // Keep enough measured dwell for the backend's independent progress verifier at 10 Hz.
      const requiredDwell = step.kind === "hover" ? step.durationSec * 1000 + 400 : step.kind === "land" ? 1500 : 700;
      while (dwellMs < requiredDwell) {
        await delay(50, undefined, { signal });
        if (Date.now() > deadline) throw new Error("Flight plan execution deadline exceeded.");
        const sample = await this.adapter.getTelemetry();
        if (!sample.connected || Date.now() - sample.capturedAt > TELEMETRY_STALE_MS || sample.faults.length) throw new Error("Aircraft telemetry or health unavailable.");
        if (sample.altitudeM !== null && sample.altitudeM > plan.maxAltitudeM) throw new Error("Aircraft exceeded the altitude boundary.");
        if (sample.position && metersBetween(sample.position, plan.home) > plan.radiusM) throw new Error("Aircraft exceeded the flight boundary.");
        if (sample.batteryPct !== null && sample.batteryPct < 20) throw new Error("Aircraft battery reached the reserve threshold.");
        if (sample.controlOwner !== "autonomy") throw new Error("Autonomous control ownership lost.");
        const dt = previousCapturedAt ? sample.capturedAt - previousCapturedAt : 0;
        if (dt > 0) {
          dwellMs = stepSatisfied(step, sample) && dt <= 500 ? dwellMs + dt : 0;
          previousCapturedAt = sample.capturedAt;
        } else if (!previousCapturedAt) previousCapturedAt = sample.capturedAt;
      }
    }
  }
}
