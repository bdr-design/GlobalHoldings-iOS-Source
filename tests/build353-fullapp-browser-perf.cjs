'use strict';

// Build 353 full-WebApp browser profiler (adapted from the Build 346 fixture).
// Not part of `npm test`: it builds a real fleet through the signed founder flow
// and official authorized commands, departs it through the real planners, then
// records requestAnimationFrame intervals, long tasks, a CPU profile and every
// simulation transaction. OSRM is replaced by a deterministic local road double
// because CI/sandbox networks block router.project-osrm.org.
//
//   GH_PERF_ENGINE=chromium GH_PERF_FLEET=1800 GH_PERF_SPEED=1 GH_PERF_SAMPLE_MS=20000 \
//     node tests/build353-fullapp-browser-perf.cjs
//   GH_PERF_MODE=air GH_PERF_FLEET=600 ...                 (air fleet + international dispatch)
//   GH_FIXTURE_OUT=/tmp/f.json / GH_FIXTURE_DEPARTED_OUT=/tmp/d.json   (save fixtures)
//   GH_FIXTURE_IN=/tmp/d.json                               (reuse a saved fixture)
// Desktop-browser numbers are relative evidence only; they are not iPhone frame,
// thermal or touch-latency measurements.

const assert=require('node:assert/strict');const path=require('node:path');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const {execFileSync}=require('node:child_process');

const root=process.env.GH_ROOT||path.resolve(__dirname,'..');
const {chromium,webkit}=require('playwright');
const {serve}=require(path.join(root,'tests/helpers/web-server'));
const {drawFounderSignature}=require(path.join(root,'tests/helpers/signature-input'));
const engineName=process.env.GH_PERF_ENGINE||'chromium';
const engine={webkit,chromium}[engineName];
assert(engine,`GH_PERF_ENGINE must be webkit or chromium: ${engineName}`);
const fleet=Number(process.env.GH_PERF_FLEET||1800);
assert(Number.isSafeInteger(fleet)&&fleet>=1&&fleet<=20000,'GH_PERF_FLEET must be 1..20000');
const sampleMs=Number(process.env.GH_PERF_SAMPLE_MS||20000);
assert(Number.isSafeInteger(sampleMs)&&sampleMs>=1000&&sampleMs<=120000,'GH_PERF_SAMPLE_MS must be 1000..120000');
const calendarEnabled=process.env.GH_PERF_CALENDAR!=='0';
const departureEnabled=process.env.GH_PERF_DEPART!=='0';
const build=Number(fs.readFileSync(path.join(root,'BUILD'),'utf8').trim());
// The save format of this source (Build 359: read from the schema owner instead of a fixed 2.0.0).
const SAVE_SCHEMA_VERSION=/SAVE_SCHEMA_VERSION='([^']+)'/.exec(fs.readFileSync(path.join(root,'WebApp/save-schema.js'),'utf8'))[1];
const version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
assert(Number.isSafeInteger(build)&&build>=340,'current BUILD must be a supported kernel-owned source');
const out=path.resolve(process.env.GH_PERF_OUT||path.join(os.tmpdir(),`build${build}-fullapp-browser-perf-${engineName}.json`));
const sha256=text=>crypto.createHash('sha256').update(text).digest('hex');
const tree=JSON.parse(fs.readFileSync(path.join(root,'RUNTIME_SOURCE_MANIFEST.json'),'utf8')).source_tree_sha256;
let commit=null;try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{}
const report={suite:'fullapp-browser-perf',build,version,sourceTreeSha256:tree,commit,browser:engineName,
  platform:process.platform,node:process.version,fleetRequested:fleet,sampleMs,
  nativeSaveBridge:'in-memory test double with exact SHA-256 verification and matching ACK; no physical native vault',
  frameMeasurement:'WebApp requestAnimationFrame recorder within desktop browser; not a measured iPhone refresh rate',
  thresholdUnder5MsVerified:false,calendarEnabled,departureEnabled,stages:[],pageErrors:[],passed:false};

