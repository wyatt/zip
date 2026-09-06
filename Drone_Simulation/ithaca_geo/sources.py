"""The four fixed data sources. No provider selection or stale FAA fallback."""
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds
import requests
from shapely.geometry import shape, mapping

VERSION = "ithaca-1"
EPT = "https://s3-us-west-2.amazonaws.com/usgs-lidar-public/NY_FingerLakes_1_2020/ept.json"
LULC = "https://prod-is-usgs-sb-prod-publish.s3.amazonaws.com/68011bedd4be0263cab0ffb5/tomp_36109_lulc_2022_2024-Edition.tif"
GUIDE = "https://cicwebresources.blob.core.windows.net/docs/ScienceBase_UserGuide_2024ed%20.pdf"
FAA = {
    "national_security": "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/DoD_Mar_13/FeatureServer/0",
    "facility_maps": "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/FAA_UAS_FacilityMap_Data/FeatureServer/0",
}


def now():
    return datetime.now(timezone.utc).isoformat()


class BudgetError(RuntimeError):
    pass


class Cache:
    """Single-process cache; never evicts. Atomic chunk commits; failures are not cached."""
    def __init__(self, root, limit):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.limit = limit
        self.used = sum(p.stat().st_size for p in self.root.rglob("*") if p.is_file())
        self.check(0)

    def check(self, extra):
        if self.used + extra > self.limit:
            raise BudgetError(f"Cache budget exceeded: {self.used} + {extra} > {self.limit} bytes; no eviction")

    def key(self, source, transform, size):
        payload = [VERSION, source, "EPSG:32618", list(transform)[:6], size]
        return self.root / (hashlib.sha256(json.dumps(payload).encode()).hexdigest() + ".npz")

    def put(self, path, **arrays):
        self.check(sum(a.nbytes for a in arrays.values()) + 8192)
        tmp = path.with_suffix(".part")
        try:
            with tmp.open("wb") as f:
                np.savez_compressed(f, **arrays)
            self.check(tmp.stat().st_size)
            self.used += tmp.stat().st_size
            tmp.replace(path)
        finally:
            tmp.unlink(missing_ok=True)


def aggregate(points, elevation, counts, transform):
    """Max of every valid return in half-open grid cells; no interpolation."""
    ok = (np.isfinite(points["X"]) & np.isfinite(points["Y"]) &
          np.isfinite(points["Z"]) & (points["Withheld"] == 0) &
          ~np.isin(points["Classification"], [7, 18, 20]))
    p = points[ok]
    c = np.floor((p["X"] - transform.c) / transform.a).astype(np.int64)
    r = np.floor((transform.f - p["Y"]) / -transform.e).astype(np.int64)
    inside = (r >= 0) & (c >= 0) & (r < counts.shape[0]) & (c < counts.shape[1])
    r, c = r[inside], c[inside]
    # fmax treats an initial NaN as missing, preserving even negative elevations.
    np.fmax.at(elevation, (r, c), p["Z"][inside])
    np.add.at(counts, (r, c), np.uint32(1))


def lidar_chunk(transform, size, cache):
    path = cache.key(EPT, transform, size)
    if path.exists():
        with np.load(path, allow_pickle=False) as a:
            return a["z"], a["counts"], str(a["retrieved_at"])
    import pdal
    bounds = (transform.c, transform.f - size * transform.a,
              transform.c + size * transform.a, transform.f)
    b = transform_bounds("EPSG:32618", "EPSG:3857", *bounds, densify_pts=21)
    pipeline = pdal.Pipeline(json.dumps([
        {"type": "readers.ept", "filename": EPT,
         "bounds": f"([{b[0]-0.01},{b[2]+0.01}],[{b[1]-0.01},{b[3]+0.01}])",
         "requests": 1},  # Omit resolution: retain full source density.
        {"type": "filters.reprojection", "in_srs": "EPSG:3857", "out_srs": "EPSG:32618"},
    ]))
    z = np.full((size, size), np.nan, dtype=np.float32)
    counts = np.zeros((size, size), dtype=np.uint32)
    for points in pipeline.iterator(chunk_size=65536, prefetch=0):
        aggregate(points, z, counts, transform)
    stamp = now()
    cache.put(path, z=z, counts=counts, retrieved_at=np.asarray(stamp))
    return z, counts, stamp


def download_county(cache, timeout):
    path = cache.root / "tomp_36109_lulc_2022_2024-Edition.tif"
    stamp_path = path.with_suffix(".json")
    if path.exists() and stamp_path.exists():
        return path, json.loads(stamp_path.read_text())["retrieved_at"]
    cap = 100 * 1024**2  # Only the specified approximately 82 MB compressed county file.
    cache.check(cap + 4096)
    temp = path.with_suffix(".part")
    try:
        with requests.get(LULC, stream=True, timeout=timeout) as response:
            response.raise_for_status()
            if int(response.headers.get("Content-Length", 0)) > cap:
                raise BudgetError("County COG exceeds the 100 MiB fallback download cap")
            size = 0
            with temp.open("wb") as f:
                for part in response.iter_content(1024 * 1024):
                    size += len(part)
                    if size > cap:
                        raise BudgetError("County COG exceeded fallback download cap")
                    f.write(part)
        stamp = now()
        temp.replace(path)
        stamp_path.write_text(json.dumps({"url": LULC, "retrieved_at": stamp}))
        cache.used += path.stat().st_size + stamp_path.stat().st_size
        return path, stamp
    finally:
        temp.unlink(missing_ok=True)


