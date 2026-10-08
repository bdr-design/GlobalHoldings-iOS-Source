'use strict';
const assert=require('assert');
global.window=global;require('../WebApp/simulation-time-core.js');require('../WebApp/simulation-pacing-core.js');const Simulation=require('../WebApp/simulation-core.js');

let now=0,time=0,created=0,finished=0,cleaned=0,cancelled=0,lastMeta=null;
const engine=Simulation.create({
  getSimTime:()=>time,setSimTime:value=>{time=value;},getSpeed:()=>0,
  getManualAggregateLimit:({from,target})=>Math.min(23*3600,target-from),
  createSliceJob:(_slice,meta)=>{created++;lastMeta=meta;const hold=created>2;return {aggregate:meta.aggregate,runChunk:()=>hold?{pending:true}:true,finish:()=>{finished++;return {committed:true,completeTo:meta.to};},cancel:()=>{cancelled++;},cleanup:()=>{cleaned++;}};}
},{nowMs:()=>now,allowedSpeeds:[0,30,600],fallbackSpeed:30,manualBatchSeconds:3600,manualMinBatchSeconds:300,manualAggregateMaxSeconds:86400});
assert(engine.advanceTo(86400,{speed:600,batchSeconds:3600}).accepted);
for(let i=0;i<20&&engine.snapshot().manualAdvance;i++){now+=16;engine.frame(now);}
assert.equal(time,86400);assert.equal(created,2,'empty day is one aggregate plus its isolated midnight boundary');assert.equal(finished,2);assert.equal(cleaned,2,'committed job resources release exactly once');assert.equal(lastMeta.aggregate,false);assert.equal(engine.snapshot().aggregateSlices,1);assert.equal(engine.snapshot().jobCleanups,2);

assert(engine.advanceTo(2*86400,{speed:600,batchSeconds:3600}).accepted);now+=16;engine.frame(now);engine.cancelAdvance('qa-cancel');
assert.equal(cancelled,1);assert.equal(cleaned,3,'cancelled job uses the same single cleanup path');assert.equal(engine.snapshot().jobActive,false);
console.log(JSON.stringify({suite:'build362-simulation-lifecycle',created,finished,cancelled,cleaned,aggregateSlices:engine.snapshot().aggregateSlices,cleanupErrors:engine.snapshot().cleanupErrors}));
