'use strict';
// Build 359, iPhone diagnostic (day 388, 30,000 assets, 13,291 documents): every player command copied the live finance
// documents (89 ms), validated every document by serializing it (32-159 ms), saved them all again (14 MB), the daily close
// copied and validated them again, a full verification of every proof ran on every tenth save, a system alert copied the
// whole state (79 ms) and each round of the archive seal deep-copied the finance root (25-31 ms). Checked here:
// 1. a final finance document (a cashed cheque, a settled invoice, an executed transfer...) is sealed at the next
//    transaction boundary, an open one is not; a durable draft shares the sealed ones and copies the open ones;
// 2. a sealed document is never amended (refused), the game's own flows still run, and a migration that rewrites one
//    (refresh-identity on a legacy document) replaces it by a copy at the same place;
// 3. a trusted validation does not serialize a sealed document it verified, and a tampered replacement is still refused;
// 4. the save codec reuses the text of sealed segments beside an open one, and its text equals the reference encoding;
// 5. the proof audit walks every proof, record, document and checkpoint period in bounded steps, finds a tampered record,
//    and skips what left the store during its cycle;
// 6. a system alert snapshots only its own roots;
// 7. a failed round of the archive seal rolls back exactly with the finance root kept by its containers.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Proof=s.GH_DOCUMENT_PROOF,Schema=s.GH_SAVE_SCHEMA,Finance=s.GH_FINANCE_CORE;
e.load('state-codec-core');const Codec=s.GH_STATE_CODEC;
state.godMoney=true;state.infiniteMoney=true;
const results=[];const test=(name,fn)=>{results.push({name,detail:fn()});console.log(`PASS ${name}`);};
const CHEQUES=600;
for(let from=0;from<CHEQUES;from+=150){const out=TX.execute(state,{label:`seal-seed-${from}`,apply:()=>{for(let i=from;i<from+150;i++){const c=e.command('finance','issue-cheque',{company:'air',amount:1000+i,beneficiary:'Supplier LLC',note:'seal',requestRef:`SEAL-${i}`});e.command('finance','settle-cheque',{id:c.id});}}});assert.equal(out.committed,true,out.reason);state.simSeconds+=3600;}
const open=[];for(let i=0;i<6;i++)open.push(e.command('finance','issue-invoice',{kind:'مصروف',amount:500+i,company:'air',counterparty:'Supplier LLC',note:`open payable ${i}`}).number);
TX.execute(state,{label:'boundary',apply:()=>{state.profile.qaBoundary=true;}});delete state.profile.qaBoundary;

test('a final document is sealed at the next boundary; an open one is not; a draft shares only the sealed',()=>{
  const cheques=state.finance.cheques,invoices=state.finance.invoices.filter(row=>open.includes(row.number));
  assert.equal(cheques.length,CHEQUES);assert.ok(cheques.every(row=>row.status==='مصروف'&&TX.isSealed(row)&&Object.isFrozen(row)),'every cashed cheque is sealed');
  assert.equal(invoices.length,open.length);assert.ok(invoices.every(row=>!TX.isSealed(row)&&!Object.isFrozen(row)),'an open payable is not');
  const transfers=state.finance.transfers.filter(row=>row.status==='منفذة');assert.ok(transfers.length>0&&transfers.every(row=>TX.isSealed(row)),'executed transfers are sealed');
  const draft=TX.deepClone(state,{shareJournaledRoots:true});
  assert.ok(draft.finance.cheques!==cheques&&draft.finance.cheques.every((row,index)=>row===cheques[index]),'the draft shares every sealed cheque (its own list)');
  const draftOpen=draft.finance.invoices.filter(row=>open.includes(row.number));
  assert.ok(draftOpen.every(row=>!invoices.includes(row))&&JSON.stringify(draftOpen)===JSON.stringify(invoices),'and copies the open payables');
  return {sealedCheques:cheques.length,openInvoices:invoices.length};
});

