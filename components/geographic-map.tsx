"use client";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { SurveyArea } from "@/lib/areas";
import type { GeoPoint } from "@/lib/operations";
import { addSatelliteTiles, SATELLITE_MAX_ZOOM } from "@/lib/satellite-tiles";

const latLng = (point: GeoPoint): L.LatLngTuple => [point.lat, point.lon];
type MapPin = { label: string; point: GeoPoint };
type Props = { home: GeoPoint; selected?: GeoPoint; route?: GeoPoint[]; area?: SurveyArea; selectionPrompt?: string; position?: GeoPoint | null; stale?: boolean; chrome?: boolean; hideHome?: boolean; selectedLabel?: string; markers?: MapPin[]; onSelect?: (point: GeoPoint) => void };
export default function GeographicMap({ home, selected, route, area, selectionPrompt, position, stale, chrome = true, hideHome, selectedLabel, markers, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), overlays = useRef<L.LayerGroup | null>(null), drone = useRef<L.Marker | null>(null);
  const select = useRef(onSelect);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(false);
  useEffect(() => { select.current = onSelect; }, [onSelect]);
  const initialHome = useRef(home);
  useEffect(() => {
    const instance = L.map(container.current!, { zoomControl: false, minZoom: 2, maxZoom: SATELLITE_MAX_ZOOM }).setView(latLng(initialHome.current), 17);
    map.current = instance;
    L.control.zoom({ position: "bottomright" }).addTo(instance); L.control.scale({ imperial: false }).addTo(instance);
    overlays.current = L.layerGroup().addTo(instance);
    addSatelliteTiles(instance, { onLoad: () => setLoaded(true), onError: () => setError(true) });
    instance.on("click", (event: L.LeafletMouseEvent) => select.current?.({ lat: event.latlng.lat, lon: event.latlng.lng }));
    const observer = new ResizeObserver(() => instance.invalidateSize()); observer.observe(container.current!);
    return () => { observer.disconnect(); instance.remove(); map.current = null; drone.current = null; };
  }, []);
  const geometry = JSON.stringify({ home, selected, route, area, hideHome, selectedLabel, markers });
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
    const bounds = [home, ...(route ?? []), ...(area ? [area.northWest, area.southEast] : []), ...(selected ? [selected] : []), ...(markers ?? []).map(marker => marker.point)].map(latLng);
    if (!select.current) map.current.fitBounds(L.latLngBounds(bounds).pad(.3), { maxZoom: 18, animate: false });
  }, [geometry]);
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
  return <div className={`map-wrap street-map-wrap${chrome ? "" : " map-bare"}`}>{chrome && <div className="street-toolbar"><strong>{onSelect ? selectionPrompt ?? "Choose the job location" : "Flight area"}</strong><button className="text-button" onClick={() => map.current?.fitBounds(L.latLngBounds([home, ...(route ?? []), ...(area ? [area.northWest, area.southEast] : []), ...(selected ? [selected] : []), ...(markers ?? []).map(marker => marker.point)].map(latLng)).pad(.3), { maxZoom: 18 })}>Fit flight area</button></div>}<div ref={container} className="street-map" data-testid="flight-map" data-tiles-loaded={loaded} />{chrome && onSelect && <div className="map-instruction"><span>{selectionPrompt ?? "Click the map to choose a location."}</span><button type="button" onClick={() => { const center = map.current?.getCenter(); if (center) onSelect({ lat: center.lat, lon: center.lng }); }}>Use map center</button></div>}{error && <p className="tile-error" role="status">Map unavailable. Try again shortly.</p>}</div>;
}
