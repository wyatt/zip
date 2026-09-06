# Inspection simulation

Open http://127.0.0.1:5173 and click **Start simulation**. Pause/Resume freezes and resumes the mission; Restart clears it so assumptions or Start can be changed. Map and 3D controls remain usable during playback.

The current 136 × 385 m inspection rectangle is split into eastern and western groups of 21 passes each. Both groups return to the Start/Charge point when finished. A group can need multiple battery flights: the default scenario completes in four flights, taking 7,896 simulated photos and returning home at the end.

Travel to the inspection boundary, returns, and travel back to the saved resume position run at 10×. Coverage and between-pass turns run at 70×; charging runs at 140×, with the playback rate displayed beside the mission clock. Time spent in a hidden tab or changing camera mode is paused. Photo counters represent planned capture events; no camera is connected.

## Planning

`mission-planner.js` calculates waypoints from the original measured elevation/occupancy arrays. The persisted data schema, source measurements, and instanced landscape geometry are unchanged.

- A boustrophedon path alternates north/south passes. Pass spacing is approximately 2.95 m (at most 3 m), with photo events every 2 horizontal meters. Nominal footprints are 15 m across × 11 m along track, giving at least 80% side overlap and approximately 81.8% forward overlap on a level surface.
- Coverage targets 12 m above the local roof or terrain directly beneath the drone. Nearby taller obstacles can raise individual segments to preserve clearance. Horizontal travel slows when necessary to keep climb/descent at 2 m/s, instead of lifting long stretches of the path to maintain constant horizontal speed. Actual footprint/overlap will vary with height and terrain; this is not a calibrated camera model.
- Transit uses a conservative climb–cross–descend connector. It finds the highest clearance requirement along every crossed raster cell and crosses above it. It is not a shortest-path optimizer.
- The obstacle field is inflated horizontally and vertically by 15 ft (4.572 m), plus 0.5 m vehicle radius and 1 m uncertainty allowance. Cell extent is included conservatively. Paths cannot leave the acquired clearance envelope.
- Missing measurements use the highest nearby original measurement, expanding the neighborhood until at least four samples are found. These are local simulation estimates, not measured or guaranteed upper bounds. Source heights and validity flags remain unchanged; reconstruction exports continue to mark missing source heights unknown. Takeoff and landing use an explicit pad-column exception to ground clearance; that pad and its surroundings need independent validation.

## Battery and resuming

`mission-simulation.js` tracks movement, capture progress, time, and battery independently of rendering. It continuously calculates the battery expected on arrival at the charger from the live position. It returns just before that prediction would fall below 10%, rather than waiting for the current battery to reach a fixed percentage. The panel shows this live arrival estimate; the departure percentage varies with return distance and climbing energy. It also checks the proposed next movement before committing, since crossing an obstacle boundary can abruptly increase return energy.

After landing, charging restores the battery to 100%, then the drone travels back through the inspection boundary to the exact interrupted position and continues the next unfinished waypoint. Completed photo IDs are retained. Finishing Part 1 triggers a return/recharge before Part 2; finishing Part 2 triggers the final return.

Defaults are 5 m/s horizontal speed, 46.5 minutes flight endurance, and 20 minutes empty-to-full charging. The panel exposes these three values. Battery drain is proportional to simulated flight time, including climbs and returns; recharge time is proportional to the missing percentage. Wind, acceleration, load, temperature, battery aging, and nonlinear charging are not modeled. `defaults`, `travelSeconds`, and the simulation's energy calculations are the integration points for a future fleet capability profile; no fleet connection is present yet. The enlarged drone symbol is for visibility, not a physical scale model.

The current area intersects the dataset's FAA planning footprints. This is an offline visualization, not a flight-ready mission or an executable autopilot export.

## Verification

Run `npm --prefix viewer test` and `npm --prefix viewer run build` from the repository root. Tests cover footprint spacing, unique photos, clearance on all coverage segments, measured-data preservation, playback rates, pause, full-mission return/recharge/resume, early returns with a short battery, and infeasible departure rejection. Browser visual verification was unavailable in this development session.

## Incremental coverage and rooftop mosaic

Each successful simulated photo marks its nominal 15 × 11 m footprint as covered. Covered cells turn green on the floating target in both map and 3D modes; remaining cells stay yellow. Travel and charging do not create coverage. Overlap increments a per-cell photo count without counting the same photo twice. Restart clears the accumulated capture state.

The separate **Rooftop mosaic** panel reveals the existing 2023 aerial image at 1 m resolution as those captures occur. It is a simulated nadir mosaic of the whole target (roofs and surrounding land), not a photogrammetric reconstruction or newly acquired imagery. Measured heights are copied only for captured cells. Missing source heights stay unknown even after capture, independently of the display-only terrain repairs.

`reconstruction.js` owns the neutral data object, independently of Three.js and the canvas. Access it through `view.reconstructionData()` when embedding or `window.inspectionReconstruction` in the current page. Treat the live arrays as read-only. **Download grid JSON** or `view.reconstructionJSON()` produces a portable snapshot. State is held in memory until Restart/reload; downloading saves a persistent file.

The raster is 136 columns × 385 rows, north-up, row-major. Index is `row * cols + col`. `origin` is the northwest outer corner in EPSG:32618 meters; cell centers are `[origin[0] + (col + 0.5) * resolution, origin[1] - (row + 0.5) * resolution]`. Heights use EPSG:5703 (NAVD88 meters). `bounds` are local offsets relative to the study origin.

Fields include `coverage` (Uint16 photo counts), `elevation` (Float32 meters), `measured` (Uint8 validity), `classes` (original Uint8 land-cover codes), `rgba` (Uint8 sRGB image channels), and `firstSeenSeconds` / `lastSeenSeconds` (Float64 mission timestamps). Uncaptured colors are transparent; unknown heights/times are NaN in memory and null in JSON. JSON converts all typed arrays to ordinary arrays. `captures` records each unique photo ID, mission time, position and footprint; `coveredCells` and `revision` allow efficient updates without copying the grid every frame.

The mosaic display uses the same land-cover palette and aerial-luminance mapping as the 3D model: green lawn, darker green trees, neutral gray roofs and pavement, and blue water. It omits 3D directional lighting and cast shadows. This is a view-only color treatment; exported `rgba` remains original aerial color. Both views share `surface-colors.js`. The panel width follows the domain aspect ratio, and its canvas fills the image frame without letterboxing.

The main 2D map uses `mapSurfaceRGB`: solid lawns and roofs, light paved surfaces, and subdued canopy detail. Paths are styled where the existing land-cover raster identifies pavement; no new path geometry or classifications are invented. The main map uses `study-map.js`, a single local texture, and has no building/place labels. The Rooftop mosaic retains its earlier `surfaceRGB` treatment and raw exported aerial colors.

Map mode now views the original 3D scene directly from above. Starting the mission only tilts the camera; it no longer swaps a styled raster for the terrain or flattens mission annotations. Geometry, material colors, lighting, and annotation elevations remain consistent during the transition. `study-map.js` is retained as a legacy helper but is not imported by the viewer. The separate Rooftop mosaic is unchanged.
