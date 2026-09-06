# Verified 2023 texture

Source: [NYS ITS spring 2023 orthoimagery service](https://orthos.its.ny.gov/arcgis/rest/services/wms/2023/MapServer), also listed in the [Tompkins County imagery downloads](https://gis.ny.gov/tompkins-county-orthoimagery-downloads). Credit: NYS ITS. Access information: [NYS orthoimagery FAQs](https://gis.ny.gov/orthoimagery-faqs).

Current study center: latitude 42.4478926458004, longitude -76.48646602014907. The 512 × 512 m crop was downloaded and visually inspected on 2026-09-05. SHA-256: `95602b95a1ea6a07d5eef95dfcec05306ab8a466d685ab335c63b16b2aca0750`.

Map export: `/export`, `bbox=377504.2293770153,4700321.510997841,378016.2293770153,4700833.510997841`, `bboxSR=32618`, `imageSR=32618`, `size=2048,2048`, `format=jpg`, `f=pjson`. Returned extent matches the terrain. North is image top. JPEG size: 951,611 bytes. Export sampling is 0.25 m/pixel, not a claim of native source accuracy.

Source pixels are unchanged. Display saturation/contrast and exposure are adjusted by the material. Outer cut faces use decorative pixelated grass/dirt/stone bands with hard boundaries and subtle square color variation. These are illustrative sides, not measured geological strata. Top faces retain aerial detail. No heights or geometry are modified by shading.

Outer-cut correction: removed roof-relative grass/dirt bands because surface elevations include buildings and canopy. Tall perimeter faces now have uniform neutral coloring with subtle pixel variation. Stronger decorative stone blocks appear only on the existing 3 m display base. Aerial tops, internal sides, measured geometry and data files are unchanged.

Current color treatment: original LULC classes select lawn green, forest green, slate/limestone roofs, warm-stone walls, neutral pavement and blue water. Aerial luminance retains top-surface detail; these are display colors, not literal material identification. Canopy-over-structure codes remain vegetation. Side coloring fades within 0.8 m for ground classes, 4 m for trees and 8 m for structures; these are visual bands, not measured object heights. The perimeter rim is limited to 0.8 m, with a neutral face below. All persisted source arrays and manifest are byte-for-byte unchanged.
