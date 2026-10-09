'use strict';
// Build 358, reported from iPhone: "the bank does not open a facility". Opening a bank branch from the world directory
// was rolled back with 'authorization-unsupported-value': every directory site carried energyKind:undefined (only power
// sites set it), and the authorized command payload refuses undefined values (JSON would drop them silently). Since
// Build 340 no test opened a directory site through the UI. Here, for each company whose sites come from the directory
// (bank, power, road, mobility), the real buttons open a site: the directory filtered to the company, then "open".
// The facility exists afterwards (and, for the bank, its branch), the command committed, and nothing was rolled back.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const COMPANIES=['bank','power','road','mobility','telecom','dealership'];
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
      const row=await page.evaluate(c=>{const s=__GH_STATE__,d=window.GH_APP_RUNTIME_METRICS.snapshot().durable.last,f=(s.customHubs||[]).filter(x=>(x.ownerCompanyId||x.company)===c).at(-1),customerSummary=window.GH_CUSTOMER_COMPANIES_CORE.snapshot(s,c)?.[c];return {company:c,facilities:(s.customHubs||[]).filter(x=>(x.ownerCompanyId||x.company)===c).length,kind:f?.kind,sourceKey:f?.sourceKey,owner:f?.ownerCompanyId||f?.company,hrStaff:s.advanced?.facilities?.[f?.id]?.staff||0,customerBranches:customerSummary?.branchCount,branches:s.bank?.branchNetwork?.length||0,command:d?.name,committed:d?.committed};},company);
      results.push(row);
      assert.equal(row.facilities,before+1,`${company}: a facility is opened from the directory (${JSON.stringify(row)}; ${warnings.join(' | ')})`);
      assert.equal(row.committed,true,`${company}: the command committed (${JSON.stringify(row)})`);
      if(company==='bank')assert.equal(row.branches,1,'bank: the branch is open');
      if(company==='telecom'||company==='dealership'){assert.equal(row.owner,company,`${company}: canonical branch owner`);assert.equal(row.kind,company==='telecom'?'telecom-branch':'dealership-branch',`${company}: expected branch facility type`);assert.match(row.sourceKey,new RegExp(`^site:${company}:`),`${company}: directory site source key`);assert.ok(row.hrStaff>0,`${company}: branch staffing is recorded`);assert.equal(row.customerBranches,1,`${company}: branch is visible in its customer-company snapshot`);}
    }
    const customerBranchFlows=await page.evaluate(async()=>{
      const state=window.__GH_STATE__,audit=window.__AUDIT__,telecom=(state.customHubs||[]).find(row=>row.ownerCompanyId==='telecom'&&row.kind==='telecom-branch'),dealer=(state.customHubs||[]).find(row=>row.ownerCompanyId==='dealership'&&row.kind==='dealership-branch');
      state.simSeconds=0;state.godMoney=true;state.infiniteMoney=true;
      await audit.runAuthorizedDomainCommand('customer-companies','create-subscription',{company:'telecom',id:'TEL-BRANCH-CYCLE-1',customerName:'عميل فرع الاتصالات',branchId:telecom.id,planId:'mobile',country:'السعودية',segment:'consumer'},{silent:true});
      state.simSeconds=31*86400;
      const billing=window.GH_CUSTOMER_COMPANIES_CORE.onFinancialDayStages({state,companyId:'telecom'},{day:31});let step;do{step=billing.next();}while(!step.done);
      await audit.runAuthorizedDomainCommand('customer-companies','receive-stock',{company:'dealership',modelId:'corolla',quantity:1,reference:'AUTO-BRANCH-PO-1'},{silent:true});
      await audit.runAuthorizedDomainCommand('customer-companies','retail-sale',{company:'dealership',saleId:'AUTO-BRANCH-SALE-1',customerName:'عميل وكالة الفرع',branchId:dealer.id,modelId:'corolla',quantity:1,termsDays:0},{silent:true});
      const telecomSummary=window.GH_CUSTOMER_COMPANIES_CORE.snapshot(state,'telecom').telecom,dealerSummary=window.GH_CUSTOMER_COMPANIES_CORE.snapshot(state,'dealership').dealership;
      return {telecomInvoice:state.finance.invoices.find(row=>row.sourceRef==='TEL-INV-TEL-BRANCH-CYCLE-1-2026-02')?.businessLocationId,telecomBranch:telecomSummary.branches.find(row=>row.id===telecom.id),dealerInvoice:state.finance.invoices.find(row=>row.sourceRef==='AUTO-SALE-AUTO-BRANCH-SALE-1')?.businessLocationId,dealerBranch:dealerSummary.branches.find(row=>row.id===dealer.id),billingEvent:state.businessWorld.events.some(row=>row.reference==='BILL-telecom-2026-02')};
    });
    assert.equal(customerBranchFlows.telecomInvoice,customerBranchFlows.telecomBranch.id,'telecom monthly invoice keeps the verified branch');
    assert.equal(customerBranchFlows.dealerInvoice,customerBranchFlows.dealerBranch.id,'dealership sale invoice keeps the verified branch');
    assert.equal(customerBranchFlows.telecomBranch.customerCount,1,'telecom branch aggregates its customer without cloning a customer row');
    assert.equal(customerBranchFlows.dealerBranch.sales,1,'dealership branch aggregates its completed sale');
    assert.equal(customerBranchFlows.billingEvent,true,'the monthly invoice batch creates one sourced official news item');
    assert.deepEqual(warnings,[],'no command was rolled back');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build358-directory-open-sites-browser',results}));
    console.log('BUILD358_DIRECTORY_OPEN_SITES_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
