"use client";
import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Velocity = { vx: number; vy: number; vz: number; yaw: number };
const directions: { label: string; vector: Velocity }[] = [
  { label: "North", vector: { vx: 1, vy: 0, vz: 0, yaw: 0 } }, { label: "South", vector: { vx: -1, vy: 0, vz: 0, yaw: 0 } },
  { label: "West", vector: { vx: 0, vy: -1, vz: 0, yaw: 0 } }, { label: "East", vector: { vx: 0, vy: 1, vz: 0, yaw: 0 } },
  { label: "Up", vector: { vx: 0, vy: 0, vz: .5, yaw: 0 } }, { label: "Down", vector: { vx: 0, vy: 0, vz: -.5, yaw: 0 } },
  { label: "Turn left", vector: { vx: 0, vy: 0, vz: 0, yaw: -20 } }, { label: "Turn right", vector: { vx: 0, vy: 0, vz: 0, yaw: 20 } },
];
export function ComputerControls({ operationId, generation, grounded }: { operationId: Id<"operations">; generation: number; grounded: boolean }) {
  const ticket = useAction(api.manualControl.ticket);
  const socket = useRef<WebSocket | null>(null), sequence = useRef(0), clockOffset = useRef(0), velocity = useRef<Velocity | null>(null);
  const pendingAction = useRef<{ sequence: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [actionStatus, setActionStatus] = useState("");
  const [connected, setConnected] = useState(false), [error, setError] = useState("");
  const [endpoint, setEndpoint] = useState(process.env.NEXT_PUBLIC_CONTROL_URL ?? "ws://127.0.0.1:8765/control");
  const send = (type: string, values: object = {}) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return;
    const next = ++sequence.current;
    if (type === "land" || type === "takeoff") {
      velocity.current = null;
      setError("");
      setActionStatus(`${type === "land" ? "Landing" : "Takeoff"} requested; waiting for aircraft acknowledgment.`);
      if (pendingAction.current) clearTimeout(pendingAction.current.timer);
      pendingAction.current = { sequence: next, timer: setTimeout(() => {
        pendingAction.current = null;
        setActionStatus("");
        setError("Aircraft acknowledgment was not received. Verify telemetry before issuing another command.");
      }, 3000) };
    }
    socket.current.send(JSON.stringify({ type, ...values, sequence: next, sentAt: Date.now() + clockOffset.current }));
  };
  const stop = () => { velocity.current = null; send("stop"); };
  useEffect(() => {
    const moveTimer = setInterval(() => { if (velocity.current) send("move", velocity.current); }, 50);
    let refreshing = false;
    const refreshTimer = setInterval(() => {
      if (!socket.current || socket.current.readyState !== WebSocket.OPEN || refreshing) return;
      refreshing = true;
      void ticket({ operationId }).then(result => socket.current?.send(JSON.stringify({ type: "authenticate", ticket: result.token }))).catch(() => { stop(); socket.current?.close(); }).finally(() => { refreshing = false; });
    }, 15000);
    const hidden = () => { if (document.hidden) stop(); };
    window.addEventListener("blur", stop); document.addEventListener("visibilitychange", hidden);
    return () => { if (pendingAction.current) clearTimeout(pendingAction.current.timer); clearInterval(moveTimer); clearInterval(refreshTimer); window.removeEventListener("blur", stop); document.removeEventListener("visibilitychange", hidden); stop(); socket.current?.close(); socket.current = null; setConnected(false); };
  }, [operationId, generation, ticket]);
  async function connect() {
    setError("");
    try {
      const url = new URL(endpoint);
      if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/control") throw new Error("Enter a valid control endpoint ending in /control.");
      if (window.location.protocol === "https:" && url.protocol !== "wss:") throw new Error("Use a trusted WSS connection from an HTTPS application.");
      const grant = await ticket({ operationId });
      socket.current?.close();
      const ws = new WebSocket(url); socket.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "authenticate", ticket: grant.token }));
      ws.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === "authenticated") { clockOffset.current = message.serverTime - Date.now(); setConnected(true); }
        if (message.sequence === pendingAction.current?.sequence && ["acknowledged", "rejected"].includes(message.type)) {
          clearTimeout(pendingAction.current!.timer); pendingAction.current = null;
          setActionStatus(message.type === "acknowledged" ? `${message.action === "land" ? "Landing" : "Takeoff"} accepted by aircraft. Follow measured flight status.` : "");
        }
        if (message.type === "rejected") { velocity.current = null; setError(String(message.reason)); }
      };
      ws.onclose = () => { if (socket.current === ws) { setConnected(false); velocity.current = null; } };
      ws.onerror = () => setError("Could not connect to the local flight agent. Check its control endpoint and certificate.");
    } catch (error) { setError(error instanceof Error ? error.message.split("\n")[0] : "Connection failed."); }
  }
  return <section className="computer-controls"><h3>Computer flight controls</h3><p className="muted">Hold a direction to move. Release to hold position. Directions use geographic north/east; speeds are limited to 1 m/s horizontally and 0.5 m/s vertically.</p>{!connected ? <div className="control-connect"><label>Local control endpoint<input aria-label="Local control endpoint" value={endpoint} onChange={e => setEndpoint(e.target.value)} /></label><button onClick={() => void connect()}>Connect computer controls</button></div> : <><p className="selection-summary" role="status">Computer controls connected</p><div className="interventions"><button disabled={!grounded} onClick={() => send("takeoff")}>Manual takeoff</button><button onClick={() => send("land")}>Manual land</button><button onClick={() => { stop(); socket.current?.close(); }}>Disconnect controls</button></div><div className="direction-controls">{directions.map(({ label, vector }) => <button key={label} disabled={grounded} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); velocity.current = vector; send("move", vector); }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onKeyDown={event => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); velocity.current = vector; send("move", vector); } }} onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); stop(); } }} onBlur={stop}>{label}</button>)}</div></>}{actionStatus && <p role="status">{actionStatus}</p>}{error && <p className="error" role="alert">{error}</p>}</section>;
}
