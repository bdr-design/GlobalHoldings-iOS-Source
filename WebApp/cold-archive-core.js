((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_COLD_ARCHIVE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const VERSION='GH-COLD-ARCHIVE-1.0.0',FORMAT='gh-cold-archive-index-v1';
  const appendQueues=new WeakMap();
  const canonical=value=>{
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    if(Array.isArray(value))return value.map(row=>row===undefined?null:canonical(row));
    if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())if(value[key]!==undefined)out[key]=canonical(value[key]);return out;}
    return null;
  };
  const stringify=value=>JSON.stringify(canonical(value));
  const hex=data=>Array.from(new Uint8Array(data),byte=>byte.toString(16).padStart(2,'0')).join('');
  async function sha256(text){const subtle=globalThis.crypto?.subtle;if(!subtle)throw new Error('cold-archive-webcrypto-unavailable');return hex(await subtle.digest('SHA-256',new TextEncoder().encode(text)));}
  const parse=text=>{try{return JSON.parse(text);}catch(_error){return null;}};
  function serializeAppend(adapter,bucket,work){
    let buckets=appendQueues.get(adapter);if(!buckets){buckets=new Map();appendQueues.set(adapter,buckets);}
    const tail=buckets.get(bucket)||Promise.resolve(),result=tail.then(work,work);buckets.set(bucket,result.then(()=>undefined,()=>undefined));return result;
  }
  function create(options={}){
    const adapter=options.adapter,bucket=String(options.bucket||'').trim();
    if(!adapter||typeof adapter.read!=='function'||typeof adapter.writeAtomic!=='function')throw new TypeError('cold-archive-atomic-adapter-required');
    if(!/^[A-Za-z0-9._-]{1,80}$/.test(bucket))throw new TypeError('cold-archive-bucket-invalid');
    const indexKeys=[`gh-cold-${bucket}-A.json`,`gh-cold-${bucket}-B.json`],prefix=`gh-cold-${bucket}-item-`,verifiedIndexTexts=new Set();
    function valid(index){return !!index&&index.format===FORMAT&&index.bucket===bucket&&Number.isSafeInteger(index.generation)&&index.generation>0&&['A','B'].includes(index.slot)&&Array.isArray(index.items)&&index.items.length<=1_000_000;}
    function validReference(ref,seen){return !!ref&&typeof ref.id==='string'&&ref.id.length>0&&ref.id.length<=240&&!seen.has(ref.id)&&typeof ref.sha256==='string'&&/^[a-f0-9]{64}$/.test(ref.sha256)&&ref.file===`${prefix}${ref.sha256}.json`&&Number.isSafeInteger(ref.bytes)&&ref.bytes>=0;}
    async function indexCandidates(){
      const rows=[];let present=0;
      for(const key of indexKeys){
        const text=await adapter.read(key);if(typeof text!=='string')continue;present++;
        const row=parse(text);if(valid(row))rows.push({key,text,row});
      }
      if(!rows.length&&present)throw new Error('cold-archive-index-unrecoverable');
      return rows.sort((a,b)=>b.row.generation-a.row.generation||a.row.slot.localeCompare(b.row.slot));
    }
    async function readRecord(ref){
      const text=await adapter.read(ref.file);
      if(typeof text!=='string'||new TextEncoder().encode(text).byteLength!==ref.bytes||await sha256(text)!==ref.sha256)throw new Error(`cold-archive-record-corrupt:${ref.id}`);
      const value=parse(text);if(value===null||String(options.idFor?.(value)||value?.id||'').trim()!==ref.id)throw new Error(`cold-archive-record-invalid:${ref.id}`);
      return value;
    }
    async function verifyCandidate(candidate,{collect=false}={}){
      const seen=new Set(),values=[];
      for(const ref of candidate.row.items){if(!validReference(ref,seen))throw new Error('cold-archive-index-reference-invalid');seen.add(ref.id);if(collect)values.push(await readRecord(ref));else await readRecord(ref);}
      verifiedIndexTexts.add(candidate.text);while(verifiedIndexTexts.size>2)verifiedIndexTexts.delete(verifiedIndexTexts.values().next().value);
      return collect?{candidate,values}:candidate;
    }
    async function bestIndex(){
      const rows=await indexCandidates();let lastError=null;const maxGeneration=rows.reduce((max,row)=>Math.max(max,row.row.generation),0);
      for(const candidate of rows){try{return {...(verifiedIndexTexts.has(candidate.text)?candidate:await verifyCandidate(candidate)),maxGeneration};}catch(error){lastError=error;}}
      if(lastError)throw lastError;return null;
    }
    async function appendNow(records,{newestFirst=false}={}){
      if(!Array.isArray(records))throw new TypeError('cold-archive-records-array-required');const old=await bestIndex(),byId=new Map((old?.row.items||[]).map(row=>[row.id,row])),adds=[];
      const supplied=[],suppliedIds=new Set();
      for(const record of records){const id=String(options.idFor?.(record)||record?.id||'').trim();if(!id||id.length>240)throw new Error('cold-archive-stable-id-required');const text=stringify(record),digest=await sha256(text),file=`${prefix}${digest}.json`,existing=byId.get(id);if(existing){if(existing.sha256!==digest)throw new Error(`cold-archive-id-conflict:${id}`);continue;}const onDisk=await adapter.read(file);if(onDisk!==text){await adapter.writeAtomic(file,text);const verified=await adapter.read(file);if(verified!==text||await sha256(verified)!==digest)throw new Error(`cold-archive-record-verification-failed:${id}`);}const ref={id,sha256:digest,file,bytes:new TextEncoder().encode(text).byteLength};byId.set(id,ref);adds.push(ref);}
      if(newestFirst)for(const record of records){const id=String(options.idFor?.(record)||record?.id||'').trim();if(!suppliedIds.has(id)){supplied.push(byId.get(id));suppliedIds.add(id);}}
      const items=newestFirst?[...supplied,...(old?.row.items||[]).filter(row=>!suppliedIds.has(row.id))]:[...byId.values()];
      const orderChanged=items.some((row,index)=>row.id!==old?.row.items?.[index]?.id);
      if(!adds.length&&!orderChanged)return {committed:true,idempotent:true,generation:old?.row.generation||0,added:0,total:byId.size};
      const slot=old?.row.slot==='A'?'B':'A',generation=(old?.maxGeneration||old?.row.generation||0)+1,index={format:FORMAT,bucket,generation,slot,items},text=stringify(index),key=indexKeys[slot==='A'?0:1];
      await adapter.writeAtomic(key,text);const verified=await adapter.read(key);if(verified!==text||!valid(parse(verified)))throw new Error('cold-archive-index-commit-verification-failed');
      verifiedIndexTexts.add(text);while(verifiedIndexTexts.size>2)verifiedIndexTexts.delete(verifiedIndexTexts.values().next().value);
      return {committed:true,idempotent:false,generation,added:adds.length,total:byId.size};
    }
    function append(records,options={}){
      if(!Array.isArray(records))return Promise.reject(new TypeError('cold-archive-records-array-required'));
      let snapshot;try{snapshot=parse(stringify(records));}catch(error){return Promise.reject(error);}
      if(!Array.isArray(snapshot))return Promise.reject(new TypeError('cold-archive-records-array-required'));
      const newestFirst=options?.newestFirst===true;return serializeAppend(adapter,bucket,()=>appendNow(snapshot,{newestFirst}));
    }
    async function peek(id){const key=String(id),rows=await indexCandidates();let lastError=null;for(const index of rows){const ref=index.row.items.find(row=>row&&row.id===key);if(!ref)continue;try{if(!validReference(ref,new Set()))throw new Error('cold-archive-index-reference-invalid');return await readRecord(ref);}catch(error){lastError=error;}}if(lastError)throw lastError;return null;}
    async function readAll(){const rows=await indexCandidates();let lastError=null;for(const index of rows){try{return (await verifyCandidate(index,{collect:true})).values;}catch(error){lastError=error;}}if(lastError)throw lastError;return [];}
    async function offloadNewestFirst(records,hotLimit=64){
      if(!Array.isArray(records)||!Number.isSafeInteger(hotLimit)||hotLimit<1)throw new TypeError('cold-archive-offload-invalid');
      if(records.length<=hotLimit)return {hot:records.slice(),archived:0,committed:true};
      const cold=records.slice(hotLimit),committed=await append(cold,{newestFirst:true});return {hot:records.slice(0,hotLimit),archived:cold.length,committed:true,generation:committed.generation,idempotent:committed.idempotent};
    }
    async function rehydrateNewestFirst(hot){if(!Array.isArray(hot))throw new TypeError('cold-archive-hot-records-invalid');const cold=await readAll(),seen=new Set(),rows=[];for(const row of [...hot,...cold]){const id=String(options.idFor?.(row)||row?.id||'');if(!id||seen.has(id))continue;seen.add(id);rows.push(row);}return rows;}
    return Object.freeze({VERSION,bucket,append,peek,readAll,offloadNewestFirst,rehydrateNewestFirst,metadata:async()=>{const index=await bestIndex();return index?{generation:index.row.generation,count:index.row.items.length,slot:index.row.slot,digests:index.row.items.map(row=>({id:row.id,sha256:row.sha256}))}:{generation:0,count:0,slot:null,digests:[]};}});
  }
  return Object.freeze({VERSION,FORMAT,create});
});
