const HEADER_BYTES = 24;

function magic(bytes: Uint8Array) {
  return String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
}

export function decodeTerrainBuffer(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < HEADER_BYTES || magic(bytes) !== "RT16") throw new Error("Invalid regional terrain tile");
  const view = new DataView(buffer);
  const version = view.getUint8(4);
  const flags = view.getUint8(5);
  if (version !== 1 || (flags & 1) !== 1) throw new Error("Unsupported regional terrain encoding");
  const rows = view.getUint16(6, true);
  const cols = view.getUint16(8, true);
  const base = view.getFloat32(10, true);
  const scale = view.getFloat32(14, true);
  const count = view.getUint32(18, true);
  const maskBytes = Math.ceil(count / 8);
  const expected = HEADER_BYTES + count * 3 + maskBytes;
  if (!rows || !cols || rows * cols !== count || !Number.isFinite(base) || !(scale > 0) || bytes.byteLength !== expected) {
    throw new Error("Misaligned regional terrain tile");
  }
  const quantized = new Uint16Array(buffer, HEADER_BYTES, count);
  const codes = new Uint8Array(buffer, HEADER_BYTES + count * 2, count);
  const measured = new Uint8Array(buffer, HEADER_BYTES + count * 3, maskBytes);
  const heights = new Float32Array(count);
  for (let i = 0; i < count; i++) heights[i] = quantized[i] === 65535 ? Number.NaN : base + quantized[i]! * scale;
  return { rows, cols, heights, codes, measured, measuredPacked: true as const, base, scale };
}

async function gunzip(buffer: ArrayBuffer) {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot decompress regional terrain tiles");
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function fetchTerrain(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Regional tile: HTTP ${response.status}`);
  let buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) buffer = await gunzip(buffer);
  return decodeTerrainBuffer(buffer);
}

export function isMeasured(tile: { measuredPacked?: boolean; measured: Uint8Array }, index: number) {
  return tile.measuredPacked ? !!(tile.measured[index >> 3]! & (1 << (index & 7))) : !!tile.measured[index];
}
