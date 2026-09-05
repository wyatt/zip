export type Point = { x: number; y: number };
export const LAUNCH: Point = { x: 100, y: 360 };
export const TARGET: Point = { x: 420, y: 140 };
export const STEP_NAMES = ["Take off", "Fly to job", "Perform task", "Return to launch", "Land"] as const;
export type Snapshot = { position: Point; altitude: number; battery: number; elapsed: number; sequence: number; step: number; state: "running" | "returning" | "landed" };
export function planRoute(target: Point): Point[] {
  return [LAUNCH, { x: LAUNCH.x, y: target.y }, target, { x: target.x, y: LAUNCH.y }, LAUNCH];
}
function between(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
export function sampleFlight(route: Point[], elapsed: number, sequence: number, taskType?: string): Snapshot {
  const t = Math.max(0, Math.min(20, elapsed));
  let position = route[0], altitude = 30, step = 0;
  if (taskType) {
    if (t < 3) altitude = t * 10;
    else if (t < 7) { step = 1; position = between(route[0], route[1], (t - 3) / 4); }
    else if (t < 12) { step = 2; position = alongPath(route.slice(1, -1), (t - 7) / 5); }
    else if (t < 18) { step = 3; position = between(route[route.length - 2], route[0], (t - 12) / 6); }
    else { step = 4; position = route[0]; altitude = (20 - t) * 15; }
    return { position, altitude, battery: 100 - t * 0.6, elapsed: t, sequence, step, state: t === 20 ? "landed" : t >= 12 ? "returning" : "running" };
  }
  if (t < 3) altitude = t * 10;
  else if (t < 9) { step = 1; position = t < 6 ? between(route[0], route[1], (t - 3) / 3) : between(route[1], route[2], (t - 6) / 3); }
  else if (t < 12) { step = 2; position = route[2]; }
  else if (t < 18) { step = 3; position = t < 15 ? between(route[2], route[3], (t - 12) / 3) : between(route[3], route[4], (t - 15) / 3); }
  else { step = 4; position = route[4]; altitude = (20 - t) * 15; }
  return { position, altitude, battery: 100 - t * 0.6, elapsed: t, sequence, step, state: t === 20 ? "landed" : t >= 12 ? "returning" : "running" };
}
function alongPath(points: Point[], progress: number): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let remaining = lengths.reduce((a, b) => a + b, 0) * progress;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) return between(points[i], points[i + 1], lengths[i] ? remaining / lengths[i] : 0);
    remaining -= lengths[i];
  }
  return points[points.length - 1];
}
