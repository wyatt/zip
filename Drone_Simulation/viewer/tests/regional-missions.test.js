import test from 'node:test';
import assert from 'node:assert/strict';
import {astarGrid,normalizePolygon,pointInPolygon,scanSegments,seededPointInPolygon} from '../mission-geometry.js';
import {RegionalMissionSimulation} from '../regional-mission-simulation.js';

test('irregular polygons and holes validate and generate contained scan segments',()=>{
  const polygon=normalizePolygon([[[-90,-80],[100,-60],[85,95],[0,45],[-80,100]],[[-15,-10],[20,-10],[20,20],[-15,20]]]);
  assert.equal(pointInPolygon([0,0],polygon),false);assert.equal(pointInPolygon([-60,50],polygon),true);
  for(const [a,b] of scanSegments(polygon,20)){assert.ok(pointInPolygon(a,polygon));assert.ok(pointInPolygon(b,polygon));}
  assert.throws(()=>normalizePolygon([[[0,0],[100,100],[0,100],[100,0]]]),/cross|enclose/);
  const target=seededPointInPolygon(polygon,42);assert.ok(pointInPolygon(target,polygon));assert.deepEqual(target,seededPointInPolygon(polygon,42));
});

test('A* routes around unavailable cells',()=>{
  const path=astarGrid({rows:7,cols:7,start:[3,0],goal:[3,6],height:()=>100,allowed:(r,c)=>c!==3||r===1});
  assert.deepEqual(path[0],[3,0]);assert.deepEqual(path.at(-1),[3,6]);assert.ok(path.some(([r,c])=>r===1&&c===3));
});

test('regional delivery simulation delivers once and returns to A',()=>{
  const start=[0,0,100],tasks=[{point:[10,0,110],kind:'deliver',photo:null},{point:start,kind:'return',photo:null}],events=[];
  const plan={mode:'delivery',start,tasks,parts:[tasks],photoCount:0,requiredBattery:20,options:{speed:5,climbSpeed:2,flightMinutes:30}};
  const sim=new RegionalMissionSimulation(plan,{onEvent:event=>events.push(event)});sim.start();for(let i=0;i<100&&sim.active;i++)sim.advanceReal(1);
  assert.equal(sim.phase,'complete');assert.deepEqual(sim.position,start);assert.equal(events.filter(e=>e.type==='delivered').length,1);assert.equal(sim.returns,1);
});

test('search result remains available and emits a found event',()=>{
  const start=[0,0,100],target=[10,0,100],tasks=[{point:target,kind:'found',photo:null},{point:start,kind:'return',photo:null}],events=[];
  const plan={mode:'search',start,target,tasks,parts:[tasks],photoCount:0,requiredBattery:20,options:{speed:5,climbSpeed:2,flightMinutes:30}};
  const sim=new RegionalMissionSimulation(plan,{onEvent:event=>events.push(event)});sim.start();for(let i=0;i<100&&sim.active;i++)sim.advanceReal(1);
  assert.deepEqual(sim.result.location,target);assert.equal(events.filter(e=>e.type==='found').length,1);
});
