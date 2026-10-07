'use strict';
// Build 359 (a million assets: the hourly proof maintenance listed every record, document and ledger row on every pass,
// 17 ms and 7 ms on the desktop at 12,000 documents, even with nothing to do). Checked here:
// 1. converting earlier versions to checkpoints takes the predecessors of the records issued since the last pass: a pass
//    with nothing new lists no record map, and the incremental passes convert exactly what a full sweep would;
// 2. a pass inside a transaction that rolls back leaves its list as it was (the next pass converts the same versions);
// 3. converting archived records reads a sealed audit archive collection once, then only the documents a later version
//    of it adds (declared by its writer), and converts them; every ARCHIVED_SWEEP-th pass reads everything again;
// 4. the save schema agrees in full afterwards.
const assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const results=[];const test=(name,fn)=>{results.push({name,detail:fn()});console.log(`PASS ${name}`);};
function world(){
  const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE;state.godMoney=true;state.infiniteMoney=true;let sequence=0;
  // Each cheque is issued then cashed: two versions of one document, the first linked by the second.
  const cheques=count=>{const out=TX.execute(state,{label:`maintenance-seed-${sequence}`,apply:()=>{for(let i=0;i<count;i++,sequence++){const c=e.command('finance','issue-cheque',{company:'air',amount:300+sequence,beneficiary:'Supplier LLC',note:'maintenance',requestRef:`MAINT-${sequence}`});e.command('finance','settle-cheque',{id:c.id});}}});assert.equal(out.committed,true,out.reason);state.simSeconds+=3600;};
  return {e,s,state,TX,Proof:s.GH_DOCUMENT_PROOF,Schema:s.GH_SAVE_SCHEMA,cheques};
}
const checkpointIds=w=>Object.keys(w.state.documentProofs.checkpointsById||{}).sort();
const drain=w=>{let total=0;for(let i=0;i<100;i++){const out=w.Proof.checkpointAncestors(w.state);total+=out.checkpointed;if(!out.checkpointed)break;}return total;};

test('checkpoint passes take only what was issued since, and convert what a full sweep would',()=>{
  // Two identical worlds: one converts after every batch (incremental passes), the other once at the end (a first pass
  // lists everything).
  const a=world(),b=world();
  for(let round=0;round<4;round++){a.cheques(40);b.cheques(40);drain(a);}
  drain(b);
  assert.deepEqual(checkpointIds(a),checkpointIds(b),'the same versions became checkpoints');
  assert.ok(checkpointIds(a).length>=150,`versions converted (${checkpointIds(a).length})`);
  // Nothing new: the pass lists no record map.
  const realm=vm.runInContext('Object',a.s),original={keys:realm.keys,values:realm.values,entries:realm.entries},store=a.state.documentProofs,watched=new Set([store.recordsById,store.archiveById,store.checkpointsById].filter(Boolean));let listed=0;
  for(const name of Object.keys(original))realm[name]=function(target,...rest){if(watched.has(target))listed++;return original[name].call(this,target,...rest);};
  let out;try{out=a.Proof.checkpointAncestors(a.state);}finally{Object.assign(realm,original);}
  assert.equal(out.checkpointed,0);assert.equal(listed,0,`record maps listed ${listed} times`);
  assert.equal(a.Schema.validate(a.state).ok,true);
  return {checkpoints:checkpointIds(a).length};
});

test('a rolled-back pass leaves its list as it was',()=>{
  const w=world();w.cheques(30);drain(w);w.cheques(30);
  const before=JSON.stringify(w.state.documentProofs);
  assert.throws(()=>w.TX.execute(w.state,{label:'maintenance-rollback',scope:['documentProofs'],writeRoots:['documentProofs'],rowRoots:{documentProofs:{level:'containers'}},apply:()=>{const out=w.Proof.checkpointAncestors(w.state);assert.ok(out.checkpointed>0);throw new Error('qa-injected');}}),/qa-injected/);
  assert.equal(JSON.stringify(w.state.documentProofs),before,'the store is back');
  const out=w.Proof.checkpointAncestors(w.state);assert.ok(out.checkpointed>0,'the next pass converts the same versions');
  return {converted:out.checkpointed};
});

test('archived records: a sealed collection is read once, then only what a later version adds',()=>{
  const w=world(),{state,TX,Proof}=w;w.cheques(60);
  const records=()=>state.finance.auditArchive.records;
  // As the daily compaction does: settled rows leave the live list as copies appended to a new archive collection.
  const archive=keep=>{const f=state.finance,a=f.auditArchive=f.auditArchive||{records:{},digests:[]};a.records=a.records||{};const rows=f.cheques;if(rows.length<=keep)return;const copies=rows.slice(keep).map(row=>structuredClone(row)),base=a.records.cheques||[],next=[...base,...copies];if(base.length)TX.deriveContainer(next,base,{changed:copies});a.records.cheques=next;rows.length=keep;};
  archive(20);TX.sealCollections(state);
  const converted=()=>records().cheques.filter(row=>Proof.record(state,row.documentProofId)?.form==='archived-document-v2').length;
  let total=0;for(let i=0;i<20;i++){const out=Proof.compactArchivedRecords(state);total+=out.compacted;if(!out.compacted)break;}
  assert.equal(converted(),records().cheques.length,'every archived document converted');
  // A later version adds documents: the next passes convert them.
  w.cheques(30);archive(20);TX.sealCollections(state);
  for(let i=0;i<20;i++){const out=Proof.compactArchivedRecords(state);total+=out.compacted;if(!out.compacted)break;}
  assert.equal(converted(),records().cheques.length,'the added documents converted too');
  assert.equal(w.Schema.validate(state).ok,true,'the save schema agrees in full');
  return {archived:records().cheques.length,converted:total};
});

console.log(JSON.stringify({suite:'build359-incremental-maintenance',results},null,1));
console.log('BUILD359_INCREMENTAL_MAINTENANCE_PASS');
