'use strict';
// Build 358: founding and company opening, as the player meets them in the game (844×390 landscape).
// Founding is two honest steps (the group, then the contract and signature). The choices with no effect are gone,
// the contract states every value in Arabic, and the chosen headquarters city is where the HQ stands on the map.
// A subsidiary opens by signing its opening contract: the holding's current account (not the consolidated cash) must
// cover the capital, a short account is refused with the reason in the contract, and opening moves money inside the
// group without raising the group value.
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
    await page.goto(server.baseURL);await page.waitForSelector('#founderFlow:not(.hidden)');

    // Step 1: the group. No dead options; the contract is written live beside the form.
    for(const selector of ['#founderRisk','#founderProcurement','#founderAuthority','#founderGovernanceStep','.inc-logo-option','#founderCapitalPreview'])
      assert.equal(await page.locator(selector).count(),0,`${selector} had no effect and is gone`);
    assert.equal(await page.locator('.incorporation-progress>span').count(),2,'founding has two steps');
    assert.equal(await page.locator('#founderDataStep').getAttribute('aria-current'),'step');
    await page.fill('#founderName','مجموعة الأفق القابضة');await page.selectOption('#founderLocation','LON');
    await page.waitForFunction(()=>document.querySelector('#founderLivePreview .charter h2')?.textContent==='مجموعة الأفق القابضة');
    assert.match(await page.locator('#founderLivePreview .charter').innerText(),/لندن/,'the live contract follows the chosen headquarters');

    // Step 2: contract and signature. Every value reads in Arabic.
    await page.click('#founderReview');await page.waitForSelector('#founderReviewPane:not([hidden])');
    assert.equal(await page.locator('#founderReviewStep').getAttribute('aria-current'),'step');
    assert.equal(await page.locator('#founderDataStep').getAttribute('aria-current'),null);
    const draft=await page.locator('#founderContractPreview .charter').innerText();
    assert.doesNotMatch(draft,/\b(balanced|founder|conservative|growth|competitive)\b/,'no internal English ids in the contract');
    assert.equal(await page.locator('#founderContractPreview .charter').getAttribute('data-status'),'draft');
    await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();
    await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);
    await page.evaluate(()=>{__GH_STATE__.speed=0;const prepare=GH_INTERFACE.prepare;window.GH_INTERFACE={...GH_INTERFACE,prepare(root,panel,arg,ctx){window.qaContext=ctx;return prepare(root,panel,arg,ctx);}};});
    const founded=await page.evaluate(()=>({profile:__GH_STATE__.profile,document:__GH_STATE__.companyRegistry.group.formationDocument,hq:document.querySelectorAll('.facility-marker').length}));
    assert.equal(founded.profile.locationId,'LON');assert.equal(founded.profile.city,'لندن');
    for(const key of ['riskAppetite','procurementPolicy','signingAuthority','firstSector','logoStyle']){assert.equal(key in founded.profile,false,`profile.${key} is not stored`);assert.equal(key in founded.document,false,`formationDocument.${key} is not stored`);}
    assert(founded.hq>=1,'the headquarters stands on the map');

    // Subsidiaries: one row per company, the contract in reach, the holding account decides.
    await page.locator('.side-nav [data-panel=companies]').click();await page.locator('#drawerBody [data-companytab="subs"]').click();
    assert.equal(await page.locator('#drawerBody details.ui-more .company-open-row').count(),0,'no opening row is hidden in a collapsed section');
    assert.equal(await page.locator('#drawerBody .company-open-row[data-company="mobility"] .is-short').count(),1,'120M against a 50M holding account reads short');
    await page.locator('#drawerBody .company-open-row[data-company="air"] [data-open="formationContract"]').click();
    const charter=page.locator('#drawerBody .charter[data-company="air"]');
    assert.equal(await charter.getAttribute('data-status'),'draft');
    assert.match(await charter.locator('.charter-flow').innerText(),/\d{4}-00-01-\d{6}/,'the contract names the holding account (its bank account number) the capital leaves');
    assert.equal(await page.locator('#drawerBody .sign-charter').isEnabled(),true);
    const before=await page.evaluate(()=>({value:__GH_STATE__.groupValue,cash:__GH_STATE__.cash}));
    await page.locator('#drawerBody .sign-charter').click();
    await page.waitForFunction(()=>__GH_STATE__.openedCompanies.includes('air')&&document.querySelector('#drawerBody .charter[data-company="air"]')?.dataset.status==='signed');
    const opened=await page.evaluate(()=>({value:__GH_STATE__.groupValue,cash:__GH_STATE__.cash,holding:GH_FINANCE_CORE.operating(__GH_STATE__,'group'),record:__GH_STATE__.companyRegistry.air,refs:document.querySelector('#drawerBody .charter-refs')?.innerText||''}));
    assert.equal(opened.value,before.value,'opening moves money inside the group; the group value does not rise');
    assert.equal(opened.cash,before.cash,'consolidated cash is unchanged by the internal transfer');
    assert.equal(opened.holding,25000000,'the holding account paid the 25M capital');
    assert.match(opened.refs,new RegExp(opened.record.formationContract),'the signed contract shows its number');
    for(const key of ['riskAppetite','procurementPolicy','logoStyle'])assert.equal(key in opened.record,false,`the company record has no ${key}`);
    assert.equal(opened.record.formationPlan.sourceAccountId,'GH-OPER-001');

    // The old bug: the card read "ready" from the consolidated cash. Sea needs 30M; the holding account has 25M.
    await page.locator('#drawerBody [data-open="companies"][data-arg="subs"]').first().click();
    assert.equal(await page.locator('#drawerBody .company-open-row[data-company="sea"] .is-short').count(),1,'sea reads short against the holding account');
    await page.locator('#drawerBody .company-open-row[data-company="sea"] [data-open="formationContract"]').click();
    assert.equal(await page.locator('#drawerBody .sign-charter').isDisabled(),true,'a short holding account cannot sign');
    assert.match(await page.locator('#drawerBody .charter-blocker').innerText(),/ينقص الحساب الجاري للقابضة/,'the reason is in the contract');
    assert.equal(await page.evaluate(()=>__GH_STATE__.openedCompanies.includes('sea')),false);

    // The group's name brands its subsidiaries: «مجموعة الأفق القابضة» opens «شركة الأفق للطيران».
    assert.equal(opened.record.legalName,'شركة الأفق للطيران','the subsidiary carries the group name');
    assert.equal(await page.evaluate(()=>GH_COMPANY_PLATFORM.resolveIdentity(__GH_STATE__,'sea').tradeName),'الأفق للشحن البحري','an unopened company already reads the group name');
    const rename=async(type,name)=>{await page.evaluate(type=>qaContext.openDrawer('companyManage',{type,tab:'overview'}),type);await page.evaluate(([type,name])=>{const input=document.querySelector(`#drawerBody .company-name-input[data-company="${type}"]`),save=document.querySelector(`#drawerBody .company-name-save[data-company="${type}"]`);if(!input||!save)throw new Error(`no rename field for ${type}`);input.value=name;save.click();},[type,name]);await page.waitForFunction(([type,name])=>__GH_STATE__.companyRegistry[type]?.legalName===name||(type==='group'&&__GH_STATE__.profile.name===name),[type,name]);};
    await rename('group','مجموعة السدرة القابضة');
    await page.waitForFunction(()=>__GH_STATE__.companyRegistry.air.legalName==='شركة السدرة للطيران');
    await rename('air','طيران النخبة');
    await rename('group','مجموعة الندى القابضة');
    assert.equal(await page.evaluate(()=>__GH_STATE__.companyRegistry.air.legalName),'طيران النخبة','a subsidiary renamed by the player keeps its name');

    // An old save sheds the retired founding fields.
    const cleaned=await page.evaluate(()=>{const s=__GH_STATE__;Object.assign(s.profile,{riskAppetite:'growth',procurementPolicy:'board',signingAuthority:'board',logoStyle:'gold'});s.companyRegistry.air.riskAppetite='growth';GH_ADVANCED.migrate(s);return ['riskAppetite','procurementPolicy','signingAuthority','logoStyle'].some(key=>key in s.profile)||'riskAppetite' in s.companyRegistry.air;});
    assert.equal(cleaned,false,'migrate() removes the retired fields from an old save');
    assert.deepEqual(errors,[]);
    console.log('PASS build358-founding-charter-browser: two-step founding, HQ city on the map, opening contract signs from the holding account, no phantom group value, the group name brands its subsidiaries');
  }finally{await browser.close();await server.close?.();}
})().catch(error=>{console.error(error);process.exit(1);});
