# Drone service — implementation brief for Codex GPT-6 Astra

## 1. Assignment and working agreement

Act as the lead product engineer for a two-person hackathon team. Build a cohesive local website from this brief, with maintainable architecture and a working demonstration. This document supersedes earlier versions of this project's build prompt.

First inspect the repository, applicable AGENTS.md files, existing code, and UI_design/. Summarize the implementation plan and important assumptions briefly, then build in verifiable increments. Do not stop after producing a plan or scaffold. Maintain a short implementation checklist so completed and outstanding work survives context changes.

Make routine implementation decisions yourself. Record deferred product choices in decisions_to_make.md and proceed with isolated, reversible assumptions. Ask only when a missing decision genuinely prevents required work; continue independent work while waiting. Unknown drone models and deferred package-handoff hardware must not block this build.

Respect existing user work and environment permissions. The explicit requirements here take precedence over optional skill defaults; in particular, this is a local Next.js/Python application, not a request to deploy, publish, or replace the stack with a hosting template. If a skill or environment restriction blocks required work, identify the instruction or restriction and its concrete impact. Do not install speculative infrastructure or contact anyone.

Use available tools to inspect files, implement changes, and verify behavior. Do not invent tool APIs. Keep progress updates concise and focused on working functionality, decisions, and blockers. Explain architecture in plain language. Validate work in proportion to its consequences, and stop repeating successful checks unless new changes justify doing so.

This task does not request additional agents. Work within the active environment's delegation policy. Keep module contracts and documentation clear enough that the second human developer can integrate hardware independently.

## 2. Agreed product contract

The customers are ordinary individuals and business owners who need drone services but know little about drones.

The customer:
1. Chooses Inspection, Delivery, or Search.
2. Answers a short task-specific form and confirms the location/area.
3. Reviews the requested outcome, timing, and estimated price.
4. Submits the job.
5. Is automatically connected with an eligible pilot who accepts it.
6. Tracks progress and receives the evidence/results.

The pilot manages a profile and individually listed drones, indicates availability, receives suitable offers, chooses a supported execution mode and aircraft, and accepts the mission. The platform generates the plan. The pilot approves it but cannot edit its route in this iteration.

Firm decisions:
- Task selection precedes questions. Do not start with a mandatory conversational AI interface.
- Customers never choose a pilot, aircraft, or execution mode.
- Jobs support immediate and scheduled requests.
- Pilots and aircraft are self-reported initially.
- Dispatch checks aircraft capability, availability, travel, and whole-mission feasibility.
- The pilot's chosen mode changes their payout.
- Pricing uses configurable quantities multiplied by unit rates.
- Inspection covers roofs, bridges, and solar panels and returns photos plus working AI image analysis. Stitching comes later.
- Both search intents initially cover the entire planned area, return ranked candidate locations, and require pilot confirmation of findings. A model score never terminates the search early.
- Delivery includes human acceptance of the package and return to pickup.
- Delivery handoff mechanics are undecided. Represent handoff as a hardware-neutral task and simulate the acceptance event.
- Real aircraft integration is deferred. A complete simulator exercises the same software contracts.
- Plan the whole sortie: launch, transit, task actions, return, landing, and subsequent evidence processing.
- Run locally now; design APIs that a future phone app can use.

## 3. Architecture and stack

The team's available skills and tools include TypeScript/Node.js, React, Next.js, Python, SQL, Java, C, REST/WebSocket APIs, microservices, data pipelines, D3.js, PostgreSQL, Redis, Supabase, Docker, Git, CI/CD, Tailwind, and Figma. Treat this as implementation context, not a requirement to use every technology. Keep Java/C at the future hardware boundary if needed, use D3 only for a concrete visualization need, and introduce Redis/Supabase only if a current requirement warrants them. Figma exports or other supplied design references may live in UI_design/.

Use Next.js App Router, React, and strict TypeScript for the website, with Python/FastAPI for the authoritative backend. Use SQLite, SQLAlchemy, Alembic, and Pydantic for persisted data and validated contracts. Use the official OpenAI Python SDK for image analysis.

