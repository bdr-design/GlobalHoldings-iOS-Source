'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {scenario}=require('./helpers/business-scenario');

const app=fs.readFileSync(require.resolve('../WebApp/app.js'),'utf8');
const start=app.indexOf('  ensureCompanyFinance();reconcileConsolidatedCash();');
const end=app.indexOf("  if(!window.GH_BUSINESS_WORLD?.execute)",start);
assert.ok(start>=0&&end>start,'startup normalization block must remain discoverable');

const {s}=scenario(),state={advanced:{schema:2,companies:{}},groupValue:100};
let financeEnsures=0,reconciles=0,mobilityEnsures=0;
vm.runInNewContext(app.slice(start,end),{
  state,
  ensureCompanyFinance(){financeEnsures++;},
  reconcileConsolidatedCash(){reconciles++;},
  window:{
    GH_CORPORATE_CORE:s.GH_CORPORATE_CORE,
    GH_MOBILITY_CORE:{ensure(target){
      mobilityEnsures++;
      assert.ok(target.advanced.groupManagement?.plan,'Corporate migration must finish before Mobility startup normalization');
    }}
  }
});

assert.equal(financeEnsures,1);
assert.equal(reconciles,1);
assert.equal(mobilityEnsures,1);
assert.deepEqual(Object.keys(state.advanced.groupManagement.plan),[
  'annualRevenueTarget','netMarginTarget','liquidityFloor','debtCeiling',
  'capitalAllocationBudget','priority','lastReviewedAt'
]);
assert.equal(JSON.stringify(state.advanced.groupManagement.history),'[]');
assert.equal(JSON.stringify(state.companyRegistry),'{}');
assert.equal(JSON.stringify(state.openedCompanies),'[]');
assert.equal(JSON.stringify(state.unlockedSectors),'[]');
assert.equal(JSON.stringify(state.stakes),'{}');
assert.equal(JSON.stringify(state.maDeals),'{}');

console.log('Build342 startup performs the one-time Corporate migration before steady simulation PASS');
