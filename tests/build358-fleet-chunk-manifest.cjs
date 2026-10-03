'use strict';
// Build 358 (million-asset save, step 3 stage A): GH_STATE_CODEC.serializeChunked writes the fleet record buffer as a
// 'chunks-v1' manifest (one id per 4 MiB store chunk) instead of base64 inside the JSON. This proves, without the
// native vault: the text decodes (with a chunk resolver) to exactly the state the base64 save decodes to, after every
// kind of write; only written chunks get new ids; a write that bypasses the store renames every chunk; and a missing,
// short, extra or malformed chunk is a corrupt save.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),EVENTS=require(path.join(ROOT,'WebApp/fleet-event-core.js'));
const CODEC=require(path.join(ROOT,'WebApp/state-codec-core.js')),TX=global.GH_TRANSACTION_CORE;
const {fleet,context,resolveRoute}=require('./helpers/fleet-fixture.js');
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,1500)});}}

const CHUNK=STORE.CHUNK_ROWS,template=fleet(),ordinary=template.filter(a=>['A1','S1','R1'].includes(a.routeId)&&!a.salePending&&!a.simulationFault&&a.phase),assets=template.slice();
for(let i=0;assets.length<CHUNK*2+5000;i++){const a=structuredClone(ordinary[i%ordinary.length]);a.id=`BULK-${String(i).padStart(8,'0')}`;a.name=`GH BULK ${i}`;assets.push(a);}
const state={saveVersion:'3.0.0',simSeconds:0,profile:{name:'chunk probe'},fleet:STORE.fromAssets(assets,{at:0})};
// A stand-in for the vault: chunk bytes by id, copied at "upload" time.
const vault=new Map();
function save(label){
  const out=CODEC.serializeChunked(state),uploaded=[];
  for(const chunk of out.chunks)if(!vault.has(chunk.id)){vault.set(chunk.id,new Uint8Array(state.fleet.rows,chunk.byteOffset,chunk.byteLength).slice());uploaded.push(chunk.index);}
  const decoded=CODEC.deserialize(out.text,{resolveChunk:id=>vault.get(id)}),reference=CODEC.deserialize(CODEC.serialize(state));
  assert.deepEqual(new Uint8Array(decoded.fleet.rows),new Uint8Array(reference.fleet.rows),`${label}: rows decode exactly`);
  const strip=tree=>JSON.stringify({...tree,fleet:{...tree.fleet,rows:null}});assert.equal(strip(decoded),strip(reference),`${label}: everything else decodes exactly`);
  assert(!out.text.includes('"base64"'),`${label}: no base64 rows in the text`);
  return {uploaded,ids:out.chunks.map(c=>c.id),textBytes:out.text.length};
}

