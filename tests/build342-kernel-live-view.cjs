'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const CLONE_CORE=require('../WebApp/clone-core.js');
global.GH_CLONE_CORE=CLONE_CORE;
const GH_KERNEL=require('../WebApp/kernel-core.js');
global.GH_KERNEL=GH_KERNEL;
const TRANSACTION=require('../WebApp/transaction-core.js');
const seed={
  saveVersion:'2.0.0',saveRevision:4,cash:900,
  assets:[{id:'A-1',fuel:71,route:{id:'R-1'}},{id:'A-2',fuel:62,route:null}],
  finance:{ledger:[{id:'L-1',amount:20}],accounts:{operating:900}},
  alerts:['newest','older'],eventLog:[{id:'E-1'}]
};
const kernel=GH_KERNEL.create({schemaVersion:'2.0.0',legacyState:seed});
for(const name of Object.keys(seed))kernel.register(name,{owner:'transaction-core',kind:'object',path:[name]});
kernel.releaseRegisteredBase();
const state=kernel.stateView();
assert.deepEqual(kernel.legacyState(),seed,'kernel bootstrap preserves the logical Save Schema payload');
assert.equal(JSON.parse(JSON.stringify(state)).saveVersion,'2.0.0','state view remains JSON-compatible');

state.finance.accounts.operating=875;
state.assets[0].fuel=70;
state.eventLog.push({id:'E-2'});
assert.equal(kernel.legacyState().finance.accounts.operating,875,'out-of-transaction writes still use a kernel commit');
assert.equal(kernel.read('assets')[0].fuel,70,'nested hot-path writes publish to kernel storage');
assert.equal(kernel.revision('finance'),1,'each direct write advances its owning section once');

const staleFinanceSection=state.finance;
state.finance={accounts:{operating:0},ledger:[]};
state.finance=staleFinanceSection;
assert.equal(kernel.legacyState().finance.accounts.operating,875,'reassigning a stale same-path live proxy is not incorrectly skipped');
assert.deepEqual(kernel.legacyState().finance.ledger,seed.finance.ledger,'stale proxy restoration preserves the original section value');

const before=kernel.legacyState(),beforeFingerprint=GH_KERNEL.fingerprint(before);
assert.throws(()=>kernel.tx({label:'fault-after-multiple-domains',owner:'transaction-core',writes:kernel.sectionNames()},()=>{
  state.cash=12;
  state.finance.accounts.operating=0;
  state.assets[1].fuel=1;
  state.eventLog.push({id:'E-3'});
  state.alerts.unshift('temporary');
  state.addedAtRuntime={value:1};
  throw new Error('injected-mid-transaction-failure');
}),/injected-mid-transaction-failure/);
assert.deepEqual(kernel.legacyState(),before,'failure restores all sections, nested fields, arrays, and dynamic roots');
assert.equal(GH_KERNEL.fingerprint(kernel.legacyState()),beforeFingerprint,'rollback restores the complete state fingerprint');
assert.equal(Object.hasOwn(state,'addedAtRuntime'),false,'failed dynamic root creation is invisible');

const result=kernel.tx({label:'multi-domain-commit',owner:'transaction-core',writes:kernel.sectionNames()},()=>{
  state.cash=950;
  state.finance.ledger.push({id:'L-2',amount:50});
  state.assets.push({id:'A-3',fuel:88,route:{id:'R-3'}});
  state.alerts.unshift('committed');
});
assert.equal(result.committed,true);
assert.equal(state.assets.length,3);
assert.equal(state.assets[2].route.id,'R-3');
assert.deepEqual(kernel.legacyState().alerts,['committed','newest','older'],'legacy newest-first array order stays stable');
assert.equal(kernel.legacyState().saveVersion,'2.0.0','logical save schema does not change');