SQLite is a reversible local-development default, not a product constraint. Use a configurable database URL and portable SQLAlchemy models/migrations so PostgreSQL can be selected later. Preserve a working PostgreSQL setup if one already exists rather than replacing it. Do not claim PostgreSQL compatibility is verified until its migrations and important transactional tests have actually run against PostgreSQL. Docker may provide an optional local database, but a new database service is not necessary solely because the team knows it.

Choose compatible stable versions after checking official documentation where needed. Preserve suitable existing dependencies and lockfiles. For a fresh repository, use pnpm for the web app and uv for Python. Keep ordinary setup free of Docker requirements.

Recommended frontend tools: Tailwind, accessible Radix/shadcn primitives, React Hook Form, Zod, TanStack Query, Lucide icons, and a browser-compatible map library with drawing support. Choose map and geocoding providers behind small adapters; document attribution, key requirements, and network dependence. Bundle Lato locally.

One repository, one Python application, one website. Use feature modules rather than separate microservices.

Suggested structure:
- apps/web/src/app: Next.js routes and layouts.
- apps/web/src/features: booking, pilot-profile, dispatch, operations, results.
- apps/web/src/components: shared accessible UI primitives and focused reusable components.
- apps/web/src/lib/api: generated API types and a small typed client.
- services/api/app: configuration, persistence setup, and modules for missions, pilots, drones, dispatch, pricing, planning, execution, and evidence.
- services/api/tests and services/api/migrations.
- docs: architecture, API/bridge contract, and demo instructions.
- UI_design: supplied visual references; preserve originals.
- decisions_to_make.md, README.md, and root development commands.

Use the equivalent structure if existing code provides a good foundation. Avoid one huge page, one huge service, generic dependency frameworks, and an interface for every small function.

Architecture rules:
- Python owns validation, eligibility, pricing, state transitions, route generation, and result processing.
- AI may assist with intent and analyze evidence; it cannot authorize a mission, assign a pilot, set prices, generate authoritative flight coordinates, or invoke aircraft commands. Treat user descriptions, uploaded-image text, and provider output as untrusted data and validate structured results before storing or displaying them.
- Next.js owns presentation and web interaction. Do not duplicate domain logic in Server Actions.
- Components call a typed API layer; route handlers invoke application services; services enforce policies and use persistence/integration adapters.
- Keep replaceable boundaries where they matter: AI analysis, aircraft execution, evidence storage, geocoding, and task planning.
- Generate TypeScript API types from FastAPI OpenAPI. Explicitly document/type streaming events because OpenAPI does not fully describe them.
- Share the public API with future native clients. Do not require Next.js-only sessions or actions to perform core operations.
- In initial local development, run one backend process and one simulator owner. Do not accidentally launch duplicate execution loops under development reload.
- Keep environment values, rates, and demo settings out of UI components.

## 4. Visual direction and supplied designs

Before styling, inspect images and relevant files in repository-relative UI_design/. The user described this as /UI_design/; it means the folder in this project, not the filesystem root. Use an image viewer for visual references rather than guessing their content. Do not overwrite the originals.

If references are missing, continue with the written visual specification and note that reference matching remains unverified. If several images conflict, use the most complete coherent reference and document the choice. Product behavior and accessibility remain authoritative when an illustration omits required states.

Create an exceedingly simple booking interface:
- White surfaces, black text/actions, restrained neutral gray.
- Lato throughout, with readable sizing and a clear type hierarchy.
- Task choices and booking controls visible in the first viewport.
- A compact form panel alongside a large, usable map on desktop.
- A deliberate stacked layout or bottom sheet on mobile.
- Sleek route geometry, map markers, hairline boundaries, disciplined spacing.
- Purposeful icons and restrained interaction motion.

No marketing hero, filler subtitle, “AI-powered” slogan, feature grid, decorative gradients, glowing effects, stock drone photos, or gratuitous cards. Never insert explanatory text just to occupy space. Use direct labels such as “Inspection,” “Where?”, “When?”, “Review,” and “Request pilot.”

Use red only when useful for a destructive action or critical condition. Status must remain understandable through text/icons, not color alone. Provide keyboard navigation, visible focus, meaningful labels, touch-friendly targets, and working loading/empty/error states. Keep important controls usable at narrow widths and enlarged text sizes.