function persist(){fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');}
function stage(name,data){report.stages.push({name,...data});persist();}

// Build 359: the vault chunks (fleet records, large sealed collections) the game uploads before each commit, kept across
// boots; a reload hands them back as the native shell does (__GH_NATIVE_SAVE_CHUNKS__, id -> ArrayBuffer).
const vaultChunks=new Map();
async function boot(browser,url,nativeSave){
  const context=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:2,hasTouch:true,locale:'ar-SA'});
  const bridge={json:nativeSave||null,generation:0,ackCount:0,maxBytes:0};
  // Native-sized source states can exceed the WebApp's 4 MB browser cache.
  // This double supplies acknowledgements but never bypasses the game's
  // transaction, schema validation, hashing, or migration owners.
  await context.exposeBinding('__qaNativeCommit',async(_source,envelope)=>{
    if(envelope?.action!=='commitSave')throw new Error(`unexpected-save-bridge-action:${envelope?.action}`);
    const json=String(envelope.saveJSON||''),parsed=JSON.parse(json),digest=sha256(json);
    if(envelope.saveHash!=null)assert.equal(envelope.saveHash,digest,'supplied save hash must match the exact committed JSON');
    assert.equal(envelope.saveSchemaVersion,SAVE_SCHEMA_VERSION);
    assert.equal(Number(envelope.saveRevision),Number(parsed.saveRevision));
    assert.equal(Number(envelope.resetEpoch),Number(parsed.resetEpoch));
    assert.equal(parsed.saveVersion,SAVE_SCHEMA_VERSION);
    bridge.json=json;bridge.generation++;bridge.ackCount++;
    bridge.maxBytes=Math.max(bridge.maxBytes,Buffer.byteLength(json));
    return {requestId:envelope.requestId,action:'commitSave',saveRevision:envelope.saveRevision,
      resetEpoch:envelope.resetEpoch,saveHash:digest,saveSchemaVersion:envelope.saveSchemaVersion,
      success:true,generation:bridge.generation,nativeVaultCommitMs:0};
  });
  await context.exposeBinding('__qaNativeChunk',async(_source,{id,base64})=>{vaultChunks.set(String(id),String(base64));return true;});
  await context.addInitScript(({saved,nativeBuild,chunks})=>{
    window.GH_NATIVE_BUILD=nativeBuild;
    if(saved){window.__GH_NATIVE_SAVE_JSON__=saved;const map=new Map();for(const [id,base64] of chunks){const bin=atob(base64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);map.set(id,bytes.buffer);}window.__GH_NATIVE_SAVE_CHUNKS__=map;}
    window.webkit=window.webkit||{};
    window.webkit.messageHandlers=window.webkit.messageHandlers||{};
    const streams=new Map();
    const nack=(envelope,error)=>{
      const detail={requestId:envelope.requestId,action:'commitSave',saveRevision:envelope.saveRevision,
        resetEpoch:envelope.resetEpoch,saveHash:envelope.saveHash||'0'.repeat(64),
        saveSchemaVersion:envelope.saveSchemaVersion,success:false,generation:0,message:String(error?.message||error)};
      window.dispatchEvent(new CustomEvent('gh-native-save-ack',{detail}));
    };
    window.webkit.messageHandlers.saveBridge={postMessage(envelope){
      try{
        const action=String(envelope?.action||'');
        if(action==='commitSave'){
          window.__qaNativeCommit(envelope).then(detail=>window.dispatchEvent(new CustomEvent('gh-native-save-ack',{detail})),error=>nack(envelope,error));
          return;
        }
        // Build 358+: the fleet records travel as vault chunks before the commit; the double acknowledges each one.
        if(action==='storeSaveChunk'){window.__qaNativeChunk({id:envelope.id,base64:envelope.base64}).then(()=>window.dispatchEvent(new CustomEvent('gh-native-chunk-ack',{detail:{requestId:envelope.requestId,id:envelope.id,success:true}})));return;}
        if(action==='saveStreamBegin'){
          if(streams.has(envelope.streamId))throw new Error('stream-already-open');
          streams.set(envelope.streamId,{base:{...envelope},chunks:[],bytes:0});
          return;
        }
        if(action==='saveStreamAbort'){streams.delete(envelope.streamId);return;}
        if(action==='saveStreamChunk'){
          const stream=streams.get(envelope.streamId);if(!stream)throw new Error('stream-not-open');
          if(Number(envelope.index)!==stream.chunks.length)throw new Error('stream-order-conflict');
          const text=String(envelope.text||'');if(!text)throw new Error('stream-empty-chunk');
          stream.chunks.push(text);stream.bytes+=new TextEncoder().encode(text).byteLength;return;
        }
        if(action==='saveStreamCommit'){
          const stream=streams.get(envelope.streamId);if(!stream)throw new Error('stream-not-open');
          if(Number(envelope.chunks)!==stream.chunks.length||Number(envelope.utf8Bytes)!==stream.bytes)throw new Error('stream-final-metadata-mismatch');
          streams.delete(envelope.streamId);
          const saveJSON=stream.chunks.join(''),commitEnvelope={...stream.base,...envelope,action:'commitSave',saveJSON};
          delete commitEnvelope.text;delete commitEnvelope.index;
          window.__qaNativeCommit(commitEnvelope).then(detail=>window.dispatchEvent(new CustomEvent('gh-native-save-ack',{detail})),error=>nack(commitEnvelope,error));
          return;
        }
        throw new Error('unexpected-save-bridge-action:'+action);
      }catch(error){if(String(envelope?.action||'')==='saveStreamCommit')nack(envelope,error);else throw error;}
    }};
  },{saved:nativeSave||null,nativeBuild:build,chunks:nativeSave?[...vaultChunks]:[]});
  const page=await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror',error=>report.pageErrors.push({stage:report.stages.at(-1)?.name||'boot',message:String(error.message||error)}));
  await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,route=>route.abort());
  await page.route(/https:\/\/router\.project-osrm\.org\//,route=>{
    const url=new URL(route.request().url()),coords=url.pathname.split('/').pop().split(';').map(p=>p.split(',').map(Number));
    const hav=(a,b)=>{const R=6371000,r=x=>x*Math.PI/180,dLat=r(b[1]-a[1]),dLon=r(b[0]-a[0]),h=Math.sin(dLat/2)**2+Math.cos(r(a[1]))*Math.cos(r(b[1]))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));};
    const legs=[],all=[];
    for(let i=0;i<coords.length-1;i++){const a=coords[i],b=coords[i+1],n=40,pts=[];for(let k=0;k<=n;k++){const t=k/n,w=Math.sin(t*Math.PI)*0.02;pts.push([+(a[0]+(b[0]-a[0])*t+w).toFixed(5),+(a[1]+(b[1]-a[1])*t).toFixed(5)]);}
      const d=hav(a,b)*1.25+50;legs.push({distance:d,duration:d/22,steps:[{geometry:{coordinates:pts},distance:d,duration:d/22}]});for(const p of pts)if(!all.length||all.at(-1)[0]!==p[0]||all.at(-1)[1]!==p[1])all.push(p);}
    const distance=legs.reduce((x,l)=>x+l.distance,0);
    route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({code:'Ok',routes:[{distance,duration:distance/22,geometry:{type:'LineString',coordinates:all},legs}],waypoints:coords.map(c=>({location:c}))})});
  });
  await page.goto(url,{waitUntil:'load'});
  await page.waitForFunction(()=>!!globalThis.__GH_STATE__&&!!globalThis.GH_SIM_KERNEL,null,{timeout:30000});
  return {context,page,bridge};
}

