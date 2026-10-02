'use strict';
const assert=require('node:assert/strict');
const {createSimulationAdapter,makeAsset}=require('./helpers/fleet-simulation-adapter');

const canonicalJSON=value=>{
  const jsonValue=JSON.parse(JSON.stringify(value));
  const sort=item=>Array.isArray(item)?item.map(sort):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,sort(item[key])])):item;
  return JSON.stringify(sort(jsonValue));
};
function exactFleet(x){
  const STORE=x.s.GH_FLEET_STORE,at=[];
  STORE.forEachLive(x.state.fleet,index=>at.push(STORE.slot(x.state.fleet,'at',index)));
  return canonicalJSON({rows:STORE.toAssets(x.state.fleet),at});
}
const results=[];
function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}

test('queued slice planning does not materialize assets or publish fleet/time writes',()=>{
  const assets=Array.from({length:100},(_,index)=>makeAsset(`R2-QUEUED-${index}`,{progress:0.1}));
  const x=createSimulationAdapter({assets}),buffer=x.state.fleet.rows,revision=x.state.fleet.revision,before=exactFleet(x),from=x.state.simSeconds;
  const job=x.makeJob({to:from+30});assert.equal(job.runChunk(1),true);
  assert.equal(x.state.fleet.rows,buffer);assert.equal(x.state.fleet.revision,revision);assert.equal(x.state.simSeconds,from);assert.equal(exactFleet(x),before);
  job.cancel();assert.equal(job.finish().reason,'job-not-finished');
  return {queuedAssets:assets.length,revision,simSeconds:x.state.simSeconds};
});

test('resolved routes are frozen and identity-stable until the route revision changes',()=>{
  const x=createSimulationAdapter(),first=x.s.__resolveFleetRoute('A1','F-AIR-A');
  assert.ok(first);assert.equal(Object.isFrozen(first),true);assert.equal(x.s.__resolveFleetRoute('A1','F-AIR-A'),first);
  x.templates.A1={...x.templates.A1,tripSeconds:x.templates.A1.tripSeconds+300};
  x.state.routesRevision=(Number(x.state.routesRevision)||0)+1;
  const refreshed=x.s.__resolveFleetRoute('A1','F-AIR-A');assert.notEqual(refreshed,first);assert.equal(Object.isFrozen(refreshed),true);assert.equal(refreshed.tripSeconds,first.tripSeconds+300);
  return {oldTripSeconds:first.tripSeconds,newTripSeconds:refreshed.tripSeconds};
});

test('a time conflict leaves the event plan unpublished and the fleet byte-equivalent',()=>{
  const x=createSimulationAdapter({assets:[makeAsset('R2-TIME-CONFLICT',{progress:.995})]}),before=exactFleet(x),from=x.state.simSeconds;
  const job=x.makeJob({from,to:from+30});assert.equal(job.runChunk(32),true);
  assert.equal(x.s.GH_TRANSACTION_CORE.execute(x.state,{label:'test:time-conflict',scope:['simSeconds'],apply:()=>{x.state.simSeconds=from+1;return true;}}).committed,true);
  const result=job.finish();assert.equal(result.reason,'time-conflict');assert.equal(result.retry,true);assert.equal(exactFleet(x),before);assert.equal(x.state.simSeconds,from+1);
  return {reason:result.reason,simSeconds:x.state.simSeconds};
});

test('cancelled event jobs write nothing',()=>{
  const x=createSimulationAdapter({assets:[makeAsset('R2-CANCEL',{progress:.995})]}),before=exactFleet(x),revision=x.state.fleet.revision,from=x.state.simSeconds;
  const job=x.makeJob({to:from+30});job.cancel();assert.equal(job.runChunk(32),true);
  assert.equal(job.finish().reason,'job-not-finished');assert.equal(exactFleet(x),before);assert.equal(x.state.fleet.revision,revision);assert.equal(x.state.simSeconds,from);
  return {revision,simSeconds:x.state.simSeconds};
});

test('a downstream owner failure restores rows exactly and permits a clean retry',()=>{
  const x=createSimulationAdapter({assets:[makeAsset('R2-ROLLBACK',{progress:.995})]}),beforeFleet=exactFleet(x),beforeRoots=x.s.GH_TRANSACTION_CORE.deepClone(x.state),buffer=x.state.fleet.rows,revision=x.state.fleet.revision,from=x.state.simSeconds;
  const job=x.makeJob({to:from+30});assert.equal(job.runChunk(32),true);
  const finance=x.s.GH_FINANCE_CORE,original=finance.execute;finance.execute=(context,command,...args)=>{if(command==='apply-simulation-journal')throw new Error('injected-r2-finance-failure');return original(context,command,...args);};
  let failure;try{job.finish();}catch(error){failure=error;}finally{finance.execute=original;}
  assert.match(String(failure?.message||failure),/injected-r2-finance-failure/);assert.deepEqual(x.s.GH_TRANSACTION_CORE.deepClone(x.state),beforeRoots);assert.equal(exactFleet(x),beforeFleet);assert.equal(x.state.fleet.rows,buffer);assert(x.state.fleet.revision>revision);
  const retry=x.makeJob({from,to:from+30});assert.equal(retry.runChunk(32),true);assert.equal(retry.finish().committed,true);assert.equal(x.state.simSeconds,from+30);
  return {revisionBefore:revision,revisionAfter:x.state.fleet.revision,bufferIdentityPreserved:true};
});

console.log(JSON.stringify({suite:'build334-r2-snapshot-budget',scope:'current Fleet Event adapter: queued work, cached routes, conflicts, cancellation and journal rollback',passed:results.filter(row=>row.ok).length,total:results.length,results},null,2));
if(results.some(row=>!row.ok))process.exitCode=1;
