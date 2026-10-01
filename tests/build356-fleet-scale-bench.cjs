'use strict';
// Fleet Core v4.2 scale benchmark (manual, not part of npm test):
//   node --expose-gc tests/build356-fleet-scale-bench.cjs 1000000
// A realistic fleet: purchase batches of 1,000 assets (one profile each), 2,000
// shared routes, 85% road / 10% air / 5% sea, already normalized. Measures
// memory, schedule build, 600x and hourly slices (ms, events, us/event, fast
// path share), hour and day slices in both processing orders, the same slice
// inside a committed and a failed transaction, the per-frame budget lookup,
// value reclamation and row compaction. Routes are frozen objects, as the
// game's route resolver supplies them.
// Desktop Node numbers are relative evidence only; iPhone is slower.
const path=require('node:path'),ROOT=path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),EVENTS=require(path.join(ROOT,'WebApp/fleet-event-core.js')),CORE=require(path.join(ROOT,'WebApp/simulation-asset-core.js'));
const N=Number(process.argv[2]||1000000),gc=()=>global.gc?.(),heap=()=>{gc();const m=process.memoryUsage();return m.heapUsed+m.arrayBuffers;};
const ROUTES=2000,routes={},modes=r=>r%20===0?'sea':r%10===0?'air':'road';
for(let r=0;r<ROUTES;r++){const mode=modes(r),dist=mode==='air'?600+r*3:mode==='sea'?900+r*2:80+r%400,speed=mode==='air'?750:mode==='sea'?30:65;
 routes[`R${r}`]=Object.freeze({id:`R${r}`,type:mode,routeMode:mode,ownerCompanyId:mode,from:`Hub ${r}`,to:`Drop ${r}`,fromFacility:`F-${r}`,toFacility:`P-${r}`,distanceKm:dist,tripSeconds:dist/speed*3600,effectiveSpeedKmh:speed,dwellHours:mode==='air'?1:mode==='sea'?12:2.5});}
const SPECS={road:{rangeKm:1800,speedKmh:90,capacity:24,capacityUnit:'طن',fuelLPer100km:32,yieldMultiplier:1},air:{speedKmh:830,capacity:180,capacityUnit:'راكب',fuelBurnKgPerKm:4.2,yieldMultiplier:1},sea:{speedKn:18,capacity:4000,capacityUnit:'TEU',fuelTonPerDay:60,yieldMultiplier:1}};
const CREW=(mode,batch)=>({mode:'automatic-fixed',ready:true,roles:[{id:mode==='air'?'pilots':mode==='sea'?'captains':'drivers',count:2,monthlyPayroll:9000}],total:2,monthlyPayroll:9000,contractId:`EMP-BATCH-${batch}`,provisionedAt:0,center:'HQ'});
const ctx={companies:{road:{serviceLevel:80,automation:10},air:{serviceLevel:85,automation:20},sea:{serviceLevel:75,automation:5}},research:{efficiency:10},economy:{roadDemand:100,airDemand:100,seaDemand:100},market:{share:{},competitorPressure:{}},reputation:{},ownedFacilities:[]};
const resolveRoute=id=>routes[id]||null;
const out={N};
// Normalized binding per (mode, route, reverse), exactly as the engine would write it.
const normalized=new Map();
function binding(mode,route,reverse){const key=`${mode}|${route.id}|${reverse}`;let b=normalized.get(key);if(b)return b;const probe={type:mode,assetMode:mode,specs:SPECS[mode],routeId:route.id,reverse,phase:'moving',progress:0,fuel:100,condition:100};CORE.normalizeAsset(probe,route,null);
 b={routeSignature:`${mode}:${route.id}`,from:probe.from,to:probe.to,distanceKm:probe.distanceKm,tripSeconds:probe.tripSeconds,effectiveSpeedKmh:probe.effectiveSpeedKmh,dwellHours:probe.dwellHours,load:CORE.loadLabel(probe)};normalized.set(key,b);return b;}
