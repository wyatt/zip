import { areaGeometry } from "../lib/areas";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCustomer, requireOperator, hashSecret } from "./access";
import { controlMode, environment, geo, jobKind, surveyArea } from "./operationsSchema";
import { assertGeo, createFlightPlan, serializeFlightPlan, matchesRequirements, metersBetween, missionProgressPct, requiredCapabilities, WAITING_FLEET_RADIUS_M, type GeoPoint } from "../lib/operations";
import { physicalIntegrationAllowed } from "../lib/roles";
import { profileLaunchSites, resolvedVehicleHome } from "./fleet";
import { quoteWorkOrder } from "../lib/pricing";

async function marketAround(ctx: QueryCtx | MutationCtx, location: GeoPoint, openOrders?: Doc<"workOrders">[]) {
  const open = openOrders ?? await ctx.db.query("workOrders").withIndex("by_status", q => q.eq("status", "open")).order("asc").take(200);
  const idle = await ctx.db.query("vehicles").withIndex("by_available", q => q.eq("available", true)).take(200);
  return {
    openNearby: open.filter(order => metersBetween(order.location, location) <= WAITING_FLEET_RADIUS_M).length,
    idleNearby: idle.filter(vehicle => !vehicle.activeOperationId && metersBetween(vehicle.home, location) <= WAITING_FLEET_RADIUS_M).length,
  };
}

const nearbyVehicle = v.object({
  vehicleId: v.id("vehicles"),
  name: v.string(),
  model: v.union(v.string(), v.null()),
  operatorName: v.string(),
  environment,
  own: v.boolean(),
  position: geo,
});

