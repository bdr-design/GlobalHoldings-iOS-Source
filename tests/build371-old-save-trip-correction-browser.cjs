'use strict';
// Build 371: loading a save written before Build 371, whose trips under way carry the route's speed and trip time
// instead of their rated ones, corrects them (the start-up normalization, about 1% on ships and aircraft). This pins that
// the correction adds and loses nothing: from one save, game A loads it as written by this build and game B loads the
// same save rewritten as an older build held it. After the load B's fleet equals A's; both then advance two calendar
// days with the same failing day transition (rolled back, then retried); every arrival, settlement and lifecycle state
// (cash, company books, journal, trip counts, every asset's phase, progress, trip and route) must be identical.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const FIELDS=['routeId','phase','progress','reverse','distanceKm','tripSeconds','effectiveSpeedKmh','fuel','condition','dwellRemaining','departureScheduled','baseFacility','from','to'];

const OUTCOME=FIELDS=>{const s=__GH_STATE__,rows={};GH_FLEET_DATA.forEach(s,a=>{if(['air','sea'].includes(a.ownerCompanyId||a.companyId)){const row={};for(const f of FIELDS)row[f]=a[f]??null;row.lastTrip=a.lastTrip?JSON.stringify(a.lastTrip):null;rows[a.id]=row;}});
  return {simSeconds:s.simSeconds,lastFinancialDay:s.lastFinancialDay,cash:s.cash,books:JSON.stringify(s.companyFinance),journal:{count:(s.finance?.journalEntries||[]).length,sequence:s.finance?.journalSequence,payments:s.finance?.paymentSequence},stats:JSON.stringify(s.stats||null),rows};};
const storageOf=page=>page.evaluate(()=>Array.from({length:localStorage.length},(_,i)=>{const key=localStorage.key(i);return [key,localStorage.getItem(key)];}));

