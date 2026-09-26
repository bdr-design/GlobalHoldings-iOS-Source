(()=>{
  'use strict';
  const VERSION='3.0.0';
  let activeContext=null,durableSequence=0;
  const durableTargets=new WeakSet();
  const runtimeTelemetry={last:null,lastSimulation:null,samples:[]};
  const runtimeClock=()=>globalThis.performance?.now?.()??Date.now();
  function publishRuntimeMetric(row){
    const metric={...row,recordedAtMs:Date.now()};
    runtimeTelemetry.last=metric;
    if(String(metric.label||'').startsWith('simulation:'))runtimeTelemetry.lastSimulation=metric;
    runtimeTelemetry.samples.push(metric);
    if(runtimeTelemetry.samples.length>24)runtimeTelemetry.samples.shift();
    return metric;
  }
  function jsonClone(value){if(value===undefined)return undefined;return JSON.parse(JSON.stringify(value));}
  function deepClone(value){if(typeof globalThis.structuredClone==='function'){try{return globalThis.structuredClone(value);}catch(_error){}}return jsonClone(value);}
  function restoreValue(target,snapshot){
    if(Array.isArray(snapshot)){if(!Array.isArray(target))return deepClone(snapshot);target.length=snapshot.length;for(let i=0;i<snapshot.length;i++){const sv=snapshot[i],tv=target[i];target[i]=sv&&typeof sv==='object'?restoreValue(tv,sv):sv;}return target;}
    if(snapshot&&typeof snapshot==='object'){if(!target||typeof target!=='object'||Array.isArray(target))target={};const existing=new Map(Object.keys(target).map(key=>[key,target[key]]));for(const key of Object.keys(target))delete target[key];for(const [key,sv] of Object.entries(snapshot)){const tv=existing.get(key);target[key]=sv&&typeof sv==='object'?restoreValue(tv,sv):sv;}return target;}
    return snapshot;
  }
  function restoreObject(target,snapshot){if(!target||typeof target!=='object'||Array.isArray(target))throw new TypeError('Transaction target must be an object');if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new TypeError('Transaction snapshot must be an object');return restoreValue(target,snapshot);}
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
  function transactionMemo(key,factory){if(!activeContext)return typeof factory==='function'?factory():undefined;key=String(key||'');if(activeContext.memo.has(key))return activeContext.memo.get(key);const value=typeof factory==='function'?factory():factory;activeContext.memo.set(key,value);return value;}
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
    if(scope.includes('assets')&&!assetContract)return {ok:false,reason:'journal-assets-without-field-contract'};
    const rootScope=scope.filter(key=>key!=='assets'),rootSnapshot=captureScoped(target,rootScope),assetEntries=[];
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
      return {ok:true,rootScope,rootSnapshot,assetEntries,assetFields:fields,records:rootScope.length+assetEntries.length*fields.length};
    }
    return {ok:true,rootScope,rootSnapshot,assetEntries,assetFields:[],records:rootScope.length};
  }
  function validateJournalPostState(target,journal){
    if(!journal)return {ok:true};
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
      const validation=options.validate?options.validate():true;
      if(validation===false||validation?.ok===false)throw new Error(validation?.reason||'validation-rejected');
      const value=options.apply();
      if(value?.then)throw new Error('Asynchronous state mutation requires an explicit lifecycle');
      return {committed:true,value,label:ctx.label,joined:true};
    }catch(error){ctx.failure=error;throw error;}
  }
  function execute(target,options={}){
    if(!target||typeof target!=='object'||Array.isArray(target))throw new TypeError('Transaction target must be an object');
    if(typeof options.apply!=='function')throw new TypeError('Transaction apply callback is required');
    if(activeContext)throw new Error('Nested state transactions are forbidden; domain commands must join their owner');
    const label=String(options.label||'transaction'),scope=normalizeScope(options.scope),declaredWriteRoots=normalizeWriteRoots(options.writeRoots),writerContracts=normalizeWriterContracts(options.writerContracts),auditWrites=options.auditWrites===true||options.enforceWriteRoots===true,totalStart=runtimeClock(),requestedJournal=options.rollbackMode==='journal';
    let fallbackReason=journalAdmissionReason(options,scope,writerContracts),rollbackStorage='legacy-scoped',snapshot=null,journal=null;
    const timing={label,scopeSize:scope?scope.length:null,fullSnapshot:false,fullSnapshotFallback:false,fallbackReason:null,rollbackStorage:null,journalRecords:0,snapshotMs:0,validateMs:0,applyMs:0,postCommitCriticalMs:0,postCommitNonCriticalMs:0,postCommitCriticalTasks:[],postCommitNonCriticalTasks:[],writeAudit:auditWrites?{enabled:true,declaredRoots:declaredWriteRoots?[...declaredWriteRoots]:null,mutatedRoots:[],undeclaredRoots:[],declaredButUnchanged:[],stage:'pending'}:null,rollbackMs:0,totalMs:0,committed:false,stage:'snapshot'};
    const snapshotStart=runtimeClock();
    if(requestedJournal&&!fallbackReason){
      const captured=captureJournal(target,scope,writerContracts);
      if(captured.ok){journal=captured;rollbackStorage='journal';timing.journalRecords=captured.records;}
      else fallbackReason=captured.reason;
    }
    if(requestedJournal&&fallbackReason){snapshot=deepClone(target);rollbackStorage='full-snapshot';}
    else if(!requestedJournal){snapshot=scope?captureScoped(target,scope):deepClone(target);rollbackStorage=scope?'legacy-scoped':'full-snapshot';}
    timing.snapshotMs=Math.max(0,runtimeClock()-snapshotStart);timing.rollbackStorage=rollbackStorage;timing.fullSnapshot=rollbackStorage==='full-snapshot';timing.fullSnapshotFallback=requestedJournal&&rollbackStorage==='full-snapshot';timing.fallbackReason=timing.fullSnapshotFallback?fallbackReason:null;
    // Write auditing is an architecture-development proof tool. Full transactions reuse
    // their rollback snapshot; scoped/journal transactions take an extra full baseline only when
    // audit/enforcement is explicitly requested. Normal gameplay pays no audit cost.
    const auditBaseline=auditWrites?((rollbackStorage==='full-snapshot')?snapshot:deepClone(target)):null;
    const context={target,label,scope:rollbackStorage==='legacy-scoped'?scope:null,snapshot,journal,rootOrder:Object.keys(target),postCommit:[],memo:new Map(),failure:null,auditBaseline,declaredWriteRoots,writerContracts,rollbackStorage,timing,irreversiblePriority:null};
    const rollback=()=>{if(context.rollbackStorage==='journal')return restoreJournal(target,context.journal,context.rootOrder);if(context.scope){restoreScoped(target,context.snapshot,context.scope);return restoreRootOrder(target,context.rootOrder);}return restoreObject(target,context.snapshot);};
    let phase='validate';activeContext=context;
    try{
      const validateStart=runtimeClock(),validation=typeof options.validate==='function'?options.validate():true;timing.validateMs=Math.max(0,runtimeClock()-validateStart);timing.stage='validate';
      if(validation===false||validation?.ok===false){const rollbackStart=runtimeClock();rollback();timing.rollbackMs=Math.max(0,runtimeClock()-rollbackStart);timing.totalMs=Math.max(0,runtimeClock()-totalStart);timing.stage='validation-rejected';publishRuntimeMetric(timing);return {committed:false,reason:validation?.reason||'validation-rejected',label};}
      phase='commit';const applyStart=runtimeClock(),value=options.apply();timing.applyMs=Math.max(0,runtimeClock()-applyStart);timing.stage='commit';
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
        phase='post-commit-irreversible';runCritical(irreversibleCritical);
      }finally{timing.postCommitCriticalMs=Math.max(0,runtimeClock()-criticalStart);}
      const nonCriticalStart=runtimeClock();for(const task of context.postCommit.filter(x=>!x.critical)){const taskStart=runtimeClock(),row={key:task.key||null,owner:task.owner||null,priority:task.priority,durationMs:0,ok:false};try{task.fn();row.ok=true;}catch(error){row.error=String(error?.message||error).slice(0,240);globalThis.console?.warn?.(`${label}: non-critical post-commit side effect failed`,error);}finally{row.durationMs=Math.max(0,runtimeClock()-taskStart);timing.postCommitNonCriticalTasks.push(row);}}timing.postCommitNonCriticalMs=Math.max(0,runtimeClock()-nonCriticalStart);
      timing.committed=true;timing.stage='committed';timing.totalMs=Math.max(0,runtimeClock()-totalStart);publishRuntimeMetric(timing);
      return {committed:true,value,label,scope:context.scope?[...context.scope]:null};
    }catch(error){
      activeContext=null;context.postCommit.length=0;
      if(auditWrites&&timing.writeAudit?.stage==='pending'){const mutatedRoots=diffRootKeys(target,auditBaseline),declared=declaredWriteRoots?new Set(declaredWriteRoots):null;timing.writeAudit={enabled:true,declaredRoots:declaredWriteRoots?[...declaredWriteRoots]:null,mutatedRoots,undeclaredRoots:declared?mutatedRoots.filter(key=>!declared.has(key)):[],declaredButUnchanged:declaredWriteRoots?declaredWriteRoots.filter(key=>!mutatedRoots.includes(key)):[],stage:'failure-before-rollback'};}
      const rollbackStart=runtimeClock();
      try{rollback();timing.rollbackMs=Math.max(0,runtimeClock()-rollbackStart);}catch(restoreError){timing.rollbackMs=Math.max(0,runtimeClock()-rollbackStart);timing.stage='rollback-failed';timing.totalMs=Math.max(0,runtimeClock()-totalStart);publishRuntimeMetric(timing);const fatal=new Error(`${label}: rollback failed`);fatal.cause=error;fatal.rollbackError=restoreError;fatal.transactionLabel=label;fatal.transactionStage='rollback';throw fatal;}
      timing.stage=phase;timing.totalMs=Math.max(0,runtimeClock()-totalStart);publishRuntimeMetric(timing);error.transactionLabel=label;error.transactionStage=phase;throw error;
    }finally{activeContext=null;}
  }
  function telemetrySnapshot(){const out=deepClone(runtimeTelemetry);if(activeContext)out.active={label:activeContext.label,rollbackStorage:activeContext.rollbackStorage,fullSnapshot:activeContext.rollbackStorage==='full-snapshot',fallbackReason:activeContext.timing?.fallbackReason||null,journalRecords:activeContext.timing?.journalRecords||0};return out;}
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
      return {committed:true,durable:true,transactionId,label,saveRevision:Number(liveState.saveRevision)||0,value,persistence:persisted};
    }catch(error){
      error.transactionLabel=error.transactionLabel||label;error.transactionStage=error.transactionStage||phase;error.durableCommitted=durableCommitted;
      if(durableCommitted){error.critical=true;globalThis.GH_PERSISTENCE?.markRecoveryRequired?.('durable-publish-failed');}
      throw error;
    }finally{if(globalThis.__GH_DURABLE_COMMAND_CONTEXT__===context)delete globalThis.__GH_DURABLE_COMMAND_CONTEXT__;durableTargets.delete(liveState);}
  }
  const API=Object.freeze({VERSION,deepClone,restoreObject,execute,join,executeDurable,isActive,isDurableActive:target=>target?durableTargets.has(target):!!globalThis.__GH_DURABLE_COMMAND_CONTEXT__,afterCommit,transactionMemo,telemetry:telemetrySnapshot});globalThis.GH_TRANSACTION_CORE=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_TRANSACTION_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
