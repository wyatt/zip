"""Acquire an exact 5 km square, full-density 2020 surface, and tiled imagery.

Separate visualization export: leaves find_way's routing domain and existing
inspection buffers unchanged. Resume by rerunning; completed source tiles persist.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import argparse, concurrent.futures, gzip, json, time, math, os, struct
import numpy as np
import pdal, rasterio, requests
from rasterio.transform import Affine
from rasterio.warp import transform_bounds
from scipy.ndimage import distance_transform_edt
from ithaca_geo import sources
from ithaca_geo.core import ORIGIN, CENTER
from ithaca_geo.legend import LEGEND

SIZE=5000
SOURCE_TILE=1000
DISPLAY_TILE=500
ORTHO='https://orthos.its.ny.gov/arcgis/rest/services/wms/2023/MapServer'
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'outputs/region-5km'
DEST=ROOT/'viewer/public/region'
HEIGHT_SCALE=.05
TERRAIN_HEADER=struct.Struct('<4sBBHHffI2x')

def atomic_json(path,value):
    tmp=path.with_suffix('.part');tmp.write_text(json.dumps(value,indent=2,allow_nan=False));tmp.replace(path)

def fetch_image(path,bounds,pixels):
    if path.exists():return
    params=dict(bbox=','.join(map(str,bounds)),bboxSR=32618,imageSR=32618,size=f'{pixels},{pixels}',format='jpg',f='pjson')
    for attempt in range(4):
        try:
            response=requests.get(ORTHO+'/export',params=params,timeout=120);response.raise_for_status();info=response.json()
            if 'href' not in info:raise RuntimeError(str(info))
            extent=info['extent']
            if any(abs(extent[k]-v)>.02 for k,v in zip(['xmin','ymin','xmax','ymax'],bounds)):
                raise RuntimeError('Imagery extent differs from requested terrain extent')
            response=requests.get(info['href'],timeout=120);response.raise_for_status()
            if not response.content.startswith(b'\xff\xd8') or len(response.content)>10*1024**2:raise RuntimeError('Invalid/oversized JPEG')
            tmp=path.with_suffix('.part');tmp.write_bytes(response.content);tmp.replace(path);return
        except Exception:
            if attempt==3:raise
            time.sleep(2*(attempt+1))

def acquire_tile(rc):
    r,c=rc;path=SOURCE/f'{r}-{c}.npz'
    if path.exists():return path
    transform=Affine(1,0,ORIGIN[0]-SIZE/2+c*SOURCE_TILE,0,-1,ORIGIN[1]+SIZE/2-r*SOURCE_TILE)
    bounds=(transform.c,transform.f-SOURCE_TILE,transform.c+SOURCE_TILE,transform.f)
    b=transform_bounds(32618,3857,*bounds,densify_pts=21)
    print(f'Acquiring source tile {r},{c}',flush=True)
    pipeline=pdal.Pipeline(json.dumps([
        {'type':'readers.ept','filename':sources.EPT,'bounds':f'([{b[0]-.01},{b[2]+.01}],[{b[1]-.01},{b[3]+.01}])','requests':2},
        {'type':'filters.reprojection','in_srs':'EPSG:3857','out_srs':'EPSG:32618'}]))
    heights=np.full((SOURCE_TILE,SOURCE_TILE),np.nan,np.float32);counts=np.zeros(heights.shape,np.uint32)
    total=0
    for points in pipeline.iterator(chunk_size=131072,prefetch=0):
        sources.aggregate(points,heights,counts,transform);total+=len(points)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',GDAL_HTTP_TIMEOUT='90',GDAL_CACHEMAX=32*1024**2):
        classes=sources.read_categories(sources.LULC,transform,SOURCE_TILE,256*1024**2)
    tmp=path.with_suffix('.part')
    with tmp.open('wb') as f:np.savez_compressed(f,heights=heights,counts=counts,classes=classes,retrieved_at=np.asarray(sources.now()))
    tmp.replace(path)
    print(f'Saved source tile {r},{c}: {int(counts.sum()):,} retained points, {int(np.isfinite(heights).sum()):,} measured cells',flush=True)
    return path

def reduce_grid(heights,classes,step):
    n=heights.shape[0]//step
    blocks=heights.reshape(n,step,n,step).transpose(0,2,1,3).reshape(n,n,step*step)
    valid=np.isfinite(blocks);known=valid.any(axis=2)
    index=np.where(valid,blocks,-np.inf).argmax(axis=2)
    z=np.take_along_axis(blocks,index[:,:,None],axis=2)[:,:,0].copy()
    cb=classes.reshape(n,step,n,step).transpose(0,2,1,3).reshape(n,n,step*step)
    code=np.take_along_axis(cb,index[:,:,None],axis=2)[:,:,0].copy()
    z[~known]=np.nan;code[~known]=0
    return z,code,known

def write_level(folder,z,codes,known):
    # Display-only nearest measured value. Validity survives in a separate byte.
    # A 1 m source cell is never silently promoted to a measurement.
    display=z.copy()
    if known.any() and not known.all():
        nearest=distance_transform_edt(~known,return_distances=False,return_indices=True)
        display[~known]=z[tuple(nearest[:,~known])]
    finite=np.isfinite(display);base=math.floor(float(np.nanmin(display))/HEIGHT_SCALE)*HEIGHT_SCALE if finite.any() else 0.
    quantized=np.full(display.shape,65535,np.uint16)
    if finite.any():
        encoded=np.ceil((display[finite]-base)/HEIGHT_SCALE-1e-6).astype(np.uint32)
        if encoded.max(initial=0)>=65535:raise RuntimeError('Tile elevation range exceeds uint16 encoding')
        quantized[finite]=encoded.astype(np.uint16)
        decoded=base+quantized[finite].astype(np.float32)*HEIGHT_SCALE
        if np.any(decoded+1e-4<display[finite]) or np.any(decoded-display[finite]>HEIGHT_SCALE+1e-3):
            raise RuntimeError('Quantized terrain failed conservative precision check')
    rows,cols=display.shape;mask=np.packbits(known.reshape(-1),bitorder='little')
    payload=TERRAIN_HEADER.pack(b'RT16',1,1,rows,cols,base,HEIGHT_SCALE,rows*cols)
    payload+=quantized.astype('<u2',copy=False).tobytes()+codes.astype('u1',copy=False).tobytes()+mask.tobytes()
    path=folder/'terrain.bin.gz';tmp=path.with_suffix('.part');tmp.write_bytes(gzip.compress(payload,compresslevel=6,mtime=0));tmp.replace(path)
    for legacy in ['elevation.f32','classes.u8','measured.u8']:(folder/legacy).unlink(missing_ok=True)

def write_thumbnail(source,destination,pixels=256):
    if destination.exists() and destination.stat().st_mtime>=source.stat().st_mtime:return
    from rasterio.enums import Resampling
    with rasterio.open(source) as image:
        data=image.read(out_shape=(image.count,pixels,pixels),resampling=Resampling.bilinear)
    tmp=destination.with_suffix('.part')
    with rasterio.open(tmp,'w',driver='JPEG',width=pixels,height=pixels,count=data.shape[0],dtype=data.dtype,quality=86) as image:image.write(data)
    tmp.replace(destination)

def export_region():
    overview=np.full((200,200),np.nan,np.float32);cover=np.zeros((200,200),np.uint8);valid=np.zeros((200,200),bool)
    tiles=[];stamps=[];point_count=0;measured_count=0;images=[]
    for r in range(5):
        for c in range(5):
            with np.load(SOURCE/f'{r}-{c}.npz',allow_pickle=False) as source:
                h=source['heights'];codes=source['classes'];point_count+=int(source['counts'].sum());measured_count+=int(np.isfinite(h).sum());stamps.append(str(source['retrieved_at']))
                z,co,ok=reduce_grid(h,codes,25);overview[r*40:(r+1)*40,c*40:(c+1)*40]=z;cover[r*40:(r+1)*40,c*40:(c+1)*40]=co;valid[r*40:(r+1)*40,c*40:(c+1)*40]=ok
                for sr in range(2):
                    for sc in range(2):
                        tr=r*2+sr;tc=c*2+sc;key=f'{tr}-{tc}';folder=DEST/'tiles'/key;folder.mkdir(parents=True,exist_ok=True)
                        a=h[sr*500:(sr+1)*500,sc*500:(sc+1)*500];cl=codes[sr*500:(sr+1)*500,sc*500:(sc+1)*500];known=np.isfinite(a)
                        for step in [1,5]:
                            level=folder/str(step);level.mkdir(exist_ok=True)
                            zz,cc,kk=(a,cl,known) if step==1 else reduce_grid(a,cl,step)
                            write_level(level,zz,cc,kk)
                        west=-2500+tc*500;north=2500-tr*500
                        bounds=(ORIGIN[0]+west,ORIGIN[1]+north-500,ORIGIN[0]+west+500,ORIGIN[1]+north)
                        images.append((folder/'aerial.jpg',bounds,1024))
                        tiles.append(dict(id=key,west=west,north=north,size=500,measuredCells=int(known.sum())))
    folder=DEST/'overview';folder.mkdir(exist_ok=True);write_level(folder,overview,cover,valid)
    print('Downloading registered aerial imagery (100 detail tiles + overview)',flush=True)
    fetch_image(folder/'aerial.jpg',(ORIGIN[0]-2500,ORIGIN[1]-2500,ORIGIN[0]+2500,ORIGIN[1]+2500),2048)
    def image_task(args):fetch_image(*args);return args[0]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for i,_ in enumerate(pool.map(image_task,images),1):
            if i%10==0:print(f'Aerial tiles ready: {i}/100',flush=True)
    for image,_,_ in images:write_thumbnail(image,image.with_name('aerial-5m.jpg'))
    manifest=dict(version=2,size=5000,tileSize=500,overviewResolution=25,levels=[5,1],origin=dict(wgs84=list(CENTER),utm_m=list(ORIGIN)),
        crs='EPSG:32618',verticalReference='NAVD88 meters (EPSG:5703), GEOID12B',zMin=float(np.nanmin(overview)),zMax=float(np.nanmax(overview)),
        terrainEncoding=dict(format='RT16+gzip',height='uint16',heightScale=HEIGHT_SCALE,missingHeight=65535,measured='little-endian bitset'),
        sourceResolution=1,sourceDates=dict(elevation='2020',landCover='2022',imagery='2023'),legend=LEGEND,tiles=tiles,
        sourceUrls=dict(lidar=sources.EPT,landCover=sources.LULC,imagery=ORTHO),retrievedAt=stamps,
        retainedPoints=point_count,measuredCells=measured_count,totalCells=25000000,
        note='Visualization only. Full-density maximum-return 1 m source; display LOD uses maximum height. Missing display heights use nearest measured cells and remain marked unmeasured. Regional tiles do not extend the inspection route or certify airspace.')
    atomic_json(DEST/'manifest.json',manifest)
    print(f'COMPLETE: 5,000 × 5,000 m, {measured_count:,} measured source cells, {point_count:,} retained returns',flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--workers',type=int,default=2);p.add_argument('--export-only',action='store_true');args=p.parse_args()
    SOURCE.mkdir(parents=True,exist_ok=True);DEST.mkdir(parents=True,exist_ok=True)
    if not args.export_only:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            for _ in pool.map(acquire_tile,[(r,c) for r in range(5) for c in range(5)]):pass
    export_region()
if __name__=='__main__':main()
