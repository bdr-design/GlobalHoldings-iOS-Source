'use strict';
const assert=require('assert'),crypto=require('crypto'),fs=require('fs');
const {harness,minimal}=require('./helpers/core-harness');

function setupNative(){
  const h=harness(['save-schema','persistence-core']);
  h.s.GH_CONTROL_PLANE={sha256:x=>crypto.createHash('sha256').update(x).digest('hex')};
  let envelope=null,generation=0;
  const postMessage=e=>{
    envelope=e;
    setTimeout(()=>{
      if(['saveManualSlot','loadManualSlot','clearManualSlot'].includes(e.action)){
        const metadata=e.action==='saveManualSlot'?{index:e.index,runtimeVersion:e.appVersion||null,simSeconds:Number(JSON.parse(e.saveJSON).simSeconds)||0,saveRevision:e.saveRevision,resetEpoch:e.resetEpoch,savedAt:1,label:e.label||''}:undefined;
        const detail={action:e.action,requestId:e.requestId,index:e.index,success:true};
        if(metadata)detail.metadata=metadata;
        if(e.action==='loadManualSlot')detail.generation=++generation;
        h.s.GH_PERSISTENCE.receiveSlotAck(detail);
      }else h.s.GH_PERSISTENCE.receiveAck({...e,generation:++generation,success:true});
    },0);
  };
  h.s.webkit={messageHandlers:{saveBridge:{postMessage},updateBridge:{postMessage}}};
  return {...h,p:h.s.GH_PERSISTENCE,getEnvelope:()=>envelope};
}

