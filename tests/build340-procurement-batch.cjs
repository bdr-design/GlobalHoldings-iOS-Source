'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

let idSequence=0,documentSequence=0;
const company={definition:{classification:{assetClasses:['aircraft'],routeModes:['air'],operationProfileId:'air-ops',primarySectorId:'air'}}};
globalThis.GH_TRANSACTION_CORE={isActive:()=>true};
globalThis.GH_COMPANY_PLATFORM={ownerForLegacyAssetMode:mode=>mode==='air'?'air':'',assetClassForLegacyMode:()=> 'aircraft',requireCompany:()=>company,resolveIdentity:()=>({shortName:'GH'})};
let occupancyCalls=0,assetPasses=0,deliveryPasses=0;
globalThis.GH_FACILITY_CORE={assetCapacity:()=>100000,assetOccupancy:(state,base)=>{occupancyCalls++;return (state.assets||[]).filter(asset=>asset.baseFacility===base.id).length+(state.realism?.procurement?.deliveries||[]).filter(row=>row.status==='pending'&&row.baseId===base.id).length;},isAssetFacilityCompatible:()=>true};
globalThis.GH_REALISM={migrate:state=>state.realism};
globalThis.GH_POLICY_CORE={procurement:()=>({approved:true,blocked:[]})};
globalThis.GH_FINANCE_CORE={operating:()=>Number.MAX_SAFE_INTEGER,execute:(_ctx,command)=>{if(command!=='pay-by-cheque')throw new Error(`unexpected-finance-command:${command}`);documentSequence++;return {cheque:{id:`CH-${documentSequence}`,status:'مصروف'},invoice:{number:`INV-${documentSequence}`,status:'مسددة'},settlement:{id:`SET-${documentSequence}`}};}};
globalThis.GH_CORPORATE_CORE={execute:()=>true};
globalThis.GH_DETERMINISM={nextId:(state,prefix)=>{state.sequences=state.sequences||{};idSequence++;const n=(state.sequences[prefix]||0)+1;state.sequences[prefix]=n;return `${prefix}-${String(n).padStart(7,'0')}`;}};
globalThis.GH_ASSET_CATALOG={air:{new:[{id:'A-1',name:'Test Aircraft',icon:'✈',price:1000000,downPayment:.2,specs:{capacity:100}}]}};
require('../WebApp/procurement-core.js');
const Procurement=globalThis.GH_PROCUREMENT_CORE;
const app=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8');
assert.match(app,/GH_TRANSACTION_CORE\.execute\(draft,\{label:'asset-purchase-composite',apply:\(\)=>window\.GH_PROCUREMENT_CORE\.withPurchaseBatch\(draft,/,'the UI purchase path wraps every allocation in one full-snapshot command transaction');
assert.match(app,/if\(!batch\.committed\)throw new Error\(batch\.reason\|\|'asset-purchase-batch-rejected'\)/,'the purchase owner rejects a failed batch before durable publication');
const bases=Array.from({length:4},(_,i)=>({id:`BASE-${i+1}`,name:`Base ${i+1}`}));
const item=globalThis.GH_ASSET_CATALOG.air.new[0];

function fixture(){
  const rawAssets=Array.from({length:20000},(_,i)=>({id:`EX-${i}`,ownerCompanyId:'air',assetMode:'air',type:'air',baseFacility:bases[i%bases.length].id,phase:'idle'}));
  const rawDeliveries=Array.from({length:400},(_,i)=>({id:`PENDING-${i}`,status:'pending',ownerCompanyId:'air',assetMode:'air',type:'air',baseId:bases[i%bases.length].id}));
  const assets=new Proxy(rawAssets,{get(target,key,receiver){if(key===Symbol.iterator||key==='reduce'||key==='filter'){assetPasses++;return Reflect.get(target,key,receiver);}return Reflect.get(target,key,receiver);}});
  const deliveries=new Proxy(rawDeliveries,{get(target,key,receiver){if(key===Symbol.iterator||key==='reduce'||key==='filter'){deliveryPasses++;return Reflect.get(target,key,receiver);}return Reflect.get(target,key,receiver);}});
  return {assets,globalBases:bases,customHubs:[],sequences:{},simSeconds:0,infiniteMoney:true,realism:{procurement:{deliveries,pendingDeliveryCount:rawDeliveries.length}}};
}

function purchase(state,index,base){return Procurement.execute({state},'purchase-assets',{type:'air',ownerCompanyId:'air',assetClass:'aircraft',tab:'new',item,mode:'cash',qty:100,base,supplier:{id:'SUP-1',legalName:'Test Supplier'},manual:true,requestRef:`MANUAL-340-${index}`,upfront:100000000,totalPrice:100000000,paymentMethod:'شيك مصرفي',documentLeadDays:10,leadSeconds:0,immediateDelivery:true});}

function run(useBatch){
  const state=fixture();let results;
  if(useBatch)results=Procurement.withPurchaseBatch(state,()=>bases.map((base,index)=>purchase(state,index,base)));
  else results=bases.map((base,index)=>purchase(state,index,base));
  return {state,results,names:state.realism.procurement.deliveries.slice(-400).map(row=>row.asset.name),assetIds:results.flatMap(row=>row.assetIds),deliveryIds:results.flatMap(row=>row.deliveryOrderIds)};
}

occupancyCalls=0;assetPasses=0;deliveryPasses=0;
const batch=run(true),batchVisits={assetPasses,deliveryPasses,occupancyCalls};
assert.equal(batch.results.reduce((sum,row)=>sum+row.count,0),400);
assert.equal(new Set(batch.assetIds).size,400);
assert.equal(new Set(batch.deliveryIds).size,400);
assert.equal(batch.names[0],'GH 20501','serial numbering counts all owned assets and pending orders');
assert.equal(batch.names.at(-1),'GH 20900','serial numbering advances across base allocations');
assert.deepEqual(batchVisits,{assetPasses:1,deliveryPasses:1,occupancyCalls:0},'a multi-base purchase builds one asset/order index and reuses facility occupancy');

occupancyCalls=0;assetPasses=0;deliveryPasses=0;
const legacy=run(false);
assert.deepEqual(batch.results,legacy.results);
assert.deepEqual(batch.names,legacy.names,'display serials and delivery results match the existing per-allocation owner path');
assert.equal(legacy.results.reduce((sum,row)=>sum+row.count,0),400);
assert.ok(occupancyCalls>=4);
assert.ok(assetPasses>=8,'legacy path rescans the fleet for each allocation');
console.log(JSON.stringify({suite:'build340-procurement-batch',assets:20000,deliveriesBeforePurchase:400,purchased:400,batchVisits,legacyVisits:{assetPasses,deliveryPasses,occupancyCalls},parity:true,environment:'Node synthetic owner state; not iPhone performance'}));
