import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { assignLaunchSiteIds } from "../lib/launch-sites";
import { BASE_CAPABILITIES, capabilitiesFromTags, droneTypeById, type OptionalTag } from "../lib/aircraft";
import type { Capability, Environment, GeoPoint, JobKind } from "../lib/operations";
import { GOLDWIN_SMITH_HALL, ITHACA_HOME } from "../lib/ithaca";
import { syncFleetLaunchSites } from "./fleet";

const QUALIFICATIONS: JobKind[] = ["flight_check", "search", "inspection", "deliver"];
const DC = { lat: 38.9072, lon: -77.0369 };
const ITHACA = ITHACA_HOME;

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

const WYATT_EMAIL = "wss58@cornell.edu";
const GOLDWIN_SMITH_NAME = "Goldwin Smith Hall";
const GOLDWIN_AIRCRAFT: SeedAircraft[] = [
  { hardwareId: "wyatt-gsh-mini", name: "Smith Scout", typeId: "dji-mini-4k", environment: "aircraft", northM: 25, eastM: -18 },
  { hardwareId: "wyatt-gsh-mavic", name: "Arts Quad", typeId: "dji-mavic-3-pro", environment: "aircraft", northM: -20, eastM: 30 },
  { hardwareId: "wyatt-gsh-industrial", name: "McGraw Inspector", typeId: "industrial", environment: "aircraft", northM: 40, eastM: 12 },
  { hardwareId: "wyatt-gsh-cargo", name: "Ezra Cargo", typeId: "delivery", environment: "aircraft", northM: -8, eastM: -28, extra: ["payload"] },
];

async function findUserByEmail(ctx: MutationCtx, email: string) {
  const users = await ctx.db.query("users").take(200);
  return users.find(user => user.email?.toLowerCase() === email) ?? null;
}

async function insertAircraft(ctx: MutationCtx, operatorId: Id<"users">, aircraft: SeedAircraft, home: GeoPoint, launch: { id: string; name: string }) {
  const type = droneTypeById(aircraft.typeId);
  const tags = [...type.tags, ...(aircraft.extra ?? [])];
  const capabilities: Capability[] = capabilitiesFromTags(tags);
  const already = await ctx.db.query("vehicles").withIndex("by_hardwareId", q => q.eq("hardwareId", aircraft.hardwareId)).unique();
  if (already) return false;
  await ctx.db.insert("vehicles", {
    operatorId,
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
  return true;
}

export const addGoldwinSmithBase = internalMutation({
  args: { email: v.optional(v.string()) },
  returns: v.object({
    email: v.string(),
    siteAdded: v.boolean(),
    siteId: v.string(),
    vehiclesCreated: v.number(),
    vehicleNames: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const email = (args.email ?? WYATT_EMAIL).trim().toLowerCase();
    const user = await findUserByEmail(ctx, email);
    if (!user) throw new Error(`No account found for ${email}.`);
    const member = await ctx.db.query("members").withIndex("by_user", q => q.eq("userId", user._id)).unique();
    if (!member) throw new Error("Finish setting up the account before adding a base.");
    if (member.role === "customer") await ctx.db.patch(member._id, { role: "operator" });
    const profile = await ctx.db.query("operatorProfiles").withIndex("by_user", q => q.eq("userId", user._id)).unique();
    const existing = profile?.presetLocations ?? [];
    const alreadyHasSite = existing.some(location => location.name.toLowerCase() === GOLDWIN_SMITH_NAME.toLowerCase());
    const locations = assignLaunchSiteIds(alreadyHasSite ? existing : [...existing, { name: GOLDWIN_SMITH_NAME, ...GOLDWIN_SMITH_HALL }]);
    const launch = locations.find(site => site.name.toLowerCase() === GOLDWIN_SMITH_NAME.toLowerCase());
    if (!launch) throw new Error("Goldwin Smith Hall launch site is missing.");
    if (profile) {
      await ctx.db.patch(profile._id, { presetLocations: locations, approved: true, acceptingJobs: true, qualifications: [...new Set([...profile.qualifications, ...QUALIFICATIONS])] });
    } else {
      await ctx.db.insert("operatorProfiles", {
        userId: user._id,
        approved: true,
        acceptingJobs: true,
        qualifications: QUALIFICATIONS,
        base: existing[0] ? { lat: existing[0].lat, lon: existing[0].lon } : ITHACA_HOME,
        serviceRadiusM: 18000,
        presetLocations: locations,
      });
    }
    const names: string[] = [];
    let vehiclesCreated = 0;
    for (const aircraft of GOLDWIN_AIRCRAFT) {
      const home = offset(GOLDWIN_SMITH_HALL, aircraft.northM, aircraft.eastM);
      const created = await insertAircraft(ctx, user._id, aircraft, home, launch);
      if (created) {
        vehiclesCreated += 1;
        names.push(aircraft.name);
      }
    }
    return { email, siteAdded: !alreadyHasSite, siteId: launch.id, vehiclesCreated, vehicleNames: names };
  },
});

export const relocateHomesToIthaca = internalMutation({
  args: {},
  returns: v.object({ profiles: v.number(), vehicles: v.number() }),
  handler: async ctx => {
    const home = ITHACA_HOME;
    const profiles = await ctx.db.query("operatorProfiles").take(100);
    let vehicles = 0;
    for (const profile of profiles) {
      const locations = assignLaunchSiteIds((profile.presetLocations ?? []).map(location => (
        location.name.toLowerCase() === "home" ? { ...location, lat: home.lat, lon: home.lon } : location
      )));
      if (!locations.some(location => location.name.toLowerCase() === "home")) {
        locations.unshift({ id: "home", name: "Home", ...home });
      }
      await ctx.db.patch(profile._id, { base: home, presetLocations: locations });
      await syncFleetLaunchSites(ctx, profile.userId, locations);
      const fleet = await ctx.db.query("vehicles").withIndex("by_operator", q => q.eq("operatorId", profile.userId)).take(100);
      const launch = locations.find(location => location.name.toLowerCase() === "home") ?? locations[0]!;
      for (const vehicle of fleet) {
        await ctx.db.patch(vehicle._id, { home, launchSiteId: launch.id, launchSiteName: launch.name });
        vehicles += 1;
      }
    }
    return { profiles: profiles.length, vehicles };
  },
});