async function captureContext(page){
  await page.evaluate(()=>{
    const prepare=GH_INTERFACE.prepare;
    window.GH_INTERFACE={...GH_INTERFACE,prepare(root,panel,arg,ctx){window.qaPerfContext=ctx;return prepare(root,panel,arg,ctx);}};
  });
  await page.locator('.side-nav [data-panel=companies]').click();
  await page.waitForFunction(()=>globalThis.qaPerfContext?.runAuthorizedDomainCommand&&globalThis.qaPerfContext?.buyAsset);
}

async function snapshot(page){
  return page.evaluate(()=>{
    const state=__GH_STATE__,sim=GH_SIM_KERNEL.snapshot(),schema=GH_SAVE_SCHEMA.validate(state),integrity=GH_INTEGRITY_CORE.check(state),
      phases={};
    // Build 359: the fleet lives in the fleet store (GH_FLEET_DATA), not in state.assets.
    GH_FLEET_DATA.forEach(state,asset=>{phases[asset.phase]=(phases[asset.phase]||0)+1;});
    return {assets:GH_FLEET_DATA.size(state),phases,simSeconds:state.simSeconds,lastFinancialDay:state.lastFinancialDay,
      lastMarketHour:state.lastMarketHour,saveRevision:state.saveRevision,saveSchema:state.saveVersion,
      openedCompanies:state.openedCompanies,routeCount:state.customRoutes.length,
      mapPresent:!!document.querySelector('#map')?.getBoundingClientRect().width,
      schemaOk:schema.ok,schemaErrors:schema.errors,
      criticalIntegrity:(integrity.critical||(integrity.issues||[]).filter(row=>row.severity==='critical'))
        .map(row=>({id:row.id||null,code:row.code||null,title:row.title||null})),
      simulation:{slices:sim.slices,cancels:sim.cancels,conflicts:sim.conflicts,manualFailures:sim.manualFailures,
        backlog:sim.backlog,governor:sim.governor,lastError:sim.lastError,lastAdvanceFailure:sim.lastAdvanceFailure},
      saveMetrics:window.__GH_APP_RUNTIME_INSTRUMENTATION__?.lastSavePreparation||null};
  });
}

async function requireHealthy(page,count,label){
  const value=await snapshot(page);
  assert.equal(value.assets,count,`${label}: actual delivered asset count`);
  assert.equal(value.schemaOk,true,`${label}: ${JSON.stringify(value.schemaErrors)}`);
  assert.deepEqual(value.criticalIntegrity,[],`${label}: critical business integrity`);
  assert.equal(value.mapPresent,true,`${label}: the full game map must be mounted`);
  assert.equal(value.simulation.lastError,'',`${label}: scheduler error`);
  return value;
}

