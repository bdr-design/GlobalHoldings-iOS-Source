'use strict';
// Build 362 follow-up: idempotency keeps at-most-once fingerprints and proof references while bounding only the
// results that can still be replayed. The checks are byte/count contracts and do not depend on machine timing.
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

const bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const options=key=>({actor:'simulation',idempotencyKey:key,idempotencyPolicy:'permanent'});
const cacheKey=(domain,name,key)=>JSON.stringify([domain,name,key]);
const plain=value=>JSON.parse(JSON.stringify(value));
function departAsset(input,index,{wide=false,proof=false}={}){
  return {
    id:input.id,type:'air',assetMode:'air',catalogId:'A320-200',routeId:wide?'R'.repeat(420):`AIR-ROUTE-${index%11}`,
    baseFacility:wide?'B'.repeat(420):`AIR-BASE-${index%5}`,phase:index%4===0?'turnaround':'moving',routeSlot:index%24,
    departureScheduled:index%4===0,reverse:index%2===0,...(index%4===0?{departureScheduledAt:123456+index}:{}),
    specs:{capacity:180,capacityUnit:'راكب',blob:'x'.repeat(1200)},staffing:{ready:true,roles:[{id:'pilot'}]},
    ...(proof&&index===0?{documentProofId:'DP-DEPART-1'}:{})
  };
}
const departures=count=>Array.from({length:count},(_,index)=>({id:`AIRCRAFT-LONG-ID-${String(index+1).padStart(8,'0')}`}));

(()=>{
  const {s}=harness(['authorization-core','transaction-core','domain-command-core']),D=s.GH_DOMAIN_COMMANDS,state=minimal();let runs=0;
  D.register('fleet',{execute(_ctx,name,payload){assert.equal(name,'depart-batch');runs++;return payload.departures.map((row,index)=>departAsset(row,index));}});
  const payload={departures:departures(500)},first=D.dispatchSystem({state},'fleet','depart-batch',payload,options('DEPART-500'));
  assert.equal(first.result.length,500);assert.ok(first.result[0].specs,'the first execution keeps the owner result intact');
  const stored=state.domainRuntime.idempotency[cacheKey('fleet','depart-batch','DEPART-500')].result,receipt=stored.result;
  assert.equal(receipt.schema,D.FLEET_RECEIPT_SCHEMA);assert.equal(receipt.projection,D.FLEET_DEPART_REPLAY_PROJECTION);
  assert.ok(bytes(stored)<=D.FLEET_RECEIPT_REPLAY_BYTES_LIMIT,`depart receipt exceeds row budget: ${bytes(stored)}`);
  assert.equal(Object.hasOwn(receipt.assets[0],'specs'),false);assert.equal(Object.hasOwn(receipt.assets[0],'type'),false);assert.equal(Object.hasOwn(receipt.assets[0],'routeSlot'),false);
  assert.deepEqual(Object.keys(receipt.assets[0]).sort(),['baseFacility','departureScheduled','departureScheduledAt','id','phase','reverse','routeId'].sort());
  const replay=D.dispatchSystem({state},'fleet','depart-batch',payload,options('DEPART-500'));
  assert.equal(runs,1,'hot replay ran the fleet owner twice');assert.equal(replay.result.length,500);assert.equal(replay.result[0].routeId,'AIR-ROUTE-0');
  assert.throws(()=>D.dispatchSystem({state},'fleet','depart-batch',{departures:payload.departures.slice(1)},options('DEPART-500')),/Idempotency payload conflict/);
  const health=D.health(state);assert.ok(health.idempotencyReplayBytes<=D.IDEMPOTENCY_REPLAY_BYTES_LIMIT);assert.ok(health.idempotencyLargestReplayBytes<=D.FLEET_RECEIPT_REPLAY_BYTES_LIMIT);
  console.log(`PASS projected depart replay: ${bytes(stored)} bytes for 500 assets`);
})();

