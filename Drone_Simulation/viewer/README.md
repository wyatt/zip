# Ithaca terrain mission viewer

This Vite/Three.js viewer opens the complete 5 km × 5 km region as a north-up planning map. The map and 3D view use the same terrain, lighting, and color material, so switching cameras does not change the appearance.

Users configure one of three simulated missions entirely in 2D:

- **Deliver:** choose A and B; fly A → B, deliver, and return to A.
- **Inspect:** choose A and draw an irregular polygon; fly coverage and create a north-up 2D mosaic.
- **Search:** choose A and draw an irregular polygon; find a hidden simulated target and report its coordinates.

The 3D view stays locked until a valid plan exists. Coarse whole-region A* runs in a Web Worker. Detailed maximum-return terrain loads independently around the planned route for altitude, clearance, and climb/descent validation. The renderer starts with the 25 m overview and streams visible 5 m or 1 m tiles into a bounded cache.

From the repository root:

```sh
npm --prefix viewer ci
npm --prefix viewer run dev -- --port 5174
npm --prefix viewer test
npm --prefix viewer run build
```

The regional browser package is generated with:

```sh
python viewer/tools/acquire_region.py --workers 2
```

It stores 1 m source data outside the browser package and writes per-tile 5 cm precision `uint16` heights, byte land-cover classes, and a bit-packed measured mask in one gzip payload. Orthophotos remain separately loadable. Missing values retain their measured status.

See [simulation_docs.md](../simulation_docs.md) for the website adapter, configuration schemas, events, polygon rules, planner behavior, and mosaic format. This remains an offline simulation: it does not control a physical drone, certify airspace, or emit a flight-ready route.
