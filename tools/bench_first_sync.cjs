'use strict';
// Focused benchmark (a tool, not an acceptance gate): the main thread's longest task from the first fleet-thread request
// until its step is ready, on <rows> road rows (default 1,000,000) with a real worker and no game around it. A heap of
// <heapObjects> small objects (default 1,500,000, ~250 MB like the game's) stands in for the game's, so the collections a
// large allocation sets off cost what they cost in play. GH_SEED=1 (default) gives the store the native vault's chunks as
// its seed (Build 372: a native save's first replica); GH_SEED=0 measures the whole copy a store without one takes.
// Prints one JSON line: ticket status, request call and ready times, worst frame gap, long tasks, and the thread's stats.
// Run: [GH_ROOT=<source tree>] [GH_SEED=0|1] NODE_PATH=<node_modules with playwright> node tools/bench_first_sync.cjs [rows] [heapObjects]
// GH_ROOT selects the source tree measured (default: this one), so two builds compare on one machine.
const fs=require('node:fs'),path=require('node:path');
const root=process.env.GH_ROOT||path.resolve(__dirname,'..'),web=path.join(root,'WebApp'),read=f=>fs.readFileSync(path.join(web,f),'utf8');
const {chromium}=require('playwright');const FIX=require(path.join(root,'tests/helpers/fleet-fixture'));
const workerSource=['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js'].map(read).join('\n;\n')+'\n;\n'+read('fleet-engine-worker.js').replace(/^importScripts\([^)]*\);$/m,'');
const pageSources=['transaction-core.js','fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js','fleet-engine-thread.js'].map(read);
const N=Number(process.argv[2]||1000000),HEAP=Number(process.argv[3]??1500000),SEED=process.env.GH_SEED!=='0';
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<!doctype html><meta charset="utf-8">');
    for(const content of pageSources)await page.addScriptTag({content});
    const template=FIX.make('road','R1',{phase:'moving',progress:.2,releaseExclusiveRouteOnArrival:false});
    const out=await page.evaluate(async({workerSource,template,routes,context,N,HEAP,SEED})=>{
      const STORE=GH_FLEET_STORE;const assets=[];for(let i=0;i<N;i++){const a=structuredClone(template);a.id=`B-${i}`;a.name=`B ${i}`;a.progress=(i%97)/97;if(i%250===0)a.note='x';assets.push(a);}
      const state={fleet:STORE.fromAssets(assets,{at:0})};assets.length=0;
      let seeded=false;if(SEED&&typeof STORE.setReplicaSeed==='function'){const chunkBytes=4*1024*1024,byteLength=state.fleet.length*STORE.STRIDE,chunks=[];for(let at=0;at<byteLength;at+=chunkBytes)chunks.push(state.fleet.rows.slice(at,Math.min(byteLength,at+chunkBytes)));seeded=STORE.setReplicaSeed(state.fleet,{chunks,chunkBytes,byteLength});}
      window.__heap=[];for(let i=0;i<HEAP;i++)window.__heap.push({a:i,b:'x'+i,c:[i,i+1]});
      const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),plans=new Map(Object.entries(routes));
      const client=GH_FLEET_ENGINE_THREAD.create({workerFactory:()=>new Worker(url),resolveRoute:id=>plans.get(String(id))||null,routesRevision:()=>0,catalogSpecs:()=>({}),timeoutMs:120000});
      await new Promise(r=>setTimeout(r,500));
      const long=[];const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())long.push(Math.round(e.duration));});observer.observe({entryTypes:['longtask']});
      let gap=0,last=performance.now(),running=true;const frame=now=>{gap=Math.max(gap,now-last);last=now;if(running)requestAnimationFrame(frame);};requestAnimationFrame(frame);
      const started=performance.now();
      const ticket=client.request(state.fleet,{from:0,to:60,context,contextKey:'k',tripAlertLimit:64,order:'events',maxEvents:1500,budget:1500});
      const callMs=performance.now()-started;
      for(let i=0;i<100000&&ticket?.status==='pending';i++)await new Promise(r=>setTimeout(r,5));
      const readyMs=performance.now()-started,status=ticket?.status;await new Promise(r=>setTimeout(r,300));running=false;observer.disconnect();
      const s=client.stats();client.terminate('done');
      return {seeded,status,requestCallMs:Math.round(callMs),readyMs:Math.round(readyMs),worstFrameGapMs:Math.round(gap),longTasks:long.sort((a,b)=>b-a).slice(0,8),longTaskCount:long.length,longTaskTotal:long.reduce((a,b)=>a+b,0),maxSyncMs:Math.round(s.maxSyncMs),fullSyncs:s.fullSyncs,seedSyncs:s.seedSyncs,maxSeedSyncMs:s.maxSeedSyncMs,maxFullSyncMs:s.maxFullSyncMs,maxRouteAnswerMs:s.maxRouteAnswerMs,lastWorkerMs:s.lastWorkerMs};
    },{workerSource,template,routes:FIX.routes,context:FIX.context(0),N,HEAP,SEED});
    console.log(JSON.stringify(out));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
