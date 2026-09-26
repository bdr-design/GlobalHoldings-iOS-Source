'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness,minimal}=require('./helpers/core-harness');
const app=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp/app.js'),'utf8'),start=app.indexOf('  function financeAuditArchive()'),end=app.indexOf('  function normalizeSimulationClocks()',start);assert(start>=0&&end>start);
function context(){
 const {s}=harness(['authorization-core','document-proof-core','finance-core']),state=minimal(),Finance=s.GH_FINANCE_CORE;state.profile={name:'Retention Group'};Finance.ensure(state);
 Object.assign(s,{state,clone:v=>JSON.parse(JSON.stringify(v)),companyFinanceTypes:()=>[],companyBook:()=>null,isFinanceCompany:()=>true,companyFinanceName:x=>x});
 vm.runInContext(app.slice(start,end)+'\nglobalThis.archive=archiveTrim;globalThis.compactGame=compactSimulationState;',s);return {s,state,Finance};
}
const results=[];function test(name,fn){try{results.push({name,passed:true,details:fn()});}catch(e){results.push({name,passed:false,error:e.message});}}
test('open invoice survives history trimming and remains collectible',()=>{
 const {s,state,Finance}=context(),doc=Finance.invoice(state,{number:'DUE-1',kind:'دخل',company:'group',amount:100,taxable:false,status:'مستحقة',counterparty:'Customer'});
 Finance.invoice(state,{number:'RECENT-1',kind:'دخل',company:'group',amount:1,taxable:false,status:'محصلة',counterparty:'Customer'});
 s.archive(state.finance.invoices,1,'invoices');const before=Finance.operating(state,'group');
 const receipt=Finance.execute({state},'collect-receivable',{number:doc.number,company:'group'});
 assert.equal(receipt.amount,100);assert.equal(Finance.operating(state,'group'),before+100);assert(s.GH_DOCUMENT_PROOF.verifyDocument(state,doc).ok);
 s.archive(state.finance.invoices,1,'invoices');assert(state.finance.auditArchive.records.invoices.some(x=>x.number===doc.number));
 return {collected:100,archivedOnlyAfterSettlement:true};
});
test('more than 5000 live debts keep exact source numbers and metadata',()=>{
 const {s,state}=context();for(const name of ['payables','receivables'])state.finance[name]=Array.from({length:5001},(_,i)=>({number:`${name}-${i}`,company:'group',kind:name==='receivables'?'دخل':'مصروف',amount:100,total:100,tax:0,status:'مستحقة',counterparty:`Party-${i}`,dueDay:i,budgetReserved:3,sourceRef:`REF-${i}`}));
 const before=JSON.stringify([state.finance.payables,state.finance.receivables]);s.compactGame(true);assert.equal(JSON.stringify([state.finance.payables,state.finance.receivables])===before,true,'compaction rewrote live debt identities/terms');return {payables:5001,receivables:5001};
});
test('archive copy failure cannot remove source documents',()=>{
 const {s,state}=context();state.finance.invoices=[{number:'RECENT',status:'محصلة'},{number:'OLD',status:'محصلة'}];const before=JSON.stringify(state);
 s.clone=()=>{throw new Error('injected-copy-failure');};assert.throws(()=>s.archive(state.finance.invoices,1,'invoices'),/injected-copy-failure/);assert.equal(JSON.stringify(state)===before,true,'archive copy failure mutated source state');return {rollbackBeforePublication:true};
});
console.log(JSON.stringify({suite:'open-invoice-retention',passed:results.filter(x=>x.passed).length,total:results.length,results},null,2));if(results.some(x=>!x.passed))process.exitCode=1;
