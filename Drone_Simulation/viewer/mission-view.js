import * as THREE from 'three';

export function createMissionView(scene,baseline) {
  const root=new THREE.Group();scene.add(root);root.visible=false;
  const drone=new THREE.Group();root.add(drone);
  const material=new THREE.MeshBasicMaterial({color:0xfff5d0,depthTest:false});
  const body=new THREE.Mesh(new THREE.SphereGeometry(1.8,12,8),material);drone.add(body);
  const arms=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-3,0,-3),new THREE.Vector3(3,0,3),new THREE.Vector3(-3,0,3),new THREE.Vector3(3,0,-3)
  ]),new THREE.LineBasicMaterial({color:0xffb850,depthTest:false}));drone.add(arms);
  for(const x of [-3,3])for(const z of [-3,3]){
    const ring=new THREE.Mesh(new THREE.RingGeometry(1.1,1.5,16),new THREE.MeshBasicMaterial({color:0xffb850,side:THREE.DoubleSide,depthTest:false}));
    ring.rotation.x=-Math.PI/2;ring.position.set(x,0,z);drone.add(ring);
  }
  drone.traverse(o=>o.renderOrder=30);
  let plan=null,paths=[],active=null,lastRevision=-1;
  const world=p=>new THREE.Vector3(p[0],p[2]-baseline,-p[1]);
  function disposeLine(line){root.remove(line);line.geometry.dispose();line.material.dispose();}
  function line(points,color,opacity){
    const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(world)),new THREE.LineBasicMaterial({color,transparent:true,opacity,depthTest:false,depthWrite:false}));l.renderOrder=20;root.add(l);return l;
  }
  function rebuild(){
    paths.forEach(disposeLine);paths=[];
    if(plan)plan.parts.forEach((tasks,i)=>paths.push(line(tasks.map(t=>t.point),i===0?0x76dce7:0xffb765,.42)));
    lastRevision=-1;
  }
  return {
    setPlan(value){plan=value;root.visible=!!value;rebuild();},
    update(sim){
      if(!sim){root.visible=false;return;}
      root.visible=true;
      const p=world(sim.position);drone.position.copy(p);
      if(lastRevision!==sim.routeRevision){
        if(active)disposeLine(active);
        active=sim.route.length?line(sim.route,0xffe36d,.95):null;
        lastRevision=sim.routeRevision;
      }
      if(active)active.visible=['outbound','return'].includes(sim.phase);
      body.material.color.set(sim.phase==='charging'?0x9ef0a3:0xfff5d0);
    },
    dispose(){paths.forEach(disposeLine);if(active)disposeLine(active);scene.remove(root);
      drone.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});},
  };
}
