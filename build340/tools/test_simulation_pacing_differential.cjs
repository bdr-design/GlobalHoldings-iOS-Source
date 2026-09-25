'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const taskRoot = path.resolve(__dirname, '..');

function load(filePath) {
  const context = { Number, Math, Date, performance: { now: () => 1234 } };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath });
  return context.GH_SIMULATION_PACING_CORE;
}
const before = load(path.join(taskRoot, 'BUILD339_REFERENCE/WebApp/simulation-pacing-core.js'));
const after = load(path.join(taskRoot, 'BUILD340_REWRITE_WORKSPACE/WebApp/simulation-pacing-core.js'));
const same = (a, b, label) => assert.equal(JSON.stringify(a), JSON.stringify(b), label);
assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'public API changed');
same(after.DEFAULTS, before.DEFAULTS, 'default pacing policy changed');

const configs = [
  {},
  { maxRealDelta: 0, maxBacklogNormal: -1, frameBudgetMs: Infinity },
  { maxRealDelta: 0.25, maxBacklogNormal: 1, maxBacklogFast: 700, frameBudgetMs: 3, manualFrameBudgetMs: 7 },
  { renderEveryNormalMs: 'bad', persistEveryFastMs: '45000', maxBacklogFast: 0 },
  { maxRealDelta: NaN, manualFrameBudgetMs: -5, renderEveryFastMs: 1e-8 }
];
for (const config of configs) same(after.normalizeConfig(config), before.normalizeConfig(config), `normalizeConfig(${JSON.stringify(config)})`);

let seed = 0x340340;
function random() { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 0x100000000; }
function run(api, config, variant) {
  const clock = { now: 1000 };
  const engine = api.create({ ...config, nowMs: () => clock.now, isFast: speed => Number(speed) >= 300 });
  const outputs = [];
  const save = (name, value) => outputs.push({ name, value, snapshot: engine.snapshot() });
  save('initial', engine.config());
  for (let i = 0; i < 12_000; i += 1) {
    const kind = i % 13;
    const speedPool = [0, 1, 30, 120, 300, 600, -2, NaN, Infinity, '600'];
    const speed = speedPool[Math.floor(random() * speedPool.length)];
    clock.now += [0, 1, 8, 16, 120, 950, 2200, -5][Math.floor(random() * 8)];
    if (kind === 0) save('frame', engine.observeLiveFrame(clock.now, speed, { suspended: random() < 0.04, paused: random() < 0.08 }));
    else if (kind === 1) save('hidden', engine.setHidden(random() < 0.5, clock.now));
    else if (kind === 2) save('manual', engine.setManualBacklog((random() - 0.1) * 200, clock.now));
    else if (kind === 3) save('limit', engine.limitBacklog((random() - 0.1) * 100));
    else if (kind === 4) save('consume', engine.consume((random() - 0.1) * 80));
    else if (kind === 5) save('clear', engine.clearBacklog());
    else if (kind === 6) save('deadline', engine.executionDeadline(random() < 0.5));
    else if (kind === 7) save('render', engine.shouldRender(clock.now, speed));
    else if (kind === 8) save('persist', engine.shouldPersist(clock.now, speed));
    else if (kind === 9) save('reset', engine.reset(clock.now));
    else if (kind === 10) save('backlog', engine.backlog());
    else if (kind === 11) save('config', engine.config());
    else save('snapshot', engine.snapshot());
  }
  return outputs;
}
for (const config of configs) {
  // Same seed for each side and each configuration.
  seed = 0x340340 + configs.indexOf(config);
  const oldResult = run(before, config, 0);
  seed = 0x340340 + configs.indexOf(config);
  const newResult = run(after, config, 0);
  same(newResult, oldResult, `stateful pacing trace for ${JSON.stringify(config)}`);
}
console.log(JSON.stringify({ suite: 'build340-simulation-pacing-differential', passed: true, configProfiles: configs.length, stepsPerProfile: 12_000, totalSteps: configs.length * 12_000 }, null, 2));
