'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = process.env.GH_TEST_SOURCE_DIR || path.resolve(__dirname, '../..');
function harness(names = []) {
  const data = new Map(), listeners = new Map();
  const storage = {
    get length() { return data.size; }, key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.get(k) ?? null; }, setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); }, clear() { data.clear(); }
  };
  const s = {console, structuredClone, TextEncoder, TextDecoder, setTimeout, clearTimeout,
    performance, Blob, URL, AbortController, localStorage: storage, sessionStorage: storage,
    addEventListener(n, fn) { const a = listeners.get(n) || []; a.push(fn); listeners.set(n, a); },
    dispatchEvent(e) { for (const fn of listeners.get(e.type) || []) fn(e); },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o.detail; } }
  };
  s.window = s; s.globalThis = s; vm.createContext(s);
  const load = n => vm.runInContext(fs.readFileSync(path.join(ROOT, 'WebApp', n + '.js'), 'utf8'), s, {filename: n + '.js'});
  names.forEach(load);
  return {s, data, storage, load};
}
function minimal() {
  return {saveVersion: '2.0.0', saveRevision: 1, resetEpoch: 0, simSeconds: 0,
    assets: [], market: [], advanced: {}, companyFinance: {}, openedCompanies: [],
    globalBases: [], customHubs: [], crew: [],
    finance: {invoices: [], cheques: [], payables: [], receivables: [], periods: []},
    treasury: {accounts: [{id: 'GH-OPER-001', balance: 1000000}, {id: 'GH-RES-002', balance: 0}, {id: 'GH-INV-003', balance: 0}], ledger: []}};
}
module.exports = {ROOT, harness, minimal};
