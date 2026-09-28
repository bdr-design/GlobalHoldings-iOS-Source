'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {ROOT}=require('./helpers/core-harness');
const {scenario}=require('./helpers/business-scenario');
const GH_KERNEL=require('../WebApp/kernel-core.js');
const GH_SIMULATION_ASSET_CORE=require('../WebApp/simulation-asset-core.js');

const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
function fragment(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,`missing app simulation fragment: ${start}`);return app.slice(a,b);}
const route={id:'B342-R',type:'air',routeMode:'air',ownerCompanyId:'air',from:'Riyadh',to:'Jeddah',fromFacility:'F-A',toFacility:'F-B',distanceKm:100,effectiveSpeedKmh:100,tripSeconds:4000,dwellHours:.1};
const count=3380,hours=10*24,ownerParityHours=1,longOwnerParityHours=24,longOwnerAssetCount=128;

function makeEnvironment(kernelOwner=false,assetCount=count){
  const e=scenario();e.manualPurchase(1);e.s.GH_REALISM.onSimulationTime(e.state,60);
  const seed=structuredClone(e.state.assets[0]);e.state.assets=Array.from({length:assetCount},(_,index)=>({
    ...structuredClone(seed),id:`B342-${String(index).padStart(5,'0')}`,name:`أصل ${index}`,type:'air',assetMode:'air',ownerCompanyId:'air',assetClass:'aircraft',operationProfileId:'air-operations',
    phase:'moving',routeId:route.id,routeSignature:'B342-ROUTE-SIGNATURE',routeSlot:index%3,reverse:false,progress:(index%10)/10,fuel:71+(index%20),condition:96,
    from:route.from,to:route.to,baseFacility:route.fromFacility,load:'82 / 100 راكب',dwellRemaining:0,departureScheduled:false,
    salePending:false,tripSeconds:route.tripSeconds,specs:{capacity:100,capacityUnit:'راكب',speedKmh:100,fuelBurnKgPerKm:2,yieldMultiplier:1.1,cargo:false},
    staffing:{mode:'automatic-fixed',ready:true,monthlyPayroll:120000},simCarrySeconds:0,crewBlocked:false
  }));
  e.state.simSeconds=0;e.state.speed=0;e.state.lastFinancialDay=0;e.state.lastMarketHour=0;
  const engineContext={
    companies:{air:{serviceLevel:91,automation:23}},research:{efficiency:37,automation:21,cleanEnergy:18},sustainability:{safShare:32,shorePower:17,electricRoadShare:12},
    economy:{jetFuel:.91,bunker:700,diesel:1.05,airDemand:108,seaDemand:96,roadDemand:103},
    market:{share:{air:9},competitorPressure:{air:42}},reputation:{air:76},ownedFacilities:['F-B'],simSeconds:0,workerCompatible:false
  };
  Object.assign(e.s,{
    state:e.state,COMPANY_PLATFORM:e.s.GH_COMPANY_PLATFORM,routeTemplates:{[route.id]:route},competitorAssets:[],
    GH_KERNEL:require('../WebApp/kernel-core.js'),
    BASE_ROUTE_IDS:new Set([route.id]),clone:value=>{if(value===undefined)return undefined;try{return structuredClone(value);}catch(_error){return JSON.parse(JSON.stringify(value));}},routeDistance:()=>route.distanceKm,
    queueAssetSaleFinalize:()=>{},processFinancialDay:day=>{e.state.lastFinancialDay=day;},processMarket:hour=>{e.state.lastMarketHour=hour;},
    SIMULATION_ASSET_ENGINE:GH_SIMULATION_ASSET_CORE,simulationAssetRuntimeContext:()=>engineContext,diag:()=>{},
    processAssetDraft:(asset,seconds,effects,meta)=>{
      const result=GH_SIMULATION_ASSET_CORE.processRow({id:asset.id,asset,route:route.id===asset.routeId?route:null,catalogSpecs:null,departureDelay:0},{simAdvance:seconds,simMeta:{from:meta.from,to:meta.to},context:engineContext});
      for(const field of GH_SIMULATION_ASSET_CORE.WRITE_FIELDS)asset[field]=result.patch[field];
      e.s.mergeSimulationEffects(effects,result.effects);
    }
  });
  vm.runInContext(fragment('  function makeSimulationEffects()','  // Pure simulation draft:'),e.s);
  vm.runInContext(fragment('  const SIMULATION_TRANSACTION_SCOPE=',"  if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core compatibility"),e.s);
  if(kernelOwner){e.state=e.s.GH_TRANSACTION_CORE.enableKernelOwner(e.state);e.s.state=e.state;assert.equal(e.s.GH_TRANSACTION_CORE.kernelOwnerStatus(e.state).enabled,true);}
  else e.s.GH_TRANSACTION_CORE.enableKernelShadow(e.state);
  return e;
}

