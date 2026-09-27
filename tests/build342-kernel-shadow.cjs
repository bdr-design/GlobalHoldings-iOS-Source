'use strict';
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');

const {s}=harness(['kernel-core','transaction-core']),tx=s.GH_TRANSACTION_CORE;
const state={'finance':{cash:100,ledger:[]},assets:[{id:'A-1',lat:24.7,lng:46.6}],alerts:['old'],'legacy.dot':{keep:true},obsolete:{value:1}};
const attached=tx.enableKernelShadow(state);
assert.equal(attached.enabled,true);
assert.equal(attached.last.ok,true);

tx.execute(state,{label:'shadow:commit',writeRoots:['finance','assets'],apply(){state.finance.cash-=10;state.finance.ledger.push({id:'L-1',debit:10,credit:10});state.assets[0].lat=25.1;}});
assert.equal(tx.kernelShadowStatus(state).last.ok,true);
assert.equal(tx.kernelShadowStatus(state).checks,1);

tx.execute(state,{label:'shadow:new-and-delete-roots',writeRoots:['new.root','obsolete'],apply(){state['new.root']={value:7};delete state.obsolete;}});
assert.equal(tx.kernelShadowStatus(state).last.ok,true,'literal dotted root keys remain distinct from nested paths');
assert.equal(tx.kernelShadowStatus(state).sections,Object.keys(state).length+1);

const before=JSON.stringify(state);
assert.throws(()=>tx.execute(state,{label:'shadow:unexpected-write',scope:['finance'],writeRoots:['finance'],apply(){state.finance.cash=1;state.alerts.unshift('unlisted-write');}}),error=>error?.code==='STATE_KERNEL_SHADOW_MISMATCH'&&error.path==='$.alerts');
assert.equal(JSON.stringify(state),before,'shadow mismatch rolls the authoritative transaction back in full');
assert.equal(tx.kernelShadowStatus(state).last.ok,true,'rollback reconciliation restores shadow parity');

let seed=0x342c0de;
const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
const fuzz={counter:0,rows:[{value:0}],meta:{flag:false}};
tx.enableKernelShadow(fuzz);
for(let index=0;index<10000;index++){
  const previous=JSON.stringify(fuzz),fail=(next()&3)===0;
  try{tx.execute(fuzz,{label:`shadow:fuzz:${index}`,writeRoots:['counter','rows','meta'],apply(){fuzz.counter++;fuzz.rows[0].value=next()%100000;fuzz.meta.flag=Boolean(next()&1);if(fail)throw new Error('injected-shadow-fuzz-failure');}});}catch(error){assert.equal(error.message,'injected-shadow-fuzz-failure');assert.equal(JSON.stringify(fuzz),previous,`state rollback ${index}`);}
  assert.equal(tx.kernelShadowStatus(fuzz).last.ok,true,`shadow parity ${index}`);
}

console.log('Build342 kernel shadow: commit parity, first-difference path, full rollback reconciliation and 10,000 deterministic fault injections PASS');
