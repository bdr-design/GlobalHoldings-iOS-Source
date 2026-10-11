'use strict';
// Build 372: the fleet passes of fleet-query-core (the shared dispatch's eligibility pass, the route center's card sums)
// run on the fleet engine's worker (GH_FLEET_ENGINE_THREAD query) when its replica is exactly the store. With a real
// worker, on a store of 70,000 rows with several companies, modes, phases, routes and last trips:
//   - the worker's result equals the main thread's (GH_FLEET_QUERY.run on the store), exactly, for dispatchEligible of
//     each company and mode (with a limit that cuts the list) and for routeCards of each company over its routes (trip
//     sums in row order), after writes made just before the request;
//   - a store holding a row with neither ownerCompanyId nor companyId (owned through the legacy mode table, which only the
//     main thread has): the worker declines (null) and the main thread's pass gives the legacy owner;
//   - with a step in flight: null at once; current(result, store) is false after a write;
//   - conditionSum (the daily close's insured condition total) is the same double on both sides and equals realism-core's
//     own pass (a row at 0, NaN or without a condition counts 100);
//   - the module's passes give exactly what app.js's own passes gave before Build 372 (kept here verbatim).
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
      const STORE=GH_FLEET_STORE,DATA=GH_FLEET_DATA,Q=GH_FLEET_QUERY,log=[];
      const assets=[];for(let i=0;i<70000;i++){const a=structuredClone(fleet[i%fleet.length]);a.id=`QA-${String(i).padStart(7,'0')}`;if(i%7===0)a.lastTrip={margin:(i%13)*1.37,revenue:(i%17)*10.11};if(i%11===0){a.phase='turnaround';a.departureScheduled=i%22===0;}if(i%19===0)a.deliveryStatus='pending';assets.push(a);}
      const state={fleet:STORE.fromAssets(assets,{at:0}),simSeconds:0};assets.length=0;const store=state.fleet;
      const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),plans=new Map(Object.entries(routes));
      const client=GH_FLEET_ENGINE_THREAD.create({workerFactory:()=>new Worker(url),resolveRoute:id=>plans.get(String(id))?{...plans.get(String(id))}:null,routesRevision:()=>0,catalogSpecs:()=>({}),timeoutMs:60000});
      const legacyOwner=mode=>({road:'road',air:'air',sea:'sea'})[mode]||null;
      const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
      const compare=async(label,name,params)=>{
        const asked=client.query(store,{name,params,simSeconds:state.simSeconds});if(!asked)throw new Error(`${label}: refused`);
        const found=await asked;if(!found)throw new Error(`${label}: no result`);if(!client.current(found,store))throw new Error(`${label}: not current`);
        const expected=Q.run(name,state,DATA,{...params,legacyOwner}),ok=same(found.result,expected);
        log.push({label,ok,size:name==='dispatchEligible'?expected.indices.length:name==='routeCards'?expected.cards.length:expected.sum});if(!ok)throw new Error(`${label}: differs`);
      };
      client.prime(store);await new Promise(resolve=>setTimeout(resolve,300));
      const live=()=>{const out=[];for(let i=0;i<store.length;i++)if(STORE.isAlive(store,i))out.push(i);return out;};
      const rows=live();for(const index of rows.slice(100,400))STORE.set(store,index,'routeId',null);STORE.set(store,rows[500],'salePending',true);STORE.removeMany(store,[rows[600],rows[601]]);
      for(const [companyId,type] of [['road','road'],['air','air'],['sea','sea']]){
        await compare(`eligible-${companyId}`,'dispatchEligible',{companyId,type,limit:20000});
        await compare(`eligible-${companyId}-cut`,'dispatchEligible',{companyId,type,limit:7});
        await compare(`cards-${companyId}`,'routeCards',{companyId,routeIds:Object.keys(routes)});
      }
      // The insured condition total (a row at 0, one NaN and one without a condition count as 100): the same double.
      STORE.set(store,rows[900],'condition',0);STORE.set(store,rows[901],'condition',NaN);STORE.set(store,rows[902],'condition',undefined);STORE.set(store,rows[903],'condition',63.17);
      await compare('condition-sum','conditionSum',{});
      // A legacy-owned row (no ownerCompanyId, no companyId).
      const legacyIndex=rows[700];STORE.set(store,legacyIndex,'ownerCompanyId',undefined);STORE.set(store,legacyIndex,'companyId',undefined);
      const declined=await client.query(store,{name:'dispatchEligible',params:{companyId:'road',type:'road'}})===null;
      const mainLegacy=Q.run('dispatchEligible',state,DATA,{companyId:'road',type:'road',legacyOwner});
      const withoutTable=Q.run('dispatchEligible',state,DATA,{companyId:'road',type:'road'});
      // A step in flight.
      const ticket=client.request(store,{from:0,to:1800,context,contextKey:'k',tripAlertLimit:64,order:'events',maxEvents:4000,budget:4000});
      const refusedInFlight=client.query(store,{name:'routeCards',params:{companyId:'road',routeIds:['R1']}})===null;client.discard(ticket);
      await new Promise(resolve=>setTimeout(resolve,50));
      const asked=client.query(store,{name:'routeCards',params:{companyId:'air',routeIds:['A1']}});STORE.set(store,rows[800],'condition',70);const late=await asked;
      // The passes as app.js made them before Build 372 (verbatim, with its owner and mode helpers): the module's results
      // must equal them.
      const assetModeOf=asset=>String(asset?.assetMode||asset?.type||'').trim(),assetOwnerCompanyId=asset=>String(asset?.ownerCompanyId||asset?.companyId||legacyOwner(assetModeOf(asset))||'').trim();
      const oldEligible=(draft,companyId,type,SHARED_DISPATCH_LIMIT)=>{const F=DATA,eligibleUnsorted=[],initialLoads=new Map();let remaining=0,remainingOnRoutes=0;
        F.scan(draft,['ownerCompanyId','companyId','assetMode','type','deliveryStatus','phase','departureScheduled','salePending','routeId'],(row,index)=>{
          if(assetOwnerCompanyId(row)!==companyId||assetModeOf(row)!==type)return;
          const idle=row.deliveryStatus!=='pending'&&row.phase!=='moving'&&!row.departureScheduled&&!row.salePending;
          if(idle&&eligibleUnsorted.length<SHARED_DISPATCH_LIMIT){eligibleUnsorted.push(index);return;}
          if(idle){remaining++;if(row.routeId)remainingOnRoutes++;}
          if(row.routeId)initialLoads.set(row.routeId,(initialLoads.get(row.routeId)||0)+1);
        });return {legacy:false,indices:eligibleUnsorted,remaining,remainingOnRoutes,initialLoads:[...initialLoads]};};
      const oldCards=(companyId,routeIds)=>{const fleet=DATA,wanted=new Set(routeIds),out=new Map();
        fleet.scan(state,['ownerCompanyId','companyId','assetMode','type','routeId','phase','departureScheduled','lastTrip','id'],row=>{
          if(!row.routeId||!wanted.has(row.routeId)||assetOwnerCompanyId(row)!==companyId)return;
          let card=out.get(row.routeId);if(!card){card={count:0,turn:0,scheduled:0,inMotion:0,primaryId:row.id,scored:0,margin:0,revenue:0};out.set(row.routeId,card);}
          card.count++;if(row.phase==='turnaround'){if(row.departureScheduled)card.scheduled++;else card.turn++;}else if(row.phase==='moving')card.inMotion++;
          if(row.lastTrip){card.scored++;card.margin=card.margin+(Number(row.lastTrip.margin)||0);card.revenue=card.revenue+(Number(row.lastTrip.revenue)||0);}
        });return {legacy:false,cards:[...out]};};
      const asOld=[];for(const [companyId,type] of [['road','road'],['air','air'],['sea','sea']])for(const limit of [20000,7])asOld.push(same(Q.run('dispatchEligible',state,DATA,{companyId,type,limit,legacyOwner}),oldEligible(state,companyId,type,limit)));
      for(const companyId of ['road','air','sea'])asOld.push(same(Q.run('routeCards',state,DATA,{companyId,routeIds:Object.keys(routes),legacyOwner}),oldCards(companyId,Object.keys(routes))));
      // realism-core fleetConditionSum as it reads the store itself.
      const oldConditionSum=()=>{let sum=0;DATA.scan(state,['condition'],a=>{sum+=Number(a.condition)||100;});return sum;};
      asOld.push(Object.is(Q.run('conditionSum',state,DATA,{}).sum,oldConditionSum()));
      const stats=client.stats();client.terminate('done');
      return {log,asOld,declined,legacyCounted:mainLegacy.legacy===false,withoutTableLegacy:withoutTable.legacy===true,refusedInFlight,staleAfterWrite:client.current(late,store)===false,queryRequests:stats.queryRequests,maxQueryWorkerMs:stats.maxQueryWorkerMs};
    },{workerSource,fleet:FIX.fleet(),routes:FIX.routes,context:FIX.context(0)});
    for(const row of result.log)console.log(JSON.stringify(row));
    assert.deepEqual(errors,[]);assert.ok(result.log.length===10&&result.log.every(row=>row.ok));
    assert.ok(result.log.find(row=>row.label==='eligible-road-cut').size===7);
    assert.deepEqual(result.asOld,Array(10).fill(true),'the module gives what app.js gave (legacy row included)');
    assert.equal(result.declined,true,'the worker declines a pass needing the legacy owner table');
    assert.equal(result.legacyCounted,true);assert.equal(result.withoutTableLegacy,true);
    assert.equal(result.refusedInFlight,true);assert.equal(result.staleAfterWrite,true);
    console.log(JSON.stringify({ok:true,queryRequests:result.queryRequests,maxQueryWorkerMs:result.maxQueryWorkerMs}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
