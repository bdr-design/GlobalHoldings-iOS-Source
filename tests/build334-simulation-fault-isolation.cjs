'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness,minimal}=require('./helpers/core-harness');
const app=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp/app.js'),'utf8');
function range(start,end){const a=app.indexOf(start),b=app.indexOf(end,a+start.length);assert(a>=0&&b>a,`missing source range ${start}`);return app.slice(a,b);}
const helper=range('  function makeSimulationEffects()','  function simulationCalendarDate(');
const job=range('  const SIMULATION_TRANSACTION_SCOPE=','  if(!window.GH_TRANSACTION_CORE?.execute)throw new Error(\'Transaction Core compatibility');
function run({faultAt=1,lateFailure=false}={}){
  const {s}=harness(['transaction-core']),state=minimal();Object.assign(state,{speed:1,todayProfit:0,groupValue:0,simulationWorld:{competitorAssets:[]},simSeconds:0});
  const asset=id=>({id,name:id,type:'air',assetMode:'air',ownerCompanyId:'air',phase:'moving',progress:0,fuel:100,condition:100,tripSeconds:60,routeId:'R',dwellRemaining:0,staffing:{mode:'automatic-fixed',ready:true},specs:{seats:1}});
  state.assets=[asset('faulted'),asset('healthy')];const before=structuredClone(state),calls={};
  Object.assign(s,{state,clone:v=>v===undefined?undefined:JSON.parse(JSON.stringify(v)),routeTemplates:{R:{tripSeconds:60,dwellHours:0,fromFacility:'A',toFacility:'B'}},competitorAssets:state.simulationWorld.competitorAssets,
    COMPANY_PLATFORM:{listInstances:()=>[]},normalizeAsset:()=>{},clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),assetOwnerCompanyId:a=>a.ownerCompanyId,
    computeTripEconomics:a=>{calls[a.id]=(calls[a.id]||0)+1;if(a.id==='faulted'&&calls[a.id]===faultAt)throw new Error('injected-trip-failure');return {revenue:10,fuelCost:1,maintReserve:1,crewCost:1,margin:7,cashContribution:8};},
    diag:()=>{},fmtMoney:String,formatDuration:String,routeDistance:()=>1,routeMatchingFacility:()=>({}),loadLabel:()=>'',findFacility:()=>({owned:true}),BASE_ROUTE_IDS:new Set(['R']),queueAssetSaleFinalize:()=>{},
    processFinancialDay:()=>{throw new Error('unexpected-boundary');},processMarket:()=>{throw new Error('unexpected-boundary');}
  });
  s.GH_FLEET_CORE={departureDelay:()=>0,departDraft:a=>{a.phase='moving';a.progress=0;}};
  s.GH_FINANCE_CORE={execute:(_ctx,_name,{journal})=>{state.todayProfit+=journal.todayProfit;state.testJournal=structuredClone(journal);}};
  s.GH_CORPORATE_CORE={execute:(_ctx,_name,{delta})=>{state.groupValue+=delta;}};
  s.GH_OPERATIONS_CORE={execute:(_ctx,_name,{text})=>(state.alerts||=[]).push(text)};
  s.GH_REALISM={onSimulationTime:()=>{if(lateFailure)throw new Error('injected-delivery-failure');}};
  vm.runInContext(helper+'\n'+job+'\nglobalThis.createJob=createSimulationSliceJob;',s);
  const to=faultAt===1?60:180,j=s.createJob(to,{speed:30,from:0,to,boundary:{day:null,hour:null}});
  while(!j.runChunk(1)){};
  if(lateFailure){assert.throws(()=>j.finish(),/injected-delivery-failure/);assert.deepEqual(JSON.parse(JSON.stringify(state.assets)),before.assets);assert.equal(state.simSeconds,0);assert.equal(state.todayProfit,0);return;}
  assert.equal(j.finish().committed,true);
  const broken=state.assets[0];assert.equal(broken.simulationFault.code,'ASSET_SIMULATION_ISOLATED');assert.equal(broken.crewBlocked,true);
  for(const field of ['phase','progress','fuel','condition','routeId','dwellRemaining'])assert.equal(broken[field],before.assets[0][field],`faulted asset leaked partial field: ${field}`);
  assert.equal(broken.lastTrip,undefined);assert.equal(state.todayProfit,7*calls.healthy,'only healthy trips may accrue');
  assert.equal(state.simSeconds,to);assert.equal(state.assets[1].simulationFault,undefined);
}
run();run({faultAt:2});run({lateFailure:true});console.log(JSON.stringify({suite:'simulation-fault-isolation',passed:3,total:3}));
