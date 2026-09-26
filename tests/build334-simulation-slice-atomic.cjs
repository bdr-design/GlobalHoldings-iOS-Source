'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {ROOT}=require('./helpers/core-harness'),{scenario}=require('./helpers/business-scenario');
const app=fs.readFileSync(require('node:path').join(ROOT,'WebApp/app.js'),'utf8'),results=[];
function fragment(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,`missing app fragment ${start}`);return app.slice(a,b);}
function environment(count=1){
 const e=scenario();e.manualPurchase(1);e.s.GH_REALISM.onSimulationTime(e.state,60);const seed=structuredClone(e.state.assets[0]);
 e.state.assets=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:`AUDIT-${i}`,routeId:'AUDIT-R',phase:'moving',progress:0}));e.state.speed=0;e.state.todayProfit=0;
 const route={id:'AUDIT-R',type:'air',routeMode:'air',ownerCompanyId:'air',route:[[24.7,46.7],[25,47]],tripSeconds:1000,distanceKm:100};
 Object.assign(e.s,{state:e.state,COMPANY_PLATFORM:e.s.GH_COMPANY_PLATFORM,SIMULATION_ASSET_ENGINE:require('../WebApp/simulation-asset-core.js'),simulationAssetRuntimeContext:()=>({workerCompatible:false}),routeTemplates:{'AUDIT-R':route},competitorAssets:[],BASE_ROUTE_IDS:new Set(['AUDIT-R']),clone:value=>value===undefined?undefined:JSON.parse(JSON.stringify(value)),routeDistance:()=>1000,queueAssetSaleFinalize:()=>{},processFinancialDay:()=>{},processMarket:()=>{},processAssetDraft:(asset)=>{asset.progress=.1;},diag:(type,detail)=>{e.state.diagnostics??={events:[]};e.state.diagnostics.events??=[];e.state.diagnostics.events.push({type,detail});}});
 vm.runInContext(fragment('  function makeSimulationEffects()', '  // Pure simulation draft:'),e.s);
 vm.runInContext(fragment('  const SIMULATION_TRANSACTION_SCOPE=', "  if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core compatibility"),e.s);
 return {...e,route,job:meta=>e.s.createSimulationSliceJob(30,{from:e.state.simSeconds,to:e.state.simSeconds+30,speed:30,...meta})};
}
function complete(job){while(!job.runChunk(32)){}return job;}
function test(name,fn){fn();results.push({name,ok:true});}
test('failed asset discards all partial effects while a healthy asset continues; chunks do not publish',()=>{
 const e=environment(2);e.s.processAssetDraft=(asset,_seconds,effects)=>{if(asset.id==='AUDIT-0'){asset.progress=.75;effects.todayProfit=321;effects.groupValue=27;effects.cash.air=123;effects.saleIds.push(asset.id);throw new Error('audit-asset-fault');}asset.progress=.2;};
 const before=JSON.stringify(e.state),cash=e.s.GH_FINANCE_CORE.operating(e.state,'air'),value=e.state.groupValue,profit=e.state.todayProfit;const job=complete(e.job());assert.equal(JSON.stringify(e.state),before);
 assert.equal(job.finish().committed,true);assert.equal(e.state.assets[0].progress,0);assert.equal(e.state.assets[1].progress,.2);assert.equal(e.state.assets[0].simulationFault.code,'ASSET_SIMULATION_ISOLATED');assert.equal(e.state.groupValue,value);assert.equal(e.state.todayProfit,profit);assert.equal(e.s.GH_FINANCE_CORE.operating(e.state,'air'),cash);
});
for(const kind of ['asset','added asset','duplicate ID','nested route','economic context'])test(`optimistic validation rejects ${kind} changes without advancing time`,()=>{
 const e=environment(2),job=complete(e.job());
 if(kind==='asset')e.state.assets[0].fuel=77;
 if(kind==='added asset')e.state.assets.push({...structuredClone(e.state.assets[0]),id:'AUDIT-NEW'});
 if(kind==='duplicate ID')e.state.assets[1].id=e.state.assets[0].id;
 if(kind==='nested route')e.route.route[0][0]+=1;
 if(kind==='economic context')e.state.research={efficiency:73};
 const before=JSON.stringify(e.state);assert.equal(job.finish().committed,false);assert.equal(JSON.stringify(e.state),before);assert.equal(e.state.simSeconds,0);
});
test('late daily-boundary exception restores every state root',()=>{
 const e=environment();e.s.processFinancialDay=()=>{e.state.cash=123;e.state.companyFinance.air.accounts[0].balance=456;e.state.newBoundaryRoot={partial:true};throw new Error('audit-boundary-fault');};
 const before=JSON.stringify(e.state),job=complete(e.job({boundary:{day:1,hour:24}}));assert.throws(()=>job.finish(),/audit-boundary-fault/);assert.equal(JSON.stringify(e.state),before);
});
test('chunk deadline is observed between assets without starving the first item',()=>{
 const e=environment(50);let clock=0,processed=0;e.s.performance={now:()=>clock};e.s.processAssetDraft=()=>{processed++;clock+=5;};const job=e.job();assert.equal(job.runChunk(32,{deadline:4}),false);assert.equal(processed,0,'the bounded source snapshot yields before planning');assert.equal(job.runChunk(32,{deadline:4}),false);assert.equal(processed,1,'the first actual asset plan runs, then the frame deadline is observed');job.cancel();assert.equal(e.state.simSeconds,0);
});
test('shared route geometry is serialized once at snapshot and once at validation',()=>{
 const e=environment(100);let reads=0;const points=e.route.route;Object.defineProperty(e.route,'route',{enumerable:true,get(){reads++;return points;}});assert.equal(complete(e.job()).finish().committed,true);assert.equal(reads,2);
});
console.log(JSON.stringify({suite:'build334-simulation-slice-atomic',scope:'actual app slice factory and business owners; injected asset work/faults and clock; not full-device timing',passed:results.length,total:results.length,results},null,2));
