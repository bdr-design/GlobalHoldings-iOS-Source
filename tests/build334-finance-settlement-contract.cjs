'use strict';

const assert = require('assert/strict');
const path = require('path');

process.env.GH_TEST_SOURCE_DIR = path.resolve(__dirname, '..');
const {harness, minimal} = require('./helpers/core-harness');
const {s} = harness(['finance-core', 'integrity-core']);
const Finance = s.GH_FINANCE_CORE;

function fresh() {
  const state = minimal();
  state.profile = {name: 'Build 334 Audit Group', founder: 'Audit Founder'};
  state.openedCompanies = ['air', 'sea', 'road', 'power', 'bank', 'mobility'];
  Finance.ensure(state);
  return state;
}

const run = (state, command, payload = {}) => Finance.execute({state}, command, payload);
const due = (state, company = 'group') => state.finance.periods
  .filter(row => (row.company || 'group') === company && row.status === 'مستحق')
  .reduce((sum, row) => sum + Number(row.amount || 0), 0);
const defects = [];
const check = (condition, id, evidence) => {
  if (!condition) defects.push({id, evidence});
};

const tax = fresh();
run(tax, 'credit', {company: 'group', amount: 2300, note: 'VAT period one', taxable: true, reference: 'B334-VAT-1'});
run(tax, 'close-vat-period', {day: 30});
check(due(tax) === 300 && Finance.book(tax, 'group').taxPayable === 300,
  'VAT_FIRST_CLOSE_BALANCE', {due: due(tax), book: Finance.book(tax, 'group').taxPayable});

run(tax, 'credit', {company: 'group', amount: 1150, note: 'VAT period two', taxable: true, reference: 'B334-VAT-2'});
check(Finance.book(tax, 'group').taxPayable === due(tax),
  'VAT_OPEN_ACCRUAL_OVERWRITES_FORMAL_DUE', {due: due(tax), book: Finance.book(tax, 'group').taxPayable});

run(tax, 'close-vat-period', {day: 58});
check(due(tax) === 450 && Finance.book(tax, 'group').taxPayable === 450,
  'VAT_SECOND_CLOSE_DROPS_PRIOR_DUE_FROM_BOOK', {due: due(tax), book: Finance.book(tax, 'group').taxPayable});

const integrity = s.GH_INTEGRITY_CORE.check(tax);
check(!integrity.issues.some(issue => issue.id === 'FINANCE_TAX_PAYABLE_MISMATCH_group'),
  'VAT_STATE_FAILS_OWN_INTEGRITY_CHECK', integrity.issues.filter(issue => issue.id === 'FINANCE_TAX_PAYABLE_MISMATCH_group'));

run(tax, 'close-vat-period', {day: 58});
const duplicatePeriodIds = tax.finance.periods
  .map(row => row.id)
  .filter((id, index, all) => all.indexOf(id) !== index);
check(duplicatePeriodIds.length === 0,
  'VAT_CLOSE_NOT_IDEMPOTENT', {duplicatePeriodIds, due: due(tax), book: Finance.book(tax, 'group').taxPayable});

const december = fresh();
run(december, 'close-vat-period', {day: 364});
const decemberPeriod = december.finance.periods.find(row => row.company === 'group');
check(!/13/.test(String(decemberPeriod.period)) && Finance.calendarMonthForDay(364) === '2026-12',
  'VAT_PERIOD_LABEL_NOT_GREGORIAN', {day: 364, period: decemberPeriod.period, calendarMonth: Finance.calendarMonthForDay(364)});

const debt = fresh();
run(debt, 'raise-debt', {company: 'group', amount: 1000, ref: 'B334-DEBT'});
run(debt, 'repay-debt', {company: 'group', amount: 100, ref: 'B334-DEBT-PAY'});
const debtAfterFirst = Finance.book(debt, 'group').debt;
let debtRetryRejected = false;
try { run(debt, 'repay-debt', {company: 'group', amount: 100, ref: 'B334-DEBT-PAY'}); }
catch (_error) { debtRetryRejected = true; }
check(debtRetryRejected || Finance.book(debt, 'group').debt === debtAfterFirst,
  'DEBT_REPAYMENT_REFERENCE_DOUBLE_POSTS', {
    debtAfterFirst,
    debtAfterRetry: Finance.book(debt, 'group').debt,
    settlements: debt.finance.debtSettlements.filter(row => row.reference === 'B334-DEBT-PAY').length
  });

const interest = fresh();
run(interest, 'transfer', {from: 'group', to: 'air', amount: 1000, ref: 'B334-FUND-AIR'});
run(interest, 'settle-intercompany-interest', {from: 'air', amount: 100, ref: 'B334-INT'});
let interestConflictRejected = false;
try { run(interest, 'settle-intercompany-interest', {from: 'air', amount: 200, ref: 'B334-INT'}); }
catch (_error) { interestConflictRejected = true; }
check(interestConflictRejected, 'INTERCOMPANY_INTEREST_REFERENCE_CONFLICT_SILENT', {
  retryAccepted: !interestConflictRejected,
  matchingTransfers: interest.finance.transfers.filter(row => row.reference === 'B334-INT').length
});

const payroll = fresh();
run(payroll, 'transfer', {from: 'group', to: 'air', amount: 1000, ref: 'B334-PAY-FUND'});
run(payroll, 'pay-payroll', {company: 'group', amount: 100, reportId: 'B334-PAY-G', reference: 'B334-PAY'});
let payrollConflictRejected = false;
try { run(payroll, 'pay-payroll', {company: 'air', amount: 200, reportId: 'B334-PAY-A', reference: 'B334-PAY'}); }
catch (_error) { payrollConflictRejected = true; }
check(payrollConflictRejected, 'PAYROLL_REFERENCE_CONFLICT_SILENT', {
  retryAccepted: !payrollConflictRejected,
  groupInvoices: payroll.finance.invoices.filter(row => row.company === 'group' && row.payrollReportId === 'B334-PAY-G').length,
  airInvoices: payroll.finance.invoices.filter(row => row.company === 'air' && row.payrollReportId === 'B334-PAY-A').length
});

const loan = fresh();
run(loan, 'issue-intercompany-loan', {id: 'B334-LOAN', lender: 'group', borrower: 'air', amount: 1000});
let loanConflictRejected = false;
try { run(loan, 'issue-intercompany-loan', {id: 'B334-LOAN', lender: 'group', borrower: 'sea', amount: 2000}); }
catch (_error) { loanConflictRejected = true; }
check(loanConflictRejected, 'INTERCOMPANY_LOAN_ID_CONFLICT_SILENT', {
  retryAccepted: !loanConflictRejected,
  stored: loan.finance.intercompanyLoans.find(row => row.id === 'B334-LOAN')
});

const withdrawal = fresh();
const available = Finance.operating(withdrawal, 'group');
let withdrawalRejected = false;
let withdrawalResult = null;
try { withdrawalResult = run(withdrawal, 'founder-withdrawal', {company: 'group', amount: available + 1, ref: 'B334-WITHDRAW'}); }
catch (_error) { withdrawalRejected = true; }
check(withdrawalRejected && Finance.operating(withdrawal, 'group') === available,
  'FOUNDER_WITHDRAWAL_PARTIAL_SUCCESS', {
    available,
    requested: available + 1,
    rejected: withdrawalRejected,
    result: withdrawalResult,
    balanceAfter: Finance.operating(withdrawal, 'group')
  });

const result = {passed: defects.length === 0, defectCount: defects.length, defects};
console.log(JSON.stringify(result, null, 2));
assert.deepEqual(defects, [], `${defects.length} finance/settlement contract defects reproduced`);

