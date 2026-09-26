'use strict';

importScripts('simulation-asset-core.js');

const CORE=self.GH_SIMULATION_ASSET_CORE,WORKER_VERSION='GH-SIMULATION-ASSET-WORKER-340.1.0',PUMP_SIZE=32;
const tasks=new Map();
function fail(requestId,error){self.postMessage({type:'error',requestId,version:WORKER_VERSION,error:String(error?.message||error||'simulation-asset-worker-error')});}
self.addEventListener('message',event=>{
  const message=event?.data||{};
  if(message.type==='cancel'){
    const task=tasks.get(message.requestId);if(task)task.cancelled=true;
    return;
  }
  if(message.type!=='process')return;
  if(tasks.size>=1){fail(message.requestId,'simulation-asset-worker-busy');return;}
  try{CORE.validateBatch(message);}catch(error){fail(message.requestId,error);return;}
  const task={requestId:message.requestId,input:message,cursor:0,records:[],cancelled:false};tasks.set(task.requestId,task);
  const pump=()=>{
    if(tasks.get(task.requestId)!==task||task.cancelled){tasks.delete(task.requestId);return;}
    try{
      const end=Math.min(task.input.rows.length,task.cursor+PUMP_SIZE);
      for(;task.cursor<end;task.cursor++)task.records.push(CORE.processRow(task.input.rows[task.cursor],task.input));
      if(task.cursor<task.input.rows.length){setTimeout(pump,0);return;}
      if(CORE.validateResults(task.input.rows,task.records))self.postMessage({type:'result',requestId:task.requestId,version:WORKER_VERSION,coreVersion:CORE.VERSION,records:task.records});
      else fail(task.requestId,'simulation-asset-worker-result-invalid');
      tasks.delete(task.requestId);
    }catch(error){tasks.delete(task.requestId);fail(task.requestId,error);}
  };
  setTimeout(pump,0);
});
