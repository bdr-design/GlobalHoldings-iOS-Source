'use strict';
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');

// The daily close now names the exact owner that failed instead of collapsing every domain into advanced-owner.
{
  const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','company-adapters-core','transaction-core','banking-core','advanced-core']);
  s.GH_CORPORATE_CORE={};s.GH_FLEET_CORE={};s.GH_ROUTE_CORE={};s.GH_MOBILITY_CORE={};
  const migrated=s.GH_COMPANY_PLATFORM.migrateState({simSeconds:86400,onboardingComplete:true,openedCompanies:['bank'],companyRegistry:{},companyFinance:{},advanced:{cyber:{coverage:90},safety:{score:90},procurement:{savings:0}}}),state=migrated.state,phases=[];
  s.GH_DOMAIN_COMMANDS={dispatchSystem(_ctx,domain){if(domain==='banking')throw Object.assign(new Error('bank-day-injected'),{code:'BANK_DAY'});return {result:{}};}};
  let caught=null;try{s.GH_ADVANCED.onFinancialDay(state,1,(name,work)=>{phases.push(name);return work();});}catch(error){caught=error;}
  assert(caught);assert.equal(caught.code,'FINANCIAL_DAY_OWNER_FAILED');assert.match(caught.owner,/bank:banking-services-v1/);assert.equal(caught.cause.code,'BANK_DAY');assert(phases.includes('simulation.finance-day.owner.bank'));
}

// A restore failure must never stop later owner undos, and its exported timing must retain both causes.
{
  const {s}=harness(['transaction-core']);const state={root:{value:1}},undoCalls=[];
  let caught=null;
  try{s.GH_TRANSACTION_CORE.execute(state,{label:'iphone-rollback-proof',scope:['root'],apply(){
    state.root.value=2;
    s.GH_TRANSACTION_CORE.registerUndo(()=>undoCalls.push('registered'));
    Object.defineProperty(state,'unremovable',{value:true,configurable:false,enumerable:true});
    throw Object.assign(new Error('original-owner-failure'),{code:'OWNER_FAILED'});
  }});}catch(error){caught=error;}
  assert(caught);assert.equal(caught.code,'TRANSACTION_ROLLBACK_FAILED');
  assert.match(String(caught.cause?.message),/original-owner-failure/);
  assert.deepEqual(undoCalls,['registered'],'registered undos still run after snapshot restore fails');
  const metric=s.GH_TRANSACTION_CORE.telemetry().last;
  assert.equal(metric.stage,'rollback-failed');assert.equal(metric.error.code,'OWNER_FAILED');
  assert(metric.rollbackFailures.some(row=>row.component==='snapshot-restore'));
}

// Frozen row containers are immutable rollback leaves, even when they were frozen outside the seal registry.
{
  const {s}=harness(['transaction-core']);const frozen=Object.freeze({id:'immutable',value:1}),state={rows:{items:[frozen],mutable:{id:'m',value:1}}},before=JSON.stringify({rows:state.rows});
  assert.throws(()=>s.GH_TRANSACTION_CORE.execute(state,{label:'frozen-row-proof',scope:['rows'],rowRoots:{rows:{level:'rows'}},apply(){state.rows.mutable.value=9;state.rows.items=[frozen];throw new Error('stop');}}),/stop/);
  assert.equal(JSON.stringify({rows:state.rows}),before);
}

// Health cannot report a failed calendar rollback as healthy.
{
  const {s}=harness(['diagnostics-core']);
  s.GH_FLEET_DATA={mode:()=> 'store',forEachFieldClasses(){},idCollisions:()=>({duplicate:0,missing:0}),size:()=>0};
  s.GH_TRANSACTION_CORE={execute(){}};s.GH_SIMULATION_CORE={create(){}};s.GH_SAVE_SCHEMA={normalize(){}};
  const state={simSeconds:100,speed:0,saveVersion:'3.0.0',cash:1,debt:0,groupValue:1,finance:{receivables:[],payables:[],invoices:[],cheques:[]},diagnostics:{},simulationKernel:{lastAdvanceFailure:{code:'TRANSACTION_ROLLBACK_FAILED',from:100,to:200,error:'rollback failed',errorDetail:{code:'TRANSACTION_ROLLBACK_FAILED'}}}};
  const report=s.GH_DIAGNOSTICS.runHealthCheck(state,{simulation:{}},{trackTransitions:false});
  assert.equal(report.status,'critical');assert(report.issues.some(row=>row.id==='TRANSACTION_ROLLBACK_FAILED'));
}

console.log('BUILD360_IPHONE_FAILURE_RECOVERY_PASS');
