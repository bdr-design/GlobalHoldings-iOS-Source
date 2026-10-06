'use strict';
// Build 359, iPhone diagnostic (day 347): the daily close failed twenty times with authorization-proof-archive-byte-limit
// and the game could not pass midnight. Archived authorization proofs were never collected: every document in the
// finance audit archive still referenced its proof. Checked here:
// - an archived document takes the v2 form: its authorization proof's digest, recorded when that proof verified;
// - a v1 archived record is upgraded the same way; the proof can then leave (GH_AUTHORIZATION.compact drops proofs only
//   released references need) and every document still verifies, also through the save schema;
// - while the proof is held it must match the recorded digest; tampering is refused (digest, shape, form, a released
//   reference whose digest is not a digest, a v2 record without a proof id carrying a digest);
// - a full archive no longer stops a command: proofs stay hot (up to 6,000) and the pressure is recorded.
const assert=require('node:assert/strict'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Proof=s.GH_DOCUMENT_PROOF,A=s.GH_AUTHORIZATION,Schema=s.GH_SAVE_SCHEMA;
const results=[];const test=(name,fn)=>{try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error?.stack||error).slice(0,1500)});}};
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e9;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e9;const item=e.item;
for(let order=0;order<40;order++){
  state.simSeconds+=1800;
  const out=TX.execute(state,{label:`release-seed-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty:1,manual:true,requestRef:`RL-${order}`,upfront:item.price,totalPrice:item.price,paymentMethod:'cash',documentLeadDays:0})),validate:()=>true});
  assert.equal(out.committed,true);
}
// Authorize every live document with its own proof (as a durable command does).
A.ensurePrincipal(state,{id:'founder',legalName:'Founder'});A.createVisualSeal(state,{ownerPersonId:'founder',strokes:[[{x:.1,y:.2},{x:.55,y:.65},{x:.9,y:.3}]]});A.createDefaultMandate(state,{principalId:'founder',companyIds:['*'],scopes:['audit.*']});A.registerCommandTargetResolver('audit',()=>['group']);
const ctx=A.authorize(state,A.buildActiveEnvelope(state,{domain:'audit',name:'post',payload:{amount:1},idempotencyKey:'REL-CTX',actor:{principalId:'founder'}}));
const documents=()=>Proof.stateDocuments(state).filter(row=>row?.documentProofId);
let bound=0;for(const document of documents()){const record=Proof.record(state,document.documentProofId);if(!record||record.authorizationProofId||Proof.releasesAuthorization(record))continue;
  const proof=A.issueProof(state,ctx,{commandId:`REL-${document.documentProofId}`,documentIds:[record.documentId],documentDigests:[record.contentDigest]});Proof.bindAuthorization(state,[{document,proofId:document.documentProofId}],proof);bound++;}
assert.ok(bound>=20,`documents authorized (${bound})`);
// Archive the settled documents (the daily compaction's move).
const open=new Set([...(state.finance.payables||[]),...(state.finance.receivables||[])].map(row=>String(row?.number||'')));
const archive=state.finance.auditArchive=state.finance.auditArchive||{records:{},digests:[]};archive.records=archive.records||{};
for(const kind of ['invoices','transfers']){const live=state.finance[kind]||[],moving=live.filter(row=>row?.documentProofId&&row.authorizationProofId&&!open.has(String(row?.number||''))&&['مدفوعة','مسددة','محصلة','منفذة'].includes(row?.status)).slice(0,40);
  archive.records[kind]=[...(archive.records[kind]||[]),...moving.map(row=>JSON.parse(JSON.stringify(row)))];state.finance[kind]=live.filter(row=>!moving.includes(row));}
const archivedDocs=()=>Object.entries(state.finance.auditArchive.records).flatMap(([kind,rows])=>kind.startsWith('companyLedger-')?[]:rows).filter(row=>row?.documentProofId&&row.authorizationProofId);
assert.ok(archivedDocs().length>=10,`authorized documents archived (${archivedDocs().length})`);
const allVerify=st=>Proof.stateDocuments(st).filter(row=>row?.documentProofId).every(d=>Proof.verifyDocument(st,d).ok===true);
assert.ok(allVerify(state),'every document verifies before');

test('archived documents take the v2 form with the authorization digest',()=>{
  const out=Proof.compactArchivedRecords(state,{limit:500});assert.ok(out.compacted>=archivedDocs().length,`converted ${out.compacted}`);
  for(const doc of archivedDocs()){const record=Proof.record(state,doc.documentProofId);assert.equal(record.form,'archived-document-v2');assert.equal(record.authorizationDigest,A.proofRecords(state).find(p=>p.id===record.authorizationProofId).proofDigest);}
  assert.ok(allVerify(state),'every document verifies');return {converted:out.compacted};
});

test('a v1 archived record is upgraded',()=>{
  const doc=archivedDocs()[0],store=state.documentProofs,record=Proof.record(state,doc.documentProofId),v1={...record,form:'archived-document-v1'};delete v1.authorizationDigest;
  const hot=store.recordsById[record.id]===record;if(hot)store.recordsById={...store.recordsById,[record.id]:v1};else store.archiveById={...store.archiveById,[record.id]:v1};
  assert.equal(Proof.verifyDocument(state,doc).ok,true,'the v1 record verifies');Proof.compactArchivedRecords(state,{limit:500});
  assert.equal(Proof.record(state,doc.documentProofId).form,'archived-document-v2','upgraded');return {id:record.id};
});

test('released proofs leave and documents still verify (schema too)',()=>{
  const ids=new Set(archivedDocs().map(d=>Proof.record(state,d.documentProofId).authorizationProofId));
  // Move the proofs to the authorization archive, then compact: nothing else references them.
  const auth=state.authorization,next={...(auth.proofArchiveById||{})},hot={...auth.proofsById};for(const id of ids){if(hot[id]){next[id]=hot[id];delete hot[id];}}auth.proofArchiveById=next;auth.proofsById=hot;
  for(const id of ids)delete state.domainRuntime?.idempotency?.[id];
  A.compact(state);const left=[...ids].filter(id=>auth.proofArchiveById[id]||auth.proofsById[id]);
  assert.equal(left.length,0,`released proofs are collected (${left.length} left)`);
  assert.ok(allVerify(state),'every document verifies without its proof');
  const v=Schema.validate(state);assert.ok(!v.errors.includes('document-proof-record'),`schema accepts released references (${v.errors.slice(0,4)})`);
  return {released:ids.size};
});

test('tampering is refused',()=>{
  const doc=archivedDocs()[1],record=Proof.record(state,doc.documentProofId),store=state.documentProofs,where=store.recordsById[record.id]===record?'recordsById':'archiveById';
  const tamper=(change,expect)=>{const copy=JSON.parse(JSON.stringify(state)),row=copy.documentProofs[where][record.id];change(row,copy);const d=Proof.stateDocuments(copy).find(x=>x.documentProofId===doc.documentProofId);const out=Proof.verifyDocument(copy,d);assert.equal(out.ok,false,`${expect}: refused`);return out.reason;};
  const reasons=[
    tamper(row=>{row.authorizationDigest='zz';},'non-digest'),
    tamper(row=>{row.form='archived-document-v1';},'form downgraded with the extra field'),
    tamper(row=>{row.form='archived-document-v1';delete row.authorizationDigest;},'v1 without its proof'),
    tamper(row=>{row.authorizationProofId=null;},'proof id removed with a digest kept'),
    tamper((row,copy)=>{copy.authorization.proofsById[row.authorizationProofId]={...structuredClone(A.proofRecords(state).find(p=>p.id===record.authorizationProofId)||{id:row.authorizationProofId}),proofDigest:'0'.repeat(64)};},'a held proof that does not match the digest'),
    tamper(row=>{row.contentDigest='0'.repeat(64);},'content digest')
  ];
  return {reasons};
});

test('a full archive no longer stops a command',()=>{
  const copy=JSON.parse(JSON.stringify(state)),auth=copy.authorization,filler='x'.repeat(4096);
  auth.proofArchiveById={...auth.proofArchiveById};for(let i=0;i<2100;i++)auth.proofArchiveById[`APR-FILL-${i}`]={id:`APR-FILL-${i}`,pad:filler,signedAtSim:0};
  copy.domainRuntime=copy.domainRuntime||{};copy.domainRuntime.idempotency=copy.domainRuntime.idempotency||{};for(let i=0;i<2100;i++)copy.domainRuntime.idempotency[`F-${i}`]={permanent:true,result:{authorizationProofId:`APR-FILL-${i}`}};
  const ctx2=A.authorize(copy,A.buildActiveEnvelope(copy,{domain:'audit',name:'post',payload:{amount:2},idempotencyKey:'REL-FULL',actor:{principalId:'founder'}}));
  const hotBefore=Object.keys(auth.proofsById).length;for(let i=hotBefore;i<4000;i++){const p=A.issueProof(copy,ctx2,{commandId:`H-${i}`});copy.domainRuntime.idempotency[`H-${i}`]={permanent:true,result:{authorizationProofId:p.id}};}
  let issued=0;for(let i=0;i<50;i++){const p=A.issueProof(copy,ctx2,{commandId:`OVER-${i}`});copy.domainRuntime.idempotency[`OVER-${i}`]={permanent:true,result:{authorizationProofId:p.id}};issued++;}
  assert.equal(issued,50,'proofs are still issued');assert.ok(auth.archivePressure&&auth.archivePressure.bytes>A.LIMITS.archiveBytes,'the archive pressure is recorded');
  assert.ok(Object.keys(auth.proofsById).length>4000&&Object.keys(auth.proofsById).length<=A.LIMITS.hardProofs,'they stay hot within the hard limit');
  return {hot:Object.keys(auth.proofsById).length};
});

const passed=results.filter(r=>r.ok).length;console.log(JSON.stringify({suite:'build359-authorization-release',passed,total:results.length,results},null,1));
if(passed!==results.length)process.exitCode=1;else console.log('BUILD359_AUTHORIZATION_RELEASE_PASS');
