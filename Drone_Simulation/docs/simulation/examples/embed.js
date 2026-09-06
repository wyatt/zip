// Integration example: copy into your host and adjust these imports.
// Import/mount on the client only. This wrapper does not depend on demo DOM IDs.
import {createLandscape} from '../../../viewer/landscape.js';
import {defaults} from '../../../viewer/mission-planner.js';
import {createMosaicPainter} from './paint-mosaic.js';

export function validateProfile(profile={}) {
  const values={...defaults,...profile};
  const ranges={speed:[1,15],flightMinutes:[5,180],chargeMinutes:[.5,120]};
  for(const [name,[min,max]] of Object.entries(ranges))
    if(!Number.isFinite(values[name])||values[name]<min||values[name]>max)
      throw new Error(`${name} must be between ${min} and ${max}`);
  if(!Number.isFinite(values.climbSpeed)||values.climbSpeed<=0)throw new Error('climbSpeed must be positive');
  for(const name of ['clearance','bodyRadius','uncertainty'])
    if(!Number.isFinite(values[name])||values[name]<0)throw new Error(`${name} must be nonnegative`);
  if(!Number.isFinite(values.arrivalReserve)||values.arrivalReserve<0||values.arrivalReserve>=100)
    throw new Error('arrivalReserve must be at least 0 and below 100');
  return values;
}

/**
 * Returns immediately, so a host can dispose while asynchronous loading proceeds.
 * ready resolves to controls, or null if unmounted before loading completed.
 * The host should catch ready rejections and display an error.
 */
export function mountSimulator({container,mosaicCanvas,dataUrl,onState=()=>{},onChange=()=>{},onProject=()=>{}}) {
  const paint=mosaicCanvas?createMosaicPainter(mosaicCanvas):()=>{};
  let view=null,disposed=false,lastPaint=0;
  const ready=createLandscape(container,{
    dataUrl,
    onChange:change=>{if(!disposed)onChange(change);},
    onProject:points=>{if(!disposed)onProject(points);},
    onMission:state=>{
      if(disposed)return;
      onState(state); // Host may additionally throttle framework state updates.
      const now=performance.now();
      if(now-lastPaint>100||state.phase==='complete'){
        lastPaint=now;paint(view?.reconstructionData()??null);
      }
    },
  }).then(instance=>{
    if(disposed){instance.dispose();return null;}
    view=instance;
    return {
      start(profile={}){
        const options=validateProfile(profile); // Validate before clearing old results.
        view.clearMission();paint(null);onState(null);
        const state=view.planMission(options);
        onState(state);view.setView('orbit');view.toggleMission();
      },
      pause(){
        const state=view.missionState();
        if(state&&!state.paused&&!['ready','complete','error'].includes(state.phase))view.toggleMission();
        paint(view.reconstructionData());
      },
      resume(){const state=view.missionState();if(state?.paused)view.toggleMission();},
      clear(){view.clearMission();paint(null);onState(null);},
      setView(mode){view.setView(mode);},
      selectStart(){view.select(0);}, // Clear first to allow editing a planned Start.
      snapshot(){return view.missionState();},
      reconstruction(){return view.reconstructionData();},
      exportJSON(){return view.reconstructionJSON();},
    };
  });
  return {ready,dispose(){
    if(disposed)return;
    disposed=true;view?.dispose();view=null;paint(null);
  }};
}

// Example host usage (supply real DOM elements):
// const mounted=mountSimulator({container,mosaicCanvas,dataUrl:'/simulator/data/',onState:renderStatus});
// const controls=await mounted.ready;
// controls?.start({speed:5,flightMinutes:46.5,chargeMinutes:20});
// Wire host buttons to controls.pause(), controls.resume(), controls.clear(), etc.
// Call mounted.dispose() when the host component unmounts, even if ready is pending.
// Do not call the returned controls after disposal.
