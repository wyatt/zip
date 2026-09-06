import * as THREE from 'three';
import {mapSurfaceRGB} from './surface-colors.js';

// A single aligned map texture from the existing categories and orthophoto.
// No labels or additional source requests; only displayed colors are changed.
export function createStudyMap(scene,meta,elevation,codes,sourceColors){
  const pixels=new Uint8Array(meta.rows*meta.cols*4);
  for(let i=0;i<codes.length;i++){
    const rgb=mapSurfaceRGB([sourceColors[i*4],sourceColors[i*4+1],sourceColors[i*4+2]],codes[i]);
    pixels.set([...rgb,255],i*4);
  }
  const texture=new THREE.DataTexture(pixels,meta.cols,meta.rows);
  texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
  const geometry=new THREE.PlaneGeometry(meta.cols*meta.resolution,meta.rows*meta.resolution);
  const uv=geometry.attributes.uv;for(let i=0;i<uv.count;i++)uv.setY(i,1-uv.getY(i));
  const material=new THREE.MeshBasicMaterial({map:texture,toneMapped:false});
  const mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=-Math.PI/2;mesh.position.y=elevation;scene.add(mesh);
  return {schedule(){},setOpacity(value){mesh.visible=value>0;},dispose(){scene.remove(mesh);texture.dispose();geometry.dispose();material.dispose();}};
}
