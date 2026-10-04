'use strict';
// Build 358, second iPhone diagnostic (25 MB state): each daily close paid a 17-21 ms full-state copy in the middle of
// its work, because the close joins system commands (fallbackReason joined-writer) and a join promotes a scoped
// transaction to a full snapshot. A staged transaction with stagedFullScope captures every other root before it writes,
// one root per step, so joins need no copy. This gate holds the transaction core to that:
//  - the extra roots, and the declared scope itself, are captured in separate steps before the first write;
//  - a join does not promote (no joined-writer fallback);
//  - a failure after writes to roots outside the original scope, and after adding a new root, restores the state exactly;
//  - a commit keeps every write;
//  - integrity-final (16-20 ms on iPhone) runs as two post-commit tasks, schema then business checks, one step each.
const assert=require('node:assert/strict');
const path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require('./helpers/core-harness');
const {s}=harness(['transaction-core']);
const TX=s.GH_TRANSACTION_CORE;

function fixture(){
  return {simSeconds:10,finance:{invoices:[{number:'A',amount:1}],cash:5},market:{prices:{X:1}},world:{rows:Array.from({length:200},(_,i)=>({id:i,v:i}))},profile:{name:'QA'},log:[]};
}
function run(target,{fail,full=true}){
  const events=[];let applyStarted=false;
  const handle=TX.beginStaged(target,{label:'qa-staged-full-scope',scope:['simSeconds','finance'],writeRoots:['simSeconds','finance'],stagedFullScope:full,
    apply:function*(){
      applyStarted=true;events.push('apply');target.simSeconds=20;target.finance.invoices.push({number:'B',amount:2});yield 'a';
      TX.join(target,{label:'qa-joined',apply:()=>{target.market.prices.X=99;target.world.rows[5].v=-1;target.log.push('joined');}});yield 'b';
      target.addedRoot={created:true};delete target.profile;yield 'c';
      if(fail)throw new Error('qa-staged-failure');
      return 'done';
    }});
  let guard=0;while(!handle.done&&guard++<1000){if(!applyStarted)events.push(handle.stage);handle.step(-Infinity);}
  return {handle,events,telemetry:TX.telemetry().last};
}

