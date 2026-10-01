'use strict';
// Fleet Core v4.1 exact event engine:
// 1. the fast (typed-column) path and the general path are bit-identical;
// 2. any partition of the same interval yields a bit-identical fleet;
// 3. against the legacy slice engine (processOne) it agrees within float
//    tolerance, except the documented exact-time improvements;
// 4. a failed slice rolls back exactly and the schedule resynchronizes;
// 5. per-trip alert limits; 6. event budgets stop on a timestamp boundary;
// 7. the time-ordered queue and the row-ordered sweep agree bit for bit.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),EVENTS=require(path.join(ROOT,'WebApp/fleet-event-core.js'));
const {WRITE,fleet,context,resolveRoute,oldSlice,compareValue,comparable}=require('./helpers/fleet-fixture.js');
const TX=global.GH_TRANSACTION_CORE;
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,1500)});}}
const rows=store=>STORE.toAssets(store);
const exactFleet=store=>JSON.stringify({rows:rows(store),at:(()=>{const out=[];STORE.forEachLive(store,row=>out.push(STORE.slot(store,'at',row)));return out;})()});
const CTX=context(0);
// Every fast-path event also checks its returned next time against nextEventTime.
function run(store,from,to,extra={}){return EVENTS.advance(store,{from,to,context:CTX,resolveRoute,verifySchedule:true,...extra});}
function sumEffects(total,effects){
 total.todayProfit+=effects.todayProfit;total.groupValue+=effects.groupValue;
 for(const k of ['sectorProfit','tripProfit','tripRevenue','tripFuel','tripMaintenance','tripCount','cash'])for(const [c,v] of Object.entries(effects[k]))total[k][c]=(total[k][c]||0)+v;
 total.alerts.push(...effects.alerts);total.saleIds.push(...effects.saleIds);total.retiredRouteIds.push(...effects.retiredRouteIds);return total;
}
const number0=value=>{const n=Number(value);return Number.isFinite(n)?n:0;};
const blank=()=>({todayProfit:0,groupValue:0,sectorProfit:{},tripProfit:{},tripRevenue:{},tripFuel:{},tripMaintenance:{},tripCount:{},cash:{},alerts:[],saleIds:[],retiredRouteIds:[]});

test('the fast path and the general path produce bit-identical fleets and effects',()=>{
 const t0=1000,fast=STORE.fromAssets(fleet(),{at:t0}),slow=STORE.fromAssets(fleet(),{at:t0});let t=t0,fastEvents=0,slowEvents=0,events=0;
 const pattern=[600,3600,45,1800,7200,777.7,3600,86400];
 for(let slice=0;slice<40;slice++){
  const to=t+pattern[slice%pattern.length],ctx=context(t);
  const a=EVENTS.advance(fast,{from:t,to,context:ctx,resolveRoute,verifySchedule:true}),b=EVENTS.advance(slow,{from:t,to,context:ctx,resolveRoute,fastPath:false});
  assert.equal(JSON.stringify(a.effects),JSON.stringify(b.effects),`slice ${slice} effects`);
  assert.equal(exactFleet(fast),exactFleet(slow),`slice ${slice} fleet`);
  fastEvents+=a.fast;slowEvents+=a.slow;events+=a.events;t=to;
 }
 assert(fastEvents>events*.8,`the fast path carries the common events (${fastEvents}/${events})`);
 return {events,fastEvents,slowEvents};
});

test('the time-ordered queue and the row-ordered sweep produce bit-identical fleets and effects',()=>{
 const t0=2000,stores={events:STORE.fromAssets(fleet(),{at:t0}),sweep:STORE.fromAssets(fleet(),{at:t0}),auto:STORE.fromAssets(fleet(),{at:t0})};let t=t0,events=0,slow=0;const orders=new Set();
 const pattern=[30,600,86400,45,7200,3*86400,777.7,3600,1,40000];
 for(let slice=0;slice<40;slice++){
  const to=t+pattern[slice%pattern.length],ctx=context(t),out={};
  for(const order of ['events','sweep','auto'])out[order]=EVENTS.advance(stores[order],{from:t,to,context:ctx,resolveRoute,order:order==='auto'?undefined:order,verifySchedule:true,tripAlertLimit:slice%3?null:5});
  assert.equal(out.events.order,'events');assert.equal(out.sweep.order,'sweep');orders.add(out.auto.order);
  for(const order of ['sweep','auto']){
   assert.equal(JSON.stringify(out[order].effects),JSON.stringify(out.events.effects),`slice ${slice} ${order} effects`);
   assert.equal(exactFleet(stores[order]),exactFleet(stores.events),`slice ${slice} ${order} fleet`);
   assert.equal(out[order].events,out.events.events,`slice ${slice} ${order} event count`);
  }
  events+=out.events.events;slow+=out.events.slow;t=to;
 }
 assert(orders.has('sweep')&&orders.has('events'),'auto chose both orders');assert(slow>0,'the general path took part');
 return {events,slow,orders:[...orders]};
});

