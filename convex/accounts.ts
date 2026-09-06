import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireUser, requireOperatorAccount, requireAdmin, requireOperator, hashSecret } from "./access";
import { geo, jobKind, presetLocation } from "./operationsSchema";
import { assertGeo } from "../lib/operations";
import { assignLaunchSiteIds } from "../lib/launch-sites";
import { isDemoRole } from "../lib/roles";
import { syncFleetLaunchSites } from "./fleet";

export const me = query({ args: {}, handler: async ctx => {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user) return null;
  const member = await ctx.db.query("members").withIndex("by_user", q => q.eq("userId", userId)).unique();
  const operator = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", userId)).unique();
  return { userId, email: user.email, member, operator };
} });
export const setup = mutation({ args: { displayName: v.string(), role: v.union(v.literal("customer"), v.literal("operator"), v.literal("demo")) }, handler: async (ctx, { displayName, role }) => {
  const userId = await requireUser(ctx);
  const name = displayName.trim();
  if (name.length < 2 || name.length > 80) throw new Error("Enter a name between 2 and 80 characters.");
  const existing = await ctx.db.query("members").withIndex("by_user", q => q.eq("userId", userId)).unique();
  if (existing) { await ctx.db.patch(existing._id, { displayName: name }); return existing._id; }
  return ctx.db.insert("members", { userId, displayName: name, role });
} });
export const redeemInvite = mutation({ args: { token: v.string(), base: geo, serviceRadiusM: v.number() }, handler: async (ctx, args) => {
  const member = await requireOperatorAccount(ctx);
  if (args.token.length > 200) throw new Error("Invalid invitation.");
  const tokenHash = await hashSecret(args.token);
  const invite = await ctx.db.query("operatorInvites").withIndex("by_hash", q => q.eq("tokenHash", tokenHash)).unique();
  const user = await ctx.db.get(member.userId);
  if (!invite || invite.expiresAt < Date.now() || invite.redeemedBy || user?.email?.toLowerCase() !== invite.email) throw new Error("Invitation is invalid, expired, or belongs to another account.");
  assertGeo(args.base);
  if (!Number.isFinite(args.serviceRadiusM) || args.serviceRadiusM < 100 || args.serviceRadiusM > 100000) throw new Error("Service radius must be 100–100,000 meters.");
  await ctx.db.patch(member._id, { role: member.role === "admin" || member.role === "demo" ? member.role : "operator" });
  const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", member.userId)).unique();
  const fields = { approved: true, acceptingJobs: true, qualifications: ["flight_check" as const], base: args.base, serviceRadiusM: args.serviceRadiusM, presetLocations: assignLaunchSiteIds([{ name: "Home", lat: args.base.lat, lon: args.base.lon }]) };
  if (profile) await ctx.db.patch(profile._id, fields); else await ctx.db.insert("operatorProfiles", { userId: member.userId, ...fields });
  await ctx.db.patch(invite._id, { redeemedBy: member.userId });
} });
export const updateAvailability = mutation({ args: { acceptingJobs: v.boolean() }, handler: async (ctx, args) => {
  const { profile } = await requireOperator(ctx);
  await ctx.db.patch(profile._id, args);
} });
export const savePresetLocations = mutation({ args: { locations: v.array(presetLocation), serviceRadiusM: v.optional(v.number()) }, handler: async (ctx, args) => {
  const member = await requireOperatorAccount(ctx);
  if (args.locations.length > 20) throw new Error("You can save at most 20 launch sites.");
  const locations = assignLaunchSiteIds(args.locations.map(location => ({
    id: location.id,
    name: location.name.trim(),
    lat: location.lat,
    lon: location.lon,
  })));
  const names = new Set<string>();
  for (const location of locations) {
    if (location.name.length < 1 || location.name.length > 40) throw new Error("Each launch site needs a name of 1–40 characters.");
    const key = location.name.toLowerCase();
    if (names.has(key)) throw new Error("Launch site names must be unique.");
    names.add(key);
    assertGeo({ lat: location.lat, lon: location.lon });
  }
  if (locations.length < 1) throw new Error("Add at least one launch site.");
  const serviceRadiusM = args.serviceRadiusM;
  if (serviceRadiusM !== undefined && (!Number.isFinite(serviceRadiusM) || serviceRadiusM < 100 || serviceRadiusM > 100000)) {
    throw new Error("Service radius must be 100–100,000 meters.");
  }
  const home = locations.find(location => location.name.toLowerCase() === "home") ?? locations[0]!;
  const base = { lat: home.lat, lon: home.lon };
  const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", member.userId)).unique();
  if (profile) {
    await ctx.db.patch(profile._id, { presetLocations: locations, base, ...(serviceRadiusM !== undefined ? { serviceRadiusM } : {}) });
    await syncFleetLaunchSites(ctx, member.userId, locations);
    if (isDemoRole(member.role)) {
      const vehicles = await ctx.db.query("vehicles").withIndex("by_operator", q => q.eq("operatorId", member.userId)).take(100);
      for (const vehicle of vehicles) if (!vehicle.integrationApproved) await ctx.db.patch(vehicle._id, { integrationApproved: true });
    }
    return profile._id;
  }
  return ctx.db.insert("operatorProfiles", {
    userId: member.userId,
    approved: true,
    acceptingJobs: true,
    qualifications: ["flight_check", "search", "inspection", "deliver"],
    base,
    serviceRadiusM: serviceRadiusM ?? 5000,
    presetLocations: locations,
  });
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
export const convertToDemo = internalMutation({ args: { memberId: v.id("members") }, returns: v.null(), handler: async (ctx, { memberId }) => {
  const member = await ctx.db.get(memberId);
  if (!member) throw new Error("Account not found.");
  if (member.role === "admin") throw new Error("Administrator accounts cannot become demo accounts.");
  await ctx.db.patch(memberId, { role: "demo" });
  const vehicles = await ctx.db.query("vehicles").withIndex("by_operator", q => q.eq("operatorId", member.userId)).take(100);
  for (const vehicle of vehicles) if (!vehicle.integrationApproved) await ctx.db.patch(vehicle._id, { integrationApproved: true });
  return null;
} });
export const storeInvite = internalMutation({ args: { email: v.string(), tokenHash: v.string() }, handler: async (ctx, args) => {
  const admin = await requireAdmin(ctx);
  const email = args.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid email.");
  const expiresAt = Date.now() + 7 * 86400000;
  await ctx.db.insert("operatorInvites", { email, tokenHash: args.tokenHash, expiresAt, createdBy: admin.userId });
  return { expiresAt };
} });
