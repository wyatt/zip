// Integration example: copy into your host and adjust this module path.
import {surfaceRGB, mapSurfaceRGB} from '../../../viewer/surface-colors.js';

/** Paint a live reconstruction or parsed JSON snapshot onto any canvas. */
export function createMosaicPainter(canvas, {style='model'}={}) {
  if(!['model','map','aerial'].includes(style))throw new Error('Unknown mosaic style');
  const context=canvas.getContext('2d');
  if(!context)throw new Error('A 2D canvas context is required');
  let previous=null,revision=-1,pixels=null;
  return function paint(data) {
    if(!data){
      context.clearRect(0,0,canvas.width,canvas.height);
      previous=null;revision=-1;pixels=null;return;
    }
    const {rows,cols,rgba,classes}=data;
    if(!Number.isInteger(rows)||!Number.isInteger(cols)||rows<1||cols<1||rows*cols>512*512||
      rgba?.length!==rows*cols*4||classes?.length!==rows*cols)
      throw new Error('Invalid or oversized reconstruction grid');
    if(previous===data&&revision===data.revision)return;
    if(previous!==data||pixels?.length!==rgba.length){
      pixels=new Uint8ClampedArray(rgba.length);
      canvas.width=cols;canvas.height=rows;
    }
    for(let i=0;i<rows*cols;i++){
      const offset=i*4;
      if(!rgba[offset+3]||pixels[offset+3])continue;
      const raw=[rgba[offset],rgba[offset+1],rgba[offset+2]];
      const color=style==='aerial'?raw:style==='map'?mapSurfaceRGB(raw,classes[i]):surfaceRGB(raw,classes[i]);
      pixels.set(color,offset);pixels[offset+3]=rgba[offset+3];
    }
    context.putImageData(new ImageData(pixels,cols,rows),0,0);
    previous=data;revision=data.revision;
  };
}
