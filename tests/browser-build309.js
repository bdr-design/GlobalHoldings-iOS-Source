'use strict';
const assert=require('assert'),fs=require('fs');
const {chromium,webkit}=require('playwright');
const {serve}=require('./helpers/web-server'),{installMapFixture,expectedNetworkError}=require('./helpers/browser-network');

(async()=>{
  // Use the full Chromium renderer in its current headless mode, as documented at
  // https://playwright.dev/docs/browsers#chromium-new-headless-mode.
  const engine=process.env.GH_BROWSER||'chromium',browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{channel:'chromium'}:{})}),server=await serve(),context=await browser.newContext({viewport:{width:1112,height:512},locale:'ar-SA'}),page=await context.newPage(),errors=[];
  await page.addInitScript(()=>{window.__build309LongTasks=[];if(globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask'))new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__build309LongTasks.push({start:entry.startTime,duration:entry.duration});window.__build309LongTasks=window.__build309LongTasks.slice(-100);}).observe({entryTypes:['longtask']});});
  await installMapFixture(page);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!expectedNetworkError(message))errors.push(message.text());});page.on('dialog',dialog=>dialog.accept());
  const state=()=>page.evaluate(()=>JSON.parse(JSON.stringify(window.__GH_STATE__)));
  const sampleFrames=()=>page.evaluate(()=>new Promise(resolve=>{const rows=[];let previous=performance.now();const tick=now=>{rows.push(now-previous);previous=now;if(rows.length===60)resolve(rows);else requestAnimationFrame(tick);};requestAnimationFrame(tick);}));
  const percentile95=rows=>[...rows].sort((a,b)=>a-b)[Math.floor(rows.length*.95)];
  const visible=async selector=>{const rows=page.locator(selector);for(let index=0;index<await rows.count();index++)if(await rows.nth(index).isVisible())return rows.nth(index);throw new Error('No visible '+selector);};
  const close=async()=>{if(await page.locator('#drawer').getAttribute('aria-hidden')==='false')await page.click('#drawerClose');};
  const panel=async name=>{await close();await (await visible(`[data-panel="${name}"]`)).click();};
  const openCompany=async type=>{await panel('companies');await page.click('[data-companytab="subs"]');await page.locator(`button.open-company[data-type="${type}"]`).click();};
  const openSite=async(kind,query,key)=>{await close();await page.click('#worldDirectoryBtn');await page.locator(`[data-world-company="${kind}"]`).click();await page.fill('#worldSearch',query);await page.waitForTimeout(350);const button=page.locator(`.open-directory-site[data-key="${key}"]`);await button.waitFor({state:'visible'});await button.click();await page.waitForTimeout(250);};
  try{
    const blankFrameDeltas=await sampleFrames();
    await page.goto(server.baseURL,{waitUntil:'domcontentloaded'});await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await page.locator('#founderForm button[type="submit"]').click();await page.waitForFunction(()=>__GH_STATE__.onboardingComplete);
    const baselineFrameDeltas=await sampleFrames();
    for(const type of ['road','power','bank','mobility'])await openCompany(type);
    await openSite('road','أبوظبي','site:road:AUH');await openSite('road','برلين','site:road:BER');await openSite('power','برلين','site:power:BER');await openSite('bank','لندن','site:bank:LON');await openSite('mobility','سنغافورة','site:mobility:SIN');
    let current=await state();for(const [company,capitalId] of [['road','AUH'],['power','BER'],['bank','LON'],['mobility','SIN']])assert(current.customHubs.some(row=>row.company===company&&row.capitalId===capitalId&&row.owned===true),`${company} outside-Riyadh facility missing`);
    await panel('control');await page.click('[data-open="assetMarket"]');await page.click('[data-markettype="road"]');const card=(await visible('.manual-buy-asset[data-type="road"]')).locator('xpath=ancestor::article[contains(@class,"asset-market-card")]'),before=current.companyFinance.road.accounts[0].balance,groupBefore=current.companyFinance.group.accounts[0].balance;await card.locator('.manual-asset-qty').fill('200');await card.locator('.manual-buy-asset').click();await page.waitForTimeout(1200);current=await state();
    const trucks=current.assets.filter(row=>row.type==='road'),roadHubs=current.customHubs.filter(hub=>hub.company==='road'&&['AUH','BER'].includes(hub.capitalId)),hubLoads=roadHubs.map(hub=>trucks.filter(row=>row.baseFacility===hub.id).length).sort((a,b)=>b-a),purchaseCheques=current.finance.cheques.filter(row=>row.company==='road'&&row.status==='مصروف'&&String(row.note||'').includes('شراء'));if(trucks.length!==200)console.error(JSON.stringify({browserErrors:errors,alerts:current.alerts?.slice(0,5),deliveries:current.realism?.procurement?.deliveries?.length,roadBalance:current.companyFinance.road.accounts[0].balance,before,hubLoads},null,2));assert.strictEqual(trucks.length,200);assert.deepStrictEqual(hubLoads,[140,60]);assert(trucks.every(row=>row.staffing?.ready===true&&row.staffing.total===3));assert.strictEqual(purchaseCheques.length,2);const purchasePaid=purchaseCheques.reduce((sum,row)=>sum+Number(row.amount),0);assert.strictEqual(groupBefore-current.companyFinance.group.accounts[0].balance,purchasePaid);assert.strictEqual(current.companyFinance.road.accounts[0].balance,before);
    const frameDeltas=await sampleFrames(),p95=percentile95(frameDeltas),runtime=await page.evaluate(()=>({visibility:document.visibilityState,simulation:window.GH_SIM_KERNEL.snapshot(),longTasks:window.__build309LongTasks}));
    const report={engine,facilities:current.customHubs.filter(row=>['AUH','BER','LON','SIN'].includes(row.capitalId)).map(row=>({company:row.company,capitalId:row.capitalId})),trucks:trucks.length,hubLoads,roadHeadcount:trucks.reduce((sum,row)=>sum+row.staffing.total,0),roadBalance:current.companyFinance.road.accounts[0].balance,frameP95Ms:p95,blankP95Ms:percentile95(blankFrameDeltas),baselineP95Ms:percentile95(baselineFrameDeltas),blankFrameDeltas,baselineFrameDeltas,frameDeltas,runtime};
    fs.mkdirSync('.ci-output/ci',{recursive:true});fs.writeFileSync(`.ci-output/ci/browser-build309-${engine}.json`,JSON.stringify(report,null,2));
    if(p95>=80)console.error(JSON.stringify(report));assert(p95<80,`render p95 ${p95.toFixed(1)}ms exceeds budget`);
    assert.deepStrictEqual(errors,[]);console.log(`BUILD309 browser ${engine} regression: PASS (render p95 ${p95.toFixed(1)}ms)`);
  }finally{fs.mkdirSync('tests/screenshots',{recursive:true});await page.screenshot({path:`tests/screenshots/build309-${engine}-last.png`});await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
