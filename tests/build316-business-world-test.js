'use strict';
const assert=require('assert');
global.window=global;
global.GH_DETERMINISM={nextFloat:()=>0.23};
require('../WebApp/business-world-core.js');
require('../WebApp/finance-core.js');
require('../WebApp/contracts-core.js');

const W=global.GH_BUSINESS_WORLD,F=global.GH_FINANCE_CORE,C=global.GH_CONTRACTS_CORE;
const state={
  simSeconds:0,
  profile:{name:'Global Holdings Group',founder:'Founder'},
  openedCompanies:['air'],
  companyRegistry:{air:{legalName:'GH Air'}},
  companyBudgets:{},finance:{},treasury:{accounts:[],ledger:[]},companyFinance:{},
  cash:0,debt:0,godMoney:false,infiniteMoney:false,
  contractRegistry:{},acceptedContracts:[],failedBids:[],contractStartDays:{},
  businessWorld:{}
};
F.ensure(state);
F.book(state,'group').accounts[0].balance=100000000;
F.book(state,'air').accounts[0].balance=100000000;
F.reconcile(state);

const first=W.syncWorld(state,{
  customers:[
    {name:'Nova Devices',sector:'air',industry:'إلكترونيات'},
    {name:'Nova Devices',sector:'air',industry:'إلكترونيات'}
  ],
  suppliers:[{id:'P1',name:'AeroMRO Global Services',legalName:'AeroMRO Global Services Ltd.',sector:'air',service:'MRO'}],
  competitors:[{id:'C6',name:'SkyBridge Cargo',sector:'طيران شحن — الخليج',sectors:['air'],hq:'دبي',marketShare:'4.9%',strategy:'شحن عالي القيمة'}],
  opportunities:[{id:'K3',name:'شحن جوي إلكترونيات عالي الأولوية',client:'Nova Devices',sector:'air',value:66000000,cost:44000000,termMonths:18,region:'الخليج/آسيا',sla:'99.0%',payment:'Net 14'}]
});
const nova=first.customers.find(x=>x.displayName==='Nova Devices');
assert(nova,'Nova customer party missing');
assert.strictEqual(first.customers.filter(x=>x.displayName==='Nova Devices').length,1,'same legal customer duplicated');
assert.strictEqual(W.partyIdForName(state,'عميل تعاقدي مسجل','customer'),null,'generic placeholder became a party');

const lost=C.execute({state},'bid',{id:'K-LOST',won:false,client:'Nova Devices',sector:'air',title:'عقد تجريبي',competitorId:'COMP-C6',competitorName:'SkyBridge Cargo'});
assert.strictEqual(lost.won,false);
assert.strictEqual(W.snapshot(state).events[0].title.includes('SkyBridge Cargo'),true,'lost bid did not preserve named competitor');

const won=C.execute({state},'bid',{id:'K3',won:true,number:'GH-CN-0003',client:'Nova Devices',sector:'air',title:'شحن جوي إلكترونيات عالي الأولوية',value:66000000,termMonths:18});
assert.strictEqual(won.record.clientPartyId,nova.id,'contract award lost customer identity');
const cashBeforeSign=F.operating(state,'air');
const signed=C.execute({state},'sign',{id:'K3',company:'air',sector:'air',deposit:1000000,name:'شحن جوي إلكترونيات عالي الأولوية',client:'Nova Devices',value:66000000,termMonths:18,taxable:false});
assert.strictEqual(signed.status,'نشط');
assert.strictEqual(signed.clientPartyId,nova.id);
assert.strictEqual(F.operating(state,'air'),cashBeforeSign+1000000,'contract deposit did not reach company current account');

const depositInvoice=state.finance.invoices.find(x=>x.sourceRef==='RCPT-air-1'||x.counterpartyPartyId===nova.id&&x.kind==='دخل');
assert(depositInvoice,'contract deposit invoice missing');
assert.strictEqual(depositInvoice.counterpartyPartyId,nova.id,'invoice did not preserve customer Party ID');
const depositTransfer=state.finance.transfers.find(x=>x.fromPartyId===nova.id&&x.company==='air');
assert(depositTransfer,'incoming collection did not preserve remitter Party ID');
const customer=W.customerSnapshot(state,nova.id);
assert(customer.totalBilled>=1000000,'customer 360 missing billed revenue');
assert(customer.received>=1000000,'customer 360 missing received cash');
assert(customer.contracts.some(x=>x.id==='K3'&&x.status==='نشط'),'customer 360 missing active contract');