const applicationState=TRANSACTION.enableKernelOwner({saveVersion:'2.0.0',saveRevision:0,cash:100,assets:[{id:'W-1',fuel:55,route:{id:'R-1'}}],finance:{accounts:{operating:100}},eventLog:[]});
const committed=TRANSACTION.execute(applicationState,{label:'simulation:owner-commit',scope:['cash','assets','finance'],apply:()=>{
  applicationState.cash=125;
  applicationState.assets[0].fuel=54;
  applicationState.finance.accounts.operating=125;
  applicationState.eventLog.push({id:'OWNER-COMMIT'});
}});
assert.equal(committed.committed,true);
assert.equal(applicationState.cash,125);
const committedMetric=TRANSACTION.telemetry().last;
assert.equal(committedMetric.rollbackStorage,'kernel-journal','the application transaction no longer snapshots live state');
assert.equal(committedMetric.fullSnapshot,false);
assert.ok(committedMetric.kernelUndoRecords>=4,'the kernel records deltas for each changed path');
const assetStorage=TRANSACTION.kernelOwnerStatus(applicationState);
assert.equal(assetStorage.enabled,true);
assert.deepEqual(assetStorage.columnSections.find(row=>row.name==='assets')?.fields,['progress','fuel','condition','dwellRemaining','tripSeconds','simCarrySeconds','departureScheduledAt','distanceKm','effectiveSpeedKmh'],'live asset rows are stored in Float64 columns with a legacy row view');
assert.ok(assetStorage.typedArrayBytes>=9*9,'live asset columns and presence maps use typed arrays');
assert.equal(assetStorage.columnSections.find(row=>row.name==='assets')?.redundantObjectFields,0,'hot numeric values exist only in typed columns, not duplicate object properties');
const liveAssets=applicationState.assets;applicationState.assets[0].fuel=53;applicationState.assets[0].route.id='R-LIVE';
assert.equal(applicationState.assets[0].fuel,53);assert.equal(applicationState.assets[0].route.id,'R-LIVE');
assert.equal(Object.keys(applicationState.assets[0]).includes('fuel'),true,'typed hot fields remain enumerable in the Save Schema view');
applicationState.assets[0].departureScheduledAt=undefined;
assert.equal(Object.hasOwn(applicationState.assets[0],'departureScheduledAt'),true,'typed presence tags preserve an explicit undefined property');
assert.throws(()=>structuredClone(applicationState),error=>error?.name==='DataCloneError','the fixture is a real Proxy that native structuredClone cannot copy');
const clonedProxy=CLONE_CORE.clone(applicationState);
assert.equal(Object.hasOwn(clonedProxy.assets[0],'departureScheduledAt'),true,'shared clone fallback preserves explicit undefined values in a live Proxy');
assert.deepEqual(Object.keys(clonedProxy.assets[0]),Object.keys(applicationState.assets[0]),'shared clone fallback preserves Save Schema row key order');
assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(applicationState)).assets[0],'departureScheduledAt'),false,'JSON still omits explicit undefined values as Save Schema 2.0.0 requires');
delete applicationState.assets[0].departureScheduledAt;
assert.equal(Object.hasOwn(applicationState.assets[0],'departureScheduledAt'),false,'delete remains distinct from an explicit undefined property in a typed column');
applicationState.assets[0].departureScheduledAt=undefined;
assert.equal(JSON.stringify(applicationState),JSON.stringify(TRANSACTION.kernelOwnerState(applicationState)),'the application proxy emits the same logical save bytes as the authoritative kernel export');
liveAssets.push({id:'W-2',fuel:42,condition:91,progress:.25,route:{id:'R-2'}});
assert.equal(applicationState.assets.length,2);assert.equal(applicationState.assets[1].fuel,42);
liveAssets.splice(1,1);assert.equal(applicationState.assets.length,1,'array structural mutations remain transparent through the kernel view');
assert.equal(liveAssets,applicationState.assets,'the kernel keeps a stable live asset-array identity across row changes');
assert.equal(JSON.parse(JSON.stringify(applicationState)).assets[0].fuel,53,'JSON save export reads typed columns, not null placeholders');
const beforeAssetReset=JSON.parse(JSON.stringify(applicationState)),resetPayload={...beforeAssetReset,assets:[]};
TRANSACTION.restoreObject(applicationState,resetPayload);assert.equal(applicationState.assets.length,0,'New Group reset can atomically empty typed asset columns');
assert.equal(TRANSACTION.kernelOwnerStatus(applicationState).typedArrayBytes,0,'empty live fleet releases per-asset column storage');
TRANSACTION.restoreObject(applicationState,beforeAssetReset);assert.deepEqual(JSON.parse(JSON.stringify(applicationState)),beforeAssetReset,'manual/native load reconstructs typed rows through the same owner');
const beforeBadColumnWrite=JSON.parse(JSON.stringify(applicationState)),revisionBeforeBadColumnWrite=TRANSACTION.revision(applicationState);
assert.throws(()=>{applicationState.assets[0].fuel=Infinity;},/kernel-column-nonfinite:fuel/);
assert.throws(()=>{liveAssets.push({id:'W-BAD',fuel:'not-a-number'});},/kernel-column-nonfinite:fuel/);
assert.deepEqual(JSON.parse(JSON.stringify(applicationState)),beforeBadColumnWrite,'invalid typed-column updates cannot leak a partial asset row');
assert.equal(TRANSACTION.revision(applicationState),revisionBeforeBadColumnWrite,'invalid typed-column updates commit no revision');
assert.throws(()=>TRANSACTION.execute(applicationState,{label:'simulation:asset-structure-rollback',apply:()=>{applicationState.assets.push({id:'W-TEMP',fuel:12,condition:88,progress:.5});applicationState.assets[0].fuel=0;throw new Error('injected-column-structure-failure');}}),/injected-column-structure-failure/);
assert.deepEqual(JSON.parse(JSON.stringify(applicationState)),beforeBadColumnWrite,'kernel rollback restores array structure, row metadata, and typed columns together');
const appRevision=TRANSACTION.revision(applicationState);applicationState.cash=126;
assert.equal(TRANSACTION.revision(applicationState),appRevision+1,'standalone state writes invalidate transaction revision guards');
applicationState.cash=125;
const ownerBefore=JSON.parse(JSON.stringify(applicationState));
assert.throws(()=>TRANSACTION.execute(applicationState,{label:'simulation:owner-fault',apply:()=>{
  applicationState.cash=1;
  applicationState.assets[0].fuel=0;
  applicationState.finance.accounts.operating=0;
  applicationState.eventLog.push({id:'FAILED'});
  throw new Error('injected-owner-failure');
}}),/injected-owner-failure/);
assert.deepEqual(JSON.parse(JSON.stringify(applicationState)),ownerBefore,'transaction failure rolls the authoritative kernel view back completely');
const rejected=TRANSACTION.execute(applicationState,{label:'simulation:owner-validation-reject',validate:()=>({ok:false,reason:'expected-rejection'}),apply:()=>{throw new Error('apply-must-not-run');}});
assert.equal(rejected.committed,false,'failed validation remains a clean atomic rejection');
assert.deepEqual(JSON.parse(JSON.stringify(applicationState)),ownerBefore);
const restored={...ownerBefore,cash:500};TRANSACTION.restoreObject(applicationState,restored);
assert.deepEqual(JSON.parse(JSON.stringify(applicationState)),restored,'load/reset publication replaces the kernel state in one transaction');
assert.equal(TRANSACTION.revision(applicationState),appRevision+3,'direct writes and atomic state publication advance only their committed revisions');
assert.equal(applicationState.saveVersion,'2.0.0');

