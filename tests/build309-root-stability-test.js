'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const {ROOT,harness,minimal}=require('./helpers/core-harness');

let passed=0;
const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};

test('directory facilities validate outside Riyadh for every company family',()=>{
  const {s}=harness(['facility-core']);
  const capitals={
    AUH:{capitalId:'AUH',city:'أبوظبي',country:'الإمارات',coords:[24.4539,54.3773]},
    BER:{capitalId:'BER',city:'برلين',country:'ألمانيا',coords:[52.52,13.405]},
    LON:{capitalId:'LON',city:'لندن',country:'المملكة المتحدة',coords:[51.5074,-.1278]},
    SIN:{capitalId:'SIN',city:'سنغافورة',country:'سنغافورة',coords:[1.3521,103.8198]}
  };
  s.GH_MOBILITY_CORE={capitalMeta:id=>capitals[id]||null};
  for(const [company,capitalId] of [['road','AUH'],['power','BER'],['bank','LON'],['mobility','SIN']]){
    const cap=capitals[capitalId],site={key:`site:${company}:${capitalId}`,company,capitalId,kind:'company-site',city:cap.city,country:cap.country,coords:[...cap.coords]};
    const verified=s.GH_FACILITY_CORE.verifyDirectorySite(site,company);assert.strictEqual(verified.key,site.key);assert.deepStrictEqual(Array.from(verified.coords),cap.coords);
  }
});

test('one logistics center accepts a large atomic fleet up to its explicit capacity',()=>{
  const {s}=harness(['transaction-core','finance-core','policy-core','facility-core','determinism-core','corporate-core','procurement-core']);
  const state={...minimal(),openedCompanies:['road'],unlockedSectors:[],globalBases:[],customHubs:[{id:'LOG-AUH',owned:true,company:'road',kind:'logistics',capitalId:'AUH',sourceKey:'site:road:AUH',city:'أبوظبي',country:'الإمارات',coords:[24.4539,54.3773],deliveryCapacity:140}],realism:{procurement:{deliveries:[]}},supplierTransactions:[],constructionContracts:[],commercialTenders:[],sequences:{},companyRegistry:{road:{legalName:'GH Logistics'}}};
  s.GH_REALISM={migrate:target=>target.realism};
  s.GH_FINANCE_CORE.ensure(state);s.GH_FINANCE_CORE.book(state,'road').accounts[0].balance=500_000_000;s.GH_FINANCE_CORE.reconcile(state);
  const item={id:'TRUCK-LARGE',name:'Heavy Truck',price:1_000_000,icon:'🚛',specs:{}},supplier={id:'SUP-1',legalName:'Fleet Supplier'},before=s.GH_FINANCE_CORE.operating(state,'road');
  const out=s.GH_PROCUREMENT_CORE.execute({state,assetCatalog:{road:{new:[item]}}},'purchase-assets',{type:'road',tab:'new',item,mode:'cash',qty:140,base:state.customHubs[0],supplier,manual:true,requestRef:'LARGE-ROAD-140',upfront:140_000_000,totalPrice:140_000_000,immediateDelivery:true});
  assert.strictEqual(out.count,140);assert.strictEqual(state.realism.procurement.deliveries.length,140);assert.strictEqual(s.GH_FINANCE_CORE.operating(state,'road'),before-140_000_000);assert.strictEqual(state.finance.cheques[0].status,'مصروف');assert.throws(()=>s.GH_PROCUREMENT_CORE.execute({state,assetCatalog:{road:{new:[item]}}},'purchase-assets',{type:'road',tab:'new',item,mode:'cash',qty:1,base:state.customHubs[0],supplier,manual:true,requestRef:'OVER',upfront:1_000_000,totalPrice:1_000_000,immediateDelivery:true}),/delivery-capacity:0\/140/);
});

