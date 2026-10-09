'use strict';
// Build 359 (owner: a million assets with their documents; no command may walk every document): the parts of the state
// that grow with the game (the finance audit archive's collections, the archived proof records, the checkpoints and
// period sums, the authorization proof archive) are replaced by their writers, never edited. Each is sealed whole (a
// container, GH_TRANSACTION_CORE {container:true}); its writers declare what each new version changed (deriveContainer).
// Checked here:
// 1. the containers are sealed whole: a durable draft and a rollback snapshot share them, a write into one throws;
// 2. a trusted validation answers an unchanged archive part without listing it (no Object.keys/values/entries on it) and
//    the save reuses its layout without comparing its members;
// 3. after maintenance (new checkpoints, records moved to the archive) a trusted validation checks only the changes and
//    agrees with a full validation;
// 4. a tampered record or document entering the archive in a declared change is refused; a removed record still needed
//    by an archived document, an undeclared replacement and an unverified checkpoint each send the check to the full
//    pass, which reports the fault;
// 5. the authorization proof archive is answered by its version without listing it, and a tampered replacement is found.
const assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Proof=s.GH_DOCUMENT_PROOF,Schema=s.GH_SAVE_SCHEMA;
e.load('state-codec-core');const Codec=s.GH_STATE_CODEC;
state.godMoney=true;state.infiniteMoney=true;
const results=[];const test=(name,fn)=>{results.push({name,detail:fn()});console.log(`PASS ${name}`);};
let sequence=0;
const cheques=count=>{const out=TX.execute(state,{label:`container-seed-${sequence}`,apply:()=>{for(let i=0;i<count;i++,sequence++){const c=e.command('finance','issue-cheque',{company:'air',amount:700+sequence,beneficiary:'Supplier LLC',note:'container',requestRef:`CONTAINER-${sequence}`});e.command('finance','settle-cheque',{id:c.id});}}});assert.equal(out.committed,true,out.reason);state.simSeconds+=3600;};
// As the daily compaction does (app.js archiveFull): rows leave the live lists as copies appended to a new archive
// collection, declared as a change of the old one.
const archiveLive=keep=>{const f=state.finance,archive=f.auditArchive=f.auditArchive||{records:{},digests:[]};archive.records=archive.records||{};
  for(const kind of ['cheques','transfers']){const rows=f[kind];if(rows.length<=keep)continue;const copies=rows.slice(keep).map(row=>structuredClone(row)),base=archive.records[kind]||[],next=[...base,...copies];if(base.length)TX.deriveContainer(next,base,{changed:copies});archive.records[kind]=next;rows.length=keep;}};
for(let i=0;i<4;i++)cheques(100);archiveLive(60);
for(;;){if(!Proof.checkpointAncestors(state).checkpointed)break;}
// Move the oldest hot records to the archive, as admission does.
for(let i=0;i<2;i++){const store=state.documentProofs,hot=store.recordsById,moving=Object.values(hot).filter(row=>!state.finance.cheques.some(c=>c.documentProofId===row.id)&&!state.finance.transfers.some(t=>t.documentProofId===row.id)).slice(0,60);if(!moving.length)break;const next={...(store.archiveById||{})},nextHot={...hot};for(const row of moving){next[row.id]=row;delete nextHot[row.id];}if(store.archiveById&&Object.keys(store.archiveById).length)TX.deriveContainer(next,store.archiveById,{changed:moving.map(row=>row.id)});store.archiveById=next;store.recordsById=nextHot;}
TX.sealCollections(state);
assert.equal(Schema.validate(state).ok,true,'the seeded state validates in full');
const draftOf=()=>{const draft=TX.deepClone(state,{shareJournaledRoots:true});Schema.inheritVerified(state,draft);return draft;};
const answered=()=>Schema.telemetry().lastValidation?.documentArchiveAnswered;
const containers=()=>{const store=state.documentProofs,records=state.finance.auditArchive.records,out={archiveById:store.archiveById,checkpointsById:store.checkpointsById,periodDigests:store.periodDigests};for(const [kind,list] of Object.entries(records))if(list.length)out[kind]=list;return out;};

test('the growing parts are sealed whole and shared by drafts and snapshots',()=>{
  const now=containers();
  for(const [name,value] of Object.entries(now)){assert.ok(value&&TX.isSealed(value)&&Object.isFrozen(value),`${name} is sealed whole`);}
  const draft=TX.deepClone(state,{shareJournaledRoots:true}),snapshot=TX.deepClone(state,{shareSealed:true});
  for(const target of [draft,snapshot]){assert.equal(target.documentProofs.archiveById,now.archiveById);assert.equal(target.documentProofs.checkpointsById,now.checkpointsById);assert.equal(target.finance.auditArchive.records.cheques,now.cheques);}
  assert.throws(()=>{now.archiveById.x={};},TypeError);assert.throws(()=>now.cheques.push({}),TypeError);
  return {archived:Object.keys(now.archiveById).length,checkpoints:Object.keys(now.checkpointsById).length,archivedCheques:now.cheques.length};
});