const compactKernel=GH_KERNEL.create({schemaVersion:'2.0.0',legacyState:{finance:{journalEntries:[
  {id:'KEEP-PREFIX',at:900,lines:[{account:'cash',debit:1,credit:0},{account:'equity',debit:0,credit:1}]},
  {id:'ARCHIVE-OLD',at:100,lines:[{account:'cash',debit:1,credit:0},{account:'equity',debit:0,credit:1}]},
  {id:'KEEP-SUFFIX',at:950,lines:[{account:'cash',debit:1,credit:0},{account:'equity',debit:0,credit:1}]}
]}}});
compactKernel.register('finance',{owner:'transaction-core',kind:'object',path:['finance']});compactKernel.releaseRegisteredBase();
const compactState=compactKernel.stateView();
compactKernel.tx({label:'journal-compaction-retain-rows',owner:'transaction-core',writes:['finance']},()=>{
  const rows=compactState.finance.journalEntries,retained=[];for(const row of rows)if(row.at>=800)retained.push(row);
  rows.length=0;for(const row of retained)rows.push(row);
});
const compactedJournals=compactKernel.legacyState().finance.journalEntries;
assert.deepEqual(compactedJournals.map(row=>row?.id),['KEEP-PREFIX','KEEP-SUFFIX'],'compaction must restore a retained row even when its original array index is reused');
assert(compactedJournals.every(row=>Array.isArray(row.lines)&&row.lines.length===2),'compaction retains each complete balanced journal row');

