'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const ROOT=process.env.GH_TEST_SOURCE_DIR;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
function fragment(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,`${start} -> ${end}`);return app.slice(a,b);}
const e=scenario();e.load('simulation-core');e.load('simulation-asset-core');
const orderId=e.manualPurchase(1);
const pending=e.state.realism.procurement.deliveries.find(row=>row.id===orderId);assert(pending&&pending.status==='pending');assert.equal(e.s.GH_REALISM.simulationSliceLimit(e.state),600,'pending delivery owner must preserve the former <=600 second calendar cadence');
assert.equal(e.s.GH_MOBILITY_CORE.simulationSliceLimit(e.state),3600,'inactive mobility must not constrain unrelated fleet simulation');
e.state.simSeconds=0;e.state.lastFinancialDay=0;e.state.lastMarketHour=0;e.state.speed=0;
let wall=0,marketCalls=0,commitCount=0;const intervals=[];
e.s.performance={now:()=>wall};
Object.assign(e.s,{state:e.state,COMPANY_PLATFORM:e.s.GH_COMPANY_PLATFORM,SIMULATION_ASSET_ENGINE:e.s.GH_SIMULATION_ASSET_CORE,simulationAssetRuntimeContext:()=>({workerCompatible:false}),routeTemplates:{},competitorAssets:[],BASE_ROUTE_IDS:new Set(),clone:v=>v===undefined?undefined:structuredClone(v),routeDistance:()=>0,queueAssetSaleFinalize:()=>{},diag:()=>{},processFinancialDay(day){e.state.lastFinancialDay=day;},processMarket(hour){assert.equal(hour,e.state.lastMarketHour+1);e.state.lastMarketHour=hour;marketCalls++;},processAssetDraft(){}});
vm.runInContext(fragment('  function makeSimulationEffects()', '  // Pure simulation draft:'),e.s);
vm.runInContext(fragment('  const SIMULATION_TRANSACTION_SCOPE=', "  if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core compatibility"),e.s);
const advanceEvents=[];const engine=e.s.GH_SIMULATION_CORE.create({
 getSimTime:()=>e.state.simSeconds,setSimTime:v=>{e.state.simSeconds=v;},getSpeed:()=>0,setSpeed:()=>{},
 getManualSliceLimit:()=>Math.min(e.s.GH_REALISM.simulationSliceLimit(e.state),e.s.GH_MOBILITY_CORE.simulationSliceLimit(e.state)),
 createSliceJob:(slice,meta)=>{const job=e.s.createSimulationSliceJob(slice,meta),finish=job.finish;job.finish=info=>{const out=finish.call(job,info);if(out?.committed){commitCount++;intervals.push([meta.from,meta.to]);}return out;};return job;},onAdvance:event=>advanceEvents.push({...event})
},{nowMs:()=>wall,allowedSpeeds:[0,30,120,300,600],fallbackSpeed:30,frameBudgetMs:4,chunkItems:32,manualBatchSeconds:3600,manualMinBatchSeconds:300,manualRetryLimit:3});
assert.equal(engine.advanceTo(3600,{speed:600,batchSeconds:3600}).accepted,true);
for(let frame=0;frame<10000&&engine.snapshot().manualAdvance;frame++){wall+=16;engine.frame(wall);}
assert.equal(e.state.simSeconds,3600);assert.equal(engine.snapshot().manualAdvance,null);assert.equal(engine.snapshot().lastAdvanceFailure??null,null);
const delivered=e.state.realism.procurement.deliveries.find(row=>row.id===orderId);assert.equal(delivered.status,'delivered','pending asset must be delivered before calendar widens its batch');assert(Number(delivered.deliveredAtSeconds)<=600,'delivery must not be delayed to the next hour by wide calendar batching');
assert.deepEqual(intervals,[[0,600],[600,3600]],'after delivery clears, owner must release the calendar back to the next hourly boundary');assert.equal(commitCount,2);assert.equal(marketCalls,1);assert.equal(e.s.GH_REALISM.simulationSliceLimit(e.state),3600);
e.state.mobility={status:'active',vehicles:[{id:'MOB-CADENCE-PROBE'}]};assert.equal(e.s.GH_MOBILITY_CORE.simulationSliceLimit(e.state),600,'active mobility fleet must preserve the former <=600 second calendar cadence');e.state.mobility={vehicles:[]};
assert(advanceEvents.some(event=>event.completed===true));
// Static host guard: the real app adapter must combine both temporal owners.
assert(/getManualSliceLimit:\(\)=>\{[\s\S]{0,600}GH_REALISM\?\.simulationSliceLimit[\s\S]{0,600}GH_MOBILITY_CORE\?\.simulationSliceLimit/.test(app),'app must consult both sub-hour owners before selecting a wide calendar slice');
console.log(JSON.stringify({suite:'build334-calendar-owner-cadence',pendingDeliveryProtected:true,intervals,deliveredAtSeconds:delivered.deliveredAtSeconds,commitCount,marketCalls,scope:'actual delivery owner + actual simulation transaction; Node contract test, not iPhone performance'},null,2));
