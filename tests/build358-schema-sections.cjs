'use strict';
// Build 358, from the iPhone diagnostic (33,000 assets, 4 companies): the post-commit schema check of every daily close
// ('integrity-final-schema') ran in one 27-37 ms step. GH_SAVE_SCHEMA.validationSteps() runs the same validation in
// sections (fleet and routes, the rest of the books, authorization proofs, document proofs, company platform) and a
// staged transaction runs one section per frame. Proven here:
//  1. draining the sections gives exactly validate()'s result, on a valid state and on states broken in each section;
//  2. a real staged transaction with a control-plane command runs the schema check over several steps, still as the
//     single 'integrity-final-schema' task followed by 'integrity-final', and commits;
//  3. a fault only a late section finds (a tampered signed document) aborts the staged transaction and rolls it back
//     exactly;
//  4. the published validation time counts only the sections' own work, not the frames between them;
//  5. each published section sample names the section and records finite duration and the work actually visited;
//  6. outside a staged transaction a stepped task still runs to the end at once.
const assert=require('node:assert/strict'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Schema=s.GH_SAVE_SCHEMA,CP=s.GH_CONTROL_PLANE,Proof=s.GH_DOCUMENT_PROOF;
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e7;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e7;const item=e.item;
for(let order=0;order<3;order++){
  const qty=2+order,total=item.price*qty;
  const out=TX.execute(state,{label:`sections-seed-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{const r=e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty,manual:true,requestRef:`SECTIONS-${order}`,upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});s.GH_REALISM.onSimulationTime(state,state.simSeconds);return r;})});
  assert.equal(out.committed,true);
}
const drain=(target,options)=>{const steps=Schema.validationSteps(target,options),sections=[];let step;while(!(step=steps.next()).done)sections.push(step.value);return {result:step.value,sections};};
const sectionNames=['fleet-routes','route-state','finance','books','authorization','document-proofs','company-platform'];
const sectionWork=metric=>Array.from(metric.sectionSamples,({name,units})=>({name,units}));
const assertedWork=sample=>Object.values(sample.details.work).reduce((total,value)=>total+(Number.isSafeInteger(value)&&value>=0?value:0),0);
// Build 359: a final document (the seed's paid purchases) is sealed, frozen and never edited; the tampered document is an
// open payable, which the business rules may still amend.
e.command('finance','issue-invoice',{kind:'مصروف',amount:1000,company:'air',counterparty:'Supplier LLC',note:'QA open payable'});
const signed=()=>Proof.stateDocuments(state).find(row=>row?.documentProofId&&!TX.isSealed(row)&&Number(row.amount??row.total)>0);

// 1. Same result as validate(), section by section, valid and broken.
{
  for(const trustVerified of [false,true]){
    const whole=Schema.validate(state,{trustVerified}),wholeMetric=Schema.telemetry().lastValidation,stepped=drain(state,{trustVerified}),steppedMetric=Schema.telemetry().lastValidation;
    assert.equal(whole.ok,true,`seeded state validates: ${whole.errors}`);assert.deepEqual(stepped.result,whole);
    assert.deepEqual(stepped.sections,['fleet-routes','route-state','finance','books','authorization','document-proofs'],`sections in order: ${stepped.sections}`);
    assert.deepEqual(Array.from(steppedMetric.sectionSamples,row=>row.name),sectionNames,'telemetry includes every executed section, including the final non-yielding section');
    assert.deepEqual(sectionWork(steppedMetric).filter(row=>!['authorization','document-proofs'].includes(row.name)),sectionWork(wholeMetric).filter(row=>!['authorization','document-proofs'].includes(row.name)),'sections without verification caches execute the same visits');
    for(const sample of steppedMetric.sectionSamples){assert.equal(Number.isFinite(sample.durationMs)&&sample.durationMs>=0,true,`${sample.name}: finite duration`);assert.equal(Number.isSafeInteger(sample.units)&&sample.units>=0,true,`${sample.name}: integer work units`);assert.equal(sample.units,assertedWork(sample),`${sample.name}: units are exactly the measured work breakdown`);}
  }
  const breaks=[
    ['fleet-routes',target=>{target.customRoutes.push({id:'QA-BAD-ROUTE',routeMode:'air',ownerCompanyId:'air',fromFacility:'B1',toFacility:'B1',route:[[0,0]]});},()=>{state.customRoutes=state.customRoutes.filter(route=>route.id!=='QA-BAD-ROUTE');}],
    ['books',target=>{target.finance.invoices.push({number:'QA-BAD-INV',total:10,amount:12,tax:0,subtotal:10});},()=>{state.finance.invoices=state.finance.invoices.filter(row=>row.number!=='QA-BAD-INV');}],
    ['document-proofs',()=>{const document=signed(),field=document.amount!==undefined?'amount':'total';document.__qa={field,value:document[field]};document[field]=Number(document[field])+1;},()=>{const document=Proof.stateDocuments(state).find(row=>row?.__qa);document[document.__qa.field]=document.__qa.value;delete document.__qa;}]
  ];
  for(const [section,breakIt,repair] of breaks){
    breakIt(state);
    for(const trustVerified of [false,true]){const whole=Schema.validate(state,{trustVerified}),stepped=drain(state,{trustVerified});assert.equal(whole.ok,false,`${section}: broken state is invalid`);assert.deepEqual(stepped.result,whole,`${section}: same errors (${whole.errors})`);}
    repair();assert.equal(Schema.validate(state).ok,true,`${section}: repaired`);
  }
  console.log('PASS sections give exactly validate() on valid and broken states');
}

// A compressed million-row fleet performs one class visit while retaining the
// logical fleet size as context. The reference row scan reports every callback
// it actually executes; units never substitute the logical size for that work.
{
  const scale=scenario(),ss=scale.s,scaleState=scale.state,realFleet=ss.GH_FLEET_DATA,MILLION=1_000_000;
  const asset={id:'N-AIR-00000001',name:'QA Aircraft',model:'QA-1',status:'active',assetMode:'air',type:'air',ownerCompanyId:'air',baseFacility:'B1',phase:'idle',progress:0,fuel:100,condition:100};
  ss.GH_FLEET_DATA=Object.freeze({...realFleet,mode:()=> 'store',size:()=>MILLION,idCollisions:()=>({duplicate:false,missing:false}),forEachFieldClasses(_state,_fields,fn){fn(asset,MILLION,{index:0,members:MILLION,forEachMember:cb=>cb(asset,0)});return {classes:1,singles:0};},forEachFields(_state,_fields,fn){for(let index=0;index<MILLION;index++)fn(asset,index);}});
  ss.GH_SAVE_SCHEMA.validate(scaleState);const compressedMetric=ss.GH_SAVE_SCHEMA.telemetry().lastValidation,compressed=compressedMetric.sectionSamples.find(row=>row.name==='fleet-routes'),compressedCompany=compressedMetric.sectionSamples.find(row=>row.name==='company-platform');
  ss.GH_SAVE_SCHEMA.validate(scaleState,{assetScan:'rows'});const rowMetric=ss.GH_SAVE_SCHEMA.telemetry().lastValidation,rows=rowMetric.sectionSamples.find(row=>row.name==='fleet-routes'),rowCompany=rowMetric.sectionSamples.find(row=>row.name==='company-platform');
  assert.equal(compressed.details.logicalRows,MILLION);assert.equal(compressed.details.work.assetFieldVisits,1,'one compressed class is one executed visit');assert.ok(compressed.units<100,`compressed units stay physical: ${compressed.units}`);
  assert.equal(rows.details.logicalRows,MILLION);assert.equal(rows.details.work.assetFieldVisits,MILLION,'the reference scan reports every executed row visit');assert.ok(rows.units>=MILLION);
  assert.equal(compressedCompany.details.logicalRows,MILLION);assert.equal(compressedCompany.details.work.assetFieldVisits,1,'company validation also counts its compressed class visit');assert.ok(compressedCompany.units<100);
  assert.equal(rowCompany.details.logicalRows,MILLION);assert.equal(rowCompany.details.work.assetFieldVisits,MILLION,'company row validation reports every row callback');assert.ok(rowCompany.units>=MILLION);
  console.log(`PASS compressed ${MILLION} logical assets report ${compressed.units} work units; row scan reports ${rows.units}`);
}

// Finance work is recorded where nested rows are already visited. Adding
// accounts, journal lines and budget lines raises units by precisely those
// loop iterations without a second enumeration for telemetry.
{
  Schema.validate(state,{trustVerified:true});const before=Schema.telemetry().lastValidation,beforeWork=before.financeWork,beforeUnits=before.sectionSamples.find(row=>row.name==='finance').units;
  const accounts=state.companyFinance.air.accounts,accountStart=accounts.length,journal=state.finance.journalEntries,journalStart=journal.length,budgetKey='qaTelemetryNested',budgetCount=257,lineCount=1024,accountCount=513;
  for(let index=0;index<accountCount;index++)accounts.push({id:`QA-ACCOUNT-${index}`,balance:0});
  journal.push({id:'QA-JOURNAL-NESTED',lines:Array.from({length:lineCount},(_,index)=>index<lineCount/2?{debit:1,credit:0}:{debit:0,credit:1})});
  state.companyBudgets[budgetKey]={enabled:false,limit:0,spent:0,reserved:0,lines:Object.fromEntries(Array.from({length:budgetCount},(_,index)=>[`line-${index}`,0])),spentByLine:{},reservedByLine:{}};
  const result=Schema.validate(state,{trustVerified:true}),after=Schema.telemetry().lastValidation,afterWork=after.financeWork,afterUnits=after.sectionSamples.find(row=>row.name==='finance').units;
  assert.equal(result.ok,true,`nested finance fixture remains valid: ${result.errors}`);assert.equal(afterWork.accountRows-beforeWork.accountRows,accountCount);assert.equal(afterWork.journalRows-beforeWork.journalRows,1);assert.equal(afterWork.journalLineRows-beforeWork.journalLineRows,lineCount);assert.equal(afterWork.budgetRows-beforeWork.budgetRows,1);assert.equal(afterWork.budgetLineRows-beforeWork.budgetLineRows,budgetCount);
  assert.equal(afterUnits-beforeUnits,accountCount+1+lineCount+1+budgetCount,'finance units equal the nested rows actually visited');
  accounts.length=accountStart;journal.length=journalStart;delete state.companyBudgets[budgetKey];assert.equal(Schema.validate(state,{trustVerified:true}).ok,true);
  console.log(`PASS finance units grow by ${afterUnits-beforeUnits} actual nested visits`);
}

// 5. Work units come from the validation walks themselves. Unsigned live
// finance documents still cost collection/inspection work even though the
// proof maps do not grow, and a sealed archive memo must remain unenumerated.
{
  Schema.validate(state,{trustVerified:true});const before=Schema.telemetry().lastValidation,beforeWork=before.documentProofWork,beforeUnits=before.sectionSamples.find(row=>row.name==='document-proofs').units;
  const count=2048,start=state.finance.transfers.length;for(let index=0;index<count;index++)state.finance.transfers.push({id:`QA-UNSIGNED-${index}`,reference:`QA-UNSIGNED-${index}`,amount:1,status:'executed'});
  const result=Schema.validate(state,{trustVerified:true}),after=Schema.telemetry().lastValidation,afterWork=after.documentProofWork,afterUnits=after.sectionSamples.find(row=>row.name==='document-proofs').units;
  assert.equal(result.ok,true,`unsigned document fixture remains valid: ${result.errors}`);assert.equal(afterWork.archiveMode,'same');assert.equal(afterWork.archiveDocuments,0,'a trusted same-version pass does not enumerate sealed archive documents');assert.equal(afterWork.checkpointRows,0);assert.equal(afterWork.sealRows,0);assert.equal(afterWork.liveDocuments,beforeWork.liveDocuments+count);assert.equal(afterUnits,beforeUnits+count,'document-proof units must scale with actual live document visits');
  state.finance.transfers.length=start;assert.equal(Schema.validate(state,{trustVerified:true}).ok,true);
  console.log(`PASS document-proof work units scale by ${count} live documents without walking the sealed archive`);
}

// 2-3. A staged transaction runs the schema check across steps, and a late-section fault rolls it back.
const stagedRun=(mutate)=>{
  CP.ensure(state);const before=JSON.stringify(state);
  const handle=TX.beginStaged(state,{label:'qa-schema-sections',apply:function*(){
    CP.execute(state,{name:'QA_SECTIONS',domain:'qa',actor:'qa'},()=>{state.profile.qaSections=(state.profile.qaSections||0)+1;mutate?.();return true;},{deferIntegrityToTransaction:true,atomic:false});
    yield 'work';return true;
  }});
  const stages=[];let guard=0;while(!handle.done&&guard++<200){handle.step(-Infinity);stages.push(handle.stage);}
  return {handle,stages,before,telemetry:TX.telemetry().last};
};
{
  const ok=stagedRun(null);
  assert.equal(ok.handle.error,null,String(ok.handle.error));assert.equal(ok.handle.result?.committed,true);
  const tasks=ok.telemetry.postCommitCriticalTasks.map(row=>row.key);
  assert.deepEqual(tasks,['integrity-final-schema','integrity-final'],`one schema task then the business check: ${tasks}`);
  const sectionSteps=ok.stages.filter(stage=>stage.startsWith('post-commit:'));
  assert.deepEqual(sectionSteps,['post-commit:fleet-routes','post-commit:route-state','post-commit:finance','post-commit:books','post-commit:authorization','post-commit:document-proofs'],`one step per section: ${ok.stages}`);
  assert.ok(ok.telemetry.postCommitCriticalTasks.every(row=>row.ok&&Number.isFinite(row.durationMs)),'both tasks recorded');
  delete state.profile.qaSections;
  console.log(`PASS staged schema check over ${ok.stages.length} steps: ${ok.stages.join(',')}`);
}
{
  // The tamper is written by the command itself, so the schema check after the commit is the one to find it.
  const document=signed(),field=document.amount!==undefined?'amount':'total',original=document[field];
  const bad=stagedRun(()=>{document[field]=Number(original)+1;});
  assert.ok(bad.handle.error&&/SAVE_SCHEMA_INTEGRITY/.test(bad.handle.error.message)&&/document-proof-integrity/.test(bad.handle.error.message),`late-section fault aborts: ${bad.handle.error}`);
  assert.ok(bad.stages.includes('post-commit:authorization'),`it was found in a later step: ${bad.stages}`);
  assert.equal(document[field],original,'the tampered field is restored');
  assert.equal(JSON.stringify(state),bad.before,'the staged transaction rolled back exactly');
  console.log('PASS a fault found by a late section rolls the staged transaction back exactly');
}

// 4. Paused time between sections is not counted.
{
  const steps=Schema.validationSteps(state,{trustVerified:true});let step,waited=0;
  while(!(step=steps.next()).done){const until=Date.now()+15;while(Date.now()<until){}waited+=15;}
  assert.equal(step.value.ok,true);
  const metric=Schema.telemetry().lastValidation;
  assert.ok(metric.totalMs<waited,`published time ${metric.totalMs} ms excludes ${waited} ms of pauses`);
  assert.ok(Math.abs(metric.totalMs-(metric.authorizationMs+metric.documentProofMs+metric.companyPlatformMs+metric.otherMs))<0.5,'sections add up');
  assert.ok(Math.abs(metric.totalMs-metric.sectionSamples.reduce((total,row)=>total+row.durationMs,0))<0.5,'section samples add up to active validation time');
  console.log(`PASS validation time ${metric.totalMs.toFixed(2)} ms excludes ${waited} ms of pauses`);
}

// 6. Outside staging: a stepped critical task runs at once (execute) and outside any transaction (afterCommit).
{
  let sections=0,done=false;
  const out=TX.execute(state,{label:'qa-sections-plain',apply:()=>{TX.afterCommit(function*(){sections++;yield 'a';sections++;yield 'b';done=true;},{critical:true,key:'qa-stepped'});return true;}});
  assert.equal(out.committed,true);assert.equal(done,true);assert.equal(sections,2);
  done=false;TX.afterCommit(function*(){yield 'x';done=true;});assert.equal(done,true,'no transaction: runs to the end');
  console.log('PASS stepped tasks run at once outside a staged transaction');
}
console.log('BUILD358_SCHEMA_SECTIONS_PASS');
