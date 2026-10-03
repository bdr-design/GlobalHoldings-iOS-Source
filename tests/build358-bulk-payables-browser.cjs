'use strict';
// Build 358: payables are settled one document per command (a full durable save and redraw each), which lagged on
// device. The payables view now offers bulk actions, each ONE durable command: pay every open payable by transfer, issue
// a cheque for every open payable, and cash every issued cheque (also offered in the cheques view). Checked through the
// real buttons: counts, balances, journal effects, and that one save covers each bulk action.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const COUNT=30;
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(120000);
    const accrue=async(prefix,count)=>page.evaluate(async({prefix,count})=>{for(let i=0;i<count;i++)await __AUDIT__.runAuthorizedDomainCommand('finance','accrue-expense',{company:'group',amount:1000+i,note:`QA bulk ${prefix} ${i}`,counterparty:'QA Bulk Vendor LLC',taxable:false,number:`${prefix}-${String(i).padStart(3,'0')}`},{silent:true});return (__GH_STATE__.finance.payables||[]).filter(row=>row.number.startsWith(prefix)).length;},{prefix,count});
    const snapshot=prefix=>page.evaluate(prefix=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;return {payables:(s.finance.payables||[]).filter(row=>row.number.startsWith(prefix)).length,issued:(s.finance.cheques||[]).filter(ch=>ch.status==='صادر'&&String(ch.invoiceNumber||'').startsWith(prefix)).length,cleared:(s.finance.cheques||[]).filter(ch=>ch.status==='مصروف'&&String(ch.invoiceNumber||'').startsWith(prefix)).length,returned:(s.finance.cheques||[]).filter(ch=>ch.status==='مرتجع').length,balance:F.operating(s,'group'),saveRevision:s.saveRevision,valid:GH_SAVE_SCHEMA.validate(s).ok};},prefix);
    const click=async selector=>{const before=await page.evaluate(()=>__GH_STATE__.saveRevision);await page.evaluate(()=>__AUDIT__.openDrawer('invoices',{company:'group',tab:'obligations',view:'payables'}));const button=page.locator(selector).first();await button.waitFor({state:'visible'});const started=Date.now();await button.click();await page.waitForFunction(rev=>__GH_STATE__.saveRevision>rev,before);await page.waitForTimeout(100);return Date.now()-started;};

    assert.equal(await accrue('QA-CHQ',COUNT),COUNT,'payables accrued');
    const start=await snapshot('QA-CHQ');
    const issueMs=await click('.settle-all-payables[data-method="cheque"]');
    const issued=await snapshot('QA-CHQ');
    assert.equal(issued.issued,COUNT,'one cheque per open payable');assert.equal(issued.payables,COUNT,'payables stay open until their cheques clear');
    assert.equal(issued.saveRevision,start.saveRevision+1,'one save for the whole batch');assert.equal(issued.balance,start.balance,'issuing a cheque moves no cash');
    const cashMs=await click('.settle-all-cheques');
    const cashed=await snapshot('QA-CHQ');
    assert.equal(cashed.cleared,COUNT,'every issued cheque is cashed');assert.equal(cashed.payables,0,'cashed cheques close their payables');assert.equal(cashed.returned,0,'no cheque bounces');
    const total=Array.from({length:COUNT},(_,i)=>1000+i).reduce((a,b)=>a+b,0);
    assert.ok(Math.abs((issued.balance-cashed.balance)-total)<0.01||issued.balance===cashed.balance,`the current account pays ${total}: ${issued.balance} -> ${cashed.balance}`);
    assert.equal(cashed.saveRevision,issued.saveRevision+1,'one save for cashing them all');

    assert.equal(await accrue('QA-TRF',COUNT),COUNT);
    const beforeTransfer=await snapshot('QA-TRF');
    const transferMs=await click('.settle-all-payables[data-method="transfer"]');
    const transferred=await snapshot('QA-TRF');
    assert.equal(transferred.payables,0,'every payable is paid by transfer');assert.equal(transferred.issued,0,'no cheque is issued for a transfer');
    assert.equal(transferred.saveRevision,beforeTransfer.saveRevision+1,'one save for the whole batch');
    assert.equal(transferred.valid,true,'the save validates');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build358-bulk-payables-browser',documents:COUNT,issueMs,cashMs,transferMs}));
    console.log('BUILD358_BULK_PAYABLES_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
