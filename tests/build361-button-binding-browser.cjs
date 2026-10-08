'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,captureInteractions:true,viewport:{width:844,height:390}});page.setDefaultTimeout(60000);
    await page.evaluate(async()=>{const s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;for(const row of GH_COMPANY_PLATFORM.listInstances(s,{includeGroup:false}))if(!row.operational){const d=row.definition;await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type:row.id,companyId:row.id,capital:d.founding.defaultCapital,legalName:`QA ${row.id}`,formationContract:`QA-BUTTON-${row.id}`},{silent:true});}});
    const panels=[['companies','holding'],['companies','subs'],['leadershipHub'],['control'],['peopleHub'],['finance'],['governanceHub'],['compliance'],['groupManagement'],['systemHub'],['settings'],['network'],['routes','all'],['assets','all'],['assetMarket','air'],['companyManage',{type:'air',tab:'overview'}],['companyManage',{type:'bank',tab:'overview'}],['labor','managers:air'],['labor','workforce'],['invoices',{company:'all',tab:'overview'}],['invoices',{company:'all',tab:'documents'}],['invoices',{company:'all',tab:'obligations'}],['monthlyFinance'],['treasury'],['energy'],['bank'],['insurance'],['realestate'],['businessWorld'],['news'],['procurement'],['conference'],['research'],['esg'],['diagnostics'],['controlPlane'],['companyFacilities',{type:'air'}],['companyFacilities',{type:'insurance'}]];
    const report=[];
    for(const [panel,arg] of panels){
      await page.evaluate(([name,value])=>__AUDIT__.openDrawer(name,value),[panel,arg]);await page.waitForTimeout(20);
      const audit=await page.evaluate(()=>{const body=document.querySelector('#drawerBody'),delegated='.god-mode-toggle,.save-now-btn,.sign-charter,[data-save-cap],[data-open-signature]',buttons=[...body.querySelectorAll('button')],unbound=[];for(const button of buttons){if(button.disabled)continue;const direct=button.__qaBoundEvents?.includes('click'),trusted=button.dataset.interactionBound==='1'||button.hasAttribute('data-open')||button.hasAttribute('data-gh-action'),inline=typeof button.onclick==='function',submit=(button.type||'submit')==='submit'&&button.form?.__qaBoundEvents?.includes('submit'),documentRoute=button.matches(delegated);if(!direct&&!trusted&&!inline&&!submit&&!documentRoute)unbound.push({text:String(button.textContent||'').trim().slice(0,80),id:button.id||'',class:button.className||'',html:button.outerHTML.slice(0,240)});}return {buttons:buttons.length,enabled:buttons.filter(row=>!row.disabled).length,unbound};});
      assert.deepEqual(audit.unbound,[],`${panel}: enabled buttons without a bound route: ${JSON.stringify(audit.unbound)}`);report.push({panel,buttons:audit.buttons,enabled:audit.enabled});
    }
    assert.deepEqual(errors,[]);assert(report.reduce((sum,row)=>sum+row.buttons,0)>180,'the audit must cover the real option surface');console.log(JSON.stringify({suite:'build361-button-binding-browser',panels:report.length,buttons:report.reduce((sum,row)=>sum+row.buttons,0),enabled:report.reduce((sum,row)=>sum+row.enabled,0)}));console.log('BUILD361_BUTTON_BINDING_BROWSER_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
