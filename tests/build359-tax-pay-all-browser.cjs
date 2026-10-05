'use strict';
// Build 359, owner report: "I have to pay each company's tax on its own, this is tiring" and "the tax is taken as a
// cheque and a transfer". The taxes view now pays every company whose VAT is due with one approval (one durable command,
// one save): one cheque per company, drawn on that company's account and cashed. Each company's account goes down by
// exactly its due tax, once. The cashing of a cheque is a treasury ledger row; the documents view listed those rows as
// transfers next to the cheque itself, so the transfers list now leaves cheque rows out.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(120000);
    const due=await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,F=GH_FINANCE_CORE,d=GH_COMPANY_PLATFORM.definitionFor(s,'air');
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(400000000,d.founding.minimumCapital),legalName:'QA Tax Air',formationContract:'QA-TAX'},{silent:true});
      for(const [company,amount] of [['group',460000],['air',920000]])await a.runAuthorizedDomainCommand('finance','credit',{company,amount,note:'إيراد خاضع للضريبة',counterparty:'QA Client LLC',reference:`QA-TAX-${company}`,taxable:true},{silent:true});
      await a.runAuthorizedDomainCommand('finance','close-vat-period',{},{silent:true});
      const out={};for(const row of s.finance.periods)if(row.status==='مستحق')out[row.company||'group']=(out[row.company||'group']||0)+Number(row.amount);return out;
    });
    assert.ok(due.group>0&&due.air>0,`VAT is due for two companies: ${JSON.stringify(due)}`);
    const snap=()=>page.evaluate(()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;return {group:F.operating(s,'group'),air:F.operating(s,'air'),cheques:s.finance.cheques.map(row=>({id:row.id,company:row.company,amount:row.amount,status:row.status,beneficiary:row.beneficiary})),open:s.finance.periods.filter(row=>row.status==='مستحق').length,saveRevision:s.saveRevision,valid:GH_SAVE_SCHEMA.validate(s).ok};});
    const cards=async view=>{await page.evaluate(view=>__AUDIT__.openDrawer('invoices',{company:'all',tab:'documents',view}),view);await page.waitForTimeout(100);return page.locator('#drawerBody .doc-art-grid .document-card').count();};
    const cardsBefore={transfers:await cards('transfers'),cheques:await cards('cheques')};
    const before=await snap();
    await page.evaluate(()=>__AUDIT__.openDrawer('invoices',{company:'all',tab:'obligations',view:'taxes'}));
    const button=page.locator('.pay-all-taxes');await button.waitFor({state:'visible'});
    assert.match(await button.textContent(),/\((2|٢)\)/,'the button names the two companies');
    await button.click();await page.waitForFunction(rev=>__GH_STATE__.saveRevision>rev,before.saveRevision);await page.waitForTimeout(150);
    const after=await snap();
    assert.equal(after.open,0,'every due period is paid');
    assert.equal(after.saveRevision,before.saveRevision+1,'one approval, one save');
    const fresh=after.cheques.filter(row=>!before.cheques.some(old=>old.id===row.id));
    assert.deepEqual(fresh.map(row=>row.company).sort(),['air','group'],'one cheque per company');
    for(const cheque of fresh){assert.equal(cheque.status,'مصروف');assert.match(cheque.beneficiary,/هيئة الزكاة والضريبة والجمارك/);assert.ok(Math.abs(cheque.amount-due[cheque.company])<.01);}
    for(const company of ['group','air'])assert.ok(Math.abs((before[company]-after[company])-due[company])<.01,`${company} pays its tax once: ${before[company]} -> ${after[company]} (due ${due[company]})`);
    assert.equal(after.valid,true,'the save validates');
    // The documents view lists the two cheques under cheques and adds nothing under transfers.
    const cardsAfter={transfers:await cards('transfers'),cheques:await cards('cheques')};
    assert.equal(cardsAfter.cheques,cardsBefore.cheques+2,`two cheque cards: ${JSON.stringify({cardsBefore,cardsAfter})}`);
    assert.equal(cardsAfter.transfers,cardsBefore.transfers,`no transfer card for a cheque: ${JSON.stringify({cardsBefore,cardsAfter})}`);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build359-tax-pay-all-browser',due,cheques:fresh.map(row=>row.id),cardsBefore,cardsAfter}));
    console.log('BUILD359_TAX_PAY_ALL_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
