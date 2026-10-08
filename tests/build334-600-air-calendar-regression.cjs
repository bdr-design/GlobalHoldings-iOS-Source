'use strict';

const assert=require('node:assert/strict');
const {createSimulationAdapter,makeAsset,fixture}=require('./helpers/fleet-simulation-adapter');

const TARGET=86400,RATES=[30,120,300,600];
function diffPaths(a,b,path='',out=[]){
  if(Object.is(a,b))return out;
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
    const keys=new Set([...Object.keys(a),...Object.keys(b)]);for(const key of keys)diffPaths(a[key],b[key],`${path}[${key}]`,out);return out;
  }
  out.push(`${path}: ${String(a)} <> ${String(b)}`);return out;
}
function assertTotalsClose(label,a,b,tolerance=1e-7){
  const keys=new Set([...Object.keys(a||{}),...Object.keys(b||{})]);
  for(const key of keys){const av=Number(a?.[key])||0,bv=Number(b?.[key])||0;assert(Math.abs(av-bv)<=tolerance*Math.max(1,Math.abs(av),Math.abs(bv)),`${label}.${key}: ${av} <> ${bv}`);}
}
const initial=Array.from({length:600},(_,i)=>makeAsset(`AIR600-${String(i).padStart(4,'0')}`,{
  route:fixture.routes.A1,from:0,phase:i%3===0?'turnaround':'moving',
  progress:i%3===0?0:(i%53)/53,dwellRemaining:i%3===0?(i*37)%3300:0,
  routeSlot:i%6,baseFacility:'F-AIR-A',fuel:72+i%28,condition:82+i%18
}));
const speedSample=initial.slice(0,8);

function legacyDay(source){
  const assets=structuredClone(source),step=1200;
  for(let from=0;from<TARGET;from+=step)fixture.oldSlice(assets,from,Math.min(TARGET,from+step));
  return assets;
}

function runRate(rate){
  const {e,s,state}=createSimulationAdapter({from:0,assets:structuredClone(speedSample)});
  e.load('simulation-core');
  state.simSeconds=0;state.lastFinancialDay=0;state.lastMarketHour=0;state.speed=rate;
  let frameTime=0,workTime=0,commits=0,events=0,marketCalls=0,dayCalls=0;
  const measured=fn=>{const start=performance.now();try{return fn();}finally{workTime+=performance.now()-start;}};
  Object.assign(s,{
    processMarket:hour=>{s.__marketHours.push(hour);state.lastMarketHour=hour;marketCalls++;},
    processFinancialDay:day=>{s.__financialDays.push(day);state.lastFinancialDay=day;dayCalls++;}
  });
  const engine=s.GH_SIMULATION_CORE.create({
    getSimTime:()=>state.simSeconds,setSimTime:value=>{state.simSeconds=value;},
    getSpeed:()=>rate,setSpeed:()=>{},
    createSliceJob:(slice,meta)=>{
      const job=measured(()=>s.__makeFleetSliceJob(slice,meta)),finish=job.finish,runChunk=job.runChunk;
      job.runChunk=(...args)=>measured(()=>runChunk.apply(job,args));
      job.finish=info=>measured(()=>{const out=finish.call(job,info);if(out?.committed){commits++;events+=Number(out.events)||0;}return out;});
      return job;
    }
  },{
    nowMs:()=>workTime,allowedSpeeds:[0,...RATES],fallbackSpeed:30,
    quantumRealSeconds:1,maxRealDelta:3,maxBacklogNormal:12,maxBacklogFast:96,
    frameBudgetMs:8,manualFrameBudgetMs:20,chunkItems:64,manualChunkItems:64,
    longTaskWarnMs:10000,hardTaskMs:10000
  });
  const started=performance.now();let frames=0;
  // Staged transactions intentionally advance one bounded stage per synthetic frame. Keep the
  // ceiling high enough to exercise that cooperative path instead of assuming the old synchronous job.
  for(;frames<100000&&engine.snapshot().days<1;frames++){
    frameTime+=1000;engine.frame(frameTime);
  }
  // A live frame may already have opened the next staged slice after committing midnight.
  // Reset aborts that uncommitted slice and restores the exact day-boundary state.
  engine.reset(frameTime,'test-day-boundary-reached');
  const elapsedMs=performance.now()-started,kernel=engine.snapshot();
  assert.equal(state.simSeconds,TARGET,`×${rate}: simulated day did not finish; ${kernel.lastError}`);
  assert.equal(kernel.lastError,'',`×${rate}: ${kernel.lastError}`);
  assert.equal(kernel.lastAdvanceFailure,null);
  assert.equal(dayCalls,1,`×${rate}: daily close count`);
  assert.equal(marketCalls,24,`×${rate}: hourly close count`);
  assert.equal(state.lastFinancialDay,1);assert.equal(state.lastMarketHour,24);
  assert.equal(commits,kernel.slices,`×${rate}: every slice must publish atomically`);
  const fleet=s.GH_FLEET_DATA.list(state).map(asset=>s.GH_FLEET_DATA.plain(asset));
  assert.equal(fleet.length,speedSample.length);
  return {rate,frames,commits,events,marketCalls,dayCalls,elapsedMs,fleet,
    revenue:state.tripRevenueAccrued||{},profit:state.tripProfitAccrued||{},kernel};
}