const supplier=W.resolveParty(state,W.partyIdForName(state,'AeroMRO Global Services Ltd.','supplier'));
assert(supplier,'supplier party missing');
const expense=F.execute({state},'accrue-expense',{company:'air',amount:50000,note:'صيانة مستحقة',method:'تحويل بنكي',taxable:false,counterparty:supplier.legalName,dueDay:1,number:'AIR-MRO-001',line:'maintenance'});
assert.strictEqual(expense.counterpartyPartyId,supplier.id);
F.execute({state},'settle-payable',{number:'AIR-MRO-001'});
const payableTransfer=state.treasury.ledger.find(x=>x.documentNumber==='AIR-MRO-001'&&x.status==='منفذة');
assert(payableTransfer,'settled payable transfer missing');
assert.strictEqual(payableTransfer.toPartyId,supplier.id,'settled payable lost beneficiary Party ID');

const chequePayment=F.execute({state},'pay-by-cheque',{company:'air',amount:60000,note:'صيانة فورية',beneficiary:supplier.legalName,taxable:false,line:'maintenance'});
assert.strictEqual(chequePayment.cheque.beneficiaryPartyId,supplier.id,'cheque lost beneficiary Party ID');
assert(state.treasury.ledger.some(x=>x.reference===chequePayment.cheque.id&&x.toPartyId===supplier.id),'settled cheque ledger lost beneficiary Party ID');

const sponsor=W.snapshot(state).sponsorships.find(x=>x.id==='SPON-AERO-001');
assert(sponsor&&sponsor.status==='عرض متاح','sponsorship seed missing');
const sponsorCashBefore=F.operating(state,'air');
W.execute({state},'accept-sponsorship',{id:sponsor.id,company:'air'});
assert.strictEqual(F.operating(state,'air'),sponsorCashBefore,'accepting sponsorship incorrectly credited cash before billing');
const day0=W.execute({state},'tick-day',{day:0});
const sponsorCashAfterFirst=F.operating(state,'air');
assert(day0.sponsorshipRevenue>0&&sponsorCashAfterFirst>sponsorCashBefore,'accepted sponsorship did not bill at contractual cycle');
const day0Repeat=W.execute({state},'tick-day',{day:0});
assert.strictEqual(day0Repeat.sponsorshipRevenue,0,'same day sponsorship billing was not idempotent');
assert.strictEqual(F.operating(state,'air'),sponsorCashAfterFirst,'same day sponsorship billing duplicated cash');

const campaignCashBefore=F.operating(state,'air');
const campaign=W.execute({state},'launch-campaign',{company:'air',channel:'digital',budget:1000000,days:30});
assert.strictEqual(F.operating(state,'air'),campaignCashBefore-1000000,'manual campaign did not debit exact budget once');
assert(campaign.impressions>0&&campaign.reach>0&&campaign.frequency>0,'campaign measurement fields missing');
assert.strictEqual(campaign.status,'نشطة');

state.simSeconds=7*86400;
const rivalCount=W.snapshot(state).competitorActivity.length;
W.execute({state},'tick-day',{day:7});
const afterRival=W.snapshot(state).competitorActivity.length;
assert.strictEqual(afterRival,rivalCount+1,'weekly competitor event missing');
W.execute({state},'tick-day',{day:7});
assert.strictEqual(W.snapshot(state).competitorActivity.length,afterRival,'weekly competitor event duplicated on same week');

state.simSeconds=30*86400;
const endCampaign=W.execute({state},'tick-day',{day:30});
assert(endCampaign.completedCampaigns>=1,'campaign lifecycle did not complete at end day');
assert.strictEqual(W.snapshot(state).campaigns.find(x=>x.id===campaign.id).status,'مكتملة');

const snapshot=W.snapshot(state);
assert(snapshot.events.length<=240&&snapshot.competitorActivity.length<=120&&snapshot.opportunities.length<=120,'bounded-growth invariant violated');
assert.strictEqual(snapshot.parties.filter(x=>x.id===nova.id).length,1,'Party single source of truth violated');

console.log('BUILD316 business world: PASS — stable parties, named bid rivals, contract→invoice→transfer identity, customer 360, sponsorship idempotency, manual marketing, bounded weekly competitor events');

// CI trigger branch only; production logic is identical to build316-business-world.
