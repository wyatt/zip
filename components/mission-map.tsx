"use client";
import { LAUNCH, type Point } from "@/lib/flight";

export function MissionMap({ target, route, position, onSelect, state }: { target: Point; route?: Point[]; position?: Point; onSelect?: (point: Point) => void; state?: string }) {
  return <div className="map-wrap">
    <div className="map-label"><span className="live-dot" /> Demo grounds <span className="muted">/ Simulated map</span></div>
    <svg className={onSelect ? "map selectable" : "map"} viewBox="0 0 640 460" role="img" aria-label={`Simulated mission map. Job at ${target.x}, ${target.y} meters. Drone at ${Math.round((position ?? LAUNCH).x)}, ${Math.round((position ?? LAUNCH).y)} meters.`} onClick={onSelect ? e => {
      const svg = e.currentTarget;
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
      onSelect({ x: Math.round(Math.max(180, Math.min(540, point.x))), y: Math.round(Math.max(60, Math.min(300, point.y))) });
    } : undefined}>
      <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#dfe2dd" strokeWidth=".8" /></pattern></defs>
      <rect width="640" height="460" fill="#eceeea" /><rect width="640" height="460" fill="url(#grid)" />
      <g fill="#e0e3de" stroke="#d1d5ce"><rect x="25" y="35" width="110" height="80" rx="3" /><rect x="25" y="146" width="110" height="130" rx="3" /><rect x="184" y="326" width="155" height="95" rx="3" /><rect x="376" y="326" width="180" height="95" rx="3" /><rect x="574" y="50" width="46" height="220" rx="3" /></g>
      <path d="M158 0V302H640M0 122H160M0 300H160M354 302V460M0 439H640" fill="none" stroke="#fff" strokeWidth="15" />
      <rect x="180" y="50" width="365" height="232" rx="6" fill="#e5e9dd" stroke="#d3d8c9" />
      <path d="M190 260L310 180L535 75M185 65L320 175L525 270" fill="none" stroke="#f8f9f5" strokeWidth="7" />
      <g className="map-type" fill="#74796f"><text x="280" y="95">NORTH FIELD</text><text x="226" y="382">OPERATIONS</text><text x="420" y="382">WORKSHOP</text><text x="42" y="210" transform="rotate(-90 42 210)">WEST WALK</text></g>
      <path d="M596 393v-35m-6 9 6-10 6 10" stroke="#222" strokeWidth="2" fill="none" /><text x="591" y="345" className="map-type">N</text>
      {route && <polyline data-testid="mission-route" points={route.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#151713" strokeWidth="3" strokeLinejoin="round" strokeDasharray="7 5" />}
      <circle cx={LAUNCH.x} cy={LAUNCH.y} r="13" fill="white" stroke="#161813" strokeWidth="2" /><text x={LAUNCH.x} y={LAUNCH.y + 5} textAnchor="middle" fontSize="13" fontWeight="900">H</text><text x="65" y="392" className="map-type">LAUNCH</text>
      <rect x={target.x - 7} y={target.y - 7} width="14" height="14" fill="#c5f429" stroke="#171a13" strokeWidth="2" /><text x={target.x + 13} y={target.y + 5} fontSize="12" fontWeight="700">JOB</text>
      {position && <g data-testid="drone-marker" data-x={position.x} data-y={position.y} transform={`translate(${position.x} ${position.y})`}><circle r="22" fill="#c5f429" opacity=".28" /><circle r="12" fill="#c5f429" stroke="#111" strokeWidth="2" /><path d="m-5 5 5-11 5 11-5-3Z" fill="#111" /></g>}
      <path d="M25 423v5h100v-5" fill="none" stroke="#74796f" /><text x="45" y="418" className="map-type">100 m</text>
    </svg>
    <div className="map-footer"><span><i className="legend-point" /> Job location <i className="legend-route" /> Planned route</span><span>{state === "completed" ? "Returned to launch" : onSelect ? "Click the map to place your job" : "Automatic return & landing"}</span></div>
  </div>;
}
