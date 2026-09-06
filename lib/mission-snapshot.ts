export const DEMO_PHASE_LABELS: Record<string, string> = {
  ready: "Ready to fly",
  outbound: "Flying to task",
  deliver: "Delivering package",
  survey: "Capturing inspection mosaic",
  inspection: "Inspecting area",
  search: "Searching area",
  found: "Target found",
  return: "Returning to A",
  complete: "Mission complete",
  mission_complete: "Mission complete",
  error: "Mission stopped",
  takeoff: "Taking off",
  landing: "Landing",
  grounded: "On the ground",
};

export function clock(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(n / 3600)).padStart(2, "0")}:${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
