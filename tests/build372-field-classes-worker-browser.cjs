'use strict';
// Build 372: the save check's classes of rows (GH_FLEET_STORE.forEachClass) and id check come from the fleet engine's
// worker (GH_FLEET_ENGINE_THREAD fieldClasses) only when its replica is exactly the store. With a real worker:
//   - the worker's classes (rows, sizes, first rows, member counts, numeric extremes including NaN) and id check equal
//     the main thread's, exactly, for the save check's fields, on a store with classes, extras, faults and dead rows;
//   - with nothing in flight the replica is brought to the store first (writes made just before are included);
//   - with a step in flight that has not been replayed here: null (the replica holds a step the store does not);
//   - with a step replayed here and nothing written since: the classes of the store with that step (as both hold it);
//   - with a step replayed here and rows and a new value written since: those go into the open step, and the classes
//     are the store's with the step and the writes;
//   - with a step replayed here and a column rewritten wholesale since (a numeric field of the check): it goes into the
//     open step, and the classes are the store's;
//   - with a step replayed here and new route plans since: null;
//   - current(result, store) is false once the store is written after the request, or for another store.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const web=path.join(path.resolve(__dirname,'..'),'WebApp'),read=file=>fs.readFileSync(path.join(web,file),'utf8');
const FIX=require('./helpers/fleet-fixture');
const cores=['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js','fleet-access-core.js','fleet-health-core.js','fleet-query-core.js'];
const workerSource=cores.map(read).join('\n;\n')+'\n;\n'+read('fleet-engine-worker.js').replace(/^importScripts\([^)]*\);$/m,'');
const fields=JSON.parse(read('save-schema.js').match(/FLEET_VALIDATION_FIELDS=Object\.freeze\((\[[^\]]+\])/)[1].replace(/'/g,'"'));

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.setContent('<!doctype html><meta charset="utf-8">');
    for(const file of [...cores,'fleet-engine-thread.js'])await page.addScriptTag({content:read(file)});
    const result=await page.evaluate(async({workerSource,fleet,routes,context,fields})=>{
      const STORE=GH_FLEET_STORE,numeric=['progress','fuel','condition'],log=[];
      const assets=[];for(let i=0;i<70000;i++){const a=structuredClone(fleet[i%fleet.length]);a.id=`QA-${String(i).padStart(7,'0')}`;a.name=`QA ${i}`;if(i%1001===0)a.note={i};if(i%5003===0)a.city='Riyadh';assets.push(a);}
      const store=STORE.fromAssets(assets,{at:0});assets.length=0;
      const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),plans=new Map(Object.entries(routes));
      let routesRev=0;const client=GH_FLEET_ENGINE_THREAD.create({workerFactory:()=>new Worker(url),resolveRoute:id=>plans.get(String(id))?{...plans.get(String(id))}:null,routesRevision:()=>routesRev,catalogSpecs:()=>({}),timeoutMs:60000});
      const live=()=>[...Array(store.length).keys()].filter(index=>STORE.isAlive(store,index));
      const mainClasses=()=>{const rows=[];STORE.forEachClass(store,fields,(row,count,info)=>rows.push([row,count,info.index,info.members]),{numeric});return {rows,ids:STORE.idCollisions(store)};};
      const same=(a,b)=>{try{return JSON.stringify(a,(k,v)=>Number.isNaN(v)?'NaN':v===undefined?'undefined':v)===JSON.stringify(b,(k,v)=>Number.isNaN(v)?'NaN':v===undefined?'undefined':v);}catch{return false;}};
      const compare=async label=>{
        const asked=client.fieldClasses(store,{fields,numeric,ids:true});if(!asked)throw new Error(`${label}: refused`);
        const found=await asked;if(!found)throw new Error(`${label}: no result`);if(!client.current(found,store))throw new Error(`${label}: not current`);
        const expected=mainClasses(),ok=same(found.rows,expected.rows)&&same(found.ids,expected.ids);log.push({label,classes:expected.rows.length,ids:expected.ids,ok});
        if(!ok)throw new Error(`${label}: classes differ`);return found;
      };
      client.prime(store);await new Promise(resolve=>setTimeout(resolve,200));
      await compare('initial');
      // Writes just before the request: faults, a NaN, extras, removals.
      const rows=live();STORE.set(store,rows[10],'condition',150);STORE.set(store,rows[20],'progress',NaN);STORE.set(store,rows[30],'id',STORE.idAt(store,rows[31]));STORE.set(store,rows[40],'city','Jeddah <b>');STORE.removeMany(store,[rows[50],rows[51]]);
      await compare('after-writes');
      // A step in flight, not replayed: refused.
      const ticket=client.request(store,{from:0,to:1800,context,contextKey:'k',tripAlertLimit:64,order:'events',maxEvents:4000,budget:4000});
      const refusedInFlight=client.fieldClasses(store,{fields,numeric})===null;
      for(let k=0;k<5000&&ticket.status==='pending';k++)await new Promise(resolve=>setTimeout(resolve,2));
      if(ticket.status!=='ready')throw new Error('step not ready');
      const refusedReady=client.fieldClasses(store,{fields,numeric})===null;
      // Replayed (inside a journal, as a transaction does), nothing written since: the classes of the store with the step.
      const journal=STORE.beginJournal(store),undo=[];const out=client.apply(ticket,store,{contextKey:'k',tx:{registerUndo(rollback,commit){undo.push([rollback,commit]);}}});if(!out)throw new Error('apply refused');
      await compare('replayed-step');
      // Replayed, then written here: the writes go into the open step, and the classes are the store's.
      STORE.set(store,rows[60],'condition',77);STORE.set(store,rows[61],'registration','QA-AFTER-STEP');STORE.set(store,rows[62],'mode','sea');
      await compare('replayed-step-written');
      // Replayed, then a column rewritten wholesale (the day close's flight counters): it goes into the open step too.
      const put=STORE.columnWriter(store,['progress']);for(const index of live())put(index,'progress',(index%10)/10);
      await compare('replayed-step-column');
      // Replayed, then new route plans: refused (the save check reads the store itself).
      routesRev++;STORE.set(store,rows[63],'condition',78);const refusedRoutes=client.fieldClasses(store,{fields,numeric})===null;
      STORE.rollbackJournal(journal);for(const [rollback] of undo.reverse())rollback();
      await compare('after-rollback');
      // A result is current only for the same store unchanged.
      const asked=client.fieldClasses(store,{fields,numeric,ids:true});STORE.set(store,rows[70],'condition',66);const late=await asked;
      const staleAfterWrite=client.current(late,store)===false,otherStore=client.current(late,STORE.fromAssets([],{at:0}))===false;
      await compare('after-late-write');
      const stats=client.stats();client.terminate('done');
      return {log,refusedInFlight,refusedReady,refusedRoutes,staleAfterWrite,otherStore,stats:{classRequests:stats.classRequests,maxClassesWorkerMs:stats.maxClassesWorkerMs,openSyncs:stats.openSyncs||0,replicaRefusals:stats.replicaRefusals||{}}};
    },{workerSource,fleet:FIX.fleet(),routes:FIX.routes,context:FIX.context(0),fields});
    for(const row of result.log)console.log(JSON.stringify(row));
    assert.deepEqual(errors,[]);assert.ok(result.log.every(row=>row.ok));
    assert.equal(result.log.find(row=>row.label==='after-writes').ids.duplicate,true,'the duplicate id is seen by both');
    assert.equal(result.refusedInFlight,true,'refused with a step in flight');assert.equal(result.refusedReady,true,'refused with a step not yet replayed');
    assert.equal(result.refusedRoutes,true,'refused after new route plans following the replayed step');
    assert.equal(result.stats.openSyncs,2,'the rows, then the column, written after the replayed step went into it');
    assert.equal(result.stats.replicaRefusals['routes-since-step'],1);assert.equal(result.stats.replicaRefusals['written-since-step'],undefined);assert.equal(result.stats.replicaRefusals['mass-write-since-step'],undefined);
    assert.equal(result.staleAfterWrite,true,'a result is not current once the store is written');assert.equal(result.otherStore,true);
    console.log(JSON.stringify({ok:true,...result.stats}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
