# Local landscape viewer

For simulator embedding, drone configuration, and external mosaic rendering, start with [simulation_docs.md](../simulation_docs.md).

**Current Map mode:** a directly overhead camera view of the same 3D landscape, with identical geometry, lighting, colors, and annotation elevations throughout the camera transition. Neither `study-map.js` nor legacy `basemap.js` is active. The Rooftop mosaic remains a separate capture-driven canvas. This supersedes historical map descriptions below.

**Inspection animation:** click **Start simulation** for a two-part survey with live battery returns, charging, and resume. Travel runs at 10×; survey runs at 70× and charging at 140×. Returns target at least 10% battery on arrival at the charger. Defaults are 5 m/s, 46.5-minute endurance, and 20-minute empty-to-full charging, editable before starting. See [mission behavior, assumptions, and tests](MISSION.md).

Current center: **42.4478926458004, -76.48646602014907**. Terrain and classes were reacquired into `outputs/east-study-512`; the exact 512 × 512 m extent has a matching 2023 image.

From the repository root:

```sh
npm --prefix viewer ci
npm --prefix viewer run dev -- --port 5173
```

Open http://127.0.0.1:5173. The viewer starts as a north-up map: drag to pan and scroll/pinch to zoom. Click **3D view** for a smooth 900 ms camera transition into the model; click **Map** to return. Switching preserves the map center, zoom and sample points. In 3D, drag to orbit and right-drag to pan. Reduced-motion preferences switch views immediately. Arrow keys pan when the canvas has focus. The large title and point-measurement panels remain hidden. Start/End labels are visible in both modes; click either label, then a measured location to move it. Escape cancels. These are visual sample locations, not validated route endpoints. Reset restores the initial points and fits the entire domain.

This is a static Three.js viewer with Vite for development/build only: no backend, framework, or additional LiDAR acquisition. The optional inspection simulation computes waypoints locally. The map view now uses live labeled OpenStreetMap street tiles, reprojected from Web Mercator to UTM 18N using Proj4js. It requires internet access. Visible attribution remains on screen; tiles use normal browser HTTP caching, with no offline download or prefetch. Only visible viewport tiles are loaded (at most 64 in GPU memory); the 3D mode stops requesting tiles. The 2D basemap is clipped to the exact rectangular 3D model footprint, with mutually exclusive surfaces during transitions. Only tiles intersecting that footprint and the visible viewport are requested. The surrounding area stays blank, making the shared extent explicit. Road/place labels come from OpenStreetMap, independently of the older LiDAR/LULC sources. See the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) before production use; the community tile service is best-effort and may need replacing with a production tile service for higher traffic. It reuses the full 512 × 512 m acquired extent, including the previous request's buffer. The initial two measured cell centers are exactly 100 m apart horizontally. Pins attach to measured surface elevations in 3D.

Original 1 m elevations are rendered as instanced height-field columns, with no interpolation or vertical exaggeration. Column sides extend to a display baseline (minimum elevation minus 3 m); they are a visual convention, not measured walls or reconstructed solid obstacles. Missing heights have no column and show the dark backing. The verified spring 2023 NYS orthophoto supplies photographic color. Its 2048 × 2048 pixels cover the exact 512 m crop; top faces retain sub-cell image detail and internal vertical sides use a subdued cell-center color; the four outer cut faces use pixelated grass/dirt/stone bands. It does not reconstruct facades. Hover still shows the original detailed LULC class/code and NAVD88 elevation. Image date and geometry date differ (2023 versus 2020), so changed buildings and tree cover can disagree. The texture adds about 929 KiB and no dependency. See [texture provenance](assets/README.md) and [height-data research](HEIGHT_DATA_RESEARCH.md).

Data is 1.5 MiB of binary arrays plus a small manifest. Source rasters and Python processing are unchanged. The renderer uses one instanced terrain mesh, bounded pixel ratio, cached shadows, and on-demand frames (continuous frames only during camera transitions or an active mission). It explicitly releases its controls, event listeners and GPU resources when disposed.

To regenerate the viewer's data after processing another small area:

```sh
# With the geospatial conda environment active:
python viewer/export_data.py --source outputs/east-study-512
```

The included photo is registered to this study crop. Another extent requires matching imagery; the viewer rejects a mismatched crop rather than stretching this photo onto it. The exporter reads aligned GeoTIFFs and fails above 512 × 512 cells. It writes float32 little-endian elevation, uint8 original classes, and bit flags (bit 0 measured, bit 1 FAA blocked). No dense XYZ JSON is generated. All samples must be finite. The data manifest includes source dates, coordinate origin, CRS and FAA freshness/completeness information.

For your existing website, reuse `landscape.js`, `basemap.js`, `photo-material.js`, `assets/ithaca-2023.jpg` and the four files in `public/data/`; the surrounding UI is separate. Install the pinned Three.js and Proj4js dependencies in that website's bundler:

