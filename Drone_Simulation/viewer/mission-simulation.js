import {distance,travelSeconds,routeTransit} from './mission-planner.js';

export class MissionSimulation {
  constructor(model,plan,onCapture=()=>{}){this.onCapture=onCapture;this.model=model;this.plan=plan;this.options=plan.options;this.reset();}
  reset(){
    this.position=this.plan.start.slice();this.phase='ready';this.paused=false;this.part=0;this.cursor=0;
    this.elapsed=0;this.battery=100;this.photos=new Set();this.flightSeconds=0;this.distance=0;
    this.chargeElapsed=0;this.chargeDuration=0;this.sorties=0;this.returns=0;this.reason='';this.resume=null;
    this.route=[];this.routeCursor=0;this.routeRevision=(this.routeRevision||0)+1;this.events=[];this.pendingPart=null;
    this.completedTasks=[0,0];
  }
  get multiplier(){return this.phase==='charging'?140:['survey','turn'].includes(this.phase)?70:['outbound','return'].includes(this.phase)?10:1;}
  get active(){return !this.paused&&!['ready','complete','error'].includes(this.phase);}
  log(type,detail={}){this.events.push({type,at:this.elapsed,battery:this.battery,...detail});}
  start(){if(this.phase==='ready'){this.depart();}else this.paused=!this.paused;}
  setRoute(route){this.route=route.points;this.routeCursor=1;this.routeRevision++;}
  depart(){
    const target=this.resume||this.plan.parts[this.part][this.cursor].point;
    const edge=[this.plan.area.east,target[1],Math.max(target[2],this.model.safe(this.plan.area.east,target[1]))];
    const first=routeTransit(this.model,this.position,edge,this.options,{pad:true});
    const second=routeTransit(this.model,edge,target,this.options);
    const back=routeTransit(this.model,target,this.plan.start,this.options,{pad:true});
    const required=(first.seconds+second.seconds+back.seconds)/(this.options.flightMinutes*60)*100+this.options.arrivalReserve;
    if(required>=this.battery){this.phase='error';this.reason='Battery cannot cover transit and return with reserve.';return;}
    this.setRoute({points:[...first.points,...second.points.slice(1)]});this.phase='outbound';this.sorties++;
    this.log('depart',{part:this.part+1,waypoints:this.route.map(p=>p.slice())});
  }
  returnHome(reason,nextPart=null){
    this.resume=this.position.slice();this.pendingPart=nextPart;
    const route=routeTransit(this.model,this.position,this.plan.start,this.options,{pad:true});
    const needed=route.seconds/(this.options.flightMinutes*60)*100;
    if(needed>this.battery){this.phase='error';this.reason='Insufficient battery for the computed return.';return;}
    this.reason=reason;this.setRoute(route);this.phase='return';this.returns++;
    this.log('return',{reason,part:this.part+1,returnSeconds:route.seconds,waypoints:route.points.map(p=>p.slice()),resume:this.resume.slice()});
  }
  setSurveyPhase(){
    const task=this.plan.parts[this.part][this.cursor];
    if(!task){this.returnHome(`Part ${this.part+1} complete`,this.part+1);return;}
    this.phase=task.kind;
  }
  arrive(){
    if(this.phase==='outbound'||this.phase==='return'){
      this.routeCursor++;
      if(this.routeCursor<this.route.length)return;
      if(this.phase==='outbound'){this.resume=null;this.setSurveyPhase();}
      else if(this.pendingPart===this.plan.parts.length){this.phase='complete';this.log('complete');}
      else {
        if(this.pendingPart!==null){this.part=this.pendingPart;this.cursor=0;this.resume=null;}
        this.pendingPart=null;this.phase='charging';this.chargeElapsed=0;this.chargeFrom=this.battery;
        this.chargeDuration=this.options.chargeMinutes*60*(100-this.chargeFrom)/100;
        this.log('charge',{part:this.part+1});
      }
      return;
    }
    const task=this.plan.parts[this.part][this.cursor];
    if(task.photo!==null&&!this.photos.has(task.photo)){
      this.photos.add(task.photo);this.onCapture({id:task.photo,position:this.position.slice(),time:this.elapsed});
    }
    this.cursor++;this.completedTasks[this.part]=this.cursor;this.setSurveyPhase();
  }
  step(dt){
    if(this.phase==='charging'){
      const duration=this.chargeDuration;
      const used=Math.min(dt,duration-this.chargeElapsed);this.elapsed+=used;this.chargeElapsed+=used;
      this.battery=this.chargeFrom+(100-this.chargeFrom)*Math.min(1,this.chargeElapsed/duration);
      if(this.chargeElapsed>=duration-1e-8){this.battery=100;this.log('charged');this.depart();}
      return used;
    }
    if(['survey','turn'].includes(this.phase)){
      const home=routeTransit(this.model,this.position,this.plan.start,this.options,{pad:true});
      const needed=home.seconds/(this.options.flightMinutes*60)*100;
      const threshold=needed+this.options.arrivalReserve;
      if(this.battery<=threshold+100/(this.options.flightMinutes*60)){
        this.returnHome('10% predicted arrival reserve');return 0;
      }
    }
    const target=['outbound','return'].includes(this.phase)?this.route[this.routeCursor]:this.plan.parts[this.part][this.cursor]?.point;
    if(!target)return 0;
    const seconds=travelSeconds(this.position,target,this.options);
    if(seconds<1e-8){this.position=target.slice();this.arrive();return 0;}
    const used=Math.min(dt,seconds),fraction=used/seconds;
    const before=this.position;
    const next=before.map((v,i)=>v+(target[i]-v)*fraction);
    if(['survey','turn'].includes(this.phase)){
      // A newly crossed raster cell can raise the return cruise altitude abruptly.
      // Evaluate the proposed move before spending energy or leaving this position.
      const home=routeTransit(this.model,next,this.plan.start,this.options,{pad:true});
      const after=this.battery-used/(this.options.flightMinutes*60)*100;
      const required=home.seconds/(this.options.flightMinutes*60)*100+this.options.arrivalReserve;
      if(after<required){this.returnHome('10% predicted arrival reserve');return 0;}
    }
    this.position=next;
    this.distance+=distance(before,this.position);this.elapsed+=used;this.flightSeconds+=used;
    this.battery=Math.max(0,this.battery-used/(this.options.flightMinutes*60)*100);
    if(used>=seconds-1e-8){this.position=target.slice();this.arrive();}
    return used;
  }
  advanceReal(seconds){
    let remaining=seconds,guard=0;
    while(remaining>1e-8&&this.active&&guard++<1000000){
      const speed=this.multiplier;
      const used=this.step(Math.min(1,remaining*speed));remaining-=used/speed;
    }
    if(guard>=1000000){this.phase='error';this.reason='Simulation could not advance.';}
  }
  snapshot(){
    const home=routeTransit(this.model,this.position,this.plan.start,this.options,{pad:true});
    const predictedArrivalBattery=this.battery-home.seconds/(this.options.flightMinutes*60)*100;
    return {predictedArrivalBattery,returnSeconds:home.seconds,phase:this.phase,paused:this.paused,part:this.part+1,elapsed:this.elapsed,battery:this.battery,
    photos:this.photos.size,totalPhotos:this.plan.photoCount,sorties:this.sorties,returns:this.returns,
    position:this.position.slice(),multiplier:this.paused?0:this.multiplier,reason:this.reason,
    chargeRemaining:this.phase==='charging'?Math.max(0,this.chargeDuration-this.chargeElapsed):0,
    completedTasks:this.completedTasks.slice(),distance:this.distance};}
}
