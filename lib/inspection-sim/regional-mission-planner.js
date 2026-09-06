import {fetchTerrain} from './regional-data.js';
import {astarGrid,normalizePolygon,pointInPolygon,polygonBounds,scanSegments,seededPointInPolygon} from './mission-geometry.js';

const DETAIL=5,MAX_ROUTE_POINTS=250000;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const distance2=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

function validateOptions(value={}){
  const options={speed:5,climbSpeed:2,flightMinutes:46.5,clearance:4.572,bodyRadius:.5,uncertainty:1,arrivalReserve:10,
    trackSpacing:value.mode==='search'?75:30,captureSpacing:15,detectionRadius:50,...value};
  for(const name of ['speed','climbSpeed','flightMinutes','clearance','bodyRadius','uncertainty','arrivalReserve','trackSpacing','captureSpacing','detectionRadius'])
    if(!Number.isFinite(options[name]))throw new Error(`${name} must be finite.`);
  if(options.speed<=0||options.climbSpeed<=0||options.flightMinutes<=0||options.trackSpacing<5||options.captureSpacing<5||options.detectionRadius<=0)
    throw new Error('Mission speeds, endurance, spacing, and detection radius must be positive.');
  return options;
}

class Terrain{
  constructor(url,manifest,overview){this.url=url;this.meta=manifest;this.overview=overview;this.half=manifest.size/2;this.tiles=new Map(manifest.tiles.map(tile=>[tile.id,tile]));this.detail=new Map();}
  coarseCell(p){return [clamp(Math.floor((this.half-p[1])/this.meta.overviewResolution),0,this.overview.rows-1),clamp(Math.floor((p[0]+this.half)/this.meta.overviewResolution),0,this.overview.cols-1)];}
  coarsePoint([r,c]){const s=this.meta.overviewResolution;return [-this.half+(c+.5)*s,this.half-(r+.5)*s];}
  coarseHeight(r,c){return this.overview.heights[r*this.overview.cols+c];}
  coarsePath(a,b,polygon=null){
    const allowed=polygon?(r,c)=>pointInPolygon(this.coarsePoint([r,c]),polygon):()=>true;
    const segmentAllowed=polygon?(a,b)=>{const steps=Math.max(1,Math.ceil(distance2(a,b)/5));for(let i=0;i<=steps;i++)if(!pointInPolygon([a[0]+(b[0]-a[0])*i/steps,a[1]+(b[1]-a[1])*i/steps],polygon))return false;return true;}:()=>true;
    const nearest=(p)=>{
      const origin=this.coarseCell(p);if(allowed(...origin))return origin;
      for(let radius=1;radius<=12;radius++){
        let best=null,bestDistance=Infinity;
        for(let dr=-radius;dr<=radius;dr++)for(let dc=-radius;dc<=radius;dc++){
          if(Math.max(Math.abs(dr),Math.abs(dc))!==radius)continue;
          const r=origin[0]+dr,c=origin[1]+dc,centre=this.coarsePoint([r,c]);if(r<0||c<0||r>=this.overview.rows||c>=this.overview.cols||!allowed(r,c)||!segmentAllowed(p,centre))continue;
          const d=distance2(p,centre);if(d<bestDistance){best=[r,c];bestDistance=d;}
        }
        if(best)return best;
      }
      throw new Error('A route endpoint has no usable 25 m terrain cell inside the selected polygon.');
    };
    const start=nearest(a),goal=nearest(b),centres=astarGrid({rows:this.overview.rows,cols:this.overview.cols,start,goal,height:(r,c)=>this.coarseHeight(r,c),allowed,
      canMove:(r,c,rr,cc)=>segmentAllowed(this.coarsePoint([r,c]),this.coarsePoint([rr,cc]))}).map(cell=>this.coarsePoint(cell));
    return [a.slice(0,2),...centres,b.slice(0,2)];
  }
  tileIdFor(p){const c=Math.floor((p[0]+this.half)/500),r=Math.floor((this.half-p[1])/500);return r<0||c<0||r>=this.meta.size/500||c>=this.meta.size/500?null:`${r}-${c}`;}
  async loadAround(points,progress=()=>{}){
    const ids=new Set(),grid=this.meta.size/500;
    for(const p of points){const id=this.tileIdFor(p);if(!id)throw new Error('Planned route leaves the regional terrain.');const [r,c]=id.split('-').map(Number);for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)if(r+dr>=0&&c+dc>=0&&r+dr<grid&&c+dc<grid)ids.add(`${r+dr}-${c+dc}`);}
    const queue=[...ids].filter(id=>!this.detail.has(id));let completed=0;
    const worker=async()=>{while(queue.length){const id=queue.shift(),tile=this.tiles.get(id),data=await fetchTerrain(`${this.url}tiles/${id}/${DETAIL}/terrain.bin.gz`);this.detail.set(id,{tile,data});completed++;progress({stage:'terrain',completed,total:ids.size});}};
    await Promise.all(Array.from({length:Math.min(8,queue.length)},worker));
  }
  heightAt(p,radius=0){
    const gc=Math.floor((p[0]+this.half)/DETAIL),gr=Math.floor((this.half-p[1])/DETAIL),side=this.meta.size/DETAIL;let highest=-Infinity;
    for(let dr=-radius;dr<=radius;dr++)for(let dc=-radius;dc<=radius;dc++){
      const r=gr+dr,c=gc+dc;if(r<0||c<0||r>=side||c>=side)continue;
      const tr=Math.floor(r/100),tc=Math.floor(c/100),entry=this.detail.get(`${tr}-${tc}`);if(!entry)continue;
      const lr=r-tr*100,lc=c-tc*100,z=entry.data.heights[lr*100+lc];if(Number.isFinite(z))highest=Math.max(highest,z);
    }
    if(!Number.isFinite(highest))throw new Error('Detailed terrain is unavailable along the candidate route.');return highest;
  }
}

