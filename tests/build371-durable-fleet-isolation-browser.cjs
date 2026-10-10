'use strict';
// Build 371: what the rest of the app can see and do while a durable command is paused between its route assignment and
// its departures. The command's draft shares the fleet root with the live state (Transaction Core journaled root), so its
// uncommitted rows are visible to a reader of the live fleet; this test pins that nothing can act on them:
// - no other root of the live state changes, no save is written (saveNow refuses), no simulated time passes, and every
//   domain command on the live state is refused;
// - a road geometry that arrives meanwhile (hydrateRoadRoutes after its network await) is neither applied nor allowed to
//   touch the route template; Build 371 applies it once the command has settled. Before Build 371 its normalized truck
//   rows went into the command's journal: kept by a commit that rebuilt the template from the draft, or rolled back while
//   the template kept the new geometry (rows and template disagreeing either way);
// - interrupted after its departures, the command rolls back whole and the save is untouched; committed, every ship is
//   underway and a reload restores it.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot,reboot}=require('./helpers/local-dom-app');
const SHIPS=12,TRUCKS=6;

async function osrmDouble(page){
  await page.route(/https:\/\/router\.project-osrm\.org\//,route=>{
    const url=new URL(route.request().url()),coords=url.pathname.split('/').pop().split(';').map(p=>p.split(',').map(Number));
    const hav=(a,b)=>{const R=6371000,r=x=>x*Math.PI/180,dLat=r(b[1]-a[1]),dLon=r(b[0]-a[0]),h=Math.sin(dLat/2)**2+Math.cos(r(a[1]))*Math.cos(r(b[1]))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));};
    const legs=[],all=[];
    for(let i=0;i<coords.length-1;i++){const a=coords[i],b=coords[i+1],n=40,pts=[];for(let k=0;k<=n;k++){const t=k/n,w=Math.sin(t*Math.PI)*0.02;pts.push([+(a[0]+(b[0]-a[0])*t+w).toFixed(5),+(a[1]+(b[1]-a[1])*t).toFixed(5)]);}
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
// Everything observable outside the fleet rows, the fleet rows by company, and the stored save.
const OBSERVE=()=>{const s=__GH_STATE__,rows={};GH_FLEET_DATA.forEach(s,a=>{const company=a.ownerCompanyId||a.companyId;(rows[company]||(rows[company]=[])).push({id:a.id,routeId:a.routeId||null,phase:a.phase||null,departureScheduled:a.departureScheduled===true,distanceKm:a.distanceKm,tripSeconds:a.tripSeconds});});
  const stored=Array.from({length:localStorage.length},(_,i)=>{const key=localStorage.key(i);return key+'='+localStorage.getItem(key);}).sort().join('\n');let h=2166136261>>>0;for(let i=0;i<stored.length;i++){h^=stored.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  const roots={};for(const key of Object.keys(s).sort())if(key!=='fleet')roots[key]=s[key];
  return {rows,roots:JSON.stringify(roots),storage:`${stored.length}:${h}`,simSeconds:s.simSeconds,saveRevision:s.saveRevision};};

async function scenario(page,{roadRoute,interrupt}){
  await page.evaluate(()=>__AUDIT__.openDrawer('routes','sea'));
  const pre=await page.evaluate(`(${OBSERVE})()`);
  // Pause: the first frame yield of the sea dispatch that sees every ship routed and none departed.
  await page.evaluate(({interrupt})=>{const original=window.__qaTimeout||(window.__qaTimeout=window.setTimeout);window.qaPause={armed:true,held:null};
    window.setTimeout=function(fn,ms,...rest){if(qaPause.armed&&!ms&&window.__GH_DURABLE_COMMAND_CONTEXT__){const ships=GH_FLEET_DATA.filter(__GH_STATE__,a=>(a.ownerCompanyId||a.companyId)==='sea');if(ships.length&&ships.every(a=>a.routeId&&a.phase!=='moving'&&!a.departureScheduled)){qaPause.armed=false;qaPause.held=()=>fn(...rest);return 0;}}return original.call(window,fn,ms,...rest);};
    const ops=window.__qaOps||(window.__qaOps=window.GH_OPERATIONS_CORE);window.GH_OPERATIONS_CORE=interrupt?{...ops,execute(ctx,cmd,payload){if(cmd==='record-alert'&&payload?.type==='dispatch')throw new Error('qa-interrupted-after-departures');return ops.execute(ctx,cmd,payload);}}:ops;},{interrupt});
  await page.locator('.dispatch-international-network[data-company="sea"]').first().click();
  await page.waitForFunction(()=>!!qaPause.held,null,{timeout:120000});

  // --- Paused between the assignment and the departures. ---
  const paused=await page.evaluate(async({roadRoute,OBSERVE})=>{
    const observe=eval(OBSERVE),at=observe(),out={inCommand:!!window.__GH_DURABLE_COMMAND_CONTEXT__,visibleShips:at.rows.sea.map(r=>`${r.routeId?'R':'-'}${r.phase==='moving'||r.departureScheduled?'D':'-'}`)};
    // Persistence refuses.
    try{out.saveNow=__AUDIT__.saveNow();}catch(error){out.saveNow=`refused:${error.message}`;}
    // Every domain command on the live state is refused (the system path, as a background writer would call it).
    try{GH_DOMAIN_COMMANDS.dispatchSystem({state:__GH_STATE__},'operations','record-alert',{text:'qa',type:'operation'},{actor:'system-ui-notification'});out.liveDomainCommand='accepted';}catch(error){out.liveDomainCommand=String(error.message);}
    // A player command is refused before it starts.
    try{out.playerCommand=await __AUDIT__.runAuthorizedDomainCommand('operations','record-alert',{text:'qa',type:'operation'},{silent:true});}catch(error){out.playerCommand=`refused:${error.message}`;}
    // A road geometry arrives (route without verified road geometry, as in an older save).
    const tpl=__AUDIT__.routeTemplatesFor(roadRoute);tpl.roadNetworkDistanceKm=0;delete tpl.roadGeometryVersion;const templateBefore=tpl.distanceKm;
    const geometry={route:tpl.route.map(([lat,lng],i)=>[lat+(i%2?0.05:0),lng]),durationSeconds:tpl.tripSeconds*1.4};window.qaGeometry=geometry;
    out.directApply=__AUDIT__.applyRoadGeometry(roadRoute,geometry,false);
    window.qaDeferred=typeof __AUDIT__.applyRoadGeometryWhenSettled==='function'?__AUDIT__.applyRoadGeometryWhenSettled(roadRoute,geometry,true):Promise.resolve('unavailable');
    for(let frame=0;frame<30;frame++)await new Promise(resolve=>requestAnimationFrame(resolve));
    const after=observe();out.templateUnchanged=__AUDIT__.routeTemplatesFor(roadRoute).distanceKm===templateBefore;
    out.sameRoots=after.roots===at.roots;out.sameStorage=after.storage===at.storage;out.sameTime=after.simSeconds===at.simSeconds;out.sameRoad=JSON.stringify(after.rows.road)===JSON.stringify(at.rows.road);
    return out;
  },{roadRoute,OBSERVE:`(${OBSERVE})`});
  assert.equal(paused.inCommand,true);
  assert(paused.saveNow===false||/^refused:/.test(paused.saveNow),`no save while the command holds the state: ${paused.saveNow}`);
  assert.equal(paused.liveDomainCommand,'Durable state command is in progress','domain commands on the live state are refused');
  assert(paused.playerCommand===false||/^refused:/.test(paused.playerCommand),`a player command is refused: ${paused.playerCommand}`);
  assert.equal(paused.directApply,false,'a geometry is not applied while the command holds the state');
  assert.equal(paused.templateUnchanged,true,'nor does it touch the route template');
  assert.equal(paused.sameRoad,true,'no truck row written during the pause');
  assert.equal(paused.sameRoots,true,'no other root of the live state changes during the pause');
  assert.equal(paused.sameStorage,true,'nothing is written to storage during the pause');
  assert.equal(paused.sameTime,true,'no simulated time during the pause');
  const pausedRoots=await page.evaluate(`(${OBSERVE})()`);assert.equal(pausedRoots.roots,pre.roots,'the live roots are those before the command');assert.equal(pausedRoots.storage,pre.storage);

  // --- Resume. ---
  await page.evaluate(()=>{const held=qaPause.held;qaPause.held=null;window.setTimeout=window.__qaTimeout;held();});
  await settled(page,'bulk-shared-departure:sea');
  const applied=await page.evaluate(()=>window.qaDeferred);
  const out=await page.evaluate(({roadRoute,OBSERVE})=>{const at=eval(OBSERVE)(),tpl=__AUDIT__.routeTemplatesFor(roadRoute);return {committed:GH_APP_RUNTIME_METRICS.snapshot().durable.last.committed,at,template:tpl.distanceKm,trucks:at.rows.road.filter(r=>r.routeId===roadRoute).map(r=>r.distanceKm),cached:!!__GH_STATE__.routeCache?.[roadRoute]};},{roadRoute,OBSERVE:`(${OBSERVE})`});
  assert.equal(applied,true,'the geometry is applied once the command settled');
  assert(out.trucks.length===TRUCKS&&out.trucks.every(d=>Math.abs(d-out.template)<1e-6),`trucks and route template agree after the command: ${JSON.stringify({template:out.template,trucks:out.trucks})}`);
  assert(Math.abs(out.template-pausedRoots.rows.road[0].distanceKm)>1,'the new geometry was applied');
  assert.equal(out.cached,true,'its cache entry is written through the routes owner after the command');
  return {pre,paused,out};
}

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[],report=[];
  try{
    let {page}=await boot({browser,errors,bypassCSP:true});page.setDefaultTimeout(120000);await osrmDouble(page);
    const roadRoute=await setup(page);assert(roadRoute,'trucks on a road route');

    // 1. Interrupted after its departures: the whole command rolls back.
    const rolled=await scenario(page,{roadRoute,interrupt:true});
    assert.equal(rolled.out.committed,false);
    assert.deepEqual(rolled.out.at.rows.sea,rolled.pre.rows.sea,'every ship exactly as before the command');
    assert.equal(rolled.out.at.saveRevision,rolled.pre.saveRevision,'no save revision');
    report.push({name:'paused then interrupted: rolled back, nothing acted on the partial result',refusals:{save:rolled.paused.saveNow,player:rolled.paused.playerCommand},visibleWhilePaused:rolled.paused.visibleShips.join('')});

    // 2. The same pause, then committed.
    await page.evaluate(()=>{window.GH_OPERATIONS_CORE=window.__qaOps;});
    const committed=await scenario(page,{roadRoute,interrupt:false});
    assert.equal(committed.out.committed,true);
    assert(committed.out.at.rows.sea.every(r=>r.routeId&&(r.phase==='moving'||r.departureScheduled)),'every ship routed and underway after the commit');
    assert.equal(committed.out.at.saveRevision,committed.pre.saveRevision+1);
    const saved=await page.evaluate(async OBSERVE=>{const read=eval(OBSERVE);const ok=await __AUDIT__.saveNow();if(ok!==true)throw new Error(`save-rejected:${ok}`);await GH_PERSISTENCE.drain();return read().rows.sea;},`(${OBSERVE})`);
    ({page}=await reboot(page,{browser,errors,bypassCSP:true}));
    const restored=await page.evaluate(`(${OBSERVE})()`);
    // Identity and lifecycle fields: tripSeconds of a ship is recomputed on load (about 1% apart on 118731e too, with no
    // command involved; a separate, pre-existing difference).
    const identity=rows=>rows.map(({id,routeId,phase,departureScheduled})=>({id,routeId,phase,departureScheduled}));
    assert.deepEqual(identity(restored.rows.sea),identity(saved),'a reload restores the committed fleet');
    report.push({name:'paused then committed: complete, reload restores it'});

    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build371-durable-fleet-isolation-browser',report},null,2));
    console.log('BUILD371_DURABLE_FLEET_ISOLATION_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
