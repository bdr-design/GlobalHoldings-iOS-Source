'use strict';
const assert=require('assert'),crypto=require('crypto');
const {harness,minimal}=require('./helpers/core-harness');
function setup(){const h=harness(['save-schema','persistence-core']);h.s.GH_CONTROL_PLANE={sha256:x=>crypto.createHash('sha256').update(x).digest('hex')};return {...h,p:h.s.GH_PERSISTENCE};}
function ack(h,e,g,success=true){return h.p.receiveAck({requestId:e.requestId,action:e.action,saveRevision:e.saveRevision,resetEpoch:e.resetEpoch,saveHash:e.saveHash,saveSchemaVersion:e.saveSchemaVersion,generation:g,success,message:success?'':'injected-native-failure'});}
(async()=>{
 let cases=0;const test=async(name,fn)=>{await fn();cases++;console.log('PASS '+name);};
 await test('small, medium, soft-warning and hard-limit preserve last good save',()=>{
  const {p,data}=setup(),s=minimal();assert(p.writeState('main',s).ok);
  for(const size of [100,100000,1100000]){s.notes='a'.repeat(size);const out=p.writeState('main',s);assert(out.ok);assert(out.utf8Bytes>=size);if(size===1100000)assert(out.warning);}
  const good=data.get('main');s.notes='a'.repeat(2200000);assert(!p.writeState('main',s).ok);assert.strictEqual(data.get('main'),good);
  assert(p.telemetry().samples.some(s=>s.durationMs>=0));
 });
 await test('Unicode byte and UTF-16 accounting both enforced',()=>{const {p}=setup();const out=p.inspectJSON('"ع😀"');assert.strictEqual(out.utf8Bytes,8);assert.strictEqual(out.storageBytes,10);});
 await test('quota, corruption read-back and serialization failure keep canonical snapshot',()=>{
  const h=setup(),s=minimal(),good=JSON.stringify(s);h.data.set('main',good);
  h.storage.setItem=()=>{throw new Error('QuotaExceededError');};s.notes='new';assert(!h.p.writeState('main',s).ok);assert.strictEqual(h.data.get('main'),good);
  h.storage.setItem=(k,v)=>h.data.set(k,v===good?v:'corrupt');assert(!h.p.writeState('main',s).ok);assert.strictEqual(h.data.get('main'),good);
  s.loop=s;assert(!h.p.writeState('main',s).ok);assert(!h.p.saveSlot(0,s).ok);assert.strictEqual(h.data.get('main'),good);
 });
 await test('ACK requires exact correlation, action, hash, revision, epoch and monotonic generation',async()=>{
  const h=setup();let envelope;h.s.webkit={messageHandlers:{saveBridge:{postMessage:e=>{envelope=e;}}}};
  const pending=h.p.requestNative('commitSave',JSON.stringify(minimal()),{timeoutMs:100});
  for(const field of ['requestId','action','saveHash','saveRevision','resetEpoch'])assert.strictEqual(ack(h,{...envelope,[field]:'wrong'},1),false);
  assert(ack(h,envelope,1));assert((await pending).ok);assert(!ack(h,envelope,1));
  const second=h.p.requestNative('commitSave',JSON.stringify(minimal()),{timeoutMs:20});assert(!ack(h,envelope,1));await assert.rejects(second,/timeout/);
 });
 await test('NACK does not count as a native commit',async()=>{const h=setup();h.s.webkit={messageHandlers:{saveBridge:{postMessage:e=>ack(h,e,1,false)}}};await assert.rejects(h.p.requestNative('commitSave',JSON.stringify(minimal())),/injected/);assert.strictEqual(h.p.telemetry().generation,0);});
 for(const mode of ['success','nack','timeout','quota','marker','compensation'])await test('atomic replacement '+mode,async()=>{
  const h=setup(),old=minimal(),next={...minimal(),saveRevision:2,resetEpoch:99,notes:'clean'};h.data.set('main',JSON.stringify(old));h.data.set('reset','0');let calls=0,applied=false;
  h.s.webkit={messageHandlers:{updateBridge:{postMessage:e=>{calls++;if(mode==='timeout'&&calls===1)return;ack(h,e,calls,!(mode==='nack'&&calls===1)&&!(mode==='compensation'&&calls===2));}}}};
  const set=h.storage.setItem.bind(h.storage);h.storage.setItem=(k,v)=>{if(['quota','compensation'].includes(mode)&&k==='main'&&String(v).includes('clean'))throw new Error('QuotaExceededError');if(mode==='marker'&&k==='reset'&&v==='99')throw new Error('marker-quota');set(k,v);};
  const task=h.p.replaceState(next,old,{storageKey:'main',resetMarkerKey:'reset',timeoutMs:20,apply:()=>{applied=true;}});
  assert(h.p.isLocked());
  if(mode==='success'){assert((await task).ok);assert(applied);assert.strictEqual(JSON.parse(h.data.get('main')).resetEpoch,99);assert.strictEqual(calls,1);}
  else{let error;try{await task;}catch(e){error=e;}assert(error);assert(!applied);assert.strictEqual(h.data.get('main'),JSON.stringify(old));assert.strictEqual(h.data.get('reset'),'0');assert.strictEqual(calls,2);if(mode==='compensation')assert(error.critical);}
  assert(!h.p.isLocked());
 });
 await test('queued native save failure restores browser snapshot and fails drain',async()=>{const h=setup(),s=minimal(),old=JSON.stringify(s);h.data.set('main',old);s.notes='new';h.s.webkit={messageHandlers:{saveBridge:{postMessage:e=>ack(h,e,1,false)}}};const out=h.p.commitState(s,{storageKey:'main'});assert(out.ok);assert(!(await out.native).ok);assert.strictEqual(h.data.get('main'),old);await assert.rejects(h.p.drain());});
 console.log(JSON.stringify({suite:'persistence-pressure-native',passed:cases,total:cases}));
})().catch(e=>{console.error(e);process.exitCode=1;});
