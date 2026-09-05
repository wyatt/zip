# zip — implementation handoff

Updated September 5, 2026. Development was wrapped up at the user's request. This document describes the current worktree, including what functions now and what remains unfinished. No further testing is being started as part of this handoff.

## Current outcome

The application has authenticated customer and operator experiences, self-service drone registration, capability-based job matching, server-generated flight plans, a separate local flight agent, live telemetry, and a shared drone adapter interface. A local simulator runs the complete takeoff → hover → land operation through that architecture.

**Operator registration does not require an invitation or join code.** An operator signs up, registers a drone and its specifications, and gets a fleet entry automatically.

This is an integration foundation, not a verified physical-drone controller or a completed production deployment. The actual aircraft protocol is still undecided. Physical control remains disabled, no physical aircraft has been accessed, and nothing has been publicly deployed. Known software gaps are listed below rather than hidden behind the passing simulator checks.

## Application surfaces

| Route | Implemented experience |
| --- | --- |
| `/request` | Sign up/sign in; submit requests; view the customer's own requests, assignment, plan progress, telemetry, and available camera stream; cancel an unassigned request; restore operation selection after refresh. |
| `/operator` | Register a drone to begin; see matching jobs; choose an eligible aircraft, autonomous/manual mode, and remote/computer takeover method; accept a job; start and supervise the assigned operation; view operation history and events. |
| `/fleet` | Register drones and specifications; see the operator's own fleet; toggle accepting jobs; issue, rotate, hide, copy, and revoke vehicle-scoped agent credentials. |

The UI retains the zip wordmark, lime accent, restrained black/white styling, Lato typography, geographic map, and responsive layouts. Navigation separates customer, operator, and aircraft surfaces.

### Self-service operator and drone registration

Registration accepts:

- Drone name and manufacturer/model description.
- Hardware identifier.
- Physical-aircraft or local-simulator environment.
- Launch latitude and longitude.
- Flight boundary radius.
- Operator service radius, established during initial registration.
- Physical-aircraft capabilities: takeoff, hover, landing, position telemetry, autonomous control, remote control, computer control, camera, and payload carrying.
- Maximum payload capacity in kilograms.

The backend validates the fields, prevents duplicate identifiers within an operator's fleet, creates the operator profile on first registration, and stores the vehicle atomically. Registered vehicles appear in the fleet immediately. Their model, capabilities, payload capacity, location, boundary, assignment, and connection status are shown.

A physical vehicle's registration does not certify its capabilities or enable commands. Its integration approval begins false, so it appears as registered with a connection required. Dispatch/control approval remains separate from listing the vehicle. The simulator advertises a fixed capability set and does not pretend to have a camera or payload mechanism.

Legacy invitation tables and administrative invitation functions remain in the backend for compatibility, but the application no longer presents or requires that workflow. The existing `approved` profile field now also acts as an access-suspension flag; normal registration enables access without an administrator invitation. A suspended profile cannot bypass suspension by registering another drone.

### Customer requests and matching

Customers can specify a flight check, search, inspection, or delivery request, title, instructions, location, execution environment, flight altitude, hover duration, and delivery payload weight. Search and inspection restore rectangular area selection using two editable corners. The map shows a shaded boundary and sweep-route preview, with dimensions and area in hectares. The backend saves the area and generates alternating sweep waypoints; customer and operator views retain the overlay. Flight checks and delivery currently use point selection.

Matching checks operator availability, service coverage, job qualifications, aircraft environment, required capabilities, payload capacity, aircraft availability, and physical-integration approval. Initial self-registered profiles support the listed job categories; aircraft capabilities determine which categories can be served.

Acceptance runs in a Convex mutation. It verifies ownership and eligibility, reserves one operator and one vehicle, creates the immutable plan and operation, and records the assignment event. Repeated acceptance of the same assignment does not create another operation.

## End-to-end execution

```text
Customer request
    ↓
Convex work order and live operator matching
    ↓
Operator accepts and chooses control mode
    ↓
Convex creates the flight plan and reserves operator/vehicle
    ↓
Local agent validates plan and aircraft readiness
    ↓
Operator presses Start
    ↓
Local agent claims command and transfers controller ownership
    ↓
Adapter acknowledgment + measured ownership confirmation
    ↓
Autonomous execution or operator control
    ↓
Measured takeoff, hover, landing, and disarm
    ↓
Convex completes the flight and releases the reservation
```

Convex owns account data, work orders, assignment, plans, control intent, operational state, latest measurements, and events. The browser does not fly a simulated mission with its own timers. The separate agent communicates with the adapter and publishes its measurements.

### Flight plans

`lib/operations.ts` defines the single executable `FlightPlan`/`PlanStep` format:

