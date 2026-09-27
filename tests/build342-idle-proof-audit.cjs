'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['save-schema']);
const state=minimal(),queue=[];state.resetEpoch=0;state.saveRevision=10;
state.documentProofs={recordsById:Object.fromEntries(Array.from({length:433},(_,index)=>[`PROOF-${index}`,{id:`PROOF-${index}`}])),archiveById:{}};
let seen=0,clock=0;
const schedule=run=>{queue.push(run);return run;};
const cancel=run=>{const index=queue.indexOf(run);if(index>=0)queue.splice(index,1);};
const audit=s.GH_SAVE_SCHEMA.createIdleProofAudit(state,{schedule,cancel,clock:()=>clock+=0.01,once:true,verify:id=>{assert.ok(state.documentProofs.recordsById[id]);seen++;return {ok:true};}});
audit.start();let callbacks=0;
while(queue.length){queue.shift()({timeRemaining:()=>20});assert(++callbacks<40,'idle audit did not complete bounded progress');}
assert.equal(callbacks,22,'433 proofs require at least 22 separate callbacks at 20 per tick');
assert.equal(seen,433);assert.equal(audit.status().maxBatch,20);assert.equal(audit.status().lastCompleted.records,433);
assert.equal(audit.status().lastCompleted.stableRevision,true);assert.equal(audit.status().active,false);

const failures=[];
const failed=s.GH_SAVE_SCHEMA.createIdleProofAudit(state,{schedule,cancel,clock:()=>clock+=0.01,once:true,verify:id=>id==='PROOF-21'?{ok:false,reason:'tampered'}:{ok:true},onIssue:issue=>failures.push(issue)});
failed.start();while(queue.length)queue.shift()({timeRemaining:()=>20});
assert.deepEqual(failures.map(issue=>issue.id),['PROOF-21']);
assert.equal(failed.status().active,false,'corrupt proof must stop the audit');
assert.equal(failed.status().cycles,0,'no corrupt cycle can be reported complete');

const reset=s.GH_SAVE_SCHEMA.createIdleProofAudit(state,{schedule,cancel,clock:()=>clock+=0.01,once:true,verify:id=>({ok:id.startsWith('PROOF-')||id==='AFTER-RESET'})});
reset.start();queue.shift()({timeRemaining:()=>20});
state.resetEpoch=1;state.documentProofs={recordsById:{'AFTER-RESET':{id:'AFTER-RESET'}},archiveById:{}};
while(queue.length)queue.shift()({timeRemaining:()=>20});
assert.equal(reset.status().lastCompleted.records,1,'reset must restart rather than verify stale proof IDs');
console.log('Build342 idle document audit: 433 records in 22 ticks, 20 per tick, fails closed and restarts on reset PASS');
