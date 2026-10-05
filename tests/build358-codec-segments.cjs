'use strict';
// Build 358: the iPhone diagnostic (27,000 assets) showed a save every ~20 s freezing the screen for up to 284 ms,
// most of it re-encoding the sealed proof store (17 MB) because one new document invalidated its cached text.
// Large collections are now written in 256-row segments; a save re-encodes only the segments whose members changed.
const assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
require(path.join(root,'WebApp/transaction-core.js'));
const C=require(path.join(root,'WebApp/state-codec-core.js')),T=globalThis.GH_TRANSACTION_CORE;
T.registerSealedCollections('documentProofs',['recordsById']);
const record=i=>({id:`DOC-${i}`,kind:'invoice',company:['air','sea','road'][i%3],amount:1000+i,issuedAt:i*60,digest:`${'d'.repeat(40)}${i}`,signature:{ref:'SIG-1',version:1},lines:[{label:'خدمة نقل',qty:1,price:1000+i}]});
const state={documentProofs:{recordsById:{}},finance:{invoices:[]},profile:{name:'Fixture'}};
for(let i=0;i<5000;i++)state.documentProofs.recordsById[`DOC-${i}`]=record(i);
for(let i=0;i<1200;i++)state.finance.invoices.push({number:`INV-${i}`,amount:i,status:i%2?'paid':'open',company:'air'});
T.sealCollections(state);

const first=C.serialize(state);
assert.equal(first,JSON.stringify(C.encodeState(state)),'cached text is byte-for-byte the plain encoding');
const tree=JSON.parse(first);
assert.equal(tree.stateCodec.version,'gh-shape-3','a save with segments carries the segment version');
assert.equal(tree.documentProofs.recordsById.$gh,3);assert.equal(tree.documentProofs.recordsById.g.length,Math.ceil(5000/256));
assert.equal(tree.finance.invoices.$gh,3);assert.equal(tree.finance.invoices.a,1);
assert.deepEqual(C.deserialize(first),JSON.parse(JSON.stringify(state)),'decode(encode(state)) is the state');

const before=C.cacheStats();
state.documentProofs.recordsById['DOC-new']=record(99999);T.sealCollections(state);
const second=C.serialize(state),after=C.cacheStats();
assert.equal(second,JSON.stringify(C.encodeState(state)));
assert.equal(after.misses-before.misses,1,'one new document re-encodes one segment, not the whole store');
assert.equal(after.hits-before.hits,Math.ceil(5000/256)-1);
assert.equal(C.deserialize(second).documentProofs.recordsById['DOC-new'].amount,100999);

// A small collection keeps the earlier form, and a save written before segments still loads.
const small={documentProofs:{recordsById:Object.fromEntries(Array.from({length:80},(_,i)=>[`D${i}`,record(i)]))}};
const smallTree=JSON.parse(C.serialize(small));assert.equal(smallTree.documentProofs.recordsById.$gh,2);assert.equal(smallTree.stateCodec.version,'gh-shape-1');
assert.deepEqual(C.deserialize(JSON.stringify(smallTree)),JSON.parse(JSON.stringify(small)));

// Corrupt segments are refused, never half-read.
const bad=JSON.parse(first);bad.documentProofs.recordsById.g[1].$gh=1;
assert.throws(()=>C.deserialize(JSON.stringify(bad)),/segment/);
const dup=JSON.parse(first);dup.documentProofs.recordsById.g[1]=dup.documentProofs.recordsById.g[0];
assert.throws(()=>C.deserialize(JSON.stringify(dup)),/segment-duplicate-key/);
console.log('PASS build358-codec-segments: segmented collections are byte-identical, round-trip, and re-encode only the changed segment');
