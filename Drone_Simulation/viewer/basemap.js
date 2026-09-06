import * as THREE from 'three';
import proj4 from 'proj4';

const HALF = 20037508.342789244;
const UTM = '+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs';

// Standard OSM tiles, requested only for the visible map viewport. Browser HTTP
// caching is left intact. No offline archive, prefetch, proxy or tile scraping.
export function createBasemap(scene, meta, elevation, invalidate, onStatus) {
  const group = new THREE.Group(); scene.add(group);
  const center = [meta.origin.utm_m[0]+meta.x0+meta.cols*meta.resolution/2,
    meta.origin.utm_m[1]+meta.y0-meta.rows*meta.resolution/2];
  const halfWidth=meta.cols*meta.resolution/2, halfDepth=meta.rows*meta.resolution/2;
  // Keep only fragments inside the exact model footprint, even during tilt/fade.
  const clippingPlanes=[
    new THREE.Plane(new THREE.Vector3(1,0,0),halfWidth),
    new THREE.Plane(new THREE.Vector3(-1,0,0),halfWidth),
    new THREE.Plane(new THREE.Vector3(0,0,1),halfDepth),
    new THREE.Plane(new THREE.Vector3(0,0,-1),halfDepth),
  ];
  const projection = proj4(UTM, 'EPSG:3857');
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0,1,0), -elevation);
  const tiles = new Map(), loader = new THREE.TextureLoader();
  let opacity=1, disposed=false, lastKey='', scheduleKey='', timer=null;
  const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    [-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]].map(([x,z])=>new THREE.Vector3(x*meta.cols*meta.resolution/2,elevation+.2,z*meta.rows*meta.resolution/2))),
    new THREE.LineDashedMaterial({color:0x577f79,dashSize:4,gapSize:3,transparent:true,depthWrite:false}));
  outline.computeLineDistances(); group.add(outline);
  // Opaque map-only backing prevents aerial imagery flashing through late tiles.
  const backing = new THREE.Mesh(new THREE.PlaneGeometry(halfWidth*2,halfDepth*2),
    new THREE.MeshBasicMaterial({color:0xe8ede8,toneMapped:false}));
  backing.rotation.x=-Math.PI/2;backing.position.y=elevation-.1;group.add(backing);

  function status() {
    const active = [...tiles.values()].filter(t=>t.wanted);
    const failed = active.filter(t=>t.failed).length;
    onStatus(failed ? 'Some street tiles unavailable · measured surface remains available' :
      active.some(t=>!t.loaded) ? 'Loading street map…' : 'OpenStreetMap · same extent as the 3D model');
  }
  function update(camera, width, height) {
    if(disposed || opacity===0) return;
    camera.updateMatrixWorld();
    const bounds=[], worldBounds=[];
    for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      ray.setFromCamera(new THREE.Vector2(x,y),camera);
      const point=ray.ray.intersectPlane(plane,new THREE.Vector3());
      if(!point)return;
      worldBounds.push(point);
      bounds.push(projection.forward([center[0]+point.x,center[1]-point.z]));
    }
    const xs=bounds.map(p=>p[0]), ys=bounds.map(p=>p[1]);
    const pixelSize=Math.max((Math.max(...xs)-Math.min(...xs))/width,(Math.max(...ys)-Math.min(...ys))/height);
    // Acquire tiles only where the viewport overlaps the model, rather than the
    // whole surrounding map. Edge tiles are visually clipped by the four planes.
    const left=Math.max(-halfWidth,Math.min(...worldBounds.map(p=>p.x)));
    const right=Math.min(halfWidth,Math.max(...worldBounds.map(p=>p.x)));
    const top=Math.max(-halfDepth,Math.min(...worldBounds.map(p=>p.z)));
    const bottom=Math.min(halfDepth,Math.max(...worldBounds.map(p=>p.z)));
    if(left>=right || top>=bottom){
      for(const tile of tiles.values()){
        tile.wanted=false;group.remove(tile.mesh);tile.mesh.geometry.dispose();tile.mesh.material.dispose();tile.texture?.dispose();
      }
      const changed=tiles.size>0;tiles.clear();lastKey='';status();if(changed)invalidate();return;
    }
    const clipped=[[left,top],[right,top],[right,bottom],[left,bottom]]
      .map(([x,z])=>projection.forward([center[0]+x,center[1]-z]));
    const minX=Math.min(...clipped.map(p=>p[0])),maxX=Math.max(...clipped.map(p=>p[0]));
    const minY=Math.min(...clipped.map(p=>p[1])),maxY=Math.max(...clipped.map(p=>p[1]));
    let zoom=Math.min(19,Math.max(12,Math.round(Math.log2(2*HALF/(256*pixelSize)))));
    let extent;
    do {
      const size=2*HALF/(2**zoom), max=2**zoom-1;
      extent=[Math.max(0,Math.floor((minX+HALF)/size)),Math.min(max,Math.floor((maxX+HALF)/size)),
        Math.max(0,Math.floor((HALF-maxY)/size)),Math.min(max,Math.floor((HALF-minY)/size))];
      if((extent[1]-extent[0]+1)*(extent[3]-extent[2]+1)<=64)break;
      zoom--;
    } while(zoom>0);
    const key=[zoom,...extent].join('/');if(key===lastKey)return;lastKey=key;
    const wanted=new Set();
    for(let x=extent[0];x<=extent[1];x++)for(let y=extent[2];y<=extent[3];y++)wanted.add(`${zoom}/${x}/${y}`);
    // GPU memory is bounded to the current viewport. Browser cache handles revisits.
    for(const [id,tile] of tiles)if(!wanted.has(id)) {
      tile.wanted=false;group.remove(tile.mesh);tile.mesh.geometry.dispose();tile.mesh.material.dispose();tile.texture?.dispose();tiles.delete(id);
    }
    for(const id of wanted) {
      if(tiles.has(id))continue;
      const [z,x,y]=id.split('/').map(Number), size=2*HALF/(2**z);
      const west=x*size-HALF,east=west+size,north=HALF-y*size,south=north-size;
      const coordinates=[[west,north],[east,north],[east,south],[west,south]].flatMap(p=>{
        const [e,n]=projection.inverse(p);return [e-center[0],elevation,center[1]-n];
      });
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(coordinates,3));
      geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,0,0,0],2));geometry.setIndex([0,2,1,0,3,2]);
      const material=new THREE.MeshBasicMaterial({transparent:true,opacity,depthWrite:false,toneMapped:false,clippingPlanes});
      const mesh=new THREE.Mesh(geometry,material);mesh.visible=false;mesh.renderOrder=1;group.add(mesh);
      const tile={mesh,wanted:true,loaded:false,failed:false};tiles.set(id,tile);
      tile.texture=loader.load(`https://tile.openstreetmap.org/${id}.png`,texture=>{
        if(disposed||!tile.wanted){texture.dispose();return;}
        texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;
        material.map=texture;material.needsUpdate=true;mesh.visible=true;tile.loaded=true;status();invalidate();
      },undefined,()=>{if(!disposed&&tile.wanted){tile.failed=true;status();invalidate();}});
    }
    status();
  }
  return {
    schedule(camera,width,height){
      const key=[...camera.position.toArray(),...camera.quaternion.toArray(),camera.zoom,width,height].join('/');
      if(key===scheduleKey)return;
      scheduleKey=key;clearTimeout(timer);timer=setTimeout(()=>update(camera,width,height),140);
    },
    setOpacity(value){opacity=value;group.visible=value>0;outline.material.opacity=value;
      for(const tile of tiles.values())tile.mesh.material.opacity=value;
      if(value===0){clearTimeout(timer);scheduleKey='';}
    },
    get opacity(){return opacity;},
    dispose(){disposed=true;clearTimeout(timer);scene.remove(group);for(const t of tiles.values()){t.wanted=false;t.texture?.dispose();t.mesh.geometry.dispose();t.mesh.material.dispose();}tiles.clear();outline.geometry.dispose();outline.material.dispose();backing.geometry.dispose();backing.material.dispose();},
  };
}
