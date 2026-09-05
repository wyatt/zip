import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { hashSecret } from "../convex/access";
import { createFlightPlan, matchesRequirements, preflightProblems, requiredCapabilities, validateSample, type AircraftSample, type Capability } from "../lib/operations";

const modules = import.meta.glob("../convex/**/*.ts");
const home = { lat: 42.35596, lon: -71.07029 };
const capabilities: Capability[] = ["takeoff", "hover", "land", "position", "autonomous", "manual_remote", "manual_computer"];
const token = "zip_agent_" + "a".repeat(64);
afterEach(() => vi.useRealTimers());
function sample(sequence = 0): AircraftSample {
  return { sequence, capturedAt: Date.now(), position: home, altitudeM: 0, batteryPct: 90, headingDeg: 0, speedMps: 0, connected: true, armed: false, airborne: false, navigationHealthy: true, controlOwner: "none", flightMode: "grounded", faults: [] };
}
async function fixture() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const customerId = await ctx.db.insert("users", { email: "customer@example.com" });
    const strangerId = await ctx.db.insert("users", { email: "stranger@example.com" });
    const operatorId = await ctx.db.insert("users", { email: "operator@example.com" });
    for (const [userId, role] of [[customerId, "customer"], [strangerId, "customer"], [operatorId, "operator"]] as const) await ctx.db.insert("members", { userId, role, displayName: role });
    await ctx.db.insert("operatorProfiles", { userId: operatorId, approved: true, acceptingJobs: true, qualifications: ["flight_check"], base: home, serviceRadiusM: 5000 });
    const vehicleId = await ctx.db.insert("vehicles", { operatorId, name: "Test aircraft", hardwareId: "test-aircraft", environment: "simulated", capabilities, maxPayloadKg: 0, home, maxRadiusM: 100, available: true, integrationApproved: true });
    await ctx.db.insert("agentCredentials", { vehicleId, tokenHash: await hashSecret(token), createdAt: Date.now(), expiresAt: Date.now() + 86400000 });
    return { customerId, strangerId, operatorId, vehicleId };
  });
  const customer = t.withIdentity({ subject: ids.customerId });
  const stranger = t.withIdentity({ subject: ids.strangerId });
  const operator = t.withIdentity({ subject: ids.operatorId });
  const workOrderId = await customer.mutation(api.workOrders.submit, { title: "Hover check", description: "Check the aircraft", kind: "flight_check", environment: "simulated", location: home, destinations: [], payloadKg: 0, altitudeM: 3, hoverSec: 5 });
  return { t, customer, stranger, operator, workOrderId, ...ids };
}
async function readyFixture() {
  const f = await fixture();
  const operationId = await f.operator.mutation(api.workOrders.accept, { workOrderId: f.workOrderId, vehicleId: f.vehicleId, mode: "autonomous", manualControl: "remote" });
  const sessionId = await f.t.mutation(api.agentLink.open, { token, instanceId: "test-instance-123", hardwareId: "test-aircraft", environment: "simulated", capabilities });
  await f.t.mutation(api.agentLink.publish, { token, sessionId, sample: sample() });
  const operation = (await f.operator.query(api.operations.details, { operationId })).operation;
  await f.t.mutation(api.agentLink.prepared, { token, sessionId, operationId, planHash: operation.planHash });
  return { ...f, operationId, sessionId };
}

