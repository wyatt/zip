# Production flight operations

This scope was authorized after the completed Phase 1 simulator. It supersedes the v1-only limits in CODEX_ASTRA_BUILD_PROMPT.md while retaining Convex, the separate local flight agent, the adapter boundary, and the iris visual direction.

## Ownership

- Customers own work orders and can see only their own requests and operation progress.
- Operators register their own drones and specifications without invitation codes. Registered operators receive eligible work orders based on service area, qualifications, vehicle capabilities, and requested execution environment. Acceptance atomically reserves an operator and vehicle.
- Convex is authoritative for accounts, aircraft registrations, assignments, immutable flight plans, command intent, control ownership, latest measured telemetry, and audit events.
- The local flight agent is the only aircraft communication process. It authenticates with a revocable operator fleet credential, then acquires an expiring session per aircraft. Aircraft acknowledgments, not button clicks, establish control ownership.
- An adapter supplies identity, live measurements, readiness, command acknowledgment, control transfer, and local failsafe behavior. The simulator implements the same contract. No hardware protocol is assumed, and no placeholder hardware adapter reports success.
- Stabilization and immediate link-loss handling remain with the aircraft controller and local agent. Cloud telemetry publication must not block aircraft control.

## First integrated operation

Customer requests a flight check → eligible operator accepts and selects autonomous or manual control → server generates takeoff/hover/land plan → agent validates and loads plan → operator starts → aircraft acknowledgment → measured takeoff, hover, landing, disarm → completion. Manual mode and takeover transfer ownership explicitly; they do not pretend a remote pilot has acted. Intervention, timeout, and restart paths are tested independently of the happy path.

## Data and safety boundaries

- Legacy demo records remain stored, but are not adopted into customer accounts or exposed through anonymous endpoints.
- Real and simulated environments are explicit and cannot be mixed. Missing sensor data is null/unknown, never fabricated.
- Telemetry carries a source timestamp, receipt timestamp, session ID, and sequence. Numeric measurements are finite and validated. UI interpolation smooths measured positions over a small bounded buffer; stale data freezes and is labeled stale.
- Commands have an idempotency key, expected control generation, expiry, agent claim, acknowledgment, and terminal outcome. Takeover fences autonomous commands. An uncertain command is reconciled against aircraft state rather than blindly replayed.
- Landing alone does not establish task success. Grounded/disarmed aircraft state and verified plan progress establish flight completion.
- Video transport is negotiated by the adapter and access-controlled. Unsupported cameras are shown as unavailable; video is not synthesized.

## Verification and release

Release evidence must cover account isolation, self-service operator/aircraft registration, capability dispatch, concurrent acceptance, credentials/session fencing, command expiry and replay protection, measured lifecycle, manual/takeover acknowledgment, cloud/agent interruption, telemetry freshness and smoothing, camera authorization, and customer/operator browser flows. Production deployment additionally needs configured identity/email services, TLS/origins, provisioned operators and agents, backups and monitoring, and a verified real-aircraft adapter before physical controls are enabled. Hardware integration and public deployment are not implied by this build.