test('a sealed document is never amended; the flows still run; a migration replaces a sealed legacy document',()=>{
  const cheque=state.finance.cheques[0];
  assert.throws(()=>TX.execute(state,{label:'amend-final',apply:()=>Proof.amendDocument(state,cheque,{transition:'cheque-cleared',mutate:row=>{row.note='x';}})}),/document-proof-archived-read-only/);
  assert.ok(TX.isSealed(state.finance.cheques[0])&&state.finance.cheques[0]===cheque,'the cheque is unchanged');
  const number=open[0],issued=e.command('finance','issue-cheque',{company:'air',amount:500,invoiceNumber:number,requestRef:'SEAL-OPEN-0'});
  const settled=TX.execute(state,{label:'settle-open',apply:()=>e.command('finance','settle-cheque',{id:issued.id})});assert.equal(settled.committed,true,settled.reason);
  TX.execute(state,{label:'boundary-2',apply:()=>{}});
  const invoice=state.finance.invoices.find(row=>row.number===number),paid=state.finance.cheques.find(row=>row.id===issued.id);
  assert.equal(invoice.status,'مسددة');assert.ok(TX.isSealed(invoice)&&TX.isSealed(paid),'the settled payable and its cashed cheque are sealed now');
  // A legacy document (no proof), final and sealed: refresh-identity rewrites it as a copy in the same place.
  const legacy={number:'LEGACY-1',company:'air',companyName:'Old name',kind:'مصروف',amount:10,subtotal:10,tax:0,total:10,status:'مدفوعة',at:1};
  state.finance.invoices.push(legacy);TX.sealCollections(state);assert.ok(TX.isSealed(legacy));
  const at=state.finance.invoices.indexOf(legacy);e.command('finance','refresh-identity',{company:'air'});
  const replaced=state.finance.invoices[at];assert.ok(replaced!==legacy&&replaced.number==='LEGACY-1'&&replaced.companyName!=='Old name','replaced by an updated copy');
  assert.equal(legacy.companyName,'Old name','the sealed original is untouched');
  state.finance.invoices.splice(at,1);
  return {amended:'refused',legacyReplaced:true};
});

test('a trusted validation does not serialize a sealed document again; a tampered replacement is refused',()=>{
  assert.equal(Schema.validate(state).ok,true);assert.equal(Schema.validate(state,{trustVerified:true}).ok,true);
  // The context's own JSON (the scripts' realm), shadowed for this one validation.
  const json=vm.runInContext('JSON',s),original=json.stringify;let sealedSerialized=0;
  s.JSON={parse:json.parse,stringify(value,...rest){if(value&&typeof value==='object'&&TX.isSealed(value)&&value.documentProofId)sealedSerialized++;return original.call(json,value,...rest);}};
  let check;try{check=Schema.validate(state,{trustVerified:true});}finally{delete s.JSON;}
  assert.equal(vm.runInContext('JSON',s),json,'the context JSON is restored');
  assert.equal(check.ok,true);assert.equal(sealedSerialized,0,`sealed documents serialized: ${sealedSerialized}`);
  const at=5,cheque=state.finance.cheques[at],tampered={...structuredClone(cheque),amount:cheque.amount+1};state.finance.cheques[at]=tampered;
  const bad=Schema.validate(state,{trustVerified:true});state.finance.cheques[at]=cheque;
  assert.equal(bad.ok,false);assert.ok(bad.errors.includes('document-proof-integrity'),JSON.stringify(bad.errors));
  assert.equal(Schema.validate(state,{trustVerified:true}).ok,true);
  return {sealedSerialized};
});

test('the save codec reuses sealed segments beside an open one, with the reference text',()=>{
  const reference=target=>JSON.stringify(Codec.encodeState(target));
  assert.equal(Codec.serialize(state),reference(state),'first save');
  const before=Codec.cacheStats();assert.equal(Codec.serialize(state),reference(state),'unchanged save');
  const unchanged=Codec.cacheStats();assert.equal(unchanged.misses,before.misses,'nothing re-encoded');assert.ok(unchanged.layout.hits>before.layout.hits,'layouts reused');
  // One more open document: only its segment (the list's head) is encoded afresh.
  e.command('finance','issue-invoice',{kind:'مصروف',amount:77,company:'air',counterparty:'Supplier LLC',note:'one more open payable'});
  assert.equal(Codec.serialize(state),reference(state),'save after a change');
  const after=Codec.cacheStats();
  return {hits:after.hits-unchanged.hits,misses:after.misses-unchanged.misses,open:after.open-unchanged.open};
});

