'use strict';

importScripts('kernel-core.js','simulation-asset-core.js');

const CORE=self.GH_SIMULATION_ASSET_CORE,KERNEL=self.GH_KERNEL;
const WORKER_VERSION='GH-SIMULATION-ASSET-WORKER-340.1.0',PUMP_SIZE=32;
const ASSET_CONTRACT=[{name:'assets',path:'assets',owner:'simulation-asset',kind:'columns',columns:{
  progress:'f64',fuel:'f64',condition:'f64',dwellRemaining:'f64',simCarrySeconds:'f64',tripSeconds:'f64',effectiveSpeedKmh:'f64',lat:'f64',lng:'f64'
}}];
const tasks=new Map(),pendingCommits=new Map();
let kernel=null,assetCount=0,initialization=null;

function fail(requestId,error){self.postMessage({type:'error',requestId,version:WORKER_VERSION,error:String(error?.message||error||'simulation-asset-worker-error')});}
function initialize(message){
  if(!Array.isArray(message.assets)||message.assets.length>50000)throw new Error('simulation-asset-kernel-bootstrap-invalid');
  kernel=KERNEL.fromLegacyState({assets:message.assets},[{...ASSET_CONTRACT[0]}]);
  assetCount=message.assets.length;
  initialization=null;
  self.postMessage({type:'initialized',requestId:message.requestId,version:WORKER_VERSION,assets:assetCount,typedArrayBytes:kernel.typedArrayBytes(),fingerprint:kernel.incrementalFingerprint('assets')});
}
function beginInitialization(message){
  if(tasks.size||!Number.isSafeInteger(message.assetCount)||message.assetCount<0||message.assetCount>50000)throw new Error('simulation-asset-kernel-bootstrap-invalid');
  kernel=null;assetCount=0;pendingCommits.clear();initialization={requestId:message.requestId,expected:message.assetCount,cursor:0,assets:new Array(message.assetCount)};
}
function appendInitializationChunk(message){
  const init=initialization,offset=Number(message.offset);
  if(!init||message.requestId!==init.requestId||!Number.isSafeInteger(offset)||offset!==init.cursor||!Array.isArray(message.assets)||message.assets.length<1||offset+message.assets.length>init.expected)throw new Error('simulation-asset-kernel-bootstrap-chunk-invalid');
  for(let index=0;index<message.assets.length;index++)init.assets[offset+index]=message.assets[index];
  init.cursor+=message.assets.length;
}
function hydrateKernelInput(message){
  if(!kernel)throw new Error('simulation-asset-kernel-not-initialized');
  kernel.tx({label:`worker-simulation-input:${message.requestId}`,owner:'simulation-asset',writes:['assets']},writer=>{
    for(const row of message.rows){const index=Number(row.assetIndex),current=kernel.readRow('assets',index);if(current?.id!==row.id||KERNEL.firstDifference(current,row.asset)!==null)writer.replaceRow('assets',index,row.asset);}
  });
  return {...message,rows:message.rows.map(row=>({...row,asset:kernel.readRow('assets',Number(row.assetIndex))}))};
}
function commitResults(input,records){
  if(!kernel)throw new Error('simulation-asset-kernel-not-initialized');
  if(Number(input.assetCount)!==assetCount)throw new Error('simulation-asset-kernel-count-conflict');
  if(pendingCommits.has(input.requestId))throw new Error('simulation-asset-worker-request-duplicate');
  const preimages=input.rows.map(row=>({index:Number(row.assetIndex),asset:row.asset}));
  const result=kernel.tx({label:`worker-simulation:${input.simMeta.from}->${input.simMeta.to}`,owner:'simulation-asset',writes:['assets']},writer=>{
    for(let index=0;index<input.rows.length;index++){
      const row=input.rows[index],assetIndex=Number(row.assetIndex),record=records[index];
      if(!Number.isSafeInteger(assetIndex)||assetIndex<0||assetIndex>=assetCount||record?.id!==row.id)throw new Error('simulation-asset-kernel-index-invalid');
      const current=kernel.readRow('assets',assetIndex);
      if(current?.id!==row.id)throw new Error(`simulation-asset-kernel-order-conflict:${assetIndex}`);
      const baseline=current,delta={};
      for(const field of CORE.WRITE_FIELDS){const before=Object.prototype.hasOwnProperty.call(baseline,field),after=Object.prototype.hasOwnProperty.call(record.patch,field);if(before!==after||KERNEL.firstDifference(baseline[field],record.patch[field])!==null)delta[field]=record.patch[field];}
      if(Object.keys(delta).length)writer.updateRow('assets',assetIndex,delta);
    }
  });
  pendingCommits.set(input.requestId,preimages);
  const committedRecords=records.map((record,index)=>{
    const current=kernel.readRow('assets',Number(input.rows[index].assetIndex)),patch={};
    for(const field of CORE.WRITE_FIELDS)patch[field]=current[field];
    return {...record,patch};
  });
  return {revision:kernel.revision('assets'),fingerprint:kernel.incrementalFingerprint('assets'),typedArrayBytes:kernel.typedArrayBytes(),commitMs:result.ms,records:committedRecords};
}
function settle(message){
  if(!kernel||!Array.isArray(message.requestIds)||message.requestIds.length>1000)throw new Error('simulation-asset-worker-settlement-invalid');
  const ids=[...new Set(message.requestIds)];
  if(message.type==='rollback'){
    const restored=[];
    for(const id of ids){const rows=pendingCommits.get(id);if(!rows)continue;
      kernel.tx({label:`worker-simulation-rollback:${id}`,owner:'simulation-asset',writes:['assets']},writer=>{for(const row of rows)writer.replaceRow('assets',row.index,row.asset);});
      pendingCommits.delete(id);restored.push(id);
    }
    self.postMessage({type:'settled',requestId:message.requestId,status:'rolled-back',requestIds:restored,pendingTransactions:pendingCommits.size,kernelState:{revision:kernel.revision('assets'),fingerprint:kernel.incrementalFingerprint('assets'),typedArrayBytes:kernel.typedArrayBytes()}});return;
  }
  if(message.type==='confirm'){
    for(const id of ids)pendingCommits.delete(id);
    self.postMessage({type:'settled',requestId:message.requestId,status:'confirmed',requestIds:ids,pendingTransactions:pendingCommits.size,kernelState:{revision:kernel.revision('assets'),fingerprint:kernel.incrementalFingerprint('assets'),typedArrayBytes:kernel.typedArrayBytes()}});return;
  }
  throw new Error('simulation-asset-worker-settlement-unsupported');
}

