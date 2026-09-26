'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../WebApp/media-asset-core.js');

function testSourceGuard(){
  assert.equal(core.normalizeSource('assets/images/map-aircraft-topdown.png'),'assets/images/map-aircraft-topdown.png');
  for(const bad of ['https://example.invalid/image.png','file:///tmp/image.png','assets/images/../private.png','assets/maps/ne2/0/0/0.webp','assets/images/a.png?x=1',''])assert.equal(core.normalizeSource(bad),'',`rejects out-of-scope image path ${bad}`);
}

async function testBoundedDecodeAndCache(){
  let active=0,maxActive=0,created=0;const engine=core.create({maxConcurrent:3,maxQueued:16,maxCached:4,imageFactory:()=>{created++;return {decoding:'',loading:'',set src(value){this.source=value;},decode(){active++;maxActive=Math.max(maxActive,active);return new Promise(resolve=>setTimeout(()=>{active--;resolve();},4));}};}});
  const sources=Array.from({length:8},(_,index)=>`assets/images/asset-${index}.webp`),first=engine.request(sources[0],1),duplicate=engine.request(sources[0],10);
  assert.equal(engine.metrics().deduplicated,1,'same image source shares one decode task');
  const rest=await engine.requestMany(sources.slice(1),2);const [a,b]=await Promise.all([first,duplicate]);assert.equal(a.ok,true);assert.equal(b.ok,true);assert.ok(rest.every(row=>row.ok));assert.equal(maxActive,3,'decode concurrency never exceeds three');assert.equal(created,8,'deduplicated image is instantiated once');
  const cached=await engine.request(sources[7]);assert.equal(cached.cached,true);assert.equal(created,8,'decoded image result is reused while it remains in the bounded cache');assert.ok(engine.metrics().cached<=4,'decode cache stays bounded');engine.dispose();assert.equal(engine.metrics().disposed,true);
}

async function testQueueBoundAndPriority(){
  const loaded=[],started=new Map(),signalStarted=new Map(),releaseDecode=new Map();
  const engine=core.create({maxConcurrent:1,maxQueued:2,imageFactory:()=>({source:'',set src(value){this.source=value;started.set(value,new Promise(resolve=>signalStarted.set(value,resolve)));},decode(){const source=this.source;loaded.push(source);let release;const promise=new Promise(resolve=>{release=resolve;});releaseDecode.set(source,release);signalStarted.get(source)?.();return promise;}})});
  const began=source=>{const promise=started.get(source);assert.ok(promise,`decode began for ${source}`);return promise;};
  const activeSource='assets/images/active.webp',lowSource='assets/images/low.webp',highSource='assets/images/high.webp';
  const active=engine.request(activeSource,0);await began(activeSource);
  const low=engine.request(lowSource,1),high=engine.request(highSource,5),dropped=await engine.request('assets/images/dropped.webp',0);
  assert.equal(dropped.error,'media-queue-full');assert.equal(engine.metrics().queued,2);
  releaseDecode.get(activeSource)();await active;await began(highSource);assert.equal(loaded[1],highSource,'higher-priority queued image is decoded first');
  releaseDecode.get(highSource)();await high;await began(lowSource);assert.equal(loaded[2],lowSource);releaseDecode.get(lowSource)();await low;
  assert.equal(engine.metrics().dropped,1);engine.dispose();
}

async function testRuntimeWiring(){
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'WebApp/index.html'),'utf8'),app=fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8'),runtime=JSON.parse(fs.readFileSync(path.join(root,'WebApp/runtime-required.json'),'utf8'));
  assert.ok(html.indexOf('media-asset-core.js')<html.indexOf('app.js'));assert.match(app,/GH_MEDIA_ASSET_CORE\?\.create/);assert.match(app,/mediaAssetEngine\?\.request\?\.\(imageSource,10\)/);assert.ok(runtime.files.includes('media-asset-core.js'));
}

(async()=>{testSourceGuard();await testBoundedDecodeAndCache();await testQueueBoundAndPriority();await testRuntimeWiring();console.log('Build 340 media engine: same-origin guard, async decode, priority, dedupe, bounded concurrency, LRU capacity and queue limit PASS');})().catch(error=>{console.error(error);process.exitCode=1;});
