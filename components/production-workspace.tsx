"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import {
  JOB_LABELS,
  OPERATION_LABELS,
  REQUEST_MODES,
  TELEMETRY_STALE_MS,
  formatDistanceM,
  formatDurationSec,
  metersBetween,
  operationStatusPending,
  pickAcceptAircraft,
  preflightProblems,
  previewAcceptedFlight,
  remainingFlightSec,
  resolvedBatteryPct,
  type CommandKind,
  type ControlMode,
  type Environment,
  type GeoPoint,
  type RoutePoint,
  type RequestKind,
} from "@/lib/operations";
import { formatSurge, formatUsd, quoteWorkOrder } from "@/lib/pricing";
import { AuthGate, type Account } from "./auth-gate";
import { AppShell } from "./app-shell";
import { FlightMap } from "./flight-map";
import { JobViewer } from "./job-viewer";
import type { AircraftSample } from "@/lib/operations";
import { ComputerControls } from "./computer-controls";
import { areaGeometry, surveyArea, type SurveyArea } from "@/lib/areas";
import { CameraPanel } from "./camera-panel";
import { clock, DEMO_PHASE_LABELS } from "@/lib/mission-snapshot";
import { OperatorSplit } from "./operator-split";
import { useBrowserLocation } from "./use-browser-location";
import { useRegionalAcceptPreview } from "./use-regional-preview";
import { DRONE_TYPES, droneTypeByModel } from "@/lib/aircraft";
import { ITHACA_HOME } from "@/lib/ithaca";
import { ArrowLeft } from "pixelarticons/react/ArrowLeft";
import { Trash } from "pixelarticons/react/Trash";

export const INITIAL_LOCATION = ITHACA_HOME;
export function messageOf(error: unknown) {
  if (!(error instanceof Error)) return "The request could not be completed.";
  const match = error.message.match(/Uncaught Error: ([^\n]+)/);
  return match ? match[1] : error.message.split("\n")[0].slice(0, 300);
}
function useOperationSelection() {
  const [id, setId] = useState<Id<"operations"> | null>(null);
  useEffect(() => {
    const value = new URL(location.href).searchParams.get("operation");
    if (value && /^[a-z0-9]{20,40}$/.test(value))
      setId(value as Id<"operations">);
  }, []);
  function select(value: Id<"operations"> | null) {
    setId(value);
    const url = new URL(location.href);
    if (value) url.searchParams.set("operation", value);
    else url.searchParams.delete("operation");
    history.replaceState(null, "", url);
  }
  return [id, select] as const;
}
export function ProductionWorkspace({
  role,
}: {
  role: "request" | "operator";
}) {
  const surface = role === "request" ? "customer" : "operator";
  return (
    <AuthGate surface={surface}>
      {(account) => (
        <AppShell account={account} surface={surface}>
          {role === "request" ? (
            <CustomerWorkspace />
          ) : account.operator?.approved ? (
            <OperatorWorkspace account={account} />
          ) : (
            <OperatorOnboarding account={account} />
          )}
        </AppShell>
      )}
    </AuthGate>
  );
}

function offsetPoint(point: GeoPoint, northM: number, eastM = 0): GeoPoint {
  return {
    lat: point.lat + northM / 111320,
    lon: point.lon + eastM / (111320 * Math.cos((point.lat * Math.PI) / 180)),
  };
}
function jobPreviewPath(order: {
  location: GeoPoint;
  destinations: GeoPoint[];
  area?: SurveyArea;
}): RoutePoint[] {
  if (order.area) return order.destinations;
  return previewAcceptedFlight({
    kind: "deliver",
    location: order.location,
    destinations: order.destinations,
    home: order.location,
    altitudeM: 0,
    hoverSec: 0,
  }).path;
}
function workOrderStatus(status: string) {
  if (status === "open") return "Finding an operator";
  if (status === "assigned") return "In progress";
  return status;
}
function RequestHeading({
  title,
  onBack,
  backLabel = "Back to requests",
}: {
  title: string;
  onBack: () => void;
  backLabel?: string;
}) {
  return (
    <div className="page-heading">
      <div className="page-title">
        <button
          type="button"
          className="back-icon"
          aria-label={backLabel}
          onClick={onBack}
        >
          <ArrowLeft width={28} height={28} aria-hidden />
        </button>
        <h1>{title}</h1>
      </div>
    </div>
  );
}

