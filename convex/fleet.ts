import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOperator, requireAdmin, requireOperatorAccount } from "./access";
import { environment, capability, geo } from "./operationsSchema";
import { assertGeo } from "../lib/operations";

async function operatorVehicles(ctx: MutationCtx, operatorId: Id<"users">) {
  return ctx.db.query("vehicles").withIndex("by_operator", q => q.eq("operatorId", operatorId)).take(100);
}

export const mine = query({ args: {}, handler: async ctx => {
  const { member } = await requireOperator(ctx);
  const vehicles = await ctx.db.query("vehicles").withIndex("by_operator", q => q.eq("operatorId", member.userId)).take(100);
  return Promise.all(vehicles.map(async vehicle => {
    const telemetry = await ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", vehicle._id)).unique();
    const session = vehicle.activeSessionId ? await ctx.db.get(vehicle.activeSessionId) : null;
    return { ...vehicle, telemetry, session: session ? { leaseUntil: session.leaseUntil, lastSeenAt: session.lastSeenAt, retired: session.retired } : null };
  }));
} });
export const agentStatus = query({ args: {}, handler: async ctx => {
  const { member } = await requireOperator(ctx);
  const credentials = await ctx.db.query("agentCredentials").withIndex("by_operator", q => q.eq("operatorId", member.userId)).order("desc").take(20);
  const active = credentials.find(credential => !credential.revokedAt);
  const vehicles = await ctx.db.query("vehicles").withIndex("by_operator", q => q.eq("operatorId", member.userId)).take(100);
  const heartbeats = [];
  for (const vehicle of vehicles) {
    const session = vehicle.activeSessionId ? await ctx.db.get(vehicle.activeSessionId) : null;
    if (session) heartbeats.push({ vehicleId: vehicle._id, name: vehicle.name, lastSeenAt: session.lastSeenAt, leaseUntil: session.leaseUntil, retired: session.retired });
  }
  return { issued: !!active, expiresAt: active?.expiresAt ?? null, lastSeenAt: active?.lastSeenAt ?? null, heartbeats };
} });
export const register = mutation({ args: { name: v.string(), hardwareId: v.string(), environment, capabilities: v.array(capability), maxPayloadKg: v.number(), cameraMp: v.optional(v.number()), home: geo, maxRadiusM: v.number(), serviceRadiusM: v.optional(v.number()), model: v.optional(v.string()) }, handler: async (ctx, args) => {
  const member = await requireOperatorAccount(ctx);
  const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", member.userId)).unique();
  if (profile && !profile.approved) throw new Error("Operator access is suspended. Contact support.");
  assertGeo(args.home);
  if (!args.name.trim() || args.name.length > 80 || !/^[a-zA-Z0-9_-]{3,80}$/.test(args.hardwareId)) throw new Error("Enter an aircraft name and a valid hardware identity.");
  if (!Number.isFinite(args.maxPayloadKg) || args.maxPayloadKg < 0 || args.maxPayloadKg > 25 || !Number.isFinite(args.maxRadiusM) || args.maxRadiusM < 5 || args.maxRadiusM > 100000) throw new Error("Invalid aircraft limits.");
  const existing = await ctx.db.query("vehicles").withIndex("by_operator", q => q.eq("operatorId", member.userId)).take(100);
  if (existing.length >= 100 || existing.some(vehicle => vehicle.hardwareId === args.hardwareId)) throw new Error("Aircraft identity already registered or fleet limit reached.");
  if (!profile || !profile.presetLocations?.length) throw new Error("Save launch sites in account settings before registering an aircraft.");
  const launch = profile.presetLocations.find(site => Math.abs(site.lat - args.home.lat) < 1e-7 && Math.abs(site.lon - args.home.lon) < 1e-7);
  if (!launch) throw new Error("Choose a saved launch site from account settings.");
  const serviceRadiusM = args.serviceRadiusM ?? Math.max(args.maxRadiusM, 100);
  if (!Number.isFinite(serviceRadiusM) || serviceRadiusM < 100 || serviceRadiusM > 100000) throw new Error("Max range must be 100–100,000 meters.");
  if (args.model && args.model.trim().length > 100) throw new Error("Model must be at most 100 characters.");
  if (!args.capabilities.length) throw new Error("Select the aircraft's supported capabilities.");
  if (args.maxPayloadKg > 0 && !args.capabilities.includes("payload")) throw new Error("Payload capacity requires payload support.");
  if (args.capabilities.includes("camera")) {
    if (!Number.isFinite(args.cameraMp) || (args.cameraMp ?? 0) < 0.1 || (args.cameraMp ?? 0) > 200) throw new Error("Enter camera resolution in megapixels.");
  } else if (args.cameraMp) throw new Error("Camera resolution requires a camera.");
  const { serviceRadiusM: _serviceRadiusM, model, cameraMp, ...vehicle } = args;
  await ctx.db.patch(profile._id, { serviceRadiusM });
  return ctx.db.insert("vehicles", { ...vehicle, ...(model?.trim() ? { model: model.trim() } : {}), ...(args.capabilities.includes("camera") ? { cameraMp } : {}), name: args.name.trim(), capabilities: [...new Set(args.capabilities)], operatorId: member.userId, available: true, integrationApproved: args.environment === "simulated" });
} });
export const remove = mutation({ args: { vehicleId: v.id("vehicles") }, handler: async (ctx, { vehicleId }) => {
  const { member } = await requireOperator(ctx);
  const vehicle = await ctx.db.get(vehicleId);
  if (!vehicle || vehicle.operatorId !== member.userId) throw new Error("Aircraft not found.");
  if (vehicle.activeOperationId) throw new Error("Finish the active operation before removing this aircraft.");
  const sessions = await ctx.db.query("agentSessions").withIndex("by_vehicle", q => q.eq("vehicleId", vehicleId)).take(100);
  for (const session of sessions) await ctx.db.delete(session._id);
  const telemetry = await ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", vehicleId)).unique();
  if (telemetry) await ctx.db.delete(telemetry._id);
  const credentials = await ctx.db.query("agentCredentials").withIndex("by_vehicle", q => q.eq("vehicleId", vehicleId)).take(20);
  for (const credential of credentials) if (!credential.revokedAt) await ctx.db.patch(credential._id, { revokedAt: Date.now() });
  await ctx.db.delete(vehicleId);
} });
export const storeCredential = internalMutation({ args: { tokenHash: v.string() }, handler: async (ctx, { tokenHash }) => {
  const { member } = await requireOperator(ctx);
  const vehicles = await operatorVehicles(ctx, member.userId);
  if (vehicles.some(vehicle => vehicle.activeOperationId)) throw new Error("Resolve active operations before rotating the fleet agent token.");
  const credentials = await ctx.db.query("agentCredentials").withIndex("by_operator", q => q.eq("operatorId", member.userId)).take(100);
  for (const credential of credentials) if (!credential.revokedAt) await ctx.db.patch(credential._id, { revokedAt: Date.now() });
  for (const vehicle of vehicles) if (vehicle.activeSessionId) await ctx.db.patch(vehicle.activeSessionId, { retired: true, leaseUntil: Date.now() });
  const expiresAt = Date.now() + 90 * 86400000;
  await ctx.db.insert("agentCredentials", { operatorId: member.userId, tokenHash, createdAt: Date.now(), expiresAt });
  return { expiresAt };
} });
export const revokeCredentials = mutation({ args: {}, handler: async ctx => {
  const { member } = await requireOperator(ctx);
  const credentials = await ctx.db.query("agentCredentials").withIndex("by_operator", q => q.eq("operatorId", member.userId)).take(100);
  for (const credential of credentials) if (!credential.revokedAt) await ctx.db.patch(credential._id, { revokedAt: Date.now() });
  for (const vehicle of await operatorVehicles(ctx, member.userId)) {
    if (vehicle.activeSessionId) await ctx.db.patch(vehicle.activeSessionId, { retired: true, leaseUntil: Date.now() });
    if (vehicle.activeOperationId) {
      const operation = await ctx.db.get(vehicle.activeOperationId);
      if (operation) await ctx.db.patch(operation._id, { state: "attention", attention: "Fleet agent credentials revoked. Verify aircraft state locally.", controlGeneration: operation.controlGeneration + 1 });
    }
  }
} });
// A real aircraft may be provisioned read-only. Control approval is a deployment-admin operation,
// and the agent additionally refuses to launch without an installed, verified hardware adapter.
export const approveIntegration = mutation({ args: { vehicleId: v.id("vehicles"), approved: v.boolean() }, handler: async (ctx, { vehicleId, approved }) => {
  await requireAdmin(ctx);
  const vehicle = await ctx.db.get(vehicleId);
  if (!vehicle || vehicle.activeOperationId) throw new Error("Aircraft is missing or has an active operation.");
  await ctx.db.patch(vehicleId, { integrationApproved: approved });
} });
