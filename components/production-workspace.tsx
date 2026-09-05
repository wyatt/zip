"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { JOB_LABELS, OPERATION_LABELS, TELEMETRY_STALE_MS, preflightProblems, type CommandKind, type ControlMode, type Environment, type GeoPoint, type JobKind } from "@/lib/operations";
import { AuthGate, type Account } from "./auth-gate";
import { AppShell } from "./app-shell";
import { FlightMap } from "./flight-map";
import { useTelemetryPlayback } from "./telemetry-playback";
import type { AircraftSample } from "@/lib/operations";
import { ComputerControls } from "./computer-controls";
import { areaGeometry, surveyArea, type SurveyArea } from "@/lib/areas";
import { CameraPanel } from "./camera-panel";

export const INITIAL_LOCATION: GeoPoint = { lat: 42.35596, lon: -71.07029 };
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
  return <AuthGate>{account => <AppShell account={account} surface={role === "request" ? "customer" : "operator"}>{role === "request" ? <CustomerWorkspace /> : account.operator?.approved ? <OperatorWorkspace /> : <OperatorOnboarding account={account} />}</AppShell>}</AuthGate>;
}

function CustomerWorkspace() {
  const orders = useQuery(api.workOrders.mine);
  const submit = useMutation(api.workOrders.submit), cancel = useMutation(api.workOrders.cancel);
  const [operationId, selectOperation] = useOperationSelection();
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [firstCorner, setFirstCorner] = useState<GeoPoint | null>(null), [secondCorner, setSecondCorner] = useState<GeoPoint | null>(null);
  const [corner, setCorner] = useState<"first" | "second">("first");
  const [kind, setKind] = useState<JobKind>("flight_check");
  const [environment, setEnvironment] = useState<Environment>("aircraft");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submittedId, setSubmittedId] = useState<Id<"workOrders"> | null>(null);
  const submitted = orders?.find(order => order._id === submittedId);
  useEffect(() => { if (submitted?.operationId) selectOperation(submitted.operationId); }, [submitted?.operationId]); // Updates arrive from Convex.
  const isAreaJob = kind === "search" || kind === "inspection";
  const area = isAreaJob && firstCorner && secondCorner ? surveyArea(firstCorner, secondCorner) : undefined;
  let geometry: ReturnType<typeof areaGeometry> | undefined;
  let areaError = "";
  if (area) { try { geometry = areaGeometry(area); } catch (error) { areaError = messageOf(error); } }
  const chooseLocation = (point: GeoPoint) => {
    if (!isAreaJob) { setLocation(point); return; }
    if (corner === "first") { setFirstCorner(point); setLocation(point); setCorner("second"); }
    else setSecondCorner(point);
  };
  const compose = showForm || (!operationId && !orders?.length);
  return <main className="workspace"><div className="page-heading"><div><p className="eyebrow">CUSTOMER WORKSPACE</p><h1>{compose ? "Request a flight" : "Your requests"}</h1></div>{!compose && <button className="primary compact" onClick={() => { setShowForm(true); selectOperation(null); setSubmittedId(null); setLocation(null); setFirstCorner(null); setSecondCorner(null); setCorner("first"); }}>Request a flight</button>}</div>
    <div className="layout"><aside className="sidebar">
      {compose ? <section className="panel"><h2>What needs doing?</h2><form onSubmit={async event => {
        event.preventDefault(); if (!location || (isAreaJob && !geometry)) return; const data = new FormData(event.currentTarget); setBusy(true); setError("");
        try {
          const id = await submit({ title: String(data.get("title")), description: String(data.get("description")), kind, environment, location: geometry?.center ?? location, ...(area ? { area } : {}), destinations: geometry?.destinations ?? (kind === "flight_check" ? [] : [location]), payloadKg: kind === "deliver" ? Number(data.get("payload")) : 0, altitudeM: Number(data.get("altitude")), hoverSec: Number(data.get("hover")) });
          setSubmittedId(id); setShowForm(false);
        } catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
      }}><label>Job type<select aria-label="Job type" value={kind} onChange={e => { setKind(e.target.value as JobKind); setFirstCorner(null); setSecondCorner(null); setCorner("first"); setLocation(null); }}>{Object.entries(JOB_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Title<input name="title" required minLength={3} maxLength={100} placeholder="e.g. Check aircraft stability" /></label><label>Instructions<textarea name="description" maxLength={2000} rows={3} placeholder="What should the operator know?" /></label>
        <label>Execution environment<select aria-label="Execution environment" value={environment} onChange={e => setEnvironment(e.target.value as Environment)}><option value="aircraft">Physical aircraft</option><option value="simulated">Simulation / training</option></select></label>
        <p className="muted">{environment === "simulated" ? "Simulation uses a virtual drone." : "Only operators with an approved aircraft integration can accept this request."}</p>
        <div className="coordinates"><label>Altitude (m)<input name="altitude" type="number" min={2} max={30} defaultValue={3} required /></label><label>Hover (s)<input name="hover" type="number" min={5} max={120} defaultValue={10} required /></label></div>
        {kind === "deliver" && <label>Payload (kg)<input name="payload" type="number" min={0} max={25} step={.1} required /></label>}
        {isAreaJob && <fieldset><legend>{kind === "search" ? "Search area" : "Inspection area"}</legend><p className="muted">Choose two opposite corners on the map. The shaded area shows the boundary and the grid shows the planned sweep.</p><div className="location-choices">{(["first", "second"] as const).map((slot, index) => <button key={slot} type="button" className={corner === slot ? "active" : ""} onClick={() => setCorner(slot)}><span className="location-index">{index + 1}</span><span><strong>{slot === "first" ? "First corner" : "Opposite corner"}</strong><small>{(slot === "first" ? firstCorner : secondCorner) ? "Selected · click to edit" : "Select on map"}</small></span></button>)}</div><button type="button" className="text-button" onClick={() => { setFirstCorner(null); setSecondCorner(null); setLocation(null); setCorner("first"); }}>Clear area</button>{geometry && <p className="selection-summary">{Math.round(geometry.widthM)} × {Math.round(geometry.heightM)} m · {(geometry.areaM2 / 10000).toFixed(2)} ha · {geometry.destinations.length / 2} sweep rows</p>}{areaError && <p className="error" role="status">{areaError}</p>}</fieldset>}
        <p className="selection-summary">{isAreaJob ? geometry ? "Area selected. Ready to submit." : `Choose the ${corner === "first" ? "first" : "opposite"} corner on the map.` : location ? `${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}` : "Choose the launch / job location on the map."}</p><button className="primary" disabled={busy || !location || (isAreaJob && !geometry)}>{busy ? "Submitting…" : "Submit request"}<span>↗</span></button></form></section> : null}
      {!compose && <section className="panel"><div className="section-title"><h2>My requests</h2><span className="count">{orders?.length ?? 0}</span></div>{orders === undefined ? <p className="muted">Loading requests…</p> : <div className="job-list">{orders.map(order => <div key={order._id} className="request-list-item"><button className={`job-row ${order.operationId === operationId || order._id === submittedId ? "selected" : ""}`} onClick={() => { selectOperation(order.operationId ?? null); setSubmittedId(order._id); }}><span className="job-person">{order.title}</span><span className="job-description">{JOB_LABELS[order.kind]} · {order.environment === "simulated" ? "Simulation" : "Aircraft"}</span><span className={`status ${order.status}`}>{order.status === "open" ? "Finding an operator" : order.status}</span></button>{order.status === "open" && <button className="text-button" onClick={async () => { try { await cancel({ workOrderId: order._id }); } catch (error) { setError(messageOf(error)); } }}>Cancel request</button>}</div>)}</div>}</section>}
      {error && <p className="error" role="alert">{error}</p>}
    </aside><div className="main-column">{operationId && !compose ? <OperationPanel operationId={operationId} operator={false} /> : <><FlightMap home={compose ? location ?? INITIAL_LOCATION : submitted?.location ?? INITIAL_LOCATION} selected={compose ? geometry?.center ?? location ?? undefined : submitted?.location} area={compose ? area : submitted?.area} route={compose ? geometry?.destinations : submitted?.area ? submitted.destinations : undefined} selectionPrompt={compose && isAreaJob ? `Select the ${corner === "first" ? "first" : "opposite"} corner of the ${kind} area` : undefined} onSelect={compose ? chooseLocation : undefined} /><section className="panel"><p className="eyebrow">{compose ? "YOUR FLIGHT" : "DISPATCH"}</p><h2>{compose ? isAreaJob ? "Define your survey area" : "Take off. Hover. Land." : submitted?.status === "cancelled" ? "Request cancelled" : "Finding a qualified operator"}</h2><p className="muted">{compose ? isAreaJob ? "Your selected area and sweep route are saved with the request for the operator to review." : "The operator reviews your requirements and aircraft capabilities before accepting. Flight checks stay at the launch location." : "Your request appears live for operators whose qualifications, service area, and aircraft match. This page updates when an operator accepts."}</p></section></>}</div></div></main>;
}

function OperatorWorkspace() {
  const eligible = useQuery(api.workOrders.eligible), operations = useQuery(api.operations.mine), vehicles = useQuery(api.fleet.mine);
  const accept = useMutation(api.workOrders.accept);
  const [operationId, selectOperation] = useOperationSelection();
  const [selectedOrder, setSelectedOrder] = useState<Id<"workOrders"> | null>(null), [selectedVehicle, setSelectedVehicle] = useState<string>("");
  const [mode, setMode] = useState<ControlMode>("autonomous"), [manualControl, setManualControl] = useState<"remote" | "computer">("remote");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const order = eligible?.find(order => order._id === selectedOrder);
  const availableVehicles = vehicles?.filter(vehicle => order?.eligibleVehicleIds.includes(vehicle._id)) ?? [];
  const vehicleId = availableVehicles.find(v => v._id === selectedVehicle)?._id ?? availableVehicles[0]?._id;
  return <main className="workspace"><div className="page-heading"><div><p className="eyebrow">OPERATOR WORKSPACE</p><h1>Flight operations</h1></div><Link href="/fleet" className="text-button">Manage aircraft ↗</Link></div><div className="layout"><aside className="sidebar">
    <section className="panel"><div className="section-title"><h2>Available jobs</h2><span className="count">{eligible?.length ?? 0}</span></div>{eligible === undefined ? <p>Loading dispatch…</p> : eligible.length === 0 ? <p className="muted">No matching jobs right now. Jobs appear here based on your qualifications, service area, and available aircraft.</p> : <div className="job-list">{eligible.map(job => <button className={`job-row ${selectedOrder === job._id ? "selected" : ""}`} key={job._id} onClick={() => { setSelectedOrder(job._id); selectOperation(null); setError(""); }}><span className="job-person">{job.title}<span>↗</span></span><span className="job-description">{JOB_LABELS[job.kind]} · {job.environment === "simulated" ? "Simulation" : "Aircraft"}</span></button>)}</div>}</section>
    {order && !operationId && <section className="panel"><p className="eyebrow">JOB REQUIREMENTS</p><h2>{order.title}</h2><p className="muted">{order.description || "No additional instructions."}</p><p className="selection-summary">{order.altitudeM} m altitude · {order.hoverSec} s hover</p><form onSubmit={async event => { event.preventDefault(); if (!vehicleId) return; setBusy(true); setError(""); try { const id = await accept({ workOrderId: order._id, vehicleId, mode, manualControl }); selectOperation(id); setSelectedOrder(null); } catch (error) { setError(messageOf(error)); } finally { setBusy(false); } }}><label>Aircraft<select value={vehicleId ?? ""} onChange={e => setSelectedVehicle(e.target.value)}>{availableVehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.name}</option>)}</select></label><fieldset><legend>Flight control</legend><label className="mode-choice"><input type="radio" name="mode" value="autonomous" checked={mode === "autonomous"} onChange={() => setMode("autonomous")} /><span>Autonomous<small>The local agent executes the approved plan.</small></span></label><label className="mode-choice"><input type="radio" name="mode" value="manual" checked={mode === "manual"} onChange={() => setMode("manual")} /><span>Manual<small>You fly; telemetry verifies the flight steps.</small></span></label></fieldset><label>Manual / takeover control<select value={manualControl} onChange={e => setManualControl(e.target.value as "remote" | "computer")}><option value="remote">Physical remote</option><option value="computer">Computer controls</option></select></label><button className="primary" disabled={busy || !vehicleId}>{busy ? "Assigning…" : "Accept job & create plan"}<span>↗</span></button></form></section>}
    <section className="panel"><h2>My operations</h2><div className="job-list">{operations?.map(operation => <button className={`job-row ${operationId === operation._id ? "selected" : ""}`} key={operation._id} onClick={() => { selectOperation(operation._id); setSelectedOrder(null); }}><span className="job-person">Flight #{operation._id.slice(-6)}</span><span className={`status ${operation.state}`}>{OPERATION_LABELS[operation.state]}</span></button>)}</div>{operations?.length === 0 && <p className="muted">Accepted jobs will appear here.</p>}</section>{error && <p className="error" role="alert">{error}</p>}
    </aside><div className="main-column">{operationId ? <OperationPanel operationId={operationId} operator /> : <><FlightMap home={order?.location ?? vehicles?.[0]?.home ?? INITIAL_LOCATION} selected={order?.location} area={order?.area} route={order?.area ? order.destinations : undefined} /><section className="panel"><p className="eyebrow">DISPATCH</p><h2>{order ? "Review and accept the job" : "Your aircraft, your operations"}</h2><p className="muted">{order ? "Review the flight area and aircraft before accepting." : "Select a matching job to review its requirements. Register and connect an aircraft from the Aircraft workspace."}</p></section></>}</div></div></main>;
}

function LiveFlightMap({ sample, sessionId, home, route, area, stale }: { sample?: AircraftSample; sessionId?: string; home: GeoPoint; route: GeoPoint[]; area?: SurveyArea; stale: boolean }) {
  const display = useTelemetryPlayback(sample, sessionId);
  return <FlightMap home={home} route={route} area={area} position={display?.position} stale={stale} />;
}
function OperationPanel({ operationId, operator }: { operationId: Id<"operations">; operator: boolean }) {
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
  return <><LiveFlightMap area={details.order?.area} home={operation.plan.home} route={operation.plan.steps.map(step => step.position)} sample={sample} sessionId={telemetry?.sessionId} stale={!fresh} /><section className="panel mission-panel"><div className="mission-heading"><div><p className="eyebrow">{vehicle?.environment === "simulated" ? "SIMULATED AIRCRAFT" : "PHYSICAL AIRCRAFT"}</p><h2>{OPERATION_LABELS[operation.state]}</h2></div><span className={`status ${fresh ? "ready" : "attention"}`} data-testid="telemetry-status">{closed && sample ? "Recorded telemetry" : fresh ? "Live telemetry" : sample ? "Telemetry stale" : "Awaiting telemetry"}</span></div><p className="muted">{details.order?.title} · {vehicle?.name}</p>
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
  return <main className="workspace"><div className="page-heading"><div><p className="eyebrow">OPERATOR WORKSPACE</p><h1>Register your drone</h1></div></div><section className="panel onboarding"><h2>{account.operator ? "Operator access suspended" : "Start accepting flight jobs"}</h2><p className="muted">{account.operator ? "Contact support to restore access to your fleet." : "Add your drone's specifications and service area. It will appear in your fleet, and matching jobs will appear in your operator workspace."}</p>{!account.operator && <Link className="primary" href="/fleet">Register your drone ↗</Link>}</section></main>;
}
