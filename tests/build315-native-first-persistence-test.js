'use strict';
const assert=require('assert'),crypto=require('crypto'),fs=require('fs');
const {harness,minimal}=require('./helpers/core-harness');

function setupNative(){
  const h=harness(['save-schema','persistence-core']);
  h.s.GH_CONTROL_PLANE={sha256:x=>crypto.createHash('sha256').update(x).digest('hex')};
  let envelope=null;
  h.s.webkit={messageHandlers:{saveBridge:{postMessage:e=>{envelope=e;setTimeout(()=>h.s.GH_PERSISTENCE.receiveAck({...e,generation:1,success:true}),0);}}}};
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

  const swift=fs.readFileSync('iOS/GlobalHoldings/GlobalSaveVault.swift','utf8');
  const controller=fs.readFileSync('iOS/GlobalHoldings/GameViewController.swift','utf8');
  assert(swift.includes('window.__GH_NATIVE_SAVE_JSON__=raw'),'native bootstrap must inject the authoritative payload directly');
  assert(!swift.includes("localStorage.setItem(key,value)"),'native bootstrap must not write the full save to localStorage');
  assert(controller.includes('JSON.stringify(window.__GH_STATE__||null)'),'native update/checkpoint paths must capture in-memory state');
  assert(!controller.includes("localStorage.getItem('global-holdings-world-v2.0.0')"),'native lifecycle must not depend on the complete localStorage save');
  assert(!controller.includes("localStorage.setItem('global-holdings-world-v2.0.0'"),'native recovery must not restore through localStorage');

  console.log('BUILD315 native-first large-save persistence regression: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
