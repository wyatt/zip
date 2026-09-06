"use client";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { SurveyArea } from "@/lib/areas";
import type { GeoPoint } from "@/lib/operations";
import { addSatelliteTiles, SATELLITE_MAX_ZOOM } from "@/lib/satellite-tiles";

const latLng = (point: GeoPoint): L.LatLngTuple => [point.lat, point.lon];
const GENERIC_DRONE = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m10 10 12 12m0-12L10 22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><g fill="white" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="5"/><circle cx="24" cy="8" r="5"/><circle cx="8" cy="24" r="5"/><circle cx="24" cy="24" r="5"/></g><rect x="12" y="11" width="8" height="10" rx="3" fill="currentColor"/></svg>';
function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
type MapPin = { label: string; point: GeoPoint };
type FleetThumb = { src: string; label: string; count: number };
type FleetPin = { id: string; label: string; point: GeoPoint; src: string; highlighted?: boolean; thumbs?: FleetThumb[] };
type Props = { home: GeoPoint; selected?: GeoPoint; route?: GeoPoint[]; area?: SurveyArea; selectionPrompt?: string; position?: GeoPoint | null; stale?: boolean; chrome?: boolean; hideHome?: boolean; selectedLabel?: string; markers?: MapPin[]; fleet?: FleetPin[]; onSelect?: (point: GeoPoint) => void };
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
function fleetTooltip(aircraft: FleetPin) {
  if (!aircraft.thumbs?.length) return escapeHtml(aircraft.label);
  const tiles = aircraft.thumbs.map((thumb) => {
    const count = thumb.count > 1 ? `<span class="fleet-thumb-count">${thumb.count}</span>` : "";
    return `<span class="fleet-thumb" title="${escapeHtml(thumb.label)}"><img src="${escapeHtml(thumb.src)}" alt="${escapeHtml(thumb.label)}">${count}</span>`;
  }).join("");
  return `<span class="fleet-thumbs">${tiles}</span>`;
}
export default function GeographicMap({ home, selected, route, area, selectionPrompt, position, stale, chrome = true, hideHome, selectedLabel, markers, fleet, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), overlays = useRef<L.LayerGroup | null>(null), fleetLayers = useRef<L.LayerGroup | null>(null), drone = useRef<L.Marker | null>(null);
  const select = useRef(onSelect);
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(false);
  useEffect(() => { select.current = onSelect; }, [onSelect]);
  const initialHome = useRef(home);
  useEffect(() => {
    const instance = L.map(container.current!, { zoomControl: false, minZoom: 2, maxZoom: SATELLITE_MAX_ZOOM }).setView(latLng(initialHome.current), 17);
    map.current = instance;
    L.control.zoom({ position: "bottomright" }).addTo(instance); L.control.scale({ imperial: false }).addTo(instance);
    overlays.current = L.layerGroup().addTo(instance);
    fleetLayers.current = L.layerGroup().addTo(instance);
    addSatelliteTiles(instance, { onLoad: () => setLoaded(true), onError: () => setError(true) });
    instance.on("click", (event: L.LeafletMouseEvent) => select.current?.({ lat: event.latlng.lat, lon: event.latlng.lng }));
    const observer = new ResizeObserver(() => instance.invalidateSize()); observer.observe(container.current!);
    return () => { observer.disconnect(); instance.remove(); map.current = null; drone.current = null; };
  }, []);
  const geometry = JSON.stringify({ home, selected, route, area, hideHome, selectedLabel, markers, fleetIds: (fleet ?? []).map(item => item.id) });
  const fleetKey = JSON.stringify(fleet ?? []);
  useEffect(() => {
    if (!overlays.current || !map.current) return;
    const { home, selected, route, area, hideHome, selectedLabel, markers } = JSON.parse(geometry) as Props;
    overlays.current.clearLayers();
    if (!hideHome) L.circleMarker(latLng(home), { radius: 6, color: "#fff", weight: 2, fillColor: "white", fillOpacity: 1 }).bindTooltip("Launch", { permanent: true, direction: "right" }).addTo(overlays.current);
    if (selected) L.circleMarker(latLng(selected), { radius: 7, color: "#fff", weight: 2, fillColor: "#c45c38", fillOpacity: 1 }).bindTooltip(selectedLabel ?? "Job location", { permanent: true, direction: "right" }).addTo(overlays.current);
    for (const marker of markers ?? []) {
      L.circleMarker(latLng(marker.point), { radius: 6, color: "#fff", weight: 2, fillColor: "white", fillOpacity: 1 }).bindTooltip(marker.label, { permanent: true, direction: "right" }).addTo(overlays.current);
    }
    if (area) L.rectangle([latLng(area.northWest), latLng(area.southEast)], { color: "#fff", weight: 2, fillColor: "#c45c38", fillOpacity: .18, interactive: false }).addTo(overlays.current);
    if (route?.length) L.polyline(route.map(latLng), { color: "#ffd18a", weight: 3, opacity: 0.95 }).addTo(overlays.current);
    const fleetPoints = (fleetRef.current ?? []).map(item => item.point);
    const bounds = [home, ...(route ?? []), ...(area ? [area.northWest, area.southEast] : []), ...(selected ? [selected] : []), ...(markers ?? []).map(marker => marker.point), ...fleetPoints].map(latLng);
    if (!select.current) map.current.fitBounds(L.latLngBounds(bounds).pad(.3), { maxZoom: 16, animate: false });
  }, [geometry]);
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
    const element = drone.current.getElement(); if (element) { element.style.opacity = stale ? ".4" : "1"; element.dataset.lat = String(position.lat); element.dataset.lon = String(position.lon); }
  }, [position, stale]);
  useEffect(() => {
    if (!map.current || !select.current) return;
    map.current.setView(latLng(home), 17);
  }, [home.lat, home.lon]);
  return <div className={`map-wrap street-map-wrap${chrome ? "" : " map-bare"}`}>{chrome && <div className="street-toolbar"><strong>{onSelect ? selectionPrompt ?? "Choose the job location" : "Flight area"}</strong><button className="text-button" onClick={() => map.current?.fitBounds(L.latLngBounds([home, ...(route ?? []), ...(area ? [area.northWest, area.southEast] : []), ...(selected ? [selected] : []), ...(markers ?? []).map(marker => marker.point)].map(latLng)).pad(.3), { maxZoom: 16 })}>Fit flight area</button></div>}<div ref={container} className="street-map" data-testid="flight-map" data-tiles-loaded={loaded} />{chrome && onSelect && <div className="map-instruction"><span>{selectionPrompt ?? "Click the map to choose a location."}</span><button type="button" onClick={() => { const center = map.current?.getCenter(); if (center) onSelect({ lat: center.lat, lon: center.lng }); }}>Use map center</button></div>}{error && <p className="tile-error" role="status">Map unavailable. Try again shortly.</p>}</div>;
}
