'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {harness, minimal} = require('./helpers/core-harness');

const results = [];
function test(name, fn) {
  try {
    const detail = fn();
    results.push({name, ok: true, detail: detail ?? null});
  } catch (error) {
    results.push({name, ok: false, error: String(error?.stack || error)});
  }
}

function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function lastTiming(tx) {
  return tx.telemetry().last || {};
}
function activeTiming(tx) {
  return tx.telemetry().active || {};
}

// Phase 1C telemetry contract. This intentionally does not exist in Phase 1B-B yet.
// Tests use it to distinguish a real sparse-journal execution from the legacy snapshot path.
function requirePhase1CTiming(tx, expectedMode) {
  const timing = lastTiming(tx);
  assert.ok(
    ['journal', 'full-snapshot'].includes(timing.rollbackStorage),
    'PHASE1C_RED: transaction telemetry must expose rollbackStorage=journal|full-snapshot before journal activation'
  );
  if (expectedMode) assert.equal(timing.rollbackStorage, expectedMode);
  return timing;
}

const ASSET_FIELDS = ['phase','dwellRemaining','reverse','progress','fuel','condition','from','to','load','baseFacility','lastTrip','routeId','routeSignature','routeSlot','departureScheduled','departureScheduledAt','releaseExclusiveRouteOnArrival','simCarrySeconds','lastTransitionGuardDay','crewBlocked','simulationFault'];

// 1. Unproven writer must force a full baseline BEFORE its callback executes.
test('test_unproven_writer_escalation', () => {
  const {s} = harness(['transaction-core']);
  const tx = s.GH_TRANSACTION_CORE;
  const state = {assets:[{id:'A',fuel:100}], outside:{value:7}};
  const before = JSON.stringify(state);
  let applySawFullBaseline = false;

  assert.throws(() => tx.execute(state, {
    label:'phase1c-unproven-writer',
    scope:['assets'],
    rollbackMode:'journal',
    writerContracts:[{owner:'legacy-unproven', proven:false}],
    apply() {
      // The future implementation must already have escalated before entering here.
      applySawFullBaseline = activeTiming(tx).rollbackStorage === 'full-snapshot';
      state.outside.value = 99;
      throw new Error('forced-after-unproven-write');
    }
  }), /forced-after-unproven-write/);

  assert.equal(JSON.stringify(state), before, 'unproven writer rollback must restore every root');
  assert.equal(applySawFullBaseline, true, 'Full Snapshot fallback must exist before the first unproven write');
  const timing = requirePhase1CTiming(tx, 'full-snapshot');
  assert.match(String(timing.fallbackReason || ''), /unproven|writer/i);
  return timing;
});

// 2. A scoped owner joined by an unproven nested writer must promote before joined apply.
test('test_joined_transaction_escalation', () => {
  const {s} = harness(['transaction-core']);
  const tx = s.GH_TRANSACTION_CORE;
  const state = {assets:[{id:'A',fuel:100}], finance:{cash:10}, outside:{v:5}};
  const before = JSON.stringify(state);
  let joinedSawFullBaseline = false;

  assert.throws(() => tx.execute(state, {
    label:'phase1c-joined-escalation',
    scope:['assets','finance'],
    rollbackMode:'journal',
    writerContracts:[{owner:'simulation-assets', proven:true, root:'assets', mode:'asset-fields', fields:['fuel'], mayJoin:true},{owner:'simulation-finance', proven:true, roots:['finance']}],
    apply() {
      state.assets[0].fuel = 90;
      tx.join(state, {
        writerContract:{owner:'unknown-joined-writer', proven:false},
        apply() {
          joinedSawFullBaseline = activeTiming(tx).rollbackStorage === 'full-snapshot';
          state.outside.v = 8;
          state.newRoot = {x:1};
          throw new Error('joined-phase1c-fault');
        }
      });
    }
  }), /joined-phase1c-fault/);

  assert.equal(JSON.stringify(state), before, 'joined promotion must preserve byte-equivalent rollback');
  assert.equal(joinedSawFullBaseline, true, 'joined unproven writer must see full baseline before mutation');
  const timing = requirePhase1CTiming(tx, 'full-snapshot');
  return timing;
});

