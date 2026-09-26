'use strict';

const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario');

const env=scenario(),{state,s,command}=env,P=s.GH_COMPANY_PLATFORM,M=s.GH_MOBILITY_CORE,F=s.GH_FINANCE_CORE;

for(const [companyId,definitionId] of [['energy-east','gh-energy-v1'],['bank-two','gh-bank-v1'],['mobility-two','gh-mobility-v1']]){
  assert.throws(()=>P.planInstance(state,{companyId,definitionId}),new RegExp(`company-definition-canonical-instance-only:${definitionId}:${companyId}`));
}
assert.equal(P.planInstance(state,{companyId:'air-two',definitionId:'gh-air-v1'}).companyId,'air-two');

command('corporate','open-company',{type:'mobility',capital:500000000,legalName:'Test Mobility'});
state.customHubs.push({id:'MOB-CENTER-RUH',name:'Riyadh',kind:'mobility-center',ownerCompanyId:'mobility',owned:true,capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],bays:120});
M.ensure(state);state.mobility.capitalCenters.push({id:'MOB-CENTER-RUH',ownerCompanyId:'mobility',capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],facilityId:'MOB-CENTER-RUH'});
command('mobility','buy-fleet',{quantity:1,centerId:'RUH',classId:'eco-ev'});

const model=state.mobility,vehicle=model.vehicles[0],driver=model.drivers[0];
model.rideRequests.push({id:'REQ-CANONICAL',ownerCompanyId:'mobility',status:'active',centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',fare:100});
model.activeTrips.push({id:'TRIP-CANONICAL',ownerCompanyId:'mobility',requestId:'REQ-CANONICAL',vehicleId:vehicle.id,driverId:driver.id,centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',routeVerified:true,dueAt:1,distanceKm:10,fare:100});vehicle.status='moving';driver.status='on-trip';
const cashBefore=F.operating(state,'mobility');M.onSimulationTime({state},2);

assert.equal(model.ownerCompanyId,'mobility');assert.equal(vehicle.ownerCompanyId,'mobility');assert.equal(driver.ownerCompanyId,'mobility');assert.equal(model.tripArchive[0].ownerCompanyId,'mobility');
const staffing=state.advanced.labor.employmentContracts.find(row=>row.assetId===vehicle.id);assert.equal(staffing.ownerCompanyId,'mobility');assert.equal(state.tripProfitAccrued.mobility,74);assert.equal(state.tripProfitAccrued['mobility-two'],undefined);assert.equal(state.finance.pendingDailyCash.mobility,74);assert.equal(F.operating(state,'mobility'),cashBefore);
assert.equal(P.validateState(state).ok,true,P.validateState(state).errors.join(','));const reloaded=P.migrateState(JSON.parse(JSON.stringify(state)));assert.equal(reloaded.errors.length,0,reloaded.errors.join(','));assert.equal(M.ensure(reloaded.state).vehicles[0].ownerCompanyId,'mobility');

const priorOwner=state.mobility.ownerCompanyId;state.mobility.ownerCompanyId='mobility-two';assert.throws(()=>M.ensure(state),/company-definition-unavailable|company-not-operational|mobility-company-compatibility-hold/);state.mobility.ownerCompanyId=priorOwner;

console.log(JSON.stringify({passed:true,canonicalOnly:['energy','bank','mobility'],multiInstance:['fleet'],mobilityJournalOwner:'mobility'}));
