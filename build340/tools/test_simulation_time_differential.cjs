'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const taskRoot = path.resolve(__dirname, '..');
const referencePath = path.join(taskRoot, 'BUILD339_REFERENCE/WebApp/simulation-time-core.js');
const rewrittenPath = path.join(taskRoot, 'BUILD340_REWRITE_WORKSPACE/WebApp/simulation-time-core.js');

function load(filePath) {
  const context = { Number, Math };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath });
  return context.GH_SIMULATION_TIME_CORE;
}

const before = load(referencePath);
const after = load(rewrittenPath);
assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'public API changed');
for (const key of Object.keys(before)) {
  if (typeof before[key] !== 'function') assert.equal(after[key], before[key], `constant changed: ${key}`);
}

function same(actual, expected, label) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), label);
}

const edgeInputs = [
  -Infinity, -86401, -86400, -1, -0, 0, 1, 3599.999999, 3600,
  86399.999999, 86400, 86401, Infinity, NaN, null, undefined, '3600', 'bad'
];
for (const day of [-2, -1, 0, 1, 2, 10_000]) {
  for (const offset of [-0.001, -0.0000361, -0.000036, 0, 0.000036, 0.0000361, 0.001]) {
    edgeInputs.push(day * before.DAY_SECONDS + offset);
  }
}
for (const value of edgeInputs) {
  same(after.boundaryAt(value), before.boundaryAt(value), `boundaryAt(${String(value)})`);
  same(after.nextBoundaryAfter(value), before.nextBoundaryAfter(value), `nextBoundaryAfter(${String(value)})`);
  for (const requested of [-1, 0, NaN, Infinity, 1e-7, 1, 3600, 86400, 'bad']) {
    same(after.clampSliceToBoundary(value, requested), before.clampSliceToBoundary(value, requested), `clamp(${String(value)}, ${String(requested)})`);
    same(after.planSlice(value, requested), before.planSlice(value, requested), `plan(${String(value)}, ${String(requested)})`);
  }
}

// Deterministic pseudo-random differential sweep with many values near both
// hourly and daily edges. This complements the checked-in golden scenarios.
let seed = 0x340339;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}
for (let i = 0; i < 25_000; i += 1) {
  const day = Math.floor(random() * 100_000);
  const second = random() * before.DAY_SECONDS;
  const near = i % 3 === 0 ? Math.round(second / before.HOUR_SECONDS) * before.HOUR_SECONDS + (random() - 0.5) * 0.0001 : second;
  const from = day * before.DAY_SECONDS + near;
  const maximum = (random() - 0.05) * before.DAY_SECONDS;
  same(after.boundaryAt(from), before.boundaryAt(from), `random boundary #${i}`);
  same(after.nextBoundaryAfter(from), before.nextBoundaryAfter(from), `random next #${i}`);
  same(after.clampSliceToBoundary(from, maximum), before.clampSliceToBoundary(from, maximum), `random clamp #${i}`);
  same(after.planSlice(from, maximum), before.planSlice(from, maximum), `random plan #${i}`);
}
for (const boundary of [undefined, null, {}, { hour: 0, day: 0 }, { hour: null, day: 1 }, { hour: 2, day: undefined }]) {
  const outcome = (fn) => {
    try { return { value: fn() }; }
    catch (error) { return { error: error.name, message: error.message }; }
  };
  same(outcome(() => after.boundaryOrder(boundary)), outcome(() => before.boundaryOrder(boundary)), `boundaryOrder(${JSON.stringify(boundary)})`);
}

console.log(JSON.stringify({
  suite: 'build340-simulation-time-differential',
  passed: true,
  apiEntries: Object.keys(before).length,
  edgeInputs: edgeInputs.length,
  randomizedCases: 25_000,
  callsCompared: 4 * 25_000 + edgeInputs.length * 20 + 6
}, null, 2));