- Takeoff at the planned launch point.
- Optional geographic waypoints for routed requests.
- Measured hover at the task location.
- Return waypoint when there is an outbound route.
- Landing and disarm at home.

Plans include version, mode, home, cruise speed, altitude/radius limits, duration budget, and minimum starting battery. Introductory flight checks remain at the launch point. Values use latitude/longitude, meters, seconds, and meters per second.

Plan serialization uses a fixed field order so Convex's object-key reordering cannot invalidate the plan hash. The agent checks the hash and validates that required capabilities and optional navigation methods exist before reporting Ready. Existing hashes generated in the original field order remain compatible.

The image reference `Image_Drop/IMG_1806.png` informed the adapter boundary. Its separate example `MissionStep` union was replaced by an alias to the actual executable `PlanStep`, avoiding two inconsistent mission formats. Velocity/rotation/image capture are adapter operations; arbitrary sequences of those primitives are not an additional implemented mission language.

### Control modes and interventions

- Autonomous Start runs the server's plan through the local mission executor.
- Manual Start transfers ownership and waits for the operator to act.
- Takeover cancels/fences the prior autonomous execution and requests the selected remote/computer owner.
- Hold, Return home, and Land are backend command intents with explicit claims and acknowledgments.
- Return home navigates home; it is not a separate automatic return-and-land sequence.
- An interrupted operation can be closed without claiming success after fresh telemetry establishes grounded and disarmed state and the operator records a reason.

Commands have idempotency keys, generations, expiry, session claims, acknowledgments, and terminal or uncertain outcomes. New control generations fence previous execution. Adapter calls validate acknowledgment identity and expiry, and acknowledgment waits have cancellation/timeouts. A timed-out command is not blindly replayed.

Control ownership is confirmed using fresh telemetry as well as the adapter acknowledgment before the backend accepts the ownership transition.

### Computer control channel

The local agent hosts a loopback WebSocket endpoint, default `ws://127.0.0.1:8765/control`. It verifies the browser origin and redeems a single-use, short-lived Convex authorization ticket bound to the operation, vehicle, agent session, operator, and control generation.

The UI provides held directional controls, yaw, manual takeoff, manual landing, and disconnect. Browser controls send updates while held; release, blur, and page hiding request a hold. Directions are world-frame north/east/up. Gateway limits are 2 m/s horizontal, 1 m/s vertical, and 45 degrees/s yaw; the UI uses lower input values.

The gateway validates input sequence and age. Replaceable velocity inputs may be superseded, while discrete commands are serialized and acknowledged. A small bounded queue prevents unbounded command accumulation. Manual takeoff/landing display acknowledgment status and report missing acknowledgment.

Landing is retained across socket closure instead of being overwritten by the release/deadman hold. Land and hold recovery requests are not rejected merely because navigation is unavailable or the aircraft is outside the planned boundary. Actual acceptance still belongs to the adapter/controller.

An HTTPS application requires a trusted WSS endpoint. The gateway binds loopback, so the operator browser and local agent are intended to run on the same computer.

## Adapter integration boundary

`agent/drone-adapter.ts` defines:

| Operation | Contract |
| --- | --- |
| `connect` | Return hardware identity, model, environment, firmware, and capabilities. |
| `disconnect` | Close the adapter connection according to its aircraft state. |
| `takeoff` | Request height in meters above measured launch origin. |
| `land` | Request landing; acknowledgment does not mean landed. |
| `move` | North/east/up velocity in m/s and clockwise yaw rate in degrees/s; motion must expire. |
| `stop` | Hold/zero velocity, never motor shutdown. |
| `transferControl` | Request autonomous, physical-remote, or computer ownership. |
| `getTelemetry` / `onTelemetry` | Supply independent measured state before, during, and after missions. |
| `handleLinkLoss` | Perform aircraft-specific local recovery without relying on Convex. |
| Optional `goTo` | Geographic waypoint and altitude navigation. |
| Optional `rotate` | Heading rotation. |
| Optional `captureImage` | Timestamped JPEG/PNG bytes. |
| Optional `openCameraStream` | Short-lived HLS/WHEP media endpoint. |

Every command includes an ID, control generation, expiry, and AbortSignal. A real adapter must honor cancellation and stale generations before physical writes, normalize frames/units/timestamps, correlate controller responses, and maintain whatever setpoint refresh its controller requires. Stabilization belongs in the flight controller.

**Where to integrate:** implement this interface under `agent/adapters/`, then wire the implementation into adapter selection in `agent/flight-agent.ts`. Selection currently instantiates the simulator and throws for physical aircraft. There is no dynamic plugin loader or completed physical implementation. `validate-plan.ts`, `mission-executor.ts`, and `adapter-command.ts` provide the shared execution layer.

## Simulator and live data

