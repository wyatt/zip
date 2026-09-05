import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { operationsTables } from "./operationsSchema";

export const point = v.object({ x: v.number(), y: v.number() });
export const taskType = v.union(v.literal("deliver"), v.literal("search"), v.literal("inspection"));
export const task = v.union(v.object({ type: v.literal("deliver"), pickup: point, dropoff: point }), v.object({ type: v.union(v.literal("search"), v.literal("inspection")), region: v.object({ northWest: point, southEast: point }) }));
export const state = v.union(...["submitted", "assigned", "ready", "running", "returning", "landed", "completed"].map(v.literal));
export const snapshot = { position: point, altitude: v.number(), battery: v.number(), elapsed: v.number(), sequence: v.number(), step: v.number(), state: v.union(v.literal("running"), v.literal("returning"), v.literal("landed")) };
export default defineSchema({
  ...authTables,
  ...operationsTables,
  jobs: defineTable({ requester: v.string(), description: v.string(), location: point, task: v.optional(task), status: state, updatedAt: v.number() }),
  drones: defineTable({ identity: v.string(), name: v.string(), simulated: v.literal(true), capabilities: v.array(v.string()), available: v.boolean(), heartbeatAt: v.number() }).index("by_identity", ["identity"]),
  missions: defineTable({ jobId: v.id("jobs"), droneId: v.id("drones"), mode: v.literal("supervised"), planVersion: v.literal(1), taskType: v.optional(taskType), route: v.array(point), steps: v.array(v.object({ name: v.string(), status: v.union(v.literal("pending"), v.literal("active"), v.literal("completed")) })), state, agentReady: v.boolean(), startedAt: v.optional(v.number()), completedAt: v.optional(v.number()), error: v.optional(v.string()) }).index("by_job", ["jobId"]).index("by_drone", ["droneId"]),
  commands: defineTable({ missionId: v.id("missions"), type: v.literal("start"), status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("completed"), v.literal("failed")), acceptedAt: v.optional(v.number()), completedAt: v.optional(v.number()), error: v.optional(v.string()) }).index("by_mission", ["missionId"]),
  telemetry: defineTable({ missionId: v.id("missions"), ...snapshot, timestamp: v.number(), simulated: v.literal(true) }).index("by_mission", ["missionId"]),
  events: defineTable({ missionId: v.id("missions"), message: v.string(), timestamp: v.number() }).index("by_mission", ["missionId"]),
});
