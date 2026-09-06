import { NextResponse } from "next/server";
import { ensureTerrainRegion } from "@/lib/demo-terrain";

export const maxDuration = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: "Invalid location." }, { status: 400 });
  }
  const region = await ensureTerrainRegion({ lat, lon }, 2000);
  return NextResponse.json({
    key: region.key,
    origin: region.origin,
    size: region.size,
    zMin: region.zMin,
    zMax: region.zMax,
  }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
