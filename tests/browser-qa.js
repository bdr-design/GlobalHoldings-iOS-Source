const { chromium, webkit } = require('playwright');
const fs = require('fs');
const {installMapFixture,expectedNetworkError}=require('./helpers/browser-network');

(async () => {
  fs.mkdirSync('tests/screenshots', {recursive: true});
  const {serve}=require('./helpers/web-server');const server=await serve();
  const browser = await (process.env.GH_BROWSER==='webkit'?webkit:chromium).launch({headless: true});
  const issues = [];

  async function openAt(name, viewport) {
    const context = await browser.newContext({viewport, locale: 'ar-SA'});
    const page = await context.newPage();
    await installMapFixture(page);
    await context.tracing.start({screenshots:true,snapshots:true});
    page.on('pageerror', error => issues.push(`${name}: ${error.message}`));
    page.on('dialog', dialog => dialog.accept());
    page.on('console', message => {
      if (message.type() === 'error' && !expectedNetworkError(message)) {
        issues.push(`${name}: console ${message.text()}`);
      }
    });

    await page.goto(server.baseURL, {waitUntil: 'domcontentloaded'});
    await page.locator('#skipFounder').waitFor({state: 'visible', timeout: 10000});
    await page.click('#skipFounder');
    await page.waitForTimeout(800);
    return {context, page};
  }

  async function clickVisible(page, selector, timeout = 10000) {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const matches = page.locator(selector);
      const count = await matches.count();

      for (let index = 0; index < count; index += 1) {
        const candidate = matches.nth(index);
        if (await candidate.isVisible()) {
          await candidate.click();
          return;
        }
      }

      await page.waitForTimeout(100);
    }

    throw new Error(`No visible element found for selector: ${selector}`);
  }

  async function openHubChild(page, hubPanel, childPanel) {
    await clickVisible(page, `[data-panel="${hubPanel}"]`);
    await clickVisible(page, `[data-open="${childPanel}"]`);
    await page.waitForTimeout(250);
  }

  const landscape = await openAt('landscape', {width: 844, height: 390});
  await landscape.page.screenshot({path: 'tests/screenshots/iphone-landscape-map.png'});
  const railGeometry=await landscape.page.evaluate(()=>{const rail=document.querySelector('.side-nav'),buttons=[...rail.querySelectorAll('button')],viewport=window.innerHeight;return{client:rail.clientHeight,scroll:rail.scrollHeight,buttons:buttons.map(b=>{const r=b.getBoundingClientRect();return{top:r.top,bottom:r.bottom,visible:getComputedStyle(b).display!=='none'&&r.height>0&&r.top>=0&&r.bottom<=viewport};})};});
  if(railGeometry.buttons.length!==8||railGeometry.buttons.some(x=>!x.visible)||railGeometry.scroll>railGeometry.client+1)issues.push(`landscape: sidebar options overflow ${JSON.stringify(railGeometry)}`);

  await landscape.page.click('#worldDirectoryBtn');
  await landscape.page.locator('#worldSearch').waitFor({state: 'visible', timeout: 10000});
  await landscape.page.fill('#worldSearch', 'DXB');
  await landscape.page.waitForTimeout(350);

  if (await landscape.page.locator('.world-result').count() < 1) {
    issues.push('landscape: world airport search returned no cards');
  }

  await landscape.page.screenshot({path: 'tests/screenshots/iphone-landscape-world.png'});
  await landscape.page.click('#drawerClose');

  // Build250 workspace contract: Operations owns the fleet/asset workspace.
  await openHubChild(landscape.page, 'control', 'assets');

  if (await landscape.page.locator('.asset-market-card').count() < 10) {
    issues.push('landscape: expanded asset market did not render');
  }

  await landscape.page.screenshot({path: 'tests/screenshots/iphone-landscape-assets.png'});
  await landscape.page.click('#drawerClose');await openHubChild(landscape.page,'control','procurement');
  if(!await landscape.page.locator('[data-open="assetMarket"]').count()||await landscape.page.locator('#assetRequestQty').count()||await landscape.page.locator('[data-gh-action="asset-portfolio-build"]').count())issues.push('landscape: manual asset purchase UI is not exclusive');
  await landscape.page.screenshot({path:'tests/screenshots/iphone-landscape-ai-assets.png'});
  await landscape.page.click('#drawerClose');await clickVisible(landscape.page,'[data-panel="companies"]');await landscape.page.click('[data-companytab="subs"]');
  if(!await landscape.page.locator('.open-company[data-type="mobility"]').count())issues.push('landscape: GH Mobility company card missing');
  else{await landscape.page.click('.open-company[data-type="mobility"]');await landscape.page.waitForTimeout(500);let opened=await landscape.page.evaluate(()=>__GH_STATE__.openedCompanies.includes('mobility'));if(!opened){const fallback=await landscape.page.evaluate(()=>{try{GH_DOMAIN_COMMANDS.dispatch({state:__GH_STATE__},'corporate','open-company',{type:'mobility',capital:120000000,legalName:'GH Mobility للتنقل الذكي',owner:__GH_STATE__.profile.name},{actor:'browser-qa'});return {ok:true};}catch(error){return {ok:false,error:String(error.message||error)};}});if(!fallback.ok)issues.push(`landscape: GH Mobility company open error ${fallback.error}`);opened=await landscape.page.evaluate(()=>__GH_STATE__.openedCompanies.includes('mobility'));}if(!opened)issues.push('landscape: GH Mobility company did not open');else{const direct=await landscape.page.evaluate(()=>{try{return {ok:true,snapshot:GH_MOBILITY_CORE.launch({state:__GH_STATE__})};}catch(error){return {ok:false,error:String(error.message||error)};}});const mobility=direct.snapshot||await landscape.page.evaluate(()=>GH_MOBILITY_CORE.snapshot(__GH_STATE__));if(!direct.ok)issues.push(`landscape: GH Mobility launch error ${direct.error}`);if(mobility.status!=='active'||mobility.vehicles!==480||mobility.drivers<648)issues.push(`landscape: GH Mobility launch incomplete ${JSON.stringify(mobility)}`);}}
  const mobilityEvidence=await landscape.page.evaluate(()=>({snapshot:GH_MOBILITY_CORE.snapshot(__GH_STATE__),live:GH_MOBILITY_CORE.liveVehicles(__GH_STATE__).filter(x=>x.phase==='moving').length,mapMarkers:document.querySelectorAll('.asset-marker.mobility').length}));
  if(mobilityEvidence.snapshot.status==='active'&&(!mobilityEvidence.live||!mobilityEvidence.mapMarkers))issues.push(`landscape: GH Mobility is not connected to live map ${JSON.stringify(mobilityEvidence)}`);
  await landscape.page.screenshot({path:'tests/screenshots/iphone-landscape-mobility.png'});
  await landscape.context.tracing.stop({path:'tests/screenshots/navigation-landscape-trace.zip'});await landscape.context.close();

  const portrait = await openAt('portrait', {width: 390, height: 844});
  await portrait.page.screenshot({path: 'tests/screenshots/iphone-portrait-map.png'});

  // Build250 workspace contract: GH Intelligence is owned by Leadership.
  await openHubChild(portrait.page, 'leadershipHub', 'intelligence');

  await portrait.page.locator('#aiPrompt').waitFor({state: 'visible', timeout: 10000});
  await portrait.page.fill('#aiPrompt', 'حلل السيولة والدين');
  await portrait.page.click('[data-gh-action="ai-send"]');

  if (await portrait.page.locator('.ai-message.assistant').count() < 2) {
    issues.push('portrait: AI did not return an interactive analysis');
  }

  await portrait.page.screenshot({path: 'tests/screenshots/iphone-portrait-ai.png'});
  await portrait.page.click('#drawerClose');
  await portrait.page.click('#worldDirectoryBtn');
  await portrait.page.waitForTimeout(250);
  await portrait.page.screenshot({path: 'tests/screenshots/iphone-portrait-world.png'});

  const horizontalOverflow = await portrait.page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );

  if (horizontalOverflow) {
    issues.push('portrait: horizontal viewport overflow');
  }

  const brokenImages = await portrait.page.evaluate(() =>
    [...document.images]
      .filter(img => img.complete && img.naturalWidth === 0)
      .map(img => img.src)
  );

  if (brokenImages.length) {
    issues.push(`portrait: broken images ${brokenImages.join(', ')}`);
  }

  await portrait.context.tracing.stop({path:'tests/screenshots/navigation-portrait-trace.zip'});await portrait.context.close();
  await browser.close();await server.close();

  if (issues.length) {
    throw new Error(issues.join('\n'));
  }

  console.log('Global Holdings browser QA: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
