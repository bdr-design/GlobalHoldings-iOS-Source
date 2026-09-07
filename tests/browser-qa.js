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
