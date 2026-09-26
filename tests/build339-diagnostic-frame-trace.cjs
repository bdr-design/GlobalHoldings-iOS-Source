'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

const {s}=harness(['diagnostics-core']);
const state=minimal();state.speed=600;state.assets=[];state.sectorProfitToday={};state.tripRevenueAccrued={};
class FakePerformanceObserver{constructor(callback){this.callback=callback;FakePerformanceObserver.active=this;}observe(){}}
FakePerformanceObserver.supportedEntryTypes=['longtask'];s.PerformanceObserver=FakePerformanceObserver;s.document={visibilityState:'visible'};s.navigator={language:'en',onLine:true,userAgent:'diagnostic-frame-test'};
s.GH_DIAGNOSTICS.installGlobalHandlers(()=>state,()=>({build:339}));
const diag=s.GH_DIAGNOSTICS,perf0=1000,wall0=1000000000000,step=1000/60;
diag.recorderStart(state,{speed:600,frames:0,slices:0},{nowMs:wall0,performanceNowMs:perf0,context:{build:339}});
assert.equal(diag.recorderIsActive(state),true);
let raf=perf0;
function frame(at,work={}){
  const callbackStartMs=at+.25,callbackEndMs=callbackStartMs+(work.callbackMs??2);
  return diag.recorderFrame(state,{rafTimestampMs:at,callbackStartMs,callbackEndMs,simSeconds:state.simSeconds,visible:true,hidden:false,panel:'map',mapActive:true,fleetSize:1420,ownMarkers:1085,mobilityMarkers:0,simulationMs:work.simulationMs??1,targetUpdateMs:work.targetUpdateMs??1,markerAnimationMs:work.markerAnimationMs??0,structuralRenderMs:0,targetUpdated:true,simulationStage:work.stage||'chunk',guardReason:work.guardReason||'',simulationGovernor:work.governor||'GREEN',simulationBacklog:0,simulationJobActive:false},{transactionProvider:()=>work.transaction||({label:'simulation:949800->950400',correlationId:'SIM-JOB-42',stage:'rollback',committed:false,totalMs:245,snapshotMs:72,validateMs:8,applyMs:80,rollbackMs:85,recordedAtMs:wall0})});
}
for(let i=0;i<40;i++){frame(raf);raf+=step;}
frame(raf,{callbackMs:58,simulationMs:42,targetUpdateMs:9,stage:'finish',governor:'RED'});raf+=step;
frame(raf+step*3,{callbackMs:2});raf+=step*3;
let frameDrop=diag.recorderSnapshot(state).events.find(row=>row.type==='FRAME_DROP');
assert.equal(frameDrop?.detail?.cause?.kind,'measured-app-stage','preceding app work must explain a delayed frame when stage timing matches');
assert.equal(frameDrop?.detail?.cause?.stage,'simulation');
assert.equal(frameDrop?.detail?.transaction?.correlationId,'SIM-JOB-42');
assert.equal(frameDrop?.detail?.estimatedMissedFrames,3);
raf+=step;
for(let i=0;i<20;i++){frame(raf);raf+=step;}
const longTaskStart=raf+5;
FakePerformanceObserver.active.callback({getEntries:()=>[{startTime:longTaskStart,duration:65,name:'self',attribution:[{containerType:'window',containerName:'app',containerId:'main',containerSrc:'https://example.invalid'}]}]});
frame(raf+step*5,{callbackMs:2});raf+=step*5;
const latestDrop=diag.recorderSnapshot(state).events.find(row=>row.type==='FRAME_DROP');
assert.equal(latestDrop?.detail?.cause?.kind,'browser-long-task-overlap','long-task timing must be attached to the matching frame gap');
assert.equal(latestDrop?.detail?.overlappingLongTasks?.[0]?.primaryAttribution?.containerName,'app');
const longTaskTrace=diag.recorderSnapshot(state).events.find(row=>row.type==='LONG_TASK_TRACE');
assert.equal(longTaskTrace?.detail?.attribution?.[0]?.containerName,'app');