test('first save names every chunk; the text holds no rows',()=>{
  const first=save('first');assert.equal(first.uploaded.length,Math.ceil(state.fleet.rows.byteLength/(CHUNK*STORE.STRIDE)));
  const again=save('unchanged');assert.deepEqual(again.uploaded,[],'nothing to upload');assert.deepEqual(again.ids,first.ids,'same ids');
  return {chunks:first.uploaded.length,textBytes:first.textBytes,rowsBytes:state.fleet.rows.byteLength};
});
test('a single-row write renames only its chunk',()=>{
  STORE.set(state.fleet,CHUNK+11,'fuel',12.5);const out=save('one row');assert.deepEqual(out.uploaded,[1]);return out.uploaded;
});
test('engine advance, rollbacks, column writes, growth and compaction keep the round trip exact',()=>{
  EVENTS.advance(state.fleet,{from:0,to:4200,context:context(0),resolveRoute,order:'sweep'});state.simSeconds=4200;save('advance');
  assert.throws(()=>TX.execute(state,{label:'rollback',scope:['fleet'],apply:()=>{STORE.set(state.fleet,3,'fuel',1);save('inside transaction');throw new Error('fail');}}),/fail/);save('after rollback');
  TX.execute(state,{label:'column',scope:['fleet'],apply:()=>{STORE.rememberColumn(state.fleet,'condition');for(let r=0;r<state.fleet.length;r+=5)STORE.setSlot(state.fleet,'condition',r,77);}});const column=save('column');assert.equal(column.uploaded.length,column.ids.length,'a column write renames every chunk');
  const extra=[];for(let i=0;i<CHUNK/2;i++){const a=structuredClone(ordinary[i%ordinary.length]);a.id=`GROW-${i}`;extra.push(a);}
  TX.execute(state,{label:'grow',scope:['fleet'],apply:()=>{for(const a of extra)STORE.add(state.fleet,a);}});save('grown');
  TX.execute(state,{label:'remove',scope:['fleet'],apply:()=>{const rows=[];for(let r=0;r<state.fleet.length;r+=4)rows.push(r);STORE.removeMany(state.fleet,rows);}});STORE.compactRows(state.fleet);save('compacted');
  return {rows:state.fleet.length,vaultChunks:vault.size};
});
test('a write that bypasses the store renames every chunk within one rotation',()=>{
  save('baseline');const bytes=new Uint8Array(state.fleet.rows),at=CHUNK*STORE.STRIDE+77;bytes[at]^=0x5a;
  let renamed=0;for(let n=1;n<=4&&!renamed;n++){const before=CODEC.cacheStats().chunks.mismatches,out=save(`bypass ${n}`);if(CODEC.cacheStats().chunks.mismatches>before){renamed=n;assert.equal(out.uploaded.length,out.ids.length,'every chunk is renamed');}}
  assert(renamed>=1,'the bypass is detected');bytes[at]^=0x5a;STORE.touch(state.fleet,CHUNK);save('repaired');return {detectedAfter:renamed};
});
test('a store decoded from a chunked save adopts its ids: a new session uploads only what it changes',()=>{
  const out=CODEC.serializeChunked(state),tree=JSON.parse(out.text),marker=tree.fleet.rows,loaded=CODEC.decodeState(tree,{resolveChunk:id=>vault.get(id)});
  assert.equal(CODEC.adoptChunkIds(loaded.fleet,marker),true);
  const same=CODEC.serializeChunked(loaded);assert.deepEqual(same.chunks.map(c=>c.id),out.chunks.map(c=>c.id),'unchanged chunks keep the ids they were loaded from');
  STORE.set(loaded.fleet,5,'fuel',3.25);const changed=CODEC.serializeChunked(loaded),renamed=changed.chunks.filter((c,i)=>c.id!==out.chunks[i].id).map(c=>c.index);
  assert.deepEqual(renamed,[0],'only the written chunk is renamed');
  assert.equal(CODEC.adoptChunkIds(loaded.fleet,{...marker,chunks:marker.chunks.slice(1)}),false,'a manifest of another shape is not adopted');
  return {chunks:out.chunks.length,renamed};
});
test('missing, short, extra and malformed chunks are corrupt saves',()=>{
  const out=CODEC.serializeChunked(state),tree=JSON.parse(out.text),errors={};
  const attempt=(label,mutate,resolve=id=>vault.get(id))=>{const copy=structuredClone(tree);mutate(copy.fleet.rows);try{CODEC.decodeState(copy,{resolveChunk:resolve});errors[label]='accepted';}catch(error){errors[label]=error.message;}};
  attempt('no resolver',()=>{},null);
  attempt('missing chunk',()=>{},id=>id===out.chunks[1].id?undefined:vault.get(id));
  attempt('short chunk',()=>{},id=>id===out.chunks[0].id?vault.get(id).subarray(1):vault.get(id));
  attempt('resolver throws',()=>{},()=>{throw new Error('io');});
  attempt('wrong count',rows=>rows.chunks.pop());
  attempt('bad id',rows=>{rows.chunks[0]='../../etc/passwd';});
  attempt('bad length',rows=>{rows.byteLength=-1;});
  assert.deepEqual(errors,{'no resolver':'state-codec-corrupt:binary-chunks-unresolved','missing chunk':'state-codec-corrupt:binary-chunk-missing','short chunk':'state-codec-corrupt:binary-chunk-length','resolver throws':'state-codec-corrupt:binary-chunk-missing','wrong count':'state-codec-corrupt:binary-chunks','bad id':'state-codec-corrupt:binary-chunks','bad length':'state-codec-corrupt:binary-chunks'});
  return errors;
});

const passed=results.filter(r=>r.ok).length;
console.log(JSON.stringify({suite:'build358-fleet-chunk-manifest',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;