function run600AssetCalendar(){
  const {e,s,state}=createSimulationAdapter({from:0,assets:structuredClone(initial)});
  e.load('simulation-core');state.simSeconds=0;state.lastFinancialDay=0;state.lastMarketHour=0;
  let frameTime=0,workTime=0,commits=0,events=0,marketCalls=0,dayCalls=0;
  const measured=fn=>{const start=performance.now();try{return fn();}finally{workTime+=performance.now()-start;}};
  Object.assign(s,{
    processMarket:hour=>{s.__marketHours.push(hour);state.lastMarketHour=hour;marketCalls++;},
    processFinancialDay:day=>{s.__financialDays.push(day);state.lastFinancialDay=day;dayCalls++;}
  });
  const engine=s.GH_SIMULATION_CORE.create({
    getSimTime:()=>state.simSeconds,setSimTime:value=>{state.simSeconds=value;},getSpeed:()=>0,setSpeed:()=>{},
    getManualSliceLimit:()=>3600,
    createSliceJob:(slice,meta)=>{const job=measured(()=>s.__makeFleetSliceJob(slice,meta)),finish=job.finish,runChunk=job.runChunk;job.runChunk=(...args)=>measured(()=>runChunk.apply(job,args));job.finish=info=>measured(()=>{const out=finish.call(job,info);if(out?.committed){commits++;events+=Number(out.events)||0;}return out;});return job;}
  },{nowMs:()=>workTime,allowedSpeeds:[0,...RATES],fallbackSpeed:30,frameBudgetMs:8,manualFrameBudgetMs:20,manualBatchSeconds:3600,manualMinBatchSeconds:300,manualChunkItems:64});
  const started=performance.now();assert.equal(engine.advanceTo(TARGET,{speed:600,batchSeconds:3600}).accepted,true);
  let frames=0;for(;frames<10000&&engine.snapshot().manualAdvance;frames++){frameTime+=16;engine.frame(frameTime);}
  const elapsedMs=performance.now()-started,kernel=engine.snapshot();
  assert.equal(state.simSeconds,TARGET);assert.equal(kernel.manualAdvance,null);assert.equal(kernel.lastAdvanceFailure,null);
  assert.equal(commits,24);assert.equal(marketCalls,24);assert.equal(dayCalls,1);assert(frames>1,'calendar work must yield across frames when the configured work budget expires');
  assert.equal(s.GH_FLEET_DATA.size(state),600);
  return {frames,commits,events,elapsedMs,kernel};
}

const old=legacyDay(speedSample);
const runs=RATES.map(runRate),reference=runs[0],scale=run600AssetCalendar();
for(const result of runs){
  const fleetDiff=diffPaths(result.fleet,reference.fleet).slice(0,40);
  assert.equal(fleetDiff.length,0,`fleet must be partition and speed invariant at ×${result.rate}: ${fleetDiff.join('; ')}`);
  assertTotalsClose(`trip revenue ×${result.rate}`,result.revenue,reference.revenue);
  assertTotalsClose(`trip profit ×${result.rate}`,result.profit,reference.profit);
  for(let i=0;i<old.length;i++)fixture.compareValue(`×${result.rate}.asset[${i}]`,fixture.comparable(old[i]),fixture.comparable(result.fleet[i]),1e-7);
}

console.log(JSON.stringify({suite:'build334-600-air-calendar-regression',environment:`node ${process.version}; Fleet Event Core + Simulation Core + actual transaction adapter; legacy processBatch comparison; no iPhone measurement`,scaleFleetAssets:600,speedSampleAssets:speedSample.length,simulatedHours:24,calendar600:(({frames,commits,events,elapsedMs})=>({frames,commits,events,elapsedMs:+elapsedMs.toFixed(2)}))(scale),runs:runs.map(({rate,frames,commits,events,elapsedMs})=>({rate,frames,commits,events,elapsedMs:+elapsedMs.toFixed(2)})),legacySliceSeconds:1200,comparison:'comparable() tolerance 1e-7',fleetInvariant:true},null,2));
