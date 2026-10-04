'use strict';
// Build 358, from an iPhone diagnostic (9,000 assets, 1,361 invoices, receivables 0, payables 0): "what we owe" and
// "what we are owed" were always empty. Nothing deleted them: every revenue was invoiced and collected in the same
// call, and every cost was paid at once whenever the account could cover it, so a solvent group never had either.
// Now daily operating revenue is invoiced on 7-day terms and daily operating costs are billed by suppliers on 7-day
// terms; the daily close collects and pays them on their due day.
// 1. Finance Core: terms, idempotent references, the due-day settlement, an uncovered payable stays open.
// 2. The real game (browser): after a few days both lists hold open rows, and each row is settled on its due day.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');
const DAY=86400;

{
  const {s,state,command}=scenario(),F=s.GH_FINANCE_CORE;
  state.simSeconds=10*DAY;
  const cash0=F.operating(state,'air');
  const doc=command('finance','credit',{company:'air',amount:115000,note:'إيراد عقد يومي · QA',taxable:true,reference:'CONTRACT-COLLECT-QA-10',counterparty:'عميل QA',termsDays:7});
  const ar=state.finance.receivables.find(row=>row.number===doc.number);
  assert.ok(ar,'the revenue stays a receivable');assert.equal(ar.dueDay,17);assert.equal(ar.autoSettle,true);assert.equal(ar.paymentTermsDays,7);
  assert.equal(F.operating(state,'air'),cash0,'no cash before the customer pays');
  assert.equal(command('finance','credit',{company:'air',amount:115000,note:'إيراد عقد يومي · QA',taxable:true,reference:'CONTRACT-COLLECT-QA-10',counterparty:'عميل QA',termsDays:7}).number,doc.number,'a repeated reference returns the same invoice');
  assert.equal(state.finance.receivables.length,1);
  const bill=command('finance','accrue-expense',{company:'air',amount:46000,note:'مصروف يومي · فاتورة مورد آجلة',method:'فاتورة مورد آجلة',dueDay:17,number:'AIR-AP-10',paymentTerms:7,counterparty:'موردو QA'});
  const ap=state.finance.payables.find(row=>row.number===bill.number);assert.ok(ap&&ap.autoSettle===true&&ap.dueDay===17,'the cost is a supplier payable on terms');
  const manual=command('finance','accrue-expense',{company:'air',amount:5000,note:'التزام يدوي',dueDay:12,number:'AIR-MANUAL-1'});
  state.simSeconds=16*DAY;
  assert.deepEqual(JSON.parse(JSON.stringify(command('finance','settle-due-terms',{day:16}))),{day:16,collected:0,collectedAmount:0,paid:0,paidAmount:0,unpaid:0},'nothing is due before day 17');
  state.simSeconds=17*DAY;
  const out=command('finance','settle-due-terms',{day:17});
  assert.deepEqual(JSON.parse(JSON.stringify(out)),{day:17,collected:1,collectedAmount:115000,paid:1,paidAmount:46000,unpaid:0});
  assert.equal(F.operating(state,'air'),cash0+115000-46000,'collected and paid on the due day');
  assert.equal(state.finance.receivables.length,0);assert.deepEqual([...state.finance.payables.map(row=>row.number)],[manual.number],'a payable without terms is left to the player');
  assert.ok(state.finance.transfers.some(row=>row.reference==='CONTRACT-COLLECT-QA-10'),'the collection keeps the revenue reference');
  assert.equal(state.finance.invoices.find(row=>row.number===doc.number).status,'محصلة');assert.equal(state.finance.invoices.find(row=>row.number===bill.number).status,'مسددة');
  // An account that cannot cover a due payable leaves it open (no overdraft); it is paid on a later close.
  const big=command('finance','accrue-expense',{company:'air',amount:F.operating(state,'air')+1e6,note:'فاتورة كبيرة',dueDay:18,number:'AIR-AP-BIG',paymentTerms:7});
  state.simSeconds=18*DAY;const short=command('finance','settle-due-terms',{day:18});
  assert.equal(short.unpaid,1);assert.ok(state.finance.payables.some(row=>row.number===big.number),'the uncovered payable stays open');
  assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
  assert.equal((s.GH_INTEGRITY_CORE.check(state).issues||[]).filter(row=>row.severity==='critical').length,0);
  // A payable with an outstanding cheque is settled when the cheque is cashed, never also by transfer on its due day.
  state.godMoney=true;state.infiniteMoney=true;
  const chequedBill=command('finance','accrue-expense',{company:'air',amount:7000,note:'فاتورة بشيك',dueDay:19,number:'AIR-AP-CHQ',paymentTerms:7,counterparty:'موردو QA'});
  assert.equal(F.payableChequeBlocker(state,chequedBill.number),null,'a supplier payable can take a cheque');
  const issued=command('finance','settle-payable',{number:chequedBill.number,method:'cheque'});
  assert.equal(F.payableChequeBlocker(state,chequedBill.number),'cheque-already-issued');
  state.simSeconds=19*DAY;const dueOut=command('finance','settle-due-terms',{day:19});
  assert.equal(dueOut.chequePending,1,'the chequed payable is left to its cheque');
  assert.ok(state.finance.payables.some(row=>row.number===chequedBill.number),'still open until the cheque is cashed');
  const cashed=command('finance','settle-cheque',{id:issued.chequeId});assert.equal(cashed.settled,true,'the cheque cashes (its payable is still there)');
  assert.equal(state.finance.payables.some(row=>row.number===chequedBill.number),false);
  // Payroll payables are paid by transfer only: the bulk cheque command skips them instead of failing.
  const payroll=command('finance','accrue-payroll',{company:'air',amount:3000,note:'رواتب مستحقة',number:'PAY-AIR-QA',dueDay:19,reportId:'PAYROLL-QA'});
  assert.equal(F.payableChequeBlocker(state,payroll.number),'payroll-cheque-not-supported');
  assert.equal(F.payableChequeBlocker(state,'NO-SUCH'),'payable-not-found');
  console.log('PASS finance core: 7-day terms, due-day settlement, uncovered payable kept open, cheque-pending payables, cheque blockers');
}

