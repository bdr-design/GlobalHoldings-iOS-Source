'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness,minimal,ROOT}=require('./helpers/core-harness');
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const asset=()=>({id:'A-1',type:'air',assetMode:'air',ownerCompanyId:'air',baseFacility:'BASE-1',phase:'idle',progress:0,fuel:80,condition:90});
const seed=()=>({...minimal(),cash:9000,speed:2,simSeconds:100,assets:[asset()],eventLog:[]});

function setup(boot=seed(),withListener=true){
  const h=harness(),{s}=h,sent=[],events=[],incidents=[],nodes=new Map(),cancelled=[];
  if(boot){s.__GH_NATIVE_SAVE_JSON__=JSON.stringify(boot);s.__GH_NATIVE_SAVE_META__={generation:41,saveRevision:boot.saveRevision};}
  s.webkit={messageHandlers:{saveBridge:{postMessage:envelope=>sent.push(envelope)}}};
  for(const core of ['clone-core','kernel-core','transaction-core','save-schema','control-plane-core','persistence-core'])h.load(core);
  s.state=s.GH_TRANSACTION_CORE.enableKernelOwner(boot||seed());
  Object.assign(s,{storageKey:'main',APP_VERSION:'3.0.0',hardResetInProgress:false,durableCommandInProgress:false,
    routeTemplates:{},routeRuntimeForState:()=>({}),cancelSimulationPersistence:()=>cancelled.push('persistence'),
    simulationEngine:{cancelAdvance:reason=>cancelled.push(reason)},diag:()=>{},exportDiagnosticsFile:()=>{},
    GH_REALISM:{reconcilePendingDeliveryCount:()=>{}},
    GH_CONTROL_PLANE:{...s.GH_CONTROL_PLANE,incident:(_state,row)=>incidents.push(row),recordBridge:()=>{}}});
  const element=tag=>({tagName:tag,style:{},textContent:'',handlers:{},setAttribute(){},focus(){},addEventListener(name,fn){this.handlers[name]=fn;},append(...children){for(const child of children)if(child.id)nodes.set(child.id,child);}});
  s.document={createElement:element,body:{appendChild:node=>nodes.set(node.id,node)}};
  s.$=id=>nodes.get(id);s.location={reload:()=>{}};
  if(withListener){
    const restoreStart=app.indexOf('  function replaceLiveState('),restoreEnd=app.indexOf('  let durableCommandSettlement=',restoreStart);
    const statusStart=app.indexOf('  let savePressureNoticeShown=false;'),statusEnd=app.indexOf("  window.addEventListener('gh-native-recovery'",statusStart);
    assert(restoreStart>=0&&restoreEnd>restoreStart&&statusStart>=0&&statusEnd>statusStart);
    vm.runInContext(app.slice(restoreStart,restoreEnd)+app.slice(statusStart,statusEnd),s,{filename:'app-native-recovery.js'});
  }
  s.addEventListener('gh-persistence-status',event=>events.push(event.detail));
  const ack=(envelope,generation,success)=>s.GH_PERSISTENCE.receiveAck({...envelope,generation,success,message:success?'':'native-refused'});
  return {...h,s,P:s.GH_PERSISTENCE,sent,events,incidents,nodes,cancelled,ack};
}
function gameplay(state){return {saveRevision:state.saveRevision,cash:state.cash,simSeconds:state.simSeconds,assets:JSON.parse(JSON.stringify(state.assets)),finance:JSON.parse(JSON.stringify(state.finance)),treasury:JSON.parse(JSON.stringify(state.treasury)),eventLog:JSON.parse(JSON.stringify(state.eventLog))};}

