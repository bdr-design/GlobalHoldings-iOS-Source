'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const app=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8'),start=app.indexOf('  function settleOutstandingPayroll(){'),end=app.indexOf('\n  }\n\n  function processFinancialDay',start);
assert(start>=0&&end>start,'the financial owner payroll settlement exists');
const source=app.slice(start,end+4),invoices=[],payables=[],invoiceReads=new Uint32Array(20000),payableReads=[];
for(let index=0;index<20000;index++){
  const number=`PAY-${String(index).padStart(5,'0')}`,invoice={payrollShortfall:index%1000===0,company:'air'};
  Object.defineProperty(invoice,'number',{enumerable:true,get(){invoiceReads[index]++;return number;}});
  invoices.push(invoice);
  const payable={number,total:1000,dueDay:20000-index};if(index%1000===0)payable.payrollShortfall=true;payables.push(payable);
}
let dispatched=0;const order=[];
const context={
  state:{finance:{invoices,payables}},
  companyOperatingBalance:()=>1e9,
  transferBetweenCompaniesSystem:()=>true,
  dispatchSystemCommand:(_ctx,domain,command,payload)=>{assert.equal(domain,'finance');assert.equal(command,'settle-payable');dispatched++;order.push(payload.number);return {ok:true};},
  pushAlert:()=>{},fmtMoney:value=>String(value),console:{warn(){}},
};
const run=vm.runInNewContext(`(()=>{${source};return settleOutstandingPayroll;})()`,context,{filename:'settle-outstanding-payroll.js'});
const result=run();
assert.equal(result.settled,20);assert.equal(result.total,20000);assert.equal(dispatched,20);
assert.deepEqual(order,Array.from({length:20},(_,index)=>`PAY-${String(19000-index*1000).padStart(5,'0')}`),'settlements retain due-date ordering after the linear join');
assert.equal(invoiceReads.reduce((sum,count)=>sum+count,0),20000,'each invoice number is read once to build the map');
console.log(JSON.stringify({suite:'build340-payroll-settlement-index',invoices:invoices.length,payables:payables.length,eligible:result.settled,invoiceNumberReads:invoiceReads.reduce((sum,count)=>sum+count,0),environment:`Node ${process.version}; isolated owner-function harness; not iPhone performance`}));
console.log('PASS payroll owner joins 20k invoices and 20k payables in linear scans and preserves due-date ordering');