(()=>{
  const {s}=harness(['authorization-core','transaction-core','domain-command-core']),D=s.GH_DOMAIN_COMMANDS,state=minimal();let runs=0;
  D.register('fleet',{execute(_ctx,_name,payload){runs++;return payload.departures.map((row,index)=>departAsset(row,index,{wide:true,proof:true}));}});
  const payload={departures:departures(500)},first=D.dispatchSystem({state},'fleet','depart-batch',payload,options('DEPART-WIDE'));
  assert.equal(first.result.length,500);
  const row=state.domainRuntime.idempotency[cacheKey('fleet','depart-batch','DEPART-WIDE')],receipt=row.result.result;
  assert.equal(receipt.schema,D.FLEET_RECEIPT_COLD_SCHEMA,'an under-count but over-byte receipt must be cold');
  assert.deepEqual(plain(receipt.proofRefs),[{documentProofId:'DP-DEPART-1'}]);assert.ok(bytes(row.result)<2000,'cold receipt retained the wide asset rows');
  assert.throws(()=>D.dispatchSystem({state},'fleet','depart-batch',payload,options('DEPART-WIDE')),/idempotency-receipt-cold/);assert.equal(runs,1,'cold retry ran the fleet owner twice');
  assert.throws(()=>D.dispatchSystem({state},'fleet','depart-batch',{departures:payload.departures.slice(0,499)},options('DEPART-WIDE')),/Idempotency payload conflict/);
  const health=D.health(state);assert.equal(health.idempotencyColdReceipts,1);assert.equal(health.idempotencyReplayResults,0);
  console.log('PASS 128 KiB fleet receipt limit: cold refusal keeps proofs and at-most-once');
})();

(()=>{
  const {s}=harness(['authorization-core','transaction-core','domain-command-core']),D=s.GH_DOMAIN_COMMANDS,state=minimal();let runs=0;
  D.register('qa',{execute(){runs++;let deep={documentProofId:'DP-QA-DEEP'};for(let index=0;index<16;index++)deep={nested:deep};return {label:'نتيجة كبيرة',blob:'س'.repeat(70000),document:{documentProofId:'DP-QA-WIDE'},deep};}});
  const first=D.dispatchSystem({state},'qa','wide',{},options('QA-WIDE')),row=state.domainRuntime.idempotency[cacheKey('qa','wide','QA-WIDE')];
  assert.ok(bytes(first)>D.IDEMPOTENCY_REPLAY_ROW_BYTES_LIMIT,'the fixture must exceed the result-row limit');assert.equal(row.result.archived,true,'a non-fleet oversized replay result must become a tombstone');
  assert.deepEqual(plain(row.result.proofRefs),[{documentProofId:'DP-QA-DEEP'},{documentProofId:'DP-QA-WIDE'}]);assert.match(row.fingerprint,/^v2:sha256:[a-f0-9]{64}$/);
  const replay=D.dispatchSystem({state},'qa','wide',{},options('QA-WIDE'));assert.equal(replay.archived,true);assert.equal(runs,1,'an oversized generic result ran twice');
  assert.throws(()=>D.dispatchSystem({state},'qa','wide',{changed:true},options('QA-WIDE')),/Idempotency payload conflict/);
  const health=D.health(state);assert.equal(health.idempotencyReplayResults,0);assert.equal(health.idempotencyArchivedResults,1);assert.equal(health.idempotencyReplayRowBudgetBytes,128*1024);
  console.log('PASS 128 KiB generic row limit: tombstone keeps proofs, fingerprint and at-most-once');
})();