function CustomerWorkspace() {
  const orders = useQuery(api.workOrders.mine);
  const submit = useMutation(api.workOrders.submit),
    cancel = useMutation(api.workOrders.cancel);
  const [operationId, selectOperation] = useOperationSelection();
  const [page, setPage] = useState<"home" | "compose" | "mission">("home");
  const [kind, setKind] = useState<RequestKind>("deliver");
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [firstCorner, setFirstCorner] = useState<GeoPoint | null>(null);
  const [secondCorner, setSecondCorner] = useState<GeoPoint | null>(null);
  const [corner, setCorner] = useState<"first" | "second">("first");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<Id<"workOrders"> | null>(null);
  const restored = useRef(false);
  const selected =
    orders?.find((order) => order._id === selectedId) ??
    orders?.find((order) => order.operationId === operationId);
  const isAreaJob = kind === "search" || kind === "inspection";
  const isDelivery = kind === "deliver";
  const mode =
    REQUEST_MODES.find((item) => item.kind === kind) ?? REQUEST_MODES[0]!;
  useEffect(() => {
    if (restored.current || !orders || !operationId) return;
    const match = orders.find((order) => order.operationId === operationId);
    if (!match || match.status === "cancelled") return;
    restored.current = true;
    setSelectedId(match._id);
    setPage("mission");
  }, [orders, operationId]);
  useEffect(() => {
    if (selected?.operationId) selectOperation(selected.operationId);
  }, [selected?.operationId]);
  const area =
    isAreaJob && firstCorner && secondCorner
      ? surveyArea(firstCorner, secondCorner)
      : undefined;
  let geometry: ReturnType<typeof areaGeometry> | undefined;
  let areaError = "";
  if (area) {
    try {
      geometry = areaGeometry(area);
    } catch (caught) {
      areaError = messageOf(caught);
    }
  }
  const { preview: deliveryPreview, planning: planningDelivery, error: deliveryPlanError } =
    useRegionalAcceptPreview(
      page === "compose" && isDelivery && firstCorner && secondCorner
        ? {
            kind: "deliver",
            home: firstCorner,
            location: firstCorner,
            destinations: [secondCorner],
            altitudeM: 3,
            hoverSec: 10,
          }
        : null,
    );
  const chooseLocation = (point: GeoPoint) => {
    if (!isAreaJob && !isDelivery) {
      setLocation(point);
      return;
    }
    if (corner === "first" || !firstCorner) {
      setFirstCorner(point);
      setLocation(point);
      setCorner("second");
      return;
    }
    setSecondCorner(
      metersBetween(firstCorner, point) < 10
        ? offsetPoint(firstCorner, 80)
        : point,
    );
  };
  const moveDeliveryPoint = (id: string, point: GeoPoint) => {
    if (id === "a") {
      setFirstCorner(point);
      setLocation(point);
      setCorner("first");
      if (secondCorner && metersBetween(point, secondCorner) < 10) {
        setSecondCorner(offsetPoint(point, 80));
      }
      return;
    }
    if (id === "b") {
      const origin = firstCorner ?? point;
      setSecondCorner(metersBetween(origin, point) < 10 ? offsetPoint(origin, 80) : point);
      setCorner("second");
    }
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
  function openMission(
    orderId: Id<"workOrders">,
    nextOperationId: Id<"operations"> | null,
  ) {
    setPage("mission");
    setSelectedId(orderId);
    setError("");
    selectOperation(nextOperationId);
  }
  const heading =
    page === "compose"
      ? `Request ${mode.label}`
      : page === "mission"
        ? (selected?.title ?? "Mission")
        : "Requests";
  const jobPoint = geometry?.center ?? firstCorner ?? location ?? ITHACA_HOME;
  const nearby = useQuery(
    api.workOrders.availableNearby,
    page === "compose"
      ? {
          kind,
          location: jobPoint,
          destinations: secondCorner ? [secondCorner] : [],
          payloadKg: 0,
          environment: "aircraft",
        }
      : "skip",
  );
  const nearbyFleet = spreadFleet(nearby ?? []);
  const split = page !== "home";
  const missions = orders?.filter((order) => order.status !== "cancelled");
  useEffect(() => {
    if (page === "mission" && selected?.status === "cancelled") goHome();
  }, [page, selected?.status]);
  return (
    <main
      className={`workspace operator-retro request-page${split ? " request-split" : " request-catalog"}`}
    >
      {page === "home" && (
        <>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <section className="mission-section">
            <div className="section-title">
              <h2>Your missions</h2>
              <span className="count">{missions?.length ?? 0}</span>
            </div>
            {missions === undefined ? (
              <p className="muted">Loading missions…</p>
            ) : missions.length === 0 ? (
              <p className="muted">
                No missions yet. Choose a flight type below to send a request.
              </p>
            ) : (
              <div className="mission-strip">
                {missions.map((order) => {
                  const type = DRONE_TYPES.find(
                    (item) => item.label === order.vehicleModel,
                  );
                  const confirmed = order.status !== "open" && !!type;
                  return (
                    <button
                      type="button"
                      className="mission-card"
                      key={order._id}
                      onClick={() =>
                        openMission(order._id, order.operationId ?? null)
                      }
                    >
                      <span className="mission-copy">
                        <span className="job-person">{order.title}</span>
                        <span className="job-description">
                          {JOB_LABELS[order.kind]} ·{" "}
                          {order.environment === "simulated"
                            ? "Simulation"
                            : "Aircraft"}
                        </span>
                      </span>
                      <span
                        className={`mission-art${confirmed ? "" : " silhouette"}`}
                        aria-hidden
                      >
                        <img
                          src={
                            type && confirmed
                              ? type.src
                              : "/drones/dji-mini-4k.png"
                          }
                          alt=""
                        />
                      </span>
                      <span className={`status ${order.status}`}>
                        {workOrderStatus(order.status)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          <section className="mode-section">
            <div className="section-title">
              <h2>Request a flight</h2>
            </div>
            <div className="mode-grid">
              {REQUEST_MODES.map((item) => (
                <button
                  type="button"
                  className="mode-card"
                  key={item.kind}
                  aria-label={item.label}
                  onClick={() => openCompose(item.kind)}
                >
                  <span className="mode-art" aria-hidden>
                    <span
                      className="mode-sprite"
                      style={{
                        ["--mode-frame" as string]: `${item.frame * 50}%`,
                      }}
                    />
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
        <OperatorSplit
          storageKey="iris-request-split"
          board={
            <>
              <RequestHeading title={heading} onBack={goHome} />
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!location || (isAreaJob && !geometry) || (isDelivery && !secondCorner)) return;
                  const data = new FormData(event.currentTarget);
                  setBusy(true);
                  setError("");
                  try {
                    const pickup = firstCorner ?? location;
                    const dropoff = secondCorner ?? location;
                    const id = await submit({
                      title: String(data.get("title")),
                      description: String(data.get("description")),
                      kind,
                      environment: "aircraft",
                      location: geometry?.center ?? pickup,
                      ...(area ? { area } : {}),
                      destinations: geometry?.destinations ?? (isDelivery ? [dropoff] : [location]),
                      payloadKg:
                        kind === "deliver" ? Number(data.get("payload")) : 0,
                      altitudeM: Number(data.get("altitude")),
                      hoverSec: Number(data.get("hover")),
                    });
                    openMission(id, null);
                  } catch (caught) {
                    setError(messageOf(caught));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Title
                  <input
                    name="title"
                    required
                    minLength={3}
                    maxLength={100}
                    placeholder={
                      kind === "deliver"
                        ? "e.g. Pharmacy drop-off"
                        : kind === "search"
                          ? "e.g. Trail search"
                          : "e.g. Roof survey"
                    }
                  />
                </label>
                <label>
                  Instructions
                  <textarea
                    name="description"
                    maxLength={2000}
                    rows={3}
                    placeholder={
                      kind === "deliver"
                        ? "Package details, pickup notes, and drop-off instructions"
                        : kind === "search"
                          ? "Who or what should the operator look for?"
                          : "What should be inspected?"
                    }
                  />
                </label>
                <div className="coordinates">
                  <input name="altitude" type="hidden" value="3" />
                  <input name="hover" type="hidden" value="10" />
                </div>
                {kind === "deliver" && (
                  <label>
                    Payload (kg)
                    <input
                      name="payload"
                      type="number"
                      min={0}
                      max={25}
                      step={0.1}
                      defaultValue={0}
                      required
                    />
                  </label>
                )}
                {isDelivery && (
                  <fieldset>
                    <legend>Pickup and drop-off</legend>
                    <p className="muted">
                      Place point A, then point B. Drag either marker to
                      refine the route. The planner flies A → B, delivers at
                      B, and returns to A.
                    </p>
                    <div className="location-choices">
                      {(["first", "second"] as const).map((slot, index) => (
                        <button
                          key={slot}
                          type="button"
                          className={corner === slot ? "active" : ""}
                          onClick={() => setCorner(slot)}
                        >
                          <span className="location-index">{index === 0 ? "A" : "B"}</span>
                          <span>
                            <strong>{slot === "first" ? "Pickup A" : "Drop-off B"}</strong>
                            <small>
                              {(slot === "first" ? firstCorner : secondCorner)
                                ? "Selected · drag marker to move"
                                : "Select on map"}
                            </small>
                          </span>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setFirstCorner(null);
                        setSecondCorner(null);
                        setLocation(null);
                        setCorner("first");
                      }}
                    >
                      Clear points
                    </button>
                    {firstCorner && secondCorner && (
                      <p className="selection-summary">
                        {Math.round(metersBetween(firstCorner, secondCorner))} m A → B
                        {planningDelivery
                          ? " · planning terrain route…"
                          : deliveryPreview?.planned
                            ? ` · ${formatDurationSec(deliveryPreview.durationSec)} terrain route`
                            : " · straight-line preview"}
                      </p>
                    )}
                    {deliveryPlanError && (
                      <p className="muted" role="status">
                        {deliveryPlanError} Showing A → B → A until a terrain
                        route is available.
                      </p>
                    )}
                  </fieldset>
                )}
                {isAreaJob && (
                  <fieldset>
                    <legend>
                      {kind === "search" ? "Search area" : "Inspection area"}
                    </legend>
                    <p className="muted">
                      Choose two opposite corners on the map. The shaded area
                      shows the boundary and the grid shows the planned sweep.
                    </p>
                    <div className="location-choices">
                      {(["first", "second"] as const).map((slot, index) => (
                        <button
                          key={slot}
                          type="button"
                          className={corner === slot ? "active" : ""}
                          onClick={() => setCorner(slot)}
                        >
                          <span className="location-index">{index + 1}</span>
                          <span>
                            <strong>
                              {slot === "first"
                                ? "First corner"
                                : "Opposite corner"}
                            </strong>
                            <small>
                              {(slot === "first" ? firstCorner : secondCorner)
                                ? "Selected · click to edit"
                                : "Select on map"}
                            </small>
                          </span>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setFirstCorner(null);
                        setSecondCorner(null);
                        setLocation(null);
                        setCorner("first");
                      }}
                    >
                      Clear area
                    </button>
                    {geometry && (
                      <p className="selection-summary">
                        {Math.round(geometry.widthM)} ×{" "}
                        {Math.round(geometry.heightM)} m ·{" "}
                        {(geometry.areaM2 / 10000).toFixed(2)} ha ·{" "}
                        {geometry.destinations.length / 2} sweep rows
                      </p>
                    )}
                    {areaError && (
                      <p className="error" role="status">
                        {areaError}
                      </p>
                    )}
                  </fieldset>
                )}
                {!isAreaJob && !isDelivery && (
                  <p className="selection-summary">
                    {location
                      ? `${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}`
                      : "Choose the job location on the map."}
                  </p>
                )}
                {isDelivery && !secondCorner && (
                  <p className="selection-summary">
                    Choose point {corner === "first" ? "A (pickup)" : "B (drop-off)"} on
                    the map.
                  </p>
                )}
                {isAreaJob && !geometry && (
                  <p className="selection-summary">
                    Choose the {corner === "first" ? "first" : "opposite"}{" "}
                    corner on the map.
                  </p>
                )}
                <button
                  className="primary"
                  disabled={busy || !location || (isAreaJob && !geometry) || (isDelivery && !secondCorner)}
                >
                  {busy ? "Submitting…" : "Submit request"}
                  <span>↗</span>
                </button>
              </form>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </>
          }
          map={
            <FlightMap
              chrome={false}
              hideHome={isDelivery}
              home={firstCorner ?? location ?? ITHACA_HOME}
              selected={isDelivery ? undefined : geometry?.center ?? location ?? undefined}
              area={area}
              markers={
                isDelivery
                  ? [
                      ...(firstCorner ? [{ id: "a", label: "A", point: firstCorner }] : []),
                      ...(secondCorner ? [{ id: "b", label: "B", point: secondCorner }] : []),
                    ]
                  : undefined
              }
              route={
                isDelivery
                  ? (deliveryPreview?.path ??
                    (firstCorner && secondCorner
                      ? [firstCorner, secondCorner, firstCorner]
                      : undefined))
                  : geometry?.destinations
              }
              fleet={nearbyFleet}
              onSelect={chooseLocation}
              onMarkerMove={isDelivery ? moveDeliveryPoint : undefined}
            />
          }
        />
      )}
      {page === "mission" && !selected && (
        <RequestHeading title="Mission" onBack={goHome} />
      )}
      {page === "mission" && selected && (
        <OperatorSplit
          overlay
          storageKey="iris-request-split"
          board={
            <div className="job-float">
              <RequestHeading title={heading} onBack={goHome} />
              {selected.operationId ? (
                <OperationPanel
                  operationId={selected.operationId}
                  operator={false}
                  map={false}
                />
              ) : (
                <WaitingPanel order={selected} />
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {selected.status === "open" && (
                <button
                  type="button"
                  className="cancel-request"
                  aria-label="Cancel request"
                  onClick={async () => {
                    try {
                      await cancel({ workOrderId: selected._id });
                      goHome();
                    } catch (caught) {
                      setError(messageOf(caught));
                    }
                  }}
                >
                  <Trash width={22} height={22} aria-hidden />
                </button>
              )}
            </div>
          }
          map={
            selected.operationId ? (
              <OperatorLiveMap operationId={selected.operationId} />
            ) : (
              <WaitingMap order={selected} />
            )
          }
        />
      )}
    </main>
  );
}

type NearbyAircraft = {
  vehicleId: Id<"vehicles">;
  name: string;
  model: string | null;
  operatorName: string;
  environment: Environment;
  own: boolean;
  position: GeoPoint;
  highlighted?: boolean;
};
function spreadFleet(nearby: NearbyAircraft[]) {
  const groups: NearbyAircraft[][] = [];
  for (const vehicle of nearby) {
    const group = groups.find(
      (entry) => metersBetween(entry[0]!.position, vehicle.position) < 180,
    );
    if (group) group.push(vehicle);
    else groups.push([vehicle]);
  }
  return groups.map((group) => {
    const first = group[0]!;
    const type = droneTypeByModel(first.model ?? undefined);
    const stacked = group.length > 1;
    const thumbs = stacked
      ? [
          ...group
            .reduce((counts, vehicle) => {
              const kind = droneTypeByModel(vehicle.model ?? undefined);
              const key = kind.id;
              const existing = counts.get(key);
              if (existing) existing.count += 1;
              else
                counts.set(key, { src: kind.src, label: kind.label, count: 1 });
              return counts;
            }, new Map<string, { src: string; label: string; count: number }>())
            .values(),
        ]
      : undefined;
    return {
      id: stacked
        ? group.map((vehicle) => vehicle.vehicleId).join("-")
        : first.vehicleId,
      src: type.src,
      label: stacked
        ? `${first.operatorName} · ${group.length} aircraft`
        : first.own
          ? `${first.name} · Your fleet`
          : first.model
            ? `${first.name} · ${first.model}`
            : first.name,
      point: first.position,
      highlighted: group.some((vehicle) => vehicle.highlighted),
      thumbs,
    };
  });
}
function JobArt({ src, silhouette }: { src: string; silhouette?: boolean }) {
  return (
    <span className={`job-art${silhouette ? " silhouette" : ""}`} aria-hidden>
      <img src={src} alt="" />
    </span>
  );
}
function OperatorDashboardMap({
  vehicles,
  here,
  order,
  operationId,
  highlightIds,
  preview,
}: {
  vehicles?: {
    _id: Id<"vehicles">;
    name: string;
    model?: string;
    home: GeoPoint;
    telemetry?: { sample?: { position: GeoPoint | null } | null } | null;
  }[];
  here: GeoPoint;
  order?: {
    location: GeoPoint;
    area?: SurveyArea;
    destinations: GeoPoint[];
  };
  operationId: Id<"operations"> | null;
  highlightIds: Id<"vehicles">[];
  preview?: {
    home: GeoPoint;
    position: GeoPoint;
    path: RoutePoint[];
    spriteSrc: string;
  };
}) {
  const details = useQuery(
    api.operations.details,
    operationId ? { operationId } : "skip",
  );
  const telemetry = useQuery(
    api.operations.telemetry,
    operationId ? { operationId } : "skip",
  );
  const highlighted = new Set(highlightIds);
  const liveId = details?.vehicle?._id;
  const livePos = telemetry?.sample?.position;
  const home =
    details?.operation.plan.home ??
    preview?.home ??
    order?.location ??
    vehicles?.[0]?.home ??
    here;
  const area = order?.area ?? details?.order?.area;
  if (order || operationId) {
    return (
      <JobViewer
        home={home}
        area={area}
        sample={telemetry?.sample}
        sessionId={telemetry?.sessionId}
        destinations={
          telemetry?.sample?.mission?.path ??
          preview?.path ??
          (order ? jobPreviewPath(order) : undefined)
        }
        previewPosition={preview?.position}
        spriteSrc={
          preview?.spriteSrc ??
          droneTypeByModel(
            details?.vehicle?.model ??
              vehicles?.find((vehicle) => highlighted.has(vehicle._id))
                ?.model ??
              vehicles?.[0]?.model,
          ).src
        }
      />
    );
  }
  return (
    <FlightMap
      chrome={false}
      hideHome
      home={home}
      area={area}
      route={telemetry?.sample?.mission?.path}
      fleet={spreadFleet(
        (vehicles ?? []).map((vehicle) => ({
          vehicleId: vehicle._id,
          name: vehicle.name,
          model: vehicle.model ?? null,
          operatorName: "",
          environment: "simulated" as const,
          own: true,
          position:
            liveId === vehicle._id && livePos
              ? livePos
              : (vehicle.telemetry?.sample?.position ?? vehicle.home),
          highlighted: highlighted.has(vehicle._id),
        })),
      )}
    />
  );
}
function WaitingMap({
  order,
}: {
  order: {
    _id: Id<"workOrders">;
    status: string;
    location: GeoPoint;
    area?: SurveyArea;
    destinations: GeoPoint[];
  };
}) {
  const nearby = useQuery(api.workOrders.availableNearby, { workOrderId: order._id });
  return (
    <FlightMap
      chrome={false}
      hideHome
      home={order.location}
      selected={order.location}
      selectedLabel="Job"
      area={order.area}
      route={jobPreviewPath(order)}
      fleet={spreadFleet(nearby ?? [])}
    />
  );
}
function WaitingPanel({
  order,
}: {
  order: {
    _id: Id<"workOrders">;
    status: string;
    kind: RequestKind | "flight_check";
    description: string;
    altitudeM: number;
    hoverSec: number;
    environment: Environment;
  };
}) {
  return (
    <section className="panel">
      <p className="eyebrow">{JOB_LABELS[order.kind].toUpperCase()}</p>
      <h2
        className={order.status === "cancelled" ? undefined : "status-pulse"}
      >
        {order.status === "cancelled"
          ? "Request cancelled"
          : "Finding a qualified operator"}
      </h2>
      <p className="muted">
        {order.description || "No additional instructions."}
      </p>
      {order.status === "open" && (
        <p className="muted">
          Qualified aircraft nearby are shown on the map. This page updates when
          an operator accepts.
        </p>
      )}
    </section>
  );
}
function payoutLabel(cents: number, surgeX?: number) {
  const surge = surgeX ? formatSurge(surgeX) : "";
  return surge ? `${formatUsd(cents)} · ${surge}` : formatUsd(cents);
}

function OperatorWorkspace({ account }: { account: Account }) {
  const eligible = useQuery(api.workOrders.eligible),
    operations = useQuery(api.operations.mine),
    vehicles = useQuery(api.fleet.mine);
  const { point: here } = useBrowserLocation();
  const accept = useMutation(api.workOrders.accept);
  const remove = useMutation(api.workOrders.remove);
  const [operationId, selectOperation] = useOperationSelection();
  const [boardTab, setBoardTab] = useState<"available" | "active">("available");
  const [selectedOrder, setSelectedOrder] = useState<Id<"workOrders"> | null>(
      null,
    ),
    [selectedVehicle, setSelectedVehicle] = useState<string>("");
  const [mode, setMode] = useState<ControlMode>("manual");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const order = eligible?.find((order) => order._id === selectedOrder);
  const availableVehicles =
    vehicles?.filter((vehicle) =>
      order?.eligibleVehicleIds.includes(vehicle._id),
    ) ?? [];
  const recommendedVehicle =
    order && availableVehicles.length
      ? pickAcceptAircraft(
          availableVehicles.map((item) => ({
            ...item,
            liveBatteryPct: item.telemetry?.sample?.batteryPct,
          })),
          order,
        )
      : undefined;
  const vehicle =
    availableVehicles.find((v) => v._id === selectedVehicle) ??
    recommendedVehicle ??
    availableVehicles[0];
  const vehicleId = vehicle?._id;
  const selectedQuote =
    order && vehicle
      ? quoteWorkOrder(order, vehicle.home, order.market)
      : order?.quote;
  const { preview: acceptPreview, planning: planningRoute, error: routeError } =
    useRegionalAcceptPreview(
      order && vehicle
        ? {
            kind: order.kind,
            location: order.location,
            destinations: order.destinations,
            area: order.area,
            home: vehicle.home,
            altitudeM: order.altitudeM,
            hoverSec: order.hoverSec,
          }
        : null,
    );
  const acceptPosition = vehicle
    ? (vehicle.telemetry?.sample?.position ?? vehicle.home)
    : undefined;
  const lifetimeCents = account.operator?.lifetimeEarningsCents ?? 0;
  const manualControl = vehicle?.capabilities.includes("manual_computer")
    ? ("computer" as const)
    : ("remote" as const);
  const showActive = boardTab === "active";
  useEffect(() => {
    if (operationId) setBoardTab("active");
  }, [operationId]);
  useEffect(() => {
    setSelectedVehicle("");
  }, [selectedOrder]);
  const availableCount = eligible?.length ?? 0;
  const overlayingJob = !showActive && !!order;
  const overlayingFlight = showActive && !!operationId;
  const overlay = overlayingJob || overlayingFlight;
  function closeOverlay() {
    setError("");
    if (overlayingFlight) selectOperation(null);
    else setSelectedOrder(null);
  }
  async function deleteJob(workOrderId: Id<"workOrders">) {
    setError("");
    try {
      await remove({ workOrderId });
      if (selectedOrder === workOrderId) setSelectedOrder(null);
      const flight = operations?.find((item) => item.workOrderId === workOrderId);
      if (flight && operationId === flight._id) selectOperation(null);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }
  useEffect(() => {
    if (!overlay) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      closeOverlay();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, overlayingFlight]);
  const listBoard = (
    <>
      <div
        className="page-heading operator-flight-tabs"
        role="tablist"
        aria-label="Flight lists"
      >
        <button
          type="button"
          role="tab"
          id="operator-tab-available"
          aria-selected={!showActive}
          aria-controls="operator-panel-available"
          className={`flight-tab ${showActive ? "" : "selected"}`}
          onClick={() => setBoardTab("available")}
        >
          Available
          {availableCount > 0 && (
            <span
              className="tab-badge"
              aria-label={`${availableCount} available ${availableCount === 1 ? "job" : "jobs"}`}
            >
              {availableCount}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          id="operator-tab-active"
          aria-selected={showActive}
          aria-controls="operator-panel-active"
          className={`flight-tab ${showActive ? "selected" : ""}`}
          onClick={() => setBoardTab("active")}
        >
          Active
        </button>
      </div>
      {!showActive && (
        <div
          id="operator-panel-available"
          role="tabpanel"
          aria-labelledby="operator-tab-available"
        >
          {eligible === undefined ? (
            <p>Loading jobs…</p>
          ) : eligible.length === 0 ? (
            <p className="muted">
              No matching jobs right now. Jobs appear here based on your
              qualifications, service area, and available aircraft.
            </p>
          ) : (
            <div className="job-list">
              {eligible.map((job) => {
                const candidates =
                  vehicles?.filter((item) =>
                    job.eligibleVehicleIds.includes(item._id),
                  ) ?? [];
                const match =
                  pickAcceptAircraft(
                    candidates.map((item) => ({
                      ...item,
                      liveBatteryPct: item.telemetry?.sample?.batteryPct,
                    })),
                    job,
                  ) ?? candidates[0];
                const type = droneTypeByModel(match?.model);
                const eta = previewAcceptedFlight({
                  kind: job.kind,
                  location: job.location,
                  destinations: job.destinations,
                  home: match?.home ?? job.location,
                  altitudeM: job.altitudeM,
                  hoverSec: job.hoverSec,
                }).durationSec;
                return (
                  <div className="job-item" key={job._id}>
                    <button
                      className="job-row"
                      onClick={() => {
                        setSelectedOrder(job._id);
                        setError("");
                      }}
                    >
                      <JobArt src={type.src} silhouette />
                      <span className="mission-copy">
                        <span className="job-person">
                          {job.title}
                          <span className="job-pay">
                            {formatUsd(job.quote.cents)}
                          </span>
                        </span>
                        <span className="job-description">
                          {JOB_LABELS[job.kind]} · ~{formatDurationSec(eta)}
                        </span>
                      </span>
                      <span className="status available">Available</span>
                    </button>
                    <button
                      type="button"
                      className="text-button delete-job"
                      onClick={() => void deleteJob(job._id)}
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {lifetimeCents > 0 && (
            <p className="muted earnings-total">
              Recorded earnings {formatUsd(lifetimeCents)}
            </p>
          )}
        </div>
      )}
      {showActive && (
        <div
          id="operator-panel-active"
          role="tabpanel"
          aria-labelledby="operator-tab-active"
        >
          {operations === undefined ? (
            <p>Loading flights…</p>
          ) : operations.length === 0 ? (
            <p className="muted">Accepted jobs will appear here.</p>
          ) : (
            <div className="job-list">
              {operations.map((operation) => {
                const type = droneTypeByModel(
                  operation.vehicleModel ?? undefined,
                );
                const left = remainingFlightSec({
                  state: operation.state,
                  maxDurationSec: operation.plan.maxDurationSec,
                  startedAt: operation.startedAt,
                  now,
                });
                const pending = operationStatusPending(operation.state);
                const eta =
                  operation.state === "completed"
                    ? "Complete"
                    : operation.state === "cancelled"
                      ? "Cancelled"
                      : pending && operation.startedAt
                        ? `${formatDurationSec(left)} left`
                        : `~${formatDurationSec(left)}`;
                return (
                  <div className="job-item" key={operation._id}>
                    <button
                      className="job-row"
                      onClick={() => {
                        selectOperation(operation._id);
                        setSelectedOrder(null);
                      }}
                    >
                      <JobArt src={type.src} />
                      <span className="mission-copy">
                        <span className="job-person">
                          {operation.title}
                          {(operation.earnedCents ??
                            operation.quotedEarnings?.cents) != null && (
                            <span className="job-pay">
                              {formatUsd(
                                operation.earnedCents ??
                                  operation.quotedEarnings?.cents ??
                                  0,
                              )}
                            </span>
                          )}
                        </span>
                        <span className="job-description">
                          {JOB_LABELS[operation.kind]} · {eta}
                        </span>
                      </span>
                      <span
                        className={`status ${operation.state}${pending ? " pending" : ""}`}
                      >
                        {OPERATION_LABELS[operation.state]}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="text-button delete-job"
                      onClick={() => void deleteJob(operation.workOrderId)}
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
  const overlayFlight = operations?.find((item) => item._id === operationId);
  const overlayWorkOrderId = overlayingJob
    ? order?._id
    : overlayFlight?.workOrderId;
  const overlayBoard = (
    <div className="job-float">
      <RequestHeading
        title={
          overlayingJob
            ? (order?.title ?? "Job")
            : (overlayFlight?.title ?? "Flight")
        }
        onBack={closeOverlay}
        backLabel="Back to jobs"
      />
      {overlayingJob && order && vehicle && (
        <div className="job-overlay-meta">
          <JobArt src={droneTypeByModel(vehicle.model).src} />
          <div>
            <p>{vehicle.name}</p>
            <p className="muted" data-testid="accept-duration">
              {planningRoute
                ? "Planning terrain route…"
                : acceptPreview
                  ? `~${formatDurationSec(acceptPreview.durationSec)} flight`
                  : routeError || "Route unavailable"}
            </p>
          </div>
        </div>
      )}
      {overlayingFlight && overlayFlight && (
        <div className="job-overlay-meta">
          <JobArt
            src={droneTypeByModel(overlayFlight.vehicleModel ?? undefined).src}
          />
          <div>
            <p>{JOB_LABELS[overlayFlight.kind]}</p>
            <p className="muted">
              {overlayFlight.state === "completed"
                ? "Complete"
                : overlayFlight.state === "cancelled"
                  ? "Cancelled"
                  : `${formatDurationSec(
                      remainingFlightSec({
                        state: overlayFlight.state,
                        maxDurationSec: overlayFlight.plan.maxDurationSec,
                        startedAt: overlayFlight.startedAt,
                        now,
                      }),
                    )} remaining`}
            </p>
          </div>
        </div>
      )}
      {overlayingJob && order && (
        <section className="panel">
          <p className="muted">
            {order.description || "No additional instructions."}
          </p>
          <p className="selection-summary">
            {order.kind === "flight_check"
              ? `${order.altitudeM} m altitude · ${order.hoverSec} s hover`
              : JOB_LABELS[order.kind]}
            {planningRoute
              ? " · planning route"
              : acceptPreview
                ? ` · ~${formatDurationSec(acceptPreview.durationSec)}`
                : ""}
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!vehicleId) return;
              setBusy(true);
              setError("");
              try {
                const id = await accept({
                  workOrderId: order._id,
                  vehicleId,
                  mode,
                  manualControl,
                });
                selectOperation(id);
                setSelectedOrder(null);
              } catch (error) {
                setError(messageOf(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Aircraft
              <select
                value={vehicleId ?? ""}
                onChange={(e) => setSelectedVehicle(e.target.value)}
              >
                {availableVehicles.map((item) => {
                  const from = item.telemetry?.sample?.position ?? item.home;
                  const distance = metersBetween(from, order.location);
                  const battery = resolvedBatteryPct({
                    batteryPct: item.batteryPct,
                    liveBatteryPct: item.telemetry?.sample?.batteryPct,
                    hardwareId: item.hardwareId,
                  });
                  return (
                    <option key={item._id} value={item._id}>
                      {item.name} · {formatDistanceM(distance)} · {Math.round(battery)}%
                    </option>
                  );
                })}
              </select>
            </label>
            <fieldset className="flight-control">
              <legend>Flight control</legend>
              <label className="mode-choice">
                <input
                  type="radio"
                  name="mode"
                  value="manual"
                  checked={mode === "manual"}
                  onChange={() => setMode("manual")}
                />
                <span>
                  Manual
                  <small>You fly; telemetry verifies the flight steps.</small>
                </span>
              </label>
              <label className="mode-choice">
                <input
                  type="radio"
                  name="mode"
                  value="autonomous"
                  checked={mode === "autonomous"}
                  onChange={() => setMode("autonomous")}
                />
                <span>
                  Autonomous <span className="beta-tag">Beta</span>
                  <small>The local agent executes the approved plan.</small>
                </span>
              </label>
            </fieldset>
            <button
              className="primary accept-job"
              disabled={busy || !vehicleId}
            >
              {busy
                ? "Assigning…"
                : selectedQuote
                  ? `Accept job - ${formatUsd(selectedQuote.cents)}`
                  : "Accept job"}
              <span>↗</span>
            </button>
          </form>
        </section>
      )}
      {overlayingFlight && operationId && (
        <OperationPanel operationId={operationId} operator map={false} />
      )}
      {overlayWorkOrderId && (
        <button
          type="button"
          className="text-button delete-job"
          onClick={() => void deleteJob(overlayWorkOrderId)}
        >
          Delete
        </button>
      )}
      {(error || (overlayingJob && routeError)) && (
        <p className="error" role="alert">
          {error || routeError}
        </p>
      )}
    </div>
  );
  return (
    <main className="workspace operator-retro">
      <OperatorSplit
        overlay={overlay}
        board={listBoard}
        panel={overlayBoard}
        map={
          <OperatorDashboardMap
            vehicles={vehicles}
            here={here}
            order={order}
            operationId={showActive ? operationId : null}
            highlightIds={
              order
                ? vehicleId
                  ? [vehicleId]
                  : order.eligibleVehicleIds
                : overlayFlight
                  ? [overlayFlight.vehicleId]
                  : []
            }
            preview={
              overlayingJob && vehicle && acceptPosition
                ? {
                    home: vehicle.home,
                    position: acceptPosition,
                    path: acceptPreview?.path ?? [],
                    spriteSrc: droneTypeByModel(vehicle.model).src,
                  }
                : undefined
            }
          />
        }
      />
    </main>
  );
}

function LiveFlightMap({
  sample,
  sessionId,
  home,
  route,
  area,
  vehicleModel,
}: {
  sample?: AircraftSample;
  sessionId?: string;
  home: GeoPoint;
  route: GeoPoint[];
  area?: SurveyArea;
  vehicleModel?: string | null;
  stale?: boolean;
  chrome?: boolean;
}) {
  return (
    <JobViewer
      home={home}
      area={area}
      sample={sample}
      sessionId={sessionId}
      destinations={sample?.mission?.path ?? route}
      spriteSrc={droneTypeByModel(vehicleModel ?? undefined).src}
    />
  );
}
function OperatorLiveMap({ operationId }: { operationId: Id<"operations"> }) {
  const details = useQuery(api.operations.details, { operationId });
  const telemetry = useQuery(api.operations.telemetry, { operationId });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  if (!details) return <div className="map-loading">Loading map…</div>;
  const sample = telemetry?.sample;
  const age = sample ? Math.max(0, now - sample.capturedAt) : Infinity;
  const { operation, vehicle, session } = details;
  const fresh =
    !!sample &&
    age <= TELEMETRY_STALE_MS &&
    sample.connected &&
    telemetry?.sessionId === vehicle?.activeSessionId &&
    !!session &&
    !session.retired &&
    session.leaseUntil > now;
  return (
    <div className="live-map-stack">
      <LiveFlightMap
        chrome={false}
        area={details.order?.area}
        home={operation.plan.home}
        route={operation.plan.steps.map((step) => step.position)}
        sample={sample}
        sessionId={telemetry?.sessionId}
        vehicleModel={vehicle?.model}
        stale={!fresh}
      />
    </div>
  );
}
function OperationPanel({
  operationId,
  operator,
  map = true,
}: {
  operationId: Id<"operations">;
  operator: boolean;
  map?: boolean;
}) {
  const details = useQuery(api.operations.details, { operationId });
  const telemetry = useQuery(api.operations.telemetry, { operationId });
  const command = useMutation(api.operations.command),
    resolve = useMutation(api.operations.resolveGrounded);
  const [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmTakeover, setConfirmTakeover] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  if (!details) return <section className="panel">Loading operation…</section>;
  const { operation, vehicle, session } = details;
  const sample = telemetry?.sample;
  const age = sample ? Math.max(0, now - sample.capturedAt) : Infinity;
  const fresh =
    !!sample &&
    age <= TELEMETRY_STALE_MS &&
    sample.connected &&
    telemetry?.sessionId === vehicle?.activeSessionId &&
    !!session &&
    !session.retired &&
    session.leaseUntil > now;
  const closed = ["completed", "cancelled"].includes(operation.state);
  const problems = preflightProblems(
    fresh ? sample : null,
    operation.plan,
    now,
  );
  async function send(kind: CommandKind) {
    setBusy(true);
    setError("");
    try {
      await command({ operationId, kind, idempotencyKey: crypto.randomUUID() });
      return true;
    } catch (error) {
      setError(messageOf(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const number = (value: number | null | undefined, digits = 0) =>
    value === null || value === undefined ? "—" : value.toFixed(digits);
  const underAutonomy =
    operation.plan.mode === "autonomous" &&
    (operation.controlOwner === "autonomy" ||
      operation.state === "taking_over");
  const canTakeControl =
    fresh && ["active", "returning"].includes(operation.state);
  return (
    <>
      {map && (
        <LiveFlightMap
          area={details.order?.area}
          home={operation.plan.home}
          route={operation.plan.steps.map((step) => step.position)}
          sample={sample}
          sessionId={telemetry?.sessionId}
          vehicleModel={vehicle?.model}
          stale={!fresh}
        />
      )}
      <section className="panel mission-panel">
        <div className="mission-heading">
          <div>
            <h2>{OPERATION_LABELS[operation.state]}</h2>
          </div>
          <span
            className={`status ${fresh ? "ready" : "attention"}`}
            data-testid="telemetry-status"
          >
            {closed && sample
              ? "Recorded telemetry"
              : fresh
                ? "Live telemetry"
                : sample
                  ? "Telemetry stale"
                  : "Awaiting telemetry"}
          </span>
        </div>
        <p className="muted">
          {details.order?.title} · {vehicle?.name}
        </p>
        <div className={sample?.mission ? "telemetry" : "telemetry telemetry-stats"}>
          {sample?.mission ? (
            <>
              <div>
                <span>Phase</span>
                <strong className="step-value">
                  {DEMO_PHASE_LABELS[sample.mission.phase] ??
                    sample.mission.phase}
                </strong>
              </div>
              <div>
                <span>Mission clock</span>
                <strong>{clock(sample.mission.elapsed)}</strong>
              </div>
              <div>
                <span>Playback</span>
                <strong>
                  {number(sample.mission.multiplier, 0)}
                  <small>×</small>
                </strong>
              </div>
              <div>
                <span>Battery</span>
                <strong>
                  {number(sample.mission.battery)}
                  <small>%</small>
                </strong>
              </div>
              <div>
                <span>Predicted at A</span>
                <strong>
                  {number(sample.mission.predictedArrivalBattery)}
                  <small>%</small>
                </strong>
              </div>
              <div>
                <span>Distance</span>
                <strong>
                  {number(sample.mission.distance / 1000, 2)}
                  <small>km</small>
                </strong>
              </div>
              <div>
                <span>Photos</span>
                <strong>
                  {sample.mission.photos}
                  <small>/{sample.mission.totalPhotos}</small>
                </strong>
              </div>
              {sample.mission.result && (
                <div>
                  <span>Search</span>
                  <strong className="step-value">
                    {sample.mission.result.type === "found"
                      ? "Target found"
                      : sample.mission.result.type}
                  </strong>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <span>Altitude above launch</span>
                <strong data-testid="altitude">
                  {number(sample?.altitudeM, 1)}
                  <small>m</small>
                </strong>
              </div>
              <div>
                <span>Battery</span>
                <strong>
                  {number(sample?.batteryPct)}
                  <small>%</small>
                </strong>
              </div>
              <div>
                <span>Ground speed</span>
                <strong>
                  {number(sample?.speedMps, 1)}
                  <small>m/s</small>
                </strong>
              </div>
            </>
          )}
        </div>
        <div className="telemetry-caption">
          <span>
            {sample
              ? closed
                ? `Recorded ${new Date(sample.capturedAt).toLocaleString()}`
                : `Last measurement ${Math.min(999, age / 1000).toFixed(1)} s ago`
              : "No measurements received"}
          </span>
          <span>
            {sample?.armed === null || sample?.armed === undefined
              ? "Arming unknown"
              : sample.armed
                ? "Armed"
                : "Disarmed"}{" "}
            · {sample?.flightMode ?? "Flight mode unknown"}
          </span>
        </div>
        {operation.attention && (
          <p role="alert" className="error">
            {operation.attention}
          </p>
        )}
        {!fresh && !closed && (
          <p className="error" role="status">
            Aircraft data is unavailable or stale. The marker shows the last
            measured position.
          </p>
        )}
        {operator && !closed && (
          <div className="control-panel">
            {["assigned", "ready", "starting", "attention"].includes(
              operation.state,
            ) && (
              <>
                {problems.length > 0 && (
                  <p className="error" role="status">
                    {problems.join(". ")}
                  </p>
                )}
                <button
                  className="primary start"
                  disabled={
                    busy ||
                    operation.state !== "ready" ||
                    !fresh ||
                    problems.length > 0
                  }
                  onClick={() => void send("start")}
                >
                  {operation.state === "starting"
                    ? "Awaiting aircraft…"
                    : operation.plan.mode === "autonomous"
                      ? "Start autonomous flight"
                      : "Start flight"}
                  <span>↗</span>
                </button>
              </>
            )}
            {["active", "taking_over", "manual", "returning", "landing"].includes(
              operation.state,
            ) && (
              <div className="interventions">
                {underAutonomy && (
                  <button
                    className="primary takeover"
                    disabled={busy || !canTakeControl}
                    onClick={() => {
                      setError("");
                      setConfirmTakeover(true);
                    }}
                  >
                    {operation.state === "taking_over"
                      ? "Transferring control…"
                      : "Take Control"}
                  </button>
                )}
                {["active", "manual", "returning"].includes(operation.state) && (
                  <>
                    <button
                      disabled={busy || !fresh}
                      onClick={() => void send("hold")}
                    >
                      Hold
                    </button>
                    <button
                      disabled={busy || !fresh}
                      onClick={() => void send("return")}
                    >
                      Return home
                    </button>
                  </>
                )}
                <button
                  className="land-button"
                  disabled={
                    busy ||
                    !session ||
                    session.retired ||
                    session.leaseUntil <= now
                  }
                  onClick={() => void send("land")}
                >
                  Land
                </button>
              </div>
            )}
            {["attention", "landing", "manual"].includes(operation.state) &&
              sample?.armed === false &&
              sample?.airborne === false &&
              fresh && (
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    setBusy(true);
                    try {
                      await resolve({
                        operationId,
                        note: String(data.get("note")),
                      });
                    } catch (error) {
                      setError(messageOf(error));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label>
                    Close without completing the job
                    <input
                      name="note"
                      required
                      minLength={5}
                      maxLength={500}
                      placeholder="Reason for closing the grounded operation"
                    />
                  </label>
                  <button disabled={busy}>
                    Confirm grounded & close operation
                  </button>
                </form>
              )}
          </div>
        )}
        {operator &&
          fresh &&
          operation.state === "manual" &&
          operation.controlOwner === "computer" && (
            <ComputerControls
              operationId={operation._id}
              generation={operation.controlGeneration}
              grounded={sample?.airborne === false && sample?.armed === false}
            />
          )}
        {operator && !closed && operation.quotedEarnings && (
          <p className="payout-callout">
            Quoted earnings{" "}
            {payoutLabel(
              operation.quotedEarnings.cents,
              operation.quotedEarnings.surgeX,
            )}
          </p>
        )}
        {closed && (
          <p className="selection-summary">
            {operation.state === "cancelled"
              ? "Operation closed without claiming task completion."
              : operation.taskOutcome === "succeeded"
                ? "Flight check verified: takeoff, hover, landing, and disarm."
                : "Flight completed. The requested task result remains unverified."}
            {operation.earnedCents != null
              ? ` Operator earnings recorded: ${formatUsd(operation.earnedCents)}.`
              : ""}
          </p>
        )}
        {error && !confirmTakeover && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {confirmTakeover && (
          <TakeControlConfirm
            busy={busy}
            error={error}
            onCancel={() => setConfirmTakeover(false)}
            onConfirm={async () => {
              if (await send("takeover")) setConfirmTakeover(false);
            }}
          />
        )}
        <CameraPanel operationId={operation._id} supported inspecting={details.order?.kind === "inspection" || sample?.mission?.mode === "inspection"} />
        <details className="events">
          <summary>
            Flight activity <span>{details.events.length} events</span>
          </summary>
          <ol>
            {details.events.map((event) => (
              <li key={event._id}>
                <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                <span>{event.message}</span>
              </li>
            ))}
          </ol>
        </details>
      </section>
    </>
  );
}

function TakeControlConfirm({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div
      className="confirm-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="take-control-title"
      >
        <div className="modal-head">
          <h2 id="take-control-title">Take Control</h2>
        </div>
        <p className="muted">
          The aircraft will hover in place. Autonomy stops, and you become
          responsible for completing this job manually.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Transferring control…" : "Take Control"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OperatorOnboarding({ account }: { account: Account }) {
  return (
    <main className="workspace operator-retro operator-onboarding">
      <div className="page-heading">
        <div>
          <h1>Register your drone</h1>
        </div>
      </div>
      <section className="panel onboarding">
        <h2>
          {account.operator
            ? "Operator access suspended"
            : "Start accepting flight jobs"}
        </h2>
        <p className="muted">
          {account.operator
            ? "Contact support to restore access to your fleet."
            : "Save launch sites in account settings, then add your drone. Matching jobs will appear in your operator workspace."}
        </p>
        {!account.operator && (
          <div className="heading-actions">
            <Link className="primary" href="/settings">
              Account settings ↗
            </Link>
            <Link className="primary" href="/fleet">
              Register your drone ↗
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
