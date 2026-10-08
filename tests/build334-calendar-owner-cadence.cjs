'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createSimulationAdapter}=require('./helpers/fleet-simulation-adapter');

const ROOT=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
const {e,s,state}=createSimulationAdapter({from:0,deliveryWork:true});
e.load('simulation-core');
const orderId=e.manualPurchase(1),pending=state.realism.procurement.deliveries.find(row=>row.id===orderId);
assert(pending&&pending.status==='pending');
assert.equal(s.GH_REALISM.simulationSliceLimit(state),600,'pending delivery owner must preserve the <=600 second calendar cadence');
assert.equal(s.GH_MOBILITY_CORE.simulationSliceLimit(state),3600,'inactive mobility must not constrain unrelated fleet simulation');
state.simSeconds=0;state.lastFinancialDay=0;state.lastMarketHour=0;state.speed=0;

let wall=0,commitCount=0,marketCalls=0;const intervals=[],advanceEvents=[];
Object.assign(s,{
  processMarket:hour=>{state.lastMarketHour=hour;marketCalls++;},
  processFinancialDay:day=>{state.lastFinancialDay=day;}
});
const engine=s.GH_SIMULATION_CORE.create({
  getSimTime:()=>state.simSeconds,setSimTime:value=>{state.simSeconds=value;},
  getSpeed:()=>0,setSpeed:()=>{},
  getManualSliceLimit:()=>Math.min(s.GH_REALISM.simulationSliceLimit(state),s.GH_MOBILITY_CORE.simulationSliceLimit(state)),
  createSliceJob:(slice,meta)=>{
    const job=s.__makeFleetSliceJob(slice,meta),finish=job.finish;
    job.finish=info=>{const out=finish.call(job,info);if(out?.committed){commitCount++;intervals.push([meta.from,meta.to]);}return out;};
    return job;
  },
  onAdvance:event=>advanceEvents.push({...event})
},{
  nowMs:()=>wall,allowedSpeeds:[0,30,120,300,600],fallbackSpeed:30,
  frameBudgetMs:4,manualFrameBudgetMs:20,chunkItems:32,manualChunkItems:64,
  manualBatchSeconds:3600,manualMinBatchSeconds:300,manualRetryLimit:3
});

assert.equal(engine.advanceTo(3600,{speed:600,batchSeconds:3600}).accepted,true);
for(let frame=0;frame<10000&&engine.snapshot().manualAdvance;frame++){wall+=16;engine.frame(wall);}
const snap=engine.snapshot(),delivered=state.realism.procurement.deliveries.find(row=>row.id===orderId);
assert.equal(state.simSeconds,3600);assert.equal(snap.manualAdvance,null);assert.equal(snap.lastAdvanceFailure,null);
assert.equal(delivered.status,'delivered','pending asset must be delivered before calendar widens its batch');
assert(Number(delivered.deliveredAtSeconds)<=600,'delivery must not be delayed to the next hour by wide calendar batching');
assert.deepEqual(intervals[0],[0,600],'the pending delivery keeps the first calendar slice at 600 seconds');
assert.equal(intervals.at(-1)[1],3600,'calendar processing reaches the hourly boundary');
for(let i=0;i<intervals.length;i++){assert(intervals[i][1]>intervals[i][0],'every event-bounded slice advances time');if(i)assert.equal(intervals[i][0],intervals[i-1][1],'event checkpoints must remain contiguous');}
assert.equal(commitCount,intervals.length);assert.equal(marketCalls,1);assert.equal(state.lastMarketHour,1);
assert.equal(s.GH_REALISM.simulationSliceLimit(state),3600);

state.mobility={status:'active',vehicles:[{id:'MOB-CADENCE-PROBE'}]};
assert.equal(s.GH_MOBILITY_CORE.simulationSliceLimit(state),3600,'active mobility must not constrain unrelated fleet simulation');
assert.equal(typeof s.GH_MOBILITY_CORE.advanceThrough,'function');
assert(advanceEvents.some(event=>event.completed===true));
assert(/if\(mobility\?\.advanceThrough\)mobility\.advanceThrough\(\{state\},from,completeTo\)/.test(app),'slice commit must step Mobility through advanceThrough');
assert(/getManualSliceLimit:\(\)=>\{[\s\S]{0,600}GH_REALISM\?\.simulationSliceLimit[\s\S]{0,600}GH_MOBILITY_CORE\?\.simulationSliceLimit/.test(app),'the real adapter must consult both temporal owners before selecting a wide slice');

console.log(JSON.stringify({suite:'build334-calendar-owner-cadence',pendingDeliveryProtected:true,intervals,deliveredAtSeconds:delivered.deliveredAtSeconds,commitCount,marketCalls,scope:'Fleet Event Core + Simulation Core + actual delivery owner and transaction; no iPhone measurement'},null,2));
