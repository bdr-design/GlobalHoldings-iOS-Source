'use strict';
// Fleet Core v4 store: exact ingest/materialize, write semantics, journaled
// rollback inside the real Transaction Core, swap-removal and compaction.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),TX=global.GH_TRANSACTION_CORE;
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}
const json=value=>JSON.parse(JSON.stringify(value));
const canon=value=>{const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;return JSON.stringify(sort(json(value)));};
function truck(i,extra={}){return {id:`N-ROAD-${String(i).padStart(8,'0')}`,ownerCompanyId:'road',assetMode:'road',assetClass:'truck',operationProfileId:'fleet-route-road-v1',type:'road',icon:'🚛',name:`GH LOGISTICS ${100+i}`,catalogId:'U-T1',routeId:'ROAD-AUTO-00000001',baseFacility:'QA-PERF-ROAD-RUH',progress:i%7/7,fuel:100,phase:i%2?'moving':'turnaround',model:'Long Haul 24T',year:2021,condition:68,specs:{rangeKm:1800,speedKmh:90,capacity:24,capacityUnit:'طن'},ownership:'lease',monthlyLease:2177,leaseTermMonths:60,leaseStartSeconds:0,purchasePrice:92400,companyName:'QA Logistics',deliveryOrderId:'DEL-ROAD-1',requestRef:'R-1',paymentRef:'P-1',routeSignature:'road:sig',routeSlot:i%5,departureScheduled:i%2===0,deliveryStatus:'delivered',deliveredDay:0,deliveredAtSeconds:0,staffing:{mode:'automatic-fixed',ready:true,roles:[{id:'drivers',count:2}],total:2,monthlyPayroll:9000,contractId:'EMP-BATCH-1',provisionedAt:0,center:'RUH'},crewBlocked:false,releaseExclusiveRouteOnArrival:false,dwellRemaining:75+i,reverse:i%3===0,from:'A',to:'B',distanceKm:199.01,tripSeconds:10474.31,effectiveSpeedKmh:68.4,dwellHours:2.5,departureScheduledAt:75+i,load:'٢١ / ٢٤ طن',...extra};}

test('ingest -> materialize preserves every JSON value of real-shaped and adversarial assets',()=>{
 const assets=[truck(1),truck(2),truck(3,{name:'Custom name',id:'odd-id',salePending:true,saleStatus:'returning',simulationFault:{code:'X',at:5},lastMaintenanceAt:9}),
  truck(4,{progress:'0.5',routeSlot:1.5,reverse:'yes',phase:null,lastTrip:{revenue:1,margin:-0}}),truck(5,{specs:{...truck(5).specs,capacity:30}}),
  {id:'BARE-7'},{id:'007',name:'0',progress:-0,fuel:Infinity,condition:NaN},{id:'X-1',routeId:null,baseFacility:'',lastTransitionGuardDay:-3,departureScheduledAt:undefined}];
 const store=STORE.fromAssets(assets,{at:100});
 for(let i=0;i<assets.length;i++){
  const expected=assets[i],got=STORE.materialize(store,i);
  for(const key of Object.keys(expected)){if(expected[key]===undefined){assert(!(key in got),`undefined ${key} must be absent`);continue;}if(typeof expected[key]==='number'&&!Number.isFinite(expected[key])){assert(Object.is(got[key],expected[key]),`${key} non-finite kept`);continue;}assert.equal(canon(got[key]),canon(expected[key]),`asset ${i} field ${key}`);}
  assert.equal(Object.keys(got).length,Object.keys(expected).filter(k=>expected[k]!==undefined).length,`asset ${i} has no extra fields`);
  assert(Object.is(STORE.materialize(store,6).progress,-0),'-0 kept');
 }
 const stats=STORE.stats(store);assert(stats.values<20,`profiles are shared: ${stats.values} values`);return stats;
});

test('materialized objects are independent copies of shared values',()=>{
 const store=STORE.fromAssets([truck(1),truck(2)]),a=STORE.materialize(store,0);a.specs.capacity=999;a.staffing.ready=false;
 assert.equal(STORE.materialize(store,1).specs.capacity,24);assert.equal(STORE.materialize(store,0).staffing.ready,true);
 return {independent:true};
});

test('set/get follow plain-object semantics and re-intern only the written asset',()=>{
 const store=STORE.fromAssets([truck(1),truck(2)]),shared=store.columns.profile[0];assert.equal(store.columns.profile[1],shared);
 STORE.set(store,0,'specs',{...truck(1).specs,capacity:50});assert.notEqual(store.columns.profile[0],shared);assert.equal(store.columns.profile[1],shared);assert.equal(STORE.get(store,1,'specs').capacity,24);
 STORE.set(store,0,'progress',0.75);assert.equal(STORE.get(store,0,'progress'),0.75);
 STORE.set(store,0,'progress','bad');assert.equal(STORE.get(store,0,'progress'),'bad');STORE.set(store,0,'progress',0.5);assert.equal(STORE.get(store,0,'progress'),0.5);assert.equal(STORE.materialize(store,0).progress,0.5);
 STORE.set(store,0,'departureScheduledAt',undefined);assert(!('departureScheduledAt' in STORE.materialize(store,0)));
 STORE.set(store,0,'saleStatus','returning');assert.equal(STORE.get(store,0,'saleStatus'),'returning');STORE.set(store,0,'saleStatus',undefined);assert.equal(STORE.get(store,0,'saleStatus'),undefined);
 STORE.set(store,0,'id','N-ROAD-00009999');assert.equal(STORE.indexOf(store,'N-ROAD-00009999'),0);assert.equal(STORE.indexOf(store,truck(1).id),-1);
 return {ok:true};
});

