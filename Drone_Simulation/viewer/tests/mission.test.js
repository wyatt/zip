import {createReconstruction} from '../reconstruction.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSafetyModel,planInspection,routeTransit,travelSeconds,defaults} from '../mission-planner.js';
import {MissionSimulation} from '../mission-simulation.js';
const root=new URL('../public/data/',import.meta.url);
const read=(name,T)=>{const b=fs.readFileSync(new URL(name,root));return new T(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const meta=JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
const heights=read('elevation.f32',Float32Array),flags=read('flags.u8',Uint8Array);
const original=heights.slice();
const area={start:{east:27.5,north:-19.5},west:-246.5,east:-110.5,south:-244.5,north:140.5};
const model=createSafetyModel(meta,heights,flags),plan=planInspection(model,area);
const close=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
function run(options=defaults){
  const p={...plan,options:{...options}},sim=new MissionSimulation(model,p);sim.start();
  for(let i=0;i<20000&&sim.active;i++)sim.advanceReal(1);
  assert.equal(sim.phase,'complete',sim.reason);return sim;
}
test('two complete coverage groups; footprint edges, spacing and unique photos',()=>{
  assert.equal(plan.laneCount,42);assert.equal(plan.photoCount,7896);
  assert.deepEqual(plan.lanes.map(l=>l.part).filter(p=>p===0).length,21);
  assert.ok(plan.spacing<=3);
  close(plan.lanes[0].points[0][0]+7.5,area.east);
  close(plan.lanes.at(-1).points[0][0]-7.5,area.west);
  const ids=plan.parts.flat().filter(t=>t.photo!==null).map(t=>t.photo);
  assert.equal(new Set(ids).size,plan.photoCount);
  for(const lane of plan.lanes){
    const photos=plan.parts[lane.part].filter(t=>t.lane===lane.lane&&t.photo!==null);
    for(let j=1;j<photos.length;j++)close(Math.abs(photos[j].point[1]-photos[j-1].point[1]),2);
    for(let j=0;j<lane.points.length;j++){
      const p=lane.points[j];assert.ok(p[2]>=model.photoHeight(p[0],p[1]));
      if(j){const prev=lane.points[j-1];assert.ok(Math.abs(p[2]-prev[2])/travelSeconds(prev,p)<=defaults.climbSpeed+1e-6);}
    }
  }
});
test('all airborne task segments clear the inflated obstacle field',()=>{
  for(const part of plan.parts)for(let j=1;j<part.length;j++){
    const a=part[j-1].point,b=part[j].point;
    assert.ok(Math.min(a[2],b[2])>=model.corridor(a,b)-1e-5);
  }
});
test('unknown obstacles use local estimates without modifying measurements',()=>{
  assert.deepEqual(heights,original);
  const i=model.known.findIndex((known,i)=>!known&&i%meta.cols>10&&i%meta.cols<meta.cols-10&&i>meta.cols*10&&i<meta.cols*(meta.rows-10));
  assert.ok(i>=0);
  const x=meta.x0+(i%meta.cols+.5),y=meta.y0-(Math.floor(i/meta.cols)+.5);
  assert.ok(model.surface(x,y)<meta.zMax);
  assert.ok(model.safe(x,y)>model.surface(x,y)+defaults.clearance);
  assert.throws(()=>model.safe(meta.x0+.5,0),/clearance envelope/);
});
test('playback follows phase rate and pause freezes mission clock and battery',()=>{
  const sim=new MissionSimulation(model,plan);sim.start();sim.advanceReal(1);close(sim.elapsed,10);
  sim.start();const paused=sim.snapshot();sim.advanceReal(50);assert.deepEqual(sim.snapshot(),paused);sim.start();
  while(sim.phase==='outbound')sim.advanceReal(.1);
  assert.equal(sim.multiplier,70);
  const before=sim.elapsed;sim.advanceReal(.01);close(sim.elapsed-before,.7);
});
test('full real-data mission returns, charges, resumes without skipping photos, and ends at home',()=>{
  const sim=run();assert.equal(sim.photos.size,plan.photoCount);assert.deepEqual(sim.position,plan.start);
  assert.deepEqual(sim.completedTasks,plan.parts.map(p=>p.length));assert.equal(sim.sorties,4);
  const returns=sim.events.filter(e=>e.type==='return'),charges=sim.events.filter(e=>e.type==='charge');
  assert.equal(returns.length,4);assert.equal(charges.length,3);
  for(const e of returns){
    assert.deepEqual(e.waypoints[0],e.resume);assert.deepEqual(e.waypoints.at(-1),plan.start);
    assert.ok(e.battery-e.returnSeconds/(defaults.flightMinutes*60)*100>=defaults.arrivalReserve);
    const expected=routeTransit(model,e.resume,plan.start);
    close(expected.seconds,e.returnSeconds);
  }
  for(const e of charges)assert.ok(e.battery>=defaults.arrivalReserve);
  const reserves=returns.filter(e=>e.reason==='10% predicted arrival reserve');assert.equal(reserves.length,2);
  for(const e of reserves){const arrival=e.battery-e.returnSeconds/(defaults.flightMinutes*60)*100;assert.ok(arrival>=10&&arrival<10.2);assert.ok(e.battery>10);}
  close(sim.elapsed,sim.flightSeconds+charges.reduce((s,e)=>s+(100-e.battery)/100*1200,0),1e-5);
});
test('short endurance triggers earlier energy-aware returns and still completes',()=>{
  const sim=run({...defaults,flightMinutes:5});
  assert.ok(sim.events.some(e=>e.type==='return'&&e.reason==='10% predicted arrival reserve'&&e.battery>10));
  for(const e of sim.events.filter(e=>e.type==='charge'))assert.ok(e.battery>=defaults.arrivalReserve-1e-5);
});
test('infeasible battery stops before departure',()=>{
  const sim=new MissionSimulation(model,{...plan,options:{...defaults,flightMinutes:.1}});sim.start();
  assert.equal(sim.phase,'error');assert.deepEqual(sim.position,plan.start);assert.equal(sim.sorties,0);
});

test('incremental reconstruction records only captured footprints and deduplicates overlaps',()=>{
  const codes=read('classes.u8',Uint8Array);
  const reconstruction=createReconstruction(meta,area,heights,codes,flags,()=>[20,80,140]);
  const d=reconstruction.data;
  assert.equal(d.coveredCells,0);assert.ok(d.elevation.every(Number.isNaN));
  const capture={id:0,position:plan.lanes[0].points[0],time:25};
  reconstruction.capture(capture);
  assert.ok(d.coveredCells>0&&d.coveredCells<d.rows*d.cols);
  const covered=d.coveredCells;reconstruction.capture(capture);assert.equal(d.coveredCells,covered);assert.equal(d.revision,1);
  reconstruction.capture({...capture,id:1,time:30});
  assert.equal(d.coveredCells,covered);
  for(let i=0;i<d.coverage.length;i++){
    if(d.coverage[i]){assert.equal(d.coverage[i],2);assert.equal(d.firstSeenSeconds[i],25);assert.equal(d.lastSeenSeconds[i],30);assert.deepEqual([...d.rgba.slice(i*4,i*4+4)],[20,80,140,255]);}
    else {assert.ok(Number.isNaN(d.elevation[i]));assert.equal(d.rgba[i*4+3],0);}
  }
  const json=JSON.parse(reconstruction.toJSON());assert.equal(json.crs,'EPSG:32618');
  assert.equal(json.elevation.find(v=>v===null),null);assert.ok(Array.isArray(json.coverage));
});
test('capture-driven reconstruction survives charging and covers the complete domain',()=>{
  const reconstruction=createReconstruction(meta,area,heights,read('classes.u8',Uint8Array),flags);
  const sim=new MissionSimulation(model,plan,event=>reconstruction.capture(event));sim.start();
  sim.advanceReal(1);assert.equal(reconstruction.data.coveredCells,0);
  for(let i=0;i<10000&&sim.active;i++)sim.advanceReal(1);
  assert.equal(sim.phase,'complete');
  const d=reconstruction.data;
  assert.equal(d.captures.length,plan.photoCount);assert.equal(d.coveredCells,d.cols*d.rows);
  assert.ok(d.coverage.every(n=>n>0));assert.ok(d.rgba.filter((_,i)=>i%4===3).every(a=>a===255));
  for(let i=0;i<d.coverage.length;i++)if(!d.measured[i])assert.ok(Number.isNaN(d.elevation[i]));
  assert.deepEqual(heights,original);
});

test('flat roofs stay 12 m below the route despite missing cells and remote tall objects',()=>{
  const m={rows:100,cols:100,resolution:1,x0:0,y0:100,zMax:300};
  const h=new Float32Array(10000).fill(100),f=new Uint8Array(10000).fill(1);
  h[5050]=NaN;f[5050]=0;h[1010]=300;
  const local=createSafetyModel(m,h,f);
  close(local.surface(50.5,49.5),100);close(local.photoHeight(50.5,49.5),112);
  const p=planInspection(local,{west:35,east:65,south:35,north:65,start:{east:70,north:50}});
  for(const lane of p.lanes)for(const point of lane.points)close(point[2],112);
  const duration=travelSeconds([0,0,100],[0,1,120]);close(duration,10);
});

test('arrival prediction includes home travel and charging playback is 140x',()=>{
  const sim=new MissionSimulation(model,plan);
  close(sim.snapshot().predictedArrivalBattery,100);close(sim.snapshot().returnSeconds,0);
  sim.start();while(sim.phase!=='return'&&sim.active)sim.advanceReal(.1);
  assert.equal(sim.phase,'return');
  const expected=sim.snapshot().predictedArrivalBattery;
  assert.ok(expected>=10&&expected<10.2);
  while(sim.phase==='return')sim.advanceReal(.01);
  assert.equal(sim.phase,'charging');assert.equal(sim.multiplier,140);
  close(sim.events.find(e=>e.type==='charge').battery,expected,.001);
  const before=sim.elapsed;sim.advanceReal(.1);close(sim.elapsed-before,14);
});
