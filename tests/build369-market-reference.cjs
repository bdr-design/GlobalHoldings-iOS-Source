'use strict';
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const snapshot=require('../WebApp/market-reference-data.js');
const reference=require('../WebApp/market-reference-core.js');

assert.equal(snapshot.version,'gh-market-reference-v1');
assert.equal(snapshot.retrievedAt,'2026-10-09');
assert.ok(Object.isFrozen(snapshot)&&Object.isFrozen(snapshot.entries));
assert.ok(Object.values(snapshot.entries).length<=4,'the offline snapshot remains bounded');
assert.ok(Buffer.byteLength(JSON.stringify(snapshot),'utf8')<6000,'the bundled reference stays under 6 KB');
for(const row of Object.values(snapshot.entries)){
  assert.match(row.sourceUrl,/^https:\/\//);assert.match(row.referenceDate,/^\d{4}-\d{2}-\d{2}$/);
  assert.match(row.attribution,/Source:/);assert.ok(row.coverage.length>12);assert.ok(row.value>0&&row.value<.20);
}

const asOf='2026-10-09T12:00:00Z';
const sa=reference.referenceForCountry('SA',{now:asOf}),saName=reference.referenceForCountry('Saudi Arabia',{now:asOf});
assert.equal(sa.available,true);assert.equal(sa.rate,.045);assert.equal(sa.referenceDate,'2026-09-16');assert.equal(saName.referenceId,sa.referenceId);
assert.match(sa.attribution,/SAMA/);assert.match(sa.sourceUrl,/news-1169/);assert.match(sa.coverage,/not a retail|not a retail financing quote/i);
const us=reference.referenceForCountry('United States',{now:asOf});
assert.equal(us.available,true);assert.equal(us.rate,.03875);assert.equal(us.sourceValue,undefined,'resolver exposes only the normalized scalar and provenance');
assert.match(us.attribution,/3\.75%-4\.00%/);
const eu=reference.referenceForCountry('DE',{now:asOf});
assert.equal(eu.available,true);assert.equal(eu.rate,.0265);assert.equal(eu.referenceDate,'2026-09-16');assert.match(eu.sourceUrl,/MRR_FR/);

assert.equal(reference.referenceForCountry('Japan',{now:asOf}).reason,'unsupported-country');
const staleSnapshot={...snapshot,entries:{...snapshot.entries,euroArea:{...snapshot.entries.euroArea,referenceDate:'2024-01-01'}}};
const stale=reference.referenceForCountry('France',{now:asOf,snapshot:staleSnapshot});
assert.equal(stale.available,false);assert.equal(stale.reason,'stale-reference');assert.equal(stale.fallback,'simulation');
const futureSnapshot={...snapshot,entries:{...snapshot.entries,euroArea:{...snapshot.entries.euroArea,referenceDate:'2027-01-01'}}};
assert.equal(reference.referenceForCountry('France',{now:asOf,snapshot:futureSnapshot}).reason,'stale-reference');
assert.equal(reference.referenceForCountry('SA',{now:asOf,maxAgeDays:1}).fallback,'simulation');

const attached=reference.attachableReference(eu);
assert.equal(attached.available,true);assert.equal(attached.referenceId,eu.referenceId);assert.match(attached.attribution,/ECB/);
assert.ok(!Object.hasOwn(attached,'sourceValue'),'contracts receive compact source metadata, not source datasets');

// A country reference is captured once when a new bank loan is originated and copied to its
// customer contract. Unsupported countries retain the pre-existing simulation benchmark.
const {harness,minimal}=require('./helpers/core-harness');
const h=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','market-reference-data','market-reference-core','realism-core','finance-core','hr-core','corporate-core','facility-core','banking-core','game-lifecycle-core']);
const {s}=h,d={...minimal(),profile:{name:'Market Reference QA'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
const state=s.GH_GAME_LIFECYCLE.pristine(d,1);
s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Market Reference Group',founder:'Founder',locationId:'RUH'},d,{nextId:()=> 'FOUND-MR',simYear:()=>2026});
s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'bank',capital:400000000,legalName:'Reference Bank'});
const bank=s.GH_BANKING_CORE.ensure(state);bank.branchNetwork.push({id:'BR-SA-QA',city:'Riyadh',country:'Saudi Arabia',servicesActive:true});
bank.loanRequests.push({id:'REQ-MR-QA',day:0,expiresDay:7,borrower:'QA Borrower',product:'corporate',amount:10000000,termDays:2555,riskGrade:'BBB',collateralCoverage:0,branchId:'BR-SA-QA',sector:'services',status:'بانتظار القرار'});
const decision=s.GH_BANKING_CORE.execute({state},'decide-loan-request',{id:'REQ-MR-QA',decision:'approve'});
assert.equal(decision.status,'موافق');
const issued=bank.loanPortfolios.find(row=>row.id===decision.loanId),customerContract=bank.customerLoanContracts.find(row=>row.id===decision.contractId);
assert.equal(issued.rateReference.referenceId,sa.referenceId);assert.equal(customerContract.rateReferenceId,sa.referenceId);
assert.equal(issued.rate,customerContract.rate);assert.equal(issued.rateReference.sourceUrl,sa.sourceUrl);
const oldLoan=structuredClone(issued),unmatched=s.GH_BANKING_CORE.loanRateQuote(state,'corporate','BBB','Japan');
assert.equal(unmatched.reference.fallback,'simulation');assert.equal(unmatched.baseRate,.046,'unsupported country continues to use the pre-existing modeled base rate');
assert.equal(s.GH_BANKING_CORE.loanRateQuote(state,'corporate','BBB','United States').baseRate,.03875);
assert.equal(s.GH_BANKING_CORE.loanRateQuote(state,'corporate','BBB','Germany').baseRate,.0265);
assert.equal(JSON.stringify(issued),JSON.stringify(oldLoan),'quote lookups for other markets never mutate an existing loan');
const quoteRequest={id:'REQ-QUOTE-QA',amount:10000000,product:'corporate',riskGrade:'BBB',branchId:'BR-SA-QA',termDays:2555},branchArray=bank.branchNetwork,portfolioArray=bank.loanPortfolios,bankBeforeQuotes=JSON.stringify(bank),quoteStart=performance.now();
for(let index=0;index<64;index++)s.GH_BANKING_CORE.loanRequestQuote(state,quoteRequest);
const repeatedQuoteMs=performance.now()-quoteStart;
assert.equal(bank.branchNetwork,branchArray,'quote rendering does not rebuild or replace the branch directory');
assert.equal(bank.loanPortfolios,portfolioArray,'quote rendering does not rebuild or replace the loan portfolio');
assert.equal(JSON.stringify(bank),bankBeforeQuotes,'repeated quote rendering is read-only for saved bank state');
assert.ok(Buffer.byteLength(JSON.stringify(issued.rateReference),'utf8')<512,'per-loan source provenance remains compact');
assert.equal(customerContract.rateReferenceId,issued.rateReference.referenceId,'customer contract links to the source stored once on its portfolio');
const jsonReload=JSON.parse(JSON.stringify({portfolio:issued,contract:customerContract}));
assert.equal(jsonReload.portfolio.rateReference.sourceUrl,sa.sourceUrl,'saved provenance survives JSON serialization');
assert.equal(jsonReload.contract.rateReferenceId,sa.referenceId);
console.log('BUILD369_MARKET_REFERENCE_PASS',JSON.stringify({snapshotBytes:Buffer.byteLength(JSON.stringify(snapshot)),portfolioProvenanceBytes:Buffer.byteLength(JSON.stringify(issued.rateReference)),quoteReads:64,repeatedQuoteMs:Number(repeatedQuoteMs.toFixed(3)),entries:Object.keys(snapshot.entries),rates:{sa,us,eu},fallbacks:['unsupported-country','stale-or-future-reference']}));
