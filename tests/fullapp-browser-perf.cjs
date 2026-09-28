'use strict';

// Full WebApp browser evidence, deliberately separate from the deterministic
// Node benchmark and from the physical-iPhone approval gate.
//
// Run on a macOS CI runner after `npm install` and `npx playwright install webkit chromium`:
//   GH_PERF_ENGINE=webkit GH_PERF_FLEET=1800 GH_PERF_OUT=/tmp/fullapp-perf.json \
//     node tests/fullapp-browser-perf.cjs
//   GH_PERF_ENGINE=chromium GH_PERF_SAMPLE_MS=30000 \
//     node tests/fullapp-browser-perf.cjs
// The in-memory save bridge only acknowledges an exactly hashed save and
// provides it on a fresh browser load. It DOES NOT test an iPhone, a Native
// Save Vault, signing, actual hardware frame cadence, or a <5 ms guarantee.

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium,webkit}=require('playwright');
const {serve}=require('./helpers/web-server');
const {drawFounderSignature}=require('./helpers/signature-input');

const root=path.resolve(__dirname,'..');
const engineName=process.env.GH_PERF_ENGINE||'webkit';
const engine={webkit,chromium}[engineName];
assert(engine,`GH_PERF_ENGINE must be webkit or chromium: ${engineName}`);
const fleet=Number(process.env.GH_PERF_FLEET||1800);
assert(Number.isSafeInteger(fleet)&&fleet>=1800&&fleet<=3380,'GH_PERF_FLEET must be 1800..3380');
const sampleMs=Number(process.env.GH_PERF_SAMPLE_MS||20000);
assert(Number.isSafeInteger(sampleMs)&&sampleMs>=5000&&sampleMs<=120000,'GH_PERF_SAMPLE_MS must be 5000..120000');
const calendarEnabled=process.env.GH_PERF_CALENDAR!=='0';
const departureEnabled=process.env.GH_PERF_DEPART!=='0';
const build=Number(fs.readFileSync(path.join(root,'BUILD'),'utf8').trim());
const version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
assert(Number.isSafeInteger(build)&&build>=343,'current BUILD must be a supported kernel-owned source');
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

