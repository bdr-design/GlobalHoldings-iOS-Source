'use strict';
// Build 358, step 2 (finance): the budget tool lived in the developer panel removed in step 1. It is now its own page
// in Money (المال ← الميزانيات). In the real game (browser), a clicked monthly ceiling and capex line bind: Finance Core
// refuses a spend above them, accepts one within them, and clearing the ceiling lifts the limit again.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
const {serve}=require('./helpers/web-server');
const {drawFounderSignature}=require('./helpers/signature-input');
(async()=>{
  const server=await serve(path.resolve(__dirname,'../WebApp')),browser=await chromium.launch({headless:true}),errors=[];
  try{
    const page=await browser.newPage({viewport:{width:844,height:390},deviceScaleFactor:1,locale:'ar-SA'});page.setDefaultTimeout(15000);
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,route=>route.abort());
    await page.goto(server.baseURL);await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);
    await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);
    await page.evaluate(()=>{__GH_STATE__.speed=0;const prepare=GH_INTERFACE.prepare;window.GH_INTERFACE={...GH_INTERFACE,prepare(root,panel,arg,ctx){window.qaContext=ctx;return prepare(root,panel,arg,ctx);}};});
    await page.locator('.side-nav [data-panel=finance]').click();
    await page.evaluate(async()=>{const d=GH_COMPANY_PLATFORM.definitionFor(__GH_STATE__,'air');await qaContext.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(50000000,d.founding.minimumCapital),legalName:'شركة الطيران',formationContract:'BUDGET-QA'});});
    await page.evaluate(()=>qaContext.openDrawer('finance'));await page.locator('#drawerBody .command-btn[data-open="budgets"]').click();
    const card=page.locator('#drawerBody .budget-card').filter({has:page.locator('.budget-save[data-company="air"]')});
    await card.locator('[data-budget-limit]').fill('10000000');await card.locator('[data-budget-line="capex"]').fill('5000000');
    await card.locator('.budget-save').click();
    await page.waitForFunction(()=>__GH_STATE__.companyBudgets?.air?.enabled===true);
    const saved=await page.evaluate(()=>({limit:__GH_STATE__.companyBudgets.air.limit,capex:__GH_STATE__.companyBudgets.air.lines.capex,active:document.querySelector('.side-nav [data-nav="finance"]')?.classList.contains('active')}));
    assert.deepEqual(saved,{limit:10000000,capex:5000000,active:true},'the clicked ceiling and line are saved; the Money rail stays active');
    const spend=amount=>page.evaluate(async amount=>{try{await qaContext.runAuthorizedDomainCommand('finance','spend',{company:'air',amount,note:'شراء معدات QA',line:'capex',counterparty:'مورد QA'},{silent:true});return 'ok';}catch(error){return String(error.message);}},amount);
    assert.match(await spend(6000000),/insufficient-funds-or-budget/,'above the capex line is refused');
    assert.equal(await spend(4000000),'ok','within the line is paid');
    assert.match(await spend(2000000),/insufficient-funds-or-budget/,'the line counts what was already spent this month');
    assert.equal(await page.evaluate(()=>__GH_STATE__.companyBudgets.air.spentByLine.capex),4000000);
    await page.locator('#drawerBody .budget-card .budget-clear[data-company="air"]').click();
    await page.waitForFunction(()=>__GH_STATE__.companyBudgets?.air?.enabled===false);
    assert.equal(await spend(6000000),'ok','without a ceiling the account balance is the only limit');
    assert.deepEqual(errors,[]);
    console.log('BUILD358_BUDGETS_BROWSER_PASS',JSON.stringify(saved));
  }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
