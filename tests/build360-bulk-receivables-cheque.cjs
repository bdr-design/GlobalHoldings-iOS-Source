'use strict';
// The owner asked for one button in "ذمم لنا" while preserving the existing collection flow.  This checks the finance
// command behind that button: one atomic command, one incoming cheque per legal drawer/company pair, and one cash move.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');
const {s,state,command}=scenario(),F=s.GH_FINANCE_CORE,P=s.GH_DOCUMENT_PROOF;
state.simSeconds=12*86400;
const beforeAir=F.operating(state,'air'),beforeGroup=F.operating(state,'group');
const documents=[
 command('finance','credit',{company:'air',amount:11500,note:'رحلة تعاقدية 1',counterparty:'عميل أطلس',reference:'B360-AR-1',termsDays:7}),
 command('finance','credit',{company:'air',amount:23000,note:'رحلة تعاقدية 2',counterparty:'عميل أطلس',reference:'B360-AR-2',termsDays:7}),
 command('finance','credit',{company:'group',amount:5750,note:'خدمة استشارية',counterparty:'عميل المدار',reference:'B360-AR-3',termsDays:7})
];
assert.equal(state.finance.receivables.length,3);
assert.equal(F.operating(state,'air'),beforeAir);assert.equal(F.operating(state,'group'),beforeGroup);

const result=command('finance','collect-receivables-by-cheque',{company:'all',numbers:documents.map(row=>row.number)});
assert.deepEqual(JSON.parse(JSON.stringify({count:result.count,cheques:result.cheques,amount:result.amount,companies:result.companies.sort()})),{count:3,cheques:2,amount:40250,companies:['air','group']});
assert.equal(F.operating(state,'air'),beforeAir+34500);assert.equal(F.operating(state,'group'),beforeGroup+5750);
assert.equal(state.finance.receivables.length,0);
const cheques=state.finance.cheques.filter(row=>result.chequeIds.includes(row.id));
assert.equal(cheques.length,2);assert.ok(cheques.every(row=>row.direction==='incoming'&&row.status==='محصل'&&row.paymentMethod==='شيك وارد'));
assert.deepEqual(JSON.parse(JSON.stringify(cheques.map(row=>row.invoiceNumbers.length).sort((a,b)=>a-b))),[1,2]);
assert.ok(cheques.every(row=>P.verifyDocument(state,row).ok),'every incoming cheque keeps a valid document proof');
for(const document of documents){const invoice=state.finance.invoices.find(row=>row.number===document.number);assert.equal(invoice.status,'محصلة');assert.equal(invoice.paymentMethod,'شيك وارد');assert.ok(invoice.collectionChequeId);assert.match(invoice.transferReference,/-DEP$/);assert.equal(P.verifyDocument(state,invoice).ok,true);}
assert.equal(state.finance.transfers.filter(row=>result.chequeIds.some(id=>row.reference===`${id}-DEP`)).length,2,'one deposit transfer per cheque');
const cashAfter={air:F.operating(state,'air'),group:F.operating(state,'group')},retry=command('finance','collect-receivables-by-cheque',{company:'all',numbers:documents.map(row=>row.number)});
assert.deepEqual(JSON.parse(JSON.stringify(retry)),{count:0,cheques:0,amount:0,companies:[]});
assert.deepEqual({air:F.operating(state,'air'),group:F.operating(state,'group')},cashAfter,'retry cannot add cash twice');
assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
console.log(JSON.stringify({suite:'build360-bulk-receivables-cheque',result,cashAfter}));
console.log('BUILD360_BULK_RECEIVABLES_CHEQUE_PASS');