A local demo identity/role switcher can expose customer and pilot experiences. It is development convenience, not production authentication. Keep simulation/fixture labels clear but unobtrusive, and implementation jargon out of customer forms.

## 5. Customer forms and outcomes

Common fields:
- Task type.
- Address search or map selection, followed by confirmation of the actual target or boundary.
- Immediate request or scheduled local date/time window, with a displayed timezone.
- Customer name/contact.
- Optional site access and launch-location notes.
- Optional plain-language instructions.
- Review of scope, assumptions, expected result, timing, and estimated charge.

Use structured forms as the reliable source of truth. Natural-language assistance may suggest values but is optional and cannot override confirmed input. Do not require an LLM to create a valid mission.

Inspection:
- Asset: roof, bridge, or solar panels.
- Asset outline or marked sections/surfaces.
- Entire asset versus selected portions.
- Concern: general condition, visible damage, a specific issue, or unsure.
- Optional reference photos and known dimensions/height; permit “I don't know.”
- Task-specific surface questions, such as bridge deck, sides, or underside.

Deliver original photos and an AI-assisted report referencing the actual photos. Include captured/missing areas, observations, supporting image IDs, uncertainty, and suggested follow-up. Do not promise certified structural conclusions, invisible damage detection, or solar performance diagnosis from ordinary RGB photographs. Translate requested outcomes into equipment requirements; reject unsupported inspection requests clearly.

Stitching is deferred. Preserve capture metadata and image ordering so it can be introduced later; do not implement a pretend stitched image.

Delivery:
- Pickup and destination addresses plus confirmed handoff points.
- Weight, length, width, and height with explicit units.
- Contents category/description.
- Handling requirements: fragility, orientation, temperature, and other instructions.
- Package readiness, delivery deadline/window, sender and recipient contact.
- Recipient availability confirmation.

Reject requirements not supported by any candidate aircraft/service. Route and estimate the loaded outbound leg, acceptance waiting allowance, and return. If the recipient does not accept, the configurable simulator behavior is to return with the undelivered package. Preserve separate delivery and aircraft-return outcomes.

Do not decide a real landing/release mechanism, proof-of-receipt method, or vendor command. Put those in decisions_to_make.md. The local demo has an explicit simulated recipient-acceptance event.

Search:
- Intent: one specific target or every instance of a target.
- Description, distinguishing features, optional reference images.
- Search boundary and optional last-known location/time.
- Timing and optional deadline.

Both intents complete planned coverage initially. Return ranked candidate locations, supporting images, and coverage/gap information. Pilots mark candidates confirmed, rejected, or uncertain. Findings can be reviewed during flight without ending coverage early.

Use “Likelihood” or “Match score” for uncalibrated model scores; do not present an arbitrary confidence as a statistically calibrated probability. No findings and incomplete coverage are valid outcomes.

## 6. Pilot profiles, aircraft, and availability

Build editable profiles, not fixture-only screens.

Pilot:
- Name/contact and base location.
- Current dispatch location, with manually entered location supported initially.
- Maximum travel distance; distinguish ground travel from aircraft flight range.
- Supported services, self-reported qualifications, and experience.
- Immediate availability and simple scheduled availability windows.
- Rating average, rating count, and completed-job count.
- Owned/operated aircraft references.

Show a new pilot as “No ratings yet.” Use a neutral matching default. Permit one customer rating per fulfilled mission; do not let pilots edit their own rating. A full reviews/moderation product is deferred.

Each aircraft:
- ID, name, manufacturer/model, operator.
- Availability, current location, and operational condition.
- Camera/sensor capabilities and relevant specifications.
- Payload mass and size limits, attachment/carrying capability, and handling support.
- Usable endurance, battery status with freshness timestamp.
- Supported modes and task actions.
- Positioning and navigation capabilities.
- Self-reported restrictions and provenance.

Unknown required capability is not a pass. Availability is separate from connection: an aircraft may be matchable before it connects, but live/simulated execution requires the appropriate connection and capability checks.