(()=>{
  const {s}=harness(['authorization-core','transaction-core','domain-command-core']),D=s.GH_DOMAIN_COMMANDS,state=minimal();let runs=0;
  D.register('qa',{execute(_ctx,_name,payload){runs++;return {number:payload.n,label:`نتيجة ${payload.n}`,blob:'س'.repeat(35000),document:{documentProofId:`DP-QA-${payload.n}`}};}});
  state.simSeconds=7000;const total=20;
  for(let n=0;n<total;n++){
    D.dispatchSystem({state},'qa','post',{n},options(`QA-${n}`));
    const health=D.health(state);assert.ok(health.idempotencyReplayBytes<=D.IDEMPOTENCY_REPLAY_BYTES_LIMIT,`budget exceeded after row ${n}: ${health.idempotencyReplayBytes}`);
  }
  assert.equal(runs,total);const table=state.domainRuntime.idempotency,oldest=table[cacheKey('qa','post','QA-0')],newest=table[cacheKey('qa','post',`QA-${total-1}`)],health=D.health(state);
  assert.equal(oldest.result.archived,true,'oldest same-time command should leave a tombstone');assert.equal(newest.result.archived,undefined,'newest same-time command should retain replay');
  assert.deepEqual(plain(oldest.result.proofRefs),[{documentProofId:'DP-QA-0'}]);assert.match(oldest.fingerprint,/^v2:sha256:[a-f0-9]{64}$/);
  const before=runs,recent=D.dispatchSystem({state},'qa','post',{n:total-1},options(`QA-${total-1}`)),old=D.dispatchSystem({state},'qa','post',{n:0},options('QA-0'));
  assert.equal(runs,before);assert.equal(recent.result.number,total-1);assert.equal(old.archived,true);assert.throws(()=>D.dispatchSystem({state},'qa','post',{n:-1},options('QA-0')),/Idempotency payload conflict/);
  const measured=Object.entries(table).reduce((sum,[key,row])=>{const [domain,name]=JSON.parse(key),cold=domain==='fleet'&&['assign-routes-batch','depart-batch'].includes(name)&&row.result?.result?.schema===D.FLEET_RECEIPT_COLD_SCHEMA;return sum+(row.result&&row.result.archived!==true&&!cold?bytes(row.result):0);},0);
  assert.equal(health.idempotencyReplayBytes,measured);assert.ok(health.idempotencyArchivedResults>0);assert.ok(health.idempotencyReplayResults<total);
  const serialized=JSON.stringify(table),restored=minimal();restored.simSeconds=state.simSeconds;restored.domainRuntime={commandSequence:state.domainRuntime.commandSequence,commands:[],owners:{},idempotency:JSON.parse(serialized)};
  const migration=D.migrateIdempotencyState(restored);assert.equal(migration.changed,false,'a budgeted save must not churn on load');assert.equal(JSON.stringify(restored.domainRuntime.idempotency),serialized);
  assert.equal(D.migrateIdempotencyState(restored).changed,false,'a second load must also be unchanged');
  console.log(`PASS aggregate replay budget: ${health.idempotencyReplayBytes}/${D.IDEMPOTENCY_REPLAY_BYTES_LIMIT} bytes, ${health.idempotencyArchivedResults} tombstones`);
})();

(()=>{
  const {s}=harness(['authorization-core','transaction-core','domain-command-core']),D=s.GH_DOMAIN_COMMANDS,state=minimal();let runs=0;
  D.register('fleet',{execute(_ctx,_name,payload){runs++;return payload.departures.map((row,index)=>departAsset(row,index));}});
  const payload={departures:departures(500)},key='LEGACY-DEPART',cache=cacheKey('fleet','depart-batch',key);
  D.dispatchSystem({state},'fleet','depart-batch',payload,options(key));const current=state.domainRuntime.idempotency[cache],legacyAssets=payload.departures.map((row,index)=>departAsset(row,index));
  state.domainRuntime.idempotency[cache]={...current,result:{...current.result,result:{schema:D.FLEET_RECEIPT_SCHEMA,family:'depart-batch',count:legacyAssets.length,assets:legacyAssets,digest:s.GH_AUTHORIZATION.digest(s.GH_AUTHORIZATION.stable(legacyAssets))}}};
  const before=bytes(state.domainRuntime.idempotency[cache].result),first=D.migrateIdempotencyState(state),after=bytes(state.domainRuntime.idempotency[cache].result);
  assert.equal(first.changed,true);assert.equal(first.compactedFleetResults,1);assert.ok(after<before/2,`legacy projection did not shrink enough: ${before} -> ${after}`);
  assert.equal(state.domainRuntime.idempotency[cache].result.result.projection,D.FLEET_DEPART_REPLAY_PROJECTION);
  const canonical=JSON.stringify(state.domainRuntime.idempotency);assert.equal(D.migrateIdempotencyState(state).changed,false);assert.equal(JSON.stringify(state.domainRuntime.idempotency),canonical);
  const restored=JSON.parse(JSON.stringify(state));assert.equal(D.migrateIdempotencyState(restored).changed,false);assert.equal(JSON.stringify(restored.domainRuntime.idempotency),canonical);
  const replay=D.dispatchSystem({state:restored},'fleet','depart-batch',payload,options(key));assert.equal(replay.result.length,500);assert.equal(runs,1,'migrated replay ran the owner');
  console.log(`PASS legacy migration: ${before} -> ${after} bytes and idempotent round-trip`);
})();

