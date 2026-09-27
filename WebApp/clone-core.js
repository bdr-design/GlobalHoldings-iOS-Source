(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.GH_CLONE_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';
  function cloneFallback(value,seen=new Map()){
    if(value===null||typeof value!=='object'){
      if(typeof value==='function'||typeof value==='symbol'){const error=new Error('Value cannot be cloned');error.name='DataCloneError';throw error;}
      return value;
    }
    if(seen.has(value))return seen.get(value);
    if(value instanceof Date)return new Date(value.getTime());
    if(value instanceof RegExp)return new RegExp(value.source,value.flags);
    if(value instanceof ArrayBuffer)return value.slice(0);
    if(typeof SharedArrayBuffer!=='undefined'&&value instanceof SharedArrayBuffer){const out=new SharedArrayBuffer(value.byteLength);new Uint8Array(out).set(new Uint8Array(value));return out;}
    if(ArrayBuffer.isView(value)){
      if(value instanceof DataView){const buffer=cloneFallback(value.buffer,seen);return new DataView(buffer,value.byteOffset,value.byteLength);}
      return new value.constructor(value);
    }
    if(value instanceof Map){const out=new Map();seen.set(value,out);for(const [key,item] of value)out.set(cloneFallback(key,seen),cloneFallback(item,seen));return out;}
    if(value instanceof Set){const out=new Set();seen.set(value,out);for(const item of value)out.add(cloneFallback(item,seen));return out;}
    const out=Array.isArray(value)?new Array(value.length):Object.create(Object.getPrototypeOf(value)===null?null:Object.prototype);
    seen.set(value,out);
    for(const key of Object.keys(value))Object.defineProperty(out,key,{configurable:true,enumerable:true,writable:true,value:cloneFallback(value[key],seen)});
    return out;
  }
  function clone(value){
    if(value===undefined)return undefined;
    if(typeof globalThis.structuredClone==='function')try{return globalThis.structuredClone(value);}catch(_error){}
    return cloneFallback(value);
  }
  return Object.freeze({VERSION:'1.0.0',clone,cloneFallback});
});
