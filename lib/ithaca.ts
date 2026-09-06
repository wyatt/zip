import type { GeoPoint } from "./operations";

/** 5 km Ithaca regional package used by the job map and inspection simulator. */
export const ITHACA_HOME: GeoPoint = { lat: 42.4478926458004, lon: -76.48646602014907 };
/** Goldwin Smith Hall, Cornell Arts Quad (232 East Ave). */
export const GOLDWIN_SMITH_HALL: GeoPoint = { lat: 42.4490733, lon: -76.4835344 };
export const ITHACA_SIZE_M = 5000;
export const ITHACA_REGION_KEY = "ithaca5km";
export const ITHACA_REGION_API = "/api/ithaca-region/";
