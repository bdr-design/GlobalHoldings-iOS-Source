'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {harness,minimal}=require('./helpers/core-harness');
const next=()=>new Promise(r=>setImmediate(r));
(async()=>{
  const {s}=harness(['save-schema','control-plane-core','persistence-core']),P=s.GH_PERSISTENCE,state=minimal(),messages=[];let generation=0;
  s.webkit={messageHandlers:{saveBridge:{postMessage:e=>messages.push(e)}}};
  // One in-flight ordinary snapshot. All later requests must become one dirty bit.
  const first=P.commitState(state,{timeoutMs:2000});assert(first.ok);await next();assert.equal(messages.length,1);assert.equal(messages[0].saveRevision,2);
  const deferred=[];for(let i=0;i<20;i++){state.marker=i;const out=P.commitState(state,{timeoutMs:2000});assert(out.ok&&out.deferred);deferred.push(out.native);}
  assert.equal(state.saveRevision,2,'coalesced requests must not consume revisions');assert.equal(messages.length,1,'no extra native payload while first save is in flight');
  P.receiveAck({...messages[0],success:true,generation:++generation});await next();await next();assert.equal(messages.length,2,'exactly one latest snapshot should flush after ACK');
  const latest=messages[1],payload=JSON.parse(latest.saveJSON);assert.equal(latest.saveRevision,3);assert.equal(payload.marker,19);assert.equal(payload.saveRevision,3);
  P.receiveAck({...latest,success:true,generation:++generation});await P.drain();assert.equal(state.saveRevision,3);assert.equal(P.telemetry().ordinaryDirty,false);assert.equal(P.telemetry().ordinaryInFlight,false);

  // Durable commit supersedes an unsent dirty ordinary snapshot after the in-flight ACK.
  const state2=minimal(),m2=[];let g2=0;const h2=harness(['save-schema','control-plane-core','persistence-core']),Q=h2.s.GH_PERSISTENCE;h2.s.webkit={messageHandlers:{saveBridge:{postMessage:e=>m2.push(e)}}};
  Q.commitState(state2,{timeoutMs:2000});await next();assert.equal(m2.length,1);state2.marker='dirty';Q.commitState(state2,{timeoutMs:2000});
  const durable={...state2,saveRevision:3,marker:'durable'};const task=Q.commitDurableState(durable,{expectedPreviousRevision:2,timeoutMs:2000});await next();assert.equal(m2.length,1,'durable waits for current native ACK');
  Q.receiveAck({...m2[0],success:true,generation:++g2});await next();await next();assert.equal(m2.length,2,'dirty ordinary must be superseded, not flushed before durable');assert.equal(JSON.parse(m2[1].saveJSON).marker,'durable');assert.equal(m2[1].saveRevision,3);
  Q.receiveAck({...m2[1],success:true,generation:++g2});const durableOut=await task;assert(durableOut.ok);await Q.drain();assert.equal(m2.length,2);
  console.log(JSON.stringify({suite:'build335-persistence-root-coalescing',passed:2,total:2,ordinaryMessages:messages.length,durableMessages:m2.length},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
