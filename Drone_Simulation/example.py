"""One approximately 80 x 80 m real-data request at the selected Ithaca study center."""
import argparse
import json
from pathlib import Path
import numpy as np
import rasterio
from ithaca_geo import Config, find_way
from ithaca_geo.core import CENTER


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="outputs/example")
    parser.add_argument("--cache", default=".cache/ithaca")
    args = parser.parse_args()
    lon, lat = CENTER
    result = find_way((lon-.00048, lat-.00036), (lon+.00048, lat+.00036),
                      (lon-.00020, lat, 300.0), (lon+.00020, lat, 300.0),
                      config=Config(output_dir=args.output, cache_dir=args.cache, chunk_cells=64,
                                    cruise_elevation_m=310.0, horizontal_clearance_m=2.0,
                                    vertical_clearance_m=5.0))
    meta = result["metadata"]
    shape = result["surface_valid"].shape
    assert result["surface_xyz"].shape == (*shape, 3)
    assert all(result[k].shape == shape for k in ("surface_class", "no_fly_mask", "domain_mask"))
    assert np.array_equal(np.isfinite(result["surface_xyz"][:, :, 2]), result["surface_valid"])
    assert result["waypoints"].shape[1] == 3
    assert meta["airspace_complete"] is False
    if all(shape):
        for name in ("surface.tif", "surface_class.tif", "masks.tif"):
            with rasterio.open(Path(args.output) / name) as src:
                assert src.shape == shape and src.crs.to_epsg() == 32618
                assert list(src.transform)[:6] == meta["grid_transform"]
        with rasterio.open(Path(args.output) / "surface_class.tif") as src:
            assert np.array_equal(src.read(1), result["surface_class"])
        with rasterio.open(Path(args.output) / "surface.tif") as src:
            assert np.array_equal(src.read(1), result["surface_xyz"][:, :, 2], equal_nan=True)
            assert int(src.read(2).sum()) == meta["point_count_total"]
    print(json.dumps({"status": meta["status"], "reason": meta["reason"], "shape": shape,
                      "valid_surface_cells": meta.get("valid_surface_cells", 0),
                      "point_count_total": meta.get("point_count_total", 0),
                      "class_codes": np.unique(result["surface_class"]).tolist(),
                      "faa_queries": {k: v for k, v in meta["sources"].items()
                                      if k in ("national_security", "facility_maps")},
                      "errors": meta["errors"], "output": args.output}, indent=2))


if __name__ == "__main__":
    main()