test('any partition of the same interval yields a bit-identical fleet',()=>{
 const t0=5000,end=t0+3*86400,stores=[0,1,2].map(()=>STORE.fromAssets(fleet(),{at:t0}));
 let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
 const partitions=[t=>t+3600,t=>t+1+Math.floor(rnd()*1800),t=>t+37];const totals=stores.map(()=>blank());
 stores.forEach((store,i)=>{let t=t0;while(t<end){const to=Math.min(end,partitions[i](t));sumEffects(totals[i],run(store,t,to).effects);t=to;}});
 assert.equal(exactFleet(stores[1]),exactFleet(stores[0]),'random partition');assert.equal(exactFleet(stores[2]),exactFleet(stores[0]),'37 s partition');
 for(const i of [1,2]){
  assert.deepEqual(totals[i].tripCount,totals[0].tripCount,'trip counts');
  for(const k of ['todayProfit','groupValue'])compareValue(`partition ${i} ${k}`,totals[0][k],totals[i][k],1e-12);
  for(const k of ['tripRevenue','tripFuel','tripMaintenance','cash','sectorProfit'])compareValue(`partition ${i} ${k}`,totals[0][k],totals[i][k],1e-12);
  assert.deepEqual([...totals[i].saleIds].sort(),[...totals[0].saleIds].sort());assert.deepEqual([...totals[i].retiredRouteIds].sort(),[...totals[0].retiredRouteIds].sort());
 }
 return {trips:Object.values(totals[0].tripCount).reduce((a,b)=>a+b,0)};
});

// Documented exact-time differences from the legacy slice engine: comparable()
// in the fleet fixture, plus a transition within legacy's 1e-6 s end-of-slice
// tolerance, which may fall on either side of the slice end (the same instant
// up to rounding).
test('the event engine agrees with the legacy slice engine within float tolerance',()=>{
 const t0=1000,legacy=fleet(),store=STORE.fromAssets(structuredClone(legacy),{at:t0});
 const pattern=[30,30,600,450,120,600,600,45,600,240,600,10,600,300];let t=t0,slices=0,trips=0,boundary=0,maxTrip=0,straddle=0;const totalsOld=blank(),totalsNew=blank();
 while(t<t0+3*86400){
  const len=pattern[slices%pattern.length],from=t,to=t+len,ctx=context(from);
  const oldEffects=oldSlice(legacy,from,to),out=EVENTS.advance(store,{from,to,context:ctx,resolveRoute,verifySchedule:true});
  sumEffects(totalsOld,oldEffects);sumEffects(totalsNew,out.effects);trips+=Object.values(oldEffects.tripCount).reduce((a,b)=>a+b,0);
  // A trip ending within legacy's 1e-6 s slice tolerance can land in the next
  // slice; cumulative counts may differ by at most the assets with a transition
  // inside that window of this slice end.
  let window=0;for(let i=0;i<legacy.length;i++)if(Math.abs(STORE.slot(store,'at',i)-to)<=1e-6||Math.abs(EVENTS.nextEventTime(store,i)-to)<=1e-6)window++;
  for(const company of new Set([...Object.keys(totalsOld.tripCount),...Object.keys(totalsNew.tripCount)]))assert(Math.abs((totalsOld.tripCount[company]||0)-(totalsNew.tripCount[company]||0))<=Math.max(window,straddle),`slice ${slices} cumulative trips ${company}`);
  straddle=window;
  const isTrip=text=>/ أكمل (?:رحلة\.|\d+ رحلات )/.test(text);
  assert.deepEqual(out.effects.alerts.filter(text=>!isTrip(text)).sort(),oldEffects.alerts.filter(text=>!isTrip(text)).sort(),`slice ${slices} operational alerts`);
  for(const company of Object.keys(oldEffects.tripRevenue))maxTrip=Math.max(maxTrip,oldEffects.tripRevenue[company]/Math.max(1,oldEffects.tripCount[company]));
  const live=rows(store);assert.equal(live.length,legacy.length);
  for(let i=0;i<legacy.length;i++){
   const expected=comparable(legacy[i]),actual=comparable(EVENTS.currentAsset(store,i,to,{resolveRoute}));
   // Legacy stops a slice once less than 1e-6 s remains (remaining>1e-6): an
   // asset whose transition falls within that window of the slice end may be on
   // either side of it in the two engines (the same instant up to rounding).
   const boundaryDeparture=Math.abs(STORE.slot(store,'at',i)-to)<=1e-6||Math.abs(EVENTS.nextEventTime(store,i)-to)<=1e-6;
   if(boundaryDeparture){boundary++;continue;}
   for(const f of WRITE)compareValue(`slice ${slices} [${from}->${to}] ${legacy[i].id}.${f}`,expected[f],actual[f],1e-7);
  }
  t=to;slices++;
 }
 // Totals agree to within one boundary trip.
 const within=(label,a,b)=>assert(Math.abs(a-b)<=maxTrip*Math.max(1,straddle)*1.01+1e-9*Math.max(1,Math.abs(a)),`${label}: legacy ${a} event ${b}`);
 for(const k of ['todayProfit','groupValue'])within(`total ${k}`,totalsOld[k],totalsNew[k]);
 for(const k of ['tripRevenue','tripFuel','tripMaintenance','cash','sectorProfit'])for(const company of new Set([...Object.keys(totalsOld[k]),...Object.keys(totalsNew[k])]))within(`total ${k}.${company}`,totalsOld[k][company]||0,totalsNew[k][company]||0);
 assert(trips>300);return {slices,trips,boundaryDepartures:boundary};
});

