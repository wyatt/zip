# iris — closed-loop simulated drone demo

## 1. Objective

Act as the lead product engineer for a small hackathon team. Build the smallest complete version of **iris** that proves this cycle:

**requester submits a job → operator accepts it and selects supervised autonomy → backend assigns a simulated drone → local agent receives the mission → operator starts it → simulated drone flies → telemetry and mission steps update → drone returns and lands → mission completes**

Phase 1 is only this closed loop. Use **Convex as the authoritative backend** and a deterministic simulator as the aircraft. Do not inspect, connect to, reverse engineer, or command the physical drone during Phase 1.

The eventual aircraft is the user-provided **Octixo F19 Arvo Drone**. Preserve a small adapter boundary so a real implementation can replace the simulator later, but do not build Phase 2 infrastructure now.

## 2. V1 definition of done

The demo is complete when:

1. A requester submits one generic drone job.
2. The job appears live in the operator interface.
3. The operator accepts the job and selects **Supervised autonomy**.
4. Convex assigns the single seeded simulated drone and creates a mission with `planVersion: 1`.
5. A separate local simulated flight agent receives the mission and reports ready.
6. The operator presses **Start autonomous flight**.
7. The agent accepts the command and runs a fixed 20-second simulated flight.
8. A drone marker moves on the map while telemetry and mission steps update through Convex.
9. The simulator automatically returns to launch and lands.
10. The mission becomes complete only after the landing step completes.

The UI, Convex writes/subscriptions, command handoff, local agent, telemetry, and mission lifecycle must actually connect end to end. Do not implement the demo as unrelated browser timers that only look connected.

Fake data is encouraged. Label the drone and telemetry as simulated and keep the values internally coherent.

## 3. Working agreement

First inspect the repository, applicable `AGENTS.md` files, existing code, and the supplied design reference. Then implement the working flow rather than stopping after a plan or scaffold.

Create a lightweight `IMPLEMENTATION_CHECKLIST.md` containing the v1 happy-path items, current status, and any real blocker. It is a working checklist, not a twelve-part evidence ledger.

Make routine reversible decisions yourself. Prefer the simplest implementation that closes the cycle. Keep unresolved future ideas out of the critical path. Do not deploy publicly unless the user asks.

## 4. Product surfaces

Build two focused experiences:

### Requester

- requester name;
- one generic job description;
- location or map point;
- **Submit job**;
- current job/mission status.

### Operator

- live incoming-job list;
- selected job details;
- accept job and select **Supervised autonomy**;
- assigned simulated drone and agent readiness;
- planned route and simple mission-step list;
- **Start autonomous flight**;
- live simulated position, altitude, battery, current step, and elapsed time;
- automatic returning, landed, and completed states.

Use `/request` and `/operator`. Show mission details inside the operator experience or use `/mission/[id]` only if a dedicated route clearly improves the demo.

Use the supplied `iris` visual direction if present: lowercase wordmark, high-contrast black and white, electric-lime accent, restrained borders, strong typography, a useful map, and responsive layouts. Prioritize the operational flow over marketing content.

## 5. System shape

```text
Requester UI ─┐
              ├─ Next.js ⇄ Convex ⇄ local simulated flight agent ⇄ simulator adapter
Operator UI ──┘
```

- Next.js owns the requester and operator interfaces.
- Convex owns jobs, drone assignment, mission state, the command, latest telemetry, mission steps, and a small event table.
- Convex subscriptions keep the requester and operator views current.
- The local simulated flight agent is a separate local process. It observes its assigned mission and pending Start command, runs the simulator, and writes updates to Convex.
- The simulator adapter owns deterministic route movement and telemetry.

Do not introduce FastAPI, SQLite, PostgreSQL, a queue, scheduled Convex jobs, or another backend service for v1.

## 6. Minimal data and lifecycle

Keep the schema small and change field names if a clearer implementation emerges. Represent at least:

- `jobs`: requester name, description, location, status, timestamps;
- `drones`: one seeded simulator with fixed capabilities and availability;
- `missions`: job, assigned drone, mode, `planVersion: 1`, route, steps, current state;
- `commands`: one Start command with `pending → accepted → completed | failed`;
- `telemetry`: the latest simulated snapshot for the mission;
- `events`: a small append-only table for useful demo events.

A simple mission lifecycle is enough:

```text
submitted → assigned → ready → running → returning → landed → completed
```

Keep only the guards needed for the happy path:

- the operator must accept the job and select supervised autonomy before assignment;
- Start requires an assigned mission and a ready simulated agent;
- repeated Start clicks must not create a second execution;
- the mission cannot complete before landing;
- simulator data must be visibly labeled as simulated.

