'use strict';

importScripts('determinism-core.js','route-core.js','map-provider-core.js','road-planner.js','road-planner-worker-core.js');

const controllers=new Map();
self.addEventListener('message',event=>{
  const message=event?.data||{};
  if(message.type==='cancel'){
    controllers.get(message.requestId)?.abort();
    return;
  }
  if(message.type!=='plan'||!Number.isSafeInteger(message.requestId))return;
  const controller=new AbortController();controllers.set(message.requestId,controller);
  self.GH_ROAD_PLANNER_WORKER_CORE.plan(message.input,{signal:controller.signal,onProgress:(done,total)=>self.postMessage({type:'progress',requestId:message.requestId,done,total})})
    .then(plan=>{if(!controller.signal.aborted)self.postMessage({type:'result',requestId:message.requestId,plan});})
    .catch(error=>{if(!controller.signal.aborted)self.postMessage({type:'error',requestId:message.requestId,error:String(error?.message||error)});})
    .finally(()=>controllers.delete(message.requestId));
});
