'use strict';
const assert=require('assert'),fs=require('fs');
const {scenario}=require('./helpers/business-scenario');

// A delivery that matures between hour boundaries must close through the slice hook.
{
  const {s,state,ctx,request}=scenario();
  const r=request(2);assert(s.GH_REQUEST_CORE.authorize(ctx,r.id));s.GH_REQUEST_CORE.tick(ctx);
  assert.strictEqual(r.status,'delivering');state.simSeconds=61;s.GH_REALISM.onSimulationTime(state,61);
  s.GH_REQUEST_CORE.onSimulationTime(ctx);assert.strictEqual(r.status,'readiness');
  s.GH_DOMAIN_COMMANDS.dispatch({...ctx},'hr','hire',{company:'air',scope:'all',source:'test'});
  s.GH_REQUEST_CORE.onSimulationTime(ctx);assert.strictEqual(r.status,'completed');
  assert(!state.advanced.procurement.assetRequests.some(x=>x.id===r.id));
}

// The new mobility company is a real financial and operational lifecycle.
{
  const {s,state,ctx,command,load}=scenario();load('mobility-core');
  command('corporate','open-company',{type:'mobility',capital:18000000,legalName:'GH Mobility'});
  const starting=s.GH_FINANCE_CORE.operating(state,'mobility'),launched=s.GH_MOBILITY_CORE.launch(ctx);
  assert.strictEqual(launched.status,'active');assert.strictEqual(launched.vehicles,80);assert(launched.drivers>=108);
  assert(s.GH_FINANCE_CORE.operating(state,'mobility')<starting,'launch CAPEX must hit the company book');
  state.simSeconds=90;s.GH_MOBILITY_CORE.onSimulationTime(ctx,90);assert(s.GH_MOBILITY_CORE.snapshot(state).activeTrips>0);
  state.simSeconds=7200;s.GH_MOBILITY_CORE.onSimulationTime(ctx,7200);const snap=s.GH_MOBILITY_CORE.snapshot(state);
  assert(snap.completed>0,'rides must arrive and complete');assert(snap.grossBookings>0&&snap.platformRevenue>0);
  assert((state.tripCountAccrued.mobility||0)>0&&(state.tripRevenueAccrued.mobility||0)>0);
  assert(state.advanced.labor.employmentContracts.some(x=>x.company==='mobility'&&x.status==='ساري'));
}

// Prevent regression to an external-map hard dependency or unchecked activation.
{
  const app=fs.readFileSync('WebApp/app.js','utf8'),adv=fs.readFileSync('WebApp/advanced-core.js','utf8'),required=JSON.parse(fs.readFileSync('WebApp/runtime-required.json','utf8'));
  assert(app.includes('fallbackRoadGeometry')&&app.includes('options.deterministic'));
  assert(adv.includes('createAutomaticRoutes(execution.assetIds,{deterministic:true})'));
  assert(app.includes("if(activateAutomaticRoute(asset,existing))")&&app.includes("if(activateAutomaticRoute(asset,route))"));
  assert(required.files.includes('mobility-core.js'));
}

console.log('Root Lifecycle + Mobility Build253: PASS');
