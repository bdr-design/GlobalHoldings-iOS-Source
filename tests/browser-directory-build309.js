'use strict';
const assert=require('assert'),fs=require('fs');
const {chromium,webkit}=require('playwright');
const {serve}=require('./helpers/web-server'),{installMapFixture,expectedNetworkError}=require('./helpers/browser-network');

(async()=>{
  const engineName=process.env.GH_BROWSER||'chromium',server=await serve(),browser=await (engineName==='webkit'?webkit:chromium).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1112,height:512},locale:'ar-SA'}),page=await context.newPage(),errors=[],evidence={purchases:[]};
  await installMapFixture(page);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!expectedNetworkError(message))errors.push(message.text());});page.on('dialog',dialog=>dialog.accept());
  const snapshot=()=>page.evaluate(()=>JSON.parse(JSON.stringify(window.__GH_STATE__)));
  const balances=state=>Object.fromEntries(Object.entries(state.companyFinance).map(([company,book])=>[company,book.accounts.map(account=>({id:account.id,balance:account.balance}))]));
  const facilities=state=>[...state.globalBases,...state.customHubs].filter(row=>row.owned);
  const visible=async selector=>{const rows=page.locator(selector);for(let index=0;index<await rows.count();index++)if(await rows.nth(index).isVisible())return rows.nth(index);throw new Error(`No visible ${selector}`);};
  const close=async()=>{if(await page.locator('#drawer').getAttribute('aria-hidden')==='false')await page.click('#drawerClose');};
  const panel=async name=>{await close();const direct=page.locator(`[data-panel="${name}"]:visible`).first();if(await direct.count())await direct.click();else{await (await visible('[data-panel="workspaceHub"]')).click();await (await visible(`[data-open="${name}"]`)).click();}};
  const companyDirectory=async company=>{await panel('companies');await page.click('[data-companytab="subs"]');await page.click(`[data-open="companyManage"][data-arg="${company}"]`);await page.click(`[data-open="companyFacilities"][data-arg="${company}"]`);await page.click(`.open-facility-directory[data-kind="${company}"]`);assert.strictEqual(await page.inputValue('#worldKind'),company);assert.strictEqual(await page.locator('#worldCountry option[value="GB"]').count(),1,`${company}: canonical British country option missing`);assert.strictEqual(await page.locator('#worldCountry option[value="UK"]').count(),0,`${company}: duplicate British country option`);};
  const sourceSite=async config=>page.evaluate(({company,code,country})=>{
    let key,city,coords;
    if(company==='air'){const row=GH_WORLD_DATA.airports.find(site=>site[0]===code);key=`air:${row[0]}`;city=row[3]||row[4];coords=[row[6],row[7]];}
    else if(company==='sea'){const row=GH_WORLD_DATA.ports.find(site=>site[0]===code);key=`port:${row[0]}:${row[3]}:${row[4]}`;city=row[1];coords=[row[3],row[4]];}
    else{const row=GH_MOBILITY_CORE.CAPITALS.find(site=>site.id===code);key=`site:${company}:${row.id}`;city=row.city;coords=[...row.coords];}
    return {key,city,coords,cityId:`${country}:${GH_DIRECTORY_CORE.normalize(city)}`};
  },config);
  const selectSite=async(config,source)=>{await page.selectOption('#worldCountry',config.country);await page.selectOption('#worldCity',source.cityId);assert.strictEqual(await page.inputValue('#worldCountry'),config.country);assert.strictEqual(await page.inputValue('#worldCity'),source.cityId);const cards=page.locator('.world-result');assert(await cards.count()>0&&await cards.count()<=24);assert(await cards.evaluateAll((rows,company)=>rows.every(row=>row.dataset.company===company),config.company));return page.locator(`.world-result[data-company="${config.company}"][data-key="${source.key}"]`);};
  try{
    await page.goto(server.baseURL,{waitUntil:'domcontentloaded'});await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await page.locator('#founderForm button[type="submit"]').click();await page.waitForFunction(()=>__GH_STATE__.onboardingComplete);
    const cases=[{company:'air',country:'AE',code:'OMDB'},{company:'sea',country:'DE',code:'DEHAM'},{company:'road',country:'AE',code:'AUH'},{company:'power',country:'DE',code:'BER'},{company:'bank',country:'GB',code:'LON'},{company:'mobility',country:'SG',code:'SIN'}];
    for(const {company} of cases){await panel('companies');await page.click('[data-companytab="subs"]');await page.click(`.open-company[data-type="${company}"]`);}
    for(const config of cases){
      const {company}=config,source=await sourceSite(config);await companyDirectory(company);const card=await selectSite(config,source),button=card.locator('.open-directory-site');
      await button.waitFor({state:'visible'});const quote=Number(await button.getAttribute('data-quote'));assert(Number.isFinite(quote)&&quote>0,`${company}: invalid displayed construction quote`);assert.strictEqual(await button.getAttribute('data-company'),company);if(company==='power')assert.strictEqual(await button.getAttribute('data-energy-kind'),'solar');
      await page.evaluate(({company,quote})=>{const state=__GH_STATE__,have=GH_FINANCE_CORE.operating(state,company);if(have<quote+10000)GH_FINANCE_CORE.execute({state},'transfer',{from:'group',to:company,amount:quote+10000-have,note:'Directory regression company funding'});},{company,quote});
      const before=await snapshot(),beforeBalances=balances(before),count=facilities(before).length;
      await button.evaluate(node=>{window.__GH_DIRECTORY_RETRY_BUTTON__=node;});await button.click();
      const after=await snapshot(),created=facilities(after).filter(row=>row.sourceKey===source.key&&row.company===company);
      assert.strictEqual(created.length,1,`${company}: selected facility was not created exactly once`);const facility=created[0];assert.strictEqual(facilities(after).length,count+1);assert.strictEqual(facility.city,source.city);assert.deepStrictEqual(facility.coords,source.coords);assert.strictEqual(facility.sourceKey,source.key);assert.strictEqual(facility.cost,quote,`${company}: paid construction amount differs from displayed quote`);assert.notStrictEqual(facility.city,'الرياض');
      const afterBalances=balances(after);assert.strictEqual(beforeBalances[company][0].balance-afterBalances[company][0].balance,quote,`${company}: quote was not deducted from its current account`);assert.deepStrictEqual(afterBalances[company].slice(1),beforeBalances[company].slice(1));for(const owner of Object.keys(beforeBalances))if(owner!==company)assert.deepStrictEqual(afterBalances[owner],beforeBalances[owner],`${company}: purchase changed ${owner} accounts`);
      await page.evaluate(()=>{window.__GH_DIRECTORY_RETRY_BUTTON__.click();delete window.__GH_DIRECTORY_RETRY_BUTTON__;});const retried=await snapshot();assert.deepStrictEqual(balances(retried),afterBalances,`${company}: duplicate opening debited an account`);assert.strictEqual(facilities(retried).length,count+1);
      await companyDirectory(company);const ownedCard=await selectSite(config,source);assert.strictEqual(await ownedCard.locator('.open-directory-site').count(),0);assert.strictEqual(await ownedCard.locator(`[data-open="facilityManage"][data-arg="${facility.id}"]`).count(),1);
      evidence.purchases.push({company,key:source.key,city:source.city,quote,actualDebit:beforeBalances[company][0].balance-afterBalances[company][0].balance});
    }

    // Pagination must expose later registry rows without repeating the first page.
    await companyDirectory('air');const firstPage=await page.locator('.world-result').evaluateAll(rows=>rows.map(row=>row.dataset.key));assert.strictEqual(firstPage.length,24);await page.locator('[data-world-page="1"]').click();const secondPage=await page.locator('.world-result').evaluateAll(rows=>rows.map(row=>row.dataset.key));assert.strictEqual(secondPage.length,24);assert(secondPage.every(key=>!firstPage.includes(key)));evidence.pagination={first:firstPage.length,second:secondPage.length};

    // A pending search cannot redraw a previous company after changing scope.
    await page.selectOption('#worldCountry','AE');await page.fill('#worldSearch','NO_MATCH_PENDING_SCOPE');await page.locator('[data-world-company="bank"]').click();await page.waitForTimeout(300);assert.strictEqual(await page.inputValue('#worldKind'),'bank');for(const id of ['worldCountry','worldCity','worldSearch'])assert.strictEqual(await page.inputValue(`#${id}`),'');assert(await page.locator('.world-result').count()>0);assert(await page.locator('.world-result').evaluateAll(rows=>rows.every(row=>row.dataset.company==='bank')));
    await page.fill('#worldSearch','NO_MATCH_PENDING_PANEL');await panel('companies');const companyTitle=await page.locator('#drawerTitle').textContent();await page.waitForTimeout(300);assert.strictEqual(await page.locator('#drawerTitle').textContent(),companyTitle);assert.strictEqual(await page.locator('#worldKind').count(),0);

    // Energy intent belongs to the active company and resets when it is reopened.
    await companyDirectory('power');assert.strictEqual(await page.inputValue('#worldEnergyKind'),'solar');await page.selectOption('#worldEnergyKind','wind');assert(await page.locator('.open-directory-site').evaluateAll(rows=>rows.length>0&&rows.every(row=>row.dataset.company==='power'&&row.dataset.energyKind==='wind')));await page.locator('[data-world-company="road"]').click();assert.strictEqual(await page.locator('#worldEnergyKind').count(),0);await page.locator('[data-world-company="power"]').click();assert.strictEqual(await page.inputValue('#worldEnergyKind'),'solar');assert(await page.locator('.open-directory-site').evaluateAll(rows=>rows.length>0&&rows.every(row=>row.dataset.company==='power'&&row.dataset.energyKind==='solar')));

    await page.setViewportSize({width:390,height:844});await companyDirectory('sea');
    const geometry=await page.evaluate(()=>{const drawer=document.querySelector('#drawerBody'),controls=[...document.querySelectorAll('#worldKind,#worldCountry,#worldCity,#worldSearch')];return {viewport:innerWidth,clientWidth:drawer.clientWidth,scrollWidth:drawer.scrollWidth,controls:controls.map(node=>{const rect=node.getBoundingClientRect();return{left:rect.left,right:rect.right,height:rect.height};}),scrollRange:drawer.scrollHeight-drawer.clientHeight};});
    assert(geometry.scrollWidth<=geometry.clientWidth+1,`iPhone directory horizontal overflow: ${JSON.stringify(geometry)}`);assert(geometry.controls.every(rect=>rect.left>=-.5&&rect.right<=geometry.viewport+.5&&rect.height>=44),`iPhone directory controls clipped or too small: ${JSON.stringify(geometry)}`);assert(geometry.scrollRange>0);await page.locator('[data-world-page="1"]').scrollIntoViewIfNeeded();assert(await page.locator('[data-world-page="1"]').isVisible());evidence.iphone=geometry;
    assert.deepStrictEqual(errors,[]);fs.mkdirSync('.ci-output/ci',{recursive:true});fs.writeFileSync(`.ci-output/ci/browser-directory-build309-${engineName}.json`,JSON.stringify(evidence,null,2));console.log(`BUILD309 unified directory browser (${engineName}): PASS`);
  }finally{fs.mkdirSync('tests/screenshots',{recursive:true});await page.screenshot({path:`tests/screenshots/build309-directory-${engineName}.png`});await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
