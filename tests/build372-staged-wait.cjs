'use strict';
// Build 372: a staged transaction's step(deadline) runs stages until the deadline, but a stage ending in '-wait' (a
// section waiting for another thread, as the save check waits for the fleet engine worker's classes, save-schema
// 'fleet-classes-wait', yielded through a post-commit critical task) ends the call. A live slice gives a deadline, and
// spun through every one of the 1800 waits in one frame (about a millisecond), so the check then read every row of a
// million-asset fleet on the main thread (334 ms) whatever the worker answered. This gate holds:
//  - with a frame's deadline, ordinary stages all run in one call, a wait stage ends the call, and one wait is spent per call;
//  - the waits stop once the awaited value is there, and the transaction then commits with the stages' result;
//  - a wait yielded from a post-commit critical task ('post-commit:fleet-classes-wait') ends the call too.
const assert=require('node:assert/strict');
const path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require('./helpers/core-harness');
const {s}=harness(['transaction-core']);
const TX=s.GH_TRANSACTION_CORE;
// A frame's deadline, well beyond what the plain stages here need: without the rule a wait spins until it.
const FRAME=()=>(globalThis.performance?.now?.()??Date.now())+30;

{
  // Apply stages: three plain stages, then a section that waits for a value set from outside after three calls.
  const target={n:0,log:[]},box={ready:false};let waits=0;
  const handle=TX.beginStaged(target,{label:'qa-staged-wait',scope:['n','log'],apply:function*(){
    target.n=1;yield 'a';target.n=2;yield 'b';target.n=3;yield 'c';
    while(!box.ready){waits++;yield 'qa-worker-wait';}
    target.log.push('after-wait');return 'done';
  }});
  const calls=[];
  for(let call=0;call<10&&!handle.done;call++){
    if(call===3)box.ready=true;
    handle.step(FRAME());calls.push({stage:handle.stage,waits,done:handle.done});
  }
  assert.equal(calls[0].stage,'qa-worker-wait','the first call ran the plain stages and stopped at the wait');
  assert.equal(calls[0].waits,1);assert.equal(calls[1].waits,2);assert.equal(calls[2].waits,3,'one wait per call');
  assert.equal(handle.done,true);assert.equal(handle.error,null);assert.equal(handle.result.committed,true);assert.equal(handle.result.value,'done');
  assert.deepEqual(target.log,['after-wait']);assert.equal(waits,3);
}
{
  // A post-commit critical task that waits (as the control plane's schema sections do).
  const target={n:0},box={ready:false};let waits=0;
  const handle=TX.beginStaged(target,{label:'qa-staged-postcommit-wait',scope:['n'],apply:function*(){
    target.n=1;
    TX.afterCommit(function(){return (function*(){while(!box.ready){waits++;yield 'fleet-classes-wait';}})();},{critical:true,key:'qa-wait',owner:'qa'});
    yield 'a';return 'ok';
  }});
  const stages=[];
  for(let call=0;call<20&&!handle.done;call++){if(waits===2)box.ready=true;handle.step(FRAME());stages.push(handle.stage);}
  assert.equal(handle.done,true);assert.equal(handle.error,null);assert.equal(handle.result.committed,true);
  assert.equal(waits,2,'one post-commit wait per call');
  assert.ok(stages.filter(stage=>stage==='post-commit:fleet-classes-wait').length>=2,`stages: ${stages.join(',')}`);
}
{
  // Without a wait, a frame's deadline still runs every stage in one call (the frame budget is unchanged).
  const target={n:0};
  const handle=TX.beginStaged(target,{label:'qa-staged-no-wait',scope:['n'],apply:function*(){for(let k=0;k<50;k++){target.n=k;yield `s${k}`;}return 'ok';}});
  handle.step(FRAME());assert.equal(handle.done,true);assert.equal(handle.result.committed,true);
}
console.log(JSON.stringify({ok:true}));
