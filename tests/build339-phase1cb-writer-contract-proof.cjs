'use strict';
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario');

const results=[];
function test(name,fn){try{results.push({name,ok:true,detail:fn()??null});}catch(error){results.push({name,ok:false,error:String(error?.stack||error)});}}
function sorted(values){return [...values].sort();}
function measure(owner,invoke){
  const e=scenario(),{s,state}=e;
  const out=s.GH_TRANSACTION_CORE.execute(state,{label:`phase1cb-writer:${owner}`,auditWrites:true,apply:()=>invoke(e)});
  assert.equal(out.committed,true);
  const audit=s.GH_TRANSACTION_CORE.telemetry().last.writeAudit;
  assert.ok(audit?.enabled);return {e,audit};
}

const EXPECTED_FINANCE=sorted(['finance','sectorProfitToday','todayProfit','tripCountAccrued','tripFuelAccrued','tripMaintenanceAccrued','tripProfitAccrued','tripRevenueAccrued']);

test('finance apply-simulation-journal exact root contract',()=>{
  const {audit}=measure('finance',({s,state})=>s.GH_FINANCE_CORE.execute({state},'apply-simulation-journal',{journal:{todayProfit:7,sectorProfit:{air:3},tripProfit:{air:2},tripRevenue:{air:9},tripFuel:{air:1},tripMaintenance:{air:1},tripCount:{air:1},cash:{air:4}}}));
  assert.deepEqual(audit.mutatedRoots,EXPECTED_FINANCE);return audit;
});

test('corporate adjust-group-value exact root contract',()=>{
  const {audit}=measure('corporate',({s,state})=>s.GH_CORPORATE_CORE.execute({state},'adjust-group-value',{delta:5}));
  assert.deepEqual(audit.mutatedRoots,['groupValue']);return audit;
});

test('operations record-alert exact root contract',()=>{
  const {audit}=measure('operations',({s,state})=>s.GH_OPERATIONS_CORE.execute({state},'record-alert',{text:'phase1cb probe',type:'simulation'}));
  assert.deepEqual(audit.mutatedRoots,['alerts','eventLog','operations']);return audit;
});

test('mobility inactive steady owner is confined to mobility root',()=>{
  const {audit}=measure('mobility',({s,state})=>s.GH_MOBILITY_CORE.onSimulationTime({state},30));
  assert.deepEqual(audit.mutatedRoots,['mobility']);return audit;
});

test('integrity-final owner is read-only on realistic frozen state',()=>{
  const e=scenario(),{s,state}=e,before=JSON.stringify(state);
  const freeze=(value,seen=new WeakSet())=>{if(!value||typeof value!=='object'||seen.has(value))return value;seen.add(value);for(const nested of Object.values(value))freeze(nested,seen);return Object.freeze(value);};
  freeze(state);const report=s.GH_INTEGRITY_CORE.check(state);assert.ok(report);assert.equal(JSON.stringify(state),before);return {status:report.status||null,issues:(report.issues||[]).length};
});

test('steady owner entrypoints are synchronous and contain no scheduler primitives',()=>{
  const e=scenario(),{s}=e;
  const entries={finance:s.GH_FINANCE_CORE.execute,corporate:s.GH_CORPORATE_CORE.execute,operations:s.GH_OPERATIONS_CORE.execute,mobility:s.GH_MOBILITY_CORE.onSimulationTime,integrity:s.GH_INTEGRITY_CORE.check};
  for(const [name,fn] of Object.entries(entries)){
    assert.equal(fn.constructor.name,'Function',`${name} must stay synchronous`);
    const src=Function.prototype.toString.call(fn);
    assert.ok(!/\basync\b|\bawait\b|setTimeout\s*\(|queueMicrotask\s*\(|Promise\s*\./.test(src),`${name} entrypoint contains async/scheduler primitive`);
  }
  return Object.keys(entries);
});

const passed=results.filter(row=>row.ok).length;
console.log(JSON.stringify({suite:'build339-phase1cb-writer-contract-proof',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;
