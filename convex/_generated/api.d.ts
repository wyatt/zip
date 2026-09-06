/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as accounts from "../accounts.js";
import type * as agentLink from "../agentLink.js";
import type * as auth from "../auth.js";
import type * as cameras from "../cameras.js";
import type * as credentials from "../credentials.js";
import type * as dispatch from "../dispatch.js";
import type * as fleet from "../fleet.js";
import type * as http from "../http.js";
import type * as manualControl from "../manualControl.js";
import type * as operations from "../operations.js";
import type * as operationsSchema from "../operationsSchema.js";
import type * as seed from "../seed.js";
import type * as workOrders from "../workOrders.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  accounts: typeof accounts;
  agentLink: typeof agentLink;
  auth: typeof auth;
  cameras: typeof cameras;
  credentials: typeof credentials;
  dispatch: typeof dispatch;
  fleet: typeof fleet;
  http: typeof http;
  manualControl: typeof manualControl;
  operations: typeof operations;
  operationsSchema: typeof operationsSchema;
  seed: typeof seed;
  workOrders: typeof workOrders;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
