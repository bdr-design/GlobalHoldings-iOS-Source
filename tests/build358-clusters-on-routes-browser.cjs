'use strict';
// Build 358, reported from iPhone: "assets do not keep to the map's lines, they sail across the map". Moving fleet
// clusters were drawn (as of the vehicle-sprite clusters) at the centroid of their assets, which lie on different routes,
// and slid in straight lines between centroids. A cluster drawn as a vehicle must stand where a vehicle can be: it now
// follows one member asset along that asset's route. With 360 aircraft dispatched from two hubs, at several zooms
// and after simulated time passes, every moving cluster marker stands exactly where one of its own moving assets is.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const QTY=180;
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390}});page.setDefaultTimeout(120000);
    await page.evaluate(async qty=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,type='air',d=GH_COMPANY_PLATFORM.definitionFor(s(),type);s().godMoney=true;s().infiniteMoney=true;
      await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,d.founding.minimumCapital),legalName:'QA Routes',formationContract:'QA-ROUTES'},{silent:true});
      const model=[...GH_ASSET_CATALOG[type].used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];let order=0;
      for(const icao of ['OMDB','EGLL']){
        const r=GH_WORLD_DATA.airports.find(x=>x[0]===icao),id=`QA-air-${icao}`;
        await a.runAuthorizedDomainCommand('facilities','create',{facility:{id,name:`QA ${icao}`,kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:`air:${icao}`,code:r[1]||icao,icao,iata:r[1],city:r[3]||'—',country:String(r[5]||'—'),coords:[r[6],r[7]]},bucket:'globalBases'},{silent:true});
        if(!await a.buyAsset(type,'used',model.id,'lease',qty,id,true,`QA-ROUTES-${order++}`,type))throw new Error('purchase');
      }
      a.openDrawer('routes',type);
    },QTY);
    const dispatch=page.locator('.dispatch-international-network[data-company="air"]').first();
    await dispatch.waitFor({state:'visible'});await dispatch.click();
    await page.waitForFunction(qty=>{const owned=GH_FLEET_DATA.filter(__GH_STATE__,x=>(x.ownerCompanyId||x.companyId)==='air');return owned.length===qty*2&&owned.every(x=>x.routeId);},QTY,{timeout:120000});
    await page.evaluate(()=>__AUDIT__.closeDrawer());
    const advance=minutes=>page.evaluate(async minutes=>{const s=__GH_STATE__,t=s.simSeconds+minutes*60;__AUDIT__.simulationEngine.advanceTo(t,{speed:600,batchSeconds:900,reason:'qa-routes',maxSeconds:7200});for(let i=0;i<1200&&(__AUDIT__.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++)await new Promise(r=>setTimeout(r,50));return GH_FLEET_DATA.filter(s,x=>x.phase==='moving').length;},minutes);
    const moving=await advance(90);assert.ok(moving>40,`aircraft are flying: ${moving}`);
    const check=async label=>page.evaluate(label=>{
      const a=__AUDIT__,F=GH_FLEET_DATA,s=__GH_STATE__;a.renderMap();a.updateMarkerPositions(true);a.animateMapMarkerPositions(performance.now()+60000);
      const metrics=a.mapMetrics(),bad=[];
      for(const cluster of metrics.clusterPoints){
        if(!cluster.assetIds)continue;
        const near=cluster.assetIds.map(id=>F.get(s,id)).filter(x=>x&&(x.phase==='moving'||x.phase==='turnaround')).map(x=>a.assetPosition(x)).some(p=>Math.abs(p[0]-cluster.lat)<1e-6&&Math.abs(((p[1]-cluster.lng+540)%360)-180)<1e-6);
        if(!near)bad.push(cluster);
      }
      return {label,clusters:metrics.clusterPoints.length,withMembers:metrics.clusterPoints.filter(c=>c.assetIds).length,bad:bad.slice(0,3)};
    },label);
    const results=[];
    for(const zoom of [2,3,5]){
      await page.evaluate(z=>{const container=document.querySelector('.leaflet-container');const m=container&&Object.values(container).find(v=>v&&typeof v.setZoom==='function');if(m)m.setView([38,30],z,{animate:false});},zoom);
      await page.waitForTimeout(250);results.push(await check(`zoom ${zoom}`));
    }
    await advance(30);results.push(await check('after 30 more simulated minutes'));
    for(const row of results){
      assert.ok(row.withMembers>0,`${row.label}: moving clusters are drawn (${JSON.stringify(row)})`);
      assert.deepEqual(row.bad,[],`${row.label}: every moving cluster stands on one of its own assets (${JSON.stringify(row)})`);
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build358-clusters-on-routes-browser',results}));
    console.log('BUILD358_CLUSTERS_ON_ROUTES_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
