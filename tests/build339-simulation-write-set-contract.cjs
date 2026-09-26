'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {ROOT}=require('./helpers/core-harness'),{scenario}=require('./helpers/business-scenario');
const app=fs.readFileSync(require('node:path').join(ROOT,'WebApp/app.js'),'utf8'),results=[];
function fragment(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,`missing app fragment ${start}`);return app.slice(a,b);}
function environment(count=2){
 const e=scenario();e.manualPurchase(1);e.s.GH_REALISM.onSimulationTime(e.state,60);const seed=structuredClone(e.state.assets[0]);
 e.state.assets=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:`B339-${i}`,routeId:'B339-R',phase:'moving',progress:0}));e.state.speed=0;e.state.todayProfit=0;
 const route={id:'B339-R',type:'air',routeMode:'air',ownerCompanyId:'air',route:[[24.7,46.7],[25,47]],tripSeconds:1000,distanceKm:100};
 Object.assign(e.s,{state:e.state,COMPANY_PLATFORM:e.s.GH_COMPANY_PLATFORM,routeTemplates:{'B339-R':route},competitorAssets:[],BASE_ROUTE_IDS:new Set(['B339-R']),clone:value=>value===undefined?undefined:structuredClone(value),routeDistance:()=>1000,queueAssetSaleFinalize:()=>{},processFinancialDay:()=>{},processMarket:()=>{},processAssetDraft:(asset,_seconds,effects)=>{asset.progress=.1;effects.todayProfit+=1;effects.sectorProfit.air=(effects.sectorProfit.air||0)+1;},SIMULATION_ASSET_ENGINE:require('../WebApp/simulation-asset-core.js'),simulationAssetRuntimeContext:()=>({workerCompatible:false}),diag:()=>{},__GH_BUILD339_WRITE_AUDIT__:true});
 vm.runInContext(fragment('  function makeSimulationEffects()', '  // Pure simulation draft:'),e.s);
 vm.runInContext(fragment('  const SIMULATION_TRANSACTION_SCOPE=', "  if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core compatibility"),e.s);
 return {...e,route,job:meta=>e.s.createSimulationSliceJob(30,{from:e.state.simSeconds,to:e.state.simSeconds+30,speed:30,...meta})};
}
function complete(job){while(!job.runChunk(32)){}return job;}
function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}

test('ordinary simulation slice writes remain inside the declared transaction roots',()=>{
 const e=environment(3),job=complete(e.job()),out=job.finish();assert.equal(out.committed,true);const metric=e.s.GH_TRANSACTION_CORE.telemetry().last;assert(metric.writeAudit?.enabled);assert.equal(metric.fullSnapshot,false);assert.deepEqual(metric.writeAudit.undeclaredRoots,[]);assert(metric.writeAudit.mutatedRoots.includes('assets'));assert(metric.writeAudit.mutatedRoots.includes('simSeconds'));return metric.writeAudit;
});

test('boundary audit discovers root changes without weakening full rollback',()=>{
 const e=environment(1);e.s.processFinancialDay=()=>{e.state.lastFinancialDay=(e.state.lastFinancialDay||0)+1;e.state.finance.auditProbe=(e.state.finance.auditProbe||0)+1;};e.s.processMarket=()=>{e.state.lastMarketHour=(e.state.lastMarketHour||0)+1;e.state.market={probe:true};};
 const job=complete(e.job({boundary:{day:1,hour:24}})),out=job.finish();assert.equal(out.committed,true);const metric=e.s.GH_TRANSACTION_CORE.telemetry().last;assert.equal(metric.fullSnapshot,true);assert.equal(metric.writeAudit.declaredRoots,null);for(const root of ['lastFinancialDay','lastMarketHour','finance','market'])assert(metric.writeAudit.mutatedRoots.includes(root),`missing ${root}`);return metric.writeAudit;
});

const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build339-simulation-write-set-contract',passed,total:results.length,results},null,2));if(passed!==results.length)process.exitCode=1;
