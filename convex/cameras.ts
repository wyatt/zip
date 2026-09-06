import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAgentSession, requireOperationAccess } from "./access";

export const publish = mutation({ args: { token: v.string(), sessionId: v.id("agentSessions"), operationId: v.id("operations"), protocol: v.union(v.literal("whep"), v.literal("hls"), v.literal("mjpeg")), url: v.string(), expiresAt: v.number() }, handler: async (ctx, args) => {
  const { vehicle } = await requireAgentSession(ctx, args.token, args.sessionId);
  const operation = await ctx.db.get(args.operationId);
  if (!operation || operation.vehicleId !== vehicle._id || ["cancelled", "completed"].includes(operation.state)) throw new Error("Camera is not available for this operation.");
  if (!Number.isFinite(args.expiresAt) || args.expiresAt <= Date.now() || args.expiresAt > Date.now() + 300000 || args.url.length > 4096) throw new Error("Camera sessions must expire within five minutes.");
  const url = new URL(args.url);
  const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !loopback)) throw new Error("Camera transport must use HTTPS.");
  const existing = await ctx.db.query("cameraSessions").withIndex("by_operation", q => q.eq("operationId", operation._id)).unique();
  const record = { vehicleId: vehicle._id, sessionId: args.sessionId, operationId: operation._id, protocol: args.protocol, url: args.url, expiresAt: args.expiresAt };
  if (existing) await ctx.db.patch(existing._id, record); else await ctx.db.insert("cameraSessions", record);
} });
export const forOperation = query({ args: { operationId: v.id("operations") }, handler: async (ctx, { operationId }) => {
  const operation = await requireOperationAccess(ctx, operationId);
  if (["cancelled", "completed"].includes(operation.state)) return null;
  const camera = await ctx.db.query("cameraSessions").withIndex("by_operation", q => q.eq("operationId", operationId)).unique();
  if (!camera || camera.expiresAt <= Date.now()) return null;
  const vehicle = await ctx.db.get(camera.vehicleId);
  const session = await ctx.db.get(camera.sessionId);
  if (vehicle?.activeSessionId !== camera.sessionId || !session || session.retired || session.leaseUntil <= Date.now()) return null;
  return { protocol: camera.protocol, url: camera.url, expiresAt: camera.expiresAt };
} });
