import { ConvexClient } from "convex/browser";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { api } from "../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { DemoDrone } from "./adapters/demo-drone";
import { startDemoHttp } from "./demo-http";
import type { CommandContext, DroneAdapter } from "./drone-adapter";
import { MissionExecutor } from "./mission-executor";
import { executeAdapterCommand } from "./adapter-command";
import { validateAdapterPlan } from "./validate-plan";
import { setTimeout as delay } from "node:timers/promises";
import { serializeFlightPlan, type AircraftSample } from "../lib/operations";
import { startControlGateway, type ControlGrant } from "./control-gateway";

type FleetVehicle = FunctionReturnType<typeof api.agentLink.fleet>[number];
type Work = FunctionReturnType<typeof api.agentLink.work>;
type VehicleHandle = {
  adapter: DroneAdapter;
  getSessionId: () => Id<"agentSessions">;
  owns: (grant: ControlGrant) => boolean;
  shutdown: () => Promise<boolean>;
};

async function connectVehicle(client: ConvexClient, token: string, instanceId: string, config: FleetVehicle, isShuttingDown: () => boolean, demo: { port: number; register: (adapter: DemoDrone) => void }): Promise<VehicleHandle> {
  const adapter = new DemoDrone(config.hardwareId, config.home, `http://127.0.0.1:${demo.port}/terrain/`, {
    environment: config.environment,
    capabilities: config.capabilities,
    model: config.name,
    batteryPct: config.batteryPct,
  });
  demo.register(adapter);
  const identity = await adapter.connect();
  const openArgs = () => ({ token, vehicleId: config.vehicleId, instanceId, hardwareId: identity.hardwareId, environment: identity.environment, capabilities: identity.capabilities });
  let sessionId = await client.mutation(api.agentLink.open, openArgs());
  const executor = new MissionExecutor(adapter);
  let latestSample: AircraftSample | null = null;
  let latestWork: Work | null = null;
  let activeExecution: AbortController | null = null;
  let activeGeneration = -1;
  let renewing = false, processing = false, reconnecting = false, shuttingDown = false;
  let lastBackendContact = Date.now();
  let linkLost = false;
  let observedSequence = -1;
  let cameraPublishedFor = "", cameraExpiresAt = 0, cameraPublishing = false, cameraFrameHash = "";
  let preparedRetryAt = 0;
  let lastPreparedError = "";
  let clockOffset = 0;
  const receivedCommands = new Set<string>();
  const sampleSubscription = adapter.onTelemetry(sample => { latestSample = sample; });
  latestSample = await adapter.getTelemetry();
  const sessionArgs = () => ({ token, sessionId });
  const contact = () => { lastBackendContact = Date.now(); };
  let publishChain = Promise.resolve();
  let publishQueued = false;
  function enqueuePublish(sample?: AircraftSample) {
    if (sample && sample.sequence > (latestSample?.sequence ?? -1)) latestSample = sample;
    if (publishQueued || shuttingDown || isShuttingDown()) return publishChain;
    publishQueued = true;
    publishChain = publishChain.then(async () => {
      publishQueued = false;
      const current = latestSample;
      if (!current || current.sequence <= observedSequence || shuttingDown || isShuttingDown()) return;
      try {
        await client.mutation(api.agentLink.publish, { ...sessionArgs(), sample: { ...current, capturedAt: current.capturedAt + clockOffset } });
        observedSequence = current.sequence;
        contact();
      } catch (error) {
        console.error(`${identity.hardwareId} publish:`, error instanceof Error ? error.message : "publish failed");
      }
    });
    return publishChain;
  }
  async function flushPublish(sample?: AircraftSample) {
    if (sample && sample.sequence > (latestSample?.sequence ?? -1)) latestSample = sample;
    await publishChain;
    if (!latestSample || latestSample.sequence <= observedSequence || shuttingDown || isShuttingDown()) return;
    await enqueuePublish(latestSample);
  }
  await enqueuePublish(latestSample);
  async function failLocally(reason: string) {
    activeExecution?.abort(); activeExecution = null;
    await adapter.handleLinkLoss(reason);
    const operationId = latestWork?.operation?._id;
    if (operationId) await client.mutation(api.agentLink.reportFailure, { ...sessionArgs(), operationId, reason }).catch(() => undefined);
  }
  function subscribe() {
    return client.onUpdate(api.agentLink.work, sessionArgs(), work => { latestWork = work; contact(); void processWork(); }, error => {
      console.error(`${identity.hardwareId} subscription requires reconciliation:`, error instanceof Error ? error.message : "connection error");
      void reconnect();
    });
  }
  let unsubscribe = subscribe();
  async function reconnect() {
    if (reconnecting || shuttingDown || isShuttingDown()) return;
    reconnecting = true;
    try {
      await failLocally("Backend connection lost; local failsafe engaged.");
      unsubscribe();
      sessionId = await client.mutation(api.agentLink.open, openArgs());
      observedSequence = -1;
      latestWork = null;
      latestSample = await adapter.getTelemetry();
      await enqueuePublish(latestSample);
      unsubscribe = subscribe();
      contact();
    } catch (error) { console.error(`${identity.hardwareId} reconnect pending:`, error instanceof Error ? error.message : "connection error"); }
    finally { reconnecting = false; }
  }
  async function processWork() {
    if (processing || shuttingDown || isShuttingDown() || !latestWork) return;
    processing = true;
    try {
      const work = latestWork;
      adapter.setJob?.(work.job ?? null);
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
        if (Date.now() < preparedRetryAt) return;
        if (observedSequence < 0 || !latestSample || Date.now() - latestSample.capturedAt > 1500) {
          await enqueuePublish(latestSample ?? await adapter.getTelemetry());
          return;
        }
        try {
          await client.mutation(api.agentLink.prepared, { ...sessionArgs(), operationId: work.operation._id, planHash: work.operation.planHash });
          lastPreparedError = "";
          contact();
        } catch (error) {
          preparedRetryAt = Date.now() + 750;
          const message = error instanceof Error ? error.message : "prepare failed";
          if (message !== lastPreparedError) {
            lastPreparedError = message;
            console.error(`${identity.hardwareId} prepare:`, message);
          }
        }
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
          await flushPublish(latestSample);
          if (claimed.kind === "land") await executeAdapterCommand(context, command => adapter.land(command));
          else if (claimed.kind === "hold") await executeAdapterCommand(context, command => adapter.stop(command));
          else if (claimed.kind === "return") {
            if (!adapter.goTo) throw new Error("Adapter does not support return navigation.");
            const sample = await adapter.getTelemetry();
            await executeAdapterCommand(context, command => adapter.goTo!(claimed.plan.home, Math.max(2, sample.altitudeM ?? 2), command));
          }
          await flushPublish(latestSample);
          if (!latestSample || latestSample.controlOwner !== owner) throw new Error("Aircraft has not confirmed the requested control owner.");
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
      if (latestWork?.operation?.state !== "assigned") console.error(`${identity.hardwareId} work:`, error instanceof Error ? error.message : "work error");
    } finally { processing = false; }
  }
  const publishTimer = setInterval(() => {
    if (!latestSample || latestSample.sequence <= observedSequence || shuttingDown || isShuttingDown()) return;
    void enqueuePublish(latestSample);
  }, 100);
  const heartbeatTimer = setInterval(() => {
    if (renewing || shuttingDown || isShuttingDown()) return;
    renewing = true;
    void client.mutation(api.agentLink.renew, sessionArgs()).then(result => {
      clockOffset = result.serverTime - Date.now();
      contact();
    }).catch(() => reconnect()).finally(() => { renewing = false; });
  }, 2000);
  const workTimer = setInterval(() => { void processWork(); }, 250);
  const cameraTimer = setInterval(() => {
    const operationId = latestWork?.operation?._id;
    if (!operationId || !identity.capabilities.includes("camera") || cameraPublishing || shuttingDown || isShuttingDown()) return;
    const jpeg = adapter.latestJpeg?.() ?? null;
    if (jpeg) {
      const hash = createHash("sha256").update(jpeg).digest("hex");
      if (cameraPublishedFor === operationId && cameraFrameHash === hash && cameraExpiresAt > Date.now() + 30000) return;
      cameraPublishing = true;
      void (async () => {
        const uploadUrl = await client.mutation(api.cameras.uploadUrl, sessionArgs());
        const uploaded = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(jpeg) });
        if (!uploaded.ok) throw new Error("Camera frame upload failed.");
        const payload = await uploaded.json() as { storageId?: Id<"_storage"> };
        if (!payload.storageId) throw new Error("Camera frame upload failed.");
        const expiresAt = Date.now() + 240000;
        await client.mutation(api.cameras.publish, { ...sessionArgs(), operationId, protocol: "mjpeg", storageId: payload.storageId, expiresAt });
        cameraPublishedFor = operationId; cameraExpiresAt = expiresAt; cameraFrameHash = hash;
      })().catch(() => console.error(`${identity.hardwareId}: camera stream is unavailable.`)).finally(() => { cameraPublishing = false; });
      return;
    }
    if (!adapter.openCameraStream || (cameraPublishedFor === operationId && cameraExpiresAt > Date.now() + 30000)) return;
    cameraPublishing = true;
    void adapter.openCameraStream().then(async stream => {
      await client.mutation(api.cameras.publish, { ...sessionArgs(), operationId, ...stream });
      cameraPublishedFor = operationId; cameraExpiresAt = stream.expiresAt;
    }).catch(() => console.error(`${identity.hardwareId}: camera stream is unavailable.`)).finally(() => { cameraPublishing = false; });
  }, 1000);
  const watchdogTimer = setInterval(() => {
    if (!linkLost && Date.now() - lastBackendContact > 3000) { linkLost = true; void failLocally("Cloud link lost; local failsafe engaged."); }
  }, 100);
  console.log(`${identity.model} connected as ${identity.hardwareId}. Environment: ${identity.environment}. Telemetry: 20 Hz source / up to 10 Hz publication.`);
  return {
    adapter,
    getSessionId: (): Id<"agentSessions"> => sessionId,
    owns: grant => !shuttingDown && !isShuttingDown() && Date.now() - lastBackendContact < 3000 && latestWork?.operation?._id === grant.operationId && latestWork.operation.controlGeneration === grant.generation && latestWork.operation.controlOwner === "computer" && latestWork.operation.state === "manual",
    async shutdown() {
      if (shuttingDown) return true;
      shuttingDown = true;
      activeExecution?.abort();
      const telemetry = await adapter.getTelemetry();
      if (telemetry.airborne || telemetry.armed) {
        shuttingDown = false;
        await failLocally("Agent shutdown requested during flight; verify landing before closing.");
        console.error(`${identity.hardwareId} remains online until aircraft is grounded and disarmed.`);
        return false;
      }
      for (const timer of [publishTimer, heartbeatTimer, workTimer, watchdogTimer, cameraTimer]) clearInterval(timer);
      sampleSubscription(); unsubscribe();
      await adapter.disconnect();
      return true;
    },
  };
}

