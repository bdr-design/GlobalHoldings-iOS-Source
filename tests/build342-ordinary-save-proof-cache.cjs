'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {harness,minimal}=require('./helpers/core-harness');

function setup(){
  const h=harness(['clone-core','kernel-core','transaction-core','authorization-core','document-proof-core','save-schema','persistence-core']);
  const {s}=h,state=minimal();state.profile={name:'Global Holdings',founder:'Founder'};
  const document={id:'B342-SAVE-PAYABLE',number:'B342-SAVE-PAYABLE',company:'group',counterparty:'Supplier',amount:125,subtotal:125,tax:0,total:125,status:'open'};
  s.GH_DOCUMENT_PROOF.sealDocument(state,document,{type:'invoice-payable',companyId:'group'});
  state.finance.invoices.push(document);
  s.GH_CONTROL_PLANE={sha256:text=>crypto.createHash('sha256').update(text).digest('hex')};
  let generation=0;const messages=[];
  s.webkit={messageHandlers:{saveBridge:{postMessage(envelope){
    messages.push(envelope);
    queueMicrotask(()=>s.GH_PERSISTENCE.receiveAck({...envelope,success:true,generation:++generation}));
  }}}};
  return {...h,state,document,messages};
}

async function ordinary(h,state){
  const {s}=h,result=s.GH_PERSISTENCE.commitState(state,{storageKey:'ordinary-proof-cache-test'});
  const validation=s.GH_SAVE_SCHEMA.telemetry().lastValidation;
  assert.equal(result.ok,true,result.reason);
  assert.equal((await result.native).ok,true,'Native must acknowledge the exact saved JSON');
  await s.GH_PERSISTENCE.drain();
  return {result,validation};
}

(async()=>{
  const h=setup(),{s}=h,live=s.GH_TRANSACTION_CORE.enableKernelOwner(h.state),P=s.GH_PERSISTENCE;
  const first=await ordinary(h,live);
  assert.equal(first.validation.proofStateCacheHits,0,'first ordinary save verifies the proofs');
  const second=await ordinary(h,live);
  assert.equal(second.validation.proofStateCacheHits,1,'a saveRevision-only increment must reuse unchanged signed proofs');
  assert.equal(second.validation.authorizationMs,0);
  assert.equal(second.validation.documentProofMs,0);
  assert.equal(h.messages.length,2);
  assert.equal(h.messages[1].saveRevision,h.messages[0].saveRevision+1);
  assert.equal(JSON.parse(h.messages[1].saveJSON).saveRevision,live.saveRevision);

  const baseline=JSON.stringify(live),original=live.finance.invoices[0].counterparty,originalRevision=live.saveRevision;
  assert.throws(()=>s.GH_TRANSACTION_CORE.execute(live,{label:'test:ordinary-save-uncommitted-tamper',validate:()=>true,apply(){
    live.finance.invoices[0].counterparty='Forged Supplier';
    const refused=P.commitState(live,{storageKey:'ordinary-proof-cache-test'});
    assert.equal(refused.ok,false,'the ordinary save must reject uncommitted signed-document tampering');
    assert.match(refused.reason,/document-proof-integrity/);
    assert.equal(s.GH_SAVE_SCHEMA.telemetry().lastValidation.proofStateCacheHits,0,'an uncommitted proof input write invalidates the cache');
    throw new Error('intentional-rollback');
  }}),/intentional-rollback/);
  assert.equal(JSON.stringify(live),baseline,'the transaction restores the exact pre-tamper state');
  assert.equal(live.finance.invoices[0].counterparty,original);
  assert.equal(live.saveRevision,originalRevision);
  assert.equal(h.messages.length,2,'a rejected ordinary save does not reach the Native Vault');
  const recovered=await ordinary(h,live);
  assert.equal(recovered.validation.proofStateCacheHits,0,'rollback changes the mutation stamp and forces a fresh proof check');
  assert.equal((await ordinary(h,live)).validation.proofStateCacheHits,1);

  live.resetEpoch=live.resetEpoch+1;
  assert.equal((await ordinary(h,live)).validation.proofStateCacheHits,0,'a reset epoch change invalidates proof reuse');

  const raw=setup(),plain=raw.state,proof=plain.documentProofs.recordsById[raw.document.documentProofId];
  assert.equal((await ordinary(raw,plain)).validation.proofStateCacheHits,0);
  assert.equal((await ordinary(raw,plain)).validation.proofStateCacheHits,0,'plain state has no kernel-backed proof cache');
  assert.equal(Object.isFrozen(proof),false,'ordinary saving of raw state does not freeze its proofs');
  assert.equal(raw.s.GH_SAVE_SCHEMA.SAVE_SCHEMA_VERSION,'2.0.0');
  const [cold,warm]=h.s.GH_PERSISTENCE.telemetry().timings.samples.filter(row=>row.kind==='ordinary-save');
  console.log(`PASS ordinary-save proof cache: unchanged kernel proof reused across revisions; in-transaction tamper rejected; rollback and reset force recheck; raw state remains mutable; Node one-document fixture schemaMs=${cold.schemaMs.toFixed(2)}/${warm.schemaMs.toFixed(2)}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
