((root,factory)=>{
  const api=factory(root?.GH_KERNEL||null);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_KERNEL_WORKER=api;
})(typeof globalThis!=='undefined'?globalThis:this,(GH_KERNEL)=>{
  'use strict';
  const VERSION='GH-KERNEL-WORKER-1.0.0',PROTOCOL='gh-kernel-message-v1';
  const clone=value=>typeof globalThis.structuredClone==='function'?globalThis.structuredClone(value):JSON.parse(JSON.stringify(value));
  function createHost(kernelFactory=GH_KERNEL){
    if(!kernelFactory?.fromLegacyState)throw new Error('kernel-worker-core-unavailable');
    let kernel=null,requestSequence=0;const requestCache=new Map(),idempotency=new Map();
    const remember=(key,fingerprint,value)=>{requestCache.set(key,{fingerprint,message:clone(value)});while(requestCache.size>512)requestCache.delete(requestCache.keys().next().value);};
    function response(request,body,transfer=[]){return {message:{protocol:PROTOCOL,requestId:request.requestId,ok:true,...body},transfer};}
    function fail(request,error){return {message:{protocol:PROTOCOL,requestId:request?.requestId||'',ok:false,error:String(error?.message||error).slice(0,240),code:String(error?.code||'KERNEL_WORKER_ERROR')},transfer:[]};}
    function applyOperation(writer,operation){
      if(!operation||typeof operation!=='object')throw new TypeError('kernel-worker-operation-invalid');
      if(operation.type==='set')return writer.set(operation.section,operation.value);
      if(operation.type==='append')return writer.append(operation.section,operation.value);
      if(operation.type==='column-set')return writer.col(operation.section,operation.column).set(operation.index,operation.value);
      if(operation.type==='row-patch')return writer.updateRow(operation.section,operation.index,operation.value);
      if(operation.type==='ledger-post')return writer.post(operation.section,operation.value);
      throw new Error(`kernel-worker-operation-unsupported:${String(operation.type)}`);
    }
    function handle(request){
      if(!request||request.protocol!==PROTOCOL||typeof request.requestId!=='string'||!request.requestId||request.requestId.length>128)return fail(request,new Error('kernel-worker-message-invalid'));
      const cacheable=request.type!=='frame';
      try{
        const requestFingerprint=cacheable?kernelFactory.fingerprint(request):null,cached=cacheable?requestCache.get(request.requestId):null;
        if(cached){if(cached.fingerprint!==requestFingerprint)throw new Error('kernel-worker-request-id-conflict');return {message:clone(cached.message),transfer:[]};}
        if(request.type==='init'){
          if(kernel)throw new Error('kernel-worker-already-initialized');
          kernel=kernelFactory.fromLegacyState(request.state,request.contracts,{schemaVersion:'2.0.0'});const body={schemaVersion:kernel.schemaVersion,sections:kernel.contracts().map(section=>({name:section.name,revision:kernel.revision(section.name)})),initialized:true};const result=response(request,body);remember(request.requestId,requestFingerprint,result.message);return result;
        }
        if(!kernel)throw new Error('kernel-worker-not-initialized');
        if(request.type==='command'){
          if(!Array.isArray(request.operations)||request.operations.length>10000)throw new Error('kernel-worker-command-invalid');
          const idempotencyKey=String(request.idempotencyKey||'').trim();if(!idempotencyKey||idempotencyKey.length>200)throw new Error('kernel-worker-idempotency-key-required');
          const payload={owner:request.owner,writes:request.writes,reads:request.reads||{},operations:request.operations},fingerprint=kernelFactory.fingerprint(payload),prior=idempotency.get(idempotencyKey);
          if(prior){if(prior.fingerprint!==fingerprint)throw new Error('kernel-worker-idempotency-conflict');const result=response(request,{...clone(prior.result),idempotent:true});remember(request.requestId,requestFingerprint,result.message);return result;}
          const result=kernel.tx({label:String(request.label||'worker-command'),owner:String(request.owner||''),owners:request.owners,writes:request.writes,reads:request.reads||{}},writer=>request.operations.map(operation=>applyOperation(writer,operation)));
          const body={committed:true,revision:result.revision,dirty:result.dirty,sectionRevisions:result.sectionRevisions,undoRecords:result.undoRecords,ms:result.ms,fingerprints:Object.fromEntries(result.dirty.map(name=>[name,kernel.fingerprint(name)]))};idempotency.set(idempotencyKey,{fingerprint,result:body});while(idempotency.size>512)idempotency.delete(idempotency.keys().next().value);
          const out=response(request,body);remember(request.requestId,requestFingerprint,out.message);return out;
        }
        if(request.type==='query'){
          const section=String(request.section||'');const revision=kernel.revision(section);if(revision==null)throw new Error(`kernel-section-unregistered:${section}`);
          const body={section,revision,fingerprint:kernel.fingerprint(section)};if(request.includeValue===true)body.value=kernel.read(section);const out=response(request,body);remember(request.requestId,requestFingerprint,out.message);return out;
        }
        if(request.type==='frame'){
          const generation=Number(request.generation);if(!Number.isSafeInteger(generation)||generation<0)throw new Error('kernel-worker-frame-generation-invalid');
          const south=Number(request.viewport?.south),north=Number(request.viewport?.north),west=Number(request.viewport?.west),east=Number(request.viewport?.east);
          if(![south,north,west,east].every(Number.isFinite)||south>north||west>east)throw new Error('kernel-worker-frame-viewport-invalid');
          const lat=kernel.columnSnapshot(request.section||'assets',request.latitudeColumn||'lat'),lng=kernel.columnSnapshot(request.section||'assets',request.longitudeColumn||'lng'),indices=[];
          for(let i=0;i<lat.data.length;i++)if(lat.presence[i]===2&&lng.presence[i]===2&&lat.data[i]>=south&&lat.data[i]<=north&&lng.data[i]>=west&&lng.data[i]<=east)indices.push(i);
          const indexBuffer=Uint32Array.from(indices),coordinates=new Float64Array(indices.length*2);for(let i=0;i<indices.length;i++){coordinates[i*2]=lat.data[indices[i]];coordinates[i*2+1]=lng.data[indices[i]];}
          const out=response(request,{generation,indices:indexBuffer,coordinates},[indexBuffer.buffer,coordinates.buffer]);return out;
        }
        throw new Error(`kernel-worker-message-type-unsupported:${String(request.type)}`);
      }catch(error){return fail(request,error);}
    }
    return Object.freeze({VERSION,PROTOCOL,handle,snapshot:()=>kernel?.snapshot()||null,legacyState:()=>kernel?.legacyState()||null,metrics:()=>({initialized:!!kernel,typedArrayBytes:kernel?.typedArrayBytes?.()||0,sectionCount:kernel?.contracts?.().length||0})});
  }
  function createClient(worker,options={}){
    if(!worker||typeof worker.postMessage!=='function'||typeof worker.addEventListener!=='function')throw new TypeError('kernel-worker-transport-required');
    const timeoutMs=Math.max(100,Number(options.timeoutMs)||5000),pending=new Map();let nextId=0,closed=false,latestFrameGeneration=-1;
    const onMessage=event=>{const message=event?.data;if(message?.protocol!==PROTOCOL||typeof message.requestId!=='string')return;const task=pending.get(message.requestId);if(!task)return;pending.delete(message.requestId);clearTimeout(task.timer);if(!message.ok){const error=new Error(message.error||'kernel-worker-request-failed');error.code=message.code||'KERNEL_WORKER_ERROR';task.reject(error);return;}if(task.type==='frame'&&task.generation<latestFrameGeneration){task.reject(new Error('kernel-worker-stale-frame'));return;}task.resolve(message);};
    worker.addEventListener('message',onMessage);
    function request(type,body={},transfer=[]){if(closed)return Promise.reject(new Error('kernel-worker-client-closed'));if(pending.size>=256)return Promise.reject(new Error('kernel-worker-pending-limit'));const requestId=`KWR-${++nextId}`,generation=type==='frame'?Number(body.generation):-1;if(type==='frame'&&generation>latestFrameGeneration)latestFrameGeneration=generation;const message={protocol:PROTOCOL,requestId,type,...body};return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);const error=new Error(`kernel-worker-timeout:${type}`);error.code='KERNEL_WORKER_TIMEOUT';reject(error);},timeoutMs);pending.set(requestId,{type,generation,timer,resolve,reject});try{worker.postMessage(message,transfer);}catch(error){clearTimeout(timer);pending.delete(requestId);reject(error);}});}
    function close(){if(closed)return;closed=true;worker.removeEventListener?.('message',onMessage);for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error('kernel-worker-client-closed'));}pending.clear();}
    return Object.freeze({initialize:(state,contracts)=>request('init',{state,contracts}),command:command=>request('command',command),query:query=>request('query',query),frame:frame=>request('frame',frame),close,pending:()=>pending.size});
  }
  return Object.freeze({VERSION,PROTOCOL,createHost,createClient});
});
