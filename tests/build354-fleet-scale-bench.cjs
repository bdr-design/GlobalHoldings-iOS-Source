'use strict';
// Fleet Core v4 scale benchmark (manual, not part of npm test):
//   node --expose-gc tests/build354-fleet-scale-bench.cjs 100000
// Builds N real-shaped trucks/aircraft on shared routes, then measures memory,
// full-store clone, one-hour and one-minute event slices at 600x pacing, and a
// transaction rollback. Desktop Node numbers are relative evidence only.
const path=require('node:path'),ROOT=path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),EVENTS=require(path.join(ROOT,'WebApp/fleet-event-core.js'));
const N=Number(process.argv[2]||100000),gc=()=>global.gc?.(),heap=()=>{gc();return process.memoryUsage().heapUsed+process.memoryUsage().arrayBuffers;};
const ROUTES=200,routes={};for(let r=0;r<ROUTES;r++){const mode=r%10===0?'air':'road',dist=mode==='air'?600+r*7:80+r*3;routes[`R${r}`]={id:`R${r}`,type:mode,routeMode:mode,ownerCompanyId:mode,from:`Hub ${r}`,to:`Drop ${r}`,fromFacility:`F-${r}`,toFacility:`P-${r}`,distanceKm:dist,tripSeconds:dist/(mode==='air'?750:65)*3600,effectiveSpeedKmh:mode==='air'?750:65,dwellHours:mode==='air'?1:2.5};}
const SPECS={road:{rangeKm:1800,speedKmh:90,capacity:24,capacityUnit:'طن',fuelLPer100km:32,yieldMultiplier:1},air:{speedKmh:830,capacity:180,capacityUnit:'راكب',fuelBurnKgPerKm:4.2,yieldMultiplier:1}};
const CREW=mode=>({mode:'automatic-fixed',ready:true,roles:[{id:mode==='air'?'pilots':'drivers',count:2,monthlyPayroll:9000}],total:2,monthlyPayroll:9000,contractId:`EMP-BATCH-${mode}`,provisionedAt:0,center:'HQ'});
const ctx={companies:{road:{serviceLevel:80,automation:10},air:{serviceLevel:85,automation:20}},research:{efficiency:10},economy:{roadDemand:100,airDemand:100},market:{share:{},competitorPressure:{}},reputation:{},ownedFacilities:[]};
const resolveRoute=id=>routes[id]||null;
const out={N};
let h0=heap(),t=performance.now();const store=STORE.create(N);
for(let i=0;i<N;i++){const r=routes[`R${i%ROUTES}`],mode=r.type;STORE.add(store,{id:`N-${mode.toUpperCase()}-${String(i).padStart(8,'0')}`,ownerCompanyId:mode,assetMode:mode,type:mode,name:`GH ${mode} ${i}`,catalogId:`C-${mode}`,specs:SPECS[mode],staffing:CREW(mode),
 routeId:r.id,baseFacility:i%2?r.fromFacility:r.toFacility,phase:i%2?'moving':'turnaround',progress:(i%97)/97,fuel:100,condition:80,dwellRemaining:(i*37)%9000,reverse:i%2===0,routeSlot:i%24,departureScheduled:false,crewBlocked:false,
 from:r.from,to:r.to,distanceKm:r.distanceKm,tripSeconds:r.tripSeconds,effectiveSpeedKmh:r.effectiveSpeedKmh,dwellHours:r.dwellHours,ownership:'lease',purchasePrice:92400,deliveryOrderId:`DEL-BATCH-${Math.floor(i/900)}`},{at:0});}
out.buildMs=Math.round(performance.now()-t);STORE.trimCapacity(store);out.memoryMB=+((heap()-h0)/1048576).toFixed(1);out.stats=STORE.stats(store);
t=performance.now();EVENTS.queueStats(store);out.queueBuildMs=Math.round(performance.now()-t);
t=performance.now();structuredClone(store);out.fullCloneMs=Math.round(performance.now()-t);
// 600x pacing: one real second = 600 game seconds. Measure 60 consecutive slices.
let sim=0,maxSlice=0,totalEvents=0;const sliceMs=[];
for(let s=0;s<60;s++){t=performance.now();const res=EVENTS.advance(store,{from:sim,to:sim+600,context:ctx,resolveRoute,tripAlertLimit:3});const ms=performance.now()-t;sliceMs.push(ms);maxSlice=Math.max(maxSlice,ms);totalEvents+=res.events;sim+=600;}
sliceMs.sort((a,b)=>a-b);out.slice600x={medianMs:+sliceMs[30].toFixed(1),maxMs:+maxSlice.toFixed(1),eventsPerSlice:Math.round(totalEvents/60)};
// Calendar jump: one 3600 s slice.
t=performance.now();const hour=EVENTS.advance(store,{from:sim,to:sim+3600,context:ctx,resolveRoute,tripAlertLimit:3});out.hourSlice={ms:Math.round(performance.now()-t),events:hour.events};sim+=3600;
// Transaction rollback of a 600 s slice.
const state={fleet:store,cash:0};t=performance.now();try{global.GH_TRANSACTION_CORE.execute(state,{label:'bench',scope:['cash'],apply:()=>{EVENTS.advance(store,{from:sim,to:sim+600,context:ctx,resolveRoute,tripAlertLimit:3});throw new Error('x');}});}catch{}out.rollbackSliceMs=Math.round(performance.now()-t);
t=performance.now();for(let i=0;i<1000;i++)EVENTS.currentAsset(store,(i*7919)%N,sim,{resolveRoute});out.thousandAssetViewsMs=Math.round(performance.now()-t);
console.log(JSON.stringify(out));
