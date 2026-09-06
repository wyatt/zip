import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashSecret } from "../convex/access";
import { createFlightPlan, deliveryEndpoints, matchesRequirements, missionProgressPct, pickAcceptAircraft, preflightProblems, previewAcceptedFlight, requiredCapabilities, SEEDED_VEHICLE_BATTERY_PCT, validateSample, type AircraftSample, type Capability } from "../lib/operations";
import { regionalMissionConfig, syntheticRegionalPlan } from "../lib/regional-plan";

const modules = import.meta.glob("../convex/**/*.ts");
const home = { lat: 42.35596, lon: -71.07029 };
const capabilities: Capability[] = ["takeoff", "hover", "land", "position", "autonomous", "manual_remote", "manual_computer"];
const token = "iris_agent_" + "a".repeat(64);
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
    const applicantId = await ctx.db.insert("users", { email: "applicant@example.com" });
    const operatorId = await ctx.db.insert("users", { email: "operator@example.com" });
    for (const [userId, role] of [[customerId, "customer"], [strangerId, "customer"], [applicantId, "operator"], [operatorId, "operator"]] as const) await ctx.db.insert("members", { userId, role, displayName: role });
    await ctx.db.insert("operatorProfiles", { userId: operatorId, approved: true, acceptingJobs: true, qualifications: ["flight_check"], base: home, serviceRadiusM: 5000, presetLocations: [{ name: "Home", ...home }, { name: "Base One", lat: 42.36796, lon: -71.08029 }] });
    const vehicleId = await ctx.db.insert("vehicles", { operatorId, name: "Test aircraft", hardwareId: "test-aircraft", environment: "simulated", capabilities, maxPayloadKg: 0, home, maxRadiusM: 100, available: true, integrationApproved: true });
    await ctx.db.insert("agentCredentials", { operatorId, tokenHash: await hashSecret(token), createdAt: Date.now(), expiresAt: Date.now() + 86400000 });
    return { customerId, strangerId, applicantId, operatorId, vehicleId };
  });
  const customer = t.withIdentity({ subject: ids.customerId });
  const stranger = t.withIdentity({ subject: ids.strangerId });
  const applicant = t.withIdentity({ subject: ids.applicantId });
  const operator = t.withIdentity({ subject: ids.operatorId });
  const workOrderId = await customer.mutation(api.workOrders.submit, { title: "Hover check", description: "Check the aircraft", kind: "flight_check", environment: "simulated", location: home, destinations: [], payloadKg: 0, altitudeM: 3, hoverSec: 5 });
  return { t, customer, stranger, applicant, operator, workOrderId, ...ids };
}
async function readyFixture() {
  const f = await fixture();
  const operationId = await f.operator.mutation(api.workOrders.accept, { workOrderId: f.workOrderId, vehicleId: f.vehicleId, mode: "autonomous", manualControl: "remote" });
  const sessionId = await f.t.mutation(api.agentLink.open, { token, vehicleId: f.vehicleId, instanceId: "test-instance-123", hardwareId: "test-aircraft", environment: "simulated", capabilities });
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

test("a fleet agent token lists and opens every operator aircraft", async () => {
  const f = await fixture();
  const secondId = await f.operator.mutation(api.fleet.register, { name: "Second aircraft", hardwareId: "test-aircraft-2", environment: "simulated", capabilities, maxPayloadKg: 0, launchSiteName: "Home", maxRadiusM: 100 });
  const fleet = await f.t.query(api.agentLink.fleet, { token });
  expect(fleet.map(vehicle => vehicle.hardwareId).sort()).toEqual(["test-aircraft", "test-aircraft-2"]);
  const first = await f.t.mutation(api.agentLink.open, { token, vehicleId: f.vehicleId, instanceId: "fleet-instance-1", hardwareId: "test-aircraft", environment: "simulated", capabilities });
  const second = await f.t.mutation(api.agentLink.open, { token, vehicleId: secondId, instanceId: "fleet-instance-1", hardwareId: "test-aircraft-2", environment: "simulated", capabilities });
  expect(first).not.toBe(second);
  await f.t.mutation(api.agentLink.publish, { token, sessionId: first, sample: sample() });
  await f.t.mutation(api.agentLink.publish, { token, sessionId: second, sample: sample() });
  const listed = await f.operator.query(api.fleet.mine, {});
  expect(listed.every(vehicle => vehicle.telemetry?.sessionId)).toBe(true);
});
test("operators can remove an idle aircraft from the fleet", async () => {
  const f = await fixture();
  const extraId = await f.operator.mutation(api.fleet.register, { name: "Spare aircraft", hardwareId: "spare-aircraft", environment: "simulated", capabilities, maxPayloadKg: 0, launchSiteName: "Home", maxRadiusM: 100 });
  await expect(f.customer.mutation(api.fleet.remove, { vehicleId: extraId })).rejects.toThrow("operator account");
  await f.operator.mutation(api.workOrders.accept, { workOrderId: f.workOrderId, vehicleId: extraId, mode: "autonomous", manualControl: "remote" });
  await expect(f.operator.mutation(api.fleet.remove, { vehicleId: extraId })).rejects.toThrow("active operation");
  await f.operator.mutation(api.fleet.remove, { vehicleId: f.vehicleId });
  const fleet = await f.operator.query(api.fleet.mine, {});
  expect(fleet.map(vehicle => vehicle._id)).toEqual([extraId]);
});
test("legacy vehicle-scoped agent tokens are rejected", async () => {
  const f = await fixture();
  const legacy = "iris_agent_" + "c".repeat(64);
  await f.t.run(async ctx => {
    await ctx.db.insert("agentCredentials", { vehicleId: f.vehicleId, tokenHash: await hashSecret(legacy), createdAt: Date.now(), expiresAt: Date.now() + 86400000 });
  });
  await expect(f.t.query(api.agentLink.fleet, { token: legacy })).rejects.toThrow("vehicle-scoped");
});

test("customers cannot read other customers' orders or act as operators", async () => {
  const f = await fixture();
  expect(await f.stranger.query(api.workOrders.mine, {})).toEqual([]);
  await expect(f.t.query(api.workOrders.mine, {})).rejects.toThrow("Sign in");
  await expect(f.customer.query(api.workOrders.eligible, {})).rejects.toThrow("operator account");
  const operationId = await f.operator.mutation(api.workOrders.accept, { workOrderId: f.workOrderId, vehicleId: f.vehicleId, mode: "autonomous", manualControl: "remote" });
  await expect(f.stranger.query(api.operations.details, { operationId })).rejects.toThrow("not found");
  await expect(f.customer.mutation(api.operations.command, { operationId, kind: "start", idempotencyKey: "unauthorized-start" })).rejects.toThrow("not found");
});
test("customer and operator accounts cannot cross roles", async () => {
  const f = await fixture();
  const aircraft = { name: "My drone", hardwareId: "role-check-aircraft", environment: "simulated" as const, capabilities, maxPayloadKg: 0, launchSiteName: "Home", maxRadiusM: 100, serviceRadiusM: 5000 };
  await expect(f.customer.mutation(api.fleet.register, aircraft)).rejects.toThrow("operator account");
  expect((await f.customer.query(api.accounts.me, {}))?.operator).toBeNull();
  await expect(f.operator.mutation(api.workOrders.submit, { title: "Hover check", description: "Check the aircraft", kind: "flight_check", environment: "simulated", location: home, destinations: [], payloadKg: 0, altitudeM: 3, hoverSec: 5 })).rejects.toThrow("customer account");
  await expect(f.operator.query(api.workOrders.mine, {})).rejects.toThrow("customer account");
});
test("demo accounts auto-approve physical integration and follow a named launch site", async () => {
  const f = await fixture();
  await f.t.run(async ctx => {
    const member = await ctx.db.query("members").withIndex("by_user", q => q.eq("userId", f.operatorId)).unique();
    await ctx.db.patch(member!._id, { role: "demo" });
  });
  const moved = { lat: 38.9096, lon: -76.9986 };
  await f.operator.mutation(api.accounts.savePresetLocations, { locations: [{ name: "Home", ...moved }], serviceRadiusM: 5000 });
  const vehicleId = await f.operator.mutation(api.fleet.register, { name: "Demo Mini", hardwareId: "demo-physical-mini", environment: "aircraft", capabilities: [...capabilities, "camera"], maxPayloadKg: 0, cameraMp: 12, launchSiteName: "Home", maxRadiusM: 5000 });
  const fleet = await f.operator.query(api.fleet.mine, {});
  const registered = fleet.find(vehicle => vehicle._id === vehicleId);
  expect(registered).toMatchObject({ integrationApproved: true, launchSiteName: "Home", home: moved });
  const elsewhere = { lat: 38.91, lon: -77.0 };
  await f.operator.mutation(api.accounts.savePresetLocations, { locations: [{ id: registered?.launchSiteId, name: "Home", ...elsewhere }], serviceRadiusM: 5000 });
  const updated = (await f.operator.query(api.fleet.mine, {})).find(vehicle => vehicle._id === vehicleId);
  expect(updated?.home).toEqual(elsewhere);
});
test("a demo account can request jobs and operate aircraft", async () => {
  const f = await fixture();
  await f.t.run(async ctx => {
    const member = await ctx.db.query("members").withIndex("by_user", q => q.eq("userId", f.operatorId)).unique();
    await ctx.db.patch(member!._id, { role: "demo" });
  });
  const demoOrder = await f.operator.mutation(api.workOrders.submit, { title: "Demo hover", description: "Check both roles", kind: "flight_check", environment: "simulated", location: home, destinations: [], payloadKg: 0, altitudeM: 3, hoverSec: 5 });
  const mine = await f.operator.query(api.workOrders.mine, {});
  expect(mine.some(order => order._id === demoOrder)).toBe(true);
  const waiting = await f.operator.query(api.workOrders.availableNearby, { workOrderId: demoOrder });
  expect(waiting.some(vehicle => vehicle.vehicleId === f.vehicleId && vehicle.own)).toBe(true);
  const eligible = await f.operator.query(api.workOrders.eligible, {});
  expect(eligible.some(order => order._id === demoOrder)).toBe(true);
  const operationId = await f.operator.mutation(api.workOrders.accept, { workOrderId: demoOrder, vehicleId: f.vehicleId, mode: "autonomous", manualControl: "remote" });
  const details = await f.operator.query(api.operations.details, { operationId });
  expect(details.operation.customerId).toBe(f.operatorId);
  expect(details.operation.operatorId).toBe(f.operatorId);
});
test("registering drone specifications creates an operator without an invitation", async () => {
  const f = await fixture();
  await f.applicant.mutation(api.accounts.savePresetLocations, { locations: [{ name: "Home", ...home }, { name: "Base One", lat: 42.36796, lon: -71.08029 }], serviceRadiusM: 7000 });
  const vehicleId = await f.applicant.mutation(api.fleet.register, { name: "My drone", model: "Test model", hardwareId: "self-registered-aircraft", environment: "aircraft", capabilities: [...capabilities, "camera", "payload"], maxPayloadKg: 2, launchSiteName: "Home", maxRadiusM: 500, serviceRadiusM: 7000 });
  const account = await f.applicant.query(api.accounts.me, {});
  expect(account?.member?.role).toBe("operator");
  expect(account?.operator).toMatchObject({ approved: true, acceptingJobs: true, serviceRadiusM: 7000 });
  const fleet = await f.applicant.query(api.fleet.mine, {});
  expect(fleet).toHaveLength(1);
  expect(fleet[0]).toMatchObject({ _id: vehicleId, model: "Test model", maxPayloadKg: 2, available: true, integrationApproved: false });
  expect(fleet[0].capabilities).toContain("camera");
  expect(await f.t.run(ctx => ctx.db.query("operatorInvites").collect())).toHaveLength(0);
});
test("invalid registration creates no operator, and suspended operators cannot re-enroll", async () => {
  const f = await fixture();
  const args = { name: "My drone", hardwareId: "registration-check", environment: "simulated" as const, capabilities, maxPayloadKg: 0, launchSiteName: "Home", maxRadiusM: 100, serviceRadiusM: 5000 };
  await expect(f.applicant.mutation(api.fleet.register, args)).rejects.toThrow("account settings");
  expect((await f.applicant.query(api.accounts.me, {}))?.operator).toBeNull();
  await f.applicant.mutation(api.accounts.savePresetLocations, { locations: [{ name: "Home", ...home }], serviceRadiusM: 5000 });
  await expect(f.applicant.mutation(api.fleet.register, { ...args, maxPayloadKg: 2 })).rejects.toThrow("payload support");
  await f.t.run(async ctx => {
    const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", f.operatorId)).unique();
    await ctx.db.patch(profile!._id, { approved: false });
  });
  await expect(f.operator.mutation(api.fleet.register, args)).rejects.toThrow("suspended");
});
test("matching requires qualifications, capability, and service coverage", () => {
  const order = { kind: "inspection" as const, environment: "aircraft" as const, location: home, required: requiredCapabilities("inspection"), payloadKg: 0 };
  const operator = { approved: true, acceptingJobs: true, qualifications: ["inspection" as const], base: home, serviceRadiusM: 100 };
  const vehicle = { environment: "aircraft" as const, capabilities: [...capabilities, "camera" as const], maxPayloadKg: 0, available: true, integrationApproved: true };
  expect(matchesRequirements(order, operator, vehicle)).toBe(true);
  expect(matchesRequirements(order, operator, { ...vehicle, available: false })).toBe(false);
  expect(matchesRequirements(order, operator, { ...vehicle, integrationApproved: false })).toBe(true);
  expect(matchesRequirements(order, { ...operator, base: { lat: 0, lon: 0 } }, vehicle)).toBe(false);
});
test("acceptance ranks by distance, then lowest battery", () => {
  const job = { kind: "inspection" as const, location: home, destinations: [home], altitudeM: 30, hoverSec: 10 };
  const farFull = { id: "far", home: { lat: home.lat + 0.02, lon: home.lon }, maxRadiusM: 8000, batteryPct: 55, hardwareId: "far" };
  const nearLow = { id: "near-low", home: { lat: home.lat + 0.0002, lon: home.lon }, maxRadiusM: 8000, batteryPct: 52, hardwareId: "wyatt-gsh-mini" };
  const nearHigh = { id: "near-high", home: { lat: home.lat + 0.0003, lon: home.lon }, maxRadiusM: 8000, batteryPct: 94, hardwareId: "wyatt-gsh-cargo" };
  const empty = { id: "empty", home, maxRadiusM: 8000, batteryPct: 8, hardwareId: "low" };
  expect(pickAcceptAircraft([farFull, nearHigh, nearLow, empty], job)?.id).toBe("near-low");
  const parkedFar = { ...farFull, id: "live-near", position: { lat: home.lat + 0.0001, lon: home.lon }, batteryPct: 60 };
  expect(pickAcceptAircraft([parkedFar, nearHigh, nearLow], job)?.id).toBe("live-near");
  const closerHigh = { id: "closer-high", home: { lat: home.lat + 0.0001, lon: home.lon }, maxRadiusM: 8000, batteryPct: 94 };
  const fartherLow = { id: "farther-low", home: { lat: home.lat + 0.0004, lon: home.lon }, maxRadiusM: 8000, batteryPct: 50 };
  expect(pickAcceptAircraft([fartherLow, closerHigh], job)?.id).toBe("closer-high");
});
test("an operator can fly multiple jobs at once when each has its own aircraft", async () => {
  const f = await fixture();
  const secondVehicleId = await f.operator.mutation(api.fleet.register, { name: "Second aircraft", hardwareId: "test-aircraft-2", environment: "simulated", capabilities, maxPayloadKg: 0, launchSiteName: "Home", maxRadiusM: 100 });
  const secondOrderId = await f.customer.mutation(api.workOrders.submit, { title: "Second hover", description: "Check the other aircraft", kind: "flight_check", environment: "simulated", location: home, destinations: [], payloadKg: 0, altitudeM: 3, hoverSec: 5 });
  const first = await f.operator.mutation(api.workOrders.accept, { workOrderId: f.workOrderId, vehicleId: f.vehicleId, mode: "autonomous", manualControl: "remote" });
  await expect(f.operator.mutation(api.workOrders.accept, { workOrderId: secondOrderId, vehicleId: f.vehicleId, mode: "autonomous", manualControl: "remote" })).rejects.toThrow("availability or aircraft");
  const second = await f.operator.mutation(api.workOrders.accept, { workOrderId: secondOrderId, vehicleId: secondVehicleId, mode: "autonomous", manualControl: "remote" });
  expect(second).not.toBe(first);
  const operations = await f.operator.query(api.operations.mine, {});
  expect(operations.filter(operation => operation.state === "assigned")).toHaveLength(2);
});
test("operators can delete open and assigned jobs without confirmation", async () => {
  const f = await fixture();
  await expect(f.customer.mutation(api.workOrders.remove, { workOrderId: f.workOrderId })).rejects.toThrow("operator account");
  await f.operator.mutation(api.workOrders.remove, { workOrderId: f.workOrderId });
  expect(await f.operator.query(api.workOrders.eligible, {})).toHaveLength(0);
  expect(await f.customer.query(api.workOrders.mine, {})).toHaveLength(0);
  const second = await f.customer.mutation(api.workOrders.submit, { title: "Second hover", description: "Check delete after accept", kind: "flight_check", environment: "simulated", location: home, destinations: [], payloadKg: 0, altitudeM: 3, hoverSec: 5 });
  await f.operator.mutation(api.workOrders.accept, { workOrderId: second, vehicleId: f.vehicleId, mode: "autonomous", manualControl: "remote" });
  await f.operator.mutation(api.workOrders.remove, { workOrderId: second });
  expect(await f.operator.query(api.operations.mine, {})).toHaveLength(0);
  const vehicle = (await f.operator.query(api.fleet.mine, {})).find(item => item._id === f.vehicleId);
  expect(vehicle?.available).toBe(true);
  expect(vehicle?.activeOperationId).toBeUndefined();
});
test("acceptance reserves one operation and repeated acceptance does not duplicate it", async () => {
  const f = await fixture();
  expect(await f.operator.query(api.workOrders.eligible, {})).toHaveLength(1);
  const args = { workOrderId: f.workOrderId, vehicleId: f.vehicleId, mode: "autonomous" as const, manualControl: "remote" as const };
  const a = await f.operator.mutation(api.workOrders.accept, args);
  const b = await f.operator.mutation(api.workOrders.accept, args);
  expect(a).toBe(b);
  expect(await f.t.run(ctx => ctx.db.query("operations").collect())).toHaveLength(1);
  const operation = await f.operator.query(api.operations.details, { operationId: a });
  expect(operation.operation.quotedEarnings?.cents).toBeGreaterThanOrEqual(300);
  expect(await f.operator.query(api.workOrders.eligible, {})).toHaveLength(0);
});
test("eligible jobs include a live operator payout quote", async () => {
  const f = await fixture();
  const jobs = await f.operator.query(api.workOrders.eligible, {});
  expect(jobs[0]?.quote.cents).toBeGreaterThanOrEqual(300);
  expect(jobs[0]?.quote.surgeX).toBeGreaterThanOrEqual(1);
});
test("session ownership rejects impostors and competing agents", async () => {
  const f = await readyFixture();
  await expect(f.t.query(api.agentLink.work, { token: "iris_agent_" + "b".repeat(64), sessionId: f.sessionId })).rejects.toThrow("expired or revoked");
  await expect(f.t.mutation(api.agentLink.open, { token, vehicleId: f.vehicleId, instanceId: "other-instance-123", hardwareId: "test-aircraft", environment: "simulated", capabilities })).rejects.toThrow("Another flight agent");
  vi.setSystemTime(Date.now() + 11000);
  await expect(f.t.mutation(api.agentLink.publish, { token, sessionId: f.sessionId, sample: sample(1) })).rejects.toThrow("session lost");
});
test("same fleet token can reclaim a silent session", async () => {
  const f = await readyFixture();
  vi.setSystemTime(Date.now() + 3100);
  const next = await f.t.mutation(api.agentLink.open, { token, vehicleId: f.vehicleId, instanceId: "reclaim-instance-123", hardwareId: "test-aircraft", environment: "simulated", capabilities });
  expect(next).not.toBe(f.sessionId);
});
test("telemetry with a newer sequence is stored even when the source timestamp did not advance", async () => {
  const f = await readyFixture();
  vi.setSystemTime(Date.now() + 5);
  const now = Date.now();
  await f.t.mutation(api.agentLink.publish, { token, sessionId: f.sessionId, sample: { ...sample(2), capturedAt: now } });
  await f.t.mutation(api.agentLink.publish, { token, sessionId: f.sessionId, sample: { ...sample(3), capturedAt: now - 20, controlOwner: "autonomy" } });
  const telemetry = await f.t.run(ctx => ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", f.vehicleId)).unique());
  expect(telemetry?.sample.sequence).toBe(3);
  expect(telemetry?.sample.controlOwner).toBe("autonomy");
  await f.t.mutation(api.agentLink.publish, { token, sessionId: f.sessionId, sample: { ...sample(3), capturedAt: now + 1 } });
  const next = await f.t.run(ctx => ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", f.vehicleId)).unique());
  expect(next?.sample.sequence).toBe(3);
});
test("start acknowledge accepts a newer owner sample whose source time lags the previous receive", async () => {
  const f = await readyFixture();
  const commandId = await f.operator.mutation(api.operations.command, { operationId: f.operationId, kind: "start", idempotencyKey: "owner-lag-check" });
  await f.t.mutation(api.agentLink.claim, { token, sessionId: f.sessionId, commandId });
  const previous = await f.t.run(ctx => ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", f.vehicleId)).unique());
  await f.t.mutation(api.agentLink.publish, {
    token,
    sessionId: f.sessionId,
    sample: { ...sample(previous!.sample.sequence + 1), capturedAt: previous!.receivedAt - 40, controlOwner: "autonomy" },
  });
  await f.t.mutation(api.agentLink.acknowledge, { token, sessionId: f.sessionId, commandId, accepted: true, owner: "autonomy" });
  const details = await f.operator.query(api.operations.details, { operationId: f.operationId });
  expect(details.operation.state).toBe("active");
  expect(details.operation.controlOwner).toBe("autonomy");
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

test("acceptance preview uses the regional A* draft and a hover fallback", () => {
  const pickup = { lat: 42.4478926458004, lon: -76.48646602014907 };
  const drop = { lat: 42.449, lon: -76.484 };
  const delivery = regionalMissionConfig({
    kind: "deliver",
    location: pickup,
    destinations: [drop],
    home: pickup,
  });
  expect(delivery).toMatchObject({ mode: "delivery" });
  expect(delivery?.a).toEqual([0, 0]);
  expect(delivery?.b?.[0]).toBeGreaterThan(0);
  const padToDrop = regionalMissionConfig({
    kind: "deliver",
    location: drop,
    destinations: [drop],
    home: pickup,
  });
  expect(padToDrop?.a).toEqual([0, 0]);
  const ends = deliveryEndpoints({ location: pickup, destinations: [drop], home: pickup });
  expect(ends.a).toEqual(pickup);
  expect(ends.b).toEqual(drop);
  const plan = createFlightPlan({
    kind: "deliver",
    location: pickup,
    destinations: [drop],
    home: pickup,
    mode: "autonomous",
    altitudeM: 3,
    hoverSec: 10,
    maxRadiusM: 3000,
  });
  expect(plan.steps[1]).toMatchObject({ kind: "deliver", position: drop });
  expect(plan.steps[2]).toMatchObject({ kind: "land", position: pickup });
  const survey = regionalMissionConfig({
    kind: "inspection",
    location: drop,
    destinations: [drop],
    home: { lat: 42.4478926458004, lon: -76.48646602014907 },
    area: {
      northWest: { lat: 42.449, lon: -76.488 },
      southEast: { lat: 42.447, lon: -76.484 },
    },
  });
  expect(survey).toMatchObject({ mode: "inspection" });
  expect(survey?.polygon?.[0]).toHaveLength(4);
  expect(regionalMissionConfig({
    kind: "flight_check",
    location: home,
    destinations: [],
    home,
  })).toBeNull();
  const hover = previewAcceptedFlight({
    kind: "flight_check",
    location: home,
    destinations: [],
    home,
    altitudeM: 3,
    hoverSec: 5,
  });
  expect(hover.path).toEqual([home]);
  expect(hover.durationSec).toBe(71);
  const elsewhere = { lat: 38.9072, lon: -77.0369 };
  const remapped = regionalMissionConfig({
    kind: "deliver",
    location: { lat: 38.908, lon: -77.035 },
    destinations: [{ lat: 38.908, lon: -77.035 }],
    home: elsewhere,
  });
  expect(remapped?.a?.[0]).toBeCloseTo(0, 5);
  expect(remapped?.a?.[1]).toBeCloseTo(0, 5);
  const synthetic = syntheticRegionalPlan({
    kind: "inspection",
    home: elsewhere,
    location: { lat: 38.908, lon: -77.035 },
    destinations: [{ lat: 38.908, lon: -77.035 }],
    area: {
      northWest: { lat: 38.9085, lon: -77.037 },
      southEast: { lat: 38.9065, lon: -77.034 },
    },
  });
  expect(synthetic.mode).toBe("inspection");
  expect(synthetic.photoCount).toBeGreaterThan(0);
  expect(synthetic.tasks.some(task => task.kind === "return")).toBe(true);
});

test("mission progress follows verified steps and live telemetry", () => {
  const plan = createFlightPlan({ kind: "flight_check", location: home, destinations: [], home, mode: "autonomous", altitudeM: 3, hoverSec: 5, maxRadiusM: 100 });
  expect(missionProgressPct({ state: "ready", steps: plan.steps, currentStep: 0, verifiedSteps: [] })).toBe(0);
  expect(missionProgressPct({
    state: "active",
    steps: plan.steps,
    currentStep: 0,
    verifiedSteps: [],
    sample: { ...sample(), altitudeM: 1.5, airborne: true, armed: true, connected: true },
  })).toBe(17);
  expect(missionProgressPct({ state: "active", steps: plan.steps, currentStep: 1, verifiedSteps: [0] })).toBe(33);
  expect(missionProgressPct({
    state: "active",
    steps: plan.steps,
    currentStep: 1,
    verifiedSteps: [0],
    dwellMs: 2500,
    sample: { ...sample(), altitudeM: 3, airborne: true, armed: true, connected: true },
  })).toBe(50);
  expect(missionProgressPct({ state: "completed", steps: plan.steps, currentStep: 2, verifiedSteps: [0, 1, 2] })).toBe(100);
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
  const grant = await f.t.mutation(api.manualControl.redeem, { token, ticket: ticket.token });
  expect(grant.generation).toBe(2);
  expect(grant.vehicleId).toBe(f.vehicleId);
  await expect(f.t.mutation(api.manualControl.redeem, { token, ticket: ticket.token })).rejects.toThrow("expired, used");
});

test("camera sessions are scoped to the job and authenticated aircraft", async () => {
  const f = await readyFixture();
  const camera = { token, sessionId: f.sessionId, operationId: f.operationId, protocol: "whep" as const, url: "https://camera.example.test/session/signed", expiresAt: Date.now() + 60000 };
  await f.t.mutation(api.cameras.publish, camera);
  expect((await f.customer.query(api.cameras.forOperation, { operationId: f.operationId }))?.url).toBe(camera.url);
  await expect(f.stranger.query(api.cameras.forOperation, { operationId: f.operationId })).rejects.toThrow("not found");
  await expect(f.t.mutation(api.cameras.publish, { ...camera, url: "http://insecure.example.test/stream" })).rejects.toThrow("HTTPS");
  vi.setSystemTime(Date.now() + 61000);
  expect(await f.customer.query(api.cameras.forOperation, { operationId: f.operationId })).toBeNull();
});

test("Goldwin Smith Hall base and aircraft attach to an existing operator", async () => {
  const f = await fixture();
  const first = await f.t.mutation(internal.seed.addGoldwinSmithBase, { email: "operator@example.com" });
  expect(first.siteAdded).toBe(true);
  expect(first.vehiclesCreated).toBe(4);
  expect(first.vehicleNames).toEqual(["Smith Scout", "Arts Quad", "McGraw Inspector", "Ezra Cargo"]);
  const again = await f.t.mutation(internal.seed.addGoldwinSmithBase, { email: "operator@example.com" });
  expect(again).toMatchObject({ siteAdded: false, vehiclesCreated: 0, vehicleNames: [] });
  const profile = await f.t.run(async ctx => ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", f.operatorId)).unique());
  expect(profile?.presetLocations?.some(site => site.name === "Goldwin Smith Hall")).toBe(true);
  const fleet = await f.operator.query(api.fleet.mine, {});
  const goldwin = fleet.filter(vehicle => vehicle.launchSiteName === "Goldwin Smith Hall");
  expect(goldwin.map(vehicle => vehicle.name).sort()).toEqual(["Arts Quad", "Ezra Cargo", "McGraw Inspector", "Smith Scout"]);
  expect(Object.fromEntries(goldwin.map(vehicle => [vehicle.hardwareId, vehicle.batteryPct]))).toEqual(SEEDED_VEHICLE_BATTERY_PCT);
});

test("seeded DC and Ithaca aircraft appear while a matching job is waiting", async () => {
  const f = await fixture();
  const seeded = await f.t.mutation(internal.seed.demoCoverage, {});
  expect(seeded.operatorsCreated).toBe(7);
  expect(seeded.vehiclesCreated).toBeGreaterThan(10);
  expect(await f.t.mutation(internal.seed.demoCoverage, {})).toEqual({ operatorsCreated: 0, vehiclesCreated: 0 });
  const ithaca = { lat: 42.443, lon: -76.5019 };
  const ithacaDrop = { lat: 42.4442, lon: -76.5004 };
  const orderId = await f.customer.mutation(api.workOrders.submit, {
    title: "Ithaca drop",
    description: "Pharmacy",
    kind: "deliver",
    environment: "aircraft",
    location: ithaca,
    destinations: [ithacaDrop],
    payloadKg: 0.4,
    altitudeM: 8,
    hoverSec: 10,
  });
  const nearby = await f.customer.query(api.workOrders.availableNearby, { workOrderId: orderId });
  expect(nearby.length).toBeGreaterThan(0);
  expect(nearby.every(vehicle => vehicle.model === "Delivery Drone")).toBe(true);
  const searchId = await f.customer.mutation(api.workOrders.submit, {
    title: "Ithaca search",
    description: "Trail",
    kind: "search",
    environment: "aircraft",
    location: ithaca,
    destinations: [ithaca],
    payloadKg: 0,
    altitudeM: 8,
    hoverSec: 10,
  });
  const searchNearby = await f.customer.query(api.workOrders.availableNearby, { workOrderId: searchId });
  expect(searchNearby.length).toBeGreaterThan(0);
  expect(searchNearby.every(vehicle => vehicle.model !== "Delivery Drone" && vehicle.model !== "Long-Range Drone" && vehicle.model !== "High-Speed / FPV Drone")).toBe(true);
  await expect(f.stranger.query(api.workOrders.availableNearby, { workOrderId: orderId })).resolves.toEqual([]);
  const preview = await f.customer.query(api.workOrders.availableNearby, {
    kind: "deliver",
    location: ithaca,
    destinations: [ithacaDrop],
    payloadKg: 0,
    environment: "aircraft",
  });
  expect(preview.length).toBeGreaterThan(0);
  expect(preview.every(vehicle => vehicle.model === "Delivery Drone")).toBe(true);
  const bases = new Set(preview.map(vehicle => `${vehicle.position.lat},${vehicle.position.lon}`));
  expect(bases.size).toBeGreaterThan(0);
  expect(bases.size).toBeLessThanOrEqual(preview.length);
});
