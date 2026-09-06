"""Public API and aligned-grid orchestration. All altitudes are NAVD88 meters."""
from dataclasses import dataclass, asdict
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import Affine
from rasterio.features import rasterize
from pyproj import Transformer
import shapely
from shapely import Point, box
from shapely.geometry import mapping
from shapely.ops import transform as project

from . import sources
from .legend import LEGEND
from .routing import route

CENTER = (-76.48646602014907, 42.4478926458004)
RADIUS = 4828.032
TO_UTM = Transformer.from_crs(4326, 32618, always_xy=True)
TO_LL = Transformer.from_crs(32618, 4326, always_xy=True)
ORIGIN = TO_UTM.transform(*CENTER)


@dataclass
class Config:
    resolution_m: float = 1.0
    acquisition_buffer_m: float = 50.0
    cruise_elevation_m: float | None = None
    horizontal_clearance_m: float | None = None
    vertical_clearance_m: float | None = None
    memory_budget_bytes: int = 2 * 1024**3
    cache_budget_bytes: int = 4 * 1024**3
    cache_dir: str = ".cache/ithaca"
    output_dir: str = "outputs/ithaca"
    chunk_cells: int = 32
    max_search_nodes: int = 100_000
    max_search_queue: int = 200_000
    http_timeout_s: int = 60

    def validate(self):
        for name in ("resolution_m", "memory_budget_bytes", "cache_budget_bytes", "chunk_cells",
                     "max_search_nodes", "max_search_queue", "http_timeout_s"):
            value = getattr(self, name)
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be finite and positive")
        for name in ("memory_budget_bytes", "cache_budget_bytes", "chunk_cells", "max_search_nodes", "max_search_queue"):
            if not isinstance(getattr(self, name), int):
                raise ValueError(f"{name} must be an integer")
        for name in ("acquisition_buffer_m", "horizontal_clearance_m", "vertical_clearance_m"):
            value = getattr(self, name)
            if value is not None and (not math.isfinite(value) or value < 0):
                raise ValueError(f"{name} must be finite and nonnegative")
        if self.acquisition_buffer_m is None:
            raise ValueError("acquisition_buffer_m is required")
        if self.cruise_elevation_m is not None and not math.isfinite(self.cruise_elevation_m):
            raise ValueError("cruise_elevation_m must be finite")
        if self.resolution_m > 64 or self.acquisition_buffer_m > 250:
            raise ValueError("Resolution must be <=64 m and acquisition buffer <=250 m")
        if self.horizontal_clearance_m is not None and self.horizontal_clearance_m > self.acquisition_buffer_m:
            raise ValueError("Acquisition buffer must cover horizontal clearance")


def requested_domain(corner1, corner2):
    corners = np.asarray([corner1, corner2], dtype=float)
    if corners.shape != (2, 2) or not np.isfinite(corners).all():
        raise ValueError("Domain corners must be finite (longitude, latitude) pairs")
    if (np.abs(corners[:, 0]) > 180).any() or (np.abs(corners[:, 1]) > 90).any():
        raise ValueError("Invalid longitude/latitude")
    west, south = corners.min(axis=0)
    east, north = corners.max(axis=0)
    if west == east or south == north:
        raise ValueError("Domain rectangle has zero area")
    # Clip in geographic space first so huge user rectangles cannot trigger huge
    # projection/densification work. The supported circle is an inscribed polygon
    # with <0.002 m radial approximation error.
    circle = Point(ORIGIN).buffer(RADIUS, quad_segs=1024)
    geographic_circle = project(TO_LL.transform, circle)
    clipped = box(west, south, east, north).intersection(geographic_circle)
    if clipped.is_empty or clipped.area == 0:
        raise ValueError("Requested rectangle does not intersect the supported circle")
    return project(TO_UTM.transform, shapely.segmentize(clipped, 0.0001)).intersection(circle)


def grid_for(domain, cfg):
    r = cfg.resolution_m
    n = min(cfg.chunk_cells, max(1, int(64/r)))
    tile = n*r
    xmin, ymin, xmax, ymax = domain.buffer(cfg.acquisition_buffer_m).bounds
    # Study-center anchored lattice, shared across all overlapping requests.
    c0 = math.floor((xmin-ORIGIN[0])/tile)*n
    c1 = math.ceil((xmax-ORIGIN[0])/tile)*n
    r0 = math.floor((ORIGIN[1]-ymax)/tile)*n
    r1 = math.ceil((ORIGIN[1]-ymin)/tile)*n
    transform = Affine(r, 0, ORIGIN[0]+c0*r, 0, -r, ORIGIN[1]-r0*r)
    return transform, (r1-r0, c1-c0), n


