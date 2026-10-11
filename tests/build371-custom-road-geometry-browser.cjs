'use strict';
// Build 371 regression: a custom road route owns its geometry (state.customRoutes; the route cache keeps only a
// canonical marker for it). hydrateRoadRoutes used to apply a geometry fetched from the network to such a route when it
// had no verified road geometry (an older save): the in-memory template and the trucks on it changed, nothing of it could
// be saved, and the next template rebuild (any command's commit, a reload) put the saved geometry back under trucks
// normalized to the new one. Now custom routes keep their saved geometry: trucks and template agree before and after a
// commit.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const SHIPS=12,TRUCKS=6;

async function osrmDouble(page){
  await page.route(/https:\/\/router\.project-osrm\.org\//,route=>{
    const url=new URL(route.request().url()),coords=url.pathname.split('/').pop().split(';').map(p=>p.split(',').map(Number));
    const hav=(a,b)=>{const R=6371000,r=x=>x*Math.PI/180,dLat=r(b[1]-a[1]),dLon=r(b[0]-a[0]),h=Math.sin(dLat/2)**2+Math.cos(r(a[1]))*Math.cos(r(b[1]))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));};
    const legs=[],all=[];
    for(let i=0;i<coords.length-1;i++){const a=coords[i],b=coords[i+1],n=40,pts=[];for(let k=0;k<=n;k++){const t=k/n,w=Math.sin(t*Math.PI)*(bend.value||0.02);pts.push([+(a[0]+(b[0]-a[0])*t+w).toFixed(5),+(a[1]+(b[1]-a[1])*t).toFixed(5)]);}
      const d=hav(a,b)*1.25+50;legs.push({distance:d,duration:d/22,steps:[{geometry:{coordinates:pts},distance:d,duration:d/22}]});for(const p of pts)if(!all.length||all.at(-1)[0]!==p[0]||all.at(-1)[1]!==p[1])all.push(p);}
    const distance=legs.reduce((x,l)=>x+l.distance,0);
    route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({code:'Ok',routes:[{distance,duration:distance/22,geometry:{type:'LineString',coordinates:all},legs}],waypoints:coords.map(c=>({location:c}))})});
  });
}
async function settled(page,pattern){
  await page.waitForFunction(pattern=>{const last=GH_APP_RUNTIME_METRICS.snapshot().durable.last;return !!last&&new RegExp(pattern).test(String(last.name||''))&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked();},pattern,{timeout:180000});
  await page.evaluate(()=>GH_PERSISTENCE.drain());
}
async function setup(page){
  await page.evaluate(async({trucks,ships})=>{
    const a=__AUDIT__,s=()=>__GH_STATE__;
    for(const type of ['road','sea']){const d=GH_COMPANY_PLATFORM.definitionFor(s(),type);await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,d.founding.minimumCapital),legalName:`QA Isolation ${type}`,formationContract:`QA-ISOLATION-${type.toUpperCase()}`},{silent:true});}
    const sites=GH_MOBILITY_CORE.CAPITALS.slice(0,2);
    for(const site of sites)await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:`QA-ROAD-${site.id}`,sourceKey:`site:road:${site.id}`,capitalId:site.id,kind:'logistics',company:'road',ownerCompanyId:'road',owned:true,deliveryCapacity:40,name:`QA Logistics ${site.city}`,city:site.city,country:site.country,coords:[...site.coords],cost:8500000,dailyCost:12500,capacity:'40',level:1}},{silent:true});
    const truck=[...GH_ASSET_CATALOG.road.used].sort((x,y)=>x.leaseMonthly-y.leaseMonthly||x.price-y.price)[0];
    await a.buyAsset('road','used',truck.id,'lease',trucks,`QA-ROAD-${sites[0].id}`,true,'QA-ISOLATION-ROAD','road');
    const port=GH_WORLD_DATA.ports.find(r=>Number.isFinite(Number(r[3]))&&Number.isFinite(Number(r[4])));
    await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-sea-PORT',name:`QA Port ${port[0]}`,kind:'port-base',company:'sea',ownerCompanyId:'sea',owned:true,sourceKey:`port:${port[0]}:${port[3]}:${port[4]}`,code:String(port[0]).slice(0,5),city:String(port[1]||port[0]),country:String(port[2]||'—'),coords:[port[3],port[4]]},bucket:'globalBases'},{silent:true});
    const ship=[...GH_ASSET_CATALOG.sea.used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
    await a.buyAsset('sea','used',ship.id,'lease',ships,'QA-sea-PORT',true,'QA-ISOLATION-SEA','sea');
    await GH_PERSISTENCE.drain();
  },{trucks:TRUCKS,ships:SHIPS});
  // One road route from the real form, and the trucks dispatched on it.
  await page.evaluate(()=>__AUDIT__.openDrawer('routes','road'));
  const manual=page.locator('.build-road-route[data-company="road"]').first();await manual.waitFor({state:'visible'});
  await page.evaluate(()=>{const from=document.getElementById('roadFrom'),to=document.getElementById('roadTo');const first=from.options[0].value;from.value=first;to.value=[...to.options].find(row=>row.value!==first).value;});
  await manual.click();await settled(page,'road');
  await page.evaluate(()=>__AUDIT__.openDrawer('routes','road'));
  await page.locator('.dispatch-existing-network[data-company="road"]').first().click();await settled(page,'bulk-shared-departure:road');
  return page.evaluate(()=>{const counts={};GH_FLEET_DATA.forEach(__GH_STATE__,a=>{if((a.ownerCompanyId||a.companyId)==='road'&&a.routeId)counts[a.routeId]=(counts[a.routeId]||0)+1;});return Object.entries(counts).sort((x,y)=>y[1]-x[1])[0]?.[0];});
}

const bend={value:0.02};
const READ=roadRoute=>{const tpl=__AUDIT__.routeTemplatesFor(roadRoute);return {template:tpl.distanceKm,trucks:GH_FLEET_DATA.filter(__GH_STATE__,a=>a.routeId===roadRoute).map(a=>a.distanceKm)};};
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,bypassCSP:true});page.setDefaultTimeout(120000);await osrmDouble(page);
    const roadRoute=await setup(page);assert(roadRoute,'trucks on a custom road route');
    // As an older save holds it: no verified road geometry, no canonical cache entry.
    await page.evaluate(roadRoute=>{const tpl=__AUDIT__.routeTemplatesFor(roadRoute);tpl.roadNetworkDistanceKm=0;delete tpl.roadGeometryVersion;delete __GH_STATE__.routeCache[roadRoute];},roadRoute);
    const before=await page.evaluate(`(${READ})(${JSON.stringify(roadRoute)})`);
    bend.value=0.6;
    await page.evaluate(()=>__AUDIT__.hydrateRoadRoutes());
    const hydrated=await page.evaluate(`(${READ})(${JSON.stringify(roadRoute)})`);
    assert.deepEqual(hydrated,before,'hydration leaves a custom route and its trucks as saved');
    // Any command's commit rebuilds the templates from the state.
    assert(await page.evaluate(()=>__AUDIT__.runAuthorizedDomainCommand('operations','record-alert',{text:'qa',type:'operation'},{silent:true})),'a command commits');
    const after=await page.evaluate(`(${READ})(${JSON.stringify(roadRoute)})`);
    assert(after.trucks.length===TRUCKS&&after.trucks.every(d=>Math.abs(d-after.template)<1e-6),`trucks and template agree after the commit: ${JSON.stringify(after)}`);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build371-custom-road-geometry-browser',before,after}));
    console.log('BUILD371_CUSTOM_ROAD_GEOMETRY_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
