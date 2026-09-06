"use client";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { SurveyArea } from "@/lib/areas";
import type { GeoPoint } from "@/lib/operations";
import { fromLocal, toLocal } from "@/lib/geo-local";
import { ITHACA_HOME, ITHACA_REGION_API, ITHACA_SIZE_M } from "@/lib/ithaca";
import { addSatelliteTiles, SATELLITE_MAX_ZOOM } from "@/lib/satellite-tiles";

const latLng = (point: GeoPoint): L.LatLngTuple => [point.lat, point.lon];
const GENERIC_DRONE = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m10 10 12 12m0-12L10 22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><g fill="white" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="5"/><circle cx="24" cy="8" r="5"/><circle cx="8" cy="24" r="5"/><circle cx="24" cy="24" r="5"/></g><rect x="12" y="11" width="8" height="10" rx="3" fill="currentColor"/></svg>';
function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
type MapPin = { id?: string; label: string; point: GeoPoint };
type FleetThumb = { src: string; label: string; count: number };
type FleetPin = { id: string; label: string; point: GeoPoint; src: string; highlighted?: boolean; thumbs?: FleetThumb[] };
type Props = { home: GeoPoint; selected?: GeoPoint; route?: GeoPoint[]; area?: SurveyArea; selectionPrompt?: string; position?: GeoPoint | null; stale?: boolean; chrome?: boolean; hideHome?: boolean; selectedLabel?: string; markers?: MapPin[]; fleet?: FleetPin[]; trail?: GeoPoint[]; faa?: { facility?: GeoJSON.GeoJsonObject; nsfr?: GeoJSON.GeoJsonObject }; onSelect?: (point: GeoPoint) => void; onMarkerMove?: (id: string, point: GeoPoint) => void };
function pinIcon(label: string) {
  return L.divIcon({
    className: "job-pin",
    html: `<span class="job-pin-btn" role="img" aria-label="${escapeHtml(label)}">${escapeHtml(label)}</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}
function fleetIcon(aircraft: FleetPin, dimmed: boolean) {
  const src = escapeHtml(aircraft.src);
  const label = escapeHtml(aircraft.label);
  const stacked = (aircraft.thumbs?.reduce((sum, thumb) => sum + thumb.count, 0) ?? 0) > 1;
  const selected = aircraft.highlighted ? " highlighted" : dimmed ? " dimmed" : "";
  const inner = stacked
    ? GENERIC_DRONE
    : `<img src="${src}" alt="" width="24" height="24">`;
  return L.divIcon({
    className: `aircraft-marker fleet-marker${stacked ? " stacked" : ""}${selected}`,
    html: `<span data-testid="${aircraft.highlighted ? "selected-drone" : "available-drone"}" role="img" aria-label="${label}">${inner}</span>`,
    iconSize: aircraft.highlighted ? [40, 40] : [32, 32],
    iconAnchor: aircraft.highlighted ? [20, 20] : [16, 16],
  });
}
function attachIthacaDetail(map: L.Map) {
  const group = L.layerGroup().addTo(map);
  const shown = new Map<string, L.ImageOverlay>();
  let tiles: { id: string; west: number; north: number; size: number }[] = [];
  const update = () => {
    const mpp = 40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180) / (256 * 2 ** map.getZoom());
    const view = map.getBounds();
    const sw = toLocal(ITHACA_HOME, { lat: view.getSouth(), lon: view.getWest() });
    const ne = toLocal(ITHACA_HOME, { lat: view.getNorth(), lon: view.getEast() });
    const half = ITHACA_SIZE_M / 2;
    const inside = ne.east > -half && sw.east < half && ne.north > -half && sw.north < half;
    const cx = (sw.east + ne.east) / 2, cy = (sw.north + ne.north) / 2;
    const wanted = mpp < 2.5 && inside
      ? tiles.filter((tile) =>
          tile.west < ne.east && tile.west + tile.size > sw.east &&
          tile.north > sw.north && tile.north - tile.size < ne.north
        ).sort((a, b) =>
          Math.hypot(a.west + a.size / 2 - cx, a.north - a.size / 2 - cy) -
          Math.hypot(b.west + b.size / 2 - cx, b.north - b.size / 2 - cy)
        ).slice(0, 4)
      : [];
    const keep = new Set(wanted.map((tile) => tile.id));
    for (const [id, overlay] of shown) {
      if (keep.has(id)) continue;
      group.removeLayer(overlay);
      shown.delete(id);
    }
    for (const tile of wanted) {
      if (shown.has(tile.id)) continue;
      const nw = fromLocal(ITHACA_HOME, { east: tile.west, north: tile.north });
      const se = fromLocal(ITHACA_HOME, { east: tile.west + tile.size, north: tile.north - tile.size });
      const overlay = L.imageOverlay(`${ITHACA_REGION_API}tiles/${tile.id}/aerial.jpg`, [[se.lat, nw.lon], [nw.lat, se.lon]], {
        opacity: 1,
        interactive: false,
        className: "ithaca-detail",
      });
      overlay.addTo(group);
      shown.set(tile.id, overlay);
    }
  };
  void fetch(`${ITHACA_REGION_API}manifest.json`)
    .then((response) => (response.ok ? response.json() : Promise.reject()))
    .then((meta: { tiles: typeof tiles }) => { tiles = meta.tiles; update(); })
    .catch(() => undefined);
  map.on("moveend zoomend", update);
  return () => { map.off("moveend zoomend", update); group.remove(); };
}
function fleetTooltip(aircraft: FleetPin) {
  if (!aircraft.thumbs?.length) return escapeHtml(aircraft.label);
  const tiles = aircraft.thumbs.map((thumb) => {
    const count = thumb.count > 1 ? `<span class="fleet-thumb-count">${thumb.count}</span>` : "";
    return `<span class="fleet-thumb" title="${escapeHtml(thumb.label)}"><img src="${escapeHtml(thumb.src)}" alt="${escapeHtml(thumb.label)}">${count}</span>`;
  }).join("");
  return `<span class="fleet-thumbs">${tiles}</span>`;
}
export default function GeographicMap({ home, selected, route, area, selectionPrompt, position, stale, chrome = true, hideHome, selectedLabel, markers, fleet, trail, faa, onSelect, onMarkerMove }: Props) {
  const container = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), overlays = useRef<L.LayerGroup | null>(null), pinLayers = useRef<L.LayerGroup | null>(null), fleetLayers = useRef<L.LayerGroup | null>(null), drone = useRef<L.Marker | null>(null), faaLayer = useRef<L.LayerGroup | null>(null), trailLine = useRef<L.Polyline | null>(null);
  const select = useRef(onSelect);
  const movePin = useRef(onMarkerMove);
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(false);
  useEffect(() => { select.current = onSelect; }, [onSelect]);
  useEffect(() => { movePin.current = onMarkerMove; }, [onMarkerMove]);
  const initialHome = useRef(home);
  const framedSelection = useRef(false);
  useEffect(() => {
    const instance = L.map(container.current!, { zoomControl: false, minZoom: 2, maxZoom: SATELLITE_MAX_ZOOM }).setView(latLng(initialHome.current), 17);
    map.current = instance;
    L.control.zoom({ position: "bottomright" }).addTo(instance); L.control.scale({ imperial: false }).addTo(instance);
    overlays.current = L.layerGroup().addTo(instance);
    pinLayers.current = L.layerGroup().addTo(instance);
    fleetLayers.current = L.layerGroup().addTo(instance);
    faaLayer.current = L.layerGroup().addTo(instance);
    addSatelliteTiles(instance, { onLoad: () => setLoaded(true), onError: () => setError(true) });
    const detachDetail = attachIthacaDetail(instance);
    instance.on("click", (event: L.LeafletMouseEvent) => select.current?.({ lat: event.latlng.lat, lon: event.latlng.lng }));
    const observer = new ResizeObserver(() => instance.invalidateSize()); observer.observe(container.current!);
    return () => { detachDetail(); observer.disconnect(); instance.remove(); map.current = null; drone.current = null; };
  }, []);
  const geometry = JSON.stringify({ home, selected, route, area, hideHome, selectedLabel, fleetIds: (fleet ?? []).map(item => item.id) });
  const pinKey = JSON.stringify((markers ?? []).map((marker) => ({ id: marker.id ?? marker.label, label: marker.label, lat: marker.point.lat, lon: marker.point.lon })));
  const fleetKey = JSON.stringify(fleet ?? []);
  const faaKey = JSON.stringify(faa ?? null);
  const trailKey = JSON.stringify(trail ?? []);
  useEffect(() => {
    if (!overlays.current || !map.current) return;
    const { home, selected, route, area, hideHome, selectedLabel, markers } = JSON.parse(geometry) as Props;
    overlays.current.clearLayers();
    if (!hideHome) L.circleMarker(latLng(home), { radius: 6, color: "#fff", weight: 2, fillColor: "white", fillOpacity: 1 }).bindTooltip("Launch", { permanent: true, direction: "right" }).addTo(overlays.current);
    if (selected) L.circleMarker(latLng(selected), { radius: 7, color: "#fff", weight: 2, fillColor: "#c45c38", fillOpacity: 1 }).bindTooltip(selectedLabel ?? "Job location", { permanent: true, direction: "right" }).addTo(overlays.current);
    if (area) L.rectangle([latLng(area.northWest), latLng(area.southEast)], { color: "#fff", weight: 2, fillColor: "#c45c38", fillOpacity: .18, interactive: false }).addTo(overlays.current);
    if (route?.length) L.polyline(route.map(latLng), { color: "#ffd18a", weight: 3, opacity: 0.95 }).addTo(overlays.current);
    const fleetPoints = (fleetRef.current ?? []).map(item => item.point);
    const bounds = [home, ...(route ?? []), ...(area ? [area.northWest, area.southEast] : []), ...(selected ? [selected] : []), ...fleetPoints].map(latLng);
    if (!select.current) map.current.fitBounds(L.latLngBounds(bounds).pad(.3), { maxZoom: 16, animate: false });
  }, [geometry]);
  useEffect(() => {
    if (!pinLayers.current) return;
    pinLayers.current.clearLayers();
    for (const marker of JSON.parse(pinKey) as { id: string; label: string; lat: number; lon: number }[]) {
      const pin = L.marker([marker.lat, marker.lon], {
        draggable: !!movePin.current,
        autoPan: true,
        bubblingMouseEvents: false,
        zIndexOffset: 600,
        icon: pinIcon(marker.label),
      }).bindTooltip(marker.label === "A" ? "Pickup" : marker.label === "B" ? "Drop-off" : marker.label, { direction: "top" });
      pin.on("click", (event) => L.DomEvent.stopPropagation(event));
      pin.on("dragend", () => {
        const next = pin.getLatLng();
        movePin.current?.(marker.id, { lat: next.lat, lon: next.lng });
      });
      pin.addTo(pinLayers.current);
    }
  }, [pinKey]);
  useEffect(() => {
    if (!fleetLayers.current) return;
    const aircraft = JSON.parse(fleetKey) as FleetPin[];
    const dimOthers = aircraft.some(item => item.highlighted);
    fleetLayers.current.clearLayers();
    for (const item of aircraft) {
      L.marker(latLng(item.point), {
        interactive: true,
        bubblingMouseEvents: false,
        zIndexOffset: item.highlighted ? 700 : 400,
        icon: fleetIcon(item, dimOthers && !item.highlighted),
      }).bindTooltip(fleetTooltip(item), { direction: "top", opacity: 1, ...(item.thumbs?.length ? { className: "fleet-thumbs-tooltip" } : {}) }).addTo(fleetLayers.current);
    }
  }, [fleetKey]);
  useEffect(() => {
    if (!map.current) return;
    if (!position) { drone.current?.remove(); drone.current = null; return; }
    if (!drone.current) drone.current = L.marker(latLng(position), { interactive: false, icon: L.divIcon({ className: "aircraft-marker", html: '<span data-testid="aircraft-marker" aria-label="Drone position">✣</span>', iconSize: [42, 42], iconAnchor: [21, 21] }) }).addTo(map.current);
    drone.current.setLatLng(latLng(position));
    if (!select.current) map.current.panTo(latLng(position), { animate: false });
    const element = drone.current.getElement(); if (element) { element.style.opacity = stale ? ".4" : "1"; element.dataset.lat = String(position.lat); element.dataset.lon = String(position.lon); }
  }, [position, stale]);
  useEffect(() => {
    if (!map.current) return;
    const points = trail ?? [];
    if (!points.length) { trailLine.current?.remove(); trailLine.current = null; return; }
    const latlngs = points.map(latLng);
    if (!trailLine.current) trailLine.current = L.polyline(latlngs, { color: "#ffd18a", weight: 3, opacity: 0.95 }).addTo(map.current);
    else trailLine.current.setLatLngs(latlngs);
  }, [trailKey]);
  useEffect(() => {
    if (!faaLayer.current) return;
    faaLayer.current.clearLayers();
    const data = faaKey ? JSON.parse(faaKey) as Props["faa"] : null;
    if (data?.facility) L.geoJSON(data.facility, { style: { color: "#c9a227", weight: 1, fillOpacity: 0.12 }, interactive: false }).addTo(faaLayer.current);
    if (data?.nsfr) L.geoJSON(data.nsfr, { style: { color: "#b42318", weight: 1, fillOpacity: 0.16 }, interactive: false }).addTo(faaLayer.current);
  }, [faaKey]);
  useEffect(() => {
    if (!map.current || !select.current || framedSelection.current) return;
    const fleetPoints = (fleetRef.current ?? []).map(item => item.point);
    if (!fleetPoints.length) return;
    map.current.fitBounds(L.latLngBounds([initialHome.current, ...fleetPoints].map(latLng)).pad(.35), { maxZoom: 15, animate: false });
    framedSelection.current = true;
  }, [fleetKey]);
  return <div className={`map-wrap street-map-wrap${chrome ? "" : " map-bare"}`}>{chrome && <div className="street-toolbar"><strong>{onSelect ? selectionPrompt ?? "Choose the job location" : "Flight area"}</strong><button className="text-button" onClick={() => map.current?.fitBounds(L.latLngBounds([home, ...(route ?? []), ...(area ? [area.northWest, area.southEast] : []), ...(selected ? [selected] : []), ...(markers ?? []).map(marker => marker.point)].map(latLng)).pad(.3), { maxZoom: 16 })}>Fit flight area</button></div>}<div ref={container} className="street-map" data-testid="flight-map" data-tiles-loaded={loaded} />{chrome && onSelect && <div className="map-instruction"><span>{selectionPrompt ?? "Click the map to choose a location."}</span><button type="button" onClick={() => { const center = map.current?.getCenter(); if (center) onSelect({ lat: center.lat, lon: center.lng }); }}>Use map center</button></div>}{error && <p className="tile-error" role="status">Map unavailable. Try again shortly.</p>}</div>;
}
