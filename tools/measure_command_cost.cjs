'use strict';
// Build 359 (a tool, not an acceptance gate): what one player command, one save and one daily close cost in work that
// grows with the documents. Builds <cheques> cheques (each issued and cashed: final documents with their proof records),
// a few open payables, then measures, as the median of <runs> runs on a warm process:
//   draftCloneMs      the durable draft a player command starts from (GH_TRANSACTION_CORE.deepClone, shareJournaledRoots)
//   draftValidateMs   the command's trusted schema validation of that draft (after inheritVerified)
//   snapshotMs        a full rollback snapshot (deepClone with shared sealed collections; the staged daily close takes one)
//   saveTextMs        the save text of the state (GH_STATE_CODEC.serialize), cache warm
//   fullValidateMs    a full validation (every proof verified afresh; Build 358 ran one on every tenth save)
//   alertMs           a system alert (operations:record-alert) as a transaction, and whether it copied the whole state
// Usage: node tools/measure_command_cost.cjs [cheques=3000] [runs=5] [root=this source]
// The root argument measures another checkout (for a before/after comparison on one machine).
const path=require('node:path');
const CHEQUES=Math.max(1,Number(process.argv[2]||3000)),RUNS=Math.max(1,Number(process.argv[3]||5)),ROOT=path.resolve(process.argv[4]||path.resolve(__dirname,'..'));
process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Schema=s.GH_SAVE_SCHEMA;e.load('state-codec-core');const Codec=s.GH_STATE_CODEC;
state.godMoney=true;state.infiniteMoney=true;
const clock=()=>performance.now(),median=list=>{const sorted=[...list].sort((a,b)=>a-b);return +sorted[Math.floor(sorted.length/2)].toFixed(1);};
const timed=fn=>{const out=[];for(let i=0;i<RUNS;i++){const started=clock();fn();out.push(clock()-started);}return median(out);};
for(let from=0;from<CHEQUES;from+=250){const out=TX.execute(state,{label:`cost-${from}`,apply:()=>{for(let i=from;i<Math.min(CHEQUES,from+250);i++){const c=e.command('finance','issue-cheque',{company:'air',amount:1000+i,beneficiary:'Supplier LLC',note:'cost',requestRef:`COST-${i}`});e.command('finance','settle-cheque',{id:c.id});}}});if(!out.committed)throw new Error(out.reason);state.simSeconds+=3600;}
// As the daily compaction keeps them: the newest 1,200 cheques and transfers and 2,500 invoices stay live, older rows move
// (copied) to the finance audit archive; ledgers and the journal keep their newest rows.
{const f=state.finance,archive=f.auditArchive=f.auditArchive||{records:{},digests:[]};archive.records=archive.records||{};
 for(const [kind,keep] of [['cheques',1200],['transfers',1200],['invoices',2500]]){const rows=f[kind];if(rows.length<=keep)continue;archive.records[kind]=[...(archive.records[kind]||[]),...rows.slice(keep).map(row=>structuredClone(row))];rows.length=keep;}
 if(f.journalEntries.length>1200)f.journalEntries.length=1200;for(const book of Object.values(state.companyFinance))if(book.ledger.length>1200)book.ledger.length=1200;}
for(let i=0;i<20;i++)e.command('finance','issue-invoice',{kind:'مصروف',amount:100+i,company:'air',counterparty:'Supplier LLC',note:`open ${i}`});
TX.sealCollections?.(state);Schema.validate(state);Schema.validate(state,{trustVerified:true});Codec.serialize(state);
const store=state.documentProofs,report={root:ROOT,cheques:CHEQUES,runs:RUNS,documents:s.GH_DOCUMENT_PROOF.stateDocuments(state).filter(row=>row?.documentProofId).length,records:Object.keys({...(store.archiveById||{}),...store.recordsById}).length,stateMB:+(Buffer.byteLength(JSON.stringify(state))/1e6).toFixed(2)};
report.draftCloneMs=timed(()=>TX.deepClone(state,{shareJournaledRoots:true}));
report.draftValidateMs=median(Array.from({length:RUNS},()=>{const draft=TX.deepClone(state,{shareJournaledRoots:true});Schema.inheritVerified(state,draft);const started=clock();Schema.validate(draft,{trustVerified:true});return clock()-started;}));
report.snapshotMs=timed(()=>TX.deepClone(state,{shareSealed:true}));
report.saveTextMs=timed(()=>Codec.serialize(state));
report.saveTextMB=+(Buffer.byteLength(Codec.serialize(state))/1e6).toFixed(2);
report.fullValidateMs=timed(()=>Schema.validate(state));
{const started=clock(),out=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'operations','record-alert',{id:'COST-ALERT',text:'cost',type:'operation'},{actor:'system-ui-notification'}),last=TX.telemetry().last;report.alertMs=+(clock()-started).toFixed(1);report.alertFullSnapshot=last?.fullSnapshot===true;if(!out?.ok)throw new Error('alert');}
if(typeof Schema.createProofAudit==='function'){const audit=Schema.createProofAudit(),steps=[];let out;do{const started=clock();out=audit.step(state,{maxItems:1000});steps.push(clock()-started);}while(!out.cycleDone);report.auditSteps=steps.length;report.auditStepMs=median(steps);}
console.log(JSON.stringify(report));
