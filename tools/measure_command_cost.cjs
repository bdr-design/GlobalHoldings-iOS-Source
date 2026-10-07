'use strict';
// Build 359 (a tool, not an acceptance gate): what one player command, one save and one daily close cost in work that
// grows with the documents. Builds <cheques> cheques (each issued and cashed: final documents with their proof records),
// a few open payables, then measures, as the median of <runs> runs on a warm process:
//   draftCloneMs      the durable draft a player command starts from (GH_TRANSACTION_CORE.deepClone, shareJournaledRoots)
//   draftValidateMs   the command's trusted schema validation of that draft (after inheritVerified), and its parts
//   snapshotMs        a full rollback snapshot (deepClone with shared sealed collections; the staged daily close takes one)
//   proofStoreMB      the proof store's JSON (records, archive, checkpoints); Build 359: records are issued compact
//   saveTextMs        the save text of the state (GH_STATE_CODEC.serialize), cache warm
//   saveChunkedMs     the native save's text (sealed collections' text as vault chunks, as serializeChunked does)
//   lookupMs          one command's first finance lookups (the transaction's transfer and invoice indexes, a cheque by id)
//   fullValidateMs    a full validation (load, import, a confirmed audit fault)
//   alertMs           a system alert (operations:record-alert) as a transaction, and whether it copied the whole state
//   auditFirstStepMs, auditMaxStepMs  proof audit steps with the 4 ms budget of an idle render callback
// With several sizes (cheques=3000,6000,...) it also prints, for each measure, its growth in ms per 1,000 documents
// between the smallest and the largest size: the work of one command that still grows with the documents.
// Usage: node tools/measure_command_cost.cjs [cheques=3000[,6000...]] [runs=5] [root=this source]
// The root argument measures another checkout (for a before/after comparison on one machine).
const path=require('node:path');
const SIZES=String(process.argv[2]||3000).split(',').map(value=>Math.max(1,Number(value)||0)).filter(Boolean),RUNS=Math.max(1,Number(process.argv[3]||5)),ROOT=path.resolve(process.argv[4]||path.resolve(__dirname,'..'));
process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const clock=()=>performance.now(),median=list=>{const sorted=[...list].sort((a,b)=>a-b);return +sorted[Math.floor(sorted.length/2)].toFixed(1);};
const timed=fn=>{const out=[];for(let i=0;i<RUNS;i++){const started=clock();fn();out.push(clock()-started);}return median(out);};
function measure(CHEQUES){
 const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Schema=s.GH_SAVE_SCHEMA;e.load('state-codec-core');const Codec=s.GH_STATE_CODEC;
 state.godMoney=true;state.infiniteMoney=true;
 for(let from=0;from<CHEQUES;from+=250){const out=TX.execute(state,{label:`cost-${from}`,apply:()=>{for(let i=from;i<Math.min(CHEQUES,from+250);i++){const c=e.command('finance','issue-cheque',{company:'air',amount:1000+i,beneficiary:'Supplier LLC',note:'cost',requestRef:`COST-${i}`});e.command('finance','settle-cheque',{id:c.id});}}});if(!out.committed)throw new Error(out.reason);state.simSeconds+=3600;}
 // As the daily compaction keeps them: the newest 1,200 cheques and transfers and 2,500 invoices stay live, older rows move
 // (copied) to the finance audit archive; ledgers and the journal keep their newest rows.
 {const f=state.finance,archive=f.auditArchive=f.auditArchive||{records:{},digests:[]};archive.records=archive.records||{};
  for(const [kind,keep] of [['cheques',1200],['transfers',1200],['invoices',2500]]){const rows=f[kind];if(rows.length<=keep)continue;archive.records[kind]=[...(archive.records[kind]||[]),...rows.slice(keep).map(row=>structuredClone(row))];rows.length=keep;}
  if(f.journalEntries.length>1200)f.journalEntries.length=1200;for(const book of Object.values(state.companyFinance))if(book.ledger.length>1200)book.ledger.length=1200;}
 for(let i=0;i<20;i++)e.command('finance','issue-invoice',{kind:'مصروف',amount:100+i,company:'air',counterparty:'Supplier LLC',note:`open ${i}`});
 TX.sealCollections?.(state);Schema.validate(state);Schema.validate(state,{trustVerified:true});Codec.serialize(state);
 const store=state.documentProofs,report={root:ROOT,cheques:CHEQUES,runs:RUNS,documents:s.GH_DOCUMENT_PROOF.stateDocuments(state).filter(row=>row?.documentProofId).length,records:Object.keys({...(store.archiveById||{}),...store.recordsById}).length,stateMB:+(Buffer.byteLength(JSON.stringify(state))/1e6).toFixed(2),proofStoreMB:+(Buffer.byteLength(JSON.stringify(store))/1e6).toFixed(2)};
 report.draftCloneMs=timed(()=>TX.deepClone(state,{shareJournaledRoots:true}));
 report.draftValidateMs=median(Array.from({length:RUNS},()=>{const draft=TX.deepClone(state,{shareJournaledRoots:true});Schema.inheritVerified(state,draft);const started=clock();Schema.validate(draft,{trustVerified:true});return clock()-started;}));
 {const draft=TX.deepClone(state,{shareJournaledRoots:true});Schema.inheritVerified(state,draft);Schema.validate(draft,{trustVerified:true});const last=Schema.telemetry().lastValidation||{};report.draftValidateParts=Object.fromEntries(Object.entries(last).filter(([key,value])=>/Ms$/.test(key)&&typeof value==='number').map(([key,value])=>[key,+value.toFixed(1)]));}
 report.snapshotMs=timed(()=>TX.deepClone(state,{shareSealed:true}));
 report.saveTextMs=timed(()=>Codec.serialize(state));
 // The native save (the iPhone's): sealed collections' text goes to the vault as chunks (fleet rows too, absent here),
 // the save text references them.
 report.saveChunkedMs=timed(()=>{const steps=Codec.serializeSteps(state,{textChunks:[]});let step;while(!(step=steps.next()).done){}return step.value;});
 report.saveTextMB=+(Buffer.byteLength(Codec.serialize(state))/1e6).toFixed(2);
 report.fullValidateMs=timed(()=>Schema.validate(state));
 {const started=clock(),out=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'operations','record-alert',{id:'COST-ALERT',text:'cost',type:'operation'},{actor:'system-ui-notification'}),last=TX.telemetry().last;report.alertMs=+(clock()-started).toFixed(1);report.alertFullSnapshot=last?.fullSnapshot===true;if(!out?.ok)throw new Error('alert');}
 // The first finance lookups of a command: the transaction builds its transfer and invoice indexes from the live lists.
 {const cheque=state.finance.cheques[Math.floor(state.finance.cheques.length/2)];
  report.lookupMs=timed(()=>TX.execute(state,{label:'cost-lookup',apply:()=>{const F=s.GH_FINANCE_CORE;F.execute({state},'settle-cheque',{id:cheque.id});F.execute({state},'issue-cheque',{company:'air',amount:cheque.amount,beneficiary:cheque.beneficiary,note:'cost',requestRef:cheque.requestRef});F.execute({state},'settle-daily-cash',{company:'air',amount:0,day:1,reference:'COST-LOOKUP-NONE'});}}));}
 {const audit=Schema.createProofAudit(),steps=[];let out;do{const started=clock();out=audit.step(state,{maxItems:1e9,budgetMs:4});steps.push(clock()-started);}while(!out.cycleDone&&steps.length<1e6);report.auditSteps=steps.length;report.auditFirstStepMs=+steps[0].toFixed(1);report.auditMaxStepMs=+Math.max(...steps).toFixed(1);}
 return report;
}
const reports=SIZES.map(measure);for(const report of reports)console.log(JSON.stringify(report));
if(reports.length>1){
  const low=reports[0],high=reports[reports.length-1],documents=high.documents-low.documents,growth={};
  for(const key of Object.keys(high))if(/Ms$/.test(key)&&typeof high[key]==='number'&&typeof low[key]==='number')growth[key]=+((high[key]-low[key])/documents*1000).toFixed(2);
  for(const key of Object.keys(high.draftValidateParts||{}))if(key!=='recordedAtMs')growth[`draftValidate.${key}`]=+(((high.draftValidateParts[key]||0)-(low.draftValidateParts?.[key]||0))/documents*1000).toFixed(2);
  console.log(JSON.stringify({msPer1000Documents:growth,between:[low.documents,high.documents]}));
}