async function buildAirFleet(page){
  await captureContext(page);
  const preparation=await page.evaluate(async count=>{
    const d=GH_COMPANY_PLATFORM.definitionFor(__GH_STATE__,'air');
    await qaPerfContext.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(400000000,d.founding.minimumCapital),legalName:'QA Performance Air',formationContract:'QA-PERFORMANCE-AIR'},{silent:true});
    const wanted=['OERK','OMDB','EGLL','LFPG','KJFK','RJTT','WSSS','EDDF'],sites=wanted.map(icao=>GH_WORLD_DATA.airports.find(row=>row[0]===icao)).filter(Boolean).slice(0,Math.ceil(count/300));
    const names=new Intl.DisplayNames(['ar'],{type:'region'});
    for(const a of sites){const facility={id:`QA-AIR-${a[0]}`,name:`QA Airport ${a[0]}`,kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:`air:${a[0]}`,code:a[1]||a[0],icao:a[0],iata:a[1],city:a[3]||a[4]||'—',country:names.of(a[5]),coords:[a[6],a[7]],deliveryCapacity:300};
      await qaPerfContext.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});}
    const model=[...GH_ASSET_CATALOG.air.used].sort((a,b)=>(a.leaseMonthly||0)-(b.leaseMonthly||0)||a.price-b.price)[0];
    const batches=[];let site=0;
    for(let remaining=count;remaining>0;){const qty=Math.min(300,remaining),order=await qaPerfContext.buyAsset('air','used',model.id,'lease',qty,`QA-AIR-${sites[site][0]}`,true,`QA-PERF-AIR-${count}-${batches.length+1}`,'air');if(!order)throw new Error('air purchase rejected');batches.push({qty,order});remaining-=qty;site++;}
    const drain=await GH_PERSISTENCE.drain({timeoutMs:30000});if(!drain?.ok)throw new Error('drain');
    return {sites:sites.map(a=>a[0]),model:model.id,batches,alerts:(__GH_STATE__.alerts||[]).slice(0,4).map(r=>r.text||String(r))};
  },fleet);
  const after=await requireHealthy(page,fleet,'after-air-domain-commands');
  stage('air-fixture',{preparation,after});
}
async function departAir(page){
  await captureContext(page);
  await page.evaluate(()=>qaPerfContext.openDrawer('routes','air'));
  const button=page.locator('.dispatch-international-network[data-company="air"]').first();
  await button.waitFor({state:'visible',timeout:30000});
  const t0=Date.now();await button.click();
  for(let i=0;i<60;i++){const st=await page.evaluate(()=>{const ph={};for(const a of GH_FLEET_DATA.list(__GH_STATE__))ph[a.phase+(a.routeId?'+r':'')]=(ph[a.phase+(a.routeId?'+r':'')]||0)+1;return {ph,routes:__GH_STATE__.customRoutes.length,alerts:(__GH_STATE__.alerts||[]).slice(0,2).map(r=>(r.text||String(r)).slice(0,220))};});if(i%5===0)console.log(JSON.stringify(st));if(Object.keys(st.ph).some(k=>k.endsWith('+r'))){stage('air-dispatch',{seconds:(Date.now()-t0)/1000,...st});console.log('AIR DISPATCHED',(Date.now()-t0)/1000,JSON.stringify(st));return;}await page.waitForTimeout(1000);}
  const notices=await page.evaluate(()=>[...document.querySelectorAll('.toast,.notice,[role=status],[role=alert]')].map(n=>n.textContent.trim()).filter(Boolean).slice(0,6));
  throw new Error('air dispatch did not assign routes: '+JSON.stringify(notices));
}
async function buildFleet(page){
  if(process.env.GH_PERF_MODE==='air')return buildAirFleet(page);
  await captureContext(page);
  const preparation=await page.evaluate(async count=>{
    const d=GH_COMPANY_PLATFORM.definitionFor(__GH_STATE__,'road');
    if(!d)throw new Error('road company definition missing');
    await qaPerfContext.runAuthorizedDomainCommand('corporate','open-company',{
      type:'road',companyId:'road',capital:Math.max(100000000,d.founding.minimumCapital),
      legalName:'QA Performance Logistics',formationContract:'QA-PERFORMANCE-FULLAPP'
    },{silent:true});
    const sites=GH_MOBILITY_CORE.CAPITALS.slice(0,Math.ceil(count/140));
    if(sites.length*140<count)throw new Error('insufficient canonical world capital sites for requested fleet');
    for(const site of sites){
      const facility={id:`QA-PERF-ROAD-${site.id}`,sourceKey:`site:road:${site.id}`,capitalId:site.id,
        kind:'logistics',company:'road',ownerCompanyId:'road',owned:true,deliveryCapacity:140,
        name:`QA Logistics ${site.city}`,city:site.city,country:site.country,coords:[...site.coords],
        cost:8500000,dailyCost:12500,capacity:'140 trucks'};
      await qaPerfContext.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'customHubs'},{silent:true});
    }
    const model=[...GH_ASSET_CATALOG.road.used].sort((a,b)=>a.leaseMonthly-b.leaseMonthly||a.price-b.price)[0];
    if(!model)throw new Error('road used asset catalog is empty');
    const batches=[];
    for(let remaining=count;remaining>0;){
      const qty=Math.min(900,remaining),order=await qaPerfContext.buyAsset('road','used',model.id,'lease',qty,
        `QA-PERF-ROAD-${sites[0].id}`,true,`QA-PERF-${count}-${batches.length+1}`,'road');
      if(!order)throw new Error(`purchase rejected: ${qty} assets with ${remaining} remaining`);
      batches.push({qty,order});remaining-=qty;
    }
    const drain=await GH_PERSISTENCE.drain({timeoutMs:30000});
    if(!drain?.ok)throw new Error('in-memory native ACK did not drain after purchase');
    return {siteCount:sites.length,model:model.id,batches,saveRevision:__GH_STATE__.saveRevision};
  },fleet);
  const after=await requireHealthy(page,fleet,'after-domain-commands');
  stage('domain-owned-fixture',{preparation,after});
  return {preparation,after};
}

