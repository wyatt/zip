"use client";
import { useEffect, useState } from "react";
import type { GeoPoint } from "@/lib/operations";

export const FALLBACK_LOCATION: GeoPoint = { lat: 42.35596, lon: -71.07029 };

export function useBrowserLocation() {
  const [point, setPoint] = useState<GeoPoint>(FALLBACK_LOCATION);
  const [fromBrowser, setFromBrowser] = useState(false);
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return;
        setPoint({ lat: coords.latitude, lon: coords.longitude });
        setFromBrowser(true);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 8_000 },
    );
  }, []);
  return { point, fromBrowser };
}
