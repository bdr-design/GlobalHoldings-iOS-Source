'use strict';

((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_MAP_ASSET_QUERY_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const VERSION='GH-MAP-ASSET-QUERY-340.1.0';
  const uniqueStrings=value=>[...new Set((Array.isArray(value)?value:[]).map(item=>String(item||'').trim()).filter(Boolean))].sort();

  function normalizeFilter(value={}){
    const mode=value?.mode==='include'?'include':'all',included=uniqueStrings(value?.included),excluded=uniqueStrings(value?.excluded).filter(id=>!included.includes(id));
    return {mode,included,excluded};
  }
  function filterKey(value={}){
    const filter=normalizeFilter(value);
    return `${filter.mode}:${filter.included.join(',')}:${filter.excluded.join(',')}`;
  }
  function buildOwnershipIndex(assets,options={}){
    if(!Array.isArray(assets))throw new TypeError('map-assets-invalid');
    const ownerOf=typeof options.ownerOf==='function'?options.ownerOf:asset=>asset?.ownerCompanyId||asset?.companyId||'',
      isKnownOwner=typeof options.isKnownOwner==='function'?options.isKnownOwner:()=>true,
      companyIds=[''],companyCodes=new Map([['',0]]),knownCodes=new Uint8Array(assets.length+1),ownerCodes=new Uint32Array(assets.length);let allKnown=true;
    for(let index=0;index<assets.length;index++){
      const owner=String(ownerOf(assets[index],index)||'').trim();if(!owner){allKnown=false;continue;}
      let code=companyCodes.get(owner);
      if(code===undefined){code=companyIds.length;companyCodes.set(owner,code);companyIds.push(owner);knownCodes[code]=isKnownOwner(owner)?1:0;if(knownCodes[code]!==1)allKnown=false;}
      ownerCodes[index]=code;
    }
    return {ownerCodes,companyIds,knownCodes:knownCodes.slice(0,companyIds.length),allKnown};
  }
  function filterVisibleIndices(snapshot,filterInput={}){
    const owners=snapshot?.ownerCodes,companyIds=snapshot?.companyIds,knownCodes=snapshot?.knownCodes;
    if(!(owners instanceof Uint32Array)||!Array.isArray(companyIds)||!(knownCodes instanceof Uint8Array)||knownCodes.length!==companyIds.length)throw new TypeError('map-ownership-index-invalid');
    const filter=normalizeFilter(filterInput),codeByCompany=new Map(companyIds.map((company,index)=>[company,index])),included=new Set(filter.included.map(id=>codeByCompany.get(id)).filter(Number.isInteger)),excluded=new Set(filter.excluded.map(id=>codeByCompany.get(id)).filter(Number.isInteger));
    const visible=new Uint32Array(owners.length);let count=0;
    for(let index=0;index<owners.length;index++){
      const code=owners[index];if(code===0||knownCodes[code]!==1)continue;
      if(filter.mode==='include'?!included.has(code):excluded.has(code))continue;
      visible[count++]=index;
    }
    return visible.slice(0,count);
  }
  function create(options={}){
    let worker=null,disabled=false,generation=0,nextRequestId=0,source=null,pending=null,cache=null;
    const timeoutMs=Math.max(250,Number(options.timeoutMs)||3000),workerFactory=options.workerFactory;
    const clearPending=()=>{if(pending?.timer)clearTimeout(pending.timer);pending=null;};
    function disable(error){
      disabled=true;clearPending();cache=null;
      try{worker?.terminate?.();}catch{}
      worker=null;
      try{options.onFailure?.(error instanceof Error?error:new Error(String(error||'map-worker-failed')));}catch{}
    }
    function handleMessage(event){
      const message=event?.data||{};
      if(message.type==='error'){disable(new Error(String(message.error||'map-worker-error')));return;}
      if(message.type!=='result'||!pending||message.requestId!==pending.requestId||message.generation!==pending.generation)return;
      if(!(message.indices instanceof Uint32Array)||message.indices.length>source?.length||message.filterKey!==pending.key){disable(new Error('map-worker-result-invalid'));return;}
      let previous=-1;for(const index of message.indices){if(index>=source.length||index<=previous){disable(new Error('map-worker-result-order-invalid'));return;}previous=index;}
      const completed=pending;clearPending();cache={generation:message.generation,key:completed.key,indices:message.indices};
      source.fallbacks.clear();
      try{options.onResult?.({generation:cache.generation,revision:source.revision,assets:source.assets,filterKey:cache.key,indices:cache.indices});}catch{}
    }
    function ensureWorker(){
      if(disabled||worker)return worker;
      try{
        if(typeof workerFactory!=='function')throw new Error('map-worker-unavailable');
        worker=workerFactory();if(!worker||typeof worker.postMessage!=='function')throw new Error('map-worker-invalid');
        worker.onmessage=handleMessage;worker.onerror=event=>disable(event?.error||new Error(event?.message||'map-worker-error'));
        worker.onmessageerror=()=>disable(new Error('map-worker-message-error'));
        return worker;
      }catch(error){disable(error);return null;}
    }
    function request(input={}){
      const assets=input.assets,revision=Number(input.revision)||0,filter=normalizeFilter(input.filter),key=filterKey(filter);
      if(!Array.isArray(assets))return {indices:null,ready:false,worker:false,reason:'assets-invalid'};
      if(!source||source.assets!==assets||source.revision!==revision||source.length!==assets.length){
        clearPending();cache=null;generation++;
        let snapshot;
        try{snapshot=buildOwnershipIndex(assets,{ownerOf:input.ownerOf,isKnownOwner:input.isKnownOwner});}
        catch(error){disable(error);return {indices:null,ready:false,worker:false,reason:'snapshot-invalid'};}
        source={assets,revision,length:assets.length,generation,snapshot,fallbacks:new Map(),workerIndexed:false};
      }
      let active=ensureWorker();
      if(active&&!source.workerIndexed){try{const ownerCodes=source.snapshot.ownerCodes.slice(),knownCodes=source.snapshot.knownCodes.slice();active.postMessage({type:'index',generation,ownerCodes,companyIds:source.snapshot.companyIds,knownCodes},[ownerCodes.buffer,knownCodes.buffer]);source.workerIndexed=true;}catch(error){disable(error);active=null;}}
      const allVisible=source.snapshot.allKnown&&filter.mode==='all'&&!filter.included.length&&!filter.excluded.length;
      if(allVisible)return {indices:null,allVisible:true,ready:true,worker:!!active,generation};
      if(cache?.generation===generation&&cache.key===key)return {indices:cache.indices,ready:true,worker:true,generation};
      let fallbackIndices=source.fallbacks.get(key);
      if(!fallbackIndices){try{fallbackIndices=filterVisibleIndices(source.snapshot,filter);source.fallbacks.set(key,fallbackIndices);}catch(error){disable(error);return {indices:null,ready:false,worker:false,reason:'fallback-index-invalid'};}}
      if(!active)return {indices:fallbackIndices,ready:true,worker:false,generation};
      if(pending?.generation===generation&&pending.key===key)return {indices:fallbackIndices,ready:false,worker:true,pending:true,generation};
      clearPending();const requestId=++nextRequestId,request={requestId,generation,key,timer:null};pending=request;
      request.timer=setTimeout(()=>disable(new Error('map-worker-timeout')),timeoutMs);
      try{active.postMessage({type:'query',requestId,generation,filter});}
      catch(error){disable(error);return {indices:fallbackIndices,ready:true,worker:false,reason:'query-post-failed',generation};}
      return {indices:fallbackIndices,ready:false,worker:true,pending:true,generation};
    }
    return Object.freeze({request,disable:()=>disable(new Error('map-worker-disabled')),isDisabled:()=>disabled,version:VERSION});
  }
  return Object.freeze({VERSION,normalizeFilter,filterKey,buildOwnershipIndex,filterVisibleIndices,create});
});
