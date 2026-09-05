import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireUser, requireMember, requireAdmin, requireOperator, hashSecret } from "./access";
import { geo, jobKind } from "./operationsSchema";
import { assertGeo } from "../lib/operations";

export const me = query({ args: {}, handler: async ctx => {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user) return null;
  const member = await ctx.db.query("members").withIndex("by_user", q => q.eq("userId", userId)).unique();
  const operator = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", userId)).unique();
  return { userId, email: user.email, member, operator };
} });
export const setup = mutation({ args: { displayName: v.string() }, handler: async (ctx, { displayName }) => {
  const userId = await requireUser(ctx);
  const name = displayName.trim();
  if (name.length < 2 || name.length > 80) throw new Error("Enter a name between 2 and 80 characters.");
  const existing = await ctx.db.query("members").withIndex("by_user", q => q.eq("userId", userId)).unique();
  if (existing) { await ctx.db.patch(existing._id, { displayName: name }); return existing._id; }
  return ctx.db.insert("members", { userId, displayName: name, role: "customer" });
} });
export const redeemInvite = mutation({ args: { token: v.string(), base: geo, serviceRadiusM: v.number() }, handler: async (ctx, args) => {
  const member = await requireMember(ctx);
  if (args.token.length > 200) throw new Error("Invalid invitation.");
  const tokenHash = await hashSecret(args.token);
  const invite = await ctx.db.query("operatorInvites").withIndex("by_hash", q => q.eq("tokenHash", tokenHash)).unique();
  const user = await ctx.db.get(member.userId);
  if (!invite || invite.expiresAt < Date.now() || invite.redeemedBy || user?.email?.toLowerCase() !== invite.email) throw new Error("Invitation is invalid, expired, or belongs to another account.");
  assertGeo(args.base);
  if (!Number.isFinite(args.serviceRadiusM) || args.serviceRadiusM < 100 || args.serviceRadiusM > 100000) throw new Error("Service radius must be 100–100,000 meters.");
  await ctx.db.patch(member._id, { role: member.role === "admin" ? "admin" : "operator" });
  const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", member.userId)).unique();
  const fields = { approved: true, acceptingJobs: true, qualifications: ["flight_check" as const], base: args.base, serviceRadiusM: args.serviceRadiusM };
  if (profile) await ctx.db.patch(profile._id, fields); else await ctx.db.insert("operatorProfiles", { userId: member.userId, ...fields });
  await ctx.db.patch(invite._id, { redeemedBy: member.userId });
} });
export const updateAvailability = mutation({ args: { acceptingJobs: v.boolean() }, handler: async (ctx, args) => {
  const { profile } = await requireOperator(ctx);
  await ctx.db.patch(profile._id, args);
} });
export const configureOperator = mutation({ args: { userId: v.id("users"), approved: v.boolean(), qualifications: v.array(jobKind) }, handler: async (ctx, { userId, approved, qualifications }) => {
  await requireAdmin(ctx);
  const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", userId)).unique();
  if (!profile) throw new Error("Operator not found.");
  if (profile.activeOperationId) throw new Error("Resolve the active operation before changing operator approval.");
  await ctx.db.patch(profile._id, { approved, qualifications: [...new Set(qualifications)] });
} });
// Provisioning is available only through the authenticated deployment administration CLI.
export const bootstrapAdmin = internalMutation({ args: { userId: v.id("users") }, handler: async (ctx, { userId }) => {
  const member = await ctx.db.query("members").withIndex("by_user", q => q.eq("userId", userId)).unique();
  if (!member) throw new Error("Create and finish setting up the account first.");
  await ctx.db.patch(member._id, { role: "admin" });
} });
export const storeInvite = internalMutation({ args: { email: v.string(), tokenHash: v.string() }, handler: async (ctx, args) => {
  const admin = await requireAdmin(ctx);
  const email = args.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid email.");
  const expiresAt = Date.now() + 7 * 86400000;
  await ctx.db.insert("operatorInvites", { email, tokenHash: args.tokenHash, expiresAt, createdBy: admin.userId });
  return { expiresAt };
} });
