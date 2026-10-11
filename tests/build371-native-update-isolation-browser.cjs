'use strict';
// Build 371: a native update's state operations (GH_RUNTIME.applyNativeUpdate, the path GameViewController runs after
// it installed a signed pack) against durable commands. The update writes the live state in a synchronous transaction
// (GH_ADVANCED applyUpdateOperations); a durable command replaces the live state with its draft when it commits. Pinned:
// - while a durable command holds the state (paused between its assignment and its departures) the update is refused
//   (Transaction Core 'durable-live-state-transaction-blocked'), writes nothing, and the command's commit carries no
//   trace of it; GameViewController then rolls the pack back (applied!==true);
// - applied outside a command it is recorded once (advanced.updateHistory) with its operations;
// - a second application of the same pack is refused (false) and changes nothing;
// - a later command, committed or rolled back, keeps the update and its record;
// - an interrupted application records nothing, and its retry applies once;
// - after a crash before any save the reload holds no trace of it, and applying it again records it once;
// - a reload restores both, and the pack is still refused as a duplicate after it.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot,reboot}=require('./helpers/local-dom-app'),{createHash}=require('node:crypto');
// The local page is not a secure context, so it has no crypto.subtle; the update validation's SHA-256 is computed by
// node:crypto (the same digest), the validation itself unchanged.
async function withDigest(page){
  await page.exposeFunction('__qaSha256Hex',bytes=>createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
  await page.evaluate(()=>{const digest=async(_algorithm,data)=>{const view=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);const hex=await window.__qaSha256Hex([...view]);const out=new Uint8Array(32);for(let i=0;i<32;i++)out[i]=parseInt(hex.slice(i*2,i*2+2),16);return out.buffer;};
    if(!globalThis.crypto?.subtle)Object.defineProperty(globalThis.crypto,'subtle',{value:{digest},configurable:true});});
}
const SHIPS=12;