async function depart(page){
  await captureContext(page);
  await page.evaluate(()=>qaPerfContext.openDrawer('routes','road'));
  // The performance fixture must own one proven operational road before asking
  // the bulk planner to fan the fleet out. Older fixtures created many centers
  // but no route, so both real browsers stopped before measuring the game.
  const hasRoad=await page.evaluate(()=>__GH_STATE__.customRoutes.some(route=>(route.routeMode||route.type)==='road'&&(route.ownerCompanyId||route.companyId||route.company)==='road'));
  if(!hasRoad){
    const manual=page.locator('.build-road-route[data-company="road"]').first();
    await manual.waitFor({state:'visible',timeout:30000});
    const selection=await page.evaluate(()=>{
      const from=document.getElementById('roadFrom'),to=document.getElementById('roadTo');
      if(!from||!to||from.options.length<2||to.options.length<2)return null;
      const a=from.options[0].value,b=[...to.options].find(row=>row.value!==a)?.value;
      if(!a||!b)return null;from.value=a;to.value=b;return {from:a,to:b};
    });
    assert(selection,'fixture requires two owned road facilities');
    await manual.click();
    try{
      await page.waitForFunction(()=>__GH_STATE__.customRoutes.some(route=>(route.routeMode||route.type)==='road'&&(route.ownerCompanyId||route.companyId||route.company)==='road'),null,{timeout:120000});
    }catch(error){
      const evidence=await page.evaluate(()=>({routes:__GH_STATE__.customRoutes.length,alerts:(__GH_STATE__.alerts||[]).slice(0,8).map(row=>row.text||row.message||String(row)),drawer:document.getElementById('drawerBody')?.innerText?.slice(0,1200)||''}));
      throw new Error('fixture-road-bootstrap-failed:'+JSON.stringify(evidence));
    }
  }
  const button=page.locator('.dispatch-existing-network[data-company="road"]').first();
  await button.waitFor({state:'visible',timeout:30000});
  await page.evaluate(()=>{window.__qaPerfDispatchStart=performance.now();});
  await button.click();
  await page.waitForFunction(()=>{
    if(GH_FLEET_DATA.list(__GH_STATE__).some(a=>a.phase==='moving'||a.departureScheduled))return true;
    const control=document.querySelector('.dispatch-existing-network[data-company="road"]');
    return performance.now()-window.__qaPerfDispatchStart>2000&&!!control&&!control.disabled&&
      !document.querySelector('.cancel-road-plan');
  },null,{timeout:220000});
  for(let i=0;i<40;i++){const st=await page.evaluate(()=>{const ph={};for(const a of GH_FLEET_DATA.list(__GH_STATE__))ph[a.phase+(a.routeId?'+r':'')+(a.departureScheduled?'+d':'')]=(ph[a.phase+(a.routeId?'+r':'')+(a.departureScheduled?'+d':'')]||0)+1;return {ph,routes:__GH_STATE__.customRoutes.length,speed:__GH_STATE__.speed,alerts:(__GH_STATE__.alerts||[]).slice(0,3).map(r=>(r.text||String(r)).slice(0,160)),plan:!!document.querySelector('.cancel-road-plan')};});console.log(JSON.stringify(st));if(st.ph['moving+r']||st.ph['turnaround+r'])break;if(i===3&&st.speed===0)await page.evaluate(()=>qaPerfContext.setSimulationSpeed(1));await page.waitForTimeout(3000);}
  // The fleet store is shared by the live state and a player command's draft, so assets can move before the command
  // publishes its routes: the check waits for the command to finish and its save to drain.
  await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:220000});
  await page.evaluate(()=>GH_PERSISTENCE.drain());
  const after=await requireHealthy(page,fleet,'after-departure');
  const active=(after.phases.moving||0)+(after.phases.turnaround||0);
  assert(active>0,'real road planner must assign at least one operational route');
  assert(after.routeCount>0,'real road planner must register a route');
  stage('real-road-dispatch',{after,active});
  await page.evaluate(async()=>{const drain=await GH_PERSISTENCE.drain({timeoutMs:30000});if(!drain?.ok)throw new Error('save did not drain after departure');});
}

