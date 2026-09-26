'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=path.resolve(__dirname,'..');
const {harness,minimal}=require('./helpers/core-harness');

function record(platform,id,definitionId){
  const definition=platform.getDefinition(definitionId);
  return {...platform.instanceMetadata(id,definition),legalName:`${id} Legal Company`,status:'active'};
}

const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','finance-core']);
const Platform=s.GH_COMPANY_PLATFORM,Finance=s.GH_FINANCE_CORE;
const state=minimal();
state.onboardingComplete=true;
state.profile={name:'Dynamic Finance Group',founder:'Founder'};
state.companyRegistry={
  group:record(Platform,'group','group'),
  air:record(Platform,'air','air'),
  'air-east':record(Platform,'air-east','air')
};
state.openedCompanies=['air','air-east'];
state.assets=[
  {id:'AIR-OWNED-1',ownerCompanyId:'air',assetMode:'air',type:'air'},
  {id:'EAST-OWNED-1',ownerCompanyId:'air-east',assetMode:'air',type:'air'},
  {id:'EAST-OWNED-2',ownerCompanyId:'air-east',assetMode:'air',type:'air'}
];

assert.equal(Platform.getOperationProfile(state,'air'),Platform.getOperationProfile(state,'air-east'),'fixture must use one operational/asset mode');
Finance.ensure(state);
assert.deepEqual([...Finance.companyIds(state)],['group','air','air-east']);
assert.deepEqual(Object.keys(state.tripProfitAccrued),['air','air-east']);
assert.equal(Finance.COMPANY_METRIC_KEYSPACE,'company-instance-id/v1');
assert.equal(Finance.collectionProfile('air-east',state).channel,Finance.collectionProfile('air',state).channel,'instance must inherit its definition collection profile');

const seededAir=Finance.operating(state,'air'),seededEast=Finance.operating(state,'air-east');
assert.equal(seededAir+seededEast,550000,'legacy treasury allocation must conserve the allocated pool');
assert.ok(seededEast>seededAir,'canonical ownerCompanyId counts, rather than shared assetMode, drive allocation');

Finance.execute({state},'apply-simulation-journal',{journal:{
  todayProfit:400,
  sectorProfit:{air:100,'air-east':300},
  tripProfit:{air:100,'air-east':300},
  tripRevenue:{air:180,'air-east':520},
  tripFuel:{air:60,'air-east':150},
  tripMaintenance:{air:20,'air-east':70},
  tripCount:{air:1,'air-east':4},
  cash:{air:100,'air-east':300}
}});
assert.equal(state.tripProfitAccrued.air,100);
assert.equal(state.tripProfitAccrued['air-east'],300);
assert.equal(state.finance.pendingDailyCash.air,100);
assert.equal(state.finance.pendingDailyCash['air-east'],300);

const consumed=Finance.execute({state},'consume-trip-accruals',{});
assert.deepEqual({...consumed.profit},{air:100,'air-east':300});
assert.deepEqual({...consumed.revenue},{air:180,'air-east':520});
assert.deepEqual({...consumed.count},{air:1,'air-east':4});
assert.deepEqual({...state.tripProfitAccrued},{air:0,'air-east':0},'reset must preserve every instance key');
assert.deepEqual({...state.finance.pendingDailyCash},{air:0,'air-east':0},'cash reset must preserve every instance key');

state.simSeconds=86400;
const airBefore=Finance.operating(state,'air'),eastBefore=Finance.operating(state,'air-east');
Finance.execute({state},'settle-daily-cash',{company:'air',amount:100,grossAmount:180,deductions:80,tripCount:1,day:1,reference:'DAY-CASH-air-1'});
Finance.execute({state},'settle-daily-cash',{company:'air-east',amount:300,grossAmount:520,deductions:220,tripCount:4,day:1,reference:'DAY-CASH-air-east-1'});
assert.equal(Finance.operating(state,'air')-airBefore,100);
assert.equal(Finance.operating(state,'air-east')-eastBefore,300);
assert.equal(state.finance.transfers.find(row=>row.reference==='DAY-CASH-air-1').company,'air');
assert.equal(state.finance.transfers.find(row=>row.reference==='DAY-CASH-air-east-1').company,'air-east');

