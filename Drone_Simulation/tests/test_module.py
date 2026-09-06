import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import rasterio
from rasterio.transform import Affine
from shapely import box

from ithaca_geo import Config, find_way
from ithaca_geo.core import ORIGIN, requested_domain, grid_for
from ithaca_geo.legend import LEGEND
from ithaca_geo.routing import route, segment_valid
from ithaca_geo.sources import aggregate, read_categories, query_faa, Cache, BudgetError, lidar_chunk


class SurfaceTests(unittest.TestCase):
    def test_max_noise_withheld_unclassified_and_missing(self):
        dtype = [(x, 'f8') for x in ('X', 'Y', 'Z')] + [('Withheld', 'u1'), ('Classification', 'u1')]
        p = np.array([(0.5, 1.5, 5, 0, 2), (0.5, 1.5, 25, 0, 1),
                      (0.5, 1.5, 500, 0, 7), (0.5, 1.5, 600, 0, 18),
                      (0.5, 1.5, 700, 0, 20), (0.5, 1.5, 800, 1, 1),
                      (1.5, 0.5, -5, 0, 0), (2, 1.5, 100, 0, 1),
                      (0.5, 0.5, np.nan, 0, 1)], dtype=dtype)
        z, count = np.full((2, 2), np.nan, 'f4'), np.zeros((2, 2), 'u4')
        aggregate(p, z, count, Affine(1, 0, 0, 0, -1, 2))
        self.assertEqual(z[0, 0], 25)
        self.assertEqual(count[0, 0], 2)
        self.assertEqual(z[1, 1], -5)
        self.assertTrue(np.isnan(z[0, 1]))
        self.assertEqual(count.sum(), 3)

    def test_categories_native_window_nearest_and_legend(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'source.tif'
            original = np.array([[24, 27], [43, 0]], dtype='uint8')
            tr = Affine(2, 0, ORIGIN[0], 0, -2, ORIGIN[1])
            with rasterio.open(path, 'w', driver='GTiff', width=2, height=2, count=1,
                               dtype='uint8', crs='EPSG:32618', transform=tr, nodata=0) as dst:
                dst.write(original, 1)
            actual = read_categories(path, tr*Affine.scale(0.5), 4, 4096)
            np.testing.assert_array_equal(actual, np.repeat(np.repeat(original, 2, 0), 2, 1))
            self.assertEqual(LEGEND['24'], 'Tree Canopy over Structures')
            self.assertNotIn('Grass', LEGEND['43'])
            self.assertEqual(len(LEGEND), 57)

    def test_cache_keys_and_exact_reuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Cache(tmp, 1_000_000)
            tr = Affine(1, 0, 0, 0, -1, 2)
            from ithaca_geo.sources import EPT
            key = cache.key(EPT, tr, 2)
            cache.put(key, z=np.ones((2, 2), 'f4'), counts=np.ones((2, 2), 'u4'),
                      retrieved_at=np.asarray('original-time'))
            z, counts, stamp = lidar_chunk(tr, 2, cache)
            self.assertEqual(stamp, 'original-time')
            self.assertNotEqual(key, cache.key(EPT, tr*Affine.scale(2), 2))
            self.assertNotEqual(key, cache.key(EPT+'different', tr, 2))
            self.assertNotEqual(key, cache.key(EPT, tr*Affine.translation(2, 0), 2))
            with self.assertRaises(BudgetError):
                cache.check(1_000_000)


class RoutingTests(unittest.TestCase):
    def setUp(self):
        self.z = np.zeros((20, 20), dtype='f4')
        self.nofly = np.zeros_like(self.z, dtype=bool)
        self.domain = box(0, 0, 20, 20)
        self.mask = np.ones_like(self.z, dtype=bool)
        self.tr = Affine(1, 0, 0, 0, -1, 20)
        self.cfg = Config(cruise_elevation_m=10, horizontal_clearance_m=0, vertical_clearance_m=1)

    def call(self, start=(3.5, 3.5, 5), end=(16.5, 16.5, 5)):
        return route(np.array(start), np.array(end), self.z, self.nofly, self.mask,
                     self.tr, self.domain, self.cfg)

    def test_detour_every_segment_and_vertical(self):
        self.z[8:12, 5:15] = 50
        path, status, _ = self.call()
        self.assertEqual(status, 'candidate_path')
        np.testing.assert_array_equal(path[0], [3.5, 3.5, 5])
        np.testing.assert_array_equal(path[-1], [16.5, 16.5, 5])
        for a, b in zip(path, path[1:]):
            self.assertTrue(segment_valid(a, b, self.z, self.nofly, self.tr, self.domain, 0, 1))
        self.assertTrue(all(p[2] == 10 for p in path[1:-1]))

    def test_tiny_obstacle_corner_and_full_vertical(self):
        self.z[10, 10] = 8
        # Diagonal segment touches obstacle corner despite endpoints in other cells.
        self.assertFalse(segment_valid((9.5, 9.5, 5), (10.5, 10.5, 5), self.z,
                                       self.nofly, self.tr, self.domain, 0, 1))
        self.assertFalse(segment_valid((10.5, 9.5, 5), (10.5, 9.5, 20), self.z,
                                       self.nofly, self.tr, self.domain, 0, 1))

    def test_unknown_and_restriction_barrier(self):
        self.z[9, :] = np.nan
        path, status, _ = self.call()
        self.assertEqual(path.shape, (0, 3))
        self.assertEqual(status, 'no_path')
        self.z[:] = 0
        self.nofly[9, :] = True
        self.assertEqual(self.call()[1], 'no_path')

    def test_stationary_and_search_budget(self):
        path, status, _ = self.call(end=(3.5, 3.5, 5))
        self.assertEqual(path.shape, (1, 3))
        self.assertEqual(status, 'candidate_path')
        self.cfg.max_search_nodes = 1
        self.assertEqual(self.call()[1], 'search_budget_exhausted')
        self.cfg.max_search_nodes = 10000
        self.cfg.max_search_queue = 1
        self.assertEqual(self.call()[1], 'search_budget_exhausted')

    def test_horizontal_clearance(self):
        self.z[10, 10] = 50
        a, b = (8.5, 8.5, 10), (8.5, 10.5, 10)
        self.assertTrue(segment_valid(a, b, self.z, self.nofly, self.tr, self.domain, 1, 1))
        self.assertFalse(segment_valid(a, b, self.z, self.nofly, self.tr, self.domain, 2, 1))

    def test_exact_domain_segment(self):
        domain = self.domain.difference(box(8, 8, 12, 12))
        self.assertFalse(segment_valid((5, 10, 10), (15, 10, 10), self.z,
                                       self.nofly, self.tr, domain, 0, 1))


class ApiTests(unittest.TestCase):
    corners = ((-76.4993, 42.4427), (-76.4987, 42.4433))
    point = (-76.499, 42.443, 300)

    def test_domain_rejection_and_lattice(self):
        with self.assertRaises(ValueError):
            find_way(*self.corners, (-76.4, 42.443, 300))
        with self.assertRaises(ValueError):
            requested_domain((-77, 41), (-76.9, 41.1))
        domain = requested_domain(*self.corners)
        tr, shape, n = grid_for(domain, Config())
        self.assertAlmostEqual((tr.c-ORIGIN[0]) % 32, 0)
        self.assertAlmostEqual((ORIGIN[1]-tr.f) % 32, 0)
        self.assertEqual(shape[0] % n, 0)

    def test_data_preserved_and_disk_alignment_when_faa_fails(self):
        def lidar(tr, n, cache):
            z = np.full((n, n), 150, 'f4')
            z[0, 0] = np.nan
            counts = np.where(np.isfinite(z), 3, 0).astype('u4')
            return z, counts, '2026-test'
        def classes(tr, n, *args):
            return np.full((n, n), 24, 'u1'), '2026-test', 'test'
        def faa(name, *args):
            return [], dict(succeeded=name != 'facility_maps', error='test failure')
        with tempfile.TemporaryDirectory() as tmp, patch('ithaca_geo.sources.lidar_chunk', side_effect=lidar), \
                patch('ithaca_geo.sources.class_chunk', side_effect=classes), patch('ithaca_geo.sources.query_faa', side_effect=faa):
            cfg = Config(output_dir=tmp+'/out', cache_dir=tmp+'/cache', cruise_elevation_m=320,
                         horizontal_clearance_m=1, vertical_clearance_m=2)
            result = find_way(*self.corners, self.point, config=cfg)
            self.assertEqual(result['metadata']['status'], 'airspace_query_failed')
            self.assertEqual(result['waypoints'].shape, (0, 3))
            self.assertGreater(result['surface_valid'].sum(), 0)
            self.assertIn(24, result['surface_class'])
            self.assertFalse(result['metadata']['airspace_complete'])
            self.assertEqual(set(p.name for p in Path(tmp+'/out').iterdir()),
                             {'surface.tif', 'surface_class.tif', 'masks.tif', 'restrictions.geojson', 'waypoints.npy', 'metadata.json'})
            for filename in ('surface.tif', 'surface_class.tif', 'masks.tif'):
                with rasterio.open(Path(tmp+'/out')/filename) as src:
                    self.assertEqual(src.shape, result['surface_valid'].shape)
                    self.assertEqual(src.crs.to_epsg(), 32618)
                    self.assertEqual(list(src.transform)[:6], result['metadata']['grid_transform'])
            with rasterio.open(Path(tmp+'/out')/'surface.tif') as src:
                np.testing.assert_array_equal(src.read(1), result['surface_xyz'][:, :, 2])
                np.testing.assert_array_equal(src.read(2) > 0, result['surface_valid'])

    def test_low_budget_stops_before_network(self):
        with tempfile.TemporaryDirectory() as tmp, patch('ithaca_geo.sources.query_faa') as mock:
            result = find_way(*self.corners, self.point,
                              config=Config(memory_budget_bytes=1024, output_dir=tmp+'/out'))
            self.assertEqual(result['metadata']['status'], 'resource_budget_exceeded')
            self.assertEqual(result['surface_xyz'].shape, (0, 0, 3))
            mock.assert_not_called()


class FakeResponse:
    def __init__(self, data):
        self.data = data
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass
    def raise_for_status(self):
        pass
    def iter_content(self, *args):
        yield json.dumps(self.data).encode()


class FaaTests(unittest.TestCase):
    def test_pagination_fresh_and_attributes(self):
        calls = []
        def get(url, params, **kwargs):
            calls.append(params)
            if params.get('returnIdsOnly'):
                return FakeResponse({'objectIdFieldName': 'OBJECTID', 'objectIds': list(range(205))})
            ids = [int(x) for x in params['objectIds'].split(',')]
            return FakeResponse({'type': 'FeatureCollection', 'features': [
                {'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [
                    [[-76.5, 42.4], [-76.4, 42.4], [-76.4, 42.5], [-76.5, 42.4]]]},
                 'properties': {'OBJECTID': i, 'CEILING': 0}} for i in ids]})
        with patch('ithaca_geo.sources.requests.get', side_effect=get):
            for _ in range(2):
                features, info = query_faa('facility_maps', (-76.5, 42.4, -76.4, 42.5), 60, 1_000_000)
                self.assertTrue(info['succeeded'])
                self.assertEqual(len(features), 205)
                self.assertEqual(features[0]['properties']['attributes']['CEILING'], 0)
                self.assertIn('retrieved_at', features[0]['properties'])
            self.assertEqual(len(calls), 8)
            self.assertTrue(all(c['inSR'] == 4326 and c['geometryType'] == 'esriGeometryEnvelope' for c in calls))

    def test_service_error_and_truncation_fail_closed(self):
        for data in ({'error': {'code': 503, 'message': 'unavailable'}},
                     {'objectIdFieldName': 'ID', 'objectIds': [1], 'exceededTransferLimit': True}):
            with patch('ithaca_geo.sources.requests.get', return_value=FakeResponse(data)):
                features, info = query_faa('national_security', (0, 0, 1, 1), 60, 10000)
                self.assertFalse(info['succeeded'])
                self.assertIn('error', info)


if __name__ == '__main__':
    unittest.main()