```js
import { createLandscape } from './landscape.js';
const view = await createLandscape(containerElement, {
  dataUrl: '/my-landscape-data/',
  onChange: ({ distance, points }) => { /* update your interface */ },
});
// view.select(0 | 1), view.setView('orbit' | 'top'), view.reset()
// When the component unmounts:
view.dispose();
```

Give the container explicit width/height. `onProject` optionally reports screen positions for A/B labels; `onHover` reports class and elevation. `npm --prefix viewer run build` creates a portable static `viewer/dist/` with relative asset paths, ready to serve under a subdirectory. Nothing is deployed.

Verification: production build and aligned binary export checks pass. Browser automation was unavailable in the development session, so visual/interaction inspection is not claimed.

Map mode uses an opaque backing while street tiles load and hides the aerial terrain. During the smooth camera transition only the 3D surface is visible; the map appears when its top-down camera settles. Late tile callbacks cannot reveal the map in 3D. Default/reset camera framing fits the complete model bounds in portrait and landscape. Geometry, data structures and source buffers are unchanged by these UI fixes.

The expanded crop remains centered at the same coordinate with 1 m cells. The previous 256 m products are retained in `outputs/green-study`. The material adds modest saturation/contrast, lower lighting exposure, and blocky perimeter bands; it does not alter the orthophoto file, data schema, or measured geometry.

Outer-cut correction: removed roof-relative grass/dirt bands because surface elevations include buildings and canopy. Tall perimeter faces now have uniform neutral coloring with subtle pixel variation. Stronger decorative stone blocks appear only on the existing 3 m display base. Aerial tops, internal sides, measured geometry and data files are unchanged.

Current color treatment: original LULC classes select lawn green, forest green, slate/limestone roofs, warm-stone walls, neutral pavement and blue water. Aerial luminance retains top-surface detail; these are display colors, not literal material identification. Canopy-over-structure codes remain vegetation. Side coloring fades within 0.8 m for ground classes, 4 m for trees and 8 m for structures; these are visual bands, not measured object heights. The perimeter rim is limited to 0.8 m, with a neutral face below. All persisted source arrays and manifest are byte-for-byte unchanged.

Building wall update: structures retain the same warm-stone wall color throughout each column, darkening by at most 10% toward its base. The earlier 8 m building-color fade is removed. Other cover types and the neutral outer cut treatment are unchanged.

Roof-edge wall styling: a display-only mask gives cells within 3 m of an original structure cell and within 2 m of its surface elevation the same warm wall material. This repairs narrow land-cover mismatches along roofs without recoloring top faces or editing classes/heights. It is a visual heuristic, not a new building classification. Water and missing cells are excluded. Include `wall-style.js` when embedding the viewer.

Inspection setup: `inspection.js` stores the user-selected local offsets: Start E 27.5 / N −19.5 m; coverage west −246.5, east −110.5, south −244.5, north 140.5 m. The coverage rectangle is 136 × 385 m (52,360 m²), inside the unchanged 512 m dataset. Map view shows a tinted rectangle; 3D shows a boundary sampled on the measured surface, with gaps where measurements are absent. These mark the inspection area only, not flight waypoints or a validated inspection route. The unrelated End marker is hidden; Reset restores the requested Start. Original data schemas and buffers remain unchanged.

Current building material: neutral gray (#a5a8aa) for structure tops and building-styled walls. No photographic roof modulation or vertical wall-color fade; scene lighting/shadows still shade faces. Geometry and source data are unchanged.

Roof display repair: `roof-display.js` estimates only enclosed missing structure patches of at most 9 cells, with at least 6 measured structure neighbors fitting a local plane within 0.6 m residual. It rejects domain-edge gaps, steep/inconsistent support and extrapolation beyond nearby elevations. Current crop: 98 visual cells filled; all 260,594 measured cells preserved exactly. Larger/unsupported gaps remain. Hover identifies estimated fills; they cannot be selected as Start. Original elevation/class/flag files and routing inputs remain unchanged. Include this module when embedding.

All-gap display repair supersedes the earlier roof-only plane repair: every missing height is now averaged from original measured cells in a 3 × 3 neighborhood, expanded to 5 × 5, 9 × 9, etc. only when fewer than four samples are available. This also handles boundary cells and large gaps. No estimate is reused as an averaging input. All measured samples, persisted arrays, source flags and routing inputs remain unchanged. Hover labels fills as estimated nearby-cell averages; filled cells remain unavailable for selecting a measured Start.

The inspection target is now a translucent yellow rectangle without an outline. In 3D it hovers 11 m above the dataset maximum surface height; in map mode it sits above the map. Bounds are unchanged. Its elevation is solely a visual offset, not an inspection flight altitude.
