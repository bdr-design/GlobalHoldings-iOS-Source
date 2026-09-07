(()=>{
  'use strict';
  const VERSION='2.9.1', SLOT_FORMAT='global-holdings-save-slot-v2', EXPORT_FORMAT='global-holdings-save';
  const LIMITS=Object.freeze({softBytes:2*1024*1024,hardBytes:4*1024*1024,storageBytes:4.5*1024*1024,ackTimeoutMs:10000,pending:16});
  const slotKey=index=>{if(!Number.isInteger(Number(index))||index<0||index>2)throw new Error('invalid-save-slot');return `global-holdings-save-slot-${Number(index)+1}`;};
  const clone=v=>globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));
  const clock=()=>globalThis.performance?.now?.()??Date.now();
  const pending=new Map(), samples=[];
  let sequence=0,generation=0,locked=false,mirrorTail=Promise.resolve(),mirrorCount=0,mirrorError=null;
  function telemetry(row){samples.push(row);if(samples.length>32)samples.shift();return row;}
  function status(detail){if(globalThis.dispatchEvent&&globalThis.CustomEvent)globalThis.dispatchEvent(new CustomEvent('gh-persistence-status',{detail}));}
  function validateState(state){return globalThis.GH_SAVE_SCHEMA?.validate?.(state)||{ok:false,errors:['save-schema-unavailable']};}
  function assertState(state){const v=validateState(state);if(!v.ok)throw new Error(`invalid-save:${(v.errors||[]).join(',')}`);}
  function bytes(text){if(globalThis.TextEncoder)return new TextEncoder().encode(text).byteLength;let n=0;for(const c of text){const p=c.codePointAt(0);n+=p<128?1:p<2048?2:p<65536?3:4;}return n;}
  function inspectJSON(json,key='',options={}){
    if(typeof json!=='string')throw new Error('serialization-failed');
    const utf8Bytes=bytes(json),storageBytes=json.length*2,hard=Math.min(LIMITS.hardBytes,options.hardBytes||LIMITS.hardBytes);
    let totalStorageBytes=storageBytes+String(key).length*2;
    for(let i=0;i<(localStorage.length||0);i++){const k=localStorage.key(i);if(k!==key)totalStorageBytes+=(String(k).length+(localStorage.getItem(k)||'').length)*2;}
    const warning=utf8Bytes>=Math.min(LIMITS.softBytes,options.softBytes||LIMITS.softBytes)||storageBytes>=LIMITS.softBytes;
    if(utf8Bytes>hard||storageBytes>hard||totalStorageBytes>LIMITS.storageBytes){const e=new Error('save-size-hard-limit');e.measurement={utf8Bytes,storageBytes,totalStorageBytes};throw e;}
    return {utf8Bytes,storageBytes,totalStorageBytes,warning};
  }
  function restoreRaw(key,raw){if(raw===null)localStorage.removeItem(key);else localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw new Error('save-rollback-verification');}
  function writeJSON(key,json,options={}){
    const start=clock();let previous=null,attempted=false;
    try{
      const measurement=inspectJSON(json,key,options);previous=localStorage.getItem(key);attempted=true;
      localStorage.setItem(key,json);
      if(localStorage.getItem(key)!==json)throw new Error('save-readback-mismatch');
      telemetry({operation:'write',ok:true,...measurement,durationMs:clock()-start});
      if(measurement.warning)status({ok:true,warning:true,reason:'save-size-soft-warning',...measurement});
      return {ok:true,json,previous,...measurement};
    }catch(error){
      let rollbackError=null;
      if(attempted)try{if(localStorage.getItem(key)!==previous)restoreRaw(key,previous);}catch(e){rollbackError=String(e.message||e);}
      const out={ok:false,reason:String(error.message||error),rollbackError,...error.measurement};telemetry({operation:'write',...out,durationMs:clock()-start});return out;
    }
  }
  function writeState(key,state,options={}){const start=clock();try{assertState(state);const json=JSON.stringify(state);const out=writeJSON(key,json,options);telemetry({operation:'serialize',ok:out.ok,utf8Bytes:out.utf8Bytes,durationMs:clock()-start});return out;}catch(e){const out={ok:false,reason:`serialization-or-schema:${e.message||e}`};telemetry({operation:'serialize',...out,durationMs:clock()-start});return out;}}
  function bridgeFor(action){return globalThis.webkit?.messageHandlers?.[action==='resetGameSave'?'updateBridge':'saveBridge'];}
  function receiveAck(detail={}){
    const row=pending.get(detail.requestId);if(!row)return false;
    if(detail.action!==row.envelope.action||detail.saveRevision!==row.envelope.saveRevision||detail.resetEpoch!==row.envelope.resetEpoch||detail.saveHash!==row.envelope.saveHash||detail.saveSchemaVersion!=='2.0.0'||typeof detail.success!=='boolean')return false;
    if(detail.success&&(!Number.isSafeInteger(detail.generation)||detail.generation<=generation))return false;
    clearTimeout(row.timer);pending.delete(detail.requestId);
    if(detail.success){generation=detail.generation;row.resolve({ok:true,native:true,...detail});}
    else{const e=new Error(detail.message||'native-save-nack');e.code='NATIVE_NACK';row.reject(e);}
    status({ok:detail.success,validated:true,...detail});return true;
  }
  function requestNative(action,json,options={}){
    const bridge=bridgeFor(action);if(!bridge)return Promise.resolve({ok:true,native:false});
    if(pending.size>=LIMITS.pending)return Promise.reject(new Error('native-save-backpressure'));
    const hash=globalThis.GH_CONTROL_PLANE?.sha256;if(!hash)return Promise.reject(new Error('save-hash-owner-unavailable'));
    const state=JSON.parse(json);assertState(state);
    const envelope={action,requestId:`${action}-${Date.now()}-${++sequence}`,saveJSON:json,saveHash:hash(json),saveRevision:Number(state.saveRevision)||0,resetEpoch:Number(state.resetEpoch)||0,saveSchemaVersion:'2.0.0',appVersion:options.appVersion||VERSION};
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(envelope.requestId);const e=new Error('native-save-ack-timeout');e.code='ACK_TIMEOUT';reject(e);},options.timeoutMs||LIMITS.ackTimeoutMs);
      pending.set(envelope.requestId,{resolve,reject,timer,envelope});
      try{bridge.postMessage(envelope);}catch(e){clearTimeout(timer);pending.delete(envelope.requestId);reject(e);}
    });
  }
  globalThis.addEventListener?.('gh-native-save-ack',e=>receiveAck(e.detail));
  globalThis.addEventListener?.('gh-native-reset-ack',e=>receiveAck(e.detail));
  function commitState(state,{storageKey='global-holdings-world-v2.0.0',appVersion=VERSION,...options}={}){
    if(locked)return {ok:false,reason:'lifecycle-locked'};
    if(bridgeFor('commitSave')&&mirrorCount>=LIMITS.pending)return {ok:false,reason:'native-save-backpressure'};
    const out=writeState(storageKey,state,options);if(!out.ok)return out;
    if(bridgeFor('commitSave')){
      mirrorCount++;
      const work=mirrorTail.then(()=>requestNative('commitSave',out.json,{appVersion,...options}));
      mirrorTail=work.then(ack=>{mirrorError=null;return ack;},error=>{
        mirrorError=error;
        try{if(localStorage.getItem(storageKey)===out.json)restoreRaw(storageKey,out.previous);}catch(e){error.rollbackError=String(e.message||e);}
        status({ok:false,reason:error.message,critical:!!error.rollbackError});return {ok:false,reason:error.message};
      }).finally(()=>{mirrorCount--;});
      out.native=mirrorTail;
    }
    return out;
  }
  async function drain(){await mirrorTail;if(mirrorError)throw mirrorError;return {ok:true,generation};}
  async function replaceState(next,previous,{storageKey='global-holdings-world-v2.0.0',resetMarkerKey,appVersion=VERSION,timeoutMs,apply,cleanupKeys=[]}={}){
    if(locked)throw new Error('lifecycle-locked');locked=true;
    let nativeAttempted=false,oldRaw=null,oldMarker=null,browserTouched=false;
    let oldJSON;
    try{
      await drain();assertState(next);assertState(previous);oldJSON=JSON.stringify(previous);
      const json=JSON.stringify(next);inspectJSON(json,storageKey);oldRaw=localStorage.getItem(storageKey);oldMarker=resetMarkerKey?localStorage.getItem(resetMarkerKey):null;
      // The current in-memory game is the compensating checkpoint. Native owns durability.
      nativeAttempted=!!bridgeFor('resetGameSave');
      await requestNative('resetGameSave',json,{appVersion,timeoutMs});
      const out=writeJSON(storageKey,json);if(!out.ok){const writeError=new Error(out.reason);writeError.rollbackError=out.rollbackError;throw writeError;}browserTouched=true;
      if(resetMarkerKey){localStorage.setItem(resetMarkerKey,String(next.resetEpoch||0));if(localStorage.getItem(resetMarkerKey)!==String(next.resetEpoch||0))throw new Error('reset-marker-verification');}
      if(apply)apply(next);
      for(const key of cleanupKeys)if(key!==storageKey&&key!==resetMarkerKey)try{localStorage.removeItem(key);}catch{}
      mirrorError=null;return {ok:true,native:nativeAttempted,generation};
    }catch(error){
      try{if(browserTouched)restoreRaw(storageKey,oldRaw);if(resetMarkerKey&&browserTouched)restoreRaw(resetMarkerKey,oldMarker);}catch(e){error.rollbackError=String(e.message||e);}
      if(nativeAttempted)try{await requestNative('resetGameSave',oldJSON,{appVersion,timeoutMs});}catch(e){error.compensationError=String(e.message||e);}
      if(error.rollbackError||error.compensationError){error.critical=true;globalThis.GH_CONTROL_PLANE?.incident?.(previous,{fingerprint:'RESET_COMPENSATION_FAILED',code:'RESET_COMPENSATION_FAILED',severity:'critical',domain:'save',title:'فشل استرداد الحفظ بعد عملية الاستبدال',detail:String(error.compensationError||error.rollbackError)});}
      throw error;
    }finally{locked=false;}
  }
  function parseSlot(raw){if(!raw)return {ok:false,reason:'empty'};try{const p=JSON.parse(raw),state=p?.format===SLOT_FORMAT?p.state:p;assertState(state);return {ok:true,state,meta:p?.format===SLOT_FORMAT?p.meta||{}:{legacy:true}};}catch(e){return {ok:false,reason:'invalid-save',error:String(e.message||e)};}}
  function slotStatus(index){try{const p=parseSlot(localStorage.getItem(slotKey(index)));return p.ok?{exists:true,meta:p.meta}:{exists:false,reason:p.reason};}catch(e){return {exists:false,reason:'storage-error'};}}
  function saveSlot(index,state,meta={}){
    try{assertState(state);const day=Math.floor((Number(state.simSeconds)||0)/86400)+1,envelope={format:SLOT_FORMAT,version:VERSION,saveSchemaVersion:'2.0.0',meta:{appVersion:meta.appVersion||VERSION,saveRevision:Number(state.saveRevision)||0,simSeconds:Number(state.simSeconds)||0,day,label:`اليوم ${day}`},state};const out=writeJSON(slotKey(index),JSON.stringify(envelope));return {...out,meta:envelope.meta};}catch(e){return {ok:false,reason:String(e.message||e)};}
  }
  function loadSlot(index,{storageKey='global-holdings-world-v2.0.0',appVersion=VERSION,previousState}={}){
    try{const p=parseSlot(localStorage.getItem(slotKey(index)));if(!p.ok)return p;
      if(bridgeFor('resetGameSave')){const previous=previousState||JSON.parse(localStorage.getItem(storageKey));return replaceState(p.state,previous,{storageKey,appVersion}).then(()=>p,e=>({ok:false,reason:String(e.message||e)}));}
      const out=writeState(storageKey,p.state);return out.ok?p:out;
    }catch(e){return {ok:false,reason:String(e.message||e)};}
  }
  function clearSlot(index){try{localStorage.removeItem(slotKey(index));return {ok:true};}catch(e){return {ok:false,error:String(e.message||e)};}}
  function exportSave(state,{appVersion=VERSION}={}){
    try{assertState(state);const day=Math.floor((Number(state.simSeconds)||0)/86400)+1,pack={format:EXPORT_FORMAT,version:appVersion,saveSchemaVersion:'2.0.0',saveRevision:Number(state.saveRevision)||0,simSeconds:Number(state.simSeconds)||0,day,state:clone(state)};const blob=new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}),a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`GlobalHoldings_Save_v${appVersion}_D${day}.ghsave`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return {ok:true,filename:a.download};}catch(e){return {ok:false,reason:'export-failed',error:String(e.message||e)};}
  }
  function migrateMetadata(state){state.advanced=state.advanced||{};state.advanced.saveSlots=Array.isArray(state.advanced.saveSlots)?state.advanced.saveSlots:[null,null,null];for(let i=0;i<3;i++){const s=slotStatus(i);state.advanced.saveSlots[i]=s.exists?{date:s.meta?.label||`اليوم ${s.meta?.day||'—'}`,version:s.meta?.appVersion||'legacy',simSeconds:Number(s.meta?.simSeconds)||0}:null;}return state.advanced.saveSlots;}
  const API=Object.freeze({VERSION,SLOT_FORMAT,LIMITS,slotStatus,saveSlot,loadSlot,clearSlot,exportSave,migrateMetadata,parseSlot,inspectJSON,writeJSON,writeState,commitState,requestNative,receiveAck,drain,replaceState,isLocked:()=>locked,telemetry:()=>({generation,pending:pending.size,mirrorCount,samples:clone(samples)})});
  globalThis.GH_PERSISTENCE=API;if(globalThis.window&&window!==globalThis)window.GH_PERSISTENCE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
