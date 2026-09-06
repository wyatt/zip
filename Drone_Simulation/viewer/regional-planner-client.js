export function planRegionalMissionInWorker(regionUrl,config,onProgress=()=>{}){
  const worker=new Worker(new URL('./regional-planner-worker.js',import.meta.url),{type:'module'}),id=crypto.randomUUID?.()??String(Date.now());
  return new Promise((resolve,reject)=>{
    worker.onmessage=({data})=>{if(data.id!==id)return;if(data.type==='progress')onProgress(data.value);else{worker.terminate();data.type==='result'?resolve(data.plan):reject(new Error(data.message));}};
    worker.onerror=event=>{worker.terminate();reject(new Error(event.message||'Regional planner worker failed.'));};
    worker.postMessage({type:'plan',id,regionUrl,config});
  });
}