test('the proof audit walks everything in bounded steps, finds a tampered record and skips what left',()=>{
  const audit=Schema.createProofAudit();let steps=0,checked=0,out;
  do{out=audit.step(state,{maxItems:40});assert.equal(out.ok,true,JSON.stringify(out));assert.ok(out.checked<=40);checked+=out.checked;steps++;}while(!out.cycleDone&&steps<10000);
  const store=state.documentProofs,records=Object.keys({...(store.archiveById||{}),...store.recordsById}).length,documents=Proof.stateDocuments(state).filter(row=>row?.documentProofId).length;
  assert.ok(checked>=records+documents,`walked ${checked} items (${records} records, ${documents} documents)`);assert.ok(steps>(records+documents)/40,'in many steps');
  // A record replaced by a tampered copy is found within one cycle.
  const id=Object.keys(store.recordsById).find(key=>store.recordsById[key].signedContent),record=store.recordsById[id],copy=structuredClone(record);copy.signedContent.material.payload.__qa='tampered';store.recordsById[id]=copy;
  const finder=Schema.createProofAudit();let found=null;for(let i=0;i<10000&&!found;i++){const r=finder.step(state,{maxItems:40});if(!r.ok)found=r;if(r.cycleDone)break;}
  store.recordsById[id]=record;
  assert.ok(found&&found.errors.some(error=>/document-proof-record-integrity|document-proof-integrity/.test(error)),`found: ${JSON.stringify(found)}`);
  // A record that leaves the store after the cycle listed it (a current version no other version links to) is skipped,
  // and so is its document.
  const copyState=JSON.parse(JSON.stringify(state)),skip=Schema.createProofAudit();skip.step(copyState,{maxItems:1});
  const hot=copyState.documentProofs.recordsById,linked=new Set(Object.values({...(copyState.documentProofs.archiveById||{}),...hot}).map(row=>row.previousProofId).filter(Boolean));
  const leaving=Object.keys(hot).filter(key=>!linked.has(key)).slice(0,5);assert.equal(leaving.length,5);for(const key of leaving)delete hot[key];
  let skipOut;for(let i=0;i<10000;i++){skipOut=skip.step(copyState,{maxItems:40});if(!skipOut.ok||skipOut.cycleDone)break;}
  assert.equal(skipOut.ok,true,JSON.stringify(skipOut.errors));
  return {steps,checked};
});

test('a system alert snapshots only its own roots',()=>{
  const out=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'operations','record-alert',{id:'QA-ALERT',text:'QA alert',type:'operation'},{actor:'system-ui-notification'});
  assert.equal(out?.ok,true);const last=TX.telemetry().last;
  assert.equal(last.label,'operations:record-alert');assert.equal(last.fullSnapshot,false,'no copy of the whole state');assert.ok(last.scopeSize<=6,`scope ${last.scopeSize}`);
  assert.equal(state.alerts[0],'QA alert');
  return {scopeSize:last.scopeSize,rollbackStorage:last.rollbackStorage};
});

test('a failed round of the archive seal rolls back exactly, the finance root kept by its containers',()=>{
  const {harness,minimal}=require(path.join(ROOT,'tests/helpers/core-harness'));
  const h=harness(['save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core','finance-core']),c=h.s,P=c.GH_DOCUMENT_PROOF,T=c.GH_TRANSACTION_CORE;
  const w=minimal();w.profile={name:'Seal rollback',founder:'Founder'};c.GH_FINANCE_CORE.ensure(w);w.finance.auditArchive={records:{invoices:[]},digests:[]};
  const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),start=app.indexOf('  function financeAuditArchive()'),end=app.indexOf('  function normalizeSimulationClocks()',start);
  Object.assign(c,{state:w,clone:x=>x===undefined?undefined:JSON.parse(JSON.stringify(x)),companyFinanceTypes:()=>[],companyBook:()=>null});
  vm.runInContext(app.slice(start,end)+'\nglobalThis.sealApi={auditSealSelection,liveProofIds,sealAuditRound};',c);
  T.execute(w,{label:'old',apply:()=>{for(let i=0;i<300;i++){const d={id:`INV-${i}`,number:`INV-${i}`,company:'group',counterparty:'Customer',amount:10,total:10,status:'محصلة',at:i*600};P.sealDocument(w,d,{type:'audit-invoice',companyId:'group'});w.finance.auditArchive.records.invoices.push(JSON.parse(JSON.stringify(d)));}}});
  w.simSeconds=400*86400;const before=JSON.stringify(w),api=c.sealApi,entry={queue:api.auditSealSelection(),keep:api.liveProofIds()};assert.ok(entry.queue.length>0);
  const real=c.buildAuditDigest;c.buildAuditDigest=()=>{throw new Error('qa-late-failure');};
  try{assert.throws(()=>api.sealAuditRound(entry),/qa-late-failure/);}finally{c.buildAuditDigest=real;}
  assert.equal(JSON.stringify(w),before,'the round rolled back exactly');
  const telemetry=T.telemetry().last;assert.equal(telemetry.label,'audit-archive-seal');assert.equal(telemetry.fullSnapshot,false);
  const queue={queue:api.auditSealSelection(),keep:api.liveProofIds()};let sealed=0;while(queue.queue.length)sealed+=api.sealAuditRound(queue);
  assert.ok(sealed>0);assert.equal(c.GH_SAVE_SCHEMA.validate(JSON.parse(JSON.stringify(w))).ok,true);
  return {sealed};
});

console.log(JSON.stringify({suite:'build359-document-seal',results},null,1));
console.log('BUILD359_DOCUMENT_SEAL_PASS');
