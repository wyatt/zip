# Data, mosaic, and coloration

[Back to integration guide](../../simulation_docs.md)

## Source raster contract

The viewer fetches a manifest and three aligned binary arrays. All rasters are row-major, north to south and west to east. For a source cell, `index = row * meta.cols + col`.

| File | In-memory type | Current size | Meaning |
| --- | --- | --- | --- |
| `elevation.f32` | Float32Array, little-endian bytes | 1,048,576 bytes | Absolute NAVD88 surface height in meters; missing = NaN |
| `classes.u8` | Uint8Array | 262,144 bytes | Original land-cover category, not a display color |
| `flags.u8` | Uint8Array | 262,144 bytes | Bit 0 (`flags[i] & 1`) measured; bit 1 (`flags[i] & 2`) FAA planning footprint |
| `manifest.json` | Plain object | Small metadata file | Rows, columns, resolution, origin, CRS, class legend, height bounds, source provenance |

The current grid is 512 × 512 with 1 m resolution; local northwest outer corner is `x0=-256`, `y0=256`. The study origin is UTM zone 18N `[377760.2293770153, 4700577.510997841]` meters. Its geographic center is approximately latitude 42.4478926458004, longitude −76.48646602014907.

Local source-cell center:

```js
const east = meta.x0 + (col + 0.5) * meta.resolution;
const north = meta.y0 - (row + 0.5) * meta.resolution;
const utmEast = meta.origin.utm_m[0] + east;
const utmNorth = meta.origin.utm_m[1] + north;
```

Mission positions use `[east, north, NAVD88]`, while Three.js uses `[east, NAVD88 - baseline, -north]`. `baseline = Math.floor(meta.zMin) - 3`. Do not pass latitude/longitude directly to these APIs, subtract terrain elevation from an already-absolute waypoint, or confuse altitude above a roof with NAVD88 elevation. Horizontal CRS is EPSG:32618; vertical CRS is EPSG:5703. The original LiDAR provenance includes GEOID12B information.

The coverage overlay explicitly inverts UVs to keep north up. Map mode uses the same 3D scene directly from above. The mosaic canvas is already north-up in array order; do not flip its rows again.

## Provenance and limitations

- Geometry: measured 2020 LiDAR surface; values describe the visible surface, including trees and roofs, not a separate terrain/building decomposition.
- Classes: Tompkins County 2022 land-cover raster, 2024 edition. Code 21 is Structures, code 24 is Tree Canopy over Structures. These are classified pixels, not per-building polygon IDs.
- Color: registered spring 2023 NYS orthophoto, `assets/ithaca-2023.jpg`, 2048 × 2048 pixels covering the exact crop.
- The renderer checks the current dimensions, resolution, origin, and offsets against this photo registration. Another site's coordinates will fail that check until matching data and imagery are supplied deliberately.

`roof-display.js` fills missing display heights by averages of nearby original measurements. `wall-style.js` extends building wall material to nearby cells within 3 m horizontally and 2 m vertically. Both are visual treatment. The planner separately estimates missing heights from nearby original maxima. Reconstruction exports retain unknown measured heights instead of either repair. None of these operations edits the persisted source arrays.

For another acquired area, use `viewer/export_data.py` with a corresponding processed output directory, then acquire a correctly registered aerial crop and update registration checks. Exporting alone does not create new imagery or make the fixed inspection area appropriate for the new crop. The exporter currently limits output to 512 × 512 cells.

## Live reconstruction object

Access through `view.reconstructionData()`, or `grid.data` for the pure reconstruction module. It starts empty after planning, accumulates only on unique photo events, persists through battery returns/charging, and is replaced on replan or removed on clear. Treat all returned fields and arrays as read-only; this is the engine's live object, not a defensive copy.

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | number, currently 1 | Schema version |
| `revision` | integer | Increments once per unique captured photo |
| `simulated` | boolean | True; existing data revealed by simulated photos |
| `crs`, `verticalCrs` | strings | EPSG:32618 and EPSG:5703 |
| `origin` | `[number, number]` | Absolute UTM northwest outer corner of reconstruction |
| `bounds` | `{west,east,south,north}` | Local study-offset bounds in meters |
| `resolution`, `rows`, `cols` | numbers | Current grid: 1 m, 385 rows, 136 columns |
| `order` | string | Documents raster row/column convention |
| `sources` | object | Image/height provenance and simulation note |
| `coveredCells` | integer | Cells photographed at least once |
| `captures` | array | `{id,time,position,footprintMeters}` per unique photo |
| `coverage` | Uint16Array | Per-cell number of overlapping photos, capped at 65,535 |
| `elevation` | Float32Array | Captured source height; NaN until captured or if source missing |
| `measured` | Uint8Array | 1 only if a captured cell has a valid measured source height |
| `classes` | Uint8Array | Source class for captured cells; zero initially |
| `rgba` | Uint8Array, length `4 * rows * cols` | Original sampled aerial sRGB bytes; alpha 0 until capture, then 255 |
| `firstSeenSeconds` | Float64Array | Mission time of first capture; NaN initially |
| `lastSeenSeconds` | Float64Array | Latest mission capture time; NaN initially |

