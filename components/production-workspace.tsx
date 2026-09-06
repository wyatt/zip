"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { JOB_LABELS, OPERATION_LABELS, REQUEST_MODES, TELEMETRY_STALE_MS, metersBetween, preflightProblems, type CommandKind, type ControlMode, type Environment, type GeoPoint, type RequestKind } from "@/lib/operations";
import { AuthGate, type Account } from "./auth-gate";
import { AppShell } from "./app-shell";
import { FlightMap } from "./flight-map";
import { useTelemetryPlayback } from "./telemetry-playback";
import type { AircraftSample } from "@/lib/operations";
import { ComputerControls } from "./computer-controls";
import { areaGeometry, surveyArea, type SurveyArea } from "@/lib/areas";
import { CameraPanel } from "./camera-panel";
import { OperatorSplit } from "./operator-split";
import { FALLBACK_LOCATION, useBrowserLocation } from "./use-browser-location";
import { DRONE_TYPES, droneTypeByModel } from "@/lib/aircraft";
import { ArrowLeft } from "pixelarticons/react/ArrowLeft";
import { Trash } from "pixelarticons/react/Trash";

export const INITIAL_LOCATION = FALLBACK_LOCATION;
export function messageOf(error: unknown) {
  if (!(error instanceof Error)) return "The request could not be completed.";
  const match = error.message.match(/Uncaught Error: ([^\n]+)/);
  return match ? match[1] : error.message.split("\n")[0].slice(0, 300);
}
function useOperationSelection() {
  const [id, setId] = useState<Id<"operations"> | null>(null);
  useEffect(() => { const value = new URL(location.href).searchParams.get("operation"); if (value && /^[a-z0-9]{20,40}$/.test(value)) setId(value as Id<"operations">); }, []);
  function select(value: Id<"operations"> | null) {
    setId(value); const url = new URL(location.href); if (value) url.searchParams.set("operation", value); else url.searchParams.delete("operation"); history.replaceState(null, "", url);
  }
  return [id, select] as const;
}
export function ProductionWorkspace({ role }: { role: "request" | "operator" }) {
  const surface = role === "request" ? "customer" : "operator";
  return <AuthGate surface={surface}>{account => <AppShell account={account} surface={surface}>{role === "request" ? <CustomerWorkspace /> : account.operator?.approved ? <OperatorWorkspace /> : <OperatorOnboarding account={account} />}</AppShell>}</AuthGate>;
}

function offsetPoint(point: GeoPoint, northM: number, eastM = 0): GeoPoint {
  return { lat: point.lat + northM / 111320, lon: point.lon + eastM / (111320 * Math.cos((point.lat * Math.PI) / 180)) };
}
function workOrderStatus(status: string) {
  if (status === "open") return "Finding an operator";
  if (status === "assigned") return "In progress";
  return status;
}
function RequestHeading({ title, onBack, backLabel = "Back to requests" }: { title: string; onBack: () => void; backLabel?: string }) {
  return (
    <div className="page-heading">
      <div className="page-title">
        <button type="button" className="back-icon" aria-label={backLabel} onClick={onBack}>
          <ArrowLeft width={28} height={28} aria-hidden />
        </button>
        <h1>{title}</h1>
      </div>
    </div>
  );
}

