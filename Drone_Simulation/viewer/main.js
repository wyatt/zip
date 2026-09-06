import {bindReconstructionView} from './reconstruction-view.js';
import './style.css';
import {createLandscape} from './landscape.js';

const $=id=>document.getElementById(id),modeButtons=[...document.querySelectorAll('[data-mode]')];
let landscape,updateReconstruction=()=>{},planned=false,planning=false,viewMode='top';
let draft={mode:'delivery',a:null,b:null,polygon:[[]]},tool='a';
const modeCopy={delivery:'Place point A, then point B. The route delivers at B and returns to A.',inspection:'Place point A anywhere on the map, then draw a polygon. The drone routes to the area before inspecting it.',search:'Place point A anywhere on the map, then draw a polygon. The drone routes to the area and searches for a hidden target.'};
const phaseCopy={ready:'Ready to fly',outbound:'Flying to delivery',deliver:'Delivering package',survey:'Capturing inspection mosaic',inspection:'Inspecting area',search:'Searching area',found:'Target found',return:'Returning to A',complete:'Mission complete',error:'Mission stopped'};
const fmtPoint=p=>p?`E ${p[0].toFixed(0)} · N ${p[1].toFixed(0)} m`:'Not placed';
const fmtTime=value=>{const s=Math.max(0,Math.round(value||0)),h=Math.floor(s/3600),m=Math.floor(s%3600/60);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};

