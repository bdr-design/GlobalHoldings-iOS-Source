'use strict';
const assert=require('assert');
const fs=require('fs');
const {harness,minimal}=require('./helpers/core-harness');

(function expansionChangesTheCapacityProcurementActuallyReads(){
  const {s}=harness(['domain-command-core','finance-core','corporate-core','facility-core']);
  const state={
    ...minimal(),
    godMoney:true,
    infiniteMoney:true,
    openedCompanies:['road'],
    groupValue:1000000,
    customHubs:[{id:'ROAD-CAP',name:'مركز السعة',owned:true,company:'road',kind:'logistics'}],
    advanced:{facilities:{}}
  };
  s.GH_FINANCE_CORE.ensure(state);
  const facility=state.customHubs[0];

  assert.strictEqual(s.GH_FACILITY_CORE.assetCapacity(facility),140,'default logistics asset capacity changed unexpectedly');
  assert.strictEqual(s.GH_FACILITY_CORE.availableAssetCapacity(state,facility),140);

  const result=s.GH_FACILITY_CORE.execute(
    {state},
    'expand',
    {id:facility.id,company:'road',addCapacity:60,cost:12000000,contractor:'BUILD315 test contractor'}
  );

  assert.strictEqual(result.assetCapacity,200,'expand must return the authoritative asset capacity');
  assert.strictEqual(facility.deliveryCapacity,200,'expand must persist the capacity field used by procurement');
  assert.strictEqual(s.GH_FACILITY_CORE.assetCapacity(facility),200,'procurement-facing capacity must increase after expansion');
  assert.strictEqual(s.GH_FACILITY_CORE.availableAssetCapacity(state,facility),200,'free capacity must reflect the expansion immediately');
  assert.strictEqual(state.advanced.facilities[facility.id].assetCapacity,200,'management model must mirror, not replace, authoritative capacity');

  state.assets.push(...Array.from({length:155},(_,index)=>({id:`ROAD-${index}`,type:'road',baseFacility:facility.id})));
  assert.strictEqual(s.GH_FACILITY_CORE.assetOccupancy(state,facility),155);
  assert.strictEqual(s.GH_FACILITY_CORE.availableAssetCapacity(state,facility),45,'occupancy must be measured against expanded capacity');
})();

(function oneCompatibilityContractOwnsUiAndProcurement(){
  const {s}=harness(['facility-core']);
  const F=s.GH_FACILITY_CORE;
  const cases=[
    ['air',{owned:true,company:'air',kind:'airport-base'},true],
    ['air',{owned:true,company:'air',kind:'airport'},false],
    ['sea',{owned:true,company:'sea',kind:'port-base'},true],
    ['sea',{owned:true,company:'sea',kind:'port'},false],
    ['road',{owned:true,company:'road',kind:'depot'},true],
    ['road',{owned:true,company:'road',kind:'logistics'},true],
    ['road',{owned:true,company:'road',kind:'airport-base'},false],
    ['road',{owned:true,company:'road',kind:'port-base'},false],
    ['road',{owned:true,company:'sea',kind:'logistics'},false],
    ['road',{owned:false,company:'road',kind:'logistics'},false]
  ];
  for(const [type,facility,expected] of cases)assert.strictEqual(F.isAssetFacilityCompatible(type,facility),expected,`${type}/${facility.company}/${facility.kind}`);

  const app=fs.readFileSync('WebApp/app.js','utf8');
  const procurement=fs.readFileSync('WebApp/procurement-core.js','utf8');
  assert(app.includes("facility?.isAssetFacilityCompatible?.(type,f)===true"),'market base picker must use Facility Core compatibility');
  assert(app.includes("window.GH_FACILITY_CORE?.isAssetFacilityCompatible?.(type,base)===true"),'buy path must use Facility Core compatibility');
  assert(procurement.includes("facility.isAssetFacilityCompatible(type,base)"),'Procurement Core must use the same compatibility contract');
  assert(!app.includes("['depot','logistics','airport-base','port-base'].includes(base.kind)"),'legacy divergent road compatibility must not return');
})();

console.log('BUILD315 facility capacity + compatibility regression: PASS');
