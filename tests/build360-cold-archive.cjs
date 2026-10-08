'use strict';
// Build 360: old finance detail moves out of the hot object graph without losing a byte of audit data. Browser/export
// saves carry the cold pages inline; native saves carry them as vault chunks. Both forms reject missing, substituted,
// duplicated and unlisted pages before the state is accepted, and historical rows are decoded only when requested.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js'));
const CODEC=require(path.join(ROOT,'WebApp/state-codec-core.js'));
const DIAGNOSTICS=require(path.join(ROOT,'WebApp/diagnostics-core.js'));
const {fleet}=require('./helpers/fleet-fixture.js');
const results=[];
function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error?.stack||error).slice(0,2400)});}}
const rows=Array.from({length:137},(_,i)=>({id:`OLD-${String(i).padStart(4,'0')}`,number:`INV-${i}`,at:i*600,amount:i+.25,note:`historical-row-${i}-سجل`,nested:{currency:'SAR',lines:[{qty:i+1,price:3.5}]}}));
function coldState(){
  const page=CODEC.createColdArchivePage('invoices',rows,{firstAt:0,lastAt:rows.at(-1).at,createdAtSim:999999});
  return {saveVersion:'3.0.0',saveRevision:1,resetEpoch:0,simSeconds:999999,coldArchive:{schema:'gh-cold-archive-v1',pages:[page]},fleet:STORE.fromAssets(fleet().slice(0,3),{at:0})};
}
const bytesOf=(state,chunk)=>typeof chunk.text==='string'?new TextEncoder().encode(chunk.text):chunk.data instanceof Uint8Array?chunk.data.slice():new Uint8Array(state.fleet.rows,chunk.byteOffset,chunk.byteLength).slice();

test('self-contained save round-trips every historical field without mutating the live marker',()=>{
  const state=coldState(),page=state.coldArchive.pages[0],before=JSON.stringify(page),json=CODEC.serialize(state),tree=JSON.parse(json);
  assert.equal(JSON.stringify(page),before,'serialization does not add inline bytes to the live state');
  assert.equal(typeof tree.coldArchive.pages[0].inline,'string','export carries its own cold bytes');
  const loaded=CODEC.deserialize(json),check=CODEC.validateColdArchive(loaded);
  assert.deepEqual(check,{ok:true,pages:1,rows:rows.length});
  assert.deepEqual(CODEC.coldArchiveRows(loaded.coldArchive.pages[0]),rows);
  const first=CODEC.coldArchiveRows(loaded.coldArchive.pages[0]),second=CODEC.coldArchiveRows(loaded.coldArchive.pages[0]);
  assert.notEqual(first,second,'lookups do not retain a decoded object graph');assert.notEqual(first[0],second[0]);
  first[0].nested.lines[0].qty=-1;assert.equal(second[0].nested.lines[0].qty,1);
  return {rows:check.rows,inlineBytes:tree.coldArchive.pages[0].inline.length};
});

test('durable drafts and rollback clones inherit cold bytes without materializing rows',()=>{
  const state=coldState(),draft=global.GH_TRANSACTION_CORE.deepClone(state,{shareJournaledRoots:true});
  assert.notEqual(draft.coldArchive.pages[0],state.coldArchive.pages[0]);
  assert.deepEqual(CODEC.validateColdArchive(draft),{ok:true,pages:1,rows:rows.length});
  assert.deepEqual(CODEC.coldArchiveRows(draft.coldArchive.pages[0]),rows);
  const jsonClone=JSON.parse(JSON.stringify(state));assert.deepEqual(CODEC.validateColdArchive(jsonClone),{ok:false,reason:'cold-archive-invalid'});
  CODEC.inheritColdArchive(state,jsonClone);assert.deepEqual(CODEC.validateColdArchive(jsonClone),{ok:true,pages:1,rows:rows.length});
  return {draftRows:rows.length};
});

test('diagnostics attribute cold bytes outside the hot JSON object graph',()=>{
  const state=coldState(),stats=CODEC.coldArchiveStats(state),profile=DIAGNOSTICS.exportBundle(state).stateByteProfile;
  assert.equal(profile.externalBytes,stats.bytes);assert.equal(profile.residentBytes,profile.rootBytes+stats.bytes);
  assert.deepEqual(profile.targeted.coldArchive,stats);
  return {hotBytes:profile.rootBytes,coldBytes:profile.externalBytes};
});

test('native save keeps cold detail out of JSON and preserves its chunk id after reload',()=>{
  const state=coldState(),out=CODEC.serializeChunked(state),tree=JSON.parse(out.text),cold=out.chunks.find(chunk=>chunk.data instanceof Uint8Array),vault=new Map(out.chunks.map(chunk=>[chunk.id,bytesOf(state,chunk)]));
  assert(cold,'a native cold chunk is returned to persistence');
  assert(tree.stateCodec.chunks.includes(cold.id));assert.equal(tree.coldArchive.pages[0].inline,undefined);
  assert.equal(out.text.includes('historical-row-136'),false,'old detail is absent from hot save JSON');
  const loaded=CODEC.decodeState(tree,{resolveChunk:id=>vault.get(id)});
  assert.deepEqual(CODEC.coldArchiveRows(loaded.coldArchive.pages[0]),rows);
  const again=CODEC.serializeChunked(loaded),againCold=again.chunks.find(chunk=>chunk.data instanceof Uint8Array);
  assert.equal(againCold.id,cold.id,'an unchanged cold page is referenced, not rewritten');
  return {chunks:out.chunks.length,coldBytes:cold.byteLength,jsonBytes:out.text.length};
});

test('cold page manifests reject substitution, omission, duplication and stray ids',()=>{
  const state=coldState(),out=CODEC.serializeChunked(state),original=JSON.parse(out.text),cold=out.chunks.find(chunk=>chunk.data instanceof Uint8Array),vault=new Map(out.chunks.map(chunk=>[chunk.id,bytesOf(state,chunk)]));
  const attempt=(mutate,resolver=id=>vault.get(id))=>{const tree=structuredClone(original);mutate(tree);assert.throws(()=>CODEC.decodeState(tree,{resolveChunk:resolver}),error=>error?.code==='STATE_CODEC_CORRUPT');};
  attempt(()=>{},id=>{const bytes=vault.get(id);if(id!==cold.id)return bytes;const changed=bytes.slice();changed[changed.length>>1]^=1;return changed;});
  attempt(tree=>{tree.stateCodec.chunks=tree.stateCodec.chunks.filter(id=>id!==cold.id);});
  attempt(tree=>{tree.coldArchive.pages.push(structuredClone(tree.coldArchive.pages[0]));});
  attempt(tree=>{tree.stateCodec.chunks.push('valid-but-unused-id');});
  attempt(tree=>{tree.coldArchive.pages[0].sum='0.0.0';});
  const inline=JSON.parse(CODEC.serialize(state));inline.coldArchive.pages[0].inline=inline.coldArchive.pages[0].inline.slice(0,-4)+'AAAA';
  assert.throws(()=>CODEC.decodeState(inline),error=>error?.code==='STATE_CODEC_CORRUPT');
  return {rejections:6};
});

const passed=results.filter(row=>row.ok).length;
console.log(JSON.stringify({suite:'build360-cold-archive',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;else console.log('BUILD360_COLD_ARCHIVE_PASS');
