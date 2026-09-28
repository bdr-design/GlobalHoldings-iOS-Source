'use strict';
const assert=require('assert');
const crypto=require('crypto');

global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
global.performance=global.performance||require('perf_hooks').performance;
global.GH_SAVE_SCHEMA={validate(){return {ok:true,errors:[]};}};
let inputRevision=0;
global.GH_TRANSACTION_CORE={isKernelOwner(){return false;},inputRevision(){return inputRevision;}};
global.GH_CONTROL_PLANE={sha256(text){return crypto.createHash('sha256').update(String(text)).digest('hex');}};
global.CustomEvent=class CustomEvent{constructor(type,options={}){this.type=type;this.detail=options.detail;}};
global.addEventListener=()=>{};
global.dispatchEvent=()=>{};

let persistence=null;
const packets=[];
global.webkit={messageHandlers:{saveBridge:{postMessage(packet){
  packets.push(packet);
  if(packet.action==='saveStreamCommit'){
    const chunks=packets.filter(row=>row.requestId===packet.requestId&&row.action==='saveStreamChunk').sort((a,b)=>a.index-b.index);
    const json=chunks.map(row=>row.text).join('');
    const hash=crypto.createHash('sha256').update(json).digest('hex');
    queueMicrotask(()=>persistence.receiveAck({
      action:'commitSave',requestId:packet.requestId,saveRevision:packet.saveRevision,resetEpoch:packet.resetEpoch,
      saveHash:hash,saveSchemaVersion:'2.0.0',success:true,generation:1,nativeVaultCommitMs:1
    }));
  }
}}}};

persistence=require('../WebApp/persistence-core.js');

async function serializerParity(){
  const sample={
    z:'مرحبا 🌍',a:1,b:true,c:null,d:undefined,e:NaN,f:Infinity,
    arr:[1,undefined,'x',null,false,{q:'\"\\\n'}],
    nested:{b:2,a:1,skip:undefined},
    date:{toJSON(){return 'serialized';}}
  };
  const chunks=[];
  const stats=await persistence.__testCooperativeJSONStream(sample,(text,index,bytes)=>chunks.push({text,index,bytes}),{budgetMs:1,guard:()=>true});
  assert.strictEqual(chunks.map(row=>row.text).join(''),JSON.stringify(sample));
  assert(stats.chunks>=1);
  assert(chunks.every(row=>Buffer.byteLength(row.text,'utf8')<=128*1024));
  let guard=true;
  const guarded=[];
  await assert.rejects(()=>persistence.__testCooperativeJSONStream({rows:Array.from({length:5000},(_,i)=>({i,v:'x'.repeat(20)}))},(text)=>{guarded.push(text);guard=false;},{budgetMs:1,guard:()=>guard}),/save-snapshot-revision-conflict/);
}

async function ordinaryNativeStream(){
  packets.length=0;
  // >4 MiB keeps the compatibility localStorage mirror intentionally bypassed.
  const rows=Array.from({length:230000},(_,i)=>'row-'+String(i).padStart(7,'0')+'-abcdefgh');
  const state={saveVersion:'2.0.0',saveRevision:0,resetEpoch:3,simSeconds:12345,rows};
  const out=persistence.commitState(state,{appVersion:'3.0.4',streamBudgetMs:2});
  assert.strictEqual(out.ok,true);
  assert(out.native&&typeof out.native.then==='function');
  const ack=await out.native;
  assert.strictEqual(ack.ok,true);
  assert.strictEqual(state.saveRevision,1);
  const begin=packets.find(row=>row.action==='saveStreamBegin');
  const commit=packets.find(row=>row.action==='saveStreamCommit');
  const chunks=packets.filter(row=>row.action==='saveStreamChunk');
  assert(begin&&commit&&chunks.length>1);
  assert(!packets.some(row=>Object.prototype.hasOwnProperty.call(row,'saveJSON')));
  assert(chunks.every(row=>Buffer.byteLength(row.text,'utf8')<=128*1024));
  const restored=JSON.parse(chunks.sort((a,b)=>a.index-b.index).map(row=>row.text).join(''));
  assert.deepStrictEqual(restored,state);
  assert.strictEqual(commit.chunks,chunks.length);
  assert.strictEqual(commit.utf8Bytes,Buffer.byteLength(JSON.stringify(state),'utf8'));
  const timing=persistence.telemetry().timings.lastSaveBreakdown;
  assert.strictEqual(timing.kind,'ordinary-save-stream-complete');
  assert(timing.serializationYields>0);
  assert(timing.streamChunks===chunks.length);
  console.log(JSON.stringify({streamChunks:chunks.length,utf8Bytes:commit.utf8Bytes,serializationCpuMs:timing.stringifyMs,maxSerializationSliceMs:timing.maxSerializationSliceMs,yields:timing.serializationYields}));
}

function sourceContracts(){
  const fs=require('fs');
  const app=fs.readFileSync(require.resolve('../WebApp/app.js'),'utf8');
  assert(!app.includes("deliveryWorkPending=hasBoundary?true:"));
  assert(app.includes("deliveryWorkPending=window.GH_REALISM?.hasPendingDeliveries?.(state)!==false"));
  assert(app.includes("mobilityStreetReady.set(request.key"));
  assert(app.includes("flushMobilityStreetRoutes();"));
  assert(app.includes("isSnapshotting?.()"));
  const sig=app.match(/function mapStructureSignature\(\)\{[^\n]+/g)?.[0]||'';
  assert(sig&&!sig.includes('state.saveRevision'));
  const saveStart=app.indexOf('function persistStateNow(options={})');
  const saveEnd=app.indexOf('function save(){',saveStart);
  assert(saveStart>=0&&saveEnd>saveStart,'persistStateNow source must be locatable');
  const saveBody=app.slice(saveStart,saveEnd);
  assert(!saveBody.includes('pruneRouteCache('),'ordinary save must not mutate route cache');
  assert(!saveBody.includes('reconcileConsolidatedCash('),'ordinary save must not reconcile finance');
  assert(!saveBody.includes('GH_INTEGRITY_CORE.check('),'ordinary save must not duplicate business-integrity scans');
  assert(saveBody.includes('readOnlySnapshot:true'),'save metric must expose the read-only contract');
  const controller=fs.readFileSync(require.resolve('../iOS/GlobalHoldings/GameViewController.swift'),'utf8');
  assert(controller.includes('case "saveStreamBegin", "saveStreamChunk", "saveStreamAbort", "saveStreamCommit":'));
  assert(controller.includes('commitNativeSave(json: json, envelope: envelope'));
  assert(controller.includes('saveStream.invalidate(document: nativeNavigationToken)'));
}

(async()=>{
  sourceContracts();
  await serializerParity();
  await ordinaryNativeStream();
  console.log('BUILD346_ROOT_CLEANUP PASS');
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
