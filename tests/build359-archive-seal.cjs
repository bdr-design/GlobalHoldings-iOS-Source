'use strict';
// Build 359 (owner: a million assets with their invoices, cheques and documents; no work in a command may pass over every
// document or record). Issuing stopped at about 6,000 documents: the proof archive had a 16 MB limit, measured by
// serializing the whole archive every 200 documents, and the finance audit archive grew without end. Checked here:
// - issuing goes on past the old limit, and the save schema accepts the store (no byte limit); Build 359: records are
//   issued compact, so the same records in the whole form of earlier builds are what pass 16 MB;
// - earlier versions become checkpoints in the next pass whatever their age; a period's digest is the sum of its
//   checkpoints' digests, moved by the rows a pass adds or removes; tampering with a checkpoint or a period is refused;
// - a period digest of the earlier form is checked once and rewritten; a tampered one is left and refused;
// - the audit archive keeps 12 game months and at most 20,000 rows: older rows are sealed (proof record and earlier
//   versions leave, one digest per period keeps them, the kind's audit digest takes their count, total and sequence);
//   a row a live document names is kept; every document left verifies and the schema accepts the state;
// - an archived cheque is still found by its request reference through the archive's index.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {harness,minimal,ROOT}=require('./helpers/core-harness'),{wholeRecord}=require('./helpers/legacy-proof-records');
const {s}=harness(['save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core','finance-core']);
const P=s.GH_DOCUMENT_PROOF,T=s.GH_TRANSACTION_CORE,Schema=s.GH_SAVE_SCHEMA,results=[];
const test=(name,fn)=>{try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error?.stack||error).slice(0,2500)});}};
const bytes=value=>Buffer.byteLength(JSON.stringify(value||{}));
function state(){const v=minimal();v.profile={name:'Archive seal',founder:'Founder'};s.GH_FINANCE_CORE.ensure(v);v.finance.auditArchive={records:{invoices:[]},digests:[]};return v;}
// Build 359: a final document (a collected invoice) is sealed and never amended; a document amended here starts open.
function invoice(v,id,at=0,detail='',status='محصلة'){const d={id,number:id,company:'group',counterparty:'Customer / عميل',amount:10,total:10,status,at,...(detail?{lineDetail:detail}:{})};P.sealDocument(v,d,{type:'audit-invoice',companyId:'group'});return d;}
const amend=(v,d,transition,mutate)=>{const out=T.execute(v,{label:`amend-${d.id}`,apply:()=>P.amendDocument(v,d,{transition,mutate})});assert.equal(out.committed,true,out.reason);};

const v=state();
test('issuing goes on past the old 16 MB archive limit',()=>{
  const out=T.execute(v,{label:'fill',apply:()=>{const lines='سطر فاتورة '.repeat(220);for(let i=0;i<9000;i++)v.finance.auditArchive.records.invoices.push(invoice(v,`FILL-${i}`,0,lines));}});
  assert.equal(out.committed,true,out.reason);
  const archive=bytes(v.documentProofs.archiveById),documents=new Map(v.finance.auditArchive.records.invoices.map(d=>[d.documentProofId,d]));
  const whole=Object.values(v.documentProofs.archiveById).reduce((n,row)=>n+bytes(wholeRecord(P,documents.get(row.id),row)),0);
  assert.ok(whole>16*1024*1024,`the same records in the whole form pass 16 MB (${whole}; compact ${archive})`);
  assert.ok(Object.keys(v.documentProofs.recordsById).length<5000,'the hot window stays under 5,000');
  const check=Schema.validate(JSON.parse(JSON.stringify(v)));assert.ok(check.ok,JSON.stringify(check.errors));
  return {records:P.records(v).length,archiveMB:+(archive/1e6).toFixed(1),wholeMB:+(whole/1e6).toFixed(1)};
});

