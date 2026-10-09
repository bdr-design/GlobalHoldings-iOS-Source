'use strict';
// The fleet worker keeps one rollback journal across several exact hourly
// calendar steps. This gate proves repeated writes to the same rows, fresh
// contexts, one commit/rollback, and recovery to the legacy one-step protocol.
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
    const assets=[];for(let i=0;i<12;i++)assets.push(FIX.make('road','R1',{phase:i%2?'moving':'turnaround',progress:i%2?.15+i/100:0,dwellRemaining:i*73,reverse:i%3===0,baseFacility:i%3===0?'P-ROAD-B':'F-ROAD-A',salePending:false,releaseExclusiveRouteOnArrival:false}));
    const contexts=Array.from({length:9},(_,i)=>{const row=FIX.context(i*3600);row.economy={...row.economy,diesel:1.01+i*.017,roadDemand:96+i*2};row.market={...row.market,competitorPressure:{...row.market.competitorPressure,road:38+i}};return row;});
    const result=await page.evaluate(async({workerSource,assets,routes,contexts})=>{
      const STORE=GH_FLEET_STORE,EVENTS=GH_FLEET_EVENTS,TX=GH_TRANSACTION_CORE;
      const workerUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));let corruptNextWindowStep=false;
      const workerFactory=()=>{const raw=new Worker(workerUrl),proxy={postMessage(message,transfer){if(corruptNextWindowStep&&message?.type==='window-advance'){corruptNextWindowStep=false;message={...message,seq:Number(message.seq)+1};}raw.postMessage(message,transfer||[]);},terminate(){raw.terminate();}};for(const key of ['onmessage','onerror','onmessageerror'])Object.defineProperty(proxy,key,{get:()=>raw[key],set:value=>{raw[key]=value;}});return proxy;};
      const plans=new Map(Object.entries(routes)),resolveRoute=id=>plans.get(String(id))||null;
      const client=GH_FLEET_ENGINE_THREAD.create({workerFactory,resolveRoute,routesRevision:()=>0,catalogSpecs:()=>({}),timeoutMs:10000});
      const state={cash:1,fleet:STORE.fromAssets(assets,{at:0})},reference=STORE.importReplica(structuredClone(STORE.exportReplica(state.fleet)));
      const wait=async ticket=>{for(let i=0;i<10000&&ticket?.status==='pending';i++)await new Promise(resolve=>setTimeout(resolve,0));return ticket;};
      const sameStore=(a,b,{revision=true}={})=>{
        const bytesA=new Uint8Array(a.rows,0,a.length*STORE.STRIDE),bytesB=new Uint8Array(b.rows,0,b.length*STORE.STRIDE);
        return a.length===b.length&&a.structure===b.structure&&(!revision||a.revision===b.revision)&&JSON.stringify([...bytesA])===JSON.stringify([...bytesB])&&JSON.stringify(a.values)===JSON.stringify(b.values)&&JSON.stringify(a.extras)===JSON.stringify(b.extras);
      };
      const key=context=>JSON.stringify(context),outputs=[],tickets=[];
      const session=client.beginWindow(state.fleet,{from:0,target:21600});
      if(!session)throw new Error('window-session-not-created');
      let idleResolved=false;client.idle().then(()=>{idleResolved=true;});await Promise.resolve();const idleHeld=!idleResolved;
      tickets[0]=await wait(client.requestWindow(session,state.fleet,{from:0,to:3600,context:contexts[0],contextKey:key(contexts[0]),tripAlertLimit:64,order:'sweep',budget:40000}));
      const handle=TX.beginStaged(state,{label:'qa-window-commit',scope:['cash'],stagedScope:true,apply:function*(){
        for(let i=0;i<6;i++){const out=client.applyWindow(tickets[i],state.fleet,{contextKey:key(contexts[i]),tx:TX});if(!out)throw new Error(`window-apply-${i}`);outputs.push(out);yield `applied-${i}`;}
        return true;
      }});
      const reach=stage=>{for(let guard=0;guard<1000&&!handle.done&&handle.stage!==stage;guard++)handle.step(-Infinity);if(handle.stage!==stage)throw handle.error||new Error(`stage-not-reached:${stage}:${handle.stage}`);};
      for(let i=0;i<6;i++){
        if(i){tickets[i]=await wait(client.requestWindow(session,state.fleet,{from:i*3600,to:(i+1)*3600,context:contexts[i],contextKey:key(contexts[i]),tripAlertLimit:64,order:'sweep',budget:40000}));}
        reach(`applied-${i}`);
        const expected=EVENTS.advance(reference,{from:i*3600,to:(i+1)*3600,context:contexts[i],resolveRoute,tripAlertLimit:64,order:'sweep'});
        if(JSON.stringify(outputs[i])!==JSON.stringify(expected))throw new Error(`window-effects-mismatch:${i}`);
        if(!sameStore(state.fleet,reference))throw new Error(`window-store-mismatch:${i}`);
      }
      while(!handle.done)handle.step(-Infinity);if(handle.error)throw handle.error;if(!handle.result?.committed)throw new Error('window-commit-rejected');
      await client.idle();const committedStats=client.stats(),commitStore=STORE.exportReplica(state.fleet);

      // A second two-step window fails after both writes. Main and worker return
      // to the exact logical checkpoint, then a normal ticket still agrees with
      // an independent reference store.
      const rollbackReference=STORE.importReplica(structuredClone(commitStore)),baseline=STORE.importReplica(structuredClone(commitStore)),rollbackTickets=[];
      const rollbackSession=client.beginWindow(state.fleet,{from:21600,target:28800});if(!rollbackSession)throw new Error('rollback-window-not-created');
      rollbackTickets[0]=await wait(client.requestWindow(rollbackSession,state.fleet,{from:21600,to:25200,context:contexts[6],contextKey:key(contexts[6]),tripAlertLimit:64,order:'sweep',budget:40000}));
      const failed=TX.beginStaged(state,{label:'qa-window-rollback',scope:['cash'],stagedScope:true,apply:function*(){
        for(let i=0;i<2;i++){const out=client.applyWindow(rollbackTickets[i],state.fleet,{contextKey:key(contexts[6+i]),tx:TX});if(!out)throw new Error(`rollback-apply-${i}`);yield `rollback-applied-${i}`;}
        throw new Error('qa-window-injected-failure');
      }});
      const reachFailed=stage=>{for(let guard=0;guard<1000&&!failed.done&&failed.stage!==stage;guard++)failed.step(-Infinity);if(failed.stage!==stage)throw failed.error||new Error(`rollback-stage-not-reached:${stage}`);};
      reachFailed('rollback-applied-0');
      rollbackTickets[1]=await wait(client.requestWindow(rollbackSession,state.fleet,{from:25200,to:28800,context:contexts[7],contextKey:key(contexts[7]),tripAlertLimit:64,order:'sweep',budget:40000}));
      reachFailed('rollback-applied-1');while(!failed.done)failed.step(-Infinity);
      const rollbackError=String(failed.error?.message||'');await client.idle();
      const rollbackExact=sameStore(state.fleet,baseline,{revision:false});
      const normal=await wait(client.request(state.fleet,{from:21600,to:25200,context:contexts[6],contextKey:key(contexts[6]),tripAlertLimit:64,order:'sweep',budget:40000}));
      let normalOut=null;const normalTx=TX.execute(state,{label:'qa-after-window-rollback',scope:['cash'],apply:()=>{normalOut=client.apply(normal,state.fleet,{contextKey:key(contexts[6]),tx:TX});return !!normalOut;}});
      const expectedNormal=EVENTS.advance(rollbackReference,{from:21600,to:25200,context:contexts[6],resolveRoute,tripAlertLimit:64,order:'sweep'});
      const recovered=normalTx.committed&&JSON.stringify(normalOut)===JSON.stringify(expectedNormal)&&sameStore(state.fleet,rollbackReference,{revision:false});
      await client.idle();

      // Worker fallback after leg 1 must not release busy/idle before the main
      // staged transaction aborts and restores that already-applied leg.
      const fallbackBaseline=STORE.importReplica(structuredClone(STORE.exportReplica(state.fleet))),fallbackTickets=[];
      const fallbackSession=client.beginWindow(state.fleet,{from:25200,target:32400});if(!fallbackSession)throw new Error('fallback-window-not-created');
      fallbackTickets[0]=await wait(client.requestWindow(fallbackSession,state.fleet,{from:25200,to:28800,context:contexts[7],contextKey:key(contexts[7]),tripAlertLimit:64,order:'sweep',budget:40000}));
      const fallbackHandle=TX.beginStaged(state,{label:'qa-window-worker-fallback',scope:['cash'],stagedScope:true,apply:function*(){
        const first=client.applyWindow(fallbackTickets[0],state.fleet,{contextKey:key(contexts[7]),tx:TX});if(!first)throw new Error('fallback-first-apply');yield 'fallback-first-applied';
        const second=client.applyWindow(fallbackTickets[1],state.fleet,{contextKey:key(contexts[8]),tx:TX});if(!second)throw new Error('fallback-second-apply');return true;
      }});
      for(let guard=0;guard<1000&&!fallbackHandle.done&&fallbackHandle.stage!=='fallback-first-applied';guard++)fallbackHandle.step(-Infinity);
      if(fallbackHandle.stage!=='fallback-first-applied')throw fallbackHandle.error||new Error('fallback-first-stage-not-reached');
      corruptNextWindowStep=true;fallbackTickets[1]=client.requestWindow(fallbackSession,state.fleet,{from:28800,to:32400,context:contexts[8],contextKey:key(contexts[8]),tripAlertLimit:64,order:'sweep',budget:40000});await wait(fallbackTickets[1]);
      let fallbackIdleResolved=false;client.idle().then(()=>{fallbackIdleResolved=true;});await Promise.resolve();
      const fallbackHeld=fallbackTickets[1]?.status==='fallback'&&client.busy===true&&fallbackIdleResolved===false;
      fallbackHandle.abort('qa-worker-fallback-main-abort');await client.idle();
      const fallbackRollbackExact=sameStore(state.fleet,fallbackBaseline,{revision:false});

      // A main-thread admission mismatch on leg 2 has the same liveness
      // contract as a worker fallback: leg 1 remains protected until abort.
      const mismatchBaseline=STORE.importReplica(structuredClone(STORE.exportReplica(state.fleet))),mismatchTickets=[];
      const mismatchSession=client.beginWindow(state.fleet,{from:25200,target:32400});if(!mismatchSession)throw new Error('mismatch-window-not-created');
      mismatchTickets[0]=await wait(client.requestWindow(mismatchSession,state.fleet,{from:25200,to:28800,context:contexts[7],contextKey:key(contexts[7]),tripAlertLimit:64,order:'sweep',budget:40000}));
      const mismatchHandle=TX.beginStaged(state,{label:'qa-window-main-mismatch',scope:['cash'],stagedScope:true,apply:function*(){
        const first=client.applyWindow(mismatchTickets[0],state.fleet,{contextKey:key(contexts[7]),tx:TX});if(!first)throw new Error('mismatch-first-apply');yield 'mismatch-first-applied';
        const second=client.applyWindow(mismatchTickets[1],state.fleet,{contextKey:'deliberately-wrong-context',tx:TX});if(second)throw new Error('mismatch-second-unexpectedly-applied');yield 'mismatch-refused';return true;
      }});
      for(let guard=0;guard<1000&&!mismatchHandle.done&&mismatchHandle.stage!=='mismatch-first-applied';guard++)mismatchHandle.step(-Infinity);
      if(mismatchHandle.stage!=='mismatch-first-applied')throw mismatchHandle.error||new Error('mismatch-first-stage-not-reached');
      mismatchTickets[1]=await wait(client.requestWindow(mismatchSession,state.fleet,{from:28800,to:32400,context:contexts[8],contextKey:key(contexts[8]),tripAlertLimit:64,order:'sweep',budget:40000}));
      for(let guard=0;guard<1000&&!mismatchHandle.done&&mismatchHandle.stage!=='mismatch-refused';guard++)mismatchHandle.step(-Infinity);
      if(mismatchHandle.stage!=='mismatch-refused')throw mismatchHandle.error||new Error('mismatch-refused-stage-not-reached');
      let mismatchIdleResolved=false;client.idle().then(()=>{mismatchIdleResolved=true;});await Promise.resolve();const mismatchHeld=client.busy===true&&mismatchIdleResolved===false;
      mismatchHandle.abort('qa-main-mismatch-abort');await client.idle();const mismatchRollbackExact=sameStore(state.fleet,mismatchBaseline,{revision:false}),finalStats=client.stats();client.terminate('qa-complete');URL.revokeObjectURL(workerUrl);
      return {protocol:client.windowProtocol,idleHeld,commitEqual:sameStore(state.fleet,rollbackReference,{revision:false}),committedStats,rollbackError,rollbackExact,recovered,fallbackHeld,fallbackRollbackExact,mismatchHeld,mismatchRollbackExact,finalStats};
    },{workerSource,assets,routes:FIX.routes,contexts});
    assert.equal(result.protocol,'journal-v1');
    assert.equal(result.idleHeld,true,'idle remains pending for the whole window');
    assert.equal(result.committedStats.windowBegins,1);assert.equal(result.committedStats.windowSteps,6);assert.equal(result.committedStats.windowCommits,1);assert.equal(result.committedStats.windowRollbacks,0);
    assert.match(result.rollbackError,/qa-window-injected-failure/);assert.equal(result.rollbackExact,true,'rollback restores all fleet bytes, values, and extras');
    assert.equal(result.recovered,true,'the legacy worker protocol recovers after a window rollback');
    assert.equal(result.fallbackHeld,true,'worker fallback keeps busy and idle locked until main rollback');assert.equal(result.fallbackRollbackExact,true,'main rollback restores leg 1 after worker fallback on leg 2');
    assert.equal(result.mismatchHeld,true,'main-thread mismatch keeps busy and idle locked until main rollback');assert.equal(result.mismatchRollbackExact,true,'main rollback restores leg 1 after a leg-2 context mismatch');
    assert.equal(result.finalStats.windowBegins,4);assert.equal(result.finalStats.windowCommits,1);assert.equal(result.finalStats.windowRollbacks,3);assert.equal(result.finalStats.windowFallbacks,2);assert.equal(result.finalStats.fallbacks,1);
    console.log(JSON.stringify({suite:'build362-fleet-window-session',idleHeld:result.idleHeld,commitSteps:result.committedStats.windowSteps,rollbackExact:result.rollbackExact,recovered:result.recovered,fallbackHeld:result.fallbackHeld,fallbackRollbackExact:result.fallbackRollbackExact,mismatchHeld:result.mismatchHeld,mismatchRollbackExact:result.mismatchRollbackExact,stats:result.finalStats}));
    console.log('BUILD362_FLEET_WINDOW_SESSION_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
