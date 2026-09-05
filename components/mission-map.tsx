"use client";
import dynamic from "next/dynamic";
export const MissionMap = dynamic(() => import("./street-map"), { ssr: false, loading: () => <div className="map-loading">Loading street map…</div> });
