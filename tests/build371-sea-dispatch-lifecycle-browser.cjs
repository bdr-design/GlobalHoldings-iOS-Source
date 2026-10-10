'use strict';
// Build 371 regression: the sea dispatch lifecycle from route assignment through departure, read as committed state.
// CI once read 12 ships routed and 0 underway (tests/build358-air-sea-dispatch-browser.cjs): the durable command shares
// the fleet store with the live state, so its assignment chunks show before its departure chunks. The committed result
// was complete. This test pins the lifecycle itself:
// - interrupted at its last step (after every assignment and departure chunk), the whole command rolls back: no route,
//   no assignment, no departure, no save revision;
// - the next dispatch commits every ship routed and underway or holding a departure slot, and no committed reading
//   shows a ship routed but not departed;
// - a repeated dispatch with no idle ship is refused without a change;
// - a reload restores the committed fleet.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot,reboot}=require('./helpers/local-dom-app');
const TYPE='sea',QTY=12;

const FLEET=type=>{const owned=GH_FLEET_DATA.filter(__GH_STATE__,asset=>(asset.ownerCompanyId||asset.companyId)===type).map(asset=>({id:asset.id,routeId:asset.routeId||null,phase:asset.phase||null,departureScheduled:asset.departureScheduled===true,baseFacility:asset.baseFacility||null}));owned.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  return {owned,routes:(__GH_STATE__.customRoutes||[]).filter(route=>(route.ownerCompanyId||route.companyId||route.company)===type).map(route=>route.id).sort(),saveRevision:__GH_STATE__.saveRevision,inCommand:!!window.__GH_DURABLE_COMMAND_CONTEXT__};};
const counts=fleet=>({owned:fleet.owned.length,routed:fleet.owned.filter(a=>a.routeId).length,underway:fleet.owned.filter(a=>a.phase==='moving'||a.departureScheduled).length,routedNotDeparted:fleet.owned.filter(a=>a.routeId&&a.phase!=='moving'&&!a.departureScheduled).length});

