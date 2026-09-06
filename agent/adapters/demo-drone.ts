import { SimulatedDrone } from "./simulated-drone";
import type { CommandContext, DroneAdapter } from "../drone-adapter";
import type { AircraftSample, Capability, Environment, FlightPlan, GeoPoint, JobKind, PlanStep } from "../../lib/operations";
import { fromLocal } from "../../lib/geo-local";
import { ITHACA_REGION_KEY } from "../../lib/ithaca";
import { encodeCoverageFrame, encodeInspectionFrame } from "../../lib/inspection-sim/mosaic-frame.js";
import { planRegionalMission } from "../../lib/inspection-sim/regional-mission-planner.js";
import { createRegionalReconstruction } from "../../lib/inspection-sim/regional-reconstruction.js";
import { RegionalMissionSimulation } from "../../lib/inspection-sim/regional-mission-simulation.js";
import { regionalMissionConfig, syntheticRegionalPlan } from "../../lib/regional-plan";

type Job = { kind: string; location: GeoPoint; destinations: GeoPoint[]; area?: { northWest: GeoPoint; southEast: GeoPoint } };
type PlannedMission = {
  start: number[];
  tasks: { point: number[]; kind?: string; photo?: number | null }[];
  photoCount: number;
  target?: number[] | null;
  options?: { speed?: number; trackSpacing?: number };
  mode?: string;
  polygon?: number[][][] | null;
  requiredBattery?: number;
};

export class DemoDrone implements DroneAdapter {
  readonly hardwareId: string;
  private readonly inner: SimulatedDrone;
  private job: Job | null = null;
  private sim: InstanceType<typeof RegionalMissionSimulation> | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private origin: GeoPoint;
  private padElevation = 0;
  private lastPos: GeoPoint | null = null;
  private lastAt = 0;
  private jpeg: Buffer | null = null;
  private reconstruction: Awaited<ReturnType<typeof createRegionalReconstruction>> = null;
  private planned: PlannedMission | null = null;
  private planning: Promise<void> | null = null;
  private cameraBase: string;
  terrainKey = ITHACA_REGION_KEY;
  path: GeoPoint[] = [];

  constructor(
    hardwareId: string,
    home: GeoPoint,
    private readonly regionBaseUrl: string,
    private readonly provisioned: { environment: Environment; capabilities: Capability[]; model?: string; batteryPct?: number },
  ) {
    this.hardwareId = hardwareId;
    this.inner = new SimulatedDrone(hardwareId, home, provisioned.batteryPct);
    this.origin = home;
    this.cameraBase = regionBaseUrl.replace(/\/terrain\/?$/, "");
  }

  private jobKey = "";
  setJob(job: Job | null) {
    const key = job ? `${job.kind}:${job.location.lat},${job.location.lon}:${job.destinations.map(point => `${point.lat},${point.lon}`).join(";")}:${job.area ? `${job.area.northWest.lat},${job.area.northWest.lon}` : ""}` : "";
    if (key === this.jobKey) return;
    this.jobKey = key;
    this.job = job;
    this.planned = null;
    this.reconstruction = null;
    this.jpeg = null;
    this.path = [];
    this.planning = job && job.kind !== "flight_check" ? this.prefetch(job) : null;
  }
  latestJpeg() { return this.jpeg; }

  private annotate(sample: AircraftSample): AircraftSample {
    if (sample.mission || !this.terrainKey) return sample;
    return {
      ...sample,
      mission: {
        mode: this.job?.kind === "deliver" ? "deliver" : this.job?.kind === "search" ? "search" : "inspection",
        phase: "ready", elapsed: 0, battery: sample.batteryPct ?? 100, predictedArrivalBattery: sample.batteryPct ?? 100,
        photos: 0, totalPhotos: this.planned?.photoCount ?? 0, sorties: 0, returns: 0, multiplier: 1, distance: 0, reason: "", terrainKey: this.terrainKey, path: this.path,
      },
    };
  }
  getTelemetry() { return this.inner.getTelemetry().then(sample => this.annotate(sample)); }
  onTelemetry(listener: (sample: AircraftSample) => void) {
    return this.inner.onTelemetry(sample => listener(this.annotate(sample)));
  }

