import { surfaceRGB } from './surface-colors.js';
// Canvas is only a view of the independent reconstruction raster.
export function bindReconstructionView(view){
  const canvas=document.getElementById('reconstruction-canvas'),ctx=canvas.getContext('2d');
  const status=document.getElementById('reconstruction-status'),download=document.getElementById('reconstruction-download');
  const panel=document.querySelector('.reconstruction-panel');
  panel.style.setProperty('--mosaic-ratio',canvas.width/canvas.height);
  let previous=null,revision=-1,pixels=null;
  download.onclick=()=>{
    const json=view.reconstructionJSON();if(!json)return;
    const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='inspection-reconstruction.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return ()=>{
    const data=view.reconstructionData();
    if(previous===data&&revision===(data?.revision??0))return;
    if(previous!==data)pixels=data?new Uint8ClampedArray(data.rgba.length):null;
    previous=data;revision=data?.revision??0;download.disabled=!data?.captures.length;
    if(!data){ctx.clearRect(0,0,canvas.width,canvas.height);status.textContent='Waiting for the first photo';return;}
    if(canvas.width!==data.cols||canvas.height!==data.rows){canvas.width=data.cols;canvas.height=data.rows;}
    panel.style.setProperty('--mosaic-ratio',data.cols/data.rows);
    for(let i=0;i<data.rows*data.cols;i++)if(data.rgba[i*4+3]&&!pixels[i*4+3]){
      pixels.set(surfaceRGB([data.rgba[i*4],data.rgba[i*4+1],data.rgba[i*4+2]],data.classes[i]),i*4);
      pixels[i*4+3]=data.rgba[i*4+3];
    }
    ctx.putImageData(new ImageData(pixels,data.cols,data.rows),0,0);
    status.textContent=`${(100*data.coveredCells/(data.totalCells??data.rows*data.cols)).toFixed(1)}% covered · ${data.captures.length.toLocaleString()} photos`;
  };
}
