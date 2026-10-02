'use strict';
// The old per-asset chunk planner was retired when Fleet Event Core became the
// simulation owner. Keep the slice atomicity gate on the current adapter: no
// writes before commit, and every downstream failure restores the fleet journal
// plus the declared gameplay roots.
const assert=require('node:assert/strict');
const {createSimulationAdapter,makeAsset}=require('./helpers/fleet-simulation-adapter');
const results=[];
function exactFleet(x){
  const store=x.state.fleet,STORE=x.s.GH_FLEET_STORE,rows=STORE.toAssets(store),checkpoints=[];
  STORE.forEachLive(store,index=>checkpoints.push(STORE.slot(store,'at',index)));
  return JSON.stringify({rows,checkpoints});
}
function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}

test('a ready event slice does not write the fleet or publish time before finish',()=>{
  const x=createSimulationAdapter({assets:[makeAsset('ATOMIC-PENDING',{progress:.995})]}),before=exactFleet(x),from=x.state.simSeconds;
  const job=x.makeJob({to:from+30});assert.equal(job.runChunk(32),true);
  assert.equal(exactFleet(x),before,'planning remains detached from the live fleet');assert.equal(x.state.simSeconds,from);
  const result=job.finish();assert.equal(result.committed,true);assert.equal(result.completeTo,from+30);assert.equal(x.state.simSeconds,result.completeTo);
  assert.notEqual(exactFleet(x),before,'the committed event publishes its row preimage and writes');
  return {events:result.events,completeTo:result.completeTo};
});

test('a late finance-owner failure restores every root and fleet row, then retry commits',()=>{
  const x=createSimulationAdapter({assets:[makeAsset('ATOMIC-ROLLBACK',{progress:.995})]}),beforeFleet=exactFleet(x),beforeRoots=x.s.GH_TRANSACTION_CORE.deepClone(x.state),buffer=x.state.fleet.rows,revision=x.state.fleet.revision,from=x.state.simSeconds;
  const job=x.makeJob({to:from+30});assert.equal(job.runChunk(32),true);
  const finance=x.s.GH_FINANCE_CORE,original=finance.execute;finance.execute=(context,command,...args)=>{if(command==='apply-simulation-journal'){x.state.companyFinance.air.accounts[0].balance=123;throw new Error('atomic-slice-finance-fault');}return original(context,command,...args);};
  let failure;try{job.finish();}catch(error){failure=error;}finally{finance.execute=original;}
  assert.match(String(failure?.message||failure),/atomic-slice-finance-fault/);
  assert.deepEqual(x.s.GH_TRANSACTION_CORE.deepClone(x.state),beforeRoots,'non-fleet transaction roots roll back');
  assert.equal(exactFleet(x),beforeFleet,'the event engine row writes roll back exactly');assert.equal(x.state.fleet.rows,buffer,'rollback does not replace the fleet buffer');
  assert.equal(x.state.simSeconds,from);assert(x.state.fleet.revision>revision,'revision remains monotonic through rollback');
  const retry=x.makeJob({from,to:from+30});assert.equal(retry.runChunk(32),true);assert.equal(retry.finish().committed,true);assert.equal(x.state.simSeconds,from+30);
  return {revisionBefore:revision,revisionAfter:x.state.fleet.revision,retry:true};
});

test('a day-boundary failure rolls back the event, time and boundary markers together',()=>{
  const from=86400-30,x=createSimulationAdapter({from,assets:[makeAsset('ATOMIC-DAY',{from,phase:'idle'})],financialDay:0,marketHour:23});
  const beforeFleet=exactFleet(x),beforeRoots=x.s.GH_TRANSACTION_CORE.deepClone(x.state),beforeCash=x.state.cash,job=x.makeJob({from,to:86400,boundary:{day:1,hour:24}});assert.equal(job.runChunk(32),true);
  x.s.processFinancialDay=day=>{x.state.cash=123;x.state.lastFinancialDay=day;throw new Error('atomic-slice-day-fault');};
  assert.throws(()=>job.finish(),/atomic-slice-day-fault/);
  assert.equal(exactFleet(x),beforeFleet);assert.deepEqual(x.s.GH_TRANSACTION_CORE.deepClone(x.state),beforeRoots);
  assert.equal(x.state.simSeconds,from);assert.equal(x.state.lastFinancialDay,0);assert.equal(x.state.cash,beforeCash);
  return {simSeconds:x.state.simSeconds,lastFinancialDay:x.state.lastFinancialDay};
});

console.log(JSON.stringify({suite:'build334-simulation-slice-atomic',scope:'current Fleet Event adapter; unpublished planning, fleet journal rollback/retry and atomic day-boundary failure',passed:results.filter(row=>row.ok).length,total:results.length,results},null,2));
if(results.some(row=>!row.ok))process.exitCode=1;
