'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const simulation=require('../WebApp/simulation-core.js');
const finance=require('../WebApp/finance-core.js');
const {harness,minimal}=require('./helpers/core-harness');

(function manualCalendarStepUsesAtomicSlices(){
  let wall=0,time=0,speed=0;
  const boundaries=[];
  const engine=simulation.create({
    getSpeed:()=>speed,setSpeed:value=>{speed=value;},getSimTime:()=>time,setSimTime:value=>{time=value;},
    createSliceJob:(slice,meta)=>({runChunk:()=>true,finish:()=>{boundaries.push(meta.boundary);return {committed:true};},cancel:()=>{}})
  },{nowMs:()=>wall,allowedSpeeds:[0,30,60,120,300,600],fallbackSpeed:30,frameBudgetMs:1000});
  engine.reset(0,'calendar-test');
  assert.strictEqual(engine.advanceTo(86400,{speed:600,reason:'test-next-day',maxSeconds:86400}).accepted,true);
  wall+=16;engine.frame(wall);
  assert.strictEqual(time,86400,'calendar advance must reach the requested day only through committed slices');
  assert.strictEqual(speed,0,'calendar advance must not overwrite the player speed selection');
  assert.strictEqual(engine.snapshot().manualAdvance,null,'manual advance must clear after its exact target is committed');
  assert(boundaries.some(boundary=>boundary.day===1),'calendar advance must preserve the normal day boundary');
  assert.strictEqual(engine.advanceTo(80000,{speed:600}).accepted,false,'calendar advance must never move simulation time backward');

  assert.strictEqual(engine.advanceTo(172800,{speed:600,maxSeconds:86400}).accepted,true);
  assert.strictEqual(engine.cancelAdvance('test-cancel'),true);
  assert.strictEqual(time,86400,'cancelling a queued calendar step must not write time directly');
})();

(function everyCompanyOwnsAnIndependentCurrentAccount(){
  const state={...minimal(),profile:{name:'حسابات الاختبار'},openedCompanies:['air','sea','road','power','bank','mobility'],companyFinance:{},companyBudgets:{},advanced:{}};
  finance.ensure(state);
  const types=['group','air','sea','road','power','bank','mobility'];
  const accountIds=types.map(type=>finance.book(state,type).accounts[0].id);
  assert.strictEqual(new Set(accountIds).size,types.length,'each legal company must retain its own current account');
  for(const type of types){const prefix=type==='group'?'GH':type.toUpperCase();assert.strictEqual(finance.book(state,type).accounts[0].id,`${prefix}-OPER-001`);}

  const before=Object.fromEntries(types.map(type=>[type,finance.operating(state,type)]));
  const settled=finance.execute({state},'settle-daily-cash',{company:'road',amount:125.5,grossAmount:150,deductions:24.5,day:1,reference:'DAY-CASH-road-1'});
  assert.strictEqual(settled.amount,125.5);
  assert.strictEqual(finance.operating(state,'road'),before.road+125.5,'profit must credit the road company current account');
  for(const type of types.filter(type=>type!=='road'))assert.strictEqual(finance.operating(state,type),before[type],`daily road profit leaked into ${type}`);
  const transfer=state.finance.transfers.find(row=>row.reference==='DAY-CASH-road-1');
  assert.strictEqual(transfer.to,'ROAD-OPER-001','the settlement evidence must name the company current account');
  const retried=finance.execute({state},'settle-daily-cash',{company:'road',amount:125.5,grossAmount:150,deductions:24.5,day:1,reference:'DAY-CASH-road-1'});
  assert.strictEqual(retried.idempotent,true,'a repeated daily close must not credit the same company twice');
  assert.strictEqual(finance.operating(state,'road'),before.road+125.5);
})();

(function largeDeliveryIsOneAtomicFleetBatch(){
  const {s}=harness(['transaction-core','domain-command-core','finance-core','facility-core','fleet-core']);
  const state={...minimal(),simSeconds:0,assets:[],crew:[],sequences:{},advanced:{labor:{}},globalBases:[],customHubs:[{id:'ROAD-BATCH',name:'مركز اختبار الدفعات',owned:true,company:'road',kind:'logistics',deliveryCapacity:600}],realism:{procurement:{deliveries:[]}}};
  s.GH_FINANCE_CORE.ensure(state);
  const batch=[];
  for(let index=1;index<=600;index++){
    const id=`ROAD-${index}`,deliveryId=`DEL-${index}`,invoice=`INV-${index}`,asset={id,type:'road',name:`شاحنة ${index}`,ownership:'owned',purchasePrice:1000};
    state.realism.procurement.deliveries.push({id:deliveryId,status:'pending',asset,baseId:'ROAD-BATCH',payment:{kind:'invoice',ref:invoice,amount:1000}});
    state.finance.invoices.push({number:invoice,status:'مدفوعة',company:'road',amount:1000});
    batch.push({deliveryId,asset,baseId:'ROAD-BATCH',phase:'idle',deliveredDay:0,deliveredAtSeconds:0});
  }
  const delivered=s.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','record-delivery-batch',{deliveries:batch},{actor:'build312-test'}).result;
  assert.strictEqual(delivered.length,600);assert.strictEqual(state.assets.length,600);
  assert(state.assets.every(asset=>asset.deliveryStatus==='delivered'&&asset.staffing?.ready===true),'every delivered asset must retain its fixed staffing evidence');
  assert.strictEqual(state.advanced.labor.employmentContracts.length,600,'one permanent staffing contract is required per delivered asset');
  assert.strictEqual(state.crew.find(row=>row.id==='drivers').count,1200,'crew aggregation must run once after the complete batch');

  const before={assets:state.assets.length,contracts:state.advanced.labor.employmentContracts.length};
  const overflow=[];
  for(let index=601;index<=602;index++){
    const id=`ROAD-${index}`,deliveryId=`DEL-${index}`,invoice=`INV-${index}`,asset={id,type:'road',name:`شاحنة ${index}`,ownership:'owned',purchasePrice:1000};
    state.realism.procurement.deliveries.push({id:deliveryId,status:'pending',asset,baseId:'ROAD-BATCH',payment:{kind:'invoice',ref:invoice,amount:1000}});
    state.finance.invoices.push({number:invoice,status:'مدفوعة',company:'road',amount:1000});
    overflow.push({deliveryId,asset,baseId:'ROAD-BATCH',phase:'idle',deliveredDay:0,deliveredAtSeconds:0});
  }
  assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','record-delivery-batch',{deliveries:overflow},{actor:'build312-test'}),/delivery-base-full/);
  assert.deepStrictEqual({assets:state.assets.length,contracts:state.advanced.labor.employmentContracts.length},before,'a failed batch must leave no partial assets or staffing contracts');
})();

(function sourceContractsRemainExplicit(){
  const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
  const app=read('WebApp/app.js'),realism=read('WebApp/realism-core.js'),procurement=read('WebApp/procurement-core.js'),sim=read('WebApp/simulation-core.js'),index=read('WebApp/index.html');
  assert(realism.includes("'record-delivery-batch'"),'due delivery batches must delegate the whole ready set to Fleet Core once');
  assert(procurement.includes('const firstSerial='),'large purchase serials must be calculated once per command');
  assert(app.includes('const purchasedAssetIds=new Set(result.assetIds)'),'purchase verification must avoid repeated linear id scans');
  assert(sim.includes('function advanceTo(')&&sim.includes('manualAdvance'),'day navigation must use a bounded simulation target');
  assert(index.includes('id="simNextDay"'),'the map clock must expose the guarded day navigation control');
})();

console.log('BUILD312 batch delivery + calendar + current account regression: PASS');
