// Fleet Core v4.1 — exact event-driven fleet simulation over the columnar store,
// built for up to 1,000,000 assets.
//
// Semantics. An asset changes only at events: a moving asset arrives at
// at + (1 - p)·D and an asset in turnaround departs at at + dwell (at = row
// checkpoint, p = progress there, D = normalized trip seconds). Between events
// progress, fuel, condition and dwell are linear functions of time (derive()).
// Events are processed in exact (time, row) order, so the fleet does not depend
// on how simulated time is sliced (frame rate, speed, pauses): any partition of
// the same interval yields a bit-identical fleet.
//
// Two equivalent paths process an event:
// - fast: typed-column reads/writes with per-(class, route, base) constants
//   and no object allocation (the common arrival and departure); it also
//   returns the row's next event time, so the queue never re-derives it;
// - general: the full asset object, for every rare case (faults, sale return,
//   exclusive-route release, crew not ready, rows not yet normalized, missing
//   routes). Tests require both paths to produce bit-identical rows and effects.
//
// Caches persist across slices in a runtime engine per store. They are keyed
// by interned refs and validated by identity against the value table on use
// (a reclaimed or rolled-back slot holds another object), so value
// reclamation and rollbacks never force a rebuild. Routes are re-read once per
// slice and per route actually used; trip economics are recomputed only when
// the economic context of the slice changes.
(()=>{
  'use strict';
  const VERSION='4.2.0';
  const STORE=globalThis.GH_FLEET_STORE||(typeof require==='function'?require('./fleet-store-core.js'):null);
  const CORE=globalThis.GH_SIMULATION_ASSET_CORE||(typeof require==='function'?require('./simulation-asset-core.js'):null);
  if(!STORE||!CORE)throw new Error('Fleet Event Core requires the Fleet Store and Simulation Asset cores');
  const DEPARTURE_INTERVAL_SECONDS=Object.freeze({air:180,sea:60,road:15});
  const ALIVE=STORE.ALIVE,EXTRAS=STORE.EXTRAS,B=STORE.HOT_BIT;
  // Record offsets: f64 slots (16 per row), 32-bit words (32 per row), bytes (128 per row).
  const O=STORE.O,FR=STORE.F64_PER_ROW,WR=STORE.WORDS_PER_ROW,SR=STORE.STRIDE;
  const F_AT=O.at,F_PROGRESS=O.progress,F_FUEL=O.fuel,F_CONDITION=O.condition,F_DWELL=O.dwellRemaining,F_DEP_AT=O.departureScheduledAt,F_CARRY=O.simCarrySeconds;
  const W_PRESENT=O.present,W_PHASE=O.phase,W_ROUTE=O.routeId,W_BASE=O.baseFacility,W_PROFILE=O.profile,W_BINDING=O.binding,W_LAST_TRIP=O.lastTrip,W_SLOT=O.routeSlot;
  const U_FLAGS=O.flags,U_REVERSE=O.reverse,U_DEP_SCHEDULED=O.departureScheduled,U_CREW_BLOCKED=O.crewBlocked,U_RELEASE=O.releaseExclusiveRouteOnArrival;
  const HOT_SET=new Set(STORE.HOT_FIELDS.map(([name])=>name));
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,number(value)));
  const fuelRate=type=>type==='air'?55:type==='sea'?43:49;
  const conditionRate=type=>type==='air'?.08:type==='sea'?.05:.11;
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const modeOf=asset=>String(asset?.assetMode||asset?.type||'').trim();
  // Departure slots per route (GH_FLEET_CORE.ROUTE_FLEET_CAPACITY): a route that carries more assets (Build 358
  // route.fleetCapacity) reuses them, so a slot's delay stays within one cycle of the base slots.
  const DEPARTURE_SLOTS=Object.freeze({air:24,sea:24,road:64});
  function slotDelay(routeSlot,mode){const slot=Math.max(0,Math.floor(Number(routeSlot)||0));return slot%(DEPARTURE_SLOTS[mode]||1)*(DEPARTURE_INTERVAL_SECONDS[mode]||0);}
  function hotInExtras(extras){for(const key in extras)if(HOT_SET.has(key))return true;return false;}
  function same(a,b){return Object.is(a,b)||(a&&b&&typeof a==='object'&&typeof b==='object'&&JSON.stringify(a)===JSON.stringify(b));}

  // ------------------------------------------------------------ derivation ---
  // State at time t from a checkpoint at `at` (used by views and checkpoints).
  function derive(asset,at,t,tripSeconds){
    const elapsed=Math.max(0,t-at);if(!(elapsed>0))return asset;
    const phase=asset.phase||(asset.routeId?'moving':'idle');
    if(!asset.routeId||phase==='idle'||asset.simulationFault)return asset;
    if(phase==='turnaround'){asset.dwellRemaining=Math.max(0,number(asset.dwellRemaining)-elapsed);return asset;}
    const duration=Number(tripSeconds);if(!Number.isFinite(duration)||duration<=0)return asset;
    const p0=clamp(asset.progress,0,1),p=clamp(p0+elapsed/duration,0,1),delta=p-p0;
    asset.progress=p;asset.fuel=clamp(number(asset.fuel,100)-delta*fuelRate(asset.type),4,100);asset.condition=clamp(number(asset.condition,100)-delta*conditionRate(asset.type),55,100);
    return asset;
  }

  // ---------------------------------------------------------- engine state ---
  // Runtime-only, one per store: the event queue and the asset classes, legs
  // and pairs below.
  const engines=new WeakMap();
  function engineFor(store){
    let e=engines.get(store);
    if(!e){
      e={store,q:makeQueue(store),refClass:[],classes:new Map(),legs:new Map(),pairs:[],
        call:0,ctxStamps:new Map(),ctxCounter:0,mark:new Uint32Array(Math.max(16,store.capacity)),markStamp:0,rate:0};
      engines.set(store,e);
    }
    return e;
  }

  // An asset class: every profile whose fast-path inputs are equal (type, mode,
  // owner, specs, fixed crew). Purchase batches differ only by their records,
  // so a million assets fall into a handful of classes.
  function classOf(e,ref){
    const value=e.store.values[ref],entry=e.refClass[ref];
    if(entry!==undefined&&entry.value===value)return entry.cls;
    const cls=classFor(e,value);e.refClass[ref]={value,cls};return cls;
  }
  function classFor(e,profile){
    const p=isObject(profile)?profile:{},staffing=p.staffing;
    const key=JSON.stringify([p.type,p.assetMode,p.ownerCompanyId,p.specs,staffing?.mode,staffing?.ready,staffing?.monthlyPayroll]);
    let cls=e.classes.get(key);if(cls)return cls;
    const mode=modeOf(p);
    cls={key,profile:p,type:p.type,mode,owner:CORE.assetOwner({ownerCompanyId:p.ownerCompanyId,assetMode:p.assetMode,type:p.type}),
      staffingReady:staffing?.mode==='automatic-fixed'&&staffing.ready===true,
      fastOk:typeof p.ownerCompanyId==='string'&&p.ownerCompanyId.trim()!==''&&isObject(p.specs),
      fr:fuelRate(p.type),cr:conditionRate(p.type),interval:DEPARTURE_INTERVAL_SECONDS[mode]||0,label:null,pairs:new Map()};
    e.classes.set(key,cls);return cls;
  }
  // A leg: one route as resolved from one base facility.
  function legOf(e,routeRef,baseRef){
    const V=e.store.values;let byBase=e.legs.get(routeRef);if(!byBase){byBase=new Map();e.legs.set(routeRef,byBase);}
    let leg=byBase.get(baseRef);
    if(leg!==undefined&&leg.routeValue===V[routeRef]&&leg.baseValue===V[baseRef])return leg;
    leg={routeRef,baseRef,routeValue:V[routeRef],baseValue:V[baseRef],call:-1,version:0,route:null,frozen:false,snap:null};
    byBase.set(baseRef,leg);return leg;
  }
  // Every route field the engine reads; a change rebuilds the leg's pairs.
  const ROUTE_FIELDS=Object.freeze(['id','type','routeMode','ownerCompanyId','companyId','company','from','to','fromFacility','toFacility','distanceKm','tripSeconds','effectiveSpeedKmh','dwellHours']);
  function sameRoute(snap,route){
    if(snap===null||route===null)return snap===route;
    for(let i=0;i<ROUTE_FIELDS.length;i++)if(!Object.is(snap[i],route[ROUTE_FIELDS[i]]))return false;
    return true;
  }
  // The leg's route for this slice (resolved once per slice). The same frozen
  // route object as last time cannot have changed.
  function legRoute(env,leg){
    if(leg.call===env.call)return leg.route;
    const route=env.resolveRoute?env.resolveRoute(leg.routeValue,leg.baseValue)||null:null;
    if(!(route!==null&&route===leg.route&&leg.frozen)&&!sameRoute(leg.snap,route)){leg.version++;leg.snap=route===null?null:ROUTE_FIELDS.map(field=>route[field]);}
    leg.route=route;leg.frozen=route!==null&&Object.isFrozen(route);leg.call=env.call;return route;
  }
  // A pair: one class on one leg — the normalized trip and every constant of
  // its arrivals and departures.
  function pairFor(e,cls,leg){
    let pair=cls.pairs.get(leg);
    if(pair===undefined){
      pair={idx:e.pairs.length,cls,leg,version:-1,ok:false,route:null,D:0,distanceKm:0,effectiveSpeedKmh:0,dwellHours:0,dwellSeconds:0,contract:false,baseIsTo:false,
        fromName:undefined,toName:undefined,fromFac:undefined,toFac:undefined,fromFacRef:0,toFacRef:0,
        ecoStamp:-1,eco:null,ecoRef:0,ecoStored:null,ecoKey:'',ecoHash:0,count:0,countCall:-1,
        rA:-1,rAv:undefined,rArev:-1,rAok:false,rB:-1,rBv:undefined,rBrev:-1,rBok:false,
        dIn:-1,dInV:undefined,dRev:-1,dOut:0,dOutV:undefined,departures:null,next0:null,next1:null};
      e.pairs.push(pair);cls.pairs.set(leg,pair);
    }
    return pair;
  }
  // Ready for this slice: the leg's route re-read, the pair rebuilt if it changed.
  function pairReady(env,pair){
    const leg=pair.leg;if(leg.call!==env.call)legRoute(env,leg);
    if(pair.version!==leg.version)buildPair(pair);
    return pair.ok;
  }
  function buildPair(pair){
    const cls=pair.cls,leg=pair.leg,route=leg.route,routeId=leg.routeValue,base=leg.baseValue;
    pair.version=leg.version;pair.ok=false;pair.route=route;pair.ecoStamp=-1;pair.eco=null;pair.ecoRef=0;pair.ecoStored=null;
    pair.rA=pair.rB=-1;pair.rAv=pair.rBv=undefined;pair.dIn=-1;pair.dInV=undefined;pair.dOut=0;pair.dOutV=undefined;pair.departures=null;
    // An arrival writes the route's end facility; an undefined end is the
    // general path's (it deletes the field rather than storing null).
    if(!cls.fastOk||!route||route.fromFacility===undefined||route.toFacility===undefined)return;
    const probe={type:cls.type,assetMode:cls.profile.assetMode,specs:cls.profile.specs,routeId,phase:'moving',progress:0,fuel:100,condition:100,reverse:false};
    CORE.normalizeAsset(probe,route,null);
    const D=Number(probe.tripSeconds);if(!(Number.isFinite(D)&&D>0))return;
    pair.ok=true;pair.D=D;pair.distanceKm=probe.distanceKm;pair.effectiveSpeedKmh=probe.effectiveSpeedKmh;pair.dwellHours=probe.dwellHours;
    pair.dwellSeconds=Math.max(0,number(route.dwellHours))*3600;
    pair.contract=route.id===routeId&&CORE.routeMode(route)===cls.mode&&CORE.routeOwner(route)===cls.owner&&(base===route.fromFacility||base===route.toFacility);
    pair.baseIsTo=base===route.toFacility;pair.fromName=route.from;pair.toName=route.to;pair.fromFac=route.fromFacility;pair.toFac=route.toFacility;pair.fromFacRef=0;pair.toFacRef=0;
  }
  // Interned ref of the facility an arrival lands at (validated by identity).
  function facilityRef(env,pair,toEnd){
    const V=env.store.values;
    if(toEnd){if(pair.toFacRef===0||V[pair.toFacRef]!==pair.toFac)pair.toFacRef=internValue(env,pair.toFac);return pair.toFacRef;}
    if(pair.fromFacRef===0||V[pair.fromFacRef]!==pair.fromFac)pair.fromFacRef=internValue(env,pair.fromFac);return pair.fromFacRef;
  }
  function internValue(env,value){return value===null||value===undefined?0:STORE.intern(env.store,value);}
  // The binding is normalized for this pair and direction (no field to write).
  function bindingReady(env,pair,bindingRef,reverse){
    const b=env.store.values[bindingRef];
    if(pair.rA===bindingRef&&pair.rAv===b&&pair.rArev===reverse)return pair.rAok;
    if(pair.rB===bindingRef&&pair.rBv===b&&pair.rBrev===reverse)return pair.rBok;
    const ok=isObject(b)&&own(b,'load')&&own(b,'from')&&own(b,'to')&&Object.is(b.distanceKm,pair.distanceKm)&&Object.is(b.tripSeconds,pair.D)&&Object.is(b.effectiveSpeedKmh,pair.effectiveSpeedKmh)&&Object.is(b.dwellHours,pair.dwellHours)&&Object.is(b.from,reverse?pair.toName:pair.fromName)&&Object.is(b.to,reverse?pair.fromName:pair.toName);
    pair.rB=pair.rA;pair.rBv=pair.rAv;pair.rBrev=pair.rArev;pair.rBok=pair.rAok;
    pair.rA=bindingRef;pair.rAv=b;pair.rArev=reverse;pair.rAok=ok;
    return ok;
  }
  // Binding after a departure in direction `reverse` (from/to/load rewritten in place).
  function departureBinding(env,pair,bindingRef,reverse){
    const V=env.store.values,b=V[bindingRef];
    if(pair.dIn===bindingRef&&pair.dInV===b&&pair.dRev===reverse&&V[pair.dOut]===pair.dOutV)return pair.dOut;
    const key=bindingRef*2+reverse;let hit=pair.departures!==null?pair.departures.get(key):undefined;
    if(hit===undefined||hit.inV!==b||V[hit.out]!==hit.outV){
      const cls=pair.cls,label=cls.label??(cls.label=CORE.loadLabel({specs:cls.profile.specs,type:cls.type})),next={};
      for(const field of Object.keys(b)){if(field==='from')next.from=reverse?pair.toName:pair.fromName;else if(field==='to')next.to=reverse?pair.fromName:pair.toName;else if(field==='load')next.load=label;else next[field]=b[field];}
      const out=STORE.intern(env.store,next);hit={inV:b,out,outV:V[out]};
      if(pair.departures===null)pair.departures=new Map();pair.departures.set(key,hit);
    }
    pair.dIn=bindingRef;pair.dInV=b;pair.dRev=reverse;pair.dOut=hit.out;pair.dOutV=hit.outV;
    return hit.out;
  }
  // Trip economics of a pair under this slice's economic context.
  function pairEconomics(env,pair){
    if(pair.ecoStamp===env.ctxStamp&&env.store.values[pair.ecoRef]===pair.ecoStored)return pair.eco;
    const cls=pair.cls,p=cls.profile;
    const eco=CORE.computeTripEconomics({ownerCompanyId:p.ownerCompanyId,assetMode:p.assetMode,type:cls.type,specs:p.specs,staffing:p.staffing,tripSeconds:pair.D},pair.route,env.ctx);
    pair.eco=eco;pair.ecoRef=STORE.intern(env.store,eco);pair.ecoStored=env.store.values[pair.ecoRef];pair.ecoStamp=env.ctxStamp;
    pair.ecoKey=STORE.valueKey(pair.ecoStored);pair.ecoHash=hashText(pair.ecoKey);
    return eco;
  }
  function bindingOf(store,row){const v=STORE.value(store,STORE.views(store).u32[row*WR+W_BINDING]);return isObject(v)?v:{};}
  function extrasOf(store,row){return (STORE.views(store).u8[row*SR+U_FLAGS]&EXTRAS)?STORE.extrasOf(store,row):null;}
  function checkpointTime(store,row){const v=STORE.views(store),carry=(v.u32[row*WR+W_PRESENT]&B.simCarrySeconds)?number(v.f64[row*FR+F_CARRY]):0;return v.f64[row*FR+F_AT]-Math.max(0,carry);}

  // Next time this asset's discrete state changes (Infinity: never by itself).
  function nextEventTime(store,row){return rowEventTime(engineFor(store),row);}
  function rowEventTime(e,row){
    const store=e.store,v=STORE.views(store),f=row*FR,w=row*WR,u=row*SR;if(!(v.u8[u+U_FLAGS]&ALIVE))return Infinity;
    const extras=extrasOf(store,row);if(extras&&extras.simulationFault)return Infinity;
    if(extras&&hotInExtras(extras))return nextEventTimeGeneric(store,row);
    const present=v.u32[w+W_PRESENT],V=store.values;
    const routeId=(present&B.routeId)?(v.u32[w+W_ROUTE]===0?null:V[v.u32[w+W_ROUTE]]):undefined;if(!routeId)return Infinity;
    const phase=((present&B.phase)?(v.u32[w+W_PHASE]===0?null:V[v.u32[w+W_PHASE]]):undefined)||'moving';if(phase==='idle')return Infinity;
    const at=v.f64[f+F_AT]-Math.max(0,(present&B.simCarrySeconds)?number(v.f64[f+F_CARRY]):0);
    if(phase==='turnaround'){
      if(!classOf(e,v.u32[w+W_PROFILE]).staffingReady&&(present&B.crewBlocked)&&v.u8[u+U_CREW_BLOCKED]===1)return Infinity;
      return at+Math.max(0,(present&B.dwellRemaining)?number(v.f64[f+F_DWELL]):0);
    }
    const duration=Number(bindingOf(store,row).tripSeconds);if(!Number.isFinite(duration)||duration<=0)return at;
    return at+(1-clamp((present&B.progress)?v.f64[f+F_PROGRESS]:undefined,0,1))*duration;
  }
  function nextEventTimeGeneric(store,row){
    const g=field=>STORE.peek(store,row,field);
    if(g('simulationFault'))return Infinity;const routeId=g('routeId');if(!routeId)return Infinity;
    const phase=g('phase')||'moving';if(phase==='idle')return Infinity;
    const at=STORE.slot(store,'at',row)-Math.max(0,number(g('simCarrySeconds')));
    if(phase==='turnaround'){const staffing=g('staffing');if(!(staffing?.mode==='automatic-fixed'&&staffing.ready===true)&&g('crewBlocked')===true)return Infinity;return at+Math.max(0,number(g('dwellRemaining')));}
    const duration=Number(g('tripSeconds'));if(!Number.isFinite(duration)||duration<=0)return at;
    return at+(1-clamp(g('progress'),0,1))*duration;
  }

  // ------------------------------------------------------------ event queue ---
  // Runtime-only schedule. `slot` holds, per row, its next event time (due;
  // Infinity: none) and the pair that event will use (hint; 0 = unknown).
  // The event queue is a 4-ary min-heap of (time, row) entries stored side by
  // side in one Float64Array (16 bytes each, four siblings per cache line),
  // built from `slot` only when a slice runs in event order. An entry is
  // current when the row's due time equals its time (a stale entry with the
  // same time and row stands for that same event). A new store epoch
  // (compaction, a restored snapshot) recomputes every row; ordinary writes
  // and rollbacks reschedule only their rows; mass writes to fields that
  // cannot move an event leave the schedule untouched.
  const SCHEDULE_COLUMNS=new Set(['flags','present','profile','binding','at','routeId','phase','progress','dwellRemaining','simCarrySeconds','crewBlocked']);
  function makeQueue(store){const slot=new Float64Array(2*Math.max(16,store.capacity));for(let i=0;i<slot.length;i+=2)slot[i]=Infinity;return {h:new Float64Array(2048),size:0,heapOk:false,slot,revision:-1,epoch:-1,builds:0};}
  function growHeap(q,needed){let cap=q.h.length>>1;while(cap<needed)cap*=2;const h=new Float64Array(2*cap);h.set(q.h.subarray(0,2*q.size));q.h=h;}
  function heapPush(q,time,row){
    if(q.size===(q.h.length>>1))growHeap(q,q.size+1);
    const h=q.h;let k=q.size++;
    while(k>0){const parent=(k-1)>>2,pt=h[2*parent];if(pt<time||(pt===time&&h[2*parent+1]<=row))break;h[2*k]=pt;h[2*k+1]=h[2*parent+1];k=parent;}
    h[2*k]=time;h[2*k+1]=row;
  }
  // Place (time, row) at hole k and sift it down.
  function siftDown(q,k,time,row){
    const h=q.h,n=q.size;
    while(true){
      const first=4*k+1;if(first>=n)break;
      const last=first+3<n?first+3:n-1;let m=first,mt=h[2*first],mr=h[2*first+1];
      for(let j=first+1;j<=last;j++){const jt=h[2*j];if(jt<mt||(jt===mt&&h[2*j+1]<mr)){m=j;mt=jt;mr=h[2*j+1];}}
      if(mt>time||(mt===time&&mr>=row))break;
      h[2*k]=mt;h[2*k+1]=mr;k=m;
    }
    h[2*k]=time;h[2*k+1]=row;
  }
  function heapPop(q){const n=--q.size;if(n>0)siftDown(q,0,q.h[2*n],q.h[2*n+1]);}
  function ensureRows(e,length){
    const q=e.q;if((q.slot.length>>1)<length){const next=new Float64Array(2*Math.max(length,q.slot.length));for(let i=q.slot.length;i<next.length;i+=2)next[i]=Infinity;next.set(q.slot);q.slot=next;}
    if(e.mark.length<length){const next=new Uint32Array(Math.max(length,e.mark.length*2));next.set(e.mark);e.mark=next;}
  }
  function eventTimeOf(e,row){const time=rowEventTime(e,row);return time===time?time:Infinity;}
  function schedule(e,row){
    const q=e.q;ensureRows(e,row+1);const time=eventTimeOf(e,row);
    q.slot[2*row]=time;q.slot[2*row+1]=0;if(q.heapOk&&time!==Infinity)heapPush(q,time,row);
  }
  // Every row's next event (O(n)); the heap is rebuilt on demand.
  function recompute(e){
    const store=e.store,q=e.q;ensureRows(e,store.capacity);q.builds++;
    const slot=q.slot;for(let row=0;row<store.length;row++){slot[2*row]=eventTimeOf(e,row);slot[2*row+1]=0;}
    for(let i=2*store.length;i<slot.length;i+=2){slot[i]=Infinity;slot[i+1]=0;}
    q.heapOk=false;q.size=0;q.epoch=STORE.epoch(store);STORE.drainDirty(store,store.revision);q.revision=store.revision;
  }
  // Floyd heap construction from the per-row schedule: O(n).
  function buildHeap(e){
    const store=e.store,q=e.q;q.size=0;
    if((q.h.length>>1)<store.length)growHeap(q,store.length);
    const h=q.h,slot=q.slot;
    for(let row=0;row<store.length;row++){const time=slot[2*row];if(time===Infinity)continue;const k=q.size++;h[2*k]=time;h[2*k+1]=row;}
    for(let k=((q.size-2)>>2);k>=0;k--)siftDown(q,k,h[2*k],h[2*k+1]);
    q.heapOk=true;
  }
  function queueFor(e){
    const store=e.store,q=e.q;
    if(q.epoch!==STORE.epoch(store)){recompute(e);return q;}
    if(q.revision===store.revision)return q;
    const drained=STORE.drainDirty(store,q.revision);
    if(!drained.complete||drained.columns.some(name=>SCHEDULE_COLUMNS.has(name))){recompute(e);return q;}
    const stamp=e.markStamp=(e.markStamp+1)>>>0||1;ensureRows(e,store.length);
    for(const row of drained.indices){if(row>=store.length||e.mark[row]===stamp)continue;e.mark[row]=stamp;schedule(e,row);}
    q.revision=store.revision;return q;
  }
  function heapFor(e){const q=queueFor(e);if(!q.heapOk)buildHeap(e);return q;}
  function validTop(q,length){while(q.size){const row=q.h[1];if(row<length&&q.slot[2*row]===q.h[0])return true;heapPop(q);}return false;}
  function peekNext(store){const e=engineFor(store),q=heapFor(e);return validTop(q,store.length)?{time:q.h[0],index:q.h[1]}:null;}
  // Time of the k-th next event (by the current schedule): processing every
  // event up to that time processes k events, plus any cascade they schedule.
  function timeForEventBudget(store,k){
    const e=engineFor(store),q=heapFor(e),limit=Math.max(1,Math.floor(Number(k)||1));if(!q.size)return Infinity;
    // Auxiliary min-heap of heap nodes: the k smallest entries in O(k log k).
    const h=q.h,slot=q.slot,length=store.length,aux=new Int32Array(4*limit+8);let n=0,found=0,time=Infinity;
    const better=(a,b)=>h[2*a]<h[2*b]||(h[2*a]===h[2*b]&&h[2*a+1]<h[2*b+1]);
    const push=node=>{let k2=n++;while(k2>0){const parent=(k2-1)>>1;if(!better(node,aux[parent]))break;aux[k2]=aux[parent];k2=parent;}aux[k2]=node;};
    const pop=()=>{const top=aux[0];n--;if(n>0){const last=aux[n];let k2=0;while(true){let child=2*k2+1;if(child>=n)break;if(child+1<n&&better(aux[child+1],aux[child]))child++;if(!better(aux[child],last))break;aux[k2]=aux[child];k2=child;}aux[k2]=last;}return top;};
    push(0);
    while(n&&found<limit){
      const node=pop(),row=h[2*node+1];
      if(row<length&&slot[2*row]===h[2*node]){found++;time=h[2*node];}
      const first=4*node+1;if(first<q.size){if(n+4>aux.length)break;for(let j=first;j<first+4&&j<q.size;j++)push(j);}
    }
    return found<limit?Infinity:time;
  }

  // ------------------------------------------------------------- slice env ---
  // The economic context minus the fields economics never reads.
  function contextStamp(e,ctx){
    let key;
    try{key=JSON.stringify(ctx,(name,value)=>name==='simSeconds'||name==='workerCompatible'?undefined:typeof value==='number'&&(!Number.isFinite(value)||Object.is(value,-0))?`#${Object.is(value,-0)?'-0':value}`:value);}
    catch{return ++e.ctxCounter;}
    let stamp=e.ctxStamps.get(key);
    if(stamp===undefined){stamp=++e.ctxCounter;if(e.ctxStamps.size>=32)e.ctxStamps.clear();e.ctxStamps.set(key,stamp);}
    return stamp;
  }
  function makeEnv(e,store,options){
    const ctx={...(options.context||{})},ownedFacilitySet=new Set(ctx.ownedFacilities||[]);delete ctx.ownedFacilities;
    const env={e,store,options,ctx,ownedFacilitySet,resolveRoute:typeof options.resolveRoute==='function'?options.resolveRoute:null,catalogSpecs:typeof options.catalogSpecs==='function'?options.catalogSpecs:null,
      call:++e.call,ctxStamp:0,touch:STORE.toucher(store),f64:null,u32:null,i32:null,u8:null,
      routes:new Map(),ecos:new Map(),
      effects:CORE.makeEffects(),touched:[],slowGroups:new Map(),notes:[],curT:0,curRow:0,tripRows:new Map(),tripTotal:0,
      tripAlertLimit:options.tripAlertLimit!==null&&options.tripAlertLimit!==undefined&&Number.isFinite(Number(options.tripAlertLimit))?Number(options.tripAlertLimit):null,
      events:0,fast:0,slow:0,faults:0,phases:null,hint:0};
    env.ctxStamp=contextStamp(e,ctx);
    const v=STORE.views(store);env.f64=v.f64;env.u32=v.u32;env.i32=v.i32;env.u8=v.u8;
    env.phases={moving:STORE.intern(store,'moving'),turnaround:STORE.intern(store,'turnaround')};
    return env;
  }
  function routeFor(env,routeId,base){
    let byBase=env.routes.get(routeId);if(!byBase){byBase=new Map();env.routes.set(routeId,byBase);}
    if(byBase.has(base))return byBase.get(base);
    const route=env.resolveRoute?env.resolveRoute(routeId,base)||null:null;byBase.set(base,route);return route;
  }
  // General-path economics: one computation per (profile fields, trip, route) and slice.
  function economicsFor(env,probe,route){
    const key=`${JSON.stringify([probe.ownerCompanyId,probe.assetMode,probe.type,probe.specs,probe.staffing?.monthlyPayroll])}|${probe.tripSeconds}|${route.id}|${route.distanceKm}`;
    let cached=env.ecos.get(key);
    if(!cached){const eco=CORE.computeTripEconomics(probe,route,env.ctx),ref=STORE.intern(env.store,eco),text=STORE.valueKey(env.store.values[ref]);cached={eco,ref,key:text,hash:hashText(text)};env.ecos.set(key,cached);}
    return cached;
  }

  // ------------------------------------------------------------- effects ---
  // Effects never depend on the order in which rows were processed: trips are
  // counted per (owner, trip economics) and summed at the end of the slice in
  // a canonical order (owner, then economics by content), and every event
  // alert, sale and route release is ordered by (time, row). The time-ordered
  // event queue and the row-ordered sweep therefore agree bit for bit.
  // 53-bit FNV-1a style hash of a canonical text (stable across runs).
  function hashText(text){let a=0x811c9dc5,b=0x9747b28c;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,0x01000193);b=Math.imul(b^c,0x5bd1e995);}return (a>>>0)*2097152+((b>>>0)&0x1fffff);}
  function note(env,list,value){env.notes.push({t:env.curT,row:env.curRow,seq:env.notes.length,list,value});}
  // Per-trip bookkeeping shared by both paths: the trip total, and per-row
  // alert records until the alert limit is exceeded.
  function countTrip(env,row,eco,name){
    env.tripTotal++;
    if(env.tripRows){let rec=env.tripRows.get(row);if(!rec){rec={count:0,eco:null,total:0,name,first:env.curT};env.tripRows.set(row,rec);}rec.count++;rec.eco=eco;rec.total+=number(eco.margin);if(name!==undefined)rec.name=name;
      if(env.tripAlertLimit!==null&&env.tripTotal>env.tripAlertLimit)env.tripRows=null;}
  }
  function slowTrip(env,owner,cached,row,name){
    const id=`${owner}\u0000${cached.ref}`;let group=env.slowGroups.get(id);
    if(!group){group={owner,eco:cached.eco,ref:cached.ref,key:cached.key,hash:cached.hash,count:0};env.slowGroups.set(id,group);}
    group.count++;countTrip(env,row,cached.eco,name);
  }
  function finishEffects(env){
    const e=env.effects,byOwner=new Map(),list=[];
    const add=(owner,eco,ref,key,hash,count)=>{let groups=byOwner.get(owner);if(!groups){groups=new Map();byOwner.set(owner,groups);}let g=groups.get(ref);if(!g){g={owner,eco,key,hash,count:0};groups.set(ref,g);list.push(g);}g.count+=count;};
    for(const pair of env.touched)add(pair.cls.owner,pair.eco,pair.ecoRef,pair.ecoKey,pair.ecoHash,pair.count);
    for(const g of env.slowGroups.values())add(g.owner,g.eco,g.ref,g.key,g.hash,g.count);
    list.sort((a,b)=>a.owner<b.owner?-1:a.owner>b.owner?1:a.hash!==b.hash?a.hash-b.hash:a.key<b.key?-1:a.key>b.key?1:0);
    const owners=new Map();
    for(const g of list){
      const eco=g.eco,n=g.count,margin=number(eco.margin),tripCash=Number.isFinite(eco.cashContribution)?eco.cashContribution:(eco.revenue-eco.fuelCost-eco.maintReserve);
      let acc=owners.get(g.owner);if(!acc){acc=[0,0,0,0,0,0];owners.set(g.owner,acc);}
      e.todayProfit+=n*margin;acc[0]+=n*margin;acc[1]+=n*(Number(tripCash)||0);acc[2]+=n*Math.max(0,Number(eco.revenue)||0);acc[3]+=n*Math.max(0,Number(eco.fuelCost)||0);acc[4]+=n*Math.max(0,Number(eco.maintReserve)||0);acc[5]+=n;
      e.groupValue+=n*(Math.max(0,Number(eco.margin)||0)*.08);
    }
    for(const [owner,acc] of owners){
      e.sectorProfit[owner]=(e.sectorProfit[owner]||0)+acc[0];e.tripProfit[owner]=(e.tripProfit[owner]||0)+acc[0];e.cash[owner]=(e.cash[owner]||0)+acc[1];
      e.tripRevenue[owner]=(e.tripRevenue[owner]||0)+acc[2];e.tripFuel[owner]=(e.tripFuel[owner]||0)+acc[3];e.tripMaintenance[owner]=(e.tripMaintenance[owner]||0)+acc[4];e.tripCount[owner]=(e.tripCount[owner]||0)+acc[5];
    }
    env.notes.sort((a,b)=>a.t-b.t||a.row-b.row||a.seq-b.seq);
    for(const item of env.notes)e[item.list].push(item.value);
    if(env.tripRows){
      const recs=[...env.tripRows].sort((a,b)=>a[1].first-b[1].first||a[0]-b[0]);
      for(const [row,rec] of recs){
        const name=rec.name!==undefined?rec.name:STORE.peek(env.store,row,'name');
        if(rec.count===1)e.alerts.push(`${name} أكمل رحلة. إيراد ${CORE.fmtMoney(rec.eco.revenue)} − وقود ${CORE.fmtMoney(rec.eco.fuelCost)} − صيانة ${CORE.fmtMoney(rec.eco.maintReserve)} = هامش الرحلة ${CORE.fmtMoney(rec.eco.margin)}. الراتب الثابت يُصرف في مسير 27.`);
        else e.alerts.push(`${name} أكمل ${rec.count} رحلات أثناء تقديم الوقت بإجمالي هامش ${CORE.fmtMoney(rec.total)}.`);
      }
    }else if(env.tripTotal)e.suppressedTripAlerts=env.tripTotal;
    return e;
  }

  // ------------------------------------------------------------ fast path ---
  const NEED=B.routeId|B.baseFacility|B.phase|B.progress|B.fuel|B.condition|B.simCarrySeconds;
  // Processes the event and returns the row's next event time (env.hint: the
  // pair of that next event), or NaN when the general path must handle it
  // (nothing has been written then). `hint` is the pair the queue entry names.
  function fastEvent(env,row,T,hint){
    const e=env.e,store=env.store,V=store.values,F=env.f64,W=env.u32,U=env.u8,f=row*FR,w=row*WR,u=row*SR,present=W[w+W_PRESENT],ph=env.phases;
    if(U[u+U_FLAGS]&EXTRAS){const extras=store.extras[row];if(extras&&(extras.simulationFault!==undefined||extras.salePending!==undefined||extras.companyId!==undefined||hotInExtras(extras)))return NaN;}
    if((present&NEED)!==NEED||F[f+F_CARRY]!==0)return NaN;
    const phaseRef=W[w+W_PHASE],routeRef=W[w+W_ROUTE],baseRef=W[w+W_BASE];
    if(routeRef===0||baseRef===0||(phaseRef!==ph.moving&&phaseRef!==ph.turnaround))return NaN;
    const cls=classOf(e,W[w+W_PROFILE]);if(!cls.fastOk)return NaN;
    let pair=hint>0?e.pairs[hint-1]:undefined;
    if(pair===undefined||pair.cls!==cls||pair.leg.routeRef!==routeRef||pair.leg.baseRef!==baseRef||pair.leg.routeValue!==V[routeRef]||pair.leg.baseValue!==V[baseRef])pair=pairFor(e,cls,legOf(e,routeRef,baseRef));
    if(!pairReady(env,pair))return NaN;
    const at=F[f+F_AT],reverse=(present&B.reverse)?U[u+U_REVERSE]:0,bindingRef=W[w+W_BINDING];
    if(!bindingReady(env,pair,bindingRef,reverse))return NaN;
    if(phaseRef===ph.turnaround){
      if(!cls.staffingReady||!pair.contract)return NaN;
      const dwell0=Math.max(0,(present&B.dwellRemaining)?number(F[f+F_DWELL]):0);if(T<at+dwell0)return NaN;
      const nextReverse=pair.baseIsTo?1:0,binding=departureBinding(env,pair,bindingRef,nextReverse);
      env.touch(row);
      U[u+U_REVERSE]=nextReverse;W[w+W_PHASE]=ph.moving;F[f+F_PROGRESS]=0;F[f+F_DWELL]=0;F[f+F_FUEL]=100;U[u+U_CREW_BLOCKED]=0;U[u+U_DEP_SCHEDULED]=0;
      W[w+W_PRESENT]=(present|B.reverse|B.dwellRemaining|B.crewBlocked|B.departureScheduled)&~B.departureScheduledAt;
      W[w+W_BINDING]=binding;F[f+F_AT]=T;
      // Arrival: at + (1 - 0)·D, on this same pair.
      env.hint=pair.idx+1;return T+pair.D;
    }
    if((present&B.releaseExclusiveRouteOnArrival)&&U[u+U_RELEASE]===1)return NaN;
    const p0=clamp(F[f+F_PROGRESS],0,1);if(T<at+(1-p0)*pair.D)return NaN;
    const eco=pairEconomics(env,pair),delta=1-p0,dwell=pair.dwellSeconds+slotDelay((present&B.routeSlot)?env.i32[w+W_SLOT]:0,cls.mode);
    const baseNext=facilityRef(env,pair,!reverse);
    env.touch(row);
    F[f+F_PROGRESS]=1;F[f+F_FUEL]=clamp(F[f+F_FUEL]-delta*cls.fr,4,100);F[f+F_CONDITION]=clamp(F[f+F_CONDITION]-delta*cls.cr,55,100);
    W[w+W_PHASE]=ph.turnaround;F[f+F_DWELL]=dwell;U[u+U_DEP_SCHEDULED]=1;F[f+F_DEP_AT]=Math.max(0,T)+dwell;
    W[w+W_BASE]=baseNext;W[w+W_LAST_TRIP]=pair.ecoRef;F[f+F_AT]=T;
    W[w+W_PRESENT]=present|B.dwellRemaining|B.departureScheduled|B.departureScheduledAt|B.lastTrip;
    if(pair.countCall!==env.call){pair.countCall=env.call;pair.count=0;env.touched.push(pair);}
    pair.count++;countTrip(env,row,eco,undefined);
    // The departure pair (same class and route, the arrival base) for the next event.
    let next=reverse?pair.next1:pair.next0;
    if(next===null||next.leg.baseRef!==baseNext||next.leg.routeRef!==routeRef){next=pairFor(e,cls,legOf(e,routeRef,baseNext));if(reverse)pair.next1=next;else pair.next0=next;}
    env.hint=next.idx+1;
    // Departure: at + dwell, unless the crew is blocked without a ready fixed crew.
    if(!cls.staffingReady&&(present&B.crewBlocked)&&U[u+U_CREW_BLOCKED]===1)return Infinity;
    return T+dwell;
  }

  // --------------------------------------------------------- general path ---
  function slowEvent(env,row,T){
    const store=env.store,before=STORE.materialize(store,row),asset=STORE.materialize(store,row);
    const at=STORE.slot(store,'at',row)-Math.max(0,number(asset.simCarrySeconds)),scheduledTrip=Number(before.tripSeconds),routeId=asset.routeId;
    const route=routeId?routeFor(env,routeId,asset.baseFacility):null;
    try{
      if(asset.simulationFault)return writeBack(env,row,before,asset,null);
      // processOne's first step: normalize from the route and catalog.
      CORE.normalizeAsset(asset,route,asset.specs?null:(env.catalogSpecs?env.catalogSpecs(asset):null));
      asset.simCarrySeconds=0;
      if(asset.phase==='idle'||!asset.routeId)return writeBack(env,row,before,asset,null);
      if(!route){
        if(Number.isFinite(scheduledTrip)&&scheduledTrip>0||asset.phase==='turnaround')derive(asset,at,T,scheduledTrip);
        asset.simulationFault={code:'ROUTE_RUNTIME_MISSING',at:T,detail:`Route runtime missing: ${String(asset.routeId).slice(0,80)}`};asset.crewBlocked=true;
        note(env,'alerts',`${asset.name||asset.id}: عُزل الأصل لأن تعريف مساره غير متاح. لم يتقدم الأصل أو الزمن التشغيلي الخاص به؛ أعد تعيين المسار بعد المراجعة.`);
        return writeBack(env,row,before,asset,T);
      }
      if(asset.phase==='turnaround'){
        const dwell0=Math.max(0,number(before.dwellRemaining));
        if(T<at+dwell0)return writeBack(env,row,before,asset,null);
        asset.dwellRemaining=0;
        if(asset.staffing?.mode!=='automatic-fixed'||asset.staffing.ready!==true){
          if(!asset.crewBlocked)note(env,'alerts',`${asset.name}: تكوين الطاقم الثابت غير مكتمل؛ أوقفت هذه الرحلة دون التأثير على بقية اللعبة.`);
          asset.crewBlocked=true;return writeBack(env,row,before,asset,T);
        }
        const owner=CORE.assetOwner(asset);
        if(route.id!==asset.routeId||CORE.routeMode(route)!==CORE.assetMode(asset)||CORE.routeOwner(route)!==owner||![route.fromFacility,route.toFacility].includes(asset.baseFacility))throw new Error('route-departure-contract');
        asset.reverse=asset.baseFacility===route.toFacility;asset.phase='moving';asset.progress=0;asset.dwellRemaining=0;asset.fuel=100;asset.crewBlocked=false;asset.departureScheduled=false;delete asset.departureScheduledAt;delete asset.simulationFault;
        asset.from=asset.reverse?route.to:route.from;asset.to=asset.reverse?route.from:route.to;asset.load=CORE.loadLabel(asset);
        return writeBack(env,row,before,asset,T);
      }
      // Moving.
      const duration=Number(asset.tripSeconds||route.tripSeconds);
      if(!Number.isFinite(duration)||duration<=0){asset.progress=0;asset.phase='idle';asset.routeId=null;asset.routeSignature=null;note(env,'alerts',`${asset.name}: أوقف النظام المسار لأن مدة الرحلة غير صالحة.`);return writeBack(env,row,before,asset,T);}
      // A row scheduled before its trip was normalized: nothing happened yet.
      if(!Number.isFinite(scheduledTrip)||scheduledTrip<=0)return writeBack(env,row,before,asset,null);
      const p0=clamp(before.progress,0,1);if(T<at+(1-p0)*scheduledTrip)return writeBack(env,row,before,asset,null);
      const delta=1-p0;
      asset.progress=1;asset.fuel=clamp(asset.fuel-delta*fuelRate(asset.type),4,100);asset.condition=clamp(asset.condition-delta*conditionRate(asset.type),55,100);
      asset.phase='turnaround';asset.dwellRemaining=Math.max(0,number(route.dwellHours))*3600+slotDelay(asset.routeSlot,modeOf(asset));asset.departureScheduled=true;asset.departureScheduledAt=Math.max(0,T)+asset.dwellRemaining;
      asset.baseFacility=asset.reverse?route.fromFacility:route.toFacility;
      let cached;
      if(asset.ownerCompanyId)cached=economicsFor(env,{ownerCompanyId:asset.ownerCompanyId,assetMode:asset.assetMode,type:asset.type,specs:asset.specs,staffing:asset.staffing,tripSeconds:Number(asset.tripSeconds||route.tripSeconds)},route);
      else{const eco=CORE.computeTripEconomics(asset,route,env.ctx),ref=STORE.intern(store,eco),text=STORE.valueKey(store.values[ref]);cached={eco,ref,key:text,hash:hashText(text)};}
      const eco=cached.eco,ecoRef=cached.ref;
      asset.lastTrip=eco;
      const owner=CORE.assetOwner(asset);if(!owner)throw new Error(`asset-owner-company-missing:${asset.id}`);
      slowTrip(env,owner,cached,row,asset.name);
      if(asset.releaseExclusiveRouteOnArrival){const retired=asset.routeId;asset.phase='idle';asset.routeId=null;asset.routeSignature=null;asset.releaseExclusiveRouteOnArrival=false;asset.progress=0;asset.dwellRemaining=0;if(retired)note(env,'retiredRouteIds',retired);note(env,'alerts',`${asset.name}: اكتمل المسار القديم المشترك وتوقف الأصل بأمان لإسناد مسار مستقل.`);}
      else if(asset.salePending){
        if(env.ownedFacilitySet.has(asset.baseFacility)){asset.phase='idle';asset.routeId=null;asset.routeSignature=null;asset.progress=0;asset.dwellRemaining=0;note(env,'saleIds',asset.id);}
        else{asset.dwellRemaining=0;note(env,'alerts',`${asset.name}: وصل محطة عامة ضمن أمر البيع؛ سيعود تلقائيًا إلى مركز المجموعة قبل تنفيذ البيع.`);}
      }
      return writeBack(env,row,before,asset,T,ecoRef);
    }catch(error){
      env.faults++;
      const isolated={...before};
      if(Number.isFinite(scheduledTrip)&&scheduledTrip>0)derive(isolated,at,T,scheduledTrip);else if(isolated.phase==='turnaround')derive(isolated,at,T,0);
      isolated.simulationFault={code:'ASSET_SIMULATION_ISOLATED',at:T,detail:String(error?.message||error).slice(0,180)};isolated.crewBlocked=true;
      note(env,'alerts',`${isolated.name||isolated.id}: عُزل خلل هذا الأصل وحده وبقيت بقية الشركات والمحاكاة عاملة. أعد تعيين مساره أو نفّذ صيانته لإعادة الفحص.`);
      return writeBack(env,row,before,isolated,T);
    }
  }
  // Generic write: every changed field through the store (journaled), then the
  // checkpoint time when the event changed the asset's state.
  function writeBack(env,row,before,after,checkpointAt,lastTripRef=0){
    const store=env.store;let touched=false;
    const touch=()=>{if(!touched){env.touch(row);touched=true;}};
    const keys=new Set([...Object.keys(before),...Object.keys(after)]);
    for(const key of keys){
      const a=before[key],b=after[key];if(same(a,b))continue;
      touch();
      if(key==='lastTrip'&&lastTripRef&&STORE.extrasOf(store,row)?.lastTrip===undefined){const v=STORE.views(store);v.u32[row*WR+W_LAST_TRIP]=lastTripRef;v.u32[row*WR+W_PRESENT]|=B.lastTrip;continue;}
      STORE.set(store,row,key,b);
    }
    if(checkpointAt!==null&&checkpointAt!==undefined){touch();STORE.views(store).f64[row*FR+F_AT]=checkpointAt;}
    return true;
  }

  // A row whose state keeps producing an event at the same instant is isolated
  // (a corrupt row must never freeze the simulation).
  const LOOP_GUARD=64;
  function isolateLoop(env,row,T){
    env.faults++;const store=env.store,before=STORE.materialize(store,row),isolated={...before,simulationFault:{code:'ASSET_EVENT_LOOP_ISOLATED',at:T,detail:'event-loop-guard'},crewBlocked:true};
    note(env,'alerts',`${isolated.name||isolated.id}: عُزل خلل هذا الأصل وحده وبقيت بقية الشركات والمحاكاة عاملة. أعد تعيين مساره أو نفّذ صيانته لإعادة الفحص.`);
    writeBack(env,row,before,isolated,T);
  }

  // ---------------------------------------------------------------- advance ---
  // Process every event with time ≤ `to`. Rows are independent and effects are
  // canonical, so two processing orders give the same fleet and effects:
  // - events: the queue in exact (time, row) order — few events per row, and
  //   the only order that honors maxEvents;
  // - sweep: rows in storage order, each through all its events up to `to` —
  //   sequential memory, no queue, for slices in which many rows move.
  // Options: context (economics context for this interval), resolveRoute(
  // routeId, base), catalogSpecs(asset), tripAlertLimit (beyond it per-trip
  // alert texts are not built; effects.suppressedTripAlerts carries their
  // count), maxEvents (event order only; processing stops after the timestamp
  // at which it is reached and completeTo reports the time up to which every
  // event was processed), order ('events' | 'sweep' | 'auto', the default),
  // fastPath (false forces the general path; tests compare the two),
  // verifySchedule (tests: every fast-path next time must equal nextEventTime).
  function advance(store,options={}){
    const from=Number(options.from),to=Number(options.to);if(!Number.isFinite(from)||!Number.isFinite(to)||to<from)throw new RangeError('fleet-event-slice-invalid');
    const e=engineFor(store),env=makeEnv(e,store,options),useFast=options.fastPath!==false,verify=options.verifySchedule===true;
    const maxEvents=Number.isFinite(Number(options.maxEvents))?Math.max(1,Math.floor(Number(options.maxEvents))):Infinity;
    const q=queueFor(e);
    // Auto: a sweep reads every row's schedule once (~7 ns a row), an event in
    // time order costs a few cache misses (~2 µs): sweep once the slice is
    // expected to move more than one row in 256.
    const order=maxEvents!==Infinity?'events':options.order==='sweep'||options.order==='events'?options.order:
      (e.rate>0?e.rate*(to-from):to-from>=3600?Infinity:0)>Math.max(64,store.live/256)?'sweep':'events';
    let completeTo=to;
    // One event of one row; returns the row's next event time.
    const step=(row,T,hint,repeats)=>{
      env.curT=T;env.curRow=row;env.hint=0;let next;
      if(repeats>=LOOP_GUARD){isolateLoop(env,row,T);next=eventTimeOf(e,row);}
      else{
        next=useFast?fastEvent(env,row,T,hint):NaN;
        if(next!==next){env.hint=0;slowEvent(env,row,T);env.slow++;next=eventTimeOf(e,row);}
        else{env.fast++;if(verify){const expected=rowEventTime(e,row);if(!Object.is(expected,next))throw new Error(`fleet-event-schedule-mismatch:${row}:${next}:${expected}`);}}
      }
      env.events++;return next;
    };
    STORE.withoutDirtyLog(store,()=>{
      const length=store.length,slot=q.slot;
      if(order==='sweep'){
        for(let row=0;row<length;row++){
          let T=slot[2*row];if(!(T<=to))continue;
          let hint=slot[2*row+1],repeats=0;
          while(true){
            const next=step(row,T,hint,repeats);hint=env.hint;
            repeats=next===T?repeats+1:0;T=next;if(!(T<=to))break;
          }
          slot[2*row]=T;slot[2*row+1]=hint;
        }
        q.heapOk=false;q.size=0;return;
      }
      if(!q.heapOk)buildHeap(e);
      let lastTime=-Infinity,loopTime=NaN,loop=null;
      while(q.size){
        const h=q.h,T=h[0],row=h[1];
        if(row>=length||slot[2*row]!==T){heapPop(q);continue;}
        if(T>to)break;
        if(env.events>=maxEvents&&T>lastTime){completeTo=lastTime;break;}
        heapPop(q);
        if(T!==loopTime){loopTime=T;if(loop!==null&&loop.size)loop.clear();}
        const repeats=loop!==null&&loop.size?(loop.get(row)||0):0;
        const next=step(row,T,slot[2*row+1],repeats);lastTime=T;
        slot[2*row]=next;slot[2*row+1]=env.hint;
        if(next!==Infinity)heapPush(q,next,row);
        if(next===T){if(loop===null)loop=new Map();loop.set(row,repeats+1);}
      }
    });
    q.revision=store.revision;
    if(to>from)e.rate=e.rate>0?e.rate*.5+env.events/(to-from)*.5:env.events/(to-from);
    return {effects:finishEffects(env),events:env.events,fast:env.fast,slow:env.slow,faults:env.faults,completeTo,order};
  }

  // Current (derived) values for presentation and read models at time t.
  function currentAsset(store,index,t,{resolveRoute=null}={}){
    const asset=STORE.materialize(store,index),at=STORE.slot(store,'at',index)-Math.max(0,number(asset.simCarrySeconds));
    const route=resolveRoute&&asset.routeId?resolveRoute(asset.routeId,asset.baseFacility):null;
    if(asset.simulationFault)return asset;
    if(!asset.phase)asset.phase=asset.routeId?'moving':'idle';
    if(typeof asset.progress!=='number')asset.progress=0;if(typeof asset.fuel!=='number')asset.fuel=100;if(typeof asset.condition!=='number')asset.condition=100;
    if(asset.simCarrySeconds===undefined)asset.simCarrySeconds=0;
    derive(asset,at,t,Number(asset.tripSeconds||route?.tripSeconds));return asset;
  }
  function queueStats(store){const e=engineFor(store),q=heapFor(e);return {size:q.size,builds:q.builds};}

  const API=Object.freeze({VERSION,DEPARTURE_INTERVAL_SECONDS,advance,nextEventTime,peekNext,timeForEventBudget,currentAsset,checkpointTime,queueStats,derive,fuelRate,conditionRate});
  globalThis.GH_FLEET_EVENTS=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_EVENTS=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
