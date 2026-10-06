'use strict';
// Build 359 (owner: a million assets with their invoices, cheques and documents): what one document costs as the game
// grows. Builds <background> cheques (each issued and cashed: two proof records) in commands of 250, then measures one
// command issuing <batch> cheques and one cashing them, and reports the proof store's size.
// Usage: node tools/measure_document_scale.cjs [background=1500] [batch=200]
const path=require('node:path'),ROOT=path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Proof=s.GH_DOCUMENT_PROOF;
state.godMoney=true;state.infiniteMoney=true;
const BACKGROUND=Math.max(0,Number(process.argv[2]??1500)),BATCH=Math.max(1,Number(process.argv[3]??200));
const issue=index=>e.command('finance','issue-cheque',{company:'air',amount:1000+index,beneficiary:'Supplier LLC',note:'scale',requestRef:`SCALE-${index}`});
const cash=id=>e.command('finance','settle-cheque',{id});
const command=(label,apply)=>{const out=TX.execute(state,{label,apply});if(!out.committed)throw new Error(out.reason||'rejected');};
const clock=()=>performance.now(),megabytes=value=>+(Buffer.byteLength(JSON.stringify(value||{}))/1e6).toFixed(2);
const report={background:BACKGROUND,batch:BATCH,failed:null};let started=clock();
try{for(let from=0;from<BACKGROUND;from+=250){command(`background-${from}`,()=>{for(let i=from;i<Math.min(BACKGROUND,from+250);i++)cash(issue(i).id);});state.simSeconds+=3600;}}
catch(error){report.failed=`background, ${Proof.records(state).length} records: ${error.message}`;}
report.backgroundMsPerCheque=BACKGROUND?+((clock()-started)/BACKGROUND).toFixed(2):null;
if(!report.failed){
  const ids=[];started=clock();
  try{command('measure-issue',()=>{for(let i=0;i<BATCH;i++)ids.push(issue(BACKGROUND+i).id);});report.issueMsPerCheque=+((clock()-started)/BATCH).toFixed(2);
    started=clock();command('measure-cash',()=>{for(const id of ids)cash(id);});report.cashMsPerCheque=+((clock()-started)/BATCH).toFixed(2);}
  catch(error){report.failed=`measured batch: ${error.message}`;}
}
const store=state.documentProofs;
Object.assign(report,{hotRecords:Object.keys(store.recordsById).length,archivedRecords:Object.keys(store.archiveById||{}).length,checkpoints:Object.keys(store.checkpointsById||{}).length,hotMB:megabytes(store.recordsById),archiveMB:megabytes(store.archiveById),liveCheques:state.finance.cheques.length});
console.log(JSON.stringify(report));if(report.failed)process.exitCode=1;
