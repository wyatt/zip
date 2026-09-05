# zip v1

## Production evolution — handoff

- [ ] Customer authentication, session recovery, and private work orders.
- [x] Self-service operator/drone registration without join codes, saved specifications, basic capability/service-area matching, atomic acceptance.
- [x] Server-generated plans; autonomous and manual control modes verified with the local simulator.
- [ ] Vehicle-scoped agent credentials, session fencing, command expiry and reconciliation.
- [x] Adapter-driven takeoff → hover → land; acknowledged takeover and manual landing verified with the local simulator.
- [ ] Independent live telemetry, measured lifecycle, stale-data handling, smooth display.
- [ ] Authorized camera integration contract and honest availability states.
- [x] Existing customer/operator browser flow, manual flight, and restart reconciliation pass; no further testing at user request.
- [ ] Production configuration, operator/agent provisioning, deployment and adapter documentation.

Work wrapped at user request. See `IMPLEMENTATION_HANDOFF.md` for the complete implementation inventory, verification evidence, and remaining limitations. Unchecked production items are not represented as complete.

Physical aircraft integration is unverified and remains disabled. The historical completed checks below describe the simulator only.

- [x] Inspect repository, specification, and supplied route/design references.
- [x] Requester submission appears live in operator session.
- [x] Acceptance with supervised autonomy assigns one seeded simulator / plan v1.
- [x] Separate local agent receives mission and reports ready.
- [x] Start is guarded and creates only one execution.
- [x] Fixed 20-second adapter flight streams position, altitude, battery, and steps through Convex.
- [x] Automatic return and landing precede mission / command completion.
- [x] Requester and operator browser flow, refresh persistence, and focused checks pass.
- [x] Setup and demo instructions complete.

Status: Phase 1 complete. No blocker. Verified locally on 2026-09-05: TypeScript, production build, 3 focused tests, and one full Playwright mission in separate requester/operator browser sessions (22.7 seconds). Desktop and mobile screenshots inspected; no browser errors or mobile overflow. Landing event precedes completion; both screens preserve the completed job after refresh. Nothing publicly deployed; no physical drone accessed.

## Iteration 2 — task types and real map

User-authorized expansion beyond the generic v1 job; physical flight remains out of scope.

- [x] Delivery pickup/drop-off pins and additional instructions.
- [x] Search and inspection rectangular region selection.
- [x] Real street map, zoom/pan, attribution, selection editing and previews.
- [x] Convex persists task geometry; local agent flies task-specific routes and steps.
- [x] Verify each task end to end, map tiles, persistence, and mobile layout.

Status: iteration 2 complete. TypeScript, production build, seven focused tests, and all three full browser mission tests pass. Real street tiles and desktop/mobile layouts inspected. Delivery, search, and inspection each persist their selections across refresh and finish after automatic return and landing. Existing v1 data preserved.

## Inspection sweep and map readability

- [x] New inspection missions scan alternating rows across the entire selected rectangle; existing saved mission plans stay intact.
- [x] Use Image_Drop references for a simplified vector basemap with restrained labels and blue/green natural features.
- [x] TypeScript, production build, eight focused tests, and a fresh complete inspection browser mission pass; desktop and mobile map renders inspected.

## Drone marker clarity

- [x] Replace the arrow and oversized halo with a clear four-rotor drone marker.
- [x] Hide flight-path lines by default; add an explicit toggle and legend, soften the task-area boundary, and space launch labels away from the drone.
- [x] TypeScript passes; browser checks verify marker rendering, path toggle, no page errors, and mobile overflow. Desktop and mobile renders inspected.

## Restored area selection

- [x] Search/inspection two-corner editing, shaded area, dimensions and sweep preview.
- [x] Persist area and generate sweep waypoints server-side; display in customer/operator/operation maps.
- [x] TypeScript passes. Additional test runs omitted at user request.
