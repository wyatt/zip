# Ithaca geospatial candidate routing

For simulator embedding, drone configuration, and external mosaic rendering, start with [simulation_docs.md](simulation_docs.md).

A small fixed-source Python module. Install and run:

```sh
conda env create -f environment.yml
conda activate ithaca-geo
python example.py --output outputs/example
python -m unittest discover -s tests -v
```

The example requests approximately **80 × 80 m** around the selected Ithaca study center, with a 50 m buffer and 1 m cells. Each run requires a new or empty output directory.

```python
from ithaca_geo import Config, find_way

result = find_way(
    (-76.49948, 42.44264), (-76.49852, 42.44336),
    (-76.49920, 42.44300, 300.0),
    (-76.49880, 42.44300, 300.0),
    config=Config(cruise_elevation_m=310.0,
                  horizontal_clearance_m=2.0,
                  vertical_clearance_m=5.0,
                  output_dir="outputs/my-request"),
)
print(result["metadata"]["status"], result["metadata"]["reason"])
```

`config` also accepts a dictionary. Omit any routing parameter to return data with `routing_not_configured`. `end_point=None` means start=end; a stationary candidate returns one validated waypoint. Invalid coordinates/configuration, endpoints outside the supported intersection, and nonempty output directories raise `ValueError` before acquisition.

**Coordinates.** Input corners are WGS84 `(longitude, latitude)`; endpoints add **NAVD88 elevation in meters**, never height above ground. The domain is the rectangle intersected with the 4828.032 m circle centered at `(-76.48646602014907, 42.4478926458004)`. Horizontal calculations use EPSG:32618. Returned x/y are pixel centers in meters **relative to the projected study center**; z stays NAVD88. Raster transforms use absolute UTM. Add `metadata.local_origin.utm_m` to waypoint x/y for GIS placement.

The north-up grid includes acquisition padding; `domain_mask` selects centers in the requested intersection. Rows increase south, columns east. Tiles share a study-center-anchored lattice, adding at most their diagonal beyond the buffer. `surface_xyz` is float32 `(rows, cols, 3)`; missing z is NaN. `surface_class` is uint8, original codes, 0 unknown. All three masks are bool. Waypoints are float64 `(n, 3)`, empty `(0, 3)` on failure.

**Data.** Full-density PDAL EPT bounds are expressed in EPSG:3857 before horizontal reprojection. Sequential streaming chunks retain maximum elevation and point counts, excluding withheld points and documented classes 7, 18, 20. Unclassified/above-ground returns remain; there is no interpolation. Native LULC windows use nearest-neighbor alignment. All 56 detailed categories remain independent of height, including canopy-over-structures (24), turf grass (27), and other low vegetation.

Only these deliverables are saved:

| File | Contents |
|---|---|
| `surface.tif` | Tiled compressed elevation and point-count bands. Float64 storage preserves uint32 counts exactly alongside NaN; returned elevations are float32. |
| `surface_class.tif` | Original uint8 codes; 0 unknown. |
| `masks.tif` | Domain, surface-valid, no-fly bands, 0/1 with no nodata value. |
| `restrictions.geojson` | WGS84 footprints, original `attributes`, policy reasons, sources and timestamps. |
| `waypoints.npy` | Candidate or empty array. |
| `metadata.json` | Status/reason, coordinates, legend, dates, chunk provenance, errors and limitations. |

**Budgets/cache.** Defaults: 2 GiB working-memory estimate, 4 GiB cache, 32-cell chunks (physical side capped at 64 m), 100,000 search expansions, 200,000 queue entries. Configure these through `Config`. Preflight reserves 96 bytes/grid cell, 192 bytes/queue entry and 512 MiB native/streaming overhead; oversized requests stop. Native raster windows and FAA responses are separately bounded. This estimate is not an OS-enforced RSS cap; EPT node sizes/native allocations are externally controlled. Coarsening never thins LiDAR.

Processed cache keys include source, resolution, coordinates, shape and processing version. Overlaps reuse chunks with original retrieval times. Cache writes are atomic; use one process per cache; there is no eviction. Failed HTTP windows permit only the specified county COG fallback, capped at 100 MiB compressed, still read in windows. FAA is refreshed every run. Resource failure before allocation returns empty arrays plus metadata/GeoJSON/waypoints, since zero-size GeoTIFFs are invalid. Later failures retain successful data.

**Routing/limitations.** A* uses constant cruise elevation, vertical endpoint connections and adjacent cell centers. Unknown elevation/cover, obstacles, out-of-domain cells and FAA masks block routing. Conservative square dilation includes horizontal clearance plus an extra cell; diagonal corner-cutting is forbidden. Complete segments, touched cell edges/corners and vertical connections are validated. Search limits return `search_budget_exhausted`.

Both fresh FAA queries must succeed. Both footprint layers block all heights under **no authorization supplied**. False no-fly means only “not blocked by these loaded layers”; `airspace_complete` is always false. Other TFRs/NOTAMs/restrictions are outside scope. Geometry is 2020; cover is 2022, 2024 edition. A height field cannot fully represent volumes, wires, overhangs or new obstacles. Routes are model candidates, not flight instructions or authorization.

**Verified:** automated tests cover alignment, original categories, peaks/noise, NaNs, complete segments, clearance, search limits, pagination and retained outputs after FAA failure. The real example in `outputs/real-example` acquired a 256 × 256 m grid, 205,513 retained points, 64,562 valid cells and 13 LULC codes using HTTP windows. Both FAA queries succeeded; two Facility Map footprints cover the requested domain, correctly yielding an empty route under this policy.

Fixed references: [LiDAR metadata](https://www.fisheries.noaa.gov/inport/item/67099), [bounded PDAL pattern](https://github.com/OpenTopography/OT_3DEP_Workflows/blob/main/notebooks/01_3DEP_Generate_DEM_User_AOI.ipynb), [LULC catalog](https://www.sciencebase.gov/catalog/item/68011bedd4be0263cab0ffb5), [class guide](https://cicwebresources.blob.core.windows.net/docs/ScienceBase_UserGuide_2024ed%20.pdf). Acquisition URLs are fixed in `ithaca_geo/sources.py` and run metadata.
