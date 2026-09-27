'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp/app.js'),'utf8');
function fragment(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,`missing app fragment ${start}`);return app.slice(a,b);}
const flushCode=fragment('  function flushMapDeferredSave(){','  function cancelSimulationPersistence(){');
const saveCode=fragment('  function persistStateNow(options={}){','  function save(){');
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
