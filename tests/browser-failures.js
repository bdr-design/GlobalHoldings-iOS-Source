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
 await run('CDN outage retains founding and finance access',{offline:true},async page=>{await page.locator('#founderForm').waitFor({state:'visible'});await page.click('#skipFounder');await page.locator('[data-panel="finance"]').first().click();assert(await page.locator('#companyTransferFrom').isVisible());assert.strictEqual(await page.evaluate(()=>__GH_STATE__.cash),50000000);});
 await run('Quota failure rolls founding back and allows a clean retry',{},async page=>{
  const before=await page.evaluate(()=>localStorage.getItem('global-holdings-world-v2.0.0'));
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(k,v){if(k==='global-holdings-world-v2.0.0')throw new DOMException('Injected quota','QuotaExceededError');return original.call(this,k,v);};});
  await page.click('#skipFounder');await page.locator('#founderError').waitFor({state:'visible'});assert.strictEqual(await page.evaluate(()=>__GH_STATE__.cash),0);assert.strictEqual(await page.evaluate(()=>__GH_STATE__.onboardingComplete),false);assert.strictEqual(await page.evaluate(()=>localStorage.getItem('global-holdings-world-v2.0.0')),before);
  await page.evaluate(()=>window.restoreStorage());await page.click('#skipFounder');assert.strictEqual(await page.evaluate(()=>__GH_STATE__.cash),50000000);assert.strictEqual(await page.evaluate(()=>__GH_STATE__.finance.journalEntries.length),1);
 });
 }finally{await browser.close();await server.close();}
 fs.mkdirSync('.ci-output/ci',{recursive:true});const report={suite:'browser-failures',browser:process.env.GH_BROWSER||'chromium',results};fs.writeFileSync('.ci-output/ci/browser-failures-'+report.browser+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
