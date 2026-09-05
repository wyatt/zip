import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../convex/schema";
import { internal as api } from "../convex/_generated/api";
import { LAUNCH, TARGET, planRoute, sampleFlight } from "../lib/flight";
import { taskRoute, validateTask, type Task, fromLatLng, toLatLng } from "../lib/tasks";

const modules = import.meta.glob("../convex/**/*.ts");
async function fixture() {
  const t = convexTest(schema, modules);
  const droneId = await t.mutation(api.dispatch.seed, {});
  await t.mutation(api.dispatch.heartbeat, { droneId });
  const jobId = await t.mutation(api.dispatch.submit, { requester: "Test requester", description: "Inspect the demo grounds", location: TARGET });
  const missionId = await t.mutation(api.dispatch.accept, { jobId, mode: "supervised" });
  return { t, droneId, jobId, missionId };
}
describe("mission guards", () => {
  test("Start requires ready agent, repeated Start returns one command, accepted once", async () => {
    const { t, missionId } = await fixture();
    await expect(t.mutation(api.dispatch.start, { missionId })).rejects.toThrow("ready");
    await t.mutation(api.dispatch.ready, { missionId });
    const [first, second] = await Promise.all([t.mutation(api.dispatch.start, { missionId }), t.mutation(api.dispatch.start, { missionId })]);
    expect(first).toBe(second);
    expect(await t.mutation(api.dispatch.acceptCommand, { commandId: first })).toBe(true);
    expect(await t.mutation(api.dispatch.acceptCommand, { commandId: first })).toBe(false);
    expect(await t.run(ctx => ctx.db.query("commands").collect())).toHaveLength(1);
  });
  test("completion requires landing, preserves event order and releases the simulator", async () => {
    const { t, missionId, jobId, droneId } = await fixture();
    await t.mutation(api.dispatch.ready, { missionId });
    const commandId = await t.mutation(api.dispatch.start, { missionId });
    await t.mutation(api.dispatch.acceptCommand, { commandId });
    await expect(t.mutation(api.dispatch.complete, { commandId })).rejects.toThrow("before landing");
    const route = planRoute(TARGET);
    const invalid = { ...sampleFlight(route, 20, 40), altitude: 2 };
    await expect(t.mutation(api.dispatch.publish, { commandId, snapshot: invalid })).rejects.toThrow("ground altitude");
    for (let sequence = 0; sequence <= 40; sequence++) await t.mutation(api.dispatch.publish, { commandId, snapshot: sampleFlight(route, sequence / 2, sequence) });
    let details = await t.query(api.dispatch.details, { jobId });
    expect(details.mission?.state).toBe("landed");
    expect(details.telemetry?.position).toEqual(LAUNCH);
    await t.mutation(api.dispatch.complete, { commandId });
    details = await t.query(api.dispatch.details, { jobId });
    expect(details.job?.status).toBe("completed");
    expect(details.command?.status).toBe("completed");
    expect(details.events.slice(-2).map(e => e.message)).toEqual(["Landed at launch · altitude 0 m", "Mission completed"]);
    expect((await t.run(ctx => ctx.db.get(droneId)))?.available).toBe(true);
  });
});
test("deterministic 20-second flight travels out and home with decreasing battery", () => {
  const route = planRoute(TARGET);
  const samples = Array.from({ length: 41 }, (_, n) => sampleFlight(route, n / 2, n));
  expect(samples[0].position).toEqual(LAUNCH);
  expect(samples[18].position).toEqual(TARGET);
  expect(samples[24].state).toBe("returning");
  expect(samples[40]).toMatchObject({ position: LAUNCH, altitude: 0, elapsed: 20, state: "landed", battery: 88 });
  samples.slice(1).forEach((s, i) => { expect(s.battery).toBeLessThan(samples[i].battery); expect(s.sequence).toBeGreaterThan(samples[i].sequence); });
});
test("task geometry is validated and geographic coordinates round-trip", () => {
  expect(fromLatLng(...toLatLng(TARGET))).toEqual(TARGET);
  expect(() => validateTask({ type: "deliver", pickup: TARGET, dropoff: TARGET })).toThrow("10 m apart");
  expect(() => validateTask({ type: "search", region: { northWest: TARGET, southEast: TARGET } })).toThrow("10 m wide");
  expect(() => validateTask({ type: "inspection", region: { northWest: TARGET, southEast: { x: 10000, y: 10000 } } })).toThrow("3 km");
});
for (const type of ["deliver", "search", "inspection"] as const) test(`${type} persists its geometry and flies the assigned task before landing`, async () => {
  const task: Task = type === "deliver" ? { type, pickup: { x: 200, y: 120 }, dropoff: TARGET } : { type, region: { northWest: { x: 200, y: 120 }, southEast: { x: 500, y: 300 } } };
  const t = convexTest(schema, modules);
  const droneId = await t.mutation(api.dispatch.seed, {});
  await t.mutation(api.dispatch.heartbeat, { droneId });
  const jobId = await t.mutation(api.dispatch.submit, { requester: "Alex", description: "Task instructions", location: TARGET, task });
  const missionId = await t.mutation(api.dispatch.accept, { jobId, mode: "supervised" });
  await t.mutation(api.dispatch.ready, { missionId });
  const commandId = await t.mutation(api.dispatch.start, { missionId });
  await t.mutation(api.dispatch.acceptCommand, { commandId });
  const route = taskRoute(task);
  expect((await t.query(api.dispatch.details, { jobId })).mission?.route).toEqual(route);
  expect(sampleFlight(route, 7, 14, type).position).toEqual(route[1]);
  expect(sampleFlight(route, 12, 24, type).position).toEqual(route.at(-2));
  expect(sampleFlight(route, 9.5, 19, type).position).not.toEqual(route[1]);
  for (let n = 0; n <= 40; n++) await t.mutation(api.dispatch.publish, { commandId, snapshot: sampleFlight(route, n / 2, n, type) });
  await t.mutation(api.dispatch.complete, { commandId });
  const details = await t.query(api.dispatch.details, { jobId });
  expect(details.job?.task).toEqual(task);
  expect(details.mission?.state).toBe("completed");
  expect(details.telemetry?.position).toEqual(LAUNCH);
  expect(details.events.some(e => e.message === (type === "deliver" ? "Deliver package" : type === "search" ? "Search region" : "Scan inspection area"))).toBe(true);
});
test("inspection sweeps across the interior in alternating rows", () => {
  const route = taskRoute({ type: "inspection", region: { northWest: { x: 200, y: 120 }, southEast: { x: 500, y: 300 } } });
  expect(route.slice(1, -1)).toEqual([
    { x: 200, y: 120 }, { x: 500, y: 120 },
    { x: 500, y: 180 }, { x: 200, y: 180 },
    { x: 200, y: 240 }, { x: 500, y: 240 },
    { x: 500, y: 300 }, { x: 200, y: 300 },
  ]);
  expect(route[0]).toEqual(LAUNCH);
  expect(route.at(-1)).toEqual(LAUNCH);
});
