import jpeg from "jpeg-js";

export function encodeInspectionFrame(data) {
  const { rows, cols, rgba } = data;
  const pixels = new Uint8Array(rows * cols * 4);
  for (let i = 0; i < rows * cols; i++) {
    const o = i * 4;
    if (rgba[o + 3]) {
      pixels[o] = rgba[o];
      pixels[o + 1] = rgba[o + 1];
      pixels[o + 2] = rgba[o + 2];
      pixels[o + 3] = 255;
    } else {
      const check = (Math.floor(i / cols) + (i % cols)) & 1;
      pixels[o] = check ? 32 : 38;
      pixels[o + 1] = check ? 48 : 57;
      pixels[o + 2] = check ? 56 : 65;
      pixels[o + 3] = 255;
    }
  }
  return Buffer.from(jpeg.encode({ data: pixels, width: cols, height: rows }, 88).data);
}

/** Fallback pass-by-pass coverage when regional orthophotos are unavailable. */
export function encodeCoverageFrame(photos, totalPhotos, cols = 32, rows = 24) {
  const pixels = new Uint8Array(rows * cols * 4);
  const total = Math.max(1, Number(totalPhotos) || 1);
  const filled = Math.max(0, Math.min(total, Number(photos) || 0));
  for (let i = 0; i < rows * cols; i++) {
    const o = i * 4;
    const captured = i / (rows * cols) < filled / total;
    const check = (Math.floor(i / cols) + (i % cols)) & 1;
    pixels[o] = captured ? 210 : check ? 32 : 38;
    pixels[o + 1] = captured ? 168 : check ? 48 : 57;
    pixels[o + 2] = captured ? 72 : check ? 56 : 65;
    pixels[o + 3] = 255;
  }
  return Buffer.from(jpeg.encode({ data: pixels, width: cols, height: rows }, 80).data);
}
