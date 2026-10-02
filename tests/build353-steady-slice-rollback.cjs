'use strict';
// Keep Build 353's steady-slice rollback and alert contracts on the current
// journaled Fleet Event adapter. The old processAssetDraft/preimage-guard
// implementation is retired; the observable rollback and alert behavior stays.
const assert=require('node:assert/strict');
const {createSimulationAdapter,makeAsset}=require('./helpers/fleet-simulation-adapter');
const results=[];

function exactFleet(x){
  const STORE=x.s.GH_FLEET_STORE,store=x.state.fleet,checkpoints=[];
  STORE.forEachLive(store,row=>checkpoints.push(STORE.slot(store,'at',row)));
  return JSON.stringify({rows:STORE.toAssets(store),checkpoints});
}
function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}
function transactionScope(s,name){return vmRun(s,`${name}.map(String)`);}
function vmRun(s,source){return require('node:vm').runInContext(source,s);}

test('steady slice commits with a bounded scoped snapshot and no legacy asset root',()=>{
  const x=createSimulationAdapter({assets:[makeAsset('B353-STEADY',{progress:.995})]}),before=exactFleet(x);
  assert.equal(Object.hasOwn(x.state,'assets'),false,'the legacy fleet array is retired');
  const job=x.makeJob({to:x.state.simSeconds+30});assert.equal(job.runChunk(32),true);
  assert.equal(exactFleet(x),before,'planning does not publish event writes');
  assert.equal(job.finish().committed,true);
  const metric=x.s.GH_TRANSACTION_CORE.telemetry().last,steady=transactionScope(x.s,'SIMULATION_STEADY_TRANSACTION_SCOPE');
  assert.equal(metric.fullSnapshot,false);assert.equal(metric.fullSnapshotFallback,false);
  assert.equal(metric.rollbackStorage,'legacy-scoped');
  assert(steady.includes('fleet'),'the fleet root is declared to the adapter');
  assert(!steady.includes('assets'),'the retired assets root is absent');
  assert.deepEqual(metric.writeAudit.undeclaredRoots,[]);
  assert.notEqual(exactFleet(x),before);
  return {scopeSize:metric.scopeSize,fullSnapshot:metric.fullSnapshot};
});

test('late failure restores the fleet journal and gameplay roots, then retry commits',()=>{
  const x=createSimulationAdapter({assets:[makeAsset('B353-ROLLBACK',{progress:.995})]}),
    beforeFleet=exactFleet(x),beforeRoots=x.s.GH_TRANSACTION_CORE.deepClone(x.state),buffer=x.state.fleet.rows,
    revision=x.state.fleet.revision,from=x.state.simSeconds,job=x.makeJob({to:from+30});
  assert.equal(job.runChunk(32),true);
  const finance=x.s.GH_FINANCE_CORE,original=finance.execute;
  finance.execute=(context,command,...args)=>{
    if(command==='apply-simulation-journal'){
      x.state.companyFinance.air.accounts[0].balance=123;
      throw new Error('b353-late-slice-fault');
    }
    return original(context,command,...args);
  };
  let failure;try{job.finish();}catch(error){failure=error;}finally{finance.execute=original;}
  assert.match(String(failure?.message||failure),/b353-late-slice-fault/);
  assert.deepEqual(x.s.GH_TRANSACTION_CORE.deepClone(x.state),beforeRoots);
  assert.equal(exactFleet(x),beforeFleet,'fleet row values and checkpoint fields restore exactly');
  assert.equal(x.state.fleet.rows,buffer,'rollback does not clone or replace the fleet buffer');
  assert.equal(x.state.simSeconds,from);assert(x.state.fleet.revision>revision,'revision remains monotonic');
  const retry=x.makeJob({from,to:from+30});assert.equal(retry.runChunk(32),true);
  assert.equal(retry.finish().committed,true);assert.equal(x.state.simSeconds,from+30);
  return {revisionBefore:revision,revisionAfter:x.state.fleet.revision,retry:true};
});

test('boundary and delivery slices use declared roots while the fleet journal owns rollback',()=>{
  const boundary=createSimulationAdapter({from:86400-30,assets:[makeAsset('B353-BOUNDARY',{from:86400-30,phase:'idle'})],financialDay:0,marketHour:23});
  let job=boundary.makeJob({from:86400-30,to:86400,boundary:{day:1,hour:24}});assert.equal(job.runChunk(32),true);
  assert.equal(job.finish().committed,true);
  let metric=boundary.s.GH_TRANSACTION_CORE.telemetry().last;
  assert.equal(metric.fullSnapshot,false);assert.equal(metric.fullSnapshotFallback,false);
  assert.equal(metric.scopeSize,transactionScope(boundary.s,'SIMULATION_TRANSACTION_SCOPE').length);
  assert.deepEqual(metric.writeAudit.undeclaredRoots,[]);

  const delivery=createSimulationAdapter({assets:[makeAsset('B353-DELIVERY')],deliveryWork:true});
  delivery.s.GH_REALISM.hasPendingDeliveries=()=>true;
  delivery.s.GH_REALISM.onSimulationTime=()=>{};
  job=delivery.makeJob();assert.equal(job.runChunk(32),true);assert.equal(job.finish().committed,true);
  metric=delivery.s.GH_TRANSACTION_CORE.telemetry().last;
  assert.equal(metric.fullSnapshot,false);assert.equal(metric.fullSnapshotFallback,false);
  assert.equal(metric.scopeSize,transactionScope(delivery.s,'SIMULATION_TRANSACTION_SCOPE').length);
  assert.deepEqual(metric.writeAudit.undeclaredRoots,[]);
  return {boundaryScope:metric.scopeSize,deliveryFullSnapshot:metric.fullSnapshot};
});

test('bulk trip alerts are summarized and non-trip alerts remain visible',()=>{
  const assets=Array.from({length:4},(_,i)=>makeAsset(`B353-ALERT-${i}`,{
    progress:.995,...(i===0?{releaseExclusiveRouteOnArrival:true}:{})
  }));
  const x=createSimulationAdapter({assets}),before=x.state.alerts.length,job=x.makeJob({to:x.state.simSeconds+30});
  assert.equal(job.runChunk(32),true);assert.equal(job.finish().committed,true);
  const added=x.state.alerts.slice(0,x.state.alerts.length-before);
  assert.equal(added.filter(text=>/ أكمل (?:رحلة\.|\d+ رحلات )/.test(text)).length,0,'bulk per-trip alerts are suppressed');
  assert.equal(added.filter(text=>/اكتملت 4 رحلة/.test(text)).length,1,'trip totals produce one company summary');
  assert(added.some(text=>/اكتمل المسار القديم المشترك/.test(text)),'non-trip alerts remain visible');
  return {alerts:added.length,summary:added.find(text=>/اكتملت 4 رحلة/.test(text))};
});

console.log(JSON.stringify({suite:'build353-steady-slice-rollback',scope:'current event adapter; bounded transaction roots, journal rollback/retry, boundary and delivery scope, alert aggregation',passed:results.filter(row=>row.ok).length,total:results.length,results},null,2));
if(results.some(row=>!row.ok))process.exitCode=1;
