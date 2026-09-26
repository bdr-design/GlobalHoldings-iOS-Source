'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

const FIELDS=['fuel','progress'];
function criticalIds(s,state){const report=s.GH_INTEGRITY_CORE.check(state);return (report.issues||[]).filter(x=>x.severity==='critical').map(x=>String(x.id||x.code||x.title)).sort();}
function makeState(){const state=minimal();state.simulationKernel={lastAtomicCommit:{from:0,to:0}};state.assets=Array.from({length:600},(_,i)=>({id:`A-${i}`,phase:'moving',fuel:100,progress:0,condition:100,specs:{capacity:180}}));return state;}
function mutate(state){state.simSeconds+=30;for(let i=0;i<state.assets.length;i++){state.assets[i].fuel-=1;state.assets[i].progress=(i+1)/10000;}state.simulationKernel.lastAtomicCommit={from:state.simSeconds-30,to:state.simSeconds};}
function run(mode,fail=false){
 const {s}=harness(['transaction-core','integrity-core']);const tx=s.GH_TRANSACTION_CORE,state=makeState(),before=JSON.stringify(state),beforeCritical=criticalIds(s,state);let wholeAssetCopies=0;const native=s.structuredClone;
 s.structuredClone=value=>{if(value===state.assets||value?.assets===state.assets)wholeAssetCopies++;return native(value);};
 const options={label:`equivalence-${mode}-${fail?'fail':'ok'}`,apply(){mutate(state);if(fail)throw new Error('forced-equivalence-failure');}};
 if(mode==='journal')Object.assign(options,{scope:['assets','simSeconds','simulationKernel'],rollbackMode:'journal',writerContracts:[{owner:'equivalence-assets',proven:true,root:'assets',mode:'asset-fields',fields:FIELDS},{owner:'equivalence-roots',proven:true,roots:['simSeconds','simulationKernel']}]});
 if(fail)assert.throws(()=>tx.execute(state,options),/forced-equivalence-failure/);else assert.equal(tx.execute(state,options).committed,true);
 return {s,tx,state,before,beforeCritical,wholeAssetCopies,json:JSON.stringify(state),critical:criticalIds(s,state),timing:tx.telemetry().last};
}

const fullOk=run('full',false),journalOk=run('journal',false);
assert.equal(journalOk.json,fullOk.json,'journal success outcome differs from full snapshot outcome');
assert.equal(JSON.stringify(journalOk.critical),JSON.stringify(fullOk.critical),'integrity result differs after successful journal commit');
assert.equal(journalOk.timing.rollbackStorage,'journal');assert.equal(journalOk.timing.fullSnapshotFallback,false);
assert.equal(journalOk.wholeAssetCopies,0,'journal path copied the whole 600-asset array');

const fullFail=run('full',true),journalFail=run('journal',true);
assert.equal(fullFail.json,fullFail.before,'full control did not restore baseline');
assert.equal(journalFail.json,journalFail.before,'journal did not restore baseline');
assert.equal(journalFail.json,fullFail.json,'journal rollback differs from full rollback');
assert.equal(JSON.stringify(journalFail.critical),JSON.stringify(journalFail.beforeCritical),'journal rollback changed integrity critical set');
assert.equal(journalFail.timing.rollbackStorage,'journal');assert.equal(journalFail.timing.fullSnapshotFallback,false);
assert.equal(journalFail.wholeAssetCopies,0,'journal rollback path copied the whole 600-asset array');

console.log(JSON.stringify({suite:'build339-phase1c-equivalence-gate',passed:true,assets:600,success:{journalRecords:journalOk.timing.journalRecords,wholeAssetCopies:journalOk.wholeAssetCopies},rollback:{journalRecords:journalFail.timing.journalRecords,wholeAssetCopies:journalFail.wholeAssetCopies},criticalIds:journalFail.critical},null,2));
