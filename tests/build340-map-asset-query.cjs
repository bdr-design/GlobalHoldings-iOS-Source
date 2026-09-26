'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../WebApp/map-asset-query-core.js');

const known=new Set(['air','sea']);
const rows=Array.from({length:20000},(_,index)=>({
  id:`asset-${index}`,
  ownerCompanyId:index%7===0?'unknown':index%3===0?'sea':index%11===0?'': 'air'
}));
const snapshot=core.buildOwnershipIndex(rows,{ownerOf:row=>row.ownerCompanyId,isKnownOwner:owner=>known.has(owner)});
const included=core.filterVisibleIndices(snapshot,{mode:'include',included:['air']});
const excluded=core.filterVisibleIndices(snapshot,{mode:'all',excluded:['sea']});
const expectedIncluded=rows.flatMap((row,index)=>row.ownerCompanyId==='air'?[index]:[]);
const expectedExcluded=rows.flatMap((row,index)=>row.ownerCompanyId==='air'?[index]:[]);
assert.deepEqual([...included],expectedIncluded,'20k include query keeps only known air rows in stable source order');
assert.deepEqual([...excluded],expectedExcluded,'20k exclusion rejects sea, unknown and ownerless rows');
assert.equal(new Set(included).size,included.length,'index has no duplicate asset rows');
assert.equal(snapshot.ownerCodes.length,20000,'worker snapshot preserves the full 20k row domain');
assert.equal(snapshot.ownerCodes.byteLength,80000,'worker index stays compact and numeric');
assert.deepEqual([...core.filterVisibleIndices(snapshot,{mode:'include',included:['missing']})],[],'unknown filter owner yields an empty result');
assert.equal(core.filterKey({mode:'include',included:['sea','air','air']}),core.filterKey({mode:'include',included:['air','sea']}),'filter keys are canonical');