export const mine = query({ args: {}, handler: async ctx => {
  const member = await requireCustomer(ctx);
  const orders = await ctx.db.query("workOrders").withIndex("by_customer", q => q.eq("customerId", member.userId)).order("desc").take(100);
  return Promise.all(orders.map(async order => {
    if (!order.operationId) return { ...order, vehicleModel: null as string | null, progressPct: null as number | null };
    const operation = await ctx.db.get(order.operationId);
    const vehicle = operation ? await ctx.db.get(operation.vehicleId) : null;
    if (!operation) return { ...order, vehicleModel: vehicle?.model ?? null, progressPct: null as number | null };
    const recorded = await ctx.db.query("operationTelemetry").withIndex("by_operation", q => q.eq("operationId", operation._id)).unique();
    const live = !recorded && vehicle?.activeOperationId === operation._id
      ? await ctx.db.query("vehicleTelemetry").withIndex("by_vehicle", q => q.eq("vehicleId", operation.vehicleId)).unique()
      : null;
    const progress = await ctx.db.query("flightProgress").withIndex("by_operation", q => q.eq("operationId", operation._id)).unique();
    const sample = recorded?.sample ?? live?.sample ?? null;
    return {
      ...order,
      vehicleModel: vehicle?.model ?? null,
      progressPct: missionProgressPct({
        state: operation.state,
        steps: operation.plan.steps,
        currentStep: operation.currentStep,
        verifiedSteps: operation.verifiedSteps,
        sample,
        dwellMs: progress?.stepIndex === operation.currentStep ? progress.dwellMs : 0,
      }),
    };
  }));
} });
export const submit = mutation({ args: { title: v.string(), description: v.string(), kind: jobKind, environment, location: geo, area: v.optional(surveyArea), destinations: v.array(geo), payloadKg: v.number(), altitudeM: v.number(), hoverSec: v.number() }, handler: async (ctx, args) => {
  const member = await requireCustomer(ctx);
  const title = args.title.trim(), description = args.description.trim();
  if (title.length < 3 || title.length > 100 || description.length > 2000) throw new Error("Provide a title (3–100 characters) and instructions under 2,000 characters.");
  assertGeo(args.location);
  if (args.destinations.length > 50) throw new Error("At most 50 waypoints are allowed.");
  args.destinations.forEach(assertGeo);
  if (args.kind === "deliver") {
    const dropoff = args.destinations.at(-1);
    if (!dropoff) throw new Error("Choose pickup A and drop-off B.");
    if (metersBetween(args.location, dropoff) < 10) throw new Error("Pickup and delivery must be at least 10 m apart.");
  }
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
export const availableNearby = query({
  args: { workOrderId: v.id("workOrders") },
  returns: v.array(nearbyVehicle),
  handler: async (ctx, { workOrderId }) => {
    const member = await requireCustomer(ctx);
    const order = await ctx.db.get(workOrderId);
    if (!order || order.customerId !== member.userId || order.status !== "open") return [];
    const job = order;
    const nearby: Array<{ vehicleId: Doc<"vehicles">["_id"]; name: string; model: string | null; operatorName: string; environment: Doc<"vehicles">["environment"]; own: boolean; position: Doc<"vehicles">["home"] }> = [];
    const seen = new Set<string>();
    async function addVehicle(vehicle: Doc<"vehicles">, own: boolean) {
      if (seen.has(vehicle._id) || !vehicle.available || vehicle.activeOperationId) return;
      if (metersBetween(vehicle.home, job.location) > Math.min(WAITING_FLEET_RADIUS_M, vehicle.maxRadiusM)) return;
      const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", vehicle.operatorId)).unique();
      const operator = own ? member : await ctx.db.query("members").withIndex("by_user", q => q.eq("userId", vehicle.operatorId)).unique();
      if (!profile || !operator) return;
      if (!matchesRequirements({ ...job, required: job.requiredCapabilities }, profile, {
        ...vehicle,
        integrationApproved: physicalIntegrationAllowed(vehicle.integrationApproved, operator.role),
      })) return;
      if (job.destinations.some(point => metersBetween(vehicle.home, point) > vehicle.maxRadiusM)) return;
      seen.add(vehicle._id);
      nearby.push({ vehicleId: vehicle._id, name: vehicle.name, model: vehicle.model ?? null, operatorName: operator.displayName, environment: vehicle.environment, own, position: vehicle.home });
    }
    for (const vehicle of await ctx.db.query("vehicles").withIndex("by_operator", q => q.eq("operatorId", member.userId)).take(100)) await addVehicle(vehicle, true);
    for (const vehicle of await ctx.db.query("vehicles").withIndex("by_available", q => q.eq("available", true)).take(200)) await addVehicle(vehicle, vehicle.operatorId === member.userId);
    return nearby;
  },
});
export const eligible = query({ args: {}, handler: async ctx => {
  const { member, profile } = await requireOperator(ctx);
  const vehicles = await ctx.db.query("vehicles").withIndex("by_operator", q => q.eq("operatorId", member.userId)).take(100);
  const orders = await ctx.db.query("workOrders").withIndex("by_status", q => q.eq("status", "open")).order("asc").take(200);
  const sites = profileLaunchSites(profile);
  const idle = await ctx.db.query("vehicles").withIndex("by_available", q => q.eq("available", true)).take(200);
  return orders.flatMap(order => {
    const eligibleVehicles = vehicles.filter(vehicle => matchesRequirements({ ...order, required: order.requiredCapabilities }, profile, { ...vehicle, integrationApproved: physicalIntegrationAllowed(vehicle.integrationApproved, member.role) }));
    if (!eligibleVehicles.length) return [];
    const nearest = eligibleVehicles.reduce((best, vehicle) => {
      const home = resolvedVehicleHome(sites, vehicle);
      const bestHome = resolvedVehicleHome(sites, best);
      return metersBetween(home, order.location) < metersBetween(bestHome, order.location) ? vehicle : best;
    });
    const market = {
      openNearby: orders.filter(other => metersBetween(other.location, order.location) <= WAITING_FLEET_RADIUS_M).length,
      idleNearby: idle.filter(vehicle => !vehicle.activeOperationId && metersBetween(vehicle.home, order.location) <= WAITING_FLEET_RADIUS_M).length,
    };
    const quote = quoteWorkOrder(order, resolvedVehicleHome(sites, nearest), market);
    return [{ ...order, eligibleVehicleIds: eligibleVehicles.map(v => v._id), quote, market }];
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
  const home = resolvedVehicleHome(profileLaunchSites(profile), vehicle);
  if (vehicle.activeOperationId || order.status !== "open" || !matchesRequirements({ ...order, required: order.requiredCapabilities }, profile, { ...vehicle, integrationApproved: physicalIntegrationAllowed(vehicle.integrationApproved, member.role) })) throw new Error("This request no longer matches your availability or aircraft capabilities.");
  const manualCapability = args.manualControl === "remote" ? "manual_remote" : "manual_computer";
  if (!vehicle.capabilities.includes(manualCapability) || (args.mode === "autonomous" && !vehicle.capabilities.includes("autonomous"))) throw new Error("Aircraft does not support this control mode and takeover method.");
  if (order.kind === "flight_check" && metersBetween(home, order.location) > 10) throw new Error("A flight check must launch within 10 meters of the requested location.");
  const plan = createFlightPlan({ ...order, mode: args.mode, home, maxRadiusM: vehicle.maxRadiusM });
  const planHash = await hashSecret(serializeFlightPlan(plan));
  const quotedEarnings = quoteWorkOrder(order, home, await marketAround(ctx, order.location));
  const operationId = await ctx.db.insert("operations", { workOrderId: order._id, customerId: order.customerId, operatorId: member.userId, vehicleId: vehicle._id, state: "assigned", plan, planHash, controlOwner: "none", controlGeneration: vehicle.controlGeneration ?? 0, manualControl: args.manualControl, currentStep: 0, stepDwellMs: 0, progressSequence: -1, verifiedSteps: [], sawAirborne: false, taskOutcome: "pending", quotedEarnings });
  await ctx.db.patch(order._id, { status: "assigned", operationId, updatedAt: Date.now() });
  await ctx.db.patch(vehicle._id, { available: false, activeOperationId: operationId });
  await ctx.db.insert("operationEvents", { operationId, actor: String(member.userId), kind: "assigned", message: `${member.displayName} accepted the job. ${args.mode === "autonomous" ? "Autonomous" : "Manual"} plan created.`, timestamp: Date.now() });
  return operationId;
} });
export const cancel = mutation({ args: { workOrderId: v.id("workOrders") }, handler: async (ctx, { workOrderId }) => {
  const member = await requireCustomer(ctx);
  const order = await ctx.db.get(workOrderId);
  if (!order || order.customerId !== member.userId) throw new Error("Request not found.");
  if (order.status !== "open") throw new Error("An assigned operation must be resolved by the operator.");
  await ctx.db.patch(workOrderId, { status: "cancelled", updatedAt: Date.now() });
} });
export const remove = mutation({
  args: { workOrderId: v.id("workOrders") },
  returns: v.null(),
  handler: async (ctx, { workOrderId }) => {
    await requireOperator(ctx);
    await deleteWorkOrder(ctx, workOrderId);
    return null;
  },
});

async function deleteWorkOrder(ctx: MutationCtx, workOrderId: Id<"workOrders">) {
  const order = await ctx.db.get(workOrderId);
  if (!order) throw new Error("Request not found.");
  if (order.operationId) await deleteOperationRecords(ctx, order.operationId);
  await ctx.db.delete(workOrderId);
}

async function deleteOperationRecords(ctx: MutationCtx, operationId: Id<"operations">) {
  const operation = await ctx.db.get(operationId);
  if (!operation) return;
  for (const command of await ctx.db.query("controlCommands").withIndex("by_operation", q => q.eq("operationId", operationId)).take(200)) await ctx.db.delete(command._id);
  for (const event of await ctx.db.query("operationEvents").withIndex("by_operation", q => q.eq("operationId", operationId)).take(200)) await ctx.db.delete(event._id);
  const telemetry = await ctx.db.query("operationTelemetry").withIndex("by_operation", q => q.eq("operationId", operationId)).unique();
  if (telemetry) await ctx.db.delete(telemetry._id);
  const progress = await ctx.db.query("flightProgress").withIndex("by_operation", q => q.eq("operationId", operationId)).unique();
  if (progress) await ctx.db.delete(progress._id);
  const camera = await ctx.db.query("cameraSessions").withIndex("by_operation", q => q.eq("operationId", operationId)).unique();
  if (camera) await ctx.db.delete(camera._id);
  const vehicle = await ctx.db.get(operation.vehicleId);
  if (vehicle?.activeOperationId === operationId) await ctx.db.patch(vehicle._id, { available: true, activeOperationId: undefined });
  const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", operation.operatorId)).unique();
  if (profile?.activeOperationId === operationId) await ctx.db.patch(profile._id, { activeOperationId: undefined });
  await ctx.db.delete(operationId);
}
