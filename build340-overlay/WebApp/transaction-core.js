(() => {
  'use strict';

  // Build 340 rewrite: every state write is guarded by one transaction owner.
  // The legacy scope and experimental journal modes stay fail-closed until a
  // caller proves the complete write contract.
  const VERSION = '3.0.0';
  let activeContext = null;
  let durableSequence = 0;
  const durableTargets = new WeakSet();
  const runtimeTelemetry = { last: null, lastSimulation: null, samples: [] };
  const runtimeClock = () => globalThis.performance?.now?.() ?? Date.now();

  function publishRuntimeMetric(row) {
    const metric = { ...row, recordedAtMs: Date.now() };
    runtimeTelemetry.last = metric;
    if (String(metric.label || '').startsWith('simulation:')) runtimeTelemetry.lastSimulation = metric;
    runtimeTelemetry.samples.push(metric);
    if (runtimeTelemetry.samples.length > 24) runtimeTelemetry.samples.shift();
    return metric;
  }

  function jsonClone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function deepClone(value) {
    if (typeof globalThis.structuredClone === 'function') {
      try { return globalThis.structuredClone(value); } catch (_error) { /* JSON-compatible fallback below. */ }
    }
    return jsonClone(value);
  }

  function restoreValue(target, snapshot) {
    if (Array.isArray(snapshot)) {
      if (!Array.isArray(target)) return deepClone(snapshot);
      target.length = snapshot.length;
      for (let index = 0; index < snapshot.length; index += 1) {
        const saved = snapshot[index];
        const current = target[index];
        target[index] = saved && typeof saved === 'object' ? restoreValue(current, saved) : saved;
      }
      return target;
    }

    if (snapshot && typeof snapshot === 'object') {
      if (!target || typeof target !== 'object' || Array.isArray(target)) target = {};
      const existingChildren = new Map(Object.keys(target).map(key => [key, target[key]]));
      for (const key of Object.keys(target)) delete target[key];
      for (const [key, saved] of Object.entries(snapshot)) {
        const current = existingChildren.get(key);
        target[key] = saved && typeof saved === 'object' ? restoreValue(current, saved) : saved;
      }
      return target;
    }
    return snapshot;
  }

  function restoreObject(target, snapshot) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw new TypeError('Transaction target must be an object');
    }
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new TypeError('Transaction snapshot must be an object');
    }
    return restoreValue(target, snapshot);
  }

  function sameOrder(keys, expected) {
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
  }

  function restoreRootOrder(target, rootOrder) {
    if (!Array.isArray(rootOrder) || !rootOrder.length) return target;
    const currentKeys = Object.keys(target);
    if (sameOrder(currentKeys, rootOrder)) return target;

    const descriptors = Object.getOwnPropertyDescriptors(target);
    const orderedKeys = [
      ...rootOrder.filter(key => Object.prototype.hasOwnProperty.call(descriptors, key)),
      ...currentKeys.filter(key => !rootOrder.includes(key))
    ];
    for (const key of currentKeys) {
      const descriptor = descriptors[key];
      if (descriptor?.configurable === false) throw new Error(`transaction-root-order-nonconfigurable:${key}`);
      delete target[key];
    }
    for (const key of orderedKeys) Object.defineProperty(target, key, descriptors[key]);
    return target;
  }

  function isActive() {
    return !!activeContext;
  }

  function transactionMemo(key, factory) {
    if (!activeContext) return typeof factory === 'function' ? factory() : undefined;
    const memoKey = String(key || '');
    if (activeContext.memo.has(memoKey)) return activeContext.memo.get(memoKey);
    const value = typeof factory === 'function' ? factory() : factory;
    activeContext.memo.set(memoKey, value);
    return value;
  }

  function normalizeScope(scope) {
    if (!Array.isArray(scope) || !scope.length) return null;
    return [...new Set(scope.map(String).filter(Boolean))];
  }

  function normalizeWriteRoots(roots) {
    if (!Array.isArray(roots)) return null;
    return [...new Set(roots.map(String).filter(Boolean))];
  }

  function normalizeWriterContracts(contracts) {
    return Array.isArray(contracts)
      ? contracts.filter(row => row && typeof row === 'object').map(row => ({ ...row }))
      : [];
  }

  function auditEqual(a, b, seen = new WeakMap()) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    let peers = seen.get(a);
    if (peers?.has(b)) return true;
    if (!peers) {
      peers = new WeakSet();
      seen.set(a, peers);
    }
    peers.add(b);

    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let index = 0; index < a.length; index += 1) {
        if (!auditEqual(a[index], b[index], seen)) return false;
      }
      return true;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key) || !auditEqual(a[key], b[key], seen)) return false;
    }
    return true;
  }

  function diffRootKeys(target, baseline) {
    const keys = new Set([...Object.keys(baseline || {}), ...Object.keys(target || {})]);
    const changed = [];
    for (const key of keys) {
      const targetHas = Object.prototype.hasOwnProperty.call(target, key);
      const baselineHas = Object.prototype.hasOwnProperty.call(baseline, key);
      if (targetHas !== baselineHas || !auditEqual(target[key], baseline[key])) changed.push(key);
    }
    return changed.sort();
  }

  function captureScoped(target, scope) {
    const snapshot = {};
    for (const key of scope) {
      snapshot[key] = {
        exists: Object.prototype.hasOwnProperty.call(target, key),
        value: deepClone(target[key])
      };
    }
    return snapshot;
  }

  function restoreScoped(target, snapshot, scope) {
    for (const key of scope) {
      const entry = snapshot[key];
      if (!entry?.exists) {
        delete target[key];
        continue;
      }
      const saved = entry.value;
      const current = target[key];
      target[key] = saved && typeof saved === 'object' ? restoreValue(current, saved) : saved;
    }
    return target;
  }

  function isJournalPrimitive(value) {
    return value === null
      || typeof value === 'string'
      || typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value));
  }

  function captureJournal(target, scope, contracts) {
    const assetContract = contracts.find(contract => contract.proven === true
      && contract.root === 'assets'
      && contract.mode === 'asset-fields'
      && Array.isArray(contract.fields)
      && contract.fields.length);
    if (scope.includes('assets') && !assetContract) return { ok: false, reason: 'journal-assets-without-field-contract' };

    const rootScope = scope.filter(key => key !== 'assets');
    const rootSnapshot = captureScoped(target, rootScope);
    const assetEntries = [];
    if (!assetContract) {
      return { ok: true, rootScope, rootSnapshot, assetEntries, assetFields: [], records: rootScope.length };
    }

    const assetFields = [...new Set(assetContract.fields.map(String).filter(Boolean))];
    const assets = target.assets || [];
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index];
      if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return { ok: false, reason: 'journal-asset-invalid' };
      const savedFields = {};
      for (const field of assetFields) {
        const descriptor = Object.getOwnPropertyDescriptor(asset, field);
        if (!descriptor
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
          || !isJournalPrimitive(descriptor.value)) {
          return { ok: false, reason: `journal-asset-field-unsupported:${field}` };
        }
        savedFields[field] = { ...descriptor };
      }
      assetEntries.push({ index, id: asset.id ?? null, ref: asset, keyOrder: Object.keys(asset), fields: savedFields });
    }
    return {
      ok: true,
      rootScope,
      rootSnapshot,
      assetEntries,
      assetFields,
      records: rootScope.length + assetEntries.length * assetFields.length
    };
  }

  function validateJournalPostState(target, journal) {
    if (!journal) return { ok: true };
    const assets = target.assets || [];
    if (journal.assetEntries.length && assets.length !== journal.assetEntries.length) {
      return { ok: false, reason: 'journal-assets-structural-length' };
    }

    for (const entry of journal.assetEntries) {
      const asset = assets[entry.index];
      if (!asset || asset !== entry.ref) return { ok: false, reason: `journal-assets-structural-order:${entry.id ?? entry.index}` };
      if (!sameOrder(Object.keys(asset), entry.keyOrder || [])) {
        return { ok: false, reason: `journal-asset-key-structure:${entry.id ?? entry.index}` };
      }
      for (const field of Object.keys(entry.fields || {})) {
        const descriptor = Object.getOwnPropertyDescriptor(asset, field);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          return { ok: false, reason: `journal-asset-field-structure:${field}` };
        }
        if (!isJournalPrimitive(descriptor.value)) return { ok: false, reason: `journal-asset-field-unsupported-new:${field}` };
      }
    }
    return { ok: true };
  }

  function restoreJournal(target, journal, rootOrder) {
    if (journal.rootScope.length) restoreScoped(target, journal.rootSnapshot, journal.rootScope);
    const assets = target.assets || [];
    for (const entry of journal.assetEntries) {
      let asset = assets[entry.index];
      if (!asset || asset !== entry.ref) {
        if (entry.id != null) asset = assets.find(row => row?.id === entry.id);
      }
      if (!asset || typeof asset !== 'object') throw new Error(`journal-asset-missing:${entry.id ?? entry.index}`);
      for (const [field, descriptor] of Object.entries(entry.fields)) Object.defineProperty(asset, field, descriptor);
    }
    return restoreRootOrder(target, rootOrder);
  }

  function applyJournalPreimageToBaseline(baseline, context) {
    const journal = context.journal;
    if (!journal) return baseline;
    if (journal.rootScope.length) restoreScoped(baseline, journal.rootSnapshot, journal.rootScope);
    const assets = baseline.assets || [];
    for (const entry of journal.assetEntries) {
      const asset = assets[entry.index];
      if (!asset || typeof asset !== 'object') throw new Error(`journal-promotion-asset-missing:${entry.id ?? entry.index}`);
      for (const [field, descriptor] of Object.entries(entry.fields)) {
        Object.defineProperty(asset, field, { ...descriptor });
      }
    }
    const allowedRoots = new Set(context.rootOrder);
    for (const key of Object.keys(baseline)) if (!allowedRoots.has(key)) delete baseline[key];
    return restoreRootOrder(baseline, context.rootOrder);
  }

  function promoteLegacyScoped(context) {
    const target = context.target;
    const scoped = new Set(context.scope);
    const remaining = {};
    for (const key of context.rootOrder) {
      if (!scoped.has(key) && Object.prototype.hasOwnProperty.call(target, key)) remaining[key] = target[key];
    }
    const remainingClone = deepClone(remaining);
    const fullSnapshot = {};
    for (const key of context.rootOrder) {
      if (scoped.has(key)) {
        const entry = context.snapshot[key];
        if (entry?.exists) fullSnapshot[key] = entry.value;
      } else if (Object.prototype.hasOwnProperty.call(remainingClone, key)) {
        fullSnapshot[key] = remainingClone[key];
      }
    }
    context.snapshot = fullSnapshot;
    context.scope = null;
  }

  function promoteToFull(context, reason = 'journal-fallback') {
    if (!context || context.rollbackStorage === 'full-snapshot') return context;
    const startedAt = runtimeClock();
    if (context.rollbackStorage === 'journal') {
      const baseline = applyJournalPreimageToBaseline(deepClone(context.target), context);
      context.snapshot = baseline;
      context.journal = null;
      context.scope = null;
    } else if (context.scope) {
      promoteLegacyScoped(context);
    }
    context.rollbackStorage = 'full-snapshot';
    if (context.timing) {
      context.timing.snapshotMs += Math.max(0, runtimeClock() - startedAt);
      context.timing.fullSnapshot = true;
      context.timing.fullSnapshotFallback = true;
      context.timing.fallbackReason = context.timing.fallbackReason || String(reason || 'journal-fallback');
      context.timing.rollbackStorage = 'full-snapshot';
    }
    return context;
  }

  function afterCommit(fn, options = {}) {
    if (typeof fn !== 'function') return;
    const task = {
      fn,
      critical: options?.critical === true,
      priority: Number(options.priority) || 0,
      key: options.key || null,
      owner: options.owner || null,
      writeContract: options.writeContract || null,
      irreversible: options.irreversible === true
    };

    if (!activeContext) {
      fn();
      return;
    }

    const context = activeContext;
    if (task.critical) {
      if (task.irreversible) {
        if (context.irreversiblePriority != null) {
          throw new Error('transaction-irreversible-ordering:multiple-terminal-critical-tasks');
        }
        const laterExisting = context.postCommit.some(row => row.critical && !row.irreversible && row.priority > task.priority);
        if (laterExisting) throw new Error('transaction-irreversible-ordering:critical-task-after-terminal');
        context.irreversiblePriority = task.priority;
      } else if (context.irreversiblePriority != null && task.priority >= context.irreversiblePriority) {
        throw new Error('transaction-irreversible-ordering:critical-task-after-terminal');
      }

      if (context.rollbackStorage === 'journal') {
        const contract = task.writeContract;
        const readOnly = contract?.proven === true && contract?.readOnly === true;
        if (!readOnly) promoteToFull(context, `critical-hook:${task.owner || task.key || 'unproven'}`);
      }
    }

    if (task.key) context.postCommit = context.postCommit.filter(existing => existing.key !== task.key);
    context.postCommit.push(task);
  }

  function journalAdmissionReason(options, scope, contracts) {
    if (options.rollbackMode !== 'journal') return null;
    if (!scope) return 'journal-requires-scope';
    if (!contracts.length) return 'unproven-writer';
    if (contracts.some(contract => contract.proven !== true)) return 'unproven-writer';
    if (contracts.some(contract => contract.structural === true)) return 'structural-writer';
    if (contracts.some(contract => contract.mayJoin === true)) return 'composite-writer';
    if (contracts.some(contract => contract.allowNestedSubobjects === true || contract.nested === true)) return 'nested-asset-writer';
    if (typeof options.validate === 'function'
      && !(options.validateContract?.proven === true && options.validateContract?.readOnly === true)) {
      return 'validation-unproven';
    }
    return null;
  }

  function join(target, options = {}) {
    if (!activeContext) return execute(target, options);
    const context = activeContext;
    try {
      if (context.target !== target) throw new Error('Cross-state transaction join is forbidden');
      // A journal join is forbidden after parent writes may have happened.
      if (context.rollbackStorage === 'journal') throw new Error('transaction-journal-unexpected-join');
      if (context.scope) promoteToFull(context, 'joined-writer');

      const validation = options.validate ? options.validate() : true;
      if (validation === false || validation?.ok === false) throw new Error(validation?.reason || 'validation-rejected');
      const value = options.apply();
      if (value?.then) throw new Error('Asynchronous state mutation requires an explicit lifecycle');
      return { committed: true, value, label: context.label, joined: true };
    } catch (error) {
      context.failure = error;
      throw error;
    }
  }

  function execute(target, options = {}) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) throw new TypeError('Transaction target must be an object');
    if (typeof options.apply !== 'function') throw new TypeError('Transaction apply callback is required');
    if (activeContext) throw new Error('Nested state transactions are forbidden; domain commands must join their owner');

    const label = String(options.label || 'transaction');
    const scope = normalizeScope(options.scope);
    const declaredWriteRoots = normalizeWriteRoots(options.writeRoots);
    const writerContracts = normalizeWriterContracts(options.writerContracts);
    const auditWrites = options.auditWrites === true || options.enforceWriteRoots === true;
    const totalStartedAt = runtimeClock();
    const requestedJournal = options.rollbackMode === 'journal';
    let fallbackReason = journalAdmissionReason(options, scope, writerContracts);
    let rollbackStorage = 'legacy-scoped';
    let snapshot = null;
    let journal = null;

    const timing = {
      label,
      scopeSize: scope ? scope.length : null,
      fullSnapshot: false,
      fullSnapshotFallback: false,
      fallbackReason: null,
      rollbackStorage: null,
      journalRecords: 0,
      snapshotMs: 0,
      validateMs: 0,
      applyMs: 0,
      postCommitCriticalMs: 0,
      postCommitNonCriticalMs: 0,
      postCommitCriticalTasks: [],
      postCommitNonCriticalTasks: [],
      writeAudit: auditWrites ? {
        enabled: true,
        declaredRoots: declaredWriteRoots ? [...declaredWriteRoots] : null,
        mutatedRoots: [],
        undeclaredRoots: [],
        declaredButUnchanged: [],
        stage: 'pending'
      } : null,
      rollbackMs: 0,
      totalMs: 0,
      committed: false,
      stage: 'snapshot'
    };

    const snapshotStartedAt = runtimeClock();
    if (requestedJournal && !fallbackReason) {
      const captured = captureJournal(target, scope, writerContracts);
      if (captured.ok) {
        journal = captured;
        rollbackStorage = 'journal';
        timing.journalRecords = captured.records;
      } else {
        fallbackReason = captured.reason;
      }
    }
    if (requestedJournal && fallbackReason) {
      snapshot = deepClone(target);
      rollbackStorage = 'full-snapshot';
    } else if (!requestedJournal) {
      snapshot = scope ? captureScoped(target, scope) : deepClone(target);
      rollbackStorage = scope ? 'legacy-scoped' : 'full-snapshot';
    }
    timing.snapshotMs = Math.max(0, runtimeClock() - snapshotStartedAt);
    timing.rollbackStorage = rollbackStorage;
    timing.fullSnapshot = rollbackStorage === 'full-snapshot';
    timing.fullSnapshotFallback = requestedJournal && rollbackStorage === 'full-snapshot';
    timing.fallbackReason = timing.fullSnapshotFallback ? fallbackReason : null;

    // Auditing is opt-in. Normal gameplay reuses the rollback snapshot and pays
    // no extra full-state comparison cost.
    const auditBaseline = auditWrites
      ? (rollbackStorage === 'full-snapshot' ? snapshot : deepClone(target))
      : null;
    const context = {
      target,
      label,
      scope: rollbackStorage === 'legacy-scoped' ? scope : null,
      snapshot,
      journal,
      rootOrder: Object.keys(target),
      postCommit: [],
      memo: new Map(),
      failure: null,
      auditBaseline,
      declaredWriteRoots,
      writerContracts,
      rollbackStorage,
      timing,
      irreversiblePriority: null
    };
    const rollback = () => {
      if (context.rollbackStorage === 'journal') return restoreJournal(target, context.journal, context.rootOrder);
      if (context.scope) {
        restoreScoped(target, context.snapshot, context.scope);
        return restoreRootOrder(target, context.rootOrder);
      }
      return restoreObject(target, context.snapshot);
    };

    let phase = 'validate';
    activeContext = context;
    try {
      const validateStartedAt = runtimeClock();
      const validation = typeof options.validate === 'function' ? options.validate() : true;
      timing.validateMs = Math.max(0, runtimeClock() - validateStartedAt);
      timing.stage = 'validate';
      if (validation === false || validation?.ok === false) {
        const rollbackStartedAt = runtimeClock();
        rollback();
        timing.rollbackMs = Math.max(0, runtimeClock() - rollbackStartedAt);
        timing.totalMs = Math.max(0, runtimeClock() - totalStartedAt);
        timing.stage = 'validation-rejected';
        publishRuntimeMetric(timing);
        return { committed: false, reason: validation?.reason || 'validation-rejected', label };
      }

      phase = 'commit';
      const applyStartedAt = runtimeClock();
      const value = options.apply();
      timing.applyMs = Math.max(0, runtimeClock() - applyStartedAt);
      timing.stage = 'commit';
      if (value?.then) throw new Error('Asynchronous state mutation requires an explicit lifecycle');
      if (context.failure) throw context.failure;

      if (context.rollbackStorage === 'journal') {
        const validationAfterApply = validateJournalPostState(target, context.journal);
        if (!validationAfterApply.ok) {
          const error = new Error(`transaction-journal-contract-violation:${validationAfterApply.reason}`);
          error.code = 'TRANSACTION_JOURNAL_CONTRACT_VIOLATION';
          throw error;
        }
      }

      activeContext = null;
      phase = 'post-commit-critical';
      const criticalTasks = context.postCommit.filter(task => task.critical).sort((a, b) => a.priority - b.priority);
      const reversibleCritical = criticalTasks.filter(task => !task.irreversible);
      const irreversibleCritical = criticalTasks.filter(task => task.irreversible);
      const runCritical = tasks => {
        for (const task of tasks) {
          const taskStartedAt = runtimeClock();
          const row = {
            key: task.key || null,
            owner: task.owner || null,
            priority: task.priority,
            durationMs: 0,
            ok: false,
            irreversible: task.irreversible === true
          };
          try {
            task.fn();
            row.ok = true;
          } finally {
            row.durationMs = Math.max(0, runtimeClock() - taskStartedAt);
            timing.postCommitCriticalTasks.push(row);
          }
        }
      };

      const criticalStartedAt = runtimeClock();
      try {
        runCritical(reversibleCritical);
        if (context.rollbackStorage === 'journal') {
          const validationAfterCritical = validateJournalPostState(target, context.journal);
          if (!validationAfterCritical.ok) {
            const error = new Error(`transaction-journal-contract-violation:${validationAfterCritical.reason}`);
            error.code = 'TRANSACTION_JOURNAL_CONTRACT_VIOLATION';
            throw error;
          }
        }

        if (auditWrites) {
          const mutatedRoots = diffRootKeys(target, auditBaseline);
          const declared = declaredWriteRoots ? new Set(declaredWriteRoots) : null;
          const undeclared = declared ? mutatedRoots.filter(key => !declared.has(key)) : [];
          const unchanged = declaredWriteRoots ? declaredWriteRoots.filter(key => !mutatedRoots.includes(key)) : [];
          timing.writeAudit = {
            enabled: true,
            declaredRoots: declaredWriteRoots ? [...declaredWriteRoots] : null,
            mutatedRoots,
            undeclaredRoots: undeclared,
            declaredButUnchanged: unchanged,
            stage: 'pre-irreversible'
          };
          if (options.enforceWriteRoots === true && undeclared.length) {
            const error = new Error(`transaction-write-set-violation:${undeclared.join(',')}`);
            error.code = 'TRANSACTION_WRITE_SET_VIOLATION';
            error.undeclaredRoots = undeclared;
            throw error;
          }
        }

        phase = 'post-commit-irreversible';
        runCritical(irreversibleCritical);
      } finally {
        timing.postCommitCriticalMs = Math.max(0, runtimeClock() - criticalStartedAt);
      }

      const nonCriticalStartedAt = runtimeClock();
      for (const task of context.postCommit.filter(row => !row.critical)) {
        const taskStartedAt = runtimeClock();
        const row = { key: task.key || null, owner: task.owner || null, priority: task.priority, durationMs: 0, ok: false };
        try {
          task.fn();
          row.ok = true;
        } catch (error) {
          row.error = String(error?.message || error).slice(0, 240);
          globalThis.console?.warn?.(`${label}: non-critical post-commit side effect failed`, error);
        } finally {
          row.durationMs = Math.max(0, runtimeClock() - taskStartedAt);
          timing.postCommitNonCriticalTasks.push(row);
        }
      }
      timing.postCommitNonCriticalMs = Math.max(0, runtimeClock() - nonCriticalStartedAt);
      timing.committed = true;
      timing.stage = 'committed';
      timing.totalMs = Math.max(0, runtimeClock() - totalStartedAt);
      publishRuntimeMetric(timing);
      return { committed: true, value, label, scope: context.scope ? [...context.scope] : null };
    } catch (error) {
      activeContext = null;
      context.postCommit.length = 0;
      if (auditWrites && timing.writeAudit?.stage === 'pending') {
        const mutatedRoots = diffRootKeys(target, auditBaseline);
        const declared = declaredWriteRoots ? new Set(declaredWriteRoots) : null;
        timing.writeAudit = {
          enabled: true,
          declaredRoots: declaredWriteRoots ? [...declaredWriteRoots] : null,
          mutatedRoots,
          undeclaredRoots: declared ? mutatedRoots.filter(key => !declared.has(key)) : [],
          declaredButUnchanged: declaredWriteRoots ? declaredWriteRoots.filter(key => !mutatedRoots.includes(key)) : [],
          stage: 'failure-before-rollback'
        };
      }

      const rollbackStartedAt = runtimeClock();
      try {
        rollback();
        timing.rollbackMs = Math.max(0, runtimeClock() - rollbackStartedAt);
      } catch (restoreError) {
        timing.rollbackMs = Math.max(0, runtimeClock() - rollbackStartedAt);
        timing.stage = 'rollback-failed';
        timing.totalMs = Math.max(0, runtimeClock() - totalStartedAt);
        publishRuntimeMetric(timing);
        const fatal = new Error(`${label}: rollback failed`);
        fatal.cause = error;
        fatal.rollbackError = restoreError;
        fatal.transactionLabel = label;
        fatal.transactionStage = 'rollback';
        throw fatal;
      }

      timing.stage = phase;
      timing.totalMs = Math.max(0, runtimeClock() - totalStartedAt);
      publishRuntimeMetric(timing);
      error.transactionLabel = label;
      error.transactionStage = phase;
      throw error;
    } finally {
      activeContext = null;
    }
  }

  function telemetrySnapshot() {
    const result = deepClone(runtimeTelemetry);
    if (activeContext) {
      result.active = {
        label: activeContext.label,
        rollbackStorage: activeContext.rollbackStorage,
        fullSnapshot: activeContext.rollbackStorage === 'full-snapshot',
        fallbackReason: activeContext.timing?.fallbackReason || null,
        journalRecords: activeContext.timing?.journalRecords || 0
      };
    }
    return result;
  }

  function rejection(reason, label, stage = 'validate') {
    const error = new Error(reason);
    error.transactionLabel = label;
    error.transactionStage = stage;
    return error;
  }

  function criticalIds(result) {
    const critical = result?.critical || ((result?.issues) || []).filter(row => row.severity === 'critical');
    return new Set(critical.map(row => String(row.id || row.code || row.title)));
  }

  async function executeDurable(liveState, options = {}) {
    if (!liveState || typeof liveState !== 'object' || Array.isArray(liveState)) {
      throw new TypeError('Durable transaction target must be an object');
    }
    if (typeof options.apply !== 'function') throw new TypeError('Durable transaction apply callback is required');
    if (activeContext) throw new Error('Durable transaction cannot start inside a synchronous transaction');
    if (durableTargets.has(liveState)) throw new Error('durable-transaction-in-progress');
    if (globalThis.__GH_DURABLE_COMMAND_CONTEXT__) throw new Error('durable-command-context-in-progress');

    const label = String(options.label || 'durable-transaction');
    const actualRevision = Math.max(0, Math.floor(Number(liveState.saveRevision) || 0));
    const expectedRevision = options.expectedRevision == null ? actualRevision : Number(options.expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw rejection('invalid-expected-save-revision', label, 'admission');
    }
    if (actualRevision !== expectedRevision) {
      throw rejection(`state-revision-conflict:${expectedRevision}:${actualRevision}`, label, 'admission');
    }

    const transactionId = String(options.transactionId || `DTX-${String(++durableSequence).padStart(9, '0')}`);
    const draft = deepClone(liveState);
    const priorCritical = criticalIds(globalThis.GH_INTEGRITY_CORE?.check?.(liveState));
    const afterPublishTasks = [];
    const context = {
      schema: 'gh-durable-transaction-v1',
      transactionId,
      label,
      liveState,
      draft,
      expectedRevision,
      startedAtSim: Number(liveState.simSeconds) || 0,
      afterPublish(fn) {
        if (typeof fn === 'function') afterPublishTasks.push(fn);
      },
      call(domain, name, payload = {}, commandOptions = {}) {
        const commands = globalThis.GH_DOMAIN_COMMANDS;
        if (!commands?.dispatch) throw new Error('domain-command-owner-unavailable');
        return commands.dispatch({ state: draft }, domain, name, payload, commandOptions);
      },
      callSystem(domain, name, payload = {}, commandOptions = {}) {
        const commands = globalThis.GH_DOMAIN_COMMANDS;
        if (!commands?.dispatchSystem) throw new Error('system-domain-command-owner-unavailable');
        return commands.dispatchSystem({ state: draft }, domain, name, payload, commandOptions);
      }
    };

    durableTargets.add(liveState);
    globalThis.__GH_DURABLE_COMMAND_CONTEXT__ = context;
    let phase = 'apply';
    let durableCommitted = false;
    try {
      const value = await options.apply(draft, context);
      if (value === false) throw rejection(`${label}-rejected`, label, phase);
      if (Number(draft.saveRevision || 0) !== expectedRevision) throw rejection('draft-save-revision-mutated', label, phase);
      draft.saveRevision = expectedRevision + 1;
      phase = 'validate';

      const schema = globalThis.GH_SAVE_SCHEMA?.validate?.(draft);
      if (schema && schema.ok === false) throw rejection(`invalid-draft:${(schema.errors || []).join(',')}`, label, phase);
      if (options.integrity !== false && globalThis.GH_INTEGRITY_CORE?.check) {
        const integrity = globalThis.GH_INTEGRITY_CORE.check(draft);
        const issues = integrity?.critical || ((integrity?.issues) || []).filter(row => row.severity === 'critical');
        const introduced = issues.filter(row => !priorCritical.has(String(row.id || row.code || row.title)));
        if (introduced.length) {
          throw rejection(`critical-integrity:${introduced.map(row => row.id || row.code || row.title).join(',')}`, label, phase);
        }
      }
      if (typeof options.validate === 'function') {
        const validation = await options.validate(draft, context);
        if (validation === false || validation?.ok === false) throw rejection(validation?.reason || 'validation-rejected', label, phase);
      }
      if (Number(liveState.saveRevision || 0) !== expectedRevision) {
        throw rejection(`state-revision-conflict:${expectedRevision}:${Number(liveState.saveRevision) || 0}`, label, 'pre-persist');
      }

      phase = 'durable-commit';
      const persist = options.persist || ((state, meta) => {
        const owner = globalThis.GH_PERSISTENCE;
        if (!owner?.commitDurableState) throw new Error('durable-persistence-owner-unavailable');
        return owner.commitDurableState(state, meta);
      });
      const persisted = await persist(draft, {
        ...(options.persistence || {}),
        expectedPreviousRevision: expectedRevision,
        transactionId,
        idempotencyKey: options.idempotencyKey || null
      });
      if (persisted === false || persisted?.ok === false) {
        throw rejection(persisted?.reason || 'durable-persistence-rejected', label, phase);
      }
      durableCommitted = true;

      phase = 'publish';
      if (typeof options.publish === 'function') await options.publish(liveState, draft, context);
      else restoreObject(liveState, draft);
      for (const task of afterPublishTasks) {
        try { await task(value, context); }
        catch (error) { globalThis.console?.warn?.(`${label}: after-publish side effect failed`, error); }
      }
      if (typeof options.afterCommit === 'function') {
        try { await options.afterCommit(value, context); }
        catch (error) { globalThis.console?.warn?.(`${label}: after-commit side effect failed`, error); }
      }
      return {
        committed: true,
        durable: true,
        transactionId,
        label,
        saveRevision: Number(liveState.saveRevision) || 0,
        value,
        persistence: persisted
      };
    } catch (error) {
      error.transactionLabel = error.transactionLabel || label;
      error.transactionStage = error.transactionStage || phase;
      error.durableCommitted = durableCommitted;
      if (durableCommitted) {
        error.critical = true;
        globalThis.GH_PERSISTENCE?.markRecoveryRequired?.('durable-publish-failed');
      }
      throw error;
    } finally {
      if (globalThis.__GH_DURABLE_COMMAND_CONTEXT__ === context) delete globalThis.__GH_DURABLE_COMMAND_CONTEXT__;
      durableTargets.delete(liveState);
    }
  }

  const API = Object.freeze({
    VERSION,
    deepClone,
    restoreObject,
    execute,
    join,
    executeDurable,
    isActive,
    isDurableActive: target => target ? durableTargets.has(target) : !!globalThis.__GH_DURABLE_COMMAND_CONTEXT__,
    afterCommit,
    transactionMemo,
    telemetry: telemetrySnapshot
  });
  globalThis.GH_TRANSACTION_CORE = API;
  if (globalThis.window && globalThis.window !== globalThis) globalThis.window.GH_TRANSACTION_CORE = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