function CustomerWorkspace() {
  const orders = useQuery(api.workOrders.mine);
  const submit = useMutation(api.workOrders.submit), cancel = useMutation(api.workOrders.cancel);
  const [operationId, selectOperation] = useOperationSelection();
  const { point: here, fromBrowser } = useBrowserLocation();
  const [page, setPage] = useState<"home" | "compose" | "mission">("home");
  const [kind, setKind] = useState<RequestKind>("deliver");
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [firstCorner, setFirstCorner] = useState<GeoPoint | null>(null);
  const [secondCorner, setSecondCorner] = useState<GeoPoint | null>(null);
  const [corner, setCorner] = useState<"first" | "second">("first");
  const [environment, setEnvironment] = useState<Environment>("aircraft");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<Id<"workOrders"> | null>(null);
  const restored = useRef(false);
  const selected = orders?.find(order => order._id === selectedId) ?? orders?.find(order => order.operationId === operationId);
  const isAreaJob = kind === "search" || kind === "inspection";
  const mode = REQUEST_MODES.find(item => item.kind === kind) ?? REQUEST_MODES[0]!;
  useEffect(() => {
    if (restored.current || !orders || !operationId) return;
    const match = orders.find(order => order.operationId === operationId);
    if (!match || match.status === "cancelled") return;
    restored.current = true;
    setSelectedId(match._id);
    setPage("mission");
  }, [orders, operationId]);
  useEffect(() => {
    if (selected?.operationId) selectOperation(selected.operationId);
  }, [selected?.operationId]);
  useEffect(() => {
    if (!fromBrowser || location || isAreaJob || page !== "compose") return;
    setLocation(here);
  }, [fromBrowser, here, location, isAreaJob, page]);
  const area = isAreaJob && firstCorner && secondCorner ? surveyArea(firstCorner, secondCorner) : undefined;
  let geometry: ReturnType<typeof areaGeometry> | undefined;
  let areaError = "";
  if (area) { try { geometry = areaGeometry(area); } catch (caught) { areaError = messageOf(caught); } }
  const chooseLocation = (point: GeoPoint) => {
    if (!isAreaJob) { setLocation(point); return; }
    if (corner === "first" || !firstCorner) {
      setFirstCorner(point);
      setLocation(point);
      setCorner("second");
      return;
    }
    setSecondCorner(metersBetween(firstCorner, point) < 10 ? offsetPoint(firstCorner, 80) : point);
  };
  function goHome() {
    setPage("home");
    setError("");
    setSelectedId(null);
    selectOperation(null);
  }
  function openCompose(next: RequestKind) {
    setKind(next);
    setPage("compose");
    setError("");
    setSelectedId(null);
    selectOperation(null);
    setLocation(null);
    setFirstCorner(null);
    setSecondCorner(null);
    setCorner("first");
  }
  function openMission(orderId: Id<"workOrders">, nextOperationId: Id<"operations"> | null) {
    setPage("mission");
    setSelectedId(orderId);
    setError("");
    selectOperation(nextOperationId);
  }
  const heading = page === "compose" ? `Request ${mode.label}` : page === "mission" ? selected?.title ?? "Mission" : "Requests";
  const split = page !== "home";
  const missions = orders?.filter(order => order.status !== "cancelled");
  useEffect(() => {
    if (page === "mission" && selected?.status === "cancelled") goHome();
  }, [page, selected?.status]);
  return (
    <main className={`workspace operator-retro request-page${split ? " request-split" : " request-catalog"}`}>
      {page === "home" && (
        <>
          {error && <p className="error" role="alert">{error}</p>}
          <section className="mission-section">
            <div className="section-title"><h2>Your missions</h2><span className="count">{missions?.length ?? 0}</span></div>
            {missions === undefined ? <p className="muted">Loading missions…</p> : missions.length === 0 ? <p className="muted">No missions yet. Choose a flight type below to send a request.</p> : (
              <div className="mission-strip">
                {missions.map(order => {
                  const type = DRONE_TYPES.find(item => item.label === order.vehicleModel);
                  const confirmed = order.status !== "open" && !!type;
                  return (
                    <button type="button" className="mission-card" key={order._id} onClick={() => openMission(order._id, order.operationId ?? null)}>
                      <span className="mission-copy">
                        <span className="job-person">{order.title}</span>
                        <span className="job-description">{JOB_LABELS[order.kind]} · {order.environment === "simulated" ? "Simulation" : "Aircraft"}</span>
                      </span>
                      <span className={`mission-art${confirmed ? "" : " silhouette"}`} aria-hidden>
                        <img src={type && confirmed ? type.src : "/drones/dji-mini-4k.png"} alt="" />
                      </span>
                      <span className={`status ${order.status}`}>{workOrderStatus(order.status)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          <section className="mode-section">
            <div className="section-title"><h2>Request a flight</h2></div>
            <div className="mode-grid">
              {REQUEST_MODES.map(item => (
                <button type="button" className="mode-card" key={item.kind} aria-label={item.label} onClick={() => openCompose(item.kind)}>
                  <span className="mode-art" aria-hidden>
                    <span className="mode-sprite" style={{ ["--mode-frame" as string]: `${item.frame * 50}%` }} />
                  </span>
                  <span className="mode-body">
                    <span className="mode-title">{item.label}</span>
                    <span className="muted">{item.summary}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
      {page === "compose" && (
        <OperatorSplit storageKey="iris-request-split" board={<>
          <RequestHeading title={heading} onBack={goHome} />
          <section className="panel">
            <p className="eyebrow">{mode.label.toUpperCase()}</p>
            <h2>Configure this job</h2>
            <form onSubmit={async event => {
              event.preventDefault();
              if (!location || (isAreaJob && !geometry)) return;
              const data = new FormData(event.currentTarget);
              setBusy(true); setError("");
              try {
                const id = await submit({
                  title: String(data.get("title")),
                  description: String(data.get("description")),
                  kind,
                  environment,
                  location: geometry?.center ?? location,
                  ...(area ? { area } : {}),
                  destinations: geometry?.destinations ?? [location],
                  payloadKg: kind === "deliver" ? Number(data.get("payload")) : 0,
                  altitudeM: Number(data.get("altitude")),
                  hoverSec: Number(data.get("hover")),
                });
                openMission(id, null);
              } catch (caught) { setError(messageOf(caught)); } finally { setBusy(false); }
            }}>
              <label>Title<input name="title" required minLength={3} maxLength={100} placeholder={kind === "deliver" ? "e.g. Pharmacy drop-off" : kind === "search" ? "e.g. Trail search" : "e.g. Roof survey"} /></label>
              <label>Instructions<textarea name="description" maxLength={2000} rows={3} placeholder={kind === "deliver" ? "Package details and drop-off notes" : kind === "search" ? "Who or what should the operator look for?" : "What should be inspected?"} /></label>
              <label>Execution environment<select aria-label="Execution environment" value={environment} onChange={e => setEnvironment(e.target.value as Environment)}><option value="aircraft">Physical aircraft</option><option value="simulated">Simulation / training</option></select></label>
              <p className="muted">{environment === "simulated" ? "Simulation uses a virtual drone." : "Only operators with an approved aircraft integration can accept this request."}</p>
              <div className="coordinates"><label>Altitude (m)<input name="altitude" type="number" min={2} max={30} defaultValue={3} required /></label><label>Hover (s)<input name="hover" type="number" min={5} max={120} defaultValue={10} required /></label></div>
              {kind === "deliver" && <label>Payload (kg)<input name="payload" type="number" min={0} max={25} step={0.1} defaultValue={0} required /></label>}
              {isAreaJob && (
                <fieldset>
                  <legend>{kind === "search" ? "Search area" : "Inspection area"}</legend>
                  <p className="muted">Choose two opposite corners on the map. The shaded area shows the boundary and the grid shows the planned sweep.</p>
                  <div className="location-choices">{(["first", "second"] as const).map((slot, index) => (
                    <button key={slot} type="button" className={corner === slot ? "active" : ""} onClick={() => setCorner(slot)}>
                      <span className="location-index">{index + 1}</span>
                      <span><strong>{slot === "first" ? "First corner" : "Opposite corner"}</strong><small>{(slot === "first" ? firstCorner : secondCorner) ? "Selected · click to edit" : "Select on map"}</small></span>
                    </button>
                  ))}</div>
                  <button type="button" className="text-button" onClick={() => { setFirstCorner(null); setSecondCorner(null); setLocation(null); setCorner("first"); }}>Clear area</button>
                  {geometry && <p className="selection-summary">{Math.round(geometry.widthM)} × {Math.round(geometry.heightM)} m · {(geometry.areaM2 / 10000).toFixed(2)} ha · {geometry.destinations.length / 2} sweep rows</p>}
                  {areaError && <p className="error" role="status">{areaError}</p>}
                </fieldset>
              )}
              <p className="selection-summary">{isAreaJob ? geometry ? "Area selected. Ready to submit." : `Choose the ${corner === "first" ? "first" : "opposite"} corner on the map.` : location ? `${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}` : "Choose the job location on the map."}</p>
              <button className="primary" disabled={busy || !location || (isAreaJob && !geometry)}>{busy ? "Submitting…" : "Submit request"}<span>↗</span></button>
            </form>
          </section>
          {error && <p className="error" role="alert">{error}</p>}
        </>} map={<FlightMap chrome home={location ?? here} selected={geometry?.center ?? location ?? undefined} area={area} route={geometry?.destinations} selectionPrompt={isAreaJob ? `Select the ${corner === "first" ? "first" : "opposite"} corner of the ${kind} area` : "Choose the job location"} onSelect={chooseLocation} />} />
      )}
      {page === "mission" && !selected && (
        <RequestHeading title="Mission" onBack={goHome} />
      )}
      {page === "mission" && selected && (
        <OperatorSplit overlay storageKey="iris-request-split" board={<div className="job-float">
          <RequestHeading title={heading} onBack={goHome} />
          {selected.operationId ? <OperationPanel operationId={selected.operationId} operator={false} map={false} /> : (
            <WaitingPanel order={selected} />
          )}
          {error && <p className="error" role="alert">{error}</p>}
          {selected.status === "open" && (
            <button
              type="button"
              className="cancel-request"
              aria-label="Cancel request"
              onClick={async () => { try { await cancel({ workOrderId: selected._id }); goHome(); } catch (caught) { setError(messageOf(caught)); } }}
            >
              <Trash width={22} height={22} aria-hidden />
            </button>
          )}
        </div>} map={selected.operationId ? <OperatorLiveMap operationId={selected.operationId} /> : <WaitingMap order={selected} />} />
      )}
    </main>
  );
}

type NearbyAircraft = { vehicleId: Id<"vehicles">; name: string; model: string | null; operatorName: string; environment: Environment; own: boolean; position: GeoPoint };
function spreadFleet(nearby: NearbyAircraft[]) {
  const groups: NearbyAircraft[][] = [];
  for (const vehicle of nearby) {
    const group = groups.find(entry => metersBetween(entry[0]!.position, vehicle.position) < 180);
    if (group) group.push(vehicle);
    else groups.push([vehicle]);
  }
  const spacing = 55;
  return groups.flatMap(group => group.map((vehicle, index) => {
    const type = droneTypeByModel(vehicle.model ?? undefined);
    const eastM = (index - (group.length - 1) / 2) * spacing;
    return {
      id: vehicle.vehicleId,
      src: type.src,
      label: vehicle.own ? `${vehicle.name} · Your fleet` : vehicle.model ? `${vehicle.name} · ${vehicle.model}` : vehicle.name,
      point: offsetPoint(vehicle.position, 0, eastM),
    };
  }));
}
function WaitingMap({ order }: { order: { _id: Id<"workOrders">; status: string; location: GeoPoint; area?: SurveyArea; destinations: GeoPoint[] } }) {
  const nearby = useQuery(api.workOrders.availableNearby, order.status === "open" ? { workOrderId: order._id } : "skip");
  return <FlightMap chrome={false} home={order.location} selected={order.location} area={order.area} route={order.area ? order.destinations : undefined} fleet={spreadFleet(nearby ?? [])} />;
}
function WaitingPanel({ order }: { order: { _id: Id<"workOrders">; status: string; kind: RequestKind | "flight_check"; description: string; altitudeM: number; hoverSec: number; environment: Environment } }) {
  return (
    <section className="panel">
      <p className="eyebrow">{JOB_LABELS[order.kind].toUpperCase()}</p>
      <h2>{order.status === "cancelled" ? "Request cancelled" : "Finding a qualified operator"}</h2>
      <p className="muted">{order.description || "No additional instructions."}</p>
      <p className="selection-summary">{order.altitudeM} m altitude · {order.hoverSec} s hover · {order.environment === "simulated" ? "Simulation" : "Aircraft"}</p>
      {order.status === "open" && <p className="muted">Qualified aircraft nearby are shown on the map. This page updates when an operator accepts.</p>}
    </section>
  );
}
function OperatorWorkspace() {
  const eligible = useQuery(api.workOrders.eligible), operations = useQuery(api.operations.mine), vehicles = useQuery(api.fleet.mine);
  const { point: here } = useBrowserLocation();
  const accept = useMutation(api.workOrders.accept);
  const [operationId, selectOperation] = useOperationSelection();
  const [boardTab, setBoardTab] = useState<"available" | "active">("available");
  const [selectedOrder, setSelectedOrder] = useState<Id<"workOrders"> | null>(null), [selectedVehicle, setSelectedVehicle] = useState<string>("");
  const [mode, setMode] = useState<ControlMode>("manual");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const order = eligible?.find(order => order._id === selectedOrder);
  const availableVehicles = vehicles?.filter(vehicle => order?.eligibleVehicleIds.includes(vehicle._id)) ?? [];
  const vehicle = availableVehicles.find(v => v._id === selectedVehicle) ?? availableVehicles[0];
  const vehicleId = vehicle?._id;
  const manualControl = vehicle?.capabilities.includes("manual_computer") ? "computer" as const : "remote" as const;
  const showActive = boardTab === "active";
  useEffect(() => { if (operationId) setBoardTab("active"); }, [operationId]);
  const availableCount = eligible?.length ?? 0;
  const overlayingJob = !showActive && !!order;
  const overlayingFlight = showActive && !!operationId;
  const overlay = overlayingJob || overlayingFlight;
  function closeOverlay() {
    setError("");
    if (overlayingFlight) selectOperation(null);
    else setSelectedOrder(null);
  }
  useEffect(() => {
    if (!overlay) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeOverlay();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, overlayingFlight]);
  const listBoard = <>
    <div className="page-heading operator-flight-tabs" role="tablist" aria-label="Flight lists">
      <button type="button" role="tab" id="operator-tab-available" aria-selected={!showActive} aria-controls="operator-panel-available" className={`flight-tab ${showActive ? "" : "selected"}`} onClick={() => setBoardTab("available")}>
        Available
        {availableCount > 0 && <span className="tab-badge" aria-label={`${availableCount} available ${availableCount === 1 ? "job" : "jobs"}`}>{availableCount}</span>}
      </button>
      <button type="button" role="tab" id="operator-tab-active" aria-selected={showActive} aria-controls="operator-panel-active" className={`flight-tab ${showActive ? "selected" : ""}`} onClick={() => setBoardTab("active")}>Active</button>
    </div>
    {!showActive && <div id="operator-panel-available" role="tabpanel" aria-labelledby="operator-tab-available">
      {eligible === undefined ? <p>Loading jobs…</p> : eligible.length === 0 ? <p className="muted">No matching jobs right now. Jobs appear here based on your qualifications, service area, and available aircraft.</p> : <div className="job-list">{eligible.map(job => <button className="job-row" key={job._id} onClick={() => { setSelectedOrder(job._id); setError(""); }}><span className="job-person">{job.title}<span>↗</span></span><span className="job-description">{JOB_LABELS[job.kind]} · {job.environment === "simulated" ? "Simulation" : "Aircraft"}</span></button>)}</div>}
    </div>}
    {showActive && <div id="operator-panel-active" role="tabpanel" aria-labelledby="operator-tab-active">
      {operations === undefined ? <p>Loading flights…</p> : operations.length === 0 ? <p className="muted">Accepted jobs will appear here.</p> : <div className="job-list">{operations.map(operation => <button className="job-row" key={operation._id} onClick={() => { selectOperation(operation._id); setSelectedOrder(null); }}><span className="job-person">Flight #{operation._id.slice(-6)}</span><span className={`status ${operation.state}`}>{OPERATION_LABELS[operation.state]}</span></button>)}</div>}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </>;
  const overlayBoard = <div className="job-float">
    <RequestHeading title={overlayingJob ? (order?.title ?? "Job") : `Flight #${operationId?.slice(-6) ?? ""}`} onBack={closeOverlay} backLabel="Back to jobs" />
    {overlayingJob && order && <section className="panel"><p className="eyebrow">JOB REQUIREMENTS</p><p className="muted">{order.description || "No additional instructions."}</p><p className="selection-summary">{order.altitudeM} m altitude · {order.hoverSec} s hover</p><form onSubmit={async event => { event.preventDefault(); if (!vehicleId) return; setBusy(true); setError(""); try { const id = await accept({ workOrderId: order._id, vehicleId, mode, manualControl }); selectOperation(id); setSelectedOrder(null); } catch (error) { setError(messageOf(error)); } finally { setBusy(false); } }}><label>Aircraft<select value={vehicleId ?? ""} onChange={e => setSelectedVehicle(e.target.value)}>{availableVehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.name}</option>)}</select></label><fieldset className="flight-control"><legend>Flight control</legend><label className="mode-choice"><input type="radio" name="mode" value="manual" checked={mode === "manual"} onChange={() => setMode("manual")} /><span>Manual<small>You fly; telemetry verifies the flight steps.</small></span></label><label className="mode-choice"><input type="radio" name="mode" value="autonomous" checked={mode === "autonomous"} onChange={() => setMode("autonomous")} /><span>Autonomous <span className="beta-tag">Beta</span><small>The local agent executes the approved plan.</small></span></label></fieldset><button className="primary" disabled={busy || !vehicleId}>{busy ? "Assigning…" : "Accept job & create plan"}<span>↗</span></button></form></section>}
    {overlayingFlight && operationId && <OperationPanel operationId={operationId} operator map={false} />}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
  return <main className="workspace operator-retro"><OperatorSplit
    overlay={overlay}
    board={overlay ? overlayBoard : listBoard}
    map={showActive && operationId ? <OperatorLiveMap operationId={operationId} /> : <FlightMap chrome={false} home={order?.location ?? vehicles?.[0]?.home ?? here} selected={order?.location} area={order?.area} route={order?.area ? order.destinations : undefined} />}
  /></main>;
}

function LiveFlightMap({ sample, sessionId, home, route, area, stale, chrome = true }: { sample?: AircraftSample; sessionId?: string; home: GeoPoint; route: GeoPoint[]; area?: SurveyArea; stale: boolean; chrome?: boolean }) {
  const display = useTelemetryPlayback(sample, sessionId);
  return <FlightMap chrome={chrome} home={home} route={route} area={area} position={display?.position} stale={stale} />;
}
function OperatorLiveMap({ operationId }: { operationId: Id<"operations"> }) {
  const details = useQuery(api.operations.details, { operationId });
  const telemetry = useQuery(api.operations.telemetry, { operationId });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  if (!details) return <div className="map-loading">Loading map…</div>;
  const sample = telemetry?.sample;
  const age = sample ? Math.max(0, now - sample.capturedAt) : Infinity;
  const { operation, vehicle, session } = details;
  const fresh = !!sample && age <= TELEMETRY_STALE_MS && sample.connected && telemetry?.sessionId === vehicle?.activeSessionId && !!session && !session.retired && session.leaseUntil > now;
  return <LiveFlightMap chrome={false} area={details.order?.area} home={operation.plan.home} route={operation.plan.steps.map(step => step.position)} sample={sample} sessionId={telemetry?.sessionId} stale={!fresh} />;
}
function OperationPanel({ operationId, operator, map = true }: { operationId: Id<"operations">; operator: boolean; map?: boolean }) {
  const details = useQuery(api.operations.details, { operationId });
  const telemetry = useQuery(api.operations.telemetry, { operationId });
  const command = useMutation(api.operations.command), resolve = useMutation(api.operations.resolveGrounded);
  const [now, setNow] = useState(Date.now()), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  if (!details) return <section className="panel">Loading operation…</section>;
  const { operation, vehicle, session } = details;
  const sample = telemetry?.sample;
  const age = sample ? Math.max(0, now - sample.capturedAt) : Infinity;
  const fresh = !!sample && age <= TELEMETRY_STALE_MS && sample.connected && telemetry?.sessionId === vehicle?.activeSessionId && !!session && !session.retired && session.leaseUntil > now;
  const closed = ["completed", "cancelled"].includes(operation.state);
  const problems = preflightProblems(fresh ? sample : null, operation.plan, now);
  async function send(kind: CommandKind) { setBusy(true); setError(""); try { await command({ operationId, kind, idempotencyKey: crypto.randomUUID() }); } catch (error) { setError(messageOf(error)); } finally { setBusy(false); } }
  const number = (value: number | null | undefined, digits = 0) => value === null || value === undefined ? "—" : value.toFixed(digits);
  return <>{map && <LiveFlightMap area={details.order?.area} home={operation.plan.home} route={operation.plan.steps.map(step => step.position)} sample={sample} sessionId={telemetry?.sessionId} stale={!fresh} />}<section className="panel mission-panel"><div className="mission-heading"><div><p className="eyebrow">{vehicle?.environment === "simulated" ? "SIMULATED AIRCRAFT" : "PHYSICAL AIRCRAFT"}</p><h2>{OPERATION_LABELS[operation.state]}</h2></div><span className={`status ${fresh ? "ready" : "attention"}`} data-testid="telemetry-status">{closed && sample ? "Recorded telemetry" : fresh ? "Live telemetry" : sample ? "Telemetry stale" : "Awaiting telemetry"}</span></div><p className="muted">{details.order?.title} · {vehicle?.name}</p>
    <div className="telemetry"><div><span>Altitude above launch</span><strong data-testid="altitude">{number(sample?.altitudeM, 1)}<small>m</small></strong></div><div><span>Battery</span><strong>{number(sample?.batteryPct)}<small>%</small></strong></div><div><span>Ground speed</span><strong>{number(sample?.speedMps, 1)}<small>m/s</small></strong></div><div><span>Control owner</span><strong className="step-value" data-testid="control-owner">{operation.controlOwner === "none" ? "No flight control" : operation.controlOwner === "autonomy" ? "Flight agent" : operation.controlOwner === "remote" ? "Physical remote" : "Operator computer"}</strong></div></div>
    <div className="telemetry-caption"><span>{sample ? closed ? `Recorded ${new Date(sample.capturedAt).toLocaleString()}` : `Last measurement ${Math.min(999, age / 1000).toFixed(1)} s ago` : "No measurements received"}</span><span>{sample?.armed === null || sample?.armed === undefined ? "Arming unknown" : sample.armed ? "Armed" : "Disarmed"} · {sample?.flightMode ?? "Flight mode unknown"}</span></div>
    <ol className="steps production-steps">{operation.plan.steps.map((step, index) => <li className={operation.verifiedSteps.includes(index) ? "completed" : operation.currentStep === index && !closed ? "active" : ""} key={index}><span>{operation.verifiedSteps.includes(index) ? "✓" : index + 1}</span><div>{step.label}<small>{step.kind === "hover" ? `${step.durationSec} s measured hold` : step.kind === "land" ? "Grounded & disarmed" : `${step.altitudeM} m above launch`}</small></div></li>)}</ol>
    {operation.attention && <p role="alert" className="error">{operation.attention}</p>}
    {!fresh && !closed && <p className="error" role="status">Aircraft data is unavailable or stale. The marker shows the last measured position.</p>}
    {operator && !closed && <div className="control-panel"><div className="flight-action"><div><strong>{operation.plan.mode === "autonomous" ? "Autonomous flight" : "Manual flight"}</strong><p>{operation.state === "ready" ? problems.length ? problems.join(". ") : "Preflight checks passed. Ready for operator start." : operation.state === "manual" ? `Control transferred to ${operation.manualControl === "remote" ? "your physical remote" : "your computer"}. Flight steps follow measured aircraft state.` : "Commands require acknowledgment from the aircraft."}</p></div><button className="primary start" disabled={busy || operation.state !== "ready" || !fresh || problems.length > 0} onClick={() => void send("start")}>{operation.state === "starting" ? "Awaiting aircraft…" : "Start flight"}<span>↗</span></button></div>
      <div className="interventions"><button className="primary takeover" disabled={busy || !fresh || !["active", "returning"].includes(operation.state)} onClick={() => void send("takeover")}>{operation.state === "taking_over" ? "Transferring control…" : "Take over"}</button><button disabled={busy || !fresh || !["active", "manual", "returning"].includes(operation.state)} onClick={() => void send("hold")}>Hold</button><button disabled={busy || !fresh || !["active", "manual", "returning"].includes(operation.state)} onClick={() => void send("return")}>Return home</button><button className="land-button" disabled={busy || !session || session.retired || session.leaseUntil <= now || ["assigned", "ready"].includes(operation.state)} onClick={() => void send("land")}>Land</button></div>
      {["attention", "assigned", "ready", "landing", "manual"].includes(operation.state) && sample?.armed === false && sample?.airborne === false && fresh && <form onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); try { await resolve({ operationId, note: String(data.get("note")) }); } catch (error) { setError(messageOf(error)); } finally { setBusy(false); } }}><label>Close without completing the job<input name="note" required minLength={5} maxLength={500} placeholder="Reason for closing the grounded operation" /></label><button disabled={busy}>Confirm grounded & close operation</button></form>}
    </div>}
    {operator && fresh && operation.state === "manual" && operation.controlOwner === "computer" && <ComputerControls operationId={operation._id} generation={operation.controlGeneration} grounded={sample?.airborne === false && sample?.armed === false} />}
    {closed && <p className="selection-summary">{operation.state === "cancelled" ? "Operation closed without claiming task completion." : operation.taskOutcome === "succeeded" ? "Flight check verified: takeoff, hover, landing, and disarm." : "Flight completed. The requested task result remains unverified."}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <CameraPanel operationId={operation._id} supported={vehicle?.capabilities.includes("camera") ?? false} />
    <details className="events"><summary>Flight activity <span>{details.events.length} events</span></summary><ol>{details.events.map(event => <li key={event._id}><time>{new Date(event.timestamp).toLocaleTimeString()}</time><span>{event.message}</span></li>)}</ol></details>
  </section></>;
}

export function OperatorOnboarding({ account }: { account: Account }) {
  return <main className="workspace operator-retro operator-onboarding"><div className="page-heading"><div><h1>Register your drone</h1></div></div><section className="panel onboarding"><h2>{account.operator ? "Operator access suspended" : "Start accepting flight jobs"}</h2><p className="muted">{account.operator ? "Contact support to restore access to your fleet." : "Save launch sites in account settings, then add your drone. Matching jobs will appear in your operator workspace."}</p>{!account.operator && <div className="heading-actions"><Link className="primary" href="/settings">Account settings ↗</Link><Link className="primary" href="/fleet">Register your drone ↗</Link></div>}</section></main>;
}
