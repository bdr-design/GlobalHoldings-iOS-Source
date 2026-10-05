'use strict';
// Build 359, iPhone diagnostic: every save spent 49-153 ms in the save-schema check, much of it stringifying and UTF-8
// encoding the two proof archives (13 MB + 2.3 MB) and every route to compare them with their byte limits. A sealed
// (deep-frozen) archive member is now measured once and its size kept by identity, the map's size being exactly its
// JSON's size; a route is measured from its other fields plus a bound per checked point, and stringified only near
// its limit. The limits are unchanged: an archive or route over its limit is still refused.
const assert=require('node:assert/strict');
const path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require('./helpers/core-harness');
const {s}=harness(['transaction-core','save-schema']),M=s.GH_SAVE_SCHEMA.measure,T=s.GH_TRANSACTION_CORE;
T.registerSealedCollections('documentProofs',['archiveById']);
const exact=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
// Exact size of a map, sealed or not, with Arabic text, emoji, escapes and skipped values.
const record=i=>({id:`DOC-${i}`,label:'فاتورة نقل جوي 🚢 "مقتبس"\n',amount:i*1.5,lines:[{q:1,p:i}],nested:{ok:true,none:null}});
const plain={};for(let i=0;i<300;i++)plain[`DOC-${i}`]=record(i);plain.skip=undefined;plain['مفتاح']=record(-1);
assert.equal(M.mapBytes(plain),exact(plain),'unsealed map');
const state={documentProofs:{archiveById:{}}};for(let i=0;i<300;i++)state.documentProofs.archiveById[`DOC-${i}`]=record(i);T.sealCollections(state);
const archive=state.documentProofs.archiveById;assert.ok(T.isSealed(archive['DOC-1']),'archive members are sealed');
assert.equal(M.mapBytes(archive),exact(archive),'sealed map');assert.equal(M.mapBytes(archive),exact(archive),'sealed map, measured again from the cache');
assert.equal(M.mapBytes({}),2);
// A sealed member is stringified once, however many times the map is measured.
{const RJSON=require('node:vm').runInContext('JSON',s),original=RJSON.stringify;let calls=0;RJSON.stringify=(...args)=>{calls++;return original(...args);};
 const fresh={documentProofs:{archiveById:{}}};for(let i=0;i<300;i++)fresh.documentProofs.archiveById[`N-${i}`]=record(i);T.sealCollections(fresh);
 try{M.mapBytes(fresh.documentProofs.archiveById);const first=calls;calls=0;for(let i=0;i<5;i++)M.mapBytes(fresh.documentProofs.archiveById);assert.ok(calls<=5*300,`later measurements stringify keys only (${calls} calls for 5 passes)`);
  assert.ok(first>=600,`the first measurement stringifies each key and member (${first})`);}finally{RJSON.stringify=original;}}
// Routes: the bound accepts a normal route, refuses one over the limit, and measures exactly near the limit.
const limit=256*1024,route=n=>({id:'R1',mode:'air',fromFacility:'A',toFacility:'B',route:Array.from({length:n},(_,i)=>[-89.123456789012+i*1e-3,179.12345678901234-i*1e-3])});
assert.equal(M.routeWithinBytes(route(2048),limit),exact(route(2048))<=limit);
const big=route(9000);assert.equal(exact(big)>limit,true);assert.equal(M.routeWithinBytes(big,limit),false,'a route over its byte limit is refused');
const near=route(Math.floor(limit/44));assert.equal(M.routeWithinBytes(near,limit),exact(near)<=limit,'near the limit the route is measured exactly');
const extra={...route(10),route:[[1,2,'x'.repeat(limit)],[3,4]]};assert.equal(M.routeWithinBytes(extra,limit),false,'longer points are measured exactly');
console.log('build359 schema byte limits: exact map sizes, sealed members measured once, route bounds keep the limit');
