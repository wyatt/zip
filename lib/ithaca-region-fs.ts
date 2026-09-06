import { existsSync } from "node:fs";
import { join } from "node:path";

export function ithacaRegionRoot(cwd = process.cwd()) {
  const candidates = [
    join(cwd, "data", "ithaca-region"),
    join(cwd, "Drone_Simulation", "viewer", "public", "region"),
  ];
  return candidates.find((dir) => existsSync(join(dir, "manifest.json")));
}
