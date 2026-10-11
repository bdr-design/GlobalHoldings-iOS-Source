'use strict';
// Build 372: the map and its status line take the fleet's classes over MAP_CLASS_FIELDS from the fleet engine's worker
// (app.js mapFleetClassRows: routes in motion, parked assets per base, owned bases, phase counts, road routes) instead of
// rebuilding the class tables on the main thread. The whole app (local DOM) with a real worker, an air fleet on routes
// and road trucks: once the summary is of the store's revision, every count the map and the status line draw from it
// equals the one read from the store on the main thread (countByFields, countByPhase, operationalRoutes); a summary
// arriving redraws the map; after more play the summary follows the store (a newer revision replaces it, never an older
// one), and its row indices are not used across a compaction.
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
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(900000000,definition.founding.minimumCapital),legalName:'QA Map Air',formationContract:'QA-MAP'},{silent:true});
      for(const icao of ['OMDB','EGLL','KJFK']){const row=W.airports.find(item=>item[0]===icao),id=`QA-map-${icao}`;await a.runAuthorizedDomainCommand('facilities','create',{facility:{id,name:`QA ${icao}`,kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:`air:${icao}`,code:row[1]||icao,icao,iata:row[1],city:row[3]||'—',country:String(row[5]||'—'),coords:[row[6],row[7]]},bucket:'globalBases'},{silent:true});}
      const model=[...GH_ASSET_CATALOG.air.used].filter(x=>!x.specs.cargo&&Number(x.specs.rangeKm)>=6000).sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      for(const icao of ['OMDB','EGLL','KJFK'])await a.buyAsset('air','used',model.id,'lease',25,`QA-map-${icao}`,true,`QA-MAP-${icao}`,'air');
    });
    await page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));
    await page.locator('.dispatch-international-network[data-company="air"]').first().click();
    await page.waitForFunction(()=>GH_FLEET_DATA.filter(__GH_STATE__,row=>row.ownerCompanyId==='air').filter(row=>row.routeId).length>=40,null,{timeout:180000});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:180000});
    await page.evaluate(()=>__AUDIT__.closeDrawer());
    const play=async ms=>{await page.evaluate(()=>__AUDIT__.setSpeed(3));await page.waitForTimeout(ms);await page.evaluate(()=>__AUDIT__.setSpeed(0));await page.waitForFunction(()=>!window.__AUDIT__.fleetEngineThreadClient?.()?.busy&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:60000});};
    await play(2500);
    const compare=async label=>{
      // Ask until the summary is of the store's revision (no step in flight now).
      await page.waitForFunction(()=>{__AUDIT__.mapFleetClassRows();const m=__AUDIT__.mapFleetSummary();return m.store===__GH_STATE__.fleet&&m.revision===__GH_STATE__.fleet.revision;},null,{timeout:30000,polling:50});
      return page.evaluate(label=>{
        const A=__AUDIT__,F=GH_FLEET_DATA,state=__GH_STATE__,parkedKey=row=>F.presentedPhase(state,row)==='moving'?null:row.baseFacility;
        const entries=map=>JSON.stringify([...map].sort((x,y)=>String(x[0]).localeCompare(String(y[0]))));
        const bases=[A.mapFleetCount(['baseFacility'],row=>row.baseFacility),F.countByFields(state,['baseFacility'],row=>row.baseFacility)];
        const parked=[A.mapFleetCount(['baseFacility','phase','routeId','simulationFault'],parkedKey),F.countByFields(state,['baseFacility','phase','routeId','simulationFault'],parkedKey)];
        A.updateMapStatus();const status=A.mapStatusCounts(),phases=F.countByPhase(state);
        const roads=A.mapRoadRouteCount(),roadsMain=A.operationalRoutes('road').filter(r=>r.routingSource).length;
        return {label,bases:entries(bases[0])===entries(bases[1]),parked:entries(parked[0])===entries(parked[1]),
          status:status.moving===(phases.get('moving')||0)&&status.idle===(phases.get('idle')||0)&&status.turn===(phases.get('turnaround')||0),roads:roads===roadsMain,
          counts:{moving:status.moving,turn:status.turn,idle:status.idle,bases:bases[0].size},received:A.mapFleetSummary().received,revision:A.mapFleetSummary().revision};
      },label);
    };
    const first=await compare('after-play');
    await play(2500);
    const second=await compare('after-more-play');
    // A compaction moves rows: the summary's row indices are not used until a summary of the new layout arrives.
    const compaction=await page.evaluate(async()=>{
      const A=__AUDIT__,STORE=GH_FLEET_STORE,store=__GH_STATE__.fleet;A.mapFleetClassRows();
      const epochBefore=STORE.epoch(store);STORE.bumpEpoch(store);const usable=A.mapFleetClassRows();
      return {epochMoved:STORE.epoch(store)!==epochBefore,usable:usable!==null};
    });
    const afterCompaction=await compare('after-compaction');
    for(const row of [first,second,afterCompaction])console.log(JSON.stringify(row));
    assert.deepEqual(errors,[]);
    for(const row of [first,second,afterCompaction]){assert.equal(row.bases,true,`${row.label}: owned bases`);assert.equal(row.parked,true,`${row.label}: parked per base`);assert.equal(row.status,true,`${row.label}: phase counts`);assert.equal(row.roads,true,`${row.label}: road routes`);}
    assert.ok(first.counts.moving+first.counts.turn+first.counts.idle===75,'every asset counted');
    assert.ok(second.revision>first.revision&&second.received>first.received,'a newer summary replaced the older one');
    assert.equal(compaction.epochMoved,true);assert.equal(compaction.usable,false,'row indices are not used across a compaction');
    console.log(JSON.stringify({ok:true}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
