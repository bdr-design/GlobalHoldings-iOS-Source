'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

(async()=>{
  {
    const {s}=harness(['diagnostics-core','transaction-core']);
    const state=minimal();
    state.speed=1;state.sectorProfitToday={};state.tripRevenueAccrued={};
    state.domainRuntime={commands:Array.from({length:80},(_,i)=>({id:`C${i}`,payload:'x'.repeat(120+i)})),idempotencyTable:Object.fromEntries(Array.from({length:90},(_,i)=>[`K${i}`,{result:{blob:'y'.repeat(300+i)},proofRefs:[`P${i}`]}]))};
    state.documentProofs={recordsById:Object.fromEntries(Array.from({length:40},(_,i)=>[`P${i}`,{digest:'a'.repeat(64),signature:'b'.repeat(96),body:{memo:'c'.repeat(220+i)}}]))};
    state.assets=[{id:'A-MOVE',phase:'moving',specs:{name:'jet',blob:'s'.repeat(220)},runtimeCoords:[1,2],metadata:{note:'m'.repeat(140)}},{id:'A-IDLE',phase:'idle',specs:{name:'ship',blob:'t'.repeat(240)},metadata:{note:'n'.repeat(100)}}];
    state.realism={procurement:{deliveries:Array.from({length:50},(_,i)=>({id:`D${i}`,status:'delivered',payload:'d'.repeat(180+i)})),open:[]}};
    const beforeDomain=JSON.stringify(state.domainRuntime),beforeAssets=JSON.stringify(state.assets);
    s.GH_TRANSACTION_CORE.execute(state,{label:'simulation:0->3600',apply(){state.simSeconds=3600;return true;}});
    const tx=s.GH_TRANSACTION_CORE.telemetry();
    assert.equal(tx.lastSimulation?.label,'simulation:0->3600');
    for(const key of ['snapshotMs','validateMs','applyMs','postCommitCriticalMs','postCommitNonCriticalMs','rollbackMs','totalMs'])assert.ok(Number.isFinite(tx.lastSimulation[key]),`missing ${key}`);
    const bundle=s.GH_DIAGNOSTICS.exportBundle(state,{appVersion:'3.0.0',saveSchemaVersion:'2.0.0',simulation:{lastFinishMs:10}});
    assert.equal(bundle.stateByteProfile.profileVersion,'build337-targeted-topn-v1');
    assert.ok(Number.isFinite(bundle.stateByteProfile.profilerDurationMs));
    assert.ok(bundle.stateByteProfile.targeted.domainRuntime);
    assert.ok(bundle.stateByteProfile.targeted.documentProofs);
    assert.ok(bundle.stateByteProfile.targeted.assets);
    assert.ok(bundle.stateByteProfile.targeted['realism.procurement']);
    assert.ok(Array.isArray(bundle.stateByteProfile.targeted.assetSamples));
    assert.equal(JSON.stringify(bundle.stateByteProfile).includes('[depth-limit]'),false,'targeted byte profile must not be cleanDetail depth-limited');
    assert.equal(bundle.simulation.lastFinishBreakdown?.label,'simulation:0->3600');
    assert.equal(JSON.stringify(state.domainRuntime),beforeDomain,'instrumentation must not rewrite domainRuntime');
    assert.equal(JSON.stringify(state.assets),beforeAssets,'instrumentation must not rewrite assets');
    assert.equal(Object.prototype.hasOwnProperty.call(state,'runtimeInstrumentation'),false,'runtime metrics must not enter persistent state');
  }

  {
    const {s}=harness(['persistence-core']);
    let posted=null,lastStatus=null;
    s.GH_CONTROL_PLANE={sha256:text=>'0'.repeat(64)};
    s.webkit={messageHandlers:{saveBridge:{postMessage(envelope){posted=envelope;}}}};
    s.addEventListener('gh-persistence-status',e=>{lastStatus=e.detail;});
    const request=s.GH_PERSISTENCE.requestNative('commitSave','{}',{saveRevision:9,resetEpoch:2,appVersion:'3.0.0'});
    assert.ok(posted?.requestId,'native request must be dispatched');
    const accepted=s.GH_PERSISTENCE.receiveAck({...posted,success:true,generation:1,message:'',nativeVaultCommitMs:7.25});
    assert.equal(accepted,true);
    await request;
    const telemetry=s.GH_PERSISTENCE.telemetry();
    assert.ok(Number.isFinite(telemetry.timings.lastNativeAck.nativeAckLatencyMs));
    assert.ok(Number.isFinite(telemetry.timings.lastNativeAck.bridgeDispatchMs));
    assert.equal(telemetry.timings.lastNativeAck.nativeVaultCommitMs,7.25);
    assert.equal(Object.prototype.hasOwnProperty.call(lastStatus||{},'nativeVaultCommitMs'),false,'runtime-only native timing must not flow into persistent control-plane status');
  }

  console.log('build337 instrumentation baseline: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
