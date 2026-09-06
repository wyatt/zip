import * as THREE from 'three';
import {selectRegionalTiles} from './regional-geometry.js';
import {coverStyle} from './surface-colors.js';
import {createPhotoMaterial} from './photo-material.js';
import {fetchTerrain,isMeasured} from './regional-data.js';

// The regional Chesapeake layer uses 0 for the lake/outside-land footprint.
// Render it with the same water group as the classified open-water codes.
const regionalCoverStyle=code=>code===0?5:coverStyle(code);

export async function loadRegionManifest(url){
  const response=await fetch(`${url}manifest.json`);
  if(!response.ok)throw new Error(`Regional map: HTTP ${response.status}. Run the regional acquisition/export first.`);
  const meta=await response.json();
  if(![1,2].includes(meta.version)||meta.size!==5000||meta.tileSize!==500||meta.tiles.length!==100||meta.overviewResolution!==25)
    throw new Error('Unsupported regional map manifest');
  return meta;
}

export async function createRegionalTerrain(scene,{url,meta,baseline,requestRender,onLocalDetail=()=>{},onStatus=()=>{}}){
  let disposed=false,localDetail=false,activeLoads=0,timer=0,lastCamera=null,focus=null,focusPlanes=null;
  const group=new THREE.Group();scene.add(group);
  const maskBytes=new Uint8Array(10*10),mask=new THREE.DataTexture(maskBytes,10,10,THREE.RedFormat);
  mask.magFilter=mask.minFilter=THREE.NearestFilter;mask.needsUpdate=true;
  const resident=new Map(),cache=new Map(),pending=new Map(),failed=new Set(),tileById=new Map(meta.tiles.map(tile=>[tile.id,tile]));let desired=new Map();
  const CACHE_LIMIT=24;
  const textureLoader=new THREE.TextureLoader();
  const frustum=new THREE.Frustum(),matrix=new THREE.Matrix4();
  function material(texture,overview,size){
    // Start with the exact material used by the original 512 m columns, then
    // add only the regional LOD clipping needed to swap overview/detail tiles.
    const m=createPhotoMaterial(texture,size,size,meta.zMax-baseline+3);
    m.clippingPlanes=focusPlanes;
    m.userData.uniforms={regionMask:{value:mask},isOverview:{value:overview},localDetail:{value:localDetail&&!focus}};
    const compilePhoto=m.onBeforeCompile,photoKey=m.customProgramCacheKey;
    m.onBeforeCompile=shader=>{
      compilePhoto(shader);
      Object.assign(shader.uniforms,m.userData.uniforms);
      shader.vertexShader=shader.vertexShader
        .replace('#include <common>','#include <common>\nvarying vec3 regionalWorld;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\nregionalWorld=(modelMatrix*instanceMatrix*vec4(position,1.0)).xyz;')
        // Internal tile boundaries are LOD seams, not display-plinth cuts.
        .replace('vOuterSide = max(','vOuterSide = 0.0 * max(');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        varying vec3 regionalWorld; uniform sampler2D regionMask; uniform bool isOverview,localDetail;
      `)
        .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
          if(localDetail && abs(regionalWorld.x)<256.0 && abs(regionalWorld.z)<256.0) discard;
          if(isOverview && texture2D(regionMask,(regionalWorld.xz+vec2(2500.0))/5000.0).r>0.5) discard;
        `);
    };
    m.customProgramCacheKey=()=>`${photoKey()}-regional-columns-v1`;return m;
  }
  function columnMesh(tile,level,heights,codes,texture,overview){
    const geometry=new THREE.BoxGeometry(level,level,level);
    const mesh=new THREE.InstancedMesh(geometry,material(texture,overview,tile.size),heights.length);
    const n=tile.size/level,matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),
      rotation=new THREE.Quaternion(),color=new THREE.Color();
    let instance=0;
    for(let i=0;i<heights.length;i++){
      if(!Number.isFinite(heights[i]))continue;
      const r=Math.floor(i/n),c=i%n,height=Math.max(.01,heights[i]-baseline);
      position.set((c+.5)*level-tile.size/2,height/2,(r+.5)*level-tile.size/2);
      scale.set(1,height/level,1);matrix.compose(position,rotation,scale);mesh.setMatrixAt(instance,matrix);
      color.setRGB(regionalCoverStyle(codes[i]),codes[i]===21?1:0,0);mesh.setColorAt(instance,color);instance++;
    }
    mesh.count=instance;mesh.position.set(tile.west+tile.size/2,0,-tile.north+tile.size/2);
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.castShadow=false;mesh.receiveShadow=true;mesh.computeBoundingSphere();
    return mesh;
  }
  async function read(path,T,signal){
    const response=await fetch(path,{signal});if(!response.ok)throw new Error(`Regional tile: HTTP ${response.status}`);
    return new T(await response.arrayBuffer());
  }
  function free(tile){group.remove(tile.mesh);tile.mesh.geometry.dispose();tile.mesh.material.dispose();tile.texture.dispose();}
  function detach(tile){group.remove(tile.mesh);}
  function cacheTile(id,tile){
    const previous=cache.get(id);if(previous&&previous!==tile)free(previous);
    cache.delete(id);cache.set(id,tile);
    while(cache.size>CACHE_LIMIT){
      const stale=[...cache].find(([key])=>!resident.has(key));if(!stale)break;
      cache.delete(stale[0]);free(stale[1]);
    }
  }
  function updateMask(){
    maskBytes.fill(0);
    for(const [id] of resident){const [r,c]=id.split('-').map(Number);maskBytes[r*10+c]=255;}
    mask.needsUpdate=true;
  }
  function intersectsFocus(tile){return !focus||tile.west<focus.east&&tile.west+tile.size>focus.west&&tile.north>focus.south&&tile.north-tile.size<focus.north;}
  async function load(tile,level,overview=false,signal){
    const folder=overview?`${url}overview/`:`${url}tiles/${tile.id}/${level}/`;
    const texturePath=overview?`${folder}aerial.jpg`:`${url}tiles/${tile.id}/${level===1?'aerial.jpg':'aerial-5m.jpg'}`;
    let texture;
    const terrainPromise=meta.version>=2?fetchTerrain(`${folder}terrain.bin.gz`,signal):Promise.all([
      read(`${folder}elevation.f32`,Float32Array,signal),read(`${folder}classes.u8`,Uint8Array,signal),read(`${folder}measured.u8`,Uint8Array,signal),
    ]).then(([heights,codes,measured])=>({rows:tile.size/level,cols:tile.size/level,heights,codes,measured,measuredPacked:false}));
    // Promise.allSettled ensures a failed terrain fetch cannot leak a later texture.
    const results=await Promise.allSettled([terrainPromise,textureLoader.loadAsync(texturePath)]);
    if(results[1].status==='fulfilled')texture=results[1].value;
    const error=results.find(result=>result.status==='rejected');
    if(error||disposed||signal?.aborted){texture?.dispose();throw error?.reason??new Error('Regional load cancelled');}
    const data=results[0].value,{heights,codes,measured}=data;
    const n=tile.size/level;
    if(data.rows!==n||data.cols!==n||heights.length!==n*n||codes.length!==n*n){texture.dispose();throw new Error('Regional tile buffers are misaligned');}
    texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    const mesh=columnMesh(tile,level,heights,codes,texture,overview);
    mesh.userData.regional={tile,level,heights,codes,measured,measuredPacked:data.measuredPacked};
    return {mesh,texture,level};
  }
  const overview=await load({size:5000,west:-2500,north:2500},25,true);
  group.add(overview.mesh);
  function report(){onStatus(failed.size?'Some detail tiles failed; overview remains available':`${resident.size} detail tiles loaded${activeLoads?' · Loading detail…':''}`);}
  function pump(){
    if(disposed)return;
    for(const [id,wanted] of desired){
      if(activeLoads>=2)break;
      if(resident.get(id)?.level===wanted.level||pending.has(id)||failed.has(`${id}/${wanted.level}`))continue;
      const cached=cache.get(id);
      if(cached?.level===wanted.level){
        const previous=resident.get(id);if(previous&&previous!==cached)detach(previous);
        resident.set(id,cached);group.add(cached.mesh);cache.delete(id);cache.set(id,cached);updateMask();requestRender();continue;
      }
      const controller=new AbortController();pending.set(id,controller);activeLoads++;
      load(wanted.tile,wanted.level,false,controller.signal).then(result=>{
        const current=desired.get(id);
        if(disposed||current?.level!==result.level){free(result);return;}
        const previous=resident.get(id);if(previous&&previous!==result)detach(previous);
        resident.set(id,result);group.add(result.mesh);cacheTile(id,result);updateMask();requestRender();
      }).catch(error=>{
        if(!disposed&&!controller.signal.aborted){failed.add(`${id}/${wanted.level}`);console.warn(error.message);}
      }).finally(()=>{pending.delete(id);activeLoads--;if(!disposed){report();pump();}});
    }
    report();
  }
  function select(){
    timer=0;if(!lastCamera||disposed)return;
    const {camera,width,target}=lastCamera;
    camera.updateMatrixWorld();matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(matrix);
    const worldPerPixel=(camera.right-camera.left)/(camera.zoom*width);
    const nextLocal=worldPerPixel<3;
    if(nextLocal!==localDetail){
      localDetail=nextLocal;
      const showLocal=localDetail&&!focus;overview.mesh.material.userData.uniforms.localDetail.value=showLocal;
      for(const entry of resident.values())entry.mesh.material.userData.uniforms.localDetail.value=showLocal;
      onLocalDetail(showLocal);requestRender();
    }
    const wanted=selectRegionalTiles(meta.tiles,{x:target.x,z:target.z,worldPerPixel,
      visible:tile=>intersectsFocus(tile)&&frustum.intersectsBox(new THREE.Box3(new THREE.Vector3(tile.west,meta.zMin-baseline,-tile.north),new THREE.Vector3(tile.west+tile.size,meta.zMax-baseline,-tile.north+tile.size)))});
    desired=new Map(wanted.map(value=>[value.tile.id,value]));
    for(const [id,entry] of resident)if(!desired.has(id)){detach(entry);resident.delete(id);}
    for(const [id,controller] of pending)if(!desired.has(id))controller.abort();
    updateMask();pump();requestRender();
  }
  return {
    group,
    setFocus(bounds){
      focus=bounds?{west:bounds.west,east:bounds.east,south:bounds.south,north:bounds.north}:null;
      focusPlanes=focus?[new THREE.Plane(new THREE.Vector3(1,0,0),-focus.west),new THREE.Plane(new THREE.Vector3(-1,0,0),focus.east),new THREE.Plane(new THREE.Vector3(0,0,1),focus.north),new THREE.Plane(new THREE.Vector3(0,0,-1),-focus.south)]:null;
      const showLocal=localDetail&&!focus;
      for(const entry of [overview,...cache.values()]){entry.mesh.material.clippingPlanes=focusPlanes;entry.mesh.material.userData.uniforms.localDetail.value=showLocal;entry.mesh.material.needsUpdate=true;}
      if(focus)for(const [id,entry] of [...cache])if(!intersectsFocus(tileById.get(id))){cache.delete(id);resident.delete(id);free(entry);}
      if(focus)for(const [id,controller] of pending)if(!intersectsFocus(tileById.get(id)))controller.abort();
      updateMask();onLocalDetail(showLocal);if(lastCamera){lastCamera.signature='';clearTimeout(timer);timer=setTimeout(select,0);}requestRender();
    },
    update(camera,width,target){
      const signature=[camera.zoom,camera.position.x,camera.position.y,camera.position.z,target.x,target.y,target.z,width].join(',');
      if(lastCamera?.signature===signature)return;
      lastCamera={camera,width,target,signature};clearTimeout(timer);timer=setTimeout(select,120);
    },
    hover(raycaster){
      const hit=raycaster.intersectObjects(group.children,false)[0];if(!hit)return null;
      if(focus&&(hit.point.x<focus.west||hit.point.x>focus.east||-hit.point.z<focus.south||-hit.point.z>focus.north))return null;
      if(localDetail&&Math.abs(hit.point.x)<256&&Math.abs(hit.point.z)<256)return null;
      const data=hit.object.userData.regional,{tile,level,heights,codes}=data;
      const n=tile.size/level,c=Math.min(n-1,Math.max(0,Math.floor((hit.point.x-tile.west)/level))),r=Math.min(n-1,Math.max(0,Math.floor((hit.point.z+tile.north)/level))),i=r*n+c;
      return {x:hit.point.x,y:-hit.point.z,elevation:heights[i],code:codes[i],label:`${meta.legend[String(codes[i])]??'Unknown cover'} · ${level} m display${isMeasured(data,i)?'':' · Estimated'}`};
    },
    pick(raycaster){return this.hover(raycaster);},
    dispose(){disposed=true;clearTimeout(timer);pending.forEach(controller=>controller.abort());free(overview);cache.forEach(free);cache.clear();resident.clear();mask.dispose();scene.remove(group);},
  };
}
