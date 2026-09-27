'use strict';
const assert=require('node:assert/strict');
const COLD=require('../WebApp/cold-archive-core.js');

class MemoryArchive{
  constructor(){this.data=new Map();this.failKey=null;}
  async read(key){return this.data.has(key)?this.data.get(key):null;}
  async writeAtomic(key,value){if(this.failKey===key){this.failKey=null;throw new Error('archive-index-failure');}this.data.set(key,value);}
}

(async()=>{
  const adapter=new MemoryArchive(),archive=COLD.create({adapter,bucket:'trip-receipts'});
  const rows=Array.from({length:500},(_,index)=>({id:`TRIP-${String(index).padStart(4,'0')}`,at:500-index,receipt:'proof-'.repeat(60)}));
  const first=await archive.offloadNewestFirst(rows,64);
  assert.equal(first.hot.length,64);assert.equal(first.archived,436);assert.deepEqual(first.hot,rows.slice(0,64));
  assert.equal((await archive.metadata()).count,436);
  assert.deepEqual(await archive.peek(rows[64].id),rows[64],'archive lookup reads and verifies only the requested record');
  assert.deepEqual(await archive.readAll(),rows.slice(64));
  assert.deepEqual(await archive.rehydrateNewestFirst(first.hot),rows,'legacy view restores original newest-first order');
  const bytesBefore=adapter.data.size,repeat=await archive.offloadNewestFirst(rows,64);
  assert.equal(repeat.idempotent,true);assert.equal(adapter.data.size,bytesBefore,'repeated post-commit offload reuses stable record digests');
  await assert.rejects(()=>archive.append([{...rows[64],receipt:'tampered'}]),/cold-archive-id-conflict/);
  adapter.failKey='gh-cold-trip-receipts-B.json';
  await assert.rejects(()=>archive.append([{id:'TRIP-NEW',at:0,receipt:'new'}]),/archive-index-failure/);
  assert.equal((await archive.metadata()).count,436,'index failure leaves the previous archive committed');
  const nextRows=Array.from({length:50},(_,index)=>({id:`NEXT-${index}`,at:550-index,receipt:'new'}));
  const grown=[...nextRows,...first.hot],next=await archive.offloadNewestFirst(grown,64);
  assert.equal(next.archived,50);
  assert.equal((await archive.metadata()).count,486);
  assert.deepEqual(await archive.rehydrateNewestFirst(next.hot),[...nextRows,...rows],'later offloads must precede the older immutable receipts in the legacy export');
  const again=await archive.offloadNewestFirst(grown,64);
  assert.equal(again.idempotent,true);
  assert.deepEqual(await archive.rehydrateNewestFirst(again.hot),[...nextRows,...rows]);
  console.log('Build342 cold archive: stable IDs/digests, bounded hot window, multi-generation legacy ordering and atomic append PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
