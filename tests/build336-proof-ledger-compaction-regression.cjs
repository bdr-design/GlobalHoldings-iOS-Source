'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {harness,minimal,ROOT} = require('./helpers/core-harness');

function environment(){
  const {s}=harness(['save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core','finance-core']);
  const state=minimal();
  state.profile={name:'Build336 Proof Regression',founder:'Founder'};
  s.GH_FINANCE_CORE.ensure(state);
  const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
  const start=app.indexOf('  function financeAuditArchive()');
  const end=app.indexOf('  function normalizeSimulationClocks()',start);
  assert.ok(start>=0&&end>start,'compaction owner block must be discoverable');
  Object.assign(s,{state,clone:v=>v===undefined?undefined:JSON.parse(JSON.stringify(v)),companyFinanceTypes:()=>Object.keys(state.companyFinance),companyBook:t=>state.companyFinance[t]});
  vm.runInContext(app.slice(start,end)+'\nglobalThis.__compactSimulationState=compactSimulationState;',s,{filename:'app-compaction-owner.js'});
  return {s,state,F:s.GH_FINANCE_CORE,P:s.GH_DOCUMENT_PROOF,S:s.GH_SAVE_SCHEMA};
}

function accrue(env){
  env.F.execute({state:env.state},'accrue-payroll',{company:'group',amount:100,number:'PAY-GROUP-D1',reportId:'R1',dueDay:1});
  return env.state.finance.transfers.find(row=>row.kind==='payroll-payable');
}

// New Build 336 behavior: legal document stays canonical; ledgers only receive a projection.
{
  const env=environment(),canonical=accrue(env);
  assert.ok(canonical?.documentProofId,'canonical payroll transfer must retain its legal proof');
  assert.equal(env.P.verifyDocument(env.state,canonical).ok,true,'canonical payroll transfer proof must verify');
  const ledger=env.state.companyFinance.group.ledger[0];
  assert.equal(ledger.documentProofId,undefined,'company ledger must not masquerade as a second legal document');
  assert.equal(ledger.contentDigest,undefined,'company ledger projection must not retain the legal security envelope');
  assert.equal(ledger.sourceDocumentProofId,canonical.documentProofId,'ledger projection must retain provenance to canonical proof');
  assert.equal(ledger.sourceDocumentId,canonical.documentId,'ledger projection must retain canonical document id');
  assert.equal(ledger.kind,'payroll-accrual');
  assert.equal(ledger.from,'ذمم رواتب مستحقة');
  assert.equal(env.S.validate(env.state).ok,true,'state must be valid before compaction');

  env.state.simSeconds=298800; // day=3 => first cutoff that makes day-0 rows eligible (cutoff=86400)
  env.s.__compactSimulationState(true);
  const post=env.S.validate(env.state);
  assert.equal(post.ok,true,`compaction must preserve proof integrity: ${post.errors?.join(',')}`);
  const archived=env.state.finance.auditArchive?.records?.['companyLedger-group']||[];
  assert.equal(archived.some(row=>row.documentProofId),false,'ledger archive must not receive a forged proof-bearing duplicate');
  assert.ok((env.state.finance.auditArchive?.digests||[]).some(row=>row.kind==='companyLedger-group'),'old ledger projection should compact into aggregate history');
}

// Disk migration path: Build 335 latent proof-bearing ledger copy is repaired before save-schema validation.
{
  const env=environment(),canonical=accrue(env);
  const legacy={...JSON.parse(JSON.stringify(canonical)),from:'ذمم رواتب مستحقة',kind:'payroll-accrual'};
  env.state.companyFinance.group.ledger=[legacy];
  env.state.treasury.ledger=[JSON.parse(JSON.stringify(legacy))];
  const forensic=env.P.forensicInspectStateProofs(env.state);
  const latent=forensic.documentFailures.find(row=>row.role==='latent-ledger');
  assert.ok(latent,'forensics must expose the latent Build 335 ledger mismatch before compaction');
  assert.equal(latent.reason,'document-content-tampered');
  assert.match(String(latent.differencePath),/^\$\.material\.payload\.(?:from|kind)$/,'forensics must identify the exact changed material field');

  const migrated=env.S.migrateLegacy(env.state);
  assert.equal(migrated.changed,true,'legacy proof-bearing ledger rows must trigger canonical migration');
  assert.equal(migrated.state.companyFinance.group.ledger[0].documentProofId,undefined);
  assert.equal(migrated.state.companyFinance.group.ledger[0].sourceDocumentProofId,canonical.documentProofId);
  assert.equal(migrated.state.treasury.ledger[0].documentProofId,undefined);
  assert.equal(env.S.validate(migrated.state).ok,true,'cold-boot migrated state must validate');
  const second=env.S.migrateLegacy(migrated.state);
  assert.equal(second.changed,false,'proof-ledger migration must be idempotent on the second pass');
  assert.equal(JSON.stringify(second.state),JSON.stringify(migrated.state),'second migration pass must not change canonicalized state bytes');
}

