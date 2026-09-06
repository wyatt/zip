# Ithaca elevation and building-height research

Research checked 2026-09-05. Only the verified 2023 photo material was implemented. The Python data structures, GeoTIFFs, viewer arrays/manifest, instanced-column geometry, labeled 2D map and camera transition remain unchanged.

## What is actually available here

**The latest NYS published survey at the study center is already our source.** A spatial query of the official [Latest LiDAR Collections service](https://elevation.its.ny.gov/arcgis/rest/services/indexes/Latest_LiDAR_Collections/FeatureServer/0) at longitude -76.499, latitude 42.443 returned only `Central Finger Lakes 2020`, `LATEST=Yes`, nominal spacing 0.7 m, DEM resolution 1 m. This establishes what the state index lists; it does not rule out unpublished county, university or commercial surveys. [NYS download portal and survey catalog](https://gis.ny.gov/node/171).

The [NOAA/USGS source metadata](https://www.fisheries.noaa.gov/inport/item/67099) reports tested aggregate spacing 0.53 m and density 3.6, plus rooftop dropouts on low-reflectivity materials. Acquisition was May 2020. The published classifications include ground and unclassified points but no separate building class 6. Consequently, filtering this source for class 6 would not recover its roofs. Ground accuracy statistics are not a guarantee of roof-edge accuracy.

The current pipeline already reads full-density bounded EPT points without requesting a coarser EPT level. Downloading the original LAZ can help audit classifications and datum handling, but those files are the source of the EPT and do not inherently provide additional observations. The current crop contains 205,513 retained returns over 65,536 square meters. A 0.5 m grid has four times as many cells as the current 1 m grid; it cannot manufacture missing roof samples.

**Building footprints are available, measured heights were not found in the inspected service.** The [Tompkins footprint layer hosted by FEMA Region 2](https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Building_Footprints/FeatureServer/0) has IDs, area, coordinates and flood-study attributes, but no roof elevation or height field. Footprints can help locate roofs for QA; they cannot supply heights by themselves. Publication/update dates are not necessarily measurement dates.

**A concrete commercial lead is Nearmap.** Its [DSM and True Ortho API](https://developer.nearmap.com/reference/dsm-and-true-ortho-api-1) provides surface elevation GeoTIFFs and a coverage query by area; its [3D exports](https://help.nearmap.com/kb/articles/740-3d-export-formats) include point clouds and DSMs. These are photogrammetric products, not additional LiDAR returns. Ithaca 3D coverage, capture date, native resolution, accuracy, datum and licensing remain unverified; a coverage check and sample are needed before purchase. No account, purchase or integration was created. A DSM could be converted offline to the existing output only after its measurement and missing-data semantics are validated.

## Recommended acquisition path, preserving this viewer

1. Ask Tompkins County GIS and Cornell's GIS/data stewards whether a newer, denser classified LAS/LAZ survey or measured roof-elevation dataset covers this exact crop. Request acquisition date, ground/roof classifications, point density, vertical datum, units, roof completeness and reuse terms. No messages have been sent.
2. If none exists, obtain a bounded high-density aerial/drone LiDAR survey or an existing licensed surface-model extract. As a procurement target, ask for at least 8–16 usable roof returns per square meter for a potential 0.5 m grid, then judge actual roof coverage; density alone is not an accuracy guarantee. This is a suggested target, not confirmed local availability.
3. Feed approved measured points into the existing rasterization/export path. Keep maximum measured surface elevation as NAVD88 meters and preserve missing cells. The existing schema and column renderer can support a finer grid within their size limit; no polygon extrusion engine or new 3D format is needed. Do not substitute a bare-earth DEM for the surface: that would remove roofs and trees.

Absolute roof elevation and building height above ground are different quantities. Building height requires trustworthy ground elevation near/beneath the building as well as roof observations. Replacing the current elevation array with roof-minus-ground would change its meaning. Keep any such investigation offline unless a separate output is explicitly requested. An orthophoto improves color but supplies no measured Z; the 2023 photo and 2020 geometry can differ where structures changed.

## Projects worth studying

| Project | What to learn | Fit to this task |
| --- | --- | --- |
| [Felix Palmer: Procedural GL JS](https://github.com/felixpalmer/procedural-gl-js), [demo](https://www.procedural.eu/map) | Terrain with raster imagery, restrained overlays and mobile-oriented controls | Strong reference for aerial color and navigation; its terrain/LOD engine is not being adopted. |
| [sigon426: 3D cities](https://sigon426.github.io/3D_cities/) | Spanish IGN elevation and orthophotos combined with OSM buildings in Three.js/Qgis2threejs | Especially relevant visual comparison for photographed terrain with buildings. Source quality still determines height quality. |
| [Anchit Jain: Manhattan 3D](https://github.com/anchitjaincfa/manhattan-3d) | Tens of thousands of NYC footprints in a compact Three.js scene with one merged building draw call | Useful efficiency reference. Its vector geometry and fallback heights are not appropriate replacements for measured columns. |

These are references reviewed through their published project pages and documentation, not performance benchmarks from a live browser session. The common transferable lesson is accurate registration, suitable imagery and restrained rendering; none requires changing this project's visualization method.

## Verification of the texture change

Production build passed. Existing elevation, class, flag and manifest SHA-256 checks all passed unchanged. Shader insertion and north-up texture-coordinate checks passed. Localhost returned HTTP 200. Browser automation was unavailable, so actual GPU rendering and interaction were not visually verified in this session.
