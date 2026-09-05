"use client";
import { useEffect, useRef, useState } from "react";
import type { AircraftSample } from "@/lib/operations";

type Frame = { sample: AircraftSample; received: number };
/** 150 ms presentation buffer, interpolation only. Never extrapolates or advances mission state. */
export function useTelemetryPlayback(sample: AircraftSample | undefined, sessionId: string | undefined) {
  const frames = useRef<Frame[]>([]);
  const session = useRef(sessionId);
  const [display, setDisplay] = useState<AircraftSample | undefined>(sample);
  useEffect(() => {
    if (!sample) { frames.current = []; setDisplay(undefined); return; }
    if (session.current !== sessionId) { frames.current = []; session.current = sessionId; }
    if (frames.current.at(-1)?.sample.sequence === sample.sequence) return;
    frames.current.push({ sample, received: performance.now() });
    if (frames.current.length > 30) frames.current.shift();
  }, [sample, sessionId]);
  useEffect(() => {
    let frameId = 0;
    const render = () => {
      const queue = frames.current, target = performance.now() - 150;
      const after = queue.findIndex(frame => frame.received >= target);
      if (queue.length) {
        const right = after < 0 ? queue.at(-1)! : queue[after];
        const left = after > 0 ? queue[after - 1] : right;
        const fraction = left === right ? 1 : Math.max(0, Math.min(1, (target - left.received) / (right.received - left.received)));
        const a = left.sample, b = right.sample;
        const interpolate = (x: number | null, y: number | null) => x === null || y === null ? y : x + (y - x) * fraction;
        setDisplay({ ...b, position: a.position && b.position ? { lat: a.position.lat + (b.position.lat - a.position.lat) * fraction, lon: a.position.lon + (b.position.lon - a.position.lon) * fraction } : b.position, altitudeM: interpolate(a.altitudeM, b.altitudeM), speedMps: interpolate(a.speedMps, b.speedMps) });
      }
      frameId = requestAnimationFrame(render);
    };
    frameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frameId);
  }, []);
  return display;
}
