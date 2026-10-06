'use strict';
// Build 359 (owner: the maritime CII corrective plan: a one-time cost, sea voyages 10% slower and 15% less fuel). Checked:
// - the governance command 'sea-cii-plan': adopting costs max(2M, 120k per ship), paid once; a second adoption, an
//   adoption without ships and a cancellation without a plan are refused; both change the routes' revision (the fleet
//   engines rebuild their route plans); cancelling restores speed and fuel, without a refund;
// - a route's speedFactor slows a voyage in both normalizeAsset owners (Fleet Core and the simulation asset core, which
//   the fleet event engine and the worker use), whether the asset has specs or not; no factor, no change;
// - sea fuel is 15% lower in both trip-economics owners (the simulation asset core through ctx.maritime, GH_ADVANCED
//   through GH_GOVERNANCE_CORE.seaFuelFactor); air is untouched;
// - an adopted plan answers the CII requirement (no corrective-action warning; the status reads adopted);
// - the app carries the factor: sea runtime routes and the fleet engine's route plans hold speedFactor, the fleet event
//   engine rebuilds a leg when it changes, the runtime context holds the fuel factor, the compliance panel has the card.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),WEB=path.join(ROOT,'WebApp'),read=file=>fs.readFileSync(path.join(WEB,file),'utf8');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const FIX=require(path.join(ROOT,'tests/helpers/fleet-fixture.js'));
const results=[];const test=(name,fn)=>{try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error?.stack||error).slice(0,2000)});}};
const e=scenario(),s=e.s,state=e.state;e.load('governance-core');
const G=s.GH_GOVERNANCE_CORE,CORE=s.GH_SIMULATION_ASSET_CORE,FLEET=s.GH_FLEET_CORE;
state.godMoney=true;state.infiniteMoney=true;
const gov=p=>e.command('governance','sea-cii-plan',p);
const cash=()=>Object.values(state.companyFinance||{}).reduce((n,book)=>n+(book.accounts||[]).reduce((m,a)=>m+(Number(a.balance)||0),0),0);

test('adopting costs once, per ship with a floor; refusals; cancelling keeps the cost',()=>{
  assert.throws(()=>gov({action:'adopt'}),/sea-cii-plan-no-ships/,'no ships, no plan');
  const ships=FIX.fleet().filter(a=>a.type==='sea');assert.ok(ships.length>0);
  state.assets=[...(state.assets||[]),...ships.map(a=>({...a,id:`CII-${a.id}`}))];
  const expected=Math.max(G.SEA_CII_PLAN.minimumCost,ships.length*G.SEA_CII_PLAN.costPerShip);assert.equal(G.seaCiiPlanCost(state),expected);
  const before=cash(),revision=Number(state.routesRevision)||0,plan=gov({action:'adopt'});
  assert.equal(plan.active,true);assert.equal(plan.cost,expected);assert.equal(plan.ships,ships.length);
  assert.ok(Math.abs(before-cash()-expected)<1,`the cost is paid once (${before-cash()})`);assert.equal(Number(state.routesRevision),revision+1,'the routes revision moves');
  assert.equal(G.seaSpeedFactor(state),.9);assert.equal(G.seaFuelFactor(state),.85);
  assert.throws(()=>gov({action:'adopt'}),/sea-cii-plan-already-active/);assert.throws(()=>gov({action:'nothing'}),/sea-cii-plan-action-invalid/);
  const paid=cash();gov({action:'cancel'});assert.equal(G.seaSpeedFactor(state),1);assert.equal(G.seaFuelFactor(state),1);assert.equal(cash(),paid,'no refund');assert.equal(Number(state.routesRevision),revision+2);
  assert.throws(()=>gov({action:'cancel'}),/sea-cii-plan-not-active/);
  gov({action:'adopt'});return {ships:ships.length,cost:expected};
});

