'use strict';

const assert=require('node:assert/strict');
const {createSimulationAdapter,makeAsset,fixture}=require('./helpers/fleet-simulation-adapter');

const canonicalJSON=value=>{
  const jsonValue=JSON.parse(JSON.stringify(value));
  const sort=item=>Array.isArray(item)?item.map(sort):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,sort(item[key])])):item;
  return JSON.stringify(sort(jsonValue));
};
function exactFleet(x,store=x.state.fleet){
  const rows=x.s.GH_FLEET_STORE.toAssets(store),at=[];
  x.s.GH_FLEET_STORE.forEachLive(store,index=>at.push(x.s.GH_FLEET_STORE.slot(store,'at',index)));
  return canonicalJSON({rows,at});
}
function test(name,fn){try{console.log(JSON.stringify({test:name,ok:true,detail:fn()}));}catch(error){console.error(JSON.stringify({test:name,ok:false,error:String(error.stack||error)}));process.exitCode=1;}}

test('a time conflict rejects the slice before changing the fleet or publishing its event plan',()=>{
  const x=createSimulationAdapter({assets:[makeAsset('B340-CONFLICT',{progress:.995})]}),before=exactFleet(x),from=x.state.simSeconds;
  const job=x.makeJob({from,to:from+30});assert.equal(job.runChunk(32),true);
  const changed=x.s.GH_TRANSACTION_CORE.execute(x.state,{label:'test:advance-time-conflict',scope:['simSeconds'],apply:()=>{x.state.simSeconds=from+1;return true;}});
  assert.equal(changed.committed,true);
  const result=job.finish();assert.equal(result.committed,false);assert.equal(result.retry,true);assert.equal(result.reason,'time-conflict');
  assert.equal(x.state.simSeconds,from+1);assert.equal(exactFleet(x),before,'conflicted planning never touches journaled rows');
  return {reason:result.reason,simSeconds:x.state.simSeconds};
});

test('a downstream owner failure restores state and fleet rows exactly, then the event queue can retry',()=>{
  const x=createSimulationAdapter({assets:[makeAsset('B340-ROLLBACK',{progress:.995})]}),beforeFleet=exactFleet(x),beforeRoots=x.s.GH_TRANSACTION_CORE.deepClone(x.state),buffer=x.state.fleet.rows,revision=x.state.fleet.revision,from=x.state.simSeconds;
  const job=x.makeJob({to:from+30});assert.equal(job.runChunk(32),true);
  const finance=x.s.GH_FINANCE_CORE,original=finance.execute;
  finance.execute=(context,command,...args)=>{if(command==='apply-simulation-journal')throw new Error('injected-finance-owner-failure');return original(context,command,...args);};
  let failure;try{job.finish();}catch(error){failure=error;}finally{finance.execute=original;}
  assert.match(String(failure?.message||failure),/injected-finance-owner-failure/);
  assert.deepEqual(x.s.GH_TRANSACTION_CORE.deepClone(x.state),beforeRoots,'every cloned non-fleet root returns to its pre-slice value');
  assert.equal(exactFleet(x),beforeFleet,'the fleet journal restores all row fields and checkpoints');
  assert.equal(x.state.fleet.rows,buffer,'rollback does not replace or clone the fleet buffer');
  assert(x.state.fleet.revision>revision,'the fleet revision stays monotonic through rollback');
  const retry=x.makeJob({from,to:from+30});assert.equal(retry.runChunk(32),true);const result=retry.finish();
  assert.equal(result.committed,true);assert.equal(x.state.simSeconds,from+30);assert(x.state.fleet.revision>revision);
  return {retryCommitted:result.committed,revisionBefore:revision,revisionAfter:x.state.fleet.revision};
});

test('cancelled jobs write nothing',()=>{
  const x=createSimulationAdapter({assets:[makeAsset('B340-CANCEL',{progress:.995})]}),before=exactFleet(x),from=x.state.simSeconds;
  const job=x.makeJob({to:from+30});job.cancel();assert.equal(job.runChunk(32),true);
  const result=job.finish();assert.equal(result.committed,false);assert.equal(x.state.simSeconds,from);assert.equal(exactFleet(x),before);
  return {reason:result.reason,simSeconds:x.state.simSeconds};
});

test('the 1500-event frame limit publishes completeTo and the next slice matches one unbounded advance',()=>{
  const from=3590,to=3630,route={id:'B340-BUDGET',type:'air',routeMode:'air',ownerCompanyId:'air',from:'A',to:'B',fromFacility:'FA',toFacility:'FB',distanceKm:20,tripSeconds:1000,effectiveSpeedKmh:100,dwellHours:1.25};
  const specs={...fixture.specs.air,speedKmh:80};
  const early=Array.from({length:1500},(_,index)=>makeAsset(`B340-E-${index}`,{route,from,progress:.99,specs,baseFacility:'FA'}));
  const late=Array.from({length:2},(_,index)=>makeAsset(`B340-L-${index}`,{route,from,progress:.98,specs,baseFacility:'FA'}));
  const assets=[...early,...late],x=createSimulationAdapter({from,assets,routeOverrides:{[route.id]:route}}),reference=x.s.GH_FLEET_STORE.fromAssets(assets,{at:from});
  const first=x.makeJob({from,to,boundary:{day:null,hour:1}});assert.equal(first.runChunk(32),true);
  const firstResult=first.finish();assert.equal(firstResult.committed,true);assert.equal(firstResult.events,1500);
  assert(Math.abs(firstResult.completeTo-3600)<1e-6,`expected the budget to stop at the hour boundary, got ${firstResult.completeTo}`);
  assert.equal(x.state.simSeconds,firstResult.completeTo,'authoritative time advances only to completeTo');
  assert.deepEqual(x.s.__marketHours,[1],'the boundary at completeTo is applied once');
  const second=x.makeJob({from:firstResult.completeTo,to});assert.equal(second.runChunk(32),true);
  const secondResult=second.finish();assert.equal(secondResult.committed,true);assert.equal(secondResult.completeTo,to);assert.equal(x.state.simSeconds,to);
  assert.deepEqual(x.s.__marketHours,[1],'continuing after the boundary does not apply it twice');
  const refOut=x.s.GH_FLEET_EVENTS.advance(reference,{from,to,context:fixture.context(from),resolveRoute:x.s.__resolveFleetRoute,tripAlertLimit:64,order:'events'});
  assert.equal(firstResult.events+secondResult.events,refOut.events);
  assert.equal(exactFleet(x),exactFleet(x,reference),'budgeted app slices match a single unbounded event advance bit for bit');
  return {firstCompleteTo:firstResult.completeTo,firstEvents:firstResult.events,secondEvents:secondResult.events,totalEvents:refOut.events,marketHours:x.s.__marketHours};
});
