'use strict';
const assert=require('node:assert/strict');
require('../WebApp/kernel-core.js');
const tx=require('../WebApp/transaction-core.js');
globalThis.GH_SIMULATION_CORE={create(){}};
globalThis.GH_SAVE_SCHEMA={normalize(){}};
const diagnostics=require('../WebApp/diagnostics-core.js');

const state=tx.enableKernelOwner({
  saveVersion:'2.0.0',simSeconds:90,speed:1,cash:1,debt:0,groupValue:1,assets:[],
  finance:{companyBooks:{},receivables:[],payables:[],invoices:[],cheques:[]},
  diagnostics:{events:[],lastHealth:null,counters:{},activeIssues:{},resolvedIssues:[]}
});
const initial=tx.kernelOwnerStatus(state).transactions;
for(let index=0;index<8;index++)diagnostics.ensure(state);
diagnostics.recorderStart(state,{speed:30,simSeconds:90},{nowMs:100000,performanceNowMs:100});
for(let index=1;index<=8;index++)diagnostics.recorderSample(state,{speed:30,simSeconds:90,frames:index},{nowMs:100000+index*500});
assert.equal(tx.kernelOwnerStatus(state).transactions,initial,'a complete diagnostic tree and repeated recorder samples must not open kernel transactions');

const healthy=diagnostics.runHealthCheck(state,{simulation:{speed:30,backlog:0,conflicts:0,slices:3,manualFailures:0}},{trackTransitions:false});
assert.equal(healthy.status,'healthy');
const actualPerformance=globalThis.performance;
globalThis.performance={now:()=>20000};
let report;
try{
  report=diagnostics.runHealthCheck(state,{simulation:{speed:30,simSeconds:90,backlog:180,conflicts:138,cancels:140,slices:3,manualFailures:6,lastAdvanceFailure:{reason:'simulation-source-revision-conflict',stage:'commit',from:0,to:3600,retries:3},lastCancelReason:'simulation-source-revision-conflict',lastProgressAt:11000,jobActive:true,hidden:false}},{trackTransitions:false});
}finally{globalThis.performance=actualPerformance;}
assert.equal(report.status,'warning','repeated conflicts and failed calendar must not be reported healthy');
const byId=new Map(report.issues.map(row=>[row.id,row]));
for(const id of ['SIM_BACKLOG_HIGH','SIM_CONFLICT_HIGH','SIM_CALENDAR_ADVANCE_FAILED','SIM_PROGRESS_STALLED'])assert.equal(byId.get(id)?.severity,'warning',`${id} must reflect actual engine snapshot fields`);
assert.equal(byId.get('SIM_CONFLICT_HIGH').evidence.conflicts,138);
assert.equal(byId.get('SIM_CALENDAR_ADVANCE_FAILED').evidence.manualFailures,6);

const manual=diagnostics.runHealthCheck(state,{simulation:{speed:30,backlog:86400,conflicts:0,slices:3,manualFailures:0,manualAdvance:{target:86400},lastProgressAt:actualPerformance.now()}},{trackTransitions:false});
assert(!manual.issues.some(row=>row.id==='SIM_BACKLOG_HIGH'),'a calendar target is not a live backlog warning');
state.speed=0;
globalThis.performance={now:()=>20000};
let pausedManual;
try{pausedManual=diagnostics.runHealthCheck(state,{simulation:{speed:30,backlog:86400,conflicts:0,slices:3,manualFailures:0,manualAdvance:{target:86400,speed:30},lastProgressAt:11000,hidden:false}},{trackTransitions:false});}
finally{globalThis.performance=actualPerformance;}
assert(pausedManual.issues.some(row=>row.id==='SIM_PROGRESS_STALLED'),'a stalled manual advance remains visible even when ordinary game speed is paused');
assert(!pausedManual.issues.some(row=>row.id==='SIM_BACKLOG_HIGH'),'the calendar target must not be labeled live backlog');
console.log('Build342 simulation health: real snapshot warnings, calendar target, and idle diagnostic no-write PASS');
