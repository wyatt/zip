import {planRegionalMission} from './regional-mission-planner.js';

self.onmessage=async({data})=>{
  if(data?.type!=='plan')return;
  try{
    const plan=await planRegionalMission({regionUrl:data.regionUrl,config:data.config,progress:value=>self.postMessage({type:'progress',id:data.id,value})});
    self.postMessage({type:'result',id:data.id,plan});
  }catch(error){self.postMessage({type:'error',id:data.id,message:error?.message||String(error)});}
};
