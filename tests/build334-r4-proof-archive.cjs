'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {harness,minimal,ROOT}=require('./helpers/core-harness');
const {s}=harness(['save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core','finance-core']);
const P=s.GH_DOCUMENT_PROOF,A=s.GH_AUTHORIZATION,T=s.GH_TRANSACTION_CORE,rows=[];
function test(name,fn){try{fn();rows.push({name,ok:true});}catch(e){rows.push({name,ok:false,error:String(e.stack||e).slice(0,5000)});}}
function state(){const v=minimal();v.profile={name:'Retained history',founder:'Founder'};s.GH_FINANCE_CORE.ensure(v);v.finance.auditArchive={records:{invoices:[]},digests:[]};return v;}
function invoice(v,id){const d={id,number:id,company:'group',counterparty:'Customer / عميل',amount:1,status:'محصلة'};P.sealDocument(v,d,{type:'audit-invoice',companyId:'group'});return d;}
const v=state();
test('6001 genuine retained documents admit new work without increasing active count',()=>{
 for(let i=0;i<6001;i++){const d=invoice(v,`REAL-${i}`);v.finance.auditArchive.records.invoices.push(d);}
 assert.equal(P.records(v).length,6001);assert(Object.keys(v.documentProofs.recordsById).length<=5000);
 assert(Object.keys(v.documentProofs.archiveById).length>=1000);
 assert(P.verifyDocument(v,v.finance.auditArchive.records.invoices[0]).ok);
 assert(P.verifyDocument(v,v.finance.auditArchive.records.invoices.at(-1)).ok);
});
test('complete schema and proof verification after actual JSON save/restore',()=>{
 const reloaded=JSON.parse(JSON.stringify(v)),out=s.GH_SAVE_SCHEMA.validate(reloaded);
 assert(out.ok,JSON.stringify(out.errors));assert(P.verifyDocument(reloaded,reloaded.finance.auditArchive.records.invoices[0]).ok);
});
test('active and cold residency cannot duplicate or hide a modified proof',()=>{
 const saved=JSON.parse(JSON.stringify(v)),id=Object.keys(saved.documentProofs.archiveById)[0];
 saved.documentProofs.recordsById[id]=structuredClone(saved.documentProofs.archiveById[id]);
 assert.equal(P.verifyRecord(saved,id).ok,false);const out=s.GH_SAVE_SCHEMA.validate(saved);assert.equal(out.ok,false);assert(out.errors.includes('document-proof-residency-conflict'));
});
test('cold record tampering is rejected rather than treated as an opaque summary',()=>{
 const saved=JSON.parse(JSON.stringify(v)),id=Object.keys(saved.documentProofs.archiveById)[0];saved.documentProofs.archiveById[id].signedContent.amount=987;
 assert.equal(P.verifyRecord(saved,id).ok,false);assert.equal(s.GH_SAVE_SCHEMA.validate(saved).ok,false);
});
test('amendment of a cold predecessor retains and verifies its full chain',()=>{
 const d=v.finance.auditArchive.records.invoices[0],prior=d.documentProofId;assert(v.documentProofs.archiveById[prior]);
 T.execute(v,{label:'amend-history',apply:()=>P.amendDocument(v,d,{transition:'invoice-collected',mutate:x=>{x.collectedAt=12;}})});
 assert(P.record(v,prior));assert(P.verifyDocument(v,d).ok);assert(P.verifyDocument(JSON.parse(JSON.stringify(v)),structuredClone(d)).ok);
});
test('garbage collection retains referenced cold ancestors and removes only unreferenced records',()=>{
 const saved=JSON.parse(JSON.stringify(v)),first=saved.finance.auditArchive.records.invoices[0];
 const unreferenced=invoice(saved,'UNREFERENCED');const id=unreferenced.documentProofId;
 saved.documentProofs.archiveById[id]=saved.documentProofs.recordsById[id];delete saved.documentProofs.recordsById[id];
 P.compact(saved,0);assert.equal(P.record(saved,id),null);assert(P.verifyDocument(saved,first).ok);
});
test('finite byte-capacity failure cannot publish half of a financial transaction',()=>{
 const saved=JSON.parse(JSON.stringify(v));saved.documentProofs.archiveById.BYTE_CAP_SENTINEL={id:'BYTE_CAP_SENTINEL',padding:'x'.repeat(P.LIMITS.archiveBytes)};
 // An otherwise referenced archive fixture forces admission capacity; the
 // sentinel is an injected size-boundary fault, NOT a valid historical proof.
 saved.finance.auditArchive.records.invoices.push({documentProofId:'BYTE_CAP_SENTINEL'});
 while(Object.keys(saved.documentProofs.recordsById).length<5000){saved.finance.invoices.push(invoice(saved,`FILL-${saved.documentProofs.sequence}`));}
 const before=JSON.stringify(saved);assert.throws(()=>T.execute(saved,{label:'bounded-capacity',apply:()=>{saved.cash-=77;saved.finance.invoices.push(invoice(saved,'MUST-ROLLBACK'));}}),/archive-byte-limit/);
 assert.equal(JSON.stringify(saved),before);
});
test('archiveTrim retains full signed documents beyond the old 12000-summary limit',()=>{
 const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),start=app.indexOf('  function financeAuditArchive()'),end=app.indexOf('  function normalizeSimulationClocks()',start),small=state();
 Object.assign(s,{state:small,clone:x=>x===undefined?undefined:JSON.parse(JSON.stringify(x)),companyFinanceTypes:()=>[],companyBook:()=>null});
 vm.runInContext(app.slice(start,end)+'\nglobalThis.trimR4=archiveTrim;',s);
 const signed=invoice(small,'SIGNATURE-PRESERVED');small.finance.auditArchive.records.invoices=[...Array.from({length:12000},(_,i)=>({id:'U-'+i,amount:1})),signed];
 small.finance.invoices=[invoice(small,'NEW-SIGNED-ROW')];s.trimR4(small.finance.invoices,0,'invoices');
 assert(small.finance.auditArchive.records.invoices.some(d=>d.documentProofId===signed.documentProofId));assert(P.verifyDocument(small,signed).ok);
});
const av=state();let ctx;
test('4101 actual authorization proofs survive admission and existing mandates/seals remain valid',()=>{
 A.ensurePrincipal(av,{id:'founder',legalName:'Founder'});A.createVisualSeal(av,{ownerPersonId:'founder',strokes:[[{x:.1,y:.2},{x:.55,y:.65},{x:.9,y:.3}]]});A.createDefaultMandate(av,{principalId:'founder',companyIds:['*'],scopes:['audit.*']});A.registerCommandTargetResolver('audit',()=>['group']);
 ctx=A.authorize(av,A.buildActiveEnvelope(av,{domain:'audit',name:'post',payload:{amount:1},idempotencyKey:'AUTH-HISTORY',actor:{principalId:'founder'}}));
 av.domainRuntime={commands:[],idempotency:{}};
 for(let i=0;i<4101;i++){const proof=A.issueProof(av,ctx,{commandId:'AUTH-'+i});av.domainRuntime.idempotency['AUTH-'+i]={permanent:true,result:{authorizationProofId:proof.id}};}
 assert.equal(A.proofRecords(av).length,4101);assert(Object.keys(av.authorization.proofsById).length<=4000);assert(A.verifyProof(av,'APR-000000001').ok);assert(A.verifyProof(av,'APR-000004101').ok);
 const restored=JSON.parse(JSON.stringify(av));assert(A.verifyProof(restored,'APR-000000001').ok);
});
test('authorization duplicate residency and corrupted archived digest fail closed',()=>{
 const copy=JSON.parse(JSON.stringify(av)),id=Object.keys(copy.authorization.proofArchiveById)[0];copy.authorization.proofsById[id]=structuredClone(copy.authorization.proofArchiveById[id]);assert.equal(A.verifyProof(copy,id).ok,false);assert(s.GH_SAVE_SCHEMA.validate(copy).errors.includes('authorization-proof-residency-conflict'));delete copy.authorization.proofsById[id];copy.authorization.proofArchiveById[id].proofDigest='0'.repeat(64);assert.equal(A.verifyProof(copy,id).ok,false);
});
test('late failure after an archive transition rolls back maps, counters, cash and documents',()=>{
 const copy=JSON.parse(JSON.stringify(v));while(Object.keys(copy.documentProofs.recordsById).length<5000)copy.finance.invoices.push(invoice(copy,`LATE-${copy.documentProofs.sequence}`));
 const before=JSON.stringify(copy);assert.throws(()=>T.execute(copy,{label:'late-after-spill',apply:()=>{copy.cash-=1;copy.finance.invoices.push(invoice(copy,'ROLLBACK-SPILL'));throw Error('late-fault');}}),/late-fault/);assert.deepEqual(JSON.parse(JSON.stringify(copy)),JSON.parse(before));
 const good=invoice(copy,'RETRY-AFTER-ROLLBACK');copy.finance.invoices.push(good);assert(P.verifyDocument(copy,good).ok);
});
console.log(JSON.stringify({suite:'R4 archived admission, finite byte limits and rollback',cases:rows,passed:rows.filter(x=>x.ok).length,total:rows.length,deviceTest:false,documentJSONBytes:Buffer.byteLength(JSON.stringify(v))},null,2));if(rows.some(x=>!x.ok))process.exitCode=1;