Prevent overlapping pilot or aircraft reservations. Reserve travel, setup, sortie, return, and a buffer for scheduled work. Store timestamps in UTC and preserve the customer's scheduling timezone. Revalidate operational data before execution; a future reservation is not proof of future battery charge.

## 7. Dispatch and the order of planning

Resolve the pricing/matching/planning dependency as follows:
1. Validate the request and derive task/equipment requirements.
2. Estimate task geometry/workload and generate preliminary plans for viable aircraft capabilities as needed.
3. Evaluate eligible pilot-aircraft-mode combinations and estimate quote quantities.
4. Show the customer a versioned quote with expiry. Confirmation starts dispatch.
5. Offer the job sequentially to the best eligible pilot, showing their eligible aircraft and modes.
6. On acceptance, atomically reserve the pilot/aircraft and record the chosen mode.
7. Finalize/revalidate that aircraft's plan and require pilot approval.
8. Revalidate execution preconditions before start.

For immediate jobs, rank by estimated readiness at launch, then reliability, then a stable ID. For scheduled jobs, first require the window can be met and rank eligible candidates by travel burden, reliability, and a stable tie-breaker. Keep tie rules and estimates deterministic. Label straight-line ground-travel approximations as estimates; isolate them for a future directions provider.

Hard filters:
- Pilot and aircraft availability for the entire required interval.
- Operator travel limit and timely arrival.
- Required qualifications/services, sensors, navigation, and actions.
- Payload mass/dimensions and handling compatibility.
- Enough endurance for the full sortie, reserve, and waiting allowance.
- A feasible preliminary route and at least one supported mode.

Return structured exclusion reasons for developer/pilot explanations. The customer never sees a candidate-selection UI.

Offers expire. Decline or timeout advances to the next candidate; an idle UI must not stop expiry processing. No candidates produces a real unmatched state with a way to revise timing/scope. Never auto-accept in normal demo behavior; use a separate pilot session to accept.

Use a transaction/conditional update for acceptance. Concurrent clicks, stale offers, and network retries must not assign two pilots or reserve an aircraft twice. Customer cancellation before execution closes offers and releases reservations. After start, cancellation is an operational request rather than immediate release of an airborne asset.

## 8. Linear pricing and payout

Create one versioned rate configuration with explicit units and currency. Use decimal arithmetic or integer minor units for money.

Customer quote = sum(quantity × customer unit rate) + platform fee.

Include:
- Ground travel: one configurable unit such as minutes, with round-trip policy explicit.
- Setup: minutes.
- Aircraft operation: flight minutes, including return.
- Operator labor: estimated minutes.
- Equipment: per-job or per-minute charges.
- Handoff waiting: included allowance.
- Evidence preparation/review: defined processing units.
- AI/API use: estimated image/token usage or clearly documented processing units.

Keep model usage estimated for quoting and record actual provider usage separately when available. Do not pretend the user's API account billing is measured unless the response supplies the data.

A reasonable initial policy is a fixed customer quote for the confirmed scope with an expiry. If dispatch changes require a higher price, get an explicit revised-quote acceptance rather than silently charging more. No actual payments in this build.

Payout = configured travel/aircraft/equipment allocations + operator labor allocation × mode factor.

Use editable illustrative factors, for example manual 1.0, assisted 0.75, supervised autonomous 0.5. These are demo assumptions, not market rates. Do not multiply the entire customer payment by these factors. Show eligible mode payouts to the pilot before acceptance and keep the chosen quote/payout breakdown immutable.

Track estimated customer revenue, pilot payout, platform processing costs, and margin separately. Reject invalid rates and flag estimates that cannot support their promised payout/cost. Recomputing a quote must not multiply charges through repeated requests.

## 9. Domain models and lifecycle

Keep these distinct:
- Customer request and task-specific specification.
- Versioned quote.
- Offer and assignment.
- Versioned aircraft-specific flight plan.
- Execution and command acknowledgements.
- Evidence assets, findings, and analysis runs.
- Mission events and customer-facing fulfillment outcome.

Use discriminated task-specific schemas so package fields cannot accidentally become search fields. Require explicit coordinate units, money currency, IDs, and UTC timestamps. Keep structured data validated even if some immutable snapshots use JSON storage.

