import { assertGeo, metersBetween, type GeoPoint } from "./operations";

export type SurveyArea = { northWest: GeoPoint; southEast: GeoPoint };
export function surveyArea(first: GeoPoint, second: GeoPoint): SurveyArea {
  return { northWest: { lat: Math.max(first.lat, second.lat), lon: Math.min(first.lon, second.lon) }, southEast: { lat: Math.min(first.lat, second.lat), lon: Math.max(first.lon, second.lon) } };
}
export function areaGeometry(area: SurveyArea) {
  const { northWest: nw, southEast: se } = area;
  assertGeo(nw); assertGeo(se);
  const widthM = metersBetween(nw, { lat: nw.lat, lon: se.lon });
  const heightM = metersBetween(nw, { lat: se.lat, lon: nw.lon });
  if (nw.lat <= se.lat || nw.lon >= se.lon || widthM < 10 || heightM < 10) throw new Error("Choose an area at least 10 meters wide and tall.");
  if (widthM > 1000 || heightM > 1000) throw new Error("Choose an area no more than 1 km wide or tall.");
  const intervals = Math.max(2, Math.min(24, Math.ceil(heightM / 20)));
  const destinations: GeoPoint[] = [];
  for (let row = 0; row <= intervals; row++) {
    const lat = nw.lat + (se.lat - nw.lat) * row / intervals;
    destinations.push({ lat, lon: row % 2 ? se.lon : nw.lon }, { lat, lon: row % 2 ? nw.lon : se.lon });
  }
  return { widthM, heightM, areaM2: widthM * heightM, destinations, center: { lat: (nw.lat + se.lat) / 2, lon: (nw.lon + se.lon) / 2 } };
}
