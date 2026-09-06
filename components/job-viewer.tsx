"use client";
import { useState } from "react";
import type { AircraftSample, GeoPoint, RoutePoint } from "@/lib/operations";
import type { SurveyArea } from "@/lib/areas";
import { MissionScene } from "./flight-map";
import { useTelemetryPlayback } from "./telemetry-playback";

type ViewMode = "top" | "orbit";

export function JobViewer({
  home,
  area,
  sample,
  sessionId,
  destinations,
  previewPosition,
  spriteSrc,
}: {
  home: GeoPoint;
  area?: SurveyArea;
  sample?: AircraftSample;
  sessionId?: string;
  destinations?: RoutePoint[];
  previewPosition?: GeoPoint;
  spriteSrc?: string;
}) {
  const display = useTelemetryPlayback(sample, sessionId);
  const [viewMode, setViewMode] = useState<ViewMode>("top");
  const live = display ?? sample;
  return (
    <div className={`mission-scene-wrap map-bare${viewMode === "orbit" ? " is-orbit" : ""}`}>
      <nav className="view-tools" role="tablist" aria-label="Map view">
        <button
          type="button"
          role="tab"
          className={`view-tab${viewMode === "top" ? " active" : ""}`}
          aria-selected={viewMode === "top"}
          onClick={() => setViewMode("top")}
        >
          2D
        </button>
        <button
          type="button"
          role="tab"
          className={`view-tab${viewMode === "orbit" ? " active" : ""}`}
          aria-selected={viewMode === "orbit"}
          title="Tilt the Ithaca map into 3D"
          onClick={() => setViewMode("orbit")}
        >
          3D
        </button>
      </nav>
      <MissionScene
        sample={live}
        home={home}
        viewMode={viewMode}
        area={area}
        destinations={live?.mission?.path ?? destinations}
        previewPosition={live?.position ? undefined : previewPosition}
        spriteSrc={spriteSrc}
      />
    </div>
  );
}
