'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

function fleetAsset(id,routeId='R1'){
  return {
    id,type:'air',assetMode:'air',catalogId:'A320',routeId,baseFacility:'BASE-1',phase:'turnaround',routeSlot:3,
    departureScheduled:false,reverse:false,specs:{capacity:180,capacityUnit:'راكب',blob:'x'.repeat(5000)},
    staffing:{ready:true,roles:Array.from({length:12},(_,i)=>({id:`crew-${i}`,memo:'y'.repeat(400)}))},
    lastTrip:{route:Array.from({length:80},(_,i)=>[i/10,i/20]),memo:'z'.repeat(3000)}
  };
}

(()=>{
  // Legacy migration: raw canonical fingerprints become v2 SHA-256 and only the
  // proven fleet batch families receive durable cold receipts.
  const {s}=harness(['authorization-core','transaction-core','domain-command-core']);
  const payload={assignments:[{id:'A1',routeId:'R1',baseFacility:'BASE-1',phase:'turnaround',route:{id:'R1'}}]};
  const key=JSON.stringify(['fleet','assign-routes-batch','AUTH-K1']);
  const original=fleetAsset('A1');
  const state=minimal();
  state.domainRuntime={commandSequence:1,commands:[],owners:{},idempotency:{
    [key]:{at:0,fingerprint:s.GH_AUTHORIZATION.stable(payload),result:{ok:true,commandId:'DOM-1',result:[original]},permanent:true}
  }};
  const before=Buffer.byteLength(JSON.stringify(state.domainRuntime.idempotency));
  const first=s.GH_DOMAIN_COMMANDS.migrateIdempotencyState(state);
  assert.equal(first.changed,true);
  assert.equal(first.migratedFingerprints,1);
  assert.equal(first.compactedFleetResults,1);
  const row=state.domainRuntime.idempotency[key];
  assert.equal(row.fingerprintVersion,2);
  assert.match(row.fingerprint,/^v2:sha256:[a-f0-9]{64}$/);
  assert.equal(row.result.result.schema,'gh-fleet-batch-receipt-v1');
  assert.equal(row.result.result.count,1);
  assert.equal(Object.hasOwn(row.result.result.assets[0],'staffing'),false);
  assert.equal(Object.hasOwn(row.result.result.assets[0],'lastTrip'),false);
  const after=Buffer.byteLength(JSON.stringify(state.domainRuntime.idempotency));
  assert.ok(after<before/4,`receipt did not compact enough: ${before} -> ${after}`);

  const replay=s.GH_DOMAIN_COMMANDS.peekIdempotency(state,'fleet','assign-routes-batch','AUTH-K1',payload);
  assert.equal(replay.commandId,'DOM-1');
  assert.ok(Array.isArray(replay.result));
  assert.equal(replay.result[0].id,'A1');
  assert.equal(replay.result[0].specs.capacity,180);
  assert.equal(replay.result[0].routeSlot,3);
  assert.throws(()=>s.GH_DOMAIN_COMMANDS.peekIdempotency(state,'fleet','assign-routes-batch','AUTH-K1',{assignments:[]}),/Idempotency payload conflict/);
  const serialized=JSON.stringify(state),restored=JSON.parse(serialized);
  const replayAfterRestore=s.GH_DOMAIN_COMMANDS.peekIdempotency(restored,'fleet','assign-routes-batch','AUTH-K1',payload);
  assert.deepEqual(JSON.parse(JSON.stringify(replayAfterRestore)),JSON.parse(JSON.stringify(replay)));
  const second=s.GH_DOMAIN_COMMANDS.migrateIdempotencyState(restored);
  assert.equal(second.changed,false);
  assert.equal(second.migratedFingerprints,0);
  assert.equal(second.compactedFleetResults,0);
})();

(()=>{
  // New writes store hash fingerprints + compact fleet receipt, while initial
  // execution still returns the full live owner result expected by app.js.
  const {s}=harness(['authorization-core','transaction-core','domain-command-core']);
  const state=minimal();let executions=0;
  s.GH_DOMAIN_COMMANDS.register('fleet',{execute(_ctx,name,payload){executions++;assert.equal(name,'assign-routes-batch');return payload.assignments.map(row=>fleetAsset(row.id,row.routeId));}});
  const payload={assignments:[{id:'A1',routeId:'R1',baseFacility:'BASE-1',phase:'turnaround',route:{id:'R1'}}]};
  const options={actor:'simulation',idempotencyKey:'K-NEW',idempotencyPolicy:'permanent'};
  const initial=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'fleet','assign-routes-batch',payload,options);
  assert.equal(executions,1);
  assert.ok(initial.result[0].staffing,'initial result must stay full');
  const cacheKey=JSON.stringify(['fleet','assign-routes-batch','K-NEW']),row=state.domainRuntime.idempotency[cacheKey];
  assert.match(row.fingerprint,/^v2:sha256:[a-f0-9]{64}$/);
  assert.equal(row.result.result.schema,'gh-fleet-batch-receipt-v1');
  const replay=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'fleet','assign-routes-batch',payload,options);
  assert.equal(executions,1,'replay re-executed owner');
  assert.equal(replay.result[0].id,'A1');
  assert.equal(Object.hasOwn(replay.result[0],'staffing'),false,'replay should hydrate compact response projection');
})();

