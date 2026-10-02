'use strict';
// Build 358 heaviness contracts (proof stores, validation, amendments).
const assert=require('node:assert/strict'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Proof=s.GH_DOCUMENT_PROOF,Schema=s.GH_SAVE_SCHEMA;
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e7;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e7;const item=e.item;
for(let order=0;order<4;order++){
  const qty=5+order,total=item.price*qty;
  const out=TX.execute(state,{label:`heaviness-seed-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{const r=e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty,manual:true,requestRef:`HEAVY-${order}`,upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});s.GH_REALISM.onSimulationTime(state,state.simSeconds);return r;})});
  assert.equal(out.committed,true);
}
const documents=Proof.stateDocuments(state).filter(row=>row?.documentProofId);
assert.ok(documents.length>=4,`the purchases sign documents (${documents.length})`);
assert.equal(Schema.validate(state).ok,true,'seeded state validates in full');

// 1. Verification never writes below the top level of the proof stores: freeze everything below it.
{
  const frozen=new WeakSet();
  const freeze=value=>{if(!value||typeof value!=='object'||frozen.has(value))return;frozen.add(value);for(const child of Object.values(value))freeze(child);Object.freeze(value);};
  const snapshot=JSON.stringify({authorization:state.authorization,documentProofs:state.documentProofs});
  const thawed={authorization:state.authorization,documentProofs:state.documentProofs};
  if(thawed.authorization)state.authorization={...thawed.authorization};state.documentProofs={...thawed.documentProofs};
  for(const root of [state.authorization,state.documentProofs])if(root)for(const child of Object.values(root))freeze(child);
  const full=Schema.validate(state),trusted=Schema.validate(state,{trustVerified:true});
  assert.equal(full.ok,true,`full validation with frozen proof data: ${full.errors}`);
  assert.equal(trusted.ok,true,`trusted validation with frozen proof data: ${trusted.errors}`);
  assert.equal(JSON.stringify({authorization:state.authorization,documentProofs:state.documentProofs}),snapshot,'validation wrote nothing');
  if(thawed.authorization)state.authorization=structuredClone(thawed.authorization);state.documentProofs=structuredClone(thawed.documentProofs);
  assert.equal(Schema.validate(state).ok,true);
}

// 2. The verified-documents ledger never hides an edit: a trusted pass re-verifies any changed document.
{
  assert.equal(Schema.validate(state,{trustVerified:true}).ok,true,'warm ledger');
  const document=documents.find(row=>Number(row.amount??row.total)>0)||documents[0],field=document.amount!==undefined?'amount':'total',original=document[field];
  document[field]=Number(original)+1;
  const tampered=Schema.validate(state,{trustVerified:true});
  assert.equal(tampered.ok,false,'a tampered signed document fails trusted validation');assert.ok(tampered.errors.includes('document-proof-integrity'));
  document[field]=original;
  assert.equal(Schema.validate(state,{trustVerified:true}).ok,true,'restored document validates again');
  const status=document.status;document.status=`${status||'open'}-edited`;
  const statusEdit=Schema.validate(state,{trustVerified:true}),fullAfter=Schema.validate(state);
  assert.equal(statusEdit.ok,fullAfter.ok,'a trusted pass and a full pass agree after an in-place edit');
  document.status=status;
}

// 3. A failed amendment restores the proof store exactly (shallow snapshot, records shared).
{
  const document=documents.find(row=>Proof.verifyDocument(state,row).ok&&Proof.record(state,row.documentProofId)?.version===3&&row.documentType==='invoice-payable')||null;
  if(document){
    const before=JSON.stringify(state.documentProofs),records=Object.values(state.documentProofs.recordsById),docBefore=JSON.stringify(document);
    assert.throws(()=>Proof.amendDocument(state,document,{transition:'invoice-payable-settled',mutate:doc=>{doc.status='settled';throw new Error('heaviness-amend-failure');}}),/heaviness-amend-failure/);
    assert.equal(JSON.stringify(state.documentProofs),before,'proof store restored exactly');
    assert.equal(JSON.stringify(document),docBefore,'document restored exactly');
    assert.ok(records.every(record=>state.documentProofs.recordsById[record.id]===record),'records are kept, not copied');
  }else{
    const value={...structuredClone(state)},sealedDoc={id:'HEAVY-AMEND',number:'HEAVY-AMEND',company:'group',counterparty:'Counterparty',amount:10,status:'open'};
    Proof.sealDocument(value,sealedDoc,{type:'invoice-payable',companyId:'group'});
    const before=JSON.stringify(value.documentProofs);
    assert.throws(()=>Proof.amendDocument(value,sealedDoc,{transition:'invoice-payable-settled',mutate:doc=>{doc.status='settled';throw new Error('heaviness-amend-failure');}}),/heaviness-amend-failure/);
    assert.equal(JSON.stringify(value.documentProofs),before,'proof store restored exactly');
  }
  assert.equal(Schema.validate(state).ok,true);
}
// 4. Sealed rows: durable drafts share them with the live state; nothing can write through them.
(async()=>{
  const {harness,minimal}=require(path.join(ROOT,'tests/helpers/core-harness'));
  const h=harness(['save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core']),a=h.s,st=minimal();
  st.profile={name:'Heavy Holdings',founder:'Heavy Founder'};
  const Auth=a.GH_AUTHORIZATION,AT=a.GH_TRANSACTION_CORE,AP=a.GH_DOCUMENT_PROOF,AV=a.GH_SAVE_SCHEMA,commands=a.GH_DOMAIN_COMMANDS;
  Auth.ensurePrincipal(st,{id:'founder',legalName:'Heavy Founder'});Auth.createVisualSeal(st,{ownerPersonId:'founder',strokes:[[{x:.1,y:.2},{x:.55,y:.65},{x:.9,y:.3}]]});
  Auth.createDefaultMandate(st,{principalId:'founder',companyIds:['*'],scopes:['heavy.*']});Auth.registerCommandTargetResolver('heavy',()=>['group']);
  const invoice=(id,amount)=>({id,company:'group',counterparty:'Heavy Counterparty',amount,subtotal:amount,tax:0,total:amount,currency:'USD',issuedAt:st.simSeconds,note:'Heavy document'});
  commands.register('heavy',{execute(ctx,name,payload){
    if(name==='post'){const document=invoice(`HEAVY-${payload.n}`,payload.amount);AP.sealDocument(ctx.state,document,{type:'audit-invoice',companyId:'group'});ctx.state.finance.invoices.unshift(document);return {document};}
    if(name==='approve')return {document:ctx.state.finance.invoices.find(row=>row.id===payload.id)};
    throw new Error('unknown-heavy-command');}});
  const envelope=(name,payload,key)=>Auth.buildActiveEnvelope(st,{domain:'heavy',name,payload,idempotencyKey:key,actor:{principalId:'founder'}});
  for(let n=1;n<=3;n++)assert.equal(commands.dispatchEnvelope({state:st},envelope('post',{n,amount:100+n},`HEAVY-POST-${n}`)).ok,true);
  // a document sealed without approval, approved later: binding a sealed record replaces it instead of editing it
  const pending=invoice('HEAVY-PENDING',77);AP.sealDocument(st,pending,{type:'audit-invoice',companyId:'group'});st.finance.invoices.unshift(pending);
  assert.equal(AV.validate(st).ok,true,'authorized state validates');
  const sealedNow=AT.sealCollections(st),pendingRecord=AP.record(st,pending.documentProofId);
  assert.ok(sealedNow>0&&AT.isSealed(pendingRecord)&&Object.isFrozen(pendingRecord.signedContent),'records are sealed deep');
  assert.ok(Object.values(st.authorization.proofsById).every(row=>AT.isSealed(row)),'authorization proofs are sealed');
  assert.ok(Object.values(st.domainRuntime.idempotency).every(row=>AT.isSealed(row)),'idempotency rows are sealed');
  const approved=commands.dispatchEnvelope({state:st},envelope('approve',{id:'HEAVY-PENDING'},'HEAVY-APPROVE'));
  const rebound=AP.record(st,pending.documentProofId);
  assert.equal(approved.ok,true);assert.notEqual(rebound,pendingRecord,'the sealed record was replaced');assert.equal(rebound.authorizationProofId,approved.authorizationProofId);
  assert.ok(!pendingRecord.authorizationProofId,'the sealed original is unchanged');assert.equal(rebound.signedContent,pendingRecord.signedContent,'its sealed content is shared');
  assert.equal(AP.verifyDocument(st,pending).ok,true);assert.equal(AV.validate(st).ok,true,'bound state validates');
  AT.sealCollections(st);
  const records=st.documentProofs.recordsById,record=Object.values(records).find(row=>row.authorizationProofId),proof=st.authorization.proofsById[record.authorizationProofId];
  const persist=()=>({ok:true}),json=()=>JSON.stringify(st);
  // a write through a shared row inside a durable command throws; the live state is untouched
  let before=json(),revision=st.saveRevision;
  await assert.rejects(AT.executeDurable(st,{label:'heaviness-sealed-write',integrity:false,persist,apply:draft=>{
    assert.notEqual(draft.documentProofs,st.documentProofs);assert.notEqual(draft.documentProofs.recordsById,records,'the collection is copied');
    assert.equal(draft.documentProofs.recordsById[record.id],record,'its rows are shared');assert.equal(draft.authorization.proofsById[proof.id],proof);
    draft.documentProofs.recordsById[record.id].documentId='EDITED';}}),TypeError);
  assert.equal(json(),before,'a failed durable command leaves the live state exactly as it was');assert.equal(st.saveRevision,revision);
  // a committed durable command adds, drops and reorders rows; publishing adopts the draft rows by identity
  const keys=Object.keys(st.domainRuntime.idempotency),probeKey='["heaviness","probe","K"]';
  const out=await AT.executeDurable(st,{label:'heaviness-sealed-publish',integrity:false,persist,apply:draft=>{
    const table=draft.domainRuntime.idempotency,row=table[keys[0]];delete table[keys[0]];table[keys[0]]=row;
    table[probeKey]={...row,at:Number(draft.simSeconds)||0};return true;}});
  assert.equal(out.committed,true);
  const table=st.domainRuntime.idempotency;assert.ok(table[probeKey],'the new row is published');assert.deepEqual(Object.keys(table),[...keys.slice(1),keys[0],probeKey],'key order follows the draft');
  for(const key of keys)assert.ok(AT.isSealed(table[key]),'published rows stay sealed and shared');
  delete table[probeKey];
  // a synchronous full-snapshot rollback over sealed rows restores the state exactly (sealed targets are adopted, not written)
  before=json();
  assert.throws(()=>AT.execute(st,{label:'heaviness-sealed-rollback',apply:()=>{const proofs=st.authorization.proofsById,row=proofs[proof.id];delete proofs[proof.id];proofs[proof.id]=row;st.documentProofs.recordsById={...records,[record.id]:{...record,documentId:'GONE'}};throw new Error('heaviness-rollback');}}),/heaviness-rollback/);
  assert.equal(json(),before,'rollback restored every sealed collection');
  // a full pass still checks the relations of sealed rows, and catches a replaced (edited) record
  delete st.authorization.proofsById[proof.id];
  let full=AV.validate(st);assert.equal(full.ok,false,'a missing proof fails the full pass');assert.ok(full.errors.includes('document-proof-record'),String(full.errors));
  st.authorization.proofsById[proof.id]=proof;assert.equal(AV.validate(st).ok,true,'and the full pass is clean again');
  // (a full-snapshot rollback restores values, not the identity of a replaced container: read the store again)
  const liveRecords=st.documentProofs.recordsById,edited=structuredClone(record);edited.signedContent.issuedAtSim=Number(edited.signedContent.issuedAtSim||0)+1;liveRecords[record.id]=edited;
  full=AV.validate(st);assert.equal(full.ok,false,'an edited copy fails the full pass');assert.equal(AV.validate(st,{trustVerified:true}).ok,false,'and the trusted pass');
  liveRecords[record.id]=record;assert.equal(AV.validate(st).ok,true);
  // 5. The codec reuses the encoded text of an unchanged sealed collection; the save text is byte-for-byte the same.
  const c=harness(['transaction-core','document-proof-core','domain-command-core','state-codec-core']),C=c.s.GH_STATE_CODEC,CT=c.s.GH_TRANSACTION_CORE;
  const row=n=>({id:`R${n}`,documentId:`D${n}`,signedContent:{material:{payload:{amount:n,lines:[{sku:'A',qty:n%3}]}},issuer:{name:'Heavy'}},note:n%5?null:'five'});
  const big={saveRevision:1,documentProofs:{schema:'gh-document-proofs-v1',recordsById:Object.fromEntries(Array.from({length:180},(_,n)=>[`R${n}`,row(n)]))},domainRuntime:{idempotency:Object.fromEntries(Array.from({length:90},(_,n)=>[`K${n}`,{at:n,fingerprint:'f',result:{ok:true,n}}]))},finance:{invoices:Array.from({length:70},(_,n)=>({id:`I${n}`,amount:n}))}};
  const reference=()=>JSON.stringify(C.encodeState(big));
  assert.equal(C.serialize(big),reference(),'unsealed: identical');
  assert.ok(CT.sealCollections(big)>=270);
  const first=C.serialize(big),hits0=C.cacheStats().hits;assert.equal(first,reference(),'first sealed save: identical');
  assert.equal(C.serialize(big),reference(),'cached save: identical');assert.equal(C.cacheStats().hits-hits0,2,'both sealed collections were reused');
  big.documentProofs.recordsById.R999=row(999);big.finance.invoices[0].amount=-1;
  assert.equal(C.serialize(big),reference(),'after an insertion and an unsealed edit: identical');
  delete big.domainRuntime.idempotency.K3;big.domainRuntime.idempotency.K3={at:3,fingerprint:'f',result:{ok:true,n:3}};
  assert.equal(C.serialize(big),reference(),'after a replaced and reordered row: identical');
  assert.equal(JSON.stringify(C.deserialize(C.serialize(big))),JSON.stringify(big),'round trip');
  console.log(JSON.stringify({suite:'build358-heaviness',documents:documents.length,records:Object.keys(state.documentProofs.recordsById).length,sealedRows:sealedNow,passed:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
