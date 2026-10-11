'use strict';
// Build 372: a game reopened from the native vault gives the fleet engine thread its first replica from the vault's own
// chunk buffers (migration-core -> STORE.setReplicaSeed -> the worker), not from a copy of the store made on the main
// thread when play starts. The whole app (local DOM) with an in-page vault stand-in and a real worker:
//   session 1 builds an air fleet on routes and saves it to the vault (fleet records as chunks);
//   session 2 opens that save as the native shell does (__GH_NATIVE_SAVE_JSON__, __GH_NATIVE_SAVE_CHUNKS__): the
//   replica arrives as the seed (no whole copy, the chunk buffers moved), equals the store byte for byte, and play then
//   runs every step on the thread (no fallback, still no whole copy) with the replica equal after it; the game saves
//   again and that save reopens.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const web=path.join(path.resolve(__dirname,'..'),'WebApp');
const workerSource=['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js','fleet-access-core.js','fleet-health-core.js','fleet-query-core.js'].map(file=>fs.readFileSync(path.join(web,file),'utf8')).join('\n;\n')+'\n;\n'+
  fs.readFileSync(path.join(web,'fleet-engine-worker.js'),'utf8').replace(/^importScripts\([^)]*\);$/m,'');

// Before the app runs: the vault stand-in (chunks and saves, acknowledged like the native shell), the worker from a
// blob, and for a reopened game the save and its chunks as the native bootstrap leaves them.
function nativeShell({workerSource,saved,chunks}){
  const vault=window.__VAULT__={chunks:new Map(),saves:[]};
  const decode=b64=>{const bin=atob(b64),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;};
  for(const [id,base64] of chunks||[])vault.chunks.set(id,decode(base64));
  const deliver=(name,detail)=>setTimeout(()=>window.dispatchEvent(new CustomEvent(name,{detail})),0);
  const referenced=json=>{try{const rows=JSON.parse(json)?.fleet?.rows;return rows?.$ghBinary==='chunks-v1'?rows.chunks:[];}catch{return [];}};
  const bridge={postMessage(m){
    if(m.action==='storeSaveChunk'){vault.chunks.set(m.id,decode(m.base64));return deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:true});}
    if(m.action==='commitSave'||m.action==='resetGameSave'||m.action==='saveManualSlot'){
      const missing=referenced(m.saveJSON).find(id=>!vault.chunks.has(id)),ok=!missing;
      if(m.action==='saveManualSlot')return deliver('gh-native-slot-ack',{requestId:m.requestId,action:m.action,index:m.index,success:ok,message:missing?`Missing save chunk: ${missing}`:''});
      if(ok)vault.saves.push(m.saveJSON);
      deliver(m.action==='resetGameSave'?'gh-native-reset-ack':'gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:ok,generation:vault.saves.length,message:missing?`Missing save chunk: ${missing}`:''});
    }
  }};
  window.webkit={messageHandlers:{saveBridge:bridge,updateBridge:bridge}};window.GH_NATIVE_BUILD=358;
  const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));window.__GH_FLEET_ENGINE_WORKER_FACTORY__=()=>new Worker(url);
  if(saved){
    window.__GH_NATIVE_SAVE_JSON__=saved;const map=new Map();
    const ids=JSON.parse(saved)?.fleet?.rows?.chunks||[];for(const id of ids)map.set(id,vault.chunks.get(id).slice().buffer);
    window.__GH_NATIVE_SAVE_CHUNKS__=map;window.__SEED_CHUNKS__=[...map.values()];
  }
}
const exportVault=page=>page.evaluate(()=>{const v=window.__VAULT__,saved=v.saves.at(-1),ids=JSON.parse(saved)?.fleet?.rows?.chunks||[];
  const b64=bytes=>{let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out);};
  return {saved,chunks:ids.map(id=>[id,b64(v.chunks.get(id))])};});
