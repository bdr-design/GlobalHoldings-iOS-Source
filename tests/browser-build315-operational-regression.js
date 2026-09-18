'use strict';
const assert=require('assert'),fs=require('fs');
const {chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server'),{installMapFixture,expectedNetworkError}=require('./helpers/browser-network');

(async()=>{
  const engineName=process.env.GH_BROWSER||'chromium',engine=engineName==='webkit'?webkit:chromium;
  const browser=await engine.launch({headless:true}),server=await serve(),page=await browser.newPage({viewport:{width:844,height:390},locale:'ar-SA'}),errors=[],evidence={engine:engineName};let expectedFailure=false;
  await installMapFixture(page);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!expectedFailure&&!expectedNetworkError(m)&&!m.location().url.includes('router.project-osrm.org'))errors.push(m.text());});
  page.on('dialog',d=>d.accept());

  const state=()=>page.evaluate(()=>JSON.parse(JSON.stringify(__GH_STATE__)));
  const close=async()=>{if(await page.locator('#drawer').getAttribute('aria-hidden')==='false')await page.click('#drawerClose');};
  const panel=async name=>{await close();const rows=page.locator(`[data-panel="${name}"]`);for(let i=0;i<await rows.count();i++)if(await rows.nth(i).isVisible()){await rows.nth(i).click();return;}throw Error('panel '+name);};
  const control=async name=>{await panel('control');await page.locator(`[data-open="${name}"]`).first().click();};
  const failStorage=()=>page.evaluate(()=>{window.__ghOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(String(key).startsWith('global-holdings-world-v2.0.0'))throw new DOMException('Operational audit quota','QuotaExceededError');return window.__ghOriginalSetItem.call(this,key,value);};});
  const restoreStorage=()=>page.evaluate(()=>{if(window.__ghOriginalSetItem){Storage.prototype.setItem=window.__ghOriginalSetItem;delete window.__ghOriginalSetItem;}});
  const waitReleased=async locator=>{await locator.waitFor({state:'visible'});for(let i=0;i<600;i++){if(await locator.isEnabled()&&(await locator.getAttribute('data-busy'))===null)return;await page.waitForTimeout(50);}throw new Error('button did not release busy state');};

  try{
    await page.goto(server.baseURL,{waitUntil:'domcontentloaded'});
    await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await page.locator('#founderForm button[type="submit"]').click();await page.waitForFunction(()=>__GH_STATE__.onboardingComplete);

    await panel('companies');await page.click('[data-companytab="subs"]');await page.click('button.open-company[data-type="sea"]');
    await panel('finance');await page.selectOption('#companyTransferFrom','group');await page.selectOption('#companyTransferTo','sea');await page.fill('#companyTransferAmount','950000000');await page.click('.company-transfer-submit');
    let current=await state();assert(current.openedCompanies.includes('sea'));assert(current.companyFinance.sea.accounts[0].balance>=950000000);

    // Facility creation must roll back on durability failure and leave the same UI action retryable.
    await close();await page.click('#worldDirectoryBtn');await page.locator('[data-world-company="sea"]').click();await page.fill('#worldSearch','DEHAM');
    const baseButton=page.locator('.open-directory-site[data-key="sea:DEHAM"]');await baseButton.waitFor({state:'visible'});
    const facilityBefore={bases:(await state()).globalBases.length,cash:(await state()).companyFinance.sea.accounts[0].balance};
    await failStorage();expectedFailure=true;await baseButton.click();await waitReleased(baseButton);expectedFailure=false;
    current=await state();assert.strictEqual(current.globalBases.length,facilityBefore.bases,'failed durable facility create must not leave a base');assert.strictEqual(current.companyFinance.sea.accounts[0].balance,facilityBefore.cash,'failed durable facility create must roll back the construction debit');assert.strictEqual(await baseButton.isEnabled(),true,'facility button must be retryable after persistence failure');
    await restoreStorage();await baseButton.click();await page.waitForFunction(()=>__GH_STATE__.globalBases.some(b=>b.company==='sea'));
    current=await state();const base=current.globalBases.find(b=>b.company==='sea');assert(base&&base.sourceKey==='sea:DEHAM');evidence.base={id:base.id,cost:base.cost};

    // Large-ish maritime purchase must roll back atomically on save failure, release the button, then succeed on retry.
    await control('assetMarket');await page.click('[data-markettype="sea"]');
    const card=page.locator('.manual-buy-asset[data-type="sea"][data-id="N-S9"]').locator('xpath=ancestor::article[contains(@class,"asset-market-card")]');
    await card.locator('.manual-asset-base').selectOption(base.id);await card.locator('.manual-asset-qty').fill('25');await card.locator('.manual-asset-mode').selectOption('cash');
    const purchaseButton=card.locator('.manual-buy-asset'),beforePurchase=await state(),seaCashBefore=beforePurchase.companyFinance.sea.accounts[0].balance;
    await failStorage();expectedFailure=true;await purchaseButton.click();await waitReleased(purchaseButton);expectedFailure=false;
    current=await state();assert.strictEqual(current.assets.filter(a=>a.type==='sea').length,0,'failed durable purchase must not create ships');assert.strictEqual(current.companyFinance.sea.accounts[0].balance,seaCashBefore,'failed durable purchase must not debit sea cash');assert.strictEqual(await purchaseButton.isEnabled(),true,'purchase button must be retryable after persistence failure');
    await restoreStorage();await purchaseButton.click();await page.waitForFunction(()=>__GH_STATE__.assets.filter(a=>a.type==='sea').length===25,null,{timeout:60000});
    current=await state();const ships=current.assets.filter(a=>a.type==='sea');assert.strictEqual(new Set(ships.map(a=>a.id)).size,25);assert(ships.every(a=>a.baseFacility===base.id&&a.deliveryStatus==='delivered'&&a.staffing?.ready===true&&a.staffing?.total===20));assert.strictEqual(ships.reduce((n,a)=>n+a.staffing.total,0),500);assert.strictEqual(seaCashBefore-current.companyFinance.sea.accounts[0].balance,25*31000000,'successful retry must debit exactly once');evidence.purchase={count:25,crew:500,debit:25*31000000};

    // Shared maritime routing must also roll back cleanly on save failure and remain retryable.
    await control('routes');await page.click('[data-routetype="sea"]');
    const dispatch=page.locator('.dispatch-international-network[data-type="sea"]');await dispatch.waitFor({state:'visible'});
    const preDispatch=await state(),routesBefore=preDispatch.customRoutes.length;
    await failStorage();expectedFailure=true;await dispatch.click();await waitReleased(dispatch);expectedFailure=false;
    current=await state();assert.strictEqual(current.customRoutes.length,routesBefore,'failed maritime durable commit must not leave routes');assert(current.assets.filter(a=>a.type==='sea').every(a=>!a.routeId&&a.phase!=='moving'&&!a.departureScheduled),'failed maritime commit must leave all ships untouched');assert.strictEqual(await dispatch.isEnabled(),true,'maritime dispatch button must be retryable after save failure');
    await restoreStorage();await dispatch.click();await page.waitForFunction(()=>__GH_STATE__.assets.filter(a=>a.type==='sea').every(a=>a.routeId),null,{timeout:60000});
    current=await state();const routed=current.assets.filter(a=>a.type==='sea'),seaRoutes=current.customRoutes.filter(r=>r.type==='sea');
    assert.strictEqual(seaRoutes.length,2,'25 ships at maritime capacity 24 must use exactly two shared routes');assert.strictEqual(new Set(routed.map(a=>a.routeId)).size,2);assert.strictEqual(routed.filter(a=>a.phase==='moving').length,2);assert.strictEqual(routed.filter(a=>a.phase==='turnaround'&&a.departureScheduled).length,23);
    for(const route of seaRoutes){const users=routed.filter(a=>a.routeId===route.id);assert(users.length>0&&users.length<=24);assert.strictEqual(new Set(users.map(a=>a.routeSlot)).size,users.length);}
    evidence.routing={routes:2,moving:2,scheduled:23};

    const saved=await state();await page.reload({waitUntil:'domcontentloaded'});const restored=await state();
    for(const key of ['assets','customRoutes','companyFinance','crew','globalBases'])assert.deepStrictEqual(restored[key],saved[key],`reload mismatch: ${key}`);
    assert.deepStrictEqual(errors,[]);
    fs.mkdirSync('.ci-output/ci',{recursive:true});fs.writeFileSync(`.ci-output/ci/build315-operational-regression-${engineName}.json`,JSON.stringify(evidence,null,2));
    console.log(`BUILD315 operational regression ${engineName}: PASS (facility/purchase/sea-route rollback + button retry; 25 ships on 2 shared routes)`);
  }finally{
    await restoreStorage().catch(()=>{});
    fs.mkdirSync('tests/screenshots',{recursive:true});await page.screenshot({path:`tests/screenshots/build315-operational-${engineName}.png`}).catch(()=>{});
    await browser.close();await server.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