const orderedLegacy={saveVersion:'2.0.0',assets:[{id:'ORDER-1',fuel:40,rareA:'a',progress:.25,condition:null,rareB:'b'}]};
const orderedKernel=GH_KERNEL.create({schemaVersion:'2.0.0',legacyState:orderedLegacy});
orderedKernel.register('saveVersion',{owner:'transaction-core',kind:'object',path:['saveVersion']});
orderedKernel.register('assets',{owner:'transaction-core',kind:'columns',path:['assets'],columns:{fuel:'f64',progress:'f64',condition:'f64'}});orderedKernel.releaseRegisteredBase();
const orderedView=orderedKernel.stateView();
assert.equal(JSON.stringify(orderedView),JSON.stringify(orderedLegacy),'typed storage preserves byte-level Save Schema row key order');
assert.deepEqual(Object.keys(orderedView.assets[0]),Object.keys(orderedLegacy.assets[0]),'live Proxy enumeration preserves legacy asset key order');
assert.equal(orderedKernel.columnStorageReport('assets').redundantObjectFields,0,'the SoA backing rows contain rare fields only');
delete orderedView.assets[0].fuel;
assert.deepEqual(Object.keys(orderedView.assets[0]),['id','rareA','progress','condition','rareB'],'deleting one hot field keeps all remaining field order stable');
orderedView.assets[0].fuel=41;
assert.deepEqual(Object.keys(orderedView.assets[0]),['id','rareA','progress','condition','rareB','fuel'],'re-adding a deleted property follows JavaScript append order');
orderedView.assets[0].rareC='c';
assert.deepEqual(Object.keys(orderedView.assets[0]),['id','rareA','progress','condition','rareB','fuel','rareC'],'rare-field writes update the kernel-owned row order');
delete orderedView.assets[0].rareA;
assert.deepEqual(Object.keys(orderedView.assets[0]),['id','progress','condition','rareB','fuel','rareC'],'rare-field deletes preserve the remaining ordered fields');
const orderedBeforeRollback=JSON.stringify(orderedView);
assert.throws(()=>orderedKernel.tx({label:'ordered-row-rollback',owner:'transaction-core',writes:['assets']},()=>{delete orderedView.assets[0].condition;orderedView.assets[0].fuel=12;orderedView.assets[0].rareD='temporary';throw new Error('ordered-row-fault');}),/ordered-row-fault/);
assert.equal(JSON.stringify(orderedView),orderedBeforeRollback,'row-order and SoA mutations roll back as one transaction');
const stableBeforeBadRestore=JSON.parse(JSON.stringify(applicationState)),revisionBeforeBadRestore=TRANSACTION.revision(applicationState),badRestore={cash:777};
Object.defineProperty(badRestore,'broken',{enumerable:true,get(){throw new Error('injected-load-decode-failure');}});
assert.throws(()=>TRANSACTION.restoreObject(applicationState,badRestore),/injected-load-decode-failure/);
assert.deepEqual(JSON.parse(JSON.stringify(applicationState)),stableBeforeBadRestore,'failed restore rolls back earlier root updates');
assert.equal(TRANSACTION.revision(applicationState),revisionBeforeBadRestore,'failed restore advances no transaction revision');

