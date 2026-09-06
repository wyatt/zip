import {fetchTerrain,isMeasured} from './regional-data.js';
import {pointInPolygon,polygonBounds} from './mission-geometry.js';

const intersects=(a,b)=>a.west<b.east&&a.east>b.west&&a.south<b.north&&a.north>b.south;

export async function createRegionalReconstruction(regionUrl,manifest,plan,onProgress=()=>{}){
  if(plan.mode!=='inspection'||!plan.polygon)return null;
  const bounds=polygonBounds(plan.polygon),span=Math.max(bounds.east-bounds.west,bounds.north-bounds.south),resolution=Math.max(1,Math.ceil(span/1200)),
    cols=Math.ceil((bounds.east-bounds.west)/resolution),rows=Math.ceil((bounds.north-bounds.south)/resolution),count=rows*cols;
  if(count>1_500_000)throw new Error('Inspection mosaic exceeds the browser grid limit; increase track spacing or use a smaller polygon.');
  const url=regionUrl.endsWith('/')?regionUrl:`${regionUrl}/`,tiles=manifest.tiles.filter(tile=>intersects(bounds,{west:tile.west,east:tile.west+tile.size,south:tile.north-tile.size,north:tile.north}));
  const terrain=new Map(),source=document.createElement('canvas');source.width=cols;source.height=rows;const context=source.getContext('2d',{willReadFrequently:true});
  let completed=0;
  const queue=[...tiles],load=async()=>{while(queue.length){const tile=queue.shift(),[data,response]=await Promise.all([
    fetchTerrain(`${url}tiles/${tile.id}/5/terrain.bin.gz`),fetch(`${url}tiles/${tile.id}/aerial.jpg`).then(async response=>{
      if(response.ok)return response;const fallback=await fetch(`${url}tiles/${tile.id}/aerial-5m.jpg`);if(!fallback.ok)throw new Error(`Mosaic imagery: HTTP ${fallback.status}`);return fallback;})]);
    const bitmap=await createImageBitmap(await response.blob());
    const x=(tile.west-bounds.west)/resolution,y=(bounds.north-tile.north)/resolution,size=tile.size/resolution;
    context.drawImage(bitmap,x,y,size,size);bitmap.close();terrain.set(tile.id,{tile,data});completed++;onProgress({stage:'mosaic',completed,total:tiles.length});}};
  await Promise.all(Array.from({length:Math.min(6,queue.length)},load));
  const sourcePixels=context.getImageData(0,0,cols,rows).data,mask=new Uint8Array(count),classes=new Uint8Array(count),measured=new Uint8Array(count),elevation=new Float32Array(count).fill(NaN);
  let totalCells=0;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const i=r*cols+c,e=bounds.west+(c+.5)*resolution,n=bounds.north-(r+.5)*resolution;if(!pointInPolygon([e,n],plan.polygon))continue;mask[i]=1;totalCells++;
    const tc=Math.floor((e+manifest.size/2)/500),tr=Math.floor((manifest.size/2-n)/500),entry=terrain.get(`${tr}-${tc}`);if(!entry)continue;
    const lc=Math.max(0,Math.min(99,Math.floor((e-entry.tile.west)/5))),lr=Math.max(0,Math.min(99,Math.floor((entry.tile.north-n)/5))),j=lr*100+lc;
    classes[i]=entry.data.codes[j];measured[i]=isMeasured(entry.data,j)?1:0;if(measured[i])elevation[i]=entry.data.heights[j];
  }
  const data={version:2,revision:0,simulated:true,mode:'inspection',crs:manifest.crs,verticalCrs:'EPSG:5703',origin:[manifest.origin.utm_m[0]+bounds.west,manifest.origin.utm_m[1]+bounds.north],
    bounds,resolution,rows,cols,polygon:plan.polygon,order:'row-major, north to south; west to east',mask,totalCells,coveredCells:0,captures:[],coverage:new Uint16Array(count),
    elevation,measured,classes,rgba:new Uint8Array(count*4),firstSeenSeconds:new Float64Array(count).fill(NaN),lastSeenSeconds:new Float64Array(count).fill(NaN),
    sources:{color:'NYS spring 2023 orthophoto',elevation:'2020 maximum-return display terrain',note:'Simulated capture reveal; not photogrammetric reconstruction'}};
  const seen=new Set(),footprint=Math.max(15,plan.options.trackSpacing);
  return {data,capture({id,position,time}){
    if(seen.has(id))return;seen.add(id);const [x,y]=position,half=footprint/2,c0=Math.max(0,Math.floor((x-half-bounds.west)/resolution)),c1=Math.min(cols-1,Math.floor((x+half-bounds.west)/resolution)),
      r0=Math.max(0,Math.floor((bounds.north-y-half)/resolution)),r1=Math.min(rows-1,Math.floor((bounds.north-y+half)/resolution));
    for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){const i=r*cols+c;if(!mask[i])continue;if(!data.coverage[i]){data.coveredCells++;data.firstSeenSeconds[i]=time;data.rgba.set(sourcePixels.slice(i*4,i*4+4),i*4);data.rgba[i*4+3]=255;}data.coverage[i]=Math.min(65535,data.coverage[i]+1);data.lastSeenSeconds[i]=time;}
    data.captures.push({id,time,position:position.slice(),footprintMeters:[footprint,footprint]});data.revision++;
  },toJSON(){return JSON.stringify(data,(_,value)=>ArrayBuffer.isView(value)?Array.from(value):value);}};
}
