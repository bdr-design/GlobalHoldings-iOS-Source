(()=>{
  'use strict';
  const VERSION='2.9.1';
  let activeContext=null;
  function jsonClone(value){if(value===undefined)return undefined;return JSON.parse(JSON.stringify(value));}
  function deepClone(value){if(typeof globalThis.structuredClone==='function'){try{return globalThis.structuredClone(value);}catch(_error){}}return jsonClone(value);}
  function restoreValue(target,snapshot){
    if(Array.isArray(snapshot)){if(!Array.isArray(target))return deepClone(snapshot);target.length=snapshot.length;for(let i=0;i<snapshot.length;i++){const sv=snapshot[i],tv=target[i];target[i]=sv&&typeof sv==='object'?restoreValue(tv,sv):sv;}return target;}
    if(snapshot&&typeof snapshot==='object'){if(!target||typeof target!=='object'||Array.isArray(target))target={};for(const key of Object.keys(target))if(!(key in snapshot))delete target[key];for(const [key,sv] of Object.entries(snapshot)){const tv=target[key];target[key]=sv&&typeof sv==='object'?restoreValue(tv,sv):sv;}return target;}
    return snapshot;
  }
  function restoreObject(target,snapshot){if(!target||typeof target!=='object'||Array.isArray(target))throw new TypeError('Transaction target must be an object');if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new TypeError('Transaction snapshot must be an object');return restoreValue(target,snapshot);}
  function isActive(){return !!activeContext;}
  function afterCommit(fn,options={}){if(typeof fn!=='function')return;const task={fn,critical:options?.critical===true,priority:Number(options.priority)||0,key:options.key||null};if(activeContext){if(task.key)activeContext.postCommit=activeContext.postCommit.filter(x=>x.key!==task.key);activeContext.postCommit.push(task);}else fn();}
  function normalizeScope(scope){if(!Array.isArray(scope)||!scope.length)return null;return [...new Set(scope.map(String).filter(Boolean))];}
  function captureScoped(target,scope){const snapshot={};for(const key of scope)snapshot[key]={exists:Object.prototype.hasOwnProperty.call(target,key),value:deepClone(target[key])};return snapshot;}
  function restoreScoped(target,snapshot,scope){for(const key of scope){const entry=snapshot[key];if(!entry?.exists){delete target[key];continue;}const sv=entry.value,tv=target[key];target[key]=sv&&typeof sv==='object'?restoreValue(tv,sv):sv;}return target;}
  function join(target, options={}) {
    if (!activeContext) return execute(target, options);
    const ctx = activeContext;
    if (ctx.target !== target) throw new Error('Cross-state transaction join is forbidden');
    // A domain command can touch more than the simulation's initial scope. Capture
    // those roots before the owner runs, retaining the original scoped snapshot.
    if (ctx.scope) {
      const full = deepClone(target);
      for (const key of ctx.scope) {
        const e = ctx.snapshot[key];
        if (e.exists) full[key] = e.value; else delete full[key];
      }
      ctx.snapshot = full; ctx.scope = null;
    }
    try {
      const validation = options.validate ? options.validate() : true;
      if (validation === false || validation?.ok === false) throw new Error(validation?.reason || 'validation-rejected');
      const value = options.apply();
      if (value?.then) throw new Error('Asynchronous state mutation requires an explicit lifecycle');
      return {committed:true, value, label:ctx.label, joined:true};
    } catch (error) { ctx.failure = error; throw error; }
  }
  function execute(target,options={}){
    if(!target||typeof target!=='object'||Array.isArray(target))throw new TypeError('Transaction target must be an object');
    if(typeof options.apply!=='function')throw new TypeError('Transaction apply callback is required');
    if(activeContext)throw new Error('Nested state transactions are forbidden; domain commands must join their owner');
    const label=String(options.label||'transaction'),scope=normalizeScope(options.scope);
    const context={target,label,scope,snapshot:scope?captureScoped(target,scope):deepClone(target),postCommit:[],failure:null};
    const rollback=()=>context.scope?restoreScoped(target,context.snapshot,context.scope):restoreObject(target,context.snapshot);
    let phase='validate'; activeContext=context;
    try{
      const validation=typeof options.validate==='function'?options.validate():true;
      if(validation===false||validation?.ok===false){rollback();return {committed:false,reason:validation?.reason||'validation-rejected',label};}
      phase='commit'; const value=options.apply();
      if(value?.then)throw new Error('Asynchronous state mutation requires an explicit lifecycle');
      if(context.failure)throw context.failure;
      activeContext=null;phase='post-commit-critical';
      for(const task of context.postCommit.filter(x=>x.critical).sort((a,b)=>a.priority-b.priority))task.fn();
      for(const task of context.postCommit.filter(x=>!x.critical))try{task.fn();}catch(error){globalThis.console?.warn?.(`${label}: non-critical post-commit side effect failed`,error);}
      return {committed:true,value,label,scope:context.scope?[...context.scope]:null};
    }catch(error){
      activeContext=null;context.postCommit.length=0;
      // One rollback authority for validation, execution and critical side effects.
      try{rollback();}catch(restoreError){const fatal=new Error(`${label}: rollback failed`);fatal.cause=error;fatal.rollbackError=restoreError;fatal.transactionLabel=label;fatal.transactionStage='rollback';throw fatal;}
      error.transactionLabel=label;error.transactionStage=phase;throw error;
    }finally{activeContext=null;}
  }
  const API=Object.freeze({VERSION,deepClone,restoreObject,execute,join,isActive,afterCommit});globalThis.GH_TRANSACTION_CORE=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_TRANSACTION_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
