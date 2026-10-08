'use strict';
// Customer lifecycle stays bounded and signed customer contracts are visible in the protected finance register.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');

function environment(){const env=scenario();env.load('business-world-core');env.load('contracts-core');return env;}

{
 const {s,state,command}=environment(),W=s.GH_BUSINESS_WORLD,F=s.GH_FINANCE_CORE,P=s.GH_DOCUMENT_PROOF;
 W.execute({state},'sync-world',{customers:[{name:'عميل الجودة',sector:'air'}],opportunities:[]});
 command('contracts','bid',{id:'QA-CUSTOMER-1',won:true,number:'QA-CN-0001',client:'عميل الجودة',sector:'air',category:'شحن',title:'عقد جودة العملاء',value:66000000,termMonths:18,region:'الخليج',sla:'99.0%',penalty:'تعويض خدمة',capacity:'52 طن أسبوعيًا',payment:'كل 14 يومًا'});
 const signed=command('contracts','sign',{id:'QA-CUSTOMER-1',company:'air',client:'عميل الجودة',sector:'air',category:'شحن',name:'عقد جودة العملاء',value:66000000,termMonths:18,region:'الخليج',sla:'99.0%',penalty:'تعويض خدمة',capacity:'52 طن أسبوعيًا',payment:'كل 14 يومًا',deposit:6600000,taxable:true});
 const official=state.finance.commercialContracts.find(row=>row.id===signed.financeDocumentId);
 assert(official,'signed customer contract must enter official finance documents');
 assert.equal(official.company,'air');assert.equal(official.counterparty,'عميل الجودة');assert.equal(official.terms.sla,'99.0%');assert(official.sourceRefs.includes('QA-CUSTOMER-1'));
 assert.equal(P.verifyDocument(state,official).ok,true);assert.equal(P.verifyDocument(state,signed).ok,true);
 const invoice=state.finance.invoices.find(row=>official.linkedDocumentNumbers.includes(row.number));assert(invoice,'deposit invoice must be linked to the official contract');
 const profile=W.customerSnapshot(state,signed.clientPartyId);assert.equal(profile.totalBilled,6600000);assert.equal(profile.received,6600000);assert.equal(profile.outstanding,0);
 command('contracts','expire',{id:'QA-CUSTOMER-1'});assert.equal(state.contractRegistry['QA-CUSTOMER-1'].status,'منتهي');assert.equal(state.finance.commercialContracts.find(row=>row.id===official.id).status,'منتهي');assert.equal(P.verifyDocument(state,state.finance.commercialContracts.find(row=>row.id===official.id)).ok,true);
 F.ensure(state);assert.equal(state.finance.commercialContracts.filter(row=>row.id===official.id).length,1,'official contract is idempotent');
}

{
 const {s,state,command}=environment(),P=s.GH_DOCUMENT_PROOF,F=s.GH_FINANCE_CORE;
 s.GH_CONTRACTS_CORE.ensure(state);
 state.contractRegistry.LEGACY={status:'نشط',number:'LEGACY-CN-1',company:'air',sector:'air',client:'عميل قديم',counterparty:'عميل قديم',title:'عقد محفوظ قديم',value:12000000,amount:12000000,termMonths:12,signedAt:86400};state.acceptedContracts.push('LEGACY');state.contractStartDays.LEGACY=1;P.sealDocument(state,state.contractRegistry.LEGACY,{type:'commercial-contract',companyId:'air',authorizationKind:'legacy-name-only'});
 const cashBefore=F.operating(state,'air'),first=command('contracts','migrate-documents'),second=command('contracts','migrate-documents'),doc=state.contractRegistry.LEGACY,official=state.finance.commercialContracts.find(row=>(row.sourceRefs||[]).includes('LEGACY'));
 assert.equal(first.migrated,1);assert.equal(first.skipped,0);assert.equal(second.migrated,0);assert(official);assert.equal(F.operating(state,'air'),cashBefore,'migration cannot post cash or revenue');assert.equal(P.verifyDocument(state,official).ok,true);assert.equal(P.verifyDocument(state,doc).ok,true);command('contracts','expire',{id:'LEGACY'});assert.equal(state.finance.commercialContracts.find(row=>row.id===official.id).status,'منتهي');
}

{
 const {s,state}=environment(),W=s.GH_BUSINESS_WORLD;
 for(let index=0;index<1000;index++){const partyId=index<W.CUSTOMER_PROFILE_LIMIT?W.upsertParty(state,{id:`LOAD-${index}`,name:`عميل حمل ${index}`,role:'customer'}).id:`LOAD-${index}`;W.touchCustomerLifecycle(state,{partyId,company:'air',amount:index%4===0?60000000:index%4===1?2000000:index%4===2?200000:500,stage:'lead',reference:`LOAD-${index}`,kind:'load'});}
 const portfolio=W.customerPortfolio(state,'air');assert.equal(portfolio.profiles.length,W.CUSTOMER_PROFILE_LIMIT);assert(Object.keys(portfolio.companies.air.segments.reduce((out,row)=>(out[row.segment]=true,out),{})).length<=4);
 let reviewed=0;const timings=[];for(let day=1;day<=365;day++){state.simSeconds=day*86400;const started=performance.now(),out=W.execute({state},'tick-day',{day});timings.push(performance.now()-started);assert(out.reviewedCustomers<=W.CUSTOMER_REVIEW_BATCH);reviewed+=out.reviewedCustomers;}
 timings.sort((a,b)=>a-b);const p99=timings[Math.floor(timings.length*.99)],bytes=Buffer.byteLength(JSON.stringify(state.businessWorld.customers));assert(reviewed>0);assert.equal(W.customerPortfolio(state,'air').profiles.length,W.CUSTOMER_PROFILE_LIMIT);assert(bytes<220000,'bounded customer engine must stay compact after a simulated year');assert(p99<10,`customer daily review p99 is too heavy: ${p99.toFixed(3)}ms`);assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);globalThis.__customerEngineMetrics={bytes,p99:Number(p99.toFixed(3))};
}

console.log('BUILD360_CUSTOMER_CONTRACT_ENGINE_PASS',JSON.stringify(globalThis.__customerEngineMetrics));