test('a failed slice transaction restores the event store exactly and the schedule resynchronizes',()=>{
 const t0=500,state={fleet:STORE.fromAssets(fleet(),{at:t0}),cash:0};
 run(state.fleet,t0,t0);const before=exactFleet(state.fleet);
 assert.throws(()=>TX.execute(state,{label:'fleet-slice',scope:['cash'],apply:()=>{run(state.fleet,t0,t0+7200);state.cash=1;throw new Error('slice-fault');}}),/slice-fault/);
 assert.equal(exactFleet(state.fleet),before);assert.equal(state.cash,0);
 const fresh=STORE.fromAssets(fleet(),{at:t0});run(fresh,t0,t0);const a=run(state.fleet,t0,t0+7200),b=run(fresh,t0,t0+7200);
 assert.equal(exactFleet(state.fleet),exactFleet(fresh));assert.equal(JSON.stringify(a.effects),JSON.stringify(b.effects));
 return {events:a.events};
});

test('tripAlertLimit suppresses only per-trip texts and reports their count',()=>{
 const t0=1000,a=STORE.fromAssets(fleet(),{at:t0}),b=STORE.fromAssets(fleet(),{at:t0});let suppressed=0,kept=0;
 const isTrip=text=>/ أكمل (?:رحلة\.|\d+ رحلات )/.test(text);
 for(let t=t0;t<t0+2*86400;t+=3600){
  const full=run(a,t,t+3600),limited=run(b,t,t+3600,{tripAlertLimit:3}),fullTrips=full.effects.alerts.filter(isTrip).length,trips=Object.values(full.effects.tripCount).reduce((x,y)=>x+y,0);
  assert.equal(JSON.stringify({...limited.effects,alerts:undefined,suppressedTripAlerts:undefined}),JSON.stringify({...full.effects,alerts:undefined}),'economics are identical');
  assert.deepEqual(limited.effects.alerts.filter(text=>!isTrip(text)),full.effects.alerts.filter(text=>!isTrip(text)),'other alerts are kept');
  if(trips>3){assert.equal(limited.effects.alerts.filter(isTrip).length,0);assert.equal(limited.effects.suppressedTripAlerts,trips);suppressed++;}
  else{assert.equal(limited.effects.alerts.filter(isTrip).length,fullTrips);kept++;}
 }
 assert(suppressed>0);return {suppressed,kept};
});

test('event budgets stop on a timestamp boundary and continuing yields the same fleet',()=>{
 const t0=2000,end=t0+86400,a=STORE.fromAssets(fleet(),{at:t0}),b=STORE.fromAssets(fleet(),{at:t0});
 run(a,t0,end);
 let t=t0,calls=0;while(t<end){const out=run(b,t,end,{maxEvents:25});assert(out.events<=25+400,'a cap holds up to one timestamp of events');assert(out.completeTo>=t);t=out.completeTo;calls++;if(out.completeTo===end)break;}
 assert.equal(exactFleet(b),exactFleet(a),'capped slices continue to the same fleet');assert(calls>5);
 // timeForEventBudget agrees with a brute-force k-th next event.
 const c=STORE.fromAssets(fleet(),{at:t0}),times=[];STORE.forEachLive(c,row=>{const time=EVENTS.nextEventTime(c,row);if(time!==Infinity)times.push(time);});times.sort((x,y)=>x-y);
 for(const k of [1,5,40,times.length])assert.equal(EVENTS.timeForEventBudget(c,k),times[k-1],`k=${k}`);
 assert.equal(EVENTS.timeForEventBudget(c,times.length+1),Infinity);
 return {calls,scheduled:times.length};
});

const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build356-fleet-events',passed,total:results.length,results},null,2));if(passed!==results.length)process.exitCode=1;
