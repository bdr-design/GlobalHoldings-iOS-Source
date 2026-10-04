'use strict';
// Build 358 (million-asset): a fleet batch command's idempotency row kept one replay row per asset (an iPhone save held
// 2.5 MB for one dispatch of 24,000 aircraft; at a million assets one dispatch would be about 100 MB, saved forever).
//  - Up to FLEET_RECEIPT_REPLAY_LIMIT assets nothing changes: the receipt lists the replay rows and a repeated request
//    gets them back without running again.
//  - A larger batch keeps a cold receipt (family, count, first and last id): a repeated request is refused with
//    'idempotency-receipt-cold' and does not run again.
//  - Loading a save converts a stored per-asset receipt above the limit into a cold one; smaller ones are kept.
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

const asset=(id,i=0)=>({id,type:'air',assetMode:'air',catalogId:'A320',routeId:`R${i%7}`,baseFacility:'BASE-1',phase:'turnaround',routeSlot:i%5,departureScheduled:false,reverse:false,specs:{capacity:180,capacityUnit:'راكب'}});
function setup(){
  const {s}=harness(['authorization-core','transaction-core','domain-command-core']),D=s.GH_DOMAIN_COMMANDS;let runs=0;
  D.register('fleet',{execute(_ctx,name,payload){runs++;return payload.assignments.map((row,i)=>asset(row.id,i));}});
  return {D,state:minimal(),runs:()=>runs};
}
const payloadOf=n=>({assignments:Array.from({length:n},(_,i)=>({id:`A${i+1}`,routeId:`R${i%7}`,baseFacility:'BASE-1',phase:'turnaround'}))});
const options=key=>({actor:'simulation',idempotencyKey:key,idempotencyPolicy:'permanent'});
const rowOf=(state,key)=>state.domainRuntime.idempotency[JSON.stringify(['fleet','assign-routes-batch',key])];
const plain=value=>JSON.parse(JSON.stringify(value));// the harness runs the cores in another realm

(()=>{
  const {D,state,runs}=setup(),limit=D.FLEET_RECEIPT_REPLAY_LIMIT;
  assert.equal(limit,512);
  // At the limit: replay rows, replayed back.
  const small=payloadOf(limit),first=D.dispatchSystem({state},'fleet','assign-routes-batch',small,options('K-SMALL'));
  assert.equal(first.result.length,limit);assert.equal(rowOf(state,'K-SMALL').result.result.schema,'gh-fleet-batch-receipt-v1');
  const replay=D.dispatchSystem({state},'fleet','assign-routes-batch',small,options('K-SMALL'));
  assert.equal(runs(),1,'a repeated request does not run again');assert.equal(replay.result.length,limit);assert.equal(replay.result[limit-1].id,`A${limit}`);
  // Above it: a cold receipt, a repeated request refused without running.
  const big=payloadOf(limit+1),out=D.dispatchSystem({state},'fleet','assign-routes-batch',big,options('K-BIG'));
  assert.equal(out.result.length,limit+1,'the command itself returns its whole result');
  const row=rowOf(state,'K-BIG');
  assert.deepEqual(plain(row.result.result),{schema:D.FLEET_RECEIPT_COLD_SCHEMA,family:'assign-routes-batch',count:limit+1,firstId:'A1',lastId:`A${limit+1}`});
  assert.ok(JSON.stringify(row).length<1200,`cold receipt is small (${JSON.stringify(row).length} bytes)`);
  assert.throws(()=>D.dispatchSystem({state},'fleet','assign-routes-batch',big,options('K-BIG')),/idempotency-receipt-cold/);
  assert.equal(runs(),2,'and does not run again');
  assert.throws(()=>D.dispatchSystem({state},'fleet','assign-routes-batch',payloadOf(3),options('K-BIG')),/Idempotency payload conflict/,'another payload under the same key is still a conflict');
  console.log('PASS replay rows up to the limit; above it a cold receipt that refuses a repeat');
})();

(()=>{
  // A save holding per-asset receipts: the large one becomes cold on load, the small one is kept.
  const {D,state,runs}=setup();
  D.dispatchSystem({state},'fleet','assign-routes-batch',payloadOf(4),options('K-OLD-SMALL'));
  const bigAssets=Array.from({length:3000},(_,i)=>({id:`B${i+1}`,routeId:'R1',phase:'turnaround'}));
  const key=JSON.stringify(['fleet','depart-batch','K-OLD-BIG']),smallBefore=JSON.stringify(rowOf(state,'K-OLD-SMALL'));
  state.domainRuntime.idempotency[key]={at:0,fingerprint:rowOf(state,'K-OLD-SMALL').fingerprint,fingerprintVersion:2,permanent:true,
    result:{ok:true,commandId:'DOM-OLD',result:{schema:'gh-fleet-batch-receipt-v1',family:'depart-batch',count:bigAssets.length,assets:bigAssets,digest:'x'}}};
  const before=JSON.stringify(state.domainRuntime.idempotency).length,m=D.migrateIdempotencyState(state),after=JSON.stringify(state.domainRuntime.idempotency).length;
  assert.equal(m.changed,true);assert.equal(m.compactedFleetResults,1);
  assert.deepEqual(plain(state.domainRuntime.idempotency[key].result),{ok:true,commandId:'DOM-OLD',result:{schema:D.FLEET_RECEIPT_COLD_SCHEMA,family:'depart-batch',count:3000,firstId:'B1',lastId:'B3000'}});
  assert.equal(JSON.stringify(rowOf(state,'K-OLD-SMALL')),smallBefore,'a receipt within the limit is kept as it was');
  assert.ok(after<before/20,`save shrinks (${before} -> ${after})`);
  assert.equal(D.migrateIdempotencyState(state).compactedFleetResults,0,'a second load changes nothing');
  assert.equal(runs(),1);
  console.log(`PASS a stored per-asset receipt above the limit becomes cold on load (${before} -> ${after} bytes)`);
})();
console.log('BUILD358_COLD_FLEET_RECEIPTS_PASS');
