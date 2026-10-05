(()=>{
  'use strict';
  const VERSION='3.0.0', SAVE_SCHEMA_VERSION='3.0.0', SLOT_FORMAT='global-holdings-save-slot-v2', EXPORT_FORMAT='global-holdings-save';
  // A purchase may not take the fleet past the record ceiling (live assets plus pending delivery snapshots; delivered
  // receipts are stored compactly since Build 358 and do not count). It is an admission rule only: a save above it
  // still loads. The browser save is one localStorage string (4.5 MB), so it keeps 6,000 records. Build 358
  // (million-asset game): the native save keeps the fleet records in 4 MiB vault chunks outside the JSON, validation
  // and the daily close work per class of rows, so the native ceiling is 1,000,000 records. Measured in desktop
  // Chromium with the full app at 1,000,000 assets: 0.5 MB save JSON plus 168 MB of record chunks, warm save ~130 ms,
  // purchase ~0.3 s, daily close ~3.6 s spread over frames (longest task ~0.2 s), boot ~3 s.
  const PERSISTENCE_LIMITS=Object.freeze({softBytes:2*1024*1024,hardBytes:4*1024*1024,storageBytes:4.5*1024*1024,nativeSoftBytes:22.5*1024*1024,nativeHardBytes:30*1024*1024,browserFleetRecordLimit:6000,nativeFleetRecordLimit:1000000,ackTimeoutMs:10000,pending:16});
  const saveSchemaVersion=state=>['2.0.0','3.0.0'].includes(String(state?.saveVersion||''))?String(state.saveVersion):SAVE_SCHEMA_VERSION;
  const slotKey=index=>{if(!Number.isInteger(Number(index))||index<0||index>2)throw new Error('invalid-save-slot');return `global-holdings-save-slot-${Number(index)+1}`;};
  const clone=v=>globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));
  // Storage encoding (Build 350). Large homogeneous collections are persisted as shape + positional-cell rows with an
  // interned pool, so a 20,000-asset fleet no longer repeats every property name and crew table 20,000 times. This is a
  // TRANSPORT encoding only: the live state and Save Schema are unchanged, parseState(serializeState(x)) is exactly
  // JSON.parse(JSON.stringify(x)), and plain (pre-350) saves still load because decodeState passes them through.
  const stateCodec=()=>globalThis.GH_STATE_CODEC||null;
  function serializeState(state){const codec=stateCodec();return codec?codec.serialize(state):JSON.stringify(state);}
  function decodeTree(tree){const codec=stateCodec();return codec?codec.decodeState(tree):tree;}
  function parseState(json){return decodeTree(JSON.parse(json));}
  const clock=()=>globalThis.performance?.now?.()??Date.now();
  const pending=new Map(), slotPending=new Map(), samples=[],timingSamples=[];
  let lastSaveBreakdown=null,lastNativeAck=null,lastSaveAtMs=null;
  function rememberTiming(row){const value={...row,recordedAtMs:Date.now()};timingSamples.push(value);if(timingSamples.length>24)timingSamples.shift();return value;}
  let sequence=0,slotSequence=0,generation=0,locked=false,durableLocked=false,recoveryRequired=false,ordinaryInFlight=null,ordinaryDirty=false,ordinaryDirtyState=null,ordinaryDirtyOptions=null,ordinaryError=null;
  const nativeSlotMeta=new Map((Array.isArray(globalThis.__GH_NATIVE_SLOT_META__)?globalThis.__GH_NATIVE_SLOT_META__:[]).filter(row=>Number.isInteger(Number(row?.index))&&Number(row.index)>=0&&Number(row.index)<=2).map(row=>[Number(row.index),clone(row)]));
  function telemetry(row){samples.push(row);if(samples.length>32)samples.shift();return row;}
  function status(detail){if(globalThis.dispatchEvent&&globalThis.CustomEvent)globalThis.dispatchEvent(new CustomEvent('gh-persistence-status',{detail}));}
  function validateState(state){return globalThis.GH_SAVE_SCHEMA?.validate?.(state)||{ok:false,errors:['save-schema-unavailable']};}
  function assertState(state){const v=validateState(state);if(!v.ok)throw new Error(`invalid-save:${(v.errors||[]).join(',')}`);}
  // Build 350: recurring saves of the live game use the verified-once ledger (see save-schema.js) and run a FULL validation
  // every FULL_VALIDATION_EVERY-th save, so an in-place edit of an already verified proof is still found within minutes.
  // Loads, imports, manual slots, exports and recovery keep using assertState() (always full).
  const FULL_VALIDATION_EVERY=10;let recurringValidations=0;
  // prevalidated: the caller validated this exact state (trusted) just before; only the scheduled full pass remains.
  function assertRecurringState(state,{prevalidated=false}={}){
    // Build 358: the rows a save writes are sealed first (immutable by contract), so later full passes and durable drafts
    // can rely on them not changing (see GH_TRANSACTION_CORE.registerSealedCollections).
    try{globalThis.GH_TRANSACTION_CORE?.sealCollections?.(state);}catch(_error){/* sealing is an optimisation */}
    const full=(++recurringValidations%FULL_VALIDATION_EVERY)===0,schema=globalThis.GH_SAVE_SCHEMA;if(prevalidated&&!full)return;
    const v=(full?schema?.validate?.(state):schema?.validate?.(state,{trustVerified:true}))||{ok:false,errors:['save-schema-unavailable']};
    if(!v.ok)throw new Error(`invalid-save:${(v.errors||[]).join(',')}`);
  }
  // Build 353: one save used to UTF-8 encode the same multi-megabyte JSON up to three times (native size check,
  // browser cache size check, SHA-256). The encoded bytes are now produced once per save and shared; values are
  // identical because the same TextEncoder output is measured and hashed.
  function utf8(text){return globalThis.TextEncoder?new TextEncoder().encode(text):null;}
  function bytes(text,encoded=null){if(encoded)return encoded.byteLength;if(globalThis.TextEncoder)return new TextEncoder().encode(text).byteLength;let n=0;for(const c of text){const p=c.codePointAt(0);n+=p<128?1:p<2048?2:p<65536?3:4;}return n;}
  function inspectJSON(json,key='',options={},encoded=null){
    if(typeof json!=='string')throw new Error('serialization-failed');
    const utf8Bytes=bytes(json,encoded),storageBytes=json.length*2,hard=Math.min(PERSISTENCE_LIMITS.hardBytes,options.hardBytes||PERSISTENCE_LIMITS.hardBytes);
    let totalStorageBytes=storageBytes+String(key).length*2;
    for(let i=0;i<(localStorage.length||0);i++){const k=localStorage.key(i);if(k!==key)totalStorageBytes+=(String(k).length+(localStorage.getItem(k)||'').length)*2;}
    const warning=utf8Bytes>=Math.min(PERSISTENCE_LIMITS.softBytes,options.softBytes||PERSISTENCE_LIMITS.softBytes)||storageBytes>=PERSISTENCE_LIMITS.softBytes;
    if(utf8Bytes>hard||storageBytes>hard||totalStorageBytes>PERSISTENCE_LIMITS.storageBytes){const e=new Error('save-size-hard-limit');e.measurement={utf8Bytes,storageBytes,totalStorageBytes};throw e;}
    return {utf8Bytes,storageBytes,totalStorageBytes,warning};
  }
  function inspectNativeJSON(json,encoded=null){
    if(typeof json!=='string')throw new Error('serialization-failed');
    const utf8Bytes=bytes(json,encoded),storageBytes=json.length*2,warning=utf8Bytes>=PERSISTENCE_LIMITS.softBytes;
    if(utf8Bytes>PERSISTENCE_LIMITS.nativeHardBytes){const e=new Error('native-save-size-hard-limit');e.measurement={utf8Bytes,storageBytes};throw e;}
    return {utf8Bytes,storageBytes,totalStorageBytes:null,warning};
  }
  function restoreRaw(key,raw){if(raw===null)localStorage.removeItem(key);else localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw new Error('save-rollback-verification');}
  function writeJSON(key,json,options={},encoded=null){
    const start=clock();let previous=null,attempted=false;
    try{
      const measurement=inspectJSON(json,key,options,encoded);previous=localStorage.getItem(key);attempted=true;
      localStorage.setItem(key,json);
      if(localStorage.getItem(key)!==json)throw new Error('save-readback-mismatch');
      telemetry({operation:'write',ok:true,...measurement,durationMs:clock()-start});
      // A native-mode browser mirror is redundancy only; its 2 MB WebStorage limit is not the player's save limit.
      if(measurement.warning)status({ok:true,warning:true,reason:'save-size-soft-warning',...measurement,mirror:options.mirror===true});
      return {ok:true,json,previous,...measurement};
    }catch(error){
      let rollbackError=null;
      if(attempted)try{if(localStorage.getItem(key)!==previous)restoreRaw(key,previous);}catch(e){rollbackError=String(e.message||e);}
      const out={ok:false,reason:String(error.message||error),rollbackError,...error.measurement};telemetry({operation:'write',...out,durationMs:clock()-start});return out;
    }
  }
  function writeState(key,state,options={}){const start=clock();try{assertState(state);const json=serializeState(state);const out=writeJSON(key,json,options);telemetry({operation:'serialize',ok:out.ok,utf8Bytes:out.utf8Bytes,durationMs:clock()-start});return out;}catch(e){const out={ok:false,reason:`serialization-or-schema:${e.message||e}`};telemetry({operation:'serialize',...out,durationMs:clock()-start});return out;}}
  function bridgeFor(action){return globalThis.webkit?.messageHandlers?.[action==='resetGameSave'?'updateBridge':'saveBridge'];}
  function fleetRecordLimit(){return bridgeFor('commitSave')?PERSISTENCE_LIMITS.nativeFleetRecordLimit:PERSISTENCE_LIMITS.browserFleetRecordLimit;}
  function receiveAck(detail={}){
    const row=pending.get(detail.requestId);if(!row)return false;
    if(detail.action!==row.envelope.action||detail.saveRevision!==row.envelope.saveRevision||detail.resetEpoch!==row.envelope.resetEpoch||detail.saveHash!==row.envelope.saveHash||detail.saveSchemaVersion!==row.envelope.saveSchemaVersion||typeof detail.success!=='boolean')return false;
    if(detail.success&&(!Number.isSafeInteger(detail.generation)||detail.generation<=generation))return false;
    const ackAt=clock(),nativeVaultCommitMs=Number(detail.nativeVaultCommitMs);
    // Build 358: the native commit's stage timings (GlobalSaveVault: parse, current slot, encode, write, verify, chunk collection).
    const nativeVaultStages=detail.nativeVaultStages&&typeof detail.nativeVaultStages==='object'?Object.fromEntries(Object.entries(detail.nativeVaultStages).filter(([key,value])=>/^[A-Za-z]{1,32}$/.test(key)&&Number.isFinite(Number(value))).slice(0,16).map(([key,value])=>[key,Math.round(Number(value)*10)/10])):null;
    lastNativeAck=rememberTiming({kind:'native-ack',requestId:detail.requestId,action:detail.action,saveRevision:Number(detail.saveRevision)||0,generation:Number(detail.generation)||0,success:detail.success===true,bridgeDispatchMs:Number.isFinite(row.bridgeDispatchMs)?row.bridgeDispatchMs:null,nativeAckLatencyMs:Number.isFinite(row.dispatchedAt)?Math.max(0,ackAt-row.dispatchedAt):null,nativeVaultCommitMs:Number.isFinite(nativeVaultCommitMs)?Math.max(0,nativeVaultCommitMs):null,nativeVaultStages});
    clearTimeout(row.timer);pending.delete(detail.requestId);
    if(detail.success){generation=detail.generation;row.resolve({ok:true,native:true,...detail});}
    else{const e=new Error(detail.message||'native-save-nack');e.code='NATIVE_NACK';row.reject(e);}
    const statusDetail={...detail};delete statusDetail.nativeVaultCommitMs;delete statusDetail.nativeVaultStages;status({ok:detail.success,validated:true,...statusDetail});return true;
  }
  function saveHash(json,encoded=null){
    const text=String(json),owner=globalThis.GH_CONTROL_PLANE?.sha256;if(!owner)throw new Error('save-hash-owner-unavailable');
    const subtle=globalThis.crypto?.subtle;
    if(text.length>=262144&&subtle&&typeof TextEncoder!=='undefined'){
      try{return subtle.digest('SHA-256',encoded||new TextEncoder().encode(text)).then(digest=>[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join(''),()=>owner(text));}catch(_error){}
    }
    return owner(text);
  }
  function requestNative(action,json,options={}){
    const bridge=bridgeFor(action);if(!bridge)return Promise.resolve({ok:true,native:false});
    if(pending.size>=PERSISTENCE_LIMITS.pending)return Promise.reject(new Error('native-save-backpressure'));
    let saveRevision=Number(options.saveRevision),resetEpoch=Number(options.resetEpoch);
    if(!Number.isSafeInteger(saveRevision)||saveRevision<0||!Number.isSafeInteger(resetEpoch)||resetEpoch<0){const state=parseState(json);assertState(state);saveRevision=Number(state.saveRevision)||0;resetEpoch=Number(state.resetEpoch)||0;}
    const post=saveHashValue=>{
      const envelope={action,requestId:`${action}-${Date.now()}-${++sequence}`,saveJSON:json,saveHash:saveHashValue,saveRevision,resetEpoch,saveSchemaVersion:options.saveSchemaVersion||SAVE_SCHEMA_VERSION,appVersion:options.appVersion||VERSION};
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
    try{const hashed=saveHash(json,options.encoded||null);return hashed&&typeof hashed.then==='function'?hashed.then(post):post(hashed);}catch(error){return Promise.reject(error);}
  }
  // Build 358 (save size): the same path carries the text chunks of sealed collections (document and authorization
  // proofs, idempotency receipts; GH_STATE_CODEC 'chunk-v1' markers). A save then sends only what changed through the
  // bridge: the 21 MB iPhone save of the diagnostic was ~20 MB of proofs written again by every commit.
  // Build 358 (million-asset save): with the native vault, the fleet record buffer is saved as 'chunks-v1' (one id per
  // 4 MiB store chunk, GH_STATE_CODEC.serializeChunked) instead of base64 in the JSON. serializeNative copies the bytes
  // of every chunk the vault has not acknowledged at the moment the save is taken (the simulation may write rows while
  // the upload runs, and a save must be one consistent instant), and uploadChunks sends them before the commit that
  // lists them. The vault refuses a commit whose chunks are missing; vaultChunks is cleared after any reset and any
  // such refusal, so the next save uploads again (an upload of a chunk the vault holds is checked and accepted).
  const vaultChunks=new Set(),chunkPending=new Map();let chunkSequence=0;
  const CHUNK_ACK_TIMEOUT_MS=60000;
  function noteVaultChunks(ids){for(const id of Array.isArray(ids)?ids:[])if(typeof id==='string'&&id)vaultChunks.add(id);}
  function forgetVaultChunks(){vaultChunks.clear();}
  function chunkedNative(state){return !!bridgeFor('commitSave')&&typeof stateCodec()?.serializeChunked==='function'&&Object.prototype.toString.call(state?.fleet?.rows)==='[object ArrayBuffer]';}
  function serializeNative(state){
    if(!chunkedNative(state))return {json:serializeState(state),uploads:[],chunked:false};
    const out=stateCodec().serializeChunked(state),uploads=[];
    // Fleet chunks copy their bytes now (rows keep changing); a text chunk (a sealed collection's JSON) is immutable.
    for(const chunk of out.chunks)if(!vaultChunks.has(chunk.id))uploads.push({id:chunk.id,bytes:typeof chunk.text==='string'?utf8(chunk.text):new Uint8Array(state.fleet.rows,chunk.byteOffset,chunk.byteLength).slice()});
    return {json:out.text,uploads,chunked:true,chunkIds:out.chunks.map(chunk=>chunk.id)};
  }
  // Build 358 (lighter commands): a durable command's save spread over frames. Serialization runs as codec steps and the
  // UTF-8 encoding in pieces; whenever a slice has run SLICE_MS the caller's frame scheduler (yieldToFrame) is awaited.
  // The command holds the lifecycle lock, so nothing writes the state meanwhile; if the fleet records changed anyway
  // (their revision moved), the save is taken again in one go, so a save is always one consistent instant. The bytes
  // are exactly those of serializeNative + utf8.
  const SLICE_MS=10;
  async function runSliced(steps,yieldToFrame,timing){let slice=clock(),step;for(;;){step=steps.next();if(step.done){timing.busyMs+=clock()-slice;return step.value;}if(clock()-slice>=SLICE_MS){timing.busyMs+=clock()-slice;timing.slices++;await yieldToFrame();slice=clock();}}}
  async function serializeNativeSliced(state,yieldToFrame,timing){
    const codec=stateCodec();if(!chunkedNative(state))return typeof codec?.serializeSteps==='function'?{json:await runSliced(codec.serializeSteps(state),yieldToFrame,timing),uploads:[],chunked:false}:serializeNative(state);
    if(typeof codec.serializeChunkedSteps!=='function')return serializeNative(state);
    const revision=state.fleet?.revision,out=await runSliced(codec.serializeChunkedSteps(state),yieldToFrame,timing);
    if(state.fleet?.revision!==revision){timing.retakes++;return serializeNative(state);}
    const uploads=[];for(const chunk of out.chunks)if(!vaultChunks.has(chunk.id))uploads.push({id:chunk.id,bytes:typeof chunk.text==='string'?utf8(chunk.text):new Uint8Array(state.fleet.rows,chunk.byteOffset,chunk.byteLength).slice()});
    return {json:out.text,uploads,chunked:true,chunkIds:out.chunks.map(chunk=>chunk.id)};
  }
  // UTF-8 in pieces of up to 1M UTF-16 units, never splitting a surrogate pair: the bytes of TextEncoder.encode(text).
  function* utf8Steps(text){
    if(typeof TextEncoder==='undefined')return null;const encoder=new TextEncoder(),out=new Uint8Array(text.length*3),PIECE=1<<20;let read=0,written=0;
    while(read<text.length){let end=Math.min(text.length,read+PIECE);if(end<text.length){const code=text.charCodeAt(end-1);if(code>=0xD800&&code<=0xDBFF)end--;}const r=encoder.encodeInto(text.slice(read,end),out.subarray(written));if(r.read!==end-read)throw new Error('utf8-encode-incomplete');read=end;written+=r.written;yield;}
    return out.slice(0,written);
  }
  function receiveChunkAck(detail={}){
    const row=chunkPending.get(detail.requestId);if(!row)return false;
    clearTimeout(row.timer);chunkPending.delete(detail.requestId);
    if(detail.success===true&&detail.id===row.id)row.resolve();else{const error=new Error(detail.message||'native-chunk-nack');error.code='CHUNK_NACK';row.reject(error);}
    return true;
  }
  // Chunks travel as the raw bytes of a fetch POST to the game's own gh://app scheme (measured on CI WebKit: a 4 MiB
  // body arrives intact in ~34 ms, no base64 string). A runtime without that route answers 404 or rejects the request;
  // the chunk then goes as base64 over saveBridge ('storeSaveChunk'), which every native build understands.
  function uploadChunk(id,bytes){
    if(typeof globalThis.fetch!=='function'||globalThis.location?.protocol!=='gh:')return uploadChunkMessage(id,bytes);
    return globalThis.fetch(`gh://app/save-chunk/${encodeURIComponent(id)}`,{method:'POST',body:bytes,cache:'no-store'}).then(async response=>{
      if(response.status===404||response.status===405)return uploadChunkMessage(id,bytes);
      let detail={};try{detail=await response.json();}catch{}
      if(!response.ok||detail.ok!==true||detail.id!==id){const error=new Error(detail.message||`native-chunk-http-${response.status}`);error.code='CHUNK_NACK';throw error;}
    },error=>{if(error?.code==='CHUNK_NACK')throw error;return uploadChunkMessage(id,bytes);});
  }
  function uploadChunkMessage(id,bytes){
    const bridge=bridgeFor('commitSave');if(!bridge)return Promise.reject(new Error('native-chunk-bridge-unavailable'));
    return new Promise((resolve,reject)=>{
      const requestId=`storeSaveChunk-${Date.now()}-${++chunkSequence}`,timer=setTimeout(()=>{chunkPending.delete(requestId);const error=new Error('native-chunk-ack-timeout');error.code='ACK_TIMEOUT';reject(error);},CHUNK_ACK_TIMEOUT_MS);
      chunkPending.set(requestId,{id,resolve,reject,timer});
      try{bridge.postMessage({action:'storeSaveChunk',requestId,id,bytes:bytes.byteLength,base64:stateCodec().bytesToBase64(bytes)});}
      catch(error){clearTimeout(timer);chunkPending.delete(requestId);reject(error);}
    });
  }
  async function uploadChunks(uploads){
    const started=clock();let bytes=0;
    for(const upload of uploads||[]){if(vaultChunks.has(upload.id))continue;await uploadChunk(upload.id,upload.bytes);vaultChunks.add(upload.id);bytes+=upload.bytes.byteLength;}
    if(uploads?.length)rememberTiming({kind:'chunk-upload',chunks:uploads.length,bytes,ms:Math.max(0,clock()-started)});
  }
  // A commit refused for a missing chunk means vaultChunks was stale: forget it so the next save uploads its chunks.
  function noteNativeRefusal(error){if(/Missing save chunk/i.test(String(error?.message||'')))forgetVaultChunks();return error;}
  globalThis.addEventListener?.('gh-native-chunk-ack',e=>receiveChunkAck(e.detail));
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
  globalThis.addEventListener?.('gh-native-slot-ack',e=>receiveSlotAck(e.detail));
  function requestManualSlot(action,index,state=null,meta={}){
    index=Number(index);if(!Number.isInteger(index)||index<0||index>2)return Promise.reject(new Error('invalid-save-slot'));
    const bridge=bridgeFor('commitSave');if(!bridge)return Promise.reject(new Error('native-slot-bridge-unavailable'));
    if(slotPending.size>=PERSISTENCE_LIMITS.pending)return Promise.reject(new Error('native-slot-backpressure'));
    const requestId=`${action}-${Date.now()}-${++slotSequence}`,envelope={action,requestId,index};let nativeSave=null;
    if(action==='saveManualSlot'){
      assertRecurringState(state);nativeSave=serializeNative(state);const json=nativeSave.json,measurement=inspectNativeJSON(json),hash=globalThis.GH_CONTROL_PLANE?.sha256;if(!hash)return Promise.reject(new Error('save-hash-owner-unavailable'));
      Object.assign(envelope,{saveJSON:json,saveHash:hash(json),saveRevision:Number(state.saveRevision)||0,resetEpoch:Number(state.resetEpoch)||0,saveSchemaVersion:saveSchemaVersion(state),appVersion:meta.appVersion||VERSION,label:String(meta.label||'').slice(0,120)});
      envelope.measurement=measurement;
    }
    return uploadChunks(nativeSave?.uploads).then(()=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{slotPending.delete(requestId);const error=new Error('native-slot-ack-timeout');error.code='ACK_TIMEOUT';reject(error);},meta.timeoutMs||PERSISTENCE_LIMITS.ackTimeoutMs);
      slotPending.set(requestId,{resolve,reject,timer,action,index});
      try{bridge.postMessage(envelope);}catch(error){clearTimeout(timer);slotPending.delete(requestId);reject(error);}
    })).catch(error=>{throw noteNativeRefusal(error);});
  }
  function ordinarySnapshotOptions(storageKey,appVersion,options){return {storageKey,appVersion,...options};}
  function clearOrdinaryDirty(){ordinaryDirty=false;ordinaryDirtyState=null;ordinaryDirtyOptions=null;}
  function deferOrdinary(state,options){ordinaryDirty=true;ordinaryDirtyState=state;ordinaryDirtyOptions=options;status({ok:true,deferred:true,reason:'native-save-coalesced',saveRevision:Number(state?.saveRevision)||0});}
  function beginOrdinary(state,{storageKey='global-holdings-world-v3.0.0',appVersion=VERSION,...options}={},control={}){
    if((locked&&!control.allowLocked)||durableLocked)return {ok:false,reason:'lifecycle-locked'};
    if(recoveryRequired)return {ok:false,reason:'memory-recovery-required'};
    const nativeBridge=!!bridgeFor('commitSave'),previousRevision=Math.max(0,Math.floor(Number(state?.saveRevision)||0)),nextRevision=previousRevision+1,syncStart=clock();
    const timing={kind:'ordinary-save',saveRevision:nextRevision,nativeBridge,schemaMs:0,stringifyMs:0,measurementMs:0,browserCacheMs:0,totalSyncMs:0,utf8Bytes:null,cacheReason:null,ok:false};
    let json,measurement,resetEpoch,cache=null,encoded=null,nativeSave=null;
    try{
      if(!state||typeof state!=='object')throw new Error('state-required');
      state.saveRevision=nextRevision;
      let stageStart=clock();assertRecurringState(state);timing.schemaMs=Math.max(0,clock()-stageStart);
      stageStart=clock();nativeSave=nativeBridge?serializeNative(state):null;json=nativeSave?nativeSave.json:serializeState(state);timing.stringifyMs=Math.max(0,clock()-stageStart);timing.chunkUploads=nativeSave?.uploads.length||0;resetEpoch=Number(state.resetEpoch)||0;
      stageStart=clock();encoded=nativeBridge?utf8(json):null;measurement=nativeBridge?inspectNativeJSON(json,encoded):inspectJSON(json,storageKey,options);timing.measurementMs=Math.max(0,clock()-stageStart);timing.utf8Bytes=measurement.utf8Bytes;
      stageStart=clock();
      if(nativeBridge){
        // A chunked save is not self-contained (its records live in the vault), so it is never mirrored to WebStorage.
        cache=nativeSave?.chunked?{ok:false,reason:'chunked-native-save',previous:null,bypassed:true}:(measurement.utf8Bytes>PERSISTENCE_LIMITS.hardBytes||measurement.storageBytes>PERSISTENCE_LIMITS.hardBytes)?{ok:false,reason:'browser-cache-size-bypass',previous:null,bypassed:true}:writeJSON(storageKey,json,{...options,mirror:true},encoded);
        if(!cache.ok&&!nativeSave?.chunked)status({ok:true,warning:true,reason:'browser-cache-skipped',cacheReason:cache.reason,utf8Bytes:measurement.utf8Bytes,mirror:true});
        if(measurement.utf8Bytes>=PERSISTENCE_LIMITS.nativeSoftBytes)status({ok:true,warning:true,reason:'native-save-size-soft-warning',utf8Bytes:measurement.utf8Bytes,nativeHardBytes:PERSISTENCE_LIMITS.nativeHardBytes});
      }else{
        cache=writeJSON(storageKey,json,options);if(!cache.ok)throw Object.assign(new Error(cache.reason),{measurement:cache});
      }
      timing.browserCacheMs=Math.max(0,clock()-stageStart);timing.cacheReason=cache?.ok===false?cache.reason:null;timing.ok=true;timing.totalSyncMs=Math.max(0,clock()-syncStart);lastSaveBreakdown=rememberTiming(timing);lastSaveAtMs=clock();
    }catch(error){state.saveRevision=previousRevision;timing.totalSyncMs=Math.max(0,clock()-syncStart);timing.error=String(error.message||error);lastSaveBreakdown=rememberTiming(timing);return {ok:false,reason:`serialization-or-schema:${error.message||error}`,...error.measurement};}
    const out={ok:true,json,...measurement,browserCache:cache?.ok!==false,cacheReason:cache?.ok===false?cache.reason:null,previous:cache?.previous??null,saveRevision:nextRevision};
    if(!nativeBridge){ordinaryError=null;return out;}
    const nativeMetadata={appVersion,...options,saveRevision:nextRevision,resetEpoch,saveSchemaVersion:saveSchemaVersion(state)};
    const work=Promise.resolve().then(()=>{if(recoveryRequired)throw new Error('native-recovery-required');return uploadChunks(nativeSave?.uploads);}).then(()=>requestNative('commitSave',json,{...nativeMetadata,encoded})).catch(error=>{throw noteNativeRefusal(error);});
    ordinaryInFlight=work.then(ack=>{ordinaryError=null;return ack;},error=>{
      ordinaryError=error;
      if(cache?.ok)try{if(localStorage.getItem(storageKey)===json)restoreRaw(storageKey,cache.previous);}catch(e){error.rollbackError=String(e.message||e);}
      const uncertainNative=error.code==='ACK_TIMEOUT';recoveryRequired=true;status({ok:false,reason:error.message,critical:!!error.rollbackError,requiresMemoryRollback:false,requiresNativeReconciliation:true,storageKey});return {ok:false,reason:error.message,uncertainNative};
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
  function commitState(state,{storageKey='global-holdings-world-v3.0.0',appVersion=VERSION,...options}={}){
    if(locked||durableLocked)return {ok:false,reason:'lifecycle-locked'};
    if(recoveryRequired)return {ok:false,reason:'memory-recovery-required'};
    const snapshotOptions=ordinarySnapshotOptions(storageKey,appVersion,options),nativeBridge=!!bridgeFor('commitSave');
    if(nativeBridge&&ordinaryInFlight){deferOrdinary(state,snapshotOptions);return {ok:true,deferred:true,coalesced:true,saveRevision:Number(state.saveRevision)||0,native:waitOrdinaryIdle().then(()=>({ok:true,deferred:true,coalesced:true}),error=>({ok:false,reason:String(error.message||error)}))};}
    return beginOrdinary(state,snapshotOptions);
  }
  async function drain(options={}){return waitOrdinaryIdle(options);}
  async function commitDurableState(state,{storageKey='global-holdings-world-v3.0.0',appVersion=VERSION,yieldToFrame=null,...options}={}){
    if(locked||durableLocked)throw new Error('lifecycle-locked');if(recoveryRequired)throw new Error('memory-recovery-required');
    if(options.expectedPreviousRevision!=null){const previous=Number(options.expectedPreviousRevision),next=Number(state?.saveRevision);if(!Number.isSafeInteger(previous)||previous<0||!Number.isSafeInteger(next)||next!==previous+1)throw new Error(`save-revision-conflict:${previous}:${next}`);}
    durableLocked=true;
    let written=null;
    try{
      await waitOrdinaryIdle({supersedeDirty:true});
      const durableTiming={kind:'durable-save',saveRevision:Number(state?.saveRevision)||0,schemaMs:0,stringifyMs:0,measurementMs:0,totalSyncMs:0,utf8Bytes:null,ok:false};let stageStart=clock();const syncStart=stageStart;
      assertRecurringState(state,{prevalidated:options.prevalidated===true});durableTiming.schemaMs=Math.max(0,clock()-stageStart);stageStart=clock();const nativeBridge=!!bridgeFor('commitSave'),sliced=nativeBridge&&typeof yieldToFrame==='function'?{busyMs:0,slices:0,retakes:0}:null,nativeSave=nativeBridge?(sliced?await serializeNativeSliced(state,yieldToFrame,sliced):serializeNative(state)):null,json=nativeSave?nativeSave.json:serializeState(state);durableTiming.stringifyMs=sliced?sliced.busyMs:Math.max(0,clock()-stageStart);durableTiming.chunkUploads=nativeSave?.uploads.length||0;lastSaveAtMs=clock();
      if(nativeBridge){
        stageStart=clock();const encodeBusy=sliced?sliced.busyMs:0,encoded=sliced?await runSliced(utf8Steps(json),yieldToFrame,sliced):utf8(json),measurement=inspectNativeJSON(json,encoded);durableTiming.measurementMs=sliced?sliced.busyMs-encodeBusy:Math.max(0,clock()-stageStart);durableTiming.utf8Bytes=measurement.utf8Bytes;durableTiming.totalSyncMs=sliced?durableTiming.schemaMs+sliced.busyMs:Math.max(0,clock()-syncStart);if(sliced){durableTiming.slices=sliced.slices;durableTiming.retakes=sliced.retakes;durableTiming.wallMs=Math.max(0,clock()-syncStart);}durableTiming.ok=true;rememberTiming(durableTiming);let ack;try{await uploadChunks(nativeSave?.uploads);ack=await requestNative('commitSave',json,{appVersion,...options,saveRevision:Number(state.saveRevision)||0,resetEpoch:Number(state.resetEpoch)||0,saveSchemaVersion:saveSchemaVersion(state),encoded});}catch(error){throw noteNativeRefusal(error);}ordinaryError=null;
        const cache=nativeSave?.chunked?{ok:false,reason:'chunked-native-save',previous:null,bypassed:true}:(measurement.utf8Bytes>PERSISTENCE_LIMITS.hardBytes||measurement.storageBytes>PERSISTENCE_LIMITS.hardBytes)?{ok:false,reason:'browser-cache-size-bypass',previous:null,bypassed:true}:writeJSON(storageKey,json,{...options,mirror:true},encoded);
        if(!cache.ok&&!nativeSave?.chunked)status({ok:true,warning:true,reason:'browser-cache-skipped',cacheReason:cache.reason,durable:true,utf8Bytes:measurement.utf8Bytes,mirror:true});
        telemetry({operation:'durable-commit',ok:true,utf8Bytes:measurement.utf8Bytes,native:true,browserCache:cache.ok,durationMs:0});status({ok:true,validated:true,durable:true,native:true,saveRevision:Number(state.saveRevision)||0});return {ok:true,json,...measurement,ack,durable:true,browserCache:cache.ok,cacheReason:cache.ok?null:cache.reason};
      }
      written=writeJSON(storageKey,json,options);if(!written.ok)throw new Error(written.reason);
      const ack=await requestNative('commitSave',json,{appVersion,...options,saveRevision:Number(state.saveRevision)||0,resetEpoch:Number(state.resetEpoch)||0,saveSchemaVersion:saveSchemaVersion(state)});ordinaryError=null;
      telemetry({operation:'durable-commit',ok:true,utf8Bytes:written.utf8Bytes,native:false,durationMs:0});status({ok:true,validated:true,durable:true,native:false,saveRevision:Number(state.saveRevision)||0});return {...written,ack,durable:true};
    }catch(error){
      if(written?.ok)try{if(localStorage.getItem(storageKey)===written.json)restoreRaw(storageKey,written.previous);}catch(rollbackError){error.rollbackError=String(rollbackError.message||rollbackError);}
      const uncertainNative=error.code==='ACK_TIMEOUT';if(error.rollbackError||uncertainNative){recoveryRequired=true;error.critical=true;}status({ok:false,reason:String(error.message||error),critical:!!error.critical,durable:true,requiresNativeReconciliation:uncertainNative,storageKey});throw error;
    }finally{durableLocked=false;}
  }
  function recoverBrowserState(storageKey='global-holdings-world-v3.0.0'){
    if(bridgeFor('commitSave'))return {ok:false,reason:'native-vault-reconciliation-required'};
    try{const raw=localStorage.getItem(storageKey);if(!raw)return {ok:false,reason:'missing-durable-state'};const state=parseState(raw);assertState(state);return {ok:true,state};}catch(error){return {ok:false,reason:String(error.message||error)};}
  }
  function markRecoveryRequired(reason='manual-recovery-required'){recoveryRequired=true;ordinaryError=ordinaryError||new Error(String(reason));status({ok:false,critical:true,reason:String(reason),requiresNativeReconciliation:!!bridgeFor('commitSave')});return true;}
  function acknowledgeRecovery(){if(bridgeFor('commitSave')&&recoveryRequired)return false;recoveryRequired=false;ordinaryError=null;return true;}
  async function replaceState(next,previous,{storageKey='global-holdings-world-v3.0.0',resetMarkerKey,appVersion=VERSION,timeoutMs,apply,cleanupKeys=[],clearManualSlots=false}={}){
    if(locked)throw new Error('lifecycle-locked');locked=true;
    let nativeAttempted=false,nativeCommitted=false,oldRaw=null,oldMarker=null,browserTouched=false;
    let oldJSON,oldNative=null;
    try{
      await drain({allowLockedFlush:true});assertState(next);assertState(previous);
      const nativeBridge=!!bridgeFor('resetGameSave');oldNative=nativeBridge?serializeNative(previous):null;oldJSON=oldNative?oldNative.json:serializeState(previous);
      const nextNative=nativeBridge?serializeNative(next):null,json=nextNative?nextNative.json:serializeState(next),nativeMeasurement=nativeBridge?inspectNativeJSON(json):null;if(!nativeBridge)inspectJSON(json,storageKey);oldRaw=localStorage.getItem(storageKey);oldMarker=resetMarkerKey?localStorage.getItem(resetMarkerKey):null;
      // The current in-memory game is the compensating checkpoint. Native owns durability. Both worlds' chunks are in
      // the vault before the reset, so the compensation below can always be committed.
      if(nativeBridge){await uploadChunks(oldNative.uploads);await uploadChunks(nextNative.uploads);}
      nativeAttempted=nativeBridge;
      await requestNative('resetGameSave',json,{appVersion,timeoutMs,clearManualSlots,saveRevision:Number(next.saveRevision)||0,resetEpoch:Number(next.resetEpoch)||0,saveSchemaVersion:saveSchemaVersion(next)});
      nativeCommitted=nativeBridge;
      const out=nextNative?.chunked?{ok:false,reason:'chunked-native-save',previous:null,bypassed:true}
        :(nativeBridge&&(nativeMeasurement.utf8Bytes>PERSISTENCE_LIMITS.hardBytes||nativeMeasurement.storageBytes>PERSISTENCE_LIMITS.hardBytes))
        ? {ok:false,reason:'browser-cache-size-bypass',previous:null,bypassed:true}
        : writeJSON(storageKey,json,{mirror:nativeBridge});
      if(out.ok)browserTouched=true;
      else if(!nativeBridge){const writeError=new Error(out.reason);writeError.rollbackError=out.rollbackError;throw writeError;}
      else if(!nextNative?.chunked)status({ok:true,warning:true,reason:'browser-cache-skipped',cacheReason:out.reason,reset:true,mirror:true});
      if(resetMarkerKey){
        try{localStorage.setItem(resetMarkerKey,String(next.resetEpoch||0));if(localStorage.getItem(resetMarkerKey)!==String(next.resetEpoch||0))throw new Error('reset-marker-verification');}
        catch(markerError){if(!nativeBridge)throw markerError;status({ok:true,warning:true,reason:'reset-marker-cache-skipped',message:String(markerError.message||markerError),mirror:true});}
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
      if(nativeAttempted)try{await requestNative('resetGameSave',oldJSON,{appVersion,timeoutMs,clearManualSlots:false,saveRevision:Number(previous.saveRevision)||0,resetEpoch:Number(previous.resetEpoch)||0,saveSchemaVersion:saveSchemaVersion(previous)});}catch(e){error.compensationError=String(e.message||e);}
      if(error.rollbackError||error.compensationError){error.critical=true;globalThis.GH_CONTROL_PLANE?.incident?.(previous,{fingerprint:'RESET_COMPENSATION_FAILED',code:'RESET_COMPENSATION_FAILED',severity:'critical',domain:'save',title:'فشل استرداد الحفظ بعد عملية الاستبدال',detail:String(error.compensationError||error.rollbackError)});}
      throw error;
    }finally{locked=false;forgetVaultChunks();}
  }
  function parseSlot(raw){if(!raw)return {ok:false,reason:'empty'};try{const p=JSON.parse(raw),state=decodeTree(p?.format===SLOT_FORMAT?p.state:p);assertState(state);return {ok:true,state,meta:p?.format===SLOT_FORMAT?p.meta||{}:{legacy:true}};}catch(e){return {ok:false,reason:'invalid-save',error:String(e.message||e)};}}
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
      const envelope={format:SLOT_FORMAT,version:VERSION,saveSchemaVersion:SAVE_SCHEMA_VERSION,meta:{appVersion:meta.appVersion||VERSION,saveRevision:Number(state.saveRevision)||0,simSeconds:Number(state.simSeconds)||0,day,label},state:stateCodec()?stateCodec().encodeState(state):state};const out=writeJSON(slotKey(index),JSON.stringify(envelope));return {...out,meta:envelope.meta};
    }catch(e){return {ok:false,reason:String(e.message||e)};}
  }
  function statusEventForSlot(error,storageKey){status({ok:false,reason:error.message,requiresNativeReconciliation:true,storageKey});}
  function loadSlot(index,{storageKey='global-holdings-world-v3.0.0',appVersion=VERSION,previousState}={}){
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
    try{assertState(state);const day=Math.floor((Number(state.simSeconds)||0)/86400)+1,pack={format:EXPORT_FORMAT,version:appVersion,saveSchemaVersion:SAVE_SCHEMA_VERSION,saveRevision:Number(state.saveRevision)||0,simSeconds:Number(state.simSeconds)||0,day,state:stateCodec()?stateCodec().encodeState(state):clone(state)};const blob=new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}),a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`GlobalHoldings_Save_v${appVersion}_D${day}.ghsave`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return {ok:true,filename:a.download};}catch(e){return {ok:false,reason:'export-failed',error:String(e.message||e)};}
  }
  function migrateMetadata(state){state.advanced=state.advanced||{};state.advanced.saveSlots=Array.isArray(state.advanced.saveSlots)?state.advanced.saveSlots:[null,null,null];for(let i=0;i<3;i++){const s=slotStatus(i);state.advanced.saveSlots[i]=s.exists?{date:s.meta?.label||`اليوم ${s.meta?.day||'—'}`,version:s.meta?.appVersion||'legacy',simSeconds:Number(s.meta?.simSeconds)||0}:null;}return state.advanced.saveSlots;}
  const API=Object.freeze({VERSION,noteVaultChunks,forgetVaultChunks,vaultChunkCount:()=>vaultChunks.size,SLOT_FORMAT,LIMITS:PERSISTENCE_LIMITS,fleetRecordLimit,slotStatus,saveSlot,loadSlot,clearSlot,exportSave,migrateMetadata,parseSlot,inspectJSON,inspectNativeJSON,writeJSON,writeState,commitState,commitDurableState,recoverBrowserState,acknowledgeRecovery,markRecoveryRequired,requestNative,receiveAck,receiveSlotAck,drain,replaceState,isLocked:()=>locked||durableLocked||recoveryRequired,
    // Cheap read for the save policy (GH_SAVE_POLICY): when the last save of any kind ran.
    saveCadence:()=>({lastSaveAtMs}),telemetry:()=>({generation,pending:pending.size,slotPending:slotPending.size,ordinaryInFlight:!!ordinaryInFlight,ordinaryDirty,recoveryRequired,samples:clone(samples),timings:{lastSaveBreakdown:clone(lastSaveBreakdown),lastNativeAck:clone(lastNativeAck),samples:clone(timingSamples)}})});
  globalThis.GH_PERSISTENCE=API;if(globalThis.window&&window!==globalThis)window.GH_PERSISTENCE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