const legacy=makeEnvironment(),e=makeEnvironment(true),tx=e.s.GH_TRANSACTION_CORE,state=e.state;
const ownerStorage=tx.kernelOwnerStatus(state),assetColumnSection=ownerStorage.columnSections.find(row=>row.name==='assets');
assert.equal(assetColumnSection?.fields.length,9,'the live 3,380-row application fleet is migrated into nine typed hot columns');
assert.equal(ownerStorage.typedArrayBytes,9*count*(Float64Array.BYTES_PER_ELEMENT+Uint8Array.BYTES_PER_ELEMENT),'live asset columns use Float64 values and Uint8 presence tags');
assert.equal(assetColumnSection.redundantObjectFields,0,'all nine live hot values are removed from the 3,380 object backing rows');
const ownerLegacy=makeEnvironment(false,longOwnerAssetCount),ownerLive=makeEnvironment(true,longOwnerAssetCount),ownerLiveTx=ownerLive.s.GH_TRANSACTION_CORE;
for(let hour=1;hour<=hours;hour++){
  const to=hour*3600,day=to%86400===0?to/86400:null;
  const commitSlice=(env,label)=>{
    const from=env.state.simSeconds,job=env.s.createSimulationSliceJob(3600,{from,to,speed:600,boundary:{day,hour}});
    let finished=false,turns=0;while(!finished){const result=job.runChunk(256);finished=result===true;assert.notEqual(result?.pending,true,`${label} fixture unexpectedly selected an asynchronous worker`);assert(++turns<100,`${label} slice planner did not make bounded progress`);}
    const committed=job.finish();assert.equal(committed.committed,true,`${label} app slice ${hour} did not commit: ${committed.reason||''}`);return committed;
  };
  commitSlice(legacy,'legacy');if(hour<=ownerParityHours)commitSlice(e,'kernel-owner-3380');
  if(hour<=longOwnerParityHours){commitSlice(ownerLegacy,'legacy-owner-parity');commitSlice(ownerLive,'kernel-owner-128');}
  const shadow=legacy.s.GH_TRANSACTION_CORE.kernelShadowStatus(legacy.state);assert.equal(shadow.enabled,true);assert.equal(shadow.checks,hour);assert.equal(shadow.last?.ok,true,`legacy shadow mismatch at hour ${hour}: ${shadow.last?.path||shadow.last?.error||''}`);
  if(hour<=ownerParityHours){
    const ownerState=tx.kernelOwnerState(state),difference=GH_KERNEL.firstDifference(legacy.state,ownerState);
    assert.equal(difference,null,`live kernel owner diverged from legacy app execution at hour ${hour}: ${difference||''}`);
    assert.equal(tx.kernelOwnerStatus(state).transactions,hour,`expected one authoritative kernel transaction per committed slice at hour ${hour}`);
    assert.equal(state.simSeconds,to);assert.equal(state.lastMarketHour,hour);if(day!==null)assert.equal(state.lastFinancialDay,day);
  }
  if(hour<=longOwnerParityHours){const difference=GH_KERNEL.firstDifference(ownerLegacy.state,ownerLiveTx.kernelOwnerState(ownerLive.state));assert.equal(difference,null,`24-slice live owner parity diverged at hour ${hour}: ${difference||''}`);assert.equal(ownerLiveTx.kernelOwnerStatus(ownerLive.state).transactions,hour);}
  if(hour%24===0)console.log(`Build342 app parity progress: day ${hour/24}/${hours/24}; large-owner rows checked=${Math.min(hour,ownerParityHours)*count}; daily-boundary owner rows checked=${Math.min(hour,longOwnerParityHours)*longOwnerAssetCount}`);
}

