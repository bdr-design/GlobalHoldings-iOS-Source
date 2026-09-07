const assert=require('assert');
global.window=global;global.GH_LIFECYCLE_CORE={validate:()=>true};global.GH_DEPENDENCY_CORE={detectCycles:()=>[],unresolved:()=>[]};
const core=require('../WebApp/integrity-core.js');
function base(){return {simSeconds:0,cash:150,companyFinance:{group:{accounts:[{id:'G1',balance:100}],debt:0,taxPayable:0,taxPaid:0},air:{accounts:[{id:'A1',balance:50}],debt:0,taxPayable:0,taxPaid:0}},finance:{invoices:[],cheques:[],payables:[],receivables:[]},treasury:{ledger:[]},assets:[],advanced:{procurement:{assetRequests:[],assetRequestArchive:[]},ai:{requests:[],requestArchive:[]}},realism:{procurement:{deliveries:[]}},businessLedger:{events:[]}}}
let s=base(),r=core.check(s);assert.strictEqual(r.status,'healthy');
s=base();s.cash=999;r=core.check(s);assert.ok(r.issues.some(x=>x.id==='FINANCE_CONSOLIDATED_CASH_MISMATCH'));
s=base();s.finance.cheques=[{id:'C1',accountId:'G1',amount:10,status:'صادر'}];r=core.check(s);assert.ok(r.issues.some(x=>x.id==='FINANCE_CHEQUE_BENEFICIARY_C1'));
s=base();s.finance.invoices=[{number:'I1'},{number:'I1'}];r=core.check(s);assert.ok(r.issues.some(x=>x.id==='FINANCE_INVOICE_DUP_I1'));
console.log('finance-integrity-2.3.9: PASS');
