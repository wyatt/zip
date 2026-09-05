# Repository instructions

- Treat `CODEX_ASTRA_BUILD_PROMPT.md` as the authoritative task specification.
- Phase 1 ends with the complete simulated requester → operator → mission cycle. Do not inspect, connect to, reverse engineer, or control the physical drone unless the user explicitly starts Phase 2.
- Use Convex as the authoritative backend. Do not introduce another database or backend service without a demonstrated blocker.
- Build the vertical slice to completion before expanding scope or adding secondary features.
- Keep the simulator behind the adapter boundary and run it through the separate local flight agent. Do not implement simulation as browser-only animation.
- Keep v1 to one generic job, one operator, one seeded simulator, one Start action, and a fixed 20-second mission with automatic return and landing.
- Treat the items listed under “Deferred until after v1” in the build prompt as out of scope.
- Preserve user files and existing changes. Make routine reversible decisions autonomously.
- Maintain a lightweight `IMPLEMENTATION_CHECKLIST.md` for the v1 happy path.
- Run relevant checks and exercise the complete flow in requester and operator browser sessions before reporting Phase 1 complete.

## Design references

The supplied design assets are currently outside the repository at:

`/Users/david/Desktop/UI_design/`

Inspect `IMG_9414.png` before implementation. Treat it as the intended Phase 1 route and flow concept.