{
  const target=fixture(),before=JSON.stringify(target),order=Object.keys(target);
  const {handle,events,telemetry}=run(target,{fail:true});
  assert.ok(handle.error&&/qa-staged-failure/.test(handle.error.message),'the failure surfaces');
  assert.equal(JSON.stringify(target),before,'state restored exactly (writes outside the first scope, a new root, a deleted root)');
  assert.deepEqual(Object.keys(target),order,'root order restored');
  assert.equal(telemetry.rollbackStorage,'legacy-scoped');assert.equal(telemetry.fullSnapshot,false,'no full-state copy');assert.equal(telemetry.fallbackReason||null,null,'no joined-writer promotion');
  assert.equal(telemetry.stagedFullScope,true);
  const snapshotSteps=events.filter(stage=>stage==='snapshot').length;
  assert.ok(snapshotSteps>=4,`one step per extra root before the first write (${snapshotSteps}: ${events.join(',')})`);
  console.log(`PASS rollback exact after join, unscoped writes, new and deleted roots (${snapshotSteps} snapshot steps)`);
}
{
  const target=fixture();
  const {handle}=run(target,{fail:false});
  assert.equal(handle.error,null);assert.equal(handle.result.committed,true);
  assert.equal(target.simSeconds,20);assert.equal(target.market.prices.X,99);assert.equal(target.world.rows[5].v,-1);assert.deepEqual(target.log,['joined']);
  assert.deepEqual(target.addedRoot,{created:true});assert.equal('profile' in target,false);
  console.log('PASS commit keeps every write');
}
{
  // The declared scope is captured one root per step too (the daily close copied every root it writes in its first
  // frame, 36-45 ms on iPhone): the first step captures nothing, each step adds at most one root, and the row-level
  // policy of a declared root still applies. An abort while capturing restores the state exactly and deletes nothing.
  const target=fixture(),before=JSON.stringify(target);
  const handle=TX.beginStaged(target,{label:'qa-deferred-scope',scope:['simSeconds','finance','world'],writeRoots:['simSeconds','finance','world'],stagedFullScope:true,rowRoots:{world:{level:'rows'}},apply:function*(){target.world.rows[1].v=-5;target.finance.cash=0;yield 'a';return true;}});
  const sizes=[];let guard=0;while(!handle.done&&guard++<100){sizes.push(TX.telemetry().last?.label==='qa-deferred-scope'?TX.telemetry().last.scopeSize:null);handle.step(-Infinity);}
  assert.equal(handle.error,null,String(handle.error));assert.equal(handle.result.committed,true);
  const t=TX.telemetry().last;assert.deepEqual(t.rowRoots,['world'],'row-level policy kept for a deferred root');assert.equal(t.stagedFullScope,true);
  assert.ok(handle.steps>=Object.keys(JSON.parse(before)).length+1,`one step per root (${handle.steps} steps)`);
  for(const stopAfter of [1,2,3,4]){
    const target=fixture(),before=JSON.stringify(target),order=Object.keys(target);
    const h=TX.beginStaged(target,{label:'qa-deferred-abort',scope:['simSeconds','finance','world'],writeRoots:['simSeconds','finance','world'],stagedFullScope:true,apply:function*(){target.simSeconds=99;yield 'a';return true;}});
    for(let i=1;i<stopAfter&&!h.done;i++)h.step(-Infinity);
    target.profile.name='written between frames';h.abort('qa-abort-while-capturing');
    assert.ok(h.error&&/qa-abort-while-capturing/.test(h.error.message));
    const expected=JSON.parse(before);if(stopAfter>=Object.keys(expected).length+1)expected.profile.name='QA';else expected.profile.name='written between frames';
    const now=JSON.parse(JSON.stringify(target));
    assert.deepEqual(Object.keys(target),order,`abort after ${stopAfter} steps: every root kept, in order`);
    assert.equal(now.simSeconds,10);assert.deepEqual(now.finance,expected.finance);assert.deepEqual(now.world,expected.world);
  }
  console.log('PASS the declared scope is captured one root per step; an abort while capturing restores and deletes nothing');
}
{
  // Without the option the join still promotes to a full snapshot (unchanged behaviour for other transactions).
  const target=fixture(),before=JSON.stringify(target);
  const {telemetry}=run(target,{fail:true,full:false});
  assert.equal(JSON.stringify(target),before);assert.equal(telemetry.fallbackReason,'joined-writer');assert.equal(telemetry.fullSnapshot,true);
  console.log('PASS without stagedFullScope a join still promotes (exact rollback)');
}
// integrity-final is split: the schema check and the business check are separate post-commit tasks (schema first), so a
// staged transaction runs them in separate steps (frames). A failing schema check still rolls the transaction back.
(()=>{
  const h=harness(['transaction-core','control-plane-core']),T=h.s.GH_TRANSACTION_CORE,CP=h.s.GH_CONTROL_PLANE;
  let schemaCalls=0,integrityCalls=0,schemaOk=true;const order=[];
  h.s.GH_SAVE_SCHEMA={validate:()=>{schemaCalls++;order.push('schema');return schemaOk?{ok:true}:{ok:false,errors:['qa-schema']};}};
  h.s.GH_INTEGRITY_CORE={check:()=>{integrityCalls++;order.push('integrity');return {issues:[]};}};
  const run=()=>{const target={simSeconds:1,finance:{n:0}},before=JSON.stringify(target);CP.ensure(target);const baseline=JSON.stringify(target);
    const handle=T.beginStaged(target,{label:'qa-split-integrity',apply:function*(){CP.execute(target,{name:'QA_SPLIT',domain:'qa',actor:'qa'},()=>{target.finance.n++;return true;},{deferIntegrityToTransaction:true,atomic:false});yield 'a';CP.execute(target,{name:'QA_SPLIT_2',domain:'qa',actor:'qa'},()=>{target.finance.n++;return true;},{deferIntegrityToTransaction:true,atomic:false});return true;}});
    const stages=[];let guard=0;while(!handle.done&&guard++<100){handle.step(-Infinity);stages.push(handle.stage);}
    return {handle,target,baseline,stages,telemetry:T.telemetry().last,before};};
  order.length=0;const ok=run();
  assert.equal(ok.handle.error,null,String(ok.handle.error));
  const tasks=ok.telemetry.postCommitCriticalTasks.map(row=>row.key);
  assert.deepEqual(tasks,['integrity-final-schema','integrity-final'],`two tasks, schema first: ${tasks}`);
  assert.deepEqual(order.filter(x=>x==='schema').length,1,'the schema is validated once per transaction');
  assert.equal(order.at(-1),'integrity');assert.ok(order.lastIndexOf('schema')<order.lastIndexOf('integrity'));
  assert.ok(ok.stages.filter(stage=>stage==='post-commit').length>=2,`separate post-commit steps: ${ok.stages}`);
  schemaOk=false;const bad=run();
  assert.ok(bad.handle.error&&/SAVE_SCHEMA_INTEGRITY/.test(bad.handle.error.message),'a failing schema check aborts');
  assert.equal(JSON.stringify(bad.target),bad.baseline,'and the transaction rolls back exactly');
  console.log('PASS integrity-final split into schema and business steps');
})();
console.log('BUILD358_STAGED_FULL_SCOPE_PASS');
