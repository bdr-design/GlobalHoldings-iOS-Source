'use strict';
// Build 371 regression: a large fleet reaches the fleet thread as a replica in parts (fleet-engine-thread beginExport),
// one part per task, instead of one copy of every row in one main-thread block (500-900 ms at a million assets: the
// 128 MB copy, the major collection it set off, and a pass over every row for route keys). Here with 4-row parts on a
// 40-asset fleet, against a real worker and an independent reference store run by the same engine on the main thread:
// - a request made while the replica travels gets a pending ticket, posted once the replica is complete;
// - rows written on the main thread meanwhile (in parts already sent and in parts still to send) reach the worker;
// - the step's effects and the store after it equal the reference's, byte for byte;
// - a calendar window cannot begin while a replica travels, and begins once it is complete;
// - a stale replica (after a window rollback) travels again in parts, and the next step still equals the reference.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const FIX=require('./helpers/fleet-fixture');
const root=process.env.GH_AUDIT_ROOT||path.resolve(__dirname,'..'),web=path.join(root,'WebApp');
const read=file=>fs.readFileSync(path.join(web,file),'utf8');
const workerSource=['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js'].map(read).join('\n;\n')+'\n;\n'+read('fleet-engine-worker.js').replace(/^importScripts\([^)]*\);$/m,'');
const pageSources=['transaction-core.js','fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js','fleet-engine-thread.js'].map(read);

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<!doctype html><meta charset="utf-8">');
    for(const content of pageSources)await page.addScriptTag({content});
    const assets=[];for(let i=0;i<40;i++)assets.push(FIX.make('road','R1',{phase:i%2?'moving':'turnaround',progress:i%2?.1+i/100:0,dwellRemaining:i*61,reverse:i%3===0,baseFacility:i%3===0?'P-ROAD-B':'F-ROAD-A',salePending:false,releaseExclusiveRouteOnArrival:false}));
    const contexts=Array.from({length:4},(_,i)=>{const row=FIX.context(i*3600);row.economy={...row.economy,diesel:1.02+i*.01};return row;});
    const result=await page.evaluate(async({workerSource,assets,routes,contexts})=>{
      const STORE=GH_FLEET_STORE,EVENTS=GH_FLEET_EVENTS,TX=GH_TRANSACTION_CORE;
      const workerUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),messages=[];
      const workerFactory=()=>{const raw=new Worker(workerUrl);return {postMessage(message,transfer){messages.push(message.type);raw.postMessage(message,transfer);},terminate(){raw.terminate();},set onmessage(fn){raw.onmessage=fn;},set onerror(fn){raw.onerror=fn;},set onmessageerror(fn){raw.onmessageerror=fn;}};};
      const plans=new Map(Object.entries(routes)),resolveRoute=id=>plans.get(String(id))||null;
      const client=GH_FLEET_ENGINE_THREAD.create({workerFactory,resolveRoute,routesRevision:()=>0,catalogSpecs:()=>({}),timeoutMs:10000,replicaPartRows:4});
      const state={cash:1,fleet:STORE.fromAssets(assets,{at:0})},reference=STORE.importReplica(structuredClone(STORE.exportReplica(state.fleet)));
      const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
      const wait=async ticket=>{for(let i=0;i<10000&&ticket?.status==='pending';i++)await tick();return ticket;};
      const sameStore=(a,b)=>{const A=new Uint8Array(a.rows,0,a.length*STORE.STRIDE),B=new Uint8Array(b.rows,0,b.length*STORE.STRIDE);return a.length===b.length&&a.structure===b.structure&&JSON.stringify([...A])===JSON.stringify([...B])&&JSON.stringify(a.values)===JSON.stringify(b.values)&&JSON.stringify(a.extras)===JSON.stringify(b.extras);};
      const key=context=>JSON.stringify(context),out={};
      const write=(index,field,value)=>{STORE.set(state.fleet,index,field,value);STORE.set(reference,index,field,value);};
      const step=async(i)=>{
        const ticket=client.request(state.fleet,{from:i*3600,to:(i+1)*3600,context:contexts[i],contextKey:key(contexts[i]),tripAlertLimit:64,order:'sweep',budget:40000});
        if(!ticket)throw new Error(`request-${i}-null`);
        const deferred=!!ticket.deferred;
        return {ticket,deferred};
      };
      const applyStep=async(ticket,i)=>{
        await wait(ticket);if(ticket.status!=='ready')throw new Error(`ticket-${i}-${ticket.status}-${ticket.reason}`);
        let applied=null;const done=TX.execute(state,{label:`qa-staged-${i}`,scope:['cash'],apply(){applied=client.apply(ticket,state.fleet,{contextKey:key(contexts[i]),tx:TX});if(!applied)throw new Error(`apply-${i}-refused`);return true;}});
        if(!done.committed)throw new Error(`commit-${i}:${done.reason}`);
        const expected=EVENTS.advance(reference,{from:i*3600,to:(i+1)*3600,context:contexts[i],resolveRoute,tripAlertLimit:64,order:'sweep'});
        return {sameEffects:JSON.stringify(applied)===JSON.stringify(expected),sameStore:sameStore(state.fleet,reference)};
      };

      // 1. The first request: the replica travels in parts; rows written meanwhile in a part sent and in a part to come.
      const first=await step(0);out.firstDeferred=first.deferred;
      await tick();await tick();
      const partsSoFar=messages.filter(type=>type==='replica-part').length;
      write(1,'fuel',41.5);write(38,'fuel',42.5);write(20,'condition',77);
      out.partsBeforeWrites=partsSoFar;
      out.windowWhileTravelling=client.beginWindow(state.fleet,{from:3600,target:7200})===null;
      out.first=await applyStep(first.ticket,0);
      out.partsTotal=messages.filter(type=>type==='replica-part').length;
      out.order=messages.filter(type=>/^replica|^advance|^sync/.test(type)).slice(0,14);
      // 2. Steady state: the next step is an ordinary incremental one.
      const second=await step(1);out.secondDeferred=second.deferred;out.second=await applyStep(second.ticket,1);
      // 3. A window begins on the complete replica, then rolls back: the replica is stale and travels again in parts.
      const session=client.beginWindow(state.fleet,{from:7200,target:10800});out.windowAfter=!!session;
      if(session){client.settleWindow(session,'rollback');}
      const partsBefore=messages.filter(type=>type==='replica-part').length;
      const third=await step(2);out.thirdDeferred=third.deferred;out.third=await applyStep(third.ticket,2);
      out.partsAgain=messages.filter(type=>type==='replica-part').length-partsBefore;
      const stats=client.stats();out.stats={stagedSyncs:stats.stagedSyncs,fullSyncs:stats.fullSyncs,deferredRequests:stats.deferredRequests,windowDeferred:stats.windowDeferred,disabled:stats.disabled,fullSyncReasons:stats.fullSyncReasons};
      client.terminate('done');
      return out;
    },{workerSource,assets,routes:FIX.routes,contexts});
    assert.equal(result.firstDeferred,true,'the first request waits for the replica');
    assert(result.partsBeforeWrites>=1&&result.partsBeforeWrites<10,`writes land while the replica travels: ${result.partsBeforeWrites} of 10 parts sent`);
    assert.equal(result.partsTotal,10,'40 rows in 4-row parts');
    assert.equal(result.windowWhileTravelling,true,'no window while a replica travels');
    assert.deepEqual(result.first,{sameEffects:true,sameStore:true},'the deferred step equals the reference, rows written meanwhile included');
    assert.equal(result.secondDeferred,false,'the next request is an ordinary incremental one');
    assert.deepEqual(result.second,{sameEffects:true,sameStore:true});
    assert.equal(result.windowAfter,true,'a window begins on the complete replica');
    assert.equal(result.thirdDeferred,true,'a stale replica travels again');assert.equal(result.partsAgain,10);
    assert.deepEqual(result.third,{sameEffects:true,sameStore:true},'and the next step still equals the reference');
    assert.equal(result.stats.disabled,null);
    console.log(JSON.stringify({suite:'build371-staged-replica-browser',...result},null,1));
    console.log('BUILD371_STAGED_REPLICA_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