def persist(result, counts, features, directory):
    path = Path(directory)
    path.mkdir(parents=True, exist_ok=True)
    meta = result["metadata"]
    rows, cols = result["surface_valid"].shape
    if rows and cols:
        profile = dict(driver="GTiff", width=cols, height=rows, crs="EPSG:32618",
                       transform=Affine(*meta["grid_transform"]), tiled=True,
                       blockxsize=256, blockysize=256, compress="deflate", BIGTIFF="IF_SAFER")
        products = [
            ("surface.tif", "float64", [result["surface_xyz"][:, :, 2], counts],
             ["maximum_elevation_NAVD88_m", "valid_point_count"], np.nan),
            ("surface_class.tif", "uint8", [result["surface_class"]], ["original_LULC_code"], 0),
            ("masks.tif", "uint8", [result["domain_mask"], result["surface_valid"], result["no_fly_mask"]],
             ["domain", "surface_valid", "no_fly"], None),
        ]
        for filename, dtype, bands, names, nodata in products:
            with rasterio.open(path / filename, "w", **profile, count=len(bands), dtype=dtype, nodata=nodata) as dst:
                for i, (band, name) in enumerate(zip(bands, names), 1):
                    dst.set_band_description(i, name)
                    # Windowed writes avoid full-grid dtype conversion/copies.
                    for _, window in dst.block_windows(i):
                        rr, cc = window.toslices()
                        dst.write(band[rr, cc].astype(dtype), i, window=window)
                dst.update_tags(vertical_reference="NAVD88 meters (EPSG:5703)", processing_version=sources.VERSION)
    (path / "restrictions.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    np.save(path / "waypoints.npy", result["waypoints"], allow_pickle=False)
    (path / "metadata.json").write_text(json.dumps(meta, indent=2, allow_nan=False))


def find_way(domain_corner1, domain_corner2, start_point, end_point=None, *, config=None):
    """Acquire only the buffered requested area and return aligned data/candidate path.

    Inputs: longitude, latitude, NAVD88 elevation m. Outputs: cell-center x/y m
    relative to study center in EPSG:32618, z unchanged NAVD88 m. The returned
    north-up grid includes acquisition padding; domain_mask selects the requested
    rectangle/circle intersection by pixel center. Paths stay inside that geometry.
    Invalid arguments raise ValueError. Data/resource failures are reported in metadata.
    """
    cfg = Config(**config) if isinstance(config, dict) else config or Config()
    cfg.validate()
    domain = requested_domain(domain_corner1, domain_corner2)
    start_ll = np.asarray(start_point, dtype=float)
    end_ll = np.asarray(start_point if end_point is None else end_point, dtype=float)
    points = []
    for name, p in (("start", start_ll), ("end", end_ll)):
        if p.shape != (3,) or not np.isfinite(p).all() or abs(p[0]) > 180 or abs(p[1]) > 90:
            raise ValueError(f"{name} must be finite (longitude, latitude, NAVD88 altitude_m)")
        x, y = TO_UTM.transform(*p[:2])
        if not domain.covers(Point(x, y)):
            raise ValueError(f"{name} lies outside the requested supported intersection")
        points.append(np.array([x, y, p[2]], dtype=np.float64))
    transform, shape, n = grid_for(domain, cfg)
    cells = math.prod(shape)
    # Reserve native-library/stream buffers plus worst-case grid temporaries and
    # Python A* heap entries. No dependence on an assumed LiDAR point density.
    estimated = cells*96 + 512*1024**2 + cfg.max_search_queue*192
    meta = {
        "status": "initializing", "reason": "", "processing_version": sources.VERSION,
        "grid_transform": list(transform)[:6], "grid_shape": list(shape),
        "grid_orientation": "north-up; row increases south, column east; XYZ at pixel centers",
        "crs": "EPSG:32618", "input_crs": "EPSG:4326", "vertical_reference": "NAVD88 meters (EPSG:5703), GEOID12B",
        "local_origin": {"wgs84": list(CENTER), "utm_m": list(ORIGIN)},
        "resolution_m": cfg.resolution_m, "class_legend": dict(LEGEND),
        "requested_domain_wgs84": mapping(project(TO_LL.transform, domain)),
        "supported_radius_m": RADIUS, "acquisition_buffer_m": cfg.acquisition_buffer_m,
        "acquisition_tile_padding_max_m": math.sqrt(2)*n*cfg.resolution_m,
        "retrieved_at": sources.now(), "estimated_working_memory_bytes": estimated,
        "source_urls": {"lidar": sources.EPT, "lulc": sources.LULC, **sources.FAA},
        "source_dates": {"lidar": "2020-05-02/2020-05-14", "lulc": "2022 (2024 edition)",
                         "faa": "Dynamic services; queried at per-layer retrieval timestamps"},
        "config": asdict(cfg), "sources": {}, "airspace_complete": False,
        "both_faa_queries_succeeded": False, "errors": [],
        "limitations": [
            "2020 LiDAR geometry and 2022 land cover (2024 edition) are different vintages.",
            "A maximum-return height field is incomplete geometry: no volumes, wires, overhang interiors or new obstacles guaranteed.",
            "Categories describe mapped cover, not measured height; low vegetation is not necessarily turf grass.",
            "Unknown elevation remains NaN and blocks routing; class 0 is unknown cover and also blocks routing.",
            "No authorization supplied: both FAA footprint layers block all heights; no-fly false only means not blocked by loaded layers.",
            "Other TFRs, NOTAMs and airspace restrictions are outside scope; airspace is always incomplete.",
            "Routes are candidate paths through this model, not flight instructions or legal authorization.",
            "Grid-cell obstacle footprints and extra-cell square dilation conservatively exceed horizontal clearance.",
            "Circle uses an inscribed polygon (<2 mm radius error); geographic rectangle edges are densified before projection.",
            "Memory is conservatively estimated including native-library reserve; source EPT node sizes are externally controlled.",
            "Caches are single-process, versioned and never automatically evicted; FAA is never reused from cache.",
        ],
    }
    empty_shape = (0, 0)
    result = {"surface_xyz": np.empty((*empty_shape, 3), np.float32),
              "surface_valid": np.empty(empty_shape, bool), "surface_class": np.empty(empty_shape, np.uint8),
              "no_fly_mask": np.empty(empty_shape, bool), "domain_mask": np.empty(empty_shape, bool),
              "waypoints": np.empty((0, 3), np.float64), "metadata": meta}
    counts = np.empty(empty_shape, np.uint32)
    features = []
    # Refuse ambiguous mixed outputs from an earlier run; caller chooses a fresh directory.
    output = Path(cfg.output_dir)
    if output.exists() and any(output.iterdir()):
        raise ValueError("output_dir must be empty or new; choose a separate directory for each run")
    try:
        if estimated > cfg.memory_budget_bytes:
            raise sources.BudgetError(f"Estimated {estimated} bytes exceeds working-memory budget {cfg.memory_budget_bytes}; use a smaller rectangle")
        cache = sources.Cache(cfg.cache_dir, cfg.cache_budget_bytes)
        # Reserve only missing aligned chunks so a full cache can still serve hits.
        needed = 0
        acquisition = domain.buffer(cfg.acquisition_buffer_m)
        for row in range(0, shape[0], n):
            for col in range(0, shape[1], n):
                tr = transform * Affine.translation(col, row)
                if acquisition.intersects(box(tr.c, tr.f-n*tr.a, tr.c+n*tr.a, tr.f)):
                    for url, bytes_per_cell in ((sources.EPT, 8), (sources.LULC, 1)):
                        if not cache.key(url, tr, n).exists():
                            needed += n*n*bytes_per_cell + 8192
        cache.check(needed)
    except sources.BudgetError as e:
        meta.update(status="resource_budget_exceeded", reason=str(e), grid_shape=[0, 0])
        persist(result, counts, features, cfg.output_dir)
        return result
    xyz = np.empty((*shape, 3), np.float32)
    x = transform.c + (np.arange(shape[1])+0.5)*cfg.resolution_m
    y = transform.f - (np.arange(shape[0])+0.5)*cfg.resolution_m
    xyz[:, :, 0] = x[None, :] - ORIGIN[0]
    xyz[:, :, 1] = y[:, None] - ORIGIN[1]
    xyz[:, :, 2] = np.nan
    z = xyz[:, :, 2]
    counts = np.zeros(shape, np.uint32)
    classes = np.zeros(shape, np.uint8)
    mask = np.zeros(shape, bool)
    for row in range(0, shape[0], n):
        mask[row:row+n] = shapely.intersects_xy(domain, x[None, :], y[row:row+n, None])
    nofly = np.zeros(shape, bool)
    result.update(surface_xyz=xyz, surface_valid=np.zeros(shape, bool), surface_class=classes,
                  no_fly_mask=nofly, domain_mask=mask)
    acquisition = domain.buffer(cfg.acquisition_buffer_m)
    envelopes = rasterio.warp.transform_bounds("EPSG:32618", "EPSG:4326", transform.c,
        transform.f-shape[0]*cfg.resolution_m, transform.c+shape[1]*cfg.resolution_m, transform.f, densify_pts=21)
    for name in sources.FAA:
        fs, info = sources.query_faa(name, envelopes, cfg.http_timeout_s, min(16*1024**2, cfg.memory_budget_bytes//64))
        features.extend(fs)
        meta["sources"][name] = info
    meta["both_faa_queries_succeeded"] = all(meta["sources"][name]["succeeded"] for name in sources.FAA)
    geoms = [project(TO_UTM.transform, shapely.geometry.shape(f["geometry"])) for f in features]
    if geoms:
        # all_touched conservatively includes footprint edges and slivers.
        nofly[:] = rasterize([(g, 1) for g in geoms], out_shape=shape, transform=transform,
                              all_touched=True, dtype="uint8").astype(bool)
    meta["sources"]["lidar"] = {"url": sources.EPT, "date": "2020-05-02/2020-05-14",
        "metadata_url": "https://www.fisheries.noaa.gov/inport/item/67099", "excluded_classes": [7, 18, 20],
        "exclude_withheld": True, "chunks": []}
    meta["sources"]["lulc"] = {"url": sources.LULC, "date": "2022", "edition": "2024",
        "catalog_url": "https://www.sciencebase.gov/catalog/item/68011bedd4be0263cab0ffb5",
        "legend_url": sources.GUIDE, "chunks": []}
    stopped = False
    disabled = set()
    for row in range(0, shape[0], n):
        for col in range(0, shape[1], n):
            tr = transform * Affine.translation(col, row)
            if not acquisition.intersects(box(tr.c, tr.f-n*tr.a, tr.c+n*tr.a, tr.f)):
                continue
            for name in ("lidar", "lulc"):
                if name in disabled:
                    continue
                record = {"row": row, "col": col, "transform": list(tr)[:6]}
                try:
                    if name == "lidar":
                        zz, cc, stamp = sources.lidar_chunk(tr, n, cache)
                        z[row:row+n, col:col+n] = zz
                        counts[row:row+n, col:col+n] = cc
                    else:
                        labels, stamp, access = sources.class_chunk(tr, n, cache, cfg.http_timeout_s, 32*1024**2)
                        classes[row:row+n, col:col+n] = labels
                        record["access"] = access
                    record["retrieved_at"] = stamp
                    record["succeeded"] = True
                except Exception as e:
                    record.update(succeeded=False, error=f"{type(e).__name__}: {e}")
                    meta["errors"].append({"source": name, **record})
                    # Stop repeated failures for that endpoint while retaining all
                    # successful chunks and continuing the other fixed source.
                    disabled.add(name)
                    stopped |= isinstance(e, sources.BudgetError)
                meta["sources"][name]["chunks"].append(record)
    result["surface_valid"][:] = np.isfinite(z)
    for code in np.unique(classes):
        if str(int(code)) not in meta["class_legend"]:
            meta["class_legend"][str(int(code))] = "Unlisted original source code; see source guide"
    configured = all(getattr(cfg, name) is not None for name in
                     ("cruise_elevation_m", "horizontal_clearance_m", "vertical_clearance_m"))
    if stopped:
        status, reason = "resource_budget_exceeded", "Acquisition reached budget; successful chunks retained"
    elif not configured:
        status, reason = "routing_not_configured", "Supply cruise_elevation_m, horizontal_clearance_m and vertical_clearance_m"
    elif not meta["both_faa_queries_succeeded"]:
        status, reason = "airspace_query_failed", "At least one fresh FAA query failed; no route permitted"
    else:
        # Surface categories remain independent in returned arrays. Unknown cover
        # is blocked for planning without changing measured elevations.
        planning_z = z.copy()
        planning_z[classes == 0] = np.nan
        waypoints, status, reason = route(*points, planning_z, nofly, mask, transform, domain, cfg)
        waypoints[:, :2] -= ORIGIN
        result["waypoints"] = waypoints
    meta.update(status=status, reason=reason, cache_used_bytes=cache.used,
                valid_surface_cells=int(np.count_nonzero(result["surface_valid"])),
                domain_cells=int(np.count_nonzero(mask)), point_count_total=int(counts.sum(dtype=np.uint64)))
    persist(result, counts, features, cfg.output_dir)
    return result