const close=Finance.execute({state},'record-daily-close',{day:1,net:400,sectors:{air:100,'air-east':300},companies:{
  air:{grossRevenue:180,expenses:80,net:100,tripRevenue:180,operatingRevenue:0,tripCount:1},
  'air-east':{grossRevenue:520,expenses:220,net:300,tripRevenue:520,operatingRevenue:0,tripCount:4}
}});
assert.deepEqual(Object.keys(close.companies),['air','air-east']);
assert.equal(close.companies.air.net,100);
assert.equal(close.companies['air-east'].net,300);
assert.equal(Finance.performance(state,'air',30).net,100);
assert.equal(Finance.performance(state,'air-east',30).net,300);
assert.equal(Finance.annualPerformance(state,'air',2026).net,100);
assert.equal(Finance.annualPerformance(state,'air-east',2026).net,300);

let before=JSON.stringify(state);
assert.throws(()=>Finance.execute({state},'apply-simulation-journal',{journal:{tripProfit:{'ghost-airline':1}}}),/finance-simulation-trip-profit-company-unknown:ghost-airline/);
assert.equal(JSON.stringify(state),before,'unknown journal owner must not partially accrue');
assert.throws(()=>Finance.execute({state},'record-daily-close',{day:2,net:1,sectors:{air:1},companies:{'ghost-airline':{net:1}}}),/finance-daily-close-company-unknown:ghost-airline/);
assert.equal(JSON.stringify(state),before,'unknown daily close owner must not create a report');
assert.throws(()=>Finance.execute({state},'record-daily-close',{day:2,net:10,sectors:{air:10},companies:{air:{grossRevenue:20,expenses:5,net:10}}}),/finance-daily-close-company-unbalanced:air/);
assert.equal(JSON.stringify(state),before,'unbalanced company close must not create a report');
assert.throws(()=>Finance.execute({state},'record-daily-close',{day:2,net:10,sectors:{air:9},companies:{air:{grossRevenue:20,expenses:10,net:10}}}),/finance-daily-close-sector-mismatch:air/);
assert.equal(JSON.stringify(state),before,'sector/company mismatch must not create a report');

state.tripProfitAccrued.sea=0;
Finance.ensure(state);
assert.equal(Object.hasOwn(state.tripProfitAccrued,'sea'),false,'zero Build 332/333 placeholder is migrated away');
state.tripProfitAccrued.sea=1;
assert.throws(()=>Finance.ensure(state),/finance-trip-profit-company-unknown:sea/,'non-zero unowned legacy bucket must fail closed');
delete state.tripProfitAccrued.sea;
Finance.ensure(state);

const legacy=harness(['finance-core']).s.GH_FINANCE_CORE,legacyState=minimal();
legacyState.openedCompanies=['air'];
legacyState.tripProfitAccrued={air:9,sea:0,road:0,power:0,bank:0,mobility:0};
legacyState.tripRevenueAccrued={air:12,sea:0,road:0,power:0,bank:0,mobility:0};
const legacyConsumed=legacy.execute({state:legacyState},'consume-trip-accruals',{});
assert.equal(legacyConsumed.profit.air,9);
assert.equal(legacyConsumed.revenue.air,12);
assert.deepEqual(Object.keys(legacyConsumed.profit),['air','sea','road','power','bank','mobility'],'platform-free legacy runtime retains the Build 332/333 key set');

console.log(JSON.stringify({
  suite:'build334-dynamic-finance-company-ids',
  passed:14,
  total:14,
  companies:Finance.companyIds(state),
  sharedOperationProfile:Platform.getOperationProfile(state,'air'),
  isolatedClose:{air:close.companies.air.net,'air-east':close.companies['air-east'].net}
},null,2));