For a mosaic cell, `origin` is already absolute UTM: `E = origin[0] + (col + .5) * resolution`, `N = origin[1] - (row + .5) * resolution`. Do not add the study origin a second time. Sampled source cells are selected by floor-based containment in the source grid. The target bounds are offset by half a meter from that grid, so the mosaic is its own georeferenced raster, not just a raw slice with identical cell centers.

The nominal capture rectangle is 15 m east/west × 11 m north/south, clipped to the target. A cell is covered when its center lies in a captured footprint. Green coverage means photographed in the simulation, not independently validated roof reconstruction or proof of a known height. Ground is included in the current target and mosaic. Photo IDs prevent duplicate capture events from inflating counts, while different overlapping photos legitimately increment counts.

The current 52,360-cell mosaic's typed arrays occupy about 1.4 MiB, plus capture records and object overhead. JSON is larger and allocates new ordinary arrays; export it on demand, not each animation frame.

## Paint elsewhere

Use [paint-mosaic.js](examples/paint-mosaic.js):

```js
import {createMosaicPainter} from './paint-mosaic.js';
const paint = createMosaicPainter(myCanvas, {style: 'model'});
paint(view.reconstructionData());
// Call again after capture revisions, or pass null after clear:
paint(null);
```

Style options in this documentation helper are `model` (current mosaic), `map` (solid main-map cartography), and `aerial` (unaltered exported colors). These options belong to the helper, not `createLandscape`.

The helper reads but never modifies the grid. It caches painted cells because the current reconstruction copies source color only on first capture. To support a future reconstruction that revises already-captured pixels, replace that cache strategy or recreate the painter when those values change. If you change palettes dynamically, recreate the painter or invalidate its cache too.

Use an image wrapper with the same aspect ratio as the grid or allow canvas `width:100%; height:auto`. Do not constrain width and height independently with `object-fit:contain` inside a wider checkerboard frame; that caused the previous side margins. Checkerboard should indicate unobserved cells inside the image, not extra space around it.

For a separate page/process, send a JSON snapshot or structured-clone the live data into a message. Do not transfer the live typed arrays' buffers with a transfer list; that would detach the buffers still used by the simulator. Throttle full-grid messages and prefer revision-based updates. No cross-window transport is built in.

## Persistence and loading

`view.reconstructionJSON()` serializes typed arrays as ordinary arrays and nonfinite numbers as null. Save the returned string as `application/json`. To display later:

```js
const grid = JSON.parse(await file.text());
paint(grid); // The supplied painter accepts ordinary arrays too.
```

The painter performs basic dimensional and buffer-length checks, not a complete untrusted-file schema audit. A production upload endpoint should validate schema version, limits, numeric types, and expected source identifiers as appropriate.

For numerical analysis, explicitly convert null heights/times back to NaN if reconstructing typed arrays. `new Float32Array(json.elevation)` by itself converts null to zero and would create false sea-level measurements.

There is no automatic localStorage, database write, background upload, GeoTIFF export, or mission checkpoint restoration. Add persistence at the host boundary. A grid snapshot is suitable for viewing captured results but does not contain enough state to resume the flight engine.

## Colors: three different views

| View | Code | Current treatment |
| --- | --- | --- |
| 3D terrain | `photo-material.js` + `surfaceTones` | Land-cover palette, aerial luminance detail, Three.js lighting and shadows |
| Rooftop mosaic | `surfaceRGB` in `surface-colors.js` | Same material palette/detail calculation; no directional lights or new cast shadows |
| Main 2D Map | `landscape.js` overhead camera | Identical 3D materials, lighting, and shadows; no separate map image or building labels |

`surfaceTones` contains grass `#578b39`, trees `#367346`, building `#a5a8aa`, road `#85878a`, and water `#337b91`. `coverStyle` maps original category codes to these display groups. `surfaceRGB` uses linear-light luminance with clamped detail before returning sRGB bytes. Editing shared tones affects the 3D material and model-style mosaic, and the overhead Map view. The legacy flat-map palette remains available through `mapSurfaceRGB` for optional external canvases.

The unused legacy flat-map palette's solid RGB values are lawn `[104,155,63]`, roofs `[184,187,182]`, roads `[169,172,168]`, other mapped pavement `[205,204,190]`, and water `[67,132,150]`. Trees use a restrained luminance variation. Unmapped groups retain aerial color. Paths appear paved only where the source classification identifies pavement; the viewer does not infer new paths from image lines.

The floating inspection annotation uses yellow `[255,223,70]` until capture, then green `[74,220,105]`, at opacity 0.25 in `inspection.js`. It hovers at a visual height independent of mission altitude. Planned routes and the drone icon use `mission-view.js`. The icon is enlarged for visibility, not drawn to the physical `bodyRadius` scale.

Displayed colors never replace the original `rgba` or class values in the reconstruction export. Apply the chosen color function when painting external canvases to reproduce the relevant view. Preserve image and class provenance if displaying or exporting results from your host.
