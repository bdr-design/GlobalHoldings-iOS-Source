'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const taskRoot = path.resolve(__dirname, '..');
function load(kind, sourceRoot) {
  const fixedDate = class extends Date { static now() { return 1_800_000_000_000; } };
  const context = { Number, String, Math, Date: fixedDate, Object, Array, Set, Map, Error };
  context.globalThis = context; context.window = context; vm.createContext(context);
  if (kind === 'lifecycle') vm.runInContext(fs.readFileSync(path.join(sourceRoot, 'WebApp/event-ledger-core.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(sourceRoot, `WebApp/${kind}-core.js`), 'utf8'), context);
  return { api: context[`GH_${kind.toUpperCase()}_CORE`], event: context.GH_EVENT_LEDGER };
}
const oldRoot = path.join(taskRoot, 'BUILD339_REFERENCE');
const newRoot = path.join(taskRoot, 'BUILD340_REWRITE_WORKSPACE');
const same = (a, b, label) => assert.equal(JSON.stringify(a), JSON.stringify(b), label);

for (const kind of ['event-ledger', 'lifecycle', 'policy']) {
  const old = load(kind, oldRoot), fresh = load(kind, newRoot);
  const exportName = kind === 'event-ledger' ? 'GH_EVENT_LEDGER' : kind === 'lifecycle' ? 'GH_LIFECYCLE_CORE' : 'GH_POLICY_CORE';
  const oldApi = old.api || old.event, newApi = fresh.api || fresh.event;
  assert.deepEqual(Object.keys(newApi).sort(), Object.keys(oldApi).sort(), `${kind} API changed`);
  if (kind === 'event-ledger') {
    const a = { simSeconds: 99 }, b = { simSeconds: 99 };
    for (let i = 0; i < 600; i += 1) {
      const event = { type: `T${i % 7}`, domain: `D${i % 5}`, entityType: `asset-${i % 4}`, entityId: i % 3 ? `A${i % 11}` : null, correlationId: i % 4 ? `C${i % 9}` : null, actor: i % 2 ? 'player' : '', detail: i % 3 ? { sequence: i, nested: [i % 2, 'x'] } : i };
      same(fresh.event.append(b, event), old.event.append(a, event), `event ${i}`);
      if (i % 13 === 0) { same(fresh.event.forEntity(b, 'asset-2', `A${i % 11}`, 20), old.event.forEntity(a, 'asset-2', `A${i % 11}`, 20), 'entity history'); same(fresh.event.forCorrelation(b, `C${i % 9}`), old.event.forCorrelation(a, `C${i % 9}`), 'correlation history'); }
      same(b, a, `event ledger state ${i}`);
    }
    same(fresh.event.summary(b), old.event.summary(a), 'event ledger summary');
  } else if (kind === 'lifecycle') {
    const scenarios = [
      { entity: { id: 'D-1', status: 'pending', correlationId: 'C-9' }, target: 'delivered', meta: { actor: 'player', reason: 'accepted', detail: { from: 'overridden', evidence: 'P-1' } } },
      { entity: { id: 'D-2', status: 'pending' }, target: 'cancelled', meta: {} },
      { entity: { id: 'D-3', status: 'delivered' }, target: 'delivered', meta: {} },
      { entity: { id: 'D-4', status: 'unknown' }, target: 'pending', meta: {} },
      { entity: null, target: 'cancelled', meta: {} }
    ];
    for (const input of scenarios) {
      const a = { simSeconds: 99 }, b = { simSeconds: 99 }, ea = input.entity && structuredClone(input.entity), eb = input.entity && structuredClone(input.entity);
      const outcome = fn => { try { return { value: fn() }; } catch (error) { return { name: error.name, message: error.message }; } };
      same(outcome(() => old.api.transition(a, ea, 'deliveryOrder', input.target, input.meta)), outcome(() => fresh.api.transition(b, eb, 'deliveryOrder', input.target, input.meta)), 'transition result');
      same({ state: a, entity: ea }, { state: b, entity: eb }, 'transition effects and event');
    }
    for (const status of ['pending', 'delivered', 'cancelled', 'open', null]) assert.equal(fresh.api.validate('deliveryOrder', status), old.api.validate('deliveryOrder', status));
  } else {
    const facts = [
      {}, { item: true, base: true, qty: 3, freeCapacity: 4, fundingGap: 0 },
      { item: true, base: true, qty: 2.5, freeCapacity: 8, fundingGap: -10 },
      { base: true, qty: '4', freeCapacity: '3', fundingGap: NaN },
      { base: false, payment: true, asset: true }, { base: true, payment: true, asset: true }
    ];
    for (const input of facts) {
      same(fresh.api.procurement(input), old.api.procurement(input), `procurement ${JSON.stringify(input)}`);
      same(fresh.api.delivery(input), old.api.delivery(input), `delivery ${JSON.stringify(input)}`);
      same(fresh.api.evaluate('unknown', input), old.api.evaluate('unknown', input), 'unknown policy');
    }
  }
  assert.ok(exportName);
}
console.log(JSON.stringify({ suite: 'build340-lifecycle-event-policy-differential', passed: true, eventRows: 600, lifecycleCases: 5, policyProfiles: 6 }, null, 2));