Choose a small set of state machines with explicit transitions. Do not force every sub-process into one ambiguous mission-status enum:
- Booking/dispatch: draft, quoted, searching, assigned, unmatched, cancelled.
- Plan: proposed, valid/invalid, approved, superseded.
- Execution: not started, running, paused, returning, landed, interrupted/failed.
- Results: pending, processing, ready, needs review, failed.
- Handoff: pending, accepted, not accepted.

These are suggested names, not a mandatory list. Keep a transition table documenting guards and terminal outcomes.

Invariants:
- Approval binds the plan revision, assigned aircraft, and chosen mode.
- Changing relevant inputs invalidates approval and estimates as necessary.
- Starting requires current approval, assignment, feasible plan, and adapter readiness.
- Flight completion does not imply analysis completion or successful delivery.
- A returned aircraft can belong to a failed delivery.
- Coverage completion does not confirm a target.
- Stale telemetry does not prove landing or connection.
- Failed commands cannot be recorded as successful actions.
- An interrupted flight does not resume automatically after a server restart.

## 10. Hardware-neutral planning

Implement a deterministic planner with a shared result format and task-specific strategies. Python geometry libraries such as Shapely are appropriate. Keep algorithm code testable without HTTP, database, AI, or physical aircraft.

Flight plan:
- Schema/planner version and mission revision.
- Coordinate frame, origin, explicit axis convention and altitude reference.
- Ordered stages, paths, and waypoints with speed/altitude.
- Semantic actions: capture image, orient camera, wait for acceptance, return, land.
- Capture metadata expectations and estimated sensor footprint.
- Distance, duration, energy estimate/reserve, coverage, and known gaps.
- Assumptions, unsupported requirements, and feasibility errors.

Geographic requests use GeoJSON longitude/latitude. Geometry algorithms operate in a documented local metric projection. Indoor plans use a distinct local-meter representation, never mislabeled GeoJSON. A demo transform records translation/rotation/scale and replans distances/speeds/clearances; never silently upload geographic coordinates or a visual scaling transform as physical commands.

Validate whole path segments and connections, not only waypoint endpoints. A path whose endpoints are outside an obstacle can still cross it. Unsupported geometry must produce an actionable error, not an apparently valid route.

Search:
- Generate alternating coverage sweeps clipped to the region minus known exclusions.
- Set spacing from documented footprint/overlap assumptions, with conservative configurable defaults.
- Route connectors without cutting across exclusions; report unreachable regions.
- Include entry, exit, capture actions, return, and landing.
- Track geometric planned coverage separately from actual capture coverage. Clearly label estimates.
- Do not terminate early on a finding.

Inspection:
- Use coverage passes for roof and solar-panel surfaces.
- Use surface-specific passes/viewpoints for bridge inspection and optional orbits where appropriate.
- Include camera heading, stand-off, and capture instructions at a hardware-neutral level.
- When missing height/geometry makes a real route underdetermined, mark it incomplete. Use an explicitly synthetic asset model for the simulator, not invented real-world dimensions.
- Plan for usable photo coverage; stitching itself stays deferred.

Delivery:
- Plan pickup to destination around known inflated exclusions, handoff wait, and return.
- Include loaded outbound and possible loaded return estimates.
- Use a simple deterministic pathfinding approach. Prove obstacle/clearance checks for the chosen approach.
- No viable outbound or return route makes the plan infeasible.

The first environment model can be flat with conservative 2D exclusion columns and bounded altitude. State this limitation. Do not claim live obstacle detection, terrain knowledge, or flight authorization. Future 3D models and onboard controllers can implement the same requirements through capabilities.

## 11. Simulator and future bridge

Provide a typed execution adapter contract covering capability discovery, health, plan validation/upload, start, pause/resume, return, abort, command acknowledgements, telemetry, and capture events.

Implement a complete simulator plus a clearly documented boundary for future hardware adapters. Do not add an unimplemented “real drone” option that looks operational. Unknown vendor APIs require no speculative SDK dependencies.

