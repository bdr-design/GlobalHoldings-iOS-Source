'use strict';
const assert=require('assert'),fs=require('fs');
const {chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server'),{installMapFixture,expectedNetworkError}=require('./helpers/browser-network');

(async()=>{
  const engineName=process.env.GH_BROWSER||'chromium',engine=engineName==='webkit'?webkit:chromium;
  const browser=await engine.launch({headless:true}),server=await serve(),page=await browser.newPage({viewport:{width:844,height:390},locale:'ar-SA'}),errors=[],evidence={engine:engineName,aircraft:300};
  await installMapFixture(page);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!expectedNetworkError(m)&&!m.location().url.includes('router.project-osrm.org'))errors.push(m.text());});
  page.on('dialog',d=>d.accept());

  const state=()=>page.evaluate(()=>JSON.parse(JSON.stringify(__GH_STATE__)));
  const close=async()=>{if(await page.locator('#drawer').getAttribute('aria-hidden')==='false')await page.click('#drawerClose');};
  const visible=async selector=>{const rows=page.locator(selector);for(let i=0;i<await rows.count();i++)if(await rows.nth(i).isVisible())return rows.nth(i);throw new Error('No visible '+selector);};
  const panel=async name=>{await close();await (await visible(`[data-panel="${name}"]`)).click();};
  const control=async name=>{await panel('control');await page.locator(`[data-open="${name}"]`).first().click();};

  try{
    await page.goto(server.baseURL,{waitUntil:'domcontentloaded'});
    await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await page.locator('#founderForm button[type="submit"]').click();await page.waitForFunction(()=>__GH_STATE__.onboardingComplete);
    await page.evaluate(()=>{__GH_STATE__.godMoney=true;__GH_STATE__.infiniteMoney=true;GH_FINANCE_CORE.reconcile(__GH_STATE__);});

    await panel('companies');await page.click('[data-companytab="subs"]');await page.click('button.open-company[data-type="air"]');
    await close();await page.click('#worldDirectoryBtn');await page.locator('[data-world-company="air"]').click();
    const ruh=await page.evaluate(()=>{
      const row=GH_WORLD_DATA.airports.find(site=>site[1]==='RUH');if(!row)throw new Error('RUH airport fixture missing');return {key:`air:${row[0]}`,name:row[2]};
    });
    await page.fill('#worldSearch','RUH');await page.waitForTimeout(250);
    const baseButton=page.locator(`.world-result[data-company="air"][data-key="${ruh.key}"] .open-directory-site`);
    await baseButton.waitFor({state:'visible'});await baseButton.click();
    await page.waitForFunction(()=>__GH_STATE__.globalBases.some(b=>b.company==='air'));
    let current=await state(),base=current.globalBases.find(b=>b.company==='air');
    assert(base&&Number(base.deliveryCapacity)===300,'air base must expose the documented 300-aircraft capacity');

    // Regression for the uploaded incident: reopen the owned facility through the same
    // public UI path first, then hire. HR helpers must remain in command context,
    // never inside the cloneable payload.
    await close();await page.click('#worldDirectoryBtn');await page.locator('[data-world-company="air"]').click();await page.fill('#worldSearch','RUH');await page.waitForTimeout(200);
    const manageFacility=page.locator(`.world-result[data-company="air"][data-key="${ruh.key}"] [data-open="facilityManage"][data-arg="${base.id}"]`);
    await manageFacility.waitFor({state:'visible'});await manageFacility.click();
    const peopleTab=page.locator('[data-facility-tab="people"]');await peopleTab.waitFor({state:'visible'});await peopleTab.click();
    const hireButton=page.locator('[data-gh-action="facility-hire"]');await hireButton.waitFor({state:'visible'});await hireButton.click();
    await page.waitForFunction(()=>__GH_STATE__.domainRuntime?.commands?.some(row=>row.domain==='facilities'&&row.name==='hire'&&row.status==='committed'));
    current=await state();
    assert(!current.controlPlane?.incidents?.some(row=>row.code==='DOMAIN_COMMAND_FAILED'&&row.domain==='facilities'&&String(row.detail||'').includes('clone')),'facility hire reproduced non-cloneable payload incident');

    await control('assetMarket');await page.click('[data-markettype="air"]');
    const card=page.locator('.manual-buy-asset[data-type="air"][data-id="N-A5"]').locator('xpath=ancestor::article[contains(@class,"asset-market-card")]');
    await card.locator('.manual-asset-base').selectOption(base.id);await card.locator('.manual-asset-qty').fill('300');await card.locator('.manual-asset-mode').selectOption('cash');
    const purchaseStart=Date.now();await card.locator('.manual-buy-asset').click();
    await page.waitForFunction(()=>__GH_STATE__.assets.filter(a=>a.type==='air').length===300,null,{timeout:120000});
    evidence.purchaseMs=Date.now()-purchaseStart;
    current=await state();
    const aircraft=current.assets.filter(a=>a.type==='air');
    assert.strictEqual(aircraft.length,300);assert(aircraft.every(a=>a.baseFacility===base.id&&a.staffing?.ready===true),'all 300 aircraft must be delivered and fully staffed');

    const sandboxCover=current.treasury.ledger.find(x=>x.kind==='sandbox-capital-cover');
    assert(sandboxCover,'large sandbox purchase must create an explicit game-mode funding cover');
    assert.strictEqual(sandboxCover.from,'تمويل وضع اللعب','sandbox cover must not present accounting equity as an external remitter');

    await panel('finance');await page.locator('[data-open="invoices"]').first().click();await page.locator('[data-tab="incoming"]').click();
    const docsText=await page.locator('#drawerBody').innerText();
    assert(docsText.includes('تغطية وضع اللعب'),'finance document must label sandbox funding clearly');
    assert(docsText.includes('تمويل وضع اللعب'),'finance document must show a clear game-mode funding source');
    assert(docsText.includes('ليست حوالة من شركة أو مستثمر خارجي'),'finance document must explain that sandbox coverage is internal');
    assert(!docsText.includes('الآمر / Remitter\nحقوق ملكية وضع اللعب'),'legacy confusing sandbox remitter must not render');

    await control('routes');await page.click('[data-routetype="air"]');
    const dispatchButton=page.locator('.dispatch-international-network[data-type="air"]');
    await dispatchButton.waitFor({state:'visible'});assert.strictEqual(await dispatchButton.isEnabled(),true);
    await page.evaluate(()=>{
      const watch=window.__GH_AIR_ROUTE_WATCH={active:true,gaps:[],last:performance.now()};
      const tick=now=>{if(!watch.active)return;watch.gaps.push(now-watch.last);watch.last=now;requestAnimationFrame(tick);};
      requestAnimationFrame(tick);
    });
    const routeStart=Date.now();await dispatchButton.click();
    await page.waitForFunction(()=>{
      const rows=__GH_STATE__.assets.filter(a=>a.type==='air');
      return rows.length===300&&rows.every(a=>a.routeId&&(a.phase==='moving'||a.departureScheduled));
    },null,{timeout:120000});
    evidence.routingMs=Date.now()-routeStart;
    evidence.paint=await page.evaluate(()=>{const w=window.__GH_AIR_ROUTE_WATCH||{gaps:[]};w.active=false;const gaps=w.gaps||[];return {frames:gaps.length,maxGapMs:gaps.length?Math.max(...gaps):0,p95Ms:gaps.length?[...gaps].sort((a,b)=>a-b)[Math.floor(gaps.length*.95)]:0};});

    current=await state();const routed=current.assets.filter(a=>a.type==='air'),routes=current.customRoutes.filter(r=>r.type==='air');
    assert.strictEqual(routes.length,25,'300 aircraft should use 25 bounded shared air routes at target load 12');
    assert.strictEqual(new Set(routed.map(a=>a.routeId)).size,25,'every aircraft must be assigned to the shared air network');
    assert.strictEqual(routed.filter(a=>a.phase==='moving').length,25,'one aircraft per air corridor must depart immediately');
    assert.strictEqual(routed.filter(a=>a.phase==='turnaround'&&a.departureScheduled).length,275,'remaining aircraft must be time-slotted instead of blocking the UI');
    for(const route of routes){
      const users=routed.filter(a=>a.routeId===route.id);
      assert(users.length>0&&users.length<=12,'automatic air density must remain at or below the 12-aircraft planning target');
      assert.strictEqual(new Set(users.map(a=>a.routeSlot)).size,users.length,'air departure slots must be unique inside each route');
    }
    assert(evidence.paint.frames>5,'route dispatch must yield enough for visible UI frames');
    assert(evidence.paint.maxGapMs<3000,`air dispatch blocked UI for ${evidence.paint.maxGapMs.toFixed(1)}ms`);
    assert.deepStrictEqual(errors,[]);

    fs.mkdirSync('.ci-output/ci',{recursive:true});fs.writeFileSync(`.ci-output/ci/build317-air300-${engineName}.json`,JSON.stringify(evidence,null,2));
    console.log(`BUILD317 air300 ${engineName}: PASS (300 aircraft -> 25 shared routes, 25 moving + 275 scheduled, max frame gap ${evidence.paint.maxGapMs.toFixed(1)}ms, game-mode funding clarified)`);
  }finally{
    fs.mkdirSync('tests/screenshots',{recursive:true});await page.screenshot({path:`tests/screenshots/build317-air300-${engineName}.png`}).catch(()=>{});
    await browser.close();await server.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
