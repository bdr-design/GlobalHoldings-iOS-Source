'use strict';

((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_MEDIA_ASSET_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const VERSION='GH-MEDIA-ASSET-340.2.0';
  function normalizeSource(value){
    const source=String(value||'').trim();
    if(!source.startsWith('assets/images/')||source.length>240||/[\\?#]/.test(source)||source.split('/').some(part=>!part||part==='.'||part==='..')||!(/\.(?:png|webp|jpe?g|svg)$/i).test(source))return '';
    return source;
  }
  function create(options={}){
    const imageFactory=options.imageFactory,maxConcurrent=Math.max(1,Math.min(4,Math.floor(Number(options.maxConcurrent)||3))),maxQueued=Math.max(1,Math.min(128,Math.floor(Number(options.maxQueued)||48))),maxCached=Math.max(1,Math.min(64,Math.floor(Number(options.maxCached)||24))),clock=typeof options.nowMs==='function'?options.nowMs:()=>Date.now();
    let active=0,sequence=0,disposed=false,requested=0,loaded=0,failed=0,deduplicated=0,dropped=0;
    const cache=new Map(),inFlight=new Map(),queue=[];
    function touch(source){const entry=cache.get(source);if(!entry)return null;cache.delete(source);entry.at=clock();cache.set(source,entry);return entry;}
    function trim(){while(cache.size>maxCached)cache.delete(cache.keys().next().value);}
    function finish(task,ok,error=null){
      active=Math.max(0,active-1);inFlight.delete(task.source);
      const result={ok,src:task.source,error:error?String(error?.message||error):null};
      if(ok){loaded++;cache.set(task.source,{at:clock()});trim();}else{failed++;try{options.onFailure?.(result);}catch{}}
      task.resolve(result);pump();
    }
    function load(task){
      let image;try{image=imageFactory?.();if(!image)throw new Error('media-image-unavailable');image.decoding='async';image.loading='eager';image.src=task.source;}
      catch(error){finish(task,false,error);return;}
      if(typeof image.decode==='function'){Promise.resolve().then(()=>image.decode()).then(()=>finish(task,true),error=>finish(task,false,error));return;}
      if(image.complete){finish(task,image.naturalWidth>0,image.naturalWidth>0?null:new Error('media-image-empty'));return;}
      image.onload=()=>finish(task,true);image.onerror=error=>finish(task,false,error||new Error('media-image-load-failed'));
    }
    function pump(){
      if(disposed)return;
      while(active<maxConcurrent&&queue.length){const task=queue.shift();if(task.done)continue;task.started=true;active++;load(task);}
    }
    function request(value,priority=0){
      requested++;const source=normalizeSource(value);if(disposed||!source)return Promise.resolve({ok:false,src:'',error:disposed?'media-engine-disposed':'media-source-rejected'});
      if(touch(source))return Promise.resolve({ok:true,src:source,cached:true,error:null});
      const existing=inFlight.get(source);if(existing){deduplicated++;if(!existing.started){existing.priority=Math.max(existing.priority,Number(priority)||0);queue.sort((a,b)=>b.priority-a.priority||a.sequence-b.sequence);}return existing.promise;}
      if(queue.length>=maxQueued){dropped++;try{options.onDrop?.({src:source,priority:Number(priority)||0,queued:queue.length});}catch{}return Promise.resolve({ok:false,src:source,error:'media-queue-full'});}
      let resolve;const promise=new Promise(done=>{resolve=done;}),task={source,priority:Number(priority)||0,sequence:sequence++,promise,resolve,started:false,done:false};inFlight.set(source,task);queue.push(task);queue.sort((a,b)=>b.priority-a.priority||a.sequence-b.sequence);pump();return promise;
    }
    function requestMany(sources,priority=0){return Promise.all((Array.isArray(sources)?sources:[]).map(source=>request(source,priority)));}
    function metrics(){return Object.freeze({version:VERSION,active,queued:queue.length,cached:cache.size,requested,loaded,failed,deduplicated,dropped,disposed});}
    function dispose(){if(disposed)return;disposed=true;for(const task of queue.splice(0)){task.done=true;inFlight.delete(task.source);task.resolve({ok:false,src:task.source,error:'media-engine-disposed'});}cache.clear();}
    return Object.freeze({request,requestMany,metrics,dispose,version:VERSION});
  }
  return Object.freeze({VERSION,normalizeSource,create});
});
