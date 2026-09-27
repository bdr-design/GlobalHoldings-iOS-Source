'use strict';
const assert=require('node:assert/strict');
const Simulation=require('../WebApp/simulation-core.js');

let now=0,simSeconds=0,speed=0,busy=false,completed=0;
const engine=Simulation.create({
  getSimTime:()=>simSeconds,setSimTime:value=>{simSeconds=value;},getSpeed:()=>speed,setSpeed:value=>{speed=value;},
  isInteractionBusy:()=>busy,
  createSliceJob:(_slice,meta)=>({runChunk:()=>true,finish:()=>{simSeconds=meta.to;return {committed:true};}}),
  onAdvance:detail=>{if(detail.completed)completed++;}
},{nowMs:()=>now,allowedSpeeds:[0,30],fallbackSpeed:30,manualBatchSeconds:300,manualMinBatchSeconds:300});

assert.equal(engine.advanceTo(300,{speed:30,batchSeconds:300}).accepted,true);
// The current state can reach the requested target just before the map gesture
// begins. Completion is still an observable finish signal and must wait too.
simSeconds=300;busy=true;now=16;engine.frame(now);
assert.equal(completed,0,'calendar finish callback never runs during a map drag');
assert.equal(engine.snapshot().manualAdvance.remaining,0,'pending completion is retained without altering committed game time');
busy=false;now=32;engine.frame(now);
assert.equal(completed,1,'deferred completion is published exactly once after the gesture');
assert.equal(engine.snapshot().manualAdvance,null);
console.log('Build342 interaction barrier: atomic finish and calendar completion are deferred until drag end PASS');
