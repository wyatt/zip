"use client";
import { useEffect, useState } from "react";
import { previewAcceptedFlight } from "@/lib/operations";
import { planAcceptedRoute, type RegionalJobInput, type RoutePreview } from "@/lib/regional-plan";

export function useRegionalAcceptPreview(input: RegionalJobInput | null) {
  const [preview, setPreview] = useState<RoutePreview | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState("");
  const key = input
    ? [
        input.kind,
        input.home.lat,
        input.home.lon,
        input.location.lat,
        input.location.lon,
        input.area?.northWest.lat,
        input.area?.northWest.lon,
        input.area?.southEast.lat,
        input.area?.southEast.lon,
        input.destinations.map((point) => `${point.lat},${point.lon}`).join(";"),
        input.altitudeM,
        input.hoverSec,
      ].join("|")
    : "";
  useEffect(() => {
    if (!input) {
      setPreview(null);
      setPlanning(false);
      setError("");
      return;
    }
    let cancelled = false;
    setError("");
    if (input.kind === "flight_check") {
      setPreview({ ...previewAcceptedFlight(input), planned: false });
      setPlanning(false);
      return;
    }
    setPlanning(true);
    void planAcceptedRoute(input)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setPlanning(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setPreview({ ...previewAcceptedFlight(input), planned: false });
        setPlanning(false);
        setError(caught instanceof Error ? caught.message : "Route planning failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return { preview, planning, error };
}