self.addEventListener('message',event=>{
  const message=event?.data||{};
  if(message.type==='cancel'){
    const task=tasks.get(message.requestId);if(task)task.cancelled=true;
    return;
  }
  if(message.type==='init'){
    if(tasks.size){fail(message.requestId,'simulation-asset-worker-busy');return;}
    try{initialize(message);pendingCommits.clear();}catch(error){kernel=null;assetCount=0;pendingCommits.clear();fail(message.requestId,error);}
    return;
  }
  if(message.type==='init-start'){
    try{beginInitialization(message);}catch(error){initialization=null;kernel=null;assetCount=0;fail(message.requestId,error);}return;
  }
  if(message.type==='init-chunk'){
    try{appendInitializationChunk(message);}catch(error){initialization=null;kernel=null;assetCount=0;fail(message.requestId,error);}return;
  }
  if(message.type==='init-end'){
    try{if(!initialization||initialization.cursor!==initialization.expected||Number(message.assetCount)!==initialization.expected)throw new Error('simulation-asset-kernel-bootstrap-incomplete');initialize({requestId:message.requestId,assets:initialization.assets});pendingCommits.clear();}
    catch(error){initialization=null;kernel=null;assetCount=0;pendingCommits.clear();fail(message.requestId,error);}return;
  }
  if(message.type==='confirm'||message.type==='rollback'){
    try{settle(message);}catch(error){fail(message.requestId,error);}
    return;
  }
  if(message.type!=='process')return;
  if(tasks.size>=1){fail(message.requestId,'simulation-asset-worker-busy');return;}
  if(!kernel){fail(message.requestId,'simulation-asset-kernel-not-initialized');return;}
  try{
    CORE.validateBatch(message);
    if(Number(message.assetCount)!==assetCount)throw new Error('simulation-asset-kernel-count-conflict');
    for(const row of message.rows)if(!Number.isSafeInteger(Number(row.assetIndex))||Number(row.assetIndex)<0||Number(row.assetIndex)>=assetCount)throw new Error('simulation-asset-kernel-index-invalid');
  }catch(error){fail(message.requestId,error);return;}
  let input;try{input=hydrateKernelInput(message);CORE.validateBatch(input);}catch(error){fail(message.requestId,error);return;}
  const task={requestId:message.requestId,input,cursor:0,records:[],cancelled:false};tasks.set(task.requestId,task);
  const pump=()=>{
    if(tasks.get(task.requestId)!==task||task.cancelled){tasks.delete(task.requestId);return;}
    try{
      const end=Math.min(task.input.rows.length,task.cursor+PUMP_SIZE);
      for(;task.cursor<end;task.cursor++)task.records.push(CORE.processRow(task.input.rows[task.cursor],task.input));
      if(task.cursor<task.input.rows.length){setTimeout(pump,0);return;}
      if(!CORE.validateResults(task.input.rows,task.records))throw new Error('simulation-asset-worker-result-invalid');
      const kernelState=commitResults(task.input,task.records);
      self.postMessage({type:'result',requestId:task.requestId,version:WORKER_VERSION,coreVersion:CORE.VERSION,records:kernelState.records,kernelState});
      tasks.delete(task.requestId);
    }catch(error){tasks.delete(task.requestId);fail(task.requestId,error);}
  };
  setTimeout(pump,0);
});
