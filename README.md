# zip — flight operations

Authenticated customer requests, self-registered operators, capability-based dispatch, server-generated flight plans, and a separate local flight agent. Convex owns operational data. The local agent owns aircraft communication and executes plans through `DroneAdapter`.

The integrated introductory job is **takeoff → measured hover → landing and disarm**. Autonomous flight, computer control, and explicit takeover use the same measured mission lifecycle. Physical aircraft integration is disabled until an actual adapter is installed and verified. No physical protocol is assumed.

## Local setup

Use Node.js 24 LTS (`.nvmrc`) and install locked dependencies:

```sh
npm ci
npm run backend
```

Keep the backend running. It provisions local Convex and generates `.env.local`. In another terminal, initialize authentication once and start Next.js:

```sh
npm run auth:setup
npm run dev
```

Authentication setup preserves existing signing keys. It stores keys in Convex configuration and does not print private keys or save them in the repository. Open http://127.0.0.1:3000/request and create an account with a password of 12–128 characters, then finish account setup.

### Provision operators and aircraft

1. Create an account, open `/operator`, and choose **Register your drone**. No invitation or join code is required.
2. Enter its name, model, hardware identity, supported capabilities, payload capacity, launch coordinates, flight boundary, and service radius. Registration creates the operator profile and adds the aircraft to your fleet automatically. Physical aircraft are registered immediately; control still requires the future verified adapter.
3. To exercise the application now, choose **Local simulator**. Its supported capabilities are fixed and clearly labeled. Save the one-time connection credential to `.env.agent` on the operator computer:

   ```dotenv
   ZIP_AGENT_TOKEN=YOUR_ISSUED_CREDENTIAL
   ```

4. Start the separate local flight agent in a third terminal:

   ```sh
   npm run agent
   ```

Each credential is scoped to one vehicle and expires after 90 days. Rotation invalidates older credentials. One live agent session owns a vehicle. `.env.agent` is private and must never be committed or placed in a `NEXT_PUBLIC_` variable.

### Exercise the complete flow

Use separate customer and operator browser sessions:

1. The customer submits a **Flight check** with execution environment **Simulation**, a location within 10 meters of the simulator's launch point, altitude, and hover duration.
2. The matching operator accepts the job and chooses autonomous/manual mode and the takeover method. Acceptance atomically reserves the operator and vehicle, and Convex creates the immutable plan.
3. Wait for Ready, then press **Start flight**. Autonomous mode executes the complete plan. Manual mode transfers control and waits for the operator's actions.
4. For computer control, select **Computer** at acceptance. After manual start or takeover, connect the computer controls. Hold a direction to move; release to hold. Use Manual takeoff and Manual land for discrete actions. Their acknowledgments appear in the controls; completion still requires measured landing and disarm.
5. Refresh either browser to restore the persisted operation. Completed operations keep their own final telemetry and cannot reveal the aircraft's next customer's flight.

The simulator generates telemetry continuously at 20 Hz, including while idle. The agent publishes up to 10 Hz through Convex. The map uses a 150 ms interpolation buffer without extrapolation; stale data freezes. Simulator motion follows elapsed time and battery persists between flights within the process. All simulator data is labeled.

The simulator has no camera or payload. Search, inspection, and delivery requirements require appropriately qualified operators and capable aircraft; completing a route alone does not prove those tasks succeeded. Real map tiles come from OpenFreeMap/OpenStreetMap and require network access and WebGL.

## Control and camera configuration

Default computer controls connect to `ws://127.0.0.1:8765/control`, on the same computer as the flight agent. The agent accepts only the exact configured browser origin. The browser obtains a short-lived, single-use authorization ticket from Convex; vehicle credentials are never sent to the browser control socket.

For an HTTPS application, use a trusted local TLS certificate and WSS:

```dotenv
# Agent-only configuration, in .env.agent
ZIP_ALLOWED_ORIGIN=https://YOUR_APPLICATION_HOST
ZIP_CONTROL_PORT=8765
ZIP_CONTROL_TLS_CERT=/absolute/path/to/certificate.pem
ZIP_CONTROL_TLS_KEY=/absolute/path/to/private-key.pem
```

Set `NEXT_PUBLIC_CONTROL_URL` in the frontend environment to the corresponding `wss://...:8765/control` endpoint. The gateway intentionally binds loopback: the operator browser and agent run on the same computer. A customer viewing remotely never receives control authority.

Camera-capable adapters can provide an HTTPS HLS or WHEP stream with a short expiry. Convex authorizes access to the operation and returns the stream session. The media service must enforce its own signed URL/session expiry, access rules, CORS, and network reachability. Camera transport and physical feeds have not been hardware-verified.

Password recovery requires `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` in the **Convex deployment environment**, with a verified sender. Without them, sign-in works but password recovery reports that email is not configured. Configure and verify recovery before serving real accounts.

## Checks

```sh
npm run typecheck
npm test
npm run build

# With the local Convex backend and Next.js running:
npx playwright install chromium
npx playwright test
```

Unit/backend tests cover access isolation, matching, reservations, credentials and session fencing, command expiry, measured completion, ownership verification, camera authorization, adapter behavior, and actual loopback WebSocket controls. The WebSocket tests need permission to listen on loopback.

The browser test provisions isolated local accounts and a simulator agent, then exercises autonomous flight, computer takeover and landing, manual flight, and interrupted-agent reconciliation. It refuses non-loopback Convex deployments. It creates test records and stops only the simulator process it started. Screenshots and traces are saved in the Playwright output directory. Check `IMPLEMENTATION_CHECKLIST.md` for current verification status; the presence of a test does not mean every scenario has passed.

## Integration and release status

See [IMPLEMENTATION_HANDOFF.md](IMPLEMENTATION_HANDOFF.md) for the complete inventory and remaining work. Development was wrapped at the user-requested handoff point.

`agent/drone-adapter.ts` defines units, command identities, expiry, cancellation, control transfer, measured telemetry, optional geographic navigation and cameras, and local link-loss handling. `lib/operations.ts` defines the single executable plan format. Adapters must honor cancellation before physical writes and implement controller-specific setpoint refresh and failsafe behavior. Stabilization belongs in the aircraft flight controller.

The production evolution is handed off with the limitations documented above. Before release, finish the remaining implementation checks, provision the deployment and operators, configure authentication recovery and HTTPS/WSS, verify camera delivery, and exercise failure paths. Before enabling real flight, implement and bench-verify the actual aircraft adapter and its telemetry, control-transfer, and link-loss behavior. See `ARCHITECTURE.md` for ownership and invariants.

Historical Phase 1 instructions and UI are preserved under `archive/phase1/`. Their old seeding, unauthenticated access, and fixed 20-second timing do not describe the current application.
