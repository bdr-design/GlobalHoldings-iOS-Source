'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['world-data','catalog','capability-registry-core','company-definitions','company-platform-core','company-adapters-core','fleet-core','mobility-core']);
s.GH_ROUTE_CORE={};
const state=s.GH_COMPANY_PLATFORM.migrateState({...minimal(),onboardingComplete:true,companyRegistry:{}}).state,before=JSON.stringify(state),counts={};
for(const id of ['air','sea','road','mobility']){
 const rows=s.GH_COMPANY_ADAPTERS.invokeAdapter(state,id,'operations','purchaseCatalogs',[],{registered:false});
 assert.equal(rows.length,1);assert.equal(rows[0].mode,id);assert(rows[0].new.length>0);assert.equal(JSON.stringify(state),before,'catalog query must not found a company, finance book, or asset');
 counts[id]={new:rows[0].new.length,used:rows[0].used.length};
}
assert.equal(counts.mobility.new,s.GH_MOBILITY_CORE.CLASSES.length);
assert.deepEqual(Array.from(state.openedCompanies),[]);assert.equal(JSON.stringify(state.companyFinance),JSON.stringify(JSON.parse(before).companyFinance));
console.log(JSON.stringify({suite:'market-discovery-contract',passed:4,counts,readOnly:true}));
