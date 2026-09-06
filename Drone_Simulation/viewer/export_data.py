"""Export only aligned height/class/mask buffers for the static viewer. No acquisition."""
import argparse
import json
from pathlib import Path
import numpy as np
import rasterio


def export(source, destination):
    source, destination = Path(source), Path(destination)
    metadata = json.loads((source / 'metadata.json').read_text())
    with rasterio.open(source / 'surface.tif') as src:
        if src.width * src.height > 512 * 512:
            raise ValueError('Lean viewer supports at most 512 × 512 cells; export a smaller request')
        z = src.read(1).astype('<f4')
        transform, crs = src.transform, src.crs
    with rasterio.open(source / 'surface_class.tif') as src:
        assert src.shape == z.shape and src.transform == transform and src.crs == crs
        classes = src.read(1).astype('u1')
    with rasterio.open(source / 'masks.tif') as src:
        assert src.shape == z.shape and src.transform == transform and src.crs == crs
        valid, nofly = src.read(2).astype(bool), src.read(3).astype(bool)
    assert np.array_equal(np.isfinite(z), valid)
    if not valid.any():
        raise ValueError('No measured surface to display')
    flags = valid.astype('u1') | (nofly.astype('u1') << 1)
    rows, cols = z.shape
    separation = round(100 / transform.a)
    choices = []
    for row, col in np.argwhere(valid[:, :max(0, cols-separation)] & valid[:, separation:]):
        choices.append((abs(row-rows/2)+abs(col+separation/2-cols/2), int(row), int(col)))
    if not choices:
        raise ValueError('No pair of measured cells approximately 100 m apart in this extent')
    _, row, col = min(choices)
    destination.mkdir(parents=True, exist_ok=True)
    z.tofile(destination / 'elevation.f32')
    classes.tofile(destination / 'classes.u8')
    flags.tofile(destination / 'flags.u8')
    manifest = {
        'rows': rows, 'cols': cols, 'resolution': transform.a,
        'x0': transform.c-metadata['local_origin']['utm_m'][0],
        'y0': transform.f-metadata['local_origin']['utm_m'][1],
        'zMin': float(z[valid].min()), 'zMax': float(z[valid].max()),
        'initialCells': [row*cols+col, row*cols+col+separation],
        'legend': metadata['class_legend'], 'crs': str(crs),
        'origin': metadata['local_origin'], 'verticalReference': metadata['vertical_reference'],
        'sourceDates': {'elevation': '2020', 'landCover': '2022'},
        'faaRetrievedAt': metadata['sources']['facility_maps']['retrieved_at'],
        'bothFaaQueriesSucceeded': metadata['both_faa_queries_succeeded'],
        'airspaceComplete': False,
        'note': 'Viewing acquired extent, including buffer. Points and dashed ruler are visual samples, not a route.'
    }
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(f'Exported {cols} × {rows} cells; {int(valid.sum())} measured; {z.nbytes+classes.nbytes+flags.nbytes:,} binary bytes')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', default='outputs/real-example')
    p.add_argument('--destination', default='viewer/public/data')
    args = p.parse_args()
    export(args.source, args.destination)
