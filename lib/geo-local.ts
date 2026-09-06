import type { GeoPoint } from "./operations";

export type LocalMeters = { east: number; north: number };

export function metersPerDegree(lat: number) {
  return { north: 111320, east: 111320 * Math.cos((lat * Math.PI) / 180) };
}

export function toLocal(origin: GeoPoint, point: GeoPoint): LocalMeters {
  const m = metersPerDegree(origin.lat);
  return { east: (point.lon - origin.lon) * m.east, north: (point.lat - origin.lat) * m.north };
}

export function fromLocal(origin: GeoPoint, local: LocalMeters): GeoPoint {
  const m = metersPerDegree(origin.lat);
  return { lat: origin.lat + local.north / m.north, lon: origin.lon + local.east / m.east };
}

export function ringFromArea(area: { northWest: GeoPoint; southEast: GeoPoint }, origin: GeoPoint): number[][] {
  const nw = toLocal(origin, area.northWest);
  const se = toLocal(origin, area.southEast);
  return [
    [nw.east, nw.north],
    [se.east, nw.north],
    [se.east, se.north],
    [nw.east, se.north],
  ];
}
