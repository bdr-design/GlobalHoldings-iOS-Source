'use strict';
// Build 359, iPhone diagnostic: one road dispatch (bulk-shared-departure:road) held the screen for 14,435 ms. Its commit
// ran in one synchronous block, and the departure check of every truck built the route conflict context from the whole
// fleet again (a pass over the fleet per truck). The real game here (local DOM, the real road planner with a local road
// double for OSRM) dispatches a road fleet with the real button, and it is checked that:
// - the command builds the route conflict context (a pass over the fleet) once for its departure checks, not once per
//   truck;
// - the commit yields frames between its chunks (DISPATCH_CHUNK trucks each), so the frames during it are many and none
//   lasts as long as the command;
// - every truck has a route and departed or is scheduled, the state validates and no critical integrity issue appears.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const TRUCKS=1500,HUB_CAPACITY=140;

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

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390},bypassCSP:true});page.setDefaultTimeout(300000);
    await osrmDouble(page);
    const setup=await page.evaluate(async({trucks,hubCapacity})=>{
      const a=__AUDIT__,s=()=>__GH_STATE__;s().godMoney=true;s().infiniteMoney=true;
      const d=GH_COMPANY_PLATFORM.definitionFor(s(),'road');
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'road',companyId:'road',capital:Math.max(100000000,d.founding.minimumCapital),legalName:'QA Road',formationContract:'QA-ROAD-DISPATCH'},{silent:true});
      const sites=GH_MOBILITY_CORE.CAPITALS.slice(0,Math.ceil(trucks/hubCapacity));
      for(const site of sites)await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:`QA-ROAD-${site.id}`,sourceKey:`site:road:${site.id}`,capitalId:site.id,kind:'logistics',company:'road',ownerCompanyId:'road',owned:true,deliveryCapacity:hubCapacity,name:`QA Logistics ${site.city}`,city:site.city,country:site.country,coords:[...site.coords],cost:8500000,dailyCost:12500,capacity:`${hubCapacity} trucks`},bucket:'customHubs'},{silent:true});
      const model=[...GH_ASSET_CATALOG.road.used].sort((x,y)=>x.leaseMonthly-y.leaseMonthly||x.price-y.price)[0];let bought=0,order=0;
      for(const site of sites){const qty=Math.min(hubCapacity,trucks-bought);if(qty<=0)break;if(!await a.buyAsset('road','used',model.id,'lease',qty,`QA-ROAD-${site.id}`,true,`QA-ROAD-${order++}`,'road'))return {error:'purchase',bought};bought+=qty;}
      await GH_PERSISTENCE.drain();
      return {bought,size:GH_FLEET_DATA.size(s()),hubs:sites.length};
    },{trucks:TRUCKS,hubCapacity:HUB_CAPACITY});
    assert.equal(setup.error,undefined,JSON.stringify(setup));assert.equal(setup.size,TRUCKS);
    // One proven road first (the planner fans the fleet out from operational roads), from the real form.
    await page.evaluate(()=>__AUDIT__.openDrawer('routes','road'));
    const manual=page.locator('.build-road-route[data-company="road"]').first();await manual.waitFor({state:'visible'});
    await page.evaluate(()=>{const from=document.getElementById('roadFrom'),to=document.getElementById('roadTo');const first=from.options[0].value;from.value=first;to.value=[...to.options].find(row=>row.value!==first).value;});
    await manual.click();
    await page.waitForFunction(()=>__GH_STATE__.customRoutes.some(route=>(route.routeMode||route.type)==='road'),null,{timeout:120000});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
    await page.evaluate(()=>{__AUDIT__.closeDrawer();__AUDIT__.openDrawer('routes','road');});
    // Count the conflict contexts and the frames while the command runs.
    await page.evaluate(()=>{
      // A route conflict context is one pass over the fleet's field classes (GH_FLEET_DATA.forEachFieldClasses): the passes
      // made while the command runs are counted.
      const data=window.GH_FLEET_DATA,probe=window.__ROAD_PROBE__={contexts:0,frames:[],commandFrames:0};
      window.GH_FLEET_DATA=Object.freeze({...data,forEachFieldClasses(...args){if(window.__GH_DURABLE_COMMAND_CONTEXT__)probe.contexts++;return data.forEachFieldClasses(...args);}});
      let last=performance.now();const tick=now=>{const inCommand=!!window.__GH_DURABLE_COMMAND_CONTEXT__;if(inCommand){probe.frames.push(now-last);probe.commandFrames++;}last=now;requestAnimationFrame(tick);};requestAnimationFrame(tick);
    });
    await page.evaluate(()=>GH_DIAGNOSTICS.recorderStart(__GH_STATE__,GH_SIM_KERNEL.snapshot(),{}));
    const button=page.locator('.dispatch-existing-network[data-company="road"]').first();await button.waitFor({state:'visible'});await button.click();
    await page.waitForFunction(()=>/bulk-shared-departure:road/.test(GH_APP_RUNTIME_METRICS.snapshot().durable?.last?.name||''),null,{timeout:300000,polling:200});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
    await page.evaluate(()=>GH_PERSISTENCE.drain());
    const out=await page.evaluate(()=>{
      const s=__GH_STATE__,probe=window.__ROAD_PROBE__,durable=GH_APP_RUNTIME_METRICS.snapshot().durable.last,phases={};let routed=0;
      GH_FLEET_DATA.forEach(s,asset=>{if((asset.ownerCompanyId||asset.companyId)!=='road')return;const key=asset.phase+(asset.departureScheduled?'+scheduled':'');phases[key]=(phases[key]||0)+1;if(asset.routeId)routed++;});
      const schema=GH_SAVE_SCHEMA.validate(s),integrity=GH_INTEGRITY_CORE.check(s);
      const departure=GH_DIAGNOSTICS.departureTraceSnapshot(s)?.recent?.[0]||null;
      return {durable,departure,contexts:probe.contexts,commandFrames:probe.commandFrames,worstFrameMs:Math.round(Math.max(0,...probe.frames)),phases,routed,schemaOk:schema.ok,schemaErrors:schema.errors,critical:(integrity.critical||(integrity.issues||[]).filter(row=>row.severity==='critical')).map(row=>row.id||row.code)};
    });
    console.log(JSON.stringify(out));
    assert.equal(out.durable.committed,true,'the road dispatch committed');
    assert.equal(out.routed,TRUCKS,'every truck has a route');
    assert.equal((out.phases.moving||0)+(out.phases['turnaround+scheduled']||0)+(out.phases['idle+scheduled']||0),TRUCKS,`every truck departed or is scheduled: ${JSON.stringify(out.phases)}`);
    assert.ok(out.contexts<=8,`fleet passes in the command: ${out.contexts} (a few, whatever the fleet; one per truck before: about ${TRUCKS})`);
    assert.ok(out.commandFrames>=Math.ceil(TRUCKS/500)*2,`the commit yields between chunks (${out.commandFrames} frames during the command)`);
    assert.ok(out.worstFrameMs<out.durable.applyMs,`no frame lasts the whole command (worst ${out.worstFrameMs} ms, apply ${out.durable.applyMs} ms)`);
    assert.equal(out.departure.modeCounts.road,TRUCKS,'road fleet dispatch is included in the cross-mode issue trace');
    assert.equal(out.departure.planner.plannedAssignments,TRUCKS,'the road trace records the assigned truck count');
    assert.ok(out.departure.routeIds.length>0&&out.departure.routeIds.length<=12,'the road issue trace retains a bounded sample of route IDs');
    assert.ok(out.departure.planner.planningMs>=0&&out.departure.planner.dispatchApplyMs>=0,'the route plan and durable apply have separate measured durations');
    assert.equal(out.departure.performance.durable.committed,true,'the issue log includes committed-command timing');
    assert.ok(out.departure.performance.wallMs>=out.departure.planner.planningMs+out.durable.totalMs-100,'the issue log wall window includes both road planning and its durable command');
    assert.equal(out.departure.performance.faultRecorder.active,true,'the issue log knows the fault recorder is active');
    assert.ok(out.departure.performance.faultRecorder.frameSummary.frameCallbacks>0,'the issue log includes frame measurements captured while route dispatch was running');
    assert.equal(out.schemaOk,true,JSON.stringify(out.schemaErrors));assert.deepEqual(out.critical,[]);
    assert.deepEqual(errors,[]);
    console.log('BUILD359_ROAD_DISPATCH_BROWSER_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
