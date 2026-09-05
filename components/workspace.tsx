"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LAUNCH, TARGET, type Point } from "@/lib/flight";
import { MissionMap } from "./mission-map";

const labels: Record<string, string> = { submitted: "Awaiting operator", assigned: "Connecting agent", ready: "Ready to fly", running: "In flight", returning: "Returning to launch", landed: "Landed", completed: "Mission completed" };
function Status({ state }: { state: string }) { return <span className={`status ${state}`}><span />{labels[state] ?? state}</span>; }
function errorText(error: unknown) { return error instanceof Error ? error.message.replace(/\[CONVEX[^\]]*\]\s*/, "") : "Something went wrong. Please try again."; }
export function Workspace({ role }: { role: "request" | "operator" }) {
  const board = useQuery(api.dispatch.board);
  const [selected, setSelected] = useState<Id<"jobs"> | null>(null);
  const [target, setTarget] = useState<Point>(TARGET);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [supervised, setSupervised] = useState(false);
  const [now, setNow] = useState(0);
  const submit = useMutation(api.dispatch.submit), accept = useMutation(api.dispatch.accept), start = useMutation(api.dispatch.start);
  const activeId = selected ?? (role === "operator" ? board?.jobs[0]?._id : undefined);
  const details = useQuery(api.dispatch.details, activeId ? { jobId: activeId } : "skip");
  const mission = details?.mission, telemetry = details?.telemetry;
  const state = details?.job?.status;
  useEffect(() => {
    const saved = new URL(window.location.href).searchParams.get("job");
    if (saved && /^[a-z0-9]{20,40}$/.test(saved)) setSelected(saved as Id<"jobs">);
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(timer);
  }, []);
  function select(id: Id<"jobs">) { setSelected(id); setSupervised(false); setError(""); window.history.replaceState(null, "", `/${role}?job=${id}`); }
  async function act(fn: () => Promise<unknown>) { setBusy(true); setError(""); try { await fn(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }
  const agentOnline = !!board?.drone && now - board.drone.heartbeatAt < 15000;
  const currentTarget = details?.job?.location ?? target;
  return <>
    <header className="header"><Link className="wordmark" href="/request" aria-label="zip home">zip<span>.</span></Link><nav aria-label="Workspace"><Link href="/request" aria-current={role === "request" ? "page" : undefined}>Requester</Link><Link href="/operator" aria-current={role === "operator" ? "page" : undefined}>Operator</Link></nav><span className="demo-badge">SIMULATED DEMO</span></header>
    <main className={`workspace ${role}`}>
      <div className="page-heading"><div><p className="eyebrow">{role === "request" ? "01 / REQUEST" : "02 / DISPATCH"}</p><h1>{role === "request" ? activeId ? "Your job" : "Request a flight" : "Flight operations"}</h1></div><span className="heading-note">{role === "operator" ? "One simulator. One mission at a time." : "A 20-second simulated mission."}</span></div>
      <div className="layout">
        <aside className="sidebar">
          {role === "request" && !activeId ? <section className="panel"><h2>What needs doing?</h2><form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void act(async () => { const id = await submit({ requester: String(data.get("requester")), description: String(data.get("description")), location: target }); select(id); }); }}>
            <label>Your name<input name="requester" autoComplete="name" placeholder="e.g. Alex Morgan" maxLength={80} required /></label>
            <label>Job description<textarea name="description" placeholder="Describe the task at this location" maxLength={500} rows={4} required /></label>
            <fieldset><legend>Job location</legend><p className="muted">Select a point on the map, or enter coordinates.</p><div className="coordinates"><label>East (m)<input aria-label="East (meters)" type="number" min={180} max={540} value={target.x} onChange={e => setTarget({ ...target, x: Number(e.target.value) })} required /></label><label>South (m)<input aria-label="South (meters)" type="number" min={60} max={300} value={target.y} onChange={e => setTarget({ ...target, y: Number(e.target.value) })} required /></label></div></fieldset>
            <button className="primary" disabled={busy || !board}>{busy ? "Submitting…" : "Submit job"}<span>↗</span></button>
          </form></section> : null}
          {role === "operator" && <section className="panel jobs"><div className="section-title"><h2>Incoming jobs</h2><span className="count">{board?.jobs.filter(j => j.status === "submitted").length ?? 0}</span></div>{board === undefined ? <p className="muted">Connecting to dispatch…</p> : board.jobs.length === 0 ? <div className="empty"><span className="empty-icon">↙</span><h3>No jobs yet</h3><p>Submit a job in the requester view. It will appear here live.</p><Link href="/request">Open requester ↗</Link></div> : <div className="job-list">{board.jobs.map(job => <button className={`job-row ${activeId === job._id ? "selected" : ""}`} key={job._id} onClick={() => select(job._id)}><span className="job-person">{job.requester}<span>↗</span></span><span className="job-description">{job.description}</span><Status state={job.status} /></button>)}</div>}</section>}
          {details?.job && <section className="panel job-details"><div className="section-title"><h2>{role === "request" ? "Request status" : "Selected job"}</h2><span className="tiny">#{details.job._id.slice(-5)}</span></div><Status state={state!} /><h3>{details.job.description}</h3><p className="muted">Requested by {details.job.requester}</p><div className="key-value"><span>Location</span><strong>{currentTarget.x} E / {currentTarget.y} S</strong></div>
            {role === "request" && <p className="status-description" aria-live="polite">{state === "submitted" ? "Your job is with the operator. Updates will appear here automatically." : state === "completed" ? "The simulated drone returned to launch and landed. Your job is complete." : state === "ready" ? "The simulated agent is ready. Waiting for the operator to start." : "Your mission is progressing. Follow its position on the map."}</p>}
            {role === "operator" && state === "submitted" && <><label className={`mode-choice ${supervised ? "checked" : ""}`}><input type="checkbox" checked={supervised} onChange={e => setSupervised(e.target.checked)} /><span><strong>Supervised autonomy</strong><small>You start the flight. Return and landing are automatic.</small></span></label><button className="primary" disabled={busy || !supervised || !board?.drone?.available} onClick={() => void act(() => accept({ jobId: details.job!._id, mode: "supervised" }))}>{busy ? "Assigning…" : "Accept & assign simulator"}<span>↗</span></button>{!board?.drone?.available && <p className="muted">{board?.drone ? "Simulator is on another mission." : "Start the local agent to make the simulator available."}</p>}</>}
          </section>}
          {role === "operator" && <section className="agent-card"><span className={`agent-dot ${agentOnline ? "online" : ""}`} /><div><strong>zip simulator 01</strong><p>{agentOnline ? "Local agent connected" : "Local agent offline"}</p></div><span className="tiny">SIM</span></section>}
          {error && <p className="error" role="alert">{error}</p>}
          {details && !details.job && <p className="error">This job could not be found. <Link href={`/${role}`}>Return to workspace</Link></p>}
        </aside>
        <div className="main-column"><MissionMap target={currentTarget} route={mission?.route} position={mission ? telemetry?.position ?? LAUNCH : undefined} state={state} onSelect={role === "request" && !activeId ? setTarget : undefined} />
          {mission ? <section className="panel mission-panel"><div className="mission-heading"><div><p className="eyebrow">MISSION / PLAN V{mission.planVersion}</p><h2>{labels[mission.state]}</h2></div><Status state={mission.state} /></div>
            <div className="telemetry" aria-label="Simulated telemetry"><div><span>Altitude</span><strong data-testid="altitude">{Math.round(telemetry?.altitude ?? 0)}<small>m</small></strong></div><div><span>Battery</span><strong>{Math.round(telemetry?.battery ?? 100)}<small>%</small></strong></div><div><span>Elapsed</span><strong data-testid="elapsed">{(telemetry?.elapsed ?? 0).toFixed(1)}<small>/ 20 s</small></strong></div><div><span>Current step</span><strong className="step-value">{telemetry ? mission.steps[telemetry.step].name : "Preflight"}</strong></div></div>
            <ol className="steps">{mission.steps.map((step, index) => <li key={step.name} className={step.status}><span>{step.status === "completed" ? "✓" : `0${index + 1}`}</span><div>{step.name}<small>{step.status === "active" ? "In progress" : step.status === "completed" ? "Done" : "Upcoming"}</small></div></li>)}</ol>
            <div className="flight-action"><div><strong>{mission.agentReady ? "Simulated agent ready" : "Waiting for simulated agent"}</strong><p>Supervised autonomy · automatic return & landing</p></div>{role === "operator" && <button className="primary start" disabled={busy || mission.state !== "ready" || !agentOnline || !!details?.command} onClick={() => void act(() => start({ missionId: mission._id }))}>{details?.command ? details.command.status === "completed" ? "Flight completed ✓" : details.command.status === "failed" ? "Flight failed" : details.command.status === "pending" ? "Start sent…" : "Flight in progress" : "Start autonomous flight"}<span>↗</span></button>}</div>
            {mission.error && <p className="error" role="alert">{mission.error} Restart the local demo to try again.</p>}
            <details className="events"><summary>Mission activity <span>{details?.events.length} events</span></summary><ol>{details?.events.map(e => <li key={e._id}><time>{new Date(e.timestamp).toLocaleTimeString()}</time><span>{e.message}</span></li>)}</ol></details>
          </section> : <section className="map-caption"><span className="caption-number">{role === "request" ? "01" : "→"}</span><div><h2>{role === "request" ? "Place the job. We’ll take it from there." : "Accept a job to prepare its flight."}</h2><p>{role === "request" ? "An operator will assign the simulator and supervise your flight." : "The route, mission steps, and live telemetry will appear here."}</p></div></section>}
          <footer className="footnote"><span className="live-dot" /> All aircraft, map coordinates, and telemetry are simulated.</footer>
        </div>
      </div>
    </main>
  </>;
}
