'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const QTY=4300,SITE='OERK',MODEL='UA-ATR72';
function installVault(){
  const vault=window.__VAULT__={chunks:new Map(),saves:[],generation:0},deliver=(name,detail)=>setTimeout(()=>window.dispatchEvent(new CustomEvent(name,{detail})),0),decode=b64=>{const bin=atob(b64),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;};
  const referenced=json=>{try{const rows=JSON.parse(json)?.fleet?.rows;return rows?.$ghBinary==='chunks-v1'?rows.chunks:[];}catch{return [];}};
  const bridge={postMessage(m){if(m.action==='storeSaveChunk'){vault.chunks.set(m.id,decode(m.base64));return deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:true});}if(['commitSave','resetGameSave','saveManualSlot'].includes(m.action)){const missing=referenced(m.saveJSON).find(id=>!vault.chunks.has(id)),ok=!missing;if(m.action==='saveManualSlot')return deliver('gh-native-slot-ack',{requestId:m.requestId,action:m.action,index:m.index,success:ok,message:missing?`Missing save chunk: ${missing}`:''});if(ok){vault.saves.push(m.saveJSON);if(vault.saves.length>2)vault.saves.shift();}deliver(m.action==='resetGameSave'?'gh-native-reset-ack':'gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:ok,generation:ok?++vault.generation:undefined,message:missing?`Missing save chunk: ${missing}`:''});}}};
  window.webkit={messageHandlers:{saveBridge:bridge,updateBridge:bridge}};window.GH_NATIVE_BUILD=358;
}
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(300000);await page.evaluate(installVault);
    const prepared=await page.evaluate(async({qty,modelId})=>{
      const a=__AUDIT__,s=__GH_STATE__,type='air',definition=GH_COMPANY_PLATFORM.definitionFor(s,type);
      if(!s.openedCompanies.includes(type))await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,definition.founding.minimumCapital),legalName:'QA Riyadh Destination Pool',formationContract:'QA-RIYADH-DESTINATION-POOL'},{silent:true});
      s.godMoney=true;s.infiniteMoney=true;const airport=GH_WORLD_DATA.airports.find(row=>row[0]==='OERK'),facility={id:`QA-air-${airport[0]}`,name:`QA Airport ${airport[0]}`,kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:`air:${airport[0]}`,code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]};
      await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});let bought=0,order=0;while(bought<qty){const n=Math.min(3000,qty-bought);if(!await a.buyAsset(type,'used',modelId,'lease',n,facility.id,true,`QA-RIYADH-${order++}`,type))return {error:'purchase',bought};bought+=n;}return {bought,rangeKm:GH_ASSET_CATALOG.air.used.find(row=>row.id===modelId).specs.rangeKm};
    },{qty:QTY,modelId:MODEL});
    assert.equal(prepared.bought,QTY);assert.ok(prepared.rangeKm<1500);
    await page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));const button=page.locator('.dispatch-international-network[data-company="air"]').first();await button.waitFor({state:'visible',timeout:30000});await button.click();
    let last=null;for(let i=0;i<600;i++){last=await page.evaluate(()=>window.GH_APP_RUNTIME_METRICS?.snapshot?.().durable?.last||null);if(last?.name==='authorized:bulk-shared-departure:air')break;await page.waitForTimeout(250);}
    const result=await page.evaluate(()=>{
      const s=__GH_STATE__,routes=(s.customRoutes||[]).filter(row=>(row.routeMode||row.type)==='air'),loads=new Map();let owned=0,routed=0,underway=0;
      GH_FLEET_DATA.scan(s,['ownerCompanyId','companyId','routeId','phase','departureScheduled'],row=>{if((row.ownerCompanyId||row.companyId)!=='air')return;owned++;if(row.routeId){routed++;loads.set(row.routeId,(loads.get(row.routeId)||0)+1);}if(row.phase==='moving'||row.departureScheduled)underway++;});
      const trace=GH_DIAGNOSTICS.departureTraceSnapshot(s),byId=new Map(routes.map(route=>[route.id,route])),over=[...loads].some(([id,count])=>{const route=byId.get(id);return !route||count>GH_FLEET_CORE.routeCapacity(route)||GH_FLEET_CORE.routeCapacity(route)>8192;});
      return {owned,routed,underway,routes:routes.length,destinations:new Set(routes.map(route=>route.toFacility)).size,over,planner:trace?.recent?.[0]?.planner||null,valid:GH_SAVE_SCHEMA.validate(s).ok};
    });
    assert.equal(last?.committed,true,`Riyadh dispatch commits: ${JSON.stringify({last,result})}`);assert.equal(result.owned,QTY);assert.equal(result.routed,QTY);assert.equal(result.underway,QTY);assert.equal(result.routes,result.destinations);assert.ok(result.planner?.reachableMax>250&&result.planner.reachableMax<400,`Riyadh candidate pool is measured: ${JSON.stringify(result.planner)}`);assert.equal(result.planner.indexBuilds,1);assert.equal(result.planner.rowsScanned,await page.evaluate(()=>GH_WORLD_DATA.airports.length));assert.equal(result.over,false);assert.equal(result.valid,true);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build371-air-destination-pool-riyadh-browser',aircraft:QTY,site:SITE,model:MODEL,routes:result.routes,reachable:result.planner.reachableMax,planner:result.planner,underway:result.underway,environment:`Chromium local DOM; in-page native vault stand-in; ${path.basename(__filename)}`}));console.log('BUILD371_AIR_DESTINATION_POOL_RIYADH_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
