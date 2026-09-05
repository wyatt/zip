import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireMember, requireOperator, requireOperationAccess } from "./access";
import { commandKind } from "./operationsSchema";
import { COMMAND_TTL_MS, preflightProblems, TELEMETRY_STALE_MS } from "../lib/operations";

export const mine = query({ args: {}, handler: async ctx => {
  const member = await requireMember(ctx);
  return member.role === "customer"
    ? ctx.db.query("operations").withIndex("by_customer", q => q.eq("customerId", member.userId)).order("desc").take(100)
    : ctx.db.query("operations").withIndex("by_operator", q => q.eq("operatorId", member.userId)).order("desc").take(100);
} });
export const details = query({ args: { operationId: v.id("operations") }, handler: async (ctx, { operationId }) => {
  const operation = await requireOperationAccess(ctx, operationId);
  const [order, vehicle, commands, events] = await Promise.all([
    ctx.db.get(operation.workOrderId), ctx.db.get(operation.vehicleId),
    ctx.db.query("controlCommands").withIndex("by_operation", q => q.eq("operationId", operationId)).order("desc").take(50),
    ctx.db.query("operationEvents").withIndex("by_operation", q => q.eq("operationId", operationId)).order("desc").take(100),
  ]);
  const closed = ["completed", "cancelled"].includes(operation.state);
  const session = !closed && vehicle?.activeSessionId ? await ctx.db.get(vehicle.activeSessionId) : null;
  const aircraft = vehicle ? { _id: vehicle._id, name: vehicle.name, environment: vehicle.environment, capabilities: vehicle.capabilities, activeSessionId: closed ? operation.loadedSessionId : vehicle.activeSessionId } : null;
  return { operation, order, vehicle: aircraft, commands, events: events.reverse(), session: session ? { leaseUntil: session.leaseUntil, retired: session.retired } : null };
} });
export const telemetry = query({ args: { operationId: v.id("operations") }, handler: async (ctx, { operationId }) => {
  const operation = await requireOperationAccess(ctx, operationId);
  const recorded = await ctx.db.query("operationTelemetry").withIndex("by_operation", q => q.eq("operationId", operationId)).unique();
  if (recorded) return recorded;
  const vehicle = await ctx.db.get(operation.vehicleId);
  if (vehicle?.activeOperationId !== operationId) return null;
  return ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", operation.vehicleId)).unique();
} });
export const command = mutation({ args: { operationId: v.id("operations"), kind: commandKind, idempotencyKey: v.string() }, handler: async (ctx, args) => {
  const operation = await requireOperationAccess(ctx, args.operationId, true);
  const { member } = await requireOperator(ctx);
  if (!/^[a-zA-Z0-9_-]{10,100}$/.test(args.idempotencyKey)) throw new Error("Invalid command identifier.");
  const existing = await ctx.db.query("controlCommands").withIndex("by_key", q => q.eq("operationId", operation._id).eq("idempotencyKey", args.idempotencyKey)).unique();
  if (existing) { if (existing.kind !== args.kind) throw new Error("Command identifier already used."); return existing._id; }
  if (["completed", "cancelled"].includes(operation.state)) throw new Error("Operation is already closed.");
  const vehicle = await ctx.db.get(operation.vehicleId);
  const session = vehicle?.activeSessionId && await ctx.db.get(vehicle.activeSessionId);
  if (!vehicle || !session || session.retired || session.leaseUntil <= Date.now() || operation.loadedSessionId !== session._id) throw new Error("The flight agent must reconnect and reconcile this operation.");
  if (vehicle.environment === "aircraft" && !vehicle.integrationApproved) throw new Error("Physical flight integration is not approved.");
  const telemetry = await ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", vehicle._id)).unique();
  const fresh = telemetry && telemetry.sessionId === session._id && Date.now() - telemetry.sample.capturedAt <= TELEMETRY_STALE_MS;
  if (args.kind === "start") {
    if (operation.state !== "ready") throw new Error("The operation is not ready to start.");
    const problems = preflightProblems(fresh ? telemetry.sample : null, operation.plan, Date.now());
    if (problems.length) throw new Error(problems.join(". "));
  } else if (args.kind !== "land" && !fresh) throw new Error("Aircraft telemetry is stale. Verify the aircraft locally.");
  if (args.kind === "takeover" && !["active", "returning", "manual"].includes(operation.state)) throw new Error("Takeover requires an active flight.");
  if (["hold", "return"].includes(args.kind) && !["active", "manual", "returning"].includes(operation.state)) throw new Error("This command requires an active flight.");
  const pending = await ctx.db.query("controlCommands").withIndex("by_operation", q => q.eq("operationId", operation._id)).order("desc").take(100);
  // Every new control intent fences the previous executor. Superseded claims are uncertain,
  // never silently reissued, while land remains available as an intervention.
  for (const previous of pending) if (previous.status === "pending" || previous.status === "claimed") await ctx.db.patch(previous._id, { status: previous.status === "pending" ? "expired" : "uncertain", reason: "Superseded by a newer operator command." });
  const generation = Math.max(operation.controlGeneration, vehicle.controlGeneration ?? 0) + 1;
  await ctx.db.patch(vehicle._id, { controlGeneration: generation });
  const commandId = await ctx.db.insert("controlCommands", { operationId: operation._id, vehicleId: operation.vehicleId, requestedBy: member.userId, kind: args.kind, idempotencyKey: args.idempotencyKey, generation, status: "pending", createdAt: Date.now(), expiresAt: Date.now() + COMMAND_TTL_MS });
  await ctx.scheduler.runAt(Date.now() + COMMAND_TTL_MS + 1, internal.agentLink.expireCommand, { commandId });
  const state = args.kind === "start" ? "starting" as const : args.kind === "takeover" ? "taking_over" as const : operation.state;
  await ctx.db.patch(operation._id, { controlGeneration: generation, state });
  await ctx.db.insert("operationEvents", { operationId: operation._id, actor: String(member.userId), kind: "command_requested", message: `${args.kind} requested; awaiting aircraft acknowledgment.`, timestamp: Date.now(), commandId });
  return commandId;
} });

