"use client";
import dynamic from "next/dynamic";
export const FlightMap = dynamic(() => import("./geographic-map"), { ssr: false, loading: () => <div className="map-loading">Loading map…</div> });
