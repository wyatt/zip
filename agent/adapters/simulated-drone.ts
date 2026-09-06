import type { AircraftSample, ControlOwner, GeoPoint } from "../../lib/operations";
import { metersBetween } from "../../lib/operations";
import { assertCommandContext, type AdapterIdentity, type CommandAcknowledgment, type CommandContext, type DroneAdapter } from "../drone-adapter";

/** A local-process aircraft simulator. All measurements originate here, never in the browser. */
export class SimulatedDrone implements DroneAdapter {
  private timer?: ReturnType<typeof setInterval>;
  private listeners = new Set<(sample: AircraftSample) => void>();
  private sample: AircraftSample;
  private generation = 0;
  private target: { position: GeoPoint; altitudeM: number };
  private velocity: { north: number; east: number; up: number; yaw: number; expiresAt: number } | null = null;
  private lastTick = 0;
  private landing = false;
  private acknowledgments = new Map<string, CommandAcknowledgment>();

  constructor(private readonly hardwareId: string, private readonly home: GeoPoint) {
    this.target = { position: { ...home }, altitudeM: 0 };
    this.sample = { sequence: 0, capturedAt: Date.now(), position: { ...home }, altitudeM: 0, batteryPct: 100, headingDeg: 0, speedMps: 0, connected: false, armed: false, airborne: false, navigationHealthy: true, controlOwner: "none", flightMode: "grounded", faults: [] };
  }
  async connect(): Promise<AdapterIdentity> {
    if (!this.timer) {
      this.sample.connected = true;
      this.lastTick = Date.now();
      this.timer = setInterval(() => this.tick(), 50);
    }
    return { hardwareId: this.hardwareId, model: "iris local simulator", environment: "simulated", firmware: "2.0", capabilities: ["takeoff", "hover", "land", "position", "autonomous", "manual_remote", "manual_computer"] };
  }
  async disconnect() {
    if (this.sample.airborne || this.sample.armed) throw new Error("Cannot disconnect a flying simulator. Land or transfer control first.");
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.sample.connected = false;
  }
  private acknowledge(context: CommandContext, action: () => void): CommandAcknowledgment {
    assertCommandContext(context, this.generation);
    if (!this.sample.connected) throw new Error("Aircraft disconnected.");
    const previous = this.acknowledgments.get(context.commandId);
    if (previous) return previous;
    this.generation = context.generation;
    action();
    const result = { commandId: context.commandId, acknowledgedAt: Date.now(), accepted: true };
    this.acknowledgments.set(context.commandId, result);
    if (this.acknowledgments.size > 200) this.acknowledgments.delete(this.acknowledgments.keys().next().value!);
    return result;
  }
  async takeoff(height: number, context: CommandContext) {
    return this.acknowledge(context, () => {
      if (!Number.isFinite(height) || height < 2 || height > 30 || this.sample.airborne || this.sample.armed || (this.sample.batteryPct ?? 0) < 30) throw new Error("Takeoff preflight failed.");
      this.sample.armed = true;
      this.sample.flightMode = "takeoff";
      this.target = { position: { ...this.sample.position! }, altitudeM: height };
      this.landing = false;
      this.velocity = null;
    });
  }
  async land(context: CommandContext) {
    return this.acknowledge(context, () => {
      this.velocity = null;
      this.landing = true;
      this.target = { position: { ...this.sample.position! }, altitudeM: 0 };
      this.sample.flightMode = "landing";
    });
  }
  async move(vx: number, vy: number, vz: number, yaw: number, context: CommandContext) {
    return this.acknowledge(context, () => {
      if (!this.sample.airborne || this.sample.controlOwner !== "computer") throw new Error("Computer control of an airborne aircraft is required.");
      if (![vx, vy, vz, yaw].every(Number.isFinite) || Math.hypot(vx, vy) > 2 || Math.abs(vz) > 1 || Math.abs(yaw) > 45) throw new Error("Velocity exceeds the control limits.");
      this.landing = false;
      this.velocity = { north: vx, east: vy, up: vz, yaw, expiresAt: Math.min(context.expiresAt, Date.now() + 300) };
      this.sample.flightMode = "manual";
    });
  }
  async stop(context: CommandContext) {
    return this.acknowledge(context, () => this.hold());
  }
  async goTo(position: GeoPoint, altitudeM: number, context: CommandContext) {
    return this.acknowledge(context, () => {
      if (!this.sample.airborne || !Number.isFinite(altitudeM) || altitudeM < 2 || altitudeM > 30 || metersBetween(this.home, position) > 3000) throw new Error("Navigation target is not valid.");
      this.target = { position, altitudeM };
      this.velocity = null;
      this.landing = false;
      this.sample.flightMode = "navigation";
    });
  }
  async rotate(degrees: number, context: CommandContext) {
    return this.acknowledge(context, () => {
      if (!Number.isFinite(degrees) || Math.abs(degrees) > 360) throw new Error("Invalid rotation.");
      this.sample.headingDeg = ((this.sample.headingDeg ?? 0) + degrees + 360) % 360;
    });
  }
  async transferControl(owner: Exclude<ControlOwner, "none">, context: CommandContext) {
    return this.acknowledge(context, () => {
      this.hold();
      this.sample.controlOwner = owner;
    });
  }
  async getTelemetry() { return structuredClone(this.sample); }
  onTelemetry(listener: (sample: AircraftSample) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async handleLinkLoss(reason: string) {
    this.velocity = null;
    // A physical-remote handoff remains with the pilot. Autonomy/computer link loss lands locally.
    if (this.sample.controlOwner !== "remote") {
      this.landing = true;
      this.target = { position: { ...this.sample.position! }, altitudeM: 0 };
      this.sample.flightMode = "failsafe landing";
    } else this.hold();
    this.sample.faults = [reason.slice(0, 200)];
  }
  private hold() {
    this.velocity = null;
    this.landing = false;
    this.target = { position: { ...this.sample.position! }, altitudeM: this.sample.altitudeM! };
    this.sample.flightMode = this.sample.airborne ? "hold" : "grounded";
  }
  private tick() {
    const now = Date.now(), dt = Math.min(.1, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    const old = this.sample.position!, oldAltitude = this.sample.altitudeM!;
    if (this.velocity && this.velocity.expiresAt <= now) this.hold();
    if (this.velocity) {
      const velocity = this.velocity;
      const proposed = { lat: old.lat + velocity.north * dt / 111320, lon: old.lon + velocity.east * dt / (111320 * Math.cos(old.lat * Math.PI / 180)) };
      if (metersBetween(proposed, this.home) <= 3000) this.sample.position = proposed;
      this.sample.altitudeM = Math.max(.5, Math.min(30, oldAltitude + velocity.up * dt));
      this.sample.headingDeg = ((this.sample.headingDeg ?? 0) + velocity.yaw * dt + 360) % 360;
    } else {
      const distance = metersBetween(old, this.target.position);
      const fraction = distance < .001 ? 1 : Math.min(1, 2 * dt / distance);
      this.sample.position = { lat: old.lat + (this.target.position.lat - old.lat) * fraction, lon: old.lon + (this.target.position.lon - old.lon) * fraction };
      const dz = this.target.altitudeM - oldAltitude;
      this.sample.altitudeM = oldAltitude + Math.sign(dz) * Math.min(Math.abs(dz), dt);
    }
    if (this.sample.altitudeM! > .1) this.sample.airborne = true;
    if (this.landing && this.sample.altitudeM! <= .01) {
      this.sample.altitudeM = 0; this.sample.armed = false; this.sample.airborne = false;
      this.sample.flightMode = "grounded"; this.landing = false;
    }
    this.sample.speedMps = dt ? metersBetween(old, this.sample.position!) / dt : 0;
    if (this.sample.armed) this.sample.batteryPct = Math.max(0, this.sample.batteryPct! - dt * .05);
    this.sample.capturedAt = now;
    this.sample.sequence++;
    for (const listener of this.listeners) listener(structuredClone(this.sample));
  }
}