test('an unchanged archive part is answered without listing it, and the save reuses its layout',()=>{
  Schema.validate(draftOf(),{trustVerified:true});Codec.serialize(state);
  // The large containers (the archived records, the checkpoints, the audit archive collections); small ones (period sums)
  // are written into the save text as they are.
  const watched=new Set(Object.entries(containers()).filter(([name])=>name!=='periodDigests').map(([,value])=>value)),realm=vm.runInContext('Object',s),original={keys:realm.keys,values:realm.values,entries:realm.entries};let listed=0;
  for(const name of Object.keys(original))realm[name]=function(target,...rest){if(watched.has(target))listed++;return original[name].call(this,target,...rest);};
  let check,layout;
  try{const draft=draftOf();check=Schema.validate(draft,{trustVerified:true});const before=Codec.cacheStats().layout.hits;Codec.serialize(state);layout=Codec.cacheStats().layout.hits-before;}finally{Object.assign(realm,original);}
  assert.equal(check.ok,true);assert.equal(answered(),1,'answered by the memo');
  assert.equal(listed,0,`the archive containers were listed ${listed} times`);assert.ok(layout>0);
  return {listed,layoutHits:layout};
});

test('after maintenance the trusted check takes only the changes and agrees with a full one',()=>{
  const rounds=[],changeVisits=[];
  for(let round=0;round<3;round++){
    cheques(30);archiveLive(60);
    // Amend live documents and checkpoint their old versions (maintenance).
    Proof.checkpointAncestors(state);TX.sealCollections(state);
    const check=Schema.validate(draftOf(),{trustVerified:true}),work=Schema.telemetry().lastValidation.documentProofWork;rounds.push(answered());
    assert.equal(check.ok,true,JSON.stringify(check.errors));
    assert.equal(work.archiveMode,'changes','the changed sealed version uses the incremental path');const visits=Object.entries(work).filter(([key,value])=>key.startsWith('change')&&Number.isSafeInteger(value)).reduce((total,[,value])=>total+value,0);assert.ok(visits>0,`changed rows are represented in work units: ${JSON.stringify(work)}`);changeVisits.push(visits);
  }
  assert.ok(rounds.every(value=>value===1),`answered by the changes each round (${rounds})`);
  assert.equal(Schema.validate(state).ok,true,'a full validation agrees');
  return {rounds,changeVisits};
});

test('faults in the changes are refused, and changes that do not add up go to the full pass',()=>{
  Schema.validate(draftOf(),{trustVerified:true});
  // Build 359: records are issued compact; one whose document is kept is tampered in a content input (its issue time).
  const store=state.documentProofs,id=Object.keys(store.archiveById).find(key=>store.archiveById[key].form===Proof.COMPACT_FORM&&Proof.locateDocument(state,key)),record=store.archiveById[id];
  const restore={archiveById:store.archiveById,checkpointsById:store.checkpointsById},cases={};
  const run=(name,setup)=>{setup();TX.sealCollections(state);const check=Schema.validate(draftOf(),{trustVerified:true});cases[name]={ok:check.ok,errors:check.errors,answered:answered()};Object.assign(store,restore);assert.equal(Schema.validate(draftOf(),{trustVerified:true}).ok,true,`${name}: restored`);return check;};
  // A tampered record written as a declared change.
  const tampered=structuredClone(record);tampered.issuedAtSim+=1;
  let check=run('declared tampered record',()=>{const next={...store.archiveById,[id]:tampered};TX.deriveContainer(next,store.archiveById,{changed:[id]});store.archiveById=next;});
  assert.equal(check.ok,false);
  // The same replacement undeclared: the full pass finds it.
  check=run('undeclared tampered record',()=>{store.archiveById={...store.archiveById,[id]:tampered};});
  assert.equal(check.ok,false);assert.equal(cases['undeclared tampered record'].answered,0,'verified in full');
  // A record removed while an archived document still carries it.
  const carried=state.finance.auditArchive.records.cheques.find(row=>store.archiveById[row.documentProofId])?.documentProofId;assert.ok(carried);
  check=run('removed record still needed',()=>{const next={...store.archiveById};delete next[carried];TX.deriveContainer(next,store.archiveById,{removed:[carried]});store.archiveById=next;});
  assert.equal(check.ok,false);assert.equal(cases['removed record still needed'].answered,0,'sent to the full pass');
  // A checkpoint that no trusted writer made.
  const checkpointId=Object.keys(store.checkpointsById)[0],forged={...structuredClone(store.checkpointsById[checkpointId]),id:'DOCP-FORGED',contentDigest:'a'.repeat(64)};
  check=run('unverified checkpoint',()=>{const next={...store.checkpointsById,[forged.id]:forged};TX.deriveContainer(next,store.checkpointsById,{changed:[forged.id]});store.checkpointsById=next;});
  assert.equal(check.ok,false);assert.equal(cases['unverified checkpoint'].answered,0,'sent to the full pass');
  // A tampered document entering the audit archive as a declared change.
  const records=state.finance.auditArchive.records,base=records.cheques,live=state.finance.cheques[state.finance.cheques.length-1],copy={...structuredClone(live),amount:live.amount+5};
  const next=[...base,copy];TX.deriveContainer(next,base,{changed:[copy]});records.cheques=next;TX.sealCollections(state);
  check=Schema.validate(draftOf(),{trustVerified:true});records.cheques=base;
  assert.equal(check.ok,false);assert.ok(check.errors.some(error=>/document-proof-(reference|integrity)/.test(error)),JSON.stringify(check.errors));
  assert.equal(Schema.validate(draftOf(),{trustVerified:true}).ok,true);
  return Object.fromEntries(Object.entries(cases).map(([name,value])=>[name,{ok:value.ok,answered:value.answered}]));
});