Simulator requirements:
- Executes plans over time and streams position, battery estimate, stage, waypoint, timestamps, and events.
- Supports adjustable demo speed independent of wall-clock reservation/offer deadlines.
- Handles pause/resume, planned return, and abort.
- Return uses a validated path; it must not take an unchecked shortcut through obstacles.
- Define abort behavior as controlled termination/landing within simulation. Do not equate a generic physical abort with cutting motors.
- Models delivery waiting and simulated recipient acceptance separately from arrival.
- Produces evidence/capture events or accepts uploaded captured images.
- Exposes errors, stale telemetry, and interrupted runs truthfully.
- Stops background loops cleanly and records meaningful transitions.

Each command carries a command ID, mission/execution ID, and plan revision. Retrying a command must not restart a sortie. Receipt, acceptance, and completion are distinct acknowledgements.

Document example wire messages, units, frame conversion ownership, capability negotiation, evidence submission, and reconnect behavior in docs/drone-bridge.md. The hardware teammate should be able to implement an adapter without understanding React or pricing.

## 12. Evidence, inspection analysis, and search findings

Evidence is a first-class backend feature. Accept image uploads now so real analysis works before aircraft integration.

Store originals separately from database metadata. Record image ID, capture timestamp, source, mission/run association, optional waypoint/position/camera pose, and provenance: actual upload, simulator fixture, or imported demo material. Validate content, file size/count limits, safe filenames, and references. Do not expose arbitrary filesystem paths.

Implement an OpenAI vision-backed inspection analyzer using the Responses API and validated structured output. Read current official docs for the selected SDK/model. The coding model and application analysis model are separate choices: use configurable OPENAI_IMAGE_MODEL, not an assumed account entitlement to Astra.

Inspection output includes:
- Concise summary.
- Findings linked to real evidence IDs.
- Observations distinct from hypotheses.
- Uncertainty, inadequate views, and missing coverage.
- Suggested follow-up.
- Analysis provider/model/version and status.

Uploaded images must actually be sent to the configured model. A report template or filename-based heuristic does not satisfy AI analysis. Never fabricate findings, image contents, or source references.

For initial search analysis, use a replaceable image-ranking interface. A vision model can rank submitted capture images against the target description/reference photos and return candidate evidence with match scores. No bespoke CV model training is required. Deduplicate overlapping observations where metadata supports it.

A ranked image is not automatically a precise ground location. Attach a candidate to a location only when capture metadata or explicit human annotation supports it. Otherwise show “Location unavailable.” If using aircraft position as a rough approximation, disclose that and represent uncertainty; never claim it is the detected object's exact coordinate.

Pilots confirm/reject/mark uncertain; preserve raw model suggestions and human decisions separately. Completed coverage with no supported candidates is legitimate.

Use persistent processing-job status with bounded retries, timeouts, batch limits, and visible failures. A simple database-backed worker in the single backend process is enough; no queue platform is necessary. Network/model calls must not block unrelated API requests or telemetry. Detect interrupted jobs on restart and support explicit retry without duplicate results.

Provide an explicitly labeled fixture analyzer for no-key demos and deterministic tests. Keep fixture results bound to their own sample evidence. Do not silently return fixture findings for arbitrary user uploads when live analysis fails. Without a key, real uploads remain stored and show analysis unavailable until configuration/retry.

## 13. API, persistence, and local security

Version the public REST API under /api/v1. Include coherent resources/actions for:
- Draft creation/editing, estimates, quote acceptance, cancellation.
- Pilot profiles, aircraft inventory, immediate/scheduled availability.
- Offers, decline/accept, reservations.
- Plan retrieval/approval.
- Execution commands and telemetry.
- Evidence upload/listing, analysis jobs, candidate confirmation, results, and ratings.
- Health and runtime capability/configuration status without secrets.

Do not expose a customer action to pick an arbitrary pilot or bypass acceptance. Thin endpoints should call the same application services future clients will use.

Use consistent typed errors with codes, field details, and appropriate status codes. Enforce idempotency/conditional writes on booking confirmation, offer acceptance, and execution commands. Reject illegal transitions, expired quotes/offers, conflicting reservations, and stale plan revisions.