test('purchase delivery and fleet share Facility Core as the only capacity owner',()=>{
  const procurement=fs.readFileSync(path.join(ROOT,'WebApp/procurement-core.js'),'utf8'),realism=fs.readFileSync(path.join(ROOT,'WebApp/realism-core.js'),'utf8'),fleet=fs.readFileSync(path.join(ROOT,'WebApp/fleet-core.js'),'utf8');
  for(const source of [procurement,realism,fleet])assert(source.includes('GH_FACILITY_CORE'), 'a capacity consumer bypasses Facility Core');
  assert(!realism.includes("base.kind==='airport-base'?24"));assert(!fleet.includes("base.kind==='airport-base'?24"));
});

test('executed cheques and transfers mutate the exact current accounts once',()=>{
  const {s}=harness(['finance-core']),state={...minimal(),openedCompanies:['air']};s.GH_FINANCE_CORE.ensure(state);const group=s.GH_FINANCE_CORE.book(state,'group').accounts[0],air=s.GH_FINANCE_CORE.book(state,'air').accounts[0];group.balance=1_000_000;air.balance=400_000;s.GH_FINANCE_CORE.reconcile(state);
  const cheque=s.GH_FINANCE_CORE.execute({state},'pay-by-cheque',{company:'air',amount:125_000,note:'شراء أصل',beneficiary:'مورد موثق',taxable:false,line:'capex',requestRef:'CHQ-POST-1'});assert.strictEqual(cheque.cheque.status,'مصروف');assert.strictEqual(air.balance,275_000);
  const transfer=s.GH_FINANCE_CORE.execute({state},'transfer',{from:'group',to:'air',amount:200_000,note:'تمويل تابع',ref:'TR-POST-1'});assert.strictEqual(group.balance,800_000);assert.strictEqual(air.balance,475_000);assert(state.finance.transfers.some(row=>row.reference==='TR-POST-1'&&row.status==='منفذة'));
  const repeated=s.GH_FINANCE_CORE.execute({state},'transfer',{from:'group',to:'air',amount:200_000,note:'تمويل تابع',ref:'TR-POST-1'});assert.strictEqual(repeated.idempotent,true);assert.strictEqual(group.balance,800_000);assert.strictEqual(air.balance,475_000);
});

test('daily operating profit reaches the company current account with a balanced clearing journal',()=>{
  const {s}=harness(['finance-core']),state={...minimal(),openedCompanies:['air']};s.GH_FINANCE_CORE.ensure(state);const account=s.GH_FINANCE_CORE.book(state,'air').accounts[0];account.balance=50_000;s.GH_FINANCE_CORE.reconcile(state);
  const first=s.GH_FINANCE_CORE.execute({state},'settle-daily-cash',{company:'air',amount:32_500,day:4,reference:'DAY-CASH-air-4',note:'صافي تشغيل'});assert.strictEqual(first.amount,32_500);assert.strictEqual(account.balance,82_500);const journal=state.finance.journalEntries.find(row=>row.sourceRef==='DAY-CASH-air-4');assert(journal);assert.strictEqual(journal.lines.find(line=>line.account===account.id).debit,32_500);assert(Math.abs(journal.lines.reduce((sum,line)=>sum+line.debit-line.credit,0))<.01);
  const repeated=s.GH_FINANCE_CORE.execute({state},'settle-daily-cash',{company:'air',amount:32_500,day:4,reference:'DAY-CASH-air-4'});assert.strictEqual(repeated.idempotent,true);assert.strictEqual(account.balance,82_500);
});

test('map rendering is throttled and Mobility remains compact without animated pulse load',()=>{
  const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),css=fs.readFileSync(path.join(ROOT,'WebApp/styles.css'),'utf8');
  assert(app.includes('maxPixelsPerSecond:8'));assert(app.includes('now-lastMapRenderAt>=4000'));assert(app.includes('now-lastUiRefreshMs>=500'));assert(!app.includes('updateMarkerPositions();updateKpis();updateMapStatus()'));assert(/\.vehicle-pin\.mobility \.vehicle-sprite\{[^}]*width:12px[^}]*height:24px/.test(css));assert(!css.includes('animation:mobilityDotPulse'));
});

console.log(`BUILD309 root stability checks: ${passed}/6`);
