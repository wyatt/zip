import type { AircraftSample, Capability, ControlOwner, Environment, FlightPlan, GeoPoint, PlanStep } from "../lib/operations";

/** The image's primitive contract is implemented with measured geographic steps.
 * FlightPlan/PlanStep is the single executable mission format used by the server
 * and local executor; duration is seconds, altitude is meters above launch. */
export type { PlanStep as MissionStep } from "../lib/operations";

export type AdapterIdentity = {
  hardwareId: string;
  model: string;
  environment: Environment;
  capabilities: Capability[];
  firmware: string;
};
export type CommandContext = {
  commandId: string;
  /** Expiring generation fences a previous autonomy executor after takeover. */
  generation: number;
  expiresAt: number;
  signal: AbortSignal;
};
export type CommandAcknowledgment = {
  commandId: string;
  acknowledgedAt: number;
  /** An acknowledgment means the controller accepted the action, not that flight finished. */
  accepted: boolean;
  reason?: string;
};
export type CapturedImage = { bytes: Uint8Array; mimeType: "image/jpeg" | "image/png"; capturedAt: number };
export type CameraStream = { protocol: "whep" | "hls" | "mjpeg"; url: string; expiresAt: number };

export interface DroneAdapter {
  connect(): Promise<AdapterIdentity>;
  disconnect(): Promise<void>;
  /** Meters above the measured launch origin. Controller enforces pre-arm checks. */
  takeoff(height: number, context: CommandContext): Promise<CommandAcknowledgment>;
  land(context: CommandContext): Promise<CommandAcknowledgment>;
  /** World-frame velocity: vx north, vy east, vz up (m/s), yaw clockwise (deg/s).
   * Adapter MUST hold on expiry. A missed refresh must never leave motion latched. */
  move(vx: number, vy: number, vz: number, yaw: number, context: CommandContext): Promise<CommandAcknowledgment>;
  /** Hold/zero velocity; NEVER stop the motors. */
  stop(context: CommandContext): Promise<CommandAcknowledgment>;
  /** Optional absolute navigation. An executor must reject unsupported plan steps. */
  goTo?(position: GeoPoint, altitudeM: number, context: CommandContext): Promise<CommandAcknowledgment>;
  rotate?(degrees: number, context: CommandContext): Promise<CommandAcknowledgment>;
  transferControl(owner: Exclude<ControlOwner, "none">, context: CommandContext): Promise<CommandAcknowledgment>;
  getTelemetry(): Promise<AircraftSample>;
  /** Measurements flow before, during, and after missions. Listener must not block the controller. */
  onTelemetry(listener: (sample: AircraftSample) => void): () => void;
  captureImage?(context: CommandContext): Promise<CapturedImage>;
  openCameraStream?(): Promise<CameraStream>;
  beginRegionalTask?(step: PlanStep, plan: FlightPlan, context: CommandContext): Promise<CommandAcknowledgment>;
  setJob?(job: { kind: string; location: GeoPoint; destinations: GeoPoint[]; area?: { northWest: GeoPoint; southEast: GeoPoint } } | null): void;
  /** Local safety action independent of Convex. Must be implemented and tested per aircraft. */
  handleLinkLoss(reason: string): Promise<void>;
}

export class UnsupportedAircraftError extends Error {
  constructor() { super("No verified physical-aircraft adapter is installed. Aircraft control is disabled."); }
}

export function assertCommandContext(context: CommandContext, currentGeneration: number, now = Date.now()) {
  if (context.signal.aborted) throw new Error("Command aborted.");
  if (!Number.isSafeInteger(context.generation) || context.generation < currentGeneration) throw new Error("Stale control generation.");
  if (!context.commandId || !Number.isFinite(context.expiresAt) || context.expiresAt <= now) throw new Error("Command expired.");
}
