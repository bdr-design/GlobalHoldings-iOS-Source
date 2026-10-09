'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');

function setup(){
 const h=harness([]),s=h.s,parties=new Map(),commands=[],resolvers=new Map();
 s.GH_AUTHORIZATION={registerCommandTargetResolver(domain,resolver){resolvers.set(domain,resolver);return resolver;}};
 s.GH_COMPANY_PLATFORM={requireCompany(_state,id){return {id,operational:true,registered:true,definition:{capabilities:id==='telecom'?['operations.telecom']:['operations.dealer']}};},resolveCompany(_state,id){return {id,operational:true};}};
 s.GH_BUSINESS_WORLD={upsertParty(_state,p){const id=String(p.id||`CUST-${String(p.name||p.displayName).toLowerCase().replace(/[^a-z0-9]+/g,'-')}`),old=parties.get(id)||{id,roles:[],sectors:[]};Object.assign(old,p,{id,roles:[...new Set([...(old.roles||[]),...(p.roles||[]),...(p.role?[p.role]:[])])]});parties.set(id,old);return old;},resolveParty(_state,id){return parties.get(String(id))||null;},touchRelationship(){return {};},touchCustomerLifecycle(){return {};},customerPortfolio(){return {companies:{}};}};
 s.GH_FINANCE_CORE={calendarMonthForDay(value){const date=new Date(Date.UTC(2026,0,1)+Math.max(0,Number(value)||0)*86400000);return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;},execute(ctx,cmd,p){if(cmd==='credit'){const row={company:p.company,kind:'دخل',number:`INV-${ctx.state.finance.invoices.length+1}`,sourceRef:p.ref||p.reference,total:p.amount,status:'مستحقة',at:ctx.state.simSeconds||0,counterpartyPartyId:p.customerId||null};ctx.state.finance.invoices.push(row);return row;}if(cmd==='pay-by-cheque')return {cheque:{id:'CHQ-TEST',status:'مصروف'},invoice:{number:'AP-TEST'}};if(cmd==='register-commercial-contract')return {id:p.id};throw new Error(`unexpected finance command ${cmd}`);}};
 s.GH_DOMAIN_COMMANDS={dispatchSystem(_ctx,domain,cmd,p,meta){commands.push({domain,cmd,p,meta});if(domain==='finance'&&cmd==='credit'){const row=s.GH_FINANCE_CORE.execute({state:s},cmd,p);return {ok:true,result:row};}if(domain==='banking'&&cmd==='submit-customer-loan-request')return {ok:true,result:{id:p.id,status:'بانتظار القرار'}};throw new Error(`unexpected system command ${domain}:${cmd}`);}};
 s.GH_BANKING_CORE={execute(){},customerFinancingQuote(_state,p){return {invoiceAmount:p.invoiceAmount,downPayment:p.downPayment||0,loanPrincipal:p.invoiceAmount-(p.downPayment||0),originationFee:0,disbursementAmount:p.invoiceAmount-(p.downPayment||0),termDays:p.termDays,product:p.product};},customerDisbursementForSale(){return null;}};
 h.load('customer-companies-core');
 return {state:s,core:s.GH_CUSTOMER_COMPANIES_CORE,commands,parties,resolvers};
}
function drain(generator){let step;do{step=generator.next();}while(!step.done);return step.value;}

test('telecom cohorts bill once by calendar month without per-person profiles',()=>{
 const {state:s,core}=setup();s.finance={invoices:[],revenueCollections:[]};
 core.execute({state:s},'set-market-cohort',{id:'SA-consumer',country:'السعودية',segment:'consumer',activeCustomers:1_000_000_000,monthlyPrice:.25});
 const data=s.customerCompanies.companies.telecom;
 assert.equal(data.cohorts.length,1);assert.equal(data.namedCustomerIds.length,0);assert.equal(core.snapshot(s,'telecom').telecom.customerCount,1_000_000_000);
 assert.equal(drain(core.onFinancialDayStages({state:s,companyId:'telecom'},{day:31})).issued,1);
 assert.equal(drain(core.onFinancialDayStages({state:s,companyId:'telecom'},{day:31})).idempotent,true);
 assert.equal(s.finance.invoices.length,1);assert.equal(s.finance.invoices[0].total,250_000_000);
 drain(core.onFinancialDayStages({state:s,companyId:'telecom'},{day:60}));assert.equal(s.finance.invoices.length,2);
});

test('named telecom profiles are bounded at 160',()=>{
 const {state:s,core}=setup();
 for(let i=0;i<core.MAX_NAMED_CUSTOMERS;i++)core.execute({state:s},'create-subscription',{id:`TEL-${i}`,customerName:`Customer ${i}`,planId:'mobile'});
 assert.equal(s.customerCompanies.companies.telecom.namedCustomerIds.length,160);
 assert.throws(()=>core.execute({state:s},'create-subscription',{id:'TEL-OVERFLOW',customerName:'Customer 160',planId:'mobile'}),/named-customer-limit/);
});

