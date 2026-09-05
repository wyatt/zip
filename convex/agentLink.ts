import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAgentSession, requireCredential } from "./access";
import { aircraftSample, capability, controlOwner, environment } from "./operationsSchema";
import { preflightProblems, SESSION_LEASE_MS, stepSatisfied, validateSample } from "../lib/operations";

const sessionArgs = { token: v.string(), sessionId: v.id("agentSessions") };
export const configuration = query({ args: { token: v.string() }, handler: async (ctx, { token }) => {
  const { vehicle } = await requireCredential(ctx, token);
  return { vehicleId: vehicle._id, hardwareId: vehicle.hardwareId, environment: vehicle.environment, home: vehicle.home, capabilities: vehicle.capabilities };
} });
async function recordEvent(ctx: MutationCtx, operationId: Id<"operations">, kind: string, message: string, commandId?: Id<"controlCommands">) {
  await ctx.db.insert("operationEvents", { operationId, actor: "flight-agent", kind, message, timestamp: Date.now(), ...(commandId ? { commandId } : {}) });
}
async function uncertainOperation(ctx: MutationCtx, operation: Doc<"operations">, reason: string) {
  if (["completed", "cancelled"].includes(operation.state)) return;
  await ctx.db.patch(operation._id, { state: "attention", attention: reason, controlGeneration: operation.controlGeneration + 1 });
  await ctx.db.patch(operation.vehicleId, { controlGeneration: operation.controlGeneration + 1 });
  const commands = await ctx.db.query("controlCommands").withIndex("by_operation", q => q.eq("operationId", operation._id)).collect();
  for (const command of commands) if (["pending", "claimed", "acknowledged"].includes(command.status)) await ctx.db.patch(command._id, { status: command.status === "pending" ? "expired" : "uncertain", reason });
  await recordEvent(ctx, operation._id, "attention", reason);
}