def read_categories(source, transform, size, max_window_bytes):
    """Read an explicit native-resolution window; never read the entire raster."""
    with rasterio.Env(GDAL_CACHEMAX=32*1024**2), rasterio.open(source) as src:
        bounds = (transform.c, transform.f - size * transform.a,
                  transform.c + size * transform.a, transform.f)
        b = transform_bounds("EPSG:32618", src.crs, *bounds, densify_pts=21)
        w = from_bounds(*b, transform=src.transform)
        left, top = math.floor(w.col_off) - 2, math.floor(w.row_off) - 2
        right, bottom = math.ceil(w.col_off + w.width) + 2, math.ceil(w.row_off + w.height) + 2
        left, top = max(0, left), max(0, top)
        right, bottom = min(src.width, right), min(src.height, bottom)
        dst = np.zeros((size, size), np.uint8)
        if right <= left or bottom <= top:
            return dst
        # Account for masked-array and warp copies, not just compressed bytes.
        if (right-left) * (bottom-top) * 16 > max_window_bytes:
            raise BudgetError("Native LULC window exceeds intermediate memory budget")
        w = Window(left, top, right-left, bottom-top)
        data = src.read(1, window=w, masked=True).filled(0)
        if data.min() < 0 or data.max() > 255:
            raise ValueError("LULC codes cannot be represented as uint8 without alteration")
        reproject(data, dst, src_transform=src.window_transform(w), src_crs=src.crs,
                  src_nodata=0, dst_transform=transform, dst_crs="EPSG:32618",
                  dst_nodata=0, resampling=Resampling.nearest, warp_mem_limit=16,
                  num_threads=1)
        return dst


def class_chunk(transform, size, cache, timeout, max_window_bytes):
    path = cache.key(LULC, transform, size)
    if path.exists():
        with np.load(path, allow_pickle=False) as a:
            return a["classes"], str(a["retrieved_at"]), "processed_cache"
    warning = None
    try:
        # GDAL must fail if HTTP Range is unsupported, allowing explicit capped fallback.
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_CACHEMAX=32*1024**2,
                          CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_TIMEOUT=str(timeout),
                          VSI_CACHE=False):
            data = read_categories(LULC, transform, size, max_window_bytes)
        stamp = now()
    except BudgetError:
        raise
    except Exception as e:
        warning = f"HTTP window access failed: {type(e).__name__}: {e}"
        local, stamp = download_county(cache, timeout)
        data = read_categories(local, transform, size, max_window_bytes)
    cache.put(path, classes=data, retrieved_at=np.asarray(stamp))
    return data, stamp, warning or "http_window"


def query_faa(name, envelope, timeout, max_bytes):
    """Fresh envelope query, deterministic pagination, original attributes and WGS84 GeoJSON."""
    url = FAA[name]
    stamp = now()
    info = {"url": url, "retrieved_at": stamp, "succeeded": False, "feature_count": 0}
    features = []
    consumed = 0

    def get(params):
        nonlocal consumed
        with requests.get(url + "/query", params=params, timeout=timeout, stream=True) as resp:
            resp.raise_for_status()
            chunks = []
            for chunk in resp.iter_content(65536):
                consumed += len(chunk)
                if consumed > max_bytes:
                    raise BudgetError(f"{name} response exceeds {max_bytes} byte budget")
                chunks.append(chunk)
        data = json.loads(b"".join(chunks))
        if "error" in data:
            raise RuntimeError(json.dumps(data["error"]))
        return data

    try:
        base = {"geometry": json.dumps(dict(zip(["xmin", "ymin", "xmax", "ymax"], envelope))),
                "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                "spatialRel": "esriSpatialRelIntersects", "where": "1=1"}
        # ID enumeration avoids offset drift/ignored resultOffset and supports services
        # with small record limits. Every batch also carries the spatial envelope.
        ids_response = get({**base, "f": "json", "returnIdsOnly": "true"})
        if ids_response.get("exceededTransferLimit"):
            raise RuntimeError("FAA object-ID enumeration was truncated")
        ids = ids_response.get("objectIds")
        oid = ids_response.get("objectIdFieldName")
        if not isinstance(ids, list) or not oid:
            raise RuntimeError("FAA returned no valid object ID listing")
        ids = sorted(set(ids))
        for offset in range(0, len(ids), 100):
            batch = ids[offset:offset+100]
            data = get({**base, "f": "geojson", "objectIds": ",".join(map(str, batch)),
                        "outFields": "*", "outSR": 4326, "returnGeometry": "true"})
            page = data.get("features")
            if not isinstance(page, list) or data.get("exceededTransferLimit"):
                raise RuntimeError("FAA page missing or truncated")
            got = set()
            for f in page:
                attrs = f.get("properties", {})
                got.add(attrs.get(oid, f.get("id")))
                geom = shape(f["geometry"])
                if geom.is_empty or not geom.is_valid or geom.geom_type not in ("Polygon", "MultiPolygon"):
                    raise RuntimeError("FAA restriction has invalid/non-polygon geometry")
                features.append({"type": "Feature", "geometry": mapping(geom),
                                 "properties": {"source": name, "source_url": url,
                                  "retrieved_at": stamp, "attributes": attrs,
                                  "reason": "national_security_footprint" if name == "national_security"
                                  else "facility_map_no_authorization_supplied"}})
            if got != set(batch):
                raise RuntimeError("FAA page IDs differ from requested IDs; query may have changed")
        info["succeeded"] = True
    except Exception as e:
        info["error"] = f"{type(e).__name__}: {e}"
    info["feature_count"] = len(features)
    return features, info
