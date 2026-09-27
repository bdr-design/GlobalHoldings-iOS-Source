'use strict';
const assert=require('node:assert/strict');
const CHUNKED=require('../WebApp/chunked-save-core.js');

class MemoryAtomicAdapter{
  constructor(){this.data=new Map();this.failKey=null;this.writes=[];}
  async read(key){return this.data.has(key)?this.data.get(key):null;}
  async writeAtomic(key,value){if(this.failKey===key){this.failKey=null;throw new Error('injected-atomic-index-failure');}this.data.set(key,value);this.writes.push(key);}
  async remove(key){this.data.delete(key);}
  async keys(){return [...this.data.keys()];}
}

(async()=>{
  const adapter=new MemoryAtomicAdapter(),store=CHUNKED.create({adapter,chunkItems:1000,appendOnlyPaths:['finance.ledger'],coldPaths:['tripArchive']});
  const state={saveVersion:'2.0.0',saveRevision:1,resetEpoch:4,simSeconds:3600,settings:{speed:1,volume:.5},finance:{ledger:Array.from({length:2201},(_,index)=>({id:`L-${index}`,debit:1,credit:1}))},tripArchive:Array.from({length:900},(_,index)=>({id:`TRIP-${index}`,receipt:'x'.repeat(200)}))};
  const first=await store.commit(state);
  assert.equal(first.manifest.storageVersion,2);
  assert.equal(first.manifest.schemaVersion,'2.0.0');
  const ledger=first.manifest.sections.find(row=>row.key==='finance.ledger').chunks;
  assert.deepEqual(ledger.map(row=>row.items),[1000,1000,201],'append-only ledgers are split into fixed 1000-row chunks');
  assert.equal(first.manifest.sections.find(row=>row.key==='tripArchive').cold,true);
  const changed={...state,saveRevision:2,simSeconds:7200,settings:{...state.settings,speed:2}};
  const second=await store.commit(changed);
  assert.equal(second.manifest.generation,2);
  assert.deepEqual(second.state,changed);
  assert.ok(second.metrics.reusedChunks>=1,'unchanged content-addressed chunks are reused');
  const current=await store.load();assert.equal(current.manifest.generation,2);
  const hot=await store.loadHot();assert.equal(hot.state.tripArchive,undefined,'cold archive payload stays out of the hot state');
  assert.ok(second.metrics.hotBytes<second.metrics.bytes,'hot payload size excludes separately stored cold records');
  assert.equal((await store.loadSection('tripArchive')).length,900,'cold section loads only on demand');
  assert.deepEqual((await store.exportLegacy()).state,changed,'legacy export rehydrates cold sections and preserves schema 2.0.0');

  adapter.failKey='manifest-A.json';
  await assert.rejects(()=>store.commit({...changed,saveRevision:3,simSeconds:10800}),/injected-atomic-index-failure/);
  assert.equal((await store.load()).manifest.generation,2,'failed manifest publication preserves the previous committed generation');
  assert.ok((await adapter.keys()).some(key=>key.startsWith(CHUNKED.CHUNK_PREFIX)),'staged chunks remain harmlessly unreachable after failed publication');

  const changedTime=second.manifest.sections.find(row=>row.key==='simSeconds').chunks[0].name;
  adapter.data.set(changedTime,'999');
  const recovered=await store.load();
  assert.equal(recovered.manifest.generation,1,'corrupt newest section falls back to the highest fully verified A/B manifest');
  assert.equal(recovered.state.simSeconds,3600);

  const legacyAdapter=new MemoryAtomicAdapter(),legacy=JSON.stringify({saveVersion:'2.0.0',saveRevision:7,simSeconds:9});
  const legacyStore=CHUNKED.create({adapter:legacyAdapter,readLegacy:async()=>legacy});
  assert.equal((await legacyStore.load()).recoveredFrom,'legacy-json');
  const migrated=await legacyStore.commit(JSON.parse(legacy));
  assert.equal(migrated.manifest.storageVersion,2);
  assert.equal(migrated.manifest.schemaVersion,'2.0.0');
  console.log('Build342 chunked save: independent storageVersion, section chunks, atomic A/B manifests, integrity fallback and legacy migration PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
