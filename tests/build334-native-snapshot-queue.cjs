'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {harness,minimal}=require('./helpers/core-harness');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<200;i++){if(fn())return;await delay(2);}throw new Error('timeout:'+label);}
async function run(delayedHash){
  const h=harness(['save-schema','control-plane-core','persistence-core']),P=h.s.GH_PERSISTENCE,state=minimal(),messages=[];let generation=0;
  if(delayedHash)h.s.crypto={subtle:{digest:(_algorithm,bytes)=>new Promise(resolve=>setTimeout(()=>resolve(crypto.createHash('sha256').update(bytes).digest()),2))}};
  h.s.webkit={messageHandlers:{saveBridge:{postMessage:e=>messages.push(e)}}};
  state.saveRevision=11;state.resetEpoch=21;if(delayedHash)state.notes='x'.repeat(300000);
  const first=P.commitState(state,{storageKey:'queue-main',timeoutMs:2000});assert(first.ok);await until(()=>messages.length===1,'first-send');assert.equal(messages[0].saveRevision,12);assert.equal(JSON.parse(messages[0].saveJSON).saveRevision,12);
  state.resetEpoch=22;state.notes=(state.notes||'')+'-second';const second=P.commitState(state,{storageKey:'queue-main',timeoutMs:2000});assert(second.ok&&second.deferred);assert.equal(state.saveRevision,12,'dirty ordinary request must not consume a revision');
  state.resetEpoch=23;state.notes=(state.notes||'')+'-latest';const third=P.commitState(state,{storageKey:'queue-main',timeoutMs:2000});assert(third.ok&&third.deferred);assert.equal(messages.length,1);
  P.receiveAck({...messages[0],success:true,generation:++generation});await until(()=>messages.length===2,'latest-send');const latest=messages[1],payload=JSON.parse(latest.saveJSON);assert.equal(latest.saveRevision,13);assert.equal(payload.saveRevision,13);assert.equal(payload.resetEpoch,23);assert(payload.notes.endsWith('-latest'));
  P.receiveAck({...latest,success:true,generation:++generation});const rows=await Promise.all([first.native,second.native,third.native]);assert(rows.every(row=>row.ok));assert.equal((await P.drain()).ok,true);assert.equal(P.isLocked(),false);
  return {delayedHash,messages:messages.map(e=>({revision:e.saveRevision,epoch:e.resetEpoch,jsonRevision:JSON.parse(e.saveJSON).saveRevision,jsonEpoch:JSON.parse(e.saveJSON).resetEpoch}))};
}
(async()=>console.log(JSON.stringify({suite:'native-snapshot-coalescing',results:[await run(false),await run(true)],passed:2,total:2},null,2)))().catch(error=>{console.error(error);process.exitCode=1;});