Persist core business records and important events with migrations. Keep high-frequency telemetry bounded in memory initially, with latest snapshots/event history sufficient for reconnect. Document what is lost at restart.

Provide a typed telemetry stream with bounded reconnect/backoff and resync. A browser refresh must recover server state, not create a new mission, execution, or subscription owner.

Use configured local origins and loopback binding by default. Keep API keys in backend environment variables only. Demo identities must not masquerade as production security; enforce their logical resource relationships without claiming authentication. Public deployment, real authentication, and data retention rules belong in the decision register.

Provide image-storage and geocoding adapters that can later use hosted services. Do not promise a fully offline map when tiles/geocoding require a network. Provide a local arena view and a few clearly labeled demo locations so the core rehearsal still works if those services fail.

## 14. Pilot and customer screens

Customer:
- Task picker, guided form, map/address confirmation.
- Scope/price review, submission, matching progress.
- Accepted pilot and arrival estimate, booking status.
- Mission progress, evidence gallery, report, ranked/confirmed findings or delivery outcome.
- Results processing and error/retry states.
- Completion rating.

Pilot:
- Editable profile and aircraft inventory.
- Availability controls and upcoming assignments.
- Offer detail: task, travel, timing, equipment, aircraft choices, valid modes, payout, preliminary route, and assumptions.
- Accept/decline and clarification flag.
- Generated final plan with approve/reject and explicit reasons. No route editor.
- Operations: relevant status, connection, battery, progress, valid execution controls, events, and findings review.

Mode definitions:
- Manual: pilot performs flight/capture actions with route guidance.
- Assisted: eligible aircraft performs specified supported portions; show what remains manual.
- Supervised autonomous: approved plan executes under operator monitoring.

The simulator can visualize each mode, but mark simulated manual/assisted behavior accurately. Do not imply a browser has real flight controls when no hardware bridge exists.

Avoid unnecessary admin dashboards. Internal exclusion/cost details belong in focused pilot/developer views, not the customer booking journey.

## 15. decisions_to_make.md

Create this file early and keep it current. For each unresolved item record: decision, why it matters, current temporary assumption, affected module, whether it blocks real deployment/hardware or only a later enhancement, and what evidence would resolve it.

Include at least:
- Delivery landing/release/loading mechanics and physical recipient handoff.
- Receipt confirmation method, handoff timeout, custody, and failed-delivery handling.
- Actual drone models, SDKs, capabilities, indoor localization, camera feeds, abort/lost-link semantics.
- Real battery/payload/energy models and required margins.
- Inspection quality thresholds, bridge geometry acquisition, and stitching.
- Search confidence calibration, location accuracy, candidate deduplication, and future CV provider.
- Financial rate values, ground-travel policy, mode payout factors, taxes, cancellation/refund policy.
- Map/geocoding provider, service area, and data licensing.
- Identity, verification, privacy/retention, and deployment requirements.
- Future phone-app implementation and mobile authentication.

Do not reopen settled decisions. In particular, no customer pilot selection, initial full-area search, deferred stitching, local development, and no pilot route editing are fixed scope.

## 16. Execution milestones

Keep each milestone runnable and update the checklist with evidence. Complete all milestones unless a genuine external dependency blocks a specific part.

A. Foundation and first usable screen:
Inspect UI_design/, establish architecture and decision register, scaffold Next.js/FastAPI, migrations, typed client, Lato/theme, task picker, and map/form shell. Show a meaningful local preview as soon as it works.

B. Booking and dispatch:
Implement the three forms, structured specifications, editable pilot/drone profiles, availability, preliminary plans/estimates, quotes, sequential offers, acceptance, and reservations. Demonstrate the customer and pilot roles in separate browser sessions.

C. Mission execution:
Implement all three planning strategies, revision-bound approval, simulator, telemetry, delivery acceptance/return, full search coverage, and valid operational controls. Rehearse a 20–30 second accelerated search.

D. Evidence and AI:
Implement uploads, real inspection analysis, ranked search candidates with honest location provenance, pilot confirmation, processing states, and labeled fixture mode. Keep stitching deferred.

E. Verification and handoff:
Run tests/builds, inspect the UI against references on desktop/mobile, fix actual defects, and finish documentation/decision register.

