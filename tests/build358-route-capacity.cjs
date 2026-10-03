'use strict';
// Build 358 (million-asset): the route registry holds 240 routes and a route carried at most 24 aircraft or ships
// (64 trucks), so no more than 5,760 aircraft could ever fly. A route may now carry more when its record says so
// (route.fleetCapacity, up to 8,192); it keeps its mode's 24 departure slots and further assets share their times.
// Checked here: the capacity rules in Fleet Core, Route Core and Save Schema agree, departure delays in Fleet Core and
// the event engine stay equal, batch commands accept one route table instead of a route per row, and the batch
// commands no longer depend on drafts of the whole fleet.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');process.env.GH_TEST_SOURCE_DIR=ROOT;
const {harness,minimal}=require('./helpers/core-harness');
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,1600)});}}
const {s}=harness(['fleet-store-core','simulation-asset-core','fleet-event-core','fleet-access-core','route-core','fleet-core','save-schema','transaction-core']);
const FLEET=s.GH_FLEET_CORE,ROUTES=s.GH_ROUTE_CORE,SCHEMA=s.GH_SAVE_SCHEMA,STORE=s.GH_FLEET_STORE;
const ENGINE_STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),EVENTS=require(path.join(ROOT,'WebApp/fleet-event-core.js')),FIXTURE=require('./helpers/fleet-fixture.js');
const R=(id,type='air',shift=0,extra={})=>({id,type,company:type,name:id,from:'A',to:'B',fromFacility:`BASE-${type}`,toFacility:`PUBLIC-${type}-${id}`,route:[[24.7+shift,46.6],[25.2+shift,47.1+shift]],distanceKm:90,maxLegKm:90,effectiveSpeedKmh:60,tripSeconds:5400,dwellHours:1,...extra});
const A=(id,type='air')=>({id,name:id,type,baseFacility:`BASE-${type}`,phase:'idle',progress:0,fuel:100,condition:100,deliveryStatus:'delivered',salePending:false,routeId:null,routeSlot:null,departureScheduled:false,staffing:{mode:'automatic-fixed',ready:true,roles:[],total:1,monthlyPayroll:1}});

test('capacity: the base unless the route record carries more, never above the maximum',()=>{
  assert.equal(FLEET.routeCapacity('air'),24);assert.equal(FLEET.routeCapacity('road'),64);
  assert.equal(FLEET.routeCapacity(R('X')),24);
  assert.equal(FLEET.routeCapacity(R('X','air',0,{fleetCapacity:51})),51);
  assert.equal(FLEET.routeCapacity(R('X','air',0,{fleetCapacity:10})),24,'below the base keeps the base');
  assert.equal(FLEET.routeCapacity(R('X','air',0,{fleetCapacity:99999})),8192,'above the maximum is clamped');
  assert.equal(FLEET.routeCapacity(R('X','air',0,{fleetCapacity:51.5})),24,'only integers count');
  assert.equal(FLEET.requiredRouteCapacity('air',5760,240),24);assert.equal(FLEET.requiredRouteCapacity('air',12000,236),51);
  assert.equal(FLEET.requiredRouteCapacity('air',1000000,240),4167);assert.equal(FLEET.requiredRouteCapacity('air',5e6,240),8192);
  const big=FLEET.automaticRouteTargetLoad('air',12000,233,52);assert.ok(big<=52&&Math.ceil(12000/big)<=233,`target ${big}`);
  assert.equal(FLEET.automaticRouteTargetLoad('air',300,240),FLEET.automaticRouteTargetLoad('air',300,240,24),'small fleets plan as before');
  return {big};
});

test('departure delays: Fleet Core and the event engine wrap slots past the base the same way',()=>{
  const interval=FLEET.ROUTE_DEPARTURE_INTERVAL_SECONDS;
  for(const mode of ['air','sea','road'])for(const slot of [0,1,23,24,25,47,63,64,65,4000]){
    const base=FLEET.ROUTE_FLEET_CAPACITY[mode],expected=(slot%base)*interval[mode];
    assert.equal(FLEET.departureDelay({type:mode,routeSlot:slot}),expected,`${mode} slot ${slot}`);
    if(slot<base)assert.equal(expected,slot*interval[mode],'slots inside the base keep their former delay');
  }
  // The engine: on arrival a slot past the base departs with the slot it wraps onto (30 -> 6), one interval after 5.
  const template=FIXTURE.fleet().find(a=>a.routeId==='A1'&&a.phase==='moving'&&!a.simulationFault&&!a.salePending);assert.ok(template,'fixture aircraft');
  const rows=[5,6,30].map(slot=>({...structuredClone(template),id:`SLOT-${slot}`,routeSlot:slot,progress:.999,departureScheduled:false}));
  const store=ENGINE_STORE.fromAssets(rows,{at:0});EVENTS.advance(store,{from:0,to:3600,context:FIXTURE.context(0),resolveRoute:FIXTURE.resolveRoute,order:'sweep'});
  const at=ENGINE_STORE.toAssets(store).map(a=>a.departureScheduledAt);
  assert.ok(at.every(Number.isFinite),`scheduled departures ${JSON.stringify(at)}`);
  assert.equal(at[2],at[1],'slot 30 departs with slot 6');assert.equal(at[1]-at[0],interval.air,'slot 6 departs one interval after slot 5');
  return {wrapped:true};
});

