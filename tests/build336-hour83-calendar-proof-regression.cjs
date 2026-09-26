'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {harness,minimal,ROOT}=require('./helpers/core-harness');

const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
function fragment(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,`${start} -> ${end}`);return app.slice(a,b);}

function baseEnvironment(){
  const {s}=harness(['save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core','finance-core','control-plane-core','simulation-asset-core','simulation-core']);
  const state=minimal();state.profile={name:'Build336 Hour83 Regression',founder:'Founder'};state.lastMarketHour=0;state.lastFinancialDay=0;state.speed=0;state.groupValue=0;state.todayProfit=0;
  state.sectorProfitToday={};state.tripProfitAccrued={};state.tripRevenueAccrued={};state.tripFuelAccrued={};state.tripMaintenanceAccrued={};state.tripCountAccrued={};state.advanced={companies:{}};
  s.GH_FINANCE_CORE.ensure(state);s.GH_CONTROL_PLANE.ensure(state);
  Object.assign(s,{
    state,
    clone:v=>v===undefined?undefined:structuredClone(v),
    companyFinanceTypes:()=>Object.keys(s.state.companyFinance||{}),
    companyBook:t=>s.state.companyFinance[t],
    COMPANY_PLATFORM:{listInstances:()=>[]},SIMULATION_ASSET_ENGINE:s.GH_SIMULATION_ASSET_CORE,simulationAssetRuntimeContext:()=>({workerCompatible:false}),routeTemplates:{},competitorAssets:[],BASE_ROUTE_IDS:new Set(),
    queueAssetSaleFinalize:()=>{},diag:()=>{},
    processFinancialDay(day){assert.equal(day,s.state.lastFinancialDay+1);s.state.lastFinancialDay=day;},
    dispatchSystemCommand:()=>({ok:true,result:{}}),
    processAssetDraft:()=>{}
  });
  s.GH_REALISM={hasPendingDeliveries:()=>false,onHour:()=>{}};
  s.GH_ADVANCED={onMarketHour:()=>{}};
  s.GH_DELIVERY_MONITOR={reconcile:()=>({})};
  s.GH_CORPORATE_CORE={execute:()=>({})};
  s.GH_MOBILITY_CORE={simulationSliceLimit:()=>3600,onSimulationTime:()=>{}};
  s.GH_OPERATIONS_CORE={execute:()=>({})};
  s.GH_ROUTE_CORE={execute:()=>({})};

  // Actual Build 335/336 owners: market boundary, compaction, slice transaction.
  vm.runInContext(fragment('  function processMarket(processedHour=null){','  // ---------------------------------------------------------------------------\n  // SIMULATION CORE 2.1'),s,{filename:'app-process-market.js'});
  vm.runInContext(fragment('  function financeAuditArchive()','  function normalizeSimulationClocks()'),s,{filename:'app-compaction-owner.js'});
  vm.runInContext(fragment('  function makeSimulationEffects()','  // Pure simulation draft:'),s,{filename:'app-simulation-guards.js'});
  vm.runInContext(fragment('  const SIMULATION_TRANSACTION_SCOPE=',"  if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core compatibility"),s,{filename:'app-simulation-transaction.js'});
  vm.runInContext('globalThis.__compactSimulationState=compactSimulationState;globalThis.__processMarket=processMarket;globalThis.__createSimulationSliceJob=createSimulationSliceJob;',s);
  return {s,F:s.GH_FINANCE_CORE,P:s.GH_DOCUMENT_PROOF,S:s.GH_SAVE_SCHEMA};
}

function seedLatentBuild335Ledger(env){
  const {s,F,P}=env;F.execute({state:s.state},'founder-investment',{company:'group',amount:125,ref:'FND-DAY0-H83'});
  const canonical=s.state.finance.transfers.find(row=>row.id==='FND-DAY0-H83');assert.ok(canonical?.documentProofId);
  const stale=structuredClone(canonical);
  s.state.companyFinance.group.ledger=[stale];s.state.treasury.ledger=[structuredClone(stale)];
  const record=P.record(s.state,canonical.documentProofId);record.authorizationKind='approved-player';canonical.authorizationKind='approved-player';
  assert.equal(P.verifyDocument(s.state,canonical).ok,true,'canonical document must remain valid');
  assert.equal(P.verifyDocument(s.state,stale).reason,'document-authorization-kind-mismatch','legacy Build335 ledger envelope must be stale');
  assert.equal(env.S.validate(s.state).ok,true,'latent stale ledger is intentionally outside canonical document scan before compaction');
  return {canonical,stale};
}

