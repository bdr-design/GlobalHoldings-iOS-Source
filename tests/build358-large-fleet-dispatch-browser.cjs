'use strict';
// Build 358 (million-asset) regression from an iPhone diagnostic: 12,000 aircraft could not leave the ground. The
// route registry holds 240 routes and a route carried 24 aircraft, so bulk dispatch refused any air fleet above
// 5,760 ("route registry capacity is not enough"). A route may now carry more (route.fleetCapacity), and the dispatch
// sends each route once per command instead of on every aircraft.
// Here, through the native save path (an in-page stand-in of the vault), 6,000 aircraft at two airports are dispatched
// with the real button: every aircraft gets a route and departs or holds a slot, the routes fit the registry and record
// their capacity, the save validates, and the fleet flies (completed trips, no faults) over three simulated hours.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const QTY=6000,SITES=['OMDB','EGLL'],GH_QUOTA_AIR=320;

// The native vault as GH_PERSISTENCE sees it: chunks and commits acknowledged by events.
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
    const prepared=await page.evaluate(async({qty,sites})=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,WORLD=GH_WORLD_DATA,type='air';
      const definition=GH_COMPANY_PLATFORM.definitionFor(s(),type);
      if(!s().openedCompanies.includes(type))await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,definition.founding.minimumCapital),legalName:'QA Large Air',formationContract:'QA-LARGE-AIR'},{silent:true});
      s().godMoney=true;s().infiniteMoney=true;
      const model=[...GH_ASSET_CATALOG[type].used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];let bought=0,order=0;
      for(const site of sites){
        const airport=WORLD.airports.find(r=>r[0]===site),facility={id:`QA-air-${airport[0]}`,name:`QA Airport ${airport[0]}`,kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:`air:${airport[0]}`,code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]};
        await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});
        const n=Math.min(3000,qty-bought);if(!await a.buyAsset(type,'used',model.id,'lease',n,facility.id,true,`QA-LARGE-${order++}`,type))return {error:'purchase',bought};bought+=n;
      }
      return {bought,size:GH_FLEET_DATA.size(s()),limit:GH_PERSISTENCE.fleetRecordLimit()};
    },{qty:QTY,sites:SITES});
    assert.equal(prepared.bought,QTY,`purchases: ${JSON.stringify(prepared)}`);
    assert.ok(prepared.limit>=QTY,'the native record ceiling admits the fleet');

    await page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));
    const button=page.locator('.dispatch-international-network[data-company="air"]').first();
    await button.waitFor({state:'visible',timeout:30000});const started=Date.now();await button.click();
    let last=null;
    for(let i=0;i<600;i++){last=await page.evaluate(()=>window.GH_APP_RUNTIME_METRICS?.snapshot?.().durable?.last||null);if(last?.name==='authorized:bulk-shared-departure:air')break;await page.waitForTimeout(250);}
    const dispatchMs=Date.now()-started;
    assert.equal(last?.committed,true,`the dispatch commits: ${JSON.stringify(last)}`);

    const state=await page.evaluate(()=>{
      const s=__GH_STATE__,F=GH_FLEET_DATA,routes=(s.customRoutes||[]).filter(r=>(r.routeMode||r.type)==='air'),routeIds=new Set(routes.map(r=>r.id)),users=new Map();let owned=0,routed=0,underway=0,unknown=0;
      F.scan(s,['ownerCompanyId','companyId','routeId','phase','departureScheduled'],r=>{if((r.ownerCompanyId||r.companyId)!=='air')return;owned++;if(r.routeId){routed++;users.set(r.routeId,(users.get(r.routeId)||0)+1);if(!routeIds.has(r.routeId))unknown++;}if(r.phase==='moving'||r.departureScheduled)underway++;});
      const over=routes.filter(r=>(users.get(r.id)||0)>GH_FLEET_CORE.routeCapacity(r)).length,v=GH_SAVE_SCHEMA.validate(s);
      return {owned,routed,underway,unknown,routes:routes.length,registry:GH_ROUTE_CORE.LIMITS.routes,maxUsers:Math.max(...users.values()),maxCapacity:Math.max(...routes.map(r=>GH_FLEET_CORE.routeCapacity(r))),over,valid:v.ok,errors:v.errors.slice(0,5),saves:__VAULT__.saves.length};
    });
    assert.equal(state.routed,QTY,`every aircraft has a route: ${JSON.stringify(state)}`);
    assert.equal(state.underway,QTY,`every aircraft departs or holds a slot: ${JSON.stringify(state)}`);
    assert.equal(state.unknown,0,'every route an aircraft uses is registered');
    assert.ok(state.routes<=state.registry,`routes fit the registry: ${state.routes}`);
    assert.ok(state.routes<=GH_QUOTA_AIR,`the dispatch stays within the air quota: ${JSON.stringify(state)}`);
    assert.equal(state.over,0,'no route carries more than its capacity');
    assert.equal(state.valid,true,`the save validates: ${state.errors}`);
    assert.ok(state.saves>0,'the native vault holds the committed save');

    const flown=await page.evaluate(async()=>{
      const s=__GH_STATE__,F=GH_FLEET_DATA,target=s.simSeconds+3*3600;__AUDIT__.simulationEngine.advanceTo(target,{speed:600,batchSeconds:3600,reason:'qa-large-fleet',maxSeconds:86400});
      for(let i=0;i<2400&&s.simSeconds<target-1;i++)await new Promise(r=>setTimeout(r,50));
      let moving=0,faults=0,trips=0;F.scan(s,['phase','simulationFault','lastTrip'],r=>{if(r.phase==='moving')moving++;if(r.simulationFault)faults++;if(r.lastTrip)trips++;});
      return {sim:s.simSeconds,target,moving,faults,trips,valid:GH_SAVE_SCHEMA.validate(s).ok};
    });
    assert.ok(flown.sim>=flown.target-1,`three simulated hours pass: ${JSON.stringify(flown)}`);
    assert.equal(flown.faults,0,'no simulation faults');
    assert.ok(flown.trips>0&&flown.moving>0,`the fleet flies: ${JSON.stringify(flown)}`);
    assert.equal(flown.valid,true,'the save still validates');

    // Build 358 (million-asset routes), from the iPhone diagnostic: after the big dispatch, 1,000 aircraft bought at a new
    // base were refused ("route-capacity": the dispatch had spread over nearly every registry slot). The mode quota keeps
    // a reserve, the new base's routes share it and carry the raised load, and every aircraft departs.
    const newBase=await page.evaluate(async()=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,airport=GH_WORLD_DATA.airports.find(r=>r[0]==='KJFK');
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-air-KJFK',name:'QA Airport KJFK',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:KJFK',code:airport[1],icao:airport[0],iata:airport[1],city:airport[3]||'—',country:String(airport[5]),coords:[airport[6],airport[7]]},bucket:'globalBases'},{silent:true});
      const model=[...GH_ASSET_CATALOG.air.used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      if(!await a.buyAsset('air','used',model.id,'lease',1000,'QA-air-KJFK',true,'QA-LARGE-KJFK','air'))return {error:'purchase'};
      return {size:GH_FLEET_DATA.size(s()),budget:GH_ROUTE_CORE.modeRouteBudget(s(),'air')};
    });
    assert.equal(newBase.size,QTY+1000,`bought: ${JSON.stringify(newBase)}`);
    await page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));
    await button.waitFor({state:'visible',timeout:30000});const samplesBefore=await page.evaluate(()=>(window.GH_APP_RUNTIME_METRICS?.snapshot?.().durable?.samples||[]).length);
    await page.locator('.dispatch-international-network[data-company="air"]').first().click();
    await page.waitForFunction(n=>{const d=window.GH_APP_RUNTIME_METRICS?.snapshot?.().durable;return (d?.samples||[]).length>n&&/bulk-shared-departure/.test(d.last?.name||'');},samplesBefore,{timeout:300000});
    const second=await page.evaluate(()=>{const s=__GH_STATE__,d=window.GH_APP_RUNTIME_METRICS.snapshot().durable.last;let atNewBase=0,routedNew=0;const newRoutes=new Set();GH_FLEET_DATA.scan(s,['baseFacility','routeId'],r=>{if(r.baseFacility==='QA-air-KJFK'){atNewBase++;if(r.routeId){routedNew++;newRoutes.add(r.routeId);}}});const raised=(s.customRoutes||[]).filter(r=>newRoutes.has(r.id)).map(r=>GH_FLEET_CORE.routeCapacity(r));const budget=GH_ROUTE_CORE.modeRouteBudget(s,'air');return {committed:d.committed,atNewBase,routedNew,newRoutes:newRoutes.size,maxNewCapacity:Math.max(0,...raised),budget,alert:(s.alerts||[])[0],valid:GH_SAVE_SCHEMA.validate(s).ok};});
    assert.equal(second.committed,true,`the new base dispatch commits: ${JSON.stringify(second)}`);
    assert.equal(second.routedNew,1000,`every new aircraft has a route: ${JSON.stringify(second)}`);
    assert.ok(second.maxNewCapacity>24,`the new base's routes carry more than the base 24 (the quota reserve is shared, not spent): ${JSON.stringify(second)}`);
    assert.ok(second.budget.used<=second.budget.quota&&second.budget.free>0,`the air quota keeps free slots for later bases: ${JSON.stringify(second.budget)}`);
    assert.equal(second.valid,true,'the save validates');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build358-large-fleet-dispatch-browser',aircraft:QTY,dispatchMs,routes:state.routes,maxCapacity:state.maxCapacity,maxUsers:state.maxUsers,after3h:{moving:flown.moving,trips:flown.trips},newBase:{routed:second.routedNew,airRoutes:second.budget.used,free:second.budget.free},environment:`Chromium local DOM; in-page native vault stand-in; ${path.basename(__filename)}`}));
    console.log('BUILD358_LARGE_FLEET_DISPATCH_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