export const open = mutation({ args: { token: v.string(), instanceId: v.string(), hardwareId: v.string(), environment, capabilities: v.array(capability) }, handler: async (ctx, args) => {
  const { credential, vehicle } = await requireCredential(ctx, args.token);
  if (!/^[a-zA-Z0-9_-]{10,100}$/.test(args.instanceId)) throw new Error("Invalid agent instance identity.");
  if (vehicle.hardwareId !== args.hardwareId || vehicle.environment !== args.environment) throw new Error("Adapter identity does not match the provisioned aircraft.");
  if (vehicle.capabilities.some(cap => !args.capabilities.includes(cap))) throw new Error("Adapter does not support the provisioned capabilities.");
  const previous = vehicle.activeSessionId ? await ctx.db.get(vehicle.activeSessionId) : null;
  if (previous && !previous.retired && previous.leaseUntil > Date.now()) {
    if (previous.instanceId === args.instanceId && previous.credentialId === credential._id) return previous._id;
    throw new Error("Another flight agent owns this aircraft.");
  }
  if (previous) await ctx.db.patch(previous._id, { retired: true });
  if (vehicle.activeOperationId) {
    const operation = await ctx.db.get(vehicle.activeOperationId);
    if (operation && !["assigned", "ready"].includes(operation.state)) await uncertainOperation(ctx, operation, "Agent reconnected. Aircraft state must be reconciled; previous commands will not replay.");
  }
  const leaseUntil = Date.now() + SESSION_LEASE_MS;
  const sessionId = await ctx.db.insert("agentSessions", { vehicleId: vehicle._id, credentialId: credential._id, instanceId: args.instanceId, hardwareId: args.hardwareId, leaseUntil, lastSeenAt: Date.now(), retired: false });
  await ctx.db.patch(vehicle._id, { activeSessionId: sessionId });
  await ctx.scheduler.runAt(leaseUntil + 1, internal.agentLink.expireSession, { sessionId });
  return sessionId;
} });
export const renew = mutation({ args: sessionArgs, handler: async (ctx, args) => {
  const { session } = await requireAgentSession(ctx, args.token, args.sessionId);
  const leaseUntil = Date.now() + SESSION_LEASE_MS;
  await ctx.db.patch(session._id, { leaseUntil, lastSeenAt: Date.now() });
  return { leaseUntil, serverTime: Date.now() };
} });
export const expireSession = internalMutation({ args: { sessionId: v.id("agentSessions") }, handler: async (ctx, { sessionId }) => {
  const session = await ctx.db.get(sessionId);
  if (!session || session.retired) return;
  if (session.leaseUntil > Date.now()) { await ctx.scheduler.runAt(session.leaseUntil + 1, internal.agentLink.expireSession, { sessionId }); return; }
  await ctx.db.patch(sessionId, { retired: true });
  const vehicle = await ctx.db.get(session.vehicleId);
  if (vehicle?.activeSessionId === sessionId && vehicle.activeOperationId) {
    const operation = await ctx.db.get(vehicle.activeOperationId);
    if (operation) await uncertainOperation(ctx, operation, "Flight agent connection expired. Verify aircraft state locally.");
  }
} });
export const work = query({ args: sessionArgs, handler: async (ctx, args) => {
  const { vehicle, session } = await requireAgentSession(ctx, args.token, args.sessionId);
  const operation = vehicle.activeOperationId ? await ctx.db.get(vehicle.activeOperationId) : null;
  const commands = await ctx.db.query("controlCommands").withIndex("by_vehicle_status", q => q.eq("vehicleId", vehicle._id).eq("status", "pending")).take(20);
  return { vehicle, operation, commands, leaseUntil: session.leaseUntil };
} });
export const prepared = mutation({ args: { ...sessionArgs, operationId: v.id("operations"), planHash: v.string() }, handler: async (ctx, args) => {
  const { vehicle } = await requireAgentSession(ctx, args.token, args.sessionId);
  const operation = await ctx.db.get(args.operationId);
  if (!operation || operation.vehicleId !== vehicle._id || vehicle.activeOperationId !== operation._id || operation.planHash !== args.planHash) throw new Error("Assigned plan does not match.");
  const telemetry = await ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", vehicle._id)).unique();
  if (!telemetry || telemetry.sessionId !== args.sessionId) throw new Error("Publish live aircraft telemetry before preparing a mission.");
  if (operation.state === "assigned" || operation.state === "ready") {
    const problems = preflightProblems(telemetry.sample, operation.plan, Date.now());
    if (problems.length) throw new Error(problems.join(". "));
    await ctx.db.patch(operation._id, { state: "ready", loadedSessionId: args.sessionId });
    if (operation.loadedSessionId !== args.sessionId) await recordEvent(ctx, operation._id, "ready", "Agent validated the flight plan and aircraft preflight checks.");
  } else {
    // Reconciliation exposes current state and permits intervention, never an automatic restart.
    await ctx.db.patch(operation._id, { loadedSessionId: args.sessionId });
  }
} });
export const claim = mutation({ args: { ...sessionArgs, commandId: v.id("controlCommands") }, handler: async (ctx, args) => {
  const { vehicle } = await requireAgentSession(ctx, args.token, args.sessionId);
  const command = await ctx.db.get(args.commandId);
  if (!command || command.vehicleId !== vehicle._id) throw new Error("Command not found.");
  if (command.status !== "pending") return null;
  const operation = await ctx.db.get(command.operationId);
  if (!operation || operation.loadedSessionId !== args.sessionId || command.generation !== operation.controlGeneration || command.expiresAt <= Date.now()) {
    await ctx.db.patch(command._id, { status: "expired", reason: "Expired or superseded before execution." });
    return null;
  }
  if (vehicle.environment === "aircraft" && !vehicle.integrationApproved) throw new Error("Physical control is disabled.");
  if (command.kind === "start") {
    const telemetry = await ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", vehicle._id)).unique();
    const problems = preflightProblems(telemetry?.sessionId === args.sessionId ? telemetry.sample : null, operation.plan, Date.now());
    if (problems.length) {
      await ctx.db.patch(command._id, { status: "rejected", reason: problems.join(". ") });
      await ctx.db.patch(operation._id, { state: "attention", attention: problems.join(". ") });
      return null;
    }
  }
  await ctx.db.patch(command._id, { status: "claimed", claimedSessionId: args.sessionId });
  await ctx.scheduler.runAt(command.expiresAt + 1, internal.agentLink.expireCommand, { commandId: command._id });
  return { ...command, status: "claimed" as const, plan: operation.plan, manualControl: operation.manualControl };
} });
export const expireCommand = internalMutation({ args: { commandId: v.id("controlCommands") }, handler: async (ctx, { commandId }) => {
  const command = await ctx.db.get(commandId);
  if (!command || !["pending", "claimed"].includes(command.status) || command.expiresAt > Date.now()) return;
  await ctx.db.patch(commandId, { status: command.status === "pending" ? "expired" : "uncertain", reason: "Aircraft acknowledgment deadline elapsed." });
  const operation = await ctx.db.get(command.operationId);
  if (operation && operation.controlGeneration === command.generation) await uncertainOperation(ctx, operation, "Command acknowledgment timed out. Verify aircraft state before retrying.");
} });
export const acknowledge = mutation({ args: { ...sessionArgs, commandId: v.id("controlCommands"), accepted: v.boolean(), owner: controlOwner, reason: v.optional(v.string()) }, handler: async (ctx, args) => {
  const { vehicle } = await requireAgentSession(ctx, args.token, args.sessionId);
  const command = await ctx.db.get(args.commandId);
  if (!command || command.vehicleId !== vehicle._id || command.claimedSessionId !== args.sessionId) throw new Error("Command not claimed by this agent.");
  if (["acknowledged", "completed"].includes(command.status)) return;
  const operation = await ctx.db.get(command.operationId);
  if (!operation || command.status !== "claimed" || operation.controlGeneration !== command.generation || command.expiresAt <= Date.now()) throw new Error("Acknowledgment is stale. Reconcile aircraft state.");
  if (args.reason && args.reason.length > 500) throw new Error("Reason too long.");
  if (!args.accepted) {
    await ctx.db.patch(command._id, { status: "rejected", reason: args.reason ?? "Aircraft rejected the command." });
    await ctx.db.patch(operation._id, { state: "attention", attention: args.reason ?? "Aircraft rejected the command." });
    await recordEvent(ctx, operation._id, "rejected", args.reason ?? "Aircraft rejected the command.", command._id);
    return;
  }
  const expectedOwner = command.kind === "takeover" || (command.kind === "start" && operation.plan.mode === "manual") ? operation.manualControl : "autonomy";
  const telemetry = await ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", vehicle._id)).unique();
  if (args.owner !== expectedOwner || !telemetry || telemetry.sessionId !== args.sessionId || !telemetry.sample.connected || Date.now() - telemetry.sample.capturedAt > 2000 || telemetry.sample.controlOwner !== expectedOwner) throw new Error("Aircraft has not confirmed the requested control owner.");
  await ctx.db.patch(command._id, { status: "acknowledged", acknowledgedAt: Date.now() });
  const state = expectedOwner !== "autonomy" ? "manual" as const : command.kind === "land" ? "landing" as const : command.kind === "return" ? "returning" as const : command.kind === "hold" ? "manual" as const : "active" as const;
  await ctx.db.patch(operation._id, { state, controlOwner: args.owner, attention: undefined, ...(command.kind === "start" ? { startedAt: Date.now() } : {}) });
  await recordEvent(ctx, operation._id, "acknowledged", `${command.kind} acknowledged by aircraft; control owner: ${args.owner}.`, command._id);
} });

