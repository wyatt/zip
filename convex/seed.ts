import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { assignLaunchSiteIds } from "../lib/launch-sites";
import { BASE_CAPABILITIES, capabilitiesFromTags, droneTypeById, type OptionalTag } from "../lib/aircraft";
import type { Capability, Environment, GeoPoint, JobKind } from "../lib/operations";

const QUALIFICATIONS: JobKind[] = ["flight_check", "search", "inspection", "deliver"];
const DC = { lat: 38.9072, lon: -77.0369 };
const ITHACA = { lat: 42.443, lon: -76.5019 };

function offset(base: GeoPoint, northM: number, eastM: number): GeoPoint {
  return {
    lat: base.lat + northM / 111320,
    lon: base.lon + eastM / (111320 * Math.cos((base.lat * Math.PI) / 180)),
  };
}

type SeedAircraft = {
  hardwareId: string;
  name: string;
  typeId: string;
  environment: Environment;
  northM: number;
  eastM: number;
  extra?: OptionalTag[];
};

type SeedOperator = {
  email: string;
  displayName: string;
  base: GeoPoint;
  serviceRadiusM: number;
  aircraft: SeedAircraft[];
};

const OPERATORS: SeedOperator[] = [
  {
    email: "seed.dc.capital@iris.demo",
    displayName: "Capital Air",
    base: DC,
    serviceRadiusM: 28000,
    aircraft: [
      { hardwareId: "seed-dc-capital-mavic", name: "Mall Scout", typeId: "dji-mavic-3-pro", environment: "aircraft", northM: 220, eastM: -180 },
      { hardwareId: "seed-dc-capital-mini", name: "Ellipse", typeId: "dji-mini-4k", environment: "aircraft", northM: -350, eastM: 420 },
      { hardwareId: "seed-dc-capital-sim", name: "Capitol Sim", typeId: "dji-neo", environment: "simulated", northM: 80, eastM: 60 },
    ],
  },
  {
    email: "seed.dc.potomac@iris.demo",
    displayName: "Potomac Wings",
    base: offset(DC, 1200, -2800),
    serviceRadiusM: 28000,
    aircraft: [
      { hardwareId: "seed-dc-potomac-delivery", name: "Key Bridge Cargo", typeId: "delivery", environment: "aircraft", northM: 0, eastM: 0, extra: ["payload"] },
      { hardwareId: "seed-dc-potomac-avata", name: "Towpath", typeId: "dji-avata-2", environment: "aircraft", northM: -480, eastM: 640 },
      { hardwareId: "seed-dc-potomac-range", name: "River Reach", typeId: "long-range", environment: "aircraft", northM: 700, eastM: -400 },
    ],
  },
  {
    email: "seed.dc.navy@iris.demo",
    displayName: "Navy Yard Lift",
    base: offset(DC, -2200, 1800),
    serviceRadiusM: 28000,
    aircraft: [
      { hardwareId: "seed-dc-navy-industrial", name: "Wharf Inspector", typeId: "industrial", environment: "aircraft", northM: 120, eastM: -90 },
      { hardwareId: "seed-dc-navy-hires", name: "Anacostia Optic", typeId: "hi-res-camera", environment: "aircraft", northM: 540, eastM: 310 },
      { hardwareId: "seed-dc-navy-f19", name: "Yard Trainer", typeId: "contixo-f19", environment: "simulated", northM: -200, eastM: 150 },
    ],
  },
  {
    email: "seed.dc.dupont@iris.demo",
    displayName: "Dupont Hover",
    base: offset(DC, 1800, -400),
    serviceRadiusM: 28000,
    aircraft: [
      { hardwareId: "seed-dc-dupont-neo", name: "Circle Watch", typeId: "dji-neo", environment: "aircraft", northM: 0, eastM: 0 },
      { hardwareId: "seed-dc-dupont-fpv", name: "P Street", typeId: "fpv", environment: "aircraft", northM: -260, eastM: 480 },
    ],
  },
  {
    email: "seed.ithaca.cascadilla@iris.demo",
    displayName: "Cascadilla Air",
    base: ITHACA,
    serviceRadiusM: 18000,
    aircraft: [
      { hardwareId: "seed-ithaca-cascadilla-mini", name: "Commons Scout", typeId: "dji-mini-4k", environment: "aircraft", northM: 160, eastM: -120 },
      { hardwareId: "seed-ithaca-cascadilla-delivery", name: "Gorge Runner", typeId: "delivery", environment: "aircraft", northM: -420, eastM: 280, extra: ["payload"] },
      { hardwareId: "seed-ithaca-cascadilla-sim", name: "Ithaca Sim", typeId: "dji-mavic-3-pro", environment: "simulated", northM: 40, eastM: 40 },
    ],
  },
  {
    email: "seed.ithaca.cornell@iris.demo",
    displayName: "Cornell Ridge",
    base: offset(ITHACA, 1600, 900),
    serviceRadiusM: 18000,
    aircraft: [
      { hardwareId: "seed-ithaca-cornell-mavic", name: "Slopewatch", typeId: "dji-mavic-3-pro", environment: "aircraft", northM: 0, eastM: 0 },
      { hardwareId: "seed-ithaca-cornell-industrial", name: "Quad Inspector", typeId: "industrial", environment: "aircraft", northM: 380, eastM: -520 },
      { hardwareId: "seed-ithaca-cornell-hires", name: "Beebe Cam", typeId: "hi-res-camera", environment: "aircraft", northM: -300, eastM: 200 },
    ],
  },
  {
    email: "seed.ithaca.cayuga@iris.demo",
    displayName: "Cayuga Lift",
    base: offset(ITHACA, -900, -1400),
    serviceRadiusM: 18000,
    aircraft: [
      { hardwareId: "seed-ithaca-cayuga-avata", name: "Inlet", typeId: "dji-avata-2", environment: "aircraft", northM: 80, eastM: 60 },
      { hardwareId: "seed-ithaca-cayuga-range", name: "Lakeshore", typeId: "long-range", environment: "aircraft", northM: -500, eastM: -240 },
      { hardwareId: "seed-ithaca-cayuga-fpv", name: "Jetty", typeId: "fpv", environment: "simulated", northM: 220, eastM: -180 },
    ],
  },
];

