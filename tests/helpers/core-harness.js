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
  const s = {console, structuredClone, TextEncoder, TextDecoder, btoa, atob, setTimeout, clearTimeout,
    performance, Blob, URL, AbortController, localStorage: storage, sessionStorage: storage,
    addEventListener(n, fn) { const a = listeners.get(n) || []; a.push(fn); listeners.set(n, a); },
    dispatchEvent(e) { for (const fn of listeners.get(e.type) || []) fn(e); },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o.detail; } }
  };
  s.window = s; s.globalThis = s; vm.createContext(s);
  // Test callbacks originate in Node's realm. Normalize cloned ArrayBuffers
  // back into the VM realm so store type checks behave like browser globals.
  const RealmArrayBuffer=vm.runInContext('ArrayBuffer',s),nativeStructuredClone=structuredClone;
  s.structuredClone=value=>{
    const copy=nativeStructuredClone(value),seen=new WeakMap();
    const localize=node=>{
      if(!node||typeof node!=='object')return node;
      if(Object.prototype.toString.call(node)==='[object ArrayBuffer]'){
        const buffer=new RealmArrayBuffer(node.byteLength);new Uint8Array(buffer).set(new Uint8Array(node));return buffer;
      }
      if(seen.has(node))return seen.get(node);seen.set(node,node);
      for(const key of Object.keys(node)){
        const child=node[key],localized=localize(child);if(localized!==child)node[key]=localized;
      }
      return node;
    };
    return localize(copy);
  };
  const loaded=new Set();
  // Every owner reads and writes the fleet through Fleet Data Access (Build 355).
  const load = n => {if(loaded.has(n))return;if(n!=='fleet-store-core'&&n!=='fleet-access-core'&&!loaded.has('fleet-access-core')){load('fleet-store-core');load('fleet-access-core');}if(n==='simulation-core'){if(!loaded.has('simulation-asset-core'))load('simulation-asset-core');if(!loaded.has('fleet-event-core'))load('fleet-event-core');if(!loaded.has('simulation-time-core'))load('simulation-time-core');if(!loaded.has('simulation-pacing-core'))load('simulation-pacing-core');}vm.runInContext(fs.readFileSync(path.join(ROOT, 'WebApp', n + '.js'), 'utf8'), s, {filename: n + '.js'});loaded.add(n);};
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