The simulator is a local-process adapter with a 20 Hz independent telemetry source. Motion follows elapsed time, and battery persists between operations within the same simulator process. It supports takeoff, hold, geographic navigation, landing/disarm, computer velocity inputs, generation fencing, and simulated ownership transfer. It does not reproduce aerodynamics or an actual radio/controller protocol.

The flight agent publishes up to 10 Hz through Convex and renews its lease every two seconds. Sessions have a ten-second lease. A local watchdog detects a lost backend connection and requests the adapter's local failsafe. The simulator lands for autonomous/computer link loss and retains remote ownership for a remote handoff. Restart reconciliation does not automatically replay the old flight.

Telemetry contains source sequence/time, position, altitude, battery, heading, ground speed, connected/armed/airborne state, navigation health, control owner/mode, and faults. Unknown measurements are null. Convex validates numeric ranges, source timestamps, ordering, session identity, and consistency.

Mission progress uses consecutive measured dwell. Landing alone cannot skip earlier steps. Completion requires verified step progression, evidence of flight, landing, and disarm. Non-flight-check task outcomes remain unverified when the aircraft merely completes the route.

Latest vehicle telemetry, per-operation telemetry, and progress are separate records. A completed customer's operation retains its own final snapshot and does not expose subsequent use of the aircraft. High-frequency telemetry is separated from lower-frequency mission details.

The map uses Leaflet/MapLibre and OpenFreeMap/OpenStreetMap data. A 150 ms presentation buffer interpolates measured positions without extrapolating a future flight. Stale measurements freeze and are labeled. Tiles require network access and WebGL.

## Cameras

Camera-capable adapters can publish an authorized short-lived HLS or WHEP URL. The backend scopes access to the operation and active vehicle session. The browser supports native HLS where available, HLS.js otherwise, and WHEP negotiation through WebRTC. Expired or unavailable media is shown honestly.

No camera is simulated, no physical stream was tested, and no media relay/transcoding service is included. The eventual camera service must enforce signed-media access, expiry, CORS, and reachability. `captureImage` exists as an optional adapter contract but is not wired into a capture/storage task workflow.

## Authentication and provisioning

- Convex Auth password sign-up, sign-in, sign-out, and authenticated sessions.
- Customer record isolation and operator ownership checks enforced in backend functions.
- Private operator/vehicle agent credentials stored as hashes, with expiry, rotation, and revocation.
- Active session ownership checks and rejection of competing agents.
- Password recovery provider implementation using Resend; requires deployment configuration and has not been verified by sending real email.
- Authentication key setup script creates signing keys in Convex and preserves existing keys without printing secrets.
- Legacy demo endpoints are internal rather than anonymously available application APIs.

`README.md` contains the current setup instructions. In brief:

```sh
npm ci
npm run backend       # keep running
npm run auth:setup    # once, with backend running
npm run dev          # separate terminal
```

Create an account, register a local simulator in `/fleet`, save its issued credential as `ZIP_AGENT_TOKEN` in private `.env.agent`, and start the agent in another terminal:

```sh
npm run agent
```

`.nvmrc` selects Node 24. `.env.example` documents public backend/control URLs and private agent/TLS configuration. Actual environment files, local backend state, build output, and test artifacts are ignored by git.

## Source map

| Files | Responsibility |
| --- | --- |
| `app/request`, `app/operator`, `app/fleet` | Application routes. |
| `app/layout.tsx`, `app/providers.tsx`, `proxy.ts` | Authentication providers, application shell setup, and session middleware. |
| `components/auth-gate.tsx`, `app-shell.tsx` | Account forms and navigation. |
| `components/production-workspace.tsx` | Customer requests, operator queue, assignment, operation details and interventions. |
| `components/fleet-workspace.tsx` | Self-service registration, specifications, fleet and connection credentials. |
| `components/computer-controls.tsx` | Authorized local browser controls and acknowledgment display. |
| `components/camera-panel.tsx` | HLS/WHEP playback and availability states. |
| `components/flight-map.tsx`, `geographic-map.tsx`, `telemetry-playback.ts` | Map loading, geographic display, measured interpolation. |
| `app/operations.css`, `app/map.css`, `app/globals.css`, `lib/map-style.ts` | Application/map styling. |
| `convex/schema.ts`, `operationsSchema.ts` | Auth, fleet, work orders, operations, commands, telemetry, progress, events, media and control-ticket tables. |
| `convex/access.ts`, `accounts.ts`, `auth.ts`, `auth.config.ts`, `http.ts` | Identity, authorization, account lifecycle, and authentication endpoints. |
| `convex/fleet.ts`, `credentials.ts` | Registration, vehicle provisioning, credential issuance/revocation and integration approval. |
| `convex/workOrders.ts`, `operations.ts` | Requests, matching, atomic assignment, command intent and operator reconciliation. |
| `convex/agentLink.ts` | Agent sessions, plan readiness, command claims/acknowledgments, telemetry and measured lifecycle. |
| `convex/manualControl.ts`, `cameras.ts` | Manual-control authorization and camera access. |
| `lib/operations.ts` | Shared operational types, matching, plans, stable serialization and measurement validation. |
| `agent/index.ts`, `flight-agent.ts` | Local process entry point and backend/adapter orchestration. |
| `agent/drone-adapter.ts`, `adapter-command.ts`, `validate-plan.ts`, `mission-executor.ts` | Integration contract, bounded command acknowledgment, plan validation and measured execution. |
| `agent/adapters/simulated-drone.ts` | Independent local simulator. |
| `scripts/setup-auth.mjs` | Authentication signing-key provisioning. |

