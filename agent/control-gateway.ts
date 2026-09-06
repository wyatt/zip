import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { DroneAdapter } from "./drone-adapter";
import { executeAdapterCommand } from "./adapter-command";
import { metersBetween, type FlightPlan } from "../lib/operations";

export type ControlGrant = { operationId: string; vehicleId: string; generation: number; expiresAt: number; plan: FlightPlan };
type Options = {
  adapterFor: (vehicleId: string) => DroneAdapter | undefined;
  port: number;
  host: string;
  allowedOrigin: string;
  redeem: (ticket: string) => Promise<ControlGrant>;
  owns: (grant: ControlGrant) => boolean;
  tls?: { certificatePath: string; keyPath: string };
};

/** Local transport belongs to the flight agent. Convex remains the authority for access and ownership. */
export async function startControlGateway(options: Options) {
  const server = options.tls ? createHttpsServer({ cert: readFileSync(options.tls.certificatePath), key: readFileSync(options.tls.keyPath) }) : createHttpServer();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  let controlling: WebSocket | null = null;
  const landing = new Set<string>();
  const adapter = (grant: ControlGrant) => {
    const found = options.adapterFor(grant.vehicleId);
    if (!found) throw new Error("Aircraft is not connected to this agent.");
    return found;
  };
  server.on("request", (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/control" || request.headers.origin !== options.allowedOrigin) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
  });
  wss.on("connection", ws => {
    let grant: ControlGrant | null = null, lastSequence = -1, lastInput = Date.now(), busy = false, authenticating = false;
    let holding = true;
    let closing = false;
    let inFlight: Promise<void> = Promise.resolve();
    const queue: Record<string, unknown>[] = [];
    const landingKey = () => `${grant!.operationId}:${grant!.generation}`;
    const rejected = (input: Record<string, unknown>, reason: string) => send({ type: "rejected", sequence: input.sequence, reason });
    const abort = new AbortController();
    const send = (value: object) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
    const context = (id: string, ttl = 250) => ({ commandId: id, generation: grant!.generation, expiresAt: Date.now() + ttl, signal: abort.signal });
    async function hold(force = false) {
      const current = grant;
      if ((!force && holding) || !current || !options.owns(current) || landing.has(landingKey())) return;
      holding = true;
      await executeAdapterCommand(context(`deadman-${randomUUID()}`, 1000), command => adapter(current).stop(command)).catch(() => adapter(current).handleLinkLoss("Manual control channel lost."));
    }
    const authDeadline = setTimeout(() => { if (!grant) ws.close(1008, "Authentication required"); }, 3000);
    const watchdog = setInterval(() => {
      if (!grant) return;
      if (grant.expiresAt <= Date.now() || !options.owns(grant)) { void hold(true).finally(() => ws.close(1008, "Control authorization expired")); return; }
      if (!busy && !queue.length && Date.now() - lastInput > 250) void hold();
    }, 50);
    ws.on("message", raw => {
      void (async () => {
        let input: Record<string, unknown>;
        try { input = JSON.parse(raw.toString()); } catch { ws.close(1008, "Invalid control message"); return; }
        if (input.type === "authenticate") {
          if (authenticating || typeof input.ticket !== "string") return;
          authenticating = true;
          try {
            const next = await options.redeem(input.ticket);
            if (ws.readyState !== WebSocket.OPEN) return;
            if (grant && (next.operationId !== grant.operationId || next.generation !== grant.generation)) throw new Error("Control operation changed.");
            if (controlling && controlling !== ws) throw new Error("Another control channel is active.");
            for (const key of landing) if (key !== `${next.operationId}:${next.generation}`) landing.delete(key);
            grant = next; controlling = ws; clearTimeout(authDeadline);
            send({ type: "authenticated", serverTime: Date.now(), expiresAt: next.expiresAt });
          } catch { ws.close(1008, "Control authentication failed"); }
          finally { authenticating = false; }
          return;
        }
        if (!grant || grant.expiresAt <= Date.now() || !options.owns(grant)) { ws.close(1008, "No control authority"); return; }
        if (!Number.isSafeInteger(input.sequence) || Number(input.sequence) <= lastSequence || typeof input.sentAt !== "number" || !Number.isFinite(input.sentAt) || Date.now() - input.sentAt > 300 || input.sentAt > Date.now() + 200) { rejected(input, "Stale control input"); return; }
        lastSequence = Number(input.sequence);
        if (!["move", "stop", "takeoff", "land"].includes(String(input.type))) { rejected(input, "Unsupported control input."); return; }
        if (input.type === "move" && (busy || queue.length)) { send({ type: "superseded", sequence: input.sequence }); return; }
        if (queue.length >= 8) { rejected(input, "Control command queue is full."); return; }
        queue.push(input);
        // Discrete actions are serialized and acknowledged. Only replaceable velocity
        // updates may be dropped. Landing survives a subsequent socket disconnect.
        if (input.type === "land") landing.add(landingKey());
        if (!busy) inFlight = drain();
      })().catch(() => ws.close(1011, "Control error"));
    });
    async function drain() {
      busy = true;
      try {
        while (queue.length) {
          const input = queue.shift()!;
          if (closing && input.type !== "land") { rejected(input, "Control channel closed."); continue; }
          try {
            const current = grant;
            if (!current || current.expiresAt <= Date.now() || !options.owns(current)) throw new Error("Control authority changed.");
            if (Date.now() - Number(input.sentAt) > (input.type === "move" ? 300 : 1500)) throw new Error("Control command expired before execution.");
            const isLanding = landing.has(landingKey());
            if (isLanding && input.type !== "land") throw new Error("Landing is in progress.");
            const id = `manual-${current.generation}-${randomUUID()}`;
            const command = context(id, input.type === "move" ? 250 : 1000);
            // Land and hold are recovery actions. Missing navigation or a breached
            // boundary must not prevent asking the controller to stop or descend.
            if (input.type === "land") {
              await executeAdapterCommand(command, context => adapter(current).land(context));
              holding = true;
            } else if (input.type === "stop") {
              await executeAdapterCommand(command, context => adapter(current).stop(context));
              holding = true;
            } else {
              const sample = await adapter(current).getTelemetry();
              if (!sample.connected || Date.now() - sample.capturedAt > 1000 || !sample.navigationHealthy || sample.controlOwner !== "computer" || sample.faults.length) throw new Error("Aircraft is not ready for computer controls.");
              if (!sample.position || sample.altitudeM === null || metersBetween(sample.position, current.plan.home) > current.plan.radiusM || sample.altitudeM > current.plan.maxAltitudeM) throw new Error("Aircraft position is unavailable or outside the flight boundary.");
              if (input.type === "takeoff") {
                await executeAdapterCommand(command, context => adapter(current).takeoff(current.plan.steps[0].altitudeM, context));
                holding = true;
              } else {
                const values = [input.vx, input.vy, input.vz, input.yaw];
                if (values.some(value => typeof value !== "number" || !Number.isFinite(value)) || Math.hypot(Number(input.vx), Number(input.vy)) > 2 || Math.abs(Number(input.vz)) > 1 || Math.abs(Number(input.yaw)) > 45) throw new Error("Control input exceeds limits.");
                const projected = { lat: sample.position.lat + Number(input.vx) / 111320, lon: sample.position.lon + Number(input.vy) / (111320 * Math.cos(sample.position.lat * Math.PI / 180)) };
                if (metersBetween(projected, current.plan.home) > current.plan.radiusM - 2 || sample.altitudeM + Number(input.vz) > current.plan.maxAltitudeM - 1) throw new Error("Control input would breach the flight boundary.");
                await executeAdapterCommand(command, context => adapter(current).move(Number(input.vx), Number(input.vy), Number(input.vz), Number(input.yaw), context));
                lastInput = Date.now(); holding = false;
              }
            }
            send({ type: "acknowledged", sequence: input.sequence, action: input.type });
          } catch (error) {
            if (input.type === "land" && grant && options.owns(grant)) {
              await adapter(grant).handleLinkLoss("Landing acknowledgment failed; reconcile aircraft state.").catch(() => undefined);
            } else await hold();
            rejected(input, error instanceof Error ? error.message : "Aircraft rejected input.");
          }
        }
      } finally { busy = false; }
    }
    ws.on("error", () => { ws.close(1011, "Control channel error"); });
    ws.on("close", () => {
      closing = true;
      clearInterval(watchdog); clearTimeout(authDeadline);
      void inFlight.finally(() => hold(true)).finally(() => {
        abort.abort();
        if (controlling === ws) controlling = null;
      });
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port, options.host, () => { server.off("error", reject); resolve(); }); });
  return { port: (server.address() as import("node:net").AddressInfo).port, async close() { for (const ws of wss.clients) ws.close(1001, "Agent shutting down"); await new Promise<void>(resolve => wss.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
