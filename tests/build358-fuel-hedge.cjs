'use strict';
// Build 358, step 2 (markets): the fake hedge that only stored a percentage is replaced by a fuel swap. The group
// treasury fixes the price of a share of a company's fuel for 3, 6 or 12 months at the forward price the economy
// implies, plus the bank's margin; every trip then pays the swap price for that share and the market for the rest.
// Both trip paths read it: the slice engine (GH_SIMULATION_ASSET_CORE.computeTripEconomics, the fleet engine thread)
// and the main-thread modifier (GH_REALISM.tripModifier). The daily close keeps one row of prices per day.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');
const DAY=86400;

const {s,state,command}=scenario(),M=s.GH_MARKET_CORE,R=s.GH_REALISM,S=s.GH_SIMULATION_ASSET_CORE;
assert.ok(S&&typeof S.fuelPriceFactor==='function','the scenario loads the shared trip economics');
state.simSeconds=40*DAY;
const e=R.migrate(state).economy;e.oil=78;e.jetFuel=.871;

// 1. The quote is the forward of the economy's own oil reversion, plus the bank margin.
const forward=R.fuelForward(state,'jet',180);
assert.ok(Math.abs(forward-(.52+78*.0045))<1e-9,'at the mean the forward is the mean price');
e.oil=110;
const shocked=R.fuelForward(state,'jet',90);
assert.ok(shocked<.52+110*.0045&&shocked>.52+78*.0045,'after a shock the forward sits between spot and the mean (backwardation)');
assert.equal(M.hedgeQuote(state,'jet',3),Math.round(shocked*(1+.012+.003)*1e4)/1e4);
e.oil=78;

// 2. The command: one live swap per company and fuel; shares and terms from the offered set only.
const hedge=command('market','hedge-fuel',{company:'air',share:.5,months:6});
assert.equal(hedge.fuel,'jet');assert.equal(hedge.share,.5);assert.equal(hedge.startDay,40);assert.equal(hedge.endDay,220);
assert.equal(hedge.price,M.hedgeQuote(state,'jet',6));assert.equal(hedge.status,'ساري');
assert.throws(()=>command('market','hedge-fuel',{company:'air',share:.25,months:3}),/hedge-already-active/);
assert.throws(()=>command('market','hedge-fuel',{company:'air',share:.3,months:3}),/hedge-share-invalid|hedge-already-active/);
assert.throws(()=>command('market','hedge-fuel',{company:'sea',share:.5,months:3}),/hedge-company-not-open/);
state.realism.markets.hedges[0].status='QA';
assert.throws(()=>command('market','hedge-fuel',{company:'air',share:.5,months:4}),/hedge-term-invalid/);
assert.throws(()=>command('market','hedge-fuel',{company:'air',share:.4,months:3}),/hedge-share-invalid/);
state.realism.markets.hedges[0].status='ساري';
assert.deepEqual(JSON.parse(JSON.stringify(M.hedgeContext(state))),{air:{jet:{share:.5,price:hedge.price}}});

// 3. A trip pays the swap price on the hedged half: the slice engine and the main-thread modifier agree.
e.jetFuel=1.2;
const asset={id:'QA-AIR',type:'air',assetMode:'air',ownerCompanyId:'air',specs:{capacity:180,fuelBurnKgPerKm:3},staffing:{monthlyPayroll:0},tripSeconds:7200};
const route={id:'R',distanceKm:1000,tripSeconds:7200};
const ctx=hedges=>({economy:{jetFuel:e.jetFuel,airDemand:100},companies:{},research:{},sustainability:{},market:{},reputation:{},fuelHedges:hedges});
const open=S.computeTripEconomics(asset,route,ctx({})),hedged=S.computeTripEconomics(asset,route,ctx(M.hedgeContext(state)));
const expected=(.5*hedge.price+.5*1.2)/1.2;
assert.ok(Math.abs(hedged.fuelCost/open.fuelCost-expected)<1e-12,`engine: ${hedged.fuelCost/open.fuelCost} vs ${expected}`);
assert.ok(hedged.margin>open.margin,'a swap below the market raises the trip margin');
const base=()=>({revenue:1000,fuelCost:200,crewCost:100,maintReserve:50});
const modified=R.tripModifier(state,asset,base());
assert.ok(Math.abs(modified.fuelCost/(200*S.fuelPriceFactor(e,'air',null))-expected)<1e-12,'the main-thread modifier applies the same blend');
assert.equal(S.fuelPriceFactor(e,'air',null),1.2/.86,'without a swap the factor is the market price as before');
assert.ok(Math.abs(S.fuelPriceFactor(e,'air',{share:.95,price:0})-(.2*1.2)/.86)<1e-12,'no more than 80% can be fixed');

// 4. Expiry: from the end day trips pay the market again, and the close marks the swap ended.
state.simSeconds=219*DAY;assert.ok(M.hedgeFor(state,'air','jet'),'live on its last day');
state.simSeconds=220*DAY;assert.equal(M.hedgeFor(state,'air','jet'),null,'expired at the end day, before the close runs');
assert.deepEqual(JSON.parse(JSON.stringify(M.hedgeContext(state))),{});
R.recordMarketDay(state,220);assert.equal(state.realism.markets.hedges[0].status,'منتهي');
const renewed=command('market','hedge-fuel',{company:'air',share:.75,months:12});assert.equal(renewed.endDay,220+360);assert.equal(renewed.id,'HDG-00002');

// 5. Price history: one row per day, idempotent, a year at most.
const rows=state.realism.markets.history.length;R.recordMarketDay(state,220);assert.equal(state.realism.markets.history.length,rows,'the same day is recorded once');
const last=state.realism.markets.history.at(-1);assert.equal(last[0],220);assert.equal(last[2],1.2);assert.equal(last[8],Math.round(e.baseRate*1e4));
for(let day=221;day<221+400;day++)R.recordMarketDay(state,day);
assert.equal(state.realism.markets.history.length,365);assert.equal(state.realism.markets.history[0][0],620-364);

assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
console.log('BUILD358_FUEL_HEDGE_PASS',JSON.stringify({quote6m:hedge.price,hedgedFuelRatio:Number(expected.toFixed(4)),history:state.realism.markets.history.length}));
