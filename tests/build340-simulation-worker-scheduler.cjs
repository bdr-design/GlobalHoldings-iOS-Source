'use strict';

const assert=require('node:assert/strict');
const Simulation=require('../WebApp/simulation-core.js');
let now=0,simSeconds=0,speed=0,chunkCalls=0,finishCalls=0,cancelCalls=0;
const engine=Simulation.create({
  getSimTime:()=>simSeconds,setSimTime:value=>{simSeconds=value;},getSpeed:()=>speed,setSpeed:value=>{speed=value;},
  createSliceJob:(slice,meta)=>({
    runChunk(){chunkCalls++;return chunkCalls===1?{pending:true}:{done:true};},
    finish(){finishCalls++;simSeconds=meta.to;return {committed:true};},
    cancel(){cancelCalls++;}
  })
},{nowMs:()=>now,allowedSpeeds:[0,30],fallbackSpeed:30,frameBudgetMs:5.5,manualFrameBudgetMs:10,manualChunkItems:64,manualBatchSeconds:300,manualMinBatchSeconds:300});
assert.equal(engine.advanceTo(300,{speed:30,batchSeconds:300}).accepted,true);
now=16;engine.frame(now);
assert.equal(chunkCalls,1,'an asynchronous pending result yields immediately instead of spinning in the same frame');
assert.equal(finishCalls,0,'a pending plan cannot reach atomic commit');
assert.equal(simSeconds,0,'pending worker calculation does not advance authoritative time');
now=32;engine.frame(now);
assert.equal(chunkCalls,2);assert.equal(finishCalls,1);assert.equal(simSeconds,300);
assert.equal(engine.snapshot().slices,1);

let pendingFinish=0,pendingCancel=0,secondNow=0;
const cancellable=Simulation.create({
  getSimTime:()=>0,setSimTime:()=>{},getSpeed:()=>0,setSpeed:()=>{},
  createSliceJob:()=>({runChunk:()=>({pending:true}),finish:()=>{pendingFinish++;return {committed:true};},cancel:()=>{pendingCancel++;}})
},{nowMs:()=>secondNow,allowedSpeeds:[0,30],fallbackSpeed:30,manualBatchSeconds:300,manualMinBatchSeconds:300});
assert.equal(cancellable.advanceTo(300,{speed:30,batchSeconds:300}).accepted,true);secondNow=16;cancellable.frame(secondNow);
assert.equal(cancellable.cancelAdvance('test-stale-worker'),true);secondNow=32;cancellable.frame(secondNow);
assert.equal(pendingCancel,1);assert.equal(pendingFinish,0,'cancelled or late worker output must never commit');
console.log('PASS scheduler yields one pending worker request per frame and rejects cancelled output before commit');

let interactionBusy=false,interactionTime=0,interactionFinish=0,interactionCancel=0,interactionChunks=0;
const interactionEngine=Simulation.create({
  getSimTime:()=>interactionTime,setSimTime:value=>{interactionTime=value;},getSpeed:()=>30,setSpeed:()=>{},isInteractionBusy:()=>interactionBusy,
  createSliceJob:(slice,meta)=>({
    runChunk(){interactionChunks++;return interactionChunks===1?{pending:true}:{done:true};},
    finish(){interactionFinish++;interactionTime=meta.to;return {committed:true};},
    cancel(){interactionCancel++;}
  })
},{nowMs:()=>0,allowedSpeeds:[0,30],fallbackSpeed:30,manualBatchSeconds:300,manualMinBatchSeconds:300});
assert.equal(interactionEngine.advanceTo(300,{speed:30,batchSeconds:300}).accepted,true);
interactionEngine.frame(16);
interactionBusy=true;interactionEngine.frame(32);
assert.equal(interactionFinish,0,'map gestures defer an already-prepared atomic simulation commit');
assert.equal(interactionTime,0,'authoritative simulation time remains unchanged while map input is active');
assert.equal(interactionCancel,0,'map input must preserve the prepared slice instead of discarding it');
interactionBusy=false;interactionEngine.frame(48);
assert.equal(interactionFinish,1,'the preserved slice commits as soon as the gesture ends');
assert.equal(interactionTime,300);
assert.equal(interactionEngine.snapshot().slices,1,'the deferred slice commits exactly once');
console.log('PASS map gesture preserves the pending atomic simulation slice and commits it once afterward');