async function measure(page){
  await captureContext(page);
  if(await page.locator('#drawer.open').count())await page.locator('#drawerClose').click();
  if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.locator('#speedToggle').click();
  const before=await requireHealthy(page,fleet,'before-real-browser-measurement');
  const speedLevel=Number(process.env.GH_PERF_SPEED||1);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:250});
  await page.evaluate(()=>{window.__qaLong=[];try{new PerformanceObserver(list=>{for(const e of list.getEntries())window.__qaLong.push({start:e.startTime,dur:e.duration});}).observe({type:'longtask',buffered:false});}catch(e){}
    window.__qaRaf=[];let last=performance.now();const tick=t=>{window.__qaRaf.push(t-last);last=t;if(window.__qaRafOn)requestAnimationFrame(tick);};window.__qaRafOn=true;requestAnimationFrame(tick);});
  await page.evaluate(()=>{const original=GH_TRANSACTION_CORE;window.__qaTx=[];window.GH_TRANSACTION_CORE={...original,execute(state,options){const t0=performance.now();const out=original.execute(state,options);const tel=original.telemetry?.()?.lastSimulation;if(String(options.label||'').startsWith('simulation:'))window.__qaTx.push({label:options.label,scope:options.scope?options.scope.length:'full',hasAssets:options.scope?options.scope.includes('assets'):true,ms:+(performance.now()-t0).toFixed(1),committed:out.committed,reason:out.reason||null});return out;}};});
  await cdp.send('Profiler.start');
  await page.evaluate(level=>{window.__qaPerfSampleStartedAt=performance.now();qaPerfContext.startFaultRecorder();qaPerfContext.setSimulationSpeed(level);},speedLevel);
  await page.waitForTimeout(sampleMs);
  await page.evaluate(()=>qaPerfContext.setSimulationSpeed(0));
  const {profile}=await cdp.send('Profiler.stop');
  fs.writeFileSync(out.replace(/\.json$/,'.cpuprofile'),JSON.stringify(profile));
  const rafLong=await page.evaluate(()=>{window.__qaRafOn=false;const r=window.__qaRaf.slice(1).sort((a,b)=>a-b),q=p=>r[Math.min(r.length-1,Math.floor(p*r.length))];return {frames:r.length,p50:q(.5),p90:q(.9),p99:q(.99),max:r.at(-1),over33:r.filter(x=>x>33.4).length,over50:r.filter(x=>x>50).length,over100:r.filter(x=>x>100).length,longTasks:window.__qaLong.length,longTaskMs:window.__qaLong.reduce((a,b)=>a+b.dur,0),longTop:window.__qaLong.map(x=>x.dur).sort((a,b)=>b-a).slice(0,15)};});
  stage('raf-longtask',rafLong);
  {const txs=await page.evaluate(()=>window.__qaTx);const by={};for(const t of txs){const k=`scope=${t.scope}`;by[k]=by[k]||{n:0,ms:0,max:0};by[k].n++;by[k].ms+=t.ms;by[k].max=Math.max(by[k].max,t.ms);}stage('sim-tx',{count:txs.length,by,rows:txs.slice(0,40)});console.log('SIMTX',JSON.stringify(by));}
  {const nodes=new Map(profile.nodes.map(n=>[n.id,n]));const self=new Map();const dt=profile.timeDeltas;const counts=new Map();for(let i=0;i<profile.samples.length;i++){const id=profile.samples[i];counts.set(id,(counts.get(id)||0)+(dt[i+1]||0));}
   for(const [id,us] of counts){const n=nodes.get(id),cf=n.callFrame,key=`${cf.functionName||'(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber+1}:${cf.columnNumber+1}`;self.set(key,(self.get(key)||0)+us);}
   // inclusive: walk parents
   const parent=new Map();for(const n of profile.nodes)for(const c of n.children||[])parent.set(c,n.id);
   const incl=new Map();for(const [id,us] of counts){const seen=new Set();let cur=id;while(cur!==undefined){const n=nodes.get(cur),cf=n.callFrame,key=`${cf.functionName||'(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber+1}:${cf.columnNumber+1}`;if(!seen.has(key)){seen.add(key);incl.set(key,(incl.get(key)||0)+us);}cur=parent.get(cur);}}
   const top=m=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,45).map(([k,v])=>`${(v/1000).toFixed(1)}ms ${k}`);
   stage('cpu-profile',{totalMs:[...counts.values()].reduce((a,b)=>a+b,0)/1000,selfTop:top(self),inclusiveTop:top(incl)});}
  const measured=await page.evaluate(()=>{
    const state=__GH_STATE__,recorder=qaPerfContext.faultRecorder(),sim=GH_SIM_KERNEL.snapshot(),
      tx=GH_TRANSACTION_CORE.telemetry(),runtime=window.__GH_APP_RUNTIME_INSTRUMENTATION__;
    return {simSeconds:state.simSeconds,frameSummary:recorder?.frameSummary||null,
      recorderEvents:(recorder?.events||[]).filter(row=>['FRAME_DROP','SIM_SLICE_CANCELLED','CALENDAR_ADVANCE_FAILED','SIM_PROGRESS_STALLED','LONG_TASK_TRACE'].includes(row.type)).slice(0,30),
      simulation:{slices:sim.slices,cancels:sim.cancels,conflicts:sim.conflicts,manualFailures:sim.manualFailures,
        backlog:sim.backlog,governor:sim.governor,lastError:sim.lastError,lastCreateMs:sim.lastCreateMs,
        lastChunkMs:sim.lastChunkMs,lastFinishMs:sim.lastFinishMs},
      lastSimulationTransaction:tx?.lastSimulation||null,
      lastSavePreparation:runtime?.lastSavePreparation||null,
      renderMetrics:runtime?.render||null};
  });
  const stopped=await page.evaluate(()=>({summary:qaPerfContext.finishFaultRecorder(),elapsedMs:performance.now()-window.__qaPerfSampleStartedAt}));
  assert(measured.frameSummary?.measured===true&&measured.frameSummary.frameCallbacks>10,'real requestAnimationFrame samples required');
  if(speedLevel>0)assert(measured.simSeconds>before.simSeconds,'simulation time must progress under 30×');
  if(speedLevel>0)assert(measured.simulation.slices>before.simulation.slices,'actual simulation slices must commit');
  assert.equal(measured.simulation.lastError,'','scheduler must not fail during measurement');
  const frames=measured.frameSummary,expectedFrames=frames.visibleIntervals+frames.estimatedMissedFrames;
  const realSeconds=stopped.elapsedMs/1000;
  stage('visible-map-30x',{before,measured,recordingSummary:stopped.summary,
    requestedSeconds:sampleMs/1000,realSeconds,simulatedSeconds:measured.simSeconds-before.simSeconds,
    effectiveRate:(measured.simSeconds-before.simSeconds)/realSeconds,
    measuredJankyIntervalPercent:frames.visibleIntervals?100*frames.jankyFrames/frames.visibleIntervals:null,
    estimatedMissingFramePercent:expectedFrames?100*frames.estimatedMissedFrames/expectedFrames:null,
    caveat:'Browser requestAnimationFrame rate and thermal behavior are not an iPhone measurement'});
}