function setTool(next){
  if(planned||planning)return;tool=next;
  $('place-a').classList.toggle('active',tool==='a');$('place-b').classList.toggle('active',tool==='b');$('draw-area').classList.toggle('active',tool==='polygon');
  $('mission-detail').textContent=tool==='a'?'Click the map to place point A.':tool==='b'?'Click the map to place point B.':'Click around the boundary. Crossed edges are rejected during planning.';
}
function publishDraft(){landscape?.setMissionDraft({...draft,targetVisible:false});}
function renderDraft(){
  if(!Array.isArray(draft.polygon)||!Array.isArray(draft.polygon[0]))draft.polygon=[[]];
  const areaMode=draft.mode!=='delivery',vertices=draft.polygon[0].length;
  $('coord-a').textContent=fmtPoint(draft.a);$('coord-b').textContent=fmtPoint(draft.b);$('coord-area').textContent=`${vertices} ${vertices===1?'vertex':'vertices'}`;
  $('coord-b-row').hidden=areaMode;$('coord-area-row').hidden=!areaMode;$('place-b').hidden=areaMode;$('draw-area').hidden=!areaMode;$('undo-point').hidden=!areaMode;
  document.querySelectorAll('.area-setting').forEach(el=>el.hidden=!areaMode);document.querySelectorAll('.search-setting').forEach(el=>el.hidden=draft.mode!=='search');
  $('mission-instructions').textContent=modeCopy[draft.mode];publishDraft();
}
function selectMode(mode){
  if(planned||planning)return;draft={mode,a:null,b:null,polygon:[[]]};tool='a';
  modeButtons.forEach(button=>{const active=button.dataset.mode===mode;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
  renderDraft();setTool('a');$('mission-result').textContent='';
}
function mapClick(point){
  if(planned||planning||viewMode!=='top')return;
  if(tool==='a'){draft.a=point;if(draft.mode==='delivery')setTool('b');else setTool('polygon');}
  else if(tool==='b')draft.b=point;
  else if(tool==='polygon')draft.polygon[0].push(point.slice(0,2));
  renderDraft();
}
function view(name,move=true){
  if(name==='orbit'&&!planned)return;viewMode=name;if(move)landscape.setView(name);
  $('viewer').classList.toggle('map-mode',name==='top');$('top').classList.toggle('active',name==='top');$('orbit').classList.toggle('active',name==='orbit');
  $('top').setAttribute('aria-pressed',String(name==='top'));$('orbit').setAttribute('aria-pressed',String(name==='orbit'));
  const hint=name==='top'?'2D planning · Drag to pan · Scroll to zoom':'3D mission · Drag to orbit · Right-drag to pan';$('camera-hint').textContent=hint;$('scene').setAttribute('aria-label',hint);
}
function planningStatus({stage,completed=0,total=1}){const names={coarse:'Searching the overview with A*',terrain:'Loading route terrain',mosaic:'Preparing inspection mosaic'};$('mission-detail').textContent=`${names[stage]||'Planning'} · ${completed}/${total}`;}
function renderMission(state){
  if(!state)return;$('mission-clock').textContent=fmtTime(state.elapsed);$('mission-battery').textContent=`${state.battery.toFixed(1)}%`;$('mission-battery-bar').value=state.battery;
  $('mission-rate').textContent=state.phase==='ready'?'PLANNED':`${state.multiplier}× PLAYBACK`;
  $('mission-progress').textContent=state.mode==='inspection'?`${state.photos.toLocaleString()} / ${state.totalPhotos.toLocaleString()} photos`:`${Math.round(state.distance||0).toLocaleString()} m flown`;
  if(!planning)$('mission-detail').textContent=state.reason||phaseCopy[state.phase]||state.phase;
  $('mission-run').textContent=state.paused?'Resume':state.phase==='ready'?'Start':state.phase==='complete'?'Complete':'Pause';$('mission-run').disabled=state.phase==='complete'||state.phase==='error';
  if(state.result?.location){const [e,n,z]=state.result.location;$('mission-result').textContent=`Found target at E ${e.toFixed(1)}, N ${n.toFixed(1)} m · elevation ${z.toFixed(1)} m NAVD88`;}
  updateReconstruction();
}
async function plan(throwOnError=false){
  if(planning||planned)return;planning=true;$('mission-plan').disabled=true;setInputsDisabled(true);$('mission-result').textContent='';
  try{
    const config={mode:draft.mode,a:draft.a,b:draft.b,polygon:draft.polygon,settings:{speed:Number($('mission-speed').value),flightMinutes:Number($('mission-endurance').value),trackSpacing:Number($('mission-spacing').value),detectionRadius:Number($('mission-detection').value)}};
    const state=await landscape.planRegionalMission(config);planned=true;$('orbit').disabled=false;$('orbit').title='Open the planned mission in 3D';$('mission-run').disabled=false;
    document.querySelector('.reconstruction-panel').hidden=draft.mode!=='inspection';renderMission(state);view('orbit');return state;
  }catch(error){$('mission-detail').textContent=error.message;$('mission-plan').disabled=false;setInputsDisabled(false);if(throwOnError)throw error;}
  finally{planning=false;}
}
function setInputsDisabled(value){modeButtons.forEach(b=>b.disabled=value);for(const id of ['place-a','place-b','draw-area','undo-point','mission-speed','mission-endurance','mission-spacing','mission-detection'])$(id).disabled=value;}
function clear(){
  landscape.clearMission();planned=false;planning=false;$('orbit').disabled=true;$('orbit').title='Plan a mission to unlock 3D';$('mission-plan').disabled=false;$('mission-run').disabled=true;$('mission-run').textContent='Start';
  $('mission-clock').textContent='00:00:00';$('mission-battery').textContent='100.0%';$('mission-battery-bar').value=100;$('mission-progress').textContent='No mission planned';$('mission-result').textContent='';$('mission-rate').textContent='2D SETUP';document.querySelector('.reconstruction-panel').hidden=true;setInputsDisabled(false);selectMode(draft.mode);landscape.reset();view('top',false);
}

try{
  landscape=await createLandscape($('scene'),{dataUrl:`${import.meta.env.BASE_URL}data/`,onMapClick:mapClick,onPlanning:planningStatus,onMissionEvent:event=>{if(event.type==='found')renderMission(landscape.missionState());},onMission:renderMission,onMapStatus:value=>$('map-status').textContent=value,
    onChange:({meta})=>$('extent').textContent=meta.regionalExtent?`${(meta.regionalExtent/1000).toFixed(0)} × ${(meta.regionalExtent/1000).toFixed(0)} km mission domain · north up`:'Local terrain only',
    onHover:point=>{const el=$('hover');el.hidden=!point;if(point){el.replaceChildren();const strong=document.createElement('strong');strong.textContent=`${point.label} · ${point.code}`;el.append(strong,`${point.elevation.toFixed(1)} m NAVD88 · E ${point.x.toFixed(1)} / N ${point.y.toFixed(1)} m`);}}});
  updateReconstruction=bindReconstructionView(landscape);$('loading').hidden=true;renderDraft();
  modeButtons.forEach(button=>button.onclick=()=>selectMode(button.dataset.mode));$('place-a').onclick=()=>setTool('a');$('place-b').onclick=()=>setTool('b');$('draw-area').onclick=()=>setTool('polygon');
  $('undo-point').onclick=()=>{draft.polygon[0].pop();renderDraft();};$('mission-plan').onclick=()=>plan();$('mission-run').onclick=()=>landscape.toggleMission();$('mission-restart').onclick=clear;
  $('orbit').onclick=()=>view('orbit');$('top').onclick=()=>view('top');$('reset').onclick=()=>{landscape.reset();view(viewMode,false);};
  Object.defineProperties(window,{missionPlanner:{configurable:true,value:{getDraft:()=>structuredClone(draft),setDraft:value=>{if(planned)throw new Error('Clear the current mission before editing.');if(!['delivery','inspection','search'].includes(value?.mode))throw new Error('mode must be delivery, inspection, or search.');draft={a:null,b:null,polygon:[[]],...structuredClone(value)};modeButtons.forEach(button=>{const active=button.dataset.mode===draft.mode;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});tool='a';renderDraft();setTool('a');},plan:()=>plan(true),start:()=>landscape.toggleMission(),clear,getPlan:()=>landscape.missionPlan(),getState:()=>landscape.missionState(),getResult:()=>landscape.missionResult()}},inspectionReconstruction:{configurable:true,get:()=>landscape.reconstructionData()}});
  window.addEventListener('pagehide',()=>landscape.dispose(),{once:true});
}catch(error){$('loading').textContent=`Unable to load landscape: ${error.message}`;console.error(error);}
