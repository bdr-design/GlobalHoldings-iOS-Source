'use strict';
// Build 372: the maintenance round's health part (app.js runMaintenanceTask 'health': diagnostic evidence, the health
// check, the control plane's check and the global halt) found the fleet's asset issues over every row on the main
// thread (165 ms at a million assets, in each maintenance round of a calendar advance). It now asks the fleet engine's
// worker for them (GH_FLEET_ENGINE_THREAD health), waits one call per frame, and uses them only if they describe the
// store exactly as it is at the same time. The whole app (local DOM) with a real worker and an air fleet on routes:
//   - healthy, then with fleet faults (a condition out of range and an unknown route, which an aircraft's presented view
//     does not make health issues; a duplicate id and a missing id, which it reports): the part takes the worker's issues
//     (healthFromWorker 1) and the health report it stores has exactly the issues of the main thread's own health check;
//   - a write while the part waits: the worker's issues are not used (healthFromWorker 0) and the report shows the write;
//   - the game then plays and saves.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const web=path.join(path.resolve(__dirname,'..'),'WebApp');
const workerSource=['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js','fleet-access-core.js','fleet-health-core.js','fleet-query-core.js'].map(file=>fs.readFileSync(path.join(web,file),'utf8')).join('\n;\n')+'\n;\n'+
  fs.readFileSync(path.join(web,'fleet-engine-worker.js'),'utf8').replace(/^importScripts\([^)]*\);$/m,'');

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390},bypassCSP:true,beforeScripts:{fn:source=>{const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));window.__GH_FLEET_ENGINE_WORKER_FACTORY__=()=>new Worker(url);},arg:workerSource}});
    page.setDefaultTimeout(180000);
    await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,W=GH_WORLD_DATA;s.godMoney=true;s.infiniteMoney=true;
      const definition=GH_COMPANY_PLATFORM.definitionFor(s,'air');
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(900000000,definition.founding.minimumCapital),legalName:'QA Health Air',formationContract:'QA-HEALTH'},{silent:true});
      for(const icao of ['OMDB','EGLL']){const row=W.airports.find(item=>item[0]===icao),id=`QA-hl-${icao}`;await a.runAuthorizedDomainCommand('facilities','create',{facility:{id,name:`QA ${icao}`,kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:`air:${icao}`,code:row[1]||icao,icao,iata:row[1],city:row[3]||'—',country:String(row[5]||'—'),coords:[row[6],row[7]]},bucket:'globalBases'},{silent:true});}
      const model=[...GH_ASSET_CATALOG.air.used].filter(x=>!x.specs.cargo&&Number(x.specs.rangeKm)>=6000).sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      for(const icao of ['OMDB','EGLL'])await a.buyAsset('air','used',model.id,'lease',30,`QA-hl-${icao}`,true,`QA-HL-${icao}`,'air');
    });
    await page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));
    await page.locator('.dispatch-international-network[data-company="air"]').first().click();
    await page.waitForFunction(()=>GH_FLEET_DATA.filter(__GH_STATE__,row=>row.ownerCompanyId==='air').every(row=>row.routeId),null,{timeout:180000});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:180000});
    await page.evaluate(()=>__AUDIT__.closeDrawer());
    await page.evaluate(()=>__AUDIT__.setSpeed(3));
    await page.waitForFunction(()=>(window.__AUDIT__.fleetEngineThreadClient?.()?.stats?.().applied||0)>=3,null,{timeout:120000});
    await page.evaluate(()=>__AUDIT__.setSpeed(0));
    await page.waitForFunction(()=>!window.__AUDIT__.fleetEngineThreadClient().busy&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:60000});
    const result=await page.evaluate(async()=>{
      const STORE=GH_FLEET_STORE,state=__GH_STATE__,store=state.fleet,metrics=window.__GH_APP_RUNTIME_INSTRUMENTATION__,log=[];
      const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
      const key=report=>(report?.issues||[]).map(row=>`${row.id}|${row.severity}|${JSON.stringify(row.detail??row.meta??null)}`).sort();
      // The part as the maintenance queue runs it (one call per frame); `during` runs after its first call.
      const runHealth=async during=>{const entry={task:'health'};let calls=0;for(;;){calls++;const finished=__AUDIT__.runMaintenanceTask(entry)!==false;if(finished)break;if(calls===1&&during)during();await frame();if(calls>2000)throw new Error('health part did not finish');}return calls;};
      const mainReport=()=>GH_DIAGNOSTICS.runHealthCheck(state,{appVersion:'qa',saveSchemaVersion:'3.0.0',simulation:{}},{recordEvent:false,trackTransitions:false,storeResult:false});
      const compare=async(label,during)=>{
        const calls=await runHealth(during),stored=state.diagnostics.lastHealth,expected=mainReport();
        const same=JSON.stringify(key(stored))===JSON.stringify(key(expected));
        log.push({label,calls,fromWorker:metrics.maintenance.healthFromWorker,issues:key(stored).length,fleetIssues:(stored?.issues||[]).filter(row=>/ASSET|FLEET/.test(String(row.id))).map(row=>row.id),same});
      };
      const rows=[...Array(store.length).keys()].filter(index=>STORE.isAlive(store,index)),keep=index=>({id:STORE.idAt(store,index),condition:STORE.peek(store,index,'condition'),routeId:STORE.peek(store,index,'routeId')});
      const restore=(index,before)=>{for(const [field,value] of Object.entries(before))STORE.set(store,index,field,value);};
      await compare('healthy');
      // Health reports id faults; a condition or route out of range reads through the presented (derived, clamped) view of
      // an aircraft in flight, so it is no health issue on either side (the save check reports those).
      const faults=[['condition',index=>STORE.set(store,index,'condition',150)],['route',index=>STORE.set(store,index,'routeId','QA-NO-SUCH-ROUTE')],['duplicate-id',index=>STORE.set(store,index,'id',STORE.idAt(store,rows[0]))],['id-missing',index=>STORE.set(store,index,'id','')]];
      for(const [label,make] of faults){const index=rows[5],before=keep(index);make(index);await compare(label);restore(index,before);}
      await compare('restored');
      // A write while the part waits for the worker: its issues no longer describe the store.
      const index=rows[9],before=keep(index);await compare('stale',()=>STORE.set(store,index,'id',STORE.idAt(store,rows[1])));restore(index,before);
      return log;
    });
    for(const row of result)console.log(JSON.stringify(row));
    assert.deepEqual(errors,[]);
    const by=Object.fromEntries(result.map(row=>[row.label,row]));
    for(const row of result)assert.equal(row.same,true,`${row.label}: the stored report equals the main thread's health check`);
    for(const label of ['healthy','condition','route','duplicate-id','id-missing','restored']){assert.equal(by[label].fromWorker,1,`${label}: the worker's issues were used`);assert.ok(by[label].calls>=2,`${label}: the part waited for the worker`);}
    assert.ok(by['duplicate-id'].fleetIssues.includes('ASSET_DUPLICATE_IDS'),'a duplicate id is reported');assert.ok(by['id-missing'].fleetIssues.includes('ASSET_ID_MISSING'),'a missing id is reported');
    assert.equal(by.stale.fromWorker,0,'a result the store moved past is not used');assert.ok(by.stale.fleetIssues.includes('ASSET_DUPLICATE_IDS'),'the write made while waiting is reported');
    await page.evaluate(()=>__AUDIT__.setSpeed(3));await page.waitForTimeout(1500);await page.evaluate(()=>__AUDIT__.setSpeed(0));
    const drained=await page.evaluate(()=>GH_PERSISTENCE.drain({timeoutMs:60000}));assert.equal(drained?.ok,true);
    console.log(JSON.stringify({ok:true,checks:result.length}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
