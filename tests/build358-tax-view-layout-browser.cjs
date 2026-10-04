'use strict';
// Build 358, reported with a screenshot (iPad landscape): in Finance > Taxes a company with a tax credit showed its name
// one letter per line. The row is a two-column grid; the credit note ("رصيد ضريبي دائن … يُخصم من ضريبة المبيعات القادمة")
// sat in the amounts column (auto width), widened it to the note's full length and squeezed the name column to nothing.
// The note now spans the row on its own line and the name column keeps a minimum width.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    for(const viewport of [{width:1000,height:460},{width:844,height:390},{width:390,height:844}]){
      const {page}=await boot({browser,errors,viewport});
      await page.evaluate(async()=>{
        const a=__AUDIT__,s=()=>__GH_STATE__;s().godMoney=true;s().infiniteMoney=true;
        for(const type of ['air','sea']){const d=GH_COMPANY_PLATFORM.definitionFor(s(),type);await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,d.founding.minimumCapital),legalName:type==='air'?'شركة الطيران العالمية القابضة للنقل الجوي':'الشركة البحرية العالمية',formationContract:`QA-TAX-${type}`},{silent:true});}
        // Input VAT with no sales: a tax credit carried to the next periods.
        await a.runAuthorizedDomainCommand('finance','accrue-expense',{company:'air',amount:115000000,note:'QA taxed purchase',counterparty:'QA Vendor LLC',taxable:true,number:'QA-TAX-CREDIT'},{silent:true});
        a.openDrawer('invoices',{company:'all',tab:'obligations',view:'taxes'});
      });
      await page.locator('.tax-company-live-row').first().waitFor({state:'visible',timeout:30000});
      const rows=await page.evaluate(()=>[...document.querySelectorAll('.tax-company-live-row')].map(row=>{const name=row.querySelector(':scope>span>b'),box=name.getBoundingClientRect(),line=parseFloat(getComputedStyle(name).lineHeight)||16,note=[...row.querySelectorAll('small')].find(el=>/رصيد ضريبي دائن/.test(el.textContent));return {name:name.textContent.trim(),width:Math.round(box.width),height:Math.round(box.height),lines:Math.round(box.height/line),note:note?{text:note.textContent.trim(),rowWidth:Math.round(row.getBoundingClientRect().width),width:Math.round(note.getBoundingClientRect().width)}:null};}));
      const air=rows.find(row=>/الطيران/.test(row.name));
      assert.ok(air,`the air company row: ${JSON.stringify(rows)}`);
      assert.ok(air.note&&/رصيد ضريبي دائن/.test(air.note.text),'the credit note is shown');
      for(const row of rows){
        assert.ok(row.width>=80,`${viewport.width}px: the company name keeps its width (${JSON.stringify(row)})`);
        assert.ok(row.lines<=3,`${viewport.width}px: the company name reads on at most three lines, not one letter per line (${JSON.stringify(row)})`);
      }
      assert.ok(air.note.width>=air.note.rowWidth*0.8,'the credit note spans the row');
      console.log(`PASS ${viewport.width}x${viewport.height}`,JSON.stringify(rows.map(row=>({name:row.name,width:row.width,lines:row.lines}))));
      await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log('BUILD358_TAX_VIEW_LAYOUT_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
