'use strict';
const assert=require('assert');
const {harness,minimal}=require('./helpers/core-harness');

const {s,load}=harness();
load('finance-core');
const state=minimal();
s.GH_FINANCE_CORE.execute({state},'ensure');

// Close a period containing a large invoice, then post a new invoice. The
// current tax liability must represent the open period only.
s.GH_FINANCE_CORE.invoice(state,{company:'mobility',kind:'دخل',amount:100000,note:'اختبار فترة مقفلة',taxable:true,status:'محصلة'});
const closed=s.GH_FINANCE_CORE.execute({state},'close-vat-period',{day:30}).find(x=>x.company==='mobility');
assert.strictEqual(closed.amount,13043,'the closed period must contain the first invoice VAT');
assert.strictEqual(state.companyFinance.mobility.taxPayable,13043,'closing must carry only the closed period liability');

s.GH_FINANCE_CORE.invoice(state,{company:'mobility',kind:'دخل',amount:1000,note:'اختبار فاتورة الفترة الجديدة',taxable:true,status:'محصلة'});
assert.strictEqual(state.companyFinance.mobility.taxPayable,130,'new invoices must not resurrect closed-period VAT');
assert.strictEqual(state.finance.taxPayable,130,'consolidated VAT must match the open period after the fix');

console.log('Finance VAT period regression BUILD257: PASS');
