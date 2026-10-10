'use strict';
// Build 371 regression (Simulation Core): a cancelled calendar request is published only after the maintenance its
// committed boundaries scheduled has drained, exactly as a completed one is. Before Build 371 cancelAdvance published at
// once and the host's queued maintenance (the daily ledger compaction) rewrote the books after the request was reported
// cancelled (tests/build334-calendar-journey-browser.cjs failed intermittently on that).
const assert=require('assert');
global.window=global;require('../WebApp/simulation-time-core.js');require('../WebApp/simulation-pacing-core.js');const Simulation=require('../WebApp/simulation-core.js');

// A deterministic host: every committed slice that reaches a 12-hour boundary queues `parts` maintenance parts.
function harness({parts=3,suspended=()=>false}={}){
  const h={now:0,time:0,created:0,finished:0,cancelled:0,deferred:0,deferredRuns:0,events:[],writesAfterPublish:0,published:false};
  h.engine=Simulation.create({
    getSimTime:()=>h.time,setSimTime:value=>{h.time=value;},getSpeed:()=>0,
    createSliceJob:(_slice,meta)=>{h.created++;return {aggregate:meta.aggregate,runChunk:()=>{h.now+=3;return true;},finish:()=>{h.finished++;return {committed:true,completeTo:meta.to};},cancel:()=>{h.cancelled++;},cleanup:()=>{}};},
    onMaintenance:()=>{h.deferred+=parts;},
    hasDeferredWork:()=>!suspended()&&h.deferred>0,
    runDeferredWork:()=>{if(suspended()||!h.deferred)return false;h.deferred--;h.deferredRuns++;if(h.published)h.writesAfterPublish++;return true;},
    isSuspended:()=>suspended(),
    onAdvance:detail=>{h.events.push(detail);if(detail.active===false)h.published=true;}
  },{nowMs:()=>h.now,allowedSpeeds:[0,30,600],fallbackSpeed:30,manualBatchSeconds:3600,manualMinBatchSeconds:300,maintenanceEveryHours:12});
  h.frame=()=>{h.now+=16;h.engine.frame(h.now);};
  // Frames until the first committed slice that queued maintenance (the race window of the browser test).
  h.untilMaintenanceQueued=()=>{for(let i=0;i<4000&&h.deferred===0;i++)h.frame();assert(h.deferred>0,'a boundary queued maintenance');};
  return h;
}
const terminal=h=>h.events.filter(e=>e.active===false);
const results=[];
function test(name,fn){try{const detail=fn();results.push({name,ok:true,...(detail||{})});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}

test('cancel inside the boundary task settles the queued maintenance before it is published',()=>{
  const h=harness({parts:4});assert(h.engine.advanceTo(3*86400,{speed:600,batchSeconds:3600}).accepted);h.untilMaintenanceQueued();
  const timeAtCancel=h.time,created=h.created;
  assert.equal(h.engine.cancelAdvance('qa-cancel'),true);
  const atCancel=h.engine.snapshot().manualAdvance;
  assert(atCancel&&atCancel.cancelling===true,'the request stays visible while its maintenance settles');assert.equal(atCancel.cancelReason,'qa-cancel');
  assert.equal(terminal(h).length,0,'nothing is published while maintenance is queued');
  for(let i=0;i<20;i++)h.frame();
  assert.equal(h.time,timeAtCancel,'no simulated time after the cancel');assert.equal(h.created,created,'no slice starts after the cancel');
  assert.equal(h.deferred,0);assert.equal(h.deferredRuns,4);assert.equal(h.writesAfterPublish,0,'no maintenance part runs after the cancellation is published');
  const ends=terminal(h);assert.equal(ends.length,1);assert.equal(ends[0].cancelled,true);assert.equal(ends[0].reason,'qa-cancel');assert(!ends.some(e=>e.completed),'a cancelled request is never reported completed');
  assert.equal(h.engine.snapshot().manualAdvance,null);
  return {timeAtCancel,deferredRuns:h.deferredRuns};
});

test('cancel with no queued maintenance is published at once (unchanged)',()=>{
  const h=harness({parts:0});assert(h.engine.advanceTo(300*86400,{speed:600,batchSeconds:3600}).accepted);for(let i=0;i<200&&!h.engine.snapshot().slices;i++)h.frame();assert(h.engine.snapshot().slices>0);assert.equal(h.deferred,0);assert(h.engine.snapshot().manualAdvance,"still advancing");
  assert.equal(h.engine.cancelAdvance('qa-cancel'),true);assert.equal(h.engine.snapshot().manualAdvance,null);assert.equal(terminal(h).length,1);assert.equal(terminal(h)[0].cancelled,true);
});

test('a second cancel while settling neither repeats the event nor changes its reason',()=>{
  const h=harness({parts:2});h.engine.advanceTo(3*86400,{speed:600,batchSeconds:3600});h.untilMaintenanceQueued();
  h.engine.cancelAdvance('first');assert.equal(h.engine.cancelAdvance('second'),true);
  for(let i=0;i<10;i++)h.frame();assert.equal(terminal(h).length,1);assert.equal(terminal(h)[0].reason,'first');
});

test('a new request is refused while a cancellation settles',()=>{
  const h=harness({parts:3});h.engine.advanceTo(3*86400,{speed:600,batchSeconds:3600});h.untilMaintenanceQueued();h.engine.cancelAdvance('qa');
  const refused=h.engine.advanceTo(h.time+86400,{speed:600});assert.equal(refused.accepted,false);assert.equal(refused.reason,'advance-cancel-settling');
  for(let i=0;i<10;i++)h.frame();assert.equal(h.engine.snapshot().manualAdvance,null);
  assert.equal(h.engine.advanceTo(h.time+86400,{speed:600}).accepted,true,'accepted once the cancel is published');
});

test('immediate cancel (halt, fatal) publishes at once and leaves the maintenance to the host',()=>{
  const h=harness({parts:3});h.engine.advanceTo(3*86400,{speed:600,batchSeconds:3600});h.untilMaintenanceQueued();
  h.engine.cancelAdvance('global-halt',{immediate:true});assert.equal(h.engine.snapshot().manualAdvance,null);assert.equal(terminal(h).length,1);assert.equal(terminal(h)[0].reason,'global-halt');
});

test('reset (hidden, speed change) settles through the same path; a hidden page publishes only after it resumes and drains',()=>{
  const h=harness({parts:3});h.engine.advanceTo(3*86400,{speed:600,batchSeconds:3600});h.untilMaintenanceQueued();const timeAtHide=h.time;
  h.engine.setHidden(true);for(let i=0;i<10;i++)h.frame();
  assert.equal(terminal(h).length,0,'not published while hidden with maintenance queued');assert.equal(h.deferredRuns,0,'no maintenance while hidden');assert.equal(h.time,timeAtHide);
  h.engine.setHidden(false);for(let i=0;i<10;i++)h.frame();
  assert.equal(h.deferred,0);assert.equal(terminal(h).length,1);assert.equal(terminal(h)[0].reason,'hidden');assert.equal(h.writesAfterPublish,0);assert.equal(h.time,timeAtHide);
});

test('a suspended host (durable command, locked save) never lets the cancellation publish over unreported maintenance',()=>{
  let suspended=false;const h=harness({parts:3,suspended:()=>suspended});h.engine.advanceTo(3*86400,{speed:600,batchSeconds:3600});h.untilMaintenanceQueued();
  suspended=true;h.engine.cancelAdvance('qa');for(let i=0;i<10;i++)h.frame();
  assert.equal(terminal(h).length,0,'hasDeferredWork reads false while suspended, so the cancel waits');assert(h.engine.snapshot().manualAdvance?.cancelling);
  suspended=false;for(let i=0;i<10;i++)h.frame();assert.equal(terminal(h).length,1);assert.equal(h.deferred,0);assert.equal(h.writesAfterPublish,0);
});

test('repeated advance and cancel cycles post each boundary once and publish each cancel once',()=>{
  const h=harness({parts:2});let cycles=0;
  for(let round=0;round<5;round++){h.published=false;assert(h.engine.advanceTo(h.time+3*86400,{speed:600,batchSeconds:3600}).accepted);h.untilMaintenanceQueued();h.engine.cancelAdvance(`qa-${round}`);for(let i=0;i<10;i++)h.frame();assert.equal(h.engine.snapshot().manualAdvance,null);cycles++;}
  const ends=terminal(h);assert.equal(ends.length,5);assert.deepEqual(ends.map(e=>e.reason),['qa-0','qa-1','qa-2','qa-3','qa-4']);assert(ends.every(e=>e.cancelled===true));assert.equal(h.writesAfterPublish,0);
  assert.equal(h.finished,h.engine.snapshot().slices,'every created slice either committed once or was cancelled');
  return {cycles,slices:h.engine.snapshot().slices};
});

test('completion is unchanged: published after the drain, never as a cancel',()=>{
  const h=harness({parts:3});h.engine.advanceTo(43200,{speed:600,batchSeconds:3600});for(let i=0;i<400&&h.engine.snapshot().manualAdvance;i++)h.frame();
  const ends=terminal(h);assert.equal(ends.length,1);assert.equal(ends[0].completed,true);assert.equal(h.deferred,0);assert.equal(h.time,43200);assert.equal(h.writesAfterPublish,0);
});

console.log(JSON.stringify({suite:'build371-calendar-cancel-settle-core',passed:results.filter(r=>r.ok).length,total:results.length,results},null,2));
if(results.some(r=>!r.ok))process.exitCode=1;