for(let i=0;i<280;i++){frame(raf);raf+=step;}
const transactionFinishAt=raf+step*2;
frame(raf+step*5,{callbackMs:2,transaction:{label:'simulation:950400->951000',correlationId:'SIM-JOB-43',stage:'rollback',committed:false,totalMs:245,snapshotMs:72,validateMs:8,applyMs:80,rollbackMs:85,recordedAtMs:wall0-perf0+transactionFinishAt}});raf+=step*5;
const transactionDrop=diag.recorderSnapshot(state).events.find(row=>row.type==='FRAME_DROP'&&row.detail?.transaction?.correlationId==='SIM-JOB-43');
assert.equal(transactionDrop?.detail?.cause?.kind,'transaction-correlated','a transaction is correlated only when its completion timestamp falls inside the delayed-frame window');
raf+=step;
for(let i=0;i<20;i++){frame(raf);raf+=step;}
frame(raf,{callbackMs:35,guardReason:'boundary-recovery'});raf+=step;
frame(raf+step*3,{callbackMs:2});raf+=step*3;
const guardedDrop=diag.recorderSnapshot(state).events.find(row=>row.type==='FRAME_DROP'&&row.detail?.cause?.kind==='measured-lifecycle-guard');
assert.equal(guardedDrop?.detail?.cause?.stage,'boundary-recovery','expensive guarded callbacks must be captured and attributed');
for(let i=0;i<45;i++)diag.recorderEvent(state,'TEST_TRACE_ROW',{index:i},'info',{nowMs:wall0+i+1});
for(let i=0;i<70;i++)diag.recorderSample(state,{speed:600,frames:i,slices:i,assets:state.assets},{nowMs:wall0+1000+i*700});
const stateBefore=JSON.stringify(state);
const status=diag.recorderSnapshot(state);
assert.ok(status.frameSummary.frameCallbacks>300);
assert.equal(status.frameSummary.jankyFrames,4);
assert.equal(status.frameSummary.longTasks,1);
assert.equal(status.sampleCount,71,'the live panel must expose the true sample total despite its compact view');
assert.equal(JSON.stringify(state),stateBefore,'frame diagnostics must remain outside the saved simulation state');
assert.equal(JSON.stringify(status.frameTrace).includes('longTasksRecent'),false,'internal ring buffers must not leak into the report');
const summary=diag.recorderStop(state,{speed:600,frames:400,slices:400},{nowMs:wall0+400000});
assert.equal(summary.frameSummary.jankyFrames,4);
assert.ok(summary.findings.some(row=>row.type==='FRAME_DROP'));
const exported=diag.exportBundle(state,{appVersion:'3.0.0',saveSchemaVersion:'2.0.0',simulation:{}});
assert.ok(exported.faultRecorder.events.length>30,'diagnostic export must preserve more than 30 recorder events');
assert.equal(exported.faultRecorder.samples.length,72,'stop adds one final sample, and export must preserve all samples');
assert.equal(exported.faultRecorder.eventCount,summary.events,'export must expose the untruncated recorder event total');
assert.equal(exported.faultRecorder.frameTrace.length,240,'diagnostic export must preserve the full bounded frame trace');
assert.ok(exported.faultRecorder.frameSummary.frameCallbacks>300);
diag.clear(state);
assert.equal(diag.recorderSnapshot(state),null,'clear must remove the runtime frame trace');
const visibilityState=minimal();visibilityState.speed=0;visibilityState.assets=[];visibilityState.sectorProfitToday={};visibilityState.tripRevenueAccrued={};
diag.recorderStart(visibilityState,{speed:0,frames:0,slices:0},{nowMs:wall0,performanceNowMs:perf0});
function visibilityFrame(at,hidden=false){return diag.recorderFrame(visibilityState,{rafTimestampMs:at,callbackStartMs:at+.25,callbackEndMs:at+2,visible:!hidden,hidden,panel:'map',simulationMs:1,targetUpdateMs:1,markerAnimationMs:0,structuralRenderMs:0});}
visibilityFrame(perf0);visibilityFrame(perf0+step);visibilityFrame(perf0+step+500,true);visibilityFrame(perf0+step+1000);visibilityFrame(perf0+step+1000+step);
const visibilitySummary=diag.recorderSnapshot(visibilityState);
assert.equal(visibilitySummary.frameSummary.visibleIntervals,2,'background/foreground transition gaps must be excluded from active FPS');
assert.equal(visibilitySummary.frameSummary.jankyFrames,0);
assert.equal(visibilitySummary.frameSummary.longGaps,0);
assert.equal(visibilitySummary.frameTrace[3]?.effectiveFps,null,'the first foreground callback after a hidden frame has no FPS estimate');
diag.clear(visibilityState);
console.log(JSON.stringify({suite:'build339-diagnostic-frame-trace',passed:28,total:28,jankyFrames:summary.frameSummary.jankyFrames,frameCallbacks:summary.frameSummary.frameCallbacks,frameTrace:exported.faultRecorder.frameTrace.length,eventsExported:exported.faultRecorder.events.length,samplesExported:exported.faultRecorder.samples.length}));
