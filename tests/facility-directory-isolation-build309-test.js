'use strict';
const assert=require('assert');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['world-data','transaction-core','domain-command-core','finance-core','facility-core','mobility-core']);
const companies=['air','sea','road','power','bank','mobility'],F=s.GH_FACILITY_CORE;
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
function stateFor(openedCompanies=companies){const state={...minimal(),openedCompanies:[...openedCompanies]};F.ensure(state);return state;}
function countryLabel(code){if(code.length===2)return new Intl.DisplayNames(['ar'],{type:'region'}).of(code);return code.replace(/\b\w/g,ch=>ch.toUpperCase());}
function globalFacility(company,id=company.toUpperCase()){
 const air=company==='air',row=(air?s.GH_WORLD_DATA.airports:s.GH_WORLD_DATA.ports).find(item=>item[0]===(air?'OMDB':'SGSIN'));assert(row,'actual registry row must exist');
 return {id,owned:true,company,kind:air?'airport-base':'port-base',sourceKey:air?`air:${row[0]}`:`port:${row[0]}:${row[3]}:${row[4]}`,name:air?row[2]:row[1],city:air?row[3]||row[4]||'—':row[1],country:countryLabel(air?row[5]:row[2]),coords:air?[row[6],row[7]]:[row[3],row[4]],code:air?row[1]||row[0]:row[0],...(air?{icao:row[0],iata:row[1]}:{terminal:!!row[5]})};
}
function capitalFacility(company,id=company.toUpperCase(),capitalId='AUH'){
 const cap=s.GH_MOBILITY_CORE.capitalMeta(capitalId),kind={road:'logistics',power:'power',bank:'bank',mobility:'mobility-center'}[company];assert(cap,'actual capital must exist');
 return {id,owned:true,company,kind,sourceKey:`site:${company}:${capitalId}`,capitalId,city:cap.city,country:cap.country,coords:[...cap.coords]};
}
const fixture=company=>['air','sea'].includes(company)?globalFacility(company):capitalFacility(company);
function create(state,facility,extra={}){return F.execute({state},'create',{facility,...extra});}
function command(state,domain,name,payload){return s.GH_DOMAIN_COMMANDS.dispatch({state},domain,name,payload,{actor:'facility-isolation-test'}).result;}
function assertRejectedUnchanged(state,facility,pattern,extra={}){
 const before=JSON.stringify(state);assert.throws(()=>create(state,facility,extra),pattern);assert.strictEqual(JSON.stringify(state),before,'rejected create must not change any state');
 const validation=F.validate({state},'create',{facility,...extra});assert.strictEqual(validation.ok,false);assert(pattern.test(validation.reason),validation.reason);
}

test('all six companies create real directory facilities outside Riyadh in the canonical bucket',()=>{
 const state=stateFor();
 for(const company of companies){const row=create(state,fixture(company));assert.strictEqual(row.company,company);assert(row.city!=='الرياض');const bucket=['air','sea'].includes(company)?state.globalBases:state.customHubs;assert(bucket.some(item=>item.id===row.id));}
 assert.strictEqual(state.globalBases.length,2);assert.strictEqual(state.customHubs.length,4);
 assert.strictEqual(state.globalBases[0].deliveryCapacity,300);assert.strictEqual(state.globalBases[1].deliveryCapacity,120);
 assert.strictEqual(new Set(state.customHubs.map(row=>row.sourceKey)).size,4,'same capital remains distinct per company');
});

test('closed companies cannot create facilities through any directory family',()=>{
 for(const company of companies)assertRejectedUnchanged(stateFor([]),fixture(company),/company-not-open/);
});

test('owner and kind cannot be swapped to another company or a generic facility',()=>{
 for(const company of companies){const row=fixture(company);row.company=company==='air'?'sea':'air';assertRejectedUnchanged(stateFor(),row,/owner-invalid/);}
 assertRejectedUnchanged(stateFor(),{...globalFacility('air'),kind:'hq'},/kind-owner-invalid/);
 assertRejectedUnchanged(stateFor(),{...globalFacility('sea'),kind:'port'},/kind-owner-invalid/);
});

test('forged coordinates and site identities are rejected for all company families',()=>{
 for(const company of companies){const row=fixture(company);row.coords[0]+=.01;assertRejectedUnchanged(stateFor(),row,/coordinates-invalid/);const renamed=fixture(company);renamed.city='الرياض';assertRejectedUnchanged(stateFor(),renamed,/identity-invalid/);}
 for(const company of ['air','sea']){const row=globalFacility(company);row.code='OTHER';assertRejectedUnchanged(stateFor(),row,/identity-invalid/);}
 assertRejectedUnchanged(stateFor(),{...globalFacility('air'),icao:'OERK'},/identity-invalid/);
 assertRejectedUnchanged(stateFor(),{...globalFacility('air'),iata:'RUH'},/identity-invalid/);
});

test('source keys must resolve exactly to the canonical global registry row',()=>{
 for(const company of ['air','sea']){
  const row=globalFacility(company);assertRejectedUnchanged(stateFor(),{...row,sourceKey:row.sourceKey+':extra'},/source-invalid/);
  assertRejectedUnchanged(stateFor(),{...row,sourceKey:company==='air'?globalFacility('sea').sourceKey:globalFacility('air').sourceKey},/source-invalid/);
 }
});

test('a second identifier cannot reopen the same directory site',()=>{
 for(const company of companies){const state=stateFor(),row=fixture(company);create(state,row);assertRejectedUnchanged(state,{...row,id:row.id+'-SECOND'},/already-open/);}
});

