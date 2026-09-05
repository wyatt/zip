import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { LAUNCH, TARGET, planRoute, sampleFlight } from "../lib/flight";

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
