/** Fill every missing display height from nearby original measured cells.
 * Uses a 3×3 neighborhood, expanding only when fewer than four measurements
 * are available. Estimates never become inputs to other estimates or routing.
 * Signature retained for the existing viewer integration.
 */
export function repairRoofDisplay(heights,codes,flags,rows,cols,resolution) {
  const display=heights.slice(),stride=cols+1;
  const sums=new Float64Array((rows+1)*stride);
  const counts=new Uint32Array(sums.length);
  for(let row=0;row<rows;row++) {
    let rowSum=0,rowCount=0;
    for(let col=0;col<cols;col++) {
      const cell=row*cols+col,i=(row+1)*stride+col+1;
      if((flags[cell]&1)&&Number.isFinite(heights[cell])){rowSum+=heights[cell];rowCount++;}
      sums[i]=sums[i-stride]+rowSum;counts[i]=counts[i-stride]+rowCount;
    }
  }
  if(!counts[counts.length-1])throw new Error('Cannot estimate heights without any measured surface cells.');
  const box=(array,left,top,right,bottom)=>array[bottom*stride+right]-array[top*stride+right]-array[bottom*stride+left]+array[top*stride+left];
  const limit=Math.max(rows,cols);let repaired=0;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++) {
    const cell=row*cols+col;
    if((flags[cell]&1)&&Number.isFinite(heights[cell]))continue;
    for(let radius=1;;radius=Math.min(limit,radius*2)) {
      const left=Math.max(0,col-radius),right=Math.min(cols,col+radius+1);
      const top=Math.max(0,row-radius),bottom=Math.min(rows,row+radius+1);
      const n=box(counts,left,top,right,bottom);
      if(n>=4||(radius>=limit&&n>0)) {
        display[cell]=box(sums,left,top,right,bottom)/n;repaired++;break;
      }
    }
  }
  return {heights:display,repaired};
}
