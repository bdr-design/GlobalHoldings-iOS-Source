'use strict';

importScripts('air-sea-network-core.js');

self.addEventListener('message',event=>{
  const message=event?.data||{};
  if(!['plan','rank-destinations','distance-index'].includes(message.type)||!Number.isSafeInteger(message.requestId))return;
  try{
    const core=self.GH_AIR_SEA_NETWORK_CORE,plan=message.type==='plan'?core.plan(message.input):message.type==='distance-index'?core.rankWorldDistances(message.input):core.rankDestinations(message.input);
    self.postMessage({type:'result',requestId:message.requestId,version:self.GH_AIR_SEA_NETWORK_CORE.VERSION,plan});
  }catch(error){
    self.postMessage({type:'error',requestId:message.requestId,error:String(error?.message||error)});
  }
});
