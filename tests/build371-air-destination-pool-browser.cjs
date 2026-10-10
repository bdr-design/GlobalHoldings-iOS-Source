'use strict';
// Build 371 regression from the iPhone diagnostic (code GH AIR 3181, "no safe, diverse air destination within the fleet
// group's range"): 4,300 ATR 72s (1,403 km) at Dubai rolled back as one command and none departed. Each new route sampled
// 900 rows of the whole 28,291-airport catalogue, so about 5 of them were within reach of Dubai; once those were taken
// by earlier routes from the same origin every candidate was a duplicate corridor. 269 routes were wanted and Dubai
// reaches 265 airports in all.
// Here, through the native save path (an in-page stand-in of the vault), the same fleet is dispatched with the real
// button: destinations come from the airports within reach, the batches left when they run out join routes already
// opened from Dubai (their capacity raised), every aircraft departs or holds a slot, the save validates and the fleet
// flies three simulated hours without faults. The rollback trace never records an aircraft name as a reason code.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const QTY=4300,SITE='OMDB',MODEL='UA-ATR72';

function installVault(){
  const vault=window.__VAULT__={chunks:new Map(),saves:[],generation:0};
  const deliver=(name,detail)=>setTimeout(()=>window.dispatchEvent(new CustomEvent(name,{detail})),0);
  const decode=b64=>{const bin=atob(b64),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;};
  const referenced=json=>{try{const rows=JSON.parse(json)?.fleet?.rows;return rows?.$ghBinary==='chunks-v1'?rows.chunks:[];}catch{return [];}};
  const bridge={postMessage(m){
    if(m.action==='storeSaveChunk'){vault.chunks.set(m.id,decode(m.base64));return deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:true});}
    if(m.action==='commitSave'||m.action==='resetGameSave'||m.action==='saveManualSlot'){
      const missing=referenced(m.saveJSON).find(id=>!vault.chunks.has(id)),ok=!missing;
      if(m.action==='saveManualSlot')return deliver('gh-native-slot-ack',{requestId:m.requestId,action:m.action,index:m.index,success:ok,message:missing?`Missing save chunk: ${missing}`:''});
      if(ok){vault.saves.push(m.saveJSON);if(vault.saves.length>2)vault.saves.shift();}
      deliver(m.action==='resetGameSave'?'gh-native-reset-ack':'gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:ok,generation:ok?++vault.generation:undefined,message:missing?`Missing save chunk: ${missing}`:''});
    }
  }};
  window.webkit={messageHandlers:{saveBridge:bridge,updateBridge:bridge}};window.GH_NATIVE_BUILD=358;
}

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(300000);
    await page.evaluate(installVault);
    const prepared=await page.evaluate(async({qty,site,modelId})=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,type='air',definition=GH_COMPANY_PLATFORM.definitionFor(s(),type);
      if(!s().openedCompanies.includes(type))await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,definition.founding.minimumCapital),legalName:'QA Destination Pool',formationContract:'QA-DESTINATION-POOL'},{silent:true});
      s().godMoney=true;s().infiniteMoney=true;
      const airport=GH_WORLD_DATA.airports.find(r=>r[0]===site),facility={id:`QA-air-${airport[0]}`,name:`QA Airport ${airport[0]}`,kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:`air:${airport[0]}`,code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]};
      await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});
      let bought=0,order=0;while(bought<qty){const n=Math.min(3000,qty-bought);if(!await a.buyAsset(type,'used',modelId,'lease',n,facility.id,true,`QA-POOL-${order++}`,type))return {error:'purchase',bought};bought+=n;}
      return {bought,rangeKm:GH_ASSET_CATALOG.air.used.find(x=>x.id===modelId).specs.rangeKm};
    },{qty:QTY,site:SITE,modelId:MODEL});
    assert.equal(prepared.bought,QTY,`purchases: ${JSON.stringify(prepared)}`);
    assert.ok(prepared.rangeKm<1500,'the fleet is short-ranged, so Dubai has fewer reachable airports than the routes wanted');

    await page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));
    const button=page.locator('.dispatch-international-network[data-company="air"]').first();
    await button.waitFor({state:'visible',timeout:30000});const started=Date.now();await button.click();
    let last=null;
    for(let i=0;i<600;i++){last=await page.evaluate(()=>window.GH_APP_RUNTIME_METRICS?.snapshot?.().durable?.last||null);if(last?.name==='authorized:bulk-shared-departure:air')break;await page.waitForTimeout(250);}
    const dispatchMs=Date.now()-started;
    const dispatched=await page.evaluate(()=>{
      const s=__GH_STATE__,F=GH_FLEET_DATA,routes=(s.customRoutes||[]).filter(r=>(r.routeMode||r.type)==='air'),users=new Map();let owned=0,routed=0,underway=0;
      F.scan(s,['ownerCompanyId','companyId','routeId','phase','departureScheduled'],r=>{if((r.ownerCompanyId||r.companyId)!=='air')return;owned++;if(r.routeId){routed++;users.set(r.routeId,(users.get(r.routeId)||0)+1);}if(r.phase==='moving'||r.departureScheduled)underway++;});
      const trace=GH_DIAGNOSTICS.departureTraceSnapshot(s),destinations=new Set(routes.map(r=>r.toFacility));
      const origin=s.globalBases.find(row=>row.id==='QA-air-OMDB')?.coords||null,range=GH_ASSET_CATALOG.air.used.find(row=>row.id==='UA-ATR72').specs.rangeKm,rad=Math.PI/180,directReachable=origin?GH_WORLD_DATA.airports.filter(row=>{const lat1=origin[0]*rad,lat2=row[6]*rad,dl=(row[6]-origin[0])*rad,dn=(row[7]-origin[1])*rad,h=Math.sin(dl/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dn/2)**2,d=2*6371.0088*Math.asin(Math.sqrt(h));return d>=35&&d<=range*1.005;}).length:0;
      return {owned,routed,underway,routes:routes.length,destinations:destinations.size,over:routes.filter(r=>(users.get(r.id)||0)>GH_FLEET_CORE.routeCapacity(r)).length,raised:routes.filter(r=>r.fleetCapacity).length,alert:(s.alerts||[]).slice(0,5).map(row=>String(row?.text||row)).join(' | '),reasons:Object.keys(trace?.byReason||{}),planner:trace?.recent?.[0]?.planner||null,origin,range,directReachable,valid:GH_SAVE_SCHEMA.validate(s).ok};
    });
    assert.equal(last?.committed,true,`the dispatch commits: ${JSON.stringify({last,dispatched})}`);
    assert.equal(dispatched.routed,QTY,`every aircraft has a route: ${JSON.stringify(dispatched)}`);
    assert.equal(dispatched.underway,QTY,`every aircraft departs or holds a slot: ${JSON.stringify(dispatched)}`);
    assert.equal(dispatched.destinations,dispatched.routes,'each route from Dubai has its own destination');
    assert.ok(dispatched.routes>200,`the network spreads over the reachable airports, not ~100 of them: ${dispatched.routes}`);
    assert.match(dispatched.alert,/انضمت \d+ دفعة إلى مسارات قائمة/,'the player is told that batches joined existing routes once the reachable destinations ran out');
    assert.ok(dispatched.raised>0,'the joined routes record their raised capacity');
    assert.equal(dispatched.over,0,'no route carries more than its capacity');
    assert.equal(dispatched.planner?.indexBuilds,1,'the origin distance index is built once for the dispatch');
    assert.equal(dispatched.planner?.rowsScanned,await page.evaluate(()=>GH_WORLD_DATA.airports.length),'the index scans each airport once');
    assert.ok(dispatched.planner?.indexCacheHits>0,'different ATR range groups reuse the same origin index');
    assert.ok(dispatched.planner?.indexMaxDistanceSliceMs<16,'fallback distance calculations yield in bounded slices');
    assert.ok(dispatched.planner?.indexMaxSortSliceMs<16,'the no-Worker fallback yields during sorting instead of blocking on one full catalogue sort');
    const firstRoutes=await page.evaluate(()=>{const routes=(__GH_STATE__.customRoutes||[]).filter(r=>(r.routeMode||r.type)==='air');return {ids:[...new Set(routes.map(r=>r.id))],capacity:Object.fromEntries(routes.map(r=>[r.id,GH_FLEET_CORE.routeCapacity(r)]))};});
    const secondPurchase=await page.evaluate(async({qty,modelId})=>{
      const a=__AUDIT__,s=__GH_STATE__,site=s.globalBases.find(row=>row.id==='QA-air-OMDB');if(!site)return {error:'base-missing'};
      const previousIds=new Set();GH_FLEET_DATA.scan(s,['ownerCompanyId','companyId','id'],row=>{if((row.ownerCompanyId||row.companyId)==='air')previousIds.add(row.id);});
      let bought=0,order=0;while(bought<qty){const n=Math.min(3000,qty-bought);if(!await a.buyAsset('air','used',modelId,'lease',n,site.id,true,`QA-POOL-REUSE-${order++}`,'air'))return {error:'purchase',bought};bought+=n;}
      const ids=[];GH_FLEET_DATA.scan(s,['ownerCompanyId','companyId','id'],row=>{if((row.ownerCompanyId||row.companyId)==='air'&&!previousIds.has(row.id))ids.push(row.id);});
      window.__GH_POOL_REUSE_IDS__=ids;return {bought,ids:ids.length,revision:s.saveRevision};
    },{qty:300,modelId:MODEL});
    assert.equal(secondPurchase.bought,300,`a second purchased batch exists: ${JSON.stringify(secondPurchase)}`);
    await page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));
    const beforeReuse=secondPurchase.revision;await button.click();
    let reuseRevision=beforeReuse;
    for(let i=0;i<600;i++){reuseRevision=await page.evaluate(()=>__GH_STATE__.saveRevision);if(reuseRevision>beforeReuse)break;await page.waitForTimeout(250);}
    assert.ok(reuseRevision>beforeReuse,'the second dispatch commits after purchasing more aircraft');
    const reuseCommit=await page.evaluate(()=>window.GH_APP_RUNTIME_METRICS?.snapshot?.().durable?.last||null);
    assert.equal(reuseCommit?.name,'authorized:bulk-shared-departure:air','the reused-route dispatch is the last durable command');
    assert.equal(reuseCommit?.committed,true,'the reused-route dispatch receives a durable commit');
    const reuse=await page.evaluate(({qty,previous,previousCapacity})=>{
      const s=__GH_STATE__,F=GH_FLEET_DATA,ids=new Set(window.__GH_POOL_REUSE_IDS__||[]),users=new Map(),routes=(s.customRoutes||[]).filter(r=>(r.routeMode||r.type)==='air');let routed=0,over=0,existingRouteAssets=0;
      F.scan(s,['ownerCompanyId','companyId','id','routeId'],r=>{if((r.ownerCompanyId||r.companyId)!=='air')return;if(r.routeId)users.set(r.routeId,(users.get(r.routeId)||0)+1);if(ids.has(r.id)&&r.routeId){routed++;if(previous.includes(r.routeId))existingRouteAssets++;}});
      const byId=new Map(routes.map(route=>[route.id,route]));let raisedOldRoutes=0,underOldCapacity=0;for(const [id,count] of users){const route=byId.get(id),capacity=route?GH_FLEET_CORE.routeCapacity(route):0,oldCapacity=previousCapacity[id]||0;if(!route||count>capacity||capacity>8192)over++;if(previous.includes(id)&&capacity>oldCapacity)raisedOldRoutes++;if(previous.includes(id)&&count>oldCapacity&&capacity<=oldCapacity)underOldCapacity++;}
      return {routed,existingRouteAssets,routes:routes.length,createdSinceFirst:routes.filter(r=>!previous.includes(r.id)).length,over,raisedOldRoutes,underOldCapacity,alert:(s.alerts||[]).slice(0,5).map(row=>String(row?.text||row)).join(' | '),valid:GH_SAVE_SCHEMA.validate(s).ok};
    },{qty:300,previous:firstRoutes.ids,previousCapacity:firstRoutes.capacity});
    assert.equal(reuse.routed,300,`all newly bought aircraft are routed: ${JSON.stringify(reuse)}`);
    assert.ok(reuse.existingRouteAssets>0,`the later order reuses at least one route that existed before that order: ${JSON.stringify(reuse)}`);
    assert.equal(reuse.createdSinceFirst,0,`the second dispatch reuses routes without creating new destinations: ${JSON.stringify(reuse)}`);
    assert.ok(reuse.raisedOldRoutes>0,`at least one route registered before the second purchase has its capacity raised: ${JSON.stringify(reuse)}`);
    assert.equal(reuse.over,0,'second dispatch respects the route capacity ceiling');
    assert.equal(reuse.underOldCapacity,0,'no preexisting route load exceeds its recorded pre-dispatch capacity');
    assert.equal(reuse.valid,true,'the second dispatch save validates');
    const largePool=await page.evaluate(async({qty,modelId})=>{
      const a=__AUDIT__,s=__GH_STATE__,airport=GH_WORLD_DATA.airports.find(r=>r[0]==='EGLL'),facility={id:'QA-air-EGLL',name:'QA Airport EGLL',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:EGLL',code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]};
      await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});
      if(!await a.buyAsset('air','used',modelId,'lease',qty,facility.id,true,'QA-POOL-LARGE','air'))return {error:'purchase'};
      const original=window.GH_ROUTE_CORE;window.__GH_ROUTE_CORE_ORIGINAL__=original;let remaining=900;window.__GH_FORCED_PREVIEW_CONFLICTS__=0;
      window.GH_ROUTE_CORE={...original,conflict(target,route){if(String(route?.id||'').startsWith('PREVIEW-AIR-')&&remaining>0){remaining--;window.__GH_FORCED_PREVIEW_CONFLICTS__++;return true;}return original.conflict(target,route);}};
      return {bought:qty,revision:s.saveRevision,rangeKm:GH_ASSET_CATALOG.air.used.find(row=>row.id===modelId).specs.rangeKm};
    },{qty:32,modelId:MODEL});
    assert.equal(largePool.bought,32,`a long-range airport fixture is ready: ${JSON.stringify(largePool)}`);
    await page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));
    const beforeLargePool=largePool.revision;await button.click();let largeRevision=beforeLargePool;
    for(let i=0;i<600;i++){largeRevision=await page.evaluate(()=>__GH_STATE__.saveRevision);if(largeRevision>beforeLargePool)break;await page.waitForTimeout(250);}
    const largePoolResult=await page.evaluate(()=>{
      const s=__GH_STATE__,trace=GH_DIAGNOSTICS.departureTraceSnapshot(s),routes=(s.customRoutes||[]).filter(route=>(route.routeMode||route.type)==='air');
      const ids=new Set();GH_FLEET_DATA.scan(s,['ownerCompanyId','companyId','routeId','baseFacility'],row=>{if((row.ownerCompanyId||row.companyId)==='air'&&row.baseFacility==='QA-air-EGLL'&&row.routeId)ids.add(row.routeId);});
      const original=window.GH_ROUTE_CORE;window.GH_ROUTE_CORE=window.__GH_ROUTE_CORE_ORIGINAL__||original;
      const planner=trace?.recent?.[0]?.planner||{};
      return {routes:ids.size,forcedConflicts:window.__GH_FORCED_PREVIEW_CONFLICTS__,windows:planner.windows||0,acceptedWindow:planner.lastAcceptedWindow||0,maxAcceptedWindow:planner.maxAcceptedWindow||0,reachable:planner.reachableMax||0,valid:GH_SAVE_SCHEMA.validate(s).ok};
    });
    assert.ok(largeRevision>beforeLargePool,'the dispatch succeeds after rejecting the entire first destination window');
    const largeCommit=await page.evaluate(()=>window.GH_APP_RUNTIME_METRICS?.snapshot?.().durable?.last||null);
    assert.equal(largeCommit?.name,'authorized:bulk-shared-departure:air','the later-window dispatch is the last durable command');
    assert.equal(largeCommit?.committed,true,'the later-window dispatch receives a durable commit');
    assert.equal(largePoolResult.forcedConflicts,900,'the test makes all 900 candidates in the first window conflict');
    assert.ok(largePoolResult.reachable>900&&largePoolResult.windows>=2,`the planner inspects a second window from a pool larger than 900: ${JSON.stringify(largePoolResult)}`);
    assert.ok(largePoolResult.maxAcceptedWindow>=2,`at least one chosen destination came from a later window: ${JSON.stringify(largePoolResult)}`);
    assert.ok(largePoolResult.routes>0,'the second window supplies a valid route');
    assert.equal(largePoolResult.valid,true,'the large-pool dispatch save validates');
    assert.ok(!dispatched.reasons.some(code=>/^GH (AIR|SEA) \d+$/.test(code)),`no reason code reads as an asset name: ${dispatched.reasons}`);
    assert.equal(dispatched.valid,true,'the save validates');

    const flown=await page.evaluate(async()=>{
      const s=__GH_STATE__,F=GH_FLEET_DATA,target=s.simSeconds+3*3600;__AUDIT__.simulationEngine.advanceTo(target,{speed:600,batchSeconds:3600,reason:'qa-destination-pool',maxSeconds:86400});
      for(let i=0;i<2400&&s.simSeconds<target-1;i++)await new Promise(r=>setTimeout(r,50));
      let moving=0,faults=0,trips=0;F.scan(s,['phase','simulationFault','lastTrip'],r=>{if(r.phase==='moving')moving++;if(r.simulationFault)faults++;if(r.lastTrip)trips++;});
      return {sim:s.simSeconds,target,moving,faults,trips,valid:GH_SAVE_SCHEMA.validate(s).ok,saves:__VAULT__.saves.length};
    });
    assert.ok(flown.sim>=flown.target-1,`three simulated hours pass: ${JSON.stringify(flown)}`);
    assert.equal(flown.faults,0,'no simulation faults');
    assert.ok(flown.trips>0&&flown.moving>0,`the fleet flies: ${JSON.stringify(flown)}`);
    assert.equal(flown.valid,true,'the save still validates');
    assert.ok(flown.saves>0,'the native vault holds the committed save');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build371-air-destination-pool-browser',aircraft:QTY,site:SITE,model:MODEL,dispatchMs,routes:dispatched.routes,raised:dispatched.raised,planner:dispatched.planner,reused:{assets:reuse.routed,preexistingRouteAssets:reuse.existingRouteAssets,createdSinceFirst:reuse.createdSinceFirst},largePool:{reachable:largePoolResult.reachable,windows:largePoolResult.windows,forcedConflicts:largePoolResult.forcedConflicts},after3h:{moving:flown.moving,assetsWithLastTrip:flown.trips},environment:`Chromium local DOM; in-page native vault stand-in; ${path.basename(__filename)}`}));
    console.log('BUILD371_AIR_DESTINATION_POOL_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
