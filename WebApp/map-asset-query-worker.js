'use strict';

importScripts('map-asset-query-core.js');

let activeIndex=null;
self.addEventListener('message',event=>{
  const message=event?.data||{};
  try{
    if(message.type==='index'){
      if(!Number.isSafeInteger(message.generation)||message.generation<1||!(message.ownerCodes instanceof Uint32Array)||!Array.isArray(message.companyIds)||!(message.knownCodes instanceof Uint8Array)||message.knownCodes.length!==message.companyIds.length||message.ownerCodes.length>200000)throw new Error('map-worker-index-invalid');
      activeIndex={generation:message.generation,ownerCodes:message.ownerCodes,companyIds:message.companyIds,knownCodes:message.knownCodes};return;
    }
    if(message.type==='query'){
      if(!activeIndex||message.generation!==activeIndex.generation||!Number.isSafeInteger(message.requestId))throw new Error('map-worker-generation-mismatch');
      const indices=self.GH_MAP_ASSET_QUERY_CORE.filterVisibleIndices(activeIndex,message.filter);
      self.postMessage({type:'result',requestId:message.requestId,generation:message.generation,filterKey:self.GH_MAP_ASSET_QUERY_CORE.filterKey(message.filter),indices},[indices.buffer]);
    }
  }catch(error){
    self.postMessage({type:'error',requestId:message.requestId||0,generation:message.generation||0,error:String(error?.message||error)});
  }
});
