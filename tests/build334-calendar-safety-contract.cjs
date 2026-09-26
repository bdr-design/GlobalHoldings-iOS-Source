'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const results=[];
function test(name,fn){fn();results.push(name);console.log('PASS',name);}
function environment(opened=[]){
 const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','company-adapters-core','transaction-core','banking-core','energy-core','advanced-core']);
 s.GH_FLEET_CORE={};s.GH_ROUTE_CORE={};s.GH_MOBILITY_CORE={};s.GH_CORPORATE_CORE={};
 const migrated=s.GH_COMPANY_PLATFORM.migrateState({...minimal(),onboardingComplete:true,openedCompanies:opened,companyRegistry:{},advanced:{cyber:{coverage:82},safety:{score:88},procurement:{savings:0}}});
 assert.deepEqual(Array.from(migrated.errors),[]);const state=migrated.state,calls=[];
 s.GH_DOMAIN_COMMANDS={dispatchSystem(ctx,domain,command,payload){calls.push({domain,command,owner:payload.ownerCompanyId??null,day:payload.day});return {result:{day:payload.day}};}};
 return {s,state,calls};
}
test('dormant unfounded prudential preview must not read or fabricate a bank book',()=>{
 const {s,state}=environment();let reads=0;
 s.GH_FINANCE_CORE={operating(){reads++;throw new Error('company-not-found:bank');}};
 const books=JSON.stringify(state.companyFinance),opened=JSON.stringify(state.openedCompanies);
 const model=s.GH_BANKING_CORE.reconcilePrudential(state);
 assert.equal(reads,0);assert.equal(model.hqla,0);assert.equal(JSON.stringify(state.companyFinance),books);assert.equal(JSON.stringify(state.openedCompanies),opened);
});
test('non-dormant bank must still reject a missing finance book',()=>{
 const {s,state}=environment();state.bank={deposits:1};
 s.GH_FINANCE_CORE={operating(){throw new Error('company-not-found:bank');}};
 assert.throws(()=>s.GH_BANKING_CORE.reconcilePrudential(state),/company-not-found:bank/);
});
test('daily dispatch skips unfounded catalog definitions and fleet-only groups',()=>{
 for(const ids of [[],['air'],['sea','road','mobility']]){
  const {s,state,calls}=environment(ids);const books=JSON.stringify(state.companyFinance);
  assert.equal(s.GH_ADVANCED.onFinancialDay(state,1),4500);
  assert.deepEqual(calls.filter(x=>['banking','energy'].includes(x.domain)),[]);
  assert.equal(JSON.stringify(state.companyFinance),books);
 }
});
test('operational bank and energy retain their owners and one scheduled dispatch',()=>{
 for(const ids of [['bank'],['power'],['bank','power'],['power','bank']]){
  const {s,state,calls}=environment(ids);s.GH_ADVANCED.onFinancialDay(state,17);
  assert.deepEqual(calls.filter(x=>['banking','energy'].includes(x.domain)),ids.sort().map(owner=>({domain:owner==='bank'?'banking':'energy',command:'tick-day',owner,day:17})));
 }
});
test('held companies receive no daily operations; direct hook retains operational authorization',()=>{
 const {s,state,calls}=environment(['bank','power']);
 for(const id of ['bank','power'])state.companyRegistry[id].quarantine={readOnly:true,reason:'definition-newer-than-runtime'};
 s.GH_ADVANCED.onFinancialDay(state,1);assert.equal(calls.filter(x=>['banking','energy'].includes(x.domain)).length,0);
 assert.throws(()=>s.GH_BANKING_CORE.onFinancialDay({state,companyId:'bank'},{day:1}),/company-not-operational/);
 assert.throws(()=>s.GH_ENERGY_CORE.onFinancialDay({state,companyId:'power'},{day:1}),/company-not-operational/);
});
test('future registered operations hooks receive company context and roll back with enclosing day',()=>{
 const {s,state}=environment();const P=s.GH_COMPANY_PLATFORM,A=s.GH_COMPANY_ADAPTERS;
 const definition=JSON.parse(JSON.stringify(P.getDefinition('air')));
 definition.id='future-air';definition.definitionId='gh-future-air-v1';definition.legacy={companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}};
 definition.adapters.operations='future-daily-v1';definition.finance.accountPrefix='FUT';definition.finance.documentPrefix='FUT';definition.founding.documentPrefix='FUT';
 A.registerProvider({schema:A.PROVIDER_SCHEMA,version:1,kind:'operations',id:'future-daily-v1',capabilityId:'company.core',engineNames:['GH_FUTURE_DAILY'],methods:['onFinancialDay']});
 P.installDefinition(definition,{source:'calendar-contract'});
 const migrated=P.migrateState({...state,openedCompanies:['future-air'],companyRegistry:{...state.companyRegistry,'future-air':{definitionId:definition.definitionId}}});
 assert.deepEqual(Array.from(migrated.errors),[]);const target=migrated.state;
 s.GH_FUTURE_DAILY={onFinancialDay(ctx,p){assert.equal(ctx.companyId,'future-air');ctx.state.companyModules[ctx.companyId]??={};ctx.state.companyModules[ctx.companyId].operations={day:p.day};throw new Error('qa-future-day-failure');}};
 const before=JSON.stringify(target);
 assert.throws(()=>s.GH_TRANSACTION_CORE.execute(target,{label:'calendar-test',apply(){target.simSeconds=86400;s.GH_ADVANCED.onFinancialDay(target,1);}}),/qa-future-day-failure/);
 assert.equal(JSON.stringify(target),before);
});
test('existing simulation kernel reaches 365 and leap 366 days with exact ordered boundaries',()=>{
 const {s}=harness(['simulation-core']);
 for(const days of [365,366]){
  let time=0,now=0,speed=0;const hours=[],dates=[];
  const engine=s.GH_SIMULATION_CORE.create({getSimTime:()=>time,setSimTime:t=>{time=t;},getSpeed:()=>speed,setSpeed:v=>{speed=v;},createSliceJob(_slice,meta){return {runChunk:()=>true,finish(){if(meta.boundary.hour!==null)hours.push(meta.boundary.hour);if(meta.boundary.day!==null)dates.push(meta.boundary.day);time=meta.to;return {committed:true};}};}},{nowMs:()=>now,allowedSpeeds:[0,1,5,15,30],fallbackSpeed:1});
  assert.equal(engine.advanceTo(days*86400,{speed:30,batchSeconds:3600}).accepted,true);now+=16;engine.frame(now);
  assert.equal(time,days*86400);assert.equal(engine.snapshot().manualAdvance,null);assert.equal(dates.length,days);assert.equal(hours.length,days*24);
  for(let i=0;i<dates.length;i++)assert.equal(dates[i],i+1);for(let i=0;i<hours.length;i++)assert.equal(hours[i],i+1);
  assert.equal(engine.advanceTo(time-1).accepted,false);assert.equal(engine.advanceTo(time+367*86400).accepted,false);
 }
});
console.log(JSON.stringify({suite:'calendar-safety-contract',passed:results.length,results}));
