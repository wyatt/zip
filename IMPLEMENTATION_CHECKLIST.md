# zip v1

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
