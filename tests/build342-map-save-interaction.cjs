'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp/app.js'),'utf8');
function fragment(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,`missing app fragment ${start}`);return app.slice(a,b);}
const flushCode=fragment('  function flushMapDeferredSave(){','  function cancelSimulationPersistence(){');
const saveCode=fragment('  function persistStateNow(options={}){','  function save(){');
const pruneCode=fragment('  function pruneRouteCache(maxEntries=160){','  pruneRouteCache();');
const mapInit=fragment('    const setInteractionState=active=>','    renderMap();');
assert.match(mapInit,/map\.on\('movestart zoomstart dragstart'/);
assert.match(mapInit,/map\.on\('moveend dragend'/);
assert.match(mapInit,/map\.on\('zoomend'/);

const queued=[],calls={integrity:0,commit:0,compact:0,reconcile:0},state={simSeconds:90,saveRevision:4};
const sandbox={state,hardResetInProgress:false,durableCommandInProgress:false,APP_VERSION:'3.0.0',storageKey:'test-save',
  window:{__GH_APP_RUNTIME_INSTRUMENTATION__:{pendingCompaction:null},GH_PERSISTENCE:{isLocked:()=>false,commitState:()=>{calls.commit++;return {ok:true,utf8Bytes:100};}},GH_INTEGRITY_CORE:{check:()=>{calls.integrity++;return {issues:[]};}},requestIdleCallback:fn=>{queued.push(fn);return queued.length;},cancelIdleCallback:()=>{}},
  performance:{now:()=>10},console:{warn:()=>{}},pruneRouteCache:()=>calls.compact++,reconcileConsolidatedCash:()=>calls.reconcile++,diag:()=>{},setTimeout:fn=>{queued.push(fn);return queued.length;},clearTimeout:()=>{}};
vm.runInNewContext('let mapInteractionActive=true,mapSavePending=false,mapSaveFlushTask=null;'+flushCode+saveCode+'globalThis.mapTest={busy:value=>{mapInteractionActive=!!value},pending:()=>mapSavePending,save:options=>persistStateNow(options),flush:()=>flushMapDeferredSave()};',sandbox);

assert.equal(sandbox.mapTest.save(),true,'ordinary save is accepted into the deferred queue while the user drags');
assert.equal(sandbox.mapTest.pending(),true);
assert.deepEqual(calls,{integrity:0,commit:0,compact:0,reconcile:0},'gesture-time save does no full-state preparation or persistence');
sandbox.mapTest.busy(false);
assert.equal(sandbox.mapTest.flush(),true,'ending the gesture schedules the deferred save');
assert.equal(queued.length,1);
queued.shift()();
assert.equal(sandbox.mapTest.pending(),false);
assert.deepEqual(calls,{integrity:2,commit:1,compact:1,reconcile:1},'one bounded-idle flush performs exactly one complete save');

sandbox.mapTest.busy(true);
assert.equal(sandbox.mapTest.save({throwOnError:true,allowMapInteraction:true}),true,'background lifecycle saves retain their immediate durability path');
assert.equal(calls.commit,2);
console.log('Build342 map save interaction: defers expensive save work until gesture end and preserves background durability PASS');

function pruneFixture(state){
  const context={state};vm.runInNewContext(pruneCode+';globalThis.prune=pruneRouteCache;',context);return context.prune;
}
const route=(at)=>({distanceKm:100,cachedAtSim:at,route:[[0,0],[1,1]]});
const empty={assets:[new Proxy({}, {get(){throw new Error('empty cache must not scan assets');}})],customRoutes:[],routeCache:{}};
const emptyRef=empty.routeCache,pruneEmpty=pruneFixture(empty);
assert.equal(pruneEmpty(),false,'an empty cache requires no write');
assert.equal(empty.routeCache,emptyRef,'an empty cache keeps its original identity');

const populated={assets:[{routeId:'ACTIVE'}],customRoutes:[],routeCache:{IDLE:route(20),ACTIVE:route(10),INVALID:{distanceKm:'bad',route:[]}}};
const prunePopulated=pruneFixture(populated);
assert.equal(prunePopulated(),true,'invalid entries and changed priority require a real cache update');
assert.deepEqual(Object.keys(populated.routeCache),['ACTIVE','IDLE']);
const populatedRef=populated.routeCache;
assert.equal(prunePopulated(),false,'a second prune with the same ids, order and values is a no-op');
assert.equal(populated.routeCache,populatedRef,'no-op pruning preserves the saved cache reference');

globalThis.GH_KERNEL=require('../WebApp/kernel-core.js');
const TX=require('../WebApp/transaction-core.js');
const live=TX.enableKernelOwner({saveVersion:'2.0.0',assets:[{id:'A1',routeId:'ACTIVE'}],customRoutes:[],routeCache:{ACTIVE:route(10),IDLE:route(20)}});
const pruneLive=pruneFixture(live),revisionBefore=TX.inputRevision(live),cacheBefore=live.routeCache;
assert.equal(pruneLive(),false,'a canonical kernel cache remains unchanged');
assert.equal(TX.inputRevision(live),revisionBefore,'ordinary save preparation does not invalidate a pending simulation slice');
assert.equal(live.routeCache,cacheBefore);
live.routeCache.INVALID={distanceKm:'bad',route:[]};
const changedRevision=TX.inputRevision(live);
assert.equal(pruneLive(),true,'genuine invalid cache data must still be removed');
assert.equal(Object.hasOwn(live.routeCache,'INVALID'),false);
assert.equal(TX.inputRevision(live),changedRevision+1,'real cache pruning records one kernel input change');
console.log('Build343 route cache save pruning: unchanged kernel state stays stable; real removal commits PASS');