function appendPath(out,path){for(const p of path)if(!out.length||distance2(out.at(-1),p)>.01)out.push(p);}
function densify(points,step=DETAIL){
  const out=[points[0]];
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],n=Math.max(1,Math.ceil(distance2(a,b)/step));for(let j=1;j<=n;j++)out.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);if(out.length>MAX_ROUTE_POINTS)throw new Error('Selected mission produces too many route samples; reduce the polygon or increase spacing.');}
  return out;
}

function siteArrivalIndex(points,polygon,target){
  if(polygon){
    const idx=points.findIndex(p=>pointInPolygon(p,polygon));
    return idx<0?0:idx;
  }
  if(target){
    let best=0,bestD=Infinity;
    for(let i=0;i<points.length;i++){const d=distance2(points[i],target);if(d<bestD){bestD=d;best=i;}}
    return best;
  }
  return 0;
}

function altitudeProfile(points,terrain,options,holdHighUntil=0,{holdCruise=false}={}){
  const radius=Math.ceil((options.clearance+options.bodyRadius+options.uncertainty)/DETAIL),margin=options.clearance+options.bodyRadius+options.uncertainty+.05;
  const climbRatio=options.climbSpeed/options.speed;
  const minSafe=points.map(p=>terrain.heightAt(p,radius)+margin);
  const end=Math.min(Math.max(0,holdHighUntil),Math.max(0,minSafe.length-1));
  if(holdCruise){
    const cruise=Math.max(...minSafe);
    const altitude=minSafe.map(()=>cruise);
    if(end>0){
      altitude[end]=minSafe[end];
      for(let i=end-1;i>=0;i--){
        const drop=distance2(points[i],points[i+1])*climbRatio;
        altitude[i]=Math.max(minSafe[i],Math.min(cruise,altitude[i+1]+drop));
      }
      for(let i=end+1;i<altitude.length;i++){
        const rise=distance2(points[i-1],points[i])*climbRatio;
        altitude[i]=Math.max(minSafe[i],Math.min(cruise,altitude[i-1]+rise));
      }
    }
    return points.map((p,i)=>[p[0],p[1],altitude[i]]);
  }
  const altitude=minSafe.slice();
  for(let i=altitude.length-2;i>=0;i--){const rise=distance2(points[i],points[i+1])*climbRatio;altitude[i]=Math.max(altitude[i],altitude[i+1]-rise);}
  for(let i=1;i<altitude.length;i++){const drop=distance2(points[i-1],points[i])*climbRatio;altitude[i]=Math.max(altitude[i],altitude[i-1]-drop);}
  if(end>0){
    const siteAlt=altitude[end],cruise=Math.max(siteAlt,...minSafe.slice(0,end+1));
    altitude[end]=siteAlt;
    for(let i=end-1;i>=0;i--){
      const drop=distance2(points[i],points[i+1])*climbRatio;
      altitude[i]=Math.max(minSafe[i],Math.min(cruise,altitude[i+1]+drop));
    }
  }
  return points.map((p,i)=>[p[0],p[1],altitude[i]]);
}

function missionTasks(mode,path,polygon,options,{target=null,returnStart=path.length-1}={}){
  let photo=0,travel=0,lastCapture=-Infinity,found=false;
  return path.map((point,i)=>{
    if(i)travel+=Math.hypot(point[0]-path[i-1][0],point[1]-path[i-1][1]);
    const inside=polygon&&pointInPolygon(point,polygon),returning=i>=returnStart;
    let kind=returning?'return':mode==='delivery'||!inside?'outbound':mode,photoId=null;
    if(mode==='inspection'&&inside&&travel-lastCapture>=options.captureSpacing){photoId=photo++;lastCapture=travel;kind='survey';}
    if(mode==='search'&&!found&&inside&&target&&distance2(point,target)<=options.detectionRadius){kind='found';found=true;}
    return {point,kind,photo:photoId};
  });
}

