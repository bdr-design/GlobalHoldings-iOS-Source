'use strict';
// Build 358: the fleet event engine on its own thread. The worker keeps a replica of the fleet store (records, value
// table, extras) and runs GH_FLEET_EVENTS.advance on it with the same code as the main thread; the main thread replays
// the result (rows written, values interned) inside the simulation slice's transaction. Each step stays open here until
// the main thread settles it: 'commit' keeps it, 'rollback' restores the replica exactly (its own store journal).
// Messages in:  replica (whole store), sync (rows and values changed on the main thread), routes, specs, advance, settle.
// Messages out: ready, result (or fallback with a reason: the main thread then runs that step itself), error.
importScripts('fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js');

const STORE=self.GH_FLEET_STORE,EVENTS=self.GH_FLEET_EVENTS,VERSION='GH-FLEET-ENGINE-WORKER-358.1.0';
let store=null,routes=new Map(),specs={},open=null;

const routeKey=(routeId,base)=>String(routeId||'')+'\u0000'+String(base||'');
class MissingRoute extends Error{}
function resolveRoute(routeId,base){
  const key=routeKey(routeId,base);
  if(!routes.has(key))throw new MissingRoute(`route-plan-missing:${String(routeId).slice(0,80)}`);
  return routes.get(key);
}
function catalogSpecs(asset){return asset?.specs?null:(specs[asset?.type]?.[asset?.catalogId]||null);}

function advance(message){
  if(!store)return {fallback:'replica-missing'};
  if(open)return {fallback:'previous-step-unsettled'};
  const length=store.length,structure=store.structure,revision=store.revision,valuesLength=store.values.length;
  const journal=STORE.beginJournal(store);
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
  open={id:message.id,journal};
  const budget=Math.max(1,Math.floor(Number(message.budget)||1500));
  return {out,indices,bytes:rows.bytes,extras:rows.extras,values,revisionDelta:store.revision-revision,staticRows:out.slow>0,
    nextBudgetTime:EVENTS.timeForEventBudget(store,budget)};
}

self.addEventListener('message',event=>{
  const message=event?.data||{};
  try{
    switch(message.type){
      case 'replica':
        if(open){STORE.endJournal(open.journal);open=null;}
        store=STORE.importReplica(message.payload);
        self.postMessage({type:'ready',version:VERSION,id:message.id,length:store.length});
        return;
      case 'sync':{
        if(!store||open){self.postMessage({type:'error',version:VERSION,id:message.id,error:open?'sync-while-step-open':'replica-missing'});return;}
        // Rows appended on the main thread (purchases) arrive with their records; a shorter store means a compaction,
        // which the main thread sends as a whole replica instead.
        if(message.length<store.length)throw new Error('sync-length-shrank');
        if(message.length>store.length){STORE.ensureCapacity(store,message.length);store.length=message.length;}
        if(message.values)STORE.applyValueChanges(store,message.values);
        if(message.rows&&message.rows.indices.length)STORE.writeRows(store,message.rows.indices,message.rows.bytes,message.rows.extras,{staticRows:true});
        store.live=message.live;store.structure=message.structure;
        return;
      }
      case 'routes':
        if(message.replace)routes=new Map();
        // Frozen like the main thread's plans, so the engine treats an unchanged plan the same way.
        for(const [key,plan] of message.plans||[])routes.set(key,plan&&typeof plan==='object'?Object.freeze(plan):null);
        return;
      case 'specs':specs=message.specs&&typeof message.specs==='object'?message.specs:{};return;
      case 'advance':{
        const started=performance.now(),result=advance(message),ms=performance.now()-started;
        if(result.fallback){self.postMessage({type:'result',version:VERSION,id:message.id,fallback:result.fallback,ms});return;}
        self.postMessage({type:'result',version:VERSION,id:message.id,ms,...result},[result.bytes,result.indices.buffer]);
        return;
      }
      case 'settle':
        if(!open||open.id!==message.id)return;
        if(message.outcome==='commit')STORE.endJournal(open.journal);else STORE.rollbackJournal(open.journal);
        open=null;
        return;
      default:return;
    }
  }catch(error){
    self.postMessage({type:'error',version:VERSION,id:message.id,error:String(error?.message||error).slice(0,240)});
  }
});
