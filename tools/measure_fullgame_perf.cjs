'use strict';
// Build 359: whole-game performance measurement on the desktop (a tool, not an acceptance gate).
// The full app in Chromium (tests/helpers/local-dom-app), the native vault replaced by an in-page stand-in (as
// tests/build358-large-fleet-dispatch-browser.cjs), the fleet engine thread running from a blob (as
// tests/build358-fleet-engine-thread-browser.cjs). It buys an air fleet, dispatches it with the real button, plays at
// 600x, then advances the calendar, and reports for each phase: frame intervals and janky frames, long tasks, saves,
// the simulation frame stages (create, chunks, finish, maintenance, render) and the render callback parts, the fleet
// thread timings, and the fault recorder's summary and causes.
//
//   NODE_PATH=/opt/node22/lib/node_modules node tools/measure_fullgame_perf.cjs --assets 24000 --play 120 --days 60 \
//     [--batch 3000] [--sites OMDB,EGLL,KJFK,RJTT] [--out report.json]
//
// Numbers are for comparing builds on one machine; an iPhone is about 3 to 5 times slower.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');process.env.GH_AUDIT_ROOT=process.env.GH_AUDIT_ROOT||root;
const {chromium}=require('playwright'),{boot}=require(path.join(root,'tests/helpers/local-dom-app'));
const web=path.join(root,'WebApp');

function args(){
  const out={assets:24000,play:120,days:60,batch:3000,sites:'OMDB,EGLL,KJFK,RJTT,WSSS,YSSY,FAOR,SBGR',out:''};
  const argv=process.argv.slice(2);for(let i=0;i<argv.length;i++){const key=argv[i].replace(/^--/,'');if(key in out){const v=argv[++i];out[key]=typeof out[key]==='number'?Number(v):String(v);}}
  out.sites=out.sites.split(',').filter(Boolean);return out;
}
const workerSource=()=>['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js'].map(file=>fs.readFileSync(path.join(web,file),'utf8')).join('\n;\n')+'\n;\n'+
  fs.readFileSync(path.join(web,'fleet-engine-worker.js'),'utf8').replace(/^importScripts\([^)]*\);$/m,'');

function installVault(){
  const vault=window.__VAULT__={chunks:new Map(),saves:[],commits:[],generation:0};
  const deliver=(name,detail)=>setTimeout(()=>window.dispatchEvent(new CustomEvent(name,{detail})),0);
  const decode=b64=>{const bin=atob(b64),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;};
  const referenced=json=>{try{const rows=JSON.parse(json)?.fleet?.rows;return rows?.$ghBinary==='chunks-v1'?rows.chunks:[];}catch{return [];}};
  const bridge={postMessage(m){
    if(m.action==='storeSaveChunk'){vault.chunks.set(m.id,decode(m.base64));return deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:true});}
    if(m.action==='commitSave'||m.action==='resetGameSave'||m.action==='saveManualSlot'){
      const missing=referenced(m.saveJSON).find(id=>!vault.chunks.has(id)),ok=!missing;
      if(m.action==='saveManualSlot')return deliver('gh-native-slot-ack',{requestId:m.requestId,action:m.action,index:m.index,success:ok,message:missing?`Missing save chunk: ${missing}`:''});
      if(ok){vault.saves.push(m.saveJSON);if(vault.saves.length>2)vault.saves.shift();vault.commits.push({at:performance.now(),bytes:m.saveJSON.length});}
      deliver(m.action==='resetGameSave'?'gh-native-reset-ack':'gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:ok,generation:ok?++vault.generation:undefined,message:missing?`Missing save chunk: ${missing}`:''});
    }
  }};
  window.webkit={messageHandlers:{saveBridge:bridge,updateBridge:bridge}};window.GH_NATIVE_BUILD=358;
}
// Frame intervals and long tasks for one phase, independent of the app's own recorder.
function installProbe(){
  const probe=window.__PROBE__={phase:null,phases:{}};
  const current=()=>probe.phase&&probe.phases[probe.phase];
  let last=null;const tick=now=>{const p=current();if(p&&last!==null){const gap=now-last;p.intervals.push(gap);}last=now;requestAnimationFrame(tick);};requestAnimationFrame(tick);
  try{new PerformanceObserver(list=>{const p=current();if(!p)return;for(const e of list.getEntries())p.longTasks.push(Math.round(e.duration));}).observe({entryTypes:['longtask']});}catch{}
  probe.start=name=>{probe.phases[name]={intervals:[],longTasks:[],startedAt:performance.now(),commitsBefore:window.__VAULT__.commits.length};probe.phase=name;last=null;};
  probe.stop=()=>{const p=current();probe.phase=null;if(!p)return null;
    const iv=p.intervals.filter(x=>x<1000).sort((a,b)=>a-b),q=f=>iv.length?Math.round(iv[Math.min(iv.length-1,Math.floor(iv.length*f))]*10)/10:0,janky=p.intervals.filter(x=>x>25).length,lt=p.longTasks.sort((a,b)=>b-a);
    const commits=window.__VAULT__.commits.slice(p.commitsBefore);
    return {wallMs:Math.round(performance.now()-p.startedAt),frames:p.intervals.length,smoothPct:p.intervals.length?Math.round((1-janky/p.intervals.length)*1000)/10:100,jankyFrames:janky,
      p50:q(.5),p95:q(.95),p99:q(.99),worstMs:Math.round(Math.max(0,...p.intervals)),over50:p.intervals.filter(x=>x>50).length,over100:p.intervals.filter(x=>x>100).length,over200:p.intervals.filter(x=>x>200).length,
      longTasks:{count:lt.length,totalMs:lt.reduce((a,b)=>a+b,0),top:lt.slice(0,8)},saves:commits.length};};
}