test('financed vehicle order is idempotent and stays pending with only one reserved SKU row',()=>{
 const {state:s,core,commands}=setup();s.finance={invoices:[],revenueCollections:[]};
 core.ensure(s);const dealer=s.customerCompanies.companies.dealership;
 dealer.inventory.push({oemId:'toyota',oemName:'تويوتا',modelId:'corolla',model:'Corolla',unitCost:17200,retailPrice:22400,quantity:1,reserved:0,sold:0});
 const payload={saleId:'SALE-1',customerName:'عميل السيارات',modelId:'corolla',quantity:1,financeRequested:true};
 const first=core.execute({state:s},'retail-sale',payload),replay=core.execute({state:s},'retail-sale',payload);
 assert.equal(first.status,'awaiting-bank-decision');assert.deepEqual(replay,first);assert.equal(dealer.inventory.length,1);assert.equal(dealer.inventory[0].quantity,1);assert.equal(dealer.inventory[0].reserved,1);assert.equal(s.finance.invoices.length,0);
 assert.equal(commands.filter(row=>row.domain==='banking'&&row.cmd==='submit-customer-loan-request').length,1);
});

test('a financed sale settles inventory only after a matching bank and Finance receipt',()=>{
 const {state:s,core}=setup();s.finance={invoices:[],revenueCollections:[]};
 core.ensure(s);const dealer=s.customerCompanies.companies.dealership;
 dealer.inventory.push({oemId:'toyota',oemName:'تويوتا',modelId:'corolla',model:'Corolla',unitCost:17200,retailPrice:22400,quantity:1,reserved:0,sold:0});
 const sale=core.execute({state:s},'retail-sale',{saleId:'SALE-2',customerName:'عميل التمويل',modelId:'corolla',financeRequested:true});
 const receipt={sourceCompanyId:'dealership',fromCompany:'bank',toCompany:'dealership',sourceSaleId:sale.id,orderId:sale.id,customerId:sale.partyId,proFormaReference:sale.proFormaReference,invoiceNumber:'AUTO-REAL-2',invoiceAmount:sale.total,downPayment:0,amount:sale.total,loanId:'LOAN-2',contractId:'CONTRACT-2',reference:'CUST-DISB-CONTRACT-2',financeReceiptId:'FIN-RECEIPT-2',status:'posted'};
 s.GH_BANKING_CORE.customerDisbursementForSale=()=>receipt;
 s.finance.invoices.push({company:'dealership',kind:'دخل',number:receipt.invoiceNumber,sourceRef:'AUTO-SALE-SALE-2',counterpartyPartyId:sale.partyId,total:sale.total,status:'محصلة'});
 const completed=core.execute({state:s},'settle-financed-sale',{saleId:sale.id});
 assert.equal(completed.status,'sold-financed');assert.equal(completed.invoiceNumber,receipt.invoiceNumber);assert.equal(dealer.inventory[0].quantity,0);assert.equal(dealer.inventory[0].reserved,0);assert.equal(dealer.inventory[0].sold,1);
});

test('a rejected dealer loan releases reserved stock without issuing an invoice',()=>{
 const {state:s,core}=setup();s.finance={invoices:[],revenueCollections:[]};
 core.ensure(s);const dealer=s.customerCompanies.companies.dealership;
 dealer.inventory.push({oemId:'toyota',oemName:'تويوتا',modelId:'corolla',model:'Corolla',unitCost:17200,retailPrice:22400,quantity:1,reserved:0,sold:0});
 const sale=core.execute({state:s},'retail-sale',{saleId:'SALE-3',customerName:'عميل مرفوض',modelId:'corolla',financeRequested:true});
 assert.equal(core.bankDecision(s,{id:sale.bankApplicationId,sourceCompanyId:'dealership',sourceSaleId:sale.id},{status:'مرفوض'}),true);
 assert.equal(dealer.inventory[0].quantity,1);assert.equal(dealer.inventory[0].reserved,0);assert.equal(s.finance.invoices.length,0);assert.equal(dealer.sales[0].status,'finance-rejected');
});

test('OEM directory stays visible without creating parties on snapshot reads',()=>{
 const {state:s,core,parties}=setup();
 const summary=core.snapshot(s,'dealership').dealership;
 assert.equal(summary.suppliers.length,6);assert.equal(summary.suppliers.every(row=>row.visible),true);assert.equal(parties.size,0);
});

test('authorization resolver maps only the fixed company commands',()=>{
 const {state:s,resolvers}=setup(),resolve=resolvers.get('customer-companies');
 assert.deepEqual(Array.from(resolve({state:s,name:'create-subscription',payload:{customerName:'Ada'}})),['telecom']);
 assert.deepEqual(Array.from(resolve({state:s,name:'retail-sale',payload:{saleId:'S1'}})),['dealership']);
 assert.deepEqual(Array.from(resolve({state:s,name:'tick-day',payload:{company:'telecom'}})),['telecom']);
 assert.deepEqual(Array.from(resolve({state:s,name:'unknown-command',payload:{company:'dealership'}})),[]);
});
