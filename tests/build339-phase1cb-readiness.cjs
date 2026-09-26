'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {harness,minimal}=require('./helpers/core-harness');

const results=[];
function test(name,fn){try{results.push({name,ok:true,detail:fn()??null});}catch(error){results.push({name,ok:false,error:String(error?.stack||error)});}}
function active(tx){return tx.telemetry().active||{};}
function last(tx){return tx.telemetry().last||{};}
function sha(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}

// Composite writers must be known before the first mutation. A declared mayJoin path
// is deliberately forced to Full Snapshot until Phase1C proves an upfront scope union.
test('test_composite_transaction_early_promotion',()=>{
  const {s}=harness(['transaction-core']);const tx=s.GH_TRANSACTION_CORE;
  const state={assets:[{id:'A',fuel:100}],outside:{v:1}};const before=JSON.stringify(state);let sawFull=false,childRan=false;
  assert.throws(()=>tx.execute(state,{
    label:'phase1cb-composite-early',scope:['assets'],rollbackMode:'journal',
    writerContracts:[{owner:'composite-steady',proven:true,root:'assets',mode:'asset-fields',fields:['fuel'],mayJoin:true}],
    apply(){sawFull=active(tx).rollbackStorage==='full-snapshot';state.assets[0].fuel=90;tx.join(state,{writerContract:{owner:'child',proven:true,roots:['outside']},apply(){childRan=true;state.outside.v=2;throw new Error('composite-fault');}});}
  }),/composite-fault/);
  assert.equal(sawFull,true,'mayJoin must force Full Snapshot before outer apply begins');
  assert.equal(childRan,true);assert.equal(JSON.stringify(state),before);assert.equal(last(tx).rollbackStorage,'full-snapshot');
  return last(tx);
});

// A journal transaction that was admitted as non-composite must not silently perform
// a late promotion when an unexpected join appears after parent writes have started.
test('test_unexpected_journal_join_rejected',()=>{
  const {s}=harness(['transaction-core']);const tx=s.GH_TRANSACTION_CORE;
  const state={assets:[{id:'A',fuel:100}],outside:{v:1}};const before=JSON.stringify(state);let childRan=false;
  assert.throws(()=>tx.execute(state,{
    label:'phase1cb-unexpected-join',scope:['assets'],rollbackMode:'journal',
    writerContracts:[{owner:'non-composite',proven:true,root:'assets',mode:'asset-fields',fields:['fuel'],mayJoin:false}],
    apply(){state.assets[0].fuel=77;tx.join(state,{writerContract:{owner:'unexpected-child',proven:true,roots:['outside']},apply(){childRan=true;state.outside.v=9;}});}
  }),/unexpected.*join|journal.*join/i);
  assert.equal(childRan,false,'unexpected joined apply must never execute');
  assert.equal(JSON.stringify(state),before,'parent journal writes must roll back');
  return last(tx);
});

// Any writer that may touch nested asset subobjects is not eligible for primitive
// field journal yet. Phase1C-B keeps it on Full Snapshot until a deep entity contract exists.
test('test_nested_subobject_mutation_escalation',()=>{
  const {s}=harness(['transaction-core']);const tx=s.GH_TRANSACTION_CORE;
  const state={assets:[{id:'A',fuel:100,staffing:{fatigueLevel:0.1}}]};const before=JSON.stringify(state);let sawFull=false;
  assert.throws(()=>tx.execute(state,{
    label:'phase1cb-nested-asset',scope:['assets'],rollbackMode:'journal',
    writerContracts:[{owner:'nested-asset-writer',proven:true,root:'assets',mode:'asset-fields',fields:['fuel'],allowNestedSubobjects:true}],
    apply(){sawFull=active(tx).rollbackStorage==='full-snapshot';state.assets[0].staffing.fatigueLevel=.9;throw new Error('nested-fault');}
  }),/nested-fault/);
  assert.equal(sawFull,true,'nested asset writer must escalate before mutation');assert.equal(JSON.stringify(state),before);
  return last(tx);
});

// New committed values for primitive field journal must stay JSON-safe. Unsupported
// values are a contract violation and must be rolled back before commit.
test('test_primitive_unsafe_value_rejection',()=>{
  for(const bad of [undefined,NaN,Infinity,-Infinity,1n]){
    const {s}=harness(['transaction-core']);const tx=s.GH_TRANSACTION_CORE;
    const state={assets:[{id:'A',fuel:100}],simSeconds:0};const before=JSON.stringify(state),beforeHash=sha(state);
    assert.throws(()=>tx.execute(state,{
      label:'phase1cb-unsafe-primitive',scope:['assets','simSeconds'],rollbackMode:'journal',
      writerContracts:[{owner:'asset-field-writer',proven:true,root:'assets',mode:'asset-fields',fields:['fuel']}],
      apply(){state.assets[0].fuel=bad;state.simSeconds=30;return true;}
    }),/field|journal|primitive|contract|unsupported/i);
    assert.equal(JSON.stringify(state),before);assert.equal(sha(state),beforeHash);
  }
  return {cases:5};
});

// Write-set verification is rollback-capable work and must complete before any
// irreversible persistence/publication task can execute.
test('test_write_barrier_precedes_irreversible_persistence',()=>{
  const {s,storage}=harness(['transaction-core']);const tx=s.GH_TRANSACTION_CORE;
  const state={simSeconds:0,outside:{v:1}};const before=JSON.stringify(state);
  assert.throws(()=>tx.execute(state,{
    label:'phase1cb-barrier-before-persist',scope:['simSeconds','outside'],rollbackMode:'journal',
    writerContracts:[{owner:'time-only',proven:true,roots:['simSeconds','outside']}],
    writeRoots:['simSeconds'],auditWrites:true,enforceWriteRoots:true,
    apply(){state.simSeconds=30;state.outside.v=2;tx.afterCommit(()=>storage.setItem('phase1cb-persist-marker','published'),{critical:true,irreversible:true,priority:100,key:'persist',owner:'persistence'});}
  }),/write-set-violation/);
  assert.equal(storage.getItem('phase1cb-persist-marker'),null,'irreversible publication ran before write barrier');
  assert.equal(JSON.stringify(state),before);
  return last(tx);
});

// The actual integrity owner must be demonstrably read-only before Phase1C-B may mark
// integrity-final readOnly. Freeze the representative authoritative tree and call it.
test('test_integrity_core_is_read_only_on_frozen_state',()=>{
  const {s}=harness(['integrity-core']);const state=minimal();state.simulationKernel={};state.domainRuntime={};state.documentProofs=[];state.realism={};state.controlPlane={};
  const before=JSON.stringify(state);
  const freeze=(value,seen=new WeakSet())=>{if(!value||typeof value!=='object'||seen.has(value))return value;seen.add(value);for(const nested of Object.values(value))freeze(nested,seen);return Object.freeze(value);};
  freeze(state);const report=s.GH_INTEGRITY_CORE.check(state);assert.ok(report);assert.equal(JSON.stringify(state),before);
  return {status:report.status||null,issues:(report.issues||[]).length};
});

// JSON byte equivalence does not require normalizing -0 to +0; both stringify as 0.
// Preserve runtime semantics rather than silently changing values.
test('test_negative_zero_does_not_require_sanitization',()=>{
  assert.equal(JSON.stringify({v:-0}),JSON.stringify({v:0}));assert.equal(Object.is(-0,0),false);return {json:JSON.stringify({v:-0})};
});

const passed=results.filter(row=>row.ok).length;
console.log(JSON.stringify({suite:'build339-phase1cb-readiness',phase:'writer-proof-red-gate',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;
