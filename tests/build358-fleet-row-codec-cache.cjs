'use strict';
// Build 358: the save encodes the fleet record buffer per 12 MiB segment and reuses the text of segments whose chunks
// were not written since the last save (GH_FLEET_STORE.chunkStamp). The save must stay byte-for-byte
// JSON.stringify(encodeState(state)) after every kind of write: single rows, the event engine, rolled-back
// transactions (row log and column snapshots), mass column writes, growth, compaction, a full-snapshot restore and a
// value-table replacement. A write that bypasses the store is caught by the rotating re-encode check.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),EVENTS=require(path.join(ROOT,'WebApp/fleet-event-core.js'));
const CODEC=require(path.join(ROOT,'WebApp/state-codec-core.js')),TX=global.GH_TRANSACTION_CORE;
const {fleet,context,resolveRoute}=require('./helpers/fleet-fixture.js');
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,1500)});}}

const SEGMENT_ROWS=STORE.CHUNK_ROWS*3,TARGET=SEGMENT_ROWS*2+4096;
// The fixture (every engine branch, including the general path) once, then ordinary routed rows up to two and a bit
// segments, as in a real fleet.
const template=fleet(),assets=template.slice(),ordinary=template.filter(a=>a.routeId==='A1'||a.routeId==='S1'||a.routeId==='R1').filter(a=>!a.salePending&&!a.simulationFault&&a.phase);
for(let i=0;assets.length<TARGET;i++){const a=structuredClone(ordinary[i%ordinary.length]);a.id=`BULK-${String(i).padStart(8,'0')}`;a.name=`GH BULK ${i}`;assets.push(a);}
const state={schema:'probe',simSeconds:0,fleet:STORE.fromAssets(assets,{at:0})};
const fresh=()=>JSON.stringify(CODEC.encodeState(state));
const stats=()=>CODEC.cacheStats().rows;
function save(label){
  const before=stats(),text=CODEC.serialize(state),after=stats();
  assert.equal(text,fresh(),`${label}: serialize must equal JSON.stringify(encodeState(state))`);
  return {hits:after.hits-before.hits,misses:after.misses-before.misses,verified:after.verified-before.verified,mismatches:after.mismatches-before.mismatches,text};
}
const segmentOf=row=>Math.floor(row/SEGMENT_ROWS);
const segments=()=>Math.ceil(state.fleet.rows.byteLength/(SEGMENT_ROWS*STORE.STRIDE));

test('first save encodes every segment; an unchanged save reuses all of them',()=>{
  const first=save('first');assert.equal(first.misses,segments());assert.equal(first.hits,0);
  const again=save('unchanged');assert.equal(again.misses,0,'nothing was written');assert.equal(again.hits,segments());assert.equal(again.verified,1,'one reused segment is re-encoded and compared');
  const decoded=CODEC.deserialize(again.text);assert.deepEqual(new Uint8Array(decoded.fleet.rows),new Uint8Array(state.fleet.rows),'rows round-trip byte for byte');
  return {rows:state.fleet.length,segments:segments(),saveMB:+(again.text.length/1048576).toFixed(1)};
});

test('a single-row write re-encodes only its segment',()=>{
  const row=SEGMENT_ROWS+17;STORE.set(state.fleet,row,'fuel',42.5);
  const out=save('one row');assert.equal(out.misses,1);assert.equal(out.hits,segments()-1);
  STORE.set(state.fleet,5,'condition',71);STORE.set(state.fleet,SEGMENT_ROWS*2+3,'progress',0.25);
  const two=save('two rows');assert.equal(two.misses,2,'segments 0 and 2');
  return {segment:segmentOf(row)};
});

test('the event engine (fast and general paths) marks every row it writes',()=>{
  let from=0;const ctx=context(0);
  for(const to of [600,4200]){EVENTS.advance(state.fleet,{from,to,context:ctx,resolveRoute,order:'sweep'});state.simSeconds=to;from=to;save(`advance to ${to}`);}
  return {advancedTo:from};
});

