'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {scenario}=require('./helpers/business-scenario');
const Core=require('../WebApp/simulation-asset-core.js');
const ROOT=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
function fragment(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,`missing app excerpt ${start}`);return app.slice(a,b);}
const SUPPORT=fragment('  const SIMULATION_ASSET_ENGINE=', '  function makeSimulationEffects(){');
const EFFECTS=fragment('  function makeSimulationEffects(){', '  // Pure simulation draft:');
const JOB=fragment('  const SIMULATION_TRANSACTION_SCOPE=', "  if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core compatibility");

function setup({assetCount=1}={}){
  const e=scenario(),s=e.s,state=e.state,route={id:'SIM-WORKER-R',type:'air',routeMode:'air',ownerCompanyId:'air',from:'ألف',to:'باء',fromFacility:'B1',toFacility:'B2',distanceKm:100,effectiveSpeedKmh:100,tripSeconds:4000,dwellHours:.1};
  e.load('simulation-time-core');e.load('simulation-pacing-core');e.load('simulation-core');e.load('simulation-asset-core');
  const asset={id:'SIM-WORKER-A',name:'اختبار محاكاة',type:'air',assetMode:'air',ownerCompanyId:'air',assetClass:'aircraft',operationProfileId:'air-operations',phase:'moving',routeId:route.id,routeSignature:'SIG',routeSlot:0,reverse:false,progress:.1,fuel:95,condition:99,from:route.from,to:route.to,baseFacility:'B1',load:'82 / 100 راكب',dwellRemaining:0,departureScheduled:false,salePending:false,tripSeconds:4000,specs:{capacity:100,capacityUnit:'راكب',speedKmh:100,fuelBurnKgPerKm:2,yieldMultiplier:1},staffing:{mode:'automatic-fixed',ready:true,monthlyPayroll:120000},simCarrySeconds:0,crewBlocked:false};
  state.assets=Array.from({length:assetCount},(_,index)=>index===0?asset:{...asset,id:`SIM-WORKER-A-${index}`});state.simSeconds=7200;state.speed=30;
  Object.assign(s,{
    state,COMPANY_PLATFORM:s.GH_COMPANY_PLATFORM,SIMULATION_ASSET_ENGINE:Core,GH_SIMULATION_ASSET_CORE:Core,
    routeTemplates:{[route.id]:route},competitorAssets:[],BASE_ROUTE_IDS:new Set([route.id]),expansionSites:[],
    getDynamicFacilities:()=>[...state.globalBases,...state.customHubs],catalogItem:()=>null,
    clone:value=>value===undefined?undefined:JSON.parse(JSON.stringify(value)),
    assetOwnerCompanyId:row=>row.ownerCompanyId||row.companyId||s.GH_COMPANY_PLATFORM.ownerForLegacyAssetMode?.(row.assetMode||row.type)||'',
    routeOwnerCompanyId:row=>row.ownerCompanyId||row.companyId||row.company||s.GH_COMPANY_PLATFORM.ownerForLegacyRouteMode?.(row.routeMode||row.type)||'',
    routeMatchingFacility:(id)=>id===route.id?route:null,
    processAssetDraft:()=>{throw new Error('compatibility fallback should not run in the worker integration test');},
    processFinancialDay:()=>{},processMarket:()=>{},routeDistance:()=>0,queueAssetSaleFinalize:()=>{},diag:()=>{},
    GH_ADVANCED:{adjustTripEconomics:(_state,_asset,eco)=>eco}
  });
  s.window=s;s.GH_SIMULATION_ASSET_CORE=Core;
  const workers=[],workerMessages=[];
  s.Worker=class MockSimulationWorker{
    constructor(){this.terminated=false;workers.push(this);}
    postMessage(message){workerMessages.push(message);setTimeout(()=>{if(this.terminated)return;const records=Core.processBatch(message);this.onmessage?.({data:{type:'result',requestId:message.requestId,version:'GH-SIMULATION-ASSET-WORKER-340.1.0',coreVersion:Core.VERSION,records}});},5);}
    terminate(){this.terminated=true;}
  };
  vm.runInContext(SUPPORT,s,{filename:'build340-simulation-worker-support.js'});
  vm.runInContext(EFFECTS,s,{filename:'build340-simulation-worker-effects.js'});
  vm.runInContext(JOB,s,{filename:'build340-simulation-worker-job.js'});
  return {e,s,state,asset,route,workers,workerMessages};
}
async function prepare(job){
  const first=job.runChunk(64,{deadline:Infinity});assert.equal(first?.pending,true,'the main thread yields after submitting the bounded worker batch');
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(job.runChunk(64,{deadline:Infinity}),true,'worker plan completes the immutable asset set');
}
async function prepareFully(job){
  for(let turn=0;turn<500;turn++){
    if(job.runChunk(256,{deadline:Infinity})===true)return;
    await new Promise(resolve=>setTimeout(resolve,2));
  }
  throw new Error('simulation-worker-integration-timeout');
}
async function run(){
  {
    const x=setup({assetCount:1});let reads=0;
    x.state.assets=x.state.assets.map(asset=>new Proxy(asset,{get(target,key,receiver){if(typeof key==='string'&&key!=='toJSON')reads++;return Reflect.get(target,key,receiver);}}));
    const job=x.s.createSimulationSliceJob(30,{from:x.state.simSeconds,to:x.state.simSeconds+30,speed:30,boundary:{day:null,hour:null}});
    assert.equal(reads,0,'creating a slice must not synchronously scan the full fleet');
    assert.equal(job.runChunk(1,{deadline:Infinity}),false,'slice-start guards are captured within the supplied chunk budget');
    assert(reads>0,'the first bounded chunk captures its immutable input before calculation');assert.equal(x.workerMessages.length,0,'asset calculation has not started while the snapshot is incomplete');
    const changed=x.s.GH_TRANSACTION_CORE.execute(x.state,{label:'test:asset-mutation-during-snapshot',apply:()=>{x.state.assets[0].specs.capacity=101;return true;}});assert.equal(changed.committed,true);
    assert.equal(job.runChunk(64,{deadline:Infinity}),true,'a transaction revision change invalidates a partial slice snapshot');const rejected=job.finish();
    assert.equal(rejected.committed,false,'a worker plan computed from an older DTO cannot publish');assert.equal(x.state.simSeconds,7200,'a stale asset plan cannot advance time');assert.equal(x.state.assets[0].specs.capacity,101,'rejected commit preserves the newer live input');
    console.log('PASS bounded slice snapshot yields to the frame budget and a transaction revision change rejects stale planning');
  }
  {
    const x=setup({assetCount:20000}),started=performance.now();
    let snapshotReads=0;const guardAssets=x.state.assets.map(asset=>new Proxy(asset,{get(target,key,receiver){if(typeof key==='string'&&key!=='toJSON')snapshotReads++;return Reflect.get(target,key,receiver);}}));x.state.assets=guardAssets;
    const job=x.s.createSimulationSliceJob(30,{from:x.state.simSeconds,to:x.state.simSeconds+30,speed:30,boundary:{day:null,hour:null}});
    assert.equal(snapshotReads,0,'large-fleet guards are not captured by the job constructor');
    assert.equal(job.runChunk(32,{deadline:Infinity}),false,'large-fleet snapshot capture yields after the configured chunk count');
    assert(snapshotReads>0&&snapshotReads<32*40,'the first chunk reads only its bounded portion of the fleet');assert.equal(x.workerMessages.length,0,'the worker starts only after a complete immutable input snapshot exists');
    await prepareFully(job);assert.equal(x.asset.progress,.1,'no live asset changes before the owner transaction');
    const result=job.finish();assert.equal(result.committed,true);assert(x.asset.progress>.1);assert.equal(x.state.simSeconds,7230);assert.equal(x.state.simulationKernel.lastAtomicCommit.assets,20000);assert.equal(x.workerMessages.length,79,'20,000 assets stay within the 256-row Worker batch limit');
    console.log(JSON.stringify({suite:'build340-simulation-app-worker-20k',assets:20000,workerBatches:x.workerMessages.length,nodeElapsedMs:+(performance.now()-started).toFixed(2),environment:`Node ${process.version}; app owner transaction integration; synthetic state only; no DOM, native persistence or iPhone`}));
  }
  {
    const x=setup(),job=x.s.createSimulationSliceJob(30,{from:x.state.simSeconds,to:x.state.simSeconds+30,speed:30,boundary:{day:null,hour:null}});await prepare(job);
    const revisionBefore=x.s.GH_TRANSACTION_CORE.revision(x.state);
    assert.equal(x.asset.progress,.1,'worker planning never mutates a live asset before commit');
    const result=job.finish();assert.equal(result.committed,true);assert(x.asset.progress>.1);assert.equal(x.state.simSeconds,7230);assert.equal(x.workers.length,1);
    assert.equal(x.s.GH_TRANSACTION_CORE.revision(x.state),revisionBefore+1,'only the atomic owner commit advances the runtime target revision');
    assert.equal(x.state.simulationKernel.lastAtomicCommit.assets,1);
    console.log('PASS worker plan crosses the existing validation and atomic simulation transaction before asset/time writes');
  }
  {
    const x=setup(),job=x.s.createSimulationSliceJob(30,{from:x.state.simSeconds,to:x.state.simSeconds+30,speed:30,boundary:{day:null,hour:null}});await prepare(job);
    const before=JSON.stringify(x.state),execute=x.s.GH_FINANCE_CORE.execute;
    x.s.GH_FINANCE_CORE.execute=(ctx,command,...args)=>{if(command==='apply-simulation-journal')throw new Error('injected-finance-owner-failure');return execute(ctx,command,...args);};
    let failure;try{job.finish();}catch(error){failure=error;}finally{x.s.GH_FINANCE_CORE.execute=execute;}
    assert.match(String(failure?.message||failure),/injected-finance-owner-failure/);assert.equal(JSON.stringify(x.state),before,'a failed finance owner rolls the whole simulation transaction back byte-for-byte');
    console.log('PASS worker-derived asset plan retains full transaction rollback when downstream finance application fails');
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
