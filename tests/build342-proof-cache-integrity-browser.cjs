'use strict';
// Build342 security gate. Proof caches on State Kernel views: reuse only while
// provably unchanged; every uncommitted tamper inside an open transaction must
// be rejected (section revisions advance only at commit).
const path=require('node:path'),assert=require('node:assert/strict');const repo=path.resolve(__dirname,'..');
const {chromium}=require('playwright');const {serve}=require(path.join(repo,'tests/helpers/web-server'));const {drawFounderSignature}=require(path.join(repo,'tests/helpers/signature-input'));
(async()=>{const server=await serve(path.join(repo,'WebApp'));const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:844,height:390}});page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,r=>r.abort());await page.goto(server.baseURL);await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);
if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.click('#speedToggle');
if(!await page.locator('#simCalendarPanel').isVisible())await page.locator('#simCalendarToggle').click();
await page.locator('[data-calendar-advance="7"]').click();await page.waitForFunction(()=>__GH_STATE__.simSeconds>=7*86400&&!GH_SIM_KERNEL.snapshot().manualAdvance,null,{timeout:120000});
const r=await page.evaluate(()=>{
  const S=__GH_STATE__,V=GH_SAVE_SCHEMA,K=GH_KERNEL,out={};
  out.isView=K.isStateView(S.authorization);
  const run=()=>{const res=V.validate(S,{lockVerifiedProofs:true});const m=V.telemetry().lastValidation||{};return {ok:res.ok!==false,errors:res.errors||[],proofHits:m.authorizationProofCacheHits,sealHits:m.authorizationSealCacheHits,docHits:m.documentRecordCacheHits,docVerifyHits:m.documentVerifyCacheHits,stateHits:m.proofStateCacheHits};};
  out.counts={proofs:Object.keys(S.authorization.proofsById||{}).length+Object.keys(S.authorization.proofArchiveById||{}).length,seals:Object.keys(S.authorization.visualSealAssetsById||S.authorization.signatureAssetsById||{}).length,records:Object.keys(S.documentProofs.recordsById||{}).length+Object.keys(S.documentProofs.archiveById||{}).length};
  out.first=run();out.second=run();
  const tx=GH_TRANSACTION_CORE;
  // Tamper helper: apply inside a transaction that we roll back, validate BEFORE rollback.
  const tamper=(label,fn)=>{let seen;try{tx.execute(S,{label:'qa:'+label,apply(){fn();seen=V.validate(S,{lockVerifiedProofs:false});seen.stateHits=(V.telemetry().lastValidation||{}).proofStateCacheHits;throw new Error('qa-rollback');},validate:()=>true});}catch(e){if(!/qa-rollback/.test(e.message))return {label,unexpected:e.message};}
    const after=run();return {label,tamperedOk:seen?.ok!==false,tamperedErrors:(seen?.errors||[]).slice(0,4),tamperedStateCacheHit:seen?.stateHits,afterRollbackOk:after.ok,afterRollbackProofHits:after.proofHits,afterRollbackDocHits:after.docHits};};
  const auth=S.authorization,pid=Object.keys(auth.proofsById)[0],rec=Object.keys(S.documentProofs.recordsById)[0],sealMap=auth.visualSealAssetsById||auth.signatureAssetsById,sid=Object.keys(sealMap)[0],mid=Object.keys(auth.mandatesById)[0];
  out.ids={pid,rec,sid,mid};
  const signed=GH_DOCUMENT_PROOF.stateDocumentEntries(S).filter(e=>e.document?.documentProofId);out.counts.signedDocuments=signed.length;
  const target=signed.find(e=>['amount','total','gross','net','netPay'].some(k=>typeof e.document[k]==='number'))||signed[0];
  const numericKey=['amount','total','gross','net','netPay'].find(k=>typeof target.document[k]==='number');out.docTarget={path:target.path,numericKey};
  const docAt=()=>target.path.split(/[.\[\]]/).filter(Boolean).reduce((o,k)=>o[k],S);
  out.t=[
    tamper('proof payloadDigest',()=>{auth.proofsById[pid].payloadDigest='0'.repeat(64);}),
    tamper('proof deep documentDigests[0]',()=>{auth.proofsById[pid].documentDigests[0]='1'.repeat(64);}),
    tamper('seal deep stroke point',()=>{const st=sealMap[sid].strokes[0];st[0]=Array.isArray(st[0])?[9999,9999]:{...st[0],x:9999};}),
    tamper('mandate scopes',()=>{auth.mandatesById[mid].scopes.push('qa-escalated-scope');}),
    tamper('document record signedContent',()=>{const r=S.documentProofs.recordsById[rec];r.signedContent={...r.signedContent,qaTampered:true};}),
    tamper('signed financial document value',()=>{const d=docAt();if(numericKey)d[numericKey]=d[numericKey]+1000;else d.number=String(d.number||'')+'-X';}),
    tamper('signed financial document deep issuer field',()=>{const d=docAt();d.issuerSnapshot={...d.issuerSnapshot,legalName:'QA Forged Issuer'};}),
  ];
  out.final=run();
  // Force past the whole-state cache: a write to a proof-input root (finance)
  // that touches no document changes the key, so signed documents must now be
  // served by the per-document cache while every document is still checked.
  tx.execute(S,{label:'qa:unrelated-finance-write',apply(){S.finance.qaCacheProbe=(Number(S.finance.qaCacheProbe)||0)+1;},validate:()=>true});
  out.afterUnrelated=run();
  return out;});

assert.equal(r.isView,true,'kernel owner active');
assert.equal(r.first.ok,true);assert.equal(r.second.ok,true);
assert.equal(r.first.proofHits,r.counts.proofs,'kernel-view proofs locked by the startup check must be reused');
assert.equal(r.first.docHits,r.counts.records,'kernel-view document records must be reused');
assert.equal(r.second.stateHits,1,'an unchanged state reuses the whole-state result');
for(const t of r.t){assert(!t.unexpected,t.label+': '+t.unexpected);assert.equal(t.tamperedOk,false,`TAMPER NOT DETECTED: ${t.label}`);assert.equal(t.tamperedStateCacheHit,0,`${t.label}: uncommitted edit must not reuse the state cache`);assert.equal(t.afterRollbackOk,true,`${t.label}: valid after rollback`);}
assert.equal(r.final.ok,true);
assert(r.counts.signedDocuments>0,'scenario must contain signed documents');
assert.equal(r.afterUnrelated.ok,true);
assert.equal(r.afterUnrelated.stateHits,0,'a finance write must change the whole-state key');
assert.equal(r.afterUnrelated.docVerifyHits,r.counts.signedDocuments,'unchanged signed documents are reused from the per-document cache');assert.deepEqual(errors,[]);
console.log(`PASS Build342 proof cache on kernel views: ${r.counts.proofs} proofs/${r.counts.records} records reused unchanged; ${r.counts.signedDocuments} signed documents reused unchanged; ${r.t.length}/${r.t.length} uncommitted tampers (digest, deep digest, seal stroke, mandate scope, record content, financial value, issuer) rejected; valid after rollback`);
await browser.close();process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