// 3. Validation is not assumed read-only. If it can mutate, rollback must include it.
test('test_validate_mutation_reversal', () => {
  const {s} = harness(['transaction-core']);
  const tx = s.GH_TRANSACTION_CORE;
  const state = {assets:[{id:'A',fuel:100}], validationSideEffect:{count:0}};
  const before = JSON.stringify(state);

  const outcome = tx.execute(state, {
    label:'phase1c-validate-mutation',
    scope:['assets'],
    rollbackMode:'journal',
    writerContracts:[{owner:'validation-control', proven:true, roots:['assets']}],
    validateContract:{readOnly:false, proven:false},
    validate() {
      state.validationSideEffect.count += 1;
      return {ok:false, reason:'forced-validation-reject'};
    },
    apply() { throw new Error('unreachable'); }
  });

  assert.equal(outcome.committed, false);
  assert.equal(JSON.stringify(state), before, 'validation mutation must be fully reversed');
  const timing = requirePhase1CTiming(tx, 'full-snapshot');
  assert.match(String(timing.fallbackReason || ''), /validate|validation/i);
  return timing;
});

// 4. Critical hook A mutates; critical hook B fails. A + apply must both roll back.
test('test_critical_hook_failure_reversal', () => {
  const {s} = harness(['transaction-core']);
  const tx = s.GH_TRANSACTION_CORE;
  const state = {assets:[{id:'A',fuel:100}], proofs:{count:0}, audit:{count:0}};
  const before = JSON.stringify(state);

  assert.throws(() => tx.execute(state, {
    label:'phase1c-critical-cascade',
    scope:['assets'],
    rollbackMode:'journal',
    writerContracts:[{owner:'asset-step', proven:true, root:'assets', mode:'asset-fields', fields:['fuel']}],
    apply() {
      state.assets[0].fuel = 80;
      tx.afterCommit(() => { state.proofs.count += 1; }, {
        critical:true, priority:10, key:'mutating-critical-a', owner:'test-a',
        writeContract:{proven:false, roots:['proofs']}
      });
      tx.afterCommit(() => { state.audit.count += 1; throw new Error('critical-b-fault'); }, {
        critical:true, priority:20, key:'failing-critical-b', owner:'test-b',
        writeContract:{proven:false, roots:['audit']}
      });
    }
  }), /critical-b-fault/);

  assert.equal(JSON.stringify(state), before, 'critical cascade failure must roll back apply and earlier critical mutations');
  const timing = requirePhase1CTiming(tx, 'full-snapshot');
  assert.match(String(timing.fallbackReason || ''), /critical|hook/i);
  return timing;
});

// 5. Safe primitive own data fields on existing asset keys are eligible for field-level journal.
test('test_field_level_undo_on_simulation_asset_fields', () => {
  const {s} = harness(['transaction-core']);
  const tx = s.GH_TRANSACTION_CORE;
  const asset = {id:'A',phase:'moving',progress:0.25,fuel:100,condition:95,tripSeconds:40,specs:{capacity:180}};
  const state = {assets:[asset], simSeconds:100, simulationKernel:{}};
  const before = JSON.stringify(state);

  assert.throws(() => tx.execute(state, {
    label:'phase1c-field-level',
    scope:['assets','simSeconds','simulationKernel'],
    rollbackMode:'journal',
    writerContracts:[{owner:'simulation-asset-fields', proven:true, root:'assets', mode:'asset-fields', fields:['fuel','progress']}],
    apply() {
      const fuelDesc = Object.getOwnPropertyDescriptor(asset,'fuel');
      const progressDesc = Object.getOwnPropertyDescriptor(asset,'progress');
      assert.ok(fuelDesc && 'value' in fuelDesc && progressDesc && 'value' in progressDesc);
      asset.fuel = 71;
      asset.progress = 0.8;
      state.simSeconds = 130;
      throw new Error('force-field-rollback');
    }
  }), /force-field-rollback/);

  assert.equal(JSON.stringify(state), before);
  const timing = requirePhase1CTiming(tx, 'journal');
  assert.equal(timing.fullSnapshotFallback, false);
  assert.ok(Number(timing.journalRecords) >= 2, 'field journal must record changed primitive fields');
  return timing;
});

