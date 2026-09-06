# Simulator integration guide

This is the entry point for integrating the existing landscape/inspection simulator into another website. It documents the implementation as of September 5, 2026. Treat the current code and this guide as authoritative over historical descriptions in `viewer/README.md` and `viewer/MISSION.md`.

## Documentation folder

| File | Purpose |
| --- | --- |
| [API and configuration](docs/simulation/api.md) | Public methods, callbacks, state, drone variables, planning behavior, validation |
| [Data, mosaic, and colors](docs/simulation/data-and-colors.md) | Raster schemas, coordinate conversion, painting elsewhere, persistence, styling |
| [Integration example](docs/simulation/examples/embed.js) | Framework-independent mounting wrapper with host controls and cleanup |
| [Reusable mosaic painter](docs/simulation/examples/paint-mosaic.js) | Draw a live grid or downloaded JSON onto any canvas |

The examples are integration starting points, not an additional app or a new simulator API. No deployment or runtime behavior is changed by these documents.

## Begin locally

From the repository root:

```sh
npm --prefix viewer ci
npm --prefix viewer run dev -- --port 5173
```

Open `http://127.0.0.1:5173`. A server may already be running there; Vite can choose another port if occupied, so check its output.

1. The viewer starts in **Map** mode, showing the same lit 3D landscape directly from above over the exact 512 × 512 m dataset.
2. Optionally click **Start**, then a measured location, to move the charging pad. Escape cancels selection.
3. Expand **Drone assumptions** to choose flight speed, endurance, and charging duration.
4. Click **Start simulation**. Planning happens locally and the camera moves to 3D.
The Start marker becomes **Charge point** after departure and returns to **Start** when the mission is restarted.

5. **Pause / Resume** controls mission advancement. **Restart** clears the mission and mosaic; click Start simulation again to plan with new values.
6. The separate camera **Reset** fits the map. It does not restart an active mission.
7. **Download grid JSON** saves the reconstruction captured so far. In-memory state is lost on reload.

Current defaults: 5 m/s horizontal speed, 2 m/s climb/descent, 46.5 minutes full-battery flight endurance, and 20 minutes empty-to-full charging. Transit playback is 10×, survey/turns 70×, and charging 140×. Playback multipliers change presentation time, not the drone's physical speed or energy per simulated second.

## Choose an integration boundary

### Embed the landscape and simulation together

Import `createLandscape` from `viewer/landscape.js`. It owns Three.js, the data load, camera, planning, mission progression, coverage annotation, and drone graphics. Supply your own buttons and panels through its methods and callbacks. Use the [embedding example](docs/simulation/examples/embed.js).

Do not import `viewer/main.js` into an existing page unless you also want the original page's DOM conventions. `main.js`, `mission-ui.js`, and `reconstruction-view.js` are application-specific wiring, with hard-coded element IDs and document queries. They are not required by `createLandscape`.

The main landscape requires a browser with WebGL, canvas, `ResizeObserver`, and `requestAnimationFrame`. It is not server-renderable. In an SSR application, load and instantiate it only after a client-side container has mounted. Dispose it when that component unmounts. Guard asynchronous mounting against an unmount that happens before `createLandscape` resolves.

### Use the mission engine without the 3D viewer

`mission-planner.js`, `mission-simulation.js`, and `reconstruction.js` do not depend on Three.js or DOM APIs. They can be used in a worker or Node process. You provide the raster arrays, area, source-color sampler, and clock. See the headless example in [API and configuration](docs/simulation/api.md).

There is no built-in worker, HTTP service, fleet connector, or autopilot interface. A host can add those around the pure modules without changing the original source raster format.

### Display only the mosaic somewhere else

Obtain `view.reconstructionData()` and pass it to a painter associated with any canvas in your site. The canvas does not need to be beside or inside the 3D viewer. The supplied [painter](docs/simulation/examples/paint-mosaic.js) needs only the grid and the pure color helper. It also accepts parsed downloaded JSON.

You can render multiple canvases from the same grid with independent display styles. Each painter maintains its own pixel cache. Avoid using the original `bindReconstructionView` for multiple instances: it queries fixed document IDs.

## Files and dependencies to carry into the host

Copy the following modules together, preserving their relative import paths:

```text
landscape.js
mission-planner.js
mission-simulation.js
mission-view.js
reconstruction.js
inspection.js
surface-colors.js
photo-material.js
roof-display.js
wall-style.js
assets/ithaca-2023.jpg
```

Serve these data files together at the `dataUrl` you supply:

