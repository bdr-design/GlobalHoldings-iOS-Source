'use strict';
const assert=require('assert'),fs=require('fs');
const {harness}=require('./helpers/core-harness');

const {s}=harness(['transaction-core','domain-command-core','route-core','fleet-core']);
const F=s.GH_FLEET_CORE;

assert.strictEqual(F.routeCapacity('air'),24,'air scheduled-corridor hard capacity must stay bounded at 24');
assert.strictEqual(F.routeCapacity('sea'),24,'sea hard safety capacity must remain unchanged');
assert.strictEqual(F.routeCapacity('road'),64,'road hard safety capacity must remain unchanged');
assert.strictEqual(typeof F.automaticRouteTargetLoad,'function','automatic diversity policy is missing');

// Automatic planning must deliberately stay well below every hard shared-route
// ceiling. Air corridors are shared through unique departure slots instead of
// allocating one persistent route per aircraft.

const air300=F.automaticRouteTargetLoad('air',300,240);
assert.strictEqual(air300,12,'300-aircraft automatic planning should target 12 aircraft per scheduled corridor');
assert.strictEqual(Math.ceil(300/air300),25,'300 aircraft should need only 25 bounded shared routes');
assert(F.departureDelay({type:'air',routeSlot:11})>F.departureDelay({type:'air',routeSlot:1}),'air route slots must create staggered departures');

const sea50=F.automaticRouteTargetLoad('sea',50,240);
assert(sea50<=5,'50 ships are still packed too densely ('+sea50+' per route)');
assert(Math.ceil(50/sea50)>=10,'50 ships must spread over at least ten maritime routes when route budget is available');

const sea25=F.automaticRouteTargetLoad('sea',25,240);
assert(sea25<=5,'25 ships must no longer collapse into two near-capacity routes');

const road50=F.automaticRouteTargetLoad('road',50,240);
assert(road50<=8,'a normal 50-truck fleet should spread across at least seven road corridors when route budget is available');

const road1000=F.automaticRouteTargetLoad('road',1000,240);
assert(road1000>=32&&road1000<=48,'large road fleets must remain bounded to protect save size/provider load');
assert(Math.ceil(1000/road1000)<=32,'1000-truck planning must stay within a bounded route count');

const constrained=F.automaticRouteTargetLoad('sea',50,3);
assert(constrained<=24&&Math.ceil(50/constrained)<=3,'route-budget constraint must safely relax diversity without exceeding hard capacity');

const app=fs.readFileSync('WebApp/app.js','utf8');
assert(app.includes('compactFleetMarker'),'moving fleet presentation must have a lightweight non-cluster marker path');
assert(app.includes('movingHeroSelection'),'moving fleet presentation must select full vehicle icons separately from compact markers');
assert(!app.includes("const standardBudget=mapRenderBudget(zoom,'standard'),movingAssets=visibleAssets.filter(asset=>asset.phase==='moving'),movingGroups=movingAssetGroups"),'legacy geographic fleet clustering is still active');

console.log('BUILD315 global fleet diversity policy + non-cluster moving presentation: PASS');
