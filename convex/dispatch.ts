import { v } from "convex/values";
// Legacy simulator functions are deployment-internal. Production clients use authenticated modules.
import { internalMutation as mutation, internalQuery as query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { point, snapshot, task } from "./schema";
import { planRoute, STEP_NAMES } from "../lib/flight";
import { taskRoute, taskSteps, validateTask } from "../lib/tasks";

const identity = "iris-sim-01";
async function event(ctx: MutationCtx, missionId: Id<"missions">, message: string) {
  await ctx.db.insert("events", { missionId, message, timestamp: Date.now() });
}
export const board = query({ args: {}, handler: async (ctx) => ({ jobs: await ctx.db.query("jobs").order("desc").collect(), drone: await ctx.db.query("drones").withIndex("by_identity", q => q.eq("identity", identity)).unique() }) });
export const details = query({ args: { jobId: v.id("jobs") }, handler: async (ctx, { jobId }) => {
  const job = await ctx.db.get(jobId);
  const mission = await ctx.db.query("missions").withIndex("by_job", q => q.eq("jobId", jobId)).unique();
  if (!mission) return { job, mission: null, telemetry: null, command: null, events: [] };
  const [telemetry, command, events] = await Promise.all([
    ctx.db.query("telemetry").withIndex("by_mission", q => q.eq("missionId", mission._id)).unique(),
    ctx.db.query("commands").withIndex("by_mission", q => q.eq("missionId", mission._id)).unique(),
    ctx.db.query("events").withIndex("by_mission", q => q.eq("missionId", mission._id)).collect(),
  ]);
  return { job, mission, telemetry, command, events };
} });
export const submit = mutation({ args: { requester: v.string(), description: v.string(), location: point, task: v.optional(task) }, handler: async (ctx, args) => {
  const requester = args.requester.trim(), description = args.description.trim();
  if (!requester || requester.length > 80 || !description || description.length > 500) throw new Error("Enter your name and a job description.");
  if (args.task) validateTask(args.task);
  else if (!Number.isFinite(args.location.x) || !Number.isFinite(args.location.y) || args.location.x < 180 || args.location.x > 540 || args.location.y < 60 || args.location.y > 300) throw new Error("Choose a point inside the demo area.");
  const location = args.task ? args.task.type === "deliver" ? args.task.dropoff : args.task.region.northWest : args.location;
  return ctx.db.insert("jobs", { requester, description, location, ...(args.task ? { task: args.task } : {}), status: "submitted", updatedAt: Date.now() });
} });
export const seed = mutation({ args: {}, handler: async ctx => {
  const drone = await ctx.db.query("drones").withIndex("by_identity", q => q.eq("identity", identity)).unique();
  return drone?._id ?? ctx.db.insert("drones", { identity, name: "iris simulator 01", simulated: true, capabilities: ["generic job", "supervised autonomy"], available: true, heartbeatAt: 0 });
} });
export const accept = mutation({ args: { jobId: v.id("jobs"), mode: v.literal("supervised") }, handler: async (ctx, { jobId, mode }) => {
  const existing = await ctx.db.query("missions").withIndex("by_job", q => q.eq("jobId", jobId)).unique();
  if (existing) return existing._id;
  const job = await ctx.db.get(jobId);
  const drone = await ctx.db.query("drones").withIndex("by_identity", q => q.eq("identity", identity)).unique();
  if (!job || job.status !== "submitted") throw new Error("This job is not awaiting acceptance.");
  if (!drone?.available) throw new Error("The simulator is busy or has not been seeded. Start the local agent.");
  const missionId = await ctx.db.insert("missions", { jobId, droneId: drone._id, mode, planVersion: 1, ...(job.task ? { taskType: job.task.type } : {}), route: job.task ? taskRoute(job.task) : planRoute(job.location), steps: (job.task ? taskSteps(job.task.type) : STEP_NAMES).map(name => ({ name, status: "pending" as const })), state: "assigned", agentReady: false });
  await ctx.db.patch(drone._id, { available: false });
  await ctx.db.patch(jobId, { status: "assigned", updatedAt: Date.now() });
  await event(ctx, missionId, "Job accepted · supervised autonomy · plan v1");
  return missionId;
} });
export const heartbeat = mutation({ args: { droneId: v.id("drones") }, handler: async (ctx, { droneId }) => {
  await ctx.db.patch(droneId, { heartbeatAt: Date.now() });
} });
export const agentWork = query({ args: { droneId: v.id("drones") }, handler: async (ctx, { droneId }) => {
  const missions = await ctx.db.query("missions").withIndex("by_drone", q => q.eq("droneId", droneId)).order("desc").collect();
  const mission = missions.find(m => m.state !== "completed");
  if (!mission) return null;
  const command = await ctx.db.query("commands").withIndex("by_mission", q => q.eq("missionId", mission._id)).unique();
  return { mission, command };
} });
export const ready = mutation({ args: { missionId: v.id("missions") }, handler: async (ctx, { missionId }) => {
  const mission = await ctx.db.get(missionId);
  if (!mission || mission.state !== "assigned") return;
  await ctx.db.patch(missionId, { agentReady: true, state: "ready" });
  await ctx.db.patch(mission.jobId, { status: "ready", updatedAt: Date.now() });
  await event(ctx, missionId, "Local simulated flight agent ready");
} });
export const start = mutation({ args: { missionId: v.id("missions") }, handler: async (ctx, { missionId }) => {
  const existing = await ctx.db.query("commands").withIndex("by_mission", q => q.eq("missionId", missionId)).unique();
  if (existing) return existing._id;
  const mission = await ctx.db.get(missionId);
  const drone = mission && await ctx.db.get(mission.droneId);
  if (!mission?.agentReady || mission.state !== "ready" || !drone || Date.now() - drone.heartbeatAt > 15000) throw new Error("Wait for the local simulated agent to be ready.");
  const commandId = await ctx.db.insert("commands", { missionId, type: "start", status: "pending" });
  await event(ctx, missionId, "Start requested");
  return commandId;
} });
export const acceptCommand = mutation({ args: { commandId: v.id("commands") }, handler: async (ctx, { commandId }) => {
  const command = await ctx.db.get(commandId);
  if (!command || command.status !== "pending") return false;
  const mission = await ctx.db.get(command.missionId);
  if (!mission || mission.state !== "ready") throw new Error("Mission is not ready.");
  await ctx.db.patch(commandId, { status: "accepted", acceptedAt: Date.now() });
  await ctx.db.patch(mission._id, { state: "running", startedAt: Date.now() });
  await ctx.db.patch(mission.jobId, { status: "running", updatedAt: Date.now() });
  await event(ctx, mission._id, "Start accepted · simulated flight running");
  return true;
} });
export const publish = mutation({ args: { commandId: v.id("commands"), snapshot: v.object(snapshot) }, handler: async (ctx, { commandId, snapshot: data }) => {
  const command = await ctx.db.get(commandId);
  if (!command || command.status !== "accepted") throw new Error("Command is not running.");
  const mission = await ctx.db.get(command.missionId);
  if (!mission) throw new Error("Mission missing.");
  const previous = await ctx.db.query("telemetry").withIndex("by_mission", q => q.eq("missionId", mission._id)).unique();
  if (previous && data.sequence <= previous.sequence) return;
  if (data.elapsed < 0 || data.elapsed > 20 || data.altitude < 0 || data.battery < 0 || data.battery > 100 || data.step < 0 || data.step > 4 || !Number.isInteger(data.step)) throw new Error("Invalid telemetry.");
  if (previous && (data.elapsed < previous.elapsed || data.battery > previous.battery || data.step < previous.step)) throw new Error("Telemetry must advance monotonically.");
  if (data.state === "landed" && (data.elapsed !== 20 || data.altitude !== 0 || data.step !== 4 || data.position.x !== mission.route[0].x || data.position.y !== mission.route[0].y)) throw new Error("Landing requires ground altitude at launch after 20 seconds.");
  const record = { missionId: mission._id, ...data, simulated: true as const, timestamp: Date.now() };
  if (previous) await ctx.db.patch(previous._id, record); else await ctx.db.insert("telemetry", record);
  const steps = mission.steps.map((step, i) => ({ name: step.name, status: data.state === "landed" || i < data.step ? "completed" as const : i === data.step ? "active" as const : "pending" as const }));
  await ctx.db.patch(mission._id, { state: data.state, steps });
  await ctx.db.patch(mission.jobId, { status: data.state, updatedAt: Date.now() });
  if (!previous || previous.step !== data.step) await event(ctx, mission._id, mission.steps[data.step].name);
  if (data.state === "landed" && previous?.state !== "landed") await event(ctx, mission._id, "Landed at launch · altitude 0 m");
} });
export const complete = mutation({ args: { commandId: v.id("commands") }, handler: async (ctx, { commandId }) => {
  const command = await ctx.db.get(commandId);
  if (command?.status === "completed") return;
  if (!command || command.status !== "accepted") throw new Error("Command is not running.");
  const mission = await ctx.db.get(command.missionId);
  const telemetry = await ctx.db.query("telemetry").withIndex("by_mission", q => q.eq("missionId", command.missionId)).unique();
  if (!mission || mission.state !== "landed" || telemetry?.altitude !== 0 || !mission.steps.every(s => s.status === "completed")) throw new Error("Mission cannot complete before landing.");
  await ctx.db.patch(commandId, { status: "completed", completedAt: Date.now() });
  await ctx.db.patch(mission._id, { state: "completed", completedAt: Date.now() });
  await ctx.db.patch(mission.jobId, { status: "completed", updatedAt: Date.now() });
  await ctx.db.patch(mission.droneId, { available: true });
  await event(ctx, mission._id, "Mission completed");
} });
export const fail = mutation({ args: { commandId: v.id("commands"), error: v.string() }, handler: async (ctx, { commandId, error }) => {
  const command = await ctx.db.get(commandId);
  if (!command || command.status !== "accepted") return;
  await ctx.db.patch(commandId, { status: "failed", error });
  await ctx.db.patch(command.missionId, { error });
  await event(ctx, command.missionId, `Agent error: ${error}`);
} });