  private async prefetch(job: Job) {
    this.terrainKey = ITHACA_REGION_KEY;
    try {
      await this.buildPlan(job);
    } catch {
      /* beginRegionalTask retries and falls back */
    }
  }

  private jobKind(value: string): Exclude<JobKind, "flight_check"> {
    return value === "deliver" || value === "delivery" ? "deliver" : value === "search" ? "search" : "inspection";
  }

  private applyPlanned(planned: PlannedMission) {
    this.planned = planned;
    this.padElevation = Number(planned.start?.[2] ?? 0);
    const stride = Math.max(1, Math.floor(planned.tasks.length / 200));
    this.path = planned.tasks.filter((_, i) => i % stride === 0 || i === planned.tasks.length - 1).map(task => fromLocal(this.origin, { east: task.point[0]!, north: task.point[1]! }));
  }

  private async buildPlan(job: Job) {
    const kind = this.jobKind(job.kind);
    const input = { kind, home: this.origin, location: job.location, destinations: job.destinations.length ? job.destinations : [job.location], area: job.area };
    const regionUrl = `${this.regionBaseUrl}${ITHACA_REGION_KEY}/`;
    try {
      const config = regionalMissionConfig(input);
      if (config) {
        const planned = await planRegionalMission({ regionUrl, config }) as PlannedMission;
        if (this.job !== job) return;
        this.applyPlanned(planned);
        if (kind === "inspection") {
          const manifest = await fetch(`${regionUrl}manifest.json`).then(response => {
            if (!response.ok) throw new Error(`Regional manifest: HTTP ${response.status}`);
            return response.json();
          });
          this.reconstruction = await createRegionalReconstruction(regionUrl, manifest, planned);
          if (this.reconstruction) this.jpeg = encodeInspectionFrame(this.reconstruction.data);
        }
        return;
      }
    } catch {
      /* use a geometric route so every aircraft still flies */
    }
    if (this.job !== job) return;
    this.reconstruction = null;
    const planned = syntheticRegionalPlan(input);
    this.applyPlanned(planned);
    if (kind === "inspection") this.jpeg = encodeCoverageFrame(0, planned.photoCount);
  }

  async connect() {
    const identity = await this.inner.connect();
    return {
      ...identity,
      model: this.provisioned.model ?? "iris demo simulator",
      environment: this.provisioned.environment,
      capabilities: [...new Set([...identity.capabilities, ...this.provisioned.capabilities, "camera" as const])],
    };
  }
  disconnect() { this.stopSim(); return this.inner.disconnect(); }
  takeoff(height: number, context: CommandContext) { return this.inner.takeoff(Math.min(30, height), context); }
  land(context: CommandContext) { this.stopSim(); this.inner.releaseExternal(); return this.inner.land(context); }
  move(vx: number, vy: number, vz: number, yaw: number, context: CommandContext) { return this.inner.move(vx, vy, vz, yaw, context); }
  stop(context: CommandContext) { return this.inner.stop(context); }
  goTo(position: GeoPoint, altitudeM: number, context: CommandContext) { return this.inner.goTo(position, Math.min(30, altitudeM), context); }
  rotate(degrees: number, context: CommandContext) { return this.inner.rotate!(degrees, context); }
  transferControl(owner: Exclude<AircraftSample["controlOwner"], "none">, context: CommandContext) { return this.inner.transferControl(owner, context); }
  handleLinkLoss(reason: string) { this.stopSim(); return this.inner.handleLinkLoss(reason); }

  async openCameraStream() {
    return { protocol: "mjpeg" as const, url: `${this.cameraBase}/camera/${encodeURIComponent(this.hardwareId)}.mjpg`, expiresAt: Date.now() + 240000 };
  }

  async beginRegionalTask(step: PlanStep, plan: FlightPlan, context: CommandContext) {
    const ack = await this.inner.stop(context);
    void this.startRegional(step, plan).catch(error => {
      const reason = error instanceof Error ? error.message : "Regional planning failed.";
      void this.inner.getTelemetry().then(current => {
        this.inner.applyExternalSample({ ...current, capturedAt: Date.now(), sequence: current.sequence + 1, flightMode: "error", faults: [reason.slice(0, 200)] });
      });
    });
    return ack;
  }