test('earlier versions become checkpoints whatever their age; period sums follow the rows',()=>{
  const live=[];for(let i=0;i<30;i++){const d=invoice(v,`LIVE-${i}`,0,'','مستحقة');v.finance.invoices.push(d);live.push(d);}
  for(const d of live)amend(v,d,'invoice-collected',x=>{x.collectedAt=1;});
  for(const d of live.slice(0,10))amend(v,d,'invoice-transfer-linked',x=>{x.transferRef='TR-1';});
  const first=P.checkpointAncestors(v);assert.equal(first.checkpointed,40,'every earlier version, of this very second');
  const periods=v.documentProofs.periodDigests;assert.ok(Object.values(periods).every(row=>row.form==='sum-v1'),'sum form');
  assert.equal(P.verifyCheckpoints(v,null,{fresh:true}).ok,true,'the sums match a full recomputation');
  for(const d of live)assert.equal(P.verifyDocument(v,d).ok,true);
  // Collecting checkpoints moves the sums down by the collected rows alone.
  const removed=v.finance.invoices.splice(-5);P.compact(v,5000);assert.equal(P.verifyCheckpoints(v,null,{fresh:true}).ok,true,'the sums after removal match');v.finance.invoices.push(...removed);
  const copy=()=>JSON.parse(JSON.stringify(v));
  {const t=copy(),id=Object.keys(t.documentProofs.checkpointsById)[0];t.documentProofs.checkpointsById[id].contentDigest='0'.repeat(64);assert.equal(P.verifyCheckpoints(t,null,{fresh:true}).ok,false,'a changed checkpoint');}
  {const t=copy(),period=Object.keys(t.documentProofs.periodDigests)[0];t.documentProofs.periodDigests[period].digest='f'.repeat(64);assert.equal(P.verifyCheckpoints(t,null,{fresh:true}).ok,false,'a changed sum');}
  {const t=copy(),period=Object.keys(t.documentProofs.periodDigests)[0];t.documentProofs.periodDigests[period].count++;assert.equal(P.verifyCheckpoints(t,null,{fresh:true}).ok,false,'a changed count');}
  return {checkpoints:Object.keys(v.documentProofs.checkpointsById||{}).length};
});

test('a period digest of the earlier form is checked once and rewritten',()=>{
  const legacy=t=>{const rows=Object.values(t.documentProofs.checkpointsById),period=rows[0].period,list=rows.filter(row=>row.period===period).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    const fields=['id','documentId','documentType','companyId','chainDepth','contentDigest','previousProofId','previousContentDigest','transition','createdAtSim','period'];
    t.documentProofs.periodDigests[period]={period,count:list.length,digest:s.GH_AUTHORIZATION.digest(s.GH_AUTHORIZATION.stable(list.map(row=>fields.map(field=>row[field]??null))))};return period;};
  const good=JSON.parse(JSON.stringify(v)),period=legacy(good);assert.equal(P.verifyCheckpoints(good,null,{fresh:true}).ok,false,'the earlier form is not read as a sum');
  assert.equal(P.migratePeriodDigests(good).count,1);assert.equal(good.documentProofs.periodDigests[period].form,'sum-v1');assert.equal(P.verifyCheckpoints(good,null,{fresh:true}).ok,true,'rewritten as its sum');
  const bad=JSON.parse(JSON.stringify(v)),p2=legacy(bad);bad.documentProofs.periodDigests[p2].digest='a'.repeat(64);
  assert.equal(P.migratePeriodDigests(bad).count,0,'a tampered earlier digest is not rewritten');assert.equal(P.verifyCheckpoints(bad,null,{fresh:true}).ok,false,'and is refused');
  return {period};
});