async function verifyIncrementalReplayBudget(){
  const {s}=harness(['authorization-core','transaction-core','domain-command-core']),D=s.GH_DOMAIN_COMMANDS,TX=s.GH_TRANSACTION_CORE,state=minimal(),table={};
  state.simSeconds=9000;state.domainRuntime={schema:'gh-domain-runtime-v2',commandSequence:4096,commands:[],owners:{},idempotency:table};
  const fingerprint=`v2:sha256:${'a'.repeat(64)}`;
  for(let index=0;index<D.PERMANENT_LIMIT;index++)table[cacheKey('qa','old',`OLD-${index}`)]={at:index,fingerprint,fingerprintVersion:D.FINGERPRINT_VERSION,result:{ok:true,commandId:`DOM-${String(index+1).padStart(9,'0')}`,archived:true},permanent:true};
  const migrated=D.migrateIdempotencyState(state),loaded=D.budgetTelemetry();
  assert.equal(migrated.changed,false);assert.equal(loaded.lastRowsScanned,D.PERMANENT_LIMIT,'load rebuild must account for the existing table once');
  D.register('qa',{execute(){return {value:'small'};}});
  const unrelated=await TX.executeDurable(state,{label:'qa-direct-durable-without-idempotency',integrity:false,persist:async()=>({ok:true}),apply:draft=>{draft.qaUnrelatedValue=1;return true;}});
  assert.equal(unrelated.committed,true);assert.equal(state.qaUnrelatedValue,1);
  const afterUnrelated=D.budgetTelemetry();assert.equal(afterUnrelated.rebuilds,loaded.rebuilds,'an unrelated durable publish discarded the loaded replay index');assert.equal(afterUnrelated.totalRowsScanned,loaded.totalRowsScanned,'an unrelated durable publish rescanned retained tombstones');
  D.dispatchSystem({state},'qa','small',{},options('AFTER-LOAD'));
  const hot=D.budgetTelemetry();assert.equal(hot.lastRowsScanned,0,'a keyed command rescanned the entire tombstone table');assert.equal(hot.rebuilds,loaded.rebuilds,'a keyed command rebuilt the loaded replay index');assert.equal(hot.incrementalUpdates,loaded.incrementalUpdates+1);assert.equal(state.domainRuntime.idempotency[cacheKey('qa','small','AFTER-LOAD')].result.result.value,'small');
  for(let index=0;index<32;index++)D.dispatchSystem({state},'qa','small',{index},{actor:'simulation'});const unkeyed=D.budgetTelemetry();assert.equal(unkeyed.rebuilds,hot.rebuilds,'unkeyed commands must not schedule idempotency maintenance');assert.equal(unkeyed.totalRowsScanned,hot.totalRowsScanned,'unkeyed commands scanned retained tombstones');
  for(let index=0;index<40;index++){
    const committed=await TX.executeDurable(state,{label:`qa-durable-after-load-${index}`,integrity:false,persist:async()=>({ok:true}),apply:draft=>D.dispatchSystem({state:draft},'qa','small',{index,durable:true},options(`DURABLE-AFTER-LOAD-${index}`))});
    assert.equal(committed.committed,true);assert.equal(committed.value.result.value,'small');
  }
  const afterDurables=D.budgetTelemetry();
  assert.equal(afterDurables.rebuilds,loaded.rebuilds+1,'forty durable commands must run exactly one scheduled count/TTL maintenance pass');
  assert.ok(afterDurables.totalRowsScanned-loaded.totalRowsScanned<=D.PERMANENT_LIMIT+40,'durable commands rescanned the retained table more than once');
  assert.equal(afterDurables.lastRowsScanned,0,'the last durable command scanned retained tombstones');
  const retainedRows=Object.keys(state.domainRuntime.idempotency).length;assert.ok(retainedRows<=D.PERMANENT_LIMIT,`scheduled durable maintenance did not enforce the permanent row limit: ${retainedRows}; ${JSON.stringify({loaded,afterDurables})}`);
  for(let index=8;index<40;index++)assert.equal(state.domainRuntime.idempotency[cacheKey('qa','small',`DURABLE-AFTER-LOAD-${index}`)].result.result.value,'small');
  console.log(`PASS incremental replay budget: load scanned ${loaded.lastRowsScanned}; 32 unkeyed commands scanned none and 40 durable commands ran one scheduled pass`);
}

