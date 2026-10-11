'use strict';
// Build 358: the fleet event engine on its own thread. The worker keeps a replica of the fleet store (records, value
// table, extras) and runs GH_FLEET_EVENTS.advance on it with the same code as the main thread; the main thread replays
// the result (rows written, values interned) inside the simulation slice's transaction. Each step stays open here until
// the main thread settles it: 'commit' keeps it, 'rollback' restores the replica exactly (its own store journal).
// Messages in:  replica (whole store), seed (Build 372: the chunk buffers a decoded store came from), compact (the main
//               thread's compaction, by its removed rows), sync (rows and values changed on the main thread), columns
//               (fields rewritten wholesale), routes, specs, advance, settle, health (Build 372: the health check's fleet
//               issues, fleet-health-core, on the replica), classes (the save check's classes of rows and id check on
//               the replica), query (a fleet-query-core pass on the replica), inspect (a copy of the replica, for gates).
// Messages out: ready, route-keys (after a replica or seed: the (route, base) pairs its rows name, for the main thread to
//               resolve), result (or fallback with a reason: the main thread then runs that step itself), error.
importScripts('fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js','fleet-access-core.js','fleet-health-core.js','fleet-query-core.js');

const STORE=self.GH_FLEET_STORE,EVENTS=self.GH_FLEET_EVENTS,VERSION='GH-FLEET-ENGINE-WORKER-372.1.0';
let store=null,routes=new Map(),specs={},open=null;

const routeKey=(routeId,base)=>String(routeId||'')+'\u0000'+String(base||'');
class MissingRoute extends Error{}
function resolveRoute(routeId,base){
  const key=routeKey(routeId,base);
  if(!routes.has(key))throw new MissingRoute(`route-plan-missing:${String(routeId).slice(0,80)}`);
  return routes.get(key);
}
// The pairs every row names (its route with its base), as the main thread named them before Build 372, for its plans.
function routeKeys(){
  const u32=STORE.views(store).u32,values=store.values,WR=STORE.WORDS_PER_ROW,W_ROUTE=STORE.O.routeId,W_BASE=STORE.O.baseFacility,pairs=new Set(),keys=[];
  for(let index=0;index<store.length;index++){
    const routeRef=u32[index*WR+W_ROUTE];if(!routeRef)continue;const baseRef=u32[index*WR+W_BASE],pair=routeRef*4294967296+baseRef;
    if(pairs.has(pair))continue;pairs.add(pair);const routeId=values[routeRef];if(routeId)keys.push(routeKey(routeId,baseRef?values[baseRef]:''));
  }
  return keys;
}
function imported(importId){self.postMessage({type:'ready',version:VERSION,id:0,length:store.length});self.postMessage({type:'route-keys',version:VERSION,importId,keys:routeKeys()});}
function catalogSpecs(asset){return asset?.specs?null:(specs[asset?.type]?.[asset?.catalogId]||null);}

function advance(message){
  if(!store)return {fallback:'replica-missing'};
  if(open)return {fallback:'previous-step-unsettled'};
  const length=store.length,structure=store.structure,revision=store.revision,valuesLength=store.values.length;
  const journal=STORE.beginJournal(store),staticBefore=STORE.staticSnapshot(store);
  let out;
  try{
    out=EVENTS.advance(store,{from:message.from,to:message.to,context:message.context,resolveRoute,catalogSpecs,tripAlertLimit:message.tripAlertLimit,order:message.order,...(Number.isFinite(message.maxEvents)?{maxEvents:message.maxEvents}:{})});
  }catch(error){
    STORE.rollbackJournal(journal);
    return {fallback:error instanceof MissingRoute?String(error.message):`engine-error:${String(error?.message||error).slice(0,160)}`};
  }
  if(store.length!==length||store.structure!==structure){STORE.rollbackJournal(journal);return {fallback:'structure-changed'};}
  const log=journal.log,indices=new Int32Array(log.count);
  for(let k=0;k<log.count;k++)indices[k]=log.rows[k];
  indices.sort();
  const rows=STORE.readRows(store,indices),values=[];
  // Reused slots first (any order), then appended slots in ascending order: the main thread interns them at these numbers.
  for(const ref of journal.reused)values.push([ref,store.values[ref]]);
  for(let ref=valuesLength;ref<store.values.length;ref++)values.push([ref,store.values[ref]]);
  open={kind:'step',id:message.id,journal};
  const budget=Math.max(1,Math.floor(Number(message.budget)||1500));
  // Build 371: the chunks this step wrote outside the fast path (staticRows used to name every row once any was slow,
  // so a moving million-asset fleet dropped every static class table on each slice).
  return {out,indices,bytes:rows.bytes,extras:rows.extras,values,revisionDelta:store.revision-revision,staticRows:STORE.staticChunksSince(store,staticBefore),
    nextBudgetTime:EVENTS.timeForEventBudget(store,budget)};
}