(async()=>{
  const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(240000);
    await page.evaluate(async()=>{
      const a=__AUDIT__,s=()=>__GH_STATE__;
      for(const type of ['air','power']){const d=GH_COMPANY_PLATFORM.definitionFor(s(),type);await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,d.founding.minimumCapital),legalName:`QA Terms ${type}`,formationContract:`QA-TERMS-${type}`},{silent:true});}
      const airport=GH_WORLD_DATA.airports.find(r=>r[0]==='OMDB');
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-air-OMDB',name:'QA OMDB',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OMDB',code:airport[1],icao:airport[0],iata:airport[1],city:airport[3]||'—',country:String(airport[5]),coords:[airport[6],airport[7]]},bucket:'globalBases'},{silent:true});
      // Daily operating revenue: a signed customer contract (K3, air cargo). Daily operating cost: leases.
      await a.runAuthorizedDomainCommand('contracts','bid',{id:'K3',won:true,number:'GH-CN-QA-TERMS',client:'Nova Devices',sector:'air',title:'QA terms air cargo',value:66000000,termMonths:18},{silent:true});
      await a.runAuthorizedDomainCommand('contracts','sign',{id:'K3',company:'air',companyId:'air',ownerCompanyId:'air',sector:'air',deposit:0,name:'QA terms air cargo',client:'Nova Devices',value:66000000,termMonths:18,taxable:true},{silent:true});
      const lease=[...GH_ASSET_CATALOG.air.used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      if(!await a.buyAsset('air','used',lease.id,'lease',6,'QA-air-OMDB',true,'QA-TERMS-LEASE','air'))throw new Error('lease rejected');
    });
    const advanceDays=async days=>{
      const target=await page.evaluate(n=>(Math.floor(__GH_STATE__.simSeconds/86400)+n)*86400,days);
      await page.evaluate(t=>__AUDIT__.simulationEngine.advanceTo(t,{reason:'qa-terms'}),target);
      await page.waitForFunction(t=>__GH_STATE__.simSeconds>=t&&!__AUDIT__.simulationEngine.snapshot().manualAdvance,target);
    };
    await advanceDays(4);
    const open=await page.evaluate(()=>{const f=__GH_STATE__.finance;return {ar:f.receivables.filter(r=>r.autoSettle).map(r=>({n:r.number,due:r.dueDay,c:r.company})),ap:f.payables.filter(r=>r.autoSettle).map(r=>({n:r.number,due:r.dueDay,c:r.company})),day:__GH_STATE__.lastFinancialDay};});
    assert.ok(open.ar.length>0,`what we are owed holds open receivables: ${JSON.stringify(open)}`);
    assert.ok(open.ap.length>0,`what we owe holds open payables: ${JSON.stringify(open)}`);
    assert.ok([...open.ar,...open.ap].every(row=>row.due>open.day&&row.due<=open.day+7),'all due within 7 days');
    await advanceDays(8);
    const after=await page.evaluate(numbers=>{const f=__GH_STATE__.finance,day=__GH_STATE__.lastFinancialDay,inv=new Map(f.invoices.map(r=>[r.number,r]));return {day,stillOpen:numbers.filter(n=>f.receivables.some(r=>r.number===n)||f.payables.some(r=>r.number===n)),statuses:[...new Set(numbers.map(n=>inv.get(n)?.status))],overdue:[...f.receivables,...f.payables].filter(r=>r.autoSettle&&r.dueDay<=day).length,openNow:{ar:f.receivables.length,ap:f.payables.length},critical:(GH_INTEGRITY_CORE.check(__GH_STATE__).issues||[]).filter(r=>r.severity==='critical').map(r=>r.id),schema:GH_SAVE_SCHEMA.validate(__GH_STATE__).ok};},[...open.ar,...open.ap].map(r=>r.n));
    assert.deepEqual(after.stillOpen,[],'every row from day 4 was settled on its due day');
    assert.deepEqual(after.statuses.sort(),['محصلة','مسددة'].sort());
    assert.equal(after.overdue,0,'nothing on terms is left past its due day');
    assert.ok(after.openNow.ar>0&&after.openNow.ap>0,'new rows keep both lists populated');
    assert.deepEqual(after.critical,[]);assert.equal(after.schema,true);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build358-payment-terms',day4:{ar:open.ar.length,ap:open.ap.length},day:after.day,open:after.openNow}));
    console.log('BUILD358_PAYMENT_TERMS_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
