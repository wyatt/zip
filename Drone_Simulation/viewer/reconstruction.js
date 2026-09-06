// Renderer-independent, north-up raster. Values appear only after photo capture.
export function createReconstruction(meta,area,heights,classes,flags,sampleRGB=()=>[165,168,170]) {
  const resolution=meta.resolution,cols=Math.ceil((area.east-area.west)/resolution),rows=Math.ceil((area.north-area.south)/resolution),n=cols*rows;
  const data={version:1,revision:0,simulated:true,crs:'EPSG:32618',verticalCrs:'EPSG:5703',
    origin:[meta.origin.utm_m[0]+area.west,meta.origin.utm_m[1]+area.north],
    bounds:{west:area.west,east:area.east,south:area.south,north:area.north},resolution,rows,cols,order:'row-major, north to south; west to east',
    sources:{color:'NYS spring 2023 orthophoto',elevation:'Existing measured 2020 surface',note:'Simulated capture reveal; not photogrammetric reconstruction'},
    coveredCells:0,captures:[],coverage:new Uint16Array(n),elevation:new Float32Array(n).fill(NaN),
    measured:new Uint8Array(n),classes:new Uint8Array(n),rgba:new Uint8Array(n*4),
    firstSeenSeconds:new Float64Array(n).fill(NaN),lastSeenSeconds:new Float64Array(n).fill(NaN)};
  const seen=new Set();
  return {data,
    capture({id,position,time}){
      if(seen.has(id))return;seen.add(id);
      const [x,y]=position;
      // Nominal nadir photo footprint: 15 m east/west by 11 m north/south.
      const c0=Math.max(0,Math.ceil((x-7.5-area.west)/resolution-.5));
      const c1=Math.min(cols-1,Math.floor((x+7.5-area.west)/resolution-.5));
      const r0=Math.max(0,Math.ceil((area.north-y-5.5)/resolution-.5));
      const r1=Math.min(rows-1,Math.floor((area.north-y+5.5)/resolution-.5));
      for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){
        const i=r*cols+c,e=area.west+(c+.5)*resolution,north=area.north-(r+.5)*resolution;
        if(!data.coverage[i]){
          data.coveredCells++;data.firstSeenSeconds[i]=time;
          const sr=Math.floor((meta.y0-north)/resolution),sc=Math.floor((e-meta.x0)/resolution),si=sr*meta.cols+sc;
          if(sr>=0&&sr<meta.rows&&sc>=0&&sc<meta.cols){
            data.measured[i]=Number.isFinite(heights[si])&&(flags[si]&1)?1:0;
            if(data.measured[i])data.elevation[i]=heights[si];
            data.classes[i]=classes[si];
            data.rgba.set([...sampleRGB(e,north),255],i*4);
          }
        }
        data.coverage[i]=Math.min(65535,data.coverage[i]+1);data.lastSeenSeconds[i]=time;
      }
      data.captures.push({id,time,position:position.slice(),footprintMeters:[15,11]});data.revision++;
    },
    toJSON(){return JSON.stringify(data,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v);}
  };
}