async function dispatch(page){
  await page.evaluate(type=>{__AUDIT__.openDrawer('routes',type);},TYPE);
  const button=page.locator(`.dispatch-international-network[data-company="${TYPE}"]`).first();await button.waitFor({state:'visible',timeout:30000});
  // In-flight readings are recorded for the report only (they are steps of an uncommitted command).
  await page.evaluate(({FLEET,type})=>{const read=eval(FLEET);window.qaInflight=[];window.qaStopInflight=false;const tick=()=>{const f=read(type);if(f.inCommand){const routed=f.owned.filter(a=>a.routeId).length,underway=f.owned.filter(a=>a.phase==='moving'||a.departureScheduled).length,key=`${routed}/${underway}`;if(qaInflight.at(-1)!==key)qaInflight.push(key);}if(!window.qaStopInflight)requestAnimationFrame(tick);};requestAnimationFrame(tick);},{FLEET:`(${FLEET})`,type:TYPE});
  // Every durable command, committed or rolled back, records its timing when it ends (runDurableStateCommand's
  // finally): the dispatch has ended when a new record names it.
  const before=await page.evaluate(()=>JSON.stringify(GH_APP_RUNTIME_METRICS.snapshot().durable.last||null));
  await button.click();
  await page.waitForFunction(before=>{const last=GH_APP_RUNTIME_METRICS.snapshot().durable.last;return !!last&&JSON.stringify(last)!==before&&String(last.name||'').includes('bulk-shared-departure')&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked();},before,{timeout:180000});
  await page.evaluate(()=>GH_PERSISTENCE.drain());
  const out=await page.evaluate(({FLEET,type})=>{window.qaStopInflight=true;return {fleet:eval(FLEET)(type),inflight:window.qaInflight,alerts:(__GH_STATE__.alerts||[]).slice(0,4).map(r=>String(r.text||r))};},{FLEET:`(${FLEET})`,type:TYPE});
  return {...out,durable:await page.evaluate(()=>GH_APP_RUNTIME_METRICS.snapshot().durable.last)};
}

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[],report=[];
  try{
    let {page}=await boot({browser,errors});
    const prepared=await page.evaluate(async({type,qty})=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,WORLD=GH_WORLD_DATA,definition=GH_COMPANY_PLATFORM.definitionFor(s(),type);
      if(!s().openedCompanies.includes(type))await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,definition.founding.minimumCapital),legalName:`QA Lifecycle ${type}`,formationContract:`QA-LIFECYCLE-${type.toUpperCase()}`},{silent:true});
      const port=WORLD.ports.find(r=>Number.isFinite(Number(r[3]))&&Number.isFinite(Number(r[4])));
      const facility={id:`QA-${type}-PORT`,name:`QA Port ${port[0]}`,kind:'port-base',company:type,ownerCompanyId:type,owned:true,sourceKey:`port:${port[0]}:${port[3]}:${port[4]}`,code:String(port[0]).slice(0,5),city:String(port[1]||port[0]),country:String(port[2]||'—'),coords:[port[3],port[4]]};
      await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});
      const model=[...GH_ASSET_CATALOG[type].used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      return !!await a.buyAsset(type,'used',model.id,'lease',qty,facility.id,true,`QA-LIFECYCLE-${type}-${qty}`,type);
    },{type:TYPE,qty:QTY});
    assert.equal(prepared,true,'ships purchased');
    const initial=await page.evaluate(({FLEET,type})=>eval(FLEET)(type),{FLEET:`(${FLEET})`,type:TYPE});
    assert.deepEqual(counts(initial),{owned:QTY,routed:0,underway:0,routedNotDeparted:0});

    // 1. Interrupted after every assignment and departure chunk: the whole command rolls back.
    await page.evaluate(()=>{const ops=window.__qaOps||(window.__qaOps=window.GH_OPERATIONS_CORE);window.qaInterrupt={armed:true,fired:0};
      window.GH_OPERATIONS_CORE={...ops,execute(ctx,cmd,payload){if(cmd==='record-alert'&&payload?.type==='dispatch'&&qaInterrupt.armed){qaInterrupt.armed=false;qaInterrupt.fired++;throw new Error('qa-dispatch-interrupted-after-departures');}return ops.execute(ctx,cmd,payload);}};});
    const interrupted=await dispatch(page);
    assert.equal(await page.evaluate(()=>qaInterrupt.fired),1,'the interruption ran after the departure chunks');
    assert.deepEqual(interrupted.fleet.owned,initial.owned,'interrupted: every ship exactly as before (no route, no departure)');
    assert.deepEqual(interrupted.fleet.routes,initial.routes,'interrupted: no route kept');
    assert.equal(interrupted.fleet.saveRevision,initial.saveRevision,'interrupted: nothing committed');
    await page.evaluate(()=>{window.GH_OPERATIONS_CORE=window.__qaOps;});
    report.push({name:'interrupted dispatch rolls back whole',inflight:interrupted.inflight});

    // 2. The next dispatch commits the whole lifecycle.
    const committed=await dispatch(page);const c=counts(committed.fleet);
    assert.equal(committed.fleet.inCommand,false);
    assert.deepEqual(c,{owned:QTY,routed:QTY,underway:QTY,routedNotDeparted:0},`committed: every ship routed and underway or holding a slot: ${JSON.stringify(c)}`);
    assert(committed.fleet.routes.length>0&&committed.fleet.owned.every(a=>committed.fleet.routes.includes(a.routeId)),'committed: every ship on a route of its company');
    assert.equal(committed.fleet.saveRevision,initial.saveRevision+1,'committed: one save revision');
    report.push({name:'dispatch commits routed and underway',counts:c,routes:committed.fleet.routes.length,inflight:committed.inflight});

    // 3. Repeated: no idle ship, refused, nothing changes.
    await page.evaluate(type=>{__AUDIT__.openDrawer('routes',type);},TYPE);
    const control=await page.evaluate(type=>{const b=document.querySelector(`.dispatch-international-network[data-company="${type}"]`);return {disabled:b?.disabled===true,text:b?.textContent||''};},TYPE);
    assert.equal(control.disabled,true,'repeated: the dispatch control is disabled with no idle ship');assert.match(control.text,/\(0\)/);
    const repeated={fleet:await page.evaluate(({FLEET,type})=>eval(FLEET)(type),{FLEET:`(${FLEET})`,type:TYPE})};
    assert.deepEqual(repeated.fleet.owned,committed.fleet.owned,'repeated: fleet unchanged');assert.deepEqual(repeated.fleet.routes,committed.fleet.routes,'repeated: routes unchanged');assert.equal(repeated.fleet.saveRevision,committed.fleet.saveRevision,'repeated: nothing committed');
    report.push({name:'repeated dispatch refused without change'});

    // 4. Recovery: a reload restores the committed fleet.
    ({page}=await reboot(page,{browser,errors}));
    const restored=await page.evaluate(({FLEET,type})=>eval(FLEET)(type),{FLEET:`(${FLEET})`,type:TYPE});
    assert.deepEqual(restored.owned,committed.fleet.owned,'reload restores every ship');assert.deepEqual(restored.routes,committed.fleet.routes,'reload restores the routes');
    report.push({name:'committed dispatch survives reload'});

    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build371-sea-dispatch-lifecycle-browser',report},null,2));
    console.log('BUILD371_SEA_DISPATCH_LIFECYCLE_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
