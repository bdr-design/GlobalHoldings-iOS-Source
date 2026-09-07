'use strict';
const assert=require('assert'),fs=require('fs');const {chromium,webkit}=require('playwright');
const {serve}=require('./helpers/web-server'),{installMapFixture,expectedNetworkError}=require('./helpers/browser-network');
(async()=>{
 const server=await serve(),engine=process.env.GH_BROWSER==='webkit'?webkit:chromium,browser=await engine.launch({headless:true});
 const context=await browser.newContext({viewport:{width:844,height:390},locale:'ar-SA'});await context.tracing.start({screenshots:true,snapshots:true});const page=await context.newPage();await installMapFixture(page);await page.clock.install({time:new Date('2026-09-06T00:00:00Z')});await page.clock.pauseAt(new Date('2026-09-06T00:00:01Z'));
 // A deterministic 10 fps browser schedule exercises low-frame-rate operation.
 // The game clock, domain owners and every simulation slice remain production code.
 await page.addInitScript(()=>{window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),100);window.cancelAnimationFrame=id=>clearTimeout(id);});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!expectedNetworkError(m))errors.push(m.text());});page.on('dialog',d=>d.accept());
 async function state(){return page.evaluate(()=>JSON.parse(JSON.stringify(window.__GH_STATE__)));}
 async function visible(selector){const choices=page.locator(selector);for(let i=0;i<await choices.count();i++)if(await choices.nth(i).isVisible())return choices.nth(i);throw new Error('No visible '+selector);}
 async function panel(name){if(await page.locator('#drawer').getAttribute('aria-hidden')==='false')await page.click('#drawerClose');await (await visible('[data-panel="'+name+'"]')).click();}
 async function control(name){await panel('control');await page.click('[data-open="'+name+'"]');}
 async function speed(n){if(await page.locator('#drawer').getAttribute('aria-hidden')==='false')await page.click('#drawerClose');await page.click('#speedToggle');await page.click('#speedMenu [data-speed="'+n+'"]');await page.click('#speedToggle');}
 const evidence={};const steps=[];function record(s){steps.push(s);console.log('E2E '+s);}
 try{
 await page.goto(server.baseURL,{waitUntil:'domcontentloaded'});
 await page.selectOption('#founderMode','sandbox');await page.locator('#founderForm button[type="submit"]').click();
 let current=await state();assert(current.onboardingComplete);assert.strictEqual(current.cash,1000000000);assert.strictEqual(current.assets.length,0);assert(current.crew.every(c=>c.count===0));record('1–2 New Group and exact capital');
 await (await visible('[data-panel="companies"]')).click();await page.click('[data-companytab="subs"]');await page.locator('button.open-company[data-type="air"]').click();
 current=await state();assert(current.openedCompanies.includes('air'));record('3 Open company');
 const initialAir=current.companyFinance.air.accounts[0].balance;await panel('finance');await page.selectOption('#companyTransferFrom','group');await page.selectOption('#companyTransferTo','air');await page.fill('#companyTransferAmount','400000000');await page.click('.company-transfer-submit');current=await state();assert.strictEqual(current.companyFinance.air.accounts[0].balance,initialAir+400000000);record('4 Fund company through Finance UI');
 await page.click('#drawerClose');await page.click('#worldDirectoryBtn');await page.fill('#worldSearch','RUH');await page.clock.runFor(300);await page.locator('.open-global-base[data-key="air:OERK"]').click();
 current=await state();assert.strictEqual(current.globalBases.length,1);const baseId=current.globalBases[0].id;assert.strictEqual(current.globalBases[0].company,'air');record('5 Create base through directory UI');
 await control('procurement');const beforeOrder=(await state()).cash;
 await page.click('[data-gh-action="asset-portfolio-build"]');current=await state();const plan=current.advanced.procurement.assetPortfolioPlans[0];assert(plan);assert(plan.summary.assetCount>=12);assert(plan.summary.models>=4);assert.strictEqual(plan.status,'awaiting_authorization');assert.strictEqual(current.cash,beforeOrder);assert(!await page.locator('#assetRequestQty').count());record('6–7 AI builds a large diverse market-and-center portfolio without debit');
 await page.click('[data-gh-action="asset-portfolio-authorize"][data-plan="'+plan.id+'"]');await page.waitForFunction(id=>window.__GH_STATE__.advanced.procurement.assetPortfolioArchive.some(x=>x.id===id&&x.status==='completed'),plan.id,{timeout:30000});current=await state();const completed=current.advanced.procurement.assetPortfolioArchive.find(x=>x.id===plan.id),portfolioAssets=current.assets.filter(a=>completed.execution.assetIds.includes(a.id)),orders=current.realism.procurement.deliveries.filter(d=>completed.execution.assetIds.includes(d.asset.id));assert.strictEqual(portfolioAssets.length,plan.summary.assetCount);assert.strictEqual(new Set(portfolioAssets.map(a=>a.id)).size,portfolioAssets.length);assert(orders.every(d=>d.status==='delivered'&&d.baseId===baseId&&d.payment.ref&&d.expeditedBy==='approved-ai-portfolio'));assert(portfolioAssets.every(a=>a.routeId&&a.phase==='moving'));assert(current.crew.some(c=>c.count>0));assert(current.cash<beforeOrder);assert.strictEqual(current.advanced.procurement.assetRequests.length,0);record('8–17 One approval atomically funds, receives, staffs, routes and departs every asset');
 const asset=portfolioAssets.slice().sort((a,b)=>(a.tripSeconds||Infinity)-(b.tripSeconds||Infinity))[0],duration=asset.tripSeconds;assert(duration>0);console.log('TRIP_SECONDS',duration);await page.click('#drawerClose');await speed(4);
 // Advance below the production three-second stall guard so no interval is
 // intentionally discarded as a background/suspended browser clock jump.
 const simStart=current.simSeconds,targetSim=simStart+duration+1;
 let safeClockSteps=0;
 while(safeClockSteps<900&&await page.evaluate(target=>__GH_STATE__.simSeconds<target,targetSim)){await page.clock.runFor(2500);safeClockSteps++;}
 const simAfterTrip=(await state()).simSeconds;console.log('SIM_TRIP_WINDOW',JSON.stringify({simStart,targetSim,simAfterTrip,safeClockSteps}));
 assert(simAfterTrip>=targetSim,'simulation time did not cover the selected trip within the protected clock-step ceiling');
 await speed(0);current=await state();assert(current.tripRevenueAccrued.air>0);assert(current.tripFuelAccrued.air>0);assert(current.tripMaintenanceAccrued.air>0);assert(current.assets.find(a=>a.id===asset.id).lastTrip.revenue>0);record('18 Actual simulated trip produces income and operating expenses');
 await panel('systemHub');await page.locator('[data-open="settings"]').first().click();await page.click('[data-gh-action="save-slot"][data-slot="0"]');
 const health=await page.evaluate(()=>({integrity:GH_INTEGRITY_CORE.check(__GH_STATE__),critical:__GH_STATE__.controlPlane.incidents.filter(i=>i.severity==='critical'&&i.status!=='resolved')}));assert.strictEqual(health.integrity.counts.critical,0,JSON.stringify(health.integrity));assert.strictEqual(health.critical.length,0,JSON.stringify(health.critical));evidence.health=health;
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('global-holdings-world-v2.0.0')));assert(saved.assets.length===plan.summary.assetCount);evidence.cash=saved.cash;evidence.simSeconds=saved.simSeconds;evidence.assetCount=saved.assets.length;evidence.deliveryCount=saved.realism.procurement.deliveries.length;evidence.routeCount=saved.customRoutes.length;evidence.journalBalanced=saved.finance.journalEntries.every(j=>Math.abs(j.lines.reduce((n,l)=>n+l.debit-l.credit,0))<.02);assert(evidence.journalBalanced);record('19 Save and verified persisted business state');
 await page.reload({waitUntil:'domcontentloaded'});current=await state();
 for(const key of ['cash','debt','simSeconds','assets','crew','globalBases','companyFinance','tripRevenueAccrued','tripFuelAccrued'])assert.deepStrictEqual(current[key],saved[key],'Reload mismatch: '+key);
 assert.strictEqual(current.advanced.procurement.assetRequestArchive.length,saved.advanced.procurement.assetRequestArchive.length);record('20 Reload preserves funds, assets, crew, requests and operating results');
 await panel('systemHub');await page.locator('[data-open="settings"]').first().click();await page.click('.new-game-direct');await page.locator('#founderForm').waitFor({state:'visible'});current=await state();
 assert.strictEqual(current.cash,0);assert.strictEqual(current.debt,0);assert.strictEqual(current.groupValue,0);for(const k of ['assets','globalBases','customRoutes','openedCompanies','ownedCompanies','hired'])assert.strictEqual(current[k].length,0,k);assert(current.crew.every(c=>c.count===0));assert.strictEqual(current.finance.journalEntries.length,0);assert.strictEqual(current.advanced.procurement.assetRequests.length,0);assert.strictEqual(current.onboardingComplete,false);assert.strictEqual(current.saveVersion,'2.0.0');record('21 Reset returns to verified pristine state');
 assert.deepStrictEqual(errors,[]);record('No unexpected browser errors');
 }finally{fs.mkdirSync('tests/screenshots',{recursive:true});await page.screenshot({path:'tests/screenshots/e2e-'+(process.env.GH_BROWSER||'chromium')+'-last.png'});await context.tracing.stop({path:'tests/screenshots/e2e-'+(process.env.GH_BROWSER||'chromium')+'-trace.zip'});await browser.close();await server.close();}
 const report={suite:'browser-lifecycle',browser:process.env.GH_BROWSER||'chromium',browserVersion:browser.version(),steps,evidence};fs.mkdirSync('.ci-output/ci',{recursive:true});fs.writeFileSync('.ci-output/ci/browser-lifecycle-'+report.browser+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
