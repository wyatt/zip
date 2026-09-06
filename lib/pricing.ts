import { areaGeometry, type SurveyArea } from "./areas";
import { metersBetween, WAITING_FLEET_RADIUS_M, type GeoPoint, type JobKind } from "./operations";

/** Local market radius used for demand vs idle-aircraft surge. */
export const SURGE_RADIUS_M = WAITING_FLEET_RADIUS_M;

export type EarningsQuote = {
  cents: number;
  surgeX: number;
  deadheadM: number;
  taskM: number;
  areaM2: number;
};

const BASE_CENTS: Record<JobKind, number> = {
  flight_check: 400,
  deliver: 650,
  inspection: 800,
  search: 900,
};

const KIND_MULTIPLIER: Record<JobKind, number> = {
  flight_check: 0.7,
  deliver: 1,
  inspection: 1.15,
  search: 1.25,
};

const DEADHEAD_CENTS_PER_M = 0.12;
const TASK_CENTS_PER_M = 0.08;
const HOVER_CENTS_PER_S = 4;
const ALTITUDE_EXTRA_CENTS_PER_M = 15;
const PAYLOAD_CENTS_PER_KG = 150;
const AREA_CENTS_PER_M2 = 0.04;

export function surgeMultiplier(openNearby: number, idleNearby: number): number {
  const demand = Math.max(0, openNearby) / Math.max(1, idleNearby);
  const raw = 1 + 0.4 * Math.max(0, demand - 0.5);
  return Math.round(Math.min(2.5, Math.max(1, raw)) * 100) / 100;
}

function pathMeters(points: GeoPoint[]): number {
  return points.slice(1).reduce((total, point, index) => total + metersBetween(points[index]!, point), 0);
}

export function quoteOperatorEarnings(input: {
  kind: JobKind;
  location: GeoPoint;
  destinations: GeoPoint[];
  home: GeoPoint;
  payloadKg: number;
  hoverSec: number;
  altitudeM: number;
  areaM2: number;
  openNearby: number;
  idleNearby: number;
}): EarningsQuote {
  const deadheadM = metersBetween(input.home, input.location);
  const route = [input.location, ...input.destinations];
  const last = input.destinations.at(-1);
  const returnM = last ? metersBetween(last, input.home) : 0;
  const taskM = pathMeters(route) + returnM;
  const surgeX = surgeMultiplier(input.openNearby, input.idleNearby);
  const altitudeExtraM = Math.max(0, input.altitudeM - 10);
  const subtotal =
    BASE_CENTS[input.kind]
    + deadheadM * DEADHEAD_CENTS_PER_M
    + taskM * TASK_CENTS_PER_M
    + input.hoverSec * HOVER_CENTS_PER_S
    + altitudeExtraM * ALTITUDE_EXTRA_CENTS_PER_M
    + Math.max(0, input.payloadKg) * PAYLOAD_CENTS_PER_KG
    + Math.max(0, input.areaM2) * AREA_CENTS_PER_M2;
  const floor = input.kind === "flight_check" ? 300 : 500;
  const cents = Math.max(floor, Math.round(subtotal * KIND_MULTIPLIER[input.kind] * surgeX));
  return { cents, surgeX, deadheadM, taskM, areaM2: Math.max(0, input.areaM2) };
}

export function quoteWorkOrder(
  order: {
    kind: JobKind;
    location: GeoPoint;
    destinations: GeoPoint[];
    payloadKg: number;
    hoverSec: number;
    altitudeM: number;
    area?: SurveyArea;
  },
  home: GeoPoint,
  market: { openNearby: number; idleNearby: number },
): EarningsQuote {
  let areaM2 = 0;
  if (order.area) {
    try { areaM2 = areaGeometry(order.area).areaM2; } catch { areaM2 = 0; }
  }
  return quoteOperatorEarnings({ ...order, home, areaM2, ...market });
}

export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatSurge(surgeX: number): string {
  return surgeX >= 1.05 ? `${surgeX.toFixed(2).replace(/0$/, "")}×` : "";
}
