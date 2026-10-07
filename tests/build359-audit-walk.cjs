'use strict';
// Build 359, after the fourth iPhone diagnostic: the proof audit (GH_SAVE_SCHEMA.createProofAudit) began each phase by
// copying the proof maps into one object and listing every id ({...archive,...hot}), listing every document
// (stateDocuments) and grouping every checkpoint, all in one step outside its time budget. It now reads the maps and lists
// in place (GH_DOCUMENT_PROOF.walkDocuments, checkpointAuditSteps), one item per pull. Checked here:
// 1. a cycle visits every authorization proof, proof record, document and checkpoint once, in steps of at most maxItems;
// 2. no step copies or lists a proof map (Object.keys/entries/values and object spread on the stores are not used);
// 3. documents put at the head of a list while the walk is suspended do not make it skip or repeat the others;
// 4. a tampered checkpoint row and a tampered period digest are each found within one cycle (by the chain of the record
//    that links to them, or by the checkpoint walk, which finds both on its own);
// 5. the checkpoint walk takes the maps of one version: maps replaced during the cycle (a period dropped, as a seal round
//    drops one) raise no false fault.
const assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Proof=s.GH_DOCUMENT_PROOF,Schema=s.GH_SAVE_SCHEMA;
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e9;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e9;const item=e.item;
const results=[];const test=(name,fn)=>{results.push({name,detail:fn()});console.log(`PASS ${name}`);};
for(let order=0;order<60;order++){
  state.simSeconds+=1800;const total=item.price;
  const out=TX.execute(state,{label:`walk-seed-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty:1,manual:true,requestRef:`WALK-${order}`,upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true}))});
  assert.equal(out.committed,true,out.reason);
}
for(let i=0;i<120;i++){const c=e.command('finance','issue-cheque',{company:'air',amount:900+i,beneficiary:'Supplier LLC',note:'walk',requestRef:`WALK-CHQ-${i}`});e.command('finance','settle-cheque',{id:c.id});}
for(;;){const out=Proof.checkpointAncestors(state);if(!out.checkpointed)break;}
TX.sealCollections(state);assert.equal(Schema.validate(state).ok,true,'the seeded state validates');
const store=state.documentProofs,auth=state.authorization||{};
const counts={authorization:Object.keys(auth.proofsById||{}).length+Object.keys(auth.proofArchiveById||{}).length,records:Object.keys(store.recordsById).length+Object.keys(store.archiveById||{}).length,documents:Proof.stateDocuments(state).filter(row=>row?.documentProofId).length,checkpoints:Object.keys(store.checkpointsById||{}).length,periods:Object.keys(store.periodDigests||{}).length};
assert.ok(counts.checkpoints>50&&counts.periods>0&&counts.documents>100,JSON.stringify(counts));
const cycle=(target,maxItems)=>{const audit=Schema.createProofAudit(),phases={};let steps=0,out;do{out=audit.step(target,{maxItems});assert.equal(out.ok,true,JSON.stringify(out));assert.ok(out.checked<=maxItems);steps++;}while(!out.cycleDone&&steps<100000);return {steps,checked:out.totalChecked,cycles:out.cycles};};

test('a cycle visits every proof, record, document and checkpoint once, in bounded steps',()=>{
  const out=cycle(state,25),expected=counts.authorization+counts.records+counts.documents+1+counts.checkpoints+counts.periods;
  assert.equal(out.checked,expected,`visited ${out.checked}, expected ${expected} (${JSON.stringify(counts)})`);
  assert.ok(out.steps>=Math.ceil(expected/25),'in steps of at most 25 items');assert.equal(out.cycles,1);
  return {...counts,steps:out.steps};
});

test('no step copies or lists a proof map',()=>{
  // The scripts' realm Object, with its listing functions counting calls on the proof and authorization maps.
  const realm=vm.runInContext('Object',s),maps=new Set([store.recordsById,store.archiveById,store.checkpointsById,store.periodDigests,auth.proofsById,auth.proofArchiveById].filter(Boolean));
  const original={keys:realm.keys,entries:realm.entries,values:realm.values,assign:realm.assign};let listed=0;
  for(const name of Object.keys(original))realm[name]=function(target,...rest){if(maps.has(target))listed++;return original[name].call(this,target,...rest);};
  let out;try{out=cycle(state,40);}finally{Object.assign(realm,original);}
  assert.equal(listed,0,`proof maps listed ${listed} times`);
  // Object spread does not go through Object.assign: the source of createProofAudit and of the walks has none on the maps.
  const source=require('node:fs').readFileSync(path.join(ROOT,'WebApp/save-schema.js'),'utf8'),start=source.indexOf('function createProofAudit()'),end=source.indexOf('\n  }\n',source.indexOf('return {step,restart',start));
  assert.ok(start>0&&end>start);assert.doesNotMatch(source.slice(start,end),/\.\.\.\(?\s*(store|auth)\??\.(recordsById|archiveById|checkpointsById|proofsById|proofArchiveById)/);
  return {steps:out.steps,listed};
});

test('documents put at the head of a list during the walk do not make it skip or repeat',()=>{
  const list=state.finance.cheques,walk=Proof.walkDocuments(state),seen=new Map();let added=0,next;
  while(!(next=walk.next()).done){seen.set(next.value,(seen.get(next.value)||0)+1);if(seen.size%17===0&&added<20){list.unshift({id:`WALK-HEAD-${added}`,status:'صادر',amount:1});added++;}}
  for(let i=0;i<added;i++)list.shift();
  const all=Proof.stateDocuments(state);assert.ok(all.every(row=>seen.get(row)===1),'every document present from the start was given exactly once');
  assert.equal([...seen.values()].filter(count=>count!==1).length,0,'none twice');
  return {documents:all.length,addedDuringWalk:added};
});

test('a tampered checkpoint row and a tampered period digest are found within one cycle',()=>{
  const find=target=>{const audit=Schema.createProofAudit();for(let i=0;i<100000;i++){const out=audit.step(target,{maxItems:30});if(!out.ok)return out;if(out.cycleDone)return null;}return null;};
  const rowCopy=JSON.parse(JSON.stringify(state)),id=Object.keys(rowCopy.documentProofs.checkpointsById)[3];rowCopy.documentProofs.checkpointsById[id].contentDigest='f'.repeat(64);
  // The record linking to the tampered checkpoint fails its chain first, or the checkpoint walk finds the row.
  const rowFault=find(rowCopy);assert.ok(rowFault&&rowFault.errors.some(error=>/^document-proof-(checkpoint|record-integrity)$/.test(error)),JSON.stringify(rowFault));
  const periodCopy=JSON.parse(JSON.stringify(state)),period=Object.keys(periodCopy.documentProofs.periodDigests)[0];periodCopy.documentProofs.periodDigests[period].digest='0'.repeat(64);
  const periodFault=find(periodCopy);assert.ok(periodFault&&periodFault.errors.some(error=>/^document-proof-(checkpoint|record-integrity)$/.test(error)),JSON.stringify(periodFault));
  // The checkpoint walk alone (no record links to these rows) finds both as well.
  for(const copy of [rowCopy,periodCopy]){const walk=Proof.checkpointAuditSteps(copy);let next;while(!(next=walk.next()).done){}assert.equal(next.value.ok,false,JSON.stringify(next.value));}
  assert.equal(Schema.validate(rowCopy).ok,false);assert.equal(Schema.validate(periodCopy).ok,false);
  return {row:rowFault.fault,period:periodFault.fault};
});

test('the checkpoint walk keeps one version of the maps: a replaced map raises no false fault',()=>{
  const copy=JSON.parse(JSON.stringify(state)),audit=Schema.createProofAudit();let out,replaced=false;
  for(let i=0;i<100000;i++){
    out=audit.step(copy,{maxItems:7});assert.equal(out.ok,true,JSON.stringify(out));
    // Mid-way through the checkpoints, a writer replaces both maps with a version without one period (as a seal round does).
    if(!replaced&&out.phase==='checkpoints'&&out.totalChecked>counts.authorization+counts.records+counts.documents+10){
      const cp=copy.documentProofs,period=Object.keys(cp.periodDigests)[0],rows={...cp.checkpointsById};for(const [key,row] of Object.entries(rows))if(row.period===period)delete rows[key];
      const periods={...cp.periodDigests};delete periods[period];cp.checkpointsById=rows;cp.periodDigests=periods;replaced=true;
    }
    if(out.cycleDone)break;
  }
  assert.ok(replaced&&out.cycleDone,'the maps were replaced during the cycle and the cycle finished clean');
  // Without the walk's own version, the half-walked old period sums would not match the new period map.
  const fresh=Proof.checkpointAuditSteps(copy);let next;while(!(next=fresh.next()).done){}assert.equal(next.value.ok,true,'the new version of the maps is consistent on its own');
  return {cycles:out.cycles};
});

console.log(JSON.stringify({suite:'build359-audit-walk',results},null,1));
console.log('BUILD359_AUDIT_WALK_PASS');