(()=>{
  // Non-fleet command results remain intact. 338-A must not broaden destructive
  // compaction into finance/proof-bearing command families.
  const {s}=harness(['authorization-core','transaction-core','domain-command-core']);
  const payload={amount:10};const key=JSON.stringify(['finance','example','K-FIN']);const result={ok:true,commandId:'DOM-FIN',result:{documentProofId:'DP-1',blob:'q'.repeat(1200)}};
  const state=minimal();state.domainRuntime={commandSequence:1,commands:[],owners:{},idempotency:{[key]:{at:0,fingerprint:s.GH_AUTHORIZATION.stable(payload),result:structuredClone(result),permanent:true}}};
  const m=s.GH_DOMAIN_COMMANDS.migrateIdempotencyState(state);
  assert.equal(m.migratedFingerprints,1);assert.equal(m.compactedFleetResults,0);
  assert.equal(state.domainRuntime.idempotency[key].result.result.blob,result.result.blob);
  assert.equal(state.domainRuntime.idempotency[key].result.result.documentProofId,'DP-1');
})();

(()=>{
  // Deferred integrity is legal only while an outer transaction is active and
  // defers validation to one outer-transaction baseline + one final verification.
  const {s}=harness(['transaction-core','control-plane-core']);
  const state=minimal();let integrityChecks=0,schemaChecks=0,handlerRuns=0;
  s.GH_INTEGRITY_CORE={check(){integrityChecks++;return {issues:[]};}};
  s.GH_SAVE_SCHEMA={validate(){schemaChecks++;return {ok:true};}};
  assert.throws(()=>s.GH_CONTROL_PLANE.execute(state,{name:'X'},()=>true,{atomic:false,integrity:true,deferIntegrityToTransaction:true}),/deferred-integrity-requires-active-transaction/);
  const out=s.GH_TRANSACTION_CORE.execute(state,{label:'outer',apply(){return s.GH_CONTROL_PLANE.execute(state,{name:'INNER',domain:'market'},()=>{handlerRuns++;return 7;},{atomic:false,integrity:true,deferIntegrityToTransaction:true});}});
  assert.equal(out.committed,true);assert.equal(handlerRuns,1);assert.equal(integrityChecks,2);assert.equal(schemaChecks,1);
})();


