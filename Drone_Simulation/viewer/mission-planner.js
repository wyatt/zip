// All positions are [east, north, NAVD88 elevation], in meters.
export const defaults=Object.freeze({speed:5,climbSpeed:2,flightMinutes:46.5,chargeMinutes:20,clearance:4.572,bodyRadius:.5,uncertainty:1,arrivalReserve:10});
export const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
export function travelSeconds(a,b,options=defaults){return Math.max(Math.hypot(a[0]-b[0],a[1]-b[1])/options.speed,Math.abs(a[2]-b[2])/options.climbSpeed);}

export function createSafetyModel(meta,heights,flags,options=defaults) {
  const {rows,cols,resolution:res}=meta;
  const clearance=options.clearance+options.bodyRadius+options.uncertainty;
  // Square horizontal dilation includes cell half-diagonals; vertical dilation
  // by the same clearance conservatively encloses a spherical safety buffer.
  const radius=Math.ceil(clearance/res+Math.SQRT1_2);
  const floor=new Float32Array(rows*cols),known=new Uint8Array(rows*cols);
  for(let i=0;i<known.length;i++)known[i]=!!((flags[i]&1)&&Number.isFinite(heights[i]));
  // Offline simulation only: unknown cells use the highest nearby original
  // measurement, never the global maximum or another inferred value.
  const estimated=heights.slice();
  if(!known.some(Boolean))throw new Error('Cannot infer a local surface without measured heights.');
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const i=r*cols+c;if(known[i])continue;
    for(let radius=1;;radius*=2){
      let count=0,maximum=-Infinity;
      for(let y=Math.max(0,r-radius);y<=Math.min(rows-1,r+radius);y++)
        for(let x=Math.max(0,c-radius);x<=Math.min(cols-1,c+radius);x++){
          const j=y*cols+x;if(known[j]){count++;maximum=Math.max(maximum,heights[j]);}
        }
      if(count>=4||(radius>=Math.max(rows,cols)&&count)){estimated[i]=maximum;break;}
    }
  }
  const bound=i=>estimated[i];
  const horizontal=new Float32Array(rows*cols);
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    let h=-Infinity;for(let x=Math.max(0,c-radius);x<=Math.min(cols-1,c+radius);x++)h=Math.max(h,bound(r*cols+x));
    horizontal[r*cols+c]=h;
  }
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    let h=-Infinity;for(let y=Math.max(0,r-radius);y<=Math.min(rows-1,r+radius);y++)h=Math.max(h,horizontal[y*cols+c]);
    floor[r*cols+c]=h+clearance+.05;
  }
  const index=(x,y)=>{
    const c=Math.floor((x-meta.x0)/res),r=Math.floor((meta.y0-y)/res);
    if(c<radius||c>=cols-radius||r<radius||r>=rows-radius)throw new Error('Route leaves the acquired clearance envelope.');
    return r*cols+c;
  };
  const safe=(x,y)=>floor[index(x,y)];
  const surface=(x,y)=>bound(index(x,y));
  function photoHeight(x,y){
    // Follow the local roof/terrain, rather than the tallest point under a
    // wide camera footprint. Nearby taller obstacles can still require a rise.
    return Math.max(surface(x,y)+12,safe(x,y));
  }

  function corridor(a,b){
    // Visit each crossed raster cell, including arbitrarily short corner cuts.
    const cuts=[0,1];
    for(const [axis,origin] of [[0,meta.x0],[1,meta.y0]]){
      const delta=b[axis]-a[axis];if(!delta)continue;
      const lo=Math.min(a[axis],b[axis]),hi=Math.max(a[axis],b[axis]);
      for(let k=Math.floor((lo-origin)/res)+1;k*res+origin<hi;k++){
        cuts.push((k*res+origin-a[axis])/delta);
      }
    }
    cuts.sort((x,y)=>x-y);let h=-Infinity;
    const visit=t=>{h=Math.max(h,safe(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t));};
    for(let i=0;i<cuts.length;i++){visit(cuts[i]);if(i)visit((cuts[i-1]+cuts[i])/2);}
    return h;
  }
  return {meta,known,clearance,radius,safe,surface,photoHeight,corridor,index};
}

// Conservative climb–cross–descend connector. Recomputed from the live position
// for every battery return/resume; no reliance on a canned return track.
export function routeTransit(model,from,to,options=defaults,{pad=false}={}) {
  if(distance(from,to)<1e-8)return {points:[from.slice()],seconds:0,pad};
  const cruise=Math.max(from[2],to[2],model.corridor(from,to)+.25);
  const points=[from.slice(),[from[0],from[1],cruise],[to[0],to[1],cruise],to.slice()];
  const clean=points.filter((p,i)=>i===0||distance(p,points[i-1])>.001);
  let seconds=0;for(let i=1;i<clean.length;i++)seconds+=travelSeconds(clean[i-1],clean[i],options);
  return {points:clean,seconds,pad};
}

export function planInspection(model,area,options=defaults) {
  const width=area.east-area.west,length=area.north-area.south;
  if(width<15||length<11)throw new Error('Inspection area is smaller than the configured photo footprint.');
  const laneCount=Math.ceil((width-15)/3)+1;
  const spacing=laneCount>1?(width-15)/(laneCount-1):0;
  const parts=[[],[]],lanes=[];let photoCount=0;
  for(let lane=0;lane<laneCount;lane++) {
    const x=area.east-7.5-lane*spacing;
    const part=lane<Math.ceil(laneCount/2)?0:1;
    const from=lane%2===0?area.north-5.5:area.south+5.5;
    const to=lane%2===0?area.south+5.5:area.north-5.5;
    const steps=Math.ceil(Math.abs(to-from));const points=[];
    for(let j=0;j<=steps;j++){
      const y=from+(to-from)*j/steps;
      points.push([x,y,model.photoHeight(x,y)]);
    }
    // Keep each segment clear; travelSeconds slows horizontal motion when
    // necessary to respect climb/descent speed without raising distant points.
    for(let j=0;j<points.length-1;j++){
      const bound=model.corridor(points[j],points[j+1])+.25;
      points[j][2]=Math.max(points[j][2],bound);points[j+1][2]=Math.max(points[j+1][2],bound);
    }
    const tasks=parts[part];
    if(tasks.length){
      const turn=routeTransit(model,tasks.at(-1).point,points[0],options);
      for(const point of turn.points.slice(1,-1))tasks.push({point,kind:'turn',lane,photo:null});
    }
    // Every two horizontal meters, plus the final boundary sample if needed.
    let nextPhoto=0;
    points.forEach((point,j)=>{
      const travelled=Math.abs(point[1]-from);let photo=null;
      if(travelled+1e-6>=nextPhoto||j===points.length-1){photo=photoCount++;nextPhoto=travelled+2;}
      tasks.push({point,kind:j===0?'turn':'survey',lane,photo});
    });
    lanes.push({part,lane,points});
  }
  const start=[area.start.east,area.start.north,model.surface(area.start.east,area.start.north)];
  if(!model.known[model.index(start[0],start[1])])throw new Error('Charging pad must have a measured height.');
  return {parts,lanes,start,photoCount,laneCount,spacing,options:{...options},area:{...area}};
}
