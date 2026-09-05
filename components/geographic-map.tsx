"use client";
import L from "leaflet";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { useEffect, useRef, useState } from "react";
import type { SurveyArea } from "@/lib/areas";
import type { GeoPoint } from "@/lib/operations";
import { cleanMapStyle } from "@/lib/map-style";

const latLng = (point: GeoPoint): L.LatLngTuple => [point.lat, point.lon];
type Props = { home: GeoPoint; selected?: GeoPoint; route?: GeoPoint[]; area?: SurveyArea; selectionPrompt?: string; position?: GeoPoint | null; stale?: boolean; onSelect?: (point: GeoPoint) => void };
export default function GeographicMap({ home, selected, route, area, selectionPrompt, position, stale, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), overlays = useRef<L.LayerGroup | null>(null), drone = useRef<L.Marker | null>(null);
  const select = useRef(onSelect);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(false);
  useEffect(() => { select.current = onSelect; }, [onSelect]);
  const initialHome = useRef(home);
  useEffect(() => {
    const instance = L.map(container.current!, { zoomControl: false, minZoom: 2, maxZoom: 19 }).setView(latLng(initialHome.current), 17);
    map.current = instance;
    L.control.zoom({ position: "bottomright" }).addTo(instance); L.control.scale({ imperial: false }).addTo(instance);
    instance.attributionControl.addAttribution('<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">OpenMapTiles</a> · &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
    overlays.current = L.layerGroup().addTo(instance);
    const abort = new AbortController();
    void fetch("https://tiles.openfreemap.org/styles/liberty", { signal: abort.signal }).then(r => { if (!r.ok) throw new Error("Map unavailable"); return r.json(); }).then(style => {
      if (abort.signal.aborted) return;
      const layer = maplibreGL({ style: cleanMapStyle(style), attributionControl: false }).addTo(instance);
      layer.getMaplibreMap().on("idle", () => setLoaded(true));
      layer.getMaplibreMap().on("error", () => setError(true));
    }).catch(() => { if (!abort.signal.aborted) setError(true); });
    instance.on("click", (event: L.LeafletMouseEvent) => select.current?.({ lat: event.latlng.lat, lon: event.latlng.lng }));
    const observer = new ResizeObserver(() => instance.invalidateSize()); observer.observe(container.current!);
    return () => { abort.abort(); observer.disconnect(); instance.remove(); map.current = null; drone.current = null; };
  }, []);
  const geometry = JSON.stringify({ home, selected, route, area });
  useEffect(() => {
    if (!overlays.current || !map.current) return;
    const { home, selected, route, area } = JSON.parse(geometry) as Props;
    overlays.current.clearLayers();
    L.circleMarker(latLng(home), { radius: 6, color: "#11140f", fillColor: "white", fillOpacity: 1 }).bindTooltip("Launch", { permanent: true, direction: "right" }).addTo(overlays.current);
    if (selected) L.circleMarker(latLng(selected), { radius: 7, color: "#11140f", fillColor: "#c5f429", fillOpacity: 1 }).bindTooltip("Job location", { permanent: true, direction: "right" }).addTo(overlays.current);
    if (area) L.rectangle([latLng(area.northWest), latLng(area.southEast)], { color: "#658500", weight: 2, fillColor: "#c5f429", fillOpacity: .15, interactive: false }).addTo(overlays.current);
    if (route?.length) L.polyline(route.map(latLng), { color: "#3977d5", weight: 2 }).addTo(overlays.current);
    if (!select.current) map.current.fitBounds(L.latLngBounds([home, ...(route ?? []), ...(area ? [area.northWest, area.southEast] : []), ...(selected ? [selected] : [])].map(latLng)).pad(.3), { maxZoom: 18, animate: false });
  }, [geometry]);
  useEffect(() => {
    if (!map.current) return;
    if (!position) { drone.current?.remove(); drone.current = null; return; }
    if (!drone.current) drone.current = L.marker(latLng(position), { interactive: false, icon: L.divIcon({ className: "aircraft-marker", html: '<span data-testid="aircraft-marker" aria-label="Drone position">✣</span>', iconSize: [42, 42], iconAnchor: [21, 21] }) }).addTo(map.current);
    drone.current.setLatLng(latLng(position));
    const element = drone.current.getElement(); if (element) { element.style.opacity = stale ? ".4" : "1"; element.dataset.lat = String(position.lat); element.dataset.lon = String(position.lon); }
  }, [position, stale]);
  return <div className="map-wrap street-map-wrap"><div className="street-toolbar"><strong>{onSelect ? selectionPrompt ?? "Choose the job location" : "Flight area"}</strong><button className="text-button" onClick={() => map.current?.fitBounds(L.latLngBounds([home, ...(route ?? []), ...(area ? [area.northWest, area.southEast] : []), ...(selected ? [selected] : [])].map(latLng)).pad(.3), { maxZoom: 18 })}>Fit flight area</button></div><div ref={container} className="street-map" data-testid="flight-map" data-tiles-loaded={loaded} />{onSelect && <div className="map-instruction"><span>{selectionPrompt ?? "Click the map to choose a location."}</span><button type="button" onClick={() => { const center = map.current?.getCenter(); if (center) onSelect({ lat: center.lat, lon: center.lng }); }}>Use map center</button></div>}{error && <p className="tile-error" role="status">Map unavailable. Try again shortly.</p>}</div>;
}
