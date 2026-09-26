'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {serve}=require('./helpers/web-server');
const {drawFounderSignature}=require('./helpers/signature-input');
const out=path.resolve(__dirname,'../verification');
(async()=>{
 const server=await serve(path.resolve(__dirname,'../WebApp')),browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:844,height:390}}),errors=[],results=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
 try{
  await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,r=>r.abort());
  await page.goto(server.baseURL);await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);
  if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.click('#speedToggle');
  const before=await page.evaluate(()=>({time:__GH_STATE__.simSeconds,owners:[...__GH_STATE__.openedCompanies],books:Object.keys(__GH_STATE__.companyFinance)}));
  assert.equal(before.time,0);assert.deepEqual(before.owners,[]);
  await page.click('#simCalendarToggle');await page.click('#simNextDay');
  await page.waitForFunction(()=>__GH_STATE__.simSeconds>=86400||Boolean(GH_SIM_KERNEL.snapshot().lastError));
  const after=await page.evaluate(()=>({time:__GH_STATE__.simSeconds,day:__GH_STATE__.lastFinancialDay,hour:__GH_STATE__.lastMarketHour,kernel:GH_SIM_KERNEL.snapshot(),owners:[...__GH_STATE__.openedCompanies],books:Object.keys(__GH_STATE__.companyFinance)}));
  results.push({case:'unfounded-group-real-next-day',before,after});
  assert.equal(after.time,86400,`calendar must finish an actual day without phantom companies: ${after.kernel.lastError}`);
  assert.equal(after.day,1);assert.equal(after.hour,24);assert.equal(after.kernel.manualAdvance,null);assert.equal(after.kernel.lastError,'');assert.deepEqual(after.owners,before.owners);assert.deepEqual(after.books,before.books);assert.deepEqual(errors,[]);
  console.log('PASS actual calendar next day with no bank, no energy, no phantom books');
 }finally{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'334-calendar-advance-results.json'),JSON.stringify({results,errors},null,2));await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
