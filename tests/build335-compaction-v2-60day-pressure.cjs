'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
const start=app.indexOf('  function financeAuditArchive(){');
const end=app.indexOf('  function normalizeSimulationClocks(){',start);
assert(start>=0&&end>start,'compaction block missing');
const block=app.slice(start,end);
global.window=global;
require(path.join(ROOT,'WebApp/transaction-core.js'));
const clone=v=>JSON.parse(JSON.stringify(v));
const companyTypes=['air','sea','road','mobility','power','bank'];
function makeState(day=60){
  const state={simSeconds:day*86400,saveRevision:1,simulationKernel:{lastCompactDay:-1},finance:{journalEntries:[],invoices:[],cheques:[],transfers:[],periods:[],auditArchive:{records:{},digests:[]}},companyFinance:{},treasury:{ledger:[]},supplierTransactions:[],alerts:[],eventLog:[],operations:{dailyBriefs:[]},bank:{cashSweeps:[]}};
  for(const t of companyTypes)state.companyFinance[t]={ledger:[]};
  return state;
}
const state=makeState(60);
let journalSeq=0;
function addDay(day,rowsPerCompany=100){
  const base=day*86400;
  for(let j=0;j<140;j++){
    journalSeq++;
    state.finance.journalEntries.push({id:`JRN-${String(journalSeq).padStart(8,'0')}`,at:base+j*300,amount:500+(j%17),note:`journal historical entry ${day}-${j} with realistic descriptive payload`,kind:j%13===0?'intercompany':'journal'});
  }
  for(const [ti,t] of companyTypes.entries()){
    const ledger=state.companyFinance[t].ledger;
    for(let i=0;i<rowsPerCompany;i++){
      const seq=day*10000+ti*1000+i+1;
      const mode=i%10;
      const kind=mode===0?'intercompany':mode===1?'bank-credit':mode===2?'cash-sweep':'operating';
      const isIncome=mode>=3&&mode%2===1;
      ledger.push({id:`LED-${t.toUpperCase()}-${String(seq).padStart(9,'0')}`,at:base+i*700,amount:1000+((i*37+day*19+ti*11)%5000),kind,from:isIncome?'عميل مؤسسي':'مورد تشغيلي',note:isIncome?`إيراد رحلة ${t} ${day}-${i}`:`مصروف تشغيلي ${t} ${day}-${i}`,documentProofId:(day===5&&i===7&&t==='air')?'PROOF-AIR-OLD':undefined,extra:'x'.repeat(72)});
    }
  }
}
for(let d=0;d<60;d++)addDay(d);
function bytes(v){return Buffer.byteLength(JSON.stringify(v),'utf8');}
function classify(row){
  const amt=Number(row.amount)||0,kind=String(row.kind||'');
  if(['intercompany','internal','bank-credit','cash-sweep'].includes(kind))return {income:0,expense:0,intercompany:['intercompany','bank-credit','cash-sweep'].includes(kind)?amt:0};
  const income=String(row.from||'').includes('عميل')||String(row.note||'').includes('إيراد')||String(row.note||'').includes('فاتورة رحلة')?amt:0;
  return {income,expense:income?0:amt,intercompany:0};
}
function truth30(t,currentDay){
  const cut=(currentDay-29)*86400;let income=0,expense=0;
  for(const r of state.companyFinance[t].ledger){if((Number(r.at)||0)<cut)continue;const m=classify(r);income+=m.income;expense+=m.expense;}
  return {income,expense};
}
function truthIC(t){let n=0;for(const r of state.companyFinance[t].ledger)n+=classify(r).intercompany;return n;}
const truths=Object.fromEntries(companyTypes.map(t=>[t,{d30:truth30(t,60),ic:truthIC(t),count:state.companyFinance[t].ledger.length}]));
const before=bytes(state);
const factory=new Function('state','companyFinanceTypes','companyBook','clone','window',`${block}\nreturn {compactSimulationState,financeAuditArchive};`);
const api=factory(state,()=>companyTypes,t=>state.companyFinance[t],clone,global);
api.compactSimulationState(true);
const after=bytes(state);
assert(after<before*0.35,`expected >65% reduction, got before=${before} after=${after}`);
const digests=state.finance.auditArchive.digests;
assert.strictEqual(digests.length,companyTypes.length+1,'exactly one digest per company ledger plus journal');
for(const d of digests){
  assert.strictEqual(d.schema,'gh-finance-audit-digest-v2');
  assert(!('sources' in d)&&!('sourceDocumentIds' in d),'legacy arrays must be absent');
  assert((d.recentDaily||[]).length<=30,'recentDaily bounded');
}
const proof=(state.finance.auditArchive.records['companyLedger-air']||[]).find(r=>r.documentProofId==='PROOF-AIR-OLD');
assert(proof&&proof.id,'old proof row must remain full in archive');
for(const t of companyTypes){
  const d=digests.find(x=>x.kind===`companyLedger-${t}`);assert(d,`digest ${t}`);
  const live=state.companyFinance[t].ledger;
  assert(live.every(r=>Number(r.at)>=58*86400),'only last two days stay live');
  const archive=state.finance.auditArchive.records[`companyLedger-${t}`]||[];
  let ic=Number(d.intercompanyTotal)||0;for(const r of live)ic+=classify(r).intercompany;for(const r of archive)ic+=classify(r).intercompany;
  assert(Math.abs(ic-truths[t].ic)<1e-6,`intercompany total drift ${t}`);
  let income=0,expense=0;const cutDay=31;
  for(const r of live){if(Math.floor(Number(r.at)/86400)<cutDay)continue;const m=classify(r);income+=m.income;expense+=m.expense;}
  for(const r of archive){if(Math.floor(Number(r.at)/86400)<cutDay)continue;const m=classify(r);income+=m.income;expense+=m.expense;}
  for(const row of d.recentDaily||[]){if(Number(row.day)>=cutDay){income+=Number(row.income)||0;expense+=Number(row.expense)||0;}}
  assert(Math.abs(income-truths[t].d30.income)<1e-6,`30d income drift ${t}`);
  assert(Math.abs(expense-truths[t].d30.expense)<1e-6,`30d expense drift ${t}`);
}
const journalDigest=digests.find(x=>x.kind==='journalEntries');
assert(journalDigest&&journalDigest.maxSequence===journalSeq-280,`journal max sequence unexpected ${journalDigest?.maxSequence} vs ${journalSeq-280}`);
// Repeated daily compaction must remain bounded: add 30 more days and compact each day.
const sizes=[];
for(let day=60;day<90;day++){
  state.simSeconds=(day+1)*86400;addDay(day);
  api.compactSimulationState(false);
  sizes.push(bytes(state));
  assert(state.finance.auditArchive.digests.length===companyTypes.length+1,'digest count must stay constant');
  for(const d of state.finance.auditArchive.digests)assert((d.recentDaily||[]).length<=30,'recentDaily remains bounded');
}
const finalBytes=sizes.at(-1),minBytes=Math.min(...sizes),growth=finalBytes-minBytes;
assert(growth<1_500_000,`bounded state grew too much over 30 additional days: ${growth}`);
console.log(JSON.stringify({suite:'build335-compaction-v2-60day-pressure',passed:12,total:12,beforeBytes:before,afterBytes:after,reductionPercent:Number(((1-after/before)*100).toFixed(2)),finalBytes90Days:finalBytes,growthAcrossExtra30Days:growth,digestCount:digests.length,liveAir:state.companyFinance.air.ledger.length,proofArchiveAir:(state.finance.auditArchive.records['companyLedger-air']||[]).length},null,2));