Do not add plan revision systems beyond `planVersion: 1`, lease expiration, competing-agent ownership, multiple consumers, capability negotiation, scheduled cleanup, or bounded event-retention machinery.

## 7. Local agent and simulator

Use a small adapter contract that v1 actually needs:

```text
connect
report fixed identity and readiness
load mission
start
emit telemetry and step updates
return automatically
land automatically
report completion or failure
```

The local agent should:

- identify the single seeded simulator;
- report a basic heartbeat/readiness signal;
- observe the assigned mission and pending Start command;
- mark the command accepted;
- run the fixed simulation once;
- publish telemetry, mission-step updates, and useful events;
- mark the command completed after landing, or failed if the simple execution throws an actual error.

The simulator should run a fixed 20-second mission:

```text
ready → takeoff → outbound → task action → return → land → complete
```

During the mission:

- move the drone marker along a deterministic route;
- update position, altitude, battery, elapsed time, and current step;
- keep timestamps and sequence order coherent;
- decrease battery rather than increasing it;
- visibly travel back to the launch point;
- reach ground altitude before publishing the landing event.

V1 has one Start action. Do not add pause/resume or separate return, land, and stop controls. Return and landing happen automatically as part of the fixed mission.

If the local agent or Convex connection stops, it is acceptable for the demo to stop and require a clean restart. Do not build cloud-disconnection continuation, full restart recovery, or resynchronization yet.

## 8. Implementation order

Work depth-first:

1. Inspect the repository and design reference.
2. Scaffold Next.js and Convex only as needed for the two interfaces.
3. Seed the one simulated drone and fixed plan shape.
4. Make requester submission appear live for the operator.
5. Make operator acceptance and supervised-autonomy selection create the assigned mission.
6. Build the local simulated flight agent and simple adapter.
7. Connect Start to the three-state command lifecycle.
8. Run the fixed 20-second flight and stream telemetry and mission steps through Convex.
9. Return, land, and complete through the backend lifecycle.
10. Exercise the complete flow in requester and operator browser sessions and fix observable defects.

Do not broaden the build until this cycle works.

## 9. Focused verification

Verify the happy path in the browser from a fresh job through mission completion. Confirm that:

- the operator sees the submitted job without manual data entry;
- acceptance assigns the seeded simulator;
- the local agent becomes ready;
- Start begins only one execution;
- the map, telemetry, and steps update from Convex-backed data;
- return and landing are visible;
- completion occurs only after landing;
- refreshing a browser page shows the current persisted state.

Add only a few high-value automated checks, such as preventing completion before landing and preventing a repeated Start from creating another execution. Exhaustive state-transition and failure-path testing is deferred.

## 10. Deferred until after v1

Do not implement these during the closed-loop slice:

- multiple customer segments or request presets;
- pause and resume;
- separate return, land, and stop controls;
- intentional failure simulation;
- lease expiration or competing-agent ownership;
- multiple agent consumers;
- continuing a sortie through cloud disconnection;
- full restart and resynchronization behavior;
- plan versioning beyond `planVersion: 1`;
- command states beyond `pending → accepted → completed | failed`;
- dedicated cancellation, interruption, stale-telemetry, and failure state machines;
- scheduled Convex jobs;
- capability negotiation beyond fixed simulator capabilities;
- bounded event-retention machinery;
- exhaustive transition tests or an evidence ledger;
- a dedicated `/mission/[id]` route unless it clearly improves the demo;
- a separate Phase 2 handoff document;
- configurable simulator speed;
- physical F19 integration.

For Phase 2, a short adapter note in the code or README is enough.

## 11. Deliverables

- requester screen;
- operator screen with mission details;
- Convex schema, mutations, queries, and subscriptions;
- one seeded simulated drone and fixed `planVersion: 1` route;
- separate local simulated flight agent;
- small simulator adapter;
- fixed 20-second mission with automatic return and landing;
- lightweight happy-path checks;
- concise setup and demo instructions;
- lightweight `IMPLEMENTATION_CHECKLIST.md`.

The v1 build is complete when a fresh requester job flows through the operator and local agent, the simulated drone visibly flies and returns, telemetry and steps update through Convex, and the mission completes after landing.

Begin by inspecting the workspace and design reference, then close this cycle. Stop after v1 unless the user explicitly asks for more.


## 12. Requirements of UI

Look at the images in /UI_design/ to get an idea for the feel of the site. If that is too hard, look at this prompt which was used to generate them:

Use black, white, neutral grays, Lato typography, generous spacing, and sleek map graphics. No marketing hero, decorative subtitles, gradients, stock photography, or “AI-powered” language. Prioritize clarity for someone who knows nothing about drones, with a layout that adapts naturally to mobile.