'use strict';
const assert=require('assert'),fs=require('fs');const {chromium,webkit}=require('playwright');
const {serve}=require('./helpers/web-server'),{installMapFixture}=require('./helpers/browser-network');
(async()=>{
 const server=await serve(),browser=await(process.env.GH_BROWSER==='webkit'?webkit:chromium).launch({headless:true}),results=[];
 async function run(name,options,body){const ctx=await browser.newContext({viewport:{width:844,height:390}}),page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{await installMapFixture(page);if(options?.init)await page.addInitScript(options.init,options.data);if(options?.offline)await page.route('https://unpkg.com/**',r=>r.abort('failed'));await page.goto(server.baseURL,{waitUntil:'domcontentloaded'});await body(page);assert.deepStrictEqual(errors,[]);results.push({name,passed:true});console.log('PASS '+name);}finally{await ctx.close();}}
 try{
 for(const raw of ['{broken',JSON.stringify({saveVersion:'9.0.0',saveRevision:1,simSeconds:0,assets:[]})])await run(raw[0]==='{'&&raw.includes('broken')?'Malformed save is retained':'Future schema is retained',{init:raw=>localStorage.setItem('global-holdings-world-v2.0.0',raw),data:raw},async page=>{await page.locator('#saveRecovery').waitFor({state:'visible'});assert.strictEqual(await page.evaluate(()=>localStorage.getItem('global-holdings-world-v2.0.0')),raw);});
 await run('Old native bridge fails closed before state writes',{init:()=>{window.webkit={messageHandlers:{saveBridge:{postMessage(){}}}};}},async page=>{await page.locator('#saveRecovery').waitFor({state:'visible'});assert((await page.locator('#saveRecovery').innerText()).includes('Build251'));assert.strictEqual(await page.evaluate(()=>localStorage.getItem('global-holdings-world-v2.0.0')),null);});
 await run('CDN outage retains founding and finance access',{offline:true},async page=>{await page.locator('#founderForm').waitFor({state:'visible'});await page.click('#founderReview');await page.click('#founderSubmit');await page.locator('[data-panel="finance"]').first().click();assert(await page.locator('#companyTransferFrom').isVisible());assert.strictEqual(await page.evaluate(()=>__GH_STATE__.cash),50000000);});
 await run('Quota failure rolls founding back and allows a clean retry',{},async page=>{
  const before=await page.evaluate(()=>localStorage.getItem('global-holdings-world-v2.0.0'));
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(k,v){if(k==='global-holdings-world-v2.0.0')throw new DOMException('Injected quota','QuotaExceededError');return original.call(this,k,v);};});
  await page.click('#founderReview');await page.click('#founderSubmit');await page.locator('#founderError').waitFor({state:'visible'});assert.strictEqual(await page.evaluate(()=>__GH_STATE__.cash),0);assert.strictEqual(await page.evaluate(()=>__GH_STATE__.onboardingComplete),false);assert.strictEqual(await page.evaluate(()=>localStorage.getItem('global-holdings-world-v2.0.0')),before);
  await page.evaluate(()=>window.restoreStorage());await page.click('#founderSubmit');await page.waitForFunction(()=>__GH_STATE__.onboardingComplete);assert.strictEqual(await page.evaluate(()=>__GH_STATE__.cash),50000000);assert.strictEqual(await page.evaluate(()=>__GH_STATE__.finance.journalEntries.length),1);
 });
 await run('Corporate interest posts once through the real midnight close',{},async page=>{
  await page.click('#founderReview');await page.click('#founderSubmit');await page.locator('.game-frame').waitFor({state:'visible'});
  const setup=await page.evaluate(()=>{
   const state=__GH_STATE__,F=GH_FINANCE_CORE,B=GH_BANKING_CORE,D=GH_DOMAIN_COMMANDS;
   if(!state.openedCompanies.includes('bank'))state.openedCompanies.push('bank');
   if(!state.unlockedSectors.includes('bank'))state.unlockedSectors.push('bank');
   state.companyRegistry.bank={...(state.companyRegistry.bank||{}),legalName:'Midnight Test Bank'};
   F.ensure(state);F.book(state,'group').accounts[0].balance=100000000;F.book(state,'bank').accounts[0].balance=80000000;F.reconcile(state);
   const bank=B.ensure(state);bank.corporateClients.group.creditLimit=25000000;
   D.dispatch({state},'banking','draw-facility',{company:'group',amount:3650000,termDays:365,rate:.06},{actor:'browser-test'});
   state.simSeconds=86390;state.lastFinancialDay=0;state.lastMarketHour=23;state.speed=0;
   return {bankCash:F.operating(state,'bank'),groupCash:F.operating(state,'group'),groupDebt:F.book(state,'group').debt};
  });
  await page.evaluate(()=>document.querySelector('#speedMenu button[data-speed="4"]')?.click());
  await page.waitForFunction(()=>__GH_STATE__.lastFinancialDay>=1,null,{timeout:10000});
  await page.evaluate(()=>document.querySelector('#speedMenu button[data-speed="0"]')?.click());
  const closed=await page.evaluate(()=>{
   const state=__GH_STATE__,report=state.bank.dailyHistory.find(row=>row.day===1),companyClose=state.finance.dailyCompanyReports.find(row=>row.day===1)?.companies?.bank;
   const facility=state.bank.corporateFacilities[0],principalRef=`CF-PRINCIPAL-${facility.id}-1`,principalEntries=state.finance.journalEntries.filter(row=>row.sourceRef===principalRef);
   return {bankCash:GH_FINANCE_CORE.operating(state,'bank'),groupCash:GH_FINANCE_CORE.operating(state,'group'),groupDebt:GH_FINANCE_CORE.book(state,'group').debt,report,companyClose,principalEntries,interestDocuments:state.finance.invoices.filter(row=>String(row.sourceRef||'').startsWith('CF-INTEREST-')).map(row=>({company:row.company,kind:row.kind,amount:row.amount,sourceRef:row.sourceRef}))};
  });
  assert(closed.report&&closed.companyClose,'the real day boundary did not produce bank close evidence');
  const debtService=closed.report.corporatePrincipalRepaid+closed.report.corporateInterestIncome;
  assert(Math.abs(closed.bankCash-setup.bankCash-debtService)<1e-6,'real processFinancialDay credited corporate interest more than once');
  assert(Math.abs(setup.groupDebt-closed.groupDebt-closed.report.corporatePrincipalRepaid)<1e-6,'borrower debt did not fall by the exact principal payment');
  assert(setup.groupCash-closed.groupCash>=debtService,'borrower cash did not fund the full debt service');
  assert.strictEqual(closed.principalEntries.length,2,'principal transfer must create exactly one journal per participating company');
  assert(Math.abs(closed.companyClose.operatingRevenue-(closed.report.interestIncome+closed.report.securityIncome+closed.report.feeIncome))<1e-6,'bank P&L lost already-posted interest');
  assert.strictEqual(closed.interestDocuments.length,2,'interest settlement must have one borrower expense and one bank income document');
  assert.deepStrictEqual(closed.interestDocuments.map(row=>row.company).sort(),['bank','group']);
  assert(closed.interestDocuments.every(row=>Math.abs(row.amount-closed.report.corporateInterestIncome)<1e-6),'interest documents do not reconcile to the collected interest');
  assert.strictEqual(new Set(closed.interestDocuments.map(row=>row.sourceRef)).size,1,'interest documents do not share one authoritative reference');
 });
 }finally{await browser.close();await server.close();}
 fs.mkdirSync('.ci-output/ci',{recursive:true});const report={suite:'browser-failures',browser:process.env.GH_BROWSER||'chromium',results};fs.writeFileSync('.ci-output/ci/browser-failures-'+report.browser+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
