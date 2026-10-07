'use strict';
// Build 359 (every command deep-copied the fleet routes, 2.4 MB, and every published command cloned and measured them
// again): Route Core adds, replaces and removes a route, never edits one, so the routes root is sealed
// (GH_TRANSACTION_CORE.registerSealedRoot): drafts and snapshots copy its membership and share the routes. Checked here:
// 1. sealing freezes the routes; a draft and a rollback snapshot share them in their own array; an edit in place throws;
// 2. Route Core's writers work on sealed routes (set-fleet-capacity replaces the route, delete filters) and a rollback
//    restores the exact routes;
// 3. the company platform migration (migrateState) patches its own copy and leaves the sealed routes alone.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,ROUTES=s.GH_ROUTE_CORE;
const results=[];const test=(name,fn)=>{results.push({name,detail:fn()});console.log(`PASS ${name}`);};
const R=(id,shift)=>({id,type:'air',routeMode:'air',ownerCompanyId:'air',name:id,from:'A',to:'B',fromFacility:'B1',toFacility:`PUBLIC-air-${id}`,route:[[24.7+shift,46.6],[25.2+shift,47.1+shift]],distanceKm:90,maxLegKm:90,effectiveSpeedKmh:600,tripSeconds:540,dwellHours:1});
state.customRoutes=[R('QA-R1',0),R('QA-R2',1),R('QA-R3',2)];

test('routes are sealed and shared; an edit in place throws',()=>{
  TX.sealCollections(state);const routes=state.customRoutes;
  assert.ok(routes.every(route=>TX.isSealed(route)&&Object.isFrozen(route)&&Object.isFrozen(route.route)),'every route is sealed, geometry too');
  const draft=TX.deepClone(state,{shareJournaledRoots:true}),snapshot=TX.deepClone(state,{shareSealed:true});
  for(const copy of [draft,snapshot]){assert.notEqual(copy.customRoutes,routes,'its own array');assert.ok(copy.customRoutes.every((route,index)=>route===routes[index]),'the same routes');}
  assert.throws(()=>{routes[0].fleetCapacity=99;},TypeError);assert.throws(()=>{routes[0].route[0][0]=0;},TypeError);
  return {routes:routes.length};
});

test('Route Core writes sealed routes by replacing them; a rollback restores them exactly',()=>{
  const original=state.customRoutes.find(route=>route.id==='QA-R2'),text=JSON.stringify(state.customRoutes);
  const out=TX.execute(state,{label:'qa-route-capacity',apply:()=>ROUTES.execute({state},'set-fleet-capacity',{id:'QA-R2',capacity:48})});
  assert.equal(out.committed,true,out.reason);const replaced=state.customRoutes.find(route=>route.id==='QA-R2');
  assert.equal(replaced.fleetCapacity,48);assert.notEqual(replaced,original,'replaced, not edited');assert.equal(original.fleetCapacity,undefined,'the sealed original is unchanged');
  TX.sealCollections(state);const sealed=JSON.stringify(state.customRoutes);
  assert.throws(()=>TX.execute(state,{label:'qa-route-delete-rollback',apply:()=>{ROUTES.execute({state},'delete',{id:'QA-R1'});assert.equal(state.customRoutes.length,2);throw new Error('qa-injected');}}),/qa-injected/);
  assert.equal(JSON.stringify(state.customRoutes),sealed,'the rollback restores the routes exactly');
  assert.notEqual(text,sealed);
  return {capacity:replaced.fleetCapacity};
});

test('the company platform migration patches a copy and leaves the sealed routes alone',()=>{
  const legacy={...R('QA-LEGACY',3)};delete legacy.routeMode;delete legacy.ownerCompanyId;legacy.company='air';
  state.customRoutes=[...state.customRoutes,legacy];TX.sealCollections(state);assert.ok(Object.isFrozen(legacy));
  const migrated=s.GH_COMPANY_PLATFORM.migrateState(state),route=(migrated.state||migrated).customRoutes.find(row=>row.id==='QA-LEGACY');
  assert.equal(route.routeMode,'air');assert.equal(route.ownerCompanyId,'air');assert.equal(legacy.routeMode,undefined,'the sealed route is untouched');
  return {routeMode:route.routeMode};
});

console.log(JSON.stringify({suite:'build359-route-seal',results},null,1));
console.log('BUILD359_ROUTE_SEAL_PASS');
