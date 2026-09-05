import { defineTable } from "convex/server";
import { v } from "convex/values";

export const geo = v.object({ lat: v.number(), lon: v.number() });
export const surveyArea = v.object({ northWest: geo, southEast: geo });
export const environment = v.union(v.literal("simulated"), v.literal("aircraft"));
export const jobKind = v.union(v.literal("flight_check"), v.literal("search"), v.literal("inspection"), v.literal("deliver"));
export const capability = v.union(...(["takeoff", "hover", "land", "position", "autonomous", "manual_remote", "manual_computer", "camera", "payload"] as const).map(v.literal));
export const controlMode = v.union(v.literal("autonomous"), v.literal("manual"));
export const controlOwner = v.union(v.literal("none"), v.literal("autonomy"), v.literal("remote"), v.literal("computer"));
export const operationState = v.union(...(["assigned", "ready", "starting", "active", "taking_over", "manual", "returning", "landing", "completed", "cancelled", "attention"] as const).map(v.literal));
export const commandKind = v.union(...(["start", "takeover", "hold", "return", "land"] as const).map(v.literal));
export const planStep = v.object({ kind: v.union(v.literal("takeoff"), v.literal("waypoint"), v.literal("hover"), v.literal("land")), label: v.string(), position: geo, altitudeM: v.number(), durationSec: v.number() });
export const flightPlan = v.object({ version: v.number(), home: geo, mode: controlMode, steps: v.array(planStep), cruiseSpeedMps: v.number(), maxAltitudeM: v.number(), radiusM: v.number(), maxDurationSec: v.number(), minimumBatteryPct: v.number() });
const measurement = v.union(v.number(), v.null());
const boolMeasurement = v.union(v.boolean(), v.null());
export const aircraftSample = v.object({
  sequence: v.number(), capturedAt: v.number(), position: v.union(geo, v.null()), altitudeM: measurement,
  batteryPct: measurement, headingDeg: measurement, speedMps: measurement, connected: v.boolean(),
  armed: boolMeasurement, airborne: boolMeasurement, navigationHealthy: v.boolean(), controlOwner,
  flightMode: v.string(), faults: v.array(v.string()),
});

