'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

const {s}=harness(['clone-core','kernel-core','transaction-core','authorization-core','document-proof-core','save-schema']);
let platformChecks=0;
const sealedPlatform=Object.freeze({
  isSealed:()=>true,
  validateState:()=>{platformChecks++;return {ok:true,errors:[]};},
  ownerForLegacyAssetMode:mode=>mode
});
s.GH_COMPANY_PLATFORM=sealedPlatform;
const state=minimal();state.profile={name:'Global Holdings',founder:'Founder'};
state.assets=Array.from({length:1800},(_,i)=>({id:`A${i}`,type:'air',ownerCompanyId:'air',baseFacility:'BASE',phase:'idle',progress:0,fuel:95,condition:100}));
state.finance.invoices=Array.from({length:2500},(_,i)=>({id:`I${i}`,number:`I${i}`,amount:100,total:100,subtotal:100,tax:0,company:'group'}));
const signed=state.finance.invoices[0];
s.GH_DOCUMENT_PROOF.sealDocument(state,signed,{type:'invoice-payable',companyId:'group'});
const live=s.GH_TRANSACTION_CORE.enableKernelOwner(state),schema=s.GH_SAVE_SCHEMA;
function checked(options={lockVerifiedProofs:true}){const started=performance.now(),result=schema.validate(live,options);return {result,metric:schema.telemetry().lastValidation,ms:performance.now()-started};}
function warm(){const check=checked();assert.equal(check.result.ok,true,check.result.errors.join(','));assert.equal(check.metric.fullStateCacheHits,1,'unchanged live roots must reuse a fully verified result');return check;}
function miss(expected){const check=checked();assert.equal(check.metric.fullStateCacheHits,0,expected);assert.equal(check.result.ok,false,expected);assert(check.result.errors.includes(expected),`${expected}: ${check.result.errors.join(',')}`);}

const cold=checked();assert.equal(cold.result.ok,true,cold.result.errors.join(','));assert.equal(cold.metric.fullStateCacheHits,0);
const firstChecks=platformChecks,fast=warm();assert.equal(platformChecks,firstChecks,'full hit skips company validation');
live.saveRevision++;warm();assert.equal(platformChecks,firstChecks,'saveRevision only remains a full hit');
live.saveRevision='bad';miss('save-revision');live.saveRevision=4;warm();
live.simSeconds=-1;miss('sim-seconds');live.simSeconds=0;assert.equal(checked().result.ok,true);warm();

const rollbackCase=(label,mutate,expected)=>{
  warm();const before=JSON.stringify(live);
  assert.throws(()=>s.GH_TRANSACTION_CORE.execute(live,{label,validate:()=>true,apply(){
    mutate();miss(expected);throw new Error('injected-rollback');
  }}),/injected-rollback/);
  assert.equal(JSON.stringify(live),before,'rollback must restore every value');
  const after=checked();assert.equal(after.result.ok,true,after.result.errors.join(','));assert.equal(after.metric.fullStateCacheHits,0,'rollback must not recover the old stamp');warm();
};
rollbackCase('qa:deep-column',()=>{live.assets[1].progress=-1;},'asset-progress');
rollbackCase('qa:asset-id',()=>{live.assets[1].id=live.assets[0].id;},'asset-id');
rollbackCase('qa:unsigned-finance',()=>{live.finance.invoices[1].total=500;},'invoice-math');
rollbackCase('qa:signed-finance',()=>{live.finance.invoices[0].company='forged';},'document-proof-integrity');

