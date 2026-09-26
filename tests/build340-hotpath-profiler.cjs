'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

const {s}=harness(['transaction-core','diagnostics-core']),tx=s.GH_TRANSACTION_CORE,diag=s.GH_DIAGNOSTICS;
const state=minimal();state.assets=[];state.diagnostics={};state.profileCounter=0;
const wall0=1000000000000,perf0=100;
diag.recorderStart(state,{speed:1},{nowMs:wall0,performanceNowMs:perf0});
assert.equal(tx.telemetry().profiledCount,0,'starting a recorder clears old profile samples');
const committed=tx.execute(state,{
  label:'simulation:0->3600',
  profileContext:{kind:'simulation-slice',from:0,to:3600,assetCount:20000,dayBoundary:null,unsafe:{drop:true}},
  validate:measure=>measure('simulation.validate.asset-guards',()=>({ok:true})),
  apply:measure=>measure('simulation.apply.batch',()=>{
    state.profileCounter++;
    measure('simulation.apply.finance-plan',()=>{state.profileCounter++;});
    return true;
  })
});
assert.equal(committed.committed,true);
let telemetry=tx.telemetry();
assert.equal(telemetry.profiledCount,1);
assert.equal(telemetry.profiledSamples.length,1);
const sample=telemetry.profiledSamples[0];
assert.equal(sample.profileContext.assetCount,20000);
assert.equal(Object.hasOwn(sample.profileContext,'unsafe'),false,'profile metadata only retains safe scalar context');
assert.equal(sample.profiled,true);
assert.equal(sample.phaseBreakdown.find(row=>row.name==='simulation.apply.batch').depth,0);
assert.equal(sample.phaseBreakdown.find(row=>row.name==='simulation.apply.finance-plan').depth,1);
assert.ok(Number.isFinite(sample.validateMs)&&Number.isFinite(sample.applyMs)&&Number.isFinite(sample.totalMs));

function frame(state,rafTimestampMs){
  return diag.recorderFrame(state,{rafTimestampMs,callbackStartMs:rafTimestampMs+.2,callbackEndMs:rafTimestampMs+1,visible:true,hidden:false,panel:'map'});
}
function cadence(intervals){
  const {s:probe}=harness(['transaction-core','diagnostics-core']),probeDiag=probe.GH_DIAGNOSTICS,sampleState=minimal();sampleState.assets=[];probeDiag.recorderStart(sampleState,{speed:0},{nowMs:wall0,performanceNowMs:perf0});
  let now=perf0;
  const record=(at)=>probeDiag.recorderFrame(sampleState,{rafTimestampMs:at,callbackStartMs:at+.2,callbackEndMs:at+1,visible:true,hidden:false,panel:'map'});
  record(now);
  for(const interval of intervals){now+=interval;record(now);}
  return probeDiag.recorderSnapshot(sampleState).frameSummary;
}
const sixty=cadence([3.96,...Array(24).fill(17.25)]);
assert.ok(sixty.expectedFrameIntervalMs>15&&sixty.expectedFrameIntervalMs<19,'a first anomalous frame gap must not set the cadence baseline');
assert.ok(sixty.estimatedRefreshHz>50&&sixty.estimatedRefreshHz<70,'60Hz observed cadence should not report a 250Hz refresh');
assert.equal(sixty.hardwareRefreshRateMeasured,false);
const ninety=cadence(Array(30).fill(1000/90));
assert.ok(ninety.expectedFrameIntervalMs>10&&ninety.expectedFrameIntervalMs<12);
const oneTwenty=cadence(Array(30).fill(1000/120));
assert.ok(oneTwenty.expectedFrameIntervalMs>7&&oneTwenty.expectedFrameIntervalMs<10);

for(let i=0;i<35;i++)frame(state,perf0+i*1000/60);
const exported=diag.exportBundle(state,{appVersion:'3.0.0',saveSchemaVersion:'2.0.0',simulation:{frames:35}});
assert.equal(exported.simulation.transactionProfile.capturedCount,1);
assert.equal(exported.simulation.lastFinishBreakdown.label,'simulation:0->3600');
assert.ok(exported.simulation.lastFinishBreakdown.phaseBreakdown.some(row=>row.name==='simulation.validate.asset-guards'));
assert.equal(exported.stateSummary.assets,0);

const beforeRejected=JSON.stringify(state);
assert.throws(()=>tx.execute(state,{label:'hr:appoint-official-manager',validate:measure=>measure('hr.validate.authority',()=>{throw new Error('profile-validation-failure');}),apply:()=>{state.profileCounter=99;}}),/profile-validation-failure/);
assert.equal(JSON.stringify(state),beforeRejected,'profiling must not weaken Full Snapshot rollback');
const rejected=tx.telemetry().profiledSamples.find(row=>row.label==='hr:appoint-official-manager');
assert.equal(rejected.stage,'validate');
assert.ok(Number.isFinite(rejected.validateMs),'failed validation still receives a phase duration');
assert.equal(rejected.phaseBreakdown.find(row=>row.name==='hr.validate.authority').ok,false);

diag.recorderStop(state,{speed:0},{nowMs:wall0+1000});
console.log(JSON.stringify({suite:'build340-hotpath-profiler',passed:22,total:22,cadence60Ms:sixty.expectedFrameIntervalMs,cadence90Ms:ninety.expectedFrameIntervalMs,cadence120Ms:oneTwenty.expectedFrameIntervalMs,profilePhases:sample.phaseBreakdown.length}));