test('rolled-back transactions leave the save exact (row log and column snapshot)',()=>{
  save('before rollbacks');
  // Row log: a scoped transaction writes rows in two segments, then fails.
  assert.throws(()=>TX.execute(state,{label:'row-rollback',scope:['fleet'],apply:()=>{STORE.set(state.fleet,3,'fuel',1);STORE.set(state.fleet,SEGMENT_ROWS*2+1,'fuel',2);throw new Error('fail');}}),/fail/);
  const rowRollback=save('row rollback');assert(rowRollback.misses>=2,'restored rows re-encode');
  // Save inside the transaction (after the write), then roll back: the cached in-transaction text must not survive.
  assert.throws(()=>TX.execute(state,{label:'save-inside',scope:['fleet'],apply:()=>{STORE.set(state.fleet,9,'fuel',3);save('inside transaction');throw new Error('fail');}}),/fail/);
  save('after in-transaction save rollback');
  // Column snapshot: a mass column write rolled back.
  assert.throws(()=>TX.execute(state,{label:'column-rollback',scope:['fleet'],apply:()=>{STORE.rememberColumn(state.fleet,'condition');for(let r=0;r<state.fleet.length;r++)STORE.setSlot(state.fleet,'condition',r,1);save('inside column write');throw new Error('fail');}}),/fail/);
  const column=save('column rollback');assert.equal(column.misses,segments(),'a column rollback re-encodes every segment');
  return {rowRollback,column:{misses:column.misses}};
});

test('a committed mass column write re-encodes every segment',()=>{
  save('before column');
  TX.execute(state,{label:'column-commit',scope:['fleet'],apply:()=>{STORE.rememberColumn(state.fleet,'condition');for(let r=0;r<state.fleet.length;r+=7)STORE.setSlot(state.fleet,'condition',r,88);}});
  const out=save('column commit');assert.equal(out.misses,segments());return out.misses;
});

test('growth, removal and compaction keep the save exact',()=>{
  const extra=[];for(let i=0;i<SEGMENT_ROWS/2;i++){const a=structuredClone(ordinary[i%ordinary.length]);a.id=`GROW-${i}`;extra.push(a);}
  TX.execute(state,{label:'grow',scope:['fleet'],apply:()=>{for(const a of extra)STORE.add(state.fleet,a);}});save('grown');
  TX.execute(state,{label:'remove',scope:['fleet'],apply:()=>{const rows=[];for(let r=0;r<state.fleet.length;r+=3)rows.push(r);STORE.removeMany(state.fleet,rows);}});save('removed');
  STORE.compactRows(state.fleet);const compacted=save('compacted');assert.equal(compacted.misses,segments(),'compaction moves rows: every segment re-encodes');
  return {rows:state.fleet.length,segments:segments()};
});

test('a full-snapshot restore and a replaced value table start a fresh cache',()=>{
  save('before full restore');
  assert.throws(()=>TX.execute(state,{label:'full-restore',apply:()=>{STORE.set(state.fleet,11,'fuel',7);throw new Error('fail');}}),/fail/);
  const restored=save('after full restore');assert.equal(restored.hits,0,'a restored buffer is a new runtime');
  state.fleet.values=state.fleet.values.slice();const replaced=save('after values replaced');assert.equal(replaced.hits,0);
  return {restoredMisses:restored.misses};
});

test('a write that bypasses the store is caught within one rotation and that save is encoded from scratch',()=>{
  // Every store writer marks its chunk; this guards against a future writer that does not. Detection is eventual: each
  // save re-encodes ONE reused segment, so a bypassing write is found within as many saves as there are segments.
  save('baseline');
  const bytes=new Uint8Array(state.fleet.rows),at=SEGMENT_ROWS*STORE.STRIDE+40;bytes[at]=bytes[at]^0xff;
  let detectedAfter=0,text=null;
  for(let n=1;n<=segments()&&!detectedAfter;n++){const before=stats();text=CODEC.serialize(state);if(stats().mismatches>before.mismatches)detectedAfter=n;}
  assert(detectedAfter>=1&&detectedAfter<=segments(),'the rotating re-encode detects the bypass within one rotation');
  assert.equal(text,fresh(),'the detecting save is exact');
  const next=save('after detection');assert.equal(next.hits,0,'the cache was dropped');
  return {detectedAfter,segments:segments()};
});

const passed=results.filter(r=>r.ok).length;
console.log(JSON.stringify({suite:'build358-fleet-row-codec-cache',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;
