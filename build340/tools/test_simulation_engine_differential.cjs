'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const taskRoot = path.resolve(__dirname, '..');
function load(root) {
  const context = {};
  context.globalThis = context; context.window = context; vm.createContext(context);
  for (const name of ['simulation-time-core', 'simulation-pacing-core', 'simulation-core']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'WebApp', `${name}.js`), 'utf8'), context, { filename: `${name}.js` });
  }
  return context.GH_SIMULATION_CORE;
}
const oldApi = load(path.join(taskRoot, 'BUILD339_REFERENCE'));
const newApi = load(path.join(taskRoot, 'BUILD340_REWRITE_WORKSPACE'));
assert.deepEqual(Object.keys(newApi).sort(), Object.keys(oldApi).sort(), 'simulation API changed');
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) result[key] = normalize(child);
    return result;
  }
  return value;
}
function outcome(fn) { try { return { value: fn() }; } catch (error) { return { name: error.name, message: error.message }; } }
function run(api, profile) {
  const events = [];
  const clock = { value: 0 };
  let sim = profile.startSim || 0;
  let speed = profile.startSpeed ?? 30;
  let suspended = false;
  let creates = 0, chunks = 0, finishes = 0;
  const callbacks = Object.fromEntries(['warning', 'fatal', 'governor', 'maintenance', 'render', 'persist', 'throttle', 'advance'].map(key => [key, []]));
  const adapter = {
    getSimTime: () => sim,
    setSimTime: value => { sim = value; events.push(['setSimTime', value]); },
    getSpeed: () => speed,
    setSpeed: (value, meta) => { speed = value; events.push(['setSpeed', value, meta]); },
    isSuspended: () => suspended,
    getManualSliceLimit: ({ from, target, speed: activeSpeed, batchSeconds }) => profile.ownerLimit || Math.min(batchSeconds, target - from),
    createSliceJob: (slice, meta) => {
      creates += 1;
      events.push(['create', slice, meta.from, meta.to, meta.boundary]);
      if (profile.createFailureAt === creates) throw new Error('injected-create-error');
      let workLeft = profile.workUnits ?? 3;
      return {
        runChunk(maxItems, meta) {
          chunks += 1;
          if (profile.chunkFailureAt === chunks) throw new Error('injected-chunk-error');
          const processed = Math.min(Math.max(1, Number(maxItems) || 1), workLeft);
          workLeft -= processed;
          clock.value += Math.max(0, profile.chunkCostMs ?? 0.1) * processed;
          events.push(['chunk', processed, meta.speed, workLeft]);
          return workLeft <= 0;
        },
        finish(info) {
          finishes += 1;
          clock.value += Math.max(0, profile.finishCostMs ?? 0.1);
          events.push(['finish', info.from, info.to, info.boundary]);
          const behavior = profile.finishOutcomes?.[finishes - 1];
          if (behavior === 'throw') throw new Error('injected-finish-error');
          if (behavior === 'conflict') return { committed: false, retry: true, reason: 'asset-conflict' };
          if (behavior === 'reject') return { committed: false, reason: 'business-reject' };
          return { committed: true };
        },
        cancel(info) { events.push(['job-cancel', info.reason, info.from, info.to]); }
      };
    },
    onWarning: ({ stage, error }) => callbacks.warning.push([stage, error?.message || String(error)]),
    onFatal: error => callbacks.fatal.push([error?.name, error?.message]),
    onGovernor: event => callbacks.governor.push(event),
    onMaintenance: (hour, meta) => callbacks.maintenance.push([hour, meta]),
    onRender: event => callbacks.render.push(event),
    onPersist: event => callbacks.persist.push(event),
    onThrottle: event => callbacks.throttle.push(event),
    onAdvance: event => callbacks.advance.push(event)
  };
  const engine = api.create(adapter, {
    nowMs: () => clock.value,
    allowedSpeeds: [0, 30, 120, 300, 600], fallbackSpeed: 30,
    quantumRealSeconds: 1, maxRealDelta: 3, maxBacklogNormal: 12, maxBacklogFast: 96,
    frameBudgetMs: profile.frameBudgetMs ?? 5.5, manualFrameBudgetMs: profile.manualFrameBudgetMs ?? 10,
    chunkItems: profile.chunkItems ?? 2, manualChunkItems: profile.manualChunkItems ?? 3,
    renderEveryNormalMs: 180, renderEveryFastMs: 450,
    persistEveryNormalMs: 12000, persistEveryFastMs: 30000,
    minRealSliceSeconds: 0, maintenanceEveryHours: 6,
    manualBatchSeconds: 3600, manualMinBatchSeconds: 300,
    manualRetryLimit: profile.manualRetryLimit ?? 3,
    longTaskWarnMs: profile.longTaskWarnMs ?? 28, hardTaskMs: profile.hardTaskMs ?? 120,
    hardTaskLimit: profile.hardTaskLimit ?? 3, conflictLimit: profile.conflictLimit ?? 3
  });
  const trace = [];
  for (const action of profile.actions) {
    let result;
    if (action.type === 'frame') { clock.value = action.now; result = engine.frame(action.now); }
    else if (action.type === 'reset') { clock.value = action.now; result = engine.reset(action.now, action.reason); }
    else if (action.type === 'hidden') { clock.value = action.now; result = engine.setHidden(action.value); }
    else if (action.type === 'advance') result = engine.advanceTo(action.target, action.options || {});
    else if (action.type === 'cancel') result = engine.cancelAdvance(action.reason);
    else if (action.type === 'speed') speed = action.value;
    else if (action.type === 'suspended') suspended = action.value;
    else throw new Error(`unknown action ${action.type}`);
    const snapshot = engine.snapshot();
    if (snapshot.lastError) snapshot.lastError = String(snapshot.lastError).split('\n')[0];
    trace.push({ action, result: normalize(result), sim, speed, snapshot: normalize(snapshot), callbacks: normalize(callbacks), events: normalize(events.slice()) });
  }
  return trace;
}
const frames = (start, count, delta = 16) => Array.from({ length: count }, (_, i) => ({ type: 'frame', now: start + i * delta }));
const profiles = [
  { name: 'live-rate-and-hour-boundary', startSim: 3500, startSpeed: 600, actions: [{ type: 'reset', now: 0, reason: 'baseline' }, ...frames(1000, 30, 16)] },
  { name: 'manual-day-advance', startSpeed: 0, actions: [{ type: 'reset', now: 0, reason: 'manual' }, { type: 'advance', target: 90000, options: { speed: 600, batchSeconds: 3600 } }, ...frames(16, 500, 16)] },
  { name: 'background-and-pause', startSpeed: 30, actions: [{ type: 'reset', now: 0, reason: 'visible' }, ...frames(1000, 4, 1000), { type: 'hidden', value: true, now: 5000 }, { type: 'hidden', value: false, now: 60000 }, ...frames(61000, 8, 1000), { type: 'suspended', value: true }, ...frames(70000, 2, 1000), { type: 'suspended', value: false }, ...frames(71000, 3, 1000)] },
  { name: 'manual-conflict-retry', startSpeed: 0, finishOutcomes: ['conflict', 'conflict', 'ok'], actions: [{ type: 'reset', now: 0, reason: 'retry' }, { type: 'advance', target: 600, options: { speed: 300, batchSeconds: 600 } }, ...frames(16, 80, 16)] },
  { name: 'manual-retry-limit', startSpeed: 0, finishOutcomes: ['conflict', 'conflict', 'conflict'], manualRetryLimit: 3, actions: [{ type: 'reset', now: 0, reason: 'retry-limit' }, { type: 'advance', target: 600, options: { speed: 300, batchSeconds: 600 } }, ...frames(16, 80, 16)] },
  { name: 'create-failure', startSpeed: 0, createFailureAt: 1, actions: [{ type: 'reset', now: 0, reason: 'create-failure' }, { type: 'advance', target: 600, options: { speed: 300, batchSeconds: 600 } }, ...frames(16, 4, 16)] },
  { name: 'chunk-failure', startSpeed: 0, chunkFailureAt: 1, actions: [{ type: 'reset', now: 0, reason: 'chunk-failure' }, { type: 'advance', target: 600, options: { speed: 300, batchSeconds: 600 } }, ...frames(16, 4, 16)] },
  { name: 'finish-failure', startSpeed: 0, finishOutcomes: ['throw'], actions: [{ type: 'reset', now: 0, reason: 'finish-failure' }, { type: 'advance', target: 600, options: { speed: 300, batchSeconds: 600 } }, ...frames(16, 8, 16)] },
  { name: 'work-pressure', startSpeed: 0, chunkCostMs: 150, hardTaskMs: 120, hardTaskLimit: 1, actions: [{ type: 'reset', now: 0, reason: 'pressure' }, { type: 'advance', target: 3600, options: { speed: 600, batchSeconds: 3600 } }, ...frames(16, 20, 16)] },
  { name: 'speed-change-live', startSpeed: 30, actions: [{ type: 'reset', now: 0, reason: 'live' }, ...frames(1000, 4, 1000), { type: 'speed', value: 120 }, ...frames(5000, 6, 1000), { type: 'speed', value: 0 }, ...frames(12000, 2, 16)] }
];
let compared = 0;
for (const profile of profiles) {
  const cleanProfile = structuredClone(profile);
  const oldTrace = run(oldApi, cleanProfile);
  const newTrace = run(newApi, cleanProfile);
  assert.equal(JSON.stringify(newTrace), JSON.stringify(oldTrace), `simulation engine trace drift: ${profile.name}`);
  compared += oldTrace.length;
}
console.log(JSON.stringify({ suite: 'build340-simulation-engine-differential', passed: true, profiles: profiles.length, tracePoints: compared, scenarios: profiles.map(row => row.name) }, null, 2));