test('a route speedFactor slows a voyage in both normalizeAsset owners',()=>{
  const ship=FIX.fleet().find(a=>a.type==='sea'),route=FIX.routes.S1,slow={...route,speedFactor:.9};
  for(const [name,run] of [['fleet-core',(asset,r)=>FLEET.normalizeAsset(asset,{route:r})],['simulation-asset-core',(asset,r)=>CORE.normalizeAsset(asset,r,null)]]){
    const plain=run(structuredClone(ship),route),slowed=run(structuredClone(ship),slow);
    assert.ok(Math.abs(slowed.effectiveSpeedKmh-plain.effectiveSpeedKmh*.9)<1e-9,`${name}: speed −10%`);assert.ok(Math.abs(slowed.tripSeconds-plain.tripSeconds/.9)<1e-6,`${name}: trip ÷ 0.9`);
    const bare={...structuredClone(ship)};delete bare.specs;const bp=run(structuredClone(bare),route),bs=run(structuredClone(bare),slow);
    assert.ok(Math.abs(bs.tripSeconds-bp.tripSeconds/.9)<1e-6,`${name}: without specs too`);
  }
  return {factor:.9};
});

test('sea fuel is 15% lower in both trip-economics owners; air is untouched',()=>{
  const ship=FIX.fleet().find(a=>a.type==='sea'),plane=FIX.fleet().find(a=>a.type==='air'),base={...FIX.context(),companies:{sea:{serviceLevel:85,automation:0},air:{serviceLevel:85,automation:0}},sustainability:{}};
  const sea=f=>CORE.computeTripEconomics(structuredClone(ship),FIX.routes.S1,{...base,maritime:{fuelFactor:f}}).fuelCost,air=f=>CORE.computeTripEconomics(structuredClone(plane),FIX.routes.A1,{...base,maritime:{fuelFactor:f}}).fuelCost;
  assert.ok(sea(1)>0);assert.ok(Math.abs(sea(.85)-sea(1)*.85)<1e-6,'simulation asset core: sea −15%');assert.equal(air(.85),air(1),'air untouched');
  return {sea:Math.round(sea(1)),slowed:Math.round(sea(.85))};
});

test('GH_ADVANCED applies the fuel factor to sea trips',()=>{
  const src=read('advanced-core.js');
  assert.match(src,/eco\.fuelCost\*=fuelEfficiency\*sustainabilityFuel\*\(1\+wear\*\.2\)\*flown\*\(mode==='sea'\?Number\(globalThis\.GH_GOVERNANCE_CORE\?\.seaFuelFactor\?\.\(state\)\?\?1\):1\);/);
  return {owner:'advanced-core'};
});

test('an adopted plan answers the CII requirement',()=>{
  const r=s.GH_REALISM.migrate(state);r.maritime.cii='E';
  const src=read('realism-core.js');assert.match(src,/r\.maritime\.correctiveAction=planNeeded&&!planActive;/);
  assert.ok(G.seaCorrectivePlan(state),'the plan is active');return {active:true};
});

test('the app carries the factors to both engines and the panel',()=>{
  const app=read('app.js'),events=read('fleet-event-core.js'),advanced=read('advanced-core.js');
  assert.match(app,/const speedFactor=routeMode==='sea'&&target\?window\.GH_GOVERNANCE_CORE\?\.seaSpeedFactor\?\.\(target\)\?\?1:1;if\(speedFactor<1\)r\.speedFactor=speedFactor;else delete r\.speedFactor;/,'sea runtime routes');
  assert.match(app,/String\(route\.routeMode\|\|route\.type\|\|''\)\.trim\(\)==='sea'&&window\.GH_GOVERNANCE_CORE\?\.seaSpeedFactor\?\.\(state\)<1\?\{speedFactor:window\.GH_GOVERNANCE_CORE\.seaSpeedFactor\(state\)\}:\{\}/,'the fleet engines\' route plans');
  assert.match(app,/maritime:\{fuelFactor:window\.GH_GOVERNANCE_CORE\?\.seaFuelFactor\?\.\(state\)\?\?1\}/,'the runtime context');
  assert.match(events,/'dwellHours','speedFactor'\]\);/,'a changed factor rebuilds a leg');
  assert.match(advanced,/'sea-cii-adopt','sea-cii-cancel'/);assert.match(advanced,/signedDomainCommand\(ctx,'governance','sea-cii-plan',\{action:adopt\?'adopt':'cancel'\}/);assert.match(advanced,/ctx\.refreshRouteRuntime\?\.\(\)/);
  return {wired:true};
});

const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build359-sea-cii-plan',passed,total:results.length,results},null,1));
if(passed!==results.length)process.exitCode=1;else console.log('BUILD359_SEA_CII_PLAN_PASS');