function verifyRestoreInvalidatesResultBytes(){
  const {s}=harness(['authorization-core','transaction-core','domain-command-core']),D=s.GH_DOMAIN_COMMANDS,TX=s.GH_TRANSACTION_CORE,state=minimal();
  D.register('qa',{execute(){return {value:'small'};}});D.dispatchSystem({state},'qa','restore-cache',{},options('RESTORE-CACHE'));
  const key=cacheKey('qa','restore-cache','RESTORE-CACHE'),table=state.domainRuntime.idempotency,wrapped=table[key].result;
  assert.ok(bytes(wrapped)<D.IDEMPOTENCY_REPLAY_ROW_BYTES_LIMIT,'the initial result must populate the byte cache below the row limit');
  const replacement=structuredClone(state),replacementWrapped=replacement.domainRuntime.idempotency[key].result;
  replacementWrapped.result={blob:'x'.repeat(D.IDEMPOTENCY_REPLAY_ROW_BYTES_LIMIT+4096)};
  assert.ok(bytes(replacementWrapped)>D.IDEMPOTENCY_REPLAY_ROW_BYTES_LIMIT,'the replacement fixture must exceed the row limit');
  TX.restoreObject(state,replacement);
  assert.equal(state.domainRuntime.idempotency,table,'restoreObject replaced the idempotency table instead of restoring it in place');
  assert.equal(state.domainRuntime.idempotency[key].result,wrapped,'restoreObject replaced the cached result identity instead of mutating it in place');
  assert.ok(bytes(wrapped)>D.IDEMPOTENCY_REPLAY_ROW_BYTES_LIMIT,'the restored result is not oversized');
  const beforePrune=D.budgetTelemetry();D.pruneIdempotency(state,state.simSeconds);const afterPrune=D.budgetTelemetry(),row=state.domainRuntime.idempotency[key],health=D.health(state);
  assert.equal(afterPrune.rebuilds,beforePrune.rebuilds+1);assert.equal(afterPrune.totalRowsScanned,beforePrune.totalRowsScanned+1);
  assert.equal(row.result.archived,true,'a same-identity restored oversized result reused its stale small byte count');
  assert.equal(health.idempotencyReplayBytes,0);assert.equal(health.idempotencyReplayResults,0);assert.equal(health.idempotencyArchivedResults,1);assert.equal(health.idempotencyLargestReplayBytes,0);
  console.log('PASS restore cache invalidation: same-identity oversized result is archived and health is exact');
}

;(async()=>{
  await verifyIncrementalReplayBudget();
  verifyRestoreInvalidatesResultBytes();
  const {s}=harness(['authorization-core','transaction-core','domain-command-core']),D=s.GH_DOMAIN_COMMANDS,TX=s.GH_TRANSACTION_CORE,state=minimal();
  D.register('qa',{execute(_ctx,_name,payload){return {blob:'x'.repeat(payload.size)};}});
  for(let index=0;index<7;index++)D.dispatchSystem({state},'qa','sized',{size:120000,index},options(`LIVE-${index}`));
  const beforeDurable=D.health(state).idempotencyReplayBytes;assert.ok(beforeDurable< D.IDEMPOTENCY_REPLAY_BYTES_LIMIT);
  const durable=await TX.executeDurable(state,{label:'qa-durable-budget-publish',integrity:false,persist:async()=>({ok:true}),apply:draft=>D.dispatchSystem({state:draft},'qa','sized',{size:100000,index:'durable'},options('DURABLE'))});
  assert.equal(durable.committed,true);const afterDurable=D.health(state).idempotencyReplayBytes;assert.ok(afterDurable>beforeDurable);
  D.dispatchSystem({state},'qa','sized',{size:120000,index:'after'},options('AFTER-DURABLE'));
  const health=D.health(state),measured=Object.values(state.domainRuntime.idempotency).reduce((sum,row)=>sum+(row?.result&&row.result.archived!==true?bytes(row.result):0),0);
  assert.equal(health.idempotencyReplayBytes,measured);assert.ok(measured<=D.IDEMPOTENCY_REPLAY_BYTES_LIMIT,`durable publish left stale replay budget: ${measured}`);assert.ok(health.idempotencyArchivedResults>=1,'the oldest replay was not evicted after durable publish');
  console.log(`PASS durable/live replay index: ${beforeDurable} -> ${afterDurable} -> ${measured}`);
  console.log('BUILD362_IDEMPOTENCY_BYTE_BUDGET_PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
