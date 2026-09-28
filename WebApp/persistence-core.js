(()=>{
  'use strict';
  const VERSION='3.0.0', SLOT_FORMAT='global-holdings-save-slot-v2', EXPORT_FORMAT='global-holdings-save';
  const PERSISTENCE_LIMITS=Object.freeze({softBytes:2*1024*1024,hardBytes:4*1024*1024,storageBytes:4.5*1024*1024,nativeHardBytes:30*1024*1024,ackTimeoutMs:10000,pending:16});
  const slotKey=index=>{if(!Number.isInteger(Number(index))||index<0||index>2)throw new Error('invalid-save-slot');return `global-holdings-save-slot-${Number(index)+1}`;};
  const clone=v=>typeof globalThis.GH_CLONE_CORE?.clone==='function'?globalThis.GH_CLONE_CORE.clone(v):(globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v)));
  const clock=()=>globalThis.performance?.now?.()??Date.now();
  const pending=new Map(), slotPending=new Map(), archivePending=new Map(), samples=[],timingSamples=[];
  let lastSaveBreakdown=null,lastNativeAck=null;
  function rememberTiming(row){const value={...row,recordedAtMs:Date.now()};timingSamples.push(value);if(timingSamples.length>24)timingSamples.shift();return value;}
  const bootGeneration=Number(globalThis.__GH_NATIVE_SAVE_META__?.generation);
  let sequence=0,slotSequence=0,streamOrdinal=0,generation=Number.isSafeInteger(bootGeneration)&&bootGeneration>=0?bootGeneration:0,locked=false,durableLocked=false,recoveryRequired=false,ordinaryInFlight=null,ordinaryDirty=false,ordinaryDirtyState=null,ordinaryDirtyOptions=null,ordinaryError=null,ordinarySnapshotting=false;
  // The document-start Native bootstrap is authoritative even when WebKit has
  // an older compatibility cache. Retain its JSON for a delayed explicit NACK;
  // a timeout cannot use this checkpoint because Native may have committed.
  let nativeConfirmedJSON=typeof globalThis.__GH_NATIVE_SAVE_JSON__==='string'?globalThis.__GH_NATIVE_SAVE_JSON__:null;
  let nativeConfirmedGeneration=nativeConfirmedJSON?generation:null;
  let nativeConfirmedRevision=nativeConfirmedJSON?Number(globalThis.__GH_NATIVE_SAVE_META__?.saveRevision):null;
  let nativeConfirmedEpoch=nativeConfirmedJSON?Number(globalThis.__GH_NATIVE_SAVE_META__?.resetEpoch):null;
  const nativeSlotMeta=new Map((Array.isArray(globalThis.__GH_NATIVE_SLOT_META__)?globalThis.__GH_NATIVE_SLOT_META__:[]).filter(row=>Number.isInteger(Number(row?.index))&&Number(row.index)>=0&&Number(row.index)<=2).map(row=>[Number(row.index),clone(row)]));
  function telemetry(row){samples.push(row);if(samples.length>32)samples.shift();return row;}
  function status(detail){if(globalThis.dispatchEvent&&globalThis.CustomEvent)globalThis.dispatchEvent(new CustomEvent('gh-persistence-status',{detail}));}
  function validateState(state,options){return globalThis.GH_SAVE_SCHEMA?.validate?.(state,options)||{ok:false,errors:['save-schema-unavailable']};}
  function assertState(state,options){const v=validateState(state,options);if(!v.ok)throw new Error(`invalid-save:${(v.errors||[]).join(',')}`);}
  function bytes(text){if(globalThis.TextEncoder)return new TextEncoder().encode(text).byteLength;let n=0;for(const c of text){const p=c.codePointAt(0);n+=p<128?1:p<2048?2:p<65536?3:4;}return n;}
  function inspectJSON(json,key='',options={}){
    if(typeof json!=='string')throw new Error('serialization-failed');
    const utf8Bytes=bytes(json),storageBytes=json.length*2,hard=Math.min(PERSISTENCE_LIMITS.hardBytes,options.hardBytes||PERSISTENCE_LIMITS.hardBytes);
    let totalStorageBytes=storageBytes+String(key).length*2;
    for(let i=0;i<(localStorage.length||0);i++){const k=localStorage.key(i);if(k!==key)totalStorageBytes+=(String(k).length+(localStorage.getItem(k)||'').length)*2;}
    const warning=utf8Bytes>=Math.min(PERSISTENCE_LIMITS.softBytes,options.softBytes||PERSISTENCE_LIMITS.softBytes)||storageBytes>=PERSISTENCE_LIMITS.softBytes;
    if(utf8Bytes>hard||storageBytes>hard||totalStorageBytes>PERSISTENCE_LIMITS.storageBytes){const e=new Error('save-size-hard-limit');e.measurement={utf8Bytes,storageBytes,totalStorageBytes};throw e;}
    return {utf8Bytes,storageBytes,totalStorageBytes,warning};
  }
  function inspectNativeJSON(json){
    if(typeof json!=='string')throw new Error('serialization-failed');
    const utf8Bytes=bytes(json),storageBytes=json.length*2,warning=utf8Bytes>=PERSISTENCE_LIMITS.softBytes;
    if(utf8Bytes>PERSISTENCE_LIMITS.nativeHardBytes){const e=new Error('native-save-size-hard-limit');e.measurement={utf8Bytes,storageBytes};throw e;}
    return {utf8Bytes,storageBytes,totalStorageBytes:null,warning};
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
    const streamed=row.stream===true,hashOK=streamed?(typeof detail.saveHash==='string'&&/^[a-f0-9]{64}$/.test(detail.saveHash)):detail.saveHash===row.envelope.saveHash;
    if(detail.action!==row.envelope.action||detail.saveRevision!==row.envelope.saveRevision||detail.resetEpoch!==row.envelope.resetEpoch||!hashOK||detail.saveSchemaVersion!=='2.0.0'||typeof detail.success!=='boolean')return false;
    if(detail.success&&(!Number.isSafeInteger(detail.generation)||detail.generation<=generation))return false;
    const ackAt=clock(),nativeVaultCommitMs=Number(detail.nativeVaultCommitMs);
    lastNativeAck=rememberTiming({kind:'native-ack',requestId:detail.requestId,action:detail.action,saveRevision:Number(detail.saveRevision)||0,generation:Number(detail.generation)||0,success:detail.success===true,bridgeDispatchMs:Number.isFinite(row.bridgeDispatchMs)?row.bridgeDispatchMs:null,nativeAckLatencyMs:Number.isFinite(row.dispatchedAt)?Math.max(0,ackAt-row.dispatchedAt):null,nativeVaultCommitMs:Number.isFinite(nativeVaultCommitMs)?Math.max(0,nativeVaultCommitMs):null});
    clearTimeout(row.timer);pending.delete(detail.requestId);
    if(detail.success){generation=detail.generation;nativeConfirmedJSON=typeof row.envelope.saveJSON==='string'?row.envelope.saveJSON:(typeof row.mirrorJSON==='string'?row.mirrorJSON:null);nativeConfirmedGeneration=nativeConfirmedJSON?generation:null;nativeConfirmedRevision=nativeConfirmedJSON?row.envelope.saveRevision:null;nativeConfirmedEpoch=nativeConfirmedJSON?row.envelope.resetEpoch:null;row.resolve({ok:true,native:true,...detail});}
    else{const e=new Error(detail.message||'native-save-nack');e.code='NATIVE_NACK';row.reject(e);}
    const statusDetail={...detail};delete statusDetail.nativeVaultCommitMs;status({ok:detail.success,validated:true,...statusDetail});return true;
  }
  function saveHash(json){
    const text=String(json),owner=globalThis.GH_CONTROL_PLANE?.sha256;if(!owner)throw new Error('save-hash-owner-unavailable');
    const subtle=globalThis.crypto?.subtle;
    if(text.length>=262144&&subtle&&typeof TextEncoder!=='undefined'){
      try{return subtle.digest('SHA-256',new TextEncoder().encode(text)).then(digest=>[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join(''),()=>owner(text));}catch(_error){}
    }
    return owner(text);
  }
  const streamYield=()=>new Promise(resolve=>{
    try{
      const schedulerYield=globalThis.scheduler?.yield;
      if(typeof schedulerYield==='function'){schedulerYield.call(globalThis.scheduler).then(resolve,()=>setTimeout(resolve,0));return;}
      if(typeof globalThis.requestAnimationFrame==='function'){globalThis.requestAnimationFrame(()=>resolve());return;}
    }catch(_error){}
    setTimeout(resolve,0);
  });
  async function cooperativeJSONStream(root,onChunk,{budgetMs=3,guard=null}={}){
    if(typeof onChunk!=='function')throw new TypeError('save-stream-chunk-sink-required');
    const encoder=new TextEncoder(),seen=new Set(),stack=[{kind:'value',value:root,key:'',array:false,root:true}];
    let buffer='',utf8Bytes=0,chunks=0,yields=0,cpuMs=0,maxSliceMs=0,sliceStart=clock(),ops=0;
    const flush=()=>{
      if(!buffer)return;
      const text=buffer;buffer='';
      const chunkBytes=encoder.encode(text).byteLength;
      if(chunkBytes>PERSISTENCE_LIMITS.nativeHardBytes||utf8Bytes+chunkBytes>PERSISTENCE_LIMITS.nativeHardBytes)throw Object.assign(new Error('native-save-size-hard-limit'),{measurement:{utf8Bytes:utf8Bytes+chunkBytes,storageBytes:null}});
      onChunk(text,chunks,chunkBytes);chunks++;utf8Bytes+=chunkBytes;
    };
    const emit=text=>{
      text=String(text);
      while(text.length){
        const room=16384-buffer.length;
        let take=Math.min(Math.max(1,room),text.length);
        if(take<text.length&&take>0){const last=text.charCodeAt(take-1),next=text.charCodeAt(take);if(last>=0xD800&&last<=0xDBFF&&next>=0xDC00&&next<=0xDFFF)take--;}
        if(take<=0){flush();continue;}
        buffer+=text.slice(0,take);text=text.slice(take);
        if(buffer.length>=16384)flush();
      }
    };
    const checkpoint=async force=>{
      const elapsed=Math.max(0,clock()-sliceStart);maxSliceMs=Math.max(maxSliceMs,elapsed);
      if(force||elapsed>=budgetMs){
        cpuMs+=elapsed;flush();
        if(typeof guard==='function'&&guard()!==true){const error=new Error('save-snapshot-revision-conflict');error.code='SAVE_SNAPSHOT_RETRY';throw error;}
        if(!force){yields++;await streamYield();sliceStart=clock();}
      }
    };
    while(stack.length){
      const frame=stack.pop();
      if(frame.kind==='raw'){emit(frame.text);}
      else if(frame.kind==='close'){seen.delete(frame.value);emit(frame.text);}
      else if(frame.kind==='array'){
        if(frame.index>=frame.value.length)continue;
        if(frame.index>0)emit(',');
        stack.push({kind:'array',value:frame.value,index:frame.index+1});
        const value=frame.value[frame.index],type=typeof value;
        stack.push({kind:'value',value:(value===undefined||type==='function'||type==='symbol')?null:value,key:String(frame.index),array:true,root:false});
      }else if(frame.kind==='object'){
        let index=frame.index,found=false;
        while(index<frame.keys.length){
          const key=frame.keys[index++],value=frame.value[key],type=typeof value;
          if(value===undefined||type==='function'||type==='symbol')continue;
          if(frame.wrote)emit(',');emit(JSON.stringify(key));emit(':');
          stack.push({kind:'object',value:frame.value,keys:frame.keys,index,wrote:true});
          stack.push({kind:'value',value,key,array:false,root:false});
          found=true;break;
        }
        if(!found)continue;
      }else{
        let value=frame.value;
        if(value&&typeof value==='object'&&typeof value.toJSON==='function')value=value.toJSON(frame.key);
        const type=typeof value;
        if(value===null){emit('null');}
        else if(type==='string'){emit(JSON.stringify(value));}
        else if(type==='number'){emit(Number.isFinite(value)?String(value):'null');}
        else if(type==='boolean'){emit(value?'true':'false');}
        else if(type==='bigint'){throw new TypeError('Do not know how to serialize a BigInt');}
        else if(type==='undefined'||type==='function'||type==='symbol'){if(frame.root)return {jsonUndefined:true,utf8Bytes:0,chunks:0,yields,cpuMs,maxSliceMs};else if(frame.array)emit('null');}
        else if(type==='object'){
          if(seen.has(value))throw new TypeError('Converting circular structure to JSON');
          seen.add(value);
          if(Array.isArray(value)){emit('[');stack.push({kind:'close',value,text:']'});stack.push({kind:'array',value,index:0});}
          else{emit('{');stack.push({kind:'close',value,text:'}'});stack.push({kind:'object',value,keys:Object.keys(value),index:0,wrote:false});}
        }
      }
      if((++ops&127)===0)await checkpoint(false);
    }
    await checkpoint(true);
    return {utf8Bytes,chunks,yields,cpuMs,maxSliceMs};
  }
  async function requestNativeStream(state,options={}){
    const bridge=bridgeFor('commitSave');if(!bridge)throw new Error('native-save-stream-bridge-unavailable');
    if(pending.size>=PERSISTENCE_LIMITS.pending)throw new Error('native-save-backpressure');
    const saveRevision=Number(options.saveRevision),resetEpoch=Number(options.resetEpoch);
    if(!Number.isSafeInteger(saveRevision)||saveRevision<0||!Number.isSafeInteger(resetEpoch)||resetEpoch<0)throw new Error('native-save-stream-envelope-invalid');
    const ordinal=++streamOrdinal,requestId='commitSave-'+Date.now()+'-'+(++sequence),streamId='S'+Date.now().toString(36)+'-'+ordinal.toString(36)+'-'+sequence.toString(36),base={protocolVersion:1,requestId,streamId,streamOrdinal:ordinal,saveRevision,resetEpoch,saveSchemaVersion:'2.0.0',appVersion:options.appVersion||VERSION};
    const inputRevision=globalThis.GH_TRANSACTION_CORE?.inputRevision,sourceRevision=typeof inputRevision==='function'?inputRevision(state):null;
    const guard=()=>sourceRevision===null||inputRevision(state)===sourceRevision;
    const mirrorParts=[];let mirrorBytes=0,mirrorEnabled=true,committed=false;
    const abort=()=>{try{bridge.postMessage({...base,action:'saveStreamAbort'});}catch(_error){}};
    ordinarySnapshotting=true;
    try{
      bridge.postMessage({...base,action:'saveStreamBegin'});
      const stats=await cooperativeJSONStream(state,(text,index,chunkBytes)=>{
        if(mirrorEnabled){mirrorBytes+=chunkBytes;if(mirrorBytes<=PERSISTENCE_LIMITS.hardBytes)mirrorParts.push(text);else{mirrorEnabled=false;mirrorParts.length=0;}}
        bridge.postMessage({...base,action:'saveStreamChunk',index,text});
      },{budgetMs:Math.max(1,Math.min(4,Number(options.streamBudgetMs)||3)),guard});
      if(!guard()){const error=new Error('save-snapshot-revision-conflict');error.code='SAVE_SNAPSHOT_RETRY';throw error;}
      if(stats.jsonUndefined)throw new Error('serialization-failed');
      const mirrorJSON=mirrorEnabled?mirrorParts.join(''):null;
      const envelope={action:'commitSave',requestId,saveRevision,resetEpoch,saveSchemaVersion:'2.0.0',appVersion:base.appVersion};
      const ack=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(requestId);const error=new Error('native-save-ack-timeout');error.code='ACK_TIMEOUT';reject(error);},options.timeoutMs||PERSISTENCE_LIMITS.ackTimeoutMs);
        pending.set(requestId,{resolve,reject,timer,envelope,stream:true,mirrorJSON,dispatchedAt:clock(),bridgeDispatchMs:null});
      });
      const dispatchStart=clock();bridge.postMessage({...base,action:'saveStreamCommit',chunks:stats.chunks,utf8Bytes:stats.utf8Bytes});const row=pending.get(requestId);if(row){row.bridgeDispatchMs=Math.max(0,clock()-dispatchStart);rememberTiming({kind:'bridge-stream-commit',requestId,action:'commitSave',saveRevision,bridgeDispatchMs:row.bridgeDispatchMs,streamChunks:stats.chunks});}
      committed=true;
      const result=await ack;return {...result,stream:true,stats,mirrorJSON};
    }catch(error){
      if(!committed){abort();const row=pending.get(requestId);if(row){clearTimeout(row.timer);pending.delete(requestId);}}
      throw error;
    }finally{ordinarySnapshotting=false;}
  }
  function requestNative(action,json,options={}){
    const bridge=bridgeFor(action);if(!bridge)return Promise.resolve({ok:true,native:false});
    if(pending.size>=PERSISTENCE_LIMITS.pending)return Promise.reject(new Error('native-save-backpressure'));
    let saveRevision=Number(options.saveRevision),resetEpoch=Number(options.resetEpoch);
    if(!Number.isSafeInteger(saveRevision)||saveRevision<0||!Number.isSafeInteger(resetEpoch)||resetEpoch<0){const state=JSON.parse(json);assertState(state);saveRevision=Number(state.saveRevision)||0;resetEpoch=Number(state.resetEpoch)||0;}
    const post=saveHashValue=>{
      const envelope={action,requestId:`${action}-${Date.now()}-${++sequence}`,saveJSON:json,saveHash:saveHashValue,saveRevision,resetEpoch,saveSchemaVersion:'2.0.0',appVersion:options.appVersion||VERSION};
      if(options.transactionId)envelope.transactionId=String(options.transactionId).slice(0,120);
      if(options.idempotencyKey)envelope.idempotencyKey=String(options.idempotencyKey).slice(0,160);
      if(options.expectedPreviousRevision!=null)envelope.expectedPreviousRevision=Number(options.expectedPreviousRevision);
      if(options.clearManualSlots===true)envelope.clearManualSlots=true;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(envelope.requestId);const e=new Error('native-save-ack-timeout');e.code='ACK_TIMEOUT';reject(e);},options.timeoutMs||PERSISTENCE_LIMITS.ackTimeoutMs);
        const row={resolve,reject,timer,envelope,dispatchedAt:clock(),bridgeDispatchMs:null};pending.set(envelope.requestId,row);
        const dispatchStart=row.dispatchedAt;
        try{bridge.postMessage(envelope);row.bridgeDispatchMs=Math.max(0,clock()-dispatchStart);rememberTiming({kind:'bridge-dispatch',requestId:envelope.requestId,action,saveRevision,bridgeDispatchMs:row.bridgeDispatchMs});}
        catch(e){row.bridgeDispatchMs=Math.max(0,clock()-dispatchStart);clearTimeout(timer);pending.delete(envelope.requestId);reject(e);}
      });
    };
    try{const hashed=saveHash(json);return hashed&&typeof hashed.then==='function'?hashed.then(post):post(hashed);}catch(error){return Promise.reject(error);}
  }
  globalThis.addEventListener?.('gh-native-save-ack',e=>receiveAck(e.detail));
  globalThis.addEventListener?.('gh-native-reset-ack',e=>receiveAck(e.detail));
  function receiveSlotAck(detail={}){
    const row=slotPending.get(detail.requestId);if(!row)return false;
    if(detail.action!==row.action||Number(detail.index)!==row.index||typeof detail.success!=='boolean')return false;
    if(detail.success&&row.action==='loadManualSlot'&&(!Number.isSafeInteger(detail.generation)||detail.generation<=generation))return false;
    clearTimeout(row.timer);slotPending.delete(detail.requestId);
    if(detail.success){
      if(detail.metadata&&typeof detail.metadata==='object')nativeSlotMeta.set(row.index,clone(detail.metadata));
      if(row.action==='clearManualSlot')nativeSlotMeta.delete(row.index);
      if(row.action==='loadManualSlot'&&Number.isSafeInteger(detail.generation)&&detail.generation>generation)generation=detail.generation;
      row.resolve({ok:true,native:true,index:row.index,action:row.action,generation:detail.generation,meta:detail.metadata?clone(detail.metadata):(nativeSlotMeta.get(row.index)||null)});
    }else{const error=new Error(detail.message||'native-slot-nack');error.code='NATIVE_SLOT_NACK';row.reject(error);}
    return true;
  }
  function receiveArchiveAck(detail={}){
    const row=archivePending.get(detail.requestId);if(!row)return false;
    if(detail.action!==row.action||detail.key!==row.key||typeof detail.success!=='boolean')return false;
    clearTimeout(row.timer);archivePending.delete(detail.requestId);
    if(!detail.success){const error=new Error(detail.message||'native-cold-archive-failed');error.code='NATIVE_ARCHIVE_NACK';row.reject(error);return true;}
    row.resolve(detail.value??null);return true;
  }
  globalThis.addEventListener?.('gh-native-slot-ack',e=>receiveSlotAck(e.detail));
  globalThis.addEventListener?.('gh-native-archive-ack',e=>receiveArchiveAck(e.detail));
  function createColdArchiveAdapter(){
    const prefix='gh-cold-archive-local:',bridge=globalThis.webkit?.messageHandlers?.saveBridge;
    function native(action,key,value){
      const requestId=`cold-archive-${Date.now()}-${++sequence}`,cleanKey=String(key||'');
      if(!bridge)return Promise.reject(new Error('native-cold-archive-bridge-unavailable'));
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{archivePending.delete(requestId);const error=new Error('native-cold-archive-ack-timeout');error.code='ACK_TIMEOUT';reject(error);},PERSISTENCE_LIMITS.ackTimeoutMs);
        archivePending.set(requestId,{action,key:cleanKey,timer,resolve,reject});
        try{bridge.postMessage({action,requestId,key:cleanKey,...(value!==undefined?{value}: {})});}
        catch(error){clearTimeout(timer);archivePending.delete(requestId);reject(error);}
      });
    }
    function localKey(key){const value=String(key||'');if(!/^gh-cold-[A-Za-z0-9._-]{1,80}-(?:[AB]\.json|item-[a-f0-9]{64}\.json)$/.test(value))throw new Error('cold-archive-key-invalid');return `${prefix}${value}`;}
    return Object.freeze({
      read(key){if(bridge)return native('coldArchiveRead',key);try{return Promise.resolve(localStorage.getItem(localKey(key)));}catch(error){return Promise.reject(error);}},
      writeAtomic(key,value){if(typeof value!=='string')return Promise.reject(new TypeError('cold-archive-value-string-required'));if(bridge)return native('coldArchiveWrite',key,value);try{const target=localKey(key),prior=localStorage.getItem(target);localStorage.setItem(target,value);if(localStorage.getItem(target)!==value){if(prior===null)localStorage.removeItem(target);else localStorage.setItem(target,prior);throw new Error('cold-archive-local-write-verification-failed');}return Promise.resolve();}catch(error){return Promise.reject(error);}},
      remove(key){if(bridge)return native('coldArchiveRemove',key);try{localStorage.removeItem(localKey(key));return Promise.resolve();}catch(error){return Promise.reject(error);}},
      keys(){if(bridge)return native('coldArchiveKeys','').then(value=>Array.isArray(value)?value:[]);try{const keys=[];for(let index=0;index<(localStorage.length||0);index++){const key=localStorage.key(index);if(String(key||'').startsWith(prefix))keys.push(String(key).slice(prefix.length));}return Promise.resolve(keys);}catch(error){return Promise.reject(error);}},
      native:!!bridge
    });
  }
  function requestManualSlot(action,index,state=null,meta={}){
    index=Number(index);if(!Number.isInteger(index)||index<0||index>2)return Promise.reject(new Error('invalid-save-slot'));
    const bridge=bridgeFor('commitSave');if(!bridge)return Promise.reject(new Error('native-slot-bridge-unavailable'));
    if(slotPending.size>=PERSISTENCE_LIMITS.pending)return Promise.reject(new Error('native-slot-backpressure'));
    const requestId=`${action}-${Date.now()}-${++slotSequence}`,envelope={action,requestId,index};
    if(action==='saveManualSlot'){
      assertState(state);const json=JSON.stringify(state),measurement=inspectNativeJSON(json),hash=globalThis.GH_CONTROL_PLANE?.sha256;if(!hash)return Promise.reject(new Error('save-hash-owner-unavailable'));
      Object.assign(envelope,{saveJSON:json,saveHash:hash(json),saveRevision:Number(state.saveRevision)||0,resetEpoch:Number(state.resetEpoch)||0,saveSchemaVersion:'2.0.0',appVersion:meta.appVersion||VERSION,label:String(meta.label||'').slice(0,120)});
      envelope.measurement=measurement;
    }
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{slotPending.delete(requestId);const error=new Error('native-slot-ack-timeout');error.code='ACK_TIMEOUT';reject(error);},meta.timeoutMs||PERSISTENCE_LIMITS.ackTimeoutMs);
      slotPending.set(requestId,{resolve,reject,timer,action,index});
      try{bridge.postMessage(envelope);}catch(error){clearTimeout(timer);slotPending.delete(requestId);reject(error);}
    });
  }
  function ordinarySnapshotOptions(storageKey,appVersion,options){return {storageKey,appVersion,...options};}
  function clearOrdinaryDirty(){ordinaryDirty=false;ordinaryDirtyState=null;ordinaryDirtyOptions=null;}
  function deferOrdinary(state,options){ordinaryDirty=true;ordinaryDirtyState=state;ordinaryDirtyOptions=options;status({ok:true,deferred:true,reason:'native-save-coalesced',saveRevision:Number(state?.saveRevision)||0});}
  function beginOrdinary(state,{storageKey='global-holdings-world-v2.0.0',appVersion=VERSION,...options}={},control={}){
    if((locked&&!control.allowLocked)||durableLocked)return {ok:false,reason:'lifecycle-locked'};
    if(recoveryRequired)return {ok:false,reason:'memory-recovery-required'};
    const nativeBridge=!!bridgeFor('commitSave'),previousRevision=Math.max(0,Math.floor(Number(state?.saveRevision)||0)),nextRevision=previousRevision+1,syncStart=clock();
    const timing={kind:'ordinary-save',saveRevision:nextRevision,nativeBridge,schemaMs:0,stringifyMs:0,measurementMs:0,browserCacheMs:0,totalSyncMs:0,utf8Bytes:null,cacheReason:null,ok:false,streamed:nativeBridge};
    let json=null,measurement=null,resetEpoch=0,cache=null;
    try{
      if(!state||typeof state!=='object')throw new Error('state-required');
      state.saveRevision=nextRevision;
      let stageStart=clock();assertState(state,globalThis.GH_TRANSACTION_CORE?.isKernelOwner?.(state)===true?{lockVerifiedProofs:true}:undefined);timing.schemaMs=Math.max(0,clock()-stageStart);
      resetEpoch=Number(state.resetEpoch)||0;
      if(!nativeBridge){
        stageStart=clock();json=JSON.stringify(state);timing.stringifyMs=Math.max(0,clock()-stageStart);
        stageStart=clock();measurement=inspectJSON(json,storageKey,options);timing.measurementMs=Math.max(0,clock()-stageStart);timing.utf8Bytes=measurement.utf8Bytes;
        stageStart=clock();cache=writeJSON(storageKey,json,options);if(!cache.ok)throw Object.assign(new Error(cache.reason),{measurement:cache});timing.browserCacheMs=Math.max(0,clock()-stageStart);
      }
      timing.cacheReason=cache?.ok===false?cache.reason:null;timing.ok=true;timing.totalSyncMs=Math.max(0,clock()-syncStart);lastSaveBreakdown=rememberTiming(timing);
    }catch(error){if(Number(state?.saveRevision)===nextRevision)state.saveRevision=previousRevision;timing.totalSyncMs=Math.max(0,clock()-syncStart);timing.error=String(error.message||error);lastSaveBreakdown=rememberTiming(timing);return {ok:false,reason:'serialization-or-schema:'+String(error.message||error),...error.measurement};}
    const out={ok:true,...(json!==null?{json}:{}),...(measurement||{}),browserCache:nativeBridge?null:cache.ok,cacheReason:null,previous:cache?.previous??null,saveRevision:nextRevision};
    if(!nativeBridge){ordinaryError=null;return out;}
    const nativeMetadata={appVersion,...options,saveRevision:nextRevision,resetEpoch};
    const work=Promise.resolve().then(()=>{if(recoveryRequired)throw new Error('native-recovery-required');return requestNativeStream(state,nativeMetadata);});
    ordinaryInFlight=work.then(result=>{
      ordinaryError=null;const stats=result.stats||{};timing.stringifyMs=Number(stats.cpuMs)||0;timing.maxSerializationSliceMs=Number(stats.maxSliceMs)||0;timing.serializationYields=Number(stats.yields)||0;timing.streamChunks=Number(stats.chunks)||0;timing.utf8Bytes=Number(stats.utf8Bytes)||0;lastSaveBreakdown=rememberTiming({...timing,kind:'ordinary-save-stream-complete'});
      const mirror=result.mirrorJSON;
      if(typeof mirror==='string'){const cacheStart=clock(),mirrorCache=writeJSON(storageKey,mirror,options);rememberTiming({kind:'ordinary-cache-after-ack',saveRevision:nextRevision,browserCacheMs:Math.max(0,clock()-cacheStart),ok:mirrorCache.ok,cacheReason:mirrorCache.ok?null:mirrorCache.reason});if(!mirrorCache.ok)status({ok:true,warning:true,reason:'browser-cache-skipped',cacheReason:mirrorCache.reason,utf8Bytes:stats.utf8Bytes});}
      else status({ok:true,warning:true,reason:'browser-cache-skipped',cacheReason:'browser-cache-size-bypass',utf8Bytes:stats.utf8Bytes});
      return result;
    },error=>{
      if(error.code==='SAVE_SNAPSHOT_RETRY'){ordinaryError=null;if(Number(state?.saveRevision)===nextRevision)state.saveRevision=previousRevision;deferOrdinary(state,ordinarySnapshotOptions(storageKey,appVersion,options));status({ok:true,deferred:true,reason:'save-snapshot-retry',saveRevision:previousRevision});return {ok:false,retry:true,reason:error.message};}
      ordinaryError=error;const uncertainNative=error.code==='ACK_TIMEOUT';recoveryRequired=true;clearOrdinaryDirty();status({ok:false,reason:error.message,critical:!!error.rollbackError,nativeNack:error.code==='NATIVE_NACK',requiresMemoryRollback:false,requiresNativeReconciliation:true,storageKey});return {ok:false,reason:error.message,uncertainNative};
    }).finally(()=>{
      ordinaryInFlight=null;
      if(!recoveryRequired&&!locked&&!durableLocked&&ordinaryDirty){const dirtyState=ordinaryDirtyState,dirtyOptions=ordinaryDirtyOptions;clearOrdinaryDirty();beginOrdinary(dirtyState,dirtyOptions);}
    });
    out.native=ordinaryInFlight;return out;
  }
  async function waitOrdinaryIdle({supersedeDirty=false,allowLockedFlush=false}={}){
    while(true){
      if(ordinaryInFlight){const result=await ordinaryInFlight;if(result?.ok===false&&ordinaryError)throw ordinaryError;continue;}
      if(ordinaryError)throw ordinaryError;
      if(supersedeDirty){clearOrdinaryDirty();return {ok:true,generation,superseded:true};}
      if(ordinaryDirty){if((locked&&!allowLockedFlush)||durableLocked||recoveryRequired)break;const dirtyState=ordinaryDirtyState,dirtyOptions=ordinaryDirtyOptions;clearOrdinaryDirty();const out=beginOrdinary(dirtyState,dirtyOptions,{allowLocked:allowLockedFlush});if(!out.ok)throw new Error(out.reason);continue;}
      break;
    }
    return {ok:true,generation};
  }
  function commitState(state,{storageKey='global-holdings-world-v2.0.0',appVersion=VERSION,...options}={}){
    if(locked||durableLocked)return {ok:false,reason:'lifecycle-locked'};
    if(recoveryRequired)return {ok:false,reason:'memory-recovery-required'};
    const snapshotOptions=ordinarySnapshotOptions(storageKey,appVersion,options),nativeBridge=!!bridgeFor('commitSave');
    if(nativeBridge&&ordinaryInFlight){deferOrdinary(state,snapshotOptions);return {ok:true,deferred:true,coalesced:true,saveRevision:Number(state.saveRevision)||0,native:waitOrdinaryIdle().then(()=>({ok:true,deferred:true,coalesced:true}),error=>({ok:false,reason:String(error.message||error)}))};}
    return beginOrdinary(state,snapshotOptions);
  }
  async function drain(options={}){return waitOrdinaryIdle(options);}
  async function commitDurableState(state,{storageKey='global-holdings-world-v2.0.0',appVersion=VERSION,...options}={}){
    if(locked||durableLocked)throw new Error('lifecycle-locked');if(recoveryRequired)throw new Error('memory-recovery-required');
    if(options.expectedPreviousRevision!=null){const previous=Number(options.expectedPreviousRevision),next=Number(state?.saveRevision);if(!Number.isSafeInteger(previous)||previous<0||!Number.isSafeInteger(next)||next!==previous+1)throw new Error(`save-revision-conflict:${previous}:${next}`);}
    durableLocked=true;
    let written=null;
    try{
      await waitOrdinaryIdle({supersedeDirty:true});assertState(state);const json=JSON.stringify(state),nativeBridge=!!bridgeFor('commitSave');
      if(nativeBridge){
        const measurement=inspectNativeJSON(json),ack=await requestNative('commitSave',json,{appVersion,...options,saveRevision:Number(state.saveRevision)||0,resetEpoch:Number(state.resetEpoch)||0});ordinaryError=null;
        const cache=(measurement.utf8Bytes>PERSISTENCE_LIMITS.hardBytes||measurement.storageBytes>PERSISTENCE_LIMITS.hardBytes)?{ok:false,reason:'browser-cache-size-bypass',previous:null,bypassed:true}:writeJSON(storageKey,json,options);
        if(!cache.ok)status({ok:true,warning:true,reason:'browser-cache-skipped',cacheReason:cache.reason,durable:true,utf8Bytes:measurement.utf8Bytes});
        telemetry({operation:'durable-commit',ok:true,utf8Bytes:measurement.utf8Bytes,native:true,browserCache:cache.ok,durationMs:0});status({ok:true,validated:true,durable:true,native:true,saveRevision:Number(state.saveRevision)||0});return {ok:true,json,...measurement,ack,durable:true,browserCache:cache.ok,cacheReason:cache.ok?null:cache.reason};
      }
      written=writeJSON(storageKey,json,options);if(!written.ok)throw new Error(written.reason);
      const ack=await requestNative('commitSave',json,{appVersion,...options,saveRevision:Number(state.saveRevision)||0,resetEpoch:Number(state.resetEpoch)||0});ordinaryError=null;
      telemetry({operation:'durable-commit',ok:true,utf8Bytes:written.utf8Bytes,native:false,durationMs:0});status({ok:true,validated:true,durable:true,native:false,saveRevision:Number(state.saveRevision)||0});return {...written,ack,durable:true};
    }catch(error){
      if(written?.ok)try{if(localStorage.getItem(storageKey)===written.json)restoreRaw(storageKey,written.previous);}catch(rollbackError){error.rollbackError=String(rollbackError.message||rollbackError);}
      const uncertainNative=error.code==='ACK_TIMEOUT';if(error.rollbackError||uncertainNative){recoveryRequired=true;error.critical=true;}status({ok:false,reason:String(error.message||error),critical:!!error.critical,durable:true,requiresNativeReconciliation:uncertainNative,storageKey});throw error;
    }finally{durableLocked=false;}
  }
  function recoverBrowserState(storageKey='global-holdings-world-v2.0.0'){
    if(bridgeFor('commitSave'))return {ok:false,reason:'native-vault-reconciliation-required'};
    try{const raw=localStorage.getItem(storageKey);if(!raw)return {ok:false,reason:'missing-durable-state'};const state=JSON.parse(raw);assertState(state);return {ok:true,state};}catch(error){return {ok:false,reason:String(error.message||error)};}
  }
  function confirmedNativeState(){
    if(!recoveryRequired||!bridgeFor('commitSave'))return {ok:false,reason:'native-recovery-not-required'};
    if(!nativeConfirmedJSON||nativeConfirmedGeneration!==generation)return {ok:false,reason:'verified-native-checkpoint-unavailable'};
    try{
      const state=JSON.parse(nativeConfirmedJSON);assertState(state);
      if(Number.isSafeInteger(nativeConfirmedRevision)&&Number(state.saveRevision)!==nativeConfirmedRevision)throw new Error('native-checkpoint-revision-mismatch');
      if(Number.isSafeInteger(nativeConfirmedEpoch)&&Number(state.resetEpoch)!==nativeConfirmedEpoch)throw new Error('native-checkpoint-epoch-mismatch');
      return {ok:true,state,generation:nativeConfirmedGeneration};
    }
    catch(error){return {ok:false,reason:`verified-native-checkpoint-invalid:${String(error.message||error)}`};}
  }
  function markRecoveryRequired(reason='manual-recovery-required'){recoveryRequired=true;ordinaryError=ordinaryError||new Error(String(reason));status({ok:false,critical:true,reason:String(reason),requiresNativeReconciliation:!!bridgeFor('commitSave')});return true;}
  function acknowledgeRecovery(){if(bridgeFor('commitSave')&&recoveryRequired)return false;recoveryRequired=false;ordinaryError=null;return true;}
  async function replaceState(next,previous,{storageKey='global-holdings-world-v2.0.0',resetMarkerKey,appVersion=VERSION,timeoutMs,apply,cleanupKeys=[],clearManualSlots=false}={}){
    if(locked)throw new Error('lifecycle-locked');locked=true;
    let nativeAttempted=false,nativeCommitted=false,oldRaw=null,oldMarker=null,browserTouched=false;
    let oldJSON;
    try{
      await drain({allowLockedFlush:true});assertState(next);assertState(previous);oldJSON=JSON.stringify(previous);
      const json=JSON.stringify(next),nativeBridge=!!bridgeFor('resetGameSave'),nativeMeasurement=nativeBridge?inspectNativeJSON(json):null;if(!nativeBridge)inspectJSON(json,storageKey);oldRaw=localStorage.getItem(storageKey);oldMarker=resetMarkerKey?localStorage.getItem(resetMarkerKey):null;
      // The current in-memory game is the compensating checkpoint. Native owns durability.
      nativeAttempted=nativeBridge;
      await requestNative('resetGameSave',json,{appVersion,timeoutMs,clearManualSlots,saveRevision:Number(next.saveRevision)||0,resetEpoch:Number(next.resetEpoch)||0});
      nativeCommitted=nativeBridge;
      const out=(nativeBridge&&(nativeMeasurement.utf8Bytes>PERSISTENCE_LIMITS.hardBytes||nativeMeasurement.storageBytes>PERSISTENCE_LIMITS.hardBytes))
        ? {ok:false,reason:'browser-cache-size-bypass',previous:null,bypassed:true}
        : writeJSON(storageKey,json);
      if(out.ok)browserTouched=true;
      else if(!nativeBridge){const writeError=new Error(out.reason);writeError.rollbackError=out.rollbackError;throw writeError;}
      else status({ok:true,warning:true,reason:'browser-cache-skipped',cacheReason:out.reason,reset:true});
      if(resetMarkerKey){
        try{localStorage.setItem(resetMarkerKey,String(next.resetEpoch||0));if(localStorage.getItem(resetMarkerKey)!==String(next.resetEpoch||0))throw new Error('reset-marker-verification');}
        catch(markerError){if(!nativeBridge)throw markerError;status({ok:true,warning:true,reason:'reset-marker-cache-skipped',message:String(markerError.message||markerError)});}
      }
      if(apply)apply(next);
      for(const key of cleanupKeys)if(key!==storageKey&&key!==resetMarkerKey)try{localStorage.removeItem(key);}catch{}
      ordinaryError=null;clearOrdinaryDirty();return {ok:true,native:nativeAttempted,generation};
    }catch(error){
      try{if(browserTouched)restoreRaw(storageKey,oldRaw);if(resetMarkerKey&&browserTouched)restoreRaw(resetMarkerKey,oldMarker);}catch(e){error.rollbackError=String(e.message||e);}
      // Once a New Game reset that clears manual slots has been ACKed by Native,
      // the durable transaction is committed. Rolling only the main save back here
      // would resurrect an old world without its manual slots. Reload from the
      // freshly refreshed Native bootstrap instead of attempting a partial rollback.
      if(nativeCommitted&&clearManualSlots){
        recoveryRequired=true;error.critical=true;error.requiresNativeReload=true;
        status({ok:false,critical:true,reason:'native-reset-committed-reload-required',requiresNativeReconciliation:true,storageKey});
        throw error;
      }
      if(nativeAttempted)try{await requestNative('resetGameSave',oldJSON,{appVersion,timeoutMs,clearManualSlots:false,saveRevision:Number(previous.saveRevision)||0,resetEpoch:Number(previous.resetEpoch)||0});}catch(e){error.compensationError=String(e.message||e);}
      if(error.rollbackError||error.compensationError){error.critical=true;globalThis.GH_CONTROL_PLANE?.incident?.(previous,{fingerprint:'RESET_COMPENSATION_FAILED',code:'RESET_COMPENSATION_FAILED',severity:'critical',domain:'save',title:'فشل استرداد الحفظ بعد عملية الاستبدال',detail:String(error.compensationError||error.rollbackError)});}
      throw error;
    }finally{locked=false;}
  }
  function parseSlot(raw){if(!raw)return {ok:false,reason:'empty'};try{const p=JSON.parse(raw),state=p?.format===SLOT_FORMAT?p.state:p;assertState(state);return {ok:true,state,meta:p?.format===SLOT_FORMAT?p.meta||{}:{legacy:true}};}catch(e){return {ok:false,reason:'invalid-save',error:String(e.message||e)};}}
  function slotStatus(index){
    try{
      index=Number(index);if(!Number.isInteger(index)||index<0||index>2)throw new Error('invalid-save-slot');
      if(bridgeFor('commitSave')){const meta=nativeSlotMeta.get(index);return meta?{exists:true,meta:clone(meta),native:true}:{exists:false,reason:'empty',native:true};}
      const p=parseSlot(localStorage.getItem(slotKey(index)));return p.ok?{exists:true,meta:p.meta}:{exists:false,reason:p.reason};
    }catch(e){return {exists:false,reason:'storage-error'};}
  }
  function saveSlot(index,state,meta={}){
    try{
      assertState(state);const day=Math.floor((Number(state.simSeconds)||0)/86400)+1,label=meta.label||`اليوم ${day}`;
      if(bridgeFor('commitSave'))return requestManualSlot('saveManualSlot',index,state,{...meta,label}).catch(error=>({ok:false,reason:String(error.message||error)}));
      const envelope={format:SLOT_FORMAT,version:VERSION,saveSchemaVersion:'2.0.0',meta:{appVersion:meta.appVersion||VERSION,saveRevision:Number(state.saveRevision)||0,simSeconds:Number(state.simSeconds)||0,day,label},state};const out=writeJSON(slotKey(index),JSON.stringify(envelope));return {...out,meta:envelope.meta};
    }catch(e){return {ok:false,reason:String(e.message||e)};}
  }
  function statusEventForSlot(error,storageKey){status({ok:false,reason:error.message,requiresNativeReconciliation:true,storageKey});}
  function loadSlot(index,{storageKey='global-holdings-world-v2.0.0',appVersion=VERSION,previousState}={}){
    try{
      if(bridgeFor('commitSave')){
        const status=slotStatus(index);if(!status.exists)return status;
        if(locked||durableLocked||recoveryRequired)return {ok:false,reason:'lifecycle-locked'};
        locked=true;
        return drain({allowLockedFlush:true}).then(()=>requestManualSlot('loadManualSlot',index,null,{appVersion})).then(out=>({...out,meta:status.meta,reloadRequired:true}),error=>{
          if(error.code==='ACK_TIMEOUT'){recoveryRequired=true;statusEventForSlot(error,storageKey);}else if(!recoveryRequired)locked=false;
          return {ok:false,reason:String(error.message||error),reloadRequired:recoveryRequired};
        });
      }
      const p=parseSlot(localStorage.getItem(slotKey(index)));if(!p.ok)return p;
      const out=writeState(storageKey,p.state);return out.ok?p:out;
    }catch(e){return {ok:false,reason:String(e.message||e)};}
  }
  function clearSlot(index){
    try{
      if(bridgeFor('commitSave'))return requestManualSlot('clearManualSlot',index).catch(error=>({ok:false,reason:String(error.message||error)}));
      localStorage.removeItem(slotKey(index));return {ok:true};
    }catch(e){return {ok:false,error:String(e.message||e)};}
  }
  function exportSave(state,{appVersion=VERSION}={}){
    try{assertState(state);const day=Math.floor((Number(state.simSeconds)||0)/86400)+1,pack={format:EXPORT_FORMAT,version:appVersion,saveSchemaVersion:'2.0.0',saveRevision:Number(state.saveRevision)||0,simSeconds:Number(state.simSeconds)||0,day,state:clone(state)};const blob=new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}),a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`GlobalHoldings_Save_v${appVersion}_D${day}.ghsave`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return {ok:true,filename:a.download};}catch(e){return {ok:false,reason:'export-failed',error:String(e.message||e)};}
  }
  function migrateMetadata(state){state.advanced=state.advanced||{};state.advanced.saveSlots=Array.isArray(state.advanced.saveSlots)?state.advanced.saveSlots:[null,null,null];for(let i=0;i<3;i++){const s=slotStatus(i);state.advanced.saveSlots[i]=s.exists?{date:s.meta?.label||`اليوم ${s.meta?.day||'—'}`,version:s.meta?.appVersion||'legacy',simSeconds:Number(s.meta?.simSeconds)||0}:null;}return state.advanced.saveSlots;}
  const API=Object.freeze({VERSION,SLOT_FORMAT,LIMITS:PERSISTENCE_LIMITS,slotStatus,saveSlot,loadSlot,clearSlot,exportSave,migrateMetadata,parseSlot,inspectJSON,inspectNativeJSON,writeJSON,writeState,commitState,commitDurableState,recoverBrowserState,confirmedNativeState,acknowledgeRecovery,markRecoveryRequired,requestNative,receiveAck,receiveSlotAck,receiveArchiveAck,createColdArchiveAdapter,drain,replaceState,isLocked:()=>locked||durableLocked||recoveryRequired,isSnapshotting:()=>ordinarySnapshotting,__testCooperativeJSONStream:cooperativeJSONStream,telemetry:()=>({generation,pending:pending.size,slotPending:slotPending.size,archivePending:archivePending.size,ordinaryInFlight:!!ordinaryInFlight,ordinaryDirty,ordinarySnapshotting,recoveryRequired,samples:clone(samples),timings:{lastSaveBreakdown:clone(lastSaveBreakdown),lastNativeAck:clone(lastNativeAck),samples:clone(timingSamples)}})});
  globalThis.GH_PERSISTENCE=API;if(globalThis.window&&window!==globalThis)window.GH_PERSISTENCE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
