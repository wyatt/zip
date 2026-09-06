const clock=seconds=>{const n=Math.floor(seconds);return `${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;};
const names={ready:'Ready',outbound:'Travel to inspection',survey:'Taking photos',turn:'Changing pass',return:'Returning to charge',charging:'Charging at Start',complete:'Both parts complete',error:'Simulation stopped'};
export function bindMissionUI(view,switchTo3D,onReset=()=>{}){
  const $=id=>document.getElementById(id);let state=null,last=0;
  const run=$('mission-run'),restart=$('mission-restart');
  function render(s){
    state=s;
    const started=s.sorties>0;
    $('start-marker').textContent=started?'Charge point':'Start';
    $('start-marker').title=started?'Charging point for this mission':'Start point · Click to move';
    $('start-marker').disabled=s.phase!=='ready';
    $('mission-phase').textContent=s.paused?'Paused':names[s.phase];
    $('mission-rate').textContent=s.paused?'PAUSED':`${s.multiplier}× ${s.multiplier>1?'SPED UP':'REAL TIME'}`;
    $('mission-clock').textContent=clock(s.elapsed);
    $('mission-battery').textContent=`${s.battery.toFixed(1)}%`;
    $('mission-battery-bar').value=s.battery;
    $('mission-progress').textContent=`Part ${s.part} / 2 · ${s.photos.toLocaleString()} / ${s.totalPhotos.toLocaleString()} photos`;
    $('mission-arrival').textContent=Number.isFinite(s.predictedArrivalBattery)?`Predicted at charger: ${s.predictedArrivalBattery.toFixed(1)}% · target ≥ 10%`:'Return target: ≥ 10% at charger';
    $('mission-sorties').textContent=`Flight ${s.sorties||'—'} · ${s.returns} returns`;
    $('mission-detail').textContent=s.phase==='charging'?`${clock(s.chargeRemaining)} to full charge (mission time)`:s.phase==='return'?s.reason:s.phase==='complete'?'Back at Start. Inspection complete.':s.phase==='error'?s.reason:'Home / charger = Start';
    run.textContent=s.phase==='ready'?'Start simulation':s.phase==='complete'?'Complete':s.paused?'Resume':'Pause';
    run.disabled=['complete','error'].includes(s.phase);
    for(const id of ['mission-speed','mission-endurance','mission-charge'])$(id).disabled=s.phase!=='ready';
    for(let i=0;i<2;i++)$('mission-part-'+(i+1)).classList.toggle('current',s.part===i+1);
  }
  run.onclick=async()=>{
    try{
      if(!state||state.phase==='ready'){
        run.disabled=true;run.textContent='Planning…';
        await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
        view.planMission({speed:Number($('mission-speed').value),flightMinutes:Number($('mission-endurance').value),chargeMinutes:Number($('mission-charge').value)});
        switchTo3D();
      }
      view.toggleMission();render(view.missionState());
    }catch(e){$('mission-detail').textContent=e.message;run.disabled=false;run.textContent='Start simulation';}
  };
  restart.onclick=()=>{view.clearMission();onReset();state=null;run.disabled=false;run.textContent='Start simulation';
    render({phase:'ready',paused:false,part:1,photos:0,totalPhotos:7896,battery:100,elapsed:0,multiplier:1,sorties:0,returns:0});};
  return s=>{if(performance.now()-last>100||s.phase!==state?.phase||s.paused!==state?.paused){last=performance.now();render(s);}};
}