test('the authorization proof archive is answered by its version, and a fault in it still found',()=>{
  const A=s.GH_AUTHORIZATION;
  A.ensurePrincipal(state,{id:'founder',legalName:'Founder'});A.createVisualSeal(state,{ownerPersonId:'founder',strokes:[[{x:.1,y:.2},{x:.55,y:.65},{x:.9,y:.3}]]});A.createDefaultMandate(state,{principalId:'founder',companyIds:['*'],scopes:['audit.*']});A.registerCommandTargetResolver('audit',()=>['group']);
  const ctx=A.authorize(state,A.buildActiveEnvelope(state,{domain:'audit',name:'post',payload:{amount:1},idempotencyKey:'CONTAINER-CTX',actor:{principalId:'founder'}}));
  for(let i=0;i<40;i++)A.issueProof(state,ctx,{commandId:`CONTAINER-AUTH-${i}`,documentIds:[`CONTAINER-DOC-${i}`],documentDigests:['b'.repeat(64)]});
  // Move the oldest proofs to the archive, as admission does (a new version declaring the proofs it added).
  const auth=state.authorization,moving=Object.values(auth.proofsById).slice(0,30),base=auth.proofArchiveById||{},next={...base},hot={...auth.proofsById};
  for(const row of moving){next[row.id]=row;delete hot[row.id];}if(Object.keys(base).length)TX.deriveContainer(next,base,{changed:moving.map(row=>row.id)});auth.proofArchiveById=next;auth.proofsById=hot;
  TX.sealCollections(state);assert.ok(TX.isSealed(auth.proofArchiveById),'the proof archive is sealed whole');
  assert.equal(TX.deepClone(state,{shareJournaledRoots:true}).authorization.proofArchiveById,auth.proofArchiveById,'and shared by a draft');
  assert.equal(Schema.validate(state).ok,true);Schema.validate(draftOf(),{trustVerified:true});
  const realm=vm.runInContext('Object',s),original={keys:realm.keys,values:realm.values,entries:realm.entries};let listed=0;
  for(const name of Object.keys(original))realm[name]=function(target,...rest){if(target===auth.proofArchiveById)listed++;return original[name].call(this,target,...rest);};
  let check;try{check=Schema.validate(draftOf(),{trustVerified:true});}finally{Object.assign(realm,original);}
  assert.equal(check.ok,true);assert.equal(listed,0,`the proof archive was listed ${listed} times`);
  // A tampered proof replacing an archived one (a new version): found.
  const id=Object.keys(auth.proofArchiveById)[0],tampered={...structuredClone(auth.proofArchiveById[id]),proofDigest:'c'.repeat(64)},kept=auth.proofArchiveById;
  auth.proofArchiveById={...kept,[id]:tampered};TX.sealCollections(state);
  const bad=Schema.validate(draftOf(),{trustVerified:true});auth.proofArchiveById=kept;
  assert.equal(bad.ok,false);assert.ok(bad.errors.includes('authorization-proof-integrity'),JSON.stringify(bad.errors));
  assert.equal(Schema.validate(draftOf(),{trustVerified:true}).ok,true);
  return {archived:Object.keys(kept).length,listed};
});

console.log(JSON.stringify({suite:'build359-container-seal',results},null,1));
console.log('BUILD359_CONTAINER_SEAL_PASS');
