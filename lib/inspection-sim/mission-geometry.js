const EPS=1e-7;

const point=p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)?[Number(p[0]),Number(p[1])]:null;
const same=(a,b)=>Math.abs(a[0]-b[0])<EPS&&Math.abs(a[1]-b[1])<EPS;
const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const onSegment=(a,b,p)=>Math.abs(orient(a,b,p))<EPS&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;
function intersects(a,b,c,d){
  const ab1=orient(a,b,c),ab2=orient(a,b,d),cd1=orient(c,d,a),cd2=orient(c,d,b);
  return (ab1*ab2<-EPS&&cd1*cd2<-EPS)||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);
}

export function pointInRing(p,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if(onSegment(a,b,p))return true;
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}

export function pointInPolygon(p,polygon){
  return pointInRing(p,polygon[0])&&!polygon.slice(1).some(ring=>pointInRing(p,ring));
}

function signedArea(ring){let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1];}return area/2;}

function cleanRing(input){
  if(!Array.isArray(input))throw new Error('Each polygon ring must be an array of points.');
  const ring=[];for(const raw of input){const p=point(raw);if(!p)throw new Error('Polygon coordinates must be finite [east, north] pairs.');if(!ring.length||!same(ring.at(-1),p))ring.push(p);}
  if(ring.length>1&&same(ring[0],ring.at(-1)))ring.pop();
  if(ring.length<3)throw new Error('Each polygon ring needs at least three distinct vertices.');
  if(Math.abs(signedArea(ring))<1)throw new Error('Polygon rings must enclose at least one square metre.');
  for(let i=0;i<ring.length;i++)for(let j=i+1;j<ring.length;j++){
    if(j===i||j===(i+1)%ring.length||i===(j+1)%ring.length)continue;
    if(intersects(ring[i],ring[(i+1)%ring.length],ring[j],ring[(j+1)%ring.length]))throw new Error('Polygon rings cannot cross themselves.');
  }
  return ring;
}

export function normalizePolygon(value,{halfSize=Infinity,maxArea=25_000_000}={}){
  let rings=value?.type==='Polygon'?value.coordinates:value;
  if(!Array.isArray(rings)||!rings.length)throw new Error('Provide a polygon as rings or GeoJSON Polygon coordinates.');
  if(Array.isArray(rings[0]?.[0])&&typeof rings[0][0][0]==='number')rings=rings;
  else if(typeof rings[0]?.[0]==='number')rings=[rings];
  else throw new Error('Invalid polygon coordinates.');
  rings=rings.map(cleanRing);
  for(const ring of rings)for(const p of ring)if(Math.abs(p[0])>halfSize||Math.abs(p[1])>halfSize)throw new Error('Polygon leaves the acquired regional domain.');
  for(let h=1;h<rings.length;h++)if(!pointInRing(rings[h][0],rings[0]))throw new Error('Polygon holes must lie inside the outer ring.');
  for(let i=0;i<rings.length;i++)for(let j=i+1;j<rings.length;j++)for(let a=0;a<rings[i].length;a++)for(let b=0;b<rings[j].length;b++)
    if(intersects(rings[i][a],rings[i][(a+1)%rings[i].length],rings[j][b],rings[j][(b+1)%rings[j].length]))throw new Error('Polygon rings cannot intersect.');
  const area=Math.abs(signedArea(rings[0]))-rings.slice(1).reduce((sum,ring)=>sum+Math.abs(signedArea(ring)),0);
  if(!(area>0)||area>maxArea)throw new Error(`Polygon area must be between 1 and ${maxArea.toLocaleString()} m².`);
  return rings;
}

export function polygonBounds(polygon){
  const points=polygon.flat();return {west:Math.min(...points.map(p=>p[0])),east:Math.max(...points.map(p=>p[0])),south:Math.min(...points.map(p=>p[1])),north:Math.max(...points.map(p=>p[1]))};
}

export function scanSegments(polygon,spacing){
  if(!(spacing>0))throw new Error('Track spacing must be positive.');
  const bounds=polygonBounds(polygon),segments=[];
  const first=Math.ceil(bounds.south/spacing)*spacing;
  for(let y=first;y<=bounds.north+EPS;y+=spacing){
    const xs=[];
    for(const ring of polygon)for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
    }
    xs.sort((a,b)=>a-b);
    for(let i=0;i+1<xs.length;i+=2)if(xs[i+1]-xs[i]>=2)segments.push([[xs[i]+.5,y],[xs[i+1]-.5,y]]);
  }
  segments.forEach((segment,i)=>{if(i%2)segment.reverse();});
  if(!segments.length)throw new Error('Polygon is too narrow for the selected track spacing.');
  return segments;
}

export function seededPointInPolygon(polygon,seed=1){
  let state=(Number(seed)>>>0)||1;const random=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/4294967296),bounds=polygonBounds(polygon);
  for(let i=0;i<10000;i++){const p=[bounds.west+random()*(bounds.east-bounds.west),bounds.south+random()*(bounds.north-bounds.south)];if(pointInPolygon(p,polygon))return p;}
  throw new Error('Could not place a search target inside the polygon.');
}

class Heap{
  constructor(){this.items=[];}
  push(value,priority){const item={value,priority};this.items.push(item);let i=this.items.length-1;while(i){const p=(i-1)>>1;if(this.items[p].priority<=priority)break;this.items[i]=this.items[p];i=p;}this.items[i]=item;}
  pop(){if(!this.items.length)return null;const root=this.items[0],last=this.items.pop();if(this.items.length){let i=0;while(true){let c=i*2+1;if(c>=this.items.length)break;if(c+1<this.items.length&&this.items[c+1].priority<this.items[c].priority)c++;if(this.items[c].priority>=last.priority)break;this.items[i]=this.items[c];i=c;}this.items[i]=last;}return root.value;}
  get length(){return this.items.length;}
}

export function astarGrid({rows,cols,start,goal,height,allowed=()=>true,canMove=()=>true}){
  const key=(r,c)=>r*cols+c,sr=Math.max(0,Math.min(rows-1,start[0])),sc=Math.max(0,Math.min(cols-1,start[1])),gr=Math.max(0,Math.min(rows-1,goal[0])),gc=Math.max(0,Math.min(cols-1,goal[1]));
  const begin=key(sr,sc),end=key(gr,gc),open=new Heap(),cost=new Map([[begin,0]]),came=new Map(),closed=new Set();open.push(begin,0);
  const dirs=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  while(open.length){
    const current=open.pop();if(closed.has(current))continue;closed.add(current);if(current===end){const path=[];for(let k=current;k!==undefined;k=came.get(k))path.push([Math.floor(k/cols),k%cols]);return path.reverse();}
    const r=Math.floor(current/cols),c=current%cols,g=cost.get(current),z=height(r,c);
    for(const [dr,dc] of dirs){const rr=r+dr,cc=c+dc;if(rr<0||cc<0||rr>=rows||cc>=cols||!allowed(rr,cc)||!canMove(r,c,rr,cc))continue;const next=key(rr,cc),nz=height(rr,cc);if(!Number.isFinite(nz))continue;
      const step=Math.hypot(dr,dc)+(Math.max(0,nz-z)/12)+Math.abs(nz-z)/60,ng=g+step;
      if(ng>=(cost.get(next)??Infinity))continue;cost.set(next,ng);came.set(next,current);open.push(next,ng+Math.hypot(gr-rr,gc-cc));
    }
  }
  throw new Error('No terrain route exists inside the selected domain.');
}
