'use strict';
// Shared Fleet Core v4 fixture: a fleet that covers every slice-engine
// transition branch, its routes and economy context, and the legacy slice
// engine (simulation-asset-core processBatch) driven exactly like app.js.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const CORE=require(path.join(ROOT,'WebApp/simulation-asset-core.js'));
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
module.exports={ROOT,CORE,GUARD_FIELDS,WRITE,INTERVAL,routes,specs,crew,make,fleet,context,resolveRoute,oldSlice,close,compareValue};
