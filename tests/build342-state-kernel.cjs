'use strict';
const assert=require('node:assert/strict');
const GH_KERNEL=require('../WebApp/kernel-core.js');
const {scenario}=require('./helpers/business-scenario');

function legacy(){return {saveVersion:'2.0.0',simSeconds:0,alerts:['middle','oldest'],eventLog:[{id:'middle'},{id:'oldest'}],assets:[{id:'A-1',progress:.25,lat:24.7,lng:46.6,phase:'moving',name:'aircraft'}],finance:{ledger:[]}};}

{
  const state=legacy(),kernel=GH_KERNEL.fromLegacyState(state,[
    {name:'alerts',path:'alerts',owner:'operations',kind:'append-only',cap:2,legacyOrder:'newest-first'},
    {name:'eventLog',path:'eventLog',owner:'operations',kind:'append-only',cap:2,legacyOrder:'newest-first'}
  ]);
  const before=JSON.stringify(state);
  assert.throws(()=>kernel.tx({label:'test:rollback',owner:'operations',writes:['alerts','eventLog']},w=>{w.append('alerts','middle');w.append('eventLog',{id:'middle'});throw new Error('injected-after-trim');}),/injected-after-trim/);
  assert.equal(JSON.stringify(kernel.legacyState()),before,'append cap trim rollback restores exact legacy order');
  const result=kernel.tx({label:'test:append',owner:'operations',writes:['alerts','eventLog']},w=>{w.append('alerts','newest');w.append('eventLog',{id:'newest'});});
  assert.deepEqual(result.dirty,['alerts','eventLog']);
  assert.deepEqual(kernel.legacyState().alerts,['newest','middle']);
  assert.deepEqual(kernel.legacyState().eventLog.map(row=>row.id),['newest','middle']);
  assert.equal(kernel.compareLegacy(kernel.legacyState()).ok,true);
  assert.throws(()=>kernel.tx({owner:'finance',writes:['alerts']},w=>w.append('alerts','unauthorized')),/kernel-writer-owner-violation/);
  assert.throws(()=>kernel.tx({owner:'operations',writes:['alerts']},w=>w.append('eventLog',{id:'undeclared'})),/kernel-write-set-violation/);
  const revision=kernel.revision('alerts');
  assert.throws(()=>kernel.tx({owner:'operations',writes:['alerts'],reads:{eventLog:8}},w=>w.append('alerts','stale')),/kernel-section-revision-conflict/);
  assert.equal(kernel.revision('alerts'),revision,'a rejected read conflict leaves section revisions unchanged');
}

{
  const state=legacy(),kernel=GH_KERNEL.fromLegacyState(state,[
    {name:'assets',path:'assets',owner:'simulation-asset',kind:'columns',columns:{progress:'f64',lat:'f64',lng:'f64',phase:'u8'},enumValues:{phase:['idle','moving','turnaround']}}
  ]);
  assert.equal(kernel.typedArrayBytes(),29,'four columns and presence bitmaps use typed-array storage');
  const before=JSON.stringify(state);
  assert.throws(()=>kernel.tx({owner:'simulation-asset',writes:['assets']},w=>{w.col('assets','progress').set(0,.75);w.col('assets','phase').set(0,'turnaround');throw new Error('abort-hot-fields');}),/abort-hot-fields/);
  assert.equal(JSON.stringify(kernel.legacyState()),before,'column write journal restores hot fields');
  kernel.tx({owner:'simulation-asset',writes:['assets']},w=>{w.col('assets','progress').set(0,.75);w.col('assets','phase').set(0,'turnaround');});
  assert.equal(kernel.legacyState().assets[0].progress,.75);
  assert.equal(kernel.legacyState().assets[0].phase,'turnaround');
  assert.equal(kernel.compareLegacy({...kernel.legacyState(),assets:[{...kernel.legacyState().assets[0],fuel:12}]}).path,'$.assets[0].fuel');
}

