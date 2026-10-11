'use strict';
// Build 372: the fleet engine thread keeps its replica from the store's replica log (STORE.drainReplica), and a store
// decoded from the native vault reaches the worker as its own chunk buffers (STORE.setReplicaSeed), moved, not copied.
// With a real worker, after every kind of change the worker's replica must equal the main thread's store byte for byte
// (records, value table, extras, length, live count, structure) and no whole copy of the store may be made:
//   seed + writes made before the first exchange (set, add, remove, extras, new values); a step replayed and committed;
//   one replayed and rolled back; one discarded; the engine run on the main thread (the fallback path) committed and
//   rolled back; a column pass committed and rolled back; compactions (two before one exchange, with rows written before
//   and after each); value reclamation; a calendar window rolled back and one committed; and a new store (a reset), the
//   one case that takes a whole copy, counted as such.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),web=path.join(root,'WebApp'),read=file=>fs.readFileSync(path.join(web,file),'utf8');
const FIX=require('./helpers/fleet-fixture');
const workerSource=['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js','fleet-access-core.js','fleet-health-core.js'].map(read).join('\n;\n')+'\n;\n'+read('fleet-engine-worker.js').replace(/^importScripts\([^)]*\);$/m,'');
const pageSources=['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js','fleet-engine-thread.js'].map(read);

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.setContent('<!doctype html><meta charset="utf-8">');
    for(const content of pageSources)await page.addScriptTag({content});
    const fleet=FIX.fleet(),N=70000;
    const result=await page.evaluate(async({workerSource,fleet,routes,context,N})=>{
      const STORE=GH_FLEET_STORE,EVENTS=GH_FLEET_EVENTS,log=[];
      const assets=[];for(let i=0;i<N;i++){const a=structuredClone(fleet[i%fleet.length]);a.id=`QA-${String(i).padStart(7,'0')}`;a.name=`QA ${i}`;if(i%997===0)a.note={text:`n${i}`};assets.push(a);}
      let store=STORE.fromAssets(assets,{at:0});assets.length=0;
      // The vault's chunks: copies of the record buffer as decoded, 4 MiB each (the codec's chunk size).
      const chunkBytes=4*1024*1024,byteLength=store.length*STORE.STRIDE,chunks=[];
      for(let at=0;at<byteLength;at+=chunkBytes)chunks.push(store.rows.slice(at,Math.min(byteLength,at+chunkBytes)));
      if(!STORE.setReplicaSeed(store,{chunks,chunkBytes,byteLength}))throw new Error('seed-refused');
      const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),plans=new Map(Object.entries(routes));
      const client=GH_FLEET_ENGINE_THREAD.create({workerFactory:()=>new Worker(url),resolveRoute:id=>plans.get(String(id))?{...plans.get(String(id))}:null,routesRevision:()=>0,catalogSpecs:()=>({}),timeoutMs:60000});
      const resolveRoute=id=>plans.get(String(id))?{...plans.get(String(id))}:null;
      const ids=()=>[...Array(store.length).keys()].filter(index=>STORE.isAlive(store,index));
      // A transaction as Transaction Core runs it for a row root: one store journal, undo callbacks settled with it.
      const tx=()=>{const journal=STORE.beginJournal(store),undo=[];return {registerUndo(rollback,commit){undo.push([rollback,commit]);},commit(){STORE.endJournal(journal);for(const [,commit] of undo)commit?.();},rollback(){STORE.rollbackJournal(journal);for(let k=undo.length-1;k>=0;k--)undo[k][0]?.();}};};
      const until=async test=>{for(let k=0;k<20000&&!test();k++)await new Promise(resolve=>setTimeout(resolve,2));if(!test())throw new Error('timeout');};
      const check=async label=>{
        if(!client.prime(store))throw new Error(`${label}: prime refused (${client.stats().lastReason})`);
        const replica=await client.inspect();if(!replica)throw new Error(`${label}: no replica`);
        const a=new Uint8Array(store.rows,0,store.length*STORE.STRIDE),b=new Uint8Array(replica.rows);let row=-1;
        if(a.length!==b.length)row=-2;else for(let i=0;i<a.length;i++)if(a[i]!==b[i]){row=Math.floor(i/STORE.STRIDE);break;}
        const norm=list=>JSON.stringify(list.map(value=>value===undefined?null:value));
        const same={rows:row===-1,values:norm(store.values)===norm(replica.values),extras:JSON.stringify(store.extras)===JSON.stringify(replica.extras),length:store.length===replica.length,live:store.live===replica.live,structure:store.structure===replica.structure};
        log.push({label,row,...same,fullSyncs:client.stats().fullSyncs});
        if(Object.values(same).some(ok=>!ok))throw new Error(`${label}: replica differs ${JSON.stringify({row,...same})}`);
      };
      const step=async(from,to)=>{const ticket=client.request(store,{from,to,context:context,contextKey:'k',tripAlertLimit:64,order:'events',maxEvents:4000,budget:4000});if(!ticket)throw new Error('request-refused');await until(()=>ticket.status!=='pending');if(ticket.status!=='ready')throw new Error(`step ${ticket.status}:${ticket.reason}`);return ticket;};
      const replay=async(from,to,outcome)=>{const ticket=await step(from,to),t=tx();const out=client.apply(ticket,store,{contextKey:'k',tx:t});if(!out)throw new Error(`apply refused ${client.stats().lastReason}`);if(outcome==='commit')t.commit();else t.rollback();return out;};

      // 1. Seed, with writes made before the first exchange.
      for(const index of ids().slice(0,300))STORE.set(store,index,'condition',50+index%40);
      for(let i=0;i<64;i++)STORE.add(store,{...structuredClone(fleet[i%fleet.length]),id:`QA-NEW-${i}`,name:`New ${i}`,note:{i}});
      STORE.set(store,7,'note',{text:'patched'});STORE.set(store,11,'registration','QA-REG-UNIQUE');
      STORE.removeMany(store,ids().filter(index=>index%2311===5));
      await check('seed');
      const seedStats=client.stats();
      const detached=chunks.every(chunk=>chunk.byteLength===0);
      // 2. Steps replayed: committed, rolled back, discarded.
      let t=0;await replay(t,t+1800,'commit');t+=1800;await check('step-commit');
      await replay(t,t+1800,'rollback');await check('step-rollback');
      {const ticket=await step(t,t+1800);client.discard(ticket);}await check('step-discard');
      // 3. The engine on this thread (a refused result's fallback), committed and rolled back.
      for(const outcome of ['commit','rollback']){
        const x=tx();EVENTS.advance(store,{from:t,to:t+3600,context,resolveRoute,catalogSpecs:()=>null,tripAlertLimit:64,order:'events'});
        if(outcome==='commit'){x.commit();t+=3600;}else x.rollback();await check(`main-engine-${outcome}`);
      }
      // 4. A column pass (the daily flight counters), committed and rolled back.
      for(const outcome of ['commit','rollback']){
        const x=tx(),put=STORE.columnWriter(store,['flightHours']);for(const index of ids())put(index,'flightHours',(index%500)+(outcome==='commit'?1:2));
        outcome==='commit'?x.commit():x.rollback();await check(`column-${outcome}`);
      }
      // 4b. An exchange while the transaction is open (the replica takes its uncommitted writes), then its rollback: the
      // rows and columns it restores must reach the replica too.
      {
        const x=tx(),put=STORE.columnWriter(store,['flightHours']);for(const index of ids())put(index,'flightHours',7777);
        for(const index of ids().slice(0,500))STORE.set(store,index,'condition',12);STORE.add(store,{...structuredClone(fleet[0]),id:'QA-INSIDE',name:'Inside'});
        if(!client.prime(store))throw new Error('prime inside refused');x.rollback();await check('rollback-after-exchange');
      }
      // 5. Compactions: two before one exchange, rows written before and after each.
      STORE.removeMany(store,ids().filter(index=>index%7===3));STORE.set(store,ids()[100],'condition',33);STORE.compactRows(store);
      STORE.set(store,ids()[200],'condition',34);STORE.removeMany(store,ids().filter(index=>index%9===4));STORE.compactRows(store);STORE.set(store,ids()[300],'note',{after:true});
      await check('compactions');
      await replay(t,t+1800,'commit');t+=1800;await check('step-after-compaction');
      // 6. Values no live row references reclaimed.
      STORE.collectValues(store);await check('collect-values');
      for(let i=0;i<20;i++)STORE.set(store,ids()[i],'registration',`QA-REUSE-${i}`);await check('values-reused');
      // 7. Calendar windows: rolled back, then committed.
      for(const outcome of ['rollback','commit']){
        const session=client.beginWindow(store,{from:t,target:t+7200});if(!session)throw new Error('window refused');
        const x=tx();
        for(const [from,to] of [[t,t+3600],[t+3600,t+7200]]){
          const ticket=client.requestWindow(session,store,{from,to,context,contextKey:'w',tripAlertLimit:64,order:'sweep',budget:40000});if(!ticket)throw new Error(`window step refused ${session.reason}`);
          await until(()=>ticket.status!=='pending');const out=client.applyWindow(ticket,store,{contextKey:'w',tx:x});if(!out)throw new Error(`window apply refused ${session.reason}`);
        }
        if(outcome==='commit'){x.commit();t+=7200;}else x.rollback();
        await check(`window-${outcome}`);
      }
      const before=client.stats();
      // 8. A new store (a hard reset): a whole copy, the one case that takes one.
      store=STORE.fromAssets(fleet.slice(0,40).map((a,i)=>({...structuredClone(a),id:`QA-RESET-${i}`})),{at:t});
      await check('store-replaced');await replay(t,t+1800,'commit');await check('step-after-reset');
      const after=client.stats();client.terminate('done');
      return {log,detached,seedStats,before,after};
    },{workerSource,fleet,routes:FIX.routes,context:FIX.context(0),N});
    assert.deepEqual(errors,[]);
    for(const row of result.log)console.log(JSON.stringify(row));
    assert.equal(result.detached,true,'the seed chunks were moved to the worker, not copied');
    assert.equal(result.seedStats.seedSyncs,1);assert.equal(result.seedStats.fullSyncs,0);
    assert.equal(result.before.fullSyncs,0,'no whole copy before the reset');assert.deepEqual(result.before.fullSyncReasons,{});
    assert.ok(result.before.compactions>=2);assert.ok(result.before.applied>=4);assert.equal(result.before.windowCommits,1);assert.equal(result.before.windowRollbacks,1);
    assert.equal(result.after.fullSyncs,1);assert.deepEqual(result.after.fullSyncReasons,{'store-replaced':1});
    console.log(JSON.stringify({ok:true,steps:result.after.applied,seedMs:result.seedStats.maxSeedSyncMs,routeAnswerMs:result.seedStats.maxRouteAnswerMs}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
