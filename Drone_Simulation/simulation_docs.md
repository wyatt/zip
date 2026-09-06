# Regional mission simulator integration

The viewer is a browser-based planning and simulation surface for the acquired 5 km × 5 km Ithaca terrain package.

## User flow

1. The complete regional overview opens north-up in **Plan map**. This is the same terrain geometry, material, and color treatment used in 3D.
2. The user chooses **Deliver**, **Inspect**, or **Search** and supplies every mission input in 2D.
3. **Deliver** accepts point A and point B. It plans A → B, records the delivery at B, and returns to A.
4. **Inspect** accepts point A anywhere in the regional domain and a simple irregular polygon. It routes from A to the area, plans coverage inside the polygon, returns to A, and builds a north-up 2D mosaic from simulated captures.
5. **Search** accepts point A anywhere in the regional domain and a simple irregular polygon. It routes from A to the area, searches for a seeded hidden target inside the polygon, reveals the red marker when detected, reports its east/north/elevation coordinates, and returns to A.
6. **Plan mission** runs coarse whole-map A* in a Web Worker. The 3D control remains locked until planning succeeds. The app then enters 3D and streams detailed terrain around the planned route.
7. **Start** runs or pauses the simulation. **Clear** discards the route and result and returns to the 2D editor.

The polygon format is either an array of rings or a GeoJSON `Polygon`. The first ring is the outer boundary and later rings are holes. Rings may be open or explicitly closed. Validation rejects non-finite coordinates, fewer than three distinct points, self-crossing rings, intersecting holes, holes outside the outer boundary, domains outside the acquired region, and oversized areas.

## Website API

`viewer/main.js` exposes a small adapter on `window.missionPlanner` for the demo page:

```js
window.missionPlanner.setDraft({
  mode: 'search', // 'delivery' | 'inspection' | 'search'
  a: [120, -80], // local east, north metres; optional third value is elevation
  polygon: [[
    [-300, -250], [250, -220], [320, 80], [40, 310], [-280, 120]
  ]],
});

await window.missionPlanner.plan();
window.missionPlanner.start();

const plan = window.missionPlanner.getPlan();
const state = window.missionPlanner.getState();
const searchResult = window.missionPlanner.getResult();
window.missionPlanner.clear();
```

For delivery, supply `b: [east, north]` instead of `polygon`. A host may set the HTML specification inputs before calling `plan()`, or integrate below the page layer with `createLandscape`.

The lower-level viewer boundary is:

```js
const view = await createLandscape(container, {
  dataUrl: '/data/',
  onMapClick(point) {},       // [east, north, NAVD88 elevation]
  onPlanning(progress) {},    // {stage, completed, total}
  onMission(state) {},
  onMissionEvent(event) {},   // start, delivered, found, complete, error
  onMapStatus(message) {},
});

view.setMissionDraft(draft);
const initialState = await view.planRegionalMission({
  mode: 'inspection',
  a: [120, -80],
  polygon: [[[-300,-250],[250,-220],[320,80],[40,310],[-280,120]]],
  settings: {
    speed: 5,
    climbSpeed: 2,
    flightMinutes: 46.5,
    clearance: 4.572,
    bodyRadius: 0.5,
    uncertainty: 1,
    arrivalReserve: 10,
    trackSpacing: 30,
    captureSpacing: 15,
    detectionRadius: 50,
  },
});
view.toggleMission();
```

The planner result contains `tasks`, `start`, `polygon`, a hidden `target` for search, timing/battery estimates, options, terrain resolution, and a safety note. Mission state contains phase, position, elapsed simulated seconds, battery, distance, photo progress, and `result`. A completed search result is:

```js
{
  type: 'search-result',
  location: [eastMetres, northMetres, elevationNavd88Metres],
  foundAt: simulatedSeconds
}
```

Inspection data remains available as `view.reconstructionData()` or `window.inspectionReconstruction`. `view.reconstructionJSON()` serializes the polygon mask, measured bit, elevations, classes, aerial RGBA values, coverage counts, timestamps, and capture metadata.

## Planning and rendering behavior

The renderer loads the 25 m overview immediately, requests visible 5 m/1 m display tiles as zoom requires, deduplicates in-flight requests, caps the retained tile cache, and releases evicted geometry and textures. Imagery stays separately loadable. Planning fetches offscreen terrain independently of the camera. Once the user enters 3D, terrain is clipped and framed to the polygon bounds or a buffered delivery corridor; detail tiles outside those XY bounds are neither requested nor retained. Returning to the planning map restores the complete regional overview.

The planner uses 25 m maximum-return overview cells for A* topology. Points near polygon boundaries snap to the nearest valid interior coarse cell while retaining the exact user coordinate at the route end. It densifies candidate routes to 5 m, loads the surrounding detailed tiles, and builds a terrain-following altitude profile from 5 m maximum-return cells with horizontal clearance dilation. It enforces climb/descent speed and a return battery reserve. Collision validation does not use averaged heights. This is a restricted-resolution route and does not claim an exact shortest path.

Search and inspection use unconstrained whole-map A* between point A and the closest end of the coverage pattern. Alternating scan segments are connected through A* constrained to the polygon, including holes, followed by an unconstrained return route when A lies outside. Search track spacing must remain within the selected detection coverage. Inspection mosaics use a polygon mask; cells outside the shape remain excluded rather than appearing as missing captures.

## Run and check locally

```sh
npm --prefix viewer ci
npm --prefix viewer run dev -- --port 5174
npm --prefix viewer test
npm --prefix viewer run build
```

The simulator requires WebGL, `ResizeObserver`, `Worker`, and `DecompressionStream` for compressed terrain. Dispose the view on unmount. It remains an offline simulator and does not control a physical drone, certify airspace, or emit autopilot commands.
