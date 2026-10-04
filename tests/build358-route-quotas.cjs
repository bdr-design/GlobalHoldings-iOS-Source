'use strict';
// Build 358 (million-asset routes), from an iPhone diagnostic (33,000 assets): 1,000 new aircraft at a new base could not
// take off ("route-capacity") and trucks could not depart. The route registry held 240 routes shared by every mode; a
// large air dispatch spread its fleet over nearly all of them, leaving a new base or a road fleet no route; road routes
// never carried more than 64 trucks.
// Now: 960 routes in three mode quotas of 320 (air, sea, road); a route carries up to 8,192 assets; dispatch shares the
// mode's free slots between waiting origins and raises the load instead of failing, keeping a reserve for later bases.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;
require(path.join(process.env.GH_TEST_SOURCE_DIR,'WebApp/route-core.js'));
const R=globalThis.GH_ROUTE_CORE;

// 1. Limits and quotas; one mode full never blocks another.
assert.equal(R.LIMITS.routes,960);assert.equal(R.LIMITS.endpoints,1440);assert.equal(R.LIMITS.fleetCapacity,8192);
assert.deepEqual({...R.MODE_ROUTE_QUOTA},{air:320,sea:320,road:320});
const point=(lat,lng)=>[lat,lng];
const route=(mode,i)=>({id:`${mode.toUpperCase()}-${i}`,type:mode,routeMode:mode,ownerCompanyId:mode,fromFacility:`${mode}-A`,toFacility:`${mode}-B-${i}`,route:[point(10+i*.01,20),point(10+i*.01,21+(i%7)*.1)]});
const fullAir={customRoutes:Array.from({length:320},(_,i)=>route('air',i))};
const air=R.modeRouteBudget(fullAir,'air'),road=R.modeRouteBudget(fullAir,'road');
assert.deepEqual([air.used,air.free],[320,0],'air quota full');assert.deepEqual([road.used,road.free],[0,320],'road keeps its whole quota');
assert.equal(road.planning,320-road.reserve,'a dispatch plans over the quota minus the reserve for later bases');

// 2. Slot allocation: preferred load while slots allow; else shared slots and a higher load; never above 8,192.
assert.deepEqual(R.allocateRouteSlots([100,40],20,24).map(r=>r.load),[24,24]);
const tight=R.allocateRouteSlots([1000],8,30);assert.deepEqual([tight[0].routes,tight[0].load],[8,125],'1,000 aircraft on the 8 slots left');
assert.throws(()=>R.allocateRouteSlots([1,1,1],2,24),error=>error.code==='route-mode-capacity'&&error.needed===3&&error.free===2);
const million=R.allocateRouteSlots(Array(5).fill(200000),320,48),routes=million.reduce((n,r)=>n+r.routes,0);
assert.ok(routes<=320&&million.every(r=>r.load<=8192&&r.routes*r.load>=200000),`1,000,000 assets on 5 bases fit one mode quota: ${JSON.stringify(million)}`);
// The reserve: a later base still finds slots after a large dispatch.
let free=320;const reserve=Math.ceil(320*.1);
for(let base=0;base<8;base++){const plan=R.allocateForBudget({free,reserve},[1000],30);assert.ok(plan[0].routes>=1,`base ${base} gets routes (${free} free)`);free-=plan[0].routes;}
assert.ok(free>0,`slots stay free for more bases (${free})`);
console.log(`PASS quotas and allocation: 1,000,000 assets on ${routes} routes; 8 successive bases leave ${free} slots`);

// 3. Route creation enforces the mode quota.
{
  const state={customRoutes:Array.from({length:320},(_,i)=>route('air',i)),routeEndpoints:{},routeCache:{}};
  assert.throws(()=>R.execute({state},'create',{route:route('air',999)}),/route-mode-capacity/,'air beyond its quota is refused');
}

// 4. Road planner: trucks at two depots with 4 free road slots depart on 4 routes that carry the raised load.
(async()=>{
  require(path.join(process.env.GH_TEST_SOURCE_DIR,'WebApp/determinism-core.js'));
  require(path.join(process.env.GH_TEST_SOURCE_DIR,'WebApp/road-planner.js'));
  const origins=[{id:'DEPOT-1',name:'مستودع ١',company:'road',coords:[24.7,46.7],city:'الرياض',country:'السعودية'},{id:'DEPOT-2',name:'مستودع ٢',company:'road',coords:[21.5,39.2],city:'جدة',country:'السعودية'}];
  const assets=Array.from({length:5000},(_,i)=>({id:`T-${String(i).padStart(5,'0')}`,name:`truck ${i}`,type:'road',assetMode:'road',ownerCompanyId:'road',baseFacility:origins[i%2].id,specs:{rangeKm:900},staffing:{mode:'automatic-fixed',ready:true}}));
  let calls=0;const provider={roadBatch:async pairs=>{calls++;return {ok:true,geometries:pairs.map(({from,to})=>({route:[from,[(from[0]+to[0])/2,(from[1]+to[1])/2],to],distanceKm:60,durationSeconds:3600}))};}};
  const plan=await globalThis.GH_ROAD_PLANNER.plan({assets,routes:[],originFor:asset=>origins.find(o=>o.id===asset.baseFacility),usable:()=>false,provider,routeCount:956,seed:3,targetRouteLoad:48,routeCapacity:()=>64,newRouteCapacity:64,routeBudget:{free:4,reserve:0},maxRouteCapacity:8192,intervalMs:0,yieldControl:async()=>{}});
  assert.equal(plan.length,5000,'every truck is planned');
  const created=plan.filter(row=>row.created),loads=new Map();for(const row of plan)loads.set(row.route.id,(loads.get(row.route.id)||0)+1);
  assert.equal(created.length,4,'4 routes on the 4 free slots');
  assert.ok(created.every(row=>row.route.fleetCapacity>=1250&&row.route.fleetCapacity<=8192),'new routes carry the raised load');
  for(const [id,load] of loads)assert.ok(load<=created.find(row=>row.route.id===id).route.fleetCapacity,`route ${id} within its capacity`);
  assert.equal(calls<=2,true,'two network batches for 4 routes');
  await assert.rejects(globalThis.GH_ROAD_PLANNER.plan({assets:assets.slice(0,10),routes:[],originFor:asset=>origins.find(o=>o.id===asset.baseFacility),usable:()=>false,provider,routeCount:959,seed:3,targetRouteLoad:48,routeCapacity:()=>64,routeBudget:{free:1,reserve:0},intervalMs:0,yieldControl:async()=>{}}),/حصة مسارات الشاحنات ممتلئة/,'two depots and one free slot: a clear message');
  console.log(`PASS road planner: 5,000 trucks on ${created.length} routes of ${created[0].route.fleetCapacity}`);
  console.log('BUILD358_ROUTE_QUOTAS_PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