// The audit archive maintenance, as app.js runs it.
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),start=app.indexOf('  function financeAuditArchive()'),end=app.indexOf('  function normalizeSimulationClocks()',start);
test('the audit archive keeps 12 months and at most 20,000 rows; older rows are sealed',()=>{
  const w=state();Object.assign(s,{state:w,clone:x=>x===undefined?undefined:JSON.parse(JSON.stringify(x)),companyFinanceTypes:()=>[],companyBook:()=>null});
  vm.runInContext(app.slice(start,end)+'\nglobalThis.sealApi={auditSealSelection,liveProofIds,sealAuditRound,AUDIT_DETAIL_LIMIT,AUDIT_RETENTION_SECONDS};',s);
  const api=s.sealApi;assert.equal(api.AUDIT_DETAIL_LIMIT,20000);assert.equal(api.AUDIT_RETENTION_SECONDS,365*86400);
  const day=86400,old=[];
  T.execute(w,{label:'old',apply:()=>{for(let i=0;i<600;i++){const d=invoice(w,`INV-${String(i).padStart(5,'0')}`,i*600,'',i<300?'مستحقة':'محصلة');old.push(d);}}});
  // Earlier versions too: half the old invoices were amended before they were archived.
  for(const d of old.slice(0,300)){w.finance.invoices.push(d);amend(w,d,'invoice-collected',x=>{x.collectedAt=2;x.status='محصلة';});}w.finance.invoices=[];
  P.checkpointAncestors(w);w.finance.auditArchive.records.invoices=old.map(d=>JSON.parse(JSON.stringify(d)));
  w.simSeconds=400*day;
  const recent=invoice(w,'INV-RECENT',w.simSeconds-10*day);w.finance.auditArchive.records.invoices=[...w.finance.auditArchive.records.invoices,JSON.parse(JSON.stringify(recent))];
  // A live cheque still names one old invoice: it stays.
  w.finance.cheques.push({id:'CHQ-1',invoiceNumber:'INV-00007',status:'مصروف',amount:10,company:'group'});
  const entry={queue:api.auditSealSelection(),keep:api.liveProofIds()};assert.equal(entry.queue.length,599,'every old row but the named one is due');
  let sealed=0,rounds=0;while(entry.queue.length){sealed+=api.sealAuditRound(entry);rounds++;}
  const left=w.finance.auditArchive.records.invoices.map(row=>row.number).sort();
  assert.deepEqual(left,['INV-00007','INV-RECENT'],'the named and the recent invoice are kept');
  assert.equal(sealed,599);assert.ok(rounds>=3,'in rounds of 200');
  const seals=Object.values(w.documentProofs.sealedPeriods);assert.equal(seals.reduce((n,row)=>n+row.count,0),599,'one digest per period counts every sealed document');
  assert.ok(seals.every(row=>row.form==='sum-v1'&&/^[a-f0-9]{64}$/.test(row.digest)));
  assert.equal(P.records(w).length,2,'the sealed documents\' records left the store');
  assert.deepEqual(Object.values(w.documentProofs.checkpointsById||{}).map(row=>row.documentId),['INV-00007'],'and the checkpoints of their earlier versions (the kept invoice keeps its own)');
  const digest=w.finance.auditArchive.digests.find(row=>row.kind==='invoices');assert.equal(digest.count,599);assert.equal(digest.total,5990);
  for(const row of w.finance.auditArchive.records.invoices)assert.equal(P.verifyDocument(w,row).ok,true);
  const check=Schema.validate(JSON.parse(JSON.stringify(w)));assert.ok(check.ok,JSON.stringify(check.errors));
  {const t=JSON.parse(JSON.stringify(w)),period=Object.keys(t.documentProofs.sealedPeriods)[0];t.documentProofs.sealedPeriods[period].count=0;assert.equal(Schema.validate(t).errors.includes('document-proof-seal'),true,'a broken seal is refused');}
  // Past 20,000 rows, the oldest are sealed even inside the 12 months.
  const filler=Array.from({length:20500},(_,i)=>({id:`J-${i}`,at:w.simSeconds-day+i,amount:1}));w.finance.auditArchive.records.journalEntries=filler;
  const over={queue:api.auditSealSelection(),keep:api.liveProofIds()};assert.equal(over.queue.length,501,'the 502 oldest of 20,502 rows are due but the named invoice (the recent invoice is among them)');
  while(over.queue.length)api.sealAuditRound(over);
  const total=Object.values(w.finance.auditArchive.records).reduce((n,rows)=>n+rows.length,0);assert.equal(total,20001,'20,000 rows and the named invoice');
  assert.equal(w.finance.auditArchive.digests.find(row=>row.kind==='journalEntries').count,500);
  return {sealed,rounds,periods:seals.length};
});

test('an archived cheque is found by its request reference through the archive index',()=>{
  const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));const e=scenario(),st=e.state;st.godMoney=true;st.infiniteMoney=true;
  const issued=e.command('finance','issue-cheque',{company:'air',amount:500,beneficiary:'Supplier LLC',note:'x',requestRef:'ARC-REF-1'});e.command('finance','settle-cheque',{id:issued.id});
  const archive=st.finance.auditArchive=st.finance.auditArchive||{records:{},digests:[]};archive.records=archive.records||{};
  const moving=st.finance.cheques.find(row=>row.id===issued.id);archive.records.cheques=[...(archive.records.cheques||[]),JSON.parse(JSON.stringify(moving))];st.finance.cheques=st.finance.cheques.filter(row=>row!==moving);
  const again=e.command('finance','issue-cheque',{company:'air',amount:500,beneficiary:'Supplier LLC',note:'x',requestRef:'ARC-REF-1'});
  assert.equal(again.idempotent,true);assert.equal(again.id,issued.id,'the archived cheque answers the retry');
  return {id:again.id};
});

const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build359-archive-seal',passed,total:results.length,results},null,1));
if(passed!==results.length)process.exitCode=1;else console.log('BUILD359_ARCHIVE_SEAL_PASS');
