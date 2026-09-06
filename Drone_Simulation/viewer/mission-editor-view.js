import * as THREE from 'three';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';

export function createMissionEditorView(scene,baseline,mapHeight){
  const root=new THREE.Group(),resolution=new THREE.Vector2(1,1);scene.add(root);
  const world=(p,height=mapHeight)=>new THREE.Vector3(p[0],(p[2]??height)-baseline+2,-p[1]);
  const circle=document.createElement('canvas');circle.width=circle.height=32;
  const context=circle.getContext('2d');context.fillStyle='#fff';context.beginPath();context.arc(16,16,15,0,Math.PI*2);context.fill();
  const circleTexture=new THREE.CanvasTexture(circle);
  function clear(){for(const child of [...root.children]){root.remove(child);child.geometry?.dispose();child.material?.dispose();}}
  function pointLayer(position,color,size){
    const geometry=new THREE.BufferGeometry().setFromPoints([position]),material=new THREE.PointsMaterial({color,size,map:circleTexture,alphaTest:.25,transparent:true,sizeAttenuation:false,depthTest:false,depthWrite:false});
    const points=new THREE.Points(geometry,material);points.renderOrder=40;root.add(points);
  }
  function dot(p,color,size=13){
    const position=world(p);pointLayer(position,0xffffff,size+4);pointLayer(position,color,size);return position;
  }
  function boundary(points){
    const geometry=new LineGeometry();geometry.setPositions(points.flatMap(p=>[p.x,p.y,p.z]));
    const material=new LineMaterial({color:0xffcc72,linewidth:2.5,worldUnits:false,depthTest:false,depthWrite:false,transparent:true,opacity:.96,alphaToCoverage:true});
    material.resolution.copy(resolution);const line=new Line2(geometry,material);line.computeLineDistances();line.renderOrder=35;root.add(line);
  }
  return {
    set({a,b,polygon,target,targetVisible=true}={}){
      clear();if(a)dot(a,0xd3f4a8);if(b)dot(b,0x76dce7);
      if(polygon)for(const ring of polygon){
        if(!ring?.length)continue;
        const points=ring.map(p=>world(p));if(points.length>2)points.push(points[0].clone());if(points.length>1)boundary(points);
        for(const p of ring)dot(p,0xffcc72,8);
      }
      if(target&&targetVisible)dot(target,0xff3d48,18);
    },
    setResolution(width,height){resolution.set(Math.max(1,width),Math.max(1,height));for(const child of root.children)if(child.material?.isLineMaterial)child.material.resolution.copy(resolution);},
    dispose(){clear();circleTexture.dispose();scene.remove(root);},
  };
}
