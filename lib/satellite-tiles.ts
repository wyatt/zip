import L from "leaflet";

export const SATELLITE_MAX_ZOOM = 21;

export function addSatelliteTiles(
  map: L.Map,
  handlers?: { onLoad?: () => void; onError?: () => void },
): L.TileLayer {
  const layer = L.tileLayer("https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
    subdomains: ["0", "1", "2", "3"],
    maxZoom: SATELLITE_MAX_ZOOM,
    maxNativeZoom: 21,
    attribution: '&copy; <a href="https://www.google.com/maps">Google</a>',
  }).addTo(map);
  if (handlers?.onLoad) layer.once("load", handlers.onLoad);
  if (handlers?.onError) layer.on("tileerror", handlers.onError);
  return layer;
}