const asyncFinance=(async()=>{
  // Reproduce the field failure contract with a 30 MiB persistence gate: the
  // exact finance mutation rolls back while legacy idempotency bloats the save,
  // then succeeds after the one-time migration shrinks the same live state.
  const {scenario}=require('./helpers/business-scenario');
  const {s,state,command}=scenario();
  const LIMIT=30*1024*1024;
  command('finance','accrue-expense',{company:'air',amount:1250,note:'Build338 cheque payable',method:'قيد مستحق',number:'B338-CHQ'});
  command('finance','accrue-expense',{company:'air',amount:1750,note:'Build338 transfer payable',method:'قيد مستحق',number:'B338-TRF'});
  state.compatibilityPressure='p'.repeat(18*1024*1024);
  state.domainRuntime=state.domainRuntime||{};state.domainRuntime.idempotency=state.domainRuntime.idempotency||{};
  const hugeAssets=Array.from({length:520},(_,i)=>({...fleetAsset(`LEG-${i}`),memo:'m'.repeat(1300)}));
  for(let i=0;i<4;i++){
    const name=i%2===0?'assign-routes-batch':'depart-batch',key=JSON.stringify(['fleet',name,`LEGACY-${i}`]);
    state.domainRuntime.idempotency[key]={at:0,fingerprint:'f'.repeat(2*1024*1024),result:{ok:true,commandId:`LEG-${i}`,result:structuredClone(hugeAssets)},permanent:true};
  }
  const beforeBytes=Buffer.byteLength(JSON.stringify(state));
  assert.ok(beforeBytes>LIMIT,`fixture must reproduce hard limit: ${beforeBytes}`);
  const beforeChequeCount=state.finance.cheques.length,beforePayable=structuredClone(state.finance.payables.find(row=>row.number==='B338-CHQ'));
  let rejected=false;
  try{
    await s.GH_TRANSACTION_CORE.executeDurable(state,{label:'B338-pre-migration-cheque',apply:draft=>s.GH_DOMAIN_COMMANDS.dispatch({state:draft},'finance','settle-payable',{number:'B338-CHQ',method:'cheque'}).result,persist:draft=>{const bytes=Buffer.byteLength(JSON.stringify(draft));return bytes>LIMIT?{ok:false,reason:'native-save-size-hard-limit'}:{ok:true,bytes};}});
  }catch(error){rejected=/native-save-size-hard-limit/.test(String(error.message));}
  assert.equal(rejected,true,'pre-migration finance command did not reproduce hard-limit rollback');
  assert.equal(state.finance.cheques.length,beforeChequeCount,'failed durable cheque leaked a cheque');
  assert.deepEqual(JSON.parse(JSON.stringify(state.finance.payables.find(row=>row.number==='B338-CHQ'))),JSON.parse(JSON.stringify(beforePayable)),'failed durable cheque mutated payable');

  const migrated=s.GH_SAVE_SCHEMA.migrateLegacy(state);
  assert.equal(migrated.changed,true);const compact=migrated.state;
  const afterBytes=Buffer.byteLength(JSON.stringify(compact));
  assert.ok(afterBytes<LIMIT,`migration did not recover persistence headroom: ${afterBytes}`);
  assert.ok(beforeBytes-afterBytes>10*1024*1024,`migration savings too small: ${beforeBytes-afterBytes}`);

  const chequeBefore=s.GH_FINANCE_CORE.operating(compact,'air');
  const chequeTx=await s.GH_TRANSACTION_CORE.executeDurable(compact,{label:'B338-cheque',apply:draft=>s.GH_DOMAIN_COMMANDS.dispatch({state:draft},'finance','settle-payable',{number:'B338-CHQ',method:'cheque'}).result,persist:draft=>{const bytes=Buffer.byteLength(JSON.stringify(draft));return bytes>LIMIT?{ok:false,reason:'native-save-size-hard-limit'}:{ok:true,bytes};}});
  assert.equal(chequeTx.committed,true);assert.equal(chequeTx.value.status,'issued');assert.ok(chequeTx.value.chequeId);
  assert.equal(s.GH_FINANCE_CORE.operating(compact,'air'),chequeBefore,'issuing payable cheque must not debit cash before settlement');
  assert.equal(compact.finance.payables.find(row=>row.number==='B338-CHQ')?.status,'شيك صادر');

  const transferBefore=s.GH_FINANCE_CORE.operating(compact,'air');
  const transferTx=await s.GH_TRANSACTION_CORE.executeDurable(compact,{label:'B338-transfer',apply:draft=>s.GH_DOMAIN_COMMANDS.dispatch({state:draft},'finance','settle-payable',{number:'B338-TRF',method:'transfer'}).result,persist:draft=>{const bytes=Buffer.byteLength(JSON.stringify(draft));return bytes>LIMIT?{ok:false,reason:'native-save-size-hard-limit'}:{ok:true,bytes};}});
  assert.equal(transferTx.committed,true);assert.equal(transferTx.value.method,'transfer');assert.equal(transferTx.value.reference,'PAY-B338-TRF');
  assert.ok(Math.abs((transferBefore-s.GH_FINANCE_CORE.operating(compact,'air'))-1750)<0.01,'transfer did not debit current account exactly once');
  assert.equal(compact.finance.payables.some(row=>row.number==='B338-TRF'),false,'settled transfer payable remained open');
  const restored=JSON.parse(JSON.stringify(compact));
  assert.equal(s.GH_SAVE_SCHEMA.validate(restored).ok,true,'post-settlement save/restore state invalid');
})();

(()=>{
  // One integrity baseline per outer transaction: nested domain commands reuse
  // the first baseline and a single keyed post-commit verifier sees the whole
  // transaction, preventing both repeated scans and earlier-command masking.
  const {s}=harness(['authorization-core','transaction-core','domain-command-core']);
  const state=minimal();let checks=0,executions=0;
  s.GH_INTEGRITY_CORE={check(target){checks++;return {issues:target.bad?[{id:'BAD',severity:'critical'}]:[]};}};
  s.GH_DOMAIN_COMMANDS.register('x',{execute(ctx,name){executions++;if(name==='first')ctx.state.first=true;if(name==='bad')ctx.state.bad=true;return {name};}});
  assert.throws(()=>s.GH_TRANSACTION_CORE.execute(state,{label:'outer-integrity',apply(){s.GH_DOMAIN_COMMANDS.dispatch({state},'x','first',{});s.GH_DOMAIN_COMMANDS.dispatch({state},'x','bad',{});return true;}}),/Integrity critical after x:bad: BAD|Integrity critical after x:bad|BAD/);
  assert.equal(executions,2);assert.equal(state.first,undefined,'outer rollback did not restore first command');assert.equal(state.bad,undefined,'outer rollback did not restore bad command');
  assert.equal(checks,2,'outer transaction should use one baseline scan plus one final scan');
})();

asyncFinance.then(()=>console.log('build338 idempotency/save/lag root contracts: PASS')).catch(error=>{console.error(error);process.exitCode=1;});