If the user later requests only one milestone, honor that narrower scope. Do not use a successful milestone as a reason to declare the full assigned build complete.

## 17. Verification and representative scenarios

Use focused unit/integration tests for policy and geometry, plus browser tests for the critical journeys. Check observable outcomes, not private implementation details.

Required examples:
1. Search booking: a near pilot with insufficient endurance is excluded; a capable available pair receives an offer; decline/expiry advances dispatch; the next pilot accepts and chooses a supported mode.
2. Reservation race: two accept attempts or overlapping bookings cannot reserve the same resource twice.
3. Scheduled job: travel/setup/return buffers can make an otherwise free time window ineligible.
4. Pricing: line items reconcile exactly, payout changes by eligible mode, and quote values do not change silently.
5. Approval: start fails before approval; aircraft/mode/plan changes invalidate it; a repeated start cannot create duplicate execution.
6. Geometry: concave areas, exclusions, connectors, and delivery outbound/return segments respect boundaries. Invalid/unreachable plans report errors.
7. Endurance: enough battery for outbound only is insufficient for delivery. Waiting and loaded-return estimates matter.
8. Search: an early high-scoring candidate does not stop coverage; final candidates include evidence/provenance and require pilot confirmation.
9. Delivery: arrival alone is not success; acceptance allows return; timeout returns an undelivered package and records the correct outcome.
10. Inspection: uploaded photos pass through the real analyzer when configured, findings cite uploaded image IDs, and inadequate evidence is reported. Mock provider calls for automated tests; separately run one small live smoke test if credentials are available.
11. Truthful fallback: absent/failed AI credentials never produce fake live reports for arbitrary images. Fixture mode is explicit.
12. Recovery: refresh/reconnect restores state without restarting a sortie; interrupted backend jobs/executions are visible.
13. Interface: task selection comes first; customers cannot select pilot/mode; pilot profile edits affect eligibility; core flows work on desktop and narrow/mobile layouts.

Run Python tests/lint, TypeScript checks, frontend tests, Next.js production build, and browser happy paths. Explicitly perform browser interaction and screenshot checks against UI_design/ when references exist. Preserve any reports/screenshots in an appropriate local artifact location.

If live provider verification cannot run, explain exactly what remains unverified and provide the retry command. Do not claim fixture tests prove the live integration or that simulator tests prove physical flight.

## 18. Deliverables and completion

Provide root commands equivalent to setup, dev, test, lint, build, seed, and API-type generation. The development command starts/stops web and backend cleanly. Seed repeatably without deleting user missions. Keep secrets, runtime uploads, and generated local databases out of source control.

Documentation:
- README.md: exact prerequisites/commands, environment configuration, local URLs, demo procedure, known limits.
- docs/architecture.md: module ownership, request-to-results flow, state/transaction boundaries, and future mobile/hardware integration.
- docs/drone-bridge.md: exact hardware integration contract and sample messages.
- decisions_to_make.md: deferred decisions and temporary assumptions.
- An implementation checklist with completed and blocked acceptance items.

The build is complete when the customer/pilot flow works end to end, dispatch and payout obey the agreed rules, all three task plans are simulated through return/landing, evidence/results work, inspection has a real AI implementation, search covers the area and supports confirmation, profiles/availability are editable, decisions and contracts are documented, and required checks pass. Explicit external verification blockers must remain labeled rather than hidden.

Do not implement payments, stitching, real aircraft SDKs, autonomous early-stop search, route editing, native mobile apps, swarms, production authentication, weather/airspace integrations, or public deployment in this iteration. Their natural extension points and decision records are sufficient.

End with a brief handoff: what works, local run instructions, the demo sequence, verification results, any specific external blockers, and the file the hardware teammate should read first.

Begin by inspecting the workspace and the supplied UI references, then execute the build.

---

Prompt-design reference: OpenAI's GPT-6 Astra guidance on initiative, instruction following, communication, and verification informed the working agreement. The product requirements and architecture above are specific to this project, not claims that OpenAI prescribes this stack.
[Official GPT-6 Astra prompting guidance](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices)