export const resolveGrounded = mutation({ args: { operationId: v.id("operations"), note: v.string() }, handler: async (ctx, args) => {
  const operation = await requireOperationAccess(ctx, args.operationId, true);
  if (!["attention", "assigned", "ready", "landing", "manual"].includes(operation.state)) throw new Error("This operation cannot be closed yet.");
  if (args.note.trim().length < 5 || args.note.length > 500) throw new Error("Record why this flight is being closed.");
  const vehicle = await ctx.db.get(operation.vehicleId);
  const telemetry = await ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", operation.vehicleId)).unique();
  if (!vehicle || !telemetry || telemetry.sessionId !== vehicle.activeSessionId || Date.now() - telemetry.sample.capturedAt > TELEMETRY_STALE_MS || !telemetry.sample.connected || telemetry.sample.armed !== false || telemetry.sample.airborne !== false) throw new Error("Fresh aircraft measurements must confirm grounded and disarmed.");
  await ctx.db.patch(operation._id, { state: "cancelled", controlOwner: "none", controlGeneration: operation.controlGeneration + 1, completedAt: Date.now(), attention: args.note.trim(), taskOutcome: "unverified" });
  await ctx.db.patch(operation.workOrderId, { status: "cancelled", updatedAt: Date.now() });
  await ctx.db.patch(vehicle._id, { available: true, activeOperationId: undefined, controlGeneration: operation.controlGeneration + 1 });
  const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", operation.operatorId)).unique();
  if (profile?.activeOperationId === operation._id) await ctx.db.patch(profile._id, { activeOperationId: undefined });
  await ctx.db.insert("operationEvents", { operationId: operation._id, actor: String(operation.operatorId), kind: "reconciled", message: `Closed after grounded/disarmed verification: ${args.note.trim()}`, timestamp: Date.now() });
} });