assert.equal(state.simSeconds,ownerParityHours*3600);assert.equal(ownerLive.state.simSeconds,longOwnerParityHours*3600);assert.equal(legacy.state.simSeconds,10*86400);assert.equal(legacy.s.GH_TRANSACTION_CORE.kernelShadowStatus(legacy.state).checks,hours);
assert.equal(legacy.s.GH_TRANSACTION_CORE.kernelShadowStatus(legacy.state).sections,Object.keys(legacy.state).length);
assert.equal(tx.kernelOwnerStatus(state).schemaVersion,'2.0.0');
assert.equal(ownerLive.state.lastMarketHour,24);assert.equal(ownerLive.state.lastFinancialDay,1,'live kernel owner crosses the real daily callback boundary with full state parity');
console.log(`Build342 app state ownership parity: legacy Full Snapshot 10-day shadow (${hours} commits, ${count} assets), live owner parity 1 commit at ${count} assets and 24 commits across a financial-day boundary at ${longOwnerAssetCount} assets PASS`);

function preparedOwnerJob(env){
  const from=env.state.simSeconds,job=env.s.createSimulationSliceJob(30,{from,to:from+30,speed:30,boundary:{day:null,hour:null}});
  for(let turn=0;turn<50;turn++){
    const result=job.runChunk(16);assert.notEqual(result?.pending,true,'the owner fixture must stay synchronous');
    if(result===true)return job;
  }
  throw new Error('owner-slice-planning-did-not-finish');
}

// Raw metadata and its descriptors cannot bypass the transaction revision.
{
  const env=makeEnvironment(true,2),job=preparedOwnerJob(env),asset=env.state.assets[0];
  const beforeStamp=GH_KERNEL.stampOf(asset),beforeRevision=env.s.GH_TRANSACTION_CORE.inputRevision(env.state);
  assert.throws(()=>{GH_KERNEL.identityOf(asset).specs.capacity+=1;},/kernel-raw-mutation-forbidden/);
  assert.throws(()=>{Object.getOwnPropertyDescriptor(GH_KERNEL.identityOf(asset),'specs').value.capacity+=1;},/kernel-raw-mutation-forbidden/);
  assert.equal(GH_KERNEL.stampOf(asset),beforeStamp,'rejected raw edits preserve the kernel stamp');
  assert.equal(env.s.GH_TRANSACTION_CORE.inputRevision(env.state),beforeRevision,'rejected raw edits preserve the revision');
  Object.getOwnPropertyDescriptor(asset,'specs').value.capacity+=1;
  assert.notEqual(env.s.GH_TRANSACTION_CORE.inputRevision(env.state),beforeRevision,'state descriptors retain tracked nested writes');
  assert.notEqual(GH_KERNEL.stampOf(asset),beforeStamp,'a descriptor write advances the kernel stamp');
  const rejected=job.finish();assert.equal(rejected.committed,false);assert.equal(rejected.reason,'simulation-source-revision-conflict');
  assert.equal(env.state.simSeconds,0,'a tracked input change cannot publish a partial slice');
}

// The faster unchanged-field path remains inside the same rollback boundary.
{
  const env=makeEnvironment(true,2),job=preparedOwnerJob(env),before=JSON.stringify(env.state),execute=env.s.GH_FINANCE_CORE.execute;
  env.s.GH_FINANCE_CORE.execute=(context,command,...args)=>{
    if(command==='apply-simulation-journal')throw new Error('injected-owner-finance-failure');
    return execute(context,command,...args);
  };
  try{assert.throws(()=>job.finish(),/injected-owner-finance-failure/);}
  finally{env.s.GH_FINANCE_CORE.execute=execute;}
  assert.equal(JSON.stringify(env.state),before,'a failed finance owner rolls back assets and time byte-for-byte');
}
console.log('Build342 raw mutation blockade, revision conflict, and atomic failed asset/finance rollback PASS');