test('route core: fleetCapacity is validated, set-fleet-capacity raises it and refuses less than the route carries',()=>{
  const state={...minimal(),saveVersion:'3.0.0',customRoutes:[R('AIR-1')]};state.fleet=STORE.create();delete state.assets;
  assert.equal(ROUTES.validateRoute(R('V','air',0,{fleetCapacity:51}),{requireCompany:false}).ok,true);
  for(const bad of [0,-1,1.5,'60',8193])assert.equal(ROUTES.validateRoute(R('V','air',0,{fleetCapacity:bad}),{requireCompany:false}).errors.includes('route-fleetCapacity'),true,`bad ${bad}`);
  const revision=state.routesRevision||0;const updated=ROUTES.execute({state},'set-fleet-capacity',{id:'AIR-1',capacity:60,inUse:40});
  assert.equal(updated.fleetCapacity,60);assert.equal(state.customRoutes[0].fleetCapacity,60);assert.ok(state.routesRevision>revision);
  assert.throws(()=>ROUTES.execute({state},'set-fleet-capacity',{id:'AIR-1',capacity:30,inUse:40}),/below-use/);
  assert.throws(()=>ROUTES.execute({state},'set-fleet-capacity',{id:'AIR-1',capacity:9000}),/invalid/);
  assert.throws(()=>ROUTES.execute({state},'set-fleet-capacity',{id:'NOPE',capacity:30}),/missing/);
  return {capacity:state.customRoutes[0].fleetCapacity};
});

test('batch commands: a route table equals a route per row, slots past the base are accepted up to the route capacity',()=>{
  const build=()=>{const route=R('AIR-BIG','air',0,{fleetCapacity:40}),assets=Array.from({length:40},(_,i)=>A(`AIR-${String(i).padStart(3,'0')}`)),state={...minimal(),saveVersion:'3.0.0',customRoutes:[route]};state.fleet=STORE.fromAssets(assets,{at:0});delete state.assets;return {state,route,assets};};
  const perRow=build(),table=build();
  FLEET.assignRoutesBatch(perRow.state,perRow.assets.map(a=>({id:a.id,routeId:'AIR-BIG',baseFacility:a.baseFacility,phase:'turnaround',route:perRow.route})));
  FLEET.execute({state:table.state},'assign-routes-batch',{assignments:table.assets.map(a=>({id:a.id,routeId:'AIR-BIG',baseFacility:a.baseFacility,phase:'turnaround',routeRef:'r'})),routes:{r:table.route}});
  const plain=state=>JSON.stringify(STORE.toAssets(state.fleet));assert.equal(plain(table.state),plain(perRow.state),'same assignment either way');
  const slots=STORE.toAssets(table.state.fleet).map(a=>a.routeSlot);assert.equal(JSON.stringify(slots),JSON.stringify(Array.from({length:40},(_,i)=>i)),'slots 0..39 on a 40-aircraft route');
  assert.equal(SCHEMA.validate(table.state).errors.includes('asset-route-capacity'),false,'the save accepts 40 users on a route of capacity 40');
  const departures=table.assets.map(a=>({id:a.id,routeRef:'r',delaySeconds:FLEET.departureDelay({...a,routeSlot:slots[table.assets.indexOf(a)]})}));
  FLEET.execute({state:table.state},'depart-batch',{departures,routes:{r:table.route}});
  assert.equal(STORE.toAssets(table.state.fleet).every(a=>a.phase==='moving'||a.departureScheduled),true,'every aircraft departs or holds a slot');
  // One more aircraft than the route carries is refused, and so is a missing route reference.
  const over=build();over.route.fleetCapacity=39;
  assert.throws(()=>FLEET.execute({state:over.state},'assign-routes-batch',{assignments:over.assets.map(a=>({id:a.id,routeId:'AIR-BIG',baseFacility:a.baseFacility,phase:'turnaround',routeRef:'r'})),routes:{r:over.route}}),/asset-route-capacity/);
  const missing=build();
  assert.throws(()=>FLEET.execute({state:missing.state},'assign-routes-batch',{assignments:[{id:missing.assets[0].id,routeId:'AIR-BIG',baseFacility:'BASE-air',phase:'turnaround',routeRef:'nope'}],routes:{r:missing.route}}),/route-assignment-contract|route-ownership-missing/);
  return {assigned:40};
});

test('save schema: users above the route capacity and invalid capacities are refused',()=>{
  const route=R('AIR-S','air',0,{fleetCapacity:30}),assets=Array.from({length:30},(_,i)=>({...A(`S-${i}`),routeId:'AIR-S',routeSlot:i,phase:'turnaround'}));
  const make=r=>{const state={...minimal(),saveVersion:'3.0.0',customRoutes:[r]};state.fleet=STORE.fromAssets(assets,{at:0});delete state.assets;return state;};
  assert.equal(SCHEMA.validate(make(route)).errors.includes('asset-route-capacity'),false,'30 users on capacity 30');
  assert.equal(SCHEMA.validate(make({...route,fleetCapacity:undefined})).errors.includes('asset-route-capacity'),true,'30 users on the base 24');
  assert.equal(SCHEMA.validate(make({...route,fleetCapacity:20000})).errors.includes('route-shape'),true,'capacity above the maximum');
  return {ok:true};
});

const passed=results.filter(r=>r.ok).length;
console.log(JSON.stringify({suite:'build358-route-capacity',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;
