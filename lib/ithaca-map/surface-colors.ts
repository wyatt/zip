export const surfaceTones = Object.freeze({
  grass: "#578b39",
  trees: "#367346",
  building: "#a5a8aa",
  road: "#85878a",
  water: "#337b91",
});

const grass = new Set([27, 34, 37, 43, 46, 51, 61, 71, 81, 83, 86]);
const trees = new Set([23, 24, 25, 26, 35, 38, 40, 41, 44, 52, 53, 54, 62, 63, 64, 72, 73, 74, 84]);

export function coverStyle(code: number) {
  if (grass.has(code)) return 1;
  if (trees.has(code)) return 2;
  if (code === 21) return 3;
  if ([20, 22, 31, 32].includes(code)) return 4;
  if ([10, 11, 12, 13, 14].includes(code)) return 5;
  return 0;
}

export function regionalCoverStyle(code: number) {
  return code === 0 ? 5 : coverStyle(code);
}

const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const srgb = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));
const tones = [null, ...Object.values(surfaceTones).map((hex) => [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255)))];

export function surfaceRGB(rgb: number[], code: number) {
  const photo = rgb.map((v) => linear(v / 255));
  const group = coverStyle(code);
  const detail = Math.min(1.45, Math.max(0.5, Math.sqrt((photo[0]! * 0.2126 + photo[1]! * 0.7152 + photo[2]! * 0.0722) / 0.2)));
  const color = !group ? photo : group === 3 ? tones[group]! : tones[group]!.map((v, i) => (group === 4 ? photo[i]! * 0.3 + v * detail * 0.7 : v * detail));
  return color.map(srgb);
}
