'use strict';
const assert=require('assert'),fs=require('fs');
const {chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server'),{installMapFixture,expectedNetworkError}=require('./helpers/browser-network');

(async()=>{
  const engineName=process.env.GH_BROWSER||'chromium',engine=engineName==='webkit'?webkit:chromium;
  const browser=await engine.launch({headless:true}),server=await serve(),page=await browser.newPage({viewport:{width:844,height:390},locale:'ar-SA'}),errors=[],evidence={engine:engineName};
  await installMapFixture(page);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!expectedNetworkError(m)&&!m.location().url.includes('router.project-osrm.org'))errors.push(m.text());});
  page.on('dialog',d=>d.accept());
  const snapshot=()=>page.evaluate(()=>JSON.parse(JSON.stringify(__GH_STATE__)));
  const close=async()=>{if(await page.locator('#drawer').getAttribute('aria-hidden')==='false')await page.click('#drawerClose');};
  const panel=async name=>{await close();const rows=page.locator(`[data-panel="${name}"]`);for(let i=0;i<await rows.count();i++)if(await rows.nth(i).isVisible()){await rows.nth(i).click();return;}throw Error('panel '+name);};
  const docs=async()=>{await panel('finance');await page.locator('[data-open="invoices"]').first().click();};

  try{
    await page.goto(server.baseURL,{waitUntil:'domcontentloaded'});
    await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await page.locator('#founderForm button[type="submit"]').click();await page.waitForFunction(()=>__GH_STATE__.onboardingComplete);

    await docs();await page.locator('[data-tab="cheques"]').click();
    let current=await snapshot(),cashBefore=current.companyFinance.group.accounts[0].balance;
    await page.fill('#chequeAmount','1000000');await page.fill('#chequeBeneficiary','Modern Supplier Holdings Ltd.');await page.fill('#chequeNote','سداد خدمات تقنية سنوية');await page.fill('#chequeDueDay','0');
    await page.click('.create-cheque-doc');
    await page.waitForFunction(()=>__GH_STATE__.finance.cheques.some(c=>c.beneficiary==='Modern Supplier Holdings Ltd.'&&c.status==='صادر'));
    current=await snapshot();const issued=current.finance.cheques.find(c=>c.beneficiary==='Modern Supplier Holdings Ltd.');
    assert.strictEqual(current.companyFinance.group.accounts[0].balance,cashBefore,'issuing cheque through UI moved current-account cash');
    assert.strictEqual(issued.purposeDetail,'سداد خدمات تقنية سنوية');
    const drawerText=await page.locator('#drawerBody').innerText();assert(drawerText.includes('الإصدار وحده لا يخصم الرصيد'),'cheque issue/clear distinction missing from UI');
    await page.locator(`.settle-cheque-now[data-id="${issued.id}"]`).click();
    await page.waitForFunction(id=>__GH_STATE__.finance.cheques.find(c=>c.id===id)?.status==='مصروف',issued.id);
    current=await snapshot();assert.strictEqual(current.companyFinance.group.accounts[0].balance,cashBefore-1000000,'manual cheque clearing did not debit exact current-account amount');
    evidence.manualCheque=issued.id;

    // Supplier payable exposes both transfer and cheque methods; cheque issuance keeps the payable open.
    await page.evaluate(()=>GH_DOMAIN_COMMANDS.dispatch({state:__GH_STATE__},'finance','accrue-expense',{company:'group',amount:250000,note:'صيانة أنظمة مركزية',method:'قيد مستحق',taxable:false,counterparty:'Systems Care Arabia Ltd.',dueDay:2,number:'GH-AP-B317',line:'technology'},{actor:'browser-test'}));
    await docs();await page.locator('[data-tab="receivables"]').click();
    assert.strictEqual(await page.locator('.settle-payable-transfer[data-number="GH-AP-B317"]').count(),1,'bank-transfer payable choice missing');
    assert.strictEqual(await page.locator('.issue-payable-cheque[data-number="GH-AP-B317"]').count(),1,'cheque payable choice missing');
    const cashBeforePayable=(await snapshot()).companyFinance.group.accounts[0].balance;
    await page.locator('.issue-payable-cheque[data-number="GH-AP-B317"]').click();
    await page.waitForFunction(()=>__GH_STATE__.finance.cheques.some(c=>c.invoiceNumber==='GH-AP-B317'&&c.status==='صادر'));
    current=await snapshot();assert(current.finance.payables.some(x=>x.number==='GH-AP-B317'),'payable cleared before cheque was cashed');assert.strictEqual(current.companyFinance.group.accounts[0].balance,cashBeforePayable,'payable cheque issue moved cash');
    const payableCheque=current.finance.cheques.find(c=>c.invoiceNumber==='GH-AP-B317');evidence.payableCheque=payableCheque.id;

    // Rich transfer purpose + actual profit/cash trace.
    await page.evaluate(()=>{
      GH_DOMAIN_COMMANDS.dispatch({state:__GH_STATE__},'finance','credit',{company:'group',amount:500000,note:'إيراد عقد خدمات مؤسسية',taxable:false,reference:'B317-REV-001',counterparty:'Enterprise Client Ltd.',sourceRefs:['CONTRACT-B317']},{actor:'browser-test'});
      GH_DOMAIN_COMMANDS.dispatch({state:__GH_STATE__},'finance','record-daily-close',{day:0,sectors:{air:0,sea:0,road:0,power:0,bank:0,mobility:0},companies:{air:{grossRevenue:500000,expenses:100000,net:400000,tripRevenue:0,operatingRevenue:500000,tripCount:0}},net:400000},{actor:'browser-test'});
    });
    await docs();await page.locator('[data-tab="incoming"]').click();
    const incoming=await page.locator('#drawerBody').innerText();
    for(const phrase of ['سبب الحركة المالية','تحصيل فاتورة/إيراد','طريقة التسوية','المستند المرتبط','CONTRACT-B317'])assert(incoming.includes(phrase),`modern transfer missing: ${phrase}`);
    await page.locator('[data-tab="profitFlow"]').click();const profit=await page.locator('#drawerBody').innerText();
    for(const phrase of ['وصول الأرباح إلى الحسابات','الربح المحاسبي','صافي حركة الحساب','فرق استحقاق/توقيت','الرصيد الجاري الآن'])assert(profit.includes(phrase),`profit-to-account view missing: ${phrase}`);
    assert.deepStrictEqual(errors,[]);
    fs.mkdirSync('.ci-output/ci',{recursive:true});fs.writeFileSync(`.ci-output/ci/build317-finance-depth-${engineName}.json`,JSON.stringify(evidence,null,2));
    console.log(`BUILD317 finance depth ${engineName}: PASS (issue-only cheque, payable cheque/transfer choice, rich transfer purpose, profit-to-account cash trace)`);
  }finally{
    fs.mkdirSync('tests/screenshots',{recursive:true});await page.screenshot({path:`tests/screenshots/build317-finance-depth-${engineName}.png`}).catch(()=>{});
    await browser.close();await server.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