const appSource=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8');
const transactionSource=fs.readFileSync(path.join(__dirname,'../WebApp/transaction-core.js'),'utf8');
const persistenceSource=fs.readFileSync(path.join(__dirname,'../WebApp/persistence-core.js'),'utf8');
const authorizationSource=fs.readFileSync(path.join(__dirname,'../WebApp/authorization-core.js'),'utf8');
const lifecycleSource=fs.readFileSync(path.join(__dirname,'../WebApp/game-lifecycle-core.js'),'utf8');
const htmlSource=fs.readFileSync(path.join(__dirname,'../WebApp/index.html'),'utf8');
const kernelBootstrap=appSource.indexOf('state=window.GH_TRANSACTION_CORE.enableKernelOwner(state);');
assert(appSource.indexOf('GH_MIGRATION_CORE.load(')<appSource.indexOf('GH_SAVE_SCHEMA.normalize(state,defaultState)'),'disk and native load migration finish before state ownership is installed');
assert(appSource.indexOf('GH_MIGRATION_CORE.structural(state,defaultState)')<kernelBootstrap,'structural migration runs before the new owner imports the complete logical save');
assert(kernelBootstrap>0&&kernelBootstrap<appSource.indexOf('let startupSignatureRequired='),'kernel ownership starts before authorization, diagnostics, control-plane and domain bootstrap can write state');
assert(kernelBootstrap<appSource.indexOf('const competitors=state.simulationWorld.competitors;'),'kernel ownership starts before application substate references are captured');
assert(appSource.indexOf('window.__GH_STATE__=state;',kernelBootstrap)>kernelBootstrap,'global state reference is rebound to the kernel proxy');
assert(!appSource.includes('enableKernelShadow('),'production startup no longer relies on an optional shadow copy');
const ownerExecute=transactionSource.slice(transactionSource.indexOf('function execute(target,options={})'),transactionSource.indexOf('function resetProfileTelemetry',transactionSource.indexOf('function execute(target,options={})')));
assert(ownerExecute.includes('owner.kernel.tx(')&&ownerExecute.includes('executeCore(target,{...options,kernelManaged:true})'),'all ordinary live transactions enter the state owner journal');
assert(transactionSource.includes("if(kernelManaged){timing.journalRecords=0;}")&&transactionSource.includes('const rollback=()=>{if(kernelManaged)return target;'),'owner transactions skip whole-state snapshot and let kernel rollback own every write');
const liveReplace=appSource.slice(appSource.indexOf('function replaceLiveState('),appSource.indexOf('\n  let durableCommandSettlement=',appSource.indexOf('function replaceLiveState(')));
assert(liveReplace.includes('GH_TRANSACTION_CORE.restoreObject(state,snapshot)'),'native recovery and live durable publication restore through the kernel owner');
const browserRecovery=appSource.slice(appSource.indexOf("detail.ok===false&&detail.requiresMemoryRollback"),appSource.indexOf("detail.ok===false&&(detail.critical",appSource.indexOf("detail.ok===false&&detail.requiresMemoryRollback")));
assert(browserRecovery.includes('recoverBrowserState')&&browserRecovery.includes('replaceLiveState(recovered.state)'),'native save rejection recovery validates and republishes through the state owner');
const durablePath=appSource.slice(appSource.indexOf('async function runDurableStateCommand('),appSource.indexOf('\n  function authorizationIdempotencyKey',appSource.indexOf('async function runDurableStateCommand(')));
assert(durablePath.includes('commitDurableState(draft')&&durablePath.includes('replaceLiveState(draft)'),'ordinary durable commands publish only after persistence acknowledgement');
const authorizedPath=appSource.slice(appSource.indexOf('async function runAuthorizedDomainCommand('),appSource.indexOf('\n  async function runAuthorizedCompositeCommand',appSource.indexOf('async function runAuthorizedDomainCommand(')));
assert(authorizedPath.includes('dispatchDurable')&&authorizedPath.includes('publish:(_live,draft)=>replaceLiveState(draft)'),'authorized domain writes use the same durable state-owner publication path');
const resetPath=appSource.slice(appSource.indexOf('async function hardResetGame('),appSource.indexOf('\n  // Public fail-safe used only by the explicit New Group control.',appSource.indexOf('async function hardResetGame(')));
assert(resetPath.includes('GH_GAME_LIFECYCLE.reset(state,defaultState'),'new-game reset uses the lifecycle persistence gate');
assert(resetPath.includes('GH_TRANSACTION_CORE.restoreObject(state,previousState)'),'reset compensation restores through the kernel owner');
assert(lifecycleSource.includes('GH_PERSISTENCE.replaceState(next')&&lifecycleSource.includes('GH_TRANSACTION_CORE.restoreObject(state,next)'),'successful durable reset restores the new game into the same kernel owner');
assert(persistenceSource.includes('if(apply)apply(next);')&&persistenceSource.includes('native-reset-committed-reload-required'),'durable reset does not publish memory before storage acknowledgement and fails closed after native commit');
assert(appSource.includes('tx.execute(state,{')&&appSource.includes('label:`simulation:${simMeta.from}->${simMeta.to}`'),'live simulation slices pass through the same kernel-backed transaction wrapper');
assert(appSource.includes('window.GH_TRANSACTION_CORE.execute(state,{label:`boundary-recovery:'),'hour/day recovery transactions also use the same owner');
assert(/const SAVE_SCHEMA_VERSION\s*=\s*'2\.0\.0'/.test(appSource),'runtime Save Schema remains 2.0.0');
assert(htmlSource.indexOf('src="clone-core.js"')<htmlSource.indexOf('src="authorization-core.js"'),'Proxy-safe clone runtime loads before proof verification');
assert(authorizationSource.includes('GH_CLONE_CORE.clone(value)'),'authorization snapshots use the Proxy-safe clone path');