function beginWindow(message){
  if(!store)throw new Error('window-replica-missing');
  if(open)throw new Error('window-while-step-open');
  const from=Number(message.from),target=Number(message.target);if(!Number.isFinite(from)||!Number.isFinite(target)||target<=from)throw new Error('window-range-invalid');
  open={kind:'window',id:message.id,journal:STORE.beginJournal(store),staticBefore:STORE.staticSnapshot(store),length:store.length,structure:store.structure,valuesLength:store.values.length,nextFrom:from,target,nextSeq:0};
}
function advanceWindow(message){
  if(!store)return {fallback:'replica-missing'};
  if(!open||open.kind!=='window'||open.id!==message.windowId)return {fallback:'window-session-missing'};
  const from=Number(message.from),to=Number(message.to),seq=Number(message.seq);
  if(seq!==open.nextSeq||!Number.isFinite(from)||!Number.isFinite(to)||Math.abs(from-open.nextFrom)>1e-6||to<=from||to>open.target+1e-6){STORE.rollbackJournal(open.journal);open=null;return {fallback:'window-sequence-invalid'};}
  const revision=store.revision;
  let out;
  try{
    out=EVENTS.advance(store,{from:message.from,to:message.to,context:message.context,resolveRoute,catalogSpecs,tripAlertLimit:message.tripAlertLimit,order:message.order,...(Number.isFinite(message.maxEvents)?{maxEvents:message.maxEvents}:{})});
  }catch(error){
    STORE.rollbackJournal(open.journal);open=null;
    return {fallback:error instanceof MissingRoute?String(error.message):`engine-error:${String(error?.message||error).slice(0,160)}`};
  }
  if(store.length!==open.length||store.structure!==open.structure){STORE.rollbackJournal(open.journal);open=null;return {fallback:'structure-changed'};}
  // The outer journal contains every row touched since the start of the window.
  // The main side removes rows already equal to its last applied checkpoint, so
  // repeated hourly steps retain the exact per-step revision and data semantics.
  const log=open.journal.log,indices=new Int32Array(log.count);
  for(let k=0;k<log.count;k++)indices[k]=log.rows[k];
  indices.sort();
  const rows=STORE.readRows(store,indices),values=[];
  for(const ref of open.journal.reused)values.push([ref,store.values[ref]]);
  for(let ref=open.valuesLength;ref<store.values.length;ref++)values.push([ref,store.values[ref]]);
  const budget=Math.max(1,Math.floor(Number(message.budget)||1500));
  open.nextFrom=Number(out.completeTo);open.nextSeq++;
  if(!Number.isFinite(open.nextFrom)||open.nextFrom<from-1e-6||open.nextFrom>to+1e-6){STORE.rollbackJournal(open.journal);open=null;return {fallback:'window-complete-to-invalid'};}
  // The chunks written outside the fast path since the window began (the rows sent are those of the whole window too).
  return {windowId:message.windowId,seq,from,to,out,indices,bytes:rows.bytes,extras:rows.extras,values,revisionDelta:store.revision-revision,staticRows:STORE.staticChunksSince(store,open.staticBefore),
    nextBudgetTime:EVENTS.timeForEventBudget(store,budget)};
}

