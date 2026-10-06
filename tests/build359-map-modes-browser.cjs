'use strict';
// Build 359, owner report from iPhone with a screenshot ("numbers and clutter all over the map"): vehicle stacks with
// count badges, moving clusters and "network" squares piled up over the map and its country names. The map now follows
// the airline-manager model, three modes:
// - operations: moving aircraft as small vehicles, each standing on its own route position, never two closer than
//   18 px when drawn, at most the zoom's vehicle budget (a vehicle moves along its route towards its asset's position); thin route lines; no count bubble anywhere;
// - network: the group's places only (no vehicles); places closer than the grouping radius share one bubble;
// - expansion: the world's airports and ports grouped in bubbles; the airport filter opens it.
// Every count on the map is Western (12, 3.4K). The mode is kept in the game state.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const QTY=90,WESTERN=/^[0-9]+(\.[0-9])?[KM]?$/;
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390}});page.setDefaultTimeout(120000);
    await page.evaluate(async qty=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,type='air',d=GH_COMPANY_PLATFORM.definitionFor(s(),type);s().godMoney=true;s().infiniteMoney=true;
      await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,d.founding.minimumCapital),legalName:'QA Modes',formationContract:'QA-MODES'},{silent:true});
      const model=[...GH_ASSET_CATALOG[type].used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];let order=0;
      for(const icao of ['OMDB','OMAA','EGLL']){
        const r=GH_WORLD_DATA.airports.find(x=>x[0]===icao),id=`QA-air-${icao}`;
        await a.runAuthorizedDomainCommand('facilities','create',{facility:{id,name:`QA ${icao}`,kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:`air:${icao}`,code:r[1]||icao,icao,iata:r[1],city:r[3]||'—',country:String(r[5]||'—'),coords:[r[6],r[7]]},bucket:'globalBases'},{silent:true});
        if(icao!=='OMAA'&&!await a.buyAsset(type,'used',model.id,'lease',qty,id,true,`QA-MODES-${order++}`,type))throw new Error('purchase');
      }
      a.openDrawer('routes',type);
    },QTY);
    const dispatch=page.locator('.dispatch-international-network[data-company="air"]').first();
    await dispatch.waitFor({state:'visible'});await dispatch.click();
    await page.waitForFunction(qty=>{const owned=GH_FLEET_DATA.filter(__GH_STATE__,x=>(x.ownerCompanyId||x.companyId)==='air');return owned.length===qty*2&&owned.every(x=>x.routeId);},QTY,{timeout:120000});
    // Build 359: the dispatch assigns in chunks (the fleet store is shared with the command's draft), so the routes show
    // before the command ends; it reopens the routes panel when it commits. Close it after that.
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});await page.evaluate(()=>GH_PERSISTENCE.drain());
    await page.evaluate(()=>__AUDIT__.closeDrawer());
    const advance=minutes=>page.evaluate(async minutes=>{const s=__GH_STATE__,t=s.simSeconds+minutes*60;__AUDIT__.simulationEngine.advanceTo(t,{speed:600,batchSeconds:900,reason:'qa-modes',maxSeconds:7200});for(let i=0;i<1200&&(__AUDIT__.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++)await new Promise(r=>setTimeout(r,50));return GH_FLEET_DATA.filter(s,x=>x.phase==='moving').length;},minutes);
    const moving=await advance(90);assert.ok(moving>40,`aircraft are flying: ${moving}`);
    const setView=(lat,lng,zoom)=>page.evaluate(([lat,lng,zoom])=>__AUDIT__.leafletMap().setView([lat,lng],zoom,{animate:false}),[lat,lng,zoom]);
    const look=()=>page.evaluate(()=>{
      const a=__AUDIT__,F=GH_FLEET_DATA,s=__GH_STATE__;a.renderMap();a.updateMarkerPositions(true);a.animateMapMarkerPositions(performance.now()+60000);
      const metrics=a.mapMetrics(),offRoute=[],m=a.leafletMap();
      for(const point of metrics.vehiclePoints){const asset=F.get(s,point.id),p=asset&&a.assetPosition(asset),t=point.target;if(!p||!t||Math.abs(p[0]-t[0])>1e-6||Math.abs(((p[1]-t[1]+540)%360)-180)>1e-6){offRoute.push(point.id);if(!globalThis.__sample)globalThis.__sample={id:point.id,target:t,asset:p,phase:asset&&asset.phase};}}
      const screen=metrics.vehiclePoints.map(point=>m.latLngToContainerPoint([point.lat,point.lng]));let closest=Infinity;
      for(let i=0;i<screen.length;i++)for(let j=i+1;j<screen.length;j++)closest=Math.min(closest,Math.hypot(screen[i].x-screen[j].x,screen[i].y-screen[j].y));
      const sample=globalThis.__sample;globalThis.__sample=null;return {...(sample?{sample}:{}),mode:metrics.mode,zoom:m.getZoom(),vehicles:metrics.vehiclePoints.length,routeLines:metrics.routeLines,facilities:metrics.facilityMarkers,world:metrics.worldMarkers,offRoute,closest,
        bubbles:[...document.querySelectorAll('.map-place-bubble b')].map(b=>b.textContent),badges:document.querySelectorAll('.fleet-stack-count,.facility-map-cluster,.fleet-cluster-marker').length,tiles:document.querySelectorAll('.facility-marker:not(.hq)').length,hq:document.querySelectorAll('.facility-marker.hq').length,dots:document.querySelectorAll('.map-base-dot').length,
        pressed:[...document.querySelectorAll('button[data-map-mode][aria-pressed="true"]')].map(b=>b.dataset.mapMode)};
    });
    const budget=zoom=>zoom<4?24:zoom<6?36:zoom<9?54:72;
    // Operations, at three zooms and after more simulated time.
    const operations=[];
    for(const zoom of [2,3,5]){await setView(38,30,zoom);await page.waitForTimeout(250);operations.push(await look());}
    await advance(30);operations.push(await look());
    for(const row of operations){
      assert.equal(row.mode,'operations');assert.deepEqual(row.pressed,['operations']);
      assert.ok(row.vehicles>0&&row.vehicles<=budget(row.zoom)+1,`vehicles within the budget: ${JSON.stringify(row)}`);
      assert.deepEqual(row.offRoute,[],`every vehicle stands on its own asset position: ${JSON.stringify({zoom:row.zoom,vehicles:row.vehicles,off:row.offRoute.length,sample:row.sample})}`);
      assert.ok(row.closest>=18,`no two vehicles overlap (${row.closest}px)`);
      assert.ok(row.routeLines>0,`route lines are drawn: ${JSON.stringify(row)}`);
      assert.deepEqual(row.bubbles,[],'no count bubble in operations');assert.equal(row.badges,0,'no vehicle count badge');
      // Build 359 (owner screenshot: base tiles all over the map): far out, bases are small dots, within the place budget.
      if(row.zoom<6){assert.equal(row.tiles,0,`no base tiles below zoom 6 (the headquarters aside): ${JSON.stringify(row)}`);assert.ok(row.dots>0&&row.dots<=(row.zoom<4?28:48),`bases are dots: ${row.dots}`);}
    }
    // Network: places only; Dubai and Abu Dhabi share one bubble far out; each stands alone closer in.
    await page.click('[data-map-mode="network"]');await setView(25,45,3);await page.waitForTimeout(200);
    const network=await look();
    assert.equal(network.mode,'network');assert.equal(network.vehicles,0,'no vehicles in network');assert.ok(network.routeLines>0,'the network keeps its route lines');
    assert.ok(network.bubbles.includes('2'),`Dubai and Abu Dhabi are grouped: ${JSON.stringify(network)}`);
    await setView(24.8,55,8);await page.waitForTimeout(200);
    const networkNear=await look();assert.equal(networkNear.bubbles.length,0,`closer in each place stands alone: ${JSON.stringify(networkNear)}`);assert.ok(networkNear.facilities>=2);
    // Expansion: world airports and ports in bubbles with Western counts, no vehicles, no route lines.
    await page.click('[data-map-mode="expansion"]');await setView(30,30,3);await page.waitForTimeout(200);
    const expansion=await look();
    assert.equal(expansion.mode,'expansion');assert.equal(expansion.vehicles,0);assert.equal(expansion.routeLines,0);
    assert.ok(expansion.world>8&&expansion.bubbles.length>4,`airports and ports are grouped: ${JSON.stringify({world:expansion.world,bubbles:expansion.bubbles.length})}`);
    for(const row of [network,expansion])for(const text of row.bubbles)assert.match(text,WESTERN,`bubble count ${text} is Western`);
    assert.match(await page.evaluate(()=>{__AUDIT__.updateMapStatus();return document.getElementById('mapStatus').textContent;}),/مطار وميناء في نطاق العرض/,'the status strip keeps the expansion line');
    assert.equal(await page.evaluate(()=>__GH_STATE__.mapMode),'expansion');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build359-map-modes-browser',operations,network:{...network,bubbles:network.bubbles.length},expansion:{world:expansion.world,bubbles:expansion.bubbles.length}}));
    console.log('BUILD359_MAP_MODES_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
