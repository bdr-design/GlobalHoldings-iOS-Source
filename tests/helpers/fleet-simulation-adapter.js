'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {scenario}=require('./business-scenario');
const fixture=require('./fleet-fixture');

const ROOT=path.resolve(__dirname,'../..');
const APP=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
function fragment(start,end){
  const a=APP.indexOf(start),b=APP.indexOf(end,a);
  assert(a>=0&&b>a,`missing app fragment ${start}`);
  return APP.slice(a,b);
}
const EFFECTS=fragment('  function makeSimulationEffects(){','  const SIMULATION_ASSET_FIELDS=');
const JOB=fragment('  const SIMULATION_TRANSACTION_SCOPE=',"  if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core compatibility");

function makeAsset(id,{route=fixture.routes.A1,from=7200,progress=0,phase='moving',...overrides}={}){
  const asset=fixture.make(route.type||route.routeMode,route.id,{id,phase,progress,...overrides});
  if(asset.routeId)fixture.CORE.normalizeAsset(asset,route,null);
  return asset;
}

function createSimulationAdapter({from=7200,assets=null,routeOverrides={},financialDay=null,marketHour=null,deliveryWork=false}={}){
  const e=scenario(),{s,state}=e;
  e.load('simulation-time-core');e.load('simulation-asset-core');e.load('fleet-event-core');
  const templates={...fixture.routes,...routeOverrides};
  const rows=assets||[makeAsset('SIM-ADAPTER-A',{from})];
  state.simSeconds=from;state.lastFinancialDay=financialDay??Math.floor(from/86400);state.lastMarketHour=marketHour??Math.floor(from/3600);
  state.fleet=s.GH_FLEET_STORE.fromAssets(rows,{at:from});delete state.assets;
  Object.assign(s,{
    state,routeTemplates:templates,competitorAssets:[],BASE_ROUTE_IDS:new Set(Object.keys(fixture.routes)),
    clone:value=>value===undefined?undefined:structuredClone(value),
    routeOwnerCompanyId:route=>route?.ownerCompanyId||route?.companyId||route?.company||'',
    routeMatchingFacility:routeId=>templates[routeId]||null,
    simulationAssetRuntimeContext:()=>fixture.context(Number(state.simSeconds)||0),
    catalogItem:()=>null,queueAssetSaleFinalize:()=>{},
    processFinancialDay:day=>{s.__financialDays.push(day);state.lastFinancialDay=day;},
    processMarket:hour=>{s.__marketHours.push(hour);state.lastMarketHour=hour;},
    diag:()=>{},pushAlert:()=>{},routeDistance:()=>0,
    __financialDays:[],__marketHours:[],__GH_BUILD339_WRITE_AUDIT__:true
  });
  if(!deliveryWork)s.GH_REALISM.hasPendingDeliveries=()=>false;
  s.GH_TRANSACTION_CORE.registerJournaledRoot('fleet',{
    begin:target=>s.GH_FLEET_DATA.beginJournal(target),
    commit:(target,_root,journal)=>s.GH_FLEET_DATA.commitJournal(target,journal),
    rollback:(target,_root,journal)=>s.GH_FLEET_DATA.rollbackJournal(target,journal)
  });
  vm.runInContext(`${EFFECTS}\n${JOB}\nthis.__makeFleetSliceJob=(sliceSeconds,meta)=>createSimulationSliceJob(sliceSeconds,meta);this.__resolveFleetRoute=fleetResolveRoute;`,s,{filename:'fleet-simulation-adapter-test.js'});
  return {
    e,s,state,templates,assets:rows,
    makeJob({from:jobFrom=from,to=jobFrom+30,...meta}={}){return s.__makeFleetSliceJob(to-jobFrom,{from:jobFrom,to,speed:30,...meta});}
  };
}

module.exports={createSimulationAdapter,makeAsset,fixture};
