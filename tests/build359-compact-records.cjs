'use strict';
// Build 359 (owner: the live proof records 80% smaller). A document's record is issued in the compact form
// (compact-document-v1): the fields the chain, authorization and residency checks read, its issue time and the digest of
// its signature snapshot. The signed content, the issuer and counterparty snapshots and the chain object (it repeats
// the link fields) are not kept: verifying the document rebuilds its signed content and compares the record's digest.
// Checked here:
// 1. on a business game (purchases, invoices, cheques issued and settled) every current record is compact and at most
//    a fifth of the whole record earlier builds wrote for the same document;
// 2. every document verifies: directly, in full and trusted validation, in the proof audit, after the save codec;
// 3. tampering is refused: a record's issue time, link fields or digest, a chain object or signed content added, the
//    document's content or issuer snapshot; a trusted validation verifies a replaced record against its document;
// 4. an amendment rebuilds the earlier version whole: in the hot window it replaces the compact record; in the archive
//    it stands in supersededById until the checkpoint pass makes it a checkpoint, or folds it into the archive when
//    another copy of the document still carries it; an amendment rolled back (by itself, by its transaction, or while
//    admission moves the hot window) leaves the proof store exactly as it was;
// 5. the schema refuses an overlay entry without its archive copy, or one also in the hot window;
// 6. a bound record keeps the digest of the document's signature snapshot; an edited snapshot is refused;
// 7. records of an earlier build (whole) take the compact form in maintenance passes that each read a bounded number
//    of documents; a pass rolled back leaves them whole; a bound one keeps its signature digest;
// 8. an orphan compact record verifies alone and is collected when nothing links to it;
// 9. forensics name the field a ledger copy changed, from the canonical document;
// 10. the app runs the conversion as its own maintenance task.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario')),{harness,minimal}=require(path.join(ROOT,'tests/helpers/core-harness'));
const {wholeRecord,legacyLiveRecords}=require(path.join(ROOT,'tests/helpers/legacy-proof-records'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Proof=s.GH_DOCUMENT_PROOF,Schema=s.GH_SAVE_SCHEMA;
e.load('state-codec-core');const Codec=s.GH_STATE_CODEC;
const results=[];const test=(name,fn)=>{results.push({name,detail:fn()});console.log(`PASS ${name}`);};
const bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8'),copy=value=>JSON.parse(JSON.stringify(value));
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e9;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e9;const item=e.item;
for(let order=0;order<60;order++){
  state.simSeconds+=1800;const total=item.price;
  const out=TX.execute(state,{label:`compact-seed-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty:1,manual:true,requestRef:`CR-${order}`,upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true}))});
  assert.equal(out.committed,true);
}
for(let i=0;i<30;i++){
  state.simSeconds+=3600;const open=e.command('finance','issue-invoice',{kind:'مصروف',amount:1000+i,company:'air',counterparty:'Supplier LLC',note:`QA payable ${i}`});
  const cheque=e.command('finance','issue-cheque',{company:'air',amount:1000+i,invoiceNumber:open.number,requestRef:`QA-COMPACT-${i}`});
  if(i%2)assert.equal(TX.execute(state,{label:`compact-settle-${i}`,apply:()=>e.command('finance','settle-cheque',{id:cheque.id})}).committed,true);
}
const documents=(target=state)=>Proof.stateDocuments(target).filter(row=>row?.documentProofId);
const recordOf=(target,id)=>target.documentProofs.recordsById[id]||target.documentProofs.archiveById?.[id];
const auditCycle=target=>{const audit=Schema.createProofAudit();let out;do{out=audit.step(target,{maxItems:400});if(!out.ok)return out;}while(!out.cycleDone);return out;};

test('records are issued compact, at most a fifth of the whole records of earlier builds',()=>{
  let whole=0,compact=0;const kinds={};
  for(const document of documents()){
    const record=Proof.record(state,document.documentProofId);assert.equal(record.form,Proof.COMPACT_FORM);
    for(const field of ['signedContent','issuerSnapshot','counterpartySnapshot','signatureSnapshot','chain'])assert.equal(Object.prototype.hasOwnProperty.call(record,field),false,`no ${field}`);
    const w=bytes(wholeRecord(Proof,document,record)),c=bytes(record),kind=`${record.documentType}${record.chainDepth?'+chain':''}`;whole+=w;compact+=c;
    const row=kinds[kind]||(kinds[kind]={records:0,whole:0,compact:0});row.records++;row.whole+=w;row.compact+=c;
  }
  assert.ok(compact<=whole*.2,`compact records ${compact} bytes of whole ${whole}`);
  for(const [kind,row] of Object.entries(kinds))assert.ok(row.compact<=row.whole*.21,`${kind}: ${row.compact} of ${row.whole}`);
  return {records:documents().length,whole,compact,ratio:+(compact/whole).toFixed(3),kinds:Object.fromEntries(Object.entries(kinds).map(([kind,row])=>[kind,{records:row.records,ratio:+(row.compact/row.whole).toFixed(3)}]))};
});

test('every document verifies: directly, full and trusted validation, the proof audit, the save codec',()=>{
  assert.ok(documents().every(document=>Proof.verifyDocument(state,document).ok===true));
  TX.sealCollections(state);
  assert.equal(Schema.validate(state).ok,true,'full validation');assert.equal(Schema.validate(state,{trustVerified:true}).ok,true,'trusted validation');
  assert.equal(auditCycle(state).ok,true,'the proof audit');
  const back=Codec.deserialize(Codec.serialize(state));assert.equal(Schema.validate(back).ok,true,'a reloaded save validates');
  assert.ok(documents(back).every(document=>Proof.verifyDocument(back,document).ok===true),'and its documents verify');
  return {documents:documents().length};
});

test('tampering is refused, and a trusted validation verifies a replaced record against its document',()=>{
  const all=documents(),root=all.find(d=>Proof.record(state,d.documentProofId).chainDepth===0),chained=all.find(d=>Proof.record(state,d.documentProofId).chainDepth>0);assert.ok(root&&chained);
  const refused=(name,edit)=>{const t=copy(state);edit(t);const v=Schema.validate(t);assert.equal(v.ok,false,`${name} is refused`);return v.errors.join(',');};
  const docIn=(t,d)=>Proof.locateDocument(t,d.documentProofId);
  const errors={
    issueTime:refused('a changed issue time',t=>{recordOf(t,root.documentProofId).issuedAtSim+=1;}),
    transition:refused('a changed transition',t=>{const r=recordOf(t,chained.documentProofId);r.transition=Proof.TRANSITIONS.find(x=>x!==r.transition);}),
    previousDigest:refused('a changed link digest',t=>{recordOf(t,chained.documentProofId).previousContentDigest='0'.repeat(64);}),
    depth:refused('a changed depth',t=>{recordOf(t,chained.documentProofId).chainDepth+=1;}),
    digest:refused('a changed content digest',t=>{recordOf(t,root.documentProofId).contentDigest='0'.repeat(64);}),
    chainObject:refused('a chain object added',t=>{const r=recordOf(t,chained.documentProofId);r.chain={previousProofId:r.previousProofId,previousContentDigest:r.previousContentDigest,transition:r.transition,depth:r.chainDepth};}),
    signedContent:refused('signed content added',t=>{recordOf(t,root.documentProofId).signedContent={};}),
    amount:refused('a changed document amount',t=>{const d=docIn(t,root);d.amount=Number(d.amount||0)+1;}),
    issuer:refused('a changed issuer snapshot',t=>{docIn(t,root).issuerSnapshot.legalName='Someone else';})
  };
  // Trusted: the live state's verified ledger knows the document's text; the replaced record is verified against it.
  const id=root.documentProofId,hot=state.documentProofs.recordsById,original=hot[id];assert.ok(original,'a hot record');
  assert.equal(Schema.validate(state,{trustVerified:true}).ok,true);
  hot[id]={...original,issuedAtSim:original.issuedAtSim+1};const trusted=Schema.validate(state,{trustVerified:true});hot[id]=original;
  assert.equal(trusted.ok,false,'a replaced record with the same digest and another issue time is refused');assert.equal(Schema.validate(state,{trustVerified:true}).ok,true,'restored');
  return errors;
});

test('an amendment rebuilds the earlier version whole in the hot window; the checkpoint pass takes it',()=>{
  while(Proof.checkpointAncestors(state).checkpointed){}
  state.simSeconds+=3600;const open=e.command('finance','issue-invoice',{kind:'مصروف',amount:4321,company:'air',counterparty:'Supplier LLC',note:'QA hot amendment'});
  const invoice=()=>state.finance.invoices.find(row=>row.number===open.number),first=Proof.record(state,invoice().documentProofId);assert.equal(first.form,Proof.COMPACT_FORM);
  e.command('finance','issue-cheque',{company:'air',amount:4321,invoiceNumber:open.number,requestRef:'QA-COMPACT-HOT'});
  const current=Proof.record(state,invoice().documentProofId),earlier=Proof.record(state,first.id);
  assert.notEqual(current.id,first.id,'the invoice was amended');assert.equal(current.form,Proof.COMPACT_FORM);assert.equal(current.previousProofId,first.id);
  assert.ok(earlier.signedContent&&earlier.form===undefined,'the earlier version is whole');assert.equal(state.documentProofs.recordsById[first.id],earlier,'in the hot window');
  assert.equal(earlier.contentDigest,first.contentDigest);assert.equal(Proof.verifyRecord(state,first.id).ok,true);assert.equal(Proof.verifyDocument(state,invoice()).ok,true);
  assert.equal(Proof.checkpointAncestors(state).checkpointed>=1,true);assert.ok(Proof.checkpoint(state,first.id),'it becomes a checkpoint');assert.equal(state.documentProofs.recordsById[first.id],undefined);
  assert.equal(Proof.verifyDocument(state,invoice()).ok,true);assert.equal(Schema.validate(state).ok,true);
  return {earlier:first.id,current:current.id};
});

// As admission does: a hot record moves to the archive (a new version of the sealed container).
const toArchive=id=>{const store=state.documentProofs,record=store.recordsById[id],hot={...store.recordsById};delete hot[id];const cold={...(store.archiveById||{}),[id]:record};if(store.archiveById)TX.deriveContainer(cold,store.archiveById,{changed:[id]});store.archiveById=cold;store.recordsById=hot;};
const openCheque=(amount,ref)=>{state.simSeconds+=3600;const open=e.command('finance','issue-invoice',{kind:'مصروف',amount,company:'air',counterparty:'Supplier LLC',note:`QA ${ref}`});return e.command('finance','issue-cheque',{company:'air',amount,invoiceNumber:open.number,requestRef:ref});};
const chequeDoc=id=>state.finance.cheques.find(row=>row.id===id);

test('an amendment of a document whose record is archived keeps the earlier version in supersededById until the checkpoint pass',()=>{
  const cheque=openCheque(5432,'QA-COMPACT-COLD'),first=chequeDoc(cheque.id).documentProofId;toArchive(first);TX.sealCollections(state);
  assert.equal(state.documentProofs.archiveById[first].form,Proof.COMPACT_FORM);assert.equal(Schema.validate(state).ok,true);
  const archiveBefore=state.documentProofs.archiveById;
  assert.equal(TX.execute(state,{label:'compact-cold-settle',apply:()=>e.command('finance','settle-cheque',{id:cheque.id})}).committed,true);
  const store=state.documentProofs,whole=store.supersededById?.[first];
  assert.ok(whole?.signedContent,'the earlier version stands whole in supersededById');assert.equal(store.archiveById,archiveBefore,'the archive is not copied by the command');
  assert.equal(store.archiveById[first].form,Proof.COMPACT_FORM,'its compact copy stays in the archive');assert.equal(Proof.record(state,first),whole,'reads find the whole version');
  assert.equal(Proof.records(state).filter(row=>row.id===first).length,1,'listed once');
  TX.sealCollections(state);assert.equal(Schema.validate(state).ok,true,'full validation');assert.equal(Schema.validate(state,{trustVerified:true}).ok,true,'trusted validation');
  assert.equal(auditCycle(state).ok,true,'the proof audit');
  const back=Codec.deserialize(Codec.serialize(state));assert.ok(back.documentProofs.supersededById?.[first]?.signedContent,'the save keeps it');assert.equal(Schema.validate(back).ok,true,'and validates');
  {const t=copy(state);t.documentProofs.supersededById[first].signedContent.issuedAtSim+=1;assert.equal(Schema.validate(t).ok,false,'a tampered overlay entry is refused');assert.equal(auditCycle(t).ok,false,'the proof audit finds it');}
  while(Proof.checkpointAncestors(state).checkpointed){}
  assert.ok(Proof.checkpoint(state,first),'the checkpoint pass makes it a checkpoint');assert.equal(state.documentProofs.supersededById,undefined,'the overlay empties');assert.equal(state.documentProofs.archiveById[first],undefined,'and the archive copy leaves');
  assert.equal(Proof.verifyDocument(state,chequeDoc(cheque.id)).ok,true);assert.equal(Schema.validate(state).ok,true);
  return {earlier:first};
});

test('an earlier version another copy still carries folds into the archive whole',()=>{
  const cheque=openCheque(6543,'QA-COMPACT-FOLD'),first=chequeDoc(cheque.id).documentProofId,stale=copy(chequeDoc(cheque.id));toArchive(first);TX.sealCollections(state);
  assert.equal(TX.execute(state,{label:'compact-fold-settle',apply:()=>e.command('finance','settle-cheque',{id:cheque.id})}).committed,true);
  assert.ok(state.documentProofs.supersededById?.[first]);state.finance.transfers.push(stale);
  Proof.checkpointAncestors(state);
  assert.equal(Proof.checkpoint(state,first),null,'a version a document carries stays a record');assert.equal(state.documentProofs.supersededById,undefined,'the overlay empties');
  assert.ok(state.documentProofs.archiveById[first]?.signedContent,'the archive holds it whole');assert.equal(Proof.verifyDocument(state,stale).ok,true,'the copy verifies');
  TX.sealCollections(state);assert.equal(Schema.validate(state).ok,true);
  // A pass leaves a pinned version out; the sweep (every 24th pass lists every record) takes it once no copy carries it.
  state.finance.transfers.splice(state.finance.transfers.indexOf(stale),1);for(let pass=0;pass<24;pass++)Proof.checkpointAncestors(state);
  assert.ok(Proof.checkpoint(state,first),'once no copy carries it, the sweep makes it a checkpoint');assert.equal(Schema.validate(state).ok,true);
  return {earlier:first};
});

test('an amendment rolled back leaves the proof store exactly as it was (hot, archived, and while admission moves records)',()=>{
  const out={},attempt=(name,target,document)=>{
    const before=JSON.stringify(target.documentProofs);
    assert.throws(()=>Proof.amendDocument(target,document,{transition:'cheque-cleared',mutate:()=>{throw new Error('qa-mutator');}}),/qa-mutator/);
    assert.equal(JSON.stringify(target.documentProofs),before,`${name}: a failed mutator`);
    assert.throws(()=>TX.execute(target,{label:`compact-rollback-${name}`,apply:()=>{Proof.amendDocument(target,document,{transition:'cheque-cleared',mutate:row=>{row.note=`${row.note} (changed)`;}});throw new Error('qa-after-amend');}}),/qa-after-amend/);
    assert.equal(JSON.stringify(target.documentProofs),before,`${name}: a failed transaction`);assert.equal(target.documentProofs.supersededById,undefined);out[name]=true;
  };
  const hot=openCheque(7654,'QA-COMPACT-RB-HOT');attempt('hot',state,chequeDoc(hot.id));
  const cold=openCheque(8765,'QA-COMPACT-RB-COLD');toArchive(chequeDoc(cold.id).documentProofId);TX.sealCollections(state);attempt('archived',state,chequeDoc(cold.id));
  assert.equal(Schema.validate(state).ok,true);
  // Admission: a hot window at its limit moves the oldest 200 records (the amended one among them) while the record is issued.
  const a=harness(['save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core','finance-core']),P=a.s.GH_DOCUMENT_PROOF,T=a.s.GH_TRANSACTION_CORE;
  const v=minimal();v.profile={name:'Admission',founder:'Founder'};a.s.GH_FINANCE_CORE.ensure(v);
  // Admission is checked every 64 issues (ADMISSION_STRIDE): the issue after 4,992 records checks and moves 200.
  const issued=Math.ceil((P.LIMITS.records-64)/64)*64,invoices=[];for(let i=0;i<issued;i++){const d={id:`ADM-${i}`,number:`ADM-${i}`,company:'group',counterparty:'Customer',amount:1,total:1,status:'مستحقة'};P.sealDocument(v,d,{type:'audit-invoice',companyId:'group'});invoices.push(d);}
  v.finance.invoices=invoices;const target=invoices[0],first=target.documentProofId;
  const before=JSON.stringify(v.documentProofs),probe=structuredClone(v);
  assert.throws(()=>T.execute(v,{label:'admission-rollback',apply:()=>{P.amendDocument(v,target,{transition:'invoice-collected',mutate:row=>{row.status='محصلة';row.collectedAt=1;}});assert.ok(v.documentProofs.supersededById?.[first]?.signedContent,'admission archived the record: it stands whole in supersededById');throw new Error('qa-admission');}}),/qa-admission/);
  assert.equal(JSON.stringify(v.documentProofs),before,'admission: a failed transaction');
  // The same amendment committed (on a copy): the earlier version is whole in supersededById, the archive holds the 200.
  const committed=P.amendDocument(probe,probe.finance.invoices[0],{transition:'invoice-collected',mutate:row=>{row.status='محصلة';row.collectedAt=1;}});
  assert.ok(probe.documentProofs.supersededById[first].signedContent&&probe.documentProofs.archiveById[first].form===P.COMPACT_FORM);assert.equal(Object.keys(probe.documentProofs.archiveById).length,200,'admission moved 200 records');
  assert.equal(P.verifyDocument(probe,probe.finance.invoices[0]).ok,true);assert.equal(a.s.GH_SAVE_SCHEMA.validate(probe).ok,true,'and the store validates');
  return {...out,admission:true,admitted:Object.keys(probe.documentProofs.archiveById).length,record:committed.record.id};
});

test('the schema refuses an overlay entry without its archive copy, or one also in the hot window',()=>{
  const cheque=openCheque(9876,'QA-COMPACT-OVERLAY'),first=chequeDoc(cheque.id).documentProofId;toArchive(first);
  assert.equal(TX.execute(state,{label:'compact-overlay-settle',apply:()=>e.command('finance','settle-cheque',{id:cheque.id})}).committed,true);TX.sealCollections(state);
  const t1=copy(state);delete t1.documentProofs.archiveById[first];const v1=Schema.validate(t1);assert.equal(v1.ok,false);assert.ok(v1.errors.includes('document-proof-residency-conflict'),v1.errors.join(','));
  const t2=copy(state),hotId=Object.keys(t2.documentProofs.recordsById)[0];t2.documentProofs.supersededById[hotId]=t2.documentProofs.recordsById[hotId];const v2=Schema.validate(t2);assert.equal(v2.ok,false);assert.ok(v2.errors.includes('document-proof-residency-conflict'),v2.errors.join(','));
  assert.equal(Schema.validate(state).ok,true);while(Proof.checkpointAncestors(state).checkpointed){}assert.equal(state.documentProofs.supersededById,undefined);
  return {missingArchive:v1.errors,alsoHot:v2.errors};
});

test('an orphan compact record verifies alone and is collected when nothing links to it',()=>{
  state.simSeconds+=3600;const open=e.command('finance','issue-invoice',{kind:'مصروف',amount:2468,company:'air',counterparty:'Supplier LLC',note:'QA orphan'});
  const at=state.finance.invoices.findIndex(row=>row.number===open.number),document=state.finance.invoices[at],id=document.documentProofId;
  state.finance.invoices.splice(at,1);state.finance.payables=(state.finance.payables||[]).filter(row=>row.number!==open.number);
  assert.equal(Proof.verifyRecord(state,id).ok,true,'the record alone verifies (shape, link, authorization)');
  Proof.compact(state,0);assert.equal(Proof.record(state,id),null,'collected');
  assert.ok(documents().every(d=>Proof.verifyDocument(state,d).ok===true));assert.equal(Schema.validate(state).ok,true);
  return {collected:id};
});

test('forensics name the field a ledger copy changed, from the canonical document',()=>{
  const t=copy(state),document=t.finance.invoices.find(row=>row.documentProofId&&Proof.record(t,row.documentProofId)?.form===Proof.COMPACT_FORM);
  t.treasury.ledger=[{...structuredClone(document),note:`${document.note} (ledger copy)`}];
  const latent=Proof.forensicInspectStateProofs(t).documentFailures.find(row=>row.role==='latent-ledger');
  assert.ok(latent);assert.equal(latent.reason,'document-content-tampered');assert.equal(latent.differencePath,'$.material.payload.note');
  return {differencePath:latent.differencePath};
});

// Signed documents: binding an authorization proof to a compact record.
function signed(){
  const h=harness(['save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core']),{s:x}=h,v=minimal();v.profile={name:'Compact Holdings',founder:'Compact Founder'};
  const Auth=x.GH_AUTHORIZATION;Auth.ensurePrincipal(v,{id:'founder',legalName:'Compact Founder'});Auth.createVisualSeal(v,{ownerPersonId:'founder',strokes:[[{x:.1,y:.2},{x:.55,y:.65},{x:.9,y:.3}]]});
  Auth.createDefaultMandate(v,{principalId:'founder',companyIds:['*'],scopes:['audit.*']});Auth.registerCommandTargetResolver('audit',()=>['group']);
  x.GH_DOMAIN_COMMANDS.register('audit',{execute(ctx,name,payload){ctx.state.auditCount=(ctx.state.auditCount||0)+1;
    const document={id:`AUD-${ctx.state.auditCount}`,company:'group',counterparty:payload.counterparty,amount:payload.amount,subtotal:payload.amount,tax:0,total:payload.amount,currency:'USD',issuedAt:ctx.state.simSeconds,note:'Compact signed document'};
    x.GH_DOCUMENT_PROOF.sealDocument(ctx.state,document,{type:'audit-invoice',companyId:'group'});ctx.state.finance.invoices.unshift(document);return {document};}});
  for(let i=0;i<12;i++){const envelope=Auth.buildActiveEnvelope(v,{domain:'audit',name:'post',payload:{amount:100+i,counterparty:`Party ${i%5}`},idempotencyKey:`COMPACT-SIGNED-${i}`,actor:{principalId:'founder'}});assert.equal(x.GH_DOMAIN_COMMANDS.dispatchEnvelope({state:v},envelope).ok,true);}
  return {x,v,P:x.GH_DOCUMENT_PROOF,V:x.GH_SAVE_SCHEMA,T:x.GH_TRANSACTION_CORE};
}

test('a bound record keeps the digest of the signature snapshot; an edited snapshot is refused',()=>{
  const {v,P,V,x}=signed(),document=v.finance.invoices[0],record=P.record(v,document.documentProofId);
  assert.equal(record.form,P.COMPACT_FORM);assert.ok(record.authorizationProofId&&document.signatureSnapshot,'bound');
  assert.equal(record.signatureDigest,x.GH_AUTHORIZATION.digest(x.GH_AUTHORIZATION.stable(document.signatureSnapshot)),'the digest of the document\'s signature snapshot');
  assert.equal(V.validate(v).ok,true);
  const t=copy(v);t.finance.invoices[0].signatureSnapshot.signerNameSnapshot='Someone else';
  assert.equal(P.verifyDocument(t,t.finance.invoices[0]).reason,'document-signature-snapshot-mismatch');assert.equal(V.validate(t).ok,false);
  const u=copy(v);u.documentProofs.recordsById[document.documentProofId].signatureDigest='0'.repeat(64);assert.equal(V.validate(u).ok,false,'an edited signature digest is refused');
  return {signatureDigest:record.signatureDigest.slice(0,12)};
});

test('records of an earlier build take the compact form in bounded maintenance passes; a pass rolled back leaves them whole',()=>{
  // The business game as a save of an earlier build: every live document's current record whole.
  const legacy=legacyLiveRecords(Proof,state);assert.ok(legacy.length>100,`whole records (${legacy.length})`);
  const wholeBytes=legacy.reduce((n,id)=>n+bytes(Proof.record(state,id)),0);
  assert.equal(Schema.validate(state).ok,true,'the earlier build\'s records validate');
  const storeBefore=JSON.stringify(state.documentProofs);
  assert.throws(()=>TX.execute(state,{label:'compact-live-rollback',apply:()=>{assert.ok(Proof.compactLiveRecords(state,{limit:20}).compacted>0);throw new Error('qa-live');}}),/qa-live/);
  assert.equal(JSON.stringify(state.documentProofs),storeBefore,'a pass rolled back leaves the records as they were');assert.ok(legacy.every(id=>Proof.record(state,id).signedContent));
  let passes=0,converted=0;
  for(;;){const out=Proof.compactLiveRecords(state,{limit:20,scan:50});assert.ok(out.read<=50&&out.compacted<=20,JSON.stringify(out));passes++;converted+=out.compacted;if(legacy.every(id=>Proof.record(state,id).form===Proof.COMPACT_FORM))break;assert.ok(passes<10000);}
  assert.equal(converted,legacy.length,'each whole record converted once');
  const compactBytes=legacy.reduce((n,id)=>n+bytes(Proof.record(state,id)),0);assert.ok(compactBytes<=wholeBytes*.2,`${compactBytes} of ${wholeBytes}`);
  assert.equal(Proof.compactLiveRecords(state,{scan:100000}).compacted,0,'nothing left to convert');
  assert.ok(documents().every(d=>Proof.verifyDocument(state,d).ok===true));TX.sealCollections(state);
  assert.equal(Schema.validate(state).ok,true);assert.equal(Schema.validate(state,{trustVerified:true}).ok,true);
  // A bound record of an earlier build keeps its signature snapshot's digest.
  const {v,P,V}=signed(),bound=v.finance.invoices[0].documentProofId,digestBefore=P.record(v,bound).signatureDigest;
  legacyLiveRecords(P,v);assert.ok(P.record(v,bound).signatureSnapshot);assert.equal(V.validate(v).ok,true);
  while(P.compactLiveRecords(v).compacted){}
  assert.equal(P.record(v,bound).form,P.COMPACT_FORM);assert.equal(P.record(v,bound).signatureDigest,digestBefore);assert.equal(V.validate(v).ok,true);
  return {records:legacy.length,passes,wholeBytes,compactBytes,ratio:+(compactBytes/wholeBytes).toFixed(3)};
});

test('the app converts them in its own maintenance task',()=>{
  const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
  assert.match(app,/MAINTENANCE_TASKS=Object\.freeze\(\[[^\]]*'proof-live'/);
  assert.match(app,/if\(entry\.task==='proof-live'\)\{const out=compactLiveProofs\(\);/);
  assert.match(app,/proofMaintenancePass\('proof-live-records',\(\)=>\(\{compacted:proofs\.compactLiveRecords\(state,\{limit:LIVE_PROOF_ROUND\}\)/);
  return {task:'proof-live'};
});

console.log(JSON.stringify({suite:'build359-compact-records',results},null,1));
console.log('BUILD359_COMPACT_RECORDS_PASS');
