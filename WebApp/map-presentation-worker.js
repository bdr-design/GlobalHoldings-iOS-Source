'use strict';

importScripts('map-presentation-core.js');

let active=null;
self.addEventListener('message',event=>{
  const message=event?.data||{};
  try{
    if(message.type==='plan'){
      if(!Number.isSafeInteger(message.generation)||message.generation<1||!Number.isSafeInteger(message.requestId)||typeof message.key!=='string'||message.key.length>200||message.assetIds?.length>200000)throw new Error('map-presentation-plan-invalid');
      const result=self.GH_MAP_PRESENTATION_CORE.buildPlan(message);
      active={generation:message.generation,key:message.key,assetCount:message.assetIds.length,routeIndexes:message.routeIndexes,baseCoordinates:message.baseCoordinates,routes:message.routes,members:result.members.slice(),groups:result.groups};
      self.postMessage({type:'plan-result',requestId:message.requestId,generation:message.generation,key:message.key,version:result.version,assetCount:result.assetCount,heroIndices:result.heroIndices,members:result.members,groups:result.groups},[result.heroIndices.buffer,result.members.buffer]);
      return;
    }
    if(message.type==='positions'){
      if(!active||message.generation!==active.generation||!Number.isSafeInteger(message.requestId))throw new Error('map-presentation-generation-mismatch');
      const centers=self.GH_MAP_PRESENTATION_CORE.updateGroupCenters(active,message.progress);
      self.postMessage({type:'positions-result',requestId:message.requestId,generation:message.generation,groups:centers});
    }
  }catch(error){self.postMessage({type:'error',requestId:message.requestId||0,generation:message.generation||0,error:String(error?.message||error)});}
});