live.extraSavedRoot={flag:true};assert.equal(checked().metric.fullStateCacheHits,0,'adding a root invalidates full validation');warm();
delete live.extraSavedRoot;assert.equal(checked().metric.fullStateCacheHits,0,'deleting a root invalidates full validation');warm();
live.resetEpoch++;assert.equal(checked().metric.fullStateCacheHits,0,'reset invalidates full validation');warm();
s.GH_IDENTITY={inspectPlainText:()=>({ok:false})};miss('identity-profile-name');
delete s.GH_IDENTITY;assert.equal(checked().metric.fullStateCacheHits,0,'changing the identity inspector invalidates the old result');warm();
s.GH_CONTROL_PLANE={sha256:()=> 'f'.repeat(64)};
const forgedCrypto=checked();assert.equal(forgedCrypto.metric.fullStateCacheHits,0,'changing the proof hashing owner invalidates the old result');
assert.equal(forgedCrypto.result.ok,false,'signed document must be checked against the new hashing owner');
assert(forgedCrypto.result.errors.includes('document-proof-record-integrity'),'each proof row must rehash after the provider changes');
assert.equal(forgedCrypto.metric.documentRecordCacheHits,0,'old proof record locks must not be reused after hashing changes');
delete s.GH_CONTROL_PLANE;assert.equal(checked().metric.fullStateCacheHits,0,'restoring the hashing owner requires another full check');warm();
const originalClone=s.GH_CLONE_CORE,cleanImported=JSON.parse(JSON.stringify(live));
s.GH_CLONE_CORE={...originalClone,clone(value){const out=originalClone.clone(value);if(out&&typeof out==='object'&&out.companyId==='group'&&out.legalName)out.legalName+=' forged';return out;}};
const forgedClone=checked();assert.equal(forgedClone.metric.fullStateCacheHits,0,'changing the clone owner invalidates the verified state');
assert(forgedClone.result.errors.includes('document-proof-integrity'),'the signed document must be checked with the new clone owner');
assert.equal(forgedClone.metric.documentVerifyCacheHits,0,'old per-document locks must not mask changed clone behavior');
assert(schema.validate(cleanImported).errors.includes('document-proof-integrity'),'imported save confirms the same result without caches');
s.GH_CLONE_CORE=originalClone;assert.equal(checked().metric.fullStateCacheHits,0,'restoring the clone owner requires fresh validation');warm();
const originalStructuredClone=s.structuredClone,secondImported=JSON.parse(JSON.stringify(live));
let structuredCloneForged=0;s.structuredClone=function(value){let out;try{out=originalStructuredClone(value);}catch(_error){out=originalClone.cloneFallback(value);}if(out&&typeof out==='object'&&out.companyId==='group'&&out.legalName){structuredCloneForged++;out.legalName+=' forged';}return out;};
const forgedStructuredClone=checked();assert.equal(forgedStructuredClone.metric.fullStateCacheHits,0,'changing structuredClone invalidates the verified state');
assert(structuredCloneForged>0,'the wrapped native clone must reach the signed issuer snapshot');
assert(forgedStructuredClone.result.errors.includes('document-proof-integrity'));
assert.equal(forgedStructuredClone.metric.documentVerifyCacheHits,0,'per-document locks must not hide changed structuredClone');
assert(schema.validate(secondImported).errors.includes('document-proof-integrity'),'imported save detects changed structuredClone');
s.structuredClone=originalStructuredClone;assert.equal(checked().metric.fullStateCacheHits,0,'restoring structuredClone requires fresh validation');warm();

const raw=structuredClone(state);assert.equal(schema.validate(raw,{lockVerifiedProofs:true}).ok,true);
assert.equal(schema.telemetry().lastValidation.fullStateCacheHits,0,'imported plain save is never cached');
assert.equal(schema.validate(raw,{lockVerifiedProofs:true}).ok,true);
assert.equal(schema.telemetry().lastValidation.fullStateCacheHits,0,'repeated imported plain save is still fully checked');
assert(schema.telemetry().lastValidation.documentRecordCacheHits>0,'frozen raw records still reuse individual proof checks');
const previousHashOwner=s.GH_CONTROL_PLANE;s.GH_CONTROL_PLANE={sha256:()=> 'f'.repeat(64)};
const rawProviderChange=schema.validate(raw,{lockVerifiedProofs:true});
assert(rawProviderChange.errors.includes('document-proof-record-integrity'),'new hash provider must rehash previously frozen raw records');
assert.equal(schema.telemetry().lastValidation.documentRecordCacheHits,0,'old frozen row locks must be discarded globally on verifier change');
s.GH_CONTROL_PLANE=previousHashOwner;
assert.equal(schema.validate(raw,{lockVerifiedProofs:true}).ok,true,'restored hash owner must fully reverify frozen raw records');
assert.equal(schema.telemetry().lastValidation.documentRecordCacheHits,0,'restoring the provider starts a new lock epoch');
assert.equal(schema.validate(raw,{lockVerifiedProofs:true}).ok,true);
assert(schema.telemetry().lastValidation.documentRecordCacheHits>0,'safe frozen row reuse resumes after verification');
raw.finance.invoices[1].total=999;
assert(schema.validate(raw,{lockVerifiedProofs:true}).errors.includes('invoice-math'),'tampered raw save is rejected');

const beforeUnsealed=platformChecks;s.GH_COMPANY_PLATFORM={...sealedPlatform,isSealed:()=>false};
assert.equal(checked().metric.fullStateCacheHits,0,'unsealed platform cannot reuse a prior verified result');
assert(platformChecks>beforeUnsealed);
s.GH_COMPANY_PLATFORM=sealedPlatform;
assert.equal(checked().metric.fullStateCacheHits,0,'external validator change forces a fresh check');
const runs=Array.from({length:25},()=>warm().ms).sort((a,b)=>a-b);
const p95=runs[Math.ceil(runs.length*.95)-1];
assert.equal(schema.SAVE_SCHEMA_VERSION,'2.0.0');
console.log(`PASS Build344 full Save Schema cache: 1800 assets, 2500 invoices, cold ${cold.ms.toFixed(2)}ms, first warm ${fast.ms.toFixed(2)}ms, warm p95 ${p95.toFixed(2)}ms; signed/unsigned tamper, rollback, raw import, root insert/remove, reset and external validators verified`);
