'use strict';
// Build 364: public fleet requests reach one million; each domain write remains capped at 3,000 and batched atomically.
// Fleet bases hold one million records. Mobility remains on its separate, explicitly bounded vehicle engine.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const env=scenario(),{state,s,command}=env,M=s.GH_MOBILITY_CORE,F=s.GH_FACILITY_CORE;
assert.equal(s.GH_PROCUREMENT_CORE.MAX_ASSET_PURCHASE_QUANTITY,3000,'fleet purchases');
assert.equal(s.GH_PROCUREMENT_CORE.MAX_ASSET_PURCHASE_REQUEST,1000000,'one guarded UI request may reach one million');
assert.equal(M.MAX_FLEET_PURCHASE_QUANTITY,3000,'mobility purchases');
for(const kind of ['airport-base','port-base','logistics','depot'])assert.equal(F.DEFAULT_ASSET_CAPACITY[kind],1000000,`${kind} can hold the one-million-asset fleet`);
assert.equal(F.DEFAULT_ASSET_CAPACITY['mobility-center'],3000,'mobility keeps its separate limit until its engine supports million-scale purchase safely');
command('corporate','open-company',{type:'mobility',capital:500000000,legalName:'Test Mobility'});state.godMoney=true;state.infiniteMoney=true;
// A center created without explicit bays (as a new center's default) takes a full purchase.
state.customHubs.push({id:'MOB-CENTER-RUH',name:'Riyadh',kind:'mobility-center',ownerCompanyId:'mobility',owned:true,capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7]});
M.ensure(state);state.mobility.capitalCenters.push({id:'MOB-CENTER-RUH',ownerCompanyId:'mobility',capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],facilityId:'MOB-CENTER-RUH'});
command('mobility','buy-fleet',{quantity:3000,centerId:'RUH',classId:'eco-ev'});
assert.equal(state.mobility.vehicles.length,3000,'3,000 vehicles in one purchase');
assert.throws(()=>command('mobility','buy-fleet',{quantity:1,centerId:'RUH',classId:'eco-ev'}),/mobility-center-capacity/,'the center is full at 3,000');
const expansion=F.execute({state},'expand',{id:'MOB-CENTER-RUH',addCapacity:500,cost:0});
assert.equal(expansion.assetCapacity,3500,'facility expansion updates the capacity enforced by Mobility purchases');
assert.equal(state.customHubs[0].bays,3500,'the Mobility bay limit stays synchronized with the expanded delivery capacity');
command('mobility','buy-fleet',{quantity:1,centerId:'RUH',classId:'eco-ev'});
assert.equal(state.mobility.vehicles.length,3001,'the expanded center accepts newly available bays');
assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
console.log(JSON.stringify({suite:'build358-purchase-caps',vehicles:state.mobility.vehicles.length}));
console.log('PASS fleet command chunk stays at 3,000; capacity and request ceiling tests cover the million-scale path');
