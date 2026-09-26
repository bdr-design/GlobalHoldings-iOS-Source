process.env.GH_TEST_SOURCE_DIR=require('path').resolve(__dirname,'..');
'use strict';
const assert=require('assert');
global.window=global;
global.GH_DETERMINISM={nextFloat:()=>0.2};
require('../WebApp/business-world-core.js');
require('../WebApp/finance-core.js');

const F=global.GH_FINANCE_CORE,W=global.GH_BUSINESS_WORLD;
const state={
  simSeconds:0,
  profile:{name:'Global Holdings Group',founder:'Founder',hq:'الرياض، المملكة العربية السعودية'},
  openedCompanies:['air'],
  companyRegistry:{air:{legalName:'GH Air'}},
  companyBudgets:{},finance:{},treasury:{accounts:[],ledger:[]},companyFinance:{},
  cash:0,debt:0,godMoney:false,infiniteMoney:false,businessWorld:{}
};
F.ensure(state);F.book(state,'group').accounts[0].balance=5000000;F.book(state,'air').accounts[0].balance=5000000;F.reconcile(state);
W.syncWorld(state,{suppliers:[{id:'MRO',name:'AeroMRO Global Services',legalName:'AeroMRO Global Services Ltd.',sector:'air',service:'MRO'}],customers:[{name:'Nova Devices',sector:'air',industry:'إلكترونيات'}]});
const supplier=W.resolveParty(state,W.partyIdForName(state,'AeroMRO Global Services Ltd.','supplier'));

// Standalone cheque issuance must not move cash. It may later clear or bounce.
const groupBefore=F.operating(state,'group');
const manual=F.execute({state},'issue-cheque',{company:'group',amount:750000,beneficiary:supplier.legalName,note:'دفعة عقد صيانة',dueDay:0});
assert.strictEqual(manual.status,'صادر');
assert.strictEqual(F.operating(state,'group'),groupBefore,'issuing a cheque moved cash before clearing');
assert.strictEqual(manual.purposeCategory,'دفعة تجارية بالشيك');
const manualSettle=F.execute({state},'settle-cheque',{id:manual.id});
assert.strictEqual(manualSettle.settled,true);
assert.strictEqual(F.operating(state,'group'),groupBefore-750000,'clearing cheque did not debit exact amount');
const manualLedger=state.treasury.ledger.find(row=>row.reference===manual.id);
assert(manualLedger&&manualLedger.paymentMethod==='شيك مصرفي'&&manualLedger.purposeCategory==='دفعة تجارية بالشيك','cheque settlement lost purpose/method metadata');

// A supplier payable can be paid by cheque without clearing the payable until cheque settlement.
const payable=F.execute({state},'accrue-expense',{company:'air',amount:250000,note:'صيانة محركات دورية',method:'قيد مستحق',taxable:false,counterparty:supplier.legalName,dueDay:3,number:'AIR-AP-001',line:'maintenance'});
const airBeforeCheque=F.operating(state,'air');
const issued=F.execute({state},'settle-payable',{number:payable.number,method:'cheque'});
assert.strictEqual(issued.method,'cheque');assert(issued.chequeId);
assert.strictEqual(F.operating(state,'air'),airBeforeCheque,'payable cheque issuance moved cash before clearing');
assert(state.finance.payables.some(row=>row.number===payable.number),'payable disappeared before cheque cleared');
assert.strictEqual(state.finance.invoices.find(row=>row.number===payable.number).status,'شيك صادر');
const issuedAgain=F.execute({state},'settle-payable',{number:payable.number,method:'cheque'});
assert.strictEqual(issuedAgain.chequeId,issued.chequeId,'same payable issued duplicate outstanding cheque');
assert.strictEqual(state.finance.cheques.filter(row=>row.invoiceNumber===payable.number&&row.status==='صادر').length,1,'duplicate outstanding payable cheque created');
const cleared=F.execute({state},'settle-cheque',{id:issued.chequeId});
assert.strictEqual(cleared.settled,true);
assert.strictEqual(F.operating(state,'air'),airBeforeCheque-250000,'payable cheque clear did not debit account');
assert(!state.finance.payables.some(row=>row.number===payable.number),'payable remained after cheque cleared');
assert.strictEqual(state.finance.invoices.find(row=>row.number===payable.number).status,'مسددة');

