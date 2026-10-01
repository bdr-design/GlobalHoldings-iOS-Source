'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js'));
require(path.join(ROOT,'WebApp/fleet-access-core.js'));
require(path.join(ROOT,'WebApp/migration-core.js'));
const MIGRATION=global.GH_MIGRATION_CORE;
const source=[
  {id:'A-1',name:'One',type:'air',ownerCompanyId:'air',condition:91,specs:{capacity:120,tags:['wide']},staffing:{ready:true,roles:[{id:'pilot',count:2}]},lastTrip:null},
  {id:'S-2',name:'Two',type:'sea',ownerCompanyId:'sea',condition:76,routeId:null,phase:'idle',departureScheduledAt:undefined,extras:{preserved:true}}
];
const state={saveVersion:'2.0.0',simSeconds:9876,assets:structuredClone(source)};
const result=MIGRATION.migrateFleet(state);
assert.equal(result.changed,true);assert.equal(state.saveVersion,'3.0.0');assert.equal(Object.hasOwn(state,'assets'),false);
assert.ok(STORE.isStore(state.fleet));
for(let row=0;row<source.length;row++)assert.equal(JSON.stringify(STORE.materialize(state.fleet,row)),JSON.stringify(source[row]),`row ${row} preserves every JSON field and key order`);

const invalidAssets=[{id:'OK'},null],failure={saveVersion:'2.0.0',simSeconds:0,assets:invalidAssets};
assert.throws(()=>MIGRATION.migrateFleet(failure));
assert.equal(failure.assets,invalidAssets,'a failed conversion leaves the legacy source array untouched');
assert.equal(Object.hasOwn(failure,'fleet'),false,'a failed conversion does not publish a partial store');

const conflict={saveVersion:'3.0.0',simSeconds:0,assets:[],fleet:STORE.create()};
assert.throws(()=>MIGRATION.migrateFleet(conflict),/MIGRATION_FLEET_SOURCE_CONFLICT/);
assert.equal(Array.isArray(conflict.assets),true);
assert.equal(STORE.isStore(conflict.fleet),true);
const unsupported={saveVersion:'4.0.0',simSeconds:0,assets:structuredClone(source)};assert.throws(()=>MIGRATION.migrateFleet(unsupported),/MIGRATION_SCHEMA_UNSUPPORTED/);assert.equal(Object.hasOwn(unsupported,'fleet'),false);assert.equal(unsupported.assets.length,source.length);

const batchAssets=['B-1','B-2'].map((id,index)=>({id,name:`Batch ${index+1}`,type:'air',assetMode:'air',ownerCompanyId:'air',assetClass:'aircraft',baseFacility:'BASE',deliveryOrderId:`OLD-${index+1}`,staffing:{mode:'automatic-fixed',ready:true,roles:[{id:'pilots',count:2}],total:2,monthlyPayroll:18000,contractId:`EMP-${index+1}`}}));
const payment={kind:'cheque',ref:'CH-SHARED',amount:200000};
const legacyBatch={saveVersion:'2.0.0',simSeconds:0,assets:structuredClone(batchAssets),realism:{procurement:{pendingDeliveryCount:2,deliveries:batchAssets.map((asset,index)=>({id:`OLD-${index+1}`,status:'pending',baseId:'BASE',requestRef:'REQ-BATCH',orderedAtSeconds:0,ownerCompanyId:'air',assetMode:'air',catalogId:'CAT-AIR',payment,asset:{...asset,specs:{capacity:100},purchasePrice:100000}}))}},advanced:{labor:{employmentContracts:batchAssets.map((asset,index)=>({id:`EMP-${index+1}`,assetId:asset.id,company:'air',ownerCompanyId:'air',automaticAssetStaffing:true,status:'ساري',count:2,salary:18000})),hiringLog:batchAssets.map((asset,index)=>({id:`HR-${index+1}`,assetId:asset.id,company:'air',total:2,monthlyPayroll:18000}))}}};
MIGRATION.migrateFleet(legacyBatch);
assert.equal(legacyBatch.realism.procurement.deliveries.length,1,'legacy per-asset receipts sharing an order payment and request are grouped');
const receipt=legacyBatch.realism.procurement.deliveries[0];assert.equal(receipt.id,'OLD-1');assert.equal(receipt.assets.length,2);assert.equal(receipt.count,2);assert.deepEqual(receipt.assets.map(asset=>asset.deliveryOrderId),['OLD-1','OLD-1']);
const contracts=legacyBatch.advanced.labor.employmentContracts;assert.equal(contracts.length,1);assert.deepEqual(contracts[0].assetIds,['B-1','B-2']);assert.equal(contracts[0].count,4);assert.equal(contracts[0].salary,36000);assert.equal(legacyBatch.fleet&&STORE.materialize(legacyBatch.fleet,1).staffing.contractId,contracts[0].id);assert.equal(legacyBatch.advanced.labor.hiringLog.length,1);assert.equal(legacyBatch.advanced.labor.hiringLog[0].total,4);
const duplicateReceipt={saveVersion:'2.0.0',simSeconds:0,assets:[{id:'PRESERVED'}],realism:{procurement:{deliveries:[{id:'DUP-1',status:'pending',baseId:'BASE',requestRef:'DUP',orderedAtSeconds:0,payment,asset:{id:'DUP-ASSET'}},{id:'DUP-2',status:'pending',baseId:'BASE',requestRef:'DUP',orderedAtSeconds:0,payment,asset:{id:'DUP-ASSET'}}]}}};const originalFleet=duplicateReceipt.assets;assert.throws(()=>MIGRATION.migrateFleet(duplicateReceipt),/MIGRATION_DELIVERY_ASSET_DUPLICATE/);assert.equal(duplicateReceipt.assets,originalFleet);assert.equal(Object.hasOwn(duplicateReceipt,'fleet'),false,'batch merge failure must not publish a partial fleet store');
console.log(JSON.stringify({suite:'build357-fleet-migration',passed:3,total:3,assets:source.length,legacyReceiptsGrouped:receipt.assets.length,crewContracts:contracts.length,atomicFailure:true}));
