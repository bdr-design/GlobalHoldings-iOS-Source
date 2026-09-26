'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Transaction=require('../WebApp/transaction-core.js');
const Finance=require('../WebApp/finance-core.js');

function makeState(openReceivables=0,transferHistory=0){
  const state={simSeconds:0,profile:{name:'Global Holdings',founder:'Founder'},openedCompanies:['air'],companyRegistry:{air:{legalName:'GH Air'}},companyBudgets:{},finance:{},treasury:{accounts:[],ledger:[]},companyFinance:{},cash:0,debt:0,godMoney:false,infiniteMoney:false,businessWorld:{}};
  Finance.ensure(state);Finance.book(state,'air').accounts[0].balance=1e12;Finance.reconcile(state);
  if(openReceivables){
    const invoices=[],receivables=[];
    for(let index=0;index<openReceivables;index++){const number=`OPEN-${String(index).padStart(6,'0')}`,row={number,company:'air',kind:'دخل',amount:100,total:100,status:'مستحقة',note:'existing open invoice'};invoices.push(row);receivables.push({...row});}
    state.finance.invoices=invoices;state.finance.receivables=receivables;
  }
  if(transferHistory)state.finance.transfers=Array.from({length:transferHistory},(_,index)=>({id:`OLD-${index}`,reference:`OLD-${index}`,company:'air',amount:100,kind:'legacy-transfer'}));
  return state;
}
function sellReceipts(state,count,{batch=true,failAfter=Infinity}={}){
  const commit=Transaction.execute(state,{label:`finance-credit-${count}`,apply:()=>{
    const apply=()=>{const rows=[];for(let index=0;index<count;index++){rows.push(Finance.execute({state},'credit',{company:'air',amount:1000,taxable:false,reference:`SALE-RECEIPT-${index}`,note:`Asset sale ${index}`}));if(index+1===failAfter)throw new Error('injected-after-credit');}return rows;};
    return batch?Finance.withCollectionBatch(state,apply):apply();
  }});
  return commit;
}

{
  const batched=makeState(),reference=makeState();
  sellReceipts(batched,24,{batch:true});sellReceipts(reference,24,{batch:false});
  assert.deepEqual(batched,reference,'batched collection indexing preserves invoice, transfer, ledger, cash, and receivable results');
  assert.equal(batched.finance.transfers.filter(row=>row.kind==='revenue-collection').length,24);
  assert.equal(batched.finance.receivables.length,0,'collected rows leave the open-receivable register');
}

{
  const state=makeState(20000,20000);let receivableFilterCalls=0,transferFindCalls=0;
  const rows=state.finance.receivables,watched=new Proxy(rows,{get(target,key,receiver){if(key==='filter')receivableFilterCalls++;return Reflect.get(target,key,receiver);}});
  const transferRows=state.finance.transfers,watchedTransfers=new Proxy(transferRows,{get(target,key,receiver){if(key==='find')transferFindCalls++;return Reflect.get(target,key,receiver);}});
  const originalInvoices=state.finance.invoices.length,originalTransfers=state.finance.transfers.length;
  state.finance.receivables=watched;state.finance.transfers=watchedTransfers;
  const started=performance.now(),result=sellReceipts(state,256,{batch:true}),elapsed=performance.now()-started;
  assert.equal(result.committed,true);
  assert.equal(receivableFilterCalls,1,'the existing 20k receivables are compacted once after the atomic batch, not once per sale');
  assert.equal(transferFindCalls,0,'20k existing transfer rows are indexed once instead of rescanned for every sale');
  assert.equal(state.finance.receivables.length,20000);
  assert.equal(state.finance.invoices.length,originalInvoices+256);
  assert.equal(state.finance.transfers.length,originalTransfers+256);
  assert.equal(state.finance.receivables[0].number,'OPEN-000000','unpaid receivables keep their stable order');
  assert.equal(state.finance.receivables.at(-1).number,'OPEN-019999');
  console.log(JSON.stringify({suite:'build340-finance-transaction-index',openReceivables:20000,priorTransfers:20000,sales:256,transferFindCalls,receivableCompactions:receivableFilterCalls,nodeElapsedMs:+elapsed.toFixed(2),fullSnapshot:Transaction.telemetry().last.rollbackStorage,environment:`Node ${process.version}; synthetic finance state; not iPhone performance`}));
}

{
  const state=makeState(),before=structuredClone(state);
  assert.throws(()=>sellReceipts(state,12,{batch:true,failAfter:5}),/injected-after-credit/);
  assert.deepEqual(state,before,'a mid-batch fault restores all finance arrays and balances byte-for-byte at the object level');
  assert.equal(Transaction.telemetry().last.rollbackStorage,'full-snapshot');
}

{
  const state=makeState(),ref='IDEMPOTENT-COLLECTION-1';
  Transaction.execute(state,{label:'finance-collection-first',apply:()=>Finance.withCollectionBatch(state,()=>Finance.execute({state},'credit',{company:'air',amount:1234,taxable:false,reference:ref}))});
  const invoiceCount=state.finance.invoices.length,transferCount=state.finance.transfers.length,cash=Finance.operating(state,'air');
  const replay=Transaction.execute(state,{label:'finance-collection-replay',apply:()=>Finance.execute({state},'credit',{company:'air',amount:1234,taxable:false,reference:ref})});
  assert.equal(replay.committed,true);assert.equal(state.finance.invoices.length,invoiceCount);assert.equal(state.finance.transfers.length,transferCount);assert.equal(Finance.operating(state,'air'),cash);
  assert.equal(replay.value.number,'AIR-000001');
}

{
  const app=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8'),start=app.indexOf('  function settleOutstandingPayroll(){'),end=app.indexOf('\n  }\n\n  function processFinancialDay',start),source=app.slice(start,end+4);
  assert(start>=0&&end>start,'payroll settlement owner function is present');
  assert.match(source,/const invoiceByNumber=new Map\(\)/);assert.doesNotMatch(source,/invoices\|\|\[\]\)\.find/);
  const saleStart=app.indexOf('  async function sellAllAssets(companyInput){'),saleEnd=app.indexOf('\n  function sellAsset(id)',saleStart),saleSource=app.slice(saleStart,saleEnd);
  assert.match(saleSource,/GH_FINANCE_CORE\.withCollectionBatch\(draft/,'the sale owner encloses the finance batch in the same full-snapshot transaction');
  assert.match(saleSource,/GH_FLEET_CORE\.withDisposalBatch\(draft/,'fleet and finance batches share one transaction boundary');
}

console.log('PASS finance transaction indexes preserve exact collection and rollback outcomes while bounding batch receivable compaction');
