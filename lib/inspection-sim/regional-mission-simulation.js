const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const travelSeconds=(a,b,options)=>Math.max(Math.hypot(a[0]-b[0],a[1]-b[1])/options.speed,Math.abs(a[2]-b[2])/options.climbSpeed);

export class RegionalMissionSimulation{
  constructor(plan,{onCapture=(_event)=>{},onEvent=(_event)=>{}}={}){this.plan=plan;this.options=plan.options;this.onCapture=onCapture;this.onEvent=onEvent;this.reset();}
  reset(){this.position=this.plan.start.slice();this.phase='ready';this.paused=false;this.cursor=0;this.elapsed=0;this.flightSeconds=0;this.distance=0;this.battery=100;this.photos=new Set();this.events=[];this.route=this.plan.tasks.map(t=>t.point);this.routeRevision=1;this.result=null;this.sorties=0;this.returns=0;}
  get active(){return !this.paused&&!['ready','complete','error'].includes(this.phase);}
  get multiplier(){return this.paused?0:['survey','inspection','search','found'].includes(this.phase)?70:10;}
  log(type,detail={}){const event={...detail,type,at:this.elapsed};this.events.push(event);this.onEvent(event);}
  start(){if(this.phase==='ready'){this.sorties=1;this.phase=this.plan.tasks[0]?.kind||'outbound';this.log('start',{mode:this.plan.mode});}else if(this.active||this.paused)this.paused=!this.paused;}
  arrive(task){
    if(task.photo!==null&&!this.photos.has(task.photo)){this.photos.add(task.photo);this.onCapture({id:task.photo,position:this.position.slice(),time:this.elapsed});}
    if(task.kind==='deliver')this.log('delivered',{location:this.position.slice()});
    if(task.kind==='found'&&!this.result){this.result={type:'search-result',location:this.plan.target.slice(),foundAt:this.elapsed};this.log('found',this.result);}
    if(task.kind==='return'&&!this.returns)this.returns=1;
    this.cursor++;
    if(this.cursor>=this.plan.tasks.length){this.position=this.plan.start.slice();this.phase='complete';this.log('complete',{result:this.result});}
    else this.phase=this.plan.tasks[this.cursor].kind;
  }
  step(dt){
    const task=this.plan.tasks[this.cursor];if(!task)return 0;
    const seconds=travelSeconds(this.position,task.point,this.options);
    if(seconds<1e-8){this.position=task.point.slice();this.arrive(task);return 0;}
    const used=Math.min(dt,seconds),fraction=used/seconds,before=this.position;
    this.position=before.map((value,i)=>value+(task.point[i]-value)*fraction);this.distance+=distance(before,this.position);this.elapsed+=used;this.flightSeconds+=used;
    this.battery=Math.max(0,this.battery-used/(this.options.flightMinutes*60)*100);
    if(this.battery<=this.options.arrivalReserve&&this.cursor<this.plan.tasks.length-1){this.phase='error';this.reason='Battery reserve reached before mission completion.';this.log('error',{reason:this.reason});return used;}
    if(used>=seconds-1e-8){this.position=task.point.slice();this.arrive(task);}return used;
  }
  advanceReal(seconds){let remaining=seconds,guard=0;while(remaining>1e-8&&this.active&&guard++<100000){const rate=this.multiplier,used=this.step(Math.min(1,remaining*rate));remaining-=used/rate;if(!used&&this.active)this.step(0);}if(guard>=100000){this.phase='error';this.reason='Simulation could not advance.';}}
  snapshot(){return {mode:this.plan.mode,phase:this.phase,paused:this.paused,part:1,elapsed:this.elapsed,battery:this.battery,predictedArrivalBattery:100-this.plan.requiredBattery,
    returnSeconds:0,photos:this.photos.size,totalPhotos:this.plan.photoCount,sorties:this.sorties,returns:this.returns,position:this.position.slice(),multiplier:this.multiplier,
    reason:this.reason||'',chargeRemaining:0,completedTasks:[this.cursor],distance:this.distance,result:this.result,target:this.plan.target};}
}
