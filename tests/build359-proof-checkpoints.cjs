'use strict';
// Build 359, iPhone diagnostic: proof records were 31 MB of a 71.5 MB save. Each amendment of a document (issued,
// cheque issued, cleared, settled) adds a whole record, and the earlier versions were kept whole only so the newer one
// could prove its link to them. An earlier version whose chain verifies now becomes a
// checkpoint (the link fields only); checkpoints carry one digest per 30-day period. Checked here:
// - the store shrinks, every document still verifies (trusted and full validation), current versions stay in the
//   compact form they are issued in (Build 359: the earlier version an amendment links to is rebuilt whole);
// - an edited checkpoint or period digest is refused; a checkpoint in two places is refused;
// - a document amended again after its history became checkpoints still verifies;
// - garbage collection drops checkpoints nothing links to and keeps the period digests exact;
// - a batch converts at most 400 versions; the state survives the save codec.
const assert=require('node:assert/strict'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Proof=s.GH_DOCUMENT_PROOF,Schema=s.GH_SAVE_SCHEMA;
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e9;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e9;const item=e.item;
const ORDERS=150;
for(let order=0;order<ORDERS;order++){
  state.simSeconds+=1800;const total=item.price;
  const out=TX.execute(state,{label:`checkpoint-seed-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty:1,manual:true,requestRef:`CP-${order}`,upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true}))});
  assert.equal(out.committed,true);
}
const store=()=>state.documentProofs,bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const documents=()=>Proof.stateDocuments(state).filter(row=>row?.documentProofId);
const allVerify=()=>documents().every(document=>Proof.verifyDocument(state,document).ok===true);
const linked=Object.values(store().recordsById).filter(row=>row.previousProofId).length;
assert.ok(linked>ORDERS,`documents were amended (${linked} linked versions)`);
assert.ok(allVerify(),'every document verifies before');
const before={bytes:bytes(store()),records:Object.keys(store().recordsById).length};

// Build 359 (a million assets): earlier versions convert in the next pass whatever their age; a batch converts at most
// 400, the rest in later batches.
let total=0,batches=0;for(;;){const out=Proof.checkpointAncestors(state);assert.ok(out.checkpointed<=400);if(!out.checkpointed)break;total+=out.checkpointed;batches++;}
TX.sealCollections(state);
const after={bytes:bytes(store()),records:Object.keys(store().recordsById).length,checkpoints:Object.keys(store().checkpointsById).length};
assert.ok(total>=linked*.9&&after.checkpoints===total,`earlier versions became checkpoints (${total} of ${linked})`);
assert.ok(after.bytes<before.bytes*.55,`the proof store shrinks (${before.bytes} -> ${after.bytes} bytes)`);
for(const document of documents()){const record=Proof.record(state,document.documentProofId);assert.ok(record&&record.form===Proof.COMPACT_FORM&&!record.signedContent,'a current version stays compact');}
assert.ok(allVerify(),'every document verifies after');
assert.deepEqual([...new Set(Object.values(store().periodDigests).map(row=>row.count))].reduce((n,c)=>n+c,0)>0,true);
assert.equal(Schema.validate(state).ok,true,'full validation');assert.equal(Schema.validate(state,{trustVerified:true}).ok,true,'trusted validation');

// Tampering is refused (on a copy, the state is sealed).
const copy=()=>JSON.parse(JSON.stringify(state));
{const t=copy(),id=Object.keys(t.documentProofs.checkpointsById)[0];t.documentProofs.checkpointsById[id].contentDigest='0'.repeat(64);
 const v=Schema.validate(t);assert.equal(v.ok,false);assert.ok(v.errors.includes('document-proof-checkpoint')||v.errors.some(x=>/document-proof/.test(x)),JSON.stringify(v.errors));}
{const t=copy(),period=Object.keys(t.documentProofs.periodDigests)[0];t.documentProofs.periodDigests[period].digest='f'.repeat(64);
 const v=Schema.validate(t);assert.equal(v.ok,false);assert.ok(v.errors.includes('document-proof-checkpoint'),JSON.stringify(v.errors));}
{const t=copy(),id=Object.keys(t.documentProofs.checkpointsById)[0];t.documentProofs.recordsById[id]={...t.documentProofs.recordsById[Object.keys(t.documentProofs.recordsById)[0]],id};
 assert.equal(Proof.verifyCheckpoints(t,null,{fresh:true}).ok,false,'a checkpoint and a record with one id are refused');}
{const t=copy(),id=Object.keys(t.documentProofs.checkpointsById)[0];delete t.documentProofs.checkpointsById[id];
 assert.equal(Proof.verifyCheckpoints(t,null,{fresh:true}).ok,false,'a missing checkpoint breaks its period digest');}

// A document whose earlier versions are checkpoints is amended again and still verifies (inside a transaction, as the
// game does it; the new version links to a whole record whose predecessor is a checkpoint). Build 359: a final document
// is sealed and never amended, so the document is an open payable: its cheque is issued (a second version), its first
// version becomes a checkpoint, then the cheque clears (a third version).
{state.simSeconds+=3600;const open=e.command('finance','issue-invoice',{kind:'مصروف',amount:1000,company:'air',counterparty:'Supplier LLC',note:'QA open payable'});
 const cheque=e.command('finance','issue-cheque',{company:'air',amount:1000,invoiceNumber:open.number,requestRef:'QA-CHECKPOINT-OPEN'});
 while(Proof.checkpointAncestors(state).checkpointed){}
 const invoice=()=>state.finance.invoices.find(row=>row.number===open.number),before=Proof.record(state,invoice().documentProofId);
 assert.ok(before?.previousProofId&&Proof.checkpoint(state,before.previousProofId),'a document whose history is checkpointed');assert.equal(TX.isSealed(invoice()),false,'an open document is not sealed');
 const out=TX.execute(state,{label:'amend-after-checkpoint',apply:()=>e.command('finance','settle-cheque',{id:cheque.id})});
 assert.equal(out.committed,true);const record=Proof.record(state,invoice().documentProofId);assert.ok(record.previousProofId===before.id&&Proof.record(state,record.previousProofId)?.signedContent,'the new version links to the one before it, rebuilt whole');assert.equal(record.form,Proof.COMPACT_FORM,'the new version is compact');
 assert.equal(Proof.verifyDocument(state,invoice()).ok,true,'the amended document verifies');assert.equal(Schema.validate(state).ok,true);}

// The save codec keeps it exact.
{if(!s.GH_STATE_CODEC)e.load('state-codec-core');const C=s.GH_STATE_CODEC,back=C.deserialize(C.serialize(state));assert.equal(JSON.stringify(back.documentProofs.periodDigests),JSON.stringify(store().periodDigests));assert.equal(Proof.verifyCheckpoints(back,null,{fresh:true}).ok,true);assert.equal(Schema.validate(back).ok,true,'a reloaded save validates');}

// Garbage collection: drop the documents of the first orders; their checkpoints go, the period digests stay exact.
{const removed=state.finance.invoices.splice(-20);const t0=Object.keys(store().checkpointsById).length;
 Proof.compact(state,Proof.LIMITS.records);
 const t1=Object.keys(store().checkpointsById).length;assert.ok(t1<t0,`unlinked checkpoints are collected (${t0} -> ${t1})`);
 assert.equal(Proof.verifyCheckpoints(state,null,{fresh:true}).ok,true,'period digests are recomputed');state.finance.invoices.push(...removed);}
console.log(JSON.stringify({suite:'build359-proof-checkpoints',linked,checkpointed:total,batches,bytesBefore:before.bytes,bytesAfter:after.bytes,ratio:+(after.bytes/before.bytes).toFixed(3)}));
console.log('BUILD359_PROOF_CHECKPOINTS_PASS');