// A different payable still supports bank-transfer settlement with full reason and balance trace.
const transferPayable=F.execute({state},'accrue-expense',{company:'air',amount:100000,note:'خدمات مناولة أرضية',method:'قيد مستحق',taxable:false,counterparty:'GroundLink Services Ltd.',dueDay:4,number:'AIR-AP-002',line:'other'});
const beforeTransfer=F.operating(state,'air');
const transferred=F.execute({state},'settle-payable',{number:transferPayable.number,method:'transfer'});
assert.strictEqual(transferred.method,'transfer');
assert.strictEqual(F.operating(state,'air'),beforeTransfer-100000);
const transferRow=state.finance.transfers.find(row=>row.documentNumber===transferPayable.number&&row.kind==='payable-settlement');
assert(transferRow,'supplier transfer settlement missing from transfer source of truth');
assert.strictEqual(transferRow.purposeCategory,'سداد ذمة مورد');
assert.strictEqual(transferRow.purposeDetail,'خدمات مناولة أرضية');
assert.strictEqual(transferRow.paymentMethod,'تحويل بنكي');
assert.strictEqual(transferRow.accountBalanceBefore,beforeTransfer);
assert.strictEqual(transferRow.accountBalanceAfter,beforeTransfer-100000);

// Revenue collection must record why cash arrived and the current-account balance transition.
const beforeRevenue=F.operating(state,'air');
const income=F.execute({state},'credit',{company:'air',amount:400000,note:'إيراد عقد شحن إلكترونيات',taxable:false,reference:'REV-AIR-001',counterparty:'Nova Devices',sourceRefs:['CONTRACT-K3']});
assert(income?.number);
const revenueTransfer=state.finance.transfers.find(row=>row.reference==='REV-AIR-001');
assert(revenueTransfer,'revenue collection transfer missing');
assert.strictEqual(revenueTransfer.purposeCategory,'تحصيل فاتورة/إيراد');
assert.strictEqual(revenueTransfer.purposeDetail,'إيراد عقد شحن إلكترونيات');
assert.strictEqual(revenueTransfer.accountBalanceBefore,beforeRevenue);
assert.strictEqual(revenueTransfer.accountBalanceAfter,beforeRevenue+400000);
assert(revenueTransfer.sourceRefs.includes('CONTRACT-K3'));

// Daily operating settlement exposes gross -> deductions -> net -> account movement.
const beforeDaily=F.operating(state,'air');
const daily=F.execute({state},'settle-daily-cash',{company:'air',amount:180000,grossAmount:250000,deductions:70000,tripCount:12,invoiceNumbers:[],day:1,reference:'DAY-CASH-air-1',note:'تحويل صافي تشغيل اليوم 1 إلى الحساب الجاري · الطيران'});
assert.strictEqual(daily.balanceBefore,beforeDaily);
assert.strictEqual(daily.balanceAfter,beforeDaily+180000);
const dailyTransfer=state.finance.transfers.find(row=>row.reference==='DAY-CASH-air-1');
assert.strictEqual(dailyTransfer.purposeCategory,'وصول صافي التشغيل للحساب الجاري');
assert.strictEqual(dailyTransfer.grossAmount,250000);
assert.strictEqual(dailyTransfer.deductions,70000);
assert.strictEqual(dailyTransfer.netAmount,180000);
assert.strictEqual(dailyTransfer.tripCount,12);

console.log('BUILD317 finance depth: PASS — issue-only cheques, cheque/transfer payable choice, transfer purpose audit, revenue/current-account trace');