(async()=>{
  let passed=0;
  {
    const e=setup(),{s,P}=e;
    const first=P.commitState(s.state,{storageKey:'main',timeoutMs:1000});await tick();
    assert.equal(first.ok,true);assert.equal(e.sent.length,1);
    assert.equal(e.data.has('main'),false,'browser cache must wait for the Native ACK');
    assert.equal(e.ack(e.sent[0],41,true),false,'boot generation cannot be replayed');
    assert.equal(e.ack(e.sent[0],42,true),true);await first.native;
    const confirmed=gameplay(s.state),durableJSON=e.sent[0].saveJSON;
    assert.equal(e.data.get('main'),durableJSON,'cache publishes exactly the ACKed payload');
    s.state.cash=4000;s.state.assets[0].fuel=23;s.state.finance.taxPayable=44;
    s.state.treasury.accounts[0].balance=4000;s.state.eventLog.push({id:'LIVE'});s.state.simSeconds=900;
    const failed=P.commitState(s.state,{storageKey:'main',timeoutMs:1000});await tick();
    assert.equal(failed.ok,true,failed.reason);assert.equal(e.sent.length,2);assert.equal(e.data.get('main'),durableJSON);
    s.state.cash=3500;s.state.assets[0].fuel=12;s.state.finance.taxPayable=55;s.state.simSeconds=950;
    assert.equal(P.commitState(s.state,{storageKey:'main'}).deferred,true,'overlapping edits coalesce');
    assert.equal(e.ack(e.sent[1],43,false),true);assert.equal((await failed.native).ok,false);
    assert.deepEqual(gameplay(s.state),confirmed,'all relevant live game fields return to the verified checkpoint');
    assert.equal(s.state.speed,0,'gameplay is paused while Native is reconciled');
    assert.equal(e.data.get('main'),durableJSON,'NACK never publishes the attempted browser cache');
    assert.equal(e.nodes.has('nativeSaveReconcile'),true,'UI remains closed until a Native reload');
    assert(e.cancelled.includes('native-save-reconciliation'),'a prepared Worker advance is cancelled');
    assert.equal(P.isLocked(),true);assert.equal(P.telemetry().ordinaryDirty,false);
    assert.equal(e.ack(e.sent[1],44,true),false,'late ACK cannot publish a rejected request');
    await tick();assert.equal(e.sent.length,2,'dirty state never flushes after a NACK');
    await assert.rejects(P.drain(),/native-refused/);passed++;

    // Simulate a fresh WebKit document with a poisoned compatibility cache.
    const restarted=harness(),r=restarted.s;r.__GH_NATIVE_SAVE_JSON__=durableJSON;r.__GH_NATIVE_SAVE_META__={generation:42,saveRevision:confirmed.saveRevision};
    r.localStorage.setItem('main',e.sent[1].saveJSON);
    restarted.load('save-schema');restarted.load('migration-core');
    const loaded=r.GH_MIGRATION_CORE.load({defaultState:seed(),storageKey:'main',saveSchema:r.GH_SAVE_SCHEMA});
    assert.equal(loaded.source,'native');
    for(const field of ['saveRevision','cash','simSeconds'])assert.equal(loaded.state[field],confirmed[field],`Native restart ${field}`);
    assert.equal(loaded.state.assets[0].fuel,confirmed.assets[0].fuel);
    assert.equal(loaded.state.finance.taxPayable,confirmed.finance.taxPayable);
    assert.equal(loaded.state.treasury.accounts[0].balance,confirmed.treasury.accounts[0].balance);
    assert.deepEqual(loaded.state.eventLog,confirmed.eventLog);passed++;
  }
  {
    const e=setup(),{s,P}=e;s.state.cash=100;s.state.simSeconds=350;
    const pending=P.commitState(s.state,{storageKey:'main',timeoutMs:15});await tick();
    const out=await pending.native;assert.equal(out.ok,false);assert.equal(out.uncertainNative,true);
    assert.equal(e.data.has('main'),false);assert.equal(e.nodes.has('nativeSaveReconcile'),true);
    assert.equal(P.isLocked(),true);assert.equal(s.state.cash,100,'an uncertain commit must not assume the old Native checkpoint');
    assert.equal(s.state.speed,0);assert(e.cancelled.includes('native-save-reconciliation'));
    assert.equal(e.ack(e.sent[0],42,true),false,'late ACK after timeout cannot reopen gameplay');
    const restarted=harness(),r=restarted.s;r.__GH_NATIVE_SAVE_JSON__=e.sent[0].saveJSON;
    r.localStorage.setItem('main',JSON.stringify(seed()));restarted.load('save-schema');restarted.load('migration-core');
    const loaded=r.GH_MIGRATION_CORE.load({defaultState:seed(),storageKey:'main',saveSchema:r.GH_SAVE_SCHEMA});
    assert.equal(loaded.state.cash,100,'restart can select a Native generation committed after the JS timeout');passed++;
  }
  {
    const native=seed(),e=setup(native),{s,P}=e;
    s.state.cash=150;s.state.assets[0].fuel=20;s.state.simSeconds=400;
    const pending=P.commitState(s.state,{storageKey:'main',timeoutMs:1000});await tick();
    e.ack(e.sent[0],42,false);await pending.native;
    assert.equal(s.state.cash,native.cash,'first NACK restores the document-start Native checkpoint');
    assert.equal(s.state.assets[0].fuel,native.assets[0].fuel);
    assert.equal(s.state.simSeconds,native.simSeconds);assert.equal(s.state.saveRevision,native.saveRevision);
    assert.equal(e.data.has('main'),false);assert.equal(P.isLocked(),true);passed++;
  }
  {
    const e=setup(null),{s,P}=e;s.state.cash=17;
    const first=P.commitState(s.state,{storageKey:'main',timeoutMs:1000});await tick();e.ack(e.sent[0],1,false);await first.native;
    assert.equal(P.confirmedNativeState().ok,false,'pristine installs have no speculative Native checkpoint');
    assert.equal(e.nodes.has('nativeSaveReconcile'),true);assert.equal(P.isLocked(),true);passed++;
  }
  console.log(JSON.stringify({suite:'build344-native-nack-recovery',passed,total:5,scope:'real persistence, schema and Kernel owner; app listener and Native endpoint controlled; no iOS device'}));
})().catch(error=>{console.error(error);process.exitCode=1;});
