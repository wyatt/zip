import { v } from "convex/values";
import { action, internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { hashSecret, requireAgentSession, requireOperationAccess } from "./access";
import { TELEMETRY_STALE_MS } from "../lib/operations";

export const ticket = action({ args: { operationId: v.id("operations") }, handler: async (ctx, { operationId }): Promise<{ token: string; expiresAt: number }> => {
  const token = "zip_control_" + Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  const result = await ctx.runMutation(internal.manualControl.issue, { operationId, tokenHash: await hashSecret(token) });
  return { token, ...result };
} });
export const issue = internalMutation({ args: { operationId: v.id("operations"), tokenHash: v.string() }, handler: async (ctx, { operationId, tokenHash }) => {
  const operation = await requireOperationAccess(ctx, operationId, true);
  if (operation.state !== "manual" || operation.controlOwner !== "computer") throw new Error("Aircraft must acknowledge computer control first.");
  const vehicle = await ctx.db.get(operation.vehicleId);
  const session = vehicle?.activeSessionId ? await ctx.db.get(vehicle.activeSessionId) : null;
  const telemetry = await ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", operation.vehicleId)).unique();
  if (!session || session.retired || session.leaseUntil <= Date.now() || !telemetry || telemetry.sessionId !== session._id || Date.now() - telemetry.sample.capturedAt > TELEMETRY_STALE_MS) throw new Error("Fresh aircraft connection required.");
  const expiresAt = Date.now() + 30000;
  await ctx.db.insert("manualTickets", { operationId, vehicleId: operation.vehicleId, sessionId: session._id, operatorId: operation.operatorId, generation: operation.controlGeneration, tokenHash, expiresAt });
  return { expiresAt };
} });
export const redeem = mutation({ args: { token: v.string(), sessionId: v.id("agentSessions"), ticket: v.string() }, handler: async (ctx, args) => {
  const { vehicle } = await requireAgentSession(ctx, args.token, args.sessionId);
  if (!/^zip_control_[a-f0-9]{64}$/.test(args.ticket)) throw new Error("Invalid control ticket.");
  const tokenHash = await hashSecret(args.ticket);
  const ticket = await ctx.db.query("manualTickets").withIndex("by_hash", q => q.eq("tokenHash", tokenHash)).unique();
  if (!ticket || ticket.consumedAt || ticket.expiresAt <= Date.now() || ticket.vehicleId !== vehicle._id || ticket.sessionId !== args.sessionId) throw new Error("Control ticket is expired, used, or belongs to another aircraft.");
  const operation = await ctx.db.get(ticket.operationId);
  if (!operation || operation.state !== "manual" || operation.controlOwner !== "computer" || operation.controlGeneration !== ticket.generation) throw new Error("Control ownership changed.");
  await ctx.db.patch(ticket._id, { consumedAt: Date.now() });
  return { operationId: operation._id, generation: ticket.generation, expiresAt: ticket.expiresAt, plan: operation.plan };
} });
