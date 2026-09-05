import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOperator, requireAdmin, requireMember } from "./access";
import { environment, capability, geo } from "./operationsSchema";
import { assertGeo } from "../lib/operations";

export const mine = query({ args: {}, handler: async ctx => {
  const { member } = await requireOperator(ctx);
  const vehicles = await ctx.db.query("vehicles").withIndex("by_operator", q => q.eq("operatorId", member.userId)).take(100);
  return Promise.all(vehicles.map(async vehicle => {
    const telemetry = await ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", vehicle._id)).unique();
    const session = vehicle.activeSessionId ? await ctx.db.get(vehicle.activeSessionId) : null;
    return { ...vehicle, telemetry, session: session ? { leaseUntil: session.leaseUntil, retired: session.retired } : null };
  }));
} });
export const register = mutation({ args: { name: v.string(), hardwareId: v.string(), environment, capabilities: v.array(capability), maxPayloadKg: v.number(), home: geo, maxRadiusM: v.number(), serviceRadiusM: v.optional(v.number()), model: v.optional(v.string()) }, handler: async (ctx, args) => {
  const member = await requireMember(ctx);
  const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", member.userId)).unique();
  if (profile && !profile.approved) throw new Error("Operator access is suspended. Contact support.");
  assertGeo(args.home);
  if (!args.name.trim() || args.name.length > 80 || !/^[a-zA-Z0-9_-]{3,80}$/.test(args.hardwareId)) throw new Error("Enter an aircraft name and a valid hardware identity.");
  if (!Number.isFinite(args.maxPayloadKg) || args.maxPayloadKg < 0 || args.maxPayloadKg > 25 || !Number.isFinite(args.maxRadiusM) || args.maxRadiusM < 5 || args.maxRadiusM > 3000) throw new Error("Invalid aircraft limits.");
  const existing = await ctx.db.query("vehicles").withIndex("by_operator", q => q.eq("operatorId", member.userId)).take(100);
  if (existing.length >= 100 || existing.some(vehicle => vehicle.hardwareId === args.hardwareId)) throw new Error("Aircraft identity already registered or fleet limit reached.");
  const serviceRadiusM = args.serviceRadiusM ?? profile?.serviceRadiusM ?? 5000;
  if (!Number.isFinite(serviceRadiusM) || serviceRadiusM < 100 || serviceRadiusM > 100000) throw new Error("Service radius must be 100–100,000 meters.");
  if (args.model && args.model.trim().length > 100) throw new Error("Model must be at most 100 characters.");
  if (!args.capabilities.length) throw new Error("Select the aircraft's supported capabilities.");
  if (args.maxPayloadKg > 0 && !args.capabilities.includes("payload")) throw new Error("Payload capacity requires payload support.");
  if (!profile) {
    await ctx.db.insert("operatorProfiles", { userId: member.userId, approved: true, acceptingJobs: true, qualifications: ["flight_check", "search", "inspection", "deliver"], base: args.home, serviceRadiusM });
    await ctx.db.patch(member._id, { role: member.role === "admin" ? "admin" : "operator" });
  }
  const { serviceRadiusM: _serviceRadiusM, model, ...vehicle } = args;
  return ctx.db.insert("vehicles", { ...vehicle, ...(model?.trim() ? { model: model.trim() } : {}), name: args.name.trim(), capabilities: [...new Set(args.capabilities)], operatorId: member.userId, available: true, integrationApproved: args.environment === "simulated" });
} });
export const storeCredential = internalMutation({ args: { vehicleId: v.id("vehicles"), tokenHash: v.string() }, handler: async (ctx, { vehicleId, tokenHash }) => {
  const { member } = await requireOperator(ctx);
  const vehicle = await ctx.db.get(vehicleId);
  if (!vehicle || vehicle.operatorId !== member.userId) throw new Error("Aircraft not found.");
  if (vehicle.activeOperationId) throw new Error("Resolve the active operation before rotating credentials.");
  const credentials = await ctx.db.query("agentCredentials").withIndex("by_vehicle", q => q.eq("vehicleId", vehicleId)).collect();
  for (const credential of credentials) if (!credential.revokedAt) await ctx.db.patch(credential._id, { revokedAt: Date.now() });
  if (vehicle.activeSessionId) await ctx.db.patch(vehicle.activeSessionId, { retired: true, leaseUntil: Date.now() });
  const expiresAt = Date.now() + 90 * 86400000;
  await ctx.db.insert("agentCredentials", { vehicleId, tokenHash, createdAt: Date.now(), expiresAt });
  return { expiresAt };
} });
export const revokeCredentials = mutation({ args: { vehicleId: v.id("vehicles") }, handler: async (ctx, { vehicleId }) => {
  const { member } = await requireOperator(ctx);
  const vehicle = await ctx.db.get(vehicleId);
  if (!vehicle || vehicle.operatorId !== member.userId) throw new Error("Aircraft not found.");
  const credentials = await ctx.db.query("agentCredentials").withIndex("by_vehicle", q => q.eq("vehicleId", vehicleId)).collect();
  for (const credential of credentials) await ctx.db.patch(credential._id, { revokedAt: Date.now() });
  if (vehicle.activeSessionId) await ctx.db.patch(vehicle.activeSessionId, { retired: true, leaseUntil: Date.now() });
  if (vehicle.activeOperationId) await ctx.db.patch(vehicle.activeOperationId, { state: "attention", attention: "Agent credentials revoked. Verify aircraft state locally.", controlGeneration: (await ctx.db.get(vehicle.activeOperationId))!.controlGeneration + 1 });
} });
// A real aircraft may be provisioned read-only. Control approval is a deployment-admin operation,
// and the agent additionally refuses to launch without an installed, verified hardware adapter.
export const approveIntegration = mutation({ args: { vehicleId: v.id("vehicles"), approved: v.boolean() }, handler: async (ctx, { vehicleId, approved }) => {
  await requireAdmin(ctx);
  const vehicle = await ctx.db.get(vehicleId);
  if (!vehicle || vehicle.activeOperationId) throw new Error("Aircraft is missing or has an active operation.");
  await ctx.db.patch(vehicleId, { integrationApproved: approved });
} });
