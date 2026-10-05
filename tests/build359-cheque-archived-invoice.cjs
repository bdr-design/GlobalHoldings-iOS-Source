'use strict';
// Build 359, iPhone diagnostic (2,515 invoices): paid invoices past the 2,500 live rows move to finance.auditArchive,
// while their cheques (62, under the 1,200 cap) stay live. The integrity check looked for a cheque's invoice in the
// live rows only and raised 13 critical "cheque link mismatch" issues for cheques whose invoice was simply archived.
// The archived invoice now counts; a real mismatch (other amount, other payee, no invoice anywhere) is still critical.
const assert=require('node:assert/strict');
const path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['integrity-core']),I=s.GH_INTEGRITY_CORE;
const invoice=(number,amount=500)=>({number,company:'group',counterparty:'مورد الوقود',total:amount,amount,status:'مدفوعة'});
const cheque=(id,invoiceNumber,amount=500,beneficiary='مورد الوقود')=>({id,invoiceNumber,company:'group',accountId:'GH-OPER-001',amount,beneficiary,status:'مصروف'});
const linkIssues=state=>Array.from(I.check(state).issues,row=>String(row.id)).filter(id=>id.startsWith("FINANCE_CHEQUE_LINK_MISMATCH_")).sort();
function scenario(){
  const state=minimal();
  state.finance.invoices=[invoice('AIR-000100')];
  state.finance.auditArchive={records:{invoices:[invoice('AIR-000007'),invoice('AIR-000008',900)]},digests:[]};
  state.finance.cheques=[cheque('AIR-CHQ-000007','AIR-000007'),cheque('AIR-CHQ-000100','AIR-000100')];
  return state;
}
// A cheque whose invoice was archived is linked, like a cheque whose invoice is live.
assert.deepEqual(linkIssues(scenario()),[]);
// Without an archive at all nothing changes.
{const state=scenario();delete state.finance.auditArchive;assert.deepEqual(linkIssues(state),['FINANCE_CHEQUE_LINK_MISMATCH_AIR-CHQ-000007']);}
// Real mismatches against an archived invoice are still critical: other amount, other payee, no invoice anywhere.
{const state=scenario();state.finance.cheques.push(cheque('AIR-CHQ-000008','AIR-000008',500),cheque('AIR-CHQ-000009','AIR-000007',500,'مستفيد آخر'),cheque('AIR-CHQ-000010','AIR-000999'));
  assert.deepEqual(linkIssues(state),['FINANCE_CHEQUE_LINK_MISMATCH_AIR-CHQ-000008','FINANCE_CHEQUE_LINK_MISMATCH_AIR-CHQ-000009','FINANCE_CHEQUE_LINK_MISMATCH_AIR-CHQ-000010']);
  assert.equal(I.check(state).issues.find(row=>row.id==='FINANCE_CHEQUE_LINK_MISMATCH_AIR-CHQ-000008').severity,'critical');}
// The live invoice wins over an archived copy with the same number.
{const state=scenario();state.finance.auditArchive.records.invoices.push(invoice('AIR-000100',1));assert.deepEqual(linkIssues(state),[]);}
console.log('build359 cheque archived invoice: 4 checks passed');