export const publish = mutation({ args: { ...sessionArgs, sample: aircraftSample }, handler: async (ctx, args) => {
  const { vehicle } = await requireAgentSession(ctx, args.token, args.sessionId);
  validateSample(args.sample, Date.now());
  const previous = await ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", vehicle._id)).unique();
  if (previous?.sessionId === args.sessionId && args.sample.sequence <= previous.sample.sequence) return;
  if (previous?.sessionId === args.sessionId && args.sample.capturedAt <= previous.sample.capturedAt) throw new Error("Telemetry timestamps must advance.");
  const record = { vehicleId: vehicle._id, sessionId: args.sessionId, environment: vehicle.environment, receivedAt: Date.now(), sample: args.sample };
  if (previous) await ctx.db.patch(previous._id, record); else await ctx.db.insert("vehicleTelemetry", record);
  const operation = vehicle.activeOperationId ? await ctx.db.get(vehicle.activeOperationId) : null;
  if (operation && operation.loadedSessionId === args.sessionId) {
    const recorded = await ctx.db.query("operationTelemetry").withIndex("by_operation", q => q.eq("operationId", operation._id)).unique();
    const operationRecord = { ...record, operationId: operation._id };
    if (recorded) await ctx.db.patch(recorded._id, operationRecord); else await ctx.db.insert("operationTelemetry", operationRecord);
  }
  if (!operation || operation.loadedSessionId !== args.sessionId || !["active", "manual", "returning", "landing", "taking_over"].includes(operation.state)) return;
  if (args.sample.faults.length || !args.sample.connected) { await uncertainOperation(ctx, operation, args.sample.faults.join("; ") || "Aircraft disconnected."); return; }
  const step = operation.plan.steps[operation.currentStep];
  if (!step) return;
  const progress = await ctx.db.query("flightProgress").withIndex("by_operation", q => q.eq("operationId", operation._id)).unique();
  const consecutiveMs = progress ? args.sample.capturedAt - progress.capturedAt : 0;
  const satisfied = stepSatisfied(step, args.sample);
  const dwell = satisfied && progress?.wasSatisfied && progress.stepIndex === operation.currentStep && consecutiveMs > 0 && consecutiveMs <= 1000 ? progress.dwellMs + consecutiveMs : 0;
  const requiredDwell = step.kind === "hover" ? step.durationSec * 1000 : step.kind === "land" ? 1000 : 300;
  const sawAirborne = progress?.sawAirborne || operation.sawAirborne || args.sample.airborne === true;
  const progressRecord = { operationId: operation._id, stepIndex: operation.currentStep, dwellMs: dwell, capturedAt: args.sample.capturedAt, sequence: args.sample.sequence, wasSatisfied: satisfied, sawAirborne };
  if (progress) await ctx.db.patch(progress._id, progressRecord); else await ctx.db.insert("flightProgress", progressRecord);
  if (!satisfied || dwell < requiredDwell) return;
  const verifiedSteps = [...operation.verifiedSteps, operation.currentStep];
  await recordEvent(ctx, operation._id, "step_verified", `${step.label} verified from aircraft measurements.`);
  const nextStep = operation.currentStep + 1;
  if (nextStep < operation.plan.steps.length) {
    const next = operation.plan.steps[nextStep];
    const state = operation.controlOwner === "autonomy" ? next.kind === "land" ? "landing" as const : next.label === "Return home" ? "returning" as const : operation.state : operation.state;
    await ctx.db.patch(operation._id, { currentStep: nextStep, verifiedSteps, stepDwellMs: 0, stepEnteredAt: args.sample.capturedAt, sawAirborne, state });
    return;
  }
  if (!sawAirborne || args.sample.airborne !== false || args.sample.armed !== false || verifiedSteps.length !== operation.plan.steps.length) throw new Error("Completion requires a verified flight, landing, and disarm.");
  const order = await ctx.db.get(operation.workOrderId);
  const taskOutcome = order?.kind === "flight_check" ? "succeeded" as const : "unverified" as const;
  await ctx.db.patch(operation._id, { state: "completed", controlOwner: "none", verifiedSteps, completedAt: Date.now(), taskOutcome });
  if (order) await ctx.db.patch(order._id, { status: "completed", updatedAt: Date.now() });
  await ctx.db.patch(vehicle._id, { available: true, activeOperationId: undefined });
  const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", operation.operatorId)).unique();
  if (profile?.activeOperationId === operation._id) await ctx.db.patch(profile._id, { activeOperationId: undefined });
  const commands = await ctx.db.query("controlCommands").withIndex("by_operation", q => q.eq("operationId", operation._id)).collect();
  for (const command of commands) if (command.status === "acknowledged") await ctx.db.patch(command._id, { status: "completed", completedAt: Date.now() });
  await recordEvent(ctx, operation._id, "completed", taskOutcome === "succeeded" ? "Flight check completed after verified landing and disarm." : "Flight completed. Task result still requires evidence.");
} });

export const reportFailure = mutation({ args: { ...sessionArgs, operationId: v.id("operations"), reason: v.string() }, handler: async (ctx, args) => {
  const { vehicle } = await requireAgentSession(ctx, args.token, args.sessionId);
  const operation = await ctx.db.get(args.operationId);
  if (!operation || operation.vehicleId !== vehicle._id) throw new Error("Operation not found.");
  await uncertainOperation(ctx, operation, args.reason.slice(0, 500));
} });
