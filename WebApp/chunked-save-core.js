/* Atomic, content-addressed storage format. It never changes Save Schema 2.0.0. */
((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_CHUNKED_SAVE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const VERSION='GH-CHUNKED-SAVE-2.0.0';
  const FORMAT='gh-state-manifest-v2';
  const CHUNK_PREFIX='gh-state-v2-chunk-';
  const INDEX_KEYS=Object.freeze(['manifest-A.json','manifest-B.json']);
  function pathRead(root,path){let value=root;for(const key of String(path).split('.')){if(value==null)return undefined;value=value[key];}return value;}
  function pathWrite(root,path,value){const keys=String(path).split('.');let target=root;for(const key of keys.slice(0,-1)){if(!target[key]||typeof target[key]!=='object'||Array.isArray(target[key]))target[key]={};target=target[key];}target[keys[keys.length-1]]=value;}
  function pathDelete(root,path){const keys=String(path).split('.');let target=root;for(const key of keys.slice(0,-1)){if(!target||typeof target!=='object')return;target=target[key];}if(target&&typeof target==='object')delete target[keys[keys.length-1]];}
  function canonical(value){
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    if(ArrayBuffer.isView(value))return Array.from(value,canonical);
    if(Array.isArray(value))return value.map(item=>item===undefined?null:canonical(item));
    if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())if(value[key]!==undefined)out[key]=canonical(value[key]);return out;}
    return null;
  }
  const stringify=value=>JSON.stringify(canonical(value));
  const hex=data=>Array.from(new Uint8Array(data),byte=>byte.toString(16).padStart(2,'0')).join('');
  async function sha256(text){
    const subtle=globalThis.crypto?.subtle;if(!subtle)throw new Error('chunked-save-webcrypto-unavailable');
    return hex(await subtle.digest('SHA-256',new TextEncoder().encode(text)));
  }
  function parseJSON(text){try{return JSON.parse(text);}catch(_error){return null;}}
  function create(options={}){
    const adapter=options.adapter;
    if(!adapter||typeof adapter.read!=='function'||typeof adapter.writeAtomic!=='function'||typeof adapter.remove!=='function'||typeof adapter.keys!=='function')throw new TypeError('chunked-save-atomic-adapter-required');
    const schemaVersion=String(options.schemaVersion||'2.0.0'),storageVersion=2,chunkItems=Number.isSafeInteger(options.chunkItems)&&options.chunkItems>0?options.chunkItems:1000,appendOnlyPaths=[...new Set((options.appendOnlyPaths||['finance.ledger']).map(String))],coldPaths=[...new Set((options.coldPaths||[]).map(String))];
    if(schemaVersion!=='2.0.0')throw new Error('chunked-save-schema-must-remain-2.0.0');
    let metrics={lastCommit:null};
    function validManifest(row){return !!row&&row.format===FORMAT&&row.schemaVersion===schemaVersion&&row.storageVersion===storageVersion&&Number.isSafeInteger(row.generation)&&row.generation>0&&['A','B'].includes(row.slot)&&Array.isArray(row.sections)&&typeof row.payloadSHA256==='string'&&/^[a-f0-9]{64}$/.test(row.payloadSHA256)&&typeof row.hotPayloadSHA256==='string'&&/^[a-f0-9]{64}$/.test(row.hotPayloadSHA256);}
    async function readIndex(name){const text=await adapter.read(name);if(typeof text!=='string')return null;const row=parseJSON(text);return validManifest(row)?{name,text,row}:null;}
    async function readManifest(entry,{includeCold=true}={}){
      const out={},nested=[];const sectionNames=new Set();
      for(const section of entry.row.sections){
        if(!section||typeof section.key!=='string'||!section.key||sectionNames.has(section.key)||!['value','array'].includes(section.kind)||!Array.isArray(section.chunks))return null;
        sectionNames.add(section.key);const values=[],materialize=includeCold||section.cold!==true;
        for(const ref of section.chunks){
          if(!ref||typeof ref.name!=='string'||!ref.name.startsWith(CHUNK_PREFIX)||typeof ref.sha256!=='string'||!/^[a-f0-9]{64}$/.test(ref.sha256)||!Number.isSafeInteger(ref.bytes)||ref.bytes<0)return null;
          const text=await adapter.read(ref.name);if(typeof text!=='string'||new TextEncoder().encode(text).byteLength!==ref.bytes||await sha256(text)!==ref.sha256)return null;
          if(!materialize)continue;
          const value=parseJSON(text);if(value===null&&text!=='null')return null;
          if(ref.items!==undefined&&(!Array.isArray(value)||value.length!==ref.items))return null;
          values.push(value);
        }
        if(!materialize)continue;
        let value;if(section.kind==='array'){
          if(values.some(value=>!Array.isArray(value)))return null;value=values.flat();
          if(Number(section.items)!==value.length)return null;
        }else {if(values.length!==1)return null;value=values[0];}
        if(section.key.includes('.'))nested.push([section.key,value]);else out[section.key]=value;
      }
      for(const [path,value] of nested)pathWrite(out,path,value);
      if(out.saveVersion!==schemaVersion)return null;
      const text=stringify(out),expectedDigest=includeCold?entry.row.payloadSHA256:entry.row.hotPayloadSHA256;if(typeof expectedDigest!=='string'||await sha256(text)!==expectedDigest)return null;
      return {state:out,canonicalJSON:text,manifest:entry.row,manifestKey:entry.name,coldPaths:entry.row.sections.filter(row=>row.cold===true).map(row=>row.key),fullyMaterialized:includeCold};
    }
    async function load({includeCold=true}={}){
      const candidates=(await Promise.all(INDEX_KEYS.map(readIndex))).filter(Boolean).sort((a,b)=>b.row.generation-a.row.generation||a.row.slot.localeCompare(b.row.slot));
      for(const candidate of candidates){const recovered=await readManifest(candidate,{includeCold});if(recovered)return {...recovered,recoveredFrom:'chunked-manifest'};}
      if(typeof options.readLegacy==='function'){
        const text=await options.readLegacy();if(typeof text==='string'){const state=parseJSON(text);if(state?.saveVersion===schemaVersion)return {state,canonicalJSON:text,manifest:null,manifestKey:null,recoveredFrom:'legacy-json'};}
      }
      return null;
    }
    async function writeChunk(text){
      const digest=await sha256(text),name=`${CHUNK_PREFIX}${digest}.json`,old=await adapter.read(name);
      if(old===text)return {name,sha256:digest,bytes:new TextEncoder().encode(text).byteLength,reused:true};
      await adapter.writeAtomic(name,text);const verified=await adapter.read(name);
      if(verified!==text||await sha256(verified)!==digest)throw new Error(`chunked-save-chunk-verification-failed:${name}`);
      return {name,sha256:digest,bytes:new TextEncoder().encode(text).byteLength,reused:false};
    }
    async function referencedChunks(){
      const refs=new Set();
      for(const key of INDEX_KEYS){const text=await adapter.read(key),row=typeof text==='string'?parseJSON(text):null;if(!validManifest(row))continue;for(const section of row.sections||[])for(const chunk of section.chunks||[])if(typeof chunk?.name==='string')refs.add(chunk.name);}
      return refs;
    }
    async function cleanup(){
      const refs=await referencedChunks();for(const key of await adapter.keys())if(key.startsWith(CHUNK_PREFIX)&&!refs.has(key))await adapter.remove(key);
    }
    async function loadSection(path){
      const loaded=await load({includeCold:false});if(!loaded?.manifest)return undefined;
      const section=loaded.manifest.sections.find(row=>row.key===String(path));if(!section)return undefined;const values=[];
      for(const ref of section.chunks){const text=await adapter.read(ref.name);if(typeof text!=='string'||new TextEncoder().encode(text).byteLength!==ref.bytes||await sha256(text)!==ref.sha256)throw new Error(`chunked-save-section-corrupt:${path}`);const value=parseJSON(text);if(value===null&&text!=='null')throw new Error(`chunked-save-section-invalid:${path}`);values.push(value);}
      if(section.kind==='array'){if(values.some(value=>!Array.isArray(value)))throw new Error(`chunked-save-section-invalid:${path}`);const result=values.flat();if(result.length!==Number(section.items))throw new Error(`chunked-save-section-count-invalid:${path}`);return result;}
      if(values.length!==1)throw new Error(`chunked-save-section-count-invalid:${path}`);return values[0];
    }
    async function exportLegacy(){
      const loaded=await load({includeCold:false});if(!loaded)return null;if(!loaded.manifest)return loaded;const out=loaded.state;
      for(const path of loaded.coldPaths){const value=await loadSection(path);if(value!==undefined)pathWrite(out,path,value);}
      const canonicalJSON=stringify(out);if(await sha256(canonicalJSON)!==loaded.manifest.payloadSHA256)throw new Error('chunked-save-export-integrity-failed');
      return {...loaded,state:out,canonicalJSON,fullyMaterialized:true};
    }
    async function commit(state,metadata={}){
      if(!state||typeof state!=='object'||Array.isArray(state)||state.saveVersion!==schemaVersion)throw new Error('chunked-save-logical-schema-invalid');
      const current=await load(),generation=(Number(current?.manifest?.generation)||0)+1,slot=current?.manifest?.slot==='A'?'B':'A';
      const split=canonical(state),sectionSources=[],specialPaths=[...new Set([...appendOnlyPaths,...coldPaths])];
      for(const path of specialPaths){const value=pathRead(state,path);if(value!==undefined){pathDelete(split,path);sectionSources.push({key:path,kind:Array.isArray(value)?'array':'value',value,cold:coldPaths.includes(path)});}}
      for(const key of Object.keys(split).sort())if(split[key]!==undefined)sectionSources.push({key,kind:Array.isArray(split[key])?'array':'value',value:split[key],cold:false});
      const sections=[];let chunksWritten=0,chunksReused=0;
      for(const source of sectionSources){const {key,kind}=source,value=source.value,refs=[];
        if(kind==='array'){
          for(let offset=0;offset<value.length;offset+=chunkItems){const part=value.slice(offset,offset+chunkItems),text=stringify(part),ref=await writeChunk(text);refs.push({...ref,items:part.length});ref.reused?chunksReused++:chunksWritten++;}
          if(value.length===0){const text='[]',ref=await writeChunk(text);refs.push({...ref,items:0});ref.reused?chunksReused++:chunksWritten++;}
          sections.push({key,kind:'array',items:value.length,chunks:refs,...(source.cold?{cold:true}:{})});
        }else {const text=stringify(value),ref=await writeChunk(text);refs.push(ref);ref.reused?chunksReused++:chunksWritten++;sections.push({key,kind:'value',items:1,chunks:refs,...(source.cold?{cold:true}:{})});}
      }
      const canonicalJSON=stringify(state),hotState=canonical(state);for(const path of coldPaths)pathDelete(hotState,path);const hotJSON=stringify(hotState),manifest={format:FORMAT,storageVersion,schemaVersion,generation,slot,saveRevision:Math.max(0,Math.floor(Number(metadata.saveRevision??state.saveRevision)||0)),resetEpoch:Math.max(0,Number(metadata.resetEpoch??state.resetEpoch)||0),payloadSHA256:await sha256(canonicalJSON),hotPayloadSHA256:await sha256(hotJSON),sections};
      const text=stringify(manifest),key=INDEX_KEYS[slot==='A'?0:1];await adapter.writeAtomic(key,text);
      const verified=await adapter.read(key);if(verified!==text||!validManifest(parseJSON(verified)))throw new Error('chunked-save-manifest-commit-verification-failed');
      // The new A/B manifest is committed. Collection happens only after readback.
      await cleanup();const loaded=await load();if(!loaded||loaded.manifest?.generation!==generation||loaded.manifest?.slot!==slot)throw new Error('chunked-save-post-commit-recovery-failed');
      metrics.lastCommit={generation,slot,changedChunks:chunksWritten,reusedChunks:chunksReused,sectionCount:sections.length,bytes:new TextEncoder().encode(canonicalJSON).byteLength,hotBytes:new TextEncoder().encode(hotJSON).byteLength,coldBytes:Math.max(0,new TextEncoder().encode(canonicalJSON).byteLength-new TextEncoder().encode(hotJSON).byteLength),storageVersion,schemaVersion};
      return {...loaded,metrics:{...metrics.lastCommit}};
    }
    return Object.freeze({VERSION,schemaVersion,storageVersion,chunkItems,load,loadHot:()=>load({includeCold:false}),loadSection,exportLegacy,commit,metrics:()=>JSON.parse(JSON.stringify(metrics)),cleanup});
  }
  return Object.freeze({VERSION,FORMAT,CHUNK_PREFIX,INDEX_KEYS,canonicalStringify:stringify,sha256,create});
});
