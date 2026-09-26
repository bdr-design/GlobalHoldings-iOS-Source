'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {harness,minimal}=require('./helpers/core-harness');
(async()=>{
 const results=[];
 for(const asynchronousHash of [false,true]){
  const {s}=harness(['save-schema','control-plane-core','persistence-core']),state=minimal(),sent=[];let generation=0;
  if(asynchronousHash){state.auditPayload='x'.repeat(300000);s.crypto={subtle:{digest:async(...args)=>{await new Promise(resolve=>setTimeout(resolve,0));return crypto.webcrypto.subtle.digest(...args);}}};}
  s.webkit={messageHandlers:{saveBridge:{postMessage(envelope){
   const payload=JSON.parse(envelope.saveJSON);sent.push(envelope);
   assert.equal(envelope.saveRevision,payload.saveRevision,'native envelope revision must describe its JSON snapshot');
   assert.equal(envelope.resetEpoch,payload.resetEpoch,'native envelope epoch must describe its JSON snapshot');
   assert.equal(envelope.saveHash,crypto.createHash('sha256').update(envelope.saveJSON).digest('hex'));
   assert.equal(s.GH_PERSISTENCE.receiveAck({...envelope,success:true,generation:++generation}),true);
  }}}};
  const first=s.GH_PERSISTENCE.commitState(state,{timeoutMs:2000});state.notes='latest';state.resetEpoch=1;
  const second=s.GH_PERSISTENCE.commitState(state,{timeoutMs:2000});
  assert(first.ok&&second.ok);await s.GH_PERSISTENCE.drain();
  assert.deepEqual(sent.map(e=>[e.saveRevision,e.resetEpoch]),[[2,0],[3,1]]);assert.equal(JSON.parse(sent[1].saveJSON).notes,'latest');
  assert.equal(s.GH_PERSISTENCE.telemetry().recoveryRequired,false);
  results.push({name:asynchronousHash?'queued snapshot + asynchronous real SHA-256':'queued snapshot + synchronous SHA-256',ok:true});
 }
 console.log(JSON.stringify({suite:'build334-persistence-snapshot-consistency',scope:'actual persistence owner; simulated native acknowledgments, not Native Save Vault',passed:results.length,total:results.length,results},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
