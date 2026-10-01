'use strict';
// Fleet Core v4 parity: the event engine must produce the same assets and the
// same economic effects as the current slice engine (simulation-asset-core
// processOne driven exactly like app.js), slice after slice, for a fleet that
// covers every transition branch.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),EVENTS=require(path.join(ROOT,'WebApp/fleet-event-core.js'));
// Fixture fleet, routes, economy context and the legacy slice engine driver.
const {WRITE,fleet,context,resolveRoute,oldSlice,compareValue}=require('./helpers/fleet-fixture.js');
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,1500)});}}

test('event engine matches the slice engine asset by asset and effect by effect',()=>{
 const t0=1000,oldAssets=fleet(),store=STORE.fromAssets(structuredClone(oldAssets),{at:t0});
 const pattern=[30,30,600,3600,777.7,3600,3600,45,600,1800,3600,3600,3600,10,3600,2400];let t=t0,slices=0,events=0,trips=0,alerts=0;
 while(t<t0+4*86400){
  const len=pattern[slices%pattern.length],from=t,to=t+len;
  const oldEffects=oldSlice(oldAssets,from,to),out=EVENTS.advance(store,{from,to,context:context(from),resolveRoute});
  events+=out.events;trips+=Object.values(oldEffects.tripCount).reduce((a,b)=>a+b,0);alerts+=oldEffects.alerts.length;
  for(let i=0;i<oldAssets.length;i++){
   const expected=oldAssets[i],actual=EVENTS.currentAsset(store,i,to,{resolveRoute});
   for(const f of WRITE)compareValue(`slice ${slices} [${from}->${to}] ${expected.id}.${f}`,expected[f],actual[f]);
  }
  for(const k of ['todayProfit','groupValue'])compareValue(`slice ${slices} effects.${k}`,oldEffects[k],out.effects[k],1e-9);
  for(const k of ['sectorProfit','tripProfit','tripRevenue','tripFuel','tripMaintenance','tripCount','cash'])compareValue(`slice ${slices} effects.${k}`,oldEffects[k],out.effects[k],1e-9);
  assert.deepEqual([...out.effects.saleIds].sort(),[...oldEffects.saleIds].sort(),`slice ${slices} saleIds`);
  assert.deepEqual([...out.effects.retiredRouteIds].sort(),[...oldEffects.retiredRouteIds].sort(),`slice ${slices} retiredRouteIds`);
  assert.deepEqual([...out.effects.alerts].sort(),[...oldEffects.alerts].sort(),`slice ${slices} alerts`);
  t=to;slices++;
 }
 assert(trips>500,'the fixture must complete many trips');assert(events<slices*oldAssets.length/3,'the event engine must process far fewer assets than the slice engine');
 return {assets:oldAssets.length,slices,eventsProcessed:events,assetSlicesOldEngine:slices*oldAssets.length,trips,alerts};
});

test('a failed slice transaction restores the event store exactly and the queue resynchronizes',()=>{
 const t0=500,state={fleet:STORE.fromAssets(fleet(),{at:t0}),cash:0},before=JSON.stringify(STORE.toAssets(state.fleet)),beforeAt=Array.from(state.fleet.columns.at.subarray(0,state.fleet.length));
 assert.throws(()=>global.GH_TRANSACTION_CORE.execute(state,{label:'fleet-slice',scope:['cash'],apply:()=>{EVENTS.advance(state.fleet,{from:t0,to:t0+7200,context:context(t0),resolveRoute});state.cash=1;throw new Error('slice-fault');}}),/slice-fault/);
 assert.equal(JSON.stringify(STORE.toAssets(state.fleet)),before);assert.deepEqual(Array.from(state.fleet.columns.at.subarray(0,state.fleet.length)),beforeAt);
 // After rollback the same slice replays to the same result as a fresh store.
 const fresh=STORE.fromAssets(fleet(),{at:t0}),a=EVENTS.advance(state.fleet,{from:t0,to:t0+7200,context:context(t0),resolveRoute}),b=EVENTS.advance(fresh,{from:t0,to:t0+7200,context:context(t0),resolveRoute});
 assert.equal(JSON.stringify(STORE.toAssets(state.fleet)),JSON.stringify(STORE.toAssets(fresh)));compareValue('replay effects',a.effects.tripRevenue,b.effects.tripRevenue,1e-12);
 return {events:a.events};
});

test('tripAlertLimit suppresses only per-trip texts and reports their count',()=>{
 const t0=1000,a=STORE.fromAssets(fleet(),{at:t0}),b=STORE.fromAssets(fleet(),{at:t0});let suppressed=0,kept=0;
 for(let t=t0;t<t0+2*86400;t+=3600){
  const full=EVENTS.advance(a,{from:t,to:t+3600,context:context(t),resolveRoute}),limited=EVENTS.advance(b,{from:t,to:t+3600,context:context(t),resolveRoute,tripAlertLimit:3});
  const isTrip=text=>/ أكمل (?:رحلة\.|\d+ رحلات )/.test(text),fullTrips=full.effects.alerts.filter(isTrip).length;
  for(const k of ['todayProfit','groupValue'])compareValue(`limited ${k}`,full.effects[k],limited.effects[k],0);
  for(const k of ['tripCount','tripRevenue','cash'])compareValue(`limited ${k}`,full.effects[k],limited.effects[k],0);
  assert.deepEqual(limited.effects.alerts.filter(text=>!isTrip(text)).sort(),full.effects.alerts.filter(text=>!isTrip(text)).sort());
  if(fullTrips>3){assert.equal(limited.effects.suppressedTripAlerts,fullTrips);assert.equal(limited.effects.alerts.filter(isTrip).length,0);suppressed++;}
  else{assert.equal(limited.effects.suppressedTripAlerts,undefined);assert.deepEqual(limited.effects.alerts.filter(isTrip).sort(),full.effects.alerts.filter(isTrip).sort());kept++;}
 }
 assert.equal(JSON.stringify(STORE.toAssets(a)),JSON.stringify(STORE.toAssets(b)));assert(suppressed>0);return {suppressedSlices:suppressed,keptSlices:kept};
});

const passed=results.filter(r=>r.ok).length;console.log(JSON.stringify({suite:'build354-fleet-event-parity',passed,total:results.length,results},null,2));if(passed!==results.length)process.exitCode=1;
