'use strict';
// Fleet Core v4 parity: the event engine must produce the same assets and the
// same economic effects as the current slice engine (simulation-asset-core
// processOne driven exactly like app.js), slice after slice, for a fleet that
// covers every transition branch.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const CORE=require(path.join(ROOT,'WebApp/simulation-asset-core.js')),STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),EVENTS=require(path.join(ROOT,'WebApp/fleet-event-core.js'));
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
const GUARD_FIELDS=(()=>{const write=JSON.parse(app.match(/const SIMULATION_ASSET_FIELDS=(\[[^\]]+\])/)[1].replace(/'/g,'"')),extra=JSON.parse(app.match(/const SIMULATION_ASSET_GUARD_FIELDS=\[\.\.\.SIMULATION_ASSET_FIELDS,([^\]]+)\]/)[1].replace(/^/,'[').replace(/$/,']').replace(/'/g,'"'));return [...write,...extra];})();
const WRITE=CORE.WRITE_FIELDS,INTERVAL={air:180,sea:60,road:15};

const routes={
 R1:{id:'R1',type:'road',routeMode:'road',ownerCompanyId:'road',from:'Riyadh hub',to:'Dammam drop',fromFacility:'F-ROAD-A',toFacility:'P-ROAD-B',distanceKm:199.0119,tripSeconds:10474.3,effectiveSpeedKmh:68.4,dwellHours:2.5},
 R2:{id:'R2',type:'road',routeMode:'road',ownerCompanyId:'road',from:'Owned A',to:'Owned C',fromFacility:'F-ROAD-A',toFacility:'F-ROAD-C',distanceKm:420,tripSeconds:22000,effectiveSpeedKmh:70,dwellHours:1},
 A1:{id:'A1',type:'air',routeMode:'air',ownerCompanyId:'air',from:'RUH',to:'DXB',fromFacility:'F-AIR-A',toFacility:'P-AIR-B',distanceKm:870,tripSeconds:4500,effectiveSpeedKmh:700,dwellHours:1.25},
 S1:{id:'S1',type:'sea',routeMode:'sea',ownerCompanyId:'sea',from:'Jeddah',to:'Suez',fromFacility:'F-SEA-A',toFacility:'P-SEA-B',distanceKm:1200,tripSeconds:150000,effectiveSpeedKmh:30,dwellHours:12},
 TINY:{id:'TINY',type:'road',routeMode:'road',ownerCompanyId:'road',from:'Yard 1',to:'Yard 2',fromFacility:'F-ROAD-A',toFacility:'P-ROAD-T',distanceKm:0.5,tripSeconds:30,effectiveSpeedKmh:60,dwellHours:0},
 ZERO:{id:'ZERO',type:'road',routeMode:'road',ownerCompanyId:'road',from:'Z1',to:'Z2',fromFacility:'F-ROAD-A',toFacility:'P-ROAD-Z',distanceKm:0,tripSeconds:0,effectiveSpeedKmh:60,dwellHours:1}
};
const specs={road:{rangeKm:1800,speedKmh:90,capacity:24,capacityUnit:'طن',fuelLPer100km:32,electric:false,yieldMultiplier:1},air:{speedKmh:830,capacity:180,capacityUnit:'راكب',fuelBurnKgPerKm:4.2,yieldMultiplier:1.05},sea:{speedKn:18,capacity:4000,capacityUnit:'TEU',fuelTonPerDay:60,yieldMultiplier:1}};
const crew={road:{mode:'automatic-fixed',ready:true,roles:[{id:'drivers',count:2,monthlyPayroll:9000}],total:2,monthlyPayroll:9000,contractId:'EMP-B-1',provisionedAt:0,center:'RUH'},air:{mode:'automatic-fixed',ready:true,roles:[],total:12,monthlyPayroll:96000,contractId:'EMP-B-2',provisionedAt:0,center:'RUH'},sea:{mode:'automatic-fixed',ready:true,roles:[],total:20,monthlyPayroll:120000,contractId:'EMP-B-3',provisionedAt:0,center:'JED'}};
let serial=0;
function make(mode,routeId,props={}){
 serial++;const route=routes[routeId]||null,base=props.baseFacility||route?.fromFacility||'F-ROAD-A';
 const asset={id:`N-${mode.toUpperCase()}-${String(serial).padStart(8,'0')}`,ownerCompanyId:mode,assetMode:mode,assetClass:mode,type:mode,name:`GH ${mode} ${serial}`,catalogId:`C-${mode}`,specs:structuredClone(specs[mode]),staffing:structuredClone(crew[mode]),
  routeId,baseFacility:base,phase:'turnaround',progress:0,fuel:100,condition:90,dwellRemaining:0,reverse:false,routeSlot:serial%6,departureScheduled:false,crewBlocked:false,releaseExclusiveRouteOnArrival:false,...props};
 if(route){CORE.normalizeAsset(asset,route,null);}
 return asset;
}
function fleet(){
 serial=0;const out=[];
 for(let i=0;i<160;i++)out.push(make('road','R1',{phase:i%3===0?'moving':'turnaround',progress:i%3===0?(i%17)/17:0,dwellRemaining:(i*311)%9000,reverse:i%2===0,baseFacility:i%2===0?'P-ROAD-B':'F-ROAD-A',condition:60+i%40,fuel:40+i%60}));
 for(let i=0;i<60;i++)out.push(make('road','R2',{phase:i%2?'moving':'turnaround',progress:(i%9)/9,dwellRemaining:i*120,salePending:i%5===0,baseFacility:i%2?'F-ROAD-A':'F-ROAD-C'}));
 for(let i=0;i<80;i++)out.push(make('air','A1',{phase:i%2?'moving':'turnaround',progress:(i%11)/11,dwellRemaining:i*45,reverse:i%3===0,baseFacility:i%3===0?'P-AIR-B':'F-AIR-A',releaseExclusiveRouteOnArrival:i%13===0}));
 for(let i=0;i<30;i++)out.push(make('sea','S1',{phase:i%2?'moving':'turnaround',progress:(i%7)/7,dwellRemaining:i*900,salePending:i%4===0}));
 for(let i=0;i<6;i++)out.push(make('road','TINY',{phase:'moving',progress:0.2}));
 for(let i=0;i<4;i++)out.push(make('road','ZERO',{phase:'moving',progress:0.3}));
 for(let i=0;i<5;i++)out.push(make('road','R1',{phase:'turnaround',dwellRemaining:200*i,staffing:{...crew.road,ready:false}}));
 for(let i=0;i<4;i++)out.push(make('road','R-MISSING',{phase:'moving',progress:0.4}));
 for(let i=0;i<4;i++)out.push(make('road','R1',{phase:'turnaround',dwellRemaining:30,baseFacility:'ELSEWHERE'}));
 for(let i=0;i<4;i++)out.push(make('road','R1',{phase:'moving',progress:0.5,simulationFault:{code:'PRESET',at:1}}));
 for(let i=0;i<6;i++)out.push(make('road','R1',{phase:'idle'}));
 for(let i=0;i<4;i++){const a=make('road','R1',{phase:'moving',progress:0.1});delete a.phase;out.push(a);}
 for(let i=0;i<4;i++)out.push(make('road',null,{phase:'idle',routeId:null}));
 return out;
}
const context=t=>({companies:{road:{serviceLevel:82,automation:15},air:{serviceLevel:90,automation:30},sea:{serviceLevel:70,automation:0}},research:{efficiency:20,automation:10,cleanEnergy:5},sustainability:{safShare:4,shorePower:10,electricRoadShare:6},economy:{jetFuel:.9,bunker:610,diesel:1.02,airDemand:104,seaDemand:96,roadDemand:101},market:{share:{road:6,air:4},competitorPressure:{sea:55}},reputation:{road:72,air:68},ownedFacilities:['F-ROAD-A','F-ROAD-C','F-AIR-A','F-SEA-A'],simSeconds:t});
const resolveRoute=routeId=>routes[routeId]?{...routes[routeId]}:null;

// Old engine, driven exactly like app.js createSimulationSliceJob + apply.
function oldSlice(assets,from,to){
 const effects=CORE.makeEffects(),rows=[];
 for(const asset of assets){const guarded={};for(const f of GUARD_FIELDS)guarded[f]=asset[f];const dto={id:asset.id,...JSON.parse(JSON.stringify(guarded))};dto.ownerCompanyId=CORE.assetOwner(dto);
  rows.push({id:asset.id,asset:dto,route:asset.routeId&&routes[asset.routeId]?{...routes[asset.routeId]}:null,catalogSpecs:null,departureDelay:Math.max(0,Math.floor(Number(asset.routeSlot)||0))*(INTERVAL[asset.assetMode]||0)});}
 const results=[];for(let i=0;i<rows.length;i+=256)results.push(...CORE.processBatch({type:'process',requestId:1,rows:rows.slice(i,i+256),context:context(from),simAdvance:to-from,simMeta:{from,to}}));
 assert(CORE.validateResults(rows,results));
 results.forEach((res,i)=>{const asset=assets[i];for(const f of WRITE){const v=res.patch[f];asset[f]=v&&typeof v==='object'?JSON.parse(JSON.stringify(v)):v;}
  effects.todayProfit+=res.effects.todayProfit;effects.groupValue+=res.effects.groupValue;for(const k of ['sectorProfit','tripProfit','tripRevenue','tripFuel','tripMaintenance','tripCount','cash'])for(const [c,v] of Object.entries(res.effects[k]))effects[k][c]=(effects[k][c]||0)+v;
  effects.alerts.push(...res.effects.alerts);effects.saleIds.push(...res.effects.saleIds);effects.retiredRouteIds.push(...res.effects.retiredRouteIds);});
 return effects;
}
const close=(a,b,tol)=>Object.is(a,b)||(typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=tol*Math.max(1,Math.abs(a),Math.abs(b)));
function compareValue(label,a,b,tol=1e-7){
 if(a&&typeof a==='object'&&b&&typeof b==='object'){const keys=new Set([...Object.keys(a),...Object.keys(b)]);for(const k of keys)compareValue(`${label}.${k}`,a[k],b[k],tol);return;}
 if(a===undefined||b===undefined||a===null||b===null){assert.equal(a??null,b??null,label);return;}
 if(typeof a==='number')assert(close(a,b,tol),`${label}: old ${a} new ${b}`);else assert.deepEqual(a,b,label);
}
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
