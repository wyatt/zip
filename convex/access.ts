import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type ReadCtx = QueryCtx | MutationCtx;
export async function requireUser(ctx: ReadCtx) {
  const id = await getAuthUserId(ctx);
  if (!id || !await ctx.db.get(id)) throw new Error("Sign in to continue.");
  return id;
}
export async function requireMember(ctx: ReadCtx) {
  const userId = await requireUser(ctx);
  const member = await ctx.db.query("members").withIndex("by_user", q => q.eq("userId", userId)).unique();
  if (!member) throw new Error("Finish setting up your account.");
  return member;
}
export async function requireOperator(ctx: ReadCtx) {
  const member = await requireMember(ctx);
  const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", member.userId)).unique();
  if (!profile?.approved || !["operator", "admin"].includes(member.role)) throw new Error("An approved operator account is required.");
  return { member, profile };
}
export async function requireAdmin(ctx: ReadCtx) {
  const member = await requireMember(ctx);
  if (member.role !== "admin") throw new Error("Administrator access required.");
  return member;
}
export async function requireOperationAccess(ctx: ReadCtx, operationId: Id<"operations">, operatorOnly = false) {
  const member = await requireMember(ctx);
  const operation = await ctx.db.get(operationId);
  if (!operation || (operation.operatorId !== member.userId && (operatorOnly || operation.customerId !== member.userId))) throw new Error("Operation not found.");
  if (operatorOnly) await requireOperator(ctx);
  return operation;
}
export async function hashSecret(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function requireCredential(ctx: ReadCtx, token: string) {
  if (!/^zip_agent_[a-f0-9]{64}$/.test(token)) throw new Error("Invalid agent credential.");
  const tokenHash = await hashSecret(token);
  const credential = await ctx.db.query("agentCredentials").withIndex("by_hash", q => q.eq("tokenHash", tokenHash)).unique();
  if (!credential || credential.revokedAt || credential.expiresAt <= Date.now()) throw new Error("Agent credential expired or revoked.");
  const vehicle = await ctx.db.get(credential.vehicleId);
  if (!vehicle) throw new Error("Aircraft not found.");
  const operator = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", vehicle.operatorId)).unique();
  if (!operator?.approved) throw new Error("Operator access suspended.");
  return { credential, vehicle };
}
export async function requireAgentSession(ctx: ReadCtx, token: string, sessionId: Id<"agentSessions">) {
  const { credential, vehicle } = await requireCredential(ctx, token);
  const session = await ctx.db.get(sessionId);
  if (!session || session.retired || session.credentialId !== credential._id || session.vehicleId !== vehicle._id || vehicle.activeSessionId !== sessionId || session.leaseUntil <= Date.now()) throw new Error("Agent session lost. Reconcile before reconnecting.");
  return { credential, vehicle, session };
}