test('a failed transaction restores every touched row, added rows and removed rows exactly',()=>{
 const state={fleet:STORE.fromAssets(Array.from({length:50},(_,i)=>truck(i))),cash:1};const store=state.fleet,before=canon(STORE.toAssets(store)),length=store.length;
 assert.throws(()=>TX.execute(state,{label:'fleet-rollback',scope:['cash'],apply:()=>{
  state.cash=2;STORE.set(store,3,'progress',0.9);STORE.set(store,3,'specs',{capacity:1});STORE.add(store,truck(500));STORE.remove(store,10);STORE.remove(store,0);STORE.set(store,7,'note','x');
  for(let i=0;i<200;i++)STORE.add(store,truck(1000+i));throw new Error('fleet-late-failure');}}),/fleet-late-failure/);
 assert.equal(state.cash,1);assert.equal(store.length,length);assert.equal(canon(STORE.toAssets(store)),before);assert.equal(STORE.indexOf(store,truck(10).id),10);
 // and a committed transaction keeps its writes
 TX.execute(state,{label:'fleet-commit',scope:['cash'],apply:()=>{STORE.set(store,3,'progress',0.25);STORE.remove(store,0);}});
 assert.equal(store.length,length-1);assert.equal(STORE.get(store,STORE.indexOf(store,truck(3).id),'progress'),0.25);assert.equal(STORE.indexOf(store,truck(0).id),-1);
 return {length:store.length};
});

test('full-snapshot rollback restores typed columns in place',()=>{
 const state={fleet:STORE.ensureCapacity(STORE.fromAssets(Array.from({length:20},(_,i)=>truck(i))),64)||null};state.fleet=state.fleet||STORE.fromAssets([]);
 const fleet=STORE.fromAssets(Array.from({length:20},(_,i)=>truck(i)));STORE.ensureCapacity(fleet,64);state.fleet=fleet;const before=canon(STORE.toAssets(fleet)),progressColumn=fleet.columns.progress;
 assert.throws(()=>TX.execute(state,{label:'fleet-full',apply:()=>{STORE.set(fleet,2,'progress',0.99);STORE.add(fleet,truck(99));STORE.set(fleet,5,'specs',{capacity:3});throw new Error('full-failure');}}),/full-failure/);
 assert.equal(canon(STORE.toAssets(state.fleet)),before);assert.equal(state.fleet.columns.progress,progressColumn,'column identity kept without growth');
 assert.throws(()=>TX.execute(state,{label:'fleet-full-growth',apply:()=>{for(let i=0;i<100;i++)STORE.add(state.fleet,truck(200+i));throw new Error('growth-failure');}}),/growth-failure/);
 assert.equal(canon(STORE.toAssets(state.fleet)),before,'growth inside a failed transaction restores content');return {ok:true};
});

test('compaction drops unreferenced values without changing assets',()=>{
 const store=STORE.fromAssets(Array.from({length:30},(_,i)=>truck(i)));for(let i=0;i<30;i++)STORE.set(store,i,'lastTrip',{revenue:i,margin:i/2});for(let i=0;i<30;i++)STORE.set(store,i,'lastTrip',{revenue:1,margin:2});
 const before=canon(STORE.toAssets(store)),out=STORE.compact(store);assert(out.removed>=30);assert.equal(canon(STORE.toAssets(store)),before);STORE.set(store,0,'lastTrip',{revenue:5});assert.equal(STORE.get(store,0,'lastTrip').revenue,5);return out;
});

test('100k rows stay compact and index lookups are fast',()=>{
 const base=truck(1),t0=performance.now(),store=STORE.create();for(let i=0;i<100000;i++)STORE.add(store,{...base,id:`N-ROAD-${String(i).padStart(8,'0')}`,name:`GH LOGISTICS ${100+i}`,progress:(i%100)/100});
 const built=performance.now()-t0,stats=STORE.stats(STORE.trimCapacity(store));const t1=performance.now();for(let i=0;i<1000;i++)assert.equal(STORE.indexOf(store,`N-ROAD-${String(i*97).padStart(8,'0')}`),i*97);
 assert(stats.bytesPerAsset<160,`compact rows: ${stats.bytesPerAsset}`);assert(stats.values<10);return {buildMs:Math.round(built),lookupMs:Math.round(performance.now()-t1),...stats};
});

const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build354-fleet-store',passed,total:results.length,results},null,2));if(passed!==results.length)process.exitCode=1;