// Real cold-boot owner path: native Build 335 JSON is migrated before validation and marked for canonical re-save.
{
  const source=environment(),canonical=accrue(source);
  const legacy={...JSON.parse(JSON.stringify(canonical)),from:'ذمم رواتب مستحقة',kind:'payroll-accrual'};
  source.state.companyFinance.group.ledger=[legacy];source.state.treasury.ledger=[JSON.parse(JSON.stringify(legacy))];source.state.simSeconds=40800;source.state.saveRevision=37;
  const raw=JSON.stringify(source.state);
  const boot=harness(['save-schema','authorization-core','document-proof-core','migration-core']);
  boot.s.__GH_NATIVE_SAVE_JSON__=raw;
  const defaults=minimal();defaults.profile={name:'Build336 Proof Regression',founder:'Founder'};
  const loaded=boot.s.GH_MIGRATION_CORE.load({defaultState:defaults,storageKey:'gh-test',legacyStorageKeys:[],resetMarkerKey:'gh-reset',saveSchema:boot.s.GH_SAVE_SCHEMA});
  assert.equal(loaded.source,'native');
  assert.equal(loaded.needsCanonicalPersist,true,'native Build335 repair must request one canonical persist after boot');
  assert.equal(loaded.state.simSeconds,40800);assert.equal(loaded.state.saveRevision,37);
  assert.equal(loaded.state.companyFinance.group.ledger[0].documentProofId,undefined);
  assert.equal(boot.s.GH_SAVE_SCHEMA.validate(loaded.state).ok,true,'cold native state must be valid before canonical persistence');
  const canonicalRaw=JSON.stringify(loaded.state),boot2=harness(['save-schema','authorization-core','document-proof-core','migration-core']);
  boot2.s.__GH_NATIVE_SAVE_JSON__=canonicalRaw;
  const loaded2=boot2.s.GH_MIGRATION_CORE.load({defaultState:defaults,storageKey:'gh-test',legacyStorageKeys:[],resetMarkerKey:'gh-reset',saveSchema:boot2.s.GH_SAVE_SCHEMA});
  assert.equal(loaded2.needsCanonicalPersist,false,'second native boot from canonical state must not request another migration save');
  assert.equal(JSON.stringify(loaded2.state),JSON.stringify(loaded.state),'second native boot must preserve the canonical state JSON exactly');
}

// RAM-at-hour-83 migration path: already-promoted company-ledger archive row is repaired atomically.
{
  const env=environment(),canonical=accrue(env);
  const legacy={...JSON.parse(JSON.stringify(canonical)),from:'ذمم رواتب مستحقة',kind:'payroll-accrual'};
  env.state.companyFinance.group.ledger=[];
  env.state.treasury.ledger=[];
  env.state.finance.auditArchive={records:{'companyLedger-group':[legacy]},digests:[]};
  assert.equal(env.S.validate(env.state).ok,false,'legacy promoted row must reproduce document-proof-integrity');
  const migrated=env.S.migrateLegacy(env.state);
  const row=migrated.state.finance.auditArchive.records['companyLedger-group'][0];
  assert.equal(row.documentProofId,undefined);
  assert.equal(row.sourceDocumentProofId,canonical.documentProofId);
  assert.equal(env.S.validate(migrated.state).ok,true,'hour-83 migrated state must validate after owner repair');
}

// Early-day player authorization path: a stale security envelope with identical material is repairable.
{
  const env=environment();
  env.F.execute({state:env.state},'founder-investment',{company:'group',amount:125,ref:'FND-EARLY-DAY'});
  const canonical=env.state.finance.transfers.find(row=>row.id==='FND-EARLY-DAY');
  const record=env.P.record(env.state,canonical.documentProofId);
  // Reconstruct Build 335's old ledger behavior: full protected copy first,
  // then later authorization binds only the canonical document/record.
  const stale=JSON.parse(JSON.stringify(canonical));
  env.state.companyFinance.group.ledger=[stale];
  env.state.treasury.ledger=[JSON.parse(JSON.stringify(stale))];
  record.authorizationKind='approved-player';canonical.authorizationKind='approved-player';
  assert.equal(env.P.verifyDocument(env.state,canonical).ok,true);
  assert.equal(env.P.verifyDocument(env.state,stale).reason,'document-authorization-kind-mismatch');
  assert.equal(env.S.validate(env.state).ok,true,'latent stale ledger envelope is not a legal document before compaction');
  const migrated=env.S.migrateLegacy(env.state);
  assert.equal(migrated.state.companyFinance.group.ledger[0].documentProofId,undefined);
  assert.equal(migrated.state.companyFinance.group.ledger[0].sourceDocumentProofId,canonical.documentProofId);
  assert.equal(env.S.validate(migrated.state).ok,true,'cold boot migration must repair stale authorization envelope without altering canonical proof');

  // The same old state without migration deterministically fails at the day-3 cutoff.
  env.state.simSeconds=298800;env.s.__compactSimulationState(true);
  assert.equal(env.S.validate(env.state).ok,false,'Build 335 legacy state must reproduce the hour-83 promotion failure');
}

// Fail closed: an unrelated/tampered accounting amount may never be normalized away.
{
  const env=environment(),canonical=accrue(env);
  const corrupt={...JSON.parse(JSON.stringify(canonical)),from:'ذمم رواتب مستحقة',kind:'payroll-accrual',amount:999};
  env.state.companyFinance.group.ledger=[corrupt];
  assert.throws(()=>env.S.migrateLegacy(env.state),/ledger-proof-migration:unexpected-payroll-diff/,'migration must reject material corruption rather than bypass proof validation');
}

console.log('build336 proof-ledger compaction regression: PASS');
