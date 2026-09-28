'use strict';

const assert=require('node:assert/strict');
const GH_KERNEL=require('../WebApp/kernel-core.js');
const {scenario}=require('./helpers/business-scenario');

const FINANCE_SCOPE=Object.freeze([
  'todayProfit','sectorProfitToday','tripProfitAccrued','tripRevenueAccrued',
  'tripFuelAccrued','tripMaintenanceAccrued','tripCountAccrued','finance'
]);
const JOURNAL=Object.freeze({
  todayProfit:23.5,
  sectorProfit:Object.freeze({air:17}),
  tripProfit:Object.freeze({air:17}),
  tripRevenue:Object.freeze({air:80}),
  tripFuel:Object.freeze({air:30}),
  tripMaintenance:Object.freeze({air:13}),
  tripCount:Object.freeze({air:2}),
  cash:Object.freeze({air:17})
});

function fixture(){
  const e=scenario(),tx=e.s.GH_TRANSACTION_CORE,finance=e.s.GH_FINANCE_CORE;
  e.s.GH_KERNEL=GH_KERNEL;
  return {e,tx,finance,base:structuredClone(e.state)};
}
function ownerState(tx,base){return tx.enableKernelOwner(structuredClone(base));}
function applyPrepared(tx,finance,state,plan,tail=()=>true){
  return tx.execute(state,{label:'build342:prepared-finance',scope:FINANCE_SCOPE,apply:()=>{
    const result=finance.execute({state},'apply-simulation-journal',{prepared:plan});
    tail(result);return result;
  }});
}

{
  const {tx,finance,base}=fixture(),legacy=structuredClone(base),owner=ownerState(tx,base),before=JSON.stringify(owner);
  const plan=finance.prepareSimulationJournal(owner,JOURNAL);
  assert.ok(plan,'canonical kernel-owner finance state must produce a prepared plan');
  assert.equal(JSON.stringify(owner),before,'preparing finance must not publish any state');
  assert.equal(tx.execute(legacy,{label:'build342:legacy-finance',scope:FINANCE_SCOPE,apply:()=>finance.execute({state:legacy},'apply-simulation-journal',{journal:JOURNAL})}).committed,true);
  assert.equal(applyPrepared(tx,finance,owner,plan).committed,true);
  assert.equal(GH_KERNEL.firstDifference(legacy,tx.kernelOwnerState(owner)),null,'prepared and legacy finance posting must be Save Schema identical');

  assert.equal(typeof finance.consumePreparedSimulationJournal,'function','prepared plans require an explicit post-commit consumer');
  finance.consumePreparedSimulationJournal(owner,plan);
  const consumed=finance.validatePreparedSimulationJournal(owner,plan);
  assert.equal(consumed.ok,false);assert.equal(consumed.reason,'finance-prepared-journal-consumed');
  const committed=JSON.stringify(owner);
  assert.throws(()=>applyPrepared(tx,finance,owner,plan),/finance-prepared-journal-consumed/,'a committed plan cannot post twice');
  assert.equal(JSON.stringify(owner),committed,'rejected plan reuse cannot change finance state');
}

{
  const {tx,finance,base}=fixture(),owner=ownerState(tx,base),plan=finance.prepareSimulationJournal(owner,JOURNAL),before=JSON.stringify(owner);
  assert.ok(plan);
  assert.throws(()=>tx.execute(owner,{label:'build342:prepared-finance-conflict',scope:FINANCE_SCOPE,apply:()=>{
    owner.finance.pendingDailyCash.air+=5;
    finance.execute({state:owner},'apply-simulation-journal',{prepared:plan});
  }}),/finance-prepared-journal-conflict/,'a finance write earlier in the same transaction must stale the prepared plan');
  assert.equal(JSON.stringify(owner),before,'finance conflict must roll back the preceding write byte-for-byte');
}

{
  const {tx,finance,base}=fixture(),owner=ownerState(tx,base),plan=finance.prepareSimulationJournal(owner,JOURNAL),before=JSON.stringify(owner);
  assert.ok(plan);
  assert.throws(()=>applyPrepared(tx,finance,owner,plan,()=>{throw new Error('injected-downstream-owner-failure');}),/injected-downstream-owner-failure/);
  assert.equal(JSON.stringify(owner),before,'a downstream failure must roll back every prepared finance posting byte-for-byte');
  assert.notEqual(finance.validatePreparedSimulationJournal(owner,plan).reason,'finance-prepared-journal-consumed','a rolled-back transaction must not consume its plan');
}

console.log('Build342 prepared finance journal parity, conflict, rollback and one-shot publication PASS');
