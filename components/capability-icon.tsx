import { Box } from "pixelarticons/react/Box";
import { Camera } from "pixelarticons/react/Camera";
import type { OptionalTag } from "@/lib/aircraft";

const ICONS = {
  camera: Camera,
  payload: Box,
} as const;

export function CapabilityIcon({ id, size = 24 }: { id: OptionalTag; size?: number }) {
  const Icon = ICONS[id];
  return <Icon width={size} height={size} aria-hidden />;
}