/** Additive tables preserve legacy demo data without assigning anonymous jobs to real users. */
export const operationsTables = {
  members: defineTable({ userId: v.id("users"), displayName: v.string(), role: v.union(v.literal("customer"), v.literal("operator"), v.literal("admin")) }).index("by_user", ["userId"]),
  operatorProfiles: defineTable({ userId: v.id("users"), approved: v.boolean(), acceptingJobs: v.boolean(), qualifications: v.array(jobKind), base: geo, serviceRadiusM: v.number(), activeOperationId: v.optional(v.id("operations")) }).index("by_user", ["userId"]),
  operatorInvites: defineTable({ tokenHash: v.string(), email: v.string(), expiresAt: v.number(), createdBy: v.id("users"), redeemedBy: v.optional(v.id("users")) }).index("by_hash", ["tokenHash"]),
  vehicles: defineTable({ operatorId: v.id("users"), name: v.string(), model: v.optional(v.string()), hardwareId: v.string(), environment, capabilities: v.array(capability), maxPayloadKg: v.number(), home: geo, maxRadiusM: v.number(), available: v.boolean(), integrationApproved: v.boolean(), controlGeneration: v.optional(v.number()), activeOperationId: v.optional(v.id("operations")), activeSessionId: v.optional(v.id("agentSessions")) }).index("by_operator", ["operatorId"]),
  agentCredentials: defineTable({ vehicleId: v.id("vehicles"), tokenHash: v.string(), createdAt: v.number(), expiresAt: v.number(), revokedAt: v.optional(v.number()) }).index("by_hash", ["tokenHash"]).index("by_vehicle", ["vehicleId"]),
  agentSessions: defineTable({ vehicleId: v.id("vehicles"), credentialId: v.id("agentCredentials"), instanceId: v.string(), leaseUntil: v.number(), lastSeenAt: v.number(), hardwareId: v.string(), retired: v.boolean() }).index("by_vehicle", ["vehicleId"]),
  workOrders: defineTable({ customerId: v.id("users"), title: v.string(), description: v.string(), kind: jobKind, environment, location: geo, area: v.optional(surveyArea), destinations: v.array(geo), requiredCapabilities: v.array(capability), payloadKg: v.number(), altitudeM: v.number(), hoverSec: v.number(), status: v.union(v.literal("open"), v.literal("assigned"), v.literal("completed"), v.literal("cancelled")), operationId: v.optional(v.id("operations")), updatedAt: v.number() }).index("by_customer", ["customerId"]).index("by_status", ["status"]),
  operations: defineTable({ workOrderId: v.id("workOrders"), customerId: v.id("users"), operatorId: v.id("users"), vehicleId: v.id("vehicles"), state: operationState, plan: flightPlan, planHash: v.string(), controlOwner, controlGeneration: v.number(), manualControl: v.union(v.literal("remote"), v.literal("computer")), currentStep: v.number(), stepEnteredAt: v.optional(v.number()), stepDwellMs: v.number(), progressSequence: v.number(), progressCapturedAt: v.optional(v.number()), verifiedSteps: v.array(v.number()), sawAirborne: v.boolean(), taskOutcome: v.union(v.literal("pending"), v.literal("succeeded"), v.literal("unverified")), loadedSessionId: v.optional(v.id("agentSessions")), startedAt: v.optional(v.number()), completedAt: v.optional(v.number()), attention: v.optional(v.string()) }).index("by_customer", ["customerId"]).index("by_operator", ["operatorId"]).index("by_vehicle", ["vehicleId"]).index("by_state", ["state"]),
  controlCommands: defineTable({ operationId: v.id("operations"), vehicleId: v.id("vehicles"), requestedBy: v.id("users"), kind: commandKind, idempotencyKey: v.string(), generation: v.number(), status: v.union(...(["pending", "claimed", "acknowledged", "completed", "rejected", "expired", "uncertain"] as const).map(v.literal)), createdAt: v.number(), expiresAt: v.number(), claimedSessionId: v.optional(v.id("agentSessions")), acknowledgedAt: v.optional(v.number()), completedAt: v.optional(v.number()), reason: v.optional(v.string()) }).index("by_operation", ["operationId"]).index("by_vehicle_status", ["vehicleId", "status"]).index("by_key", ["operationId", "idempotencyKey"]),
  vehicleTelemetry: defineTable({ vehicleId: v.id("vehicles"), sessionId: v.id("agentSessions"), environment, receivedAt: v.number(), sample: aircraftSample }).index("by_vehicle", ["vehicleId"]),
  operationTelemetry: defineTable({ operationId: v.id("operations"), vehicleId: v.id("vehicles"), sessionId: v.id("agentSessions"), environment, receivedAt: v.number(), sample: aircraftSample }).index("by_operation", ["operationId"]),
  flightProgress: defineTable({ operationId: v.id("operations"), stepIndex: v.number(), dwellMs: v.number(), capturedAt: v.number(), sequence: v.number(), wasSatisfied: v.boolean(), sawAirborne: v.boolean() }).index("by_operation", ["operationId"]),
  operationEvents: defineTable({ operationId: v.id("operations"), actor: v.string(), kind: v.string(), message: v.string(), timestamp: v.number(), commandId: v.optional(v.id("controlCommands")) }).index("by_operation", ["operationId"]),
  cameraSessions: defineTable({ operationId: v.id("operations"), vehicleId: v.id("vehicles"), sessionId: v.id("agentSessions"), protocol: v.union(v.literal("hls"), v.literal("whep")), url: v.string(), expiresAt: v.number() }).index("by_operation", ["operationId"]),
  manualTickets: defineTable({ operationId: v.id("operations"), vehicleId: v.id("vehicles"), sessionId: v.id("agentSessions"), operatorId: v.id("users"), generation: v.number(), tokenHash: v.string(), expiresAt: v.number(), consumedAt: v.optional(v.number()) }).index("by_hash", ["tokenHash"]),
};
