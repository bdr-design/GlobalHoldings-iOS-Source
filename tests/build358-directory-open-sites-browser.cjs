'use strict';
// Build 358, reported from iPhone: "the bank does not open a facility". Opening a bank branch from the world directory
// was rolled back with 'authorization-unsupported-value': every directory site carried energyKind:undefined (only power
// sites set it), and the authorized command payload refuses undefined values (JSON would drop them silently). Since
// Build 340 no test opened a directory site through the UI. Here, for each company whose sites come from the directory
// (bank, power, road, mobility), the real buttons open a site: the directory filtered to the company, then "open".
// The facility exists afterwards (and, for the bank, its branch), the command committed, and nothing was rolled back.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const COMPANIES=['bank','power','road','mobility'];
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[],warnings=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390}});page.setDefaultTimeout(60000);
    page.on('console',message=>{if(message.type()==='warning'&&/rolled back/i.test(message.text()))warnings.push(message.text().slice(0,300));});
    await page.evaluate(async companies=>{
      const a=__AUDIT__,s=()=>__GH_STATE__;s().godMoney=true;s().infiniteMoney=true;
      for(const type of companies){const d=GH_COMPANY_PLATFORM.definitionFor(s(),type);await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(900000000,d.founding.minimumCapital),legalName:`QA ${type}`,formationContract:`QA-DIR-${type}`},{silent:true});}
    },COMPANIES);
    const results=[];
    for(const company of COMPANIES){
      const before=await page.evaluate(c=>(__GH_STATE__.customHubs||[]).filter(f=>(f.ownerCompanyId||f.company)===c).length,company);
      await page.evaluate(()=>__AUDIT__.openDrawer('network'));
      await page.locator('#worldKind').selectOption(company);
      const open=page.locator('#drawerBody .open-directory-site').first();
      await open.waitFor({state:'visible'});await open.click();
      await page.waitForFunction(([c,n])=>(__GH_STATE__.customHubs||[]).filter(f=>(f.ownerCompanyId||f.company)===c).length>n||window.GH_APP_RUNTIME_METRICS?.snapshot?.().durable?.last?.committed===false,[company,before],{timeout:30000}).catch(()=>{});
      const row=await page.evaluate(c=>{const s=__GH_STATE__,d=window.GH_APP_RUNTIME_METRICS.snapshot().durable.last;return {company:c,facilities:(s.customHubs||[]).filter(f=>(f.ownerCompanyId||f.company)===c).length,branches:s.bank?.branchNetwork?.length||0,command:d?.name,committed:d?.committed};},company);
      results.push(row);
      assert.equal(row.facilities,before+1,`${company}: a facility is opened from the directory (${JSON.stringify(row)}; ${warnings.join(' | ')})`);
      assert.equal(row.committed,true,`${company}: the command committed (${JSON.stringify(row)})`);
      if(company==='bank')assert.equal(row.branches,1,'bank: the branch is open');
    }
    assert.deepEqual(warnings,[],'no command was rolled back');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build358-directory-open-sites-browser',results}));
    console.log('BUILD358_DIRECTORY_OPEN_SITES_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
