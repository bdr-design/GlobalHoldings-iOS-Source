'use strict';
// Build 358 regression (acceptance and CI on the commit that staged the calendar day close): a staged slice moves the
// clock to its end when it starts and then runs across frames. The kernel used to call the calendar advance complete
// as soon as the clock reached the target, while that last slice was still in flight; the game is paused during a
// calendar advance, so the next frame cancelled the job ('paused') and rolled back the last day's close.
// The advance must finish only after the last slice commits, and the slice must never be cancelled.
const assert=require('node:assert/strict');
const path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require('./helpers/core-harness');
const {s}=harness(['simulation-core']);

function run({target,pendingChunks}){
  let wall=0,time=0;const commits=[],cancels=[],advanceEvents=[],observed=[];
  const engine=s.GH_SIMULATION_CORE.create({
    getSimTime:()=>time,setSimTime:t=>{time=t;},getSpeed:()=>0,setSpeed:()=>{},
    createSliceJob:(_slice,meta)=>{
      let chunks=0;
      return {
        // Like the staged day close: the first chunk moves the clock to the slice end, then the work stays pending.
        runChunk(){wall+=1;if(chunks===0)time=meta.to;chunks++;return chunks>pendingChunks?true:{pending:true};},
        finish(){wall+=1;commits.push({from:meta.from,to:meta.to});return {committed:true};},
        cancel(reason){cancels.push({reason,from:meta.from,to:meta.to});time=meta.from;}
      };
    },
    onAdvance:e=>advanceEvents.push({...e})
  },{nowMs:()=>wall,allowedSpeeds:[0,30,120,300,600],fallbackSpeed:30,manualBatchSeconds:86400,manualMinBatchSeconds:300,manualRetryLimit:3});
  assert.equal(engine.advanceTo(target,{speed:600,batchSeconds:86400,reason:'qa-staged-completion'}).accepted,true);
  for(let frame=0;frame<5000;frame++){
    wall+=16;engine.frame(wall);const k=engine.snapshot();observed.push({time,manual:!!k.manualAdvance,job:k.jobActive});
    if(!k.manualAdvance&&!k.jobActive)break;
  }
  for(let frame=0;frame<5;frame++){wall+=16;engine.frame(wall);}
  return {time,commits,cancels,advanceEvents,observed,kernel:engine.snapshot()};
}

for(const [target,pendingChunks] of [[86400,4],[3*86400,6],[86400,40]]){
  const out=run({target,pendingChunks}),name=`target ${target}, ${pendingChunks} pending chunks`;
  assert.deepEqual(out.cancels,[],`${name}: no slice is cancelled (${JSON.stringify(out.cancels)})`);
  assert.equal(out.time,target,`${name}: the clock stays at the target`);
  assert.equal(out.commits.at(-1)?.to,target,`${name}: the last slice commits`);
  for(let i=1;i<out.commits.length;i++)assert.equal(out.commits[i].from,out.commits[i-1].to,`${name}: committed slices are contiguous`);
  assert.equal(out.observed.some(row=>!row.manual&&row.job),false,`${name}: the advance never reads as finished while a slice is in flight`);
  const completed=out.advanceEvents.filter(e=>e.completed===true);
  assert.equal(completed.length,1,`${name}: one completion event`);
  assert.equal(out.kernel.manualAdvance,null);assert.equal(out.kernel.jobActive,false);
  console.log(`PASS ${name}: ${out.commits.length} slices committed, completion after the last commit`);
}
console.log('BUILD358_CALENDAR_STAGED_COMPLETION_PASS');
