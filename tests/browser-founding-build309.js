'use strict';
const assert=require('assert'),fs=require('fs');
const {chromium,webkit}=require('playwright');
const {serve}=require('./helpers/web-server'),{installMapFixture,expectedNetworkError}=require('./helpers/browser-network');
(async()=>{
 const engine=process.env.GH_BROWSER||'chromium',server=await serve(),browser=await(engine==='webkit'?webkit:chromium).launch({headless:true}),results=[];
 async function pageFor(viewport){const page=await browser.newPage({viewport,locale:'ar-SA'});await installMapFixture(page);page.errors=[];page.on('pageerror',e=>page.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!expectedNetworkError(m))page.errors.push(m.text());});await page.goto(server.baseURL,{waitUntil:'domcontentloaded'});return page;}
 const state=page=>page.evaluate(()=>JSON.parse(JSON.stringify(__GH_STATE__)));
 try{
  for(const viewport of [{width:320,height:740},{width:390,height:844},{width:844,height:390}]){
   const page=await pageFor(viewport);try{
    assert.strictEqual(await page.locator('#skipFounder,.founder-visual,#founderCurrency,#founderSector,#founderRisk').count(),0);
    const before=await state(page);await page.fill('#founderName','  مجموعة العساف  ');await page.selectOption('#founderLocation','LON');await page.selectOption('#founderMode','investor');
    await page.click('#founderReview');assert((await page.locator('#founderContractPreview').innerText()).includes('250,000,000 USD'));assert((await page.locator('#founderContractPreview').innerText()).includes('لندن · المملكة المتحدة'));
    const reviewed=await state(page);assert.strictEqual(reviewed.cash,before.cash);assert.strictEqual(reviewed.onboardingComplete,false);assert.deepStrictEqual(reviewed.companyRegistry,before.companyRegistry);
    await page.click('#founderBack');assert.strictEqual(await page.inputValue('#founderName'),'  مجموعة العساف  ');await page.fill('#founderName',' ');await page.click('#founderReview');assert(await page.locator('#founderError').isVisible());assert.strictEqual((await state(page)).onboardingComplete,false);
    await page.fill('#founderName','مجموعة العساف');await page.locator('.incorporation-customize summary').click();await page.fill('#founderShort','asaf');await page.fill('#founderEnglishName','Al Assaf Holdings');await page.click('.inc-logo-option[data-logo-style="gold"]');
    await page.setInputFiles('#founderLogoUpload','WebApp/assets/images/map-mobility-sedan-topdown.webp');await page.waitForFunction(()=>document.querySelector('#founderLogoStatus').textContent==='الشعار جاهز');
    await page.click('#founderReview');const overflow=await page.evaluate(()=>{const flow=document.querySelector('#founderFlow'),paper=document.querySelector('.formation-paper');return {flow:flow.scrollWidth-flow.clientWidth,paper:paper.scrollWidth-paper.clientWidth};});assert(overflow.flow<=1&&overflow.paper<=1,JSON.stringify({viewport,overflow}));
    await page.click('#founderSubmit');await page.waitForFunction(()=>__GH_STATE__.onboardingComplete);const saved=await state(page),document=saved.companyRegistry.group.formationDocument;
    assert.strictEqual(saved.cash,250000000);assert.strictEqual(saved.profile.name,'مجموعة العساف');assert.strictEqual(saved.profile.shortName,'ASAF');assert.strictEqual(document.name,'مجموعة العساف');assert.strictEqual(document.city,'لندن');assert.strictEqual(document.capital,250000000);assert(saved.profile.logo.startsWith('data:image/'));assert.strictEqual(saved.finance.journalEntries.length,1);assert.strictEqual(saved.profile.mode,'investor');assert.strictEqual(saved.infiniteMoney,false);assert.strictEqual(saved.assets.length,0);assert.strictEqual(saved.openedCompanies.length,0);
    await page.evaluate(()=>document.querySelector('#founderForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));assert.strictEqual((await state(page)).finance.journalEntries.length,1);
    await page.reload();await page.waitForFunction(()=>__GH_STATE__.onboardingComplete);assert.deepStrictEqual((await state(page)).companyRegistry.group.formationDocument,document);assert(await page.locator('#founderFlow').isHidden());assert.deepStrictEqual(page.errors,[]);results.push({viewport,capital:saved.cash,contractId:document.id,overflow});
   }finally{await page.close();}
  }
  const page=await pageFor({width:1000,height:700});try{
   await page.click('#founderReview');const original=await page.evaluate(()=>localStorage.getItem('global-holdings-world-v2.0.0'));
   await page.evaluate(()=>{window.__foundingNative=[];window.webkit={messageHandlers:{saveBridge:{postMessage(envelope){window.__foundingNative.push(envelope);}}}};});
   await page.click('#founderSubmit');await page.waitForFunction(()=>__foundingNative.length===1);assert.strictEqual((await state(page)).onboardingComplete,false);assert.strictEqual((await state(page)).cash,0);assert(await page.locator('#founderSubmit').isDisabled());
   await page.evaluate(()=>document.querySelector('#founderForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.strictEqual(await page.evaluate(()=>__foundingNative.length),1);
   await page.evaluate(()=>GH_PERSISTENCE.receiveAck({...__foundingNative[0],success:false,generation:0,message:'injected-native-rejection'}));await page.locator('#founderError').waitFor({state:'visible'});assert.strictEqual((await state(page)).cash,0);assert.strictEqual((await state(page)).onboardingComplete,false);assert.strictEqual(await page.evaluate(()=>localStorage.getItem('global-holdings-world-v2.0.0')),original);
   await page.click('#founderSubmit');await page.waitForFunction(()=>__foundingNative.length===2);await page.evaluate(()=>GH_PERSISTENCE.receiveAck({...__foundingNative[1],success:true,generation:1}));await page.waitForFunction(()=>__GH_STATE__.onboardingComplete);await page.evaluate(()=>{delete window.webkit;});assert.strictEqual((await state(page)).cash,50000000);assert.strictEqual((await state(page)).finance.journalEntries.length,1);
   await page.locator('[data-panel="companies"]').first().click();await page.click('[data-open="formationContract"]');assert(await page.locator('#drawerBody .formation-paper').isVisible());assert((await page.locator('#drawerBody').innerText()).includes((await state(page)).companyRegistry.group.formationContract));assert.deepStrictEqual(page.errors,[]);results.push({native:'pending isolation, duplicate click, rejection rollback, successful retry and saved document PASS'});
  }finally{await page.close();}
  fs.mkdirSync('.ci-output/ci',{recursive:true});fs.writeFileSync(`.ci-output/ci/browser-founding-${engine}.json`,JSON.stringify(results,null,2));console.log(`Founding browser ${engine}: PASS (${results.length} scenarios)`);
 }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