class FakeWorker{
  constructor(delay=0){this.delay=delay;this.index=null;this.terminated=false;}
  postMessage(message){
    if(this.terminated)return;
    if(message.type==='index'){this.index={generation:message.generation,ownerCodes:message.ownerCodes,companyIds:message.companyIds,knownCodes:message.knownCodes};return;}
    if(message.type==='query'){
      const index=this.index;
      setTimeout(()=>{
        if(this.terminated)return;
        try{
          const indices=core.filterVisibleIndices(index,message.filter);
          this.onmessage?.({data:{type:'result',requestId:message.requestId,generation:message.generation,filterKey:core.filterKey(message.filter),indices}});
        }catch(error){this.onmessage?.({data:{type:'error',requestId:message.requestId,generation:message.generation,error:error.message}});}
      },this.delay);
    }
  }
  terminate(){this.terminated=true;}
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function testAsyncLifecycle(){
  const worker=new FakeWorker(5),completions=[];
  const engine=core.create({workerFactory:()=>worker,timeoutMs:1000,onResult:result=>completions.push(result)});
  const filter={mode:'include',included:['sea']};
  const first=engine.request({assets:rows,revision:4,filter,ownerOf:row=>row.ownerCompanyId,isKnownOwner:owner=>known.has(owner)});
  assert.equal(first.ready,false,'first query renders from the bounded fallback while the worker warms');
  assert.deepEqual([...first.indices],[...core.filterVisibleIndices(snapshot,filter)],'fallback equals the core reference result');
  assert.equal(engine.request({assets:rows,revision:4,filter,ownerOf:row=>row.ownerCompanyId,isKnownOwner:owner=>known.has(owner)}).pending,true,'duplicate requests coalesce');
  await wait(15);
  const ready=engine.request({assets:rows,revision:4,filter,ownerOf:row=>row.ownerCompanyId,isKnownOwner:owner=>known.has(owner)});
  assert.equal(ready.ready,true,'worker result becomes the cached response');
  assert.deepEqual([...ready.indices],[...first.indices],'worker and fallback preserve exact indices');
  assert.equal(completions.length,1,'one worker completion is published');

  const nextRows=rows.slice(0,4300),nextFilter={mode:'all',excluded:['sea']};
  const stale=engine.request({assets:rows,revision:4,filter:{mode:'all'},ownerOf:row=>row.ownerCompanyId,isKnownOwner:owner=>known.has(owner)});
  assert.equal(stale.ready,false,'new filter query is asynchronous');
  const latest=engine.request({assets:nextRows,revision:5,filter:nextFilter,ownerOf:row=>row.ownerCompanyId,isKnownOwner:owner=>known.has(owner)});
  assert.equal(latest.ready,false,'new source supersedes pending result');
  await wait(20);
  const current=engine.request({assets:nextRows,revision:5,filter:nextFilter,ownerOf:row=>row.ownerCompanyId,isKnownOwner:owner=>known.has(owner)});
  assert.equal(current.ready,true,'latest source is indexed');
  assert.deepEqual([...current.indices],[...core.filterVisibleIndices(core.buildOwnershipIndex(nextRows,{ownerOf:row=>row.ownerCompanyId,isKnownOwner:owner=>known.has(owner)}),nextFilter)],'fresh index is exact after source replacement');
  assert.equal(completions.at(-1).assets,nextRows,'stale source result never replaces current asset data');
  engine.disable();assert.equal(worker.terminated,true,'worker shutdown is supported');
}

async function testFallback(){
  let failures=0;
  const engine=core.create({workerFactory:()=>{throw new Error('worker-not-supported');},onFailure:()=>failures++});
  const result=engine.request({assets:rows,revision:1,filter:{mode:'include',included:['air']},ownerOf:row=>row.ownerCompanyId,isKnownOwner:owner=>known.has(owner)});
  assert.equal(result.indices,null,'unavailable worker asks caller to use its tested main-thread fallback');
  assert.equal(engine.isDisabled(),true,'a worker creation failure disables retries for this session');
  assert.equal(failures,1,'worker failure is reported once');

  let invalidEngine,invalidFailures=0;
  const invalidWorker={postMessage(message){if(message.type==='query')setTimeout(()=>invalidWorker.onmessage?.({data:{type:'result',requestId:message.requestId,generation:message.generation,filterKey:core.filterKey(message.filter),indices:new Uint32Array([3,1])}}),0);},terminate(){this.terminated=true;}};
  invalidEngine=core.create({workerFactory:()=>invalidWorker,onFailure:()=>invalidFailures++});
  invalidEngine.request({assets:rows.slice(0,5),revision:2,filter:{mode:'all'},ownerOf:row=>row.ownerCompanyId,isKnownOwner:owner=>known.has(owner)});
  await wait(10);
  assert.equal(invalidEngine.isDisabled(),true,'unordered worker indexes disable the worker before rendering corrupted rows');
  assert.equal(invalidFailures,1,'invalid worker output triggers fallback exactly once');
}

function testWorkerMessageContract(){
  const workerPath=path.join(__dirname,'../WebApp/map-asset-query-worker.js'),workerSource=fs.readFileSync(workerPath,'utf8'),sent=[];
  const context={Uint8Array,Uint32Array,Array,Map,Set,Number,String,TypeError,Error,Math,Promise,console};
  context.self=context;context.globalThis=context;
  context.importScripts=()=>{context.GH_MAP_ASSET_QUERY_CORE=core;};
  context.addEventListener=(type,listener)=>{if(type==='message')context.receive=listener;};
  context.postMessage=(message,transfer=[])=>sent.push({message,transfer});
  vm.runInNewContext(workerSource,context,{filename:workerPath});
  const smallRows=[{ownerCompanyId:'air'},{ownerCompanyId:'sea'},{ownerCompanyId:'unknown'},{ownerCompanyId:''}],small=core.buildOwnershipIndex(smallRows,{ownerOf:row=>row.ownerCompanyId,isKnownOwner:owner=>known.has(owner)});
  context.receive({data:{type:'index',generation:1,ownerCodes:small.ownerCodes,companyIds:small.companyIds,knownCodes:small.knownCodes}});
  context.receive({data:{type:'query',generation:1,requestId:8,filter:{mode:'include',included:['air']}}});
  assert.equal(sent.length,1,'worker emits one result message');
  assert.equal(sent[0].message.type,'result');
  assert.deepEqual([...sent[0].message.indices],[0],'worker query preserves row index semantics');
  assert.equal(sent[0].message.requestId,8,'request identity crosses worker boundary');
  context.receive({data:{type:'query',generation:0,requestId:9,filter:{mode:'all'}}});
  assert.equal(sent[1].message.type,'error','worker rejects stale generations');
}

function testRuntimeWiring(){
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'WebApp/index.html'),'utf8'),app=fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8'),runtime=JSON.parse(fs.readFileSync(path.join(root,'WebApp/runtime-required.json'),'utf8'));
  assert.match(html,/worker-src 'self'/,'CSP allows only same-origin worker scripts');
  assert.match(html,/map-asset-query-core\.js/,'map query core loads before the app');
  assert.ok(html.indexOf('map-asset-query-core.js')<html.indexOf('app.js'),'map worker interface loads before map rendering');
  assert.match(app,/new Worker\('map-asset-query-worker\.js'\)/,'app creates a same-origin worker');
  assert.match(app,/function mapVisibleAssetRows\(filterState\)/,'map asset queries cross the separate engine boundary');
  assert.match(app,/mapAssetQueryEngine\.request\(/,'map render submits a worker query');
  assert.ok(runtime.files.includes('map-asset-query-core.js')&&runtime.files.includes('map-asset-query-worker.js'),'native staged runtime requires both worker files');
}

(async()=>{
  await testAsyncLifecycle();
  await testFallback();
  testWorkerMessageContract();
  testRuntimeWiring();
  console.log('Build 340 map asset query: 20k ownership/filter, 4.3k source replacement, stable order, worker contract, stale response rejection, and fallback PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
