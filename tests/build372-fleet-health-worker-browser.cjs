'use strict';
// Build 372: the health check's fleet issues (fleet-health-core) are found by the fleet engine's worker on its replica
// (GH_FLEET_ENGINE_THREAD health()), not on the main thread. With a real worker, the worker's issue rows must equal the
// ones the main thread finds on the same store, exactly (ids, order, texts, evidence), for a healthy fleet and after
// every kind of fault the check reports: a duplicate id, a missing id, an invalid progress, a condition out of range,
// each made, then repaired, then made inside a transaction that rolls back; and after a compaction. health() refuses
// while a step is in flight (its replica would hold an unsettled step), and its result names the store it was found on.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const web=path.join(path.resolve(__dirname,'..'),'WebApp'),read=file=>fs.readFileSync(path.join(web,file),'utf8');
const FIX=require('./helpers/fleet-fixture');
const cores=['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js','fleet-access-core.js','fleet-health-core.js','fleet-query-core.js'];
const workerSource=cores.map(read).join('\n;\n')+'\n;\n'+read('fleet-engine-worker.js').replace(/^importScripts\([^)]*\);$/m,'');

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.setContent('<!doctype html><meta charset="utf-8">');
    for(const file of [...cores,'fleet-engine-thread.js'])await page.addScriptTag({content:read(file)});
    const result=await page.evaluate(async({workerSource,fleet,routes,context})=>{
      const STORE=GH_FLEET_STORE,DATA=GH_FLEET_DATA,HEALTH=GH_FLEET_HEALTH,N=70000,log=[];
      const assets=[];for(let i=0;i<N;i++){const a=structuredClone(fleet[i%fleet.length]);a.id=`QA-${String(i).padStart(7,'0')}`;assets.push(a);}
      let state={fleet:STORE.fromAssets(assets,{at:0}),simSeconds:5000};assets.length=0;
      const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),plans=new Map(Object.entries(routes));
      const client=GH_FLEET_ENGINE_THREAD.create({workerFactory:()=>new Worker(url),resolveRoute:id=>plans.get(String(id))?{...plans.get(String(id))}:null,routesRevision:()=>0,catalogSpecs:()=>({}),timeoutMs:60000});
      const live=()=>[...Array(state.fleet.length).keys()].filter(index=>STORE.isAlive(state.fleet,index));
      const check=async label=>{
        const asked=client.health(state.fleet,{simSeconds:state.simSeconds});if(!asked)throw new Error(`${label}: health refused`);
        const found=await asked;if(!found)throw new Error(`${label}: no result`);
        const expected=HEALTH.assetIssues(state,DATA),same=JSON.stringify(found.issues)===JSON.stringify(expected);
        log.push({label,issues:expected.map(row=>row[0]),same,store:found.store===state.fleet});
        if(!same)throw new Error(`${label}: worker ${JSON.stringify(found.issues).slice(0,300)} main ${JSON.stringify(expected).slice(0,300)}`);
        if(found.store!==state.fleet)throw new Error(`${label}: result names another store`);
        return expected.map(row=>row[0]);
      };
      const tx=()=>{const journal=STORE.beginJournal(state.fleet);return {rollback(){STORE.rollbackJournal(journal);},commit(){STORE.endJournal(journal);}};};
      const faults={
        duplicate:[index=>STORE.set(state.fleet,index,'id',STORE.idAt(state.fleet,index+1)),'ASSET_DUPLICATE_IDS'],
        missing:[index=>STORE.set(state.fleet,index,'id',undefined),'ASSET_ID_MISSING'],
        progress:[index=>STORE.set(state.fleet,index,'progress',-1),'ASSET_PROGRESS_INVALID'],
        condition:[index=>STORE.set(state.fleet,index,'condition',150),'ASSET_CONDITION_INVALID']
      };
      const healthy=await check('healthy');
      for(const [name,[make,code]] of Object.entries(faults)){
        const index=live()[1000+Object.keys(faults).indexOf(name)*10],before={id:STORE.idAt(state.fleet,index),progress:STORE.peek(state.fleet,index,'progress'),condition:STORE.peek(state.fleet,index,'condition')};
        make(index);const made=await check(`${name}-made`);if(!made.includes(code))throw new Error(`${name}: ${code} not reported`);
        STORE.set(state.fleet,index,'id',before.id);STORE.set(state.fleet,index,'progress',before.progress);STORE.set(state.fleet,index,'condition',before.condition);
        const repaired=await check(`${name}-repaired`);if(repaired.length)throw new Error(`${name}: still reported after repair`);
        const x=tx();make(index);x.rollback();const rolled=await check(`${name}-rolled-back`);if(rolled.length)throw new Error(`${name}: reported after rollback`);
      }
      STORE.removeMany(state.fleet,live().filter(index=>index%5===2));STORE.compactRows(state.fleet);
      STORE.set(state.fleet,live()[10],'condition',-3);await check('after-compaction');
      // A step in flight: no health result (its replica holds the unsettled step).
      const ticket=client.request(state.fleet,{from:5000,to:6800,context,contextKey:'k',tripAlertLimit:64,order:'events',maxEvents:4000,budget:4000});
      const refusedWhileStep=client.health(state.fleet,{simSeconds:5000})===null;client.discard(ticket);
      await new Promise(resolve=>setTimeout(resolve,50));
      // The result names the store it was found on: a new game's store is another one.
      const oldStore=state.fleet,pending=client.health(oldStore,{simSeconds:state.simSeconds});state={fleet:STORE.fromAssets(fleet.slice(0,20).map((a,i)=>({...structuredClone(a),id:`R-${i}`})),{at:0}),simSeconds:0};
      const late=await pending;await check('new-store');
      const stats=client.stats();client.terminate('done');
      return {log,healthy,refusedWhileStep,lateStoreIsOld:late?.store===oldStore,stats:{healthRequests:stats.healthRequests,maxHealthWorkerMs:stats.maxHealthWorkerMs,fullSyncs:stats.fullSyncs}};
    },{workerSource,fleet:FIX.fleet(),routes:FIX.routes,context:FIX.context(5000)});
    for(const row of result.log)console.log(JSON.stringify(row));
    assert.deepEqual(errors,[]);
    assert.ok(result.log.every(row=>row.same&&row.store));
    assert.equal(result.refusedWhileStep,true,'no health result while a step is in flight');
    assert.equal(result.lateStoreIsOld,true,'a result names the store it was asked for');
    console.log(JSON.stringify({ok:true,checks:result.log.length,healthyFixtureIssues:result.healthy,...result.stats}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