async function advanceTwoDaysWithRollback(page){
  // The first staged day transition fails once inside its apply (rolled back whole), then the engine retries it.
  await page.evaluate(()=>{const TX=window.GH_TRANSACTION_CORE;window.__qaTx=TX;window.qaFailed=0;
    window.GH_TRANSACTION_CORE={...TX,beginStaged(state,options){if(!window.qaFailed&&/^simulation:/.test(String(options?.label||''))){window.qaFailed=1;return TX.beginStaged(state,{...options,apply(...args){options.apply(...args);throw new Error('qa-day-transition-failure');}});}return TX.beginStaged(state,options);}};});
  // A failed day stops the calendar request at the last committed state; the player's next click retries it.
  let clicks=0;
  for(let day=0;day<2;day++){
    const t=await page.evaluate(()=>__GH_STATE__.simSeconds);
    while(await page.evaluate(t=>__GH_STATE__.simSeconds<=t,t)){
      assert(++clicks<=6,'the day advances within a few retries');
      await page.evaluate(()=>document.querySelector('#simNextDay').click());
      await page.waitForFunction(()=>!GH_SIM_KERNEL.snapshot().manualAdvance,null,{timeout:180000});
      await page.waitForFunction(()=>!GH_TRANSACTION_CORE.isStaged(__GH_STATE__),null,{timeout:60000});
    }
  }
  await page.evaluate(()=>{window.GH_TRANSACTION_CORE=window.__qaTx;});
  await page.waitForFunction(()=>!GH_TRANSACTION_CORE.isActive()&&!GH_TRANSACTION_CORE.isStaged(__GH_STATE__)&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:60000});
  return page.evaluate(()=>window.qaFailed);
}

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    // The save: air and sea fleets dispatched and played a little (trips under way).
    let {page}=await boot({browser,errors});page.setDefaultTimeout(120000);
    await page.evaluate(async()=>{
      const a=__AUDIT__,s=()=>__GH_STATE__;
      for(const type of ['air','sea']){const d=GH_COMPANY_PLATFORM.definitionFor(s(),type);await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,d.founding.minimumCapital),legalName:`QA Old Save ${type}`,formationContract:`QA-OLDSAVE-${type.toUpperCase()}`},{silent:true});}
      const airport=GH_WORLD_DATA.airports.find(r=>r[0]==='OMDB');
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-air-OMDB',name:'QA Airport OMDB',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OMDB',code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]},bucket:'globalBases'},{silent:true});
      const port=GH_WORLD_DATA.ports.find(r=>Number.isFinite(Number(r[3]))&&Number.isFinite(Number(r[4])));
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-sea-PORT',name:`QA Port ${port[0]}`,kind:'port-base',company:'sea',ownerCompanyId:'sea',owned:true,sourceKey:`port:${port[0]}:${port[3]}:${port[4]}`,code:String(port[0]).slice(0,5),city:String(port[1]||port[0]),country:String(port[2]||'—'),coords:[port[3],port[4]]},bucket:'globalBases'},{silent:true});
      const cheapest=type=>[...GH_ASSET_CATALOG[type].used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      await a.buyAsset('air','used',cheapest('air').id,'lease',8,'QA-air-OMDB',true,'QA-OLDSAVE-AIR','air');
      await a.buyAsset('sea','used',cheapest('sea').id,'lease',6,'QA-sea-PORT',true,'QA-OLDSAVE-SEA','sea');
      await GH_PERSISTENCE.drain();
    });
    for(const type of ['air','sea']){
      await page.evaluate(type=>__AUDIT__.openDrawer('routes',type),type);
      const before=await page.evaluate(()=>GH_APP_RUNTIME_METRICS.snapshot().durable.samples.length);
      await page.locator(`.dispatch-international-network[data-company="${type}"]`).first().click();
      await page.waitForFunction(({type,before})=>{const m=GH_APP_RUNTIME_METRICS.snapshot().durable;return m.samples.length>before&&new RegExp(`bulk-shared-departure:${type}`).test(String(m.last?.name||''))&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked();},{type,before},{timeout:120000});
    }
    await page.evaluate(()=>__AUDIT__.setSpeed(2));await page.waitForFunction(t=>__GH_STATE__.simSeconds>t+5400,await page.evaluate(()=>__GH_STATE__.simSeconds),{timeout:120000});await page.evaluate(()=>__AUDIT__.setSpeed(0));
    await page.waitForFunction(()=>!GH_TRANSACTION_CORE.isActive()&&!GH_TRANSACTION_CORE.isStaged(__GH_STATE__)&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:60000});
    assert.equal(await page.evaluate(async()=>{const ok=await __AUDIT__.saveNow();await GH_PERSISTENCE.drain();return ok;}),true,'the save');
    const storage=await storageOf(page);await page.close();

    // Game A: the save as this build writes it.
    ({page}=await boot({browser,errors,storage}));page.setDefaultTimeout(120000);
    const loadedA=await page.evaluate(`(${OUTCOME})(${JSON.stringify(FIELDS)})`);
    const failedA=await advanceTwoDaysWithRollback(page);
    const outcomeA=await page.evaluate(`(${OUTCOME})(${JSON.stringify(FIELDS)})`);await page.close();

    // Game B: the same save rewritten as an older build held it (route speed and trip time on every trip under way).
    ({page}=await boot({browser,errors,storage}));page.setDefaultTimeout(120000);
    const rewritten=await page.evaluate(()=>{let n=0;const rows=[];GH_FLEET_DATA.forEach(__GH_STATE__,a=>{if(!['air','sea'].includes(a.ownerCompanyId||a.companyId)||!a.routeId)return;const route=__AUDIT__.routeTemplatesFor(a.routeId);if(!route)return;rows.push([a.id,{effectiveSpeedKmh:route.effectiveSpeedKmh,tripSeconds:route.tripSeconds}]);});
      GH_TRANSACTION_CORE.execute(__GH_STATE__,{label:'qa-older-build-save',scope:['fleet'],apply(){const drafts=[];for(const [id,patch] of rows){const d=GH_FLEET_DATA.draft(__GH_STATE__,id);if(d.effectiveSpeedKmh!==patch.effectiveSpeedKmh){Object.assign(d,patch);drafts.push(d);n++;}}GH_FLEET_DATA.commit(__GH_STATE__,drafts);}});return n;});
    assert(rewritten>=10,`the older save differs on the trips under way: ${rewritten}`);
    assert.equal(await page.evaluate(async()=>{const ok=await __AUDIT__.saveNow();await GH_PERSISTENCE.drain();return ok;}),true);
    const oldStorage=await storageOf(page);await page.close();
    ({page}=await boot({browser,errors,storage:oldStorage}));page.setDefaultTimeout(120000);
    const loadedB=await page.evaluate(`(${OUTCOME})(${JSON.stringify(FIELDS)})`);
    assert.deepEqual(loadedB.rows,loadedA.rows,'the load corrects every trip under way to the values this build writes');
    const failedB=await advanceTwoDaysWithRollback(page);
    const outcomeB=await page.evaluate(`(${OUTCOME})(${JSON.stringify(FIELDS)})`);
    assert.equal(failedA,1);assert.equal(failedB,1,'a day transition failed and was rolled back in both games');
    assert(outcomeA.simSeconds>=loadedA.simSeconds+2*86400-86400&&outcomeA.lastFinancialDay>loadedA.lastFinancialDay,'two days advanced');
    assert(Object.values(outcomeA.rows).some((row,i)=>row.lastTrip!==Object.values(loadedA.rows)[i].lastTrip),'trips arrived and settled in the window');
    // Exact: time, cash, company books, journal, stats (trip counts), and every asset's route, phase, direction, departure
    // state, base and last trip. Fuel, condition, progress and dwell are compared to a relative 1e-9: their last binary
    // digit depends on the fleet store's value-table history (rewriting the speeds and restoring the very same values
    // before the save, with no correction at all, gives the same three 1e-14 differences), not on the correction.
    const differing=Object.keys(outcomeA).filter(key=>key!=='rows'&&JSON.stringify(outcomeA[key])!==JSON.stringify(outcomeB[key]));
    assert.deepEqual(differing,[],`the corrected older save settles exactly as this build's save: ${differing.join(',')}`);
    const FLOAT=new Set(['fuel','condition','progress','dwellRemaining']),rowDiffs=[];
    for(const id of Object.keys(outcomeA.rows))for(const key of Object.keys(outcomeA.rows[id])){const a=outcomeA.rows[id][key],b=outcomeB.rows?.[id]?.[key];
      const same=FLOAT.has(key)&&typeof a==='number'&&typeof b==='number'?Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a)):JSON.stringify(a)===JSON.stringify(b);if(!same)rowDiffs.push({id,key,a,b});}
    assert.deepEqual(rowDiffs,[],'every asset arrives, settles and moves exactly as in this build\'s save');
    assert.deepEqual(Object.keys(outcomeB.rows).sort(),Object.keys(outcomeA.rows).sort());
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build371-old-save-trip-correction-browser',rewritten,simSeconds:[loadedA.simSeconds,outcomeA.simSeconds],journal:outcomeA.journal}));
    console.log('BUILD371_OLD_SAVE_TRIP_CORRECTION_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