(async()=>{
  {
    const h=setupNative(),state=minimal();
    // Larger than browser hard limit, but far below the 30 MB native contract.
    state.notes='x'.repeat(5*1024*1024);
    const out=await h.p.commitDurableState(state,{storageKey:'main',timeoutMs:200});
    assert(out.ok&&out.ack.native===true,'native durable save must succeed');
    assert.strictEqual(out.browserCache,false,'oversized world must not be forced into browser cache');
    assert.strictEqual(h.data.get('main'),undefined,'oversized native save must not leave a partial browser copy');
    assert(h.getEnvelope()?.saveJSON?.length>5*1024*1024,'full payload must reach Native Save Vault');
  }

  {
    const h=setupNative(),state=minimal();
    state.notes='x'.repeat(5*1024*1024);
    const out=h.p.commitState(state,{storageKey:'main',timeoutMs:200});
    assert(out.ok,'queued native save must not be vetoed by browser quota');
    assert.strictEqual(out.browserCache,false);
    assert((await out.native).ok,'queued native mirror must acknowledge');
    await h.p.drain();
  }

  {
    const {s}=harness(['save-schema','persistence-core','migration-core']);
    const native={...minimal(),saveRevision:9,simSeconds:86400,notes:'native-authority'};
    s.__GH_NATIVE_SAVE_JSON__=JSON.stringify(native);
    s.localStorage.setItem('main',JSON.stringify({...native,saveRevision:99,notes:'stale-browser-copy'}));
    const loaded=s.GH_MIGRATION_CORE.load({defaultState:minimal(),storageKey:'main',legacyStorageKeys:[],resetMarkerKey:'reset',saveSchema:s.GH_SAVE_SCHEMA});
    assert.strictEqual(loaded.source,'native');
    assert.strictEqual(loaded.state.notes,'native-authority','native vault must win over a divergent browser cache');
    assert.strictEqual(s.__GH_NATIVE_SAVE_JSON__,undefined,'bootstrap payload must be released after successful parse');
  }

  {
    const h=setupNative(),state=minimal();
    state.notes='s'.repeat(5*1024*1024);
    const out=await h.p.saveSlot(0,state,{appVersion:'3.0.0',label:'large-native-slot'});
    assert(out.ok&&out.native===true,'manual slot must wait for and receive Native ACK');
    assert.strictEqual(h.getEnvelope().action,'saveManualSlot');
    assert(h.getEnvelope().saveJSON.length>4*1024*1024,'manual slot payload must exceed the browser 4 MB contract');
    assert.strictEqual(h.data.get('global-holdings-save-slot-1'),undefined,'native manual slots must not duplicate the full payload into localStorage');
    assert(h.p.slotStatus(0).exists,'ACK metadata must make the native slot visible immediately');
    const loaded=await h.p.loadSlot(0,{appVersion:'3.0.0'});
    assert(loaded.ok&&loaded.reloadRequired===true,'native slot load must be ACKed before reload');
    const cleared=await h.p.clearSlot(0);
    assert(cleared.ok,'native slot clear must be ACKed');
    assert.strictEqual(h.p.slotStatus(0).exists,false,'cleared native slot metadata must disappear immediately');
  }

  {
    const h=setupNative(),previous=minimal(),next={...minimal(),saveRevision:2,resetEpoch:1};
    const out=await h.p.replaceState(next,previous,{storageKey:'main',appVersion:'3.0.0',clearManualSlots:true});
    assert(out.ok&&out.native===true);
    assert.strictEqual(h.getEnvelope().action,'resetGameSave');
    assert.strictEqual(h.getEnvelope().clearManualSlots,true,'new-game reset must explicitly clear native manual slots');
  }

  const swift=fs.readFileSync('iOS/GlobalHoldings/GlobalSaveVault.swift','utf8');
  const controller=fs.readFileSync('iOS/GlobalHoldings/GameViewController.swift','utf8');
  assert(swift.includes('window.__GH_NATIVE_SAVE_JSON__=raw'),'native bootstrap must inject the authoritative payload directly');
  assert(!swift.includes("localStorage.setItem(key,value)"),'native bootstrap must not write the full save to localStorage');
  assert(controller.includes('JSON.stringify(window.__GH_STATE__||null)'),'native update/checkpoint paths must capture in-memory state');
  assert(!controller.includes("localStorage.getItem('global-holdings-world-v2.0.0')"),'native lifecycle must not depend on the complete localStorage save');
  assert(!controller.includes("localStorage.setItem('global-holdings-world-v2.0.0'"),'native recovery must not restore through localStorage');
  const advanced=fs.readFileSync('WebApp/advanced-core.js','utf8');
  const app=fs.readFileSync('WebApp/app.js','utf8');
  assert(advanced.includes("out=await globalThis.GH_PERSISTENCE?.saveSlot?.(slot,s"),'save-slot UI must await the native slot ACK before reporting success');
  assert(app.includes('clearManualSlots:true,prepare:next=>'),'New Game must clear native manual slots in the same reset transaction');
  assert(swift.includes('try fm.copyItem(at: source, to: backup)'),'manual-slot reset must copy backups before source deletion');
  assert(swift.includes('let manualSlotHashes: [String?]?'),'reset journal must pin the exact pre-reset manual-slot set');
  assert(swift.includes('sha256(try Data(contentsOf: backup)) == expected'),'staged backups must be hash-verified before source deletion or recovery');
  assert(swift.includes('sha256(try Data(contentsOf: source)) == expected'),'recovery must preserve a still-valid original if backup staging was interrupted');
  assert(swift.includes('if clearManualSlots { self.discardManualSlotResetBackups() }'),'successful reset must finalize staged manual-slot deletion');
  assert(controller.includes('case .success(let metadata):\n                        self?.refreshNativeBootstrapScript()'),'manual-slot save must refresh future bootstrap metadata');
  assert(controller.includes('case .success:\n                        self?.refreshNativeBootstrapScript()'),'manual-slot clear must refresh future bootstrap metadata');
  assert(controller.includes('self?.refreshNativeBootstrapScript()\n                    self?.applyWebBridgeUpdate'),'pre-update native commit must refresh bootstrap before the new runtime loads');

  console.log('BUILD315 native-first + native manual-slot persistence regression: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
