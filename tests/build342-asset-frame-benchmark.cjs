'use strict';
// Run with: node tests/build342-asset-frame-benchmark.cjs [fleet-size]
// Synthetic Node timing only. Run a separate WKWebView/iPhone trace for approval.
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
const count=Number(process.argv[2]||3380),hours=10*24,ownerParityHours=1,longOwnerParityHours=24,longOwnerAssetCount=128;
assert(Number.isSafeInteger(count)&&count>0&&count<=10000,'fleet-size must be 1..10000');

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
  if(kernelOwner){e.state=e.s.GH_TRANSACTION_CORE.enableKernelOwner(e.state);e.s.state=e.state;e.s.GH_MOBILITY_CORE.ensure(e.state);assert.equal(e.s.GH_TRANSACTION_CORE.kernelOwnerStatus(e.state).enabled,true);}
  else e.s.GH_TRANSACTION_CORE.enableKernelShadow(e.state);
  return e;
}


const {performance}=require('node:perf_hooks');
for(const fleet of [count]){
  const e=makeEnvironment(true,fleet),t=e.s.GH_TRANSACTION_CORE,rows=[],allChunks=[];e.s.GH_DIAGNOSTICS={recorderIsActive:()=>true};
  for(let hour=0;hour<24;hour++){
    const from=e.state.simSeconds,to=from+30,created=performance.now(),job=e.s.createSimulationSliceJob(30,{from,to,speed:30,boundary:{day:null,hour:null}}),createMs=performance.now()-created;
    let result,turns=0,planner=performance.now(),chunks=[];do{const frameStart=performance.now();result=job.runChunk(64,{deadline:frameStart+4});const elapsed=performance.now()-frameStart;chunks.push(elapsed);allChunks.push(elapsed);assert.notEqual(result?.pending,true);assert(++turns<500);}while(result!==true);
    const planMs=performance.now()-planner,finishStart=performance.now(),outcome=job.finish(),finishMs=performance.now()-finishStart;
    assert.equal(outcome.committed,true,JSON.stringify(outcome));rows.push({createMs,planMs,finishMs,turns,chunkMax:Math.max(...chunks),phases:(t.telemetry().lastSimulation?.phaseBreakdown||[]).filter(x=>x.durationMs>1).map(x=>[x.name,+x.durationMs.toFixed(2)])});
  }
  const sum=k=>rows.reduce((n,v)=>n+v[k],0),sort=k=>rows.map(v=>v[k]).sort((a,b)=>a-b),orderedChunks=allChunks.sort((a,b)=>a-b);
  console.log(JSON.stringify({environment:`Node ${process.version}; controlled synthetic finance, ${fleet.toLocaleString('en-US')} air assets, no DOM/native/iPhone`,fleet,slices:rows.length,chunkBudgetMs:4,
    createTotalMs:+sum('createMs').toFixed(1),planningTotalMs:+sum('planMs').toFixed(1),
    chunkP95Ms:+orderedChunks[Math.floor(orderedChunks.length*.95)].toFixed(2),chunkMaxMs:+orderedChunks.at(-1).toFixed(2),
    finishP50Ms:+sort('finishMs')[12].toFixed(2),finishP95Ms:+sort('finishMs')[22].toFixed(2),finishMaxMs:+sort('finishMs').at(-1).toFixed(2),
    slowFinishes:rows.map((x,i)=>({slice:i,ms:+x.finishMs.toFixed(2),phases:x.phases})).filter(x=>x.ms>=5)
  },null,2));
}
