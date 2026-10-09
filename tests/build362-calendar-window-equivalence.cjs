'use strict';
// Real-app acceptance for the manual calendar window: the enabled six-hour
// path must equal six legacy hourly commits, honor hard boundaries, expose
// deterministic counters, and roll back to hourly work for post-commit fleet effects.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const root=process.env.GH_AUDIT_ROOT||path.resolve(__dirname,'..'),web=path.join(root,'WebApp');
const workerSource=['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js'].map(file=>fs.readFileSync(path.join(web,file),'utf8')).join('\n;\n')+'\n;\n'+
  fs.readFileSync(path.join(web,'fleet-engine-worker.js'),'utf8').replace(/^importScripts\([^)]*\);$/m,'');

function verifyGroupedBoundaryHealth(){
  const core=require(path.join(web,'simulation-core.js'));let time=0,wall=0;
  const engine=core.create({
    getSimTime:()=>time,setSimTime:value=>{time=value;},getSpeed:()=>0,
    getManualAggregateLimit:({from,target})=>target-from,
    createSliceJob:(slice,meta)=>({aggregate:meta.aggregate,runChunk:()=>true,finish(){time=meta.to;return {committed:true,aggregateSubSlices:Math.round(slice/3600)};}})
  },{nowMs:()=>wall,manualAggregateMaxSeconds:86400});
  assert.equal(engine.advanceTo(30*3600,{speed:600,batchSeconds:3600}).accepted,true);
  for(let frames=0;frames<20&&engine.snapshot().manualAdvance;frames++){wall+=16;engine.frame(wall);}
  const health=engine.health();
  assert.equal(time,30*3600);assert.equal(health.aggregateWindows,2);assert.equal(health.aggregateSubSlices,30);
  assert.equal(health.hours,30,'a grouped window must count every crossed hour');
  assert.equal(health.days,1,'a grouped window must count every crossed day');
  return {hours:health.hours,days:health.days,aggregateWindows:health.aggregateWindows};
}

const storageOf=page=>page.evaluate(()=>Array.from({length:localStorage.length},(_,i)=>{const key=localStorage.key(i);return [key,localStorage.getItem(key)];}));
async function installWorker(page,enabled){
  await page.evaluate(({source,enabled})=>{const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));window.__GH_FLEET_ENGINE_WORKER_FACTORY__=()=>new Worker(url);window.__GH_MANUAL_CALENDAR_WINDOWS__=enabled;window.__QA_WORKER_URL__=url;},{source:workerSource,enabled});
}
async function advance(page,hours,label){
  return page.evaluate(async({hours,label})=>{
    const a=__AUDIT__,s=__GH_STATE__,target=s.simSeconds+hours*3600,accepted=a.simulationEngine.advanceTo(target,{speed:600,batchSeconds:3600,reason:label,maxSeconds:366*86400});
    for(let i=0;i<30000&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++)await new Promise(resolve=>setTimeout(resolve,5));
    const health=a.simulationEngine.health(),snapshot=a.simulationEngine.snapshot();
    return {accepted:accepted?.accepted===true,reached:Math.abs(s.simSeconds-target)<1e-6,target,sim:s.simSeconds,health,failure:snapshot.lastAdvanceFailure||null,thread:GH_APP_RUNTIME_METRICS.snapshot().fleetEngineThread};
  },{hours,label});
}
async function canonical(page){
  return page.evaluate(()=>{
    const s=__GH_STATE__,state=JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(s).filter(([key])=>key!=='fleet'))));
    // Diagnostics contain wall-clock recorder samples and are explicitly runtime
    // evidence. Calendar economics, documents, control records and ID sequences remain compared.
    delete state.diagnostics;delete state.simulationKernel;
    const replica=GH_FLEET_STORE.exportReplica(s.fleet);
    return {state,fleet:{length:replica.length,live:replica.live,capacity:replica.capacity,structure:replica.structure,revision:replica.revision,values:replica.values,extras:replica.extras,words:Array.from(new Uint32Array(replica.rows))},lastAtomicCommit:s.simulationKernel?.lastAtomicCommit||null,mapRevision:Number(window.GH_MAP_STRUCTURE_REVISION)||0};
  });
}
function firstDiff(a,b,pathName='root'){
  if(Object.is(a,b))return null;if(typeof a!==typeof b||a===null||b===null||typeof a!=='object')return {path:pathName,a,b};
  if(Array.isArray(a)!==Array.isArray(b))return {path:pathName,a,b};
  const keys=new Set([...Object.keys(a),...Object.keys(b)]);for(const key of keys){const diff=firstDiff(a[key],b[key],`${pathName}.${key}`);if(diff)return diff;}return null;
}