export async function planRegionalMission({regionUrl,config,progress=()=>{}}){
  if(!['delivery','inspection','search'].includes(config?.mode))throw new Error('Mission mode must be delivery, inspection, or search.');
  const url=regionUrl.endsWith('/')?regionUrl:`${regionUrl}/`,manifest=await fetch(`${url}manifest.json`).then(r=>{if(!r.ok)throw new Error(`Regional manifest: HTTP ${r.status}`);return r.json();});
  const half=manifest.size/2,inside=p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)&&Math.abs(p[0])<half&&Math.abs(p[1])<half;
  if(!inside(config.a))throw new Error('Point A must lie inside the regional domain.');
  if(config.mode==='delivery'&&!inside(config.b))throw new Error('Point B must lie inside the regional domain.');
  const options=validateOptions({...config.settings,mode:config.mode}),overview=await fetchTerrain(`${url}overview/terrain.bin.gz`),terrain=new Terrain(url,manifest,overview);
  progress({stage:'coarse',completed:0,total:1});let polygon=null,target=null,route=[],returnStart=0;
  if(config.mode==='delivery'){
    const outbound=terrain.coarsePath(config.a,config.b);appendPath(route,outbound);returnStart=route.length;appendPath(route,[...outbound].reverse());
  }else{
    polygon=normalizePolygon(config.polygon,{halfSize:half,maxArea:config.settings?.maxArea??25_000_000});
    const homeInside=pointInPolygon(config.a,polygon),forward=scanSegments(polygon,options.trackSpacing),reverse=[...forward].reverse().map(([a,b])=>[b,a]),
      segments=distance2(config.a,reverse[0][0])<distance2(config.a,forward[0][0])?reverse:forward;
    let current=config.a.slice(0,2);appendPath(route,[current]);
    for(let i=0;i<segments.length;i++){const segment=segments[i];appendPath(route,terrain.coarsePath(current,segment[0],i||homeInside?polygon:null));appendPath(route,segment);current=segment[1];}
    returnStart=route.length;appendPath(route,terrain.coarsePath(current,config.a,homeInside?polygon:null));
    if(config.mode==='search')target=seededPointInPolygon(polygon,config.seed??Date.now());
  }
  progress({stage:'coarse',completed:1,total:1});route=densify(route);
  await terrain.loadAround(route,progress);if(target)target=[target[0],target[1],terrain.heightAt(target,0)];
  const holdHighUntil=siteArrivalIndex(route,polygon,config.mode==='delivery'?config.b:null);
  const profiled=altitudeProfile(route,terrain,options,holdHighUntil,{holdCruise:config.mode==='delivery'}),surface=terrain.heightAt(config.a,0),start=[config.a[0],config.a[1],surface],
    tasks=missionTasks(config.mode,profiled,polygon,options,{target,returnStart});
  if(config.mode==='delivery')tasks[Math.max(0,returnStart-1)].kind='deliver';
  if(config.mode==='search'&&!tasks.some(task=>task.kind==='found'))throw new Error('Search track spacing exceeds the configured detection coverage.');
  tasks.push({point:start.slice(),kind:'return',photo:null});
  let previous=start,flightSeconds=0;for(const task of tasks){flightSeconds+=Math.max(distance2(previous,task.point)/options.speed,Math.abs(previous[2]-task.point[2])/options.climbSpeed);previous=task.point;}
  const requiredBattery=flightSeconds/(options.flightMinutes*60)*100+options.arrivalReserve;if(requiredBattery>=100)throw new Error('Mission exceeds the selected endurance and return reserve.');
  const bounds=polygon?polygonBounds(polygon):null,routeBounds={west:Infinity,east:-Infinity,south:Infinity,north:-Infinity};
  for(const point of profiled){routeBounds.west=Math.min(routeBounds.west,point[0]);routeBounds.east=Math.max(routeBounds.east,point[0]);routeBounds.south=Math.min(routeBounds.south,point[1]);routeBounds.north=Math.max(routeBounds.north,point[1]);}
  const sourceBounds=bounds?{west:Math.min(bounds.west,routeBounds.west),east:Math.max(bounds.east,routeBounds.east),south:Math.min(bounds.south,routeBounds.south),north:Math.max(bounds.north,routeBounds.north)}:routeBounds,
    buffer=config.mode==='delivery'?125:25,renderBounds={west:Math.max(-half,sourceBounds.west-buffer),east:Math.min(half,sourceBounds.east+buffer),south:Math.max(-half,sourceBounds.south-buffer),north:Math.min(half,sourceBounds.north+buffer)},
    photoCount=tasks.reduce((n,t)=>n+(t.photo!==null),0);
  return {version:1,mode:config.mode,simulated:true,start,parts:[tasks],tasks,photoCount,polygon,target,bounds,renderBounds,options,flightSeconds,requiredBattery,terrainResolution:DETAIL,
    safetyNote:'Candidate topology uses 25 m A*. Altitudes are validated against 5 m maximum-return cells with horizontal clearance dilation; no averaged height is used.'};
}
