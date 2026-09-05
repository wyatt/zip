import { areaGeometry } from "../lib/areas";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMember, requireOperator, hashSecret } from "./access";
import { controlMode, environment, geo, jobKind, surveyArea } from "./operationsSchema";
import { assertGeo, createFlightPlan, serializeFlightPlan, matchesRequirements, metersBetween, requiredCapabilities } from "../lib/operations";

export const mine = query({ args: {}, handler: async ctx => {
  const member = await requireMember(ctx);
  return ctx.db.query("workOrders").withIndex("by_customer", q => q.eq("customerId", member.userId)).order("desc").take(100);
} });
export const submit = mutation({ args: { title: v.string(), description: v.string(), kind: jobKind, environment, location: geo, area: v.optional(surveyArea), destinations: v.array(geo), payloadKg: v.number(), altitudeM: v.number(), hoverSec: v.number() }, handler: async (ctx, args) => {
  const member = await requireMember(ctx);
  const title = args.title.trim(), description = args.description.trim();
  if (title.length < 3 || title.length > 100 || description.length > 2000) throw new Error("Provide a title (3–100 characters) and instructions under 2,000 characters.");
  assertGeo(args.location);
  if (args.destinations.length > 50) throw new Error("At most 50 waypoints are allowed.");
  args.destinations.forEach(assertGeo);
  if (!Number.isFinite(args.payloadKg) || args.payloadKg < 0 || args.payloadKg > 25) throw new Error("Invalid payload weight.");
  if (args.area && !["search", "inspection"].includes(args.kind)) throw new Error("An area is only supported for search and inspection.");
  const geometry = args.area ? areaGeometry(args.area) : null;
  const location = geometry?.center ?? args.location;
  const destinations = geometry?.destinations ?? args.destinations;
  createFlightPlan({ ...args, location, destinations, home: location, mode: "autonomous", maxRadiusM: 3000 });
  // Bound one account's active queue without scanning everyone else's orders.
  const recent = await ctx.db.query("workOrders").withIndex("by_customer", q => q.eq("customerId", member.userId)).order("desc").take(100);
  if (recent.filter(order => order.status === "open" || order.status === "assigned").length >= 20) throw new Error("Finish or cancel an existing request before adding more.");
  return ctx.db.insert("workOrders", { ...args, location, destinations, title, description, customerId: member.userId, requiredCapabilities: requiredCapabilities(args.kind), status: "open", updatedAt: Date.now() });
} });
export const eligible = query({ args: {}, handler: async ctx => {
  const { member, profile } = await requireOperator(ctx);
  const vehicles = await ctx.db.query("vehicles").withIndex("by_operator", q => q.eq("operatorId", member.userId)).take(100);
  const orders = await ctx.db.query("workOrders").withIndex("by_status", q => q.eq("status", "open")).order("asc").take(200);
  return orders.flatMap(order => {
    const eligibleVehicles = vehicles.filter(vehicle => matchesRequirements({ ...order, required: order.requiredCapabilities }, profile, vehicle));
    return eligibleVehicles.length ? [{ ...order, eligibleVehicleIds: eligibleVehicles.map(v => v._id) }] : [];
  });
} });
export const accept = mutation({ args: { workOrderId: v.id("workOrders"), vehicleId: v.id("vehicles"), mode: controlMode, manualControl: v.union(v.literal("remote"), v.literal("computer")) }, handler: async (ctx, args) => {
  const { member, profile } = await requireOperator(ctx);
  const order = await ctx.db.get(args.workOrderId), vehicle = await ctx.db.get(args.vehicleId);
  if (!order || !vehicle || vehicle.operatorId !== member.userId) throw new Error("Request or aircraft not found.");
  if (order.operationId) {
    const existing = await ctx.db.get(order.operationId);
    if (existing?.operatorId === member.userId && existing.vehicleId === vehicle._id) return existing._id;
    throw new Error("Another operator already accepted this job.");
  }
  if (profile.activeOperationId || vehicle.activeOperationId || order.status !== "open" || !matchesRequirements({ ...order, required: order.requiredCapabilities }, profile, vehicle)) throw new Error("This request no longer matches your availability or aircraft capabilities.");
  const manualCapability = args.manualControl === "remote" ? "manual_remote" : "manual_computer";
  if (!vehicle.capabilities.includes(manualCapability) || (args.mode === "autonomous" && !vehicle.capabilities.includes("autonomous"))) throw new Error("Aircraft does not support this control mode and takeover method.");
  if (order.kind === "flight_check" && metersBetween(vehicle.home, order.location) > 10) throw new Error("A flight check must launch within 10 meters of the requested location.");
  const plan = createFlightPlan({ ...order, mode: args.mode, home: vehicle.home, maxRadiusM: vehicle.maxRadiusM });
  const planHash = await hashSecret(serializeFlightPlan(plan));
  const operationId = await ctx.db.insert("operations", { workOrderId: order._id, customerId: order.customerId, operatorId: member.userId, vehicleId: vehicle._id, state: "assigned", plan, planHash, controlOwner: "none", controlGeneration: vehicle.controlGeneration ?? 0, manualControl: args.manualControl, currentStep: 0, stepDwellMs: 0, progressSequence: -1, verifiedSteps: [], sawAirborne: false, taskOutcome: "pending" });
  await ctx.db.patch(order._id, { status: "assigned", operationId, updatedAt: Date.now() });
  await ctx.db.patch(vehicle._id, { available: false, activeOperationId: operationId });
  await ctx.db.patch(profile._id, { activeOperationId: operationId });
  await ctx.db.insert("operationEvents", { operationId, actor: String(member.userId), kind: "assigned", message: `${member.displayName} accepted the job. ${args.mode === "autonomous" ? "Autonomous" : "Manual"} plan created.`, timestamp: Date.now() });
  return operationId;
} });
export const cancel = mutation({ args: { workOrderId: v.id("workOrders") }, handler: async (ctx, { workOrderId }) => {
  const member = await requireMember(ctx);
  const order = await ctx.db.get(workOrderId);
  if (!order || order.customerId !== member.userId) throw new Error("Request not found.");
  if (order.status !== "open") throw new Error("An assigned operation must be resolved by the operator.");
  await ctx.db.patch(workOrderId, { status: "cancelled", updatedAt: Date.now() });
} });
