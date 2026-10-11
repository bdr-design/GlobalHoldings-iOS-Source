'use strict';
// Build 371 regression: a reload must not change a trip under way. The start-up normalization's patch kept the first
// pending value of a field when a later set() of it equalled the asset's own value, so the route's speed and trip time
// (set first) replaced every rated speed (set next) on each load: ships about 1% slower after a reload, their arrival
// times moved. Every air and sea asset, dispatched and then played a little, must read the same after save and reload.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot,reboot}=require('./helpers/local-dom-app');
const FIELDS=['routeId','distanceKm','tripSeconds','effectiveSpeedKmh','dwellHours','from','to','phase','progress','reverse'];

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    let {page}=await boot({browser,errors});page.setDefaultTimeout(120000);
    await page.evaluate(async()=>{
      const a=__AUDIT__,s=()=>__GH_STATE__;
      for(const type of ['air','sea']){const d=GH_COMPANY_PLATFORM.definitionFor(s(),type);await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,d.founding.minimumCapital),legalName:`QA Reload ${type}`,formationContract:`QA-RELOAD-${type.toUpperCase()}`},{silent:true});}
      const airport=GH_WORLD_DATA.airports.find(r=>r[0]==='OMDB');
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-air-OMDB',name:'QA Airport OMDB',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OMDB',code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]},bucket:'globalBases'},{silent:true});
      const port=GH_WORLD_DATA.ports.find(r=>Number.isFinite(Number(r[3]))&&Number.isFinite(Number(r[4])));
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-sea-PORT',name:`QA Port ${port[0]}`,kind:'port-base',company:'sea',ownerCompanyId:'sea',owned:true,sourceKey:`port:${port[0]}:${port[3]}:${port[4]}`,code:String(port[0]).slice(0,5),city:String(port[1]||port[0]),country:String(port[2]||'—'),coords:[port[3],port[4]]},bucket:'globalBases'},{silent:true});
      const cheapest=type=>[...GH_ASSET_CATALOG[type].used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      await a.buyAsset('air','used',cheapest('air').id,'lease',8,'QA-air-OMDB',true,'QA-RELOAD-AIR','air');
      await a.buyAsset('sea','used',cheapest('sea').id,'lease',6,'QA-sea-PORT',true,'QA-RELOAD-SEA','sea');
      await GH_PERSISTENCE.drain();
    });
    for(const type of ['air','sea']){
      await page.evaluate(type=>__AUDIT__.openDrawer('routes',type),type);
      const before=await page.evaluate(()=>GH_APP_RUNTIME_METRICS.snapshot().durable.samples.length);
      await page.locator(`.dispatch-international-network[data-company="${type}"]`).first().click();
      await page.waitForFunction(({type,before})=>{const m=GH_APP_RUNTIME_METRICS.snapshot().durable;return m.samples.length>before&&new RegExp(`bulk-shared-departure:${type}`).test(String(m.last?.name||''))&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked();},{type,before},{timeout:120000});
    }
    // A little play, so trips are under way at different progress.
    await page.evaluate(()=>__AUDIT__.setSpeed(2));await page.waitForFunction(t=>__GH_STATE__.simSeconds>t+1800,await page.evaluate(()=>__GH_STATE__.simSeconds),{timeout:120000});
    await page.evaluate(()=>__AUDIT__.setSpeed(0));
    await page.waitForFunction(()=>!GH_TRANSACTION_CORE.isActive()&&!GH_TRANSACTION_CORE.isStaged(__GH_STATE__)&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:60000});
    const read=FIELDS=>{const out={};GH_FLEET_DATA.forEach(__GH_STATE__,a=>{if(['air','sea'].includes(a.ownerCompanyId||a.companyId)){const row={};for(const f of FIELDS)row[f]=a[f]??null;out[a.id]=row;}});return out;};
    const saved=await page.evaluate(async({read,FIELDS})=>{const r=eval(read);const ok=await __AUDIT__.saveNow();if(ok!==true)throw new Error(`save-rejected:${ok}`);await GH_PERSISTENCE.drain();return {time:__GH_STATE__.simSeconds,rows:r(FIELDS)};},{read:`(${read})`,FIELDS});
    assert.equal(Object.keys(saved.rows).length,14,'every air and sea asset read');
    assert(Object.values(saved.rows).every(row=>row.routeId),'every asset on a route');
    ({page}=await reboot(page,{browser,errors}));
    const restored=await page.evaluate(({read,FIELDS})=>({time:__GH_STATE__.simSeconds,rows:eval(read)(FIELDS)}),{read:`(${read})`,FIELDS});
    assert.equal(restored.time,saved.time);
    const changed=Object.keys(saved.rows).filter(id=>JSON.stringify(saved.rows[id])!==JSON.stringify(restored.rows[id])).map(id=>({id,saved:saved.rows[id],restored:restored.rows[id]}));
    assert.deepEqual(changed,[],`a reload changes no trip under way: ${JSON.stringify(changed.slice(0,2))}`);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build371-reload-trip-speed-browser',assets:Object.keys(saved.rows).length,simSeconds:saved.time}));
    console.log('BUILD371_RELOAD_TRIP_SPEED_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
