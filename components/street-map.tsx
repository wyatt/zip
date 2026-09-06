"use client";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { LAUNCH, type Point } from "@/lib/flight";
import { fromLatLng, toLatLng, type Task } from "@/lib/tasks";
import { addSatelliteTiles, SATELLITE_MAX_ZOOM } from "@/lib/satellite-tiles";

type Props = { target: Point; task?: Task; first?: Point; route?: Point[]; position?: Point; onSelect?: (point: Point) => void; instruction?: string; state?: string };
export default function StreetMap({ target, task, first, route, position, onSelect, instruction, state }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const overlays = useRef<L.LayerGroup | null>(null);
  const drone = useRef<L.Marker | null>(null);
  const select = useRef(onSelect);
  const bounds = useRef<L.LatLngBounds | null>(null);
  const [showRoute, setShowRoute] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { select.current = onSelect; }, [onSelect]);
  useEffect(() => {
    const instance = L.map(container.current!, { zoomControl: false, scrollWheelZoom: true, touchZoom: true, minZoom: 13, maxZoom: SATELLITE_MAX_ZOOM }).setView(toLatLng({ x: 350, y: 220 }), 16);
    map.current = instance;
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(instance);
    addSatelliteTiles(instance, { onLoad: () => { setLoaded(true); setTileError(false); }, onError: () => setTileError(true) });
    overlays.current = L.layerGroup().addTo(instance);
    instance.on("click", (event: L.LeafletMouseEvent) => select.current?.(fromLatLng(event.latlng.lat, event.latlng.lng)));
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current!);
    return () => { observer.disconnect(); instance.remove(); map.current = null; drone.current = null; };
  }, []);
  const geometry = JSON.stringify({ target, task, first, route });
  useEffect(() => {
    if (!map.current || !overlays.current) return;
    const data = JSON.parse(geometry) as Props;
    const group = overlays.current;
    group.clearLayers();
    const points: Point[] = [LAUNCH];
    function pin(p: Point, label: string, lime = true) {
      points.push(p);
      L.circleMarker(toLatLng(p), { radius: 7, color: "#fff", weight: 2, fillColor: lime ? "#c45c38" : "#fff", fillOpacity: 1 }).bindTooltip(label, { permanent: true, direction: "right", offset: [18, 0], className: "map-pin-label" }).addTo(group);
    }
    pin(LAUNCH, "Launch", false);
    if (data.task?.type === "deliver") { pin(data.task.pickup, "Pickup"); pin(data.task.dropoff, "Delivery"); }
    else if (data.task) {
      const { northWest, southEast } = data.task.region;
      points.push(northWest, southEast);
      L.rectangle([toLatLng(northWest), toLatLng(southEast)], { color: "#fff", weight: 1, dashArray: "4 5", fillColor: "#c45c38", fillOpacity: .18 }).addTo(group);
    } else if (data.first) pin(data.first, "First point");
    else if (!select.current) pin(data.target, "Job");
    if (data.route && showRoute) {
      L.polyline(data.route.map(toLatLng), { color: "#fff", weight: 4, opacity: .8, interactive: false }).addTo(group);
      L.polyline(data.route.map(toLatLng), { color: "#ffd18a", weight: 2, opacity: .95, interactive: false }).addTo(group);
    }
    if (data.route) points.push(...data.route);
    bounds.current = L.latLngBounds(points.map(toLatLng)).pad(.3);
    if (!select.current) map.current.fitBounds(bounds.current, { maxZoom: 17, padding: [40, 40], animate: false });
  }, [geometry, showRoute]);
  useEffect(() => {
    if (!map.current) return;
    if (!position) { drone.current?.remove(); drone.current = null; return; }
    if (!drone.current) drone.current = L.marker(toLatLng(position), { interactive: false, zIndexOffset: 1000, icon: L.divIcon({ className: "aircraft-marker", html: '<span data-testid="drone-marker" role="img" aria-label="Simulated drone"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m10 10 12 12m0-12L10 22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><g fill="white" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="5"/><circle cx="24" cy="8" r="5"/><circle cx="8" cy="24" r="5"/><circle cx="24" cy="24" r="5"/></g><rect x="12" y="11" width="8" height="10" rx="3" fill="currentColor"/></svg></span>', iconSize: [42, 42], iconAnchor: [21, 21] }) }).addTo(map.current);
    drone.current.setLatLng(toLatLng(position));
    const element = drone.current.getElement()?.querySelector<HTMLElement>("[data-testid=drone-marker]");
    if (element) { element.dataset.x = String(position.x); element.dataset.y = String(position.y); }
  }, [position]);
  return <div className="map-wrap street-map-wrap">
    <div className="street-toolbar"><span><span className="live-dot" /> Boston Common <small>Real map · simulated flight</small></span><div className="map-controls">{route && <button type="button" aria-pressed={showRoute} onClick={() => setShowRoute(value => !value)}>{showRoute ? "Hide flight path" : "Show flight path"}</button>}<button type="button" onClick={() => bounds.current && map.current?.fitBounds(bounds.current, { maxZoom: 17, padding: [40, 40] })}>Fit route</button></div></div>
    <div ref={container} className="street-map" data-testid="street-map" data-tiles-loaded={loaded} aria-label="Interactive street map. Use the zoom controls and click to select locations." />
    {onSelect && <div className="map-instruction"><span aria-live="polite">{instruction}</span><button type="button" onClick={() => { const p = map.current?.getCenter(); if (p) onSelect(fromLatLng(p.lat, p.lng)); }}>Use map center</button></div>}
    {tileError && <p className="tile-error" role="status">Some map tiles could not load. Check your internet connection; your selection is saved.</p>}
    <div className="map-footer"><span className="map-legend">{position && <span><i className="legend-drone" /> Simulated drone</span>}{(task || first || !onSelect) && <span><i className="legend-point" /> {task?.type === "deliver" ? "Pickup & delivery" : task ? "Task area" : first ? "First point" : "Job location"}</span>}{route && showRoute && <span><i className="legend-route" /> Planned flight & return</span>}</span><span>{state === "completed" ? "Returned to launch" : "Automatic return & landing"}</span></div>
  </div>;
}
