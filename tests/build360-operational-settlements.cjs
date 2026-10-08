'use strict';
// Exact-date insurance claims, paired intercompany services and transaction-level tax profiles.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');
const env=scenario(),{s,state,command}=env;env.load('insurance-core');
const F=s.GH_FINANCE_CORE,P=s.GH_DOCUMENT_PROOF,DAY=86400;
command('corporate','open-company',{type:'insurance',capital:60000000,legalName:'شركة اختبار التأمين'});

state.insurance={claimsReserve:[{id:'INS-RES-0',day:0,payDay:30,amount:125000}],lastProcessedDay:29};state.simSeconds=30*DAY;
const insuranceBefore=F.operating(state,'insurance'),report=s.GH_INSURANCE_CORE.execute({state},'tick-day',{day:30});
assert.equal(report.claimsDue,125000);assert.equal(report.claimsPaid,125000);assert.equal(report.claimsUnpaid,0);assert.equal(report.cashExpense,0);
assert.equal(F.operating(state,'insurance'),insuranceBefore-125000);assert.equal(state.insurance.claimsReserve.length,0);
const claimTransfer=state.finance.transfers.find(row=>row.reference==='INS-CLAIM-PAY-30');
assert(claimTransfer);assert.equal(claimTransfer.kind,'insurance-claim-payment');assert.equal(claimTransfer.taxCode,'insurance-claim');assert.equal(P.verifyDocument(state,claimTransfer).ok,true);
assert.equal(state.finance.payables.some(row=>String(row.note).includes('مطالبات تأمين')),false,'claim payment cannot become a seven-day supplier payable');
const cashAfterClaim=F.operating(state,'insurance'),retry=s.GH_INSURANCE_CORE.execute({state},'tick-day',{day:30});assert.equal(retry.day,30);assert.equal(F.operating(state,'insurance'),cashAfterClaim);

// Once the group insurer exists, fleet premiums and claims stay inside the group with one linked transfer each.
const drain=generator=>{let step;while(!(step=generator.next()).done){}}
const fleetValue=10000000,maintenance={companies:new Map([['air',{count:10,conditionSum:1000,value:fleetValue,risk:0,premium:fleetValue*.0035,sample:[],due:[],cost:0,restored:0,threshold:80,licence:0,unsafe:0,fine:0}]])};
const airBeforePolicy=F.operating(state,'air'),insurerBeforePolicy=F.operating(state,'insurance');drain(s.GH_REALISM.runIncidents(state,maintenance,30));
const policy=state.advanced.insurance.fleetPolicies[0];assert(policy);assert.equal(policy.company,'air');assert.equal(policy.insurerCompanyId,'insurance');
assert.equal(F.operating(state,'air'),airBeforePolicy-policy.premium);assert.equal(F.operating(state,'insurance'),insurerBeforePolicy+policy.premium);
const policyTransfer=state.finance.transfers.find(row=>row.reference===policy.transferReference);assert(policyTransfer);assert.equal(policyTransfer.kind,'intercompany-service');assert.equal(P.verifyDocument(state,policyTransfer).ok,true);
state.advanced.insurance.claims.unshift({id:'CLM-AIR-QA',company:'air',ownerCompanyId:'air',insurerCompanyId:'insurance',policyReference:policy.id,openedAt:30*DAY,status:'قيد الفحص',loss:1000000,deductible:100000,covered:900000,reserve:900000,incidents:1});
state.simSeconds=33*DAY;const airBeforeClaim=F.operating(state,'air'),insurerBeforeFleetClaim=F.operating(state,'insurance');s.GH_REALISM.onDay(state,33);
const fleetClaim=state.advanced.insurance.claims.find(row=>row.id==='CLM-AIR-QA');assert.equal(fleetClaim.status,'مدفوعة');assert.equal(fleetClaim.provider,'شركة التأمين التابعة');assert.equal(F.operating(state,'air'),airBeforeClaim+900000);assert.equal(F.operating(state,'insurance'),insurerBeforeFleetClaim-900000);
const fleetClaimTransfer=state.finance.transfers.find(row=>row.reference===fleetClaim.transferReference);assert(fleetClaimTransfer);assert.equal(fleetClaimTransfer.kind,'intercompany-service');assert.equal(P.verifyDocument(state,fleetClaimTransfer).ok,true);

const airBefore=F.operating(state,'air'),groupBefore=F.operating(state,'group');
const service=command('finance','settle-intercompany-service',{from:'air',to:'group',amount:100000,reference:'IC-SVC-QA-1',serviceCategory:'خدمة إدارية مشتركة',taxCode:'intercompany-tax-group'});
assert.equal(service.amount,100000);assert.equal(F.operating(state,'air'),airBefore-100000);assert.equal(F.operating(state,'group'),groupBefore+100000);
const serviceTransfer=state.finance.transfers.find(row=>row.reference==='IC-SVC-QA-1');assert(serviceTransfer);assert.equal(P.verifyDocument(state,serviceTransfer).ok,true);
const serviceDocs=[service.expenseInvoiceNumber,service.incomeInvoiceNumber].map(number=>state.finance.invoices.find(row=>row.number===number));
assert(serviceDocs.every(Boolean));assert(serviceDocs.every(row=>row.taxCode==='intercompany-tax-group'&&row.taxRate===0&&row.tax===0));
const serviceRetry=command('finance','settle-intercompany-service',{from:'air',to:'group',amount:100000,reference:'IC-SVC-QA-1',serviceCategory:'خدمة إدارية مشتركة',taxCode:'intercompany-tax-group'});
assert.equal(serviceRetry.amount,0);assert.equal(F.operating(state,'air'),airBefore-100000);assert.equal(F.operating(state,'group'),groupBefore+100000);

const reduced=command('finance','issue-invoice',{kind:'دخل',amount:105,status:'مستحقة',company:'air',counterparty:'عميل ضريبي',note:'خدمة بنسبة مخفضة',taxable:true,taxCode:'reduced-test',taxRate:.05,taxJurisdiction:'QA'});
assert.deepEqual({tax:reduced.tax,subtotal:reduced.subtotal,taxCode:reduced.taxCode,taxRate:reduced.taxRate,taxJurisdiction:reduced.taxJurisdiction},{tax:5,subtotal:100,taxCode:'reduced-test',taxRate:.05,taxJurisdiction:'QA'});
const exempt=command('finance','issue-invoice',{kind:'مصروف',amount:100,status:'مستحقة',company:'insurance',counterparty:'مستفيد',note:'تسوية معفاة',taxable:false,taxCode:'insurance-claim'});
assert.equal(exempt.tax,0);assert.equal(exempt.taxRate,0);assert.equal(exempt.taxCode,'insurance-claim');
assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
console.log('BUILD360_OPERATIONAL_SETTLEMENTS_PASS',JSON.stringify({claim:report.claimsPaid,service:service.amount,reducedTax:reduced.tax}));
