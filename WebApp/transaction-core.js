(()=>{
  'use strict';
  const VERSION='3.0.0';
  let activeContext=null,durableSequence=0;
  const targetRevisions=new WeakMap();
  const targetSectionRevisions=new WeakMap();
  const durableTargets=new WeakSet();
  const kernelShadows=new WeakMap();
  const kernelOwners=new WeakMap();
  const runtimeTelemetry={last:null,lastSimulation:null,samples:[],profiledSamples:[],profiledCount:0};
  const runtimeClock=()=>globalThis.performance?.now?.()??Date.now();
  function publishRuntimeMetric(row){
    const metric={...row,recordedAtMs:Date.now()};
    runtimeTelemetry.last=metric;
    if(String(metric.label||'').startsWith('simulation:'))runtimeTelemetry.lastSimulation=metric;
    runtimeTelemetry.samples.push(metric);
    if(runtimeTelemetry.samples.length>24)runtimeTelemetry.samples.shift();
    if(metric.profiled===true){
      runtimeTelemetry.profiledCount++;
      runtimeTelemetry.profiledSamples.push(metric);
      runtimeTelemetry.profiledSamples.sort((a,b)=>(Number(b.totalMs)||0)-(Number(a.totalMs)||0));
      if(runtimeTelemetry.profiledSamples.length>24)runtimeTelemetry.profiledSamples.length=24;
    }
    return metric;
  }
  function compactProfileContext(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const out={};let count=0;
    for(const [key,item] of Object.entries(value)){
      if(count++>=24)break;
      if(item===null||typeof item==='string'||typeof item==='boolean'||(typeof item==='number'&&Number.isFinite(item)))out[String(key).slice(0,64)]=typeof item==='string'?item.slice(0,120):item;
    }
    return out;
  }
  function jsonClone(value){if(value===undefined)return undefined;return JSON.parse(JSON.stringify(value));}
  function deepClone(value){if(typeof globalThis.structuredClone==='function'){try{return globalThis.structuredClone(value);}catch(_error){}}return jsonClone(value);}
  function restoreValue(target,snapshot){
    if(target&&typeof target==='object'&&Object.isFrozen(target))return deepClone(snapshot);
    if(Array.isArray(snapshot)){
      if(!Array.isArray(target))return deepClone(snapshot);
      const oldLength=target.length,existing=new Map(Array.from({length:oldLength},(_,index)=>[index,target[index]]));
      for(let i=0;i<snapshot.length;i++){const sv=snapshot[i],tv=existing.get(i);target[i]=sv&&typeof sv==='object'?restoreValue(tv,sv):sv;}
      for(let i=snapshot.length;i<oldLength;i++)delete target[i];target.length=snapshot.length;return target;
    }
    if(snapshot&&typeof snapshot==='object'){
      if(!target||typeof target!=='object'||Array.isArray(target))target={};
      const keys=new Set(Object.keys(snapshot)),existing=new Map(Object.keys(target).map(key=>[key,target[key]]));
      for(const [key,sv] of Object.entries(snapshot)){const tv=existing.get(key);target[key]=sv&&typeof sv==='object'?restoreValue(tv,sv):sv;}
      for(const key of Object.keys(target))if(!keys.has(key))delete target[key];return target;
    }
    return snapshot;
  }
  function restoreObjectCore(target,snapshot){if(!target||typeof target!=='object'||Array.isArray(target))throw new TypeError('Transaction target must be an object');if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new TypeError('Transaction snapshot must be an object');return restoreValue(target,snapshot);}
  function restoreObject(target,snapshot){
    const owner=kernelOwners.get(target);if(!owner||owner.transactionDepth>0)return restoreObjectCore(target,snapshot);
    const result=owner.kernel.tx({label:'state-owner:atomic-replace',owner:'transaction-core',writes:owner.kernel.sectionNames()},()=>{
      owner.transactionDepth++;
      try{
        // Keep registered root sections alive while nested values are restored.
        // Clearing the proxy root first unregisters each path from the live view,
        // so later writes cannot resolve their parent and rollback loses them.
        for(const key of Object.keys(snapshot)){
          if(['__proto__','constructor','prototype'].includes(key))throw new Error(`transaction-root-key-invalid:${key}`);
          const value=snapshot[key];
          const current=target[key];
          if(value&&typeof value==='object'&&current&&typeof current==='object'&&Array.isArray(value)===Array.isArray(current))restoreValue(current,value);
          else target[key]=deepClone(value);
        }
        for(const key of Object.keys(target))if(!Object.prototype.hasOwnProperty.call(snapshot,key))delete target[key];
        return target;
      }finally{owner.transactionDepth--;}
    });
    owner.transactions++;owner.lastCommit={label:'state-owner:atomic-replace',revision:result.revision,undoRecords:result.undoRecords,ms:result.ms,dirty:result.dirty};advanceSectionRevisions(target,result.dirty.length?result.dirty:['*']);advanceRevision(target);return target;
  }
  function sameOrder(keys,expected){return keys.length===expected.length&&keys.every((key,index)=>key===expected[index]);}
  function restoreRootOrder(target,rootOrder){
    if(!Array.isArray(rootOrder)||!rootOrder.length)return target;
    const current=Object.keys(target);if(sameOrder(current,rootOrder))return target;
    const descriptors=Object.getOwnPropertyDescriptors(target),ordered=[...rootOrder.filter(key=>Object.prototype.hasOwnProperty.call(descriptors,key)),...current.filter(key=>!rootOrder.includes(key))];
    for(const key of current){const descriptor=descriptors[key];if(descriptor?.configurable===false)throw new Error(`transaction-root-order-nonconfigurable:${key}`);delete target[key];}
    for(const key of ordered)Object.defineProperty(target,key,descriptors[key]);
    return target;
  }
  function isActive(){return !!activeContext;}
  function revision(target){return target&&typeof target==='object'?targetRevisions.get(target)||0:0;}
  function advanceRevision(target){const next=revision(target)>=Number.MAX_SAFE_INTEGER?1:revision(target)+1;targetRevisions.set(target,next);return next;}
  function sectionRevision(target,name){if(!target||typeof target!=='object')return 0;return targetSectionRevisions.get(target)?.get(String(name||'*'))||0;}
  function advanceSectionRevisions(target,names){if(!target||typeof target!=='object')return;let revisions=targetSectionRevisions.get(target);if(!revisions){revisions=new Map();targetSectionRevisions.set(target,revisions);}for(const name of new Set((names||['*']).map(String))){const current=revisions.get(name)||0;revisions.set(name,current>=Number.MAX_SAFE_INTEGER?1:current+1);}}
  function registerShadowRoot(shadow,name){if(shadow.registered.has(name))return;shadow.kernel.register(name,{owner:'transaction-core',kind:'object',path:[name]});shadow.registered.add(name);}
  function shadowCompare(target,shadow){const result=shadow.kernel.compareLegacy(target);shadow.checks++;shadow.last={ok:result.ok,path:result.path||null,fingerprints:result.fingerprints,checkedAt:Date.now()};if(!result.ok){const error=new Error(`state-kernel-shadow-mismatch:${result.path||'$'}`);error.code='STATE_KERNEL_SHADOW_MISMATCH';error.path=result.path;throw error;}return result;}
  function shadowSync(target,roots,label='transaction'){
    const shadow=kernelShadows.get(target);if(!shadow)return null;
    const names=[...new Set((roots||[]).map(String))];for(const name of names)registerShadowRoot(shadow,name);
    if(!names.length)return shadowCompare(target,shadow);
    try{
      const result=shadow.kernel.tx({label:String(label||'transaction'),actor:'transaction-core',writes:names},writer=>{
        for(const name of names){if(Object.prototype.hasOwnProperty.call(target,name))writer.set(name,target[name]);else writer.delete(name);}
        return shadowCompare(target,shadow);
      });
      shadow.revision=result.revision;return result;
    }catch(error){shadow.last={...(shadow.last||{}),ok:false,error:String(error?.message||error),checkedAt:Date.now()};throw error;}
  }
  function reconcileKernelShadow(target){
    const shadow=kernelShadows.get(target);if(!shadow)return true;
    try{
      const names=new Set([...shadow.registered,...Object.keys(target)]);shadowSync(target,[...names],'rollback-reconcile');return true;
    }catch(error){shadow.enabled=false;shadow.last={...(shadow.last||{}),ok:false,detached:true,error:String(error?.message||error),checkedAt:Date.now()};return false;}
  }
  function enableKernelShadow(target){
    if(!target||typeof target!=='object'||Array.isArray(target))throw new TypeError('kernel-shadow-target-required');
    if(kernelShadows.has(target))return kernelShadowStatus(target);
    const factory=globalThis.GH_KERNEL;if(!factory?.create)throw new Error('state-kernel-unavailable');
    const kernel=factory.create({schemaVersion:'2.0.0',legacyState:target}),shadow={kernel,registered:new Set(),checks:0,revision:0,last:null,enabled:true};
    kernelShadows.set(target,shadow);for(const name of Object.keys(target))registerShadowRoot(shadow,name);
    kernel.releaseRegisteredBase();
    const result=kernel.compareLegacy(target);shadow.last={ok:result.ok,path:result.path||null,fingerprints:result.fingerprints,checkedAt:Date.now()};
    if(!result.ok){kernelShadows.delete(target);throw new Error(`state-kernel-shadow-bootstrap-mismatch:${result.path||'$'}`);}
    return kernelShadowStatus(target);
  }
  function enableKernelOwner(target){
    if(!target||typeof target!=='object'||Array.isArray(target))throw new TypeError('kernel-owner-target-required');
    if(kernelOwners.has(target))return target;
    const factory=globalThis.GH_KERNEL;if(!factory?.create)throw new Error('state-kernel-unavailable');
    const kernel=factory.create({schemaVersion:'2.0.0',legacyState:target});
    const assetColumns=Object.freeze({progress:'f64',fuel:'f64',condition:'f64',dwellRemaining:'f64',tripSeconds:'f64',simCarrySeconds:'f64',departureScheduledAt:'f64',distanceKm:'f64',effectiveSpeedKmh:'f64'});
    for(const name of Object.keys(target))if(!['__proto__','constructor','prototype'].includes(name)){
      if(name==='assets'&&Array.isArray(target.assets))kernel.register(name,{owner:'transaction-core',kind:'columns',path:[name],columns:assetColumns});
      else kernel.register(name,{owner:'transaction-core',kind:'object',path:[name]});
    }
    kernel.releaseRegisteredBase();const initial=kernel.compareLegacy(target);if(!initial.ok)throw new Error(`state-kernel-owner-bootstrap-mismatch:${initial.path||'$'}`);
    let state;const owner={kernel,transactionDepth:0,transactions:0,rollbacks:0,lastCommit:null};
    state=kernel.stateView({onCommit:result=>{owner.transactions++;owner.lastCommit={label:'state-view:single-write',revision:result.revision,undoRecords:result.undoRecords,ms:result.ms,dirty:result.dirty};advanceSectionRevisions(state,result.dirty.length?result.dirty:['*']);advanceRevision(state);}});
    kernelOwners.set(state,owner);targetRevisions.set(state,0);targetSectionRevisions.set(state,new Map());return state;
  }
  function kernelOwnerStatus(target){
    const owner=kernelOwners.get(target);if(!owner)return {enabled:false,sections:0,transactions:0,rollbacks:0,lastCommit:null};
    const columns=owner.kernel.contracts().filter(section=>section.kind==='columns');
    return {enabled:true,schemaVersion:owner.kernel.schemaVersion,sections:owner.kernel.sectionNames().length,columnSections:columns.map(section=>({name:section.name,fields:Object.keys(section.columns),...owner.kernel.columnStorageReport(section.name)})),typedArrayBytes:owner.kernel.typedArrayBytes(),transactions:owner.transactions,rollbacks:owner.rollbacks,revision:owner.kernel.revision(),lastCommit:owner.lastCommit?deepClone(owner.lastCommit):null};
  }
  function kernelOwnerState(target){const owner=kernelOwners.get(target);if(!owner)throw new Error('kernel-owner-not-enabled');return owner.kernel.legacyState();}
  function disableKernelShadow(target){const shadow=kernelShadows.get(target);if(!shadow)return false;shadow.enabled=false;kernelShadows.delete(target);return true;}
  function kernelShadowStatus(target){const shadow=kernelShadows.get(target);return shadow?{enabled:shadow.enabled,checks:shadow.checks,revision:shadow.revision,sections:shadow.registered.size,last:shadow.last?deepClone(shadow.last):null}: {enabled:false,checks:0,revision:0,sections:0,last:null};}
  function transactionMemo(key,factory){if(!activeContext)return typeof factory==='function'?factory():undefined;key=String(key||'');if(activeContext.memo.has(key))return activeContext.memo.get(key);const value=typeof factory==='function'?factory():factory;activeContext.memo.set(key,value);return value;}
  function transactionMemoGet(key){if(!activeContext)return undefined;return activeContext.memo.get(String(key||''));}
  function transactionMemoSet(key,value){if(!activeContext)return value;activeContext.memo.set(String(key||''),value);return value;}
  function normalizeScope(scope){if(!Array.isArray(scope)||!scope.length)return null;return [...new Set(scope.map(String).filter(Boolean))];}
  function normalizeWriteRoots(roots){if(!Array.isArray(roots))return null;return [...new Set(roots.map(String).filter(Boolean))];}
  function normalizeWriterContracts(contracts){return Array.isArray(contracts)?contracts.filter(row=>row&&typeof row==='object').map(row=>({...row})):[];}
  function auditEqual(a,b,seen=new WeakMap()){
    if(Object.is(a,b))return true;
    if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
    if(Array.isArray(a)!==Array.isArray(b))return false;
    let peers=seen.get(a);if(peers?.has(b))return true;if(!peers){peers=new WeakSet();seen.set(a,peers);}peers.add(b);
    if(Array.isArray(a)){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!auditEqual(a[i],b[i],seen))return false;return true;}
    const ak=Object.keys(a),bk=Object.keys(b);if(ak.length!==bk.length)return false;
    for(const key of ak)if(!Object.prototype.hasOwnProperty.call(b,key)||!auditEqual(a[key],b[key],seen))return false;
    return true;
  }
  function diffRootKeys(target,baseline){
    const keys=new Set([...Object.keys(baseline||{}),...Object.keys(target||{})]),changed=[];
    for(const key of keys){const hasA=Object.prototype.hasOwnProperty.call(target,key),hasB=Object.prototype.hasOwnProperty.call(baseline,key);if(hasA!==hasB||!auditEqual(target[key],baseline[key]))changed.push(key);}
    return changed.sort();
  }
  function captureScoped(target,scope){const snapshot={};for(const key of scope)snapshot[key]={exists:Object.prototype.hasOwnProperty.call(target,key),value:deepClone(target[key])};return snapshot;}
  function restoreScoped(target,snapshot,scope){for(const key of scope){const entry=snapshot[key];if(!entry?.exists){delete target[key];continue;}const sv=entry.value,tv=target[key];target[key]=sv&&typeof sv==='object'?restoreValue(tv,sv):sv;}return target;}
  function isJournalPrimitive(value){return value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value));}
  function captureJournal(target,scope,contracts){
    const assetContract=contracts.find(row=>row.proven===true&&row.root==='assets'&&row.mode==='asset-fields'&&Array.isArray(row.fields)&&row.fields.length);
    const fieldContracts=contracts.filter(row=>row.proven===true&&row.mode==='fields'&&Array.isArray(row.fields)&&row.fields.length);
    if(scope.includes('assets')&&!assetContract)return {ok:false,reason:'journal-assets-without-field-contract'};
    const fieldRoots=new Set(fieldContracts.map(row=>String(row.root||''))),rootScope=scope.filter(key=>key!=='assets'&&!fieldRoots.has(key)),rootSnapshot=captureScoped(target,rootScope),assetEntries=[],fieldEntries=[];
    for(const contract of fieldContracts){
      const root=String(contract.root||''),object=target[root];if(!root||!scope.includes(root)||!object||typeof object!=='object'||Array.isArray(object))return {ok:false,reason:`journal-field-root-invalid:${root}`};
      const fields={},names=[...new Set(contract.fields.map(String).filter(Boolean))];
      for(const field of names){const descriptor=Object.getOwnPropertyDescriptor(object,field);if(descriptor&&!Object.prototype.hasOwnProperty.call(descriptor,'value'))return {ok:false,reason:`journal-field-accessor:${root}.${field}`};fields[field]=descriptor?{exists:true,descriptor:{...descriptor}}:{exists:false,descriptor:null};}
      fieldEntries.push({root,ref:object,fields});
    }
    if(assetContract){
      const fields=[...new Set(assetContract.fields.map(String).filter(Boolean))];
      for(let index=0;index<(target.assets||[]).length;index++){
        const asset=target.assets[index];if(!asset||typeof asset!=='object'||Array.isArray(asset))return {ok:false,reason:'journal-asset-invalid'};
        const saved={};
        for(const field of fields){
          const descriptor=Object.getOwnPropertyDescriptor(asset,field);
          if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value')||!isJournalPrimitive(descriptor.value))return {ok:false,reason:`journal-asset-field-unsupported:${field}`};
          saved[field]={...descriptor};
        }
        assetEntries.push({index,id:asset.id??null,ref:asset,keyOrder:Object.keys(asset),fields:saved});
      }
      return {ok:true,rootScope,rootSnapshot,assetEntries,fieldEntries,assetFields:fields,records:rootScope.length+assetEntries.length*fields.length+fieldEntries.reduce((sum,row)=>sum+Object.keys(row.fields).length,0)};
    }
    return {ok:true,rootScope,rootSnapshot,assetEntries,fieldEntries,assetFields:[],records:rootScope.length+fieldEntries.reduce((sum,row)=>sum+Object.keys(row.fields).length,0)};
  }
  function validateJournalPostState(target,journal){
    if(!journal)return {ok:true};
    for(const entry of journal.fieldEntries||[]){if(target[entry.root]!==entry.ref)return {ok:false,reason:`journal-field-root-replaced:${entry.root}`};for(const field of Object.keys(entry.fields)){const descriptor=Object.getOwnPropertyDescriptor(entry.ref,field);if(descriptor&&!Object.prototype.hasOwnProperty.call(descriptor,'value'))return {ok:false,reason:`journal-field-accessor-new:${entry.root}.${field}`};}}
    const assets=target.assets||[];
    if(journal.assetEntries.length&&assets.length!==journal.assetEntries.length)return {ok:false,reason:'journal-assets-structural-length'};
    for(const entry of journal.assetEntries){
      const asset=assets[entry.index];
      if(!asset||asset!==entry.ref)return {ok:false,reason:`journal-assets-structural-order:${entry.id??entry.index}`};
      if(!sameOrder(Object.keys(asset),entry.keyOrder||[]))return {ok:false,reason:`journal-asset-key-structure:${entry.id??entry.index}`};
      for(const field of Object.keys(entry.fields||{})){
        const descriptor=Object.getOwnPropertyDescriptor(asset,field);
        if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))return {ok:false,reason:`journal-asset-field-structure:${field}`};
        if(!isJournalPrimitive(descriptor.value))return {ok:false,reason:`journal-asset-field-unsupported-new:${field}`};
      }
    }
    return {ok:true};
  }
  function restoreJournal(target,journal,rootOrder){
    if(journal.rootScope.length)restoreScoped(target,journal.rootSnapshot,journal.rootScope);
    for(const entry of journal.fieldEntries||[])for(const [field,saved] of Object.entries(entry.fields)){if(saved.exists)Object.defineProperty(entry.ref,field,saved.descriptor);else delete entry.ref[field];}
    const assets=target.assets||[];
    for(const entry of journal.assetEntries){
      let asset=assets[entry.index];if(!asset||asset!==entry.ref){if(entry.id!=null)asset=assets.find(row=>row?.id===entry.id);}
      if(!asset||typeof asset!=='object')throw new Error(`journal-asset-missing:${entry.id??entry.index}`);
      for(const [field,descriptor] of Object.entries(entry.fields))Object.defineProperty(asset,field,descriptor);
    }
    return restoreRootOrder(target,rootOrder);
  }
  function applyJournalPreimageToBaseline(baseline,context){
    const journal=context.journal;if(!journal)return baseline;
    if(journal.rootScope.length)restoreScoped(baseline,journal.rootSnapshot,journal.rootScope);
    for(const entry of journal.fieldEntries||[]){const object=baseline[entry.root];if(!object||typeof object!=='object')throw new Error(`journal-promotion-field-root-missing:${entry.root}`);for(const [field,saved] of Object.entries(entry.fields)){if(saved.exists)Object.defineProperty(object,field,{...saved.descriptor});else delete object[field];}}
    const assets=baseline.assets||[];
    for(const entry of journal.assetEntries){
      const asset=assets[entry.index];if(!asset||typeof asset!=='object')throw new Error(`journal-promotion-asset-missing:${entry.id??entry.index}`);
      for(const [field,descriptor] of Object.entries(entry.fields))Object.defineProperty(asset,field,{...descriptor});
    }
    const allowed=new Set(context.rootOrder);for(const key of Object.keys(baseline))if(!allowed.has(key))delete baseline[key];
    return restoreRootOrder(baseline,context.rootOrder);
  }
  function promoteLegacyScoped(context){
    const target=context.target,scoped=new Set(context.scope),remaining={};
    for(const key of context.rootOrder)if(!scoped.has(key)&&Object.prototype.hasOwnProperty.call(target,key))remaining[key]=target[key];
    const remainingClone=deepClone(remaining),full={};
    for(const key of context.rootOrder){if(scoped.has(key)){const entry=context.snapshot[key];if(entry?.exists)full[key]=entry.value;}else if(Object.prototype.hasOwnProperty.call(remainingClone,key))full[key]=remainingClone[key];}
    context.snapshot=full;context.scope=null;
  }
  function promoteToFull(context,reason='journal-fallback'){
    if(!context||context.rollbackStorage==='full-snapshot')return context;
    const start=runtimeClock();
    if(context.rollbackStorage==='journal'){
      const baseline=applyJournalPreimageToBaseline(deepClone(context.target),context);
      context.snapshot=baseline;context.journal=null;context.scope=null;
    }else if(context.scope)promoteLegacyScoped(context);
    context.rollbackStorage='full-snapshot';
    if(context.timing){context.timing.snapshotMs+=Math.max(0,runtimeClock()-start);context.timing.fullSnapshot=true;context.timing.fullSnapshotFallback=true;context.timing.fallbackReason=context.timing.fallbackReason||String(reason||'journal-fallback');context.timing.rollbackStorage='full-snapshot';}
    return context;
  }
  function afterCommit(fn,options={}){
    if(typeof fn!=='function')return;
    const task={fn,critical:options?.critical===true,priority:Number(options.priority)||0,key:options.key||null,owner:options.owner||null,writeContract:options.writeContract||null,irreversible:options.irreversible===true};
    if(activeContext){
      const ctx=activeContext;
      if(task.critical){
        if(task.irreversible){
          if(ctx.irreversiblePriority!=null)throw new Error('transaction-irreversible-ordering:multiple-terminal-critical-tasks');
          const laterExisting=ctx.postCommit.some(row=>row.critical&&!row.irreversible&&row.priority>task.priority);if(laterExisting)throw new Error('transaction-irreversible-ordering:critical-task-after-terminal');
          ctx.irreversiblePriority=task.priority;
        }else if(ctx.irreversiblePriority!=null&&task.priority>=ctx.irreversiblePriority)throw new Error('transaction-irreversible-ordering:critical-task-after-terminal');
        if(ctx.rollbackStorage==='journal'){
          const contract=task.writeContract,readOnly=contract?.proven===true&&contract?.readOnly===true;
          if(!readOnly)promoteToFull(ctx,`critical-hook:${task.owner||task.key||'unproven'}`);
        }
      }
      if(task.key)ctx.postCommit=ctx.postCommit.filter(x=>x.key!==task.key);
      ctx.postCommit.push(task);
    }else fn();
  }
  function journalAdmissionReason(options,scope,contracts){
    if(options.rollbackMode!=='journal')return null;
    if(!scope)return 'journal-requires-scope';
    if(!contracts.length)return 'unproven-writer';
    if(contracts.some(row=>row.proven!==true))return 'unproven-writer';
    if(contracts.some(row=>row.structural===true))return 'structural-writer';
    if(contracts.some(row=>row.mayJoin===true))return 'composite-writer';
    if(contracts.some(row=>row.allowNestedSubobjects===true||row.nested===true))return 'nested-asset-writer';
    if(typeof options.validate==='function'&&!(options.validateContract?.proven===true&&options.validateContract?.readOnly===true))return 'validation-unproven';
    return null;
  }
  function join(target,options={}){
    if(!activeContext)return execute(target,options);
    const ctx=activeContext;
    try{
      if(ctx.target!==target)throw new Error('Cross-state transaction join is forbidden');
      // Phase1C-B forbids late journal promotion: by the time join() is called the
      // parent may already have written. Composite writers must declare mayJoin at
      // execute() admission and therefore begin on Full Snapshot until an upfront
      // scope-union contract is separately proven.
      if(ctx.rollbackStorage==='journal')throw new Error('transaction-journal-unexpected-join');
      if(ctx.scope)promoteToFull(ctx,'joined-writer');
      const validation=options.validate?options.validate(ctx.measure):true;
      if(validation===false||validation?.ok===false)throw new Error(validation?.reason||'validation-rejected');
      const value=options.apply(ctx.measure);
      if(value?.then)throw new Error('Asynchronous state mutation requires an explicit lifecycle');
      return {committed:true,value,label:ctx.label,joined:true};
    }catch(error){ctx.failure=error;throw error;}
  }
  function executeCore(target,options={}){
    if(!target||typeof target!=='object'||Array.isArray(target))throw new TypeError('Transaction target must be an object');
    if(typeof options.apply!=='function')throw new TypeError('Transaction apply callback is required');
    if(activeContext)throw new Error('Nested state transactions are forbidden; domain commands must join their owner');
    const label=String(options.label||'transaction'),scope=normalizeScope(options.scope),declaredWriteRoots=normalizeWriteRoots(options.writeRoots),writerContracts=normalizeWriterContracts(options.writerContracts),auditWrites=options.auditWrites===true||options.enforceWriteRoots===true,totalStart=runtimeClock(),requestedJournal=options.rollbackMode==='journal',kernelManaged=options.kernelManaged===true&&kernelOwners.has(target),profiled=options.profile===true||(options.profile!==false&&globalThis.GH_DIAGNOSTICS?.recorderIsActive?.(target)===true),phaseBreakdown=profiled?[]:null;
    for(const [section,expected] of Object.entries(options.readRevisions||{})){const actual=sectionRevision(target,section);if(Number(expected)!==actual){const error=new Error(`transaction-section-revision-conflict:${section}:${expected}:${actual}`);error.code='TRANSACTION_SECTION_REVISION_CONFLICT';error.transactionLabel=label;error.transactionStage='admission';throw error;}}
    let fallbackReason=kernelManaged?null:journalAdmissionReason(options,scope,writerContracts),rollbackStorage=kernelManaged?'kernel-journal':'legacy-scoped',snapshot=null,journal=null;
    const shadow=kernelShadows.get(target),shadowRoots=declaredWriteRoots||scope;
    let phaseDepth=0;
    const measure=(name,work)=>{
      if(typeof work!=='function')throw new TypeError('Profile phase callback is required');
      if(!profiled)return work();
      const depth=phaseDepth++,started=runtimeClock();let ok=false;
      try{const value=work();ok=true;return value;}
      finally{phaseBreakdown.push({name:String(name||'unnamed').slice(0,100),durationMs:Math.max(0,runtimeClock()-started),depth,ok});if(phaseBreakdown.length>64)phaseBreakdown.shift();phaseDepth--;}
    };
    const derivedProfileContext=profiled?{kind:label.startsWith('simulation:')?'simulation-slice':label.startsWith('boundary-recovery:')?'boundary-recovery':'state-transaction',assetCount:Array.isArray(target.assets)?target.assets.length:null,invoiceCount:Array.isArray(target.finance?.invoices)?target.finance.invoices.length:null,receivableCount:Array.isArray(target.finance?.receivables)?target.finance.receivables.length:null,payableCount:Array.isArray(target.finance?.payables)?target.finance.payables.length:null}:null;
    const timing={label,profiled,profileContext:profiled?compactProfileContext(options.profileContext||derivedProfileContext):null,phaseBreakdown,scopeSize:scope?scope.length:null,fullSnapshot:false,fullSnapshotFallback:false,fallbackReason:null,rollbackStorage:null,journalRecords:0,snapshotMs:0,validateMs:0,applyMs:0,postCommitCriticalMs:0,postCommitNonCriticalMs:0,postCommitCriticalTasks:[],postCommitNonCriticalTasks:[],writeAudit:auditWrites?{enabled:true,declaredRoots:declaredWriteRoots?[...declaredWriteRoots]:null,mutatedRoots:[],undeclaredRoots:[],declaredButUnchanged:[],stage:'pending'}:null,rollbackMs:0,totalMs:0,committed:false,stage:'snapshot'};
    const snapshotStart=runtimeClock();
    if(kernelManaged){timing.journalRecords=0;}
    else if(shadow?.enabled){snapshot=deepClone(target);rollbackStorage='full-snapshot';fallbackReason=fallbackReason||'kernel-shadow-audit-mode';}
    else if(requestedJournal&&!fallbackReason){
      const captured=captureJournal(target,scope,writerContracts);
      if(captured.ok){journal=captured;rollbackStorage='journal';timing.journalRecords=captured.records;}
      else fallbackReason=captured.reason;
    }
    if(!kernelManaged&&!shadow?.enabled&&requestedJournal&&fallbackReason){snapshot=deepClone(target);rollbackStorage='full-snapshot';}
    else if(!kernelManaged&&!shadow?.enabled&&!requestedJournal){snapshot=scope?captureScoped(target,scope):deepClone(target);rollbackStorage=scope?'legacy-scoped':'full-snapshot';}
    timing.snapshotMs=Math.max(0,runtimeClock()-snapshotStart);timing.rollbackStorage=rollbackStorage;timing.fullSnapshot=rollbackStorage==='full-snapshot';timing.fullSnapshotFallback=requestedJournal&&rollbackStorage==='full-snapshot';timing.fallbackReason=timing.fullSnapshotFallback?fallbackReason:null;
    // Write auditing is an architecture-development proof tool. Full transactions reuse
    // their rollback snapshot; scoped/journal transactions take an extra full baseline only when
    // audit/enforcement is explicitly requested. Normal gameplay pays no audit cost.
    const auditBaseline=auditWrites?(kernelManaged?kernelOwners.get(target).kernel.legacyState():((rollbackStorage==='full-snapshot')?snapshot:deepClone(target))):null;
    const context={target,label,scope:rollbackStorage==='legacy-scoped'?scope:null,snapshot,journal,rootOrder:Object.keys(target),postCommit:[],memo:new Map(),failure:null,auditBaseline,declaredWriteRoots,writerContracts,rollbackStorage,timing,measure,irreversiblePriority:null,shadowRoots};
    const rollback=()=>{if(kernelManaged)return target;if(context.rollbackStorage==='journal')return restoreJournal(target,context.journal,context.rootOrder);if(context.scope){restoreScoped(target,context.snapshot,context.scope);return restoreRootOrder(target,context.rootOrder);}return restoreObject(target,context.snapshot);};
    let phase='validate';activeContext=context;
    try{
      const validateStart=runtimeClock();let validation;
      try{validation=typeof options.validate==='function'?options.validate(measure):true;}
      finally{timing.validateMs=Math.max(0,runtimeClock()-validateStart);timing.stage='validate';}
      if(validation===false||validation?.ok===false){const rollbackStart=runtimeClock();rollback();timing.rollbackMs=Math.max(0,runtimeClock()-rollbackStart);timing.totalMs=Math.max(0,runtimeClock()-totalStart);timing.stage='validation-rejected';publishRuntimeMetric(timing);return {committed:false,reason:validation?.reason||'validation-rejected',label};}
      phase='commit';const applyStart=runtimeClock();let value;
      try{value=options.apply(measure);}
      finally{timing.applyMs=Math.max(0,runtimeClock()-applyStart);timing.stage='commit';}
      if(value?.then)throw new Error('Asynchronous state mutation requires an explicit lifecycle');
      if(context.failure)throw context.failure;
      if(context.rollbackStorage==='journal'){
        const postApply=validateJournalPostState(target,context.journal);if(!postApply.ok){const error=new Error(`transaction-journal-contract-violation:${postApply.reason}`);error.code='TRANSACTION_JOURNAL_CONTRACT_VIOLATION';throw error;}
      }
      activeContext=null;phase='post-commit-critical';
      const criticalTasks=context.postCommit.filter(x=>x.critical).sort((a,b)=>a.priority-b.priority),reversibleCritical=criticalTasks.filter(task=>!task.irreversible),irreversibleCritical=criticalTasks.filter(task=>task.irreversible);
      const runCritical=tasks=>{for(const task of tasks){const taskStart=runtimeClock(),row={key:task.key||null,owner:task.owner||null,priority:task.priority,durationMs:0,ok:false,irreversible:task.irreversible===true};try{task.fn();row.ok=true;}finally{row.durationMs=Math.max(0,runtimeClock()-taskStart);timing.postCommitCriticalTasks.push(row);}}};
      const criticalStart=runtimeClock();try{
        runCritical(reversibleCritical);
        if(context.rollbackStorage==='journal'){
          const postCritical=validateJournalPostState(target,context.journal);if(!postCritical.ok){const error=new Error(`transaction-journal-contract-violation:${postCritical.reason}`);error.code='TRANSACTION_JOURNAL_CONTRACT_VIOLATION';throw error;}
        }
        if(auditWrites){
          const mutatedRoots=diffRootKeys(target,auditBaseline),declared=declaredWriteRoots?new Set(declaredWriteRoots):null,undeclared=declared?mutatedRoots.filter(key=>!declared.has(key)):[],unchanged=declaredWriteRoots?declaredWriteRoots.filter(key=>!mutatedRoots.includes(key)):[];
          timing.writeAudit={enabled:true,declaredRoots:declaredWriteRoots?[...declaredWriteRoots]:null,mutatedRoots,undeclaredRoots:undeclared,declaredButUnchanged:unchanged,stage:'pre-irreversible'};
          if(options.enforceWriteRoots===true&&undeclared.length){const error=new Error(`transaction-write-set-violation:${undeclared.join(',')}`);error.code='TRANSACTION_WRITE_SET_VIOLATION';error.undeclaredRoots=undeclared;throw error;}
        }
        if(shadow?.enabled){const roots=context.shadowRoots||diffRootKeys(target,snapshot);shadowSync(target,roots,label);}
        phase='post-commit-irreversible';runCritical(irreversibleCritical);
      }finally{timing.postCommitCriticalMs=Math.max(0,runtimeClock()-criticalStart);}
      const nonCriticalStart=runtimeClock();for(const task of context.postCommit.filter(x=>!x.critical)){const taskStart=runtimeClock(),row={key:task.key||null,owner:task.owner||null,priority:task.priority,durationMs:0,ok:false};try{task.fn();row.ok=true;}catch(error){row.error=String(error?.message||error).slice(0,240);globalThis.console?.warn?.(`${label}: non-critical post-commit side effect failed`,error);}finally{row.durationMs=Math.max(0,runtimeClock()-taskStart);timing.postCommitNonCriticalTasks.push(row);}}timing.postCommitNonCriticalMs=Math.max(0,runtimeClock()-nonCriticalStart);
      if(!kernelManaged){advanceSectionRevisions(target,declaredWriteRoots||scope||['*']);advanceRevision(target);}timing.committed=true;timing.stage='committed';timing.totalMs=Math.max(0,runtimeClock()-totalStart);publishRuntimeMetric(timing);
      return {committed:true,value,label,scope:context.scope?[...context.scope]:null};
    }catch(error){
      activeContext=null;context.postCommit.length=0;
      if(auditWrites&&timing.writeAudit?.stage==='pending'){const mutatedRoots=diffRootKeys(target,auditBaseline),declared=declaredWriteRoots?new Set(declaredWriteRoots):null;timing.writeAudit={enabled:true,declaredRoots:declaredWriteRoots?[...declaredWriteRoots]:null,mutatedRoots,undeclaredRoots:declared?mutatedRoots.filter(key=>!declared.has(key)):[],declaredButUnchanged:declaredWriteRoots?declaredWriteRoots.filter(key=>!mutatedRoots.includes(key)):[],stage:'failure-before-rollback'};}
      const rollbackStart=runtimeClock();
      try{rollback();timing.rollbackMs=Math.max(0,runtimeClock()-rollbackStart);}catch(restoreError){timing.rollbackMs=Math.max(0,runtimeClock()-rollbackStart);timing.stage='rollback-failed';timing.totalMs=Math.max(0,runtimeClock()-totalStart);publishRuntimeMetric(timing);const fatal=new Error(`${label}: rollback failed`);fatal.cause=error;fatal.rollbackError=restoreError;fatal.transactionLabel=label;fatal.transactionStage='rollback';throw fatal;}
      if(shadow?.enabled)reconcileKernelShadow(target);
      timing.stage=phase;timing.totalMs=Math.max(0,runtimeClock()-totalStart);publishRuntimeMetric(timing);error.transactionLabel=label;error.transactionStage=phase;throw error;
    }finally{activeContext=null;}
  }
  class KernelTransactionRejected extends Error{constructor(result){super(result?.reason||'kernel-transaction-rejected');this.result=result;}}
  function execute(target,options={}){
    const owner=kernelOwners.get(target);if(!owner)return executeCore(target,options);
    if(owner.transactionDepth>0)return executeCore(target,{...options,kernelManaged:true});
    const label=String(options.label||'transaction');let outcome=null,kernelCommit=null;
    try{
      kernelCommit=owner.kernel.tx({label,owner:'transaction-core',writes:owner.kernel.sectionNames()},()=>{
        owner.transactionDepth++;
        try{outcome=executeCore(target,{...options,kernelManaged:true});if(!outcome?.committed)throw new KernelTransactionRejected(outcome);return outcome;}
        finally{owner.transactionDepth--;}
      });
      owner.transactions++;owner.lastCommit={label,revision:kernelCommit.revision,undoRecords:kernelCommit.undoRecords,ms:kernelCommit.ms,dirty:kernelCommit.dirty};advanceSectionRevisions(target,normalizeWriteRoots(options.writeRoots)||normalizeScope(options.scope)||kernelCommit.dirty||['*']);advanceRevision(target);
      const metric=runtimeTelemetry.last;if(metric?.label===label){Object.assign(metric,{rollbackStorage:'kernel-journal',fullSnapshot:false,fullSnapshotFallback:false,snapshotMs:0,kernelCommitMs:kernelCommit.ms,kernelUndoRecords:kernelCommit.undoRecords,kernelDirtySections:kernelCommit.dirty});}
      return outcome;
    }catch(error){
      owner.transactions++;owner.rollbacks++;
      if(error instanceof KernelTransactionRejected){owner.lastCommit={label,revision:owner.kernel.snapshot().revision,undoRecords:0,ms:0,dirty:[]};return error.result;}
      error.transactionLabel=error.transactionLabel||label;error.transactionStage=error.transactionStage||'kernel-commit';throw error;
    }
  }
  function resetProfileTelemetry(){runtimeTelemetry.profiledSamples.length=0;runtimeTelemetry.profiledCount=0;runtimeTelemetry.lastSimulation=null;return true;}
  function telemetrySnapshot(){const out=deepClone(runtimeTelemetry);if(activeContext)out.active={label:activeContext.label,rollbackStorage:activeContext.rollbackStorage,fullSnapshot:activeContext.rollbackStorage==='full-snapshot',fallbackReason:activeContext.timing?.fallbackReason||null,journalRecords:activeContext.timing?.journalRecords||0,profiled:activeContext.timing?.profiled===true,phaseBreakdown:activeContext.timing?.phaseBreakdown?deepClone(activeContext.timing.phaseBreakdown):null};return out;}
  function rejection(reason,label,stage='validate'){const error=new Error(reason);error.transactionLabel=label;error.transactionStage=stage;return error;}
  function criticalIds(result){return new Set((((result?.critical)||((result?.issues)||[]).filter(row=>row.severity==='critical'))||[]).map(row=>String(row.id||row.code||row.title)));}
  async function executeDurable(liveState,options={}){
    if(!liveState||typeof liveState!=='object'||Array.isArray(liveState))throw new TypeError('Durable transaction target must be an object');
    if(typeof options.apply!=='function')throw new TypeError('Durable transaction apply callback is required');
    if(activeContext)throw new Error('Durable transaction cannot start inside a synchronous transaction');
    if(durableTargets.has(liveState))throw new Error('durable-transaction-in-progress');
    if(globalThis.__GH_DURABLE_COMMAND_CONTEXT__)throw new Error('durable-command-context-in-progress');
    const label=String(options.label||'durable-transaction'),actualRevision=Math.max(0,Math.floor(Number(liveState.saveRevision)||0)),expectedRevision=options.expectedRevision==null?actualRevision:Number(options.expectedRevision);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw rejection('invalid-expected-save-revision',label,'admission');
    if(actualRevision!==expectedRevision)throw rejection(`state-revision-conflict:${expectedRevision}:${actualRevision}`,label,'admission');
    const transactionId=String(options.transactionId||`DTX-${String(++durableSequence).padStart(9,'0')}`),draft=deepClone(liveState),priorCritical=criticalIds(globalThis.GH_INTEGRITY_CORE?.check?.(liveState)),afterPublishTasks=[];
    const context={schema:'gh-durable-transaction-v1',transactionId,label,liveState,draft,expectedRevision,startedAtSim:Number(liveState.simSeconds)||0,afterPublish(fn){if(typeof fn==='function')afterPublishTasks.push(fn);},call(domain,name,payload={},commandOptions={}){const commands=globalThis.GH_DOMAIN_COMMANDS;if(!commands?.dispatch)throw new Error('domain-command-owner-unavailable');return commands.dispatch({state:draft},domain,name,payload,commandOptions);},callSystem(domain,name,payload={},commandOptions={}){const commands=globalThis.GH_DOMAIN_COMMANDS;if(!commands?.dispatchSystem)throw new Error('system-domain-command-owner-unavailable');return commands.dispatchSystem({state:draft},domain,name,payload,commandOptions);}};
    durableTargets.add(liveState);globalThis.__GH_DURABLE_COMMAND_CONTEXT__=context;let phase='apply',durableCommitted=false;
    try{
      const value=await options.apply(draft,context);if(value===false)throw rejection(`${label}-rejected`,label,phase);
      if(Number(draft.saveRevision||0)!==expectedRevision)throw rejection('draft-save-revision-mutated',label,phase);
      draft.saveRevision=expectedRevision+1;phase='validate';
      const schema=globalThis.GH_SAVE_SCHEMA?.validate?.(draft);if(schema&&schema.ok===false)throw rejection(`invalid-draft:${(schema.errors||[]).join(',')}`,label,phase);
      if(options.integrity!==false&&globalThis.GH_INTEGRITY_CORE?.check){const integrity=globalThis.GH_INTEGRITY_CORE.check(draft),introduced=(((integrity?.critical)||((integrity?.issues)||[]).filter(row=>row.severity==='critical'))||[]).filter(row=>!priorCritical.has(String(row.id||row.code||row.title)));if(introduced.length)throw rejection(`critical-integrity:${introduced.map(row=>row.id||row.code||row.title).join(',')}`,label,phase);}
      if(typeof options.validate==='function'){const validation=await options.validate(draft,context);if(validation===false||validation?.ok===false)throw rejection(validation?.reason||'validation-rejected',label,phase);}
      if(Number(liveState.saveRevision||0)!==expectedRevision)throw rejection(`state-revision-conflict:${expectedRevision}:${Number(liveState.saveRevision)||0}`,label,'pre-persist');
      phase='durable-commit';const persist=options.persist||((state,meta)=>{const owner=globalThis.GH_PERSISTENCE;if(!owner?.commitDurableState)throw new Error('durable-persistence-owner-unavailable');return owner.commitDurableState(state,meta);}),persisted=await persist(draft,{...(options.persistence||{}),expectedPreviousRevision:expectedRevision,transactionId,idempotencyKey:options.idempotencyKey||null});if(persisted===false||persisted?.ok===false)throw rejection(persisted?.reason||'durable-persistence-rejected',label,phase);durableCommitted=true;
      phase='publish';if(typeof options.publish==='function')await options.publish(liveState,draft,context);else restoreObject(liveState,draft);
      for(const task of afterPublishTasks)try{await task(value,context);}catch(error){globalThis.console?.warn?.(`${label}: after-publish side effect failed`,error);}
      if(typeof options.afterCommit==='function')try{await options.afterCommit(value,context);}catch(error){globalThis.console?.warn?.(`${label}: after-commit side effect failed`,error);}
      if(!kernelOwners.has(liveState)||typeof options.publish==='function'){advanceSectionRevisions(liveState,normalizeWriteRoots(options.writeRoots)||['*']);advanceRevision(liveState);}return {committed:true,durable:true,transactionId,label,saveRevision:Number(liveState.saveRevision)||0,value,persistence:persisted};
    }catch(error){
      error.transactionLabel=error.transactionLabel||label;error.transactionStage=error.transactionStage||phase;error.durableCommitted=durableCommitted;
      if(durableCommitted){error.critical=true;globalThis.GH_PERSISTENCE?.markRecoveryRequired?.('durable-publish-failed');}
      throw error;
    }finally{if(globalThis.__GH_DURABLE_COMMAND_CONTEXT__===context)delete globalThis.__GH_DURABLE_COMMAND_CONTEXT__;durableTargets.delete(liveState);}
  }
  const API=Object.freeze({VERSION,deepClone,restoreObject,execute,join,executeDurable,isActive,isDurableActive:target=>target?durableTargets.has(target):!!globalThis.__GH_DURABLE_COMMAND_CONTEXT__,revision,sectionRevision,enableKernelOwner,kernelOwnerStatus,kernelOwnerState,enableKernelShadow,disableKernelShadow,kernelShadowStatus:target=>kernelShadowStatus(target),afterCommit,transactionMemo,transactionMemoGet,transactionMemoSet,resetProfileTelemetry,telemetry:telemetrySnapshot});globalThis.GH_TRANSACTION_CORE=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_TRANSACTION_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