async function ensureOperator(ctx: MutationCtx, spec: SeedOperator) {
  const existingVehicle = await ctx.db.query("vehicles").withIndex("by_hardwareId", q => q.eq("hardwareId", spec.aircraft[0]!.hardwareId)).unique();
  if (existingVehicle) return { operatorId: existingVehicle.operatorId, created: false, vehicles: 0 };
  const userId = await ctx.db.insert("users", { email: spec.email });
  await ctx.db.insert("members", { userId, displayName: spec.displayName, role: "operator" });
  const sites = assignLaunchSiteIds([
    { name: "Home", ...spec.base },
    ...spec.aircraft.map((aircraft, index) => ({ name: aircraft.name, ...offset(spec.base, aircraft.northM, aircraft.eastM), id: `site-${index}` })),
  ]);
  await ctx.db.insert("operatorProfiles", {
    userId,
    approved: true,
    acceptingJobs: true,
    qualifications: QUALIFICATIONS,
    base: spec.base,
    serviceRadiusM: spec.serviceRadiusM,
    presetLocations: sites,
  });
  let vehicles = 0;
  for (const aircraft of spec.aircraft) {
    const type = droneTypeById(aircraft.typeId);
    const tags = [...type.tags, ...(aircraft.extra ?? [])];
    const capabilities: Capability[] = capabilitiesFromTags(tags);
    const home = offset(spec.base, aircraft.northM, aircraft.eastM);
    const launch = sites.find(site => site.name === aircraft.name) ?? sites[0]!;
    const already = await ctx.db.query("vehicles").withIndex("by_hardwareId", q => q.eq("hardwareId", aircraft.hardwareId)).unique();
    if (already) continue;
    await ctx.db.insert("vehicles", {
      operatorId: userId,
      name: aircraft.name,
      model: type.label,
      hardwareId: aircraft.hardwareId,
      environment: aircraft.environment,
      capabilities: aircraft.environment === "simulated" ? [...new Set([...BASE_CAPABILITIES, ...capabilities])] : capabilities,
      maxPayloadKg: tags.includes("payload") ? type.payloadKg ?? 2 : 0,
      ...(tags.includes("camera") ? { cameraMp: type.cameraMp ?? 12 } : {}),
      home,
      launchSiteId: launch.id,
      launchSiteName: launch.name,
      maxRadiusM: 8000,
      available: true,
      integrationApproved: true,
    });
    vehicles += 1;
  }
  return { operatorId: userId, created: true, vehicles };
}

export const demoCoverage = internalMutation({
  args: {},
  returns: v.object({ operatorsCreated: v.number(), vehiclesCreated: v.number() }),
  handler: async ctx => {
    let operatorsCreated = 0, vehiclesCreated = 0;
    for (const spec of OPERATORS) {
      const result = await ensureOperator(ctx, spec);
      if (result.created) operatorsCreated += 1;
      vehiclesCreated += result.vehicles;
    }
    return { operatorsCreated, vehiclesCreated };
  },
});
