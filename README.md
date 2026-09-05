# zip — local simulated flight demo

Next.js requester and operator screens, a local Convex backend, and a separate flight agent. No physical aircraft integration and no public deployment.

## Run locally

Use Node.js 24 LTS or 26+ and npm. Install the locked dependencies:

```sh
npm ci
```

Keep these three terminals running from the repository:

```sh
# Terminal 1: provisions local Convex and writes .env.local on first run
npm run backend

# Terminal 2: seeds zip-sim-01, reports readiness, and subscribes to missions
npm run agent

# Terminal 3: serves the application
npm run dev
```

Wait for Convex to report “functions ready” before starting the other processes. First setup downloads the local Convex runtime; no account is required. The generated `NEXT_PUBLIC_CONVEX_URL` connects both Next.js and the agent to the same backend. Convex state stays in the ignored `.convex/` directory. Restart Next.js if the environment URL changes.

Open [requester](http://127.0.0.1:3000/request) and [operator](http://127.0.0.1:3000/operator) in separate tabs or browser sessions.

1. Enter a name and generic job description. Choose a map point or use the numeric coordinates, then submit.
2. In the operator view, select the incoming job, check **Supervised autonomy**, and accept it.
3. Wait for the local simulated agent to report ready, then press **Start autonomous flight**.
4. Follow takeoff (0–3 seconds), outbound flight (3–9), task (9–12), return (12–18), and landing (18–20).
5. Confirm completion, all five steps done, altitude 0 m, and the marker back at launch. Expand Mission activity to see landing before completion. Refresh either tab: the job URL restores its persisted state.

The map is a schematic of fictional demo grounds, with coordinates in local meters. It does not use real geography. The simulator starts at 100% battery and finishes at 88%; every new flight is a fresh simulated battery. The heartbeat only indicates local agent connectivity. All mission and telemetry updates come through Convex; browser timers only refresh the connectivity indicator.

## Checks

```sh
npm run typecheck
npm test
npm run build

# With all three local processes running:
npx playwright install chromium
npx playwright test
```

The focused tests cover Start readiness/idempotency, one-time command acceptance, completion guards, and deterministic flight telemetry. The browser test uses separate requester/operator contexts for a fresh 20-second mission, checks return and landing event order, refreshes both pages, checks mobile overflow, and captures screenshots in ignored `test-results/`.

## Implementation

- `convex/schema.ts` / `convex/dispatch.ts`: authoritative jobs, simulator assignment, plan v1, command, latest telemetry, steps, and append-only mission events.
- `agent/index.ts`: separate local agent using a Convex subscription and basic heartbeat.
- `agent/simulator.ts`: small adapter contract and fixed 20-second execution.
- `lib/flight.ts`: deterministic route and telemetry sampling.
- `components/`: requester/operator interfaces and map rendering from subscribed data.

This is a trusted local demo without authentication. Keep it local. Only run one flight agent. A stopped agent or connection can interrupt a mission; failed commands retain their error for inspection and are not retried. Full recovery and restart reconciliation are outside v1; use a fresh local Convex deployment for a clean demo after an interrupted mission. Completed missions release the simulator for the next job normally.

Phase 2 would replace `FlightAdapter` with an explicitly authorized aircraft implementation. No hardware discovery, connection, or control is included.