(async()=>{
  const groupedHealth=verifyGroupedBoundaryHealth(),browser=await chromium.launch({headless:true}),errors=[];
  try{
    const setup=await boot({browser,errors,viewport:{width:844,height:390},bypassCSP:true});setup.page.setDefaultTimeout(180000);
    const setupSummary=await setup.page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,W=GH_WORLD_DATA;s.godMoney=true;s.infiniteMoney=true;
      const definition=GH_COMPANY_PLATFORM.definitionFor(s,'air');
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(900000000,definition.founding.minimumCapital),legalName:'QA Calendar Air',formationContract:'QA-CALENDAR-WINDOW'},{silent:true});
      for(const icao of ['OMDB','EGLL']){const row=W.airports.find(item=>item[0]===icao),id=`QA-window-${icao}`;await a.runAuthorizedDomainCommand('facilities','create',{facility:{id,name:`QA ${icao}`,kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:`air:${icao}`,code:row[1]||icao,icao,iata:row[1],city:row[3]||'—',country:String(row[5]||'—'),coords:[row[6],row[7]]},bucket:'globalBases'},{silent:true});}
      const cheapest=[...GH_ASSET_CATALOG.air.used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      await a.buyAsset('air','used',cheapest.id,'lease',24,'QA-window-OMDB',true,'QA-CALENDAR-ASSETS','air');
      return {fleet:GH_FLEET_DATA.size(s),pending:GH_REALISM.hasPendingDeliveries(s)};
    });
    await setup.page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));
    const dispatch=setup.page.locator('.dispatch-international-network[data-company="air"]').first();await dispatch.waitFor({state:'visible'});await dispatch.click();
    await setup.page.waitForFunction(()=>GH_FLEET_DATA.filter(__GH_STATE__,row=>(row.ownerCompanyId||row.companyId)==='air').every(row=>row.routeId),null,{timeout:180000});
    await setup.page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:180000});
    await setup.page.evaluate(()=>__AUDIT__.closeDrawer());
    await setup.page.evaluate(()=>GH_PERSISTENCE.drain());
    const storage=await storageOf(setup.page);await setup.page.close();
    assert.equal(setupSummary.fleet,24);assert.equal(setupSummary.pending,false);

    const run=async enabled=>{
      const env=await boot({browser,errors,storage,viewport:{width:844,height:390},bypassCSP:true});env.page.setDefaultTimeout(180000);await installWorker(env.page,enabled);
      const result=await advance(env.page,6,enabled?'qa-window-enabled':'qa-window-disabled'),state=await canonical(env.page);
      return {page:env.page,result,state};
    };
    const legacy=await run(false),windowed=await run(true);
    const diff=firstDiff(legacy.state,windowed.state);assert.deepEqual(diff,null,`window state differs from six hourly commits: ${JSON.stringify(diff)}`);
    assert.equal(legacy.result.reached,true);assert.equal(windowed.result.reached,true);assert.equal(windowed.result.failure,null);
    assert.equal(legacy.result.health.aggregateWindows,0);assert.equal(windowed.result.health.aggregateWindows,1);assert.equal(windowed.result.health.aggregateSubSlices,6);assert.equal(windowed.result.health.lastAggregateHours,6);
    assert.equal(legacy.result.health.hours,6);assert.equal(windowed.result.health.hours,6);assert.equal(windowed.result.health.days,legacy.result.health.days);
    assert.equal(windowed.result.thread.windowBegins,1);assert.equal(windowed.result.thread.windowSteps,6);assert.equal(windowed.result.thread.windowCommits,1);assert.equal(windowed.result.thread.windowRollbacks,0);

    const boundaries=await windowed.page.evaluate(()=>{
      const limit=__AUDIT__.emptyCalendarAggregateLimit;
      const maintenance=limit({from:6*3600,target:20*3600,batchSeconds:3600,maintenanceDueAt:9*3600});
      const midnight=limit({from:20*3600,target:30*3600,batchSeconds:3600,maintenanceDueAt:40*3600});
      const original=window.GH_REALISM;window.GH_REALISM={...original,hasPendingDeliveries:()=>true};let delivery;
      try{delivery=limit({from:6*3600,target:12*3600,batchSeconds:3600,maintenanceDueAt:20*3600});}finally{window.GH_REALISM=original;}
      return {maintenance,midnight,delivery};
    });
    assert.deepEqual(boundaries,{maintenance:3*3600,midnight:3*3600,delivery:0});

    const fallback=await windowed.page.evaluate(async()=>{
      const s=__GH_STATE__,a=__AUDIT__,before=a.simulationEngine.health(),threadBefore=GH_APP_RUNTIME_METRICS.snapshot().fleetEngineThread;
      const asset=GH_FLEET_DATA.find(s,row=>row.routeId&&row.phase==='moving')||GH_FLEET_DATA.find(s,row=>row.routeId);
      if(!asset)throw new Error('sale-fallback-asset-missing');
      GH_FLEET_DATA.update(s,asset.id,{phase:'moving',progress:.999999,salePending:true,crewBlocked:false,simulationFault:undefined});
      const target=s.simSeconds+2*3600,accepted=a.simulationEngine.advanceTo(target,{speed:600,batchSeconds:3600,reason:'qa-window-post-commit-fallback',maxSeconds:366*86400});
      for(let i=0;i<30000&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++)await new Promise(resolve=>setTimeout(resolve,5));
      for(let i=0;i<1000&&(window.__GH_DURABLE_COMMAND_CONTEXT__||GH_PERSISTENCE.isLocked());i++)await new Promise(resolve=>setTimeout(resolve,5));
      const after=a.simulationEngine.health(),threadAfter=GH_APP_RUNTIME_METRICS.snapshot().fleetEngineThread;
      return {accepted:accepted?.accepted===true,reached:Math.abs(s.simSeconds-target)<1e-6,failure:a.simulationEngine.snapshot().lastAdvanceFailure||null,aggregateFallbacks:after.aggregateFallbacks-before.aggregateFallbacks,windowRollbacks:threadAfter.windowRollbacks-threadBefore.windowRollbacks,manualFailures:after.manualFailures-before.manualFailures,hours:after.hours-before.hours,days:after.days-before.days};
    });
    assert.equal(fallback.accepted,true);assert.equal(fallback.reached,true);assert.equal(fallback.failure,null);assert.equal(fallback.manualFailures,0);assert.equal(fallback.hours,2);assert.equal(fallback.days,0);
    assert.ok(fallback.aggregateFallbacks>=1,JSON.stringify(fallback));assert.ok(fallback.windowRollbacks>=1,JSON.stringify(fallback));
    console.log(JSON.stringify({suite:'build362-calendar-window-equivalence',setup:setupSummary,groupedHealth,legacy:{slices:legacy.result.health.slices,hours:legacy.result.health.hours},window:{slices:windowed.result.health.slices,hours:windowed.result.health.hours,aggregateWindows:windowed.result.health.aggregateWindows,aggregateSubSlices:windowed.result.health.aggregateSubSlices,thread:windowed.result.thread},boundaries,fallback}));
    assert.deepEqual(errors,[]);console.log('BUILD362_CALENDAR_WINDOW_EQUIVALENCE_PASS');
    await legacy.page.close();await windowed.page.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
