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
    // Use the funded sandbox profile so the QA suite can exercise every
    // subsidiary (including the deliberately large GH Mobility launch) without
    // turning on God Mode or depending on a persisted browser profile.
    await page.locator('#founderMode').waitFor({state: 'visible', timeout: 10000});
    await page.screenshot({path:`tests/screenshots/${name}-founder-contract.png`});
    const founderGeometry=await page.evaluate(()=>{const flow=document.querySelector('#founderFlow'),sheet=document.querySelector('.founder-contract-sheet'),aside=document.querySelector('.founder-visual'),controls=[...flow.querySelectorAll('input:not([type="file"]),select,.founder-submit')];return{flow:{clientWidth:flow.clientWidth,scrollWidth:flow.scrollWidth},sheet:{clientWidth:sheet.clientWidth,scrollWidth:sheet.scrollWidth},aside:{left:aside.getBoundingClientRect().left,right:aside.getBoundingClientRect().right},controls:controls.map(node=>node.getBoundingClientRect().height),viewport:window.innerWidth};});
    if(founderGeometry.flow.scrollWidth>founderGeometry.flow.clientWidth+1||founderGeometry.sheet.scrollWidth>founderGeometry.sheet.clientWidth+1||founderGeometry.aside.left<-.5||founderGeometry.aside.right>founderGeometry.viewport+.5||founderGeometry.controls.some(height=>height<44))issues.push(`${name}: founder contract geometry is unsafe ${JSON.stringify(founderGeometry)}`);
    await page.selectOption('#founderMode', 'sandbox');
    await page.locator('#founderForm button[type="submit"]').click();
    await page.locator('#founderFlow').waitFor({state:'hidden',timeout:10000});
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
  const offlineMapEvidence=await landscape.page.evaluate(()=>({
    offline:document.querySelector('.map-stage')?.classList.contains('map-tiles-offline')||false,
    localTileFallbacks:[...document.querySelectorAll('.leaflet-tile-pane img')].map(img=>img.getAttribute('src')||'').filter(src=>/assets\/images\//.test(src)),
    fallbackBoundTiles:document.querySelectorAll('.leaflet-tile-pane img[data-gh-image-bound]').length
  }));
  if(!offlineMapEvidence.offline||offlineMapEvidence.localTileFallbacks.length||offlineMapEvidence.fallbackBoundTiles)issues.push(`landscape: offline basemap recovery is unsafe ${JSON.stringify(offlineMapEvidence)}`);
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

  // BUILD306: logistics, energy and banking must all use the same visible
  // company-facility -> global-directory -> domain-command workflow.
  for(const config of [{type:'road',funding:10000000,kind:'logistics'},{type:'power',funding:50000000,kind:'power'},{type:'bank',funding:10000000,kind:'bank'}]){
    await clickVisible(landscape.page,'[data-panel="companies"]');await landscape.page.click('[data-companytab="subs"]');
    const openButton=landscape.page.locator(`.open-company[data-type="${config.type}"]`);if(await openButton.count())await openButton.click();
    if(config.funding)await landscape.page.evaluate(({type,funding})=>GH_FINANCE_CORE.execute({state:__GH_STATE__},'transfer',{from:'group',to:type,amount:funding,note:'BUILD306 browser facility funding'}),config);
    await clickVisible(landscape.page,'[data-panel="companies"]');await landscape.page.click('[data-companytab="subs"]');await landscape.page.click(`[data-open="companyManage"][data-arg="${config.type}"]`);await landscape.page.click(`[data-open="companyFacilities"][data-arg="${config.type}"]`);
    const directoryAction=landscape.page.locator(`.open-facility-directory[data-kind="${config.type}"]`);if(!await directoryAction.count()){issues.push(`landscape: ${config.type} company has no unified facility-directory action`);continue;}await directoryAction.click();
    await landscape.page.fill('#worldSearch','RUH');await landscape.page.waitForTimeout(350);const site=landscape.page.locator(`.open-directory-site[data-key="site:${config.type}:RUH"]`);if(!await site.count()){issues.push(`landscape: ${config.type} directory did not expose the RUH site`);continue;}await site.click();await landscape.page.waitForTimeout(250);
    const opened=await landscape.page.evaluate(({type,kind})=>__GH_STATE__.customHubs.some(row=>row.owned&&row.company===type&&row.kind===kind&&row.capitalId==='RUH'),config);if(!opened)issues.push(`landscape: ${config.type} facility did not open through the unified directory workflow`);
    if(await landscape.page.locator('#drawerClose').isVisible())await landscape.page.click('#drawerClose');
  }

  // BUILD301: the owned-assets register contains owned objects only. The
  // purchase catalog is a single separate entry point rather than a duplicate
  // catalog embedded in the register.
  await openHubChild(landscape.page, 'control', 'assets');
  if(await landscape.page.locator('.owned-asset-row').count()!==0||!await landscape.page.locator('[data-open="assetMarket"]').count())issues.push('landscape: owned-assets register is not zero-state/single-entry');

  await landscape.page.screenshot({path: 'tests/screenshots/iphone-landscape-assets.png'});
  await landscape.page.click('#drawerClose');await openHubChild(landscape.page,'control','assetMarket');
  if(await landscape.page.locator('.asset-market-card').count()<10||!await landscape.page.locator('.manual-buy-asset').count()||await landscape.page.locator('#assetRequestQty').count()||await landscape.page.locator('[data-gh-action="asset-portfolio-build"]').count())issues.push('landscape: manual asset purchase UI is not exclusive');
  await landscape.page.screenshot({path:'tests/screenshots/iphone-landscape-ai-assets.png'});
  await landscape.page.click('#drawerClose');await clickVisible(landscape.page,'[data-panel="companies"]');await landscape.page.click('[data-companytab="subs"]');
  if(!await landscape.page.locator('.open-company[data-type="mobility"]').count())issues.push('landscape: GH Mobility company card missing');
  else{
    await landscape.page.click('.open-company[data-type="mobility"]');await landscape.page.waitForTimeout(300);
    const opened=await landscape.page.evaluate(()=>__GH_STATE__.openedCompanies.includes('mobility'));
    if(!opened)issues.push('landscape: GH Mobility company did not open through its visible UI control');
    else{
      // A new company must remain physically empty until the player buys its
      // center and vehicle through their visible, singular UI flows.
      const zero=await landscape.page.evaluate(()=>({snapshot:GH_MOBILITY_CORE.snapshot(__GH_STATE__),centers:__GH_STATE__.customHubs.filter(x=>x.company==='mobility'&&x.owned).length}));
      if(zero.snapshot.vehicles!==0||zero.snapshot.drivers!==0||zero.centers!==0)issues.push(`landscape: Mobility did not start at zero ${JSON.stringify(zero)}`);
      await clickVisible(landscape.page,'[data-panel="companies"]');await landscape.page.click('[data-companytab="subs"]');
      await landscape.page.click('[data-open="companyManage"][data-arg="mobility"]');
      await landscape.page.click('[data-open="companyFacilities"][data-arg="mobility"]');
      await clickVisible(landscape.page,'.mobility-open-capital-center');
      await landscape.page.evaluate(()=>GH_FINANCE_CORE.execute({state:__GH_STATE__},'transfer',{from:'group',to:'mobility',amount:10000000,note:'Browser QA funding'}));
      await clickVisible(landscape.page,'[data-panel="companies"]');await landscape.page.click('[data-companytab="subs"]');
      await landscape.page.click('[data-open="companyManage"][data-arg="mobility"]');await landscape.page.click('[data-company-manage-tab="assets"]');
      await landscape.page.click('[data-open="assetMarket"][data-arg="mobility"]');await clickVisible(landscape.page,'.manual-buy-mobility');
      const mobility=await landscape.page.evaluate(()=>GH_MOBILITY_CORE.snapshot(__GH_STATE__));
      if(mobility.status!=='active'||mobility.vehicles!==1||mobility.drivers!==1||mobility.monthlyPayroll!==6000)issues.push(`landscape: purchased Mobility asset/staffing incomplete ${JSON.stringify(mobility)}`);
    }
  }
  await landscape.page.click('#drawerClose');await landscape.page.evaluate(()=>document.querySelector('.filter-btn[data-filter="mobility"]')?.click());
  await landscape.page.waitForTimeout(120);
  const mobilityEvidence=await landscape.page.evaluate(()=>{const marker=document.querySelector('.asset-marker.mobility'),dot=marker?.querySelector('.mobility-street-dot'),markerRect=marker?.getBoundingClientRect(),dotRect=dot?.getBoundingClientRect();return{snapshot:GH_MOBILITY_CORE.snapshot(__GH_STATE__),live:GH_MOBILITY_CORE.liveVehicles(__GH_STATE__).filter(x=>x.phase==='moving').length,mapMarkers:document.querySelectorAll('.asset-marker.mobility').length,markerSize:markerRect?{width:markerRect.width,height:markerRect.height}:null,dotSize:dotRect?{width:dotRect.width,height:dotRect.height}:null};});
  if(mobilityEvidence.snapshot.status==='active'&&!mobilityEvidence.mapMarkers)issues.push(`landscape: GH Mobility is not connected to live map ${JSON.stringify(mobilityEvidence)}`);
  if(mobilityEvidence.mapMarkers&&(!mobilityEvidence.markerSize||mobilityEvidence.markerSize.width<40||mobilityEvidence.markerSize.height<40||!mobilityEvidence.dotSize||mobilityEvidence.dotSize.width<12||mobilityEvidence.dotSize.height<12))issues.push(`landscape: GH Mobility marker is not visibly/touchably usable ${JSON.stringify(mobilityEvidence)}`);
  if(mobilityEvidence.live>0){
    await landscape.page.click('#speedToggle');await landscape.page.click('#speedMenu [data-speed="600"]');await landscape.page.click('#speedToggle');
    const motionEvidence=await landscape.page.evaluate(async()=>{const points=[],simStart=__GH_STATE__.simSeconds,start=performance.now();while(performance.now()-start<900){await new Promise(resolve=>requestAnimationFrame(resolve));const marker=document.querySelector('.asset-marker.mobility.is-moving');if(!marker)break;const box=marker.getBoundingClientRect();points.push([box.left+box.width/2,box.top+box.height/2]);}const deltas=points.slice(1).map((point,index)=>Math.hypot(point[0]-points[index][0],point[1]-points[index][1])),active=deltas.filter(delta=>delta>.05),distance=deltas.reduce((sum,delta)=>sum+delta,0);return{frames:points.length,activeFrames:active.length,distance,maxJump:Math.max(0,...deltas),unique:new Set(points.map(point=>`${point[0].toFixed(2)}:${point[1].toFixed(2)}`)).size,simDelta:__GH_STATE__.simSeconds-simStart};});
    await landscape.page.click('#speedToggle');await landscape.page.click('#speedMenu [data-speed="0"]');await landscape.page.click('#speedToggle');
    if(motionEvidence.simDelta<=0)issues.push(`landscape: motion QA did not advance simulation ${JSON.stringify(motionEvidence)}`);
    if(motionEvidence.distance>2&&(motionEvidence.unique<5||motionEvidence.activeFrames<4||motionEvidence.maxJump>Math.max(5,motionEvidence.distance*.72)))issues.push(`landscape: Mobility presentation motion still jumps between sparse targets ${JSON.stringify(motionEvidence)}`);
  }
  await landscape.page.screenshot({path:'tests/screenshots/iphone-landscape-mobility.png'});
  await landscape.context.tracing.stop({path:'tests/screenshots/navigation-landscape-trace.zip'});await landscape.context.close();

  const portrait = await openAt('portrait', {width: 390, height: 844});
  await portrait.page.screenshot({path: 'tests/screenshots/iphone-portrait-map.png'});
  const portraitBrandGeometry=await portrait.page.evaluate(()=>{const topbar=document.querySelector('.topbar').getBoundingClientRect(),brand=document.querySelector('.topbar .brand').getBoundingClientRect(),name=document.querySelector('#groupName').getBoundingClientRect();return{viewport:window.innerWidth,topbar:{left:topbar.left,right:topbar.right},brand:{left:brand.left,right:brand.right},name:{left:name.left,right:name.right}};});
  if(portraitBrandGeometry.brand.left<portraitBrandGeometry.topbar.left-.5||portraitBrandGeometry.brand.right>portraitBrandGeometry.topbar.right+.5||portraitBrandGeometry.name.left<portraitBrandGeometry.topbar.left-.5||portraitBrandGeometry.name.right>portraitBrandGeometry.topbar.right+.5)issues.push(`portrait: group brand escapes topbar ${JSON.stringify(portraitBrandGeometry)}`);

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
      .filter(img => !img.classList.contains('leaflet-tile') && img.complete && img.naturalWidth === 0)
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