(async()=>{
  const opt=args(),browser=await chromium.launch({headless:true}),errors=[],report={tool:'measure_fullgame_perf',options:opt,phases:{}};
  const log=(...m)=>console.error('[perf]',...m);
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390},bypassCSP:true});page.setDefaultTimeout(0);
    await page.evaluate(installVault);
    await page.evaluate(source=>{const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));window.__GH_FLEET_ENGINE_WORKER_FACTORY__=()=>new Worker(url);},workerSource());
    await page.evaluate(installProbe);

    // Fleet: the cheapest long-range airliner, spread over the sites in batches.
    const t0=Date.now();
    const bought=await page.evaluate(async({qty,sites,batch})=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,WORLD=GH_WORLD_DATA,type='air',definition=GH_COMPANY_PLATFORM.definitionFor(s(),type);
      if(!s().openedCompanies.includes(type))await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,definition.founding.minimumCapital),legalName:'Perf Air',formationContract:'PERF-AIR'},{silent:true});
      s().godMoney=true;s().infiniteMoney=true;
      const model=[...GH_ASSET_CATALOG[type].used].filter(x=>!x.specs.cargo&&Number(x.specs.rangeKm)>=6000).sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      const facilities=[];for(const site of sites){const airport=WORLD.airports.find(r=>r[0]===site);if(!airport)continue;const facility={id:`PERF-air-${airport[0]}`,name:`Perf ${airport[0]}`,kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:`air:${airport[0]}`,code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]};await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});facilities.push(facility.id);}
      let bought=0,order=0;while(bought<qty){const n=Math.min(batch,qty-bought),site=facilities[order%facilities.length];if(!await a.buyAsset(type,'used',model.id,'lease',n,site,true,`PERF-${order++}`,type))return {error:'purchase',bought};bought+=n;}
      return {bought,size:GH_FLEET_DATA.size(s()),model:model.id};
    },{qty:opt.assets,sites:opt.sites,batch:opt.batch});
    report.fleet={...bought,buyMs:Date.now()-t0};log('fleet',JSON.stringify(report.fleet));
    if(bought.error)throw new Error(`purchase failed: ${JSON.stringify(bought)}`);

    // Dispatch with the real button; the probe covers the command and the frames after it.
    await page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));
    const button=page.locator('.dispatch-international-network[data-company="air"]').first();await button.waitFor({state:'visible',timeout:60000});
    await page.evaluate(()=>__PROBE__.start('dispatch'));const t1=Date.now();await button.click();
    await page.waitForFunction(()=>/bulk-shared-departure/.test(window.GH_APP_RUNTIME_METRICS?.snapshot?.().durable?.last?.name||''),null,{timeout:0,polling:250});
    await page.waitForTimeout(3000);
    report.phases.dispatch={...await page.evaluate(()=>__PROBE__.stop()),commandMs:Date.now()-t1,durable:await page.evaluate(()=>window.GH_APP_RUNTIME_METRICS.snapshot().durable.last)};
    log('dispatch',JSON.stringify(report.phases.dispatch));
    await page.evaluate(()=>__AUDIT__.closeDrawer());

    const phase=async(name,run)=>{
      await page.evaluate(()=>{const s=__GH_STATE__;GH_DIAGNOSTICS.recorderStart(s,__AUDIT__.simulationEngine.snapshot(),{nowMs:Date.now()});__PROBE__.start('x');});
      await page.evaluate(n=>{__PROBE__.phases[n]=__PROBE__.phases.x;delete __PROBE__.phases.x;__PROBE__.phase=n;},name);
      const simBefore=await page.evaluate(()=>__GH_STATE__.simSeconds);
      await run();
      const out=await page.evaluate(({simBefore})=>{
        const s=__GH_STATE__,probe=__PROBE__.stop(),engine=__AUDIT__.simulationEngine.snapshot(),summary=GH_DIAGNOSTICS.recorderStop(s,engine,{nowMs:Date.now()}),rec=GH_DIAGNOSTICS.recorderSnapshot(s,{includeHistory:true}),m=window.GH_APP_RUNTIME_METRICS.snapshot();
        const causes={};for(const e of rec?.events||[]){if(e.type!=='FRAME_DROP')continue;const c=e.detail?.cause||{};const key=[c.kind,c.stage,c.subStage,c.renderPart].filter(Boolean).join('/');causes[key]=(causes[key]||0)+1;}
        return {...probe,simDays:Math.round((s.simSeconds-simBefore)/864)/100,
          engine:{maxFrame:engine.maxFrame,maxCycleMs:engine.maxCycleMs,maxFinishMs:engine.maxFinishMs,maxChunkMs:engine.maxChunkMs,maxRenderMs:engine.maxRenderMs,maxMaintenanceMs:engine.maxMaintenanceMs,longTasks:engine.longTasks,governor:engine.governor},
          simRender:m.simRender,fleetThread:m.fleetEngineThread,recorder:{frameSummary:summary?.frameSummary,findings:(summary?.findings||[]).map(f=>({type:f.type,count:f.count})),dropCauses:causes,keyEvents:rec?.keyEvents||{}}};
      },{simBefore});
      report.phases[name]=out;log(name,JSON.stringify({smoothPct:out.smoothPct,p95:out.p95,worstMs:out.worstMs,longTasks:out.longTasks.count,saves:out.saves,simDays:out.simDays,dropCauses:out.recorder.dropCauses}));
    };
    // Live play at 600x (speed level 4).
    await phase('play',async()=>{await page.evaluate(()=>__AUDIT__.setSpeed(4));await page.waitForTimeout(opt.play*1000);await page.evaluate(()=>__AUDIT__.setSpeed(0));});
    // Calendar advance.
    await phase('advance',async()=>{
      await page.evaluate(days=>{const s=__GH_STATE__;__AUDIT__.simulationEngine.advanceTo(s.simSeconds+days*86400,{reason:'perf-advance',maxSeconds:366*86400});},opt.days);
      await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance,null,{timeout:0,polling:500});
    });
    report.errors=errors.slice(0,10);
  }finally{await browser.close();}
  const text=JSON.stringify(report,null,2);if(opt.out)fs.writeFileSync(opt.out,text);console.log(text);
})().catch(error=>{console.error(error);process.exitCode=1;});
