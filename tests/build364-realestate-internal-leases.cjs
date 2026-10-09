'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','finance-core','facility-core','realestate-core','economics-core','save-schema']);

const openedCompanies=['bank','realestate'],companyRegistry=Object.fromEntries(openedCompanies.map(id=>{const definition=s.GH_COMPANY_DEFINITIONS.get(id);return [id,{id,definitionId:definition.definitionId,definitionVersion:definition.definitionVersion,status:'active'}];}));
const state={...minimal(),profile:{name:'Build 364 internal rent'},companyRegistry,openedCompanies,branches:[],customHubs:[{id:'RE-RUH',kind:'realestate',ownerCompanyId:'realestate',owned:true,city:'الرياض',country:'السعودية'}],realEstate:{},advanced:{}};
const F=s.GH_FINANCE_CORE;F.ensure(state);for(const id of openedCompanies)F.book(state,id).accounts[0].balance=250000000;F.reconcile(state);
const RE=s.GH_REALESTATE_CORE,re=RE.ensure(state),office=re.offices[0];
re.projects.push({id:'RE-LEASE-QA',officeId:office.id,city:office.city,country:office.country,type:'residential',name:'برج المجموعة',mode:'lease',units:200,unitCost:212400,landCost:6480000,buildCost:36000000,priceLevel:1,startDay:0,completeDay:0,status:'مكتمل',milestonesPaid:3,sold:0,presold:0,leased:0,handedOver:0,salesRevenue:0,rentRevenue:0,leases:[]});
const beforeInvalid=JSON.stringify({project:re.projects[0],contracts:state.finance.commercialContracts});
assert.throws(()=>RE.leaseToCompany(state,{projectId:'RE-LEASE-QA',companyId:'realestate',leaseId:'BAD-TENANT',units:1,rentLevel:1,years:3}),/realestate-internal-lease-tenant-invalid/);
assert.throws(()=>RE.leaseToCompany(state,{projectId:'RE-LEASE-QA',companyId:'bank',leaseId:'BAD-UNITS',units:201,rentLevel:1,years:3}),/realestate-internal-lease-units-invalid/);
assert.equal(JSON.stringify({project:re.projects[0],contracts:state.finance.commercialContracts}),beforeInvalid,'rejected requests do not create partial lease records');
const lease=RE.leaseToCompany(state,{projectId:'RE-LEASE-QA',companyId:'bank',leaseId:'RE-LEASE-QA-001',units:2,rentLevel:1,years:3});
assert.equal(lease.units,2);assert.equal(lease.tenantCompanyId,'bank');assert.ok(lease.documentProofId&&lease.contentDigest,'lease agreement has a protected commercial-contract proof');
assert.equal(re.projects[0].leased,2);assert.equal(state.finance.commercialContracts.find(row=>row.id===lease.legalDocumentId)?.terms.internal,true);
assert.deepEqual(RE.leaseToCompany(state,{projectId:'RE-LEASE-QA',companyId:'bank',leaseId:'RE-LEASE-QA-001',units:2,rentLevel:1,years:3}),lease,'retry returns the same lease without duplicating it');
assert.throws(()=>RE.leaseToCompany(state,{projectId:'RE-LEASE-QA',companyId:'bank',leaseId:'RE-LEASE-QA-001',units:3,rentLevel:1,years:3}),/realestate-internal-lease-reference-conflict/);

const realestateBefore=F.operating(state,'realestate'),bankBefore=F.operating(state,'bank');state.companyBudgets.bank={enabled:true,limit:100000000,spent:0,reserved:0,period:1,lines:{other:100},spentByLine:{},reservedByLine:{}};let day30;
for(let day=1;day<=30;day++){state.simSeconds=day*86400;const row=RE.tickDay(state,{day});if(day===30)day30=row;}
const expected=lease.annualRent*30/365;
assert.ok(Math.abs(day30.internalRentRevenue-lease.annualRent/365)<.01,'the owner recognizes daily internal rental income');
assert.equal(day30.internalRentSettlements.length,0,'an over-budget settlement stays open without a partial transfer');assert.ok(Math.abs(re.internalRentAccounts.bank.amount-expected)<.02);assert.equal(RE.summary(state).internalRentReceivable,re.internalRentAccounts.bank.amount);
state.companyBudgets.bank.lines.other=10000;state.simSeconds=31*86400;const day31=RE.tickDay(state,{day:31}),settlement=day31.internalRentSettlements.find(row=>row.companyId==='bank');
assert.ok(settlement&&Math.abs(settlement.amount-lease.annualRent*31/365)<.02,'carried rent settles once after its budget is available');
const transfer=state.finance.transfers.find(row=>row.reference===settlement.reference);assert.equal(transfer?.kind,'intercompany-service');assert.equal(transfer.fromCompany,'bank');assert.equal(transfer.toCompany,'realestate');
assert.ok(transfer.expenseDocumentNumber&&transfer.incomeDocumentNumber,'the settlement creates linked expense and income documents');
assert.equal(F.operating(state,'bank'),bankBefore-settlement.amount);assert.equal(F.operating(state,'realestate'),realestateBefore+settlement.amount);
const close=s.GH_ECONOMICS_CORE.sectorEconomics(state,{day:31,preferDailyReport:true}).detail;
assert.ok(close.companyExpense.bank>0,'tenant receives a daily P&L expense');assert.equal(close.companyCashExpense.bank,0,'a completed internal transfer is not charged again by generic daily close');
assert.equal(close.companyCashRevenue.realestate,day31.revenue-day31.internalRentRevenue,'owner cash income excludes internal rent already handled by its transfer');
assert.equal(Object.keys(re.internalRentAccounts).length,0,'settled receivable clears');assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true,'new lease state passes the current save schema');
console.log(JSON.stringify({suite:'build364-realestate-internal-leases',passed:1,total:1,leaseId:lease.id,settlement:transfer.reference,amount:settlement.amount}));
