// Render-only surface interpolation. Source samples/validity stay separate.
export function surfaceGeometryData(heights,codes,rows,cols,resolution,west,north,baseline,coverStyle=()=>0){
  if(heights.length!==rows*cols)throw new Error('Misaligned regional surface');
  if(codes.length!==rows*cols)throw new Error('Misaligned regional cover');
  const stride=cols+1,positions=new Float32Array((rows+1)*stride*3),uv=new Float32Array((rows+1)*stride*2);
  const cover=new Float32Array((rows+1)*stride);
  const valid=new Uint8Array((rows+1)*stride);
  for(let r=0;r<=rows;r++)for(let c=0;c<=cols;c++){
    let sum=0,n=0,highest=-Infinity,highestCode=0;
    for(let rr=Math.max(0,r-1);rr<=Math.min(rows-1,r);rr++)for(let cc=Math.max(0,c-1);cc<=Math.min(cols-1,c);cc++){
      const cell=rr*cols+cc,z=heights[cell];
      if(Number.isFinite(z)){sum+=z;n++;if(z>highest){highest=z;highestCode=codes[cell];}}
    }
    const i=r*stride+c;positions.set([west+c*resolution,n?sum/n-baseline:0,-north+r*resolution],i*3);
    uv.set([c/cols,1-r/rows],i*2);cover[i]=coverStyle(highestCode);valid[i]=!!n;
  }
  const indices=[];
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const i=r*stride+c;
    if(valid[i]&&valid[i+1]&&valid[i+stride])indices.push(i,i+stride,i+1);
    if(valid[i+1]&&valid[i+stride]&&valid[i+stride+1])indices.push(i+1,i+stride,i+stride+1);
  }
  return {positions,uv,cover,indices:new Uint32Array(indices)};
}

export function selectRegionalTiles(tiles,{x,z,worldPerPixel,visible},maxTiles=20){
  // The 25 m overview already covers the complete region. Detail is streamed
  // only when it contributes visible pixels.
  if(worldPerPixel>=6)return [];
  const candidates=tiles.filter(tile=>visible(tile)).map(tile=>({tile,distance:Math.hypot(tile.west+tile.size/2-x,-tile.north+tile.size/2-z)}))
    .sort((a,b)=>a.distance-b.distance).slice(0,maxTiles);
  // At close range the four tiles around the target use the same one-metre
  // column scale as the registered centre patch. The rest stay at 5 m.
  return candidates.map(({tile},i)=>({tile,level:worldPerPixel<1.5&&i<4?1:5}));
}