(async()=>{
  const beforeDurable=JSON.parse(JSON.stringify(applicationState)),revisionBeforeDurable=TRANSACTION.revision(applicationState);
  const durable=await TRANSACTION.executeDurable(applicationState,{
    label:'save:kernel-owned-publish',
    apply:draft=>{draft.cash=650;return 'published';},
    persist:async(draft,metadata)=>({ok:true,saveRevision:draft.saveRevision,expectedPreviousRevision:metadata.expectedPreviousRevision})
  });
  assert.equal(durable.committed,true);assert.equal(applicationState.cash,650);assert.equal(applicationState.saveRevision,beforeDurable.saveRevision+1);
  assert.equal(TRANSACTION.revision(applicationState),revisionBeforeDurable+1,'durable publication advances one kernel revision after persistence acknowledgement');
  const stable=JSON.parse(JSON.stringify(applicationState)),stableRevision=TRANSACTION.revision(applicationState);
  await assert.rejects(()=>TRANSACTION.executeDurable(applicationState,{
    label:'save:kernel-owned-persist-reject',apply:draft=>{draft.cash=999;},persist:async()=>({ok:false,reason:'injected-persist-rejection'})
  }),/injected-persist-rejection/);
  assert.deepEqual(JSON.parse(JSON.stringify(applicationState)),stable,'persistence rejection never publishes its draft into the live kernel');
  assert.equal(TRANSACTION.revision(applicationState),stableRevision,'persistence rejection advances no live state revision');
  console.log('PASS Build342 live state view: single writer, delta undo, JSON compatibility, atomic load/reset publication, and durable save rejection');
})().catch(error=>{console.error(error);process.exitCode=1;});