// 6. Structural/object-valued asset mutation is never permitted to stay in field mode.
test('test_field_level_escalation_on_structural_mutation', () => {
  const {s} = harness(['transaction-core']);
  const tx = s.GH_TRANSACTION_CORE;
  const state = {assets:[{id:'A',fuel:100,progress:0.2,specs:{capacity:180}}], simSeconds:0};
  const before = JSON.stringify(state);
  let applySawFallback = false;

  assert.throws(() => tx.execute(state, {
    label:'phase1c-structural-escalation',
    scope:['assets','simSeconds'],
    rollbackMode:'journal',
    writerContracts:[{owner:'structural-asset-operation', proven:true, root:'assets', mode:'entity', structural:true}],
    apply() {
      applySawFallback = activeTiming(tx).rollbackStorage === 'full-snapshot';
      state.assets.push({id:'B',fuel:50,progress:0});
      delete state.assets[0].fuel;
      state.assets[0].specs = {capacity:999};
      throw new Error('force-structural-rollback');
    }
  }), /force-structural-rollback/);

  assert.equal(JSON.stringify(state), before);
  assert.equal(applySawFallback, true, 'structural contract must escalate before structural mutation starts');
  const timing = requirePhase1CTiming(tx, 'full-snapshot');
  assert.match(String(timing.fallbackReason || ''), /structural|entity|asset/i);
  return timing;
});

// 7. Journal rollback must be byte-equivalent, not merely deep-equal.
test('test_exact_byte_rollback_sha256', () => {
  const {s} = harness(['transaction-core']);
  const tx = s.GH_TRANSACTION_CORE;
  const state = {
    z:{v:1},
    assets:[{id:'A',phase:'moving',progress:0.1,fuel:100,condition:99}],
    simSeconds:3590,
    simulationKernel:{lastAtomicCommit:{from:0,to:3590}},
    a:{v:2}
  };
  const beforeJson = JSON.stringify(state);
  const beforeHash = sha(state);

  assert.throws(() => tx.execute(state, {
    label:'phase1c-byte-rollback',
    scope:['assets','simSeconds','simulationKernel'],
    rollbackMode:'journal',
    writerContracts:[{owner:'simulation-steady', proven:true, root:'assets', mode:'asset-fields', fields:['fuel','progress']}],
    apply() {
      state.assets[0].fuel = 33;
      state.assets[0].progress = 0.99;
      state.simSeconds = 3600;
      state.simulationKernel.lastAtomicCommit = {from:3590,to:3600};
      throw new Error('byte-equivalence-fault');
    }
  }), /byte-equivalence-fault/);

  assert.equal(JSON.stringify(state), beforeJson);
  assert.equal(sha(state), beforeHash);
  const timing = requirePhase1CTiming(tx, 'journal');
  return {beforeHash, timing};
});

// 8. Persistence publication must not become irreversible while rollback-capable critical work remains.
test('test_save_ordering_invariance', () => {
  const {s} = harness(['transaction-core','save-schema','control-plane-core','persistence-core']);
  const tx = s.GH_TRANSACTION_CORE;
  const state = minimal();
  const beforeJson = JSON.stringify(state);
  const beforeRevision = state.saveRevision;

  // Phase1C must model persistence as a terminal/irreversible publication stage,
  // not as an ordinary critical hook followed by more rollback-capable hooks.
  assert.throws(() => tx.execute(state, {
    label:'phase1c-save-ordering',
    scope:['simSeconds'],
    rollbackMode:'journal',
    writerContracts:[{owner:'test-state', proven:true, roots:['simSeconds']}],
    apply() {
      state.simSeconds = 60;
      tx.afterCommit(() => {
        const out = s.GH_PERSISTENCE.commitState(state,{storageKey:'phase1c-save-ordering'});
        assert.equal(out.ok,true);
      }, {critical:true, priority:100, key:'save', owner:'persistence', irreversible:true});
      tx.afterCommit(() => { throw new Error('late-critical-after-save'); }, {
        critical:true, priority:200, key:'late-critical', owner:'test-late', writeContract:{proven:false, roots:['finance']}
      });
    }
  }), /irreversible|ordering|late-critical-after-save/);

  // Either admission rejects the ordering before persistence, or a compensating mechanism
  // must leave both memory and durable/browser snapshot at the pre-transaction revision.
  assert.equal(JSON.stringify(state), beforeJson, 'memory must return to pre-transaction state');
  assert.equal(state.saveRevision, beforeRevision, 'saveRevision must not leak from a rolled-back transaction');
  const raw = s.localStorage.getItem('phase1c-save-ordering');
  if (raw !== null) assert.equal(raw, beforeJson, 'browser save must not publish rolled-back state');

  const timing = requirePhase1CTiming(tx);
  return timing;
});

const passed = results.filter(row => row.ok).length;
console.log(JSON.stringify({
  suite:'build339-phase1c-adversarial-contract',
  phase:'tests-first-red-gate',
  source:'Build 339 Phase 1B-B clean baseline',
  passed,
  total:results.length,
  journalActivationAllowed: passed === results.length,
  results
}, null, 2));

if (passed !== results.length) process.exitCode = 1;