function makeEngine(env,start,{maintenanceEveryHours=12}={}){
  const {s}=env;let wall=0;const maintenance=[];s.performance={now:()=>wall};
  s.state.simSeconds=start;s.state.lastMarketHour=Math.floor(start/3600);s.state.lastFinancialDay=Math.floor(start/86400);
  const engine=s.GH_SIMULATION_CORE.create({
    getSimTime:()=>s.state.simSeconds,setSimTime:v=>{s.state.simSeconds=v;},getSpeed:()=>0,setSpeed:()=>{},getManualSliceLimit:()=>3600,
    createSliceJob:(slice,meta)=>s.__createSimulationSliceJob(slice,meta),
    onMaintenance:hour=>{maintenance.push(hour);s.__compactSimulationState(false);},
    onAdvance:()=>{}
  },{nowMs:()=>wall,allowedSpeeds:[0,30,120,300,600],fallbackSpeed:30,frameBudgetMs:4,manualFrameBudgetMs:10,chunkItems:32,manualChunkItems:64,maintenanceEveryHours,manualBatchSeconds:3600,manualMinBatchSeconds:300,manualRetryLimit:3});
  return {engine,maintenance,run(target){assert.equal(engine.advanceTo(target,{speed:600,batchSeconds:3600}).accepted,true);for(let frame=0;frame<60000&&engine.snapshot().manualAdvance;frame++){wall+=16;engine.frame(wall);}return engine.snapshot();}};
}

// A. Exact uninterrupted Build335 latent-state timing: first day-0 ledger promotion occurs at maintenance hour 83,
// then the hour-84 market pre/post integrity check rejects the promoted stale proof and time rolls back to 298800.
{
  const env=baseEnvironment();seedLatentBuild335Ledger(env);const runner=makeEngine(env,0);const snap=runner.run(302400);
  assert.deepEqual(runner.maintenance.slice(0,7),[11,23,35,47,59,71,83],'12-hour maintenance cadence must expose day-0 history first at hour 83');
  assert.equal(env.s.state.simSeconds,298800,'legacy state must stop at the exact pre-hour84 boundary');
  assert.ok(snap.lastAdvanceFailure,'legacy state must fail the manual advance');
  assert.match(String(snap.lastAdvanceFailure.error||snap.lastError||''),/document-proof-integrity/,'failure must be the proof contract, not the scheduler');
  assert.equal(env.S.validate(env.s.state).ok,false,'hour83 compaction must have exposed the stale ledger proof');
}

// B. Cold boot from the last durable point @ 40800: Build336 migration repairs the latent ledger projection before validation,
// then the real scheduler/transaction/market-integrity path crosses 298800 and reaches 302400.
{
  const env=baseEnvironment();seedLatentBuild335Ledger(env);env.s.state.simSeconds=40800;env.s.state.lastMarketHour=11;env.s.state.lastFinancialDay=0;env.s.state.saveRevision=37;
  const migrated=env.S.migrateLegacy(env.s.state);assert.equal(migrated.changed,true);env.s.state=migrated.state;
  assert.equal(env.S.validate(env.s.state).ok,true,'cold-boot migrated state must validate before time advances');
  const runner=makeEngine(env,40800);const snap=runner.run(302400);
  assert.equal(env.s.state.simSeconds,302400,'Build336 cold-boot state must cross the former hour83/84 failure');
  assert.equal(snap.manualAdvance,null);assert.equal(snap.lastAdvanceFailure??null,null);
  assert.equal(env.S.validate(env.s.state).ok,true,'state must remain save-schema valid after hour84');
  assert.equal(env.P.forensicInspectStateProofs(env.s.state).ok,true,'proof forensics must remain clean after hour84');
  assert.ok(runner.maintenance.includes(84),'cold boot re-anchors runtime maintenance cadence without affecting correctness');
}

// C. Exceptional RAM snapshot @ 298800 after Build335 already promoted the stale row: migration repairs the promoted
// companyLedger archive row atomically, then hour84 commits normally.
{
  const env=baseEnvironment();seedLatentBuild335Ledger(env);env.s.state.simSeconds=298800;env.s.state.lastMarketHour=83;env.s.state.lastFinancialDay=3;env.s.__compactSimulationState(true);
  assert.equal(env.S.validate(env.s.state).ok,false,'promoted legacy RAM snapshot must reproduce proof failure');
  const migrated=env.S.migrateLegacy(env.s.state);env.s.state=migrated.state;assert.equal(env.S.validate(env.s.state).ok,true);
  const runner=makeEngine(env,298800);const snap=runner.run(302400);
  assert.equal(env.s.state.simSeconds,302400);assert.equal(snap.lastAdvanceFailure??null,null);assert.equal(env.P.forensicInspectStateProofs(env.s.state).ok,true);
}

console.log(JSON.stringify({suite:'build336-hour83-calendar-proof-regression',passed:true,scope:'actual simulation scheduler + actual simulation transaction + actual market control-plane save-schema integrity + actual compaction owner',formerFailureBoundary:[298800,302400]},null,2));
