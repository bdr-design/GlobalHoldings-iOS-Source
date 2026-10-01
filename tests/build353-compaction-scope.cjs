'use strict';
// Build 353: daily history compaction uses a scoped rollback snapshot. Prove the
// actual compaction writes stay inside that scope and a failure restores exactly.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
const start=app.indexOf('  function financeAuditArchive(){'),end=app.indexOf('  function normalizeSimulationClocks(){',start);
assert(start>=0&&end>start,'compaction block missing');const block=app.slice(start,end);
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const realTx=global.GH_TRANSACTION_CORE,clone=v=>JSON.parse(JSON.stringify(v)),types=['air','road','bank'];
function makeState(){
 const state={simSeconds:40*86400,saveRevision:1,simulationKernel:{lastCompactDay:-1},assets:Array.from({length:300},(_,i)=>({id:`A${i}`,specs:{capacity:i},staffing:{roles:[{id:'crew',count:2}]}})),realism:{procurement:{deliveries:[{id:'D1'}]}},domainRuntime:{idempotency:{}},
  finance:{journalEntries:[],invoices:[],cheques:[],transfers:[],periods:[],payables:[],receivables:[],auditArchive:{records:{},digests:[]}},companyFinance:{},treasury:{ledger:Array.from({length:1500},(_,i)=>({id:`T${i}`,amount:i}))},supplierTransactions:Array.from({length:3200},(_,i)=>({id:`S${i}`,at:i,amount:i})),alerts:Array.from({length:50},(_,i)=>`alert ${i}`),eventLog:Array.from({length:300},(_,i)=>({id:`E${i}`})),operations:{dailyBriefs:Array.from({length:30},(_,i)=>({day:i}))},bank:{cashSweeps:Array.from({length:60},(_,i)=>({id:i}))}};
 for(const t of types)state.companyFinance[t]={ledger:Array.from({length:400},(_,i)=>({id:`L-${t}-${i}`,at:i*3600,amount:100+i,kind:i%7?'operating':'intercompany',from:i%2?'عميل':'مورد',note:'x'}))};
 for(let i=0;i<500;i++)state.finance.journalEntries.push({id:`J${i}`,at:i*3000,amount:i});
 for(let i=0;i<2700;i++)state.finance.invoices.push({number:`INV-${i}`,at:i,total:i,status:'paid'});
 return state;
}
function api(state,tx){return new Function('state','companyFinanceTypes','companyBook','clone','window',`${block}\nreturn {compactSimulationState,HISTORY_COMPACTION_SCOPE};`)(state,()=>types,t=>state.companyFinance[t],clone,{GH_TRANSACTION_CORE:tx});}
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}
test('compaction writes only declared roots and does not snapshot the fleet',()=>{
 const state=makeState(),assetsBefore=JSON.stringify(state.assets);global.__GH_BUILD339_WRITE_AUDIT__=true;
 try{api(state,realTx).compactSimulationState(true);}finally{delete global.__GH_BUILD339_WRITE_AUDIT__;}
 const metric=realTx.telemetry().last;assert.equal(metric.committed,true);assert.equal(metric.rollbackStorage,'legacy-scoped');
 assert.deepEqual(metric.writeAudit.undeclaredRoots,[]);assert(metric.writeAudit.mutatedRoots.includes('finance'));assert(metric.writeAudit.mutatedRoots.includes('companyFinance'));
 assert.equal(JSON.stringify(state.assets),assetsBefore);assert(state.supplierTransactions.length<=3000);assert(state.alerts.length<=32);return {mutated:metric.writeAudit.mutatedRoots,scope:metric.scopeSize};
});
test('a failure after every compaction write restores the exact state',()=>{
 const state=makeState(),before=JSON.stringify(state);
 const failing={...realTx,execute(target,options){return realTx.execute(target,{...options,apply(...args){options.apply(...args);throw new Error('b353-compaction-fault');}});}};
 assert.throws(()=>api(state,failing).compactSimulationState(true),/b353-compaction-fault/);assert.equal(JSON.stringify(state),before);return {restored:true};
});
const passed=results.filter(r=>r.ok).length;console.log(JSON.stringify({suite:'build353-compaction-scope',passed,total:results.length,results},null,2));if(passed!==results.length)process.exitCode=1;
