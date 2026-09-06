/** Display-only roof-edge repair. Original classes and heights are never edited.
 * Adjacent cells near a structure's roof elevation share its wall material;
 * their top materials still use their own original land-cover classes.
 */
export function buildingWallStyles(codes, heights, flags, rows, cols, resolution) {
  const walls=new Uint8Array(rows*cols);
  const radius=Math.ceil(3/resolution);
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++) {
    const cell=row*cols+col;
    if(codes[cell]!==21 || !(flags[cell]&1) || !Number.isFinite(heights[cell]))continue;
    walls[cell]=1;
    for(let dr=-radius;dr<=radius;dr++)for(let dc=-radius;dc<=radius;dc++) {
      if((dr*dr+dc*dc)*resolution*resolution>9)continue;
      const r=row+dr,c=col+dc;
      if(r<0||r>=rows||c<0||c>=cols)continue;
      const other=r*cols+c;
      if(!(flags[other]&1) || (codes[other]>=10 && codes[other]<=14))continue;
      if(Math.abs(heights[other]-heights[cell])<=2)walls[other]=1;
    }
  }
  return walls;
}