{
  const state=legacy(),kernel=GH_KERNEL.fromLegacyState(state,[{name:'finance.ledger',path:'finance.ledger',owner:'finance',kind:'ledger'}]);
  const entry={id:'LEDGER-1',debit:125,credit:125,idempotencyKey:'trip:T-1:revenue'};
  kernel.tx({owner:'finance',writes:['finance.ledger']},w=>w.post('finance.ledger',entry));
  const revision=kernel.revision('finance.ledger');
  kernel.tx({owner:'finance',writes:['finance.ledger']},w=>assert.deepEqual(w.post('finance.ledger',entry),entry));
  assert.equal(kernel.revision('finance.ledger'),revision,'identical idempotent post does not append or advance revision');
  assert.throws(()=>kernel.tx({owner:'finance',writes:['finance.ledger']},w=>w.post('finance.ledger',{...entry,debit:126})),/kernel-ledger-entry-unbalanced/);
  assert.throws(()=>kernel.tx({owner:'finance',writes:['finance.ledger']},w=>w.post('finance.ledger',{...entry,debit:126,credit:126,id:'LEDGER-2'})),/kernel-idempotency-conflict/);
  assert.equal(kernel.read('finance.ledger').length,1);
}

{
  const {s,state}=scenario(),tx=s.GH_TRANSACTION_CORE;
  const first=tx.execute(state,{label:'kernel-section-revision:first',writeRoots:['simSeconds'],apply:()=>{state.simSeconds+=1;}});
  assert.equal(first.committed,true);
  const revision=tx.sectionRevision(state,'simSeconds');
  assert.equal(revision,1);
  assert.throws(()=>tx.execute(state,{label:'kernel-section-revision:stale',readRevisions:{simSeconds:0},writeRoots:['simSeconds'],apply:()=>{state.simSeconds+=1;}}),/transaction-section-revision-conflict/);
  assert.equal(state.simSeconds,1,'stale section reader is rejected before mutation');
  tx.execute(state,{label:'kernel-section-revision:current',readRevisions:{simSeconds:revision},writeRoots:['simSeconds'],apply:()=>{state.simSeconds+=1;}});
  assert.equal(tx.sectionRevision(state,'simSeconds'),2);
}

{
  const initial={config:{value:0},events:[{id:'E-0'}],assets:[{id:'A-0',value:0}]};
  const kernel=GH_KERNEL.fromLegacyState(initial,[
    {name:'config',owner:'fuzz',kind:'object'},
    {name:'events',owner:'fuzz',kind:'append-only',cap:16,legacyOrder:'newest-first'},
    {name:'assets',owner:'fuzz',kind:'columns',columns:{value:'f64'}}
  ]);
  let seed=0x342f00d;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let index=0;index<10000;index++){
    const before=kernel.legacyState(),beforeHash=GH_KERNEL.fingerprint(before),revision=kernel.revision('events'),failureStage=(random()%4),value=random()%100000;
    let failed=false;
    try{
      kernel.tx({label:`property-rollback:${index}`,owner:'fuzz',writes:['config','events','assets'],reads:{config:kernel.revision('config'),events:revision,assets:kernel.revision('assets')}},writer=>{
        writer.set('config',{value});if(failureStage===1)throw new Error('injected');
        writer.append('events',{id:`E-${index}`,value});if(failureStage===2)throw new Error('injected');
        writer.col('assets','value').set(0,value);if(failureStage===3)throw new Error('injected');
      });
    }catch(error){assert.equal(error.message,'injected');failed=true;}
    if(failureStage!==0){assert.equal(failed,true);assert.equal(GH_KERNEL.fingerprint(kernel.legacyState()),beforeHash,`kernel rollback mismatch at ${index}`);assert.equal(kernel.revision('events'),revision,`failed transaction advanced revision ${index}`);}
    else assert.equal(failed,false);
  }
}

console.log('Build342 state kernel: scoped owners, section revisions, append-only rollback/order, ledger idempotency, Float64 columns and 10,000 deterministic fault injections PASS');