Generated Convex files were refreshed as modules were added. Historical demo code/data and prior user work were preserved, including archived UI, browser test, and README under `archive/phase1/`. Legacy `agent/simulator.ts`, `lib/flight.ts`, `lib/tasks.ts`, and older map/task components remain; they are not the current authenticated operational path.

## Verification already performed

No additional tests were started after the user requested that testing stop. The last running registration test had already completed successfully.

- TypeScript passed after the self-registration changes.
- The production build passed after the self-registration changes; a subsequent accessible-label adjustment and fleet specification text were exercised in the browser.
- The latest non-network test run passed 25 checks covering domain/backend logic and the adapter. The three loopback gateway checks had passed separately before the registration changes.
- The complete browser scenario passed with self-registration: customer request, acceptance, autonomous flight, takeover, manual landing, manual flight, agent interruption/reconciliation, refresh, and mobile layout.
- A separate browser scenario passed physical-drone **registration only**, confirming that model/payload specifications persist in the fleet, no join code is required, and the mobile layout does not overflow. It made no physical connection.

Evidence artifacts from these runs are local and temporary:

- `/private/tmp/zip-self-registration-verified-e2e/`
- `/private/tmp/zip-drone-specifications-e2e/`

## Remaining work and limits

These are follow-up items, not claims that the current goal secretly verified them:

1. **Physical integration:** choose the actual protocol/controller, implement and wire its adapter, map real telemetry and controls, verify controller ownership and link-loss behavior, and enable physical integration only after that work. The app currently rejects physical execution.
2. **Dispatch scale:** eligible-job matching reads the oldest 200 open orders before filtering. Pagination/indexing needs improvement so a large irrelevant queue cannot hide matching work. Customer/operation lists also have fixed limits; the active-request limit examines only recent records.
3. **Production configuration:** configure hosted Convex/frontend, authentication recovery, HTTPS/WSS, operational monitoring and deployment procedures. Public deployment was not requested or performed.
4. **Camera delivery:** implement the actual media source/service and verify end-to-end playback, authorization and network traversal. The contracts and browser playback paths exist; a real feed does not.
5. **Task execution beyond flight checks:** current search/inspection/delivery requests describe requirements and routes, but do not implement detection, evidence capture/storage, or payload release. Search/inspection area selection has been restored; delivery still uses simpler point geometry than the preserved older delivery demo.
6. **Further control hardening:** continuous supervision is strongest in autonomous execution. Manual/return/landing supervision, startup cleanup, telemetry-call timeout handling and deeper adapter fault behavior need further work once the controller is known. Passing the simulator tests does not verify real flight safety.
7. **Other maintenance:** improve dispatch/profile management for larger fleets, complete lifecycle cleanup/retention, and remove or migrate unused legacy modules when appropriate. Existing operator service-area editing is limited; registration establishes the first profile's base and radius.

The current handoff is the working application foundation and its documented integration boundary. It is not a claim that these remaining production or hardware tasks are complete.

## Restored search and inspection areas

Following the handoff, search and inspection regained two-corner rectangular selection, corner editing, clear/reset, shaded boundaries, area dimensions, and a sweep preview. `lib/areas.ts` normalizes corners and creates alternating survey rows. `workOrders.area` stores the region; submission generates waypoints on the server, which feed the existing flight-plan executor. Customer request maps, operator review maps, and active-operation maps display the region. Existing requests remain readable. Areas must be at least 10 m wide/tall and no larger than 1 km per side; existing flight-time and aircraft-boundary checks still apply. Sweep spacing is a planning preview, not a guarantee of camera coverage or detection. Only TypeScript was checked for this restoration; no additional browser suite was run, following the request to limit testing.

## UI copy cleanup

Removed the map footer captions, plan-version label, and technical implementation copy from the flight UI. The request form no longer has a redundant New request button. The request-history view retains a Request a flight action for starting another request. Simulation labels and useful flight/connection status remain visible. No additional tests were run for this copy cleanup.
