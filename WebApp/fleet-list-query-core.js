(()=>{
  'use strict';

  // A read-only query index for the fleet list.  It intentionally knows
  // nothing about the Fleet Store representation: every row enters through
  // GH_FLEET_DATA.scan and ids leave through GH_FLEET_DATA.idAtRow.
  //
  // owner/status/search values are a snapshot. Source or membership changes
  // rebuild it automatically; owners, names, facilities, phase or condition
  // edits must call invalidate(), or supply dependencyRevision when creating
  // a manager. Large first builds and uncached searches deliberately require
  // ensureAsync/queryAsync so a million-row pass never silently blocks a UI
  // event. Returned row arrays are caller-owned copies; idsView is the
  // allocation-free option and fails closed as soon as its signature changes.
  const VERSION='1.0.0';
  const ALL_OWNER=Symbol('all-fleet-owners');
  const EMPTY_ROWS=new Int32Array(0);
  const DEFAULT_SEARCH_FIELDS=Object.freeze(['id','name','model','baseFacility']);
  const INDEX_FIELDS=Object.freeze(['id','ownerCompanyId','companyId','phase','status','condition']);
  const VALID_STATUS=new Set(['all','moving','ready','idle','service']);
  const COMBINING_MARKS=/[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
  const now=()=>globalThis.performance?.now?.()??Date.now();

  function defaultNormalize(value){
    return String(value??'').normalize('NFKD').replace(COMBINING_MARKS,'').toLocaleLowerCase('ar').replace(/\s+/g,' ').trim();
  }
  function fleetAPI(explicit){
    const api=explicit||globalThis.GH_FLEET_DATA;
    if(!api||typeof api.scan!=='function'||typeof api.scanLength!=='function'||typeof api.membershipRevision!=='function'||typeof api.source!=='function'||typeof api.idAtRow!=='function')throw new Error('fleet-list-query-requires-public-fleet-data-api');
    return api;
  }
  function ownerKey(value){return value===undefined||value===null||value===''||value==='all'?ALL_OWNER:String(value);}
  function statusKey(value){value=String(value||'all');return VALID_STATUS.has(value)?value:'all';}
  function uniqueFields(searchFields){return [...new Set([...INDEX_FIELDS,...searchFields])];}

  // Chunked typed collectors avoid a temporary million-element boxed Array.
  class IntCollector{
    constructor(chunkSize=4096){this.chunkSize=chunkSize;this.chunks=[];this.tail=null;this.used=0;this.length=0;}
    push(value){if(!this.tail||this.used===this.tail.length){this.tail=new Int32Array(this.chunkSize);this.chunks.push(this.tail);this.used=0;}this.tail[this.used++]=value;this.length++;}
    finish(){if(!this.length)return EMPTY_ROWS;const out=new Int32Array(this.length);let at=0;for(let i=0;i<this.chunks.length;i++){const chunk=this.chunks[i],take=i===this.chunks.length-1?this.used:chunk.length;out.set(chunk.subarray(0,take),at);at+=take;}return out;}
  }
  function collectors(){return {all:new IntCollector(),moving:new IntCollector(),ready:new IntCollector(),idle:new IntCollector(),service:new IntCollector()};}
  function finishCollectors(value){return Object.freeze({all:value.all.finish(),moving:value.moving.finish(),ready:value.ready.finish(),idle:value.idle.finish(),service:value.service.finish()});}

  // Search text is retained once as UTF-8 rather than as one JS string per
  // asset.  Every value is wholly inside one chunk, making substring probes
  // allocation-free after the query itself has been encoded.
  class BytePool{
    constructor(chunkBytes){this.chunkBytes=Math.max(16_384,Math.floor(Number(chunkBytes)||1_048_576));this.chunks=[];this.used=[];this.active=-1;}
    fresh(size=this.chunkBytes){this.active=this.chunks.length;this.chunks.push(new Uint8Array(size));this.used.push(0);return this.active;}
    add(bytes){
      if(!bytes.length)return [0,0,0];
      if(bytes.length>this.chunkBytes){const index=this.chunks.length;this.chunks.push(bytes.slice());this.used.push(bytes.length);return [index,0,bytes.length];}
      if(this.active<0||this.used[this.active]+bytes.length>this.chunks[this.active].length)this.fresh();
      const index=this.active,offset=this.used[index];this.chunks[index].set(bytes,offset);this.used[index]+=bytes.length;return [index,offset,bytes.length];
    }
    finish(){for(let i=0;i<this.chunks.length;i++)if(this.used[i]!==this.chunks[i].length)this.chunks[i]=this.chunks[i].subarray(0,this.used[i]);return Object.freeze(this.chunks.slice());}
  }
  function containsBytes(haystack,offset,length,needle){
    if(!needle.length)return true;if(needle.length>length)return false;
    const end=offset+length-needle.length,first=needle[0];
    outer:for(let at=offset;at<=end;at++)if(haystack[at]===first){for(let k=1;k<needle.length;k++)if(haystack[at+k]!==needle[k])continue outer;return true;}
    return false;
  }

  function create(options={}){
    const F=fleetAPI(options.fleetData),normalize=typeof options.normalizeSearch==='function'?options.normalizeSearch:defaultNormalize;
    const searchFields=Object.freeze((Array.isArray(options.searchFields)&&options.searchFields.length?options.searchFields:DEFAULT_SEARCH_FIELDS).map(String));
    const fields=uniqueFields(searchFields),encoder=new TextEncoder(),chunkBytes=Math.max(16_384,Math.floor(Number(options.textChunkBytes)||1_048_576));
    const maxCacheEntries=Math.max(1,Math.floor(Number(options.maxCacheEntries)||12)),maxCacheRows=Math.max(1,Math.floor(Number(options.maxCacheRows)||1_000_000));
    const rawSyncLimit=options.maxSyncBuildRows===undefined?50_000:Number(options.maxSyncBuildRows),maxSyncBuildRows=rawSyncLimit===Infinity?Infinity:Math.max(0,Math.floor(rawSyncLimit)||0),rawQueryLimit=options.maxSyncQueryRows===undefined?50_000:Number(options.maxSyncQueryRows),maxSyncQueryRows=rawQueryLimit===Infinity?Infinity:Math.max(0,Math.floor(rawQueryLimit)||0),maxPendingQueries=Math.max(1,Math.floor(Number(options.maxPendingQueries)||2));
    const searchText=typeof options.searchText==='function'?options.searchText:null,dependencyRevision=typeof options.dependencyRevision==='function'?options.dependencyRevision:null;
    const indexes=new WeakMap(),pendingBuilds=new WeakMap(),invalidations=new WeakMap(),buildTickets=new WeakMap();
    const totals={builds:0,buildScanCalls:0,queryCalls:0,queryCacheHits:0,querySearchPasses:0,queryRowsTested:0,asyncYields:0,maxBuildSliceMs:0,maxQuerySliceMs:0};
    const buildSlices=[],querySlices=[];

    function requireState(state){if(!state||typeof state!=='object')throw new TypeError('fleet-list-query-state-required');return state;}
    function signature(state){return {source:F.source(state),membership:String(F.membershipRevision(state)),invalidation:invalidations.get(state)||0,dependency:dependencyRevision?dependencyRevision(state):undefined};}
    function sameSignature(a,b){return !!a&&a.source===b.source&&a.membership===b.membership&&a.invalidation===b.invalidation&&Object.is(a.dependency,b.dependency);}
    function issueBuild(state){const ticket=(buildTickets.get(state)||0)+1;buildTickets.set(state,ticket);return ticket;}
    function asyncBuildRequired(length){const error=new Error(`fleet-list-query-async-build-required:${length}`);error.code='FLEET_LIST_QUERY_ASYNC_BUILD_REQUIRED';return error;}
    function asyncQueryRequired(length){const error=new Error(`fleet-list-query-async-query-required:${length}`);error.code='FLEET_LIST_QUERY_ASYNC_QUERY_REQUIRED';return error;}
    function recordSlice(samples,key,value){totals[key]=Math.max(totals[key],value);samples.push(value);if(samples.length>2_048)samples.splice(0,1_024);}
    function p99(samples){if(!samples.length)return 0;const sorted=samples.slice().sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.99)-1)];}
    function rowSearchText(row){
      if(searchText)return normalize(searchText(row));
      let out='';for(const field of searchFields){const value=row[field];if(value===undefined||value===null||value==='')continue;out+=(out?' ':'')+String(value);}return normalize(out);
    }
    function makeBuilder(state,sig){
      const length=Math.max(0,Math.floor(Number(F.scanLength(state))||0)),pool=new BytePool(chunkBytes),textChunk=new Uint32Array(length),textOffset=new Uint32Array(length),textLength=new Uint32Array(length),byOwner=new Map(),global=collectors();let live=0;
      function record(key){let value=byOwner.get(key);if(!value){value=collectors();byOwner.set(key,value);}return value;}
      function append(target,rowIndex,moving,ready,idle,service){target.all.push(rowIndex);if(moving)target.moving.push(rowIndex);if(ready)target.ready.push(rowIndex);if(idle)target.idle.push(rowIndex);if(service)target.service.push(rowIndex);}
      function add(row,rowIndex){
        if(typeof row.id!=='string'||!row.id)return;
        const owner=String(row.ownerCompanyId||row.companyId||''),moving=row.phase==='moving'||row.status==='moving',ready=row.phase==='turnaround'||row.status==='available',idle=!['moving','turnaround'].includes(row.phase)&&row.status!=='moving',service=Number(row.condition)<85;
        append(global,rowIndex,moving,ready,idle,service);append(record(owner),rowIndex,moving,ready,idle,service);
        const bytes=encoder.encode(rowSearchText(row)),where=pool.add(bytes);textChunk[rowIndex]=where[0];textOffset[rowIndex]=where[1];textLength[rowIndex]=where[2];live++;
      }
      function finish(){
        const owners=new Map();for(const [key,value] of byOwner)owners.set(key,finishCollectors(value));
        const index={state,source:sig.source,membership:sig.membership,invalidation:sig.invalidation,dependency:sig.dependency,scanLength:length,live,owners,global:finishCollectors(global),textChunks:pool.finish(),textChunk,textOffset,textLength,cache:new Map(),cacheRows:0,pendingQueries:new Map(),pendingSequence:0,builtAt:Date.now()};
        return index;
      }
      return {add,finish};
    }
    function publish(state,sig,builder,ticket){
      const after=signature(state);if(!sameSignature(sig,after))throw new Error('fleet-membership-changed-during-query-index-build');
      if(buildTickets.get(state)!==ticket){const current=indexes.get(state);if(sameSignature(current,after))return current;throw new Error('fleet-list-query-index-build-superseded');}
      const index=builder.finish();indexes.set(state,index);totals.builds++;return index;
    }
    function build(state){
      requireState(state);
      const length=Math.max(0,Math.floor(Number(F.scanLength(state))||0));if(length>maxSyncBuildRows)throw asyncBuildRequired(length);
      const sig=signature(state),ticket=issueBuild(state),builder=makeBuilder(state,sig),started=now();totals.buildScanCalls++;F.scan(state,fields,builder.add);recordSlice(buildSlices,'maxBuildSliceMs',now()-started);return publish(state,sig,builder,ticket);
    }
    function ensure(state){requireState(state);const sig=signature(state),current=indexes.get(state);return sameSignature(current,sig)?current:build(state);}
    async function ensureAsync(state,{batchRows=1_024,yieldFn}={}){
      requireState(state);
      const sig=signature(state),current=indexes.get(state);if(sameSignature(current,sig))return current;
      const already=pendingBuilds.get(state);if(already&&sameSignature(already.signature,sig))return already.promise;
      const ticket=issueBuild(state),schedule=typeof yieldFn==='function'?yieldFn:()=>new Promise(resolve=>setTimeout(resolve,0)),step=Math.max(256,Math.floor(Number(batchRows)||1_024)),builder=makeBuilder(state,sig),limit=Math.max(0,Math.floor(Number(F.scanLength(state))||0));
      const promise=(async()=>{let from=0;while(from<limit){const started=now();totals.buildScanCalls++;const next=F.scan(state,fields,builder.add,{from,to:Math.min(limit,from+step)});recordSlice(buildSlices,'maxBuildSliceMs',now()-started);from=Math.max(from+1,Number(next)||0);if(from<limit){totals.asyncYields++;await schedule();if(!sameSignature(sig,signature(state)))throw new Error('fleet-membership-changed-during-query-index-build');}}return publish(state,sig,builder,ticket);})();
      pendingBuilds.set(state,{signature:sig,promise});try{return await promise;}finally{if(pendingBuilds.get(state)?.promise===promise)pendingBuilds.delete(state);}
    }
    function bucket(index,owner,status){const record=owner===ALL_OWNER?index.global:index.owners.get(owner);return record?.[status]||EMPTY_ROWS;}
    function cacheKey(owner,status,query){return `${owner===ALL_OWNER?'*':owner}\u0000${status}\u0000${query}`;}
    function cacheGet(index,key){const hit=index.cache.get(key);if(!hit)return null;index.cache.delete(key);index.cache.set(key,hit);totals.queryCacheHits++;return hit.rows;}
    function cachePut(index,key,meta,rows){
      if(rows.length>maxCacheRows)return rows;
      const old=index.cache.get(key);if(old){index.cacheRows-=old.rows.length;index.cache.delete(key);}
      while(index.cache.size&&((index.cache.size>=maxCacheEntries)||(index.cacheRows+rows.length>maxCacheRows))){const oldest=index.cache.keys().next().value,entry=index.cache.get(oldest);index.cache.delete(oldest);index.cacheRows-=entry.rows.length;}
      index.cache.set(key,{...meta,rows});index.cacheRows+=rows.length;return rows;
    }
    function queryPlan(index,filter){
      const owner=ownerKey(filter?.owner??filter?.ownerCompanyId),status=statusKey(filter?.status),query=normalize(filter?.search??filter?.query??''),key=cacheKey(owner,status,query);
      if(!query)return {owner,status,query,key,rows:bucket(index,owner,status),cached:true};
      const exact=cacheGet(index,key);if(exact)return {owner,status,query,key,rows:exact,cached:true};
      let candidate=bucket(index,owner,status),prefixLength=-1;
      for(const entry of index.cache.values())if(entry.owner===owner&&entry.status===status&&query.startsWith(entry.query)&&entry.query.length>prefixLength){candidate=entry.rows;prefixLength=entry.query.length;}
      return {owner,status,query,key,candidate,needle:encoder.encode(query),cached:false};
    }
    function matches(index,row,needle){const length=index.textLength[row];return containsBytes(index.textChunks[index.textChunk[row]],index.textOffset[row],length,needle);}
    function runQuery(index,filter){
      totals.queryCalls++;const plan=queryPlan(index,filter);if(plan.cached)return plan.rows;
      if(plan.candidate.length>maxSyncQueryRows)throw asyncQueryRequired(plan.candidate.length);
      totals.querySearchPasses++;const found=new IntCollector();for(const row of plan.candidate){totals.queryRowsTested++;if(matches(index,row,plan.needle))found.push(row);}
      const rows=found.finish();return cachePut(index,plan.key,{owner:plan.owner,status:plan.status,query:plan.query},rows);
    }
    function query(state,filter={}){return runQuery(ensure(state),filter).slice();}
    async function queryAsync(state,filter={},options={}){
      totals.queryCalls++;const index=await ensureAsync(state,options),signal=options.signal;if(signal?.aborted){const error=new Error('fleet-list-query-aborted');error.code='FLEET_LIST_QUERY_ABORTED';throw error;}
      const plan=queryPlan(index,filter);if(plan.cached)return plan.rows.slice();
      const pending=[...index.pendingQueries.values()].find(entry=>entry.key===plan.key&&entry.signal===signal);if(pending)return (await pending.promise).slice();
      if(index.pendingQueries.size>=maxPendingQueries){const error=new Error('fleet-list-query-pending-limit');error.code='FLEET_LIST_QUERY_PENDING_LIMIT';throw error;}
      const schedule=typeof options.yieldFn==='function'?options.yieldFn:()=>new Promise(resolve=>setTimeout(resolve,0)),batchRows=Math.max(256,Math.floor(Number(options.batchRows)||4_096));
      const valid=()=>!signal?.aborted&&indexes.get(state)===index&&sameSignature(index,signature(state));
      const promise=(async()=>{totals.querySearchPasses++;const found=new IntCollector();for(let from=0;from<plan.candidate.length;from+=batchRows){if(!valid())throw new Error(signal?.aborted?'fleet-list-query-aborted':'fleet-membership-changed-during-list-query');const started=now(),to=Math.min(plan.candidate.length,from+batchRows);for(let i=from;i<to;i++){const row=plan.candidate[i];totals.queryRowsTested++;if(matches(index,row,plan.needle))found.push(row);}recordSlice(querySlices,'maxQuerySliceMs',now()-started);if(to<plan.candidate.length){totals.asyncYields++;await schedule();}}if(!valid())throw new Error(signal?.aborted?'fleet-list-query-aborted':'fleet-membership-changed-during-list-query');return cachePut(index,plan.key,{owner:plan.owner,status:plan.status,query:plan.query},found.finish());})();
      const pendingId=++index.pendingSequence,entry={key:plan.key,signal,promise};index.pendingQueries.set(pendingId,entry);try{return (await promise).slice();}finally{if(index.pendingQueries.get(pendingId)===entry)index.pendingQueries.delete(pendingId);}
    }
    function queryIds(state,filter={}){const rows=runQuery(ensure(state),filter),ids=new Array(rows.length);for(let i=0;i<rows.length;i++)ids[i]=F.idAtRow(state,rows[i]);return ids;}
    function idsView(state,filter={}){
      const index=ensure(state),rows=runQuery(index,filter);
      const valid=()=>indexes.get(state)===index&&sameSignature(index,signature(state));
      return Object.freeze({length:rows.length,rowAt(position){return valid()?rows[position]:undefined;},idAt(position){return valid()?F.idAtRow(state,rows[position]):undefined;},slice(from=0,to=rows.length){if(!valid())return [];const start=Math.max(0,Math.floor(Number(from)||0)),end=Math.max(start,Math.min(rows.length,Math.floor(Number(to)||0)));const out=new Array(end-start);for(let i=start;i<end;i++)out[i-start]=F.idAtRow(state,rows[i]);return out;}});
    }
    function invalidate(state){if(!state||typeof state!=='object')return false;invalidations.set(state,(invalidations.get(state)||0)+1);issueBuild(state);const removed=indexes.delete(state);return removed||pendingBuilds.has(state);}
    function ready(state){if(!state||typeof state!=='object')return false;return sameSignature(indexes.get(state),signature(state));}
    function stats(state){const index=state&&typeof state==='object'?indexes.get(state):null;return Object.freeze({...totals,buildSliceP99Ms:p99(buildSlices),querySliceP99Ms:p99(querySlices),indexed:Boolean(index),ready:ready(state),membership:index?.membership??null,liveRows:index?.live??0,scanLength:index?.scanLength??0,owners:index?.owners.size??0,cacheEntries:index?.cache.size??0,cacheRows:index?.cacheRows??0,pendingQueries:index?.pendingQueries.size??0,textBytes:index?index.textChunks.reduce((sum,chunk)=>sum+chunk.byteLength,0):0});}
    return Object.freeze({VERSION,ready,ensure,ensureAsync,query,queryAsync,queryIds,idsView,invalidate,stats,normalizeSearch:normalize});
  }

  let defaultManager=null;
  function manager(){if(!defaultManager)defaultManager=create();return defaultManager;}
  const API=Object.freeze({VERSION,create,normalizeSearch:defaultNormalize,ready:(...args)=>manager().ready(...args),ensure:(...args)=>manager().ensure(...args),ensureAsync:(...args)=>manager().ensureAsync(...args),query:(...args)=>manager().query(...args),queryAsync:(...args)=>manager().queryAsync(...args),queryIds:(...args)=>manager().queryIds(...args),idsView:(...args)=>manager().idsView(...args),invalidate:(...args)=>manager().invalidate(...args),stats:(...args)=>manager().stats(...args)});
  globalThis.GH_FLEET_LIST_QUERY=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_LIST_QUERY=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