let h0=heap(),t=performance.now();const store=STORE.create(N);
for(let i=0;i<N;i++){
 const batch=Math.floor(i/1000),r0=(batch*37+(i%64))%ROUTES,mode=i%20===0?'sea':i%10===0?'air':'road';
 let r=r0;while(modes(r)!==mode)r=(r+1)%ROUTES;const route=routes[`R${r}`],reverse=i%2===0,moving=i%3!==0;
 STORE.add(store,{id:`N-${mode.toUpperCase()}-${String(i).padStart(8,'0')}`,ownerCompanyId:mode,assetMode:mode,assetClass:mode,type:mode,name:`GH ${mode} ${i}`,catalogId:`C-${mode}`,specs:SPECS[mode],staffing:CREW(mode,batch),
  deliveryOrderId:`DEL-BATCH-${batch}`,ownership:batch%2?'lease':'cash',purchasePrice:92400,
  routeId:route.id,baseFacility:reverse?route.toFacility:route.fromFacility,phase:moving?'moving':'turnaround',progress:moving?(i%97)/97:1,fuel:moving?90:70,condition:80,dwellRemaining:moving?0:(i*37)%9000,reverse,routeSlot:i%24,departureScheduled:!moving,crewBlocked:false,releaseExclusiveRouteOnArrival:false,simCarrySeconds:0,
  ...binding(mode,route,reverse)},{at:0});
}
out.buildMs=Math.round(performance.now()-t);STORE.trimCapacity(store);out.memoryMB=+((heap()-h0)/1048576).toFixed(1);out.stats=STORE.stats(store);
t=performance.now();EVENTS.queueStats(store);out.queueBuildMs=Math.round(performance.now()-t);
t=performance.now();const budgetTime=EVENTS.timeForEventBudget(store,4000);out.budgetLookupMs=+(performance.now()-t).toFixed(2);void budgetTime;
// 600x: one real second = 600 game seconds; 60 consecutive slices.
let sim=0;const sliceMs=[];let events=0,fast=0;
for(let s=0;s<60;s++){t=performance.now();const res=EVENTS.advance(store,{from:sim,to:sim+600,context:ctx,resolveRoute,tripAlertLimit:3});sliceMs.push(performance.now()-t);events+=res.events;fast+=res.fast;sim+=600;}
sliceMs.sort((a,b)=>a-b);const median=sliceMs[30],eventsPerSlice=events/60;
out.slice600x={medianMs:+median.toFixed(1),p95Ms:+sliceMs[57].toFixed(1),eventsPerSlice:Math.round(eventsPerSlice),usPerEvent:+(median*1000/eventsPerSlice).toFixed(2),fastShare:+(fast/events).toFixed(4)};
// The same work split by a 4,000-event frame budget.
const frames=[];let frameEvents=0;const target=sim+600;
while(sim<target){const limit=Math.min(target,EVENTS.timeForEventBudget(store,4000));const to=limit>sim?limit:target;t=performance.now();const res=EVENTS.advance(store,{from:sim,to,context:ctx,resolveRoute,tripAlertLimit:3,maxEvents:6000});frames.push(performance.now()-t);frameEvents+=res.events;sim=res.completeTo;}
frames.sort((a,b)=>a-b);out.budgetedFrames={frames:frames.length,maxMs:+frames[frames.length-1].toFixed(1),medianMs:+frames[frames.length>>1].toFixed(1),events:frameEvents};
for(const order of ['events','sweep']){t=performance.now();const hour=EVENTS.advance(store,{from:sim,to:sim+3600,context:ctx,resolveRoute,tripAlertLimit:3,order});out[`hourSlice_${order}`]={ms:Math.round(performance.now()-t),events:hour.events,usPerEvent:+((performance.now()-t)*1000/hour.events).toFixed(3)};sim+=3600;}
t=performance.now();const day=EVENTS.advance(store,{from:sim,to:sim+86400,context:ctx,resolveRoute,tripAlertLimit:3,order:'sweep'});out.daySlice_sweep={ms:Math.round(performance.now()-t),events:day.events,usPerEvent:+((performance.now()-t)*1000/day.events).toFixed(3)};sim+=86400;
t=performance.now();EVENTS.queueStats(store);out.heapRebuildAfterSweepMs=Math.round(performance.now()-t);
// Inside Transaction Core: journaled commit and a failed slice.
const state={fleet:store,cash:0};
t=performance.now();global.GH_TRANSACTION_CORE.execute(state,{label:'bench-commit',scope:['cash'],apply:()=>{EVENTS.advance(store,{from:sim,to:sim+600,context:ctx,resolveRoute,tripAlertLimit:3});state.cash++;}});out.committedSliceMs=Math.round(performance.now()-t);sim+=600;
t=performance.now();try{global.GH_TRANSACTION_CORE.execute(state,{label:'bench-fail',scope:['cash'],apply:()=>{EVENTS.advance(store,{from:sim,to:sim+600,context:ctx,resolveRoute,tripAlertLimit:3});throw new Error('x');}});}catch{}out.failedSliceMs=Math.round(performance.now()-t);
t=performance.now();EVENTS.queueStats(store);out.rebuildAfterRollbackMs=Math.round(performance.now()-t);
t=performance.now();const gcOut=STORE.collectValues(store);out.collectValues={ms:Math.round(performance.now()-t),...gcOut};
t=performance.now();STORE.removeMany(store,Array.from({length:1000},(_,i)=>Math.floor(i*N/1000)));out.remove1000Ms=+(performance.now()-t).toFixed(1);
t=performance.now();STORE.compactRows(store);out.compactRowsMs=Math.round(performance.now()-t);
t=performance.now();for(let i=0;i<1000;i++)STORE.indexOf(store,`N-ROAD-${String((Math.floor(i*N/1000)|1)).padStart(8,'0')}`);out.thousandLookupsMs=Math.round(performance.now()-t);
console.log(JSON.stringify(out));
