'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const ROOT=process.env.GH_TEST_SOURCE_DIR;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
function fragment(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,`${start} -> ${end}`);return app.slice(a,b);}
const e=scenario();e.load('simulation-core');
e.manualPurchase(1);e.s.GH_REALISM.onSimulationTime(e.state,60);
const seed=structuredClone(e.state.assets[0]);
const route={id:'R600',type:'air',routeMode:'air',ownerCompanyId:'air',fromFacility:'B1',toFacility:'B1',route:[[24.7,46.7],[25.1,47.2]],tripSeconds:10000,distanceKm:700,dwellHours:.5};
e.state.assets=Array.from({length:600},(_,i)=>({...structuredClone(seed),id:`AIR600-${i}`,name:`AIR600-${i}`,routeId:'R600',routeSignature:'R600',phase:'moving',progress:(i%60)/60,tripSeconds:10000,ownerCompanyId:'air',company:'air',catalogId:e.item.id,simulationFault:null,crewBlocked:false}));
e.state.simSeconds=0;e.state.lastFinancialDay=0;e.state.lastMarketHour=0;e.state.speed=0;e.state.todayProfit=0;
let wall=0,marketCalls=0,dayCalls=0,commitCount=0;
e.s.performance={now:()=>wall};
Object.assign(e.s,{state:e.state,COMPANY_PLATFORM:e.s.GH_COMPANY_PLATFORM,routeTemplates:{R600:route},competitorAssets:[],BASE_ROUTE_IDS:new Set(['R600']),clone:v=>v===undefined?undefined:structuredClone(v),routeDistance:()=>700,queueAssetSaleFinalize:()=>{},diag:()=>{},
 processFinancialDay(day){assert.equal(day,e.state.lastFinancialDay+1);e.state.lastFinancialDay=day;dayCalls++;},
 processMarket(hour){assert.equal(hour,e.state.lastMarketHour+1);e.state.lastMarketHour=hour;marketCalls++;},
 processAssetDraft(asset,seconds,effects){wall+=0.02;const owner='air',before=Number(asset.progress)||0;asset.progress=(before+seconds/10000)%1;const revenue=seconds/36,margin=revenue*.35;effects.todayProfit+=margin;effects.sectorProfit[owner]=(effects.sectorProfit[owner]||0)+margin;effects.tripProfit[owner]=(effects.tripProfit[owner]||0)+margin;effects.tripRevenue[owner]=(effects.tripRevenue[owner]||0)+revenue;effects.tripFuel[owner]=(effects.tripFuel[owner]||0)+revenue*.25;effects.tripMaintenance[owner]=(effects.tripMaintenance[owner]||0)+revenue*.15;effects.tripCount[owner]=(effects.tripCount[owner]||0)+1;effects.cash[owner]=(effects.cash[owner]||0)+margin;effects.groupValue+=margin*.08;}
});
vm.runInContext(fragment('  function makeSimulationEffects()', '  // Pure simulation draft:'),e.s);
vm.runInContext(fragment('  const SIMULATION_TRANSACTION_SCOPE=', "  if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core compatibility"),e.s);
const rateMatch=app.match(/const SIMULATION_RATE_BY_LEVEL=Object\.freeze\(\{([^}]+)\}\)/);assert(rateMatch);const rates=Object.values(Object.fromEntries([...rateMatch[1].matchAll(/(\d+)\s*:\s*(\d+)/g)].map(m=>[Number(m[1]),Number(m[2])]))).filter(Number);const fastest=Math.max(...rates),fallback=Math.min(...rates);
const advanceEvents=[];const engine=e.s.GH_SIMULATION_CORE.create({getSimTime:()=>e.state.simSeconds,setSimTime:v=>{e.state.simSeconds=v;},getSpeed:()=>0,setSpeed:()=>{},getManualSliceLimit:()=>Math.min(e.s.GH_REALISM.simulationSliceLimit(e.state),e.s.GH_MOBILITY_CORE.simulationSliceLimit(e.state)),createSliceJob:(slice,meta)=>{const job=e.s.createSimulationSliceJob(slice,meta),finish=job.finish;job.finish=info=>{const out=finish.call(job,info);if(out?.committed)commitCount++;return out;};return job;},onAdvance:x=>advanceEvents.push({...x})},{nowMs:()=>wall,allowedSpeeds:[0,...rates],fallbackSpeed:fallback,frameBudgetMs:4,chunkItems:32,manualBatchSeconds:3600,manualMinBatchSeconds:300,manualRetryLimit:3});
const beforeRevenue=Number(e.state.tripRevenueAccrued?.air)||0,beforeProgress=e.state.assets.map(a=>a.progress);
assert.equal(engine.advanceTo(86400,{speed:fastest,batchSeconds:3600}).accepted,true);
let frames=0;const started=performance.now();
for(;frames<50000&&engine.snapshot().manualAdvance;frames++){wall+=16;engine.frame(wall);}const elapsed=performance.now()-started;
const snap=engine.snapshot(),afterRevenue=Number(e.state.tripRevenueAccrued?.air)||0,moved=e.state.assets.reduce((n,a,i)=>n+(Math.abs(Number(a.progress)-Number(beforeProgress[i]))>1e-9?1:0),0);
assert.equal(e.state.simSeconds,86400,'calendar must reach the requested day');assert.equal(snap.manualAdvance,null);assert.equal(snap.lastAdvanceFailure??null,null);assert.equal(dayCalls,1);assert.equal(marketCalls,24);assert.equal(e.state.lastFinancialDay,1);assert.equal(e.state.lastMarketHour,24);assert(afterRevenue>beforeRevenue,'trip revenue must publish with committed fleet motion');assert(moved>0,'asset progress must publish from the same committed slices');assert.equal(commitCount,24,'one-day calendar advance must use the 24 exact hourly atomic intervals when no chunk pressure exists');assert(advanceEvents.some(e=>e.completed===true));
console.log(JSON.stringify({suite:'build334-600-air-calendar-regression',environment:`node ${process.version}; actual slice/transaction/finance owners; synthetic asset economics; no DOM/native/iPhone`,assets:e.state.assets.length,frames,commitCount,dayCalls,marketCalls,revenueDelta:afterRevenue-beforeRevenue,movedAssets:moved,elapsedMs:+elapsed.toFixed(2),stateBytes:Buffer.byteLength(JSON.stringify(e.state)),kernel:snap},null,2));