// The update pack as GameViewController hands it over after a native install (postInstall: same version as the runtime).
async function makePack(page,marker){
  return page.evaluate(async marker=>{
    const operationsJSON=JSON.stringify([{type:'content-config',value:{qaUpdateMarker:marker}}]);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(operationsJSON));
    const sha=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
    return {format:'global-holdings-update',manifest:{id:`qa-native-update-${marker}`,version:GH_ADVANCED.VERSION,packageType:'full-web',installMode:'clean-snapshot-v1',operationsSha256:sha},build:0,operationsJSON,replacedWebFiles:true};
  },marker);
}
const UPDATE_STATE=()=>{const a=__GH_STATE__.advanced||{};return {history:(a.updateHistory||[]).map(row=>({id:row.id,version:row.version})),content:JSON.stringify(a.content||{}),saveRevision:__GH_STATE__.saveRevision};};
async function apply(page,pack){return page.evaluate(async pack=>{try{return {result:await GH_RUNTIME.applyNativeUpdate(pack)};}catch(error){return {error:String(error?.message||error)};}},pack);}
async function settled(page,pattern){
  await page.waitForFunction(pattern=>{const last=GH_APP_RUNTIME_METRICS.snapshot().durable.last;return !!last&&new RegExp(pattern).test(String(last.name||''))&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked();},pattern,{timeout:180000});
  await page.evaluate(()=>GH_PERSISTENCE.drain());
}

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[],report=[];
  try{
    let {page}=await boot({browser,errors});page.setDefaultTimeout(120000);await withDigest(page);
    await page.evaluate(async ships=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,d=GH_COMPANY_PLATFORM.definitionFor(s(),'sea');
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'sea',companyId:'sea',capital:Math.max(400000000,d.founding.minimumCapital),legalName:'QA Update Sea',formationContract:'QA-UPDATE-SEA'},{silent:true});
      const port=GH_WORLD_DATA.ports.find(r=>Number.isFinite(Number(r[3]))&&Number.isFinite(Number(r[4])));
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-sea-PORT',name:`QA Port ${port[0]}`,kind:'port-base',company:'sea',ownerCompanyId:'sea',owned:true,sourceKey:`port:${port[0]}:${port[3]}:${port[4]}`,code:String(port[0]).slice(0,5),city:String(port[1]||port[0]),country:String(port[2]||'—'),coords:[port[3],port[4]]},bucket:'globalBases'},{silent:true});
      const ship=[...GH_ASSET_CATALOG.sea.used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      await a.buyAsset('sea','used',ship.id,'lease',ships,'QA-sea-PORT',true,'QA-UPDATE-SEA','sea');await GH_PERSISTENCE.drain();
    },SHIPS);
    const initial=await page.evaluate(`(${UPDATE_STATE})()`);

    // 1. During a durable command (the sea dispatch, paused between its assignment and its departures).
    const duringPack=await makePack(page,'during');
    await page.evaluate(()=>{const original=window.setTimeout;window.qaPause={armed:true,held:null,original};
      window.setTimeout=function(fn,ms,...rest){if(qaPause.armed&&!ms&&window.__GH_DURABLE_COMMAND_CONTEXT__&&String(fn).includes('[native code]')){const ships=GH_FLEET_DATA.filter(__GH_STATE__,a=>(a.ownerCompanyId||a.companyId)==='sea');if(ships.length&&ships.every(a=>a.routeId&&a.phase!=='moving'&&!a.departureScheduled)){qaPause.armed=false;qaPause.held=()=>fn(...rest);return 0;}}return original.call(window,fn,ms,...rest);};
      __AUDIT__.openDrawer('routes','sea');});
    await page.locator('.dispatch-international-network[data-company="sea"]').first().click();
    await page.waitForFunction(()=>!!qaPause.held,null,{timeout:120000});
    // The update owner itself is refused by Transaction Core while the command holds the state, writing nothing.
    const direct=await page.evaluate(async pack=>{try{return {result:await GH_ADVANCED.applyNativeUpdate(pack,{state:__GH_STATE__,runtimeBuild:0,pushAlert(){},updateKpis(){}})};}catch(error){return {error:String(error?.message||error)};}},duringPack);
    assert.match(String(direct.error),/durable-live-state-transaction-blocked/,`the owner is refused during the command: ${JSON.stringify(direct)}`);
    // The runtime entry GameViewController calls waits for the command instead of failing (a failure rolls the pack back
    // and reloads the page, dropping the command).
    await page.evaluate(pack=>{window.qaDuring={done:false};GH_RUNTIME.applyNativeUpdate(pack).then(result=>{qaDuring={done:true,result};},error=>{qaDuring={done:true,error:String(error?.message||error)};});},duringPack);
    for(let i=0;i<30;i++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    const duringState=await page.evaluate(`(${UPDATE_STATE})()`);
    assert.equal(await page.evaluate(()=>qaDuring.done),false,'the update waits while the command holds the state');
    assert.deepEqual(duringState,initial,'and writes nothing meanwhile');
    await page.evaluate(()=>{const held=qaPause.held;qaPause.held=null;window.setTimeout=qaPause.original;held();});
    await settled(page,'bulk-shared-departure:sea');
    await page.waitForFunction(()=>qaDuring.done,null,{timeout:60000});
    const during=await page.evaluate(()=>qaDuring),afterCommand=await page.evaluate(`(${UPDATE_STATE})()`);
    assert.equal(during.result,true,`applied once the command committed: ${JSON.stringify(during)}`);
    assert.equal(afterCommand.saveRevision,initial.saveRevision+1,'the command itself committed');
    assert.deepEqual(afterCommand.history.filter(row=>row.id===duringPack.manifest.id),[{id:duringPack.manifest.id,version:duringPack.manifest.version}],'recorded once, on the committed state');
    assert.match(afterCommand.content,/"qaUpdateMarker":"during"/,'its operations applied after the commit, not erased by it');
    report.push({name:'update arriving during a durable command waits and applies once after it',ownerRefusal:direct.error});

    // 2. Outside a command: applied once, with its operations.
    const pack=await makePack(page,'outside');
    const first=await apply(page,pack);assert.equal(first.result,true,`applied outside a command: ${JSON.stringify(first)}`);
    const applied=await page.evaluate(`(${UPDATE_STATE})()`);
    assert.deepEqual(applied.history.filter(row=>row.id===pack.manifest.id),[{id:pack.manifest.id,version:pack.manifest.version}],'recorded once');
    assert.match(applied.content,/"qaUpdateMarker":"outside"/,'its operations applied');
    const integrity=await page.evaluate(()=>GH_RUNTIME.businessIntegrity());assert(integrity&&integrity.counts&&integrity.counts.critical===0,'integrity holds after the update (what GameViewController checks)');

    // 3. The same pack again: refused, nothing changes.
    const second=await apply(page,pack);assert.equal(second.result,false,'a second application is refused as a duplicate');
    assert.deepEqual(await page.evaluate(`(${UPDATE_STATE})()`),applied,'the duplicate changes nothing');
    report.push({name:'applied once outside a command; duplicate refused'});

    // 4. A later command that rolls back, then one that commits: the update and its record stay.
    await page.evaluate(()=>{const ops=window.GH_OPERATIONS_CORE;window.__qaOps=ops;window.GH_OPERATIONS_CORE={...ops,execute(ctx,cmd,payload){if(cmd==='record-alert'&&payload?.type==='qa-fail')throw new Error('qa-command-failure');return ops.execute(ctx,cmd,payload);}};});
    const failed=await page.evaluate(async()=>{try{return await __AUDIT__.runAuthorizedDomainCommand('operations','record-alert',{text:'qa',type:'qa-fail'},{silent:true});}catch(error){return `refused:${error.message}`;}});
    await page.evaluate(()=>{window.GH_OPERATIONS_CORE=window.__qaOps;});
    const afterRollback=await page.evaluate(`(${UPDATE_STATE})()`);
    assert.notEqual(failed,true,'the failing command did not commit');
    assert.deepEqual({...afterRollback,saveRevision:0},{...applied,saveRevision:0},'a rolled-back command keeps the update and its record');
    const ok=await page.evaluate(()=>__AUDIT__.runAuthorizedDomainCommand('operations','record-alert',{text:'qa-after-update',type:'operation'},{silent:true}));
    assert(ok,'a later command commits');
    const afterCommit=await page.evaluate(`(${UPDATE_STATE})()`);
    assert.deepEqual(afterCommit.history,applied.history,'a committed command keeps the update record');assert.equal(afterCommit.content,applied.content,'and its operations');
    report.push({name:'later commands (rolled back and committed) keep the update'});

    // 5. Interrupted application: an operation fails inside the update's transaction. Nothing is recorded or applied, the
    // failure is reported (GameViewController rolls the pack back); a retry of the same pack then applies it once.
    const interruptedPack=await makePack(page,'interrupted');
    const beforeInterrupt=await page.evaluate(`(${UPDATE_STATE})()`);
    await page.evaluate(()=>{const strategy=window.GH_STRATEGY_CORE;window.__qaStrategy=strategy;window.GH_STRATEGY_CORE={...strategy,execute(ctx,cmd,payload){if(cmd==='apply-runtime-update'){const out=strategy.execute(ctx,cmd,payload);throw new Error('qa-update-operation-failure');}return strategy.execute(ctx,cmd,payload);}};});
    const interrupted=await apply(page,interruptedPack);
    await page.evaluate(()=>{window.GH_STRATEGY_CORE=window.__qaStrategy;});
    assert.match(String(interrupted.error),/qa-update-operation-failure/,'the failure is reported, not retried');
    const afterInterrupt=await page.evaluate(`(${UPDATE_STATE})()`);
    assert.deepEqual({...afterInterrupt,saveRevision:0},{...beforeInterrupt,saveRevision:0},'the interrupted update left no record and no operation');
    const retried=await apply(page,interruptedPack);assert.equal(retried.result,true,'a retry applies it');
    const afterRetry=await page.evaluate(`(${UPDATE_STATE})()`);
    assert.equal(afterRetry.history.filter(row=>row.id===interruptedPack.manifest.id).length,1,'recorded once');
    assert.equal((await apply(page,interruptedPack)).result,false,'and refused as a duplicate after it');
    report.push({name:'interrupted application leaves nothing; its retry applies once'});

    // 6. Crash before any save: the reload holds the last save, without the update; applying it again records it once.
    const crashPack=await makePack(page,'crash');
    await page.evaluate(async()=>{const ok=await __AUDIT__.saveNow();if(ok!==true)throw new Error(`save-rejected:${ok}`);await GH_PERSISTENCE.drain();});
    assert.equal((await apply(page,crashPack)).result,true);
    ({page}=await reboot(page,{browser,errors}));await withDigest(page);
    const afterCrash=await page.evaluate(`(${UPDATE_STATE})()`);
    assert.equal(afterCrash.history.some(row=>row.id===crashPack.manifest.id),false,'the unsaved update is not in the reloaded state');
    assert.equal((await apply(page,crashPack)).result,true,'re-applied after the crash');
    assert.equal((await page.evaluate(`(${UPDATE_STATE})()`)).history.filter(row=>row.id===crashPack.manifest.id).length,1,'recorded once');
    assert.equal((await apply(page,crashPack)).result,false,'then refused as a duplicate');
    report.push({name:'crash before save: the update is re-applied once'});

    // 7. Recovery: a reload restores the update; the pack stays a duplicate.
    const saved=await page.evaluate(async UPDATE_STATE=>{const read=eval(UPDATE_STATE);const ok=await __AUDIT__.saveNow();if(ok!==true)throw new Error(`save-rejected:${ok}`);await GH_PERSISTENCE.drain();return read();},`(${UPDATE_STATE})`);
    ({page}=await reboot(page,{browser,errors}));await withDigest(page);
    const restored=await page.evaluate(`(${UPDATE_STATE})()`);
    assert.deepEqual(restored.history,saved.history,'a reload restores the update record');assert.equal(restored.content,saved.content,'and its operations');
    const third=await apply(page,pack);assert.equal(third.result,false,'after a reload the pack is still refused as a duplicate');
    report.push({name:'reload restores the update; still a duplicate'});

    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build371-native-update-isolation-browser',report},null,2));
    console.log('BUILD371_NATIVE_UPDATE_ISOLATION_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
