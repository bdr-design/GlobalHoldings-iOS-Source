// Fleet Core v4 — event-driven fleet simulation over the columnar store.
// The slice engine (simulation-asset-core processOne) walks every asset every
// slice. Here an asset's progress, fuel, condition and dwell are linear in time
// from a checkpoint (`at`), so only assets with a due arrival/departure (or a
// fault/carry/crew re-check) are processed. A processed asset runs exactly the
// processOne transition loop for that slice, from its state derived at the slice
// start, so results match the slice engine up to floating-point rounding.
(()=>{
  'use strict';
  const VERSION='4.0.0';
  const STORE=globalThis.GH_FLEET_STORE||(typeof require==='function'?require('./fleet-store-core.js'):null);
  const CORE=globalThis.GH_SIMULATION_ASSET_CORE||(typeof require==='function'?require('./simulation-asset-core.js'):null);
  if(!STORE||!CORE)throw new Error('Fleet Event Core requires the Fleet Store and Simulation Asset cores');
  const MAX_TRANSITIONS=96;
  const DEPARTURE_INTERVAL_SECONDS=Object.freeze({air:180,sea:60,road:15});
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,number(value)));
  const fuelRate=type=>type==='air'?55:type==='sea'?43:49;
  const conditionRate=type=>type==='air'?.08:type==='sea'?.05:.11;
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);

  // ------------------------------------------------------------ row access ---
  // Assets with non-conforming hot values keep them in extras; the generic store
  // accessors handle those rows, typed columns handle the rest.
  function profileOf(store,index){const value=store.values[store.columns.profile[index]];return value&&typeof value==='object'?value:{};}
  function bindingOf(store,index){const value=store.values[store.columns.binding[index]];return value&&typeof value==='object'?value:{};}
  function extrasOf(store,index){return store.columns.extra[index]===1&&own(store.extras,index)?store.extras[index]:null;}
  const HOT_KIND=new Map(STORE.HOT_FIELDS.map(([name,kind],bit)=>[name,{kind,bit:1<<bit}]));
  const BIT=name=>HOT_KIND.get(name).bit;
  const B={id:BIT('id'),name:BIT('name'),routeId:BIT('routeId'),baseFacility:BIT('baseFacility'),phase:BIT('phase'),progress:BIT('progress'),fuel:BIT('fuel'),condition:BIT('condition'),dwellRemaining:BIT('dwellRemaining'),reverse:BIT('reverse'),routeSlot:BIT('routeSlot'),departureScheduled:BIT('departureScheduled'),departureScheduledAt:BIT('departureScheduledAt'),crewBlocked:BIT('crewBlocked'),releaseExclusiveRouteOnArrival:BIT('releaseExclusiveRouteOnArrival'),simCarrySeconds:BIT('simCarrySeconds'),lastTransitionGuardDay:BIT('lastTransitionGuardDay'),lastTrip:BIT('lastTrip')};
  function hotInExtras(extras){if(!extras)return false;for(const key of Object.keys(extras))if(HOT_KIND.has(key))return true;return false;}
  // Typed-column read of the processOne-visible fields (no copies, no lookups).
  function readAsset(store,index){
    const extras=extrasOf(store,index);if(hotInExtras(extras))return readAssetGeneric(store,index);
    const c=store.columns,p=c.present[index],V=store.values,profile=profileOf(store,index),binding=bindingOf(store,index);
    const r=column=>column[index]===0?null:V[column[index]];
    return {id:(p&B.id)?STORE.joinPattern(V[c.idPattern[index]],c.idNumber[index]):extras?.id,name:(p&B.name)?STORE.joinPattern(V[c.namePattern[index]],c.nameNumber[index]):extras?.name,
      type:profile.type,assetMode:profile.assetMode,ownerCompanyId:profile.ownerCompanyId,companyId:extras?.companyId,specs:profile.specs,staffing:profile.staffing,
      phase:(p&B.phase)?r(c.phase):undefined,progress:(p&B.progress)?c.progress[index]:undefined,fuel:(p&B.fuel)?c.fuel[index]:undefined,condition:(p&B.condition)?c.condition[index]:undefined,dwellRemaining:(p&B.dwellRemaining)?c.dwellRemaining[index]:undefined,reverse:(p&B.reverse)?c.reverse[index]===1:undefined,routeId:(p&B.routeId)?r(c.routeId):undefined,baseFacility:(p&B.baseFacility)?r(c.baseFacility):undefined,routeSlot:(p&B.routeSlot)?c.routeSlot[index]:undefined,
      departureScheduled:(p&B.departureScheduled)?c.departureScheduled[index]===1:undefined,departureScheduledAt:(p&B.departureScheduledAt)?c.departureScheduledAt[index]:undefined,crewBlocked:(p&B.crewBlocked)?c.crewBlocked[index]===1:undefined,releaseExclusiveRouteOnArrival:(p&B.releaseExclusiveRouteOnArrival)?c.releaseExclusiveRouteOnArrival[index]===1:undefined,simCarrySeconds:(p&B.simCarrySeconds)?c.simCarrySeconds[index]:undefined,lastTransitionGuardDay:(p&B.lastTransitionGuardDay)?c.lastTransitionGuardDay[index]:undefined,
      routeSignature:binding.routeSignature,from:binding.from,to:binding.to,distanceKm:binding.distanceKm,tripSeconds:binding.tripSeconds,effectiveSpeedKmh:binding.effectiveSpeedKmh,dwellHours:binding.dwellHours,load:binding.load,
      lastTrip:(p&B.lastTrip)?r(c.lastTrip):undefined,salePending:extras?.salePending,simulationFault:extras?.simulationFault};
  }
  // Generic read for rows whose hot fields hold non-conforming values (kept in extras).
  function readAssetGeneric(store,index){
    const g=field=>STORE.peek(store,index,field),profile=profileOf(store,index),binding=bindingOf(store,index),extras=extrasOf(store,index);
    const asset={id:STORE.idAt(store,index),name:g('name'),type:profile.type,assetMode:profile.assetMode,ownerCompanyId:profile.ownerCompanyId,companyId:extras?.companyId,specs:profile.specs,staffing:profile.staffing,
      phase:g('phase'),progress:g('progress'),fuel:g('fuel'),condition:g('condition'),dwellRemaining:g('dwellRemaining'),reverse:g('reverse'),routeId:g('routeId'),baseFacility:g('baseFacility'),routeSlot:g('routeSlot'),
      departureScheduled:g('departureScheduled'),departureScheduledAt:g('departureScheduledAt'),crewBlocked:g('crewBlocked'),releaseExclusiveRouteOnArrival:g('releaseExclusiveRouteOnArrival'),simCarrySeconds:g('simCarrySeconds'),lastTransitionGuardDay:g('lastTransitionGuardDay'),
      routeSignature:binding.routeSignature,from:binding.from,to:binding.to,distanceKm:binding.distanceKm,tripSeconds:binding.tripSeconds,effectiveSpeedKmh:binding.effectiveSpeedKmh,dwellHours:binding.dwellHours,load:binding.load,
      lastTrip:STORE.peek(store,index,'lastTrip'),salePending:extras?.salePending,simulationFault:extras?.simulationFault};
    return asset;
  }
  function modeOf(asset){return String(asset.assetMode||asset.type||'').trim();}
  function departureDelayOf(asset){const slot=Math.max(0,Math.floor(Number(asset.routeSlot)||0));return slot*(DEPARTURE_INTERVAL_SECONDS[modeOf(asset)]||0);}
  function isMovingPhase(phase){return phase!=='turnaround'&&phase!=='idle';}

  // State at time t from the checkpoint. Linear progression is exactly what the
  // slice engine accumulates slice by slice (clamps are monotone).
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
  function tripSecondsOf(asset,route){const value=Number(asset.tripSeconds||route?.tripSeconds);return value;}
  // Next time the slice engine would change this asset's discrete state.
  function nextEventTime(store,index){
    const extras=extrasOf(store,index);if(extras?.simulationFault)return Infinity;
    const c=store.columns,present=c.present[index];
    const routeId=STORE.peek(store,index,'routeId'),phaseValue=STORE.peek(store,index,'phase'),phase=phaseValue||(routeId?'moving':'idle');
    if(!routeId||phase==='idle')return Infinity;
    const at=c.at[index],carry=number(STORE.peek(store,index,'simCarrySeconds'));if(carry>0)return at;
    if(phase==='turnaround')return at+Math.max(0,number(STORE.peek(store,index,'dwellRemaining')));
    const duration=Number(bindingOf(store,index).tripSeconds);if(!Number.isFinite(duration)||duration<=0)return at;
    void present;return at+Math.max(0,(1-clamp(STORE.peek(store,index,'progress'),0,1))*duration);
  }

  // ------------------------------------------------------------ event queue ---
  // Runtime-only binary min-heap of (time, index, version). Stale entries are
  // skipped by version; any unexplained store change triggers a rebuild.
  const queues=new WeakMap();
  function makeQueue(store){return {store,time:new Float64Array(64),index:new Int32Array(64),ver:new Uint32Array(64),size:0,versions:new Uint32Array(Math.max(16,store.capacity)),revision:store.revision,structure:store.structure,length:store.length,builds:0,values:store.values};}
  function heapPush(q,time,index){
    if(q.size===q.time.length){const cap=q.size*2,t=new Float64Array(cap),i=new Int32Array(cap),v=new Uint32Array(cap);t.set(q.time);i.set(q.index);v.set(q.ver);q.time=t;q.index=i;q.ver=v;}
    let k=q.size++;const ver=q.versions[index];
    while(k>0){const parent=(k-1)>>1;if(q.time[parent]<time||(q.time[parent]===time&&q.index[parent]<=index))break;q.time[k]=q.time[parent];q.index[k]=q.index[parent];q.ver[k]=q.ver[parent];k=parent;}
    q.time[k]=time;q.index[k]=index;q.ver[k]=ver;
  }
  function heapPop(q){
    const top={time:q.time[0],index:q.index[0],ver:q.ver[0]};q.size--;
    if(q.size>0){const time=q.time[q.size],index=q.index[q.size],ver=q.ver[q.size];let k=0;
      while(true){let child=2*k+1;if(child>=q.size)break;const right=child+1;if(right<q.size&&(q.time[right]<q.time[child]||(q.time[right]===q.time[child]&&q.index[right]<q.index[child])))child=right;if(q.time[child]>time||(q.time[child]===time&&q.index[child]>=index))break;q.time[k]=q.time[child];q.index[k]=q.index[child];q.ver[k]=q.ver[child];k=child;}
      q.time[k]=time;q.index[k]=index;q.ver[k]=ver;}
    return top;
  }
  function ensureVersions(q,length){if(q.versions.length<length){const next=new Uint32Array(Math.max(length,q.versions.length*2));next.set(q.versions);q.versions=next;}}
  function schedule(q,index){ensureVersions(q,index+1);q.versions[index]=(q.versions[index]+1)>>>0;const time=nextEventTime(q.store,index);if(time!==Infinity)heapPush(q,time,index);}
  function rebuild(q){
    const store=q.store;q.size=0;q.versions=new Uint32Array(Math.max(16,store.capacity));q.builds++;
    for(let index=0;index<store.length;index++){const time=nextEventTime(store,index);if(time!==Infinity)heapPush(q,time,index);}
    q.revision=store.revision;q.structure=store.structure;q.length=store.length;q.values=store.values;STORE.drainDirty(store,store.revision);
  }
  function queueFor(store){
    let q=queues.get(store);if(!q){q=makeQueue(store);queues.set(store,q);rebuild(q);return q;}
    if(q.revision===store.revision&&q.values===store.values)return q;
    const drained=STORE.drainDirty(store,q.revision);
    if(!drained.complete||q.values!==store.values||drained.revision<q.revision){rebuild(q);return q;}
    for(const index of new Set(drained.indices))if(index<store.length)schedule(q,index);
    q.revision=store.revision;q.structure=store.structure;q.length=store.length;return q;
  }
  function peekNext(store){const q=queueFor(store);while(q.size){const index=q.index[0];if(index>=store.length||q.ver[0]!==q.versions[index]){heapPop(q);continue;}return {time:q.time[0],index};}return null;}

  // -------------------------------------------------------- write-back ---
  const HOT_WRITE=['phase','progress','fuel','condition','dwellRemaining','reverse','routeId','baseFacility','departureScheduled','departureScheduledAt','crewBlocked','releaseExclusiveRouteOnArrival','simCarrySeconds','lastTransitionGuardDay','lastTrip'];
  const BINDING_WRITE=['from','to','load','routeSignature'];
  function same(a,b){return Object.is(a,b)||(a&&b&&typeof a==='object'&&typeof b==='object'&&JSON.stringify(a)===JSON.stringify(b));}
  // Direct typed-column write of one conforming hot value; anything else takes the
  // generic store path (which moves the value to extras exactly like set()).
  function writeHotFast(store,index,field,value,refs){
    const {kind,bit}=HOT_KIND.get(field),c=store.columns;
    if(value===undefined){c.present[index]&=~bit;return;}
    if(kind==='f64'&&typeof value==='number'){c[field][index]=value;c.present[index]|=bit;return;}
    if(kind==='bool'&&typeof value==='boolean'){c[field][index]=value?1:0;c.present[index]|=bit;return;}
    if(kind==='i32'&&Number.isInteger(value)&&value>=-2147483648&&value<=2147483647&&!Object.is(value,-0)){c[field][index]=value;c.present[index]|=bit;return;}
    if(kind==='ref'){let ref=refs?.get(value);if(ref===undefined){ref=STORE.intern(store,value);refs?.set(value,ref);}c[field][index]=ref;c.present[index]|=bit;return;}
    STORE.set(store,index,field,value);
  }
  function writeBack(store,index,before,after,at,refs){
    STORE.touch(store,index);store.columns.at[index]=at;
    const generic=hotInExtras(extrasOf(store,index));
    for(const field of HOT_WRITE){const a=before[field],b=after[field];if(Object.is(a,b))continue;if(field!=='lastTrip'&&a&&b&&typeof a==='object'&&same(a,b))continue;if(generic)STORE.set(store,index,field,b);else writeHotFast(store,index,field,b,refs);}
    const binding=bindingOf(store,index);let changed=false;for(const field of BINDING_WRITE)if(!same(binding[field],after[field])){changed=true;break;}
    if(changed){
      const key=`${store.columns.binding[index]}\u0000${after.from}\u0000${after.to}\u0000${after.load}\u0000${after.routeSignature}\u0000${after.from===undefined}${after.to===undefined}${after.load===undefined}${after.routeSignature===undefined}`;
      let ref=refs?.get(key);
      if(ref===undefined){const next={};for(const k of Object.keys(binding))next[k]=binding[k];for(const field of BINDING_WRITE){if(after[field]===undefined)delete next[field];else next[field]=after[field];}ref=STORE.intern(store,next);refs?.set(key,ref);}
      store.columns.binding[index]=ref;
    }
    for(const field of ['simulationFault','salePending'])if(!same(before[field],after[field]))STORE.set(store,index,field,after[field]);
  }

  // ------------------------------------------------------------- the loop ---
  // processOne's transition loop on an already-derived asset (mutated in place).
  function runAsset(asset,route,remaining,simMeta,ctx,effects,economicsFor,loadLabel=CORE.loadLabel,tripAlert=null){
    const fmtMoney=CORE.fmtMoney,formatDuration=CORE.formatDuration;
    asset.simCarrySeconds=0;
    if(asset.phase==='idle'||!asset.routeId||remaining<=0)return;
    if(!route){asset.simulationFault={code:'ROUTE_RUNTIME_MISSING',at:number(simMeta.from)||number(ctx.simSeconds),detail:`Route runtime missing: ${String(asset.routeId).slice(0,80)}`};asset.crewBlocked=true;effects.alerts.push(`${asset.name||asset.id}: عُزل الأصل لأن تعريف مساره غير متاح. لم يتقدم الأصل أو الزمن التشغيلي الخاص به؛ أعد تعيين المسار بعد المراجعة.`);return;}
    let transitions=0,completedTrips=0,totalTripMargin=0,lastEco=null;
    while(remaining>1e-6&&transitions<MAX_TRANSITIONS&&asset.routeId&&asset.phase!=='idle'){
      transitions++;
      if(asset.phase==='turnaround'){
        const dwell=Math.max(0,number(asset.dwellRemaining));
        if(dwell>remaining){asset.dwellRemaining=dwell-remaining;remaining=0;break;}
        remaining=Math.max(0,remaining-dwell);
        if(asset.staffing?.mode!=='automatic-fixed'||asset.staffing.ready!==true){if(!asset.crewBlocked)effects.alerts.push(`${asset.name}: تكوين الطاقم الثابت غير مكتمل؛ أوقفت هذه الرحلة دون التأثير على بقية اللعبة.`);asset.crewBlocked=true;remaining=0;break;}
        const owner=CORE.assetOwner(asset);
        if(!route||route.id!==asset.routeId||CORE.routeMode(route)!==CORE.assetMode(asset)||CORE.routeOwner(route)!==owner||![route.fromFacility,route.toFacility].includes(asset.baseFacility))throw new Error('route-departure-contract');
        asset.reverse=asset.baseFacility===route.toFacility;asset.phase='moving';asset.progress=0;asset.dwellRemaining=0;asset.fuel=100;asset.crewBlocked=false;asset.departureScheduled=false;asset.departureScheduledAt=undefined;asset.simulationFault=undefined;
        asset.from=asset.reverse?route.to:route.from;asset.to=asset.reverse?route.from:route.to;asset.load=loadLabel(asset);continue;
      }
      const duration=Number(asset.tripSeconds||route.tripSeconds);
      if(!Number.isFinite(duration)||duration<=0){asset.progress=0;asset.phase='idle';asset.routeId=null;asset.routeSignature=null;effects.alerts.push(`${asset.name}: أوقف النظام المسار لأن مدة الرحلة غير صالحة.`);remaining=0;break;}
      const progress=clamp(number(asset.progress),0,1),timeToArrival=Math.max(0,(1-progress)*duration),travel=Math.min(remaining,timeToArrival),delta=duration>0?travel/duration:0;
      asset.progress=clamp(progress+delta,0,1);asset.fuel=clamp(asset.fuel-delta*fuelRate(asset.type),4,100);asset.condition=clamp(asset.condition-delta*conditionRate(asset.type),55,100);
      remaining=Math.max(0,remaining-travel);if(asset.progress<1-1e-9)break;
      asset.progress=1;asset.phase='turnaround';asset.dwellRemaining=Math.max(0,number(route.dwellHours))*3600+departureDelayOf(asset);asset.departureScheduled=true;asset.departureScheduledAt=Math.max(0,(number(simMeta.to)||number(ctx.simSeconds))-remaining)+asset.dwellRemaining;
      asset.baseFacility=asset.reverse?route.fromFacility:route.toFacility;
      const eco=economicsFor(asset,route);asset.lastTrip=eco;lastEco=eco;completedTrips++;totalTripMargin+=number(eco.margin);
      const ownerCompanyId=CORE.assetOwner(asset);if(!ownerCompanyId)throw new Error(`asset-owner-company-missing:${asset.id}`);
      effects.todayProfit+=number(eco.margin);effects.sectorProfit[ownerCompanyId]=(effects.sectorProfit[ownerCompanyId]||0)+number(eco.margin);effects.tripProfit[ownerCompanyId]=(effects.tripProfit[ownerCompanyId]||0)+number(eco.margin);
      const tripCash=Number.isFinite(eco.cashContribution)?eco.cashContribution:(eco.revenue-eco.fuelCost-eco.maintReserve);
      effects.cash[ownerCompanyId]=(effects.cash[ownerCompanyId]||0)+(Number(tripCash)||0);effects.tripRevenue[ownerCompanyId]=(effects.tripRevenue[ownerCompanyId]||0)+Math.max(0,Number(eco.revenue)||0);effects.tripFuel[ownerCompanyId]=(effects.tripFuel[ownerCompanyId]||0)+Math.max(0,Number(eco.fuelCost)||0);effects.tripMaintenance[ownerCompanyId]=(effects.tripMaintenance[ownerCompanyId]||0)+Math.max(0,Number(eco.maintReserve)||0);effects.tripCount[ownerCompanyId]=(effects.tripCount[ownerCompanyId]||0)+1;
      effects.groupValue+=Math.max(0,Number(eco.margin)||0)*.08;
      if(asset.releaseExclusiveRouteOnArrival){const retiredRouteId=asset.routeId;asset.phase='idle';asset.routeId=null;asset.routeSignature=null;asset.releaseExclusiveRouteOnArrival=false;asset.progress=0;asset.dwellRemaining=0;if(retiredRouteId)effects.retiredRouteIds.push(retiredRouteId);effects.alerts.push(`${asset.name}: اكتمل المسار القديم المشترك وتوقف الأصل بأمان لإسناد مسار مستقل.`);remaining=0;break;}
      if(asset.salePending){if(ctx.ownedFacilitySet?.has(asset.baseFacility)){asset.phase='idle';asset.routeId=null;asset.routeSignature=null;asset.progress=0;asset.dwellRemaining=0;effects.saleIds.push(asset.id);remaining=0;break;}asset.dwellRemaining=0;effects.alerts.push(`${asset.name}: وصل محطة عامة ضمن أمر البيع؛ سيعود تلقائيًا إلى مركز المجموعة قبل تنفيذ البيع.`);}
    }
    if(transitions>=MAX_TRANSITIONS&&remaining>1e-6){asset.simCarrySeconds=Math.min(86400,Math.max(0,remaining));const day=Math.floor((number(simMeta.to)||number(ctx.simSeconds))/86400);if(asset.lastTransitionGuardDay!==day){asset.lastTransitionGuardDay=day;effects.alerts.push(`${asset.name}: بلغ حد حماية انتقالات المحاكاة؛ تم حفظ ${formatDuration(asset.simCarrySeconds)} كزمن مرحّل وسيُستكمل في الشريحة التالية دون فقد.`);}}
    else asset.simCarrySeconds=0;
    if(tripAlert&&completedTrips>0){tripAlert(asset,completedTrips,lastEco,totalTripMargin);return;}
    if(completedTrips===1&&lastEco)effects.alerts.push(`${asset.name} أكمل رحلة. إيراد ${fmtMoney(lastEco.revenue)} − وقود ${fmtMoney(lastEco.fuelCost)} − صيانة ${fmtMoney(lastEco.maintReserve)} = هامش الرحلة ${fmtMoney(lastEco.margin)}. الراتب الثابت يُصرف في مسير 27.`);
    else if(completedTrips>1)effects.alerts.push(`${asset.name} أكمل ${completedTrips} رحلات أثناء تقديم الوقت بإجمالي هامش ${fmtMoney(totalTripMargin)}.`);
  }

  // Advance the fleet over (from, to]. Only due assets are processed; each runs
  // the processOne loop for the whole slice from its derived state at `from`.
  // options.resolveRoute(routeId, baseFacility) returns the planned route (or null),
  // options.catalogSpecs(asset) supplies specs for assets that carry none.
  // options.tripAlertLimit: when more trips than this complete in the slice, the
  // per-trip alert texts are not built (the host summarizes from the trip journal)
  // and effects.suppressedTripAlerts carries their count.
  function advance(store,{from,to,context={},resolveRoute,catalogSpecs=null,tripAlertLimit=null}={}){
    const start=Number(from),end=Number(to);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw new RangeError('fleet-event-slice-invalid');
    const effects=CORE.makeEffects(),simMeta={from:start,to:end},ctx={...context,ownedFacilitySet:new Set(context.ownedFacilities||[])};
    const q=queueFor(store),routeCache=new Map(),economicsCache=new Map(),valueRefs=new Map(),processed=new Set(),reschedule=[];
    const routeFor=(routeId,base)=>{const key=`${routeId}\u0000${base||''}`;if(routeCache.has(key))return routeCache.get(key);const route=resolveRoute?resolveRoute(routeId,base)||null:null;routeCache.set(key,route);return route;};
    const economicsFor=(asset,route)=>{const key=`${asset.__profileRef}|${CORE.assetOwner(asset)}|${asset.tripSeconds}|${route.id}|${route.distanceKm}|${route.tripSeconds}`;let eco=economicsCache.get(key);if(!eco){eco=CORE.computeTripEconomics(asset,route,ctx);economicsCache.set(key,eco);}return eco;};
    const loadLabels=new Map(),labelFor=asset=>{const key=asset.__profileRef;if(key===undefined)return CORE.loadLabel(asset);let label=loadLabels.get(key);if(label===undefined){label=CORE.loadLabel(asset);loadLabels.set(key,label);}return label;};
    const limit=tripAlertLimit!==null&&tripAlertLimit!==undefined&&Number.isFinite(Number(tripAlertLimit))?Number(tripAlertLimit):null,pendingTripAlerts=[];
    const tripAlert=limit===null?null:(asset,count,eco,total)=>{pendingTripAlerts.push({name:asset.name,count,eco,total});};
    let events=0,faults=0;
    while(q.size){
      const top=q.time[0],index=q.index[0];
      if(index>=store.length||q.ver[0]!==q.versions[index]){heapPop(q);continue;}
      if(top>end)break;heapPop(q);
      if(processed.has(index))continue;processed.add(index);events++;
      const before=readAsset(store,index),at=store.columns.at[index];
      const route=before.routeId?routeFor(before.routeId,before.baseFacility):null;
      // Same first step as processOne: normalize from the route and catalog.
      let asset=CORE.normalizeAsset({...before},route,catalogSpecs?catalogSpecs(before):null);asset.__profileRef=store.columns.profile[index];
      derive(asset,at,start,tripSecondsOf(asset,route));
      const startProgress=asset.progress,startFuel=asset.fuel,startCondition=asset.condition,startDwell=asset.dwellRemaining;
      try{
        if(!asset.simulationFault)runAsset(asset,route,Math.max(0,end-start)+Math.max(0,number(before.simCarrySeconds)),simMeta,ctx,effects,economicsFor,labelFor,tripAlert);
      }catch(error){
        faults++;asset={...before,progress:startProgress,fuel:startFuel,condition:startCondition,dwellRemaining:startDwell,simulationFault:{code:'ASSET_SIMULATION_ISOLATED',at:start,detail:String(error?.message||error).slice(0,180)},crewBlocked:true};
        effects.alerts.push(`${asset.name||asset.id}: عُزل خلل هذا الأصل وحده وبقيت بقية الشركات والمحاكاة عاملة. أعد تعيين مساره أو نفّذ صيانته لإعادة الفحص.`);
      }
      delete asset.__profileRef;
      writeBack(store,index,before,asset,end,valueRefs);
      // Keep the event schedule on the normalized trip time the loop used.
      const trip=Number(asset.tripSeconds);if(Number.isFinite(trip)&&trip>0&&!Object.is(bindingOf(store,index).tripSeconds,trip)){const key=`trip\u0000${store.columns.binding[index]}\u0000${trip}`;let ref=valueRefs.get(key);if(ref===undefined){ref=STORE.intern(store,{...bindingOf(store,index),tripSeconds:trip});valueRefs.set(key,ref);}store.columns.binding[index]=ref;}
      reschedule.push(index);
    }
    if(pendingTripAlerts.length){
      if(pendingTripAlerts.length<=limit)for(const row of pendingTripAlerts){if(row.count===1)effects.alerts.push(`${row.name} أكمل رحلة. إيراد ${CORE.fmtMoney(row.eco.revenue)} − وقود ${CORE.fmtMoney(row.eco.fuelCost)} − صيانة ${CORE.fmtMoney(row.eco.maintReserve)} = هامش الرحلة ${CORE.fmtMoney(row.eco.margin)}. الراتب الثابت يُصرف في مسير 27.`);else effects.alerts.push(`${row.name} أكمل ${row.count} رحلات أثناء تقديم الوقت بإجمالي هامش ${CORE.fmtMoney(row.total)}.`);}
      else effects.suppressedTripAlerts=pendingTripAlerts.length;
    }
    for(const index of reschedule)schedule(q,index);
    STORE.drainDirty(store,q.revision);q.revision=store.revision;q.structure=store.structure;q.length=store.length;
    return {effects,events,faults,processed:reschedule};
  }

  // Current (derived) values for presentation and read models at time t.
  function currentAsset(store,index,t,{resolveRoute=null}={}){
    const asset=STORE.materialize(store,index),at=store.columns.at[index];
    const route=resolveRoute&&asset.routeId?resolveRoute(asset.routeId,asset.baseFacility):null;
    if(asset.simulationFault)return asset;
    // The slice engine writes these defaults for every live asset on its first
    // slice; the event view presents the same values without touching the row.
    if(!asset.phase)asset.phase=asset.routeId?'moving':'idle';
    if(typeof asset.progress!=='number')asset.progress=0;if(typeof asset.fuel!=='number')asset.fuel=100;if(typeof asset.condition!=='number')asset.condition=100;
    if(asset.simCarrySeconds===undefined)asset.simCarrySeconds=0;
    derive(asset,at,t,tripSecondsOf(asset,route));return asset;
  }
  function progressAt(store,index,t){
    const phase=STORE.peek(store,index,'phase'),routeId=STORE.peek(store,index,'routeId');
    const p0=clamp(STORE.peek(store,index,'progress'),0,1);if(!routeId||!isMovingPhase(phase||'moving')||extrasOf(store,index)?.simulationFault)return p0;
    const duration=Number(bindingOf(store,index).tripSeconds);if(!Number.isFinite(duration)||duration<=0)return p0;
    return clamp(p0+Math.max(0,t-store.columns.at[index])/duration,0,1);
  }
  // Bring every row's checkpoint to t (used before exporting a legacy save).
  function checkpointAll(store,t,options){for(let index=0;index<store.length;index++){const asset=currentAsset(store,index,t,options);for(const field of ['progress','fuel','condition','dwellRemaining'])if(asset[field]!==undefined&&typeof asset[field]==='number')STORE.set(store,index,field,asset[field]);store.columns.at[index]=t;}}
  function queueStats(store){const q=queueFor(store);return {size:q.size,builds:q.builds};}

  const API=Object.freeze({VERSION,MAX_TRANSITIONS,DEPARTURE_INTERVAL_SECONDS,advance,nextEventTime,peekNext,currentAsset,progressAt,checkpointAll,queueStats,derive});
  globalThis.GH_FLEET_EVENTS=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_EVENTS=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