async function advanceCalendar(page){
  if(await page.locator('#drawer.open').count())await page.locator('#drawerClose').click();
  if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.locator('#speedToggle').click();
  const before=await snapshot(page),target=(Math.floor(before.simSeconds/86400)+1)*86400;
  await page.locator('#simCalendarToggle').click();
  await page.locator('#simNextDay').click();
  // The boundaries of the last hour and the day close (staged) finish after the clock reaches the target: wait for both.
  await page.waitForFunction(t=>(__GH_STATE__.simSeconds>=t&&!GH_SIM_KERNEL.snapshot().manualAdvance&&!GH_TRANSACTION_CORE.isStaged(__GH_STATE__)&&__GH_STATE__.lastMarketHour>=Math.floor(t/3600))||
    (!GH_SIM_KERNEL.snapshot().manualAdvance&&!!GH_SIM_KERNEL.snapshot().lastAdvanceFailure),target,{timeout:240000});
  const after=await requireHealthy(page,fleet,'after-real-calendar-advance');
  stage('calendar-next-day',{before:{simSeconds:before.simSeconds,lastFinancialDay:before.lastFinancialDay,
    lastMarketHour:before.lastMarketHour},target,after});
  assert.equal(after.simSeconds,target,'the real app must reach exactly the next day');
  assert.equal(after.lastFinancialDay,Math.floor(target/86400));
  assert.equal(after.lastMarketHour,Math.floor(target/3600));
  assert.equal(after.simulation.manualFailures-before.simulation.manualFailures,0,'calendar must not fail');
}

