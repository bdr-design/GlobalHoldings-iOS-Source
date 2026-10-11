'use strict';
// Build 372: the save check (GH_SAVE_SCHEMA validationSteps) takes the fleet's classes of rows and id check from the
// fleet engine's worker when its caller runs the sections across frames (app.js fleetClassesForValidation, the
// maintenance schema task, a durable command's draft, a staged transaction's post-commit check). The whole app (local
// DOM) with a real worker and an air fleet on routes: the result with the worker's classes ({ok, errors}) must equal the
// one-shot validate() exactly, on a healthy fleet and with each fleet fault the check reports (a condition out of range,
// an unknown route, a duplicate id, an unsafe display text), and the worker's classes must really be used
// (fleetWork.workerClasses). A write between the request and the result makes the result stale: the section then reads
// the store itself (workerClasses 0) and still equals validate() of the store as written. The game then plays and saves.
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
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(900000000,definition.founding.minimumCapital),legalName:'QA Validation Air',formationContract:'QA-VALIDATION'},{silent:true});
      for(const icao of ['OMDB','EGLL']){const row=W.airports.find(item=>item[0]===icao),id=`QA-val-${icao}`;await a.runAuthorizedDomainCommand('facilities','create',{facility:{id,name:`QA ${icao}`,kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:`air:${icao}`,code:row[1]||icao,icao,iata:row[1],city:row[3]||'—',country:String(row[5]||'—'),coords:[row[6],row[7]]},bucket:'globalBases'},{silent:true});}
      const model=[...GH_ASSET_CATALOG.air.used].filter(x=>!x.specs.cargo&&Number(x.specs.rangeKm)>=6000).sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      for(const icao of ['OMDB','EGLL'])await a.buyAsset('air','used',model.id,'lease',30,`QA-val-${icao}`,true,`QA-VAL-${icao}`,'air');
    });
    await page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));
    await page.locator('.dispatch-international-network[data-company="air"]').first().click();
    await page.waitForFunction(()=>GH_FLEET_DATA.filter(__GH_STATE__,row=>row.ownerCompanyId==='air').every(row=>row.routeId),null,{timeout:180000});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:180000});
    await page.evaluate(()=>__AUDIT__.closeDrawer());
    // A few slices so the fleet thread exists and holds the store.
    await page.evaluate(()=>__AUDIT__.setSpeed(3));
    await page.waitForFunction(()=>(window.__AUDIT__.fleetEngineThreadClient?.()?.stats?.().applied||0)>=3,null,{timeout:120000});
    await page.evaluate(()=>__AUDIT__.setSpeed(0));
    await page.waitForFunction(()=>!window.__AUDIT__.fleetEngineThreadClient().busy&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:60000});
    const result=await page.evaluate(async()=>{
      const S=GH_SAVE_SCHEMA,STORE=GH_FLEET_STORE,state=__GH_STATE__,store=state.fleet,provider=globalThis.GH_FLEET_CLASSES_PROVIDER,log=[];
      // The sections as a cooperative caller runs them, with the worker's classes; between={after first wait: fn}.
      const sections=async between=>{
        const steps=S.validationSteps(state,{trustVerified:true,fleetClasses:provider});let step,waited=false;
        while(!(step=steps.next()).done){if(step.value==='fleet-classes-wait'){if(!waited&&between){between();}waited=true;await new Promise(resolve=>setTimeout(resolve,4));}}
        return {check:step.value,fleetWork:S.telemetry?.()?.lastValidation?.fleetWork||null};
      };
      const compare=async(label,between)=>{
        const {check,fleetWork}=await sections(between),once=S.validate(state,{trustVerified:true});
        const same=check.ok===once.ok&&JSON.stringify([...check.errors].sort())===JSON.stringify([...once.errors].sort());
        log.push({label,ok:check.ok,errors:check.errors,same,workerClasses:fleetWork?.workerClasses??null,classWaits:fleetWork?.classWaits??null});
        return same;
      };
      const rows=[...Array(store.length).keys()].filter(index=>STORE.isAlive(store,index)),keep=index=>({id:STORE.idAt(store,index),condition:STORE.peek(store,index,'condition'),routeId:STORE.peek(store,index,'routeId'),name:STORE.peek(store,index,'name')});
      const restore=(index,before)=>{for(const [field,value] of Object.entries(before))STORE.set(store,index,field,value);};
      await compare('healthy');
      const faults=[['condition',index=>STORE.set(store,index,'condition',150)],['route',index=>STORE.set(store,index,'routeId','QA-NO-SUCH-ROUTE')],['duplicate-id',index=>STORE.set(store,index,'id',STORE.idAt(store,rows[0]))],['display-text',index=>STORE.set(store,index,'name','QA <script>')]];
      for(const [label,make] of faults){const index=rows[5],before=keep(index);make(index);await compare(label);restore(index,before);}
      await compare('restored');
      // A write after the request: the worker's result is stale, the section reads the store itself.
      const index=rows[7],before=keep(index);await compare('stale',()=>STORE.set(store,index,'condition',151));restore(index,before);
      return log;
    });
    for(const row of result)console.log(JSON.stringify(row));
    assert.deepEqual(errors,[]);
    for(const row of result)assert.equal(row.same,true,`${row.label}: the result with the worker's classes equals validate()`);
    const by=Object.fromEntries(result.map(row=>[row.label,row]));
    assert.equal(by.healthy.ok,true);assert.equal(by.restored.ok,true);
    assert.ok(by.condition.errors.includes('asset-condition'));assert.ok(by.route.errors.includes('asset-route-reference'));assert.ok(by['duplicate-id'].errors.includes('asset-id'));assert.ok(by['display-text'].errors.length>0);
    for(const label of ['healthy','condition','route','duplicate-id','display-text','restored'])assert.equal(by[label].workerClasses,1,`${label}: the worker's classes were used`);
    assert.equal(by.stale.workerClasses,0,'a stale result is not used');assert.ok(by.stale.errors.includes('asset-condition'),'the store as written is checked');
    // The game still plays and saves.
    await page.evaluate(()=>__AUDIT__.setSpeed(3));await page.waitForTimeout(1500);await page.evaluate(()=>__AUDIT__.setSpeed(0));
    const drained=await page.evaluate(()=>GH_PERSISTENCE.drain({timeoutMs:60000}));assert.equal(drained?.ok,true);
    console.log(JSON.stringify({ok:true,checks:result.length}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
