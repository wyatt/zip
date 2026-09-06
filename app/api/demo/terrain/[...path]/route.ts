import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { TERRAIN_CACHE_ROOT } from "@/lib/demo-terrain";

const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gz": "application/gzip",
  ".bin": "application/octet-stream",
};

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const parts = (await context.params).path;
  if (!parts.length || !/^[a-f0-9]{16}$/.test(parts[0] ?? "") || parts.some(part => part.includes("..") || part.includes("/") || part.includes("\\"))) {
    return new NextResponse("Not found", { status: 404 });
  }
  const full = resolve(join(TERRAIN_CACHE_ROOT, ...parts));
  if (relative(resolve(TERRAIN_CACHE_ROOT), full).startsWith("..") || normalize(full) !== full) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  try {
    const body = await readFile(full);
    return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": TYPES[extname(full)] ?? "application/octet-stream", "Cache-Control": "public, max-age=86400, immutable" } });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
