'use strict';
const assert = require('assert');
const {harness, minimal} = require('./helpers/core-harness');
const results = [];
function check(name, fn) { try { fn(); results.push({name, pass: true}); } catch (e) { results.push({name, pass: false, error: e.message}); } }
check('settled cheque has explicit success and cannot double debit', () => {
  const {s} = harness(['finance-core']); const state = minimal(), f = s.GH_FINANCE_CORE;
  const ch = f.execute(state, 'issue-cheque', {company: 'group', amount: 100, beneficiary: 'Supplier'});
  const out = f.execute(state, 'settle-cheque', {id: ch.id});
  assert.strictEqual(out.settled, true); assert.strictEqual(out.status, 'settled');
  const cash = state.cash, count = state.finance.journalEntries.length;
  assert(f.execute(state, 'settle-cheque', {id: ch.id}).settled);
  assert.strictEqual(state.cash, cash); assert.strictEqual(state.finance.journalEntries.length, count);
});
check('bounced cheque has explicit failure and preserves cash', () => {
  const {s} = harness(['finance-core']); const state = minimal(), f = s.GH_FINANCE_CORE;
  const ch = f.execute(state, 'issue-cheque', {amount: 100, beneficiary: 'Supplier'});
  f.execute(state, 'transfer', {from: 'group', to: 'air', amount: 999950});
  const out = f.execute(state, 'settle-cheque', {id: ch.id});
  assert.strictEqual(out.settled, false); assert.strictEqual(out.status, 'bounced');
  assert.strictEqual(state.cash, 1000000);
});
check('future schema is rejected without relabelling', () => {
  const {s} = harness(['save-schema']); const state = minimal(); state.saveVersion = '99.0.0';
  assert.throws(() => s.GH_SAVE_SCHEMA.normalize(state, {})); assert.strictEqual(state.saveVersion, '99.0.0');
});
check('malformed current save never becomes a default save', () => {
  const {s, data} = harness(['save-schema', 'persistence-core', 'migration-core']);
  data.set('main', '{broken');
  assert.throws(() => s.GH_MIGRATION_CORE.load({defaultState: minimal(), storageKey: 'main', saveSchema: s.GH_SAVE_SCHEMA}));
  assert.strictEqual(data.get('main'), '{broken');
});
check('legacy quota failure retains original bytes', () => {
  const {s, data, storage} = harness(['save-schema', 'persistence-core', 'migration-core']);
  const raw = JSON.stringify(minimal()); data.set('old', raw);
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => s.GH_MIGRATION_CORE.load({defaultState: minimal(), storageKey: 'main', legacyStorageKeys: ['old'], saveSchema: s.GH_SAVE_SCHEMA}));
  assert.strictEqual(data.get('old'), raw); assert(!data.has('main'));
});
check('facility cannot fabricate staff when HR is absent', () => {
  const {s} = harness(['transaction-core', 'domain-command-core', 'finance-core', 'facility-core']);
  const state = minimal(); state.globalBases.push({id: 'B', name: 'Base', kind: 'airport-base', company: 'air', owned: true});
  s.GH_FINANCE_CORE.ensure(state); s.GH_FINANCE_CORE.execute(state, 'transfer', {from: 'group', to: 'air', amount: 600000});
  const before = state.cash;
  assert.throws(() => s.GH_DOMAIN_COMMANDS.dispatch({state}, 'facilities', 'hire', {id: 'B'}));
  assert.strictEqual(state.cash, before); assert.strictEqual(state.advanced.facilities?.B?.staff || 0, 0);
});
check('HR hires only approved facility deficit and repeat is a no-op', () => {
  const {s} = harness(['transaction-core', 'domain-command-core', 'finance-core', 'hr-core', 'facility-core']);
  const state = minimal(); state.globalBases.push({id: 'B', name: 'Base', kind: 'airport-base', company: 'air', owned: true});
  s.GH_FINANCE_CORE.execute(state, 'transfer', {from: 'group', to: 'air', amount: 600000});
  const one = s.GH_DOMAIN_COMMANDS.dispatch({state}, 'facilities', 'hire', {id: 'B'});
  assert(one.ok); assert.strictEqual(state.advanced.facilities.B.staff, 36);
  const cash = state.cash;
  s.GH_DOMAIN_COMMANDS.dispatch({state}, 'facilities', 'hire', {id: 'B'});
  assert.strictEqual(state.advanced.facilities.B.staff, 36); assert.strictEqual(state.cash, cash);
});
check('nested domain call participates in the enclosing rollback', () => {
  const {s} = harness(['transaction-core', 'domain-command-core', 'finance-core']); const state = minimal();
  s.GH_FINANCE_CORE.ensure(state); const before = state.cash; let reached = false;
  assert.throws(() => s.GH_TRANSACTION_CORE.execute(state, {apply() {
    s.GH_DOMAIN_COMMANDS.dispatch({state}, 'finance', 'spend', {amount: 100, taxable: false}); reached = true;
    throw new Error('injected-after-finance');
  }}), /injected-after-finance/);
  assert(reached); assert.strictEqual(state.cash, before); assert.strictEqual(state.finance.journalEntries.length, 0);
});
check('idempotency is bounded, payload-bound and domain-scoped', () => {
  const {s} = harness(['transaction-core', 'domain-command-core']); const state = minimal();
  s.GH_DOMAIN_COMMANDS.register('sample', {execute(_ctx, _cmd, p) { return {amount: p.amount}; }});
  const call = (key, amount) => s.GH_DOMAIN_COMMANDS.dispatch({state}, 'sample', 'run', {amount}, {idempotencyKey: key});
  assert.strictEqual(call('same', 1).commandId, call('same', 1).commandId);
  assert.throws(() => call('same', 2), /idempotency/i);
  for (let i = 0; i < 600; i++) call('key-' + i, i);
  assert(Object.keys(state.domainRuntime.idempotency).length <= 512);
});
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.error ? ': ' + r.error : ''}`);
console.log(JSON.stringify({suite: 'BUILD251 correctness firewall', passed: results.filter(r => r.pass).length, total: results.length}));
if (results.some(r => !r.pass)) process.exitCode = 1;
