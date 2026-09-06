import * as THREE from 'three';

// User-selected local UTM offsets in meters, relative to the current study origin.
export const inspection = Object.freeze({
  start: {east:27.5,north:-19.5},
  west:-246.5,east:-110.5,south:-244.5,north:140.5,
});

export function inspectionStartCell(meta,heights,flags) {
  const col=Math.round((inspection.start.east-meta.x0)/meta.resolution-.5);
  const row=Math.round((meta.y0-inspection.start.north)/meta.resolution-.5);
  const cell=row*meta.cols+col;
  if(row<0||row>=meta.rows||col<0||col>=meta.cols||!(flags[cell]&1)||!Number.isFinite(heights[cell]))
    throw new Error('The selected inspection start has no measured surface in this dataset.');
  return cell;
}

export function createInspectionOverlay(scene,meta,heights,flags,baseline,mapHeight) {
  const {west,east,south,north}=inspection;
  const cols=Math.ceil((east-west)/meta.resolution),rows=Math.ceil((north-south)/meta.resolution);
  const pixels=new Uint8Array(cols*rows*4);
  const texture=new THREE.DataTexture(pixels,cols,rows,THREE.RGBAFormat);
  texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;
  let previous=null,revision=-1;
  function updateCoverage(data){
    if(previous===data&&revision===(data?.revision??0))return;
    previous=data;revision=data?.revision??0;
    for(let i=0;i<cols*rows;i++)pixels.set(data?.coverage[i]?[74,220,105,255]:[255,223,70,255],i*4);
    texture.needsUpdate=true;
  }
  updateCoverage(null);
  const fill=new THREE.Mesh(
    new THREE.PlaneGeometry(east-west,north-south),
    new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.25,
      depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
  const uv=fill.geometry.attributes.uv;
  for(let i=0;i<uv.count;i++)uv.setY(i,1-uv.getY(i));
  fill.rotation.x=-Math.PI/2;
  fill.position.set((west+east)/2,mapHeight+8,-(north+south)/2);
  fill.renderOrder=11;
  scene.add(fill);
  // A floating area annotation, not a flight-altitude or route surface.
  return {updateCoverage,dispose(){texture.dispose();}};
}