self.addEventListener('message',event=>{
  const message=event?.data||{};
  try{
    switch(message.type){
      case 'replica':
        if(open){STORE.rollbackJournal(open.journal);open=null;}
        store=STORE.importReplica(message.payload);imported(message.importId);
        return;
      // Build 372: the chunks the main thread's store was decoded from (moved here, not copied there), assembled here.
      case 'seed':{
        if(open){STORE.rollbackJournal(open.journal);open=null;}
        const meta=message.meta||{},byteLength=Number(meta.byteLength),chunkBytes=Number(meta.chunkBytes),chunks=Array.isArray(message.chunks)?message.chunks:[];
        const length=Number(meta.length),bytes=length*STORE.STRIDE;
        if(!Number.isSafeInteger(byteLength)||!Number.isSafeInteger(bytes)||bytes<0||bytes>byteLength||!(chunkBytes>0)||chunks.length!==Math.ceil(byteLength/chunkBytes))throw new Error('fleet-seed-invalid');
        // The chunks are the record buffer as saved (its capacity); the replica keeps the store's rows.
        const rows=new Uint8Array(bytes);
        for(let index=0;index<chunks.length;index++){
          const chunk=chunks[index],view=chunk instanceof ArrayBuffer?new Uint8Array(chunk):null,start=index*chunkBytes;
          if(!view||view.length!==Math.min(chunkBytes,byteLength-start))throw new Error('fleet-seed-chunk-invalid');
          if(start<bytes)rows.set(view.subarray(0,Math.min(view.length,bytes-start)),start);
        }
        store=STORE.importReplica({length:meta.length,live:meta.live,structure:meta.structure,revision:meta.revision,values:message.values,extras:message.extras,rows:rows.buffer});
        imported(message.importId);
        return;
      }
      case 'compact':
        if(!store||open){self.postMessage({type:'error',version:VERSION,id:message.id,error:open?'compact-while-step-open':'replica-missing'});return;}
        STORE.compactRowsAt(store,{dead:message.dead,length:message.length});
        return;
      case 'sync':{
        if(!store||open){self.postMessage({type:'error',version:VERSION,id:message.id,error:open?'sync-while-step-open':'replica-missing'});return;}
        // Rows appended on the main thread (purchases) arrive with their records. Build 372: a shorter store is a rollback
        // of rows appended inside a transaction (compactions arrive before, as 'compact'): those rows go, as there.
        if(message.length<store.length)STORE.truncateReplica(store,message.length);
        if(message.length>store.length){STORE.ensureCapacity(store,message.length);store.length=message.length;}
        if(message.values)STORE.applyValueChanges(store,message.values);
        if(message.rows&&message.rows.indices.length)STORE.writeRows(store,message.rows.indices,message.rows.bytes,message.rows.extras,{staticRows:true});
        store.live=message.live;store.structure=message.structure;
        return;
      }
      // Build 359: columns the main thread rewrote wholesale (after the rows of the same exchange).
      case 'columns':{
        if(!store||open){self.postMessage({type:'error',version:VERSION,id:message.id,error:open?'columns-while-step-open':'replica-missing'});return;}
        STORE.writeColumns(store,message.payload,{reported:message.reported||[]});
        return;
      }
      case 'routes':
        if(message.replace)routes=new Map();
        // Frozen like the main thread's plans, so the engine treats an unchanged plan the same way.
        for(const [key,plan] of message.plans||[])routes.set(key,plan&&typeof plan==='object'?Object.freeze(plan):null);
        return;
      // Build 372: the health check's fleet issues on the replica (the main thread asks only with no step open, so the
      // replica is the store as of its last exchange).
      case 'health':{
        if(!store||open||!self.GH_FLEET_HEALTH||!self.GH_FLEET_DATA){self.postMessage({type:'health',version:VERSION,id:message.id,unavailable:!store?'replica-missing':open?'step-open':'health-core-missing'});return;}
        const started=performance.now(),issues=self.GH_FLEET_HEALTH.assetIssues({fleet:store,simSeconds:Number(message.simSeconds)||0},self.GH_FLEET_DATA);
        self.postMessage({type:'health',version:VERSION,id:message.id,issues,ms:performance.now()-started});
        return;
      }
      // Build 372: the fleet's classes of rows (GH_FLEET_STORE.forEachClass: each class's first row and size, then its
      // numeric extremes) and the id collision check, on the replica, for the save check (save-schema validationSteps).
      // The main thread asks only when the replica is its store (no step it has not replayed, nothing unsent), so an open
      // step it replayed is part of both.
      case 'classes':{
        if(!store){self.postMessage({type:'classes',version:VERSION,id:message.id,unavailable:'replica-missing'});return;}
        const started=performance.now(),rows=[];
        STORE.forEachClass(store,Array.isArray(message.fields)?message.fields:[],(row,count,info)=>{rows.push([row,count,info.index,info.members]);},{numeric:Array.isArray(message.numeric)?message.numeric:[]});
        const ids=message.ids?STORE.idCollisions(store):null;
        self.postMessage({type:'classes',version:VERSION,id:message.id,rows,ids,ms:performance.now()-started});
        return;
      }
      // Build 372: a fleet pass of fleet-query-core on the replica (asked, like 'classes', only when it is the main
      // thread's store). No legacy owner table here: a pass that needs one answers {legacy:true}.
      case 'query':{
        if(!store||!self.GH_FLEET_QUERY||!self.GH_FLEET_DATA){self.postMessage({type:'query',version:VERSION,id:message.id,unavailable:!store?'replica-missing':'query-core-missing'});return;}
        const started=performance.now(),result=self.GH_FLEET_QUERY.run(String(message.name),{fleet:store,simSeconds:Number(message.simSeconds)||0},self.GH_FLEET_DATA,message.params||{});
        self.postMessage({type:'query',version:VERSION,id:message.id,result,ms:performance.now()-started});
        return;
      }
      // A copy of the replica, on request only (the differential gates compare it with the main thread's store).
      case 'inspect':{
        if(!store){self.postMessage({type:'inspect',version:VERSION,id:message.id,missing:true});return;}
        const rows=store.rows.slice(0,store.length*STORE.STRIDE);
        self.postMessage({type:'inspect',version:VERSION,id:message.id,length:store.length,live:store.live,structure:store.structure,values:store.values,extras:store.extras,rows},[rows]);
        return;
      }
      case 'specs':specs=message.specs&&typeof message.specs==='object'?message.specs:{};return;
      case 'advance':{
        const started=performance.now(),result=advance(message),ms=performance.now()-started;
        if(result.fallback){self.postMessage({type:'result',version:VERSION,id:message.id,fallback:result.fallback,ms});return;}
        self.postMessage({type:'result',version:VERSION,id:message.id,ms,...result},[result.bytes,result.indices.buffer]);
        return;
      }
      case 'window-begin':beginWindow(message);return;
      case 'window-advance':{
        const started=performance.now(),result=advanceWindow(message),ms=performance.now()-started;
        if(result.fallback){self.postMessage({type:'result',version:VERSION,id:message.id,fallback:result.fallback,ms});return;}
        self.postMessage({type:'result',version:VERSION,id:message.id,ms,...result},[result.bytes,result.indices.buffer]);
        return;
      }
      case 'settle':
        if(!open||open.kind!=='step'||open.id!==message.id)return;
        if(message.outcome==='commit')STORE.endJournal(open.journal);else STORE.rollbackJournal(open.journal);
        open=null;
        return;
      case 'window-settle':
        if(!open||open.kind!=='window'||open.id!==message.id)return;
        if(message.outcome==='commit')STORE.endJournal(open.journal);else STORE.rollbackJournal(open.journal);
        open=null;
        return;
      default:return;
    }
  }catch(error){
    self.postMessage({type:'error',version:VERSION,id:message.id,error:String(error?.message||error).slice(0,240)});
  }
});
