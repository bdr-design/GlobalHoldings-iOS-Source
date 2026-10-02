'use strict';
const assert=require('node:assert/strict');
const {createSimulationAdapter,makeAsset,fixture}=require('./helpers/fleet-simulation-adapter');

function test(name,fn){try{console.log(JSON.stringify({test:name,ok:true,detail:fn()}));}catch(error){console.error(JSON.stringify({test:name,ok:false,error:String(error.stack||error)}));process.exitCode=1;}}

test('event slice writes gameplay roots in its declared scope and fleet rows through the journal',()=>{
  const rows=Array.from({length:3},(_,index)=>makeAsset(`B339-${index}`,{progress:.995}));
  const x=createSimulationAdapter({assets:rows}),beforeRevision=x.state.fleet.revision;
  const job=x.makeJob({to:x.state.simSeconds+30}),ready=job.runChunk(32);assert.equal(ready,true);
  const result=job.finish();assert.equal(result.committed,true);
  const metric=x.s.GH_TRANSACTION_CORE.telemetry().last;
  assert.equal(metric.fullSnapshot,false,'the fleet is excluded from the cloned transaction state');
  assert.equal(metric.writeAudit?.enabled,true);assert.equal(metric.writeAudit.stage,'pre-irreversible');
  assert.deepEqual(metric.writeAudit.undeclaredRoots,[]);
  assert(metric.writeAudit.declaredRoots.includes('fleet'));
  assert(metric.writeAudit.mutatedRoots.includes('simSeconds'));
  assert(x.state.fleet.revision>beforeRevision,'event writes touched the fleet journal before changing rows');
  assert.equal(result.completeTo,x.state.simSeconds);
  return {events:metric.label,writeAudit:metric.writeAudit,fleetRevisionDelta:x.state.fleet.revision-beforeRevision};
});

test('calendar-boundary owners stay in the transaction scope and each run once at the committed time',()=>{
  const from=86400-30,asset=makeAsset('B339-BOUNDARY',{from,phase:'idle',progress:0});
  const x=createSimulationAdapter({from,assets:[asset],financialDay:0,marketHour:23});
  const job=x.makeJob({to:86400,boundary:{day:1,hour:24}});assert.equal(job.runChunk(32),true);
  const result=job.finish();assert.equal(result.committed,true);assert.equal(result.completeTo,86400);
  assert.deepEqual(x.s.__financialDays,[1]);assert.deepEqual(x.s.__marketHours,[24]);
  const metric=x.s.GH_TRANSACTION_CORE.telemetry().last;
  assert.equal(metric.fullSnapshot,false,'the declared slice scope includes boundary effects and skips fleet cloning');
  assert.deepEqual(metric.writeAudit.undeclaredRoots,[]);
  assert(metric.writeAudit.declaredRoots.includes('lastFinancialDay'));
  assert(metric.writeAudit.declaredRoots.includes('lastMarketHour'));
  assert.equal(x.state.lastFinancialDay,1);assert.equal(x.state.lastMarketHour,24);
  return {completeTo:result.completeTo,financialDays:x.s.__financialDays,marketHours:x.s.__marketHours,writeAudit:metric.writeAudit};
});
