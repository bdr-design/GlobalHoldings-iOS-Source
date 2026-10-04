(()=>{
  'use strict';
  const VERSION='3.0.0';
  const ROUTE_TYPES=Object.freeze(['air','sea','road']);
  const fleetData=()=>{const api=globalThis.GH_FLEET_DATA||(typeof require==='function'?require('./fleet-access-core.js'):null);if(!api)throw new Error('fleet-data-access-unavailable');return api;};
  // fleetCapacity: the most assets one route may carry (Build 358; GH_FLEET_CORE.routeCapacity reads it per mode).
  // Build 358 (million-asset routes): the registry holds 960 routes in three mode quotas of 320 (air, sea, road), so one
  // mode can never take the slots another needs (a large air dispatch used to leave road fleets no route at all). A
  // route carries up to fleetCapacity (8,192) assets, so each mode reaches 320 x 8,192 = 2.6 million assets. Dispatch
  // plans within its mode's free slots (allocateRouteSlots) and raises the per-route load instead of rejecting.
  const LIMITS=Object.freeze({routes:960,endpoints:1440,cacheEntries:160,pointsPerRoute:2048,routeBytes:256*1024,cacheBytes:512*1024,fleetCapacity:8192});
  const MODE_ROUTE_QUOTA=Object.freeze({air:320,sea:320,road:320});
  const NEAR_DUPLICATE=Object.freeze({sampleCount:33,endpointKm:2.5,meanKm:1.25,maxKm:3,lengthRatio:1.04});
  const clone=value=>globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const text=(value,max=120)=>String(value??'').trim().slice(0,max);
  const platform=()=>globalThis.GH_COMPANY_PLATFORM||null;
  const routeMode=route=>text(route?.routeMode||route?.type,48);
  function routeOwnerCompanyId(route){
    const mode=routeMode(route),explicit=text(route?.ownerCompanyId||route?.companyId||route?.company,80);
    return explicit||text(platform()?.ownerForLegacyRouteMode?.(mode),80);
  }
  function validateRouteOwnership(route,state=null){
    const P=platform(),mode=routeMode(route),companyId=routeOwnerCompanyId(route);
    if(!mode)throw new Error('route-mode-missing');
    if(!companyId)throw new Error('route-owner-company-missing');
    if(P){
      const company=state?P.requireCompany(state,companyId,{operational:true,capability:'operations.fleet'}):P.getDefinition(companyId);
      const definition=company?.definition||company;
      if(!definition)throw new Error(`route-owner-company-unknown:${companyId}`);
      if(!definition.classification?.routeModes?.includes(mode))throw new Error(`route-mode-owner-mismatch:${companyId}:${mode}`);
    }else if(!ROUTE_TYPES.includes(mode)||companyId!==mode)throw new Error('route-company-isolation');
    return {companyId,mode};
  }

  function bytes(value){
    const json=typeof value==='string'?value:JSON.stringify(value);
    if(globalThis.TextEncoder)return new TextEncoder().encode(json).byteLength;
    return unescape(encodeURIComponent(json)).length;
  }
  function validPoint(point){return Array.isArray(point)&&point.length>=2&&finite(point[0])&&finite(point[1])&&point[0]>=-90&&point[0]<=90&&point[1]>=-180&&point[1]<=180;}
  function haversine(a,b){
    if(!validPoint(a)||!validPoint(b))return Infinity;
    const rad=Math.PI/180,dLat=(b[0]-a[0])*rad,dLon=(b[1]-a[1])*rad,lat1=a[0]*rad,lat2=b[0]*rad;
    const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 6371*2*Math.asin(Math.min(1,Math.sqrt(h)));
  }
  function routeLength(points){let total=0;for(let i=1;i<points.length;i++)total+=haversine(points[i-1],points[i]);return total;}
  // Read-only rendering geometry. Canonical routes and simulated trip times stay unchanged.
  function splitAtDateline(points){
    if(!Array.isArray(points)||points.length<2||points.some(point=>!validPoint(point)))return [];
    const segments=[],copy=point=>[point[0],point[1]];let current=[copy(points[0])];
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],delta=((b[1]-a[1]+540)%360)-180;
      if(Math.abs(b[1]-a[1])>180){
        const boundary=delta===0?a[1]:(delta>0?180:-180),t=delta?(boundary-a[1])/delta:0,latitude=a[0]+(b[0]-a[0])*t;
        current.push([latitude,boundary]);segments.push(current);current=[[latitude,-boundary]];
      }
      current.push(copy(b));
    }
    segments.push(current);return segments;
  }
  function validateRoute(route,{requireCompany=true,state=null}={}){
    const errors=[];
    if(!object(route))return {ok:false,errors:['route-not-object']};
    const id=text(route.id,80),mode=routeMode(route),points=route.route;
    if(!id||id!==String(route.id)||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id))errors.push('route-id');
    if(!mode||(platform()?!platform().isKnownRouteMode(mode):!ROUTE_TYPES.includes(mode)))errors.push('route-mode');
    if(requireCompany)try{validateRouteOwnership(route,state);}catch(error){errors.push(String(error?.message||error));}
    if(!text(route.fromFacility,100)||!text(route.toFacility,100)||route.fromFacility===route.toFacility)errors.push('route-endpoints');
    if(!Array.isArray(points)||points.length<2||points.length>LIMITS.pointsPerRoute)errors.push('route-points-count');
    else if(points.some(point=>!validPoint(point)))errors.push('route-point');
    if(Array.isArray(points)&&points.length>=2&&points.every(validPoint)&&routeLength(points)<0.05)errors.push('route-length');
    try{if(bytes(route)>LIMITS.routeBytes)errors.push('route-size');}catch(_error){errors.push('route-serialization');}
    for(const key of ['effectiveSpeedKmh','distanceKm','tripSeconds','dwellHours'])if(route[key]!==undefined&&(!Number.isFinite(Number(route[key]))||Number(route[key])<0))errors.push(`route-${key}`);
    if(route.fleetCapacity!==undefined&&!(Number.isSafeInteger(route.fleetCapacity)&&route.fleetCapacity>=1&&route.fleetCapacity<=LIMITS.fleetCapacity))errors.push('route-fleetCapacity');
    return {ok:errors.length===0,errors:[...new Set(errors)]};
  }
  function canonicalRoute(route,state=null){
    const out=clone(route),validation=validateRoute(out,{state});
    if(!validation.ok)throw new Error(`invalid-route:${validation.errors.join(',')}`);
    const owner=validateRouteOwnership(out,state);out.id=text(out.id,80);out.routeMode=owner.mode;out.ownerCompanyId=owner.companyId;
    // `type` is retained only as a legacy mode alias. `company` is never
    // synthesized: legal/display identity belongs to the company registry.
    if(out.type!==undefined)out.type=owner.mode;
    out.fromFacility=text(out.fromFacility,100);out.toFacility=text(out.toFacility,100);
    out.from=text(out.from||out.fromFacility,160);out.to=text(out.to||out.toFacility,160);out.name=text(out.name||`${out.from} → ${out.to}`,220);
    out.route=out.route.map(point=>[Number(point[0]),Number(point[1])]);
    return out;
  }
  function ensure(state){
    state.customRoutes=Array.isArray(state.customRoutes)?state.customRoutes:[];
    state.routeEndpoints=object(state.routeEndpoints)?state.routeEndpoints:{};
    state.routeCache=object(state.routeCache)?state.routeCache:{};
    return state;
  }
  function bumpRoutesRevision(state){const current=Math.max(0,Math.floor(Number(state.routesRevision)||0));if(current>=Number.MAX_SAFE_INTEGER)throw new Error('route-revision-exhausted');state.routesRevision=current+1;return state.routesRevision;}
  // Build 358 (million-asset): geometry results are kept per points array (route points are never edited in place:
  // routes are canonicalized into new arrays), so duplicate checks against every registered route stop recomputing
  // the same hashes and samples for each new route.
  const geometrySignatures=new WeakMap(),geometrySamples=new WeakMap(),geometryLengths=new WeakMap();
  function geometrySignature(rawPoints){
    if(geometrySignatures.has(rawPoints))return geometrySignatures.get(rawPoints);
    const points=rawPoints.filter(validPoint).map(point=>`${Number(point[0]).toFixed(5)},${Number(point[1]).toFixed(5)}`);let out='';
    if(points.length>=2){
      const forward=points.join(';'),reverse=[...points].reverse().join(';'),canonical=forward<reverse?forward:reverse;
      const hash=(value,seed)=>{let result=seed>>>0;for(let i=0;i<value.length;i++){result^=value.charCodeAt(i);result=Math.imul(result,16777619)>>>0;}return result.toString(36);};
      out=`${points.length}:${hash(canonical,2166136261)}:${hash(canonical,2246822519)}`;
    }
    geometrySignatures.set(rawPoints,out);return out;
  }
  function signature(route){
    const geometry=Array.isArray(route?.route)?geometrySignature(route.route):'';
    return geometry?`${routeOwnerCompanyId(route)}:${routeMode(route)}:${geometry}`:'';
  }
  function sample(points,count=NEAR_DUPLICATE.sampleCount){
    if(!Array.isArray(points)||points.length<2||points.some(point=>!validPoint(point)))return [];
    const cumulative=[0];for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]+haversine(points[i-1],points[i]));
    const total=cumulative[cumulative.length-1];if(!(total>0))return [];
    const output=[];let segment=1;
    for(let i=0;i<count;i++){
      const target=total*(i/(count-1));while(segment<cumulative.length-1&&cumulative[segment]<target)segment++;
      const start=Math.max(0,segment-1),span=cumulative[segment]-cumulative[start],ratio=span>0?(target-cumulative[start])/span:0,a=points[start],b=points[segment];
      let longitude=a[1]+((((b[1]-a[1]+540)%360)-180)*ratio);if(longitude>180)longitude-=360;if(longitude<-180)longitude+=360;
      output.push([a[0]+(b[0]-a[0])*ratio,longitude]);
    }
    return output;
  }
  const cachedSample=points=>{if(!Array.isArray(points))return sample(points);let out=geometrySamples.get(points);if(!out){out=sample(points);geometrySamples.set(points,out);}return out;};
  const cachedLength=points=>{let out=geometryLengths.get(points);if(out===undefined){out=routeLength(points);geometryLengths.set(points,out);}return out;};
  function corridorMetrics(first,second){
    if(!first||!second||routeMode(first)!==routeMode(second)||routeOwnerCompanyId(first)!==routeOwnerCompanyId(second))return {comparable:false,duplicate:false};
    const a=cachedSample(first.route),b=cachedSample(second.route);if(!a.length||!b.length)return {comparable:false,duplicate:false};
    const lengthA=cachedLength(first.route),lengthB=cachedLength(second.route),ratio=Math.max(lengthA,lengthB)/Math.max(.001,Math.min(lengthA,lengthB));
    const score=right=>{const distances=a.map((point,index)=>haversine(point,right[index])),endpoint=Math.max(distances[0],distances[distances.length-1]),mean=distances.reduce((sum,value)=>sum+value,0)/distances.length,max=Math.max(...distances);return {endpoint,mean,max};};
    const forward=score(b),reverse=score([...b].reverse()),best=(forward.mean+forward.endpoint)<=(reverse.mean+reverse.endpoint)?forward:reverse;
    return {comparable:true,lengthA,lengthB,lengthRatio:ratio,...best,duplicate:ratio<=NEAR_DUPLICATE.lengthRatio&&best.endpoint<=NEAR_DUPLICATE.endpointKm&&best.mean<=NEAR_DUPLICATE.meanKm&&best.max<=NEAR_DUPLICATE.maxKm};
  }
  function conflict(routes,candidate,{ignoreId=null}={}){
    const exact=signature(candidate);
    for(const existing of Array.isArray(routes)?routes:[]){
      if(!existing||existing.id===ignoreId)continue;
      if(existing.id===candidate.id)return {code:'duplicate-route-id',route:existing};
      if(exact&&signature(existing)===exact)return {code:'duplicate-route',route:existing};
      const metrics=corridorMetrics(existing,candidate);if(metrics.duplicate)return {code:'near-duplicate-route',route:existing,metrics};
    }
    return null;
  }
  function validateEndpoint(endpoint){
    if(!object(endpoint)||!text(endpoint.id,100)||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(String(endpoint.id))||!validPoint(endpoint.coords))throw new Error('invalid-route-endpoint');
    return {...clone(endpoint),id:text(endpoint.id,100),coords:[Number(endpoint.coords[0]),Number(endpoint.coords[1])]};
  }
  function cacheGeometry(state,payload){
    const id=text(payload.id,80);if(!id)throw new Error('route-id-required');
    const canonical=state.customRoutes.find(route=>route.id===id),points=payload.route;
    if(!canonical&&(!Array.isArray(points)||points.length<2||points.length>LIMITS.pointsPerRoute||points.some(point=>!validPoint(point))))throw new Error('invalid-route-cache-geometry');
    if(!Object.prototype.hasOwnProperty.call(state.routeCache,id)&&Object.keys(state.routeCache).length>=LIMITS.cacheEntries)throw new Error('route-cache-capacity');
    const entry={distanceKm:Math.max(0,Number(payload.distanceKm)||0),durationSeconds:Math.max(0,Number(payload.durationSeconds)||0),cachedAtSim:Math.max(0,Number(state.simSeconds)||0),routeSignature:signature(canonical||{routeMode:payload.routeMode||payload.type,ownerCompanyId:payload.ownerCompanyId||payload.companyId||payload.company,route:points})};
    // A custom route already owns its geometry. Duplicating it in the cache causes save growth.
    if(!canonical)entry.route=points.map(point=>[Number(point[0]),Number(point[1])]);else entry.canonicalRouteId=id;
    const next={...state.routeCache,[id]:entry};if(bytes(next)>LIMITS.cacheBytes)throw new Error('route-cache-size-capacity');
    state.routeCache[id]=entry;return entry;
  }
  // Build 358 (million-asset): the bases and routes assets use are read once from their columns (cached per chunk),
  // not by walking the fleet per endpoint or per route.
  const routeIdsInUse=state=>fleetData().distinctRefs(state,'routeId');
  function collectUnusedEndpoints(state){
    let bases=null;
    for(const [endpointId,endpoint] of Object.entries(state.routeEndpoints)){
      if(!endpoint?.routeEndpoint)continue;
      const stillUsed=state.customRoutes.some(route=>route.fromFacility===endpointId||route.toFacility===endpointId)||(bases||(bases=fleetData().distinctRefs(state,'baseFacility'))).has(endpointId);
      if(endpoint?.routeEndpoint&&!stillUsed)delete state.routeEndpoints[endpointId];
    }
  }
  // The routes a mode holds, its quota and the slots it may still create (bounded by the whole registry too).
  function modeRouteBudget(state,mode){
    const routes=Array.isArray(state?.customRoutes)?state.customRoutes:[],quota=MODE_ROUTE_QUOTA[mode]||LIMITS.routes;let used=0;
    for(const route of routes)if(routeMode(route)===mode)used++;
    const free=Math.max(0,Math.min(quota-used,LIMITS.routes-routes.length)),reserve=Math.ceil(quota*.1);
    // planning: the routes a dispatch spreads its fleet over. It leaves a tenth of the quota free for bases added later
    // (their assets need routes from their own origin); once the free slots are within that reserve they all count.
    return {mode,quota,used,free,reserve,planning:used+(free>reserve?free-reserve:free)};
  }
  // New routes for groups of assets waiting at their origins (one group per origin; a group needs at least one route):
  // the preferred load per route while the free slots allow it, else the slots shared out by group size and the load
  // raised to fit, never above maxLoad. Returns per group {routes, load}; throws when even that cannot fit.
  function allocateRouteSlots(groupSizes,freeSlots,preferredLoad,maxLoad=LIMITS.fleetCapacity){
    const sizes=(Array.isArray(groupSizes)?groupSizes:[]).map(n=>Math.max(0,Math.floor(Number(n)||0))),free=Math.max(0,Math.floor(Number(freeSlots)||0)),preferred=Math.max(1,Math.floor(Number(preferredLoad)||1)),max=Math.max(preferred,Math.floor(Number(maxLoad)||preferred));
    const active=sizes.filter(n=>n>0).length,wanted=sizes.map(n=>n?Math.ceil(n/preferred):0),wantedTotal=wanted.reduce((a,b)=>a+b,0);
    if(wantedTotal<=free)return sizes.map((n,i)=>({routes:wanted[i],load:n?Math.min(preferred,n):0}));
    if(active>free){const error=new Error('route-mode-capacity');error.code='route-mode-capacity';error.needed=active;error.free=free;throw error;}
    const total=sizes.reduce((a,b)=>a+b,0),spare=free-active,slots=sizes.map(n=>n?Math.min(Math.ceil(n/preferred),1+Math.floor(spare*n/total)):0);
    return sizes.map((n,i)=>{if(!n)return {routes:0,load:0};const load=Math.ceil(n/slots[i]);if(load>max){const error=new Error('route-load-capacity');error.code='route-load-capacity';throw error;}return {routes:Math.ceil(n/load),load};});
  }
  // The new-route allocation for one dispatch within a mode's budget: the free slots down to the reserve, or half of what
  // is free when that is more (at least one route per waiting origin), so later bases still find slots; the whole
  // remainder only when nothing less fits.
  function allocateForBudget(budget,groupSizes,preferredLoad,maxLoad=LIMITS.fleetCapacity){
    const free=Math.max(0,Math.floor(Number(budget?.free)||0)),reserve=Math.max(0,Math.floor(Number(budget?.reserve)||0)),active=(groupSizes||[]).filter(n=>Number(n)>0).length;
    const share=Math.max(active,free-reserve,Math.ceil(free/2));
    try{return allocateRouteSlots(groupSizes,Math.min(free,share),preferredLoad,maxLoad);}
    catch(error){if(error.code!=='route-load-capacity'||share>=free)throw error;return allocateRouteSlots(groupSizes,free,preferredLoad,maxLoad);}
  }
  function execute(ctx,command,payload={}){
    const state=ensure(ctx.state||ctx);
    if(command==='create'||command==='create-with-cache'){
      if(state.customRoutes.length>=LIMITS.routes)throw new Error('route-capacity');
      const route=canonicalRoute(payload.route,state),existing=conflict(state.customRoutes,route);
      if(modeRouteBudget(state,routeMode(route)).free<=0)throw new Error('route-mode-capacity');
      if(existing)throw new Error(existing.code);
      state.customRoutes.push(route);
      const cache=command==='create-with-cache'?cacheGeometry(state,{id:route.id,route:route.route,distanceKm:payload.distanceKm??route.distanceKm,durationSeconds:payload.durationSeconds??route.tripSeconds}):null;
      bumpRoutesRevision(state);
      return command==='create-with-cache'?{route,cache}:route;
    }
    if(command==='replace'){
      const replaceId=text(payload.replaceId,80),assetId=text(payload.assetId,100),index=state.customRoutes.findIndex(route=>route.id===replaceId);if(index<0)throw new Error('route-replace-missing');
      let foreignUse=false;if(routeIdsInUse(state).has(replaceId)){const fleet=fleetData();fleet.scan(state,['id','routeId'],row=>{if(row.routeId===replaceId&&row.id!==assetId){foreignUse=true;return fleet.STOP;}});}if(foreignUse)throw new Error('route-replace-in-use');
      const route=canonicalRoute(payload.route,state),existing=conflict(state.customRoutes,route,{ignoreId:replaceId});if(existing)throw new Error(existing.code);
      state.customRoutes[index]=route;delete state.routeCache[replaceId];collectUnusedEndpoints(state);bumpRoutesRevision(state);return route;
    }
    if(command==='delete'){
      const id=text(payload.id,80),used=routeIdsInUse(state).has(id);if(used)throw new Error('route-in-use');
      const before=state.customRoutes.length;state.customRoutes=state.customRoutes.filter(route=>route.id!==id);delete state.routeCache[id];
      collectUnusedEndpoints(state);
      if(before!==state.customRoutes.length)bumpRoutesRevision(state);
      return before!==state.customRoutes.length;
    }
    if(command==='dedupe'){
      // Route ids in use: the distinct truthy routeId values, read from the column (no view per asset).
      const used=fleetData().distinctRefs(state,'routeId'),kept=[],removedIds=[],conflicts=[];
      for(const raw of state.customRoutes){
        let route;try{route=canonicalRoute(raw,state);}catch(_error){kept.push(raw);continue;}
        const found=conflict(kept,route);
        if(!found){kept.push(route);continue;}
        const existing=found.route,existingUsed=used.has(existing.id),routeUsed=used.has(route.id);
        if(existingUsed&&routeUsed){kept.push(route);conflicts.push([existing.id,route.id]);continue;}
        if(routeUsed&&!existingUsed){const index=kept.findIndex(row=>row.id===existing.id);if(index>=0)kept.splice(index,1);delete state.routeCache[existing.id];removedIds.push(existing.id);kept.push(route);continue;}
        delete state.routeCache[route.id];removedIds.push(route.id);
      }
      if(removedIds.length){state.customRoutes=kept;bumpRoutesRevision(state);}return {removed:removedIds.length,removedIds,conflicts};
    }
    if(command==='set-fleet-capacity'){
      // Raise (or reset) the most assets one route carries. Lowering it below the route's current users is refused.
      const id=text(payload.id,80),index=state.customRoutes.findIndex(route=>route.id===id);if(index<0)throw new Error('route-capacity-missing');
      const capacity=Number(payload.capacity);if(!Number.isSafeInteger(capacity)||capacity<1||capacity>LIMITS.fleetCapacity)throw new Error('route-fleet-capacity-invalid');
      const minimum=Math.max(0,Math.floor(Number(payload.inUse)||0));if(capacity<minimum)throw new Error('route-fleet-capacity-below-use');
      const route=state.customRoutes[index];if(route.fleetCapacity===capacity)return route;
      state.customRoutes[index]={...route,fleetCapacity:capacity};bumpRoutesRevision(state);return state.customRoutes[index];
    }
    if(command==='register-endpoint'){
      const endpoint=validateEndpoint(payload.endpoint),exists=Object.prototype.hasOwnProperty.call(state.routeEndpoints,endpoint.id);
      if(!exists&&Object.keys(state.routeEndpoints).length>=LIMITS.endpoints)throw new Error('route-endpoint-capacity');
      const changed=JSON.stringify(state.routeEndpoints[endpoint.id]||null)!==JSON.stringify(endpoint);state.routeEndpoints[endpoint.id]=endpoint;if(changed)bumpRoutesRevision(state);return endpoint;
    }
    if(command==='cache-geometry'){const before=JSON.stringify(state.routeCache[payload.id]||null),entry=cacheGeometry(state,payload);if(before!==JSON.stringify(entry))bumpRoutesRevision(state);return entry;}
    throw new Error(`Unknown route command: ${command}`);
  }
  const API=Object.freeze({VERSION,ROUTE_TYPES,LIMITS,MODE_ROUTE_QUOTA,modeRouteBudget,allocateRouteSlots,allocateForBudget,NEAR_DUPLICATE,ensure,validPoint,splitAtDateline,routeMode,routeOwnerCompanyId,validateRouteOwnership,validateRoute,canonicalRoute,signature,sample,corridorMetrics,conflict,execute});
  globalThis.GH_ROUTE_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('routes',API);if(globalThis.window&&window!==globalThis)window.GH_ROUTE_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
