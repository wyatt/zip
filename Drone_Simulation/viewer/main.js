import { bindReconstructionView } from './reconstruction-view.js';
import { bindMissionUI } from './mission-ui.js';
import './style.css';
import { createLandscape } from './landscape.js';

const $ = (id) => document.getElementById(id);
let landscape;
let updateMission=()=>{};
let updateReconstruction=()=>{};
try {
  landscape = await createLandscape($('scene'), {
    dataUrl: `${import.meta.env.BASE_URL}data/`,
    onMission: state=>{updateMission(state);updateReconstruction();},
    onProject: (points) => points.forEach((point,i)=>{
      const label=$(i===0?'start-marker':'end-marker');
      label.style.display=point.visible&&i===0?'flex':'none';
      label.style.left=`${point.x}px`;label.style.top=`${point.y}px`;
    }),
    onChange: ({ meta, selection, points }) => {
      ['start-marker','end-marker'].forEach((id,i)=>{
        $(id).classList.toggle('selected',selection===i);
        $(id).setAttribute('aria-pressed',String(selection===i));
        $(id).title=`${i===0?((landscape?.missionState()?.sorties??0)>0?'Charge point':'Start'):'End'}: ${points[i].elevation.toFixed(1)} m NAVD88 · E ${points[i].x.toFixed(1)} / N ${points[i].y.toFixed(1)} m. Click to move.`;
      });
      $('point-hint').hidden=selection===null;
      $('point-hint').textContent=selection===null?'':`Click a measured location to place ${selection===0?'Start':'End'}. Esc cancels.`;
      $('extent').textContent = `${meta.cols * meta.resolution} × ${meta.rows * meta.resolution} m acquired extent · ${meta.resolution} m cells`;
    },
    onHover: (point) => {
      $('hover').hidden = !point;
      if (point) {
        $('hover').replaceChildren();
        const strong = document.createElement('strong'); strong.textContent = `${point.label} · ${point.code}`;
        $('hover').append(strong, `${point.elevation.toFixed(1)} m NAVD88 · E ${point.x.toFixed(1)} / N ${point.y.toFixed(1)} m`);
      }
    },
  });
  $('loading').hidden = true;
  $('start-marker').onclick=()=>landscape.select(0);
  $('end-marker').onclick=()=>landscape.select(1);
  const view = (name, moveCamera = true) => {
    if (moveCamera) landscape.setView(name);
    $('viewer').classList.toggle('map-mode',name === 'top');
    const instruction = name === 'top' ? 'Drag to pan · Scroll to zoom · Click 3D view to explore' : 'Drag to orbit · Right-drag to pan · Scroll to zoom';
    $('camera-hint').textContent = instruction;
    $('scene').setAttribute('aria-label', `${name === 'top' ? 'Top-down map' : '3D landscape'}. ${instruction}. Arrow keys pan.`);
    for (const id of ['orbit', 'top']) { $(id).classList.toggle('active', id === name); $(id).setAttribute('aria-pressed', String(id === name)); }
  };
  updateReconstruction=bindReconstructionView(landscape);
  updateMission=bindMissionUI(landscape,()=>view('orbit'),updateReconstruction);
  Object.defineProperty(window,'inspectionReconstruction',{configurable:true,get:()=>landscape.reconstructionData()});
  $('orbit').onclick = () => view('orbit'); $('top').onclick = () => view('top');
  $('reset').onclick = () => { landscape.reset(); view('top', false); };
  window.addEventListener('pagehide', () => landscape.dispose(), { once: true });
} catch (error) {
  $('loading').textContent = `Unable to load landscape: ${error.message}`;
  console.error(error);
}
