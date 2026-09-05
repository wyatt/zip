"use client";
import { type Point } from "@/lib/flight";
import { formatPoint, taskSummary, type Task, type TaskType } from "@/lib/tasks";

export type Draft = { type: TaskType; first?: Point; second?: Point };
export function draftTask(draft: Draft): Task | undefined {
  if (!draft.first || !draft.second) return;
  return draft.type === "deliver" ? { type: "deliver", pickup: draft.first, dropoff: draft.second } : { type: draft.type, region: { northWest: { x: Math.min(draft.first.x, draft.second.x), y: Math.min(draft.first.y, draft.second.y) }, southEast: { x: Math.max(draft.first.x, draft.second.x), y: Math.max(draft.first.y, draft.second.y) } } };
}
export function TaskForm({ draft, onChange, slot, onSlot, onSubmit, busy, connected }: { draft: Draft; onChange: (draft: Draft) => void; slot: "first" | "second"; onSlot: (slot: "first" | "second") => void; onSubmit: (data: FormData) => void; busy: boolean; connected: boolean }) {
  const task = draftTask(draft);
  return <section className="panel"><h2>What needs doing?</h2><form onSubmit={e => { e.preventDefault(); onSubmit(new FormData(e.currentTarget)); }}>
    <fieldset><legend>Task type</legend><div className="task-tabs">{(["deliver", "search", "inspection"] as const).map(type => <label key={type} className={draft.type === type ? "active" : ""}><input type="radio" name="taskType" value={type} checked={draft.type === type} onChange={() => { onChange({ type }); onSlot("first"); }} /><span>{type === "deliver" ? "Deliver" : type === "search" ? "Search" : "Inspection"}</span></label>)}</div></fieldset>
    <label>Your name<input name="requester" autoComplete="name" placeholder="e.g. Alex Morgan" maxLength={80} required /></label>
    <fieldset><legend>{draft.type === "deliver" ? "Pickup & delivery" : `${draft.type === "search" ? "Search" : "Inspection"} region`}</legend><p className="muted">{draft.type === "deliver" ? "Place two pins on the map. Select a location below to change it." : "Choose two opposite corners on the map to outline a rectangular region."}</p><div className="location-choices">{(["first", "second"] as const).map((key, i) => <button key={key} type="button" className={slot === key ? "active" : ""} onClick={() => onSlot(key)}><span className="location-index">{i + 1}</span><span><strong>{draft.type === "deliver" ? i === 0 ? "Pickup location" : "Delivery location" : i === 0 ? "First corner" : "Opposite corner"}</strong><small>{draft[key] ? formatPoint(draft[key]) : "Select on map"}</small></span></button>)}</div>{task && <p className="selection-summary" data-testid="selection-summary">{taskSummary(task)}</p>}<button type="button" className="text-button" disabled={!draft.first && !draft.second} onClick={() => { onChange({ type: draft.type }); onSlot("first"); }}>Clear selection</button></fieldset>
    <label>{draft.type === "deliver" ? "Additional information" : draft.type === "search" ? "What should we look for?" : "What needs inspecting?"}<textarea name="description" placeholder={draft.type === "deliver" ? "Package details, pickup instructions, and drop-off notes" : draft.type === "search" ? "Describe the person, pet, or item to look for" : "Describe the site and anything to focus on"} maxLength={500} rows={4} required /></label>
    <button className="primary" disabled={busy || !connected || !task}>{busy ? "Submitting…" : "Submit job"}<span>↗</span></button>
  </form></section>;
}
