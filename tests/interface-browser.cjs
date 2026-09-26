'use strict';
const {chromium}=require('playwright');
const assert=require('assert/strict');
const path=require('path');
const fs=require('fs');
const {serve}=require('./helpers/web-server');
const {drawFounderSignature}=require('./helpers/signature-input');

(async()=>{
  const server=await serve(path.resolve(__dirname,'../WebApp'));
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:844,height:390},deviceScaleFactor:2,locale:'ar-SA'});
  const errors=[],out=path.resolve(__dirname,'../verification');
  fs.mkdirSync(out,{recursive:true});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,route=>route.abort());
  await page.goto(server.baseURL);
  await page.selectOption('#founderMode','sandbox');
  await page.click('#founderReview');
  await drawFounderSignature(page);
  await page.locator('#founderForm button[type=submit]').click();
  await page.waitForFunction(()=>__GH_STATE__.onboardingComplete);
  await page.evaluate(()=>{
    __GH_STATE__.speed=0;
    const original=GH_INTERFACE.prepare;
    window.GH_INTERFACE={...GH_INTERFACE,prepare(root,panel,arg,ctx){window.qaContext=ctx;return original(root,panel,arg,ctx);}};
  });
  await page.locator('.side-nav [data-panel=companies]').click();
  await page.evaluate(async()=>{
    for(const type of ['air','sea','road','power','bank','mobility'])if(!__GH_STATE__.openedCompanies.includes(type)){const minimum=Number(GH_COMPANY_PLATFORM.definitionFor(__GH_STATE__,type)?.founding?.minimumCapital)||0;await qaContext.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(50000000,minimum),legalName:'شركة اختبار '+type,formationContract:'INTERFACE-QA-'+type});}
    qaContext.openDrawer('companies');
  });

  const report=[];
  const panels=['companies','leadershipHub','control','peopleHub','finance','workspaceHub','governanceHub','systemHub','settings','network','routes','assets','assetMarket','companyManage','labor','invoices','monthlyFinance','treasury','energy','bank','businessWorld','news','procurement','conference','audit','legal','insurance','research','esg','career','diagnostics','controlPlane'];
  for(const panel of panels){
    await page.evaluate(name=>qaContext.openDrawer(name,name==='companyManage'?'air':name==='labor'?'managers:air':name==='assetMarket'?'air':undefined),panel);
    await page.waitForTimeout(50);
    const metrics=await page.evaluate(()=>{
      const map=GH_INTERFACE.mapViewport(),drawer=document.querySelector('#drawer').getBoundingClientRect(),body=document.querySelector('#drawerBody');
      return {mapWidth:map.width,mapRight:map.right,drawerLeft:drawer.left,overflow:body.scrollWidth>body.clientWidth+2,text:body.innerText.length};
    });
    assert(metrics.mapWidth>340&&metrics.mapRight<=metrics.drawerLeft+1,panel+' hides map');
    assert(!metrics.overflow,panel+' overflows');
    assert(metrics.text>0);
    report.push({panel,...metrics});
    if(['companies','finance','labor','companyManage','leadershipHub'].includes(panel))await page.screenshot({path:path.join(out,'334-'+panel+'.png')});
  }

  await page.evaluate(()=>qaContext.openDrawer('labor','managers:air'));
  await page.locator('[data-gh-action=hr-appoint-manager]').first().click();
  await page.locator('[data-confirm=cancel]').click();
  assert.equal(await page.evaluate(()=>GH_HR_CORE.officialManager(__GH_STATE__,'air')),null);

  const beforeFailure=await page.evaluate(()=>({
    revision:Number(__GH_STATE__.saveRevision)||0,
    contracts:__GH_STATE__.advanced.labor.employmentContracts.filter(row=>row.officialManager&&row.company==='air').length,
    hiring:__GH_STATE__.advanced.labor.hiringLog.filter(row=>row.action==='official-manager-appointed'&&row.company==='air').length
  }));
  await page.evaluate(()=>{
    window.qaOriginalPersistence=window.GH_PERSISTENCE;
    window.GH_PERSISTENCE={...window.GH_PERSISTENCE,commitDurableState:async()=>{throw new Error('qa-forced-durable-save-failure');}};
  });
  await page.locator('[data-gh-action=hr-appoint-manager]').first().click();
  await page.locator('[data-confirm=accept]').click();
  await page.waitForFunction(()=>__GH_STATE__.alerts?.some(text=>String(text).includes('qa-forced-durable-save-failure')&&(String(text).includes('تعذر تعيين المدير الرسمي')||String(text).includes('أُلغيت المعاملة بالكامل'))));
  const afterFailure=await page.evaluate(()=>({
    revision:Number(__GH_STATE__.saveRevision)||0,
    manager:GH_HR_CORE.officialManager(__GH_STATE__,'air'),
    contracts:__GH_STATE__.advanced.labor.employmentContracts.filter(row=>row.officialManager&&row.company==='air').length,
    hiring:__GH_STATE__.advanced.labor.hiringLog.filter(row=>row.action==='official-manager-appointed'&&row.company==='air').length,
    falseSuccess:__GH_STATE__.alerts.some(text=>String(text).includes('أصبح المدير الرسمي')),
    realFailure:__GH_STATE__.alerts.some(text=>String(text).includes('qa-forced-durable-save-failure')&&(String(text).includes('تعذر تعيين المدير الرسمي')||String(text).includes('أُلغيت المعاملة بالكامل'))),
    failureAlerts:__GH_STATE__.alerts.filter(text=>String(text).includes('qa-forced-durable-save-failure'))
  }));
  assert.equal(afterFailure.manager,null,'save failure must not leave a manager in live state');
  assert.equal(afterFailure.contracts,beforeFailure.contracts,'save failure must not leave a manager contract');
  assert.equal(afterFailure.hiring,beforeFailure.hiring,'save failure must not leave a hiring log entry');
  assert.equal(afterFailure.revision,beforeFailure.revision,'save failure must not advance the live save revision');
  assert.equal(afterFailure.falseSuccess,false,'save failure must not emit a success alert');
  assert.equal(afterFailure.realFailure,true,`save failure must be visible as a real failure: ${JSON.stringify(afterFailure.failureAlerts)}`);
  await page.evaluate(()=>{window.GH_PERSISTENCE=window.qaOriginalPersistence;delete window.qaOriginalPersistence;});

  await page.locator('[data-gh-action=hr-appoint-manager]').first().click();
  await page.locator('[data-confirm=accept]').click();
  await page.waitForFunction(()=>GH_HR_CORE.officialManager(__GH_STATE__,'air'));
  const manager=await page.evaluate(()=>GH_HR_CORE.officialManager(__GH_STATE__,'air'));
  assert(manager.contractId);
  assert.equal(await page.evaluate(()=>__GH_STATE__.advanced.labor.employmentContracts.filter(row=>row.officialManager&&row.company==='air'&&row.status==='ساري').length),1);
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);
  assert.equal(await page.evaluate(()=>GH_HR_CORE.officialManager(__GH_STATE__,'air')?.contractId),manager.contractId);
  assert.equal(await page.locator('#speedMenu [data-speed]').count(),4);
  assert.deepEqual(errors,[]);
  const result={report,manager:manager.name,persisted:true,saveFailureRollback:true,errors};
  fs.writeFileSync(path.join(out,'334-interface-results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({panels:report.length,manager:manager.name,persisted:true,saveFailureRollback:true,errors}));
  await browser.close();
  await server.close();
})().catch(error=>{console.error(error);process.exit(1);});
