'use strict';
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');
const results=[];
function test(name,fn){try{fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:String(e.stack||e)});}}
test('scope promotion copies previously covered fleet once, not twice',()=>{
 const {s}=harness(['transaction-core']);const tx=s.GH_TRANSACTION_CORE,state={assets:[{id:'A',fuel:100}],finance:{cash:10},outside:{v:5}};
 const native=s.structuredClone;let coveredCopies=0;s.structuredClone=v=>{if(v===state.assets||v?.assets===state.assets)coveredCopies++;return native(v);};
 const outcome=tx.execute(state,{scope:['assets','finance'],apply(){state.assets[0].fuel=90;return tx.join(state,{apply(){state.outside.v=7;}});}});
 assert.equal(outcome.committed,true);assert.equal(coveredCopies,1);assert.equal(state.outside.v,7);
});
test('promoted rollback restores before-owner values and removes new roots, including critical side effects',()=>{
 const {s}=harness(['transaction-core']);const tx=s.GH_TRANSACTION_CORE,state={assets:[{id:'A',fuel:100}],finance:{cash:10},outside:{v:5}},before=JSON.stringify(state);
 assert.throws(()=>tx.execute(state,{scope:['assets','finance','missing'],apply(){state.assets[0].fuel=5;state.missing={partial:true};tx.join(state,{apply(){state.outside.v=9;state.newRoot=[1];delete state.finance;}});tx.afterCommit(()=>{throw Error('critical failure');},{critical:true});}}),/critical failure/);
 assert.deepEqual(JSON.parse(JSON.stringify(state)),JSON.parse(before));assert.equal(tx.isActive(),false);
});
test('failure while promoting scope poisons the outer transaction even when its caller catches it',()=>{
 const {s}=harness(['transaction-core']);const tx=s.GH_TRANSACTION_CORE,state={assets:[{id:'A',fuel:100}]};let armed=false;
 Object.defineProperty(state,'other',{enumerable:true,configurable:true,get(){if(armed)throw Error('promotion fault');return {safe:true};}});
 assert.throws(()=>tx.execute(state,{scope:['assets'],apply(){state.assets[0].fuel=2;armed=true;try{tx.join(state,{apply(){throw Error('unreachable');}});}catch(_e){armed=false;}return true;}}),/promotion fault/);
 assert.equal(state.assets[0].fuel,100);assert.equal(tx.isActive(),false);
});
test('failed joined apply remains sticky and full transactions need no promotion snapshot',()=>{
 const {s}=harness(['transaction-core']);const tx=s.GH_TRANSACTION_CORE,state={assets:[{id:'A',fuel:100}],other:{v:5}},before=JSON.stringify(state);let copies=0;const native=s.structuredClone;s.structuredClone=v=>{copies++;return native(v);};
 assert.throws(()=>tx.execute(state,{apply(){try{tx.join(state,{apply(){state.other.v=6;throw Error('joined fault');}});}catch(_e){}return true;}}),/joined fault/);assert.equal(JSON.stringify(state),before);assert.equal(copies,1);
});
test('a caught cross-state join violation still aborts the transaction that requested it',()=>{
 const {s}=harness(['transaction-core']);const tx=s.GH_TRANSACTION_CORE,state={assets:[{id:'A',fuel:100}]},foreign={value:1};
 assert.throws(()=>tx.execute(state,{scope:['assets'],apply(){state.assets[0].fuel=9;try{tx.join(foreign,{apply(){foreign.value=2;}});}catch(_e){}return true;}}),/Cross-state transaction join/);
 assert.equal(state.assets[0].fuel,100);assert.equal(foreign.value,1);assert.equal(tx.isActive(),false);
});
console.log(JSON.stringify({suite:'build334-r2-transaction-promotion',passed:results.filter(x=>x.ok).length,total:results.length,results},null,2));if(results.some(x=>!x.ok))process.exitCode=1;
