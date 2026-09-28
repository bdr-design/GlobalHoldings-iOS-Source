'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

const {s}=harness(['clone-core','kernel-core','transaction-core','authorization-core','document-proof-core','save-schema']);
// The application seals the company registry before ordinary saves. Keep the
// fixture on the same trusted path without replacing the kernel verifier:
// swapping a verifier must itself invalidate every cached proof result.
s.GH_COMPANY_PLATFORM=Object.freeze({isSealed:()=>true,validateState:()=>({ok:true,errors:[]})});
const state=minimal();state.profile={name:'Global Holdings',founder:'Founder'};
for(let i=0;i<1000;i++){
  const id=`RELOCK-${i}`,document={id,number:id,company:'group',counterparty:'Supplier',amount:125,subtotal:125,tax:0,total:125,status:'open'};
  s.GH_DOCUMENT_PROOF.sealDocument(state,document,{type:'invoice-payable',companyId:'group'});
  state.finance.invoices.push(document);
}
const live=s.GH_TRANSACTION_CORE.enableKernelOwner(state);
let result=s.GH_SAVE_SCHEMA.validate(live,{lockVerifiedProofs:true});
assert.equal(result.ok,true,`initial check: ${result.errors.join(',')}`);

live.saveRevision++;
result=s.GH_SAVE_SCHEMA.validate(live,{lockVerifiedProofs:true});
assert.equal(result.ok,true,`warm check: ${result.errors.join(',')}`);
const warm=s.GH_SAVE_SCHEMA.telemetry().lastValidation;
assert.equal(warm.fullStateCacheHits,1,'a verified whole-state hit skips 1000 unchanged signed documents');
assert.equal(warm.proofStateCacheHits,1);
assert.equal(warm.documentCollectionMs,0);
assert.equal(warm.documentRecordVerifyMs,0);
assert.equal(warm.documentVerifyMs,0);

assert.throws(()=>s.GH_TRANSACTION_CORE.execute(live,{label:'proof-hit-tamper',validate:()=>true,apply(){
  live.finance.invoices[500].counterparty='Forged Supplier';
  result=s.GH_SAVE_SCHEMA.validate(live,{lockVerifiedProofs:true});
  assert.equal(result.ok,false,'uncommitted tampering must fail integrity validation');
  assert.ok(result.errors.includes('document-proof-integrity'));
  assert.equal(s.GH_SAVE_SCHEMA.telemetry().lastValidation.fullStateCacheHits,0);
  assert.equal(s.GH_SAVE_SCHEMA.telemetry().lastValidation.proofStateCacheHits,0);
  throw new Error('test-rollback');
}}),/test-rollback/);
result=s.GH_SAVE_SCHEMA.validate(live,{lockVerifiedProofs:true});
assert.equal(result.ok,true,`rollback check: ${result.errors.join(',')}`);
assert.equal(s.GH_SAVE_SCHEMA.telemetry().lastValidation.proofStateCacheHits,0,'rollback must force a fresh verification');
assert.equal(s.GH_SAVE_SCHEMA.validate(live,{lockVerifiedProofs:true}).ok,true);
assert.equal(s.GH_SAVE_SCHEMA.telemetry().lastValidation.fullStateCacheHits,1,'the first successful post-rollback check restores safe reuse');

const imported=JSON.parse(JSON.stringify(live));
imported.finance.invoices[500].counterparty='Forged Supplier';
result=s.GH_SAVE_SCHEMA.validate(imported);
assert.ok(result.errors.includes('document-proof-integrity'),'an imported plain save must recompute signed-document integrity');
console.log('PASS Build343 proof hit: 1000 signed documents skipped on verified full-state hit; tamper, rollback, and import integrity remain enforced');
