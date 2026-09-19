'use strict';
// CI synchronization marker: Build316 business-world verification.
const assert=require('assert'),fs=require('fs');
const {chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server'),{installMapFixture,expectedNetworkError}=require('./helpers/browser-network');

(async()=>{
  const engineName=process.env.GH_BROWSER||'chromium',engine=engineName==='webkit'?webkit:chromium;
  const browser=await engine.launch({headless:true}),server=await serve(),page=await browser.newPage({viewport:{width:844,height:390},locale:'ar-SA'}),errors=[],evidence={engine:engineName};
  await installMapFixture(page);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!expectedNetworkError(m)&&!m.location().url.includes('router.project-osrm.org'))errors.push(m.text());});
  page.on('dialog',d=>d.accept());

  const state=()=>page.evaluate(()=>JSON.parse(JSON.stringify(__GH_STATE__)));
  const close=async()=>{if(await page.locator('#drawer').getAttribute('aria-hidden')==='false')await page.click('#drawerClose');};
  const panel=async name=>{await close();const rows=page.locator(`[data-panel="${name}"]`);for(let i=0;i<await rows.count();i++)if(await rows.nth(i).isVisible()){await rows.nth(i).click();return;}throw Error('panel '+name);};

  try{
    await page.goto(server.baseURL,{waitUntil:'domcontentloaded'});
    await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await page.locator('#founderForm button[type="submit"]').click();await page.waitForFunction(()=>__GH_STATE__.onboardingComplete);

    // Business World is a real domain and legacy/static commercial data is normalized into one Party master.
    let current=await state();
    assert(current.businessWorld&&current.businessWorld.schema===1,'Business World state missing');
    const nova=Object.values(current.businessWorld.parties).filter(p=>(p.aliases||[]).includes('Nova Devices'));
    assert.strictEqual(nova.length,1,'Nova Devices should exist once in Party master');
    assert(current.businessWorld.opportunities.some(o=>o.id==='K3'&&o.partyId===nova[0].id),'opportunity did not link to customer Party ID');

    // Open through the actual leadership/control surface; no hidden developer-only route.
    await panel('control');await page.locator('[data-open="businessWorld"]').first().click();
    await page.locator('[data-business-tab="customers"]').click();
    await page.getByText('Nova Devices',{exact:true}).first().waitFor({state:'visible'});

    // Sponsorship must remain an explicit player decision and must not credit cash on acceptance alone.
    await page.locator('[data-business-tab="sponsorships"]').click();
    const sponsorCard=page.locator('article.list-item').filter({hasText:'Crestline Business Network'}).first();
    await sponsorCard.waitFor({state:'visible'});
    const beforeSponsor=await state(),groupCashBefore=beforeSponsor.companyFinance.group.accounts[0].balance;
    await sponsorCard.locator('[data-gh-action="business-accept-sponsorship"]').click();
    await page.waitForFunction(()=>__GH_STATE__.businessWorld.sponsorships.some(x=>x.id==='SPON-GROUP-001'&&x.status==='نشط'));
    current=await state();assert.strictEqual(current.companyFinance.group.accounts[0].balance,groupCashBefore,'accepting sponsorship credited cash before contractual billing');

    // The scheduled billing is execution of an accepted contract, not a new automatic decision.
    await page.evaluate(()=>GH_DOMAIN_COMMANDS.dispatch({state:__GH_STATE__},'business-world','tick-day',{day:0},{actor:'simulation-scheduler'}));
    current=await state();
    const sponsorTransfer=current.treasury.ledger.find(x=>x.collection===true&&x.fromPartyId&&(x.sourceRefs||[]).includes('SPON-GROUP-001'));
    assert(sponsorTransfer,'sponsorship billing did not create a source-linked incoming collection');
    assert(current.finance.transfers.some(x=>x.reference===sponsorTransfer.reference&&x.fromPartyId===sponsorTransfer.fromPartyId),'sponsorship collection diverged between finance transfer and treasury ledger');
    assert.strictEqual(current.companyFinance.group.accounts[0].balance,groupCashBefore+sponsorTransfer.amount,'sponsorship billing did not credit the exact contractual collection');
    const sponsorParty=current.businessWorld.parties[sponsorTransfer.fromPartyId];assert(sponsorParty&&sponsorParty.displayName==='Crestline Business Network','incoming sponsorship transfer lost remitter identity');
    evidence.sponsorship={party:sponsorParty.displayName,amount:sponsorTransfer.amount,reference:sponsorTransfer.reference};

    // Marketing is also manual: one click, one exact debit, one named agency.
    await panel('control');await page.locator('[data-open="businessWorld"]').first().click();await page.locator('[data-business-tab="marketing"]').click();
    const beforeCampaign=await state(),cashBeforeCampaign=beforeCampaign.companyFinance.group.accounts[0].balance;
    await page.fill('#businessCampaignBudget','1000000');await page.fill('#businessCampaignDays','30');await page.selectOption('#businessCampaignChannel','digital');
    await page.click('[data-gh-action="business-launch-campaign"]');
    await page.waitForFunction(()=>__GH_STATE__.businessWorld.campaigns.length===1);
    current=await state();assert.strictEqual(current.companyFinance.group.accounts[0].balance,cashBeforeCampaign-1000000,'campaign budget must debit exactly once');
    const campaign=current.businessWorld.campaigns[0],agency=current.businessWorld.parties[campaign.agencyPartyId];assert.strictEqual(agency.displayName,'Nexa Media Exchange');
    evidence.campaign={id:campaign.id,budget:campaign.budget,agency:agency.displayName,reach:campaign.reach,impressions:campaign.impressions};

    // Transfer UI is one ledger with derived incoming/outgoing/internal views and real party names.
    await panel('finance');await page.locator('[data-open="invoices"]').first().click();
    for(const tab of ['incoming','outgoing','internal'])assert.strictEqual(await page.locator(`[data-tab="${tab}"]`).count(),1,`missing ${tab} transfer view`);
    await page.locator('[data-tab="incoming"]').click();await page.getByText('Crestline Business Network',{exact:true}).first().waitFor({state:'visible'});
    await page.locator('[data-tab="outgoing"]').click();await page.getByText('Nexa Media Exchange',{exact:true}).first().waitFor({state:'visible'});

    // Newsroom consumes actual Business World events rather than inventing an unrelated feed.
    await panel('leadershipHub');await page.locator('[data-open="news"]').first().click();await page.locator('[data-news-filter="business"]').click();
    const newsText=await page.locator('.news-feed').innerText();assert(newsText.includes('Crestline Business Network'),'business newsroom missing sponsor event');assert(newsText.includes('حملة رقمية'),'business newsroom missing campaign event');

    current=await state();assert(current.businessWorld.events.length<=240&&current.businessWorld.opportunities.length<=120&&current.businessWorld.campaigns.length<=80,'Business World bounded-growth invariant violated');
    assert.deepStrictEqual(errors,[]);
    fs.mkdirSync('.ci-output/ci',{recursive:true});fs.writeFileSync(`.ci-output/ci/build316-business-world-${engineName}.json`,JSON.stringify(evidence,null,2));
    console.log(`BUILD316 business world ${engineName}: PASS (Party master, manual sponsorship/marketing, named incoming/outgoing transfers, state-derived news)`);
  }finally{
    fs.mkdirSync('tests/screenshots',{recursive:true});await page.screenshot({path:`tests/screenshots/build316-business-world-${engineName}.png`}).catch(()=>{});
    await browser.close();await server.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
