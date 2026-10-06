// Build 358: main-thread side of the fleet engine thread (fleet-engine-worker.js). The event engine's work, the larger
// part of every simulation slice and of every frame during a calendar advance, runs on a Worker over a replica of the
// fleet store; this side keeps the replica in step and replays each result inside the slice's transaction.
//
// - Before each step the replica receives what changed here since the last exchange: rows from the store's dirty log
//   (purchases, sales, route assignments), value-table changes by reference number, route plans for every
//   (route, base) the fleet can reach. When the dirty log cannot explain every change (another drainer, a compaction,
//   a new record buffer), the whole store is sent again.
// - request() posts the step; apply() replays it: values interned at the worker's numbers (STORE.internAt), rows written
//   through the store's toucher (journaled, so the transaction's rollback restores them), the engine's revision count.
//   The worker keeps its step open until the transaction settles it (commit or rollback), so both sides stay equal.
// - Anything unexpected (the store changed since the request, a value at another number, a route plan the worker does
//   not hold, a worker error) makes apply() refuse; the caller then runs the step itself on this thread, exactly as
//   before, and the next exchange sends the whole store.
(()=>{
  'use strict';
  const VERSION='1.0.0';
  const STORE=globalThis.GH_FLEET_STORE||(typeof require==='function'?require('./fleet-store-core.js'):null);
  if(!STORE)throw new Error('Fleet engine thread requires the Fleet Store core');
  const W_ROUTE=STORE.O.routeId,W_BASE=STORE.O.baseFacility,WR=STORE.WORDS_PER_ROW;
  const routeKey=(routeId,base)=>String(routeId||'')+'\u0000'+String(base||'');

  function create({workerFactory,resolveRoute,catalogSpecs,routesRevision=()=>0,clock=()=>performance.now(),timeoutMs=15000}={}){
    let worker=null,disabled=null,nextId=1,needsFull=true,synced=null,routeTable=new Map(),routesAt=null,pending=null,lastBudgetTime=Infinity;
    const tickets=new Map(),waiters=[],stats={requests:0,applied:0,fallbacks:0,fullSyncs:0,incrementalSyncs:0,columnSyncs:0,rowsSent:0,lastWorkerMs:0,lastApplyMs:0,lastSyncMs:0,maxWorkerMs:0,maxApplyMs:0,maxSyncMs:0,maxFullSyncMs:0,lastReason:'',fullSyncReasons:{}};
    const settleWaiters=()=>{if(pending)return;while(waiters.length)waiters.shift()();};
    function disable(reason){
      if(disabled)return;disabled=String(reason||'disabled');stats.lastReason=disabled;
      try{worker?.terminate?.();}catch(_error){}worker=null;
      for(const ticket of tickets.values()){ticket.status='failed';ticket.reason=disabled;clearTimeout(ticket.timer);}
      tickets.clear();pending=null;settleWaiters();
    }
    function ensureWorker(){
      if(disabled)return null;if(worker)return worker;
      try{worker=typeof workerFactory==='function'?workerFactory():null;}catch(error){disable(`worker-create:${error?.message||error}`);return null;}
      if(!worker){disable('worker-unavailable');return null;}
      worker.onmessage=event=>receive(event?.data||{});
      worker.onerror=event=>disable(`worker-error:${event?.message||'unknown'}`);
      worker.onmessageerror=()=>disable('worker-message-error');
      needsFull=true;
      if(typeof catalogSpecs==='function')post({type:'specs',specs:catalogSpecs()});
      return worker;
    }
    function post(message,transfer){worker.postMessage(message,transfer||[]);}
    function receive(message){
      if(message.type==='error'){disable(`worker:${message.error}`);return;}
      if(message.type!=='result')return;
      const ticket=tickets.get(message.id);if(!ticket)return;
      clearTimeout(ticket.timer);stats.lastWorkerMs=Number(message.ms)||0;stats.maxWorkerMs=Math.max(stats.maxWorkerMs,stats.lastWorkerMs);
      if(message.fallback){ticket.status='fallback';ticket.reason=String(message.fallback);ticket.settled=true;tickets.delete(ticket.id);if(pending===ticket)pending=null;needsFull=needsFull||ticket.reason.startsWith('engine-error');settleWaiters();return;}
      if(Number.isFinite(message.nextBudgetTime)||message.nextBudgetTime===Infinity)lastBudgetTime=message.nextBudgetTime;
      ticket.result=message;ticket.status='ready';
      if(ticket.discarded)settle(ticket,'rollback');
    }
    // (route, base) pairs a row can reach: its own, then the ends of every plan reached, until nothing new appears.
    function addRouteKeys(store,keys,indices){
      const u32=STORE.views(store).u32,values=store.values,add=(routeId,base)=>{if(routeId)keys.add(routeKey(routeId,base));};
      const scan=index=>{const routeRef=u32[index*WR+W_ROUTE],baseRef=u32[index*WR+W_BASE];if(routeRef)add(values[routeRef],baseRef?values[baseRef]:'');};
      if(indices)for(const index of indices){if(index<store.length)scan(index);}else for(let index=0;index<store.length;index++)scan(index);
    }
    function closeRouteKeys(keys){
      const queue=[...keys].filter(key=>!routeTable.has(key)),plans=[];
      while(queue.length){
        const key=queue.pop();if(routeTable.has(key))continue;
        const split=key.indexOf('\u0000'),routeId=key.slice(0,split),base=key.slice(split+1);
        let plan=null;try{plan=resolveRoute(routeId,base)||null;}catch(_error){plan=null;}
        if(plan&&typeof plan==='object')plan=JSON.parse(JSON.stringify(plan));
        routeTable.set(key,plan);plans.push([key,plan]);
        if(plan)for(const end of [plan.fromFacility,plan.toFacility]){const next=routeKey(routeId,end||'');if(!routeTable.has(next)){keys.add(next);queue.push(next);}}
      }
      return plans;
    }
    function fullSync(store,reason){
      stats.fullSyncReasons[reason]=(stats.fullSyncReasons[reason]||0)+1;
      const started=clock(),payload=STORE.exportReplica(store);
      routeTable=new Map();routesAt=routesRevision();const keys=new Set();addRouteKeys(store,keys,null);const plans=closeRouteKeys(keys);
      post({type:'replica',id:0,payload},[payload.rows]);
      post({type:'routes',replace:true,plans});
      STORE.drainDirty(store,store.revision);
      synced={store,runtime:STORE.chunkStamp(store).runtime,since:store.revision,values:store.values.slice(),length:store.length};
      needsFull=false;stats.fullSyncs++;stats.lastSyncMs=clock()-started;stats.maxSyncMs=Math.max(stats.maxSyncMs,stats.lastSyncMs);stats.maxFullSyncMs=Math.max(stats.maxFullSyncMs,stats.lastSyncMs);
    }
    function sync(store){
      const reason=needsFull?'stale':!synced?'first':synced.store!==store?'store-replaced':synced.runtime!==STORE.chunkStamp(store).runtime?'store-runtime':store.length<synced.length?'store-shrank':'';
      if(reason){fullSync(store,reason);return;}
      const started=clock(),dirty=STORE.drainDirty(store,synced.since);
      if(!dirty.complete){fullSync(store,'dirty-log-incomplete');return;}
      // Build 359: columns rewritten wholesale (the daily fleet pass) travel as columns, with the presence column (a
      // column writer sets presence bits quietly), instead of the whole store.
      const columnNames=dirty.columns.length?[...new Set([...dirty.columns,'present'])]:null;
      if(columnNames&&!columnNames.every(name=>Object.prototype.hasOwnProperty.call(STORE.SLOTS,name))){fullSync(store,'column-writes');return;}
      const indices=Int32Array.from(new Set(dirty.indices.filter(index=>index>=0&&index<store.length))).sort();
      const values=STORE.valueChanges(store,synced.values);
      if(routesRevision()!==routesAt){
        routesAt=routesRevision();const keys=new Set(routeTable.keys());routeTable=new Map();addRouteKeys(store,keys,indices);
        post({type:'routes',replace:true,plans:closeRouteKeys(keys)});
      }else if(indices.length){const keys=new Set();addRouteKeys(store,keys,indices);const plans=closeRouteKeys(keys);if(plans.length)post({type:'routes',replace:false,plans});}
      if(indices.length||values.changes.length||store.length!==synced.length){
        const rows=STORE.readRows(store,indices),count=indices.length;
        post({type:'sync',length:store.length,live:store.live,structure:store.structure,values,rows:{indices,bytes:rows.bytes,extras:rows.extras}},[rows.bytes,indices.buffer]);
        stats.rowsSent+=count;
      }
      if(columnNames){const payload=STORE.readColumns(store,columnNames);post({type:'columns',reported:dirty.columns,payload},payload.columns.map(([,buffer])=>buffer));stats.columnSyncs++;}
      synced.since=store.revision;synced.values=store.values.slice();synced.length=store.length;
      stats.incrementalSyncs++;stats.lastSyncMs=clock()-started;stats.maxSyncMs=Math.max(stats.maxSyncMs,stats.lastSyncMs);
    }
    // Posts one step. Returns a ticket ({status:'pending'|'ready'|'fallback'|'failed'}) or null when the thread is not
    // available (the caller runs the step itself).
    function request(store,{from,to,context,contextKey,tripAlertLimit,order,maxEvents,budget}={}){
      if(pending||!STORE.isStore(store)||!ensureWorker())return null;
      try{sync(store);}catch(error){disable(`sync:${error?.message||error}`);return null;}
      const ticket={id:nextId++,store,from,to,contextKey:String(contextKey||''),revision:store.revision,valuesLength:store.values.length,length:store.length,status:'pending',result:null,settled:false,discarded:false,applied:false,reason:''};
      tickets.set(ticket.id,ticket);pending=ticket;stats.requests++;
      ticket.timer=setTimeout(()=>{if(ticket.status==='pending')disable('worker-timeout');},timeoutMs);
      post({type:'advance',id:ticket.id,from,to,context,tripAlertLimit,order,maxEvents,budget});
      return ticket;
    }
    // Messages reach the worker in order, so a settle posted while its step still runs is handled right after it.
    function settle(ticket,outcome){
      if(!ticket||ticket.settled)return;ticket.settled=true;tickets.delete(ticket.id);clearTimeout(ticket.timer);
      if(worker&&!disabled&&(ticket.status==='pending'||ticket.status==='ready'))post({type:'settle',id:ticket.id,outcome});
      if(pending===ticket)pending=null;settleWaiters();
    }
    // The caller will not use this ticket (cancelled slice, or it runs the step itself): the worker rolls the step back,
    // which leaves its replica where this side still is.
    function discard(ticket){
      if(!ticket||ticket.settled||ticket.applied)return;ticket.discarded=true;
      settle(ticket,'rollback');
    }
    // Replays a ready step into the store, inside the caller's transaction. Returns the engine's output, or null (the
    // ticket is then discarded and the caller runs the step itself).
    function apply(ticket,store,{contextKey,tx}={}){
      if(!ticket||ticket.status!=='ready'||ticket.settled||ticket.discarded)return null;
      const refuse=reason=>{stats.fallbacks++;stats.lastReason=reason;discard(ticket);return null;};
      if(store!==ticket.store||store.revision!==ticket.revision||store.values.length!==ticket.valuesLength||store.length!==ticket.length)return refuse('store-changed');
      if(contextKey!==undefined&&String(contextKey)!==ticket.contextKey)return refuse('context-changed');
      if(!tx?.registerUndo)return refuse('transaction-required');
      const started=clock(),message=ticket.result;
      // From here the store is written: a disagreement throws, and the transaction rolls back what was replayed. The
      // store's journal starts before the first value (it would otherwise start at the first row, and a rollback would
      // keep values interned before it while the worker removes them); a step that changed nothing opens none.
      if(message.values.length||message.indices.length)STORE.journalFor(store);
      for(const [ref,value] of message.values)if(!STORE.internAt(store,ref,value)){
        needsFull=true;discard(ticket);
        throw new Error(`fleet-thread-value-mismatch:${ref}:length=${store.values.length}:held=${JSON.stringify(store.values[ref]??null).slice(0,60)}:wanted=${JSON.stringify(value).slice(0,60)}:list=${JSON.stringify(message.values.map(([r])=>r))}`);
      }
      STORE.withoutDirtyLog(store,()=>STORE.writeRows(store,message.indices,message.bytes,message.extras,{revisionDelta:message.revisionDelta,staticRows:message.staticRows}));
      ticket.applied=true;
      tx.registerUndo(()=>settle(ticket,'rollback'),()=>settle(ticket,'commit'));
      if(synced&&synced.store===store){synced.since=store.revision;synced.values=store.values.slice();synced.length=store.length;}
      stats.applied++;stats.lastApplyMs=clock()-started;stats.maxApplyMs=Math.max(stats.maxApplyMs,stats.lastApplyMs);
      return message.out;
    }
    // Resolves when no step is in flight (commands that write the fleet wait for it).
    function idle(){return pending?new Promise(resolve=>waiters.push(resolve)):Promise.resolve();}
    return {
      VERSION,request,apply,discard,idle,
      markStale(){needsFull=true;},
      get busy(){return !!pending;},get disabled(){return disabled;},get available(){return !disabled&&typeof workerFactory==='function';},
      budgetTime:()=>lastBudgetTime,stats:()=>({...stats,disabled,pending:!!pending}),
      terminate(reason='terminated'){disable(reason);}
    };
  }
  const API=Object.freeze({VERSION,create,routeKey});
  globalThis.GH_FLEET_ENGINE_THREAD=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_ENGINE_THREAD=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
