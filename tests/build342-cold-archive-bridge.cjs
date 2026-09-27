'use strict';
const assert=require('node:assert/strict');
const events=new Map(),files=new Map();
global.addEventListener=(name,listener)=>{const rows=events.get(name)||new Set();rows.add(listener);events.set(name,rows);};
global.dispatchEvent=event=>{for(const listener of events.get(event.type)||[])listener(event);};
global.webkit={messageHandlers:{saveBridge:{postMessage(message){
  let success=true,value=null,error='';
  if(message.action==='coldArchiveRead')value=files.get(message.key)??null;
  else if(message.action==='coldArchiveWrite')files.set(message.key,message.value);
  else if(message.action==='coldArchiveRemove')files.delete(message.key);
  else if(message.action==='coldArchiveKeys')value=[...files.keys()].sort();
  else{success=false;error='unsupported-action';}
  queueMicrotask(()=>global.dispatchEvent({type:'gh-native-archive-ack',detail:{requestId:message.requestId,action:message.action,key:message.key,success,value,message:error}}));
}}}};

const PERSISTENCE=require('../WebApp/persistence-core.js');

(async()=>{
  const adapter=PERSISTENCE.createColdArchiveAdapter();
  assert.equal(adapter.native,true,'iOS uses the Native archive bridge instead of browser quota');
  const key='gh-cold-mobility-trip-receipts-e9-A.json';
  assert.equal(await adapter.read(key),null);
  await adapter.writeAtomic(key,'{"generation":1}');
  assert.equal(await adapter.read(key),'{"generation":1}');
  assert.deepEqual(await adapter.keys(),[key]);
  await adapter.remove(key);
  assert.equal(await adapter.read(key),null);
  const mismatched=PERSISTENCE.receiveArchiveAck({requestId:'missing',action:'coldArchiveRead',key,success:true,value:'bad'});
  assert.equal(mismatched,false,'unsolicited native replies cannot settle another request');
  console.log('Build342 Native cold archive bridge: request correlation, atomic operation adapter and verified key roundtrip PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
