import { expect, test } from "vitest";
import { quoteOperatorEarnings, surgeMultiplier } from "../lib/pricing";

const home = { lat: 42.35596, lon: -71.07029 };

test("balanced markets stay at 1.00× and busy queues surge up to 2.50×", () => {
  expect(surgeMultiplier(1, 2)).toBe(1);
  expect(surgeMultiplier(5, 1)).toBe(2.5);
  expect(surgeMultiplier(3, 1)).toBe(2);
});

test("quotes rise with distance, payload, area, and surge", () => {
  const nearby = quoteOperatorEarnings({
    kind: "deliver",
    location: home,
    destinations: [home],
    home,
    payloadKg: 0,
    hoverSec: 10,
    altitudeM: 3,
    areaM2: 0,
    openNearby: 1,
    idleNearby: 4,
  });
  const far = { lat: home.lat + 0.02, lon: home.lon };
  const heavy = quoteOperatorEarnings({
    kind: "deliver",
    location: far,
    destinations: [far],
    home,
    payloadKg: 4,
    hoverSec: 10,
    altitudeM: 3,
    areaM2: 0,
    openNearby: 4,
    idleNearby: 1,
  });
  expect(nearby.cents).toBeGreaterThanOrEqual(500);
  expect(nearby.surgeX).toBe(1);
  expect(heavy.cents).toBeGreaterThan(nearby.cents);
  expect(heavy.surgeX).toBeGreaterThan(1);
  expect(heavy.deadheadM).toBeGreaterThan(1000);
});

test("search and inspection pay more than a local flight check", () => {
  const check = quoteOperatorEarnings({
    kind: "flight_check",
    location: home,
    destinations: [],
    home,
    payloadKg: 0,
    hoverSec: 5,
    altitudeM: 3,
    areaM2: 0,
    openNearby: 1,
    idleNearby: 1,
  });
  const search = quoteOperatorEarnings({
    kind: "search",
    location: home,
    destinations: [{ lat: home.lat + 0.001, lon: home.lon }],
    home,
    payloadKg: 0,
    hoverSec: 20,
    altitudeM: 12,
    areaM2: 20000,
    openNearby: 1,
    idleNearby: 1,
  });
  expect(check.cents).toBeGreaterThanOrEqual(300);
  expect(search.cents).toBeGreaterThan(check.cents);
});
