'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {serve}=require('./helpers/web-server'),{drawFounderSignature}=require('./helpers/signature-input');
const out=process.env.GH_R4_BROWSER_OUT||path.resolve(__dirname,'../verification/r4-recovery');fs.mkdirSync(out,{recursive:true});
(async()=>{const server=await serve(path.resolve(__dirname,'../WebApp')),browser=await chromium.launch({headless:true}),results=[];
try{for(const viewport of [{width:844,height:390},{width:390,height:844}]){
 const context=await browser.newContext({viewport,deviceScaleFactor:2,hasTouch:true,locale:'ar-SA'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(15000);await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,r=>r.abort());
 await page.goto(server.baseURL);await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);
 await page.evaluate(()=>{__GH_STATE__.speed=0;window.__r4BridgeSends=0;window.webkit={messageHandlers:{saveBridge:{postMessage(){__r4BridgeSends++;}},diagnosticBridge:{postMessage(){window.__r4Exported=true;}}}};GH_PERSISTENCE.markRecoveryRequired('Injected native ACK timeout — preserve save');});
 const dialog=page.locator('#nativeSaveReconcile');await dialog.waitFor({state:'visible'});assert.equal(await dialog.getAttribute('role'),'alertdialog');assert.equal(await page.evaluate(()=>GH_PERSISTENCE.isLocked()),true);assert.equal(await page.evaluate(()=>__GH_STATE__.speed),0);
 const stateBefore=await page.evaluate(()=>JSON.stringify(__GH_STATE__));const url=page.url();await page.waitForTimeout(900);assert.equal(page.url(),url);assert.equal(await page.locator('#nativeSaveReconcile').count(),1);assert.equal(await page.evaluate(()=>JSON.stringify(__GH_STATE__)),stateBefore,'locked runtime must not mutate during recovery UI');
 assert((await page.locator('#nativeSaveReconcileReason').innerText()).includes('Injected native ACK timeout'));
 const retry=await page.locator('#nativeSaveReconcileRetry').boundingBox(),exportButton=await page.locator('#nativeSaveReconcileExport').boundingBox();for(const rect of [retry,exportButton])assert(rect&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=viewport.width+1&&rect.y+rect.height<=viewport.height+1,'recovery controls must fit viewport');
 await page.locator('#nativeSaveReconcileExport').click();await page.waitForFunction(()=>window.__r4Exported===true);assert.equal(await page.evaluate(()=>__r4BridgeSends),0,'diagnostic export must not request a new save');
 await page.screenshot({path:path.join(out,`recovery-${viewport.width}.png`)});
 await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('#nativeSaveReconcileRetry').click()]);await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);assert.equal(await page.locator('#nativeSaveReconcile').count(),0);
 assert.deepEqual(errors,[]);results.push({viewport,manualRetry:true,noAutoReload:true,locked:true,exportWithoutSave:true,errors});await context.close();
}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,scope:'Actual Chromium DOM and recovery owner, injected failure; browser localStorage, not native iPhone recovery'},null,2));console.log(JSON.stringify({passed:results.length,total:2,results},null,2));}finally{await browser.close();await server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
