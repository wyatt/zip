import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { sampleFlight, type Point, type Snapshot } from "../lib/flight";

// Phase 2 can replace this adapter; nothing here discovers or connects to aircraft.
export interface FlightAdapter {
  connect(): Promise<{ identity: string; ready: boolean }>;
  loadMission(route: Point[], taskType?: string): void;
  start(publish: (snapshot: Snapshot) => Promise<void>): Promise<void>;
}
export class SimulatorAdapter implements FlightAdapter {
  private route: Point[] | null = null;
  private taskType?: string;
  async connect() { return { identity: "iris-sim-01", ready: true }; }
  loadMission(route: Point[], taskType?: string) { this.route = route; this.taskType = taskType; }
  async start(publish: (snapshot: Snapshot) => Promise<void>) {
    if (!this.route) throw new Error("Load a mission before starting.");
    const started = performance.now();
    for (let sequence = 0; sequence <= 40; sequence++) {
      await delay(Math.max(0, started + sequence * 500 - performance.now()));
      await publish(sampleFlight(this.route, sequence / 2, sequence, this.taskType));
    }
  }
}
