# API and configuration reference

[Back to integration guide](../../simulation_docs.md)

## `createLandscape(container, options)`

Import from `viewer/landscape.js`. Returns a Promise resolving to the view object. Loading failures reject the Promise. Call it once per mounted container; successful instances must be disposed on unmount.

| Option | Meaning |
| --- | --- |
| `dataUrl` | Required in practice: URL prefix ending in `/` for the four data files |
| `onMission(snapshot)` | Called on rendered frames when a mission exists; not a guaranteed callback for every waypoint or phase transition |
| `onChange(change)` | Initial/current point descriptions, selection, distance, and manifest; can fire before the creation Promise resolves |
| `onProject(points)` | Screen projections of the two stored markers after render; `{x,y,visible}` in CSS pixels relative to the container |
| `onHover(pointOrNull)` | Hovered surface description, or null when no cell is hovered |
| `onMapStatus(text)` | Status string; the current top-down scene reports its status once |

Callbacks default to no-ops. Keep them inexpensive and do not throw from them. A heavy callback delays the animation loop. For React or similar hosts, throttle state updates rather than rendering the application tree on every `onMission` call.

`onChange` receives `{distance, points, selection, meta}`. `distance` is horizontal separation of the two stored samples, retained from the earlier visualizer. Only the first sample is now the Start/Charge point; the second is not an inspection endpoint. A point description contains `cell`, `elevation`, `code`, `label`, `blocked`, `x`, and `y`. `x/y` are local east/north meters; `elevation` is absolute NAVD88 meters. Estimated display heights are identified in the label. The `blocked` field reports the source FAA bit, not a runtime collision check.

The returned view has these methods:

| Method | Behavior |
| --- | --- |
| `planMission(settings = {})` | Synchronously builds safety model, plan, and empty reconstruction; replaces any previous mission; returns its `ready` snapshot; does not start movement |
| `toggleMission()` | Starts a ready mission; otherwise toggles pause. No-op before planning. Host should call only in ready/active/paused states, not complete/error |
| `missionState()` | New lightweight snapshot object, or `undefined` if no mission |
| `clearMission()` | Removes mission/paths/reconstruction and resets target shading to yellow; preserves current Start |
| `setView('top' \| 'orbit', options?)` | Moves the same scene's camera between overhead/oblique views; options `{animate:true, reset:false}`; default transition is 900 ms, disabled for reduced motion |
| `reset()` | Resets camera to fitted map; restores initial Start only when no mission exists; does not clear a mission |
| `select(0)` | Toggles interactive Start placement; ignored while any mission exists, including a completed one |
| `select(1)` | Legacy second-sample selection; not used by the inspection mission |
| `reconstructionData()` | Live plain object containing typed arrays, or null before planning/after clear |
| `reconstructionJSON()` | JSON string of the current grid, or null; arrays become ordinary arrays and NaN becomes null |
| `dispose()` | Releases rendering resources, controls, observers, event handlers, and RAF; treat as a terminal operation and call once |

`clearMission()` does not emit a dedicated null `onMission` callback. Clear host state and repaint an empty mosaic yourself after calling it. `reset()` and `clearMission()` are deliberately different operations. Changing Start requires clearing the mission first. There is currently no public `setStart(east,north)` method on the embedded view.

The module does not install the global `window.inspectionReconstruction`. That getter is installed by the demo's `main.js` only. Use `reconstructionData()` for portable integration.

## Drone profile

`planMission` merges the supplied settings with `defaults` from `mission-planner.js` and copies the result into the plan. Provide numeric values, not form strings. The example wrapper validates every supported field before calling it.

| Field | Default | Unit | Validation in `createLandscape` |
| --- | --- | --- | --- |
| `speed` | 5 | horizontal m/s | Finite, 1–15 inclusive |
| `climbSpeed` | 2 | vertical m/s, ascent and descent | Not validated there; host must require positive finite |
| `flightMinutes` | 46.5 | full-battery usable flight minutes | Finite, 5–180 inclusive |
| `chargeMinutes` | 20 | empty-to-full recharge minutes | Finite, 0.5–120 inclusive |
| `clearance` | 4.572 | meters, 15 ft | Not validated there; host must require nonnegative finite |
| `bodyRadius` | 0.5 | meters | Not validated there; host must require nonnegative finite |
| `uncertainty` | 1 | meters | Not validated there; host must require nonnegative finite |
| `arrivalReserve` | 10 | battery percentage at home | Not validated there; host must require finite, 0–less than 100 |

The demo form exposes only speed, endurance, and charging duration. Advanced fields are accepted by `planMission` because its settings are passed to the planner, but are not exposed or validated by the demo form. The pure planner does not apply these UI ranges either. Validate inputs at any worker/server boundary too.

The effective modeled obstacle margin is `clearance + bodyRadius + uncertainty`, currently 6.072 m, with conservative raster dilation. Increasing a margin may make the present target too close to the acquired boundary to plan. Handle planning errors in the host UI; do not suppress them by reducing clearances silently.

Battery expenditure is `100 * flightSeconds / (flightMinutes * 60)`. Movement time is `max(horizontalDistance / speed, abs(verticalChange) / climbSpeed)`. Charging increases percentage linearly; charging duration is `chargeMinutes * 60 * missingPercentage / 100`. The charger therefore retains its configured empty-to-full time even if endurance changes. The model does not automatically infer charger watts from battery capacity.

