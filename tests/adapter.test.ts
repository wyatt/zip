// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { SimulatedDrone } from "../agent/adapters/simulated-drone";
import type { CommandContext } from "../agent/drone-adapter";
import { validateAdapterPlan } from "../agent/validate-plan";
import { createFlightPlan, serializeFlightPlan } from "../lib/operations";
const home = { lat: 42.35596, lon: -71.07029 };
function context(id: string, generation = 1): CommandContext { return { commandId: id, generation, expiresAt: Date.now() + 1000, signal: new AbortController().signal }; }
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
test("unsupported navigation is rejected before preparing a plan", async () => {
  vi.useFakeTimers();
  const adapter = new SimulatedDrone("plan-test", home);
  const identity = await adapter.connect();
  const plan = createFlightPlan({ kind: "inspection", location: home, destinations: [home], home, mode: "autonomous", altitudeM: 3, hoverSec: 5, maxRadiusM: 100 });
  expect(() => validateAdapterPlan(plan, identity, adapter)).not.toThrow();
  Object.defineProperty(adapter, "goTo", { value: undefined });
  expect(() => validateAdapterPlan(plan, identity, adapter)).toThrow("geographic waypoints");
  await adapter.disconnect();
});
test("adapter emits idle telemetry, rejects stale generations, and holds when velocity expires", async () => {
  vi.useFakeTimers();
  const adapter = new SimulatedDrone("adapter-test", home);
  await adapter.connect();
  const received: number[] = [];
  adapter.onTelemetry(sample => received.push(sample.sequence));
  await vi.advanceTimersByTimeAsync(500);
  expect(received).toHaveLength(10);
  expect((await adapter.getTelemetry()).airborne).toBe(false);
  await adapter.transferControl("computer", context("owner"));
  await adapter.takeoff(3, context("takeoff"));
  await vi.advanceTimersByTimeAsync(3500);
  expect((await adapter.getTelemetry()).altitudeM).toBe(3);
  await adapter.move(1, 0, 0, 0, context("move"));
  await vi.advanceTimersByTimeAsync(500);
  const held = await adapter.getTelemetry();
  expect(held.flightMode).toBe("hold");
  expect(held.speedMps).toBe(0);
  expect(held.armed).toBe(true);
  await adapter.transferControl("remote", context("takeover", 2));
  await expect(adapter.move(1, 0, 0, 0, context("stale", 1))).rejects.toThrow("generation");
  await adapter.land(context("land", 2)); await vi.advanceTimersByTimeAsync(3500);
  expect((await adapter.getTelemetry()).armed).toBe(false);
  await adapter.disconnect();
});
test("local link-loss action lands autonomy without any cloud publication", async () => {
  vi.useFakeTimers();
  const adapter = new SimulatedDrone("failsafe-test", home);
  await adapter.connect(); await adapter.transferControl("autonomy", context("owner"));
  await adapter.takeoff(3, context("takeoff")); await vi.advanceTimersByTimeAsync(3500);
  await adapter.handleLinkLoss("Cloud unavailable"); await vi.advanceTimersByTimeAsync(3500);
  const sample = await adapter.getTelemetry();
  expect(sample).toMatchObject({ altitudeM: 0, armed: false, airborne: false, faults: ["Cloud unavailable"] });
  await adapter.disconnect();
});

test("plan integrity survives transport key reordering and detects changed values", () => {
  const plan = createFlightPlan({ kind: "flight_check", location: home, destinations: [], home, mode: "autonomous", altitudeM: 3, hoverSec: 5, maxRadiusM: 100 });
  const reordered = JSON.parse(JSON.stringify(plan, Object.keys(plan).concat(["kind", "label", "position", "altitudeM", "durationSec", "lat", "lon"]).sort()));
  expect(serializeFlightPlan(reordered)).toBe(serializeFlightPlan(plan));
  expect(serializeFlightPlan(plan)).toBe(JSON.stringify(plan)); // Existing stored hashes remain valid.
  reordered.steps[0].altitudeM = 10;
  expect(serializeFlightPlan(reordered)).not.toBe(serializeFlightPlan(plan));
});
