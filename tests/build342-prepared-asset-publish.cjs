'use strict';
const assert=require('node:assert/strict');
const K=require('../WebApp/kernel-core.js');
const source={assets:[{id:'A',progress:.1,fuel:60,specs:{capacity:10}},{id:'B',progress:.2,fuel:50}],finance:{balance:100}};
const kernel=K.fromLegacyState(source,[
  {name:'assets',kind:'columns',owner:'transaction-core',columns:{progress:'f64',fuel:'f64'}},
  {name:'finance',kind:'object',owner:'transaction-core'}
]);
const view=kernel.stateView(),liveArray=view.assets,oldRow=view.assets[0],numericOnlyRow=view.assets[1],before=JSON.stringify(view),beforeStamp=K.stampOf(oldRow),numericStamp=K.stampOf(numericOnlyRow);
let prepared=kernel.prepareColumnUpdate('assets');prepared.patch(0,{progress:.75,lastTrip:{margin:42}});prepared.patch(1,{fuel:41});
assert.equal(JSON.stringify(view),before,'preparation leaves all live values untouched');
assert.throws(()=>kernel.tx({owner:'transaction-core',writes:['assets','finance']},writer=>{
  writer.publishPreparedRows('assets',prepared);view.finance.balance=0;throw new Error('finance-injected');
}),/finance-injected/);
assert.equal(JSON.stringify(view),before,'publication and finance rollback restore the identical legacy bytes');
assert.equal(oldRow.progress,.1,'old row references follow a rollback');
prepared=kernel.prepareColumnUpdate('assets');prepared.patch(0,{progress:.75,lastTrip:{margin:42}});prepared.patch(1,{fuel:41});
kernel.tx({owner:'transaction-core',writes:['assets','finance']},writer=>{writer.publishPreparedRows('assets',prepared);view.finance.balance=142;});
assert.equal(liveArray,view.assets,'the existing live asset array stays stable after an atomic swap');
assert.equal(oldRow.progress,.75,'an existing row reference reads the new typed value');
assert.notEqual(K.stampOf(oldRow),beforeStamp,'prepared numeric changes invalidate row mutation stamps');
assert.notEqual(K.stampOf(numericOnlyRow),numericStamp,'numeric-only changes invalidate the original row identity stamp');
assert.equal(oldRow.lastTrip.margin,42,'an existing row reference reads new metadata');
assert.equal(Object.getOwnPropertyDescriptor(oldRow,'lastTrip').value.margin,42,'descriptors read live metadata');
assert.equal(view.assets[1].fuel,41);
assert.equal(view.finance.balance,142);
assert.deepEqual(kernel.legacyState().assets,[{id:'A',progress:.75,fuel:60,specs:{capacity:10},lastTrip:{margin:42}},{id:'B',progress:.2,fuel:41}]);
assert.throws(()=>prepared.patch(0,{fuel:0}),/already-published/,'the preparation handle cannot mutate committed storage');
assert.throws(()=>{K.identityOf(view.assets[0]).specs.capacity=0;},/kernel-raw-mutation-forbidden/);
const stale=kernel.prepareColumnUpdate('assets');stale.patch(1,{fuel:30});
view.assets[1].fuel=40;
assert.throws(()=>kernel.tx({owner:'transaction-core',writes:['assets']},writer=>writer.publishPreparedRows('assets',stale)),/kernel-prepared-section-conflict/);
assert.equal(view.assets[1].fuel,40,'a newer tracked write cannot be replaced by an older staged section');
console.log('Build342 prepared asset publication: live references, Save Schema order, read-only raw data and finance rollback PASS');
