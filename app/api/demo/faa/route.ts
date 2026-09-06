import { NextResponse } from "next/server";
import { readCachedFaa } from "@/lib/demo-terrain";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!/^[a-f0-9]{16}$/.test(key)) return NextResponse.json({ error: "Invalid terrain key." }, { status: 400 });
  try {
    return NextResponse.json(await readCachedFaa(key));
  } catch {
    return NextResponse.json({ facility: { type: "FeatureCollection", features: [] }, nsfr: { type: "FeatureCollection", features: [] } });
  }
}