(async()=>{
  persist();
  let server,browser,session;
  try{
    server=await serve(path.join(root,'WebApp'));
    browser=await engine.launch({headless:true});
    report.browserVersion=browser.version();
    if(process.env.GH_FIXTURE_IN){
      const fixture=fs.readFileSync(process.env.GH_FIXTURE_IN,'utf8');
      session=await boot(browser,server.baseURL,fixture);
      const loaded=await requireHealthy(session.page,fleet,'after-fixture-load');
      stage('fixture-load',{phases:loaded.phases,simSeconds:loaded.simSeconds});
      if(process.env.GH_PERF_DEPART==='1')await depart(session.page);
      if(process.env.GH_FIXTURE_DEPARTED_OUT){fs.writeFileSync(process.env.GH_FIXTURE_DEPARTED_OUT,session.bridge.json);}
      if(process.env.GH_INSPECT){const r=await session.page.evaluate(src=>eval(src),fs.readFileSync(process.env.GH_INSPECT,'utf8'));console.log(JSON.stringify(r,null,1));return;}
      await measure(session.page);
      if(calendarEnabled)await advanceCalendar(session.page);
      report.passed=report.pageErrors.length===0;persist();console.log('DONE',out);return;
    }
    session=await boot(browser,server.baseURL,null);
    await session.page.selectOption('#founderMode','sandbox');
    await session.page.click('#founderReview');
    await drawFounderSignature(session.page);
    await session.page.locator('#founderForm button[type=submit]').click();
    await session.page.waitForFunction(()=>__GH_STATE__?.onboardingComplete,null,{timeout:30000});
    if(await session.page.evaluate(()=>__GH_STATE__.speed>0))await session.page.locator('#speedToggle').click();
    await buildFleet(session.page);
    const fixture=session.bridge.json;
    assert(fixture,'the committed fixture must be available from the acknowledged save');
    report.fixtureSha256=sha256(fixture);if(process.env.GH_FIXTURE_OUT)fs.writeFileSync(process.env.GH_FIXTURE_OUT,fixture);
    report.fixtureUtf8Bytes=Buffer.byteLength(fixture);
    report.fixtureSource='signed founder onboarding and official authorized company, facility and purchase commands';
    await session.context.close();session=null;

    // Fresh load exercises actual save migration, proof validation, kernel
    // ownership and UI map setup from the exact acknowledged source JSON.
    session=await boot(browser,server.baseURL,fixture);
    const loaded=await requireHealthy(session.page,fleet,'after-native-source-fixture-reload');
    stage('fresh-verified-load',{loaded,fixtureSha256:report.fixtureSha256});
    if(departureEnabled)await (process.env.GH_PERF_MODE==='air'?departAir(session.page):depart(session.page));
    if(process.env.GH_FIXTURE_DEPARTED_OUT)fs.writeFileSync(process.env.GH_FIXTURE_DEPARTED_OUT,session.bridge.json);
    if(process.env.GH_INSPECT){const r=await session.page.evaluate(src=>eval(src),fs.readFileSync(process.env.GH_INSPECT,'utf8'));console.log(JSON.stringify(r,null,1));return;}
    await measure(session.page);
    if(calendarEnabled)await advanceCalendar(session.page);
    const final=await requireHealthy(session.page,fleet,'final');
    report.final=final;
    report.simulatedNativeAcks=session.bridge.ackCount;
    report.maxAcknowledgedSaveBytes=session.bridge.maxBytes;
    report.passed=report.pageErrors.length===0;
    assert.equal(report.passed,true,JSON.stringify(report.pageErrors));
    persist();
    console.log(`FULL_APP_BROWSER_PERF PASS ${engineName} ${fleet} delivered assets; `+
      `${report.stages.find(row=>row.name==='visible-map-30x')?.measured?.frameSummary?.frameCallbacks} live frames; `+
      `result ${out}; under-5ms and device approval NOT claimed`);
  }catch(error){
    report.error=String(error?.stack||error);persist();
    if(session?.page)try{await session.page.screenshot({path:out.replace(/\.json$/,'.png'),timeout:3000});}catch{}
    console.error(report.error);
    process.exitCode=1;
  }finally{try{await session?.context.close();}catch{}try{await browser?.close();}catch{}try{await server?.close();}catch{}}
})();
