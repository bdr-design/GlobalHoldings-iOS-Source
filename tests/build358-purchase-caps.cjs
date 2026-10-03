'use strict';
// Build 358: one purchase buys up to 3,000 assets in every company (aircraft, ships and trucks through procurement;
// Mobility vehicles were capped at 50), and every asset base takes 3,000 so such a purchase fits one base (airports
// already did; ports, logistics hubs, depots and mobility centers held 80-140).
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const env=scenario(),{state,s,command}=env,M=s.GH_MOBILITY_CORE,F=s.GH_FACILITY_CORE;
assert.equal(s.GH_PROCUREMENT_CORE.MAX_ASSET_PURCHASE_QUANTITY,3000,'fleet purchases');
assert.equal(M.MAX_FLEET_PURCHASE_QUANTITY,3000,'mobility purchases');
for(const kind of ['airport-base','port-base','logistics','depot','mobility-center'])assert.equal(F.DEFAULT_ASSET_CAPACITY[kind],3000,`${kind} takes 3,000`);
command('corporate','open-company',{type:'mobility',capital:500000000,legalName:'Test Mobility'});state.godMoney=true;state.infiniteMoney=true;
// A center created without explicit bays (as a new center's default) takes a full purchase.
state.customHubs.push({id:'MOB-CENTER-RUH',name:'Riyadh',kind:'mobility-center',ownerCompanyId:'mobility',owned:true,capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7]});
M.ensure(state);state.mobility.capitalCenters.push({id:'MOB-CENTER-RUH',ownerCompanyId:'mobility',capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],facilityId:'MOB-CENTER-RUH'});
command('mobility','buy-fleet',{quantity:3000,centerId:'RUH',classId:'eco-ev'});
assert.equal(state.mobility.vehicles.length,3000,'3,000 vehicles in one purchase');
assert.throws(()=>command('mobility','buy-fleet',{quantity:1,centerId:'RUH',classId:'eco-ev'}),/mobility-center-capacity/,'the center is full at 3,000');
assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
console.log(JSON.stringify({suite:'build358-purchase-caps',vehicles:state.mobility.vehicles.length}));
console.log('PASS one purchase buys 3,000 in every company and one base takes it');
