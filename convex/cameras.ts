import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAgentSession, requireOperationAccess } from "./access";

const protocol = v.union(v.literal("whep"), v.literal("hls"), v.literal("mjpeg"));
const session = v.object({ protocol, url: v.string(), expiresAt: v.number() });

export const uploadUrl = mutation({
  args: { token: v.string(), sessionId: v.id("agentSessions") },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireAgentSession(ctx, args.token, args.sessionId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const publish = mutation({
  args: {
    token: v.string(),
    sessionId: v.id("agentSessions"),
    operationId: v.id("operations"),
    protocol,
    url: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { vehicle } = await requireAgentSession(ctx, args.token, args.sessionId);
    const operation = await ctx.db.get(args.operationId);
    if (!operation || operation.vehicleId !== vehicle._id || ["cancelled", "completed"].includes(operation.state)) throw new Error("Camera is not available for this operation.");
    if (!Number.isFinite(args.expiresAt) || args.expiresAt <= Date.now() || args.expiresAt > Date.now() + 300000) throw new Error("Camera sessions must expire within five minutes.");
    let url = args.url;
    if (args.storageId) {
      const stored = await ctx.storage.getUrl(args.storageId);
      if (!stored) throw new Error("Camera frame was not uploaded.");
      url = stored;
    }
    if (!url || url.length > 4096) throw new Error("Camera session is missing a reachable URL.");
    const parsed = new URL(url);
    const loopback = parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
    if (parsed.username || parsed.password || (parsed.protocol !== "https:" && !loopback)) throw new Error("Camera transport must use HTTPS.");
    const existing = await ctx.db.query("cameraSessions").withIndex("by_operation", q => q.eq("operationId", operation._id)).unique();
    if (existing?.storageId && existing.storageId !== args.storageId) await ctx.storage.delete(existing.storageId);
    const record = {
      vehicleId: vehicle._id,
      sessionId: args.sessionId,
      operationId: operation._id,
      protocol: args.protocol,
      url,
      expiresAt: args.expiresAt,
      ...(args.storageId ? { storageId: args.storageId } : {}),
    };
    if (existing) await ctx.db.replace(existing._id, record); else await ctx.db.insert("cameraSessions", record);
    return null;
  },
});

export const forOperation = query({
  args: { operationId: v.id("operations") },
  returns: v.union(session, v.null()),
  handler: async (ctx, { operationId }) => {
    const operation = await requireOperationAccess(ctx, operationId);
    if (["cancelled", "completed"].includes(operation.state)) return null;
    const camera = await ctx.db.query("cameraSessions").withIndex("by_operation", q => q.eq("operationId", operationId)).unique();
    if (!camera || camera.expiresAt <= Date.now()) return null;
    const vehicle = await ctx.db.get(camera.vehicleId);
    const sessionDoc = await ctx.db.get(camera.sessionId);
    if (vehicle?.activeSessionId !== camera.sessionId || !sessionDoc || sessionDoc.retired || sessionDoc.leaseUntil <= Date.now()) return null;
    return { protocol: camera.protocol, url: camera.url, expiresAt: camera.expiresAt };
  },
});

export async function deleteCameraSession(ctx: MutationCtx, operationId: Id<"operations">) {
  const camera = await ctx.db.query("cameraSessions").withIndex("by_operation", q => q.eq("operationId", operationId)).unique();
  if (!camera) return;
  if (camera.storageId) await ctx.storage.delete(camera.storageId);
  await ctx.db.delete(camera._id);
}
