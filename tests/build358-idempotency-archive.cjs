'use strict';
// Build 358, iPhone diagnostic (49.5 MB save): domainRuntime.idempotency held 15.5 MB, every keyed player command's whole
// result kept forever (permanent), and every keyed command walked and sorted the whole table. Now the newest 256
// permanent rows keep their result, older ones keep only the fingerprint (a duplicate is still refused, nothing re-runs)
// with the command and authorization proof ids, at most 4,096 permanent rows are kept, and the full pass runs every 32
// keyed commands. Loading an older save applies the same policy once.
const assert=require('node:assert/strict');
const path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core']),C=s.GH_DOMAIN_COMMANDS;
let runs=0;
C.register('qa',{execute(ctx,name,payload){runs++;return {number:payload.n,lines:Array.from({length:40},(_,i)=>({row:i,text:'سطر مستند مالي طويل للاختبار '.repeat(3)}))};}});
const state=minimal();state.simSeconds=1000;
const N=5000,dispatch=n=>C.dispatchSystem({state},'qa','post',{n},{actor:'simulation',idempotencyKey:`AUTH-qa-post-${n}`,idempotencyPolicy:'permanent'});
for(let n=0;n<N;n++){state.simSeconds=1000+n;dispatch(n);}
C.pruneIdempotency(state,state.simSeconds);
const table=state.domainRuntime.idempotency,rows=Object.values(table),full=rows.filter(row=>row.result&&row.result.archived!==true),archived=rows.filter(row=>row.result?.archived===true);
assert.ok(rows.length<=C.PERMANENT_LIMIT,`at most ${C.PERMANENT_LIMIT} permanent rows (${rows.length})`);
assert.ok(full.length<=C.PERMANENT_RESULT_LIMIT,`at most ${C.PERMANENT_RESULT_LIMIT} full results (${full.length})`);
assert.ok(archived.length>=rows.length-C.PERMANENT_RESULT_LIMIT&&archived.every(row=>row.fingerprint&&row.result.commandId),'older rows keep their fingerprint and command id');
const bytes=JSON.stringify(table).length;assert.ok(bytes<2.5e6,`the table stays small: ${bytes} bytes for ${N} commands`);
// A recent key replays its full result; an archived key is still refused as a duplicate (it does not run again).
const before=runs;
const recent=dispatch(N-1);assert.equal(runs,before,'a recent replay does not run again');assert.equal(recent.result.number,N-1,'and returns its full result');
const old=dispatch(N-4000);assert.equal(runs,before,'an archived duplicate does not run again');assert.equal(old.archived,true,'the archived marker comes back');assert.equal(old.result,undefined);
assert.throws(()=>C.dispatchSystem({state},'qa','post',{n:-1},{actor:'simulation',idempotencyKey:`AUTH-qa-post-${N-4000}`,idempotencyPolicy:'permanent'}),/Idempotency payload conflict/,'a different payload under an archived key is refused');
console.log(`PASS ${N} permanent commands: ${rows.length} rows, ${full.length} full results, ${(bytes/1e6).toFixed(2)} MB`);

// Loading an older save archives once; a small (new game) table is left untouched, so save/reload stays exact.
const legacy=minimal();legacy.simSeconds=9000;legacy.domainRuntime={commandSequence:0,commands:[],owners:{},idempotency:{}};
for(let n=0;n<1000;n++)legacy.domainRuntime.idempotency[JSON.stringify(['qa','post',`L-${n}`])]={at:n,fingerprint:`v2:sha256:${String(n).padStart(64,'0')}`,fingerprintVersion:2,permanent:true,result:{ok:true,commandId:`DOM-${n}`,authorizationProofId:`APR-${n}`,result:{lines:'x'.repeat(4000)}}};
const migrated=C.migrateIdempotencyState(legacy);
const legacyRows=Object.values(legacy.domainRuntime.idempotency);
assert.equal(migrated.changed,true);assert.equal(legacyRows.filter(row=>row.result.archived).length,1000-C.PERMANENT_RESULT_LIMIT);
assert.ok(legacyRows.filter(row=>row.result.archived).every(row=>row.result.authorizationProofId),'archived rows keep the authorization proof they pin');
const fresh=minimal();fresh.domainRuntime={commandSequence:0,commands:[],owners:{},idempotency:{}};
for(let n=0;n<10;n++)fresh.domainRuntime.idempotency[JSON.stringify(['qa','post',`F-${n}`])]={at:n,fingerprint:`v2:sha256:${String(n).padStart(64,'0')}`,fingerprintVersion:2,permanent:true,result:{ok:true,commandId:`DOM-${n}`}};
const freshBefore=JSON.stringify(fresh);assert.equal(C.migrateIdempotencyState(fresh).changed,false);assert.equal(JSON.stringify(fresh),freshBefore,'a small table is not rewritten on load');
console.log('PASS load: an older save archives once; a new game save is untouched');
console.log('BUILD358_IDEMPOTENCY_ARCHIVE_PASS');
