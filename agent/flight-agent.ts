import { ConvexClient } from "convex/browser";
import { createHash, randomUUID } from "node:crypto";
import { api } from "../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { SimulatedDrone } from "./adapters/simulated-drone";
import { UnsupportedAircraftError, type CommandContext, type DroneAdapter } from "./drone-adapter";
import { MissionExecutor } from "./mission-executor";
import { executeAdapterCommand } from "./adapter-command";
import { validateAdapterPlan } from "./validate-plan";
import { setTimeout as delay } from "node:timers/promises";
import { serializeFlightPlan, type AircraftSample } from "../lib/operations";
import { startControlGateway } from "./control-gateway";

type Work = FunctionReturnType<typeof api.agentLink.work>;
export async function startFlightAgent(url: string, token: string) {
  const client = new ConvexClient(url);
  const config = await client.query(api.agentLink.configuration, { token });
  let adapter: DroneAdapter;
  if (config.environment === "simulated") adapter = new SimulatedDrone(config.hardwareId, config.home);
  else { await client.close(); throw new UnsupportedAircraftError(); }
  const identity = await adapter.connect();
  const instanceId = randomUUID();
  let sessionId = await client.mutation(api.agentLink.open, { token, instanceId, hardwareId: identity.hardwareId, environment: identity.environment, capabilities: identity.capabilities });
  const executor = new MissionExecutor(adapter);
  let latestSample: AircraftSample | null = null;
  let latestWork: Work | null = null;
  let activeExecution: AbortController | null = null;
  let activeGeneration = -1;
  let publishing = false, renewing = false, processing = false, reconnecting = false, shuttingDown = false;
  let lastBackendContact = Date.now();
  let linkLost = false;
  let observedSequence = -1;
  let cameraPublishedFor = "", cameraExpiresAt = 0, cameraPublishing = false;
  const receivedCommands = new Set<string>();
  const sampleSubscription = adapter.onTelemetry(sample => { latestSample = sample; });
  const sessionArgs = () => ({ token, sessionId });
  const contact = () => { lastBackendContact = Date.now(); };
  async function failLocally(reason: string) {
    activeExecution?.abort(); activeExecution = null;
    await adapter.handleLinkLoss(reason);
    const operationId = latestWork?.operation?._id;
    if (operationId) await client.mutation(api.agentLink.reportFailure, { ...sessionArgs(), operationId, reason }).catch(() => undefined);
  }
  function subscribe() {
    return client.onUpdate(api.agentLink.work, sessionArgs(), work => { latestWork = work; contact(); void processWork(); }, error => {
      console.error("Agent subscription requires reconciliation:", error instanceof Error ? error.message : "connection error");
      void reconnect();
    });
  }
  let unsubscribe = subscribe();
  async function reconnect() {
    if (reconnecting || shuttingDown) return;
    reconnecting = true;
    try {
      await failLocally("Backend connection lost; local failsafe engaged.");
      unsubscribe();
      sessionId = await client.mutation(api.agentLink.open, { token, instanceId, hardwareId: identity.hardwareId, environment: identity.environment, capabilities: identity.capabilities });
      observedSequence = -1;
      latestWork = null;
      unsubscribe = subscribe();
      contact();
    } catch (error) { console.error("Agent reconnect pending:", error instanceof Error ? error.message : "connection error"); }
    finally { reconnecting = false; }
  }
  async function processWork() {
    if (processing || shuttingDown || !latestWork) return;
    processing = true;
    try {
      const work = latestWork;
      if (activeExecution && work.operation?.controlGeneration !== activeGeneration) {
        activeExecution.abort(); activeExecution = null;
        const controller = new AbortController();
        await executeAdapterCommand({ commandId: `fence-${randomUUID()}`, generation: work.operation?.controlGeneration ?? activeGeneration, expiresAt: Date.now() + 1000, signal: controller.signal }, command => adapter.stop(command));
      }
      if (!work.operation) return;
      if (work.operation.loadedSessionId !== sessionId) {
        if (["assigned", "ready"].includes(work.operation.state)) {
          try {
            validateAdapterPlan(work.operation.plan, identity, adapter);
            if (createHash("sha256").update(serializeFlightPlan(work.operation.plan)).digest("hex") !== work.operation.planHash) throw new Error("Flight plan integrity check failed.");
          } catch (error) {
            await failLocally(error instanceof Error ? error.message : "Invalid flight plan.");
            return;
          }
        }
        await client.mutation(api.agentLink.prepared, { ...sessionArgs(), operationId: work.operation._id, planHash: work.operation.planHash });
        contact();
        return;
      }
      for (const command of work.commands) {
        if (receivedCommands.has(command._id)) continue;
        const claimed = await client.mutation(api.agentLink.claim, { ...sessionArgs(), commandId: command._id });
        contact();
        if (!claimed) { receivedCommands.add(command._id); continue; }
        receivedCommands.add(command._id);
        activeExecution?.abort(); activeExecution = null;
        const controller = new AbortController();
        const context: CommandContext = { commandId: command._id, generation: claimed.generation, expiresAt: claimed.expiresAt, signal: controller.signal };
        try {
          const owner = claimed.kind === "takeover" || (claimed.kind === "start" && claimed.plan.mode === "manual") ? claimed.manualControl : "autonomy";
          const ownershipRequestedAt = Date.now();
          await executeAdapterCommand({ ...context, commandId: `${command._id}:owner` }, command => adapter.transferControl(owner, command));
          while (!latestSample || !latestSample.connected || latestSample.controlOwner !== owner || latestSample.capturedAt < ownershipRequestedAt) {
            if (Date.now() >= context.expiresAt || controller.signal.aborted) throw new Error("Aircraft did not confirm control ownership before the deadline.");
            await delay(50, undefined, { signal: controller.signal });
          }
          await client.mutation(api.agentLink.publish, { ...sessionArgs(), sample: latestSample });
          if (claimed.kind === "land") await executeAdapterCommand(context, command => adapter.land(command));
          else if (claimed.kind === "hold") await executeAdapterCommand(context, command => adapter.stop(command));
          else if (claimed.kind === "return") {
            if (!adapter.goTo) throw new Error("Adapter does not support return navigation.");
            const sample = await adapter.getTelemetry();
            await executeAdapterCommand(context, command => adapter.goTo!(claimed.plan.home, Math.max(2, sample.altitudeM ?? 2), command));
          }
          await client.mutation(api.agentLink.acknowledge, { ...sessionArgs(), commandId: command._id, accepted: true, owner });
          contact();
          if (claimed.kind === "start" && claimed.plan.mode === "autonomous") {
            activeExecution = controller;
            activeGeneration = claimed.generation;
            void executor.run(claimed.plan, command._id, claimed.generation, controller.signal).catch(error => {
              if (!controller.signal.aborted) void failLocally(error instanceof Error ? error.message : "Flight execution failed.");
            }).finally(() => { if (activeExecution === controller) activeExecution = null; });
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Aircraft command failed.";
          await client.mutation(api.agentLink.acknowledge, { ...sessionArgs(), commandId: command._id, accepted: false, owner: "none", reason }).catch(() => undefined);
          await failLocally(reason);
        }
      }
    } catch (error) {
      // Readiness can change while a plan is being prepared; the processing interval retries it.
      if (latestWork?.operation?.state !== "assigned") console.error("Agent work:", error instanceof Error ? error.message : "work error");
    } finally { processing = false; }
  }
  const publishTimer = setInterval(() => {
    if (publishing || !latestSample || latestSample.sequence === observedSequence || shuttingDown) return;
    publishing = true;
    const sample = latestSample;
    void client.mutation(api.agentLink.publish, { ...sessionArgs(), sample }).then(() => { observedSequence = sample.sequence; contact(); }).catch(() => undefined).finally(() => { publishing = false; });
  }, 100);
  const heartbeatTimer = setInterval(() => {
    if (renewing || shuttingDown) return;
    renewing = true;
    void client.mutation(api.agentLink.renew, sessionArgs()).then(contact).catch(() => reconnect()).finally(() => { renewing = false; });
  }, 2000);
  const workTimer = setInterval(() => { void processWork(); }, 250);
  const cameraTimer = setInterval(() => {
    const operationId = latestWork?.operation?._id;
    if (!operationId || !adapter.openCameraStream || !identity.capabilities.includes("camera") || cameraPublishing || shuttingDown || (cameraPublishedFor === operationId && cameraExpiresAt > Date.now() + 30000)) return;
    cameraPublishing = true;
    void adapter.openCameraStream().then(async stream => {
      await client.mutation(api.cameras.publish, { ...sessionArgs(), operationId, ...stream });
      cameraPublishedFor = operationId; cameraExpiresAt = stream.expiresAt;
    }).catch(() => console.error("Camera stream is unavailable.")).finally(() => { cameraPublishing = false; });
  }, 5000);
  const watchdogTimer = setInterval(() => {
    if (!linkLost && Date.now() - lastBackendContact > 3000) { linkLost = true; void failLocally("Cloud link lost; local failsafe engaged."); }
  }, 100);
  const gateway = await startControlGateway({
    adapter, port: Number(process.env.ZIP_CONTROL_PORT ?? "8765"), allowedOrigin: process.env.ZIP_ALLOWED_ORIGIN ?? "http://127.0.0.1:3000",
    redeem: ticket => client.mutation(api.manualControl.redeem, { ...sessionArgs(), ticket }),
    owns: grant => !shuttingDown && Date.now() - lastBackendContact < 3000 && latestWork?.operation?._id === grant.operationId && latestWork.operation.controlGeneration === grant.generation && latestWork.operation.controlOwner === "computer" && latestWork.operation.state === "manual",
    ...(process.env.ZIP_CONTROL_TLS_CERT && process.env.ZIP_CONTROL_TLS_KEY ? { tls: { certificatePath: process.env.ZIP_CONTROL_TLS_CERT, keyPath: process.env.ZIP_CONTROL_TLS_KEY } } : {}),
  });
  console.log(`${identity.model} connected as ${identity.hardwareId}. Environment: ${identity.environment}. Telemetry: 20 Hz source / up to 10 Hz publication.`);
  return {
    adapter,
    getSessionId: (): Id<"agentSessions"> => sessionId,
    async shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      activeExecution?.abort();
      const telemetry = await adapter.getTelemetry();
      if (telemetry.airborne || telemetry.armed) {
        shuttingDown = false;
        await failLocally("Agent shutdown requested during flight; verify landing before closing.");
        console.error("Agent remains online until aircraft is grounded and disarmed. Retry shutdown after landing.");
        return;
      }
      for (const timer of [publishTimer, heartbeatTimer, workTimer, watchdogTimer, cameraTimer]) clearInterval(timer);
      await gateway.close();
      sampleSubscription(); unsubscribe();
      await adapter.disconnect();
      await client.close();
    },
  };
}
