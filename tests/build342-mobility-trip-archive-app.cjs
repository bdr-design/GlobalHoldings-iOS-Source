'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const COLD=require('../WebApp/cold-archive-core.js');
const app=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8');
const start=app.indexOf('  const coldMobilityArchiveAdapter=');
const end=app.indexOf("  if(startupLoadMeta?.source===",start);
assert(start>=0&&end>start,'production Mobility archive path must remain in app.js');
const source=app.slice(start,end);

function clone(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
function setup({rejectAck=false,failWrite=false}={}){
  const files=new Map(),scheduled=[],warnings=[];let saveCount=0,ackRejected=rejectAck,writeRejected=failWrite;
  const adapter={
    async read(key){return files.has(key)?files.get(key):null;},
    async writeAtomic(key,value){if(writeRejected){writeRejected=false;throw new Error('injected-archive-write-failure');}files.set(key,value);},
    async remove(key){files.delete(key);},async keys(){return [...files.keys()];}
  };
  const state={resetEpoch:9,mobility:{tripArchivePending:[]}};
  const transaction={execute(target,spec){if(ackRejected)return {committed:false,reason:'injected-ack-rejection'};if(spec.validate&&!spec.validate())return {committed:false,reason:'stale-epoch'};const prior=clone(target.mobility);try{const value=spec.apply();return {committed:true,value};}catch(error){target.mobility=prior;throw error;}}};
  const window={GH_PERSISTENCE:{createColdArchiveAdapter:()=>adapter},GH_COLD_ARCHIVE:COLD,GH_TRANSACTION_CORE:transaction};
  const context={window,state,startupLoadMeta:{source:'none',needsCanonicalPersist:false},clone,save:()=>{saveCount++;return true;},
    setTimeout:(fn,delay)=>{const row={fn,delay,id:scheduled.length+1};scheduled.push(row);return row.id;},clearTimeout:()=>{},Map,Set,Promise,Number,Math,console:{warn:(...args)=>warnings.push(args),error:console.error},Error,String,Array};
  vm.runInNewContext(source,context,{filename:'app-cold-mobility-archive.js'});
  state.mobility.tripArchivePending=Array.from({length:130},(_,index)=>({id:`TRIP-${String(index).padStart(4,'0')}`,fare:100,driverPayout:10,platformRevenue:74}));
  return {state,window,scheduled,files,adapter,get saveCount(){return saveCount;},get warningCount(){return warnings.length;},reject(value){ackRejected=value;}};
}

(async()=>{
  {
    const x=setup(),first=await x.window.GH_MOBILITY_ARCHIVE.flush();
    assert.deepEqual(JSON.parse(JSON.stringify(first)),{ok:true,archived:128,remaining:2});
    assert.equal(x.state.mobility.tripArchivePending.length,2,'hot overflow is removed only after the archive index is durably acknowledged');
    assert.equal(x.saveCount,1,'hot-state deletion is persisted after the archive receipt commit');
    assert.equal(x.scheduled.length,1,'remaining cold writes resume through the bounded background queue');
    const second=await x.window.GH_MOBILITY_ARCHIVE.flush();assert.equal(second.archived,2);assert.equal(second.remaining,0);
    assert.equal((await x.window.GH_MOBILITY_ARCHIVE.readAll()).length,130,'the app archive read path verifies and returns every original receipt');
  }
  {
    const x=setup(),bucket='mobility-trip-receipts-e9-s000000',archive=COLD.create({adapter:x.adapter,bucket,idFor:row=>row.id});
    await archive.append(Array.from({length:4090},(_,index)=>({id:`OLD-${String(index).padStart(5,'0')}`,fare:100})));
    const first=await x.window.GH_MOBILITY_ARCHIVE.flush();assert.equal(first.remaining,2);assert.equal(x.state.mobility.tripArchiveSegment,1,'a nearly full native index rolls the app cursor forward only after durable acknowledgement');
    const firstMeta=await x.window.GH_MOBILITY_ARCHIVE.metadata();assert.equal(firstMeta.count,4218);assert.equal(firstMeta.segments,2,'each A/B archive index stays below the per-file native size limit');
    await x.window.GH_MOBILITY_ARCHIVE.flush();const rows=await x.window.GH_MOBILITY_ARCHIVE.readAll();assert.equal(rows.length,4220,'readAll spans every committed archive segment in chronological order');
  }
  {
    const x=setup({rejectAck:true}),failed=await x.window.GH_MOBILITY_ARCHIVE.flush();
    assert.equal(failed.ok,false);assert.equal(x.state.mobility.tripArchivePending.length,130,'rejected atomic acknowledgement retains every hot receipt');
    assert.equal(x.warningCount,1,'failed acknowledgement is surfaced for diagnostics and retry');
    assert.equal((await x.window.GH_MOBILITY_ARCHIVE.readAll()).length,128,'durable receipts remain available after the app transaction rejects');
    x.reject(false);const retry=await x.window.GH_MOBILITY_ARCHIVE.flush();assert.equal(retry.ok,true);assert.equal(retry.archived,128,'retry is idempotent after the archive write succeeded but state acknowledgement failed');
  }
  {
    const x=setup({failWrite:true}),failed=await x.window.GH_MOBILITY_ARCHIVE.flush();
    assert.equal(failed.ok,false);assert.equal(x.warningCount,1,'failed archive storage is surfaced for diagnostics and retry');assert.equal(x.state.mobility.tripArchivePending.length,130,'archive write failure cannot discard hot receipts');
    const retry=await x.window.GH_MOBILITY_ARCHIVE.flush();assert.equal(retry.ok,true);assert.equal(x.state.mobility.tripArchivePending.length,2);
  }
  console.log('Build342 Mobility app archive path: bounded flush, transactional ack, retry after durable-write and ack failures, verified rehydrate PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
