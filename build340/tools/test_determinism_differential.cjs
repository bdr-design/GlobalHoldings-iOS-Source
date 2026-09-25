'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const taskRoot = path.resolve(__dirname, '..');

function load(filePath) {
  const context = { Number, Math, String, TypeError };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath });
  return context.GH_DETERMINISM;
}
const before = load(path.join(taskRoot, 'BUILD339_REFERENCE/WebApp/determinism-core.js'));
const after = load(path.join(taskRoot, 'BUILD340_REWRITE_WORKSPACE/WebApp/determinism-core.js'));
const same = (a, b, label) => assert.equal(JSON.stringify(a), JSON.stringify(b), label);
assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'public API changed');
assert.equal(after.VERSION, before.VERSION);
for (const text of ['', 'Global Holdings', 'المجموعة 🚚', '\ud83d\ude80', 0, null, { id: 7 }]) {
  assert.equal(after.hashString(text), before.hashString(text), `hashString(${String(text)})`);
}
function outcome(fn) {
  try { return { value: fn() }; }
  catch (error) { return { error: error.name, message: error.message }; }
}
for (const state of [null, undefined, 0, '', {}, { profile: { name: '' } }, { profile: { name: 'شركة المدار' }, determinism: { seed: 0, streams: [] }, sequences: [] }, { profile: null, determinism: { seed: -7, streams: { x: Infinity } }, sequences: { 'A!': '3' } }]) {
  const oldState = structuredClone(state);
  const newState = structuredClone(state);
  const oldResult = outcome(() => before.ensure(oldState));
  const newResult = outcome(() => after.ensure(newState));
  same(newResult, oldResult, `ensure result for ${JSON.stringify(state)}`);
  same(newState, oldState, `ensure state for ${JSON.stringify(state)}`);
}

let seed = 0x340341;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; }
const streams = ['', null, undefined, 'default', 'assets', 'finance', 'شركة', '😀', '0', 'x'];
const prefixes = ['', null, undefined, 'ID', 'ASSET', 'طائرة-🌍', 'a b.c', 0, '---', 'شركة_٢'];
for (let trial = 0; trial < 1_000; trial += 1) {
  const initial = {
    profile: { name: `founder-${Math.floor(random() * 1e8)}-${trial}` },
    determinism: { seed: Math.floor(random() * 0xffffffff) || 1, streams: {} },
    sequences: {}
  };
  if (trial % 3 === 0) initial.determinism.streams.generated = Math.floor(random() * 0xffffffff);
  if (trial % 5 === 0) initial.sequences.ASSET = Math.floor(random() * 10_000);
  const oldState = structuredClone(initial);
  const newState = structuredClone(initial);
  for (let step = 0; step < 200; step += 1) {
    const stream = streams[Math.floor(random() * streams.length)];
    const prefix = prefixes[Math.floor(random() * prefixes.length)];
    const call = Math.floor(random() * 3);
    const oldValue = call === 0 ? before.nextUint(oldState, stream) : call === 1 ? before.nextFloat(oldState, stream) : before.nextId(oldState, prefix);
    const newValue = call === 0 ? after.nextUint(newState, stream) : call === 1 ? after.nextFloat(newState, stream) : after.nextId(newState, prefix);
    same(newValue, oldValue, `generated output trial=${trial},step=${step}`);
    same(newState, oldState, `saved RNG state trial=${trial},step=${step}`);
  }
}
console.log(JSON.stringify({ suite: 'build340-determinism-differential', passed: true, states: 1_000, stepsPerState: 200, outputsCompared: 200_000, malformedEnsureCases: 9 }, null, 2));
