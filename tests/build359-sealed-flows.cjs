'use strict';
// Build 359: a final finance document (a settled invoice, a cashed cheque, an executed transfer, a paid VAT period, a
// repaid debt...) is sealed at the next transaction boundary, and an amendment of a sealed document is refused
// (document-proof-archived-read-only). Every finance flow must therefore amend a document only while it is open, or within
// the transaction that made it final. Checked here, each command in its own transaction after every final document of the
// earlier ones was sealed:
// 1. the finance flows (invoices, receivables, payables, cheques, payment by cheque, payroll, VAT, debt, intercompany
//    loans, due terms, the daily cash settlement) commit, and none amends a sealed document;
// 2. the daily close pattern (paid trip invoices posted and linked to the day's settlement in one transaction) commits;
// 3. linking an invoice sealed in an earlier transaction is refused and leaves the state as it was (the constraint the
//    flows above respect).
const assert=require('node:assert/strict'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Finance=s.GH_FINANCE_CORE,Schema=s.GH_SAVE_SCHEMA;
state.godMoney=true;state.infiniteMoney=true;
const results=[];const test=(name,fn)=>{results.push({name,detail:fn()});console.log(`PASS ${name}`);};
const day=()=>Math.floor((Number(state.simSeconds)||0)/86400);
// One command per transaction; the boundary before it seals every final document the earlier ones left.
const step=(label,command,payload)=>{
  TX.sealCollections(state);
  let value,out;try{out=TX.execute(state,{label,apply:()=>{value=e.command('finance',command,typeof payload==='function'?payload():payload);}});}
  catch(error){throw new Error(`${label}: ${error?.message||error}`);}
  assert.equal(out.committed,true,`${label}: ${out.reason}`);state.simSeconds+=3600;return value;
};
const sealedCount=()=>['invoices','cheques','transfers','periods','debtRecords','payrollReports'].reduce((n,bucket)=>n+(state.finance[bucket]||[]).filter(row=>TX.isSealed(row)).length,0);

test('the finance flows commit after every earlier final document was sealed',()=>{
  const receivable=step('issue-receivable','issue-invoice',{kind:'دخل',amount:4200,company:'air',counterparty:'Customer LLC',note:'sealed flow receivable'});
  step('collect-receivable','collect-receivable',{number:receivable.number,company:'air'});
  const payable=step('issue-payable','issue-invoice',{kind:'مصروف',amount:1300,company:'air',counterparty:'Supplier LLC',note:'sealed flow payable'});
  const cheque=step('issue-cheque','issue-cheque',{company:'air',amount:1300,invoiceNumber:payable.number,requestRef:'SEALED-FLOW-CHQ'});
  step('settle-cheque','settle-cheque',{id:cheque.id});
  step('pay-by-cheque','pay-by-cheque',{company:'air',amount:900,beneficiary:'Supplier LLC',note:'sealed flow purchase',requestRef:'SEALED-FLOW-PBC'});
  step('pay-by-cheque-retry','pay-by-cheque',{company:'air',amount:900,beneficiary:'Supplier LLC',note:'sealed flow purchase',requestRef:'SEALED-FLOW-PBC'});
  step('accrue-expense','accrue-expense',{company:'air',amount:1750,note:'sealed flow transfer payable',method:'قيد مستحق',number:'SEALED-FLOW-TRF'});
  step('settle-payable','settle-payable',{number:'SEALED-FLOW-TRF'});
  step('accrue-payroll','accrue-payroll',{company:'air',amount:2500,note:'sealed flow payroll',number:'SEALED-FLOW-PAY',dueDay:day(),reportId:'SEALED-FLOW-REPORT'});
  step('settle-due-terms','settle-due-terms',()=>({day:day()+1,company:'air'}));
  step('pay-payroll','pay-payroll',{company:'air',amount:3000,note:'sealed flow salaries',reference:'SEALED-FLOW-SALARIES'});
  step('raise-debt','raise-debt',{company:'air',amount:500000,note:'sealed flow credit line',lender:'Bank LLC',termDays:360});
  step('repay-debt','repay-debt',{company:'air',amount:1000});
  step('issue-intercompany-loan','issue-intercompany-loan',{id:'SEALED-FLOW-LOAN',lender:'group',borrower:'air',amount:100000,annualRate:.1,termDays:365});
  state.simSeconds+=40*86400;
  step('repay-intercompany-loan','repay-intercompany-loan',{id:'SEALED-FLOW-LOAN',amount:110000,reference:'SEALED-FLOW-REPAY'});
  step('close-vat-period','close-vat-period',()=>({day:day()}));
  step('pay-taxes','pay-taxes',{company:'air'});
  step('settle-daily-cash','settle-daily-cash',()=>({company:'air',amount:250,grossAmount:250,deductions:0,tripCount:2,day:day(),reference:`DAY-CASH-air-${day()}`}));
  TX.sealCollections(state);
  assert.ok(sealedCount()>10,`final documents were sealed between the flows (${sealedCount()})`);
  assert.equal(Schema.validate(state).ok,true,'the state validates in full');
  return {sealed:sealedCount()};
});

test('the daily close pattern: paid trip invoices linked to the settlement in the same transaction',()=>{
  TX.sealCollections(state);const reference=`DAY-CASH-air-QA-${day()}`;
  const out=TX.execute(state,{label:'daily-close-pattern',apply:()=>{
    const doc=Finance.invoice(state,{kind:'دخل',amount:640,note:'تسوية رحلات يومية QA',method:'تسوية تشغيل يومية',taxable:false,status:'مدفوعة',company:'air',counterparty:'QA source',settlementAccount:'مركز التسوية التشغيلية اليومية'});
    s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'finance','settle-daily-cash',{company:'air',amount:640,grossAmount:640,deductions:0,tripCount:3,invoiceNumbers:[doc.number],day:day()+1,reference},{actor:'financial-close'});
  }});
  assert.equal(out.committed,true,out.reason);
  const linked=state.finance.invoices.find(row=>row.transferReference===reference);assert.ok(linked,'the paid invoice carries the settlement reference');
  TX.sealCollections(state);assert.ok(TX.isSealed(linked),'and is sealed at the next boundary');
  return {reference};
});

test('linking an invoice sealed in an earlier transaction is refused and changes nothing',()=>{
  TX.sealCollections(state);
  const sealed=state.finance.invoices.find(row=>TX.isSealed(row)&&row.status==='مدفوعة'&&row.company==='air'&&row.documentProofId);assert.ok(sealed,'a sealed paid invoice');
  const before=JSON.stringify(state);
  let refused=null;
  try{TX.execute(state,{label:'link-sealed',apply:()=>s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'finance','settle-daily-cash',{company:'air',amount:10,grossAmount:10,deductions:0,tripCount:1,invoiceNumbers:[sealed.number],day:day()+2,reference:'DAY-CASH-air-QA-SEALED'},{actor:'financial-close'})});}catch(error){refused=error;}
  assert.match(String(refused?.message),/document-proof-archived-read-only/);
  assert.equal(JSON.stringify(state),before,'rolled back exactly');
  return {refused:String(refused.message).slice(0,80)};
});

console.log(JSON.stringify({suite:'build359-sealed-flows',results},null,1));
console.log('BUILD359_SEALED_FLOWS_PASS');
