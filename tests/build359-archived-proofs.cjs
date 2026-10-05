'use strict';
// Build 358 (save size): the finance audit archive is sealed, and the current record of every document kept there takes
// the compact archived form (GH_DOCUMENT_PROOF.compactArchivedRecords): no copy of the signed content or of the issuer,
// counterparty and signature snapshots; verification rebuilds the signed content from the archived document. Checked:
// - archived rows are sealed and shared (not copied) by durable drafts; a write to one throws;
// - the records of archived documents shrink, live documents keep whole records, a batch converts at most 200;
// - every document verifies (direct, trusted and full validation) and the state survives the save codec;
// - tampering is refused: the archived document's content, the record's digest or chain link, its signature digest,
//   its shape, a missing archived document;
// - an archived-form document cannot be amended or authorized again.
const assert=require('node:assert/strict'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Proof=s.GH_DOCUMENT_PROOF,Schema=s.GH_SAVE_SCHEMA,Codec=s.GH_STATE_CODEC||require(path.join(ROOT,'WebApp/state-codec-core.js'));
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e9;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e9;const item=e.item;
for(let order=0;order<120;order++){
  state.simSeconds+=1800;const total=item.price;
  const out=TX.execute(state,{label:`archived-seed-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty:1,manual:true,requestRef:`AR-${order}`,upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true}))});
  assert.equal(out.committed,true);
}
// The daily compaction's move (app.js archiveTrim/archiveFull): settled rows leave the live list as copies appended to
// the archive bucket.
const open=new Set([...(state.finance.payables||[]),...(state.finance.receivables||[])].map(row=>String(row?.number||'')));
const settled={invoices:row=>!open.has(String(row?.number||''))&&['مدفوعة','مسددة','محصلة'].includes(row?.status),transfers:row=>['منفذة','مسددة','ملغى','ملغاة'].includes(row?.status)};
const archive=state.finance.auditArchive=state.finance.auditArchive||{records:{},digests:[]};archive.records=archive.records||{};
for(const [kind,leaves] of Object.entries(settled)){const live=state.finance[kind],moving=live.filter(row=>row?.documentProofId&&leaves(row)).slice(0,60);
  archive.records[kind]=[...(archive.records[kind]||[]),...moving.map(row=>JSON.parse(JSON.stringify(row)))];state.finance[kind]=live.filter(row=>!moving.includes(row));}
const archived=()=>Object.entries(state.finance.auditArchive.records).flatMap(([kind,rows])=>kind.startsWith('companyLedger-')?[]:rows).filter(row=>row?.documentProofId);
assert.ok(archived().length>=60,`documents were archived (${archived().length})`);
const documents=()=>Proof.stateDocuments(state).filter(row=>row?.documentProofId),allVerify=st=>Proof.stateDocuments(st).filter(row=>row?.documentProofId).every(d=>Proof.verifyDocument(st,d).ok===true);
assert.ok(allVerify(state),'every document verifies before');

// Sealed archive: sealing freezes the rows; a durable draft shares them.
TX.sealCollections(state);
const row0=state.finance.auditArchive.records.invoices[0];assert.equal(TX.isSealed(row0),true,'archived rows are sealed');
assert.throws(()=>{row0.status='x';},TypeError,'an archived row cannot be edited');
const draft=TX.deepClone(state,{shareJournaledRoots:true});assert.equal(draft.finance.auditArchive.records.invoices[0],row0,'a durable draft shares the archived rows');
assert.notEqual(draft.finance.auditArchive.records.invoices,state.finance.auditArchive.records.invoices,'in a new collection');
assert.deepEqual(Object.keys(draft.finance),Object.keys(state.finance),'key order is kept');

// Conversion: batches of at most 200, only archived documents, every document still verifies.
const recordBytes=docs=>docs.reduce((n,d)=>n+Buffer.byteLength(JSON.stringify(Proof.record(state,d.documentProofId))),0);
const before={archived:recordBytes(archived()),store:Buffer.byteLength(JSON.stringify(state.documentProofs))};
let converted=0;for(;;){const out=Proof.compactArchivedRecords(state);assert.ok(out.compacted<=200);if(!out.compacted)break;converted+=out.compacted;}
assert.equal(converted,archived().length,'every archived document took the archived form');
for(const d of archived())assert.equal(Proof.record(state,d.documentProofId).form,Proof.ARCHIVED_FORM);
for(const d of documents().filter(d=>!archived().includes(d)))assert.ok(Proof.record(state,d.documentProofId).signedContent,'a live document keeps its whole record');
const after={archived:recordBytes(archived()),store:Buffer.byteLength(JSON.stringify(state.documentProofs))};
assert.ok(after.archived<before.archived*.3,`archived documents' records shrink (${before.archived} -> ${after.archived} bytes)`);
assert.ok(allVerify(state),'every document verifies after');
TX.sealCollections(state);
assert.equal(Schema.validate(state).ok,true,`full validation ${JSON.stringify(Schema.validate(state).errors)}`);assert.equal(Schema.validate(state,{trustVerified:true}).ok,true,'trusted validation');
assert.equal(Proof.forensicInspectStateProofs(state).ok,true,'forensic inspection');

// The save codec round trip.
{const text=Codec.serialize(state),loaded=Codec.deserialize(text);assert.equal(Schema.validate(loaded).ok,true,'a loaded save validates');assert.ok(allVerify(loaded),'and its documents verify');}

// Tampering, on copies.
const copy=()=>JSON.parse(JSON.stringify(state));
const refused=(name,edit)=>{const t=copy();edit(t);const v=Schema.validate(t);assert.equal(v.ok,false,`${name} is refused`);assert.ok(v.errors.some(x=>/document-proof|document/.test(x)),`${name}: ${JSON.stringify(v.errors)}`);return v.errors;};
const doc=t=>t.finance.auditArchive.records.invoices[0],rec=t=>{const id=doc(t).documentProofId;return t.documentProofs.recordsById[id]||t.documentProofs.archiveById[id];};
refused('an edited archived document',t=>{doc(t).total=Number(doc(t).total)+1;doc(t).amount=doc(t).total;});
refused('an edited archived note',t=>{doc(t).note='changed';});
refused('an edited record digest',t=>{rec(t).contentDigest='0'.repeat(64);});
refused('an edited chain link',t=>{const r=rec(t);if(r.chain){r.chain.transition='invoice-collected';}else r.chainDepth=1;});
refused('extra content in the archived form',t=>{rec(t).signedContent={};});
refused('a missing archived document',t=>{t.finance.auditArchive.records.invoices.shift();});
{const t=copy(),d=t.finance.auditArchive.records.invoices.find(row=>row.signatureSnapshot);if(d){d.signatureSnapshot.signerNameSnapshot='x';const v=Schema.validate(t);assert.equal(v.ok,false,'an edited signature snapshot is refused');}}
{const t=copy(),id=doc(t).documentProofId;assert.equal(Proof.verifyRecord(t,id).ok,true);t.finance.auditArchive.records.invoices[0].counterparty='someone else';assert.equal(Proof.verifyRecord(t,id).ok,false,'the record verifies against its archived document');}

// Read only.
{const d=archived()[0];assert.throws(()=>TX.execute(state,{label:'amend-archived',apply:()=>Proof.amendDocument(state,d,{transition:'debt-balance-adjusted',mutate:row=>{row.note='x';}})}),/document-proof-archived-read-only/);
 assert.equal(allVerify(state),true,'nothing changed');}
// Authorization proofs nothing references any more are collected after 30 game days, not only past the admission limit.
{const t=copy(),A=s.GH_AUTHORIZATION,auth=A.ensure(t),record=Object.values(t.documentProofs.recordsById).find(row=>row.signedContent);
 const proof=(id,signedAtSim)=>({id,version:1,signedAtSim,signerPersonId:'P',mandateId:'M',documentIds:[],documentDigests:[]});
 record.authorizationProofId='AUTHP-QA-REF';for(const [id,at] of [['AUTHP-QA-REF',0],['AUTHP-QA-OLD',0],['AUTHP-QA-NEW',t.simSeconds+31*86400]])auth.proofsById[id]=proof(id,at);
 t.simSeconds+=31*86400;A.compact(t);
 assert.equal(auth.proofsById['AUTHP-QA-OLD'],undefined,'an unreferenced proof older than 30 days is collected');assert.ok(auth.proofsById['AUTHP-QA-NEW'],'a recent unreferenced proof stays');assert.ok(auth.proofsById['AUTHP-QA-REF'],'a referenced proof stays');}
console.log(JSON.stringify({suite:'build359-archived-proofs',archived:archived().length,recordBytes:{before:before.archived,after:after.archived},store:{before:before.store,after:after.store}},null,1));
console.log('BUILD359_ARCHIVED_PROOFS_PASS');
