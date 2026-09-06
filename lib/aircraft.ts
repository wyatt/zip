import type { Capability } from "./operations";

export const BASE_CAPABILITIES: Capability[] = [
  "takeoff",
  "hover",
  "land",
  "position",
  "autonomous",
  "manual_remote",
  "manual_computer",
];
export const SIMULATOR_CAPABILITIES: Capability[] = [...BASE_CAPABILITIES, "camera", "payload"];

export type OptionalTag = Exclude<
  Capability,
  | "takeoff"
  | "hover"
  | "land"
  | "position"
  | "autonomous"
  | "manual_remote"
  | "manual_computer"
>;

export const OPTIONAL_TAGS: { id: OptionalTag; label: string }[] = [
  { id: "camera", label: "Camera (MP)" },
  { id: "payload", label: "Payload (kg)" },
];

export type DroneType = {
  id: string;
  label: string;
  code: string;
  src: string;
  tags: OptionalTag[];
  known: boolean;
  payloadKg?: number;
  cameraMp?: number;
};

export const DRONE_TYPES: DroneType[] = [
  {
    id: "dji-mini-4k",
    label: "DJI Mini 4K",
    code: "MINI",
    src: "/drones/dji-mini-4k.png",
    tags: ["camera"],
    known: true,
    cameraMp: 12,
  },
  {
    id: "dji-neo",
    label: "DJI Neo",
    code: "NEO",
    src: "/drones/dji-neo.png",
    tags: ["camera"],
    known: true,
    cameraMp: 12,
  },
  {
    id: "contixo-f19",
    label: "Contixo F19",
    code: "F19",
    src: "/drones/contixo-f19.png",
    tags: [],
    known: true,
  },
  {
    id: "dji-mavic-3-pro",
    label: "DJI Mavic 3 Pro",
    code: "MAVIC",
    src: "/drones/dji-mavic-3-pro.png",
    tags: ["camera"],
    known: true,
    cameraMp: 20,
  },
  {
    id: "dji-avata-2",
    label: "DJI Avata 2",
    code: "AVATA",
    src: "/drones/dji-avata-2.png",
    tags: ["camera"],
    known: true,
    cameraMp: 12,
  },
  {
    id: "delivery",
    label: "Delivery Drone",
    code: "CARGO",
    src: "/drones/delivery.png",
    tags: ["payload"],
    known: false,
    payloadKg: 2,
  },
  {
    id: "long-range",
    label: "Long-Range Drone",
    code: "RANGE",
    src: "/drones/long-range.png",
    tags: [],
    known: false,
  },
  {
    id: "hi-res-camera",
    label: "High-Resolution Camera Drone",
    code: "OPTIC",
    src: "/drones/hi-res-camera.png",
    tags: ["camera"],
    known: false,
    cameraMp: 48,
  },
  {
    id: "fpv",
    label: "High-Speed / FPV Drone",
    code: "FPV",
    src: "/drones/fpv.png",
    tags: [],
    known: false,
  },
  {
    id: "industrial",
    label: "Industrial / Inspection Drone",
    code: "INDUST",
    src: "/drones/industrial.png",
    tags: ["camera"],
    known: false,
    cameraMp: 20,
  },
];

const NAME_ADJECTIVES = [
  "Swift",
  "Rusty",
  "Quiet",
  "Brisk",
  "Dusty",
  "Keen",
  "Nimble",
  "Stout",
  "Vivid",
  "Sly",
  "Bold",
  "Calm",
  "Feral",
  "Lucky",
  "Rapid",
  "Sunny",
];
const NAME_NOUNS = [
  "Kestrel",
  "Falcon",
  "Osprey",
  "Merlin",
  "Harrier",
  "Goshawk",
  "Hobby",
  "Petrel",
  "Tern",
  "Skua",
  "Albatross",
  "Nighthawk",
  "Swallow",
  "Swiftlet",
  "Wren",
  "Finch",
  "Raven",
  "Magpie",
  "Jay",
  "Crow",
  "Owl",
  "Heron",
  "Egret",
  "Ibis",
  "Crane",
  "Stork",
  "Plover",
  "Sandpiper",
  "Curlew",
  "Snipe",
  "Bittern",
  "Shrike",
  "Vulture",
  "Condor",
  "Buzzard",
  "Kite",
  "Sparrow",
  "Starling",
  "Thrush",
  "Warbler",
  "Lark",
  "Pipit",
  "Wagtail",
  "Kingfisher",
  "Roller",
  "Hoopoe",
  "Woodpecker",
  "Nuthatch",
  "Cuckoo",
  "Dove",
  "Pigeon",
  "Quail",
  "Pheasant",
  "Grouse",
  "Gull",
  "Skimmer",
  "Shearwater",
  "Frigate",
  "Gannet",
  "Pelican",
  "Cormorant",
  "Loon",
  "Grebe",
  "Coot",
  "Rail",
  "Teal",
  "Wigeon",
  "Mallard",
  "Pintail",
  "Shoveler",
  "Eider",
  "Merganser",
  "Swan",
  "Goose",
  "Hornet",
  "Wasp",
  "Cicada",
  "Moth",
  "Firefly",
  "Dragonfly",
  "Damselfly",
  "Mayfly",
  "Beetle",
  "Locust",
  "Cricket",
  "Mantis",
  "Scorpion",
  "Spider",
  "Bee",
  "Comet",
  "Meteor",
  "Nova",
  "Pulsar",
  "Quasar",
  "Nebula",
  "Asteroid",
  "Bolt",
  "Spark",
  "Ember",
  "Flare",
  "Blaze",
  "Torch",
  "Lantern",
  "Beacon",
  "Signal",
  "Relay",
  "Vector",
  "Axis",
  "Orbit",
  "Apex",
  "Ridge",
  "Summit",
  "Spire",
  "Needle",
  "Crag",
  "Cliff",
  "Bluff",
  "Mesa",
  "Dune",
  "Delta",
  "Fjord",
  "Cove",
  "Inlet",
  "Strait",
  "Channel",
  "Atoll",
  "Reef",
  "Skiff",
  "Cutter",
  "Sloop",
  "Ketch",
  "Yawl",
  "Brig",
  "Clipper",
  "Schooner",
  "Kayak",
  "Canoe",
  "Arrow",
  "Dart",
  "Javelin",
  "Lance",
  "Pike",
  "Glaive",
  "Saber",
  "Dirk",
];

export type PresetLocation = { name: string; lat: number; lon: number };

export function droneTypeById(id: string) {
  return DRONE_TYPES.find((type) => type.id === id) ?? DRONE_TYPES[0];
}

export function droneTypeByModel(model?: string) {
  return DRONE_TYPES.find((type) => type.label === model) ?? DRONE_TYPES[0];
}

export function generateAircraftName(taken: string[], avoid?: string) {
  const unused: string[] = [];
  for (const adjective of NAME_ADJECTIVES) {
    for (const noun of NAME_NOUNS) {
      const name = `${adjective} ${noun}`;
      if (name !== avoid && !taken.includes(name)) unused.push(name);
    }
  }
  if (unused.length > 0)
    return unused[Math.floor(Math.random() * unused.length)]!;
  let n = 2;
  while (taken.includes(`Swift Kestrel ${n}`)) n += 1;
  return `Swift Kestrel ${n}`;
}

export function generateHardwareId(typeId: string) {
  return `iris-${typeId}-${Math.random().toString(36).slice(2, 8)}`;
}

export function capabilitiesFromTags(tags: OptionalTag[]): Capability[] {
  return [...new Set([...BASE_CAPABILITIES, ...tags])];
}
