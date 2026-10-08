'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');

async function accept(page){const dialog=page.locator('dialog.ui-confirm');await dialog.waitFor({state:'visible'});await dialog.locator('[data-confirm="accept"]').click();}
async function openAllCompanies(page){
  await page.evaluate(()=>{__GH_STATE__.godMoney=true;__GH_STATE__.infiniteMoney=true;__AUDIT__.openDrawer('companies','subs');});
  await page.locator('.open-all-companies').click();await accept(page);
  await page.waitForFunction(()=>GH_COMPANY_PLATFORM.listInstances(__GH_STATE__,{includeGroup:false}).every(row=>row.operational));
}
async function openScope(page,{company,region='',country='',count}){
  const before=await page.evaluate(()=>__GH_STATE__.globalBases.length+__GH_STATE__.customHubs.length);
  await page.evaluate(()=>__AUDIT__.openDrawer('network'));
  await page.locator('#worldKind').selectOption(company);
  if(region)await page.locator('#worldRegion').selectOption(region);
  if(country)await page.locator('#worldCountry').selectOption(country);
  await page.locator('#worldBulkCount').selectOption(String(count));
  const button=page.locator('.open-scope-facilities');await button.waitFor({state:'visible'});
  const planned=Number(await button.getAttribute('data-count'));assert.equal(planned,count);
  await button.click();await accept(page);
  await page.waitForFunction(expected=>GH_APP_RUNTIME_METRICS.snapshot().durable.last?.name==='authorized:open-facilities-by-scope'&&GH_APP_RUNTIME_METRICS.snapshot().durable.last?.committed===true&&(__GH_STATE__.globalBases.length+__GH_STATE__.customHubs.length)>=expected,before+count);
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const asiaErrors=[],asiaSession=await boot({browser,errors:asiaErrors,viewport:{width:844,height:390}}),asia=asiaSession.page;asia.setDefaultTimeout(60000);
    await openAllCompanies(asia);await openScope(asia,{company:'bank',region:'asia',count:3});await openScope(asia,{company:'bank',region:'asia',count:3});
    await asia.evaluate(()=>__AUDIT__.openDrawer('bank',{tab:'branches'}));assert.equal(await asia.locator('.bank-branch-service-card').count(),6);assert.equal(await asia.locator('[data-bank-service]').count(),0,'the bank desk has no manual service activation controls');assert.match(await asia.locator('.bank-branch-service-card').first().innerText(),/جميع الخدمات مفعّلة \(10\)/);
    const bank=await asia.evaluate(()=>{const facilities=__GH_STATE__.customHubs.filter(row=>row.ownerCompanyId==='bank'),branches=__GH_STATE__.bank.branchNetwork||[],all=GH_BANKING_CORE.ALL_BRANCH_SERVICES;branches[0].services=['حسابات وودائع'];branches[0].serviceModel='أساسي';const normalized=GH_BANKING_CORE.ensure(__GH_STATE__).branchNetwork;return {facilityCompanies:[...new Set(facilities.map(row=>row.ownerCompanyId))],countries:[...new Set(facilities.map(row=>row.country))],branches:normalized.map(row=>({active:row.servicesActive,model:row.serviceModel,services:row.services})),all:[...all],valid:GH_SAVE_SCHEMA.validate(__GH_STATE__).ok};});
    assert.deepEqual(bank.facilityCompanies,['bank']);assert.equal(bank.countries.length,6,'repeated Asia selections continue with six unique countries');assert.equal(bank.branches.length,6);assert(bank.branches.every(row=>row.active&&row.model==='شامل'&&row.services.length===bank.all.length&&bank.all.every(service=>row.services.includes(service))),'new and legacy branches expose the complete service catalog');assert.equal(bank.valid,true);assert.deepEqual(asiaErrors,[]);await asia.close();

    const worldErrors=[],worldSession=await boot({browser,errors:worldErrors,viewport:{width:844,height:390}}),world=worldSession.page;world.setDefaultTimeout(60000);
    await openAllCompanies(world);await openScope(world,{company:'air',count:5});
    const air=await world.evaluate(()=>{const rows=__GH_STATE__.globalBases.filter(row=>row.ownerCompanyId==='air');return {count:rows.length,companies:[...new Set(rows.map(row=>row.ownerCompanyId))],countries:[...new Set(rows.map(row=>row.country))],valid:GH_SAVE_SCHEMA.validate(__GH_STATE__).ok};});
    assert.equal(air.count,5);assert.deepEqual(air.companies,['air']);assert(air.countries.length>=4,'world selection spreads facilities across countries');assert.equal(air.valid,true);assert.deepEqual(worldErrors,[]);await world.close();
    console.log(JSON.stringify({suite:'build363-facility-scope-bank-browser',asiaBankBranches:bank.branches.length,asiaCountries:bank.countries.length,worldAirBases:air.count,worldCountries:air.countries.length,allBankServices:bank.all.length}));
    console.log('BUILD363_FACILITY_SCOPE_BANK_BROWSER_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