const compare=page=>page.evaluate(async()=>{
  const client=window.__AUDIT__.fleetEngineThreadClient?.()||null,store=__GH_STATE__.fleet,STORE=GH_FLEET_STORE;
  const replica=client?await client.inspect():null;if(!replica)return {replica:false};
  const a=new Uint8Array(store.rows,0,store.length*STORE.STRIDE),b=new Uint8Array(replica.rows);let row=-1;
  if(a.length!==b.length)row=-2;else for(let i=0;i<a.length;i++)if(a[i]!==b[i]){row=Math.floor(i/STORE.STRIDE);break;}
  const norm=list=>JSON.stringify(list.map(value=>value===undefined?null:value));
  return {replica:true,row,values:norm(store.values)===norm(replica.values),extras:JSON.stringify(store.extras)===JSON.stringify(replica.extras),length:store.length===replica.length,stats:client.stats()};
});
const settled=page=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:180000});

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    // Session 1: an air fleet on routes, saved to the vault.
    const first=await boot({browser,errors,viewport:{width:844,height:390},bypassCSP:true,beforeScripts:{fn:nativeShell,arg:{workerSource}}});first.page.setDefaultTimeout(180000);
    const fleet=await first.page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,W=GH_WORLD_DATA;s.godMoney=true;s.infiniteMoney=true;
      const definition=GH_COMPANY_PLATFORM.definitionFor(s,'air');
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(900000000,definition.founding.minimumCapital),legalName:'QA Seed Air',formationContract:'QA-SEED'},{silent:true});
      for(const icao of ['OMDB','EGLL','KJFK']){const row=W.airports.find(item=>item[0]===icao),id=`QA-seed-${icao}`;await a.runAuthorizedDomainCommand('facilities','create',{facility:{id,name:`QA ${icao}`,kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:`air:${icao}`,code:row[1]||icao,icao,iata:row[1],city:row[3]||'—',country:String(row[5]||'—'),coords:[row[6],row[7]]},bucket:'globalBases'},{silent:true});}
      const model=[...GH_ASSET_CATALOG.air.used].filter(x=>!x.specs.cargo&&Number(x.specs.rangeKm)>=6000).sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      for(const icao of ['OMDB','EGLL','KJFK'])await a.buyAsset('air','used',model.id,'lease',40,`QA-seed-${icao}`,true,`QA-SEED-${icao}`,'air');
      return GH_FLEET_DATA.size(s);
    });
    await first.page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));
    await first.page.locator('.dispatch-international-network[data-company="air"]').first().click();
    await first.page.waitForFunction(()=>GH_FLEET_DATA.filter(__GH_STATE__,row=>row.ownerCompanyId==='air').every(row=>row.routeId),null,{timeout:180000});
    await settled(first.page);await first.page.evaluate(()=>__AUDIT__.closeDrawer());
    const drained=await first.page.evaluate(()=>GH_PERSISTENCE.drain({timeoutMs:60000}));assert.equal(drained?.ok,true,'session 1 saves');
    const vault=await exportVault(first.page);await first.page.close();
    assert.ok(vault.chunks.length>=1,'the fleet records are in vault chunks');

    // Session 2: reopened from the vault.
    const second=await boot({browser,errors,viewport:{width:844,height:390},bypassCSP:true,beforeScripts:{fn:nativeShell,arg:{workerSource,...vault}}});second.page.setDefaultTimeout(180000);
    await second.page.waitForFunction(()=>(window.__AUDIT__.fleetEngineThreadClient?.()?.stats?.().seedSyncs||0)>=1,null,{timeout:30000});
    const opened=await second.page.evaluate(()=>({size:GH_FLEET_DATA.size(__GH_STATE__),routed:GH_FLEET_DATA.filter(__GH_STATE__,row=>!!row.routeId).length,moved:window.__SEED_CHUNKS__.every(buffer=>buffer.byteLength===0)}));
    assert.equal(opened.size,fleet);assert.equal(opened.routed,fleet);assert.equal(opened.moved,true,'the seed chunk buffers were moved to the worker');
    const atOpen=await compare(second.page);
    assert.equal(atOpen.replica,true);assert.equal(atOpen.row,-1,'replica rows equal at open');assert.equal(atOpen.values,true);assert.equal(atOpen.extras,true);assert.equal(atOpen.length,true);
    assert.equal(atOpen.stats.seedSyncs,1);assert.equal(atOpen.stats.fullSyncs,0,'no whole copy at open');
    // Play: every step on the thread.
    await second.page.evaluate(()=>__AUDIT__.setSpeed(3));
    await second.page.waitForFunction(()=>(window.__AUDIT__.fleetEngineThreadClient().stats().applied||0)>=6,null,{timeout:120000});
    await second.page.evaluate(()=>__AUDIT__.setSpeed(0));await settled(second.page);
    await second.page.waitForFunction(()=>!window.__AUDIT__.fleetEngineThreadClient().busy,null,{timeout:30000});
    const afterPlay=await compare(second.page);
    assert.equal(afterPlay.row,-1,'replica rows equal after play');assert.equal(afterPlay.values,true);assert.equal(afterPlay.extras,true);
    assert.equal(afterPlay.stats.fullSyncs,0,`no whole copy in play: ${JSON.stringify(afterPlay.stats.fullSyncReasons)}`);assert.equal(afterPlay.stats.fallbacks,0);assert.ok(afterPlay.stats.applied>=6);
    // The reopened game saves, and that save reopens.
    const again=await second.page.evaluate(()=>GH_PERSISTENCE.drain({timeoutMs:60000}));assert.equal(again?.ok,true,'session 2 saves');
    const vault2=await exportVault(second.page);await second.page.close();
    const third=await boot({browser,errors,viewport:{width:844,height:390},bypassCSP:true,beforeScripts:{fn:nativeShell,arg:{workerSource,...vault2}}});
    await third.page.waitForFunction(()=>(window.__AUDIT__.fleetEngineThreadClient?.()?.stats?.().seedSyncs||0)>=1,null,{timeout:30000});
    const reopened=await compare(third.page);assert.equal(reopened.row,-1);assert.equal(reopened.stats.fullSyncs,0);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,fleet,chunks:vault.chunks.length,seedMs:atOpen.stats.maxSeedSyncMs,routeAnswerMs:atOpen.stats.maxRouteAnswerMs,routeKeys:atOpen.stats.routeKeysAnswered,applied:afterPlay.stats.applied}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
