import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { TERRAIN_CACHE_ROOT } from "../lib/demo-terrain";
import { ITHACA_REGION_KEY } from "../lib/ithaca";
import { ithacaRegionRoot } from "../lib/ithaca-region-fs";

const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gz": "application/gzip",
  ".bin": "application/octet-stream",
};

export function startDemoHttp(port: number, getJpeg: (hardwareId?: string) => Buffer | null) {
  const server = createServer((req, res) => {
    void handle(req, res, getJpeg);
  });
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise((done, fail) => server.close(err => err ? fail(err) : done())),
      });
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, getJpeg: (hardwareId?: string) => Buffer | null) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  res.setHeader("Access-Control-Allow-Origin", "*");
  const camera = url.pathname.match(/^\/camera(?:\/([^/]+))?\.mjpg$/);
  if (camera) {
    const hardwareId = camera[1] ? decodeURIComponent(camera[1]) : undefined;
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=frame",
      "Cache-Control": "no-cache",
      Connection: "close",
    });
    const timer = setInterval(() => {
      const jpeg = getJpeg(hardwareId);
      if (!jpeg || res.destroyed) return;
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
      res.write(jpeg);
      res.write("\r\n");
    }, 200);
    req.on("close", () => clearInterval(timer));
    return;
  }
  const prefix = "/terrain/";
  if (!url.pathname.startsWith(prefix)) {
    res.writeHead(404); res.end(); return;
  }
  const rel = decodeURIComponent(url.pathname.slice(prefix.length));
  const ithacaPrefix = `${ITHACA_REGION_KEY}/`;
  const root = rel.startsWith(ithacaPrefix) ? ithacaRegionRoot() : TERRAIN_CACHE_ROOT;
  const fileRel = rel.startsWith(ithacaPrefix) ? rel.slice(ithacaPrefix.length) : rel;
  if (!root || !fileRel || fileRel.includes("..")) {
    res.writeHead(rel.startsWith(ithacaPrefix) ? 503 : 404); res.end(); return;
  }
  const full = resolve(join(root, fileRel));
  if (relative(resolve(root), full).startsWith("..") || normalize(full) !== full) {
    res.writeHead(403); res.end(); return;
  }
  try {
    const info = await stat(full);
    if (!info.isFile()) throw new Error("not a file");
    res.writeHead(200, { "Content-Type": TYPES[extname(full)] ?? "application/octet-stream", "Cache-Control": "public, max-age=86400, immutable" });
    createReadStream(full).pipe(res);
  } catch {
    res.writeHead(404); res.end();
  }
}