async function observeOwner(f: Awaited<ReturnType<typeof readyFixture>>, owner: AircraftSample["controlOwner"]) {
  const telemetry = await f.t.run(ctx => ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", f.vehicleId)).unique());
  vi.setSystemTime(Date.now() + 1);
  await f.t.mutation(api.agentLink.publish, { token, sessionId: f.sessionId, sample: { ...sample(telemetry!.sample.sequence + 1), controlOwner: owner } });
}

test("customers cannot read other customers' orders or act as operators", async () => {
  const f = await fixture();
  expect(await f.stranger.query(api.workOrders.mine, {})).toEqual([]);
  await expect(f.t.query(api.workOrders.mine, {})).rejects.toThrow("Sign in");
  await expect(f.customer.query(api.workOrders.eligible, {})).rejects.toThrow("approved operator");
  const operationId = await f.operator.mutation(api.workOrders.accept, { workOrderId: f.workOrderId, vehicleId: f.vehicleId, mode: "autonomous", manualControl: "remote" });
  await expect(f.stranger.query(api.operations.details, { operationId })).rejects.toThrow("not found");
  await expect(f.customer.mutation(api.operations.command, { operationId, kind: "start", idempotencyKey: "unauthorized-start" })).rejects.toThrow("not found");
});
test("registering drone specifications creates an operator without an invitation", async () => {
  const f = await fixture();
  const vehicleId = await f.stranger.mutation(api.fleet.register, { name: "My drone", model: "Test model", hardwareId: "self-registered-aircraft", environment: "aircraft", capabilities: [...capabilities, "camera", "payload"], maxPayloadKg: 2, home, maxRadiusM: 500, serviceRadiusM: 7000 });
  const account = await f.stranger.query(api.accounts.me, {});
  expect(account?.member?.role).toBe("operator");
  expect(account?.operator).toMatchObject({ approved: true, acceptingJobs: true, serviceRadiusM: 7000 });
  const fleet = await f.stranger.query(api.fleet.mine, {});
  expect(fleet).toHaveLength(1);
  expect(fleet[0]).toMatchObject({ _id: vehicleId, model: "Test model", maxPayloadKg: 2, available: true, integrationApproved: false });
  expect(fleet[0].capabilities).toContain("camera");
  expect(await f.t.run(ctx => ctx.db.query("operatorInvites").collect())).toHaveLength(0);
});
test("invalid registration creates no operator, and suspended operators cannot re-enroll", async () => {
  const f = await fixture();
  const args = { name: "My drone", hardwareId: "registration-check", environment: "simulated" as const, capabilities, maxPayloadKg: 0, home, maxRadiusM: 100, serviceRadiusM: 5000 };
  await expect(f.stranger.mutation(api.fleet.register, { ...args, maxPayloadKg: 2 })).rejects.toThrow("payload support");
  expect((await f.stranger.query(api.accounts.me, {}))?.operator).toBeNull();
  await f.t.run(async ctx => {
    const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", f.operatorId)).unique();
    await ctx.db.patch(profile!._id, { approved: false });
  });
  await expect(f.operator.mutation(api.fleet.register, args)).rejects.toThrow("suspended");
});
test("matching requires qualifications, capability, environment and service coverage", () => {
  const order = { kind: "inspection" as const, environment: "aircraft" as const, location: home, required: requiredCapabilities("inspection"), payloadKg: 0 };
  const operator = { approved: true, acceptingJobs: true, qualifications: ["inspection" as const], base: home, serviceRadiusM: 100 };
  const vehicle = { environment: "aircraft" as const, capabilities: [...capabilities, "camera" as const], maxPayloadKg: 0, available: true, integrationApproved: true };
  expect(matchesRequirements(order, operator, vehicle)).toBe(true);
  expect(matchesRequirements(order, operator, { ...vehicle, capabilities })).toBe(false);
  expect(matchesRequirements(order, operator, { ...vehicle, integrationApproved: false })).toBe(false);
  expect(matchesRequirements(order, { ...operator, base: { lat: 0, lon: 0 } }, vehicle)).toBe(false);
});
test("acceptance reserves one operation and repeated acceptance does not duplicate it", async () => {
  const f = await fixture();
  expect(await f.operator.query(api.workOrders.eligible, {})).toHaveLength(1);
  const args = { workOrderId: f.workOrderId, vehicleId: f.vehicleId, mode: "autonomous" as const, manualControl: "remote" as const };
  const a = await f.operator.mutation(api.workOrders.accept, args);
  const b = await f.operator.mutation(api.workOrders.accept, args);
  expect(a).toBe(b);
  expect(await f.t.run(ctx => ctx.db.query("operations").collect())).toHaveLength(1);
  expect(await f.operator.query(api.workOrders.eligible, {})).toHaveLength(0);
});
test("session ownership rejects impostors and competing agents", async () => {
  const f = await readyFixture();
  await expect(f.t.query(api.agentLink.work, { token: "zip_agent_" + "b".repeat(64), sessionId: f.sessionId })).rejects.toThrow("expired or revoked");
  await expect(f.t.mutation(api.agentLink.open, { token, instanceId: "other-instance-123", hardwareId: "test-aircraft", environment: "simulated", capabilities })).rejects.toThrow("Another flight agent");
  vi.setSystemTime(Date.now() + 11000);
  await expect(f.t.mutation(api.agentLink.publish, { token, sessionId: f.sessionId, sample: sample(1) })).rejects.toThrow("session lost");
});
test("start rechecks fresh preflight, expires, and cannot be claimed twice", async () => {
  const f = await readyFixture();
  vi.setSystemTime(Date.now() + 3000);
  await expect(f.operator.mutation(api.operations.command, { operationId: f.operationId, kind: "start", idempotencyKey: "stale-start-check" })).rejects.toThrow("fresh aircraft");
  await f.t.mutation(api.agentLink.publish, { token, sessionId: f.sessionId, sample: sample(1) });
  const commandId = await f.operator.mutation(api.operations.command, { operationId: f.operationId, kind: "start", idempotencyKey: "valid-start-check" });
  expect(await f.t.mutation(api.agentLink.claim, { token, sessionId: f.sessionId, commandId })).toBeTruthy();
  expect(await f.t.mutation(api.agentLink.claim, { token, sessionId: f.sessionId, commandId })).toBeNull();
  const operation = (await f.operator.query(api.operations.details, { operationId: f.operationId })).operation;
  expect(operation.state).toBe("starting");
  expect(operation.controlOwner).toBe("none");
});
test("a forged final landing snapshot cannot skip takeoff and hover", async () => {
  const f = await readyFixture();
  const commandId = await f.operator.mutation(api.operations.command, { operationId: f.operationId, kind: "start", idempotencyKey: "landing-skip-check" });
  await f.t.mutation(api.agentLink.claim, { token, sessionId: f.sessionId, commandId });
  await observeOwner(f, "autonomy");
  await f.t.mutation(api.agentLink.acknowledge, { token, sessionId: f.sessionId, commandId, accepted: true, owner: "autonomy" });
  vi.setSystemTime(Date.now() + 200);
  await f.t.mutation(api.agentLink.publish, { token, sessionId: f.sessionId, sample: sample(999) });
  const details = await f.operator.query(api.operations.details, { operationId: f.operationId });
  expect(details.operation.state).toBe("active");
  expect(details.operation.verifiedSteps).toEqual([]);
});
test("takeover fences the autonomous executor and waits for the right aircraft owner", async () => {
  const f = await readyFixture();
  const start = await f.operator.mutation(api.operations.command, { operationId: f.operationId, kind: "start", idempotencyKey: "takeover-start-check" });
  await f.t.mutation(api.agentLink.claim, { token, sessionId: f.sessionId, commandId: start });
  await observeOwner(f, "autonomy");
  await f.t.mutation(api.agentLink.acknowledge, { token, sessionId: f.sessionId, commandId: start, accepted: true, owner: "autonomy" });
  const takeover = await f.operator.mutation(api.operations.command, { operationId: f.operationId, kind: "takeover", idempotencyKey: "takeover-owner-check" });
  await f.t.mutation(api.agentLink.claim, { token, sessionId: f.sessionId, commandId: takeover });
  await expect(f.t.mutation(api.agentLink.acknowledge, { token, sessionId: f.sessionId, commandId: takeover, accepted: true, owner: "autonomy" })).rejects.toThrow("control owner");
  let details = await f.operator.query(api.operations.details, { operationId: f.operationId });
  expect(details.operation.state).toBe("taking_over");
  await expect(f.t.mutation(api.agentLink.acknowledge, { token, sessionId: f.sessionId, commandId: takeover, accepted: true, owner: "remote" })).rejects.toThrow("control owner");
  await observeOwner(f, "remote");
  await f.t.mutation(api.agentLink.acknowledge, { token, sessionId: f.sessionId, commandId: takeover, accepted: true, owner: "remote" });
  details = await f.operator.query(api.operations.details, { operationId: f.operationId });
  expect(details.operation.state).toBe("manual");
  expect(details.operation.controlGeneration).toBe(2);
});
test("telemetry rejects NaN, infinity, impossible state and old source timestamps", () => {
  expect(() => validateSample({ ...sample(), altitudeM: NaN }, Date.now())).toThrow("altitude");
  expect(() => validateSample({ ...sample(), position: { lat: Infinity, lon: 0 } }, Date.now())).toThrow("coordinates");
  expect(() => validateSample({ ...sample(), airborne: true, armed: false }, Date.now())).toThrow("Inconsistent");
  expect(() => validateSample({ ...sample(), capturedAt: Date.now() - 11000 }, Date.now())).toThrow("timestamp");
  const plan = createFlightPlan({ kind: "flight_check", location: home, destinations: [], home, mode: "autonomous", altitudeM: 3, hoverSec: 5, maxRadiusM: 100 });
  expect(preflightProblems({ ...sample(), batteryPct: null }, plan, Date.now())).toContain("Insufficient battery or battery unknown");
});

test("measured flight completes in order and an old customer never sees the aircraft's next flight", async () => {
  const f = await readyFixture();
  const commandId = await f.operator.mutation(api.operations.command, { operationId: f.operationId, kind: "start", idempotencyKey: "verified-flight-check" });
  await f.t.mutation(api.agentLink.claim, { token, sessionId: f.sessionId, commandId });
  await observeOwner(f, "autonomy");
  await f.t.mutation(api.agentLink.acknowledge, { token, sessionId: f.sessionId, commandId, accepted: true, owner: "autonomy" });
  for (let sequence = 2; sequence <= 49; sequence++) {
    vi.setSystemTime(Date.now() + 200);
    if (sequence % 10 === 0) await f.t.mutation(api.agentLink.renew, { token, sessionId: f.sessionId });
    const airborne = sequence <= 35;
    await f.t.mutation(api.agentLink.publish, { token, sessionId: f.sessionId, sample: { ...sample(sequence), altitudeM: airborne ? 3 : 0, airborne, armed: airborne, controlOwner: "autonomy" } });
  }
  const details = await f.customer.query(api.operations.details, { operationId: f.operationId });
  expect(details.operation.state).toBe("completed");
  expect(details.operation.verifiedSteps).toEqual([0, 1, 2]);
  expect(details.events.at(-2)?.message).toContain("Land and disarm verified");
  expect(details.events.at(-1)?.message).toContain("Flight check completed");
  const recorded = await f.customer.query(api.operations.telemetry, { operationId: f.operationId });
  vi.setSystemTime(Date.now() + 200);
  await f.t.mutation(api.agentLink.publish, { token, sessionId: f.sessionId, sample: { ...sample(50), position: { lat: 40, lon: -70 } } });
  expect((await f.customer.query(api.operations.telemetry, { operationId: f.operationId }))?.sample).toEqual(recorded?.sample);
});

test("computer tickets require acknowledged ownership and cannot be replayed", async () => {
  const f = await readyFixture();
  await expect(f.operator.action(api.manualControl.ticket, { operationId: f.operationId })).rejects.toThrow("acknowledge computer");
  await f.t.run(ctx => ctx.db.patch(f.operationId, { manualControl: "computer" }));
  const start = await f.operator.mutation(api.operations.command, { operationId: f.operationId, kind: "start", idempotencyKey: "manual-ticket-start" });
  await f.t.mutation(api.agentLink.claim, { token, sessionId: f.sessionId, commandId: start });
  await observeOwner(f, "autonomy");
  await f.t.mutation(api.agentLink.acknowledge, { token, sessionId: f.sessionId, commandId: start, accepted: true, owner: "autonomy" });
  const takeover = await f.operator.mutation(api.operations.command, { operationId: f.operationId, kind: "takeover", idempotencyKey: "manual-ticket-takeover" });
  await f.t.mutation(api.agentLink.claim, { token, sessionId: f.sessionId, commandId: takeover });
  await expect(f.t.mutation(api.agentLink.acknowledge, { token, sessionId: f.sessionId, commandId: takeover, accepted: true, owner: "computer" })).rejects.toThrow("control owner");
  await observeOwner(f, "computer");
  await f.t.mutation(api.agentLink.acknowledge, { token, sessionId: f.sessionId, commandId: takeover, accepted: true, owner: "computer" });
  await expect(f.customer.action(api.manualControl.ticket, { operationId: f.operationId })).rejects.toThrow("not found");
  const ticket = await f.operator.action(api.manualControl.ticket, { operationId: f.operationId });
  const grant = await f.t.mutation(api.manualControl.redeem, { token, sessionId: f.sessionId, ticket: ticket.token });
  expect(grant.generation).toBe(2);
  await expect(f.t.mutation(api.manualControl.redeem, { token, sessionId: f.sessionId, ticket: ticket.token })).rejects.toThrow("expired, used");
});

test("camera sessions are scoped to the job and authenticated aircraft", async () => {
  const f = await readyFixture();
  const camera = { token, sessionId: f.sessionId, operationId: f.operationId, protocol: "whep" as const, url: "https://camera.example.test/session/signed", expiresAt: Date.now() + 60000 };
  await expect(f.t.mutation(api.cameras.publish, camera)).rejects.toThrow("not available");
  await f.t.run(ctx => ctx.db.patch(f.vehicleId, { capabilities: [...capabilities, "camera"] }));
  await f.t.mutation(api.cameras.publish, camera);
  expect((await f.customer.query(api.cameras.forOperation, { operationId: f.operationId }))?.url).toBe(camera.url);
  await expect(f.stranger.query(api.cameras.forOperation, { operationId: f.operationId })).rejects.toThrow("not found");
  await expect(f.t.mutation(api.cameras.publish, { ...camera, url: "http://insecure.example.test/stream" })).rejects.toThrow("HTTPS");
  vi.setSystemTime(Date.now() + 61000);
  expect(await f.customer.query(api.cameras.forOperation, { operationId: f.operationId })).toBeNull();
});
