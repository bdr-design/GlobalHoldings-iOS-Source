'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const core=require(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp/simulation-core.js'));
function scenario(callbackDelayMs){
  let wall=0,time=0,commits=0;const fatal=[];
  const engine=core.create({getSimTime:()=>time,setSimTime:v=>{time=v;},getSpeed:()=>30,
    createSliceJob:(slice,meta)=>{wall+=.1;return {runChunk:()=>{wall+=.1;return true;},finish:()=>{wall+=.1;time=meta.to;commits++;return {committed:true};}};},onFatal:e=>fatal.push(e.message)
  },{nowMs:()=>wall,allowedSpeeds:[0,1,5,15,30],fallbackSpeed:1,frameBudgetMs:4,chunkItems:32,minRealSliceSeconds:.5});
  for(let frame=1;frame<=120;frame++){const rafTimestamp=frame*16;wall=rafTimestamp+callbackDelayMs;engine.frame(rafTimestamp);}
  assert(commits>0,`all simulation work starved when rAF callback arrives ${callbackDelayMs}ms after timestamp`);
  assert(time>0&&time<=120*.016*30+1e-7,'do not manufacture additional elapsed simulation time');assert.deepEqual(fatal,[]);
  return {callbackDelayMs,commits,simSeconds:time,slices:engine.snapshot().slices};
}
console.log(JSON.stringify({suite:'late-frame-liveness',results:[0,8,25,100].map(scenario),passed:4,total:4},null,2));