test('explicit buckets cannot move a company facility into another facility registry',()=>{
 for(const company of companies){const row=fixture(company),wrong=['air','sea'].includes(company)?'customHubs':'globalBases';assertRejectedUnchanged(stateFor(),row,/bucket-mismatch/,{bucket:wrong});assertRejectedUnchanged(stateFor(),row,/bucket-mismatch/,{bucket:'unknown'});}
});

test('funding, settled cheque and facility all roll back if opening fails late',()=>{
 const state=stateFor();s.GH_FINANCE_CORE.ensure(state);s.GH_FINANCE_CORE.book(state,'group').accounts[0].balance=1_000_000;s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=0;s.GH_FINANCE_CORE.reconcile(state);
 const before=JSON.stringify(state);
 assert.throws(()=>s.GH_TRANSACTION_CORE.execute(state,{label:'open-base-failure',apply(){
  command(state,'finance','transfer',{from:'group',to:'air',amount:200_000,note:'construction funding',ref:'BASE-FUND-1'});
  command(state,'finance','pay-by-cheque',{company:'air',amount:200_000,note:'construction payment',beneficiary:'Approved Contractor',taxable:false,line:'capex'});
  command(state,'facilities','create',{facility:globalFacility('air'),bucket:'globalBases'});
  assert.strictEqual(state.globalBases.length,1);assert.strictEqual(state.finance.cheques[0].status,'مصروف');
  throw new Error('injected-staffing-failure');
 }}),/injected-staffing-failure/);
 assert.strictEqual(JSON.stringify(state),before,'full opening transaction must be restored');
});

test('invalid site after payment rolls back finance before any facility can escape',()=>{
 const state=stateFor();s.GH_FINANCE_CORE.ensure(state);s.GH_FINANCE_CORE.book(state,'sea').accounts[0].balance=500_000;s.GH_FINANCE_CORE.reconcile(state);const before=JSON.stringify(state);
 assert.throws(()=>s.GH_TRANSACTION_CORE.execute(state,{label:'invalid-base-opening',apply(){
  command(state,'finance','pay-by-cheque',{company:'sea',amount:100_000,note:'construction payment',beneficiary:'Approved Contractor',taxable:false,line:'capex'});
  const invalid=globalFacility('sea');invalid.coords=[24.7136,46.6753];command(state,'facilities','create',{facility:invalid,bucket:'globalBases'});
 }}),/coordinates-invalid/);
 assert.strictEqual(JSON.stringify(state),before);
});

test('legacy facility state is neither rewritten nor rejected when loaded',()=>{
 const state=stateFor(),legacy={id:'LEGACY-AIR',company:'air',kind:'airport-base',owned:true,name:'Legacy base',city:'Old city',coords:[1,2]};state.globalBases.push(legacy);F.ensure(state);assert.strictEqual(F.find(state,legacy.id),legacy);assert.strictEqual(legacy.sourceKey,undefined);
});

test('every management command rejects another company before touching the facility or accounts',()=>{
 const commands=['close','budget','optimize','recovery','maintenance','expand','hire','audit','contract','task','task-done'];
 for(const company of companies){
  const state=stateFor(),facility=create(state,fixture(company));s.GH_FINANCE_CORE.ensure(state);const before=JSON.stringify(state);
  for(const cmd of commands){
   const payload={id:facility.id,company:company==='air'?'sea':'air',cost:100_000,amount:100_000,settlement:100_000};
   assert.strictEqual(F.validate({state},cmd,payload).reason,'facility-management-company-mismatch');
   assert.throws(()=>F.execute({state},cmd,payload),/facility-management-company-mismatch/);
   assert.strictEqual(JSON.stringify(state),before,`${company}:${cmd} changed state after a company mismatch`);
  }
 }
});

test('a cross-company management rejection rolls back earlier finance in the same transaction',()=>{
 const state=stateFor(),facility=create(state,globalFacility('air'));s.GH_FINANCE_CORE.ensure(state);s.GH_FINANCE_CORE.book(state,'group').accounts[0].balance=1_000_000;s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=0;s.GH_FINANCE_CORE.reconcile(state);const before=JSON.stringify(state);
 assert.throws(()=>s.GH_TRANSACTION_CORE.execute(state,{label:'wrong-company-management',apply(){
  command(state,'finance','transfer',{from:'group',to:'air',amount:200_000,note:'facility funding',ref:'WRONG-OWNER-FUND'});
  command(state,'facilities','budget',{id:facility.id,company:'sea',cost:100_000,amount:100_000});
 }}),/facility-management-company-mismatch/);
 assert.strictEqual(JSON.stringify(state),before);
});

test('valid management charges only its actual owner with explicit or implicit company',()=>{
 for(const company of companies){
  const state=stateFor(),facility=create(state,fixture(company));s.GH_FINANCE_CORE.ensure(state);
  for(const owner of ['group',...companies])s.GH_FINANCE_CORE.book(state,owner).accounts[0].balance=500_000;s.GH_FINANCE_CORE.reconcile(state);
  const before=Object.fromEntries(['group',...companies].map(owner=>[owner,s.GH_FINANCE_CORE.operating(state,owner)]));
  command(state,'facilities','budget',{id:facility.id,company,cost:100_000,amount:100_000});
  command(state,'facilities','budget',{id:facility.id,cost:50_000,amount:50_000});
  for(const owner of ['group',...companies])assert.strictEqual(s.GH_FINANCE_CORE.operating(state,owner),before[owner]-(owner===company?150_000:0),`${company} facility affected ${owner} account`);
  assert.strictEqual(state.advanced.facilities[facility.id].budget,150_000);
 }
});

console.log(`BUILD309 facility directory isolation: ${passed}/13`);
