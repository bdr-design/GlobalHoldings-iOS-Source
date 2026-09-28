'use strict';

const assert = require('node:assert/strict');
const { harness, minimal } = require('./helpers/core-harness');

const { s } = harness(['clone-core', 'kernel-core', 'transaction-core', 'finance-core']);
const finance = s.GH_FINANCE_CORE;
const transactions = s.GH_TRANSACTION_CORE;
const plain = minimal();
finance.ensure(plain);
const state = transactions.enableKernelOwner(plain);

// A reconciliation with no changed totals must not invalidate a prepared
// simulation slice or add undo records to the kernel's transaction journal.
finance.reconcile(state);
const settled = {
  cash: state.cash,
  debt: state.debt,
  taxPayable: state.finance.taxPayable,
  taxPaid: state.finance.taxPaid
};
const before = transactions.revision(state);
const beforeInput = transactions.inputRevision(state);
const beforeWrites = transactions.kernelOwnerStatus(state).transactions;
assert.equal(finance.reconcile(state), settled.cash);
assert.equal(transactions.revision(state), before);
assert.equal(transactions.inputRevision(state), beforeInput);
assert.equal(transactions.kernelOwnerStatus(state).transactions, beforeWrites);

const noop = transactions.execute(state, {
  label: 'finance:reconcile-noop',
  apply: () => finance.reconcile(state)
});
assert.equal(noop.committed, true);
assert.equal(transactions.revision(state), before);
assert.equal(transactions.inputRevision(state), beforeInput);
assert.deepEqual(Array.from(transactions.kernelOwnerStatus(state).lastCommit.dirty), []);

const account = finance.book(state, 'group').accounts[0];
account.balance += 250;
const beforeChangedBalance = transactions.revision(state);
assert.equal(finance.reconcile(state), settled.cash + 250);
assert.equal(transactions.revision(state), beforeChangedBalance + 1);
assert.equal(transactions.inputRevision(state), beforeInput + 2);
assert.equal(state.debt, settled.debt);
assert.equal(state.finance.taxPayable, settled.taxPayable);
assert.equal(state.finance.taxPaid, settled.taxPaid);
assert.deepEqual(Array.from(transactions.kernelOwnerStatus(state).lastCommit.dirty), ['cash']);

// Preserve numeric normalization even if an imported state stores a number
// as text, and continue to reject invalid account balances without writes.
state.cash = String(state.cash);
const normalizedAt = transactions.revision(state);
finance.reconcile(state);
assert.equal(typeof state.cash, 'number');
assert.equal(transactions.revision(state), normalizedAt + 1);

const rollbackAt = transactions.revision(state);
assert.throws(() => transactions.execute(state, {
  label: 'finance:reconcile-invalid-balance',
  apply() {
    account.balance = -1;
    finance.reconcile(state);
  }
}), /invalid-account-balance:group/);
assert.equal(account.balance, 1000250);
assert.equal(state.cash, settled.cash + 250);
assert.equal(transactions.revision(state), rollbackAt);

console.log('PASS finance reconciliation: no-op has zero dirty roots; changed balance updates cash; normalization and rollback retained');
