'use strict';
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');
const results=[];
function test(name,fn){try{const detail=fn();results.push({name,ok:true,detail});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}

test('write audit reports nested root mutations without changing state semantics',()=>{
  const {s}=harness(['transaction-core']),tx=s.GH_TRANSACTION_CORE,state={assets:[{id:'A',fuel:100}],finance:{cash:10},unchanged:{v:1}};
  const out=tx.execute(state,{label:'audit-observe',auditWrites:true,writeRoots:['assets','finance'],apply(){state.assets[0].fuel=90;state.finance.cash=8;}});
  assert.equal(out.committed,true);assert.equal(state.assets[0].fuel,90);assert.equal(state.finance.cash,8);
  const audit=tx.telemetry().last.writeAudit;assert.deepEqual(audit.mutatedRoots,['assets','finance']);assert.deepEqual(audit.undeclaredRoots,[]);assert.equal(audit.stage,'pre-irreversible');
  return audit;
});

test('undeclared write is rejected and rollback is byte-equivalent',()=>{
  const {s}=harness(['transaction-core']),tx=s.GH_TRANSACTION_CORE,state={assets:[{id:'A',fuel:100}],finance:{cash:10},outside:{value:7}},before=JSON.stringify(state);
  assert.throws(()=>tx.execute(state,{label:'audit-enforce',scope:['assets','finance'],auditWrites:true,enforceWriteRoots:true,writeRoots:['assets','finance'],apply(){state.assets[0].fuel=1;tx.join(state,{apply(){state.outside.value=99;}});}}),error=>error?.code==='TRANSACTION_WRITE_SET_VIOLATION'&&error.undeclaredRoots.includes('outside'));
  assert.equal(JSON.stringify(state),before);
  const audit=tx.telemetry().last.writeAudit;assert.ok(audit.mutatedRoots.includes('outside'));assert.ok(audit.undeclaredRoots.includes('outside'));return audit;
});

test('critical post-commit authoritative mutation is included in write audit',()=>{
  const {s}=harness(['transaction-core']),tx=s.GH_TRANSACTION_CORE,state={finance:{cash:10},proofs:{count:0}};
  tx.execute(state,{label:'audit-critical',auditWrites:true,writeRoots:['finance','proofs'],apply(){state.finance.cash=9;tx.afterCommit(()=>{state.proofs.count++;},{critical:true,key:'proof-finalize',owner:'test'});}});
  const audit=tx.telemetry().last.writeAudit;assert.deepEqual(audit.mutatedRoots,['finance','proofs']);assert.deepEqual(audit.undeclaredRoots,[]);return audit;
});

test('caught joined failure records mutation evidence before full rollback',()=>{
  const {s}=harness(['transaction-core']),tx=s.GH_TRANSACTION_CORE,state={assets:[{id:'A',fuel:100}],outside:{value:7}},before=JSON.stringify(state);
  assert.throws(()=>tx.execute(state,{label:'audit-failure',scope:['assets'],auditWrites:true,writeRoots:['assets','outside'],apply(){state.assets[0].fuel=2;try{tx.join(state,{apply(){state.outside.value=12;throw new Error('joined-fault');}});}catch(_error){}}}),/joined-fault/);
  assert.equal(JSON.stringify(state),before);const audit=tx.telemetry().last.writeAudit;assert.ok(audit.mutatedRoots.includes('assets'));assert.ok(audit.mutatedRoots.includes('outside'));assert.equal(audit.stage,'failure-before-rollback');return audit;
});

test('audit is opt-in and absent from normal transaction telemetry',()=>{
  const {s}=harness(['transaction-core']),tx=s.GH_TRANSACTION_CORE,state={value:1};tx.execute(state,{label:'normal',apply(){state.value=2;}});assert.equal(tx.telemetry().last.writeAudit,null);
});

const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build339-transaction-write-set-audit',passed,total:results.length,results},null,2));if(passed!==results.length)process.exitCode=1;