async function boot(browser,url,nativeSave){
  const context=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:2,hasTouch:true,locale:'ar-SA'});
  const bridge={json:nativeSave||null,generation:0,ackCount:0,maxBytes:0};
  // Native-sized source states can exceed the WebApp's 4 MB browser cache.
  // This double supplies acknowledgements but never bypasses the game's
  // transaction, schema validation, hashing, or migration owners.
  await context.exposeBinding('__qaNativeCommit',async(_source,envelope)=>{
    if(envelope?.action!=='commitSave')throw new Error(`unexpected-save-bridge-action:${envelope?.action}`);
    const json=String(envelope.saveJSON||''),parsed=JSON.parse(json),digest=sha256(json);
    assert.equal(envelope.saveHash,digest,'the WebApp must hash exactly the committed JSON');
    assert.equal(envelope.saveSchemaVersion,'2.0.0');
    assert.equal(Number(envelope.saveRevision),Number(parsed.saveRevision));
    assert.equal(Number(envelope.resetEpoch),Number(parsed.resetEpoch));
    assert.equal(parsed.saveVersion,'2.0.0');
    bridge.json=json;bridge.generation++;bridge.ackCount++;
    bridge.maxBytes=Math.max(bridge.maxBytes,Buffer.byteLength(json));
    return {requestId:envelope.requestId,action:envelope.action,saveRevision:envelope.saveRevision,
      resetEpoch:envelope.resetEpoch,saveHash:envelope.saveHash,saveSchemaVersion:envelope.saveSchemaVersion,
      success:true,generation:bridge.generation,nativeVaultCommitMs:0};
  });
  await context.addInitScript(({saved,nativeBuild})=>{
    window.GH_NATIVE_BUILD=nativeBuild;
    if(saved)window.__GH_NATIVE_SAVE_JSON__=saved;
    window.webkit=window.webkit||{};
    window.webkit.messageHandlers=window.webkit.messageHandlers||{};
    window.webkit.messageHandlers.saveBridge={postMessage(envelope){
      window.__qaNativeCommit(envelope).then(detail=>{
        window.dispatchEvent(new CustomEvent('gh-native-save-ack',{detail}));
      },error=>{
        window.dispatchEvent(new CustomEvent('gh-native-save-ack',{detail:{
          requestId:envelope.requestId,action:envelope.action,saveRevision:envelope.saveRevision,
          resetEpoch:envelope.resetEpoch,saveHash:envelope.saveHash,
          saveSchemaVersion:envelope.saveSchemaVersion,success:false,generation:0,message:String(error.message||error)
        }}));
      });
    }};
  },{saved:nativeSave||null,nativeBuild:build});
  const page=await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror',error=>report.pageErrors.push({stage:report.stages.at(-1)?.name||'boot',message:String(error.message||error)}));
  await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,route=>route.abort());
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
      phases={},assets=state.assets||[];
    for(const asset of assets)phases[asset.phase]=(phases[asset.phase]||0)+1;
    return {assets:assets.length,phases,simSeconds:state.simSeconds,lastFinancialDay:state.lastFinancialDay,
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

async function buildFleet(page){
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
        kind:'logistics',ownerCompanyId:'road',owned:true,deliveryCapacity:140,
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
  const button=page.locator('.dispatch-existing-network[data-company="road"]').first();
  await button.waitFor({state:'visible',timeout:30000});
  await page.evaluate(()=>{window.__qaPerfDispatchStart=performance.now();});
  await button.click();
  await page.waitForFunction(()=>{
    if(__GH_STATE__.assets.some(a=>a.phase==='moving'||a.departureScheduled))return true;
    const control=document.querySelector('.dispatch-existing-network[data-company="road"]');
    return performance.now()-window.__qaPerfDispatchStart>2000&&!!control&&!control.disabled&&
      !document.querySelector('.cancel-road-plan');
  },null,{timeout:220000});
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
  await page.evaluate(()=>{window.__qaPerfSampleStartedAt=performance.now();qaPerfContext.startFaultRecorder();qaPerfContext.setSimulationSpeed(1);});
  await page.waitForTimeout(sampleMs);
  await page.evaluate(()=>qaPerfContext.setSimulationSpeed(0));
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
  assert(measured.simSeconds>before.simSeconds,'simulation time must progress under 30×');
  assert(measured.simulation.slices>before.simulation.slices,'actual simulation slices must commit');
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
  await page.waitForFunction(t=>__GH_STATE__.simSeconds>=t||
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
    session=await boot(browser,server.baseURL,null);
    await session.page.selectOption('#founderMode','sandbox');
    await session.page.click('#founderReview');
    await drawFounderSignature(session.page);
    await session.page.locator('#founderForm button[type=submit]').click();
    await session.page.waitForFunction(()=>__GH_STATE__?.onboardingComplete,null,{timeout:30000});
    if(await session.page.evaluate(()=>__GH_STATE__.speed>0))await session.page.locator('#speedToggle').click();
    await buildFleet(session.page);
    const fixture=session.bridge.json;
    assert(fixture&&JSON.parse(fixture).assets.length===fleet,'the committed fixture must be available from the acknowledged save');
    report.fixtureSha256=sha256(fixture);
    report.fixtureUtf8Bytes=Buffer.byteLength(fixture);
    report.fixtureSource='signed founder onboarding and official authorized company, facility and purchase commands';
    await session.context.close();session=null;

    // Fresh load exercises actual save migration, proof validation, kernel
    // ownership and UI map setup from the exact acknowledged source JSON.
    session=await boot(browser,server.baseURL,fixture);
    const loaded=await requireHealthy(session.page,fleet,'after-native-source-fixture-reload');
    stage('fresh-verified-load',{loaded,fixtureSha256:report.fixtureSha256});
    if(departureEnabled)await depart(session.page);
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
