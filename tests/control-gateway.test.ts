// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import { once } from "node:events";
import { startControlGateway } from "../agent/control-gateway";
import { SimulatedDrone } from "../agent/adapters/simulated-drone";
import { createFlightPlan } from "../lib/operations";
import { executeAdapterCommand } from "../agent/adapter-command";
import type { CommandContext } from "../agent/drone-adapter";

const home = { lat: 42.35596, lon: -71.07029 };
const plan = createFlightPlan({ kind: "flight_check", location: home, destinations: [], home, mode: "manual", altitudeM: 2, hoverSec: 5, maxRadiusM: 100 });
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
const context = (): CommandContext => ({ commandId: "test-command", generation: 1, expiresAt: Date.now() + 1000, signal: new AbortController().signal });

async function fixture() {
  const adapter = new SimulatedDrone("gateway-test", home);
  await adapter.connect();
  cleanup.push(() => adapter.disconnect());
  await adapter.transferControl("computer", context());
  const stop = vi.spyOn(adapter, "stop");
  const land = vi.spyOn(adapter, "land");
  const gateway = await startControlGateway({ adapterFor: () => adapter, port: 0, allowedOrigin: "http://iris.test", owns: () => true, redeem: async () => ({ operationId: "test-flight", vehicleId: "test-aircraft", generation: 1, expiresAt: Date.now() + 30000, plan }) });
  cleanup.push(() => gateway.close());
  const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}/control`, { origin: "http://iris.test" });
  cleanup.push(async () => { if (ws.readyState === WebSocket.CLOSED) return; const closed = once(ws, "close"); ws.close(); await closed; });
  const messages: { type: string; sequence?: number; reason?: string }[] = [];
  ws.on("message", raw => messages.push(JSON.parse(String(raw))));
  await once(ws, "open");
  ws.send(JSON.stringify({ type: "authenticate", ticket: "test-ticket" }));
  await vi.waitFor(() => expect(messages.some(m => m.type === "authenticated")).toBe(true));
  const send = (type: string, sequence: number, extra = {}) => ws.send(JSON.stringify({ type, sequence, sentAt: Date.now(), ...extra }));
  return { adapter, stop, land, ws, messages, send };
}

test("a landing sent behind a slow stop is acknowledged and survives socket closure", async () => {
  const f = await fixture();
  const originalStop = f.adapter.stop.bind(f.adapter);
  f.stop.mockRestore();
  const stop = vi.spyOn(f.adapter, "stop").mockImplementation(async command => {
    await new Promise(resolve => setTimeout(resolve, 80));
    return originalStop(command);
  });
  f.send("stop", 1); f.send("land", 2);
  await vi.waitFor(() => expect(f.messages).toContainEqual(expect.objectContaining({ type: "acknowledged", sequence: 2 })));
  expect(f.land).toHaveBeenCalledTimes(1);
  const stops = stop.mock.calls.length;
  const closed = once(f.ws, "close"); f.ws.close(); await closed;
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(stop).toHaveBeenCalledTimes(stops);
});

test("navigation failure does not block land and old control inputs are rejected", async () => {
  const f = await fixture();
  const sample = await f.adapter.getTelemetry();
  vi.spyOn(f.adapter, "getTelemetry").mockResolvedValue({ ...sample, navigationHealthy: false, position: null, faults: ["Navigation unavailable"] });
  f.send("land", 1, { sentAt: Date.now() - 1000 });
  await vi.waitFor(() => expect(f.messages).toContainEqual(expect.objectContaining({ type: "rejected", sequence: 1 })));
  expect(f.land).not.toHaveBeenCalled();
  f.send("land", 2);
  await vi.waitFor(() => expect(f.land).toHaveBeenCalledTimes(1));
});

test("adapter acknowledgment must correlate and a hung transport is cancelled", async () => {
  await expect(executeAdapterCommand(context(), async () => ({ commandId: "different", accepted: true, acknowledgedAt: Date.now() }))).rejects.toThrow("match");
  let transportSignal: AbortSignal | undefined;
  await expect(executeAdapterCommand({ ...context(), expiresAt: Date.now() + 30 }, command => {
    transportSignal = command.signal;
    return new Promise(() => {});
  })).rejects.toThrow("timed out");
  expect(transportSignal?.aborted).toBe(true);
});