```text
manifest.json
elevation.f32
classes.u8
flags.u8
```

They currently live in `viewer/public/data/`. `dataUrl` must end in `/` because the loader appends filenames directly. For example, `/simulator/data/`, not `/simulator/data`.

Use the pinned dependencies in `viewer/package.json` and lockfile: Three.js 0.180.0 and Vite 7.3.6 for the current development/build workflow. The existing package also contains Proj4js 2.19.10; the active map no longer imports it, although legacy `basemap.js` does. Install a compatible modern Node runtime supported by the pinned Vite package; this repository does not pin a Node version. Another bundler is acceptable if it supports ES modules, the `three/addons/` imports, and imported JPEG asset URLs.

`basemap.js` (OSM tiles) and `study-map.js` (styled raster) are legacy map renderers and are no longer used by the main viewer. Map mode is the same 3D scene viewed directly from above, with identical materials, lighting, geometry, and annotation elevations. Only the camera and pan/orbit controls change. Do not restore a separate map surface during integration; that caused a color jump at animation startup.

You do not need Python, LiDAR downloads, or the `outputs/` processing directory just to serve the viewer. They are needed only to reacquire/export source data.

## Minimal host layout

```html
<div id="landscape-host"></div>
<canvas id="inspection-preview"></canvas>
```

```css
#landscape-host {
  position: relative;
  width: 100%;
  height: 70vh; /* A nonzero explicit height is required. */
  min-height: 320px;
}
#landscape-host > canvas { display: block; }
#inspection-preview {
  display: block;
  width: 100%;
  height: auto; /* Preserve the intrinsic domain aspect ratio. */
  image-rendering: pixelated;
}
```

Do not import all of `viewer/style.css` into a host by default: it contains global page styling. Bring over only the styles you need. The simulator inserts its own WebGL canvas, but HTML labels, instructions, status messages, and credits belong to the host.

The current study contains NYS orthophoto colors and USGS/Chesapeake Bay land-cover classifications. Retain appropriate source credit and provenance in the host, including in experiences that display only the mosaic. Existing credit markup is in `viewer/index.html`; source notes are in `viewer/assets/README.md` and the manifest.

## Fleet-specific configuration

Pass the selected drone's simulation profile to `view.planMission(profile)`. The profile is captured when planning; changing a form or a fleet object afterward will not modify a running mission. Clear/replan to apply a different drone.

The battery parameter is **usable endurance in minutes**, not Wh or mAh. The simulator has no electrical power model. If the fleet provides Wh, the host must derive endurance from an appropriate flight-power assumption before passing it in. Do not pass a mAh value as `flightMinutes`.

The profile fields, validation limits, and parameters still hard-coded in the planner are listed in [API and configuration](docs/simulation/api.md). In particular, playback rates, photo footprint, spacing, and inspection offset are not currently `planMission` options. Do not invent unsupported configuration keys and expect them to work.

## Integration validation

From the repository root:

```sh
npm --prefix viewer test
npm --prefix viewer run build
```

The current automated suite has 11 tests covering planning clearance, full mission completion, battery returns, charging rates, local height estimates, and reconstruction coverage. It does not replace a browser integration check.

In the host, verify:

- All four source requests and the bundled JPEG load successfully at the host's base path.
- The container sizes correctly on desktop and mobile, including after resize.
- Map/3D switching continuously tilts the same scene without color/surface swaps; map north and mosaic north agree.
- Start, pause, resume, clear, and replan update your own controls correctly.
- Travel shows 10×, survey 70×, and charging 140×; the arrival-battery estimate targets 10%.
- A second canvas paints only captured cells, persists across charging, and clears on restart.
- JSON remains accessible independently of the display styling.
- Unmount/re-mount does not leave canvases, event listeners, animation loops, or retained grids behind.

Browser visual verification was unavailable in the development session. Build success and the Node tests establish module/algorithm checks, not screenshot or layout correctness in your host.

## Scope and constraints for the next agent

Preserve the 1 m instanced-column rendering and persisted elevation/class/flag formats unless explicitly asked to change them. Display repairs and palettes are independent of measured data. Do not silently rewrite source elevations or class codes to simplify integration.

The current mission scans the whole inspection rectangle, including ground. Roof-only scanning and holding roof-level altitude between buildings were discussed but **have not been implemented**. Do not describe them as existing behavior.

The dataset is old, has missing measurements, and includes FAA planning footprints covering this area. Unknown-height routing uses local simulation estimates. This remains an offline simulation; it does not validate a real flight or produce a flight-ready controller command stream.