  private async startRegional(step: PlanStep, plan: FlightPlan) {
    const job = this.job ?? { kind: step.kind, location: step.position, destinations: [step.position] };
    this.origin = plan.home;
    if (this.planning) await this.planning;
    if (!this.planned) await this.buildPlan(job);
    if (!this.planned) throw new Error("Unable to synthesize a mission route.");
    const mode = step.kind === "deliver" ? "delivery" : step.kind === "search" ? "search" : "inspection";
    this.inner.lockExternal();
    this.sim = new RegionalMissionSimulation(this.planned, {
      onCapture: (event: { id: number; position: number[]; time: number }) => {
        this.reconstruction?.capture(event);
        if (this.reconstruction) this.jpeg = encodeInspectionFrame(this.reconstruction.data);
        else this.jpeg = encodeCoverageFrame(this.sim?.snapshot().photos ?? 0, this.planned?.photoCount ?? 0);
      },
    });
    this.sim.start();
    this.stopSimLoop();
    let last = Date.now();
    this.timer = setInterval(() => {
      if (!this.sim) return;
      const now = Date.now();
      this.sim.advanceReal(Math.min(0.25, (now - last) / 1000));
      last = now;
      this.publish(mode);
    }, 50);
    this.publish(mode);
  }

  private publish(mode: "delivery" | "inspection" | "search") {
    const sim = this.sim;
    if (!sim) return;
    const snap = sim.snapshot();
    const east = Number(snap.position[0] ?? 0);
    const north = Number(snap.position[1] ?? 0);
    const elev = Number(snap.position[2] ?? this.padElevation);
    const position = fromLocal(this.origin, { east, north });
    const now = Date.now();
    const speed = this.lastPos && this.lastAt ? Math.hypot(...[position.lat - this.lastPos.lat, position.lon - this.lastPos.lon].map((d, i) => i === 0 ? d * 111320 : d * 111320 * Math.cos(position.lat * Math.PI / 180))) / Math.max(0.05, (now - this.lastAt) / 1000) : 0;
    const heading = this.lastPos ? (Math.atan2(position.lon - this.lastPos.lon, position.lat - this.lastPos.lat) * 180 / Math.PI + 360) % 360 : 0;
    this.lastPos = position; this.lastAt = now;
    const complete = snap.phase === "complete" || snap.phase === "error";
    const result = snap.result;
    const found = result?.location ? fromLocal(this.origin, { east: Number(result.location[0]), north: Number(result.location[1]) }) : null;
    const sample: AircraftSample = {
      sequence: 0, capturedAt: now, position, altitudeM: Math.min(200, Math.max(0, elev - this.padElevation)),
      batteryPct: Number(snap.battery ?? 0), headingDeg: heading, speedMps: Math.min(200, speed),
      connected: true, armed: !complete, airborne: !complete && snap.phase !== "ready",
      navigationHealthy: true, controlOwner: "autonomy",
      flightMode: complete ? (snap.phase === "error" ? "error" : "mission_complete") : String(snap.phase),
      faults: snap.phase === "error" ? [String(snap.reason || "Simulation stopped")] : [],
      mission: {
        mode: mode === "delivery" ? "deliver" : mode, phase: String(snap.phase), elapsed: Number(snap.elapsed ?? 0), battery: Number(snap.battery ?? 0),
        predictedArrivalBattery: Number(snap.predictedArrivalBattery ?? 0), photos: Number(snap.photos ?? 0), totalPhotos: Number(snap.totalPhotos ?? 0),
        sorties: Number(snap.sorties ?? 0), returns: Number(snap.returns ?? 0), multiplier: Number(snap.multiplier ?? 1), distance: Number(snap.distance ?? 0),
        reason: String(snap.reason || ""), terrainKey: this.terrainKey,
        path: this.path,
        result: found && result ? { type: String(result.type), lat: found.lat, lon: found.lon, foundAt: Number(result.foundAt ?? now) } : undefined,
      },
    };
    this.inner.applyExternalSample(sample);
    if (complete) this.stopSimLoop();
  }

  private stopSim() { this.stopSimLoop(); this.sim = null; }
  private stopSimLoop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
