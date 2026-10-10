'use strict';
// Build 371 regression: a fleet above one dispatch's limit (SHARED_DISPATCH_LIMIT, 20,000) departs in successive
// commands. Each command used to size its routes for its own 20,000 aircraft (a load of about 72), so the routes earlier
// commands filled were never used again and every later command opened new ones: 120,000 aircraft at 8 bases stopped
// at 100,000 when the air quota ran out ("حصة المسارات الجوية ممتلئة"), and a million stopped at the same 100,000.
// Here, through the native save path (an in-page stand-in of the vault), 120,000 aircraft at 8 bases are dispatched:
// every aircraft departs or holds a slot, the routes fit the air quota with free slots left for later bases, the load is
// even, no route carries more than its capacity, and the save validates.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const QTY=120000,SITES=['OMDB','EGLL','KJFK','RJTT','WSSS','YSSY','FAOR','SBGR'];

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
    const {page}=await boot({browser,errors});page.setDefaultTimeout(0);
    await page.evaluate(installVault);
    const prepared=await page.evaluate(async({qty,sites})=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,type='air',definition=GH_COMPANY_PLATFORM.definitionFor(s(),type);
      if(!s().openedCompanies.includes(type))await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,definition.founding.minimumCapital),legalName:'QA Fleet Series',formationContract:'QA-FLEET-SERIES'},{silent:true});
      s().godMoney=true;s().infiniteMoney=true;
      const model=[...GH_ASSET_CATALOG[type].used].filter(x=>!x.specs.cargo&&Number(x.specs.rangeKm)>=6000).sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0],ids=[];
      for(const site of sites){const r=GH_WORLD_DATA.airports.find(x=>x[0]===site),facility={id:`QA-air-${r[0]}`,name:`QA ${r[0]}`,kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:`air:${r[0]}`,code:r[1]||r[0],icao:r[0],iata:r[1],city:r[3]||r[4]||'—',country:String(r[5]||'—'),coords:[r[6],r[7]]};await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});ids.push(facility.id);}
      let bought=0,order=0;while(bought<qty){const n=Math.min(3000,qty-bought);if(!await a.buyAsset(type,'used',model.id,'lease',n,ids[order%ids.length],true,`QA-SERIES-${order++}`,type))return {error:'purchase',bought};bought+=n;}
      return {bought,limit:GH_PERSISTENCE.fleetRecordLimit()};
    },{qty:QTY,sites:SITES});
    assert.equal(prepared.bought,QTY,`purchases: ${JSON.stringify(prepared)}`);

    await page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));
    const button=page.locator('.dispatch-international-network[data-company="air"]').first();
    await button.waitFor({state:'visible',timeout:30000});const started=Date.now();await button.click();
    // The series is six commands; it is over when no command is in flight and every aircraft holds a route.
    await page.waitForFunction(qty=>{if(window.__GH_DURABLE_COMMAND_CONTEXT__||GH_PERSISTENCE.isLocked())return false;const alerts=(__GH_STATE__.alerts||[]).map(a=>String(a?.text||a));return alerts.filter(t=>/وُزعت/.test(t)).length>=Math.ceil(qty/20000)||alerts.some(t=>/حصة المسارات|أُلغي الأمر/.test(t));},QTY,{timeout:0,polling:1000});
    await page.waitForTimeout(1500);
    const dispatchMs=Date.now()-started;
    const state=await page.evaluate(()=>{
      const s=__GH_STATE__,F=GH_FLEET_DATA,routes=(s.customRoutes||[]).filter(r=>(r.routeMode||r.type)==='air'),users=new Map();let owned=0,routed=0,underway=0;
      F.scan(s,['ownerCompanyId','companyId','routeId','phase','departureScheduled'],r=>{if((r.ownerCompanyId||r.companyId)!=='air')return;owned++;if(r.routeId){routed++;users.set(r.routeId,(users.get(r.routeId)||0)+1);}if(r.phase==='moving'||r.departureScheduled)underway++;});
      const loads=[...users.values()].sort((a,b)=>a-b),budget=GH_ROUTE_CORE.modeRouteBudget(s,'air'),v=GH_SAVE_SCHEMA.validate(s);
      return {owned,routed,underway,routes:routes.length,budget,minLoad:loads[0],maxLoad:loads.at(-1),over:routes.filter(r=>(users.get(r.id)||0)>GH_FLEET_CORE.routeCapacity(r)).length,
        refusals:(s.alerts||[]).map(a=>String(a?.text||a)).filter(t=>/حصة المسارات|أُلغي الأمر/.test(t)),dispatches:(s.alerts||[]).map(a=>String(a?.text||a)).filter(t=>/وُزعت/.test(t)).length,valid:v.ok,errors:v.errors.slice(0,5),saves:__VAULT__.saves.length};
    });
    assert.deepEqual(state.refusals,[],`no command of the series is refused: ${JSON.stringify(state)}`);
    assert.equal(state.routed,QTY,`every aircraft has a route (the series stopped at 100,000 before): ${JSON.stringify(state)}`);
    assert.equal(state.underway,QTY,`every aircraft departs or holds a slot: ${JSON.stringify(state)}`);
    assert.equal(state.dispatches,Math.ceil(QTY/20000),'six commands of 20,000');
    assert.ok(state.budget.used<=state.budget.quota&&state.budget.free>0,`the series stays inside the air quota and leaves slots for later bases: ${JSON.stringify(state.budget)}`);
    assert.ok(state.maxLoad<=Math.ceil(state.minLoad*1.25),`the load is even across the routes (no 72-aircraft routes beside 3,000-aircraft ones): ${state.minLoad}..${state.maxLoad}`);
    assert.equal(state.over,0,'no route carries more than its capacity');
    assert.equal(state.valid,true,`the save validates: ${state.errors}`);
    assert.ok(state.saves>0,'the native vault holds the committed save');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build371-air-fleet-series-browser',aircraft:QTY,bases:SITES.length,dispatchMs,routes:state.routes,load:[state.minLoad,state.maxLoad],freeSlots:state.budget.free,environment:`Chromium local DOM; in-page native vault stand-in; ${path.basename(__filename)}`}));
    console.log('BUILD371_AIR_FLEET_SERIES_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