function persistentInstanceId() {
  const path = join(process.cwd(), "data", ".iris-agent-instance");
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (/^[a-zA-Z0-9_-]{10,100}$/.test(existing)) return existing;
  } catch { /* first run */ }
  const id = randomUUID();
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  writeFileSync(path, id);
  return id;
}

function isAddrInUse(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE";
}

export async function startFlightAgent(url: string, token: string) {
  const client = new ConvexClient(url);
  const instanceId = persistentInstanceId();
  const vehicles = new Map<string, VehicleHandle>();
  const skipped = new Set<string>();
  const connecting = new Set<string>();
  let shuttingDown = false;
  const demos: DemoDrone[] = [];
  const demoHttp = await startDemoHttp(Number(process.env.IRIS_DEMO_HTTP_PORT ?? "8766"), hardwareId => {
    if (hardwareId) return demos.find(drone => drone.hardwareId === hardwareId)?.latestJpeg() ?? null;
    for (let i = demos.length - 1; i >= 0; i--) {
      const jpeg = demos[i]?.latestJpeg();
      if (jpeg) return jpeg;
    }
    return null;
  }).catch(error => {
    if (isAddrInUse(error)) throw new Error("Demo HTTP port 8766 is already in use. Stop the other flight agent first.");
    throw error;
  });
  const demoOpts = { port: demoHttp.port, register: (adapter: DemoDrone) => { demos.push(adapter); } };
  console.log(`Demo terrain and camera at http://127.0.0.1:${demoHttp.port}/`);
  async function pulse() {
    if (shuttingDown) return;
    await client.mutation(api.agentLink.pulse, { token });
  }
  async function connect(config: FleetVehicle) {
    if (vehicles.has(config.vehicleId) || skipped.has(config.vehicleId) || connecting.has(config.vehicleId)) return;
    connecting.add(config.vehicleId);
    try {
      vehicles.set(config.vehicleId, await connectVehicle(client, token, instanceId, config, () => shuttingDown, demoOpts));
    } catch (error) {
      skipped.add(config.vehicleId);
      console.error(`${config.hardwareId}:`, error instanceof Error ? error.message : "failed to connect");
    } finally {
      connecting.delete(config.vehicleId);
    }
  }
  async function sync(list: FleetVehicle[]) {
    const ids = new Set(list.map(vehicle => vehicle.vehicleId));
    for (const [id, handle] of [...vehicles]) {
      if (ids.has(id as Id<"vehicles">)) continue;
      if (await handle.shutdown()) vehicles.delete(id);
    }
    for (const id of [...skipped]) if (!ids.has(id as Id<"vehicles">)) skipped.delete(id);
    for (const config of list) await connect(config);
  }
  const gateway = await startControlGateway({
    port: Number(process.env.IRIS_CONTROL_PORT ?? process.env.PORT ?? "8765"),
    host: process.env.IRIS_CONTROL_BIND ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1"),
    allowedOrigin: process.env.IRIS_ALLOWED_ORIGIN ?? "http://127.0.0.1:3000",
    redeem: ticket => client.mutation(api.manualControl.redeem, { token, ticket }),
    adapterFor: vehicleId => vehicles.get(vehicleId)?.adapter,
    owns: grant => vehicles.get(grant.vehicleId)?.owns(grant) ?? false,
    ...(process.env.IRIS_CONTROL_TLS_CERT && process.env.IRIS_CONTROL_TLS_KEY ? { tls: { certificatePath: process.env.IRIS_CONTROL_TLS_CERT, keyPath: process.env.IRIS_CONTROL_TLS_KEY } } : {}),
  }).catch(error => {
    if (isAddrInUse(error)) throw new Error("Control gateway port 8765 is already in use. Stop the other flight agent first.");
    throw error;
  });
  let unsubscribe = client.onUpdate(api.agentLink.fleet, { token }, list => { void sync(list); }, error => {
    console.error("Fleet subscription requires reconciliation:", error instanceof Error ? error.message : "connection error");
  });
  await pulse();
  const pulseTimer = setInterval(() => { void pulse().catch(error => {
    console.error("Flight server heartbeat failed:", error instanceof Error ? error.message : "connection error");
  }); }, 2000);
  await sync(await client.query(api.agentLink.fleet, { token }));
  console.log(`Fleet agent online. Connected aircraft: ${vehicles.size}.`);
  return {
    async shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      let blocked = false;
      for (const [id, handle] of [...vehicles]) {
        if (await handle.shutdown()) vehicles.delete(id);
        else blocked = true;
      }
      if (blocked) {
        shuttingDown = false;
        console.error("Agent remains online until all aircraft are grounded and disarmed. Retry shutdown after landing.");
        return;
      }
      unsubscribe();
      clearInterval(pulseTimer);
      await demoHttp.close();
      await gateway.close();
      await client.close();
    },
  };
}
