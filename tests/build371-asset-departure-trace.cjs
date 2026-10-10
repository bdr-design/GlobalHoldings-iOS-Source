'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {createSimulationAdapter,fixture}=require('./helpers/fleet-simulation-adapter');

(async()=>{
  const {s}=harness(['diagnostics-core']),state=minimal();
  const modes={air:2,sea:1,road:1},reasons={'route-capacity-full':4};
  for(let i=0;i<200;i++)s.GH_DIAGNOSTICS.recordAssetDepartureTrace(state,{source:'manual-preflight',attempts:4,departed:0,blocked:4,modeCounts:modes,reasonCounts:reasons,samples:[{assetId:`A-${i}`,mode:'air',outcome:'blocked',reasonCode:'route-capacity-full'}]});
  const snapshot=s.GH_DIAGNOSTICS.departureTraceSnapshot(state);
  assert.equal(snapshot.totalAttempts,800);
  assert.equal(snapshot.totalBlocked,800);
  assert.equal(snapshot.byMode.air,400);
  assert.equal(snapshot.byReason['route-capacity-full'],800);
  assert.equal(snapshot.recent.length,160,'departure evidence ring remains bounded');
  assert.equal(JSON.stringify(state).includes('assetDepartureTrace'),false,'runtime trace does not enlarge saved game state');
  const bundle=s.GH_DIAGNOSTICS.exportBundle(state,{appVersion:'3.0.0'});
  assert.equal(bundle.assetDepartureTrace.totalAttempts,800,'diagnostic export contains flight trace without manually starting the generic recorder');
  const asyncBundle=await s.GH_DIAGNOSTICS.exportBundleAsync(state,{appVersion:'3.0.0'},{budgetMs:1});
  assert.equal(asyncBundle.assetDepartureTrace.totalAttempts,800,'native async diagnostic export contains the same trace');

  const rows=[fixture.make('air','A1',{id:'TRACE-AIR',phase:'turnaround',dwellRemaining:0}),fixture.make('sea','S1',{id:'TRACE-SEA',phase:'turnaround',dwellRemaining:0}),fixture.make('road','R1',{id:'TRACE-ROAD',phase:'turnaround',dwellRemaining:0})];
  const sim=createSimulationAdapter({from:0,assets:rows});
  sim.s.recordAssetDepartureTrace=()=>null;
  const job=sim.makeJob({from:0,to:1,staged:false});while(job.runChunk(32)!==true){}const result=job.finish();
  assert.equal(result.committed,true);
  assert.equal(result.departureTrace.attempts,3,'simulation records each air, sea, and road departure');
  assert.equal(result.departureTrace.departed,3);
  assert.equal(result.departureTrace.blocked,0);
  assert.deepEqual({...result.departureTrace.modeCounts},{air:1,sea:1,road:1});
  const blockedRows=[fixture.make('air','A1',{id:'TRACE-NO-CREW',phase:'turnaround',dwellRemaining:0,staffing:{mode:'automatic-fixed',ready:false}}),fixture.make('road','R-MISSING',{id:'TRACE-NO-ROUTE',phase:'turnaround',dwellRemaining:0})];
  const blockedSim=createSimulationAdapter({from:0,assets:blockedRows});blockedSim.s.recordAssetDepartureTrace=()=>null;
  const blockedJob=blockedSim.makeJob({from:0,to:1,staged:false});while(blockedJob.runChunk(32)!==true){}const blockedResult=blockedJob.finish();
  assert.equal(blockedResult.departureTrace.blocked,2);
  assert.equal(blockedResult.departureTrace.reasonCounts['asset-staffing-invalid'],1);
  assert.equal(blockedResult.departureTrace.reasonCounts['route-runtime-missing'],1);
  console.log('build371 asset departure trace: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
