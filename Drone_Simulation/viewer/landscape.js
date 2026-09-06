import { createReconstruction } from './reconstruction.js';
import { defaults, createSafetyModel, planInspection } from './mission-planner.js';
import { MissionSimulation } from './mission-simulation.js';
import { createMissionView } from './mission-view.js';
import { repairRoofDisplay } from './roof-display.js';
import { inspection, inspectionStartCell, createInspectionOverlay } from './inspection.js';
import { buildingWallStyles } from './wall-style.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPhotoMaterial, createBaseMaterial, coverStyle } from './photo-material.js';
import { loadRegionManifest, createRegionalTerrain } from './regional-terrain.js';
import {planRegionalMissionInWorker} from './regional-planner-client.js';
import {RegionalMissionSimulation} from './regional-mission-simulation.js';
import {createRegionalReconstruction} from './regional-reconstruction.js';
import {createMissionEditorView} from './mission-editor-view.js';
import aerialUrl from './assets/ithaca-2023.jpg';

/** Standalone, framework-free viewer. Rendering is on demand; dispose on unmount. */
export async function createLandscape(container, { dataUrl, onChange = () => {}, onProject = () => {}, onHover = () => {}, onMapClick = () => {}, onMapStatus = () => {}, onPlanning = () => {}, onMissionEvent = () => {}, onMission = () => {} } = {}) {
  const read = async (name, type) => {
    const response = await fetch(`${dataUrl}${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return type === 'json' ? response.json() : response.arrayBuffer();
  };
  const [meta, zBuffer, cBuffer, fBuffer] = await Promise.all([
    read('manifest.json','json'), read('elevation.f32'), read('classes.u8'), read('flags.u8'),
  ]);
  const regionUrl=`${dataUrl.replace(/data\/?$/, '')}region/`;
  let regionMeta=null;
  try { regionMeta=await loadRegionManifest(regionUrl); }
  catch { /* The local 512 m package remains usable before regional acquisition. */ }
  meta.regionalExtent=regionMeta?.size??null;
  const heights = new Float32Array(zBuffer), codes = new Uint8Array(cBuffer), flags = new Uint8Array(fBuffer);
  const {rows, cols, resolution: res} = meta, count = rows * cols;
  if (heights.length !== count || codes.length !== count || flags.length !== count || count > 512*512) throw new Error('Invalid or oversized aligned surface buffers');
  // This verified texture is registered to the existing 512 m study crop.
  // Fail rather than silently misregister it if another data extent is supplied.
  if(meta.rows!==512 || meta.cols!==512 || res!==1 || meta.x0!==-256 || meta.y0!==256 ||
      Math.abs(meta.origin.utm_m[0]-377760.2293770153)>.001 ||
      Math.abs(meta.origin.utm_m[1]-4700577.510997841)>.001)
    throw new Error('The 2023 aerial texture is registered to the original study crop; export matching imagery for another extent.');
  const aerial = await new THREE.TextureLoader().loadAsync(aerialUrl);
  aerial.colorSpace=THREE.SRGBColorSpace;
  aerial.wrapS=aerial.wrapT=THREE.ClampToEdgeWrapping;
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  aerial.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const span = Math.max(rows,cols)*res;
  const worldSpan=regionMeta?.size??span;
  const camera = new THREE.OrthographicCamera(-worldSpan, worldSpan, worldSpan, -worldSpan, .1, Math.max(3000,worldSpan*3));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.minZoom = .4; controls.maxZoom = 12;
  controls.maxPolarAngle = Math.PI*.485;
  controls.screenSpacePanning = true;
  controls.listenToKeyEvents(container);
  controls.keyPanSpeed = 18;
  scene.add(new THREE.HemisphereLight(0xe3f0f5, 0x46553b, 1.5));
  const sun = new THREE.DirectionalLight(0xffefd5, 2.3);
  sun.position.set(-span*.7,span*1.2,span*.47); sun.castShadow = true;
  sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera, {left:-span*.85,right:span*.85,top:span*.85,bottom:-span*.85,near:1,far:span*4});
  sun.shadow.bias = -.00025; sun.shadow.normalBias = .25;
  scene.add(sun);
  const baseline = Math.floor(meta.zMin)-3;
  const base = new THREE.Mesh(new THREE.BoxGeometry(cols*res+2, 3, rows*res+2), createBaseMaterial());
  base.position.y = -1.51; base.receiveShadow = true; scene.add(base);
  const roofDisplay=repairRoofDisplay(heights,codes,flags,rows,cols,res);
  const displayHeights=roofDisplay.heights;
  const validCells = [];
  for (let i=0;i<count;i++) if (Number.isFinite(displayHeights[i])) validCells.push(i);
  const terrain = new THREE.InstancedMesh(new THREE.BoxGeometry(res,res,res), createPhotoMaterial(aerial,cols*res,rows*res,meta.zMax-baseline), validCells.length);
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), scale = new THREE.Vector3(), color = new THREE.Color();
  const position = new THREE.Vector3();
  function location(cell) {
    const row = Math.floor(cell/cols), col = cell%cols;
    return new THREE.Vector3((col+.5-cols/2)*res, displayHeights[cell]-baseline, (row+.5-rows/2)*res);
  }
  const wallStyles=buildingWallStyles(codes,heights,flags,rows,cols,res);
  validCells.forEach((cell, instance) => {
    position.copy(location(cell)); const height = position.y;
    position.y = height/2; scale.set(1,height/res,1);
    matrix.compose(position,q,scale); terrain.setMatrixAt(instance,matrix);
    color.setRGB(coverStyle(codes[cell]),wallStyles[cell]||codes[cell]===21?1:0,0); // Existing GPU attribute stores the display group.
    terrain.setColorAt(instance,color);
  });
  terrain.castShadow = true; terrain.receiveShadow = true;
  terrain.computeBoundingSphere(); scene.add(terrain);
  let regional=null,missionBounds=null;
  if(regionMeta){
    terrain.visible=false;base.visible=false;
    try { regional=await createRegionalTerrain(scene,{url:regionUrl,meta:regionMeta,baseline,requestRender,onStatus:onMapStatus,
      onLocalDetail:visible=>{const show=visible&&!(viewMode==='orbit'&&missionBounds);terrain.visible=show;base.visible=show;requestRender();}}); }
    catch(error){terrain.visible=true;base.visible=true;onMapStatus(`Regional map unavailable · ${error.message}`);}
  }
  // A sparse ground grid provides scale without implying additional observations.
  const grid = new THREE.GridHelper(span+100, Math.round((span+100)/25),0x3a525d,0x263e49);
  grid.position.y = -3.1; scene.add(grid);
  const compass = new THREE.ArrowHelper(new THREE.Vector3(0,0,-1),new THREE.Vector3(span/2+15,0,span/2-25),25,0x96afb6,5,3);
  scene.add(compass);
  const northCanvas = document.createElement('canvas'); northCanvas.width=64; northCanvas.height=64;
  const ctx=northCanvas.getContext('2d');ctx.fillStyle='#abc3c8';ctx.font='500 36px sans-serif';ctx.textAlign='center';ctx.fillText('N',32,45);
  const northTexture=new THREE.CanvasTexture(northCanvas);
  const north=new THREE.Sprite(new THREE.SpriteMaterial({map:northTexture,transparent:true})); north.scale.set(10,10,1);north.position.set(span/2+15,4,span/2-56);scene.add(north);
  const markers = new THREE.Group(); markers.visible = true; scene.add(markers);
  const initialCells=[inspectionStartCell(meta,heights,flags),meta.initialCells[1]];
  let cells = [...initialCells], selection = null, disposed = false, scheduled = 0, transition = null, viewMode = 'top';
  const inspectionOverlay=createInspectionOverlay(scene,meta,heights,flags,baseline,meta.zMax-baseline+3);
  const missionView=createMissionView(scene,baseline);
  const editorView=createMissionEditorView(scene,baseline,meta.zMax);
  inspectionOverlay.setVisible(false);
  let mission=null,missionLast=null,reconstruction=null,missionPlan=null,missionDraft={};
  // One source image read, reused for each simulated capture. No new imagery fetch.
  const colorCanvas=document.createElement('canvas');colorCanvas.width=cols;colorCanvas.height=rows;
  const colorContext=colorCanvas.getContext('2d');colorContext.drawImage(aerial.image,0,0,cols,rows);
  const sourceColors=colorContext.getImageData(0,0,cols,rows).data;
  onMapStatus('Top-down 3D landscape · same geometry and colors');
  const sampleRGB=(e,n)=>{
    const c=Math.max(0,Math.min(cols-1,Math.floor((e-meta.x0)/res)));
    const r=Math.max(0,Math.min(rows-1,Math.floor((meta.y0-n)/res)));
    const i=(r*cols+c)*4;return [sourceColors[i],sourceColors[i+1],sourceColors[i+2]];
  };
  let labelPositions = [];
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  function describe(cell) {
    return {cell, elevation: displayHeights[cell], code:codes[cell], label:(meta.legend[String(codes[cell])] || 'Unknown cover')+(!(flags[cell]&1)?' · Estimated nearby-cell average':''), blocked:!!(flags[cell]&2), x:meta.x0+(cell%cols+.5)*res, y:meta.y0-(Math.floor(cell/cols)+.5)*res};
  }
  function updateMarkers() {
    for (const child of [...markers.children]) { child.geometry?.dispose(); child.material?.dispose(); markers.remove(child); }
    const points=cells.map(location);
    labelPositions = points.map(p=>p.clone().add(new THREE.Vector3(0,4,0)));
    points.slice(0,1).forEach((point,i)=>{
      const tint=i===0?0xd3f4a8:0x9ed9ed;
      const dot=new THREE.Mesh(new THREE.SphereGeometry(1.6,16,12),new THREE.MeshBasicMaterial({color:tint}));
      dot.position.copy(point).add(new THREE.Vector3(0,1,0));markers.add(dot);
      const ring=new THREE.Mesh(new THREE.RingGeometry(2.8,3.2,32),new THREE.MeshBasicMaterial({color:tint,side:THREE.DoubleSide}));
      ring.rotation.x=-Math.PI/2;ring.position.copy(point).add(new THREE.Vector3(0,.2,0));markers.add(ring);
    });
    const descriptions=cells.map(describe);
    onChange({distance:Math.hypot(points[0].x-points[1].x,points[0].z-points[1].z),points:descriptions,selection,meta});
    requestRender();
  }
  function render(time) {
    scheduled=0;if(disposed)return;
    if (transition) {
      const t = Math.min(1, (time-transition.started)/transition.duration);
      const ease = t*t*(3-2*t);
      const spherical = new THREE.Spherical(
        THREE.MathUtils.lerp(transition.from.radius,transition.to.radius,ease),
        THREE.MathUtils.lerp(transition.from.phi,transition.to.phi,ease),
        THREE.MathUtils.lerp(transition.from.theta,transition.to.theta,ease),
      );

      controls.target.lerpVectors(transition.fromTarget,transition.toTarget,ease);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      camera.zoom=THREE.MathUtils.lerp(transition.fromZoom,transition.toZoom,ease);
      camera.updateProjectionMatrix();
      controls.update();
      if(t===1){transition=null;controls.enabled=true;}
      else requestRender();
    }
    // Map is the same lit 3D scene viewed from above. Camera motion never
    // swaps surfaces, palettes, or annotation elevations.
    if(mission){
      const dt=missionLast===null?0:Math.min(.25,Math.max(0,(time-missionLast)/1000));
      missionLast=time;
      if(!document.hidden&&!transition)mission.advanceReal(dt);
      missionView.update(mission);inspectionOverlay.updateCoverage(reconstruction?.data);onMission(mission.snapshot());
      if(mission.active&&!document.hidden)requestRender();
    }
    renderer.render(scene,camera);
    if(regional){const rect=container.getBoundingClientRect();regional.update(camera,rect.width,controls.target);}
    const rect=container.getBoundingClientRect();
    onProject(labelPositions.map(position=>{const p=position.clone().project(camera);return {x:(p.x+1)*rect.width/2,y:(1-p.y)*rect.height/2,visible:Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z>-1&&p.z<1};}));
  }
  function requestRender(){if(!scheduled&&!disposed)scheduled=requestAnimationFrame(render);}
  controls.addEventListener('change',requestRender);
  function visibility(){missionLast=null;if(!document.hidden)requestRender();}
  document.addEventListener('visibilitychange',visibility);
  function resize(){
    const {width,height}=container.getBoundingClientRect();if(!width||!height)return;
    const aspect=width/height;
    // A bounding sphere fits every model corner in portrait and landscape,
    // even while the camera rotates. Zoom 1 is the full-domain view.
    const radius=Math.max(worldSpan/2,Math.hypot(cols*res/2,rows*res/2,(meta.zMax-baseline+3)/2));
    const half=radius*1.28;
    camera.left=-half*Math.max(1,aspect);camera.right=-camera.left;
    camera.top=half*Math.max(1,1/aspect);camera.bottom=-camera.top;
    camera.updateProjectionMatrix();renderer.setSize(width,height);editorView.setResolution(width,height);requestRender();
  }
  const observer=new ResizeObserver(resize);observer.observe(container);
  function setView(name, { animate = true, reset = false } = {}) {
    const map = name === 'top';
    viewMode=name;
    const missionFocus=!map&&missionBounds?missionBounds:null;regional?.setFocus(missionFocus);
    if(missionFocus){terrain.visible=false;base.visible=false;}grid.visible=compass.visible=north.visible=!missionFocus;
    controls.enableRotate = !map;
    controls.mouseButtons.LEFT = map ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.touches.ONE = map ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const to = new THREE.Spherical().setFromVector3(map
      ? new THREE.Vector3(0,Math.max(400,worldSpan*1.4),.001)
      : new THREE.Vector3(worldSpan*.52,worldSpan*.46,worldSpan*.60));
    // Use the shortest azimuth arc, including after freely orbiting the model.
    to.theta = from.theta + Math.atan2(Math.sin(to.theta-from.theta),Math.cos(to.theta-from.theta));
    const fullMap=map&&missionBounds;
    const toTarget = missionFocus?new THREE.Vector3((missionFocus.west+missionFocus.east)/2,(meta.zMax-baseline)/2,-(missionFocus.south+missionFocus.north)/2)
      :(reset||fullMap)?new THREE.Vector3(0,(meta.zMax-baseline)/2,0):controls.target.clone();
    const focusWidth=missionFocus?Math.max(150,missionFocus.east-missionFocus.west):0,focusHeight=missionFocus?Math.max(150,missionFocus.north-missionFocus.south):0;
    const toZoom = missionFocus?Math.min(controls.maxZoom,Math.max(controls.minZoom,Math.min((camera.right-camera.left)/(focusWidth*1.45),(camera.top-camera.bottom)/(focusHeight*1.45)))):(reset||fullMap)?1:camera.zoom;
    if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      transition = {from,to,fromTarget:controls.target.clone(),toTarget,
        fromZoom:camera.zoom,toZoom,started:performance.now(),duration:900};
      controls.enabled = false;
    } else {
      transition=null;controls.enabled=true;
      controls.target.copy(toTarget);
      camera.position.copy(toTarget).add(new THREE.Vector3().setFromSpherical(to));
      camera.zoom=toZoom;camera.updateProjectionMatrix();controls.update();
    }
    requestRender();
  }
  function setRay(event){const r=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);}
  function hit(event){setRay(event);const intersection=raycaster.intersectObject(terrain,false)[0];return intersection ? validCells[intersection.instanceId] : null;}
  function hitPoint(event){
    setRay(event);const remote=regional?.pick(raycaster);if(remote)return [remote.x,remote.y,remote.elevation];
    const intersection=raycaster.intersectObject(terrain,false)[0];if(!intersection)return null;const d=describe(validCells[intersection.instanceId]);return [d.x,d.y,d.elevation];
  }
  let down=null,lastHover=0;
  function pointerDown(event){down={x:event.clientX,y:event.clientY,button:event.button};}
  function pointerUp(event){
    if(!down||down.button!==0||Math.hypot(event.clientX-down.x,event.clientY-down.y)>5)return;down=null;if(mission||transition)return;
    if(selection!==null){const cell=hit(event);if(cell===null||!(flags[cell]&1))return;cells[selection]=cell;selection=null;container.style.cursor='';updateMarkers();return;}
    const point=hitPoint(event);if(point)onMapClick(point);
  }
  function pointerMove(event){if(event.buttons||performance.now()-lastHover<100)return;lastHover=performance.now();const cell=hit(event);onHover(cell===null?null:describe(cell));}
  function leave(){onHover(null);}
  function key(event){if(event.key==='Escape'){selection=null;container.style.cursor='';updateMarkers();}}
  renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pointerUp);renderer.domElement.addEventListener('pointermove',pointerMove);renderer.domElement.addEventListener('pointerleave',leave);window.addEventListener('keydown',key);
  controls.target.set(0,(meta.zMax-baseline)/2,0);
  camera.position.set(0,Math.max(400,worldSpan*1.4),.001);camera.zoom=1;
  resize();setView('top', {animate:false});updateMarkers();
  return {
    setView,
    setMissionDraft(value){missionDraft=value??{};editorView.set(missionDraft);requestRender();},
    async planRegionalMission(config){
      if(!regional||!regionMeta)throw new Error('Regional terrain is unavailable.');
      if(mission)throw new Error('Restart the current mission before planning another.');
      onPlanning({stage:'coarse',completed:0,total:1});
      const plan=await planRegionalMissionInWorker(regionUrl,config,onPlanning);
      reconstruction=await createRegionalReconstruction(regionUrl,regionMeta,plan,onPlanning);
      missionPlan=plan;missionBounds=plan.renderBounds;
      const relayEvent=event=>{if(event.type==='found'){missionDraft={...missionDraft,target:plan.target,targetVisible:true};editorView.set(missionDraft);}onMissionEvent(event);};
      mission=new RegionalMissionSimulation(plan,{onCapture:event=>reconstruction?.capture(event),onEvent:relayEvent});missionLast=null;
      missionDraft={...missionDraft,polygon:plan.polygon,target:plan.target,targetVisible:false};editorView.set(missionDraft);missionView.setPlan(plan);requestRender();return mission.snapshot();
    },
    planMission(settings={}){
      const options={...defaults,...settings};
      if(!Number.isFinite(options.speed)||options.speed<1||options.speed>15||
        !Number.isFinite(options.flightMinutes)||options.flightMinutes<5||options.flightMinutes>180||
        !Number.isFinite(options.chargeMinutes)||options.chargeMinutes<.5||options.chargeMinutes>120)
        throw new Error('Use speed 1–15 m/s, endurance 5–180 min and charge time 0.5–120 min.');
      const start=describe(cells[0]);
      const area={...inspection,start:{east:start.x,north:start.y}};
      const model=createSafetyModel(meta,heights,flags,options);
      const plan=planInspection(model,area,options);
      inspectionOverlay.setVisible(true);
      reconstruction=createReconstruction(meta,area,heights,codes,flags,sampleRGB);
      mission=new MissionSimulation(model,plan,capture=>reconstruction.capture(capture));missionLast=null;selection=null;container.style.cursor='';updateMarkers();missionView.setPlan(plan);requestRender();
      return mission.snapshot();
    },
    toggleMission(){if(mission){mission.start();missionLast=null;requestRender();}},
    reconstructionData(){return reconstruction?.data??null;},
    reconstructionJSON(){return reconstruction?.toJSON()??null;},
    clearMission(){reconstruction=null;inspectionOverlay.updateCoverage(null);inspectionOverlay.setVisible(false);mission=null;missionPlan=null;missionBounds=null;regional?.setFocus(null);missionLast=null;missionView.setPlan(null);editorView.set(missionDraft);requestRender();},
    missionState(){return mission?.snapshot();},
    missionResult(){return mission?.snapshot().result??null;},
    missionPlan(){return missionPlan;},
    select(index){if(mission)return;selection=selection===index?null:index;container.style.cursor=selection===null?'':'crosshair';updateMarkers();},
    reset(){if(!mission)cells=[...initialCells];selection=null;container.style.cursor='';setView('top', {reset:true});updateMarkers();},
    dispose(){disposed=true;regional?.dispose();document.removeEventListener('visibilitychange',visibility);missionView.dispose();editorView.dispose();inspectionOverlay.dispose();cancelAnimationFrame(scheduled);observer.disconnect();controls.dispose();window.removeEventListener('keydown',key);renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pointerUp);renderer.domElement.removeEventListener('pointermove',pointerMove);renderer.domElement.removeEventListener('pointerleave',leave);scene.traverse(obj=>{obj.geometry?.dispose();if(Array.isArray(obj.material))obj.material.forEach(m=>m.dispose());else obj.material?.dispose();});terrain.dispose();aerial.dispose();northTexture.dispose();renderer.dispose();renderer.domElement.remove();},
  };
}
