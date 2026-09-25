'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const taskRoot = path.resolve(__dirname, '..');
function load(filePath) {
  const context = { Number, String, Set, Map, Math, TypeError };
  context.globalThis = context; context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath });
  return { api: context.GH_DEPENDENCY_CORE, context };
}
const old = load(path.join(taskRoot, 'BUILD339_REFERENCE/WebApp/dependency-core.js'));
const fresh = load(path.join(taskRoot, 'BUILD340_REWRITE_WORKSPACE/WebApp/dependency-core.js'));
const same = (a, b, label) => assert.equal(JSON.stringify(a), JSON.stringify(b), label);
assert.deepEqual(Object.keys(fresh.api).sort(), Object.keys(old.api).sort(), 'public API changed');
assert.equal(fresh.api.VERSION, old.api.VERSION);

let seed = 0x340342;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; }
for (let trial = 0; trial < 250; trial += 1) {
  const initial = { simSeconds: trial * 97, dependencyGraph: { edges: [] } };
  const a = structuredClone(initial), b = structuredClone(initial);
  for (let step = 0; step < 250; step += 1) {
    const parent = `N${Math.floor(random() * 30)}`;
    const child = `N${Math.floor(random() * 30)}`;
    const kind = ['depends_on', 'requires', 'owns'][Math.floor(random() * 3)];
    const action = Math.floor(random() * 4);
    let x, y;
    if (action === 0) { const meta = { step, score: random(), note: step % 7 ? null : 'تبعّي' }; x = old.api.link(a, parent, child, kind, meta); y = fresh.api.link(b, parent, child, kind, meta); }
    else if (action === 1) { const status = ['open', 'resolved', 'cancelled', 'blocked'][Math.floor(random() * 4)]; x = old.api.setStatus(a, parent, child, kind, status); y = fresh.api.setStatus(b, parent, child, kind, status); }
    else if (action === 2) { x = old.api.children(a, parent); y = fresh.api.children(b, parent); }
    else { x = old.api.parents(a, child); y = fresh.api.parents(b, child); }
    same(y, x, `operation output trial=${trial},step=${step}`);
    same(b, a, `state trial=${trial},step=${step}`);
  }
  same(fresh.api.unresolved(b, 'N3'), old.api.unresolved(a, 'N3'), `unresolved trial=${trial}`);
  same(fresh.api.detectCycles(b), old.api.detectCycles(a), `cycles trial=${trial}`);
  const valid = new Set(Array.from({ length: 15 }, (_, i) => `N${i}`));
  same(fresh.api.compact(b, valid), old.api.compact(a, valid), `compact count trial=${trial}`);
  same(b, a, `compact state trial=${trial}`);
}

// Ensure large valid dependency chains are safe even when longer than the
// JavaScript call-stack recursion limit.
const longChain = { dependencyGraph: { edges: [] } };
for (let index = 0; index < 30_000; index += 1) {
  longChain.dependencyGraph.edges.push({ parentId: `L${index}`, childId: `L${index + 1}`, status: 'open' });
}
assert.equal(JSON.stringify(fresh.api.detectCycles(longChain)), '[]');
console.log(JSON.stringify({ suite: 'build340-dependency-differential', passed: true, graphProfiles: 250, operationsPerProfile: 250, cycleComparisons: 250, stackSafeChainEdges: 30_000 }, null, 2));
