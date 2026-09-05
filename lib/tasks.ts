import { LAUNCH, type Point } from "./flight";

export type TaskType = "deliver" | "search" | "inspection";
export type Task = { type: "deliver"; pickup: Point; dropoff: Point } | { type: "search" | "inspection"; region: { northWest: Point; southEast: Point } };
export const TASK_LABELS = { deliver: "Delivery", search: "Search", inspection: "Inspection" };
// Local meter frame anchored beside Boston Common. Existing v1 coordinates remain valid.
const ORIGIN = { lat: 42.3592, lng: -71.0715 };
const METERS_LNG = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);
export function toLatLng(p: Point): [number, number] { return [ORIGIN.lat - p.y / 111320, ORIGIN.lng + p.x / METERS_LNG]; }
export function fromLatLng(lat: number, lng: number): Point { return { x: Math.round((lng - ORIGIN.lng) * METERS_LNG), y: Math.round((ORIGIN.lat - lat) * 111320) }; }
export function formatPoint(p: Point) { const [lat, lng] = toLatLng(p); return `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
export function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function regionArea(region: Extract<Task, { region: unknown }>["region"]) { return (region.southEast.x - region.northWest.x) * (region.southEast.y - region.northWest.y); }
export function validateTask(task: Task) {
  const points = task.type === "deliver" ? [task.pickup, task.dropoff] : [task.region.northWest, task.region.southEast];
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || distance(p, LAUNCH) > 3000)) throw new Error("Choose locations within 3 km of the simulated launch point.");
  if (task.type === "deliver") { if (distance(task.pickup, task.dropoff) < 10) throw new Error("Pickup and delivery must be at least 10 m apart."); }
  else if (task.region.southEast.x - task.region.northWest.x < 10 || task.region.southEast.y - task.region.northWest.y < 10) throw new Error("Select a region at least 10 m wide and 10 m tall.");
}
export function taskRoute(task: Task): Point[] {
  if (task.type === "deliver") return [LAUNCH, task.pickup, task.dropoff, LAUNCH];
  const { northWest: nw, southEast: se } = task.region;
  const sweep: Point[] = [];
  for (let row = 0; row < 4; row++) {
    const y = nw.y + (se.y - nw.y) * row / 3;
    sweep.push({ x: row % 2 ? se.x : nw.x, y }, { x: row % 2 ? nw.x : se.x, y });
  }
  return [LAUNCH, ...sweep, LAUNCH];
}
export function taskSteps(type: TaskType) { return ["Take off", type === "deliver" ? "Fly to pickup" : "Fly to region", type === "deliver" ? "Deliver package" : type === "search" ? "Search region" : "Scan inspection area", "Return to launch", "Land"]; }
export function taskSummary(task: Task) { return task.type === "deliver" ? `${Math.round(distance(task.pickup, task.dropoff))} m pickup to delivery` : `${(regionArea(task.region) / 10000).toFixed(2)} ha · sweep route`; }
