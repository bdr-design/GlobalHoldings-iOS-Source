'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;
const TX=require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js'));
const FLEET=require(path.join(ROOT,'WebApp/fleet-access-core.js'));
TX.registerJournaledRoot('fleet',{begin:(target)=>FLEET.beginJournal(target),commit:(target,_root,journal)=>FLEET.commitJournal(target,journal),rollback:(target,_root,journal)=>FLEET.rollbackJournal(target,journal),revision:(_target,root)=>Number(root?.revision)||0});
const state={cash:90,other:{value:1},simSeconds:100,fleet:STORE.fromAssets([{id:'A-1',type:'air',ownerCompanyId:'air',condition:83},{id:'A-2',type:'air',ownerCompanyId:'air',condition:91}],{at:100})};
const rows=state.fleet.rows,before=JSON.stringify(STORE.toAssets(state.fleet)),revision=state.fleet.revision,structure=state.fleet.structure;
const snapshot=TX.deepClone(state);
assert.equal(Object.hasOwn(snapshot,'fleet'),false,'ordinary snapshots omit self-journaled roots');
assert.equal(TX.deepClone(state,{shareJournaledRoots:true}).fleet,state.fleet,'durable drafts share the journal owner root');
assert.throws(()=>TX.execute(state,{label:'journaled-fleet-rollback',apply:()=>{
  state.cash=12;state.other.value=2;FLEET.update(state,'A-1',{condition:12,note:'transient'});FLEET.remove(state,'A-2');throw new Error('injected-failure');
}}),/injected-failure/);
assert.equal(state.cash,90);assert.equal(state.other.value,1);
assert.equal(state.fleet.rows,rows,'rollback keeps the original fleet buffer; no 128-byte-per-row snapshot was restored');
assert.equal(JSON.stringify(STORE.toAssets(state.fleet)),before,'fleet rows and extras restore exactly');
assert.ok(state.fleet.revision>revision,'revision is monotonic through rollback');
assert.ok(state.fleet.structure>structure,'structure is monotonic through rollback');

async function verifyDurableJournalGuard(){
  const live={saveRevision:9,simSeconds:100,fleet:STORE.fromAssets([{id:'D-1',type:'air',ownerCompanyId:'air',condition:83}],{at:100})};
  const rows=live.fleet.rows,before=JSON.stringify(STORE.toAssets(live.fleet));let persisted=false,caught=null;
  await assert.rejects(TX.executeDurable(live,{
    label:'durable-fleet-rollback-guard',expectedRevision:9,integrity:false,
    persist:async()=>{persisted=true;return {ok:true};},
    apply:async draft=>{
      assert.throws(()=>TX.execute(live,{label:'illegal-live-state-write',apply:()=>true}),/durable-live-state-transaction-blocked/);
      try{TX.execute(draft,{label:'failed-durable-fleet-suboperation',scope:['fleet'],apply:()=>{
        FLEET.update(draft,'D-1',{condition:1,note:'must-not-publish'});throw new Error('injected-durable-suboperation-failure');
      }});}catch(error){caught=error;}
      return true;
    }
  }),/durable-journaled-root-write-failed:fleet/);
  assert.match(String(caught?.message||caught),/durable-journaled-root-write-failed:fleet/,'the failed subtransaction is marked as unsafe to catch and continue');
  assert.equal(persisted,false,'a poisoned durable draft never reaches persistence');
  assert.equal(live.fleet.rows,rows,'the outer journal keeps the original buffer');
  assert.equal(JSON.stringify(STORE.toAssets(live.fleet)),before,'outer rollback restores the fleet exactly');
  return {poisonReason:caught.message,persisted,bufferIdentityPreserved:true};
}

verifyDurableJournalGuard().then(detail=>console.log(JSON.stringify({suite:'build357-fleet-journal',passed:2,total:2,bufferIdentityPreserved:true,revisionMonotonic:true,durableGuard:detail}))).catch(error=>{console.error(error);process.exitCode=1;});