## State and timing

The phase sequence is normally:

```text
ready → outbound → turn/survey → return → charging → outbound → … → return → complete
```

An error may terminate progress. Pause is a separate boolean, not a phase. `toggleMission` flips pause after startup; write idempotent host pause/resume wrappers using `missionState()` if needed.

Snapshot fields:

| Field | Meaning |
| --- | --- |
| `phase`, `paused` | State and pause flag |
| `part` | Current group, 1-based; 1 or 2 |
| `elapsed` | Mission seconds, including recharge time |
| `battery` | Current percentage |
| `predictedArrivalBattery` | Current percentage minus recomputed return-flight energy |
| `returnSeconds` | Estimated return flight seconds, not wall-clock playback duration |
| `photos`, `totalPhotos` | Completed unique captures and planned total |
| `sorties`, `returns` | Number of departures and initiated returns |
| `position` | `[localEast, localNorth, absoluteNAVD88]`, meters |
| `multiplier` | 10 transit, 70 survey/turn, 140 charging, 1 ready/complete/error, 0 paused |
| `reason` | Latest return/error reason; it can remain populated after a later phase change |
| `chargeRemaining` | Mission seconds to full charge during charging; otherwise zero |
| `completedTasks` | Two-element array of completed task counts, not photo counts |
| `distance` | Accumulated 3D flight distance, meters |

The engine reevaluates return energy while surveying and checks the proposed next movement before spending that energy. It initiates a return before estimated arrival drops below `arrivalReserve`. Discrete time steps and abrupt obstacle changes can produce slightly more reserve. Returning after a completed part can also leave much more battery. There is no fixed 15% departure threshold.

The integrated renderer advances using RAF wall time capped at 0.25 s per frame. It pauses advancement while the document is hidden or the camera transition is active. This is a visual simulation clock, not a real-time telemetry clock; under severe stalls it deliberately does not catch up all elapsed wall time. Camera rendering and mission callbacks share the same loop. Do not also call `advanceReal()` on the same mission from another loop.

## Planning constants versus runtime options

The following remain implementation constants, not accepted configuration fields:

| Behavior | Current value | Location to change deliberately |
| --- | --- | --- |
| Playback rates | 10× / 70× / 140× | `MissionSimulation.multiplier`, `mission-simulation.js`; update UI copy/tests too |
| Surface offset | 12 m above local roof/terrain, subject to clearance | `photoHeight`, `mission-planner.js` |
| Footprint | 15 m east/west × 11 m north/south | Planner edge insets and reconstruction capture bounds; update together |
| Photo spacing | Every 2 horizontal meters | Planner photo-event generation |
| Pass spacing | At most 3 m | Planner lane count and spacing |
| Coverage groups | Two, split by lane index | Planner, simulation progress arrays, demo labels, mission-view colors |
| Area/initial Start | Existing local rectangle and pad | `inspection.js` |
| Terrain resolution | 1 m, fixed current crop | Exported data and texture registration checks |

The current 136 × 385 m target produces 42 passes and 7,896 nominal photos. Do not use that number as an invariant for a different domain: use `plan.photoCount` or `snapshot.totalPhotos`. The demo's initial/reset display text contains fixed current-domain numbers and would need updating if the area becomes configurable.

`planInspection` accepts an area object in the pure API, but the embedded viewer and floating overlay currently import the same fixed `inspection` constant. Exposing arbitrary runtime domains requires updating both integrations. The current planner expects a domain large enough for its photo footprint and meaningful two-part split; tiny/single-lane domains are not supported by the integrated flow.

## Pure engine example

```js
import {defaults, createSafetyModel, planInspection} from './mission-planner.js';
import {MissionSimulation} from './mission-simulation.js';
import {createReconstruction} from './reconstruction.js';

// meta/heights/classes/flags are already-loaded original aligned arrays.
const options = {...defaults, flightMinutes: 46.5};
const area = {
  start: {east: 27.5, north: -19.5},
  west: -246.5, east: -110.5, south: -244.5, north: 140.5,
};
const model = createSafetyModel(meta, heights, flags, options);
const plan = planInspection(model, area, options);
// Provide an sRGB byte sampler registered to local east/north coordinates.
const grid = createReconstruction(meta, area, heights, classes, flags, sampleRGB);
const sim = new MissionSimulation(model, plan, capture => grid.capture(capture));
sim.start();
sim.advanceReal(0.1); // 0.1 playback seconds; current phase determines multiplier
const state = sim.snapshot();
const reconstruction = grid.data;
```

`plan.parts` contains task arrays `{point, kind, lane, photo}`. `point` uses local east/north plus absolute NAVD88. `photo` is a unique integer ID or null. `plan.lanes` contains the lane point arrays. The simulation exposes its `events`, live `route`, and task cursor when instantiated directly; these are internal implementation properties, not part of the embedded view's snapshot API. Events record departures, return routes, charges, and completion. Captures go through the third constructor argument with `{id, position, time}`.

`sim.start()` starts or toggles pause; `sim.active` indicates whether advancement can proceed. Recreate both simulator and reconstruction for a fresh run: calling the engine's `reset()` alone does not reset the separately owned reconstruction/capture-ID set. There is no public save/resume checkpoint import. Exporting the mosaic is not sufficient to restore battery, routing, or mission cursors.
