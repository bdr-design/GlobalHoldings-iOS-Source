(()=>{
  'use strict';
  const VERSION='3.0.0';
  const ROUTE_TYPES=Object.freeze(['air','sea','road']);
  const LIMITS=Object.freeze({routes:240,endpoints:360,cacheEntries:160,pointsPerRoute:2048,routeBytes:256*1024,cacheBytes:512*1024});
  const NEAR_DUPLICATE=Object.freeze({sampleCount:33,endpointKm:2.5,meanKm:1.25,maxKm:3,lengthRatio:1.04});
  const clone=value=>globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const text=(value,max=120)=>String(value??'').trim().slice(0,max);

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
  function validateRoute(route,{requireCompany=true}={}){
    const errors=[];
    if(!object(route))return {ok:false,errors:['route-not-object']};
    const id=text(route.id,80),type=text(route.type,16),company=text(route.company||route.type,16),points=route.route;
    if(!id||id!==String(route.id)||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id))errors.push('route-id');
    if(!ROUTE_TYPES.includes(type))errors.push('route-type');
    if(requireCompany&&company!==type)errors.push('route-company-isolation');
    if(!text(route.fromFacility,100)||!text(route.toFacility,100)||route.fromFacility===route.toFacility)errors.push('route-endpoints');
    if(!Array.isArray(points)||points.length<2||points.length>LIMITS.pointsPerRoute)errors.push('route-points-count');
    else if(points.some(point=>!validPoint(point)))errors.push('route-point');
    if(Array.isArray(points)&&points.length>=2&&points.every(validPoint)&&routeLength(points)<0.05)errors.push('route-length');
    try{if(bytes(route)>LIMITS.routeBytes)errors.push('route-size');}catch(_error){errors.push('route-serialization');}
    for(const key of ['effectiveSpeedKmh','distanceKm','tripSeconds','dwellHours'])if(route[key]!==undefined&&(!Number.isFinite(Number(route[key]))||Number(route[key])<0))errors.push(`route-${key}`);
    return {ok:errors.length===0,errors:[...new Set(errors)]};
  }
  function canonicalRoute(route){
    const out=clone(route),validation=validateRoute(out);
    if(!validation.ok)throw new Error(`invalid-route:${validation.errors.join(',')}`);
    out.id=text(out.id,80);out.type=text(out.type,16);out.company=out.type;
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
  function signature(route){
    const points=(Array.isArray(route?.route)?route.route:[]).filter(validPoint).map(point=>`${Number(point[0]).toFixed(5)},${Number(point[1]).toFixed(5)}`);
    if(points.length<2)return '';
    const forward=points.join(';'),reverse=[...points].reverse().join(';'),canonical=forward<reverse?forward:reverse;
    const hash=(value,seed)=>{let result=seed>>>0;for(let i=0;i<value.length;i++){result^=value.charCodeAt(i);result=Math.imul(result,16777619)>>>0;}return result.toString(36);};
    return `${route?.company||route?.type||''}:${route?.type||''}:${points.length}:${hash(canonical,2166136261)}:${hash(canonical,2246822519)}`;
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
  function corridorMetrics(first,second){
    if(!first||!second||first.type!==second.type||(first.company||first.type)!==(second.company||second.type))return {comparable:false,duplicate:false};
    const a=sample(first.route),b=sample(second.route);if(!a.length||!b.length)return {comparable:false,duplicate:false};
    const lengthA=routeLength(first.route),lengthB=routeLength(second.route),ratio=Math.max(lengthA,lengthB)/Math.max(.001,Math.min(lengthA,lengthB));
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
    const entry={distanceKm:Math.max(0,Number(payload.distanceKm)||0),durationSeconds:Math.max(0,Number(payload.durationSeconds)||0),cachedAtSim:Math.max(0,Number(state.simSeconds)||0),routeSignature:signature(canonical||{type:payload.type,company:payload.company,route:points})};
    // A custom route already owns its geometry. Duplicating it in the cache causes save growth.
    if(!canonical)entry.route=points.map(point=>[Number(point[0]),Number(point[1])]);else entry.canonicalRouteId=id;
    const next={...state.routeCache,[id]:entry};if(bytes(next)>LIMITS.cacheBytes)throw new Error('route-cache-size-capacity');
    state.routeCache[id]=entry;return entry;
  }
  function collectUnusedEndpoints(state){
    for(const [endpointId,endpoint] of Object.entries(state.routeEndpoints)){
      const stillUsed=state.customRoutes.some(route=>route.fromFacility===endpointId||route.toFacility===endpointId)||(state.assets||[]).some(asset=>asset.baseFacility===endpointId);
      if(endpoint?.routeEndpoint&&!stillUsed)delete state.routeEndpoints[endpointId];
    }
  }
  function execute(ctx,command,payload={}){
    const state=ensure(ctx.state||ctx);
    if(command==='create'||command==='create-with-cache'){
      if(state.customRoutes.length>=LIMITS.routes)throw new Error('route-capacity');
      const route=canonicalRoute(payload.route),existing=conflict(state.customRoutes,route);
      if(existing)throw new Error(existing.code);
      state.customRoutes.push(route);
      const cache=command==='create-with-cache'?cacheGeometry(state,{id:route.id,route:route.route,distanceKm:payload.distanceKm??route.distanceKm,durationSeconds:payload.durationSeconds??route.tripSeconds}):null;
      return command==='create-with-cache'?{route,cache}:route;
    }
    if(command==='replace'){
      const replaceId=text(payload.replaceId,80),assetId=text(payload.assetId,100),index=state.customRoutes.findIndex(route=>route.id===replaceId);if(index<0)throw new Error('route-replace-missing');
      const foreignUse=(state.assets||[]).find(asset=>asset.routeId===replaceId&&asset.id!==assetId);if(foreignUse)throw new Error('route-replace-in-use');
      const route=canonicalRoute(payload.route),existing=conflict(state.customRoutes,route,{ignoreId:replaceId});if(existing)throw new Error(existing.code);
      state.customRoutes[index]=route;delete state.routeCache[replaceId];collectUnusedEndpoints(state);return route;
    }
    if(command==='delete'){
      const id=text(payload.id,80),used=(state.assets||[]).some(asset=>asset.routeId===id);if(used)throw new Error('route-in-use');
      const before=state.customRoutes.length;state.customRoutes=state.customRoutes.filter(route=>route.id!==id);delete state.routeCache[id];
      collectUnusedEndpoints(state);
      return before!==state.customRoutes.length;
    }
    if(command==='dedupe'){
      const used=new Set((state.assets||[]).map(asset=>asset.routeId).filter(Boolean)),kept=[],removedIds=[],conflicts=[];
      for(const raw of state.customRoutes){
        let route;try{route=canonicalRoute(raw);}catch(_error){kept.push(raw);continue;}
        const found=conflict(kept,route);
        if(!found){kept.push(route);continue;}
        const existing=found.route,existingUsed=used.has(existing.id),routeUsed=used.has(route.id);
        if(existingUsed&&routeUsed){kept.push(route);conflicts.push([existing.id,route.id]);continue;}
        if(routeUsed&&!existingUsed){const index=kept.findIndex(row=>row.id===existing.id);if(index>=0)kept.splice(index,1);delete state.routeCache[existing.id];removedIds.push(existing.id);kept.push(route);continue;}
        delete state.routeCache[route.id];removedIds.push(route.id);
      }
      if(removedIds.length)state.customRoutes=kept;return {removed:removedIds.length,removedIds,conflicts};
    }
    if(command==='register-endpoint'){
      const endpoint=validateEndpoint(payload.endpoint),exists=Object.prototype.hasOwnProperty.call(state.routeEndpoints,endpoint.id);
      if(!exists&&Object.keys(state.routeEndpoints).length>=LIMITS.endpoints)throw new Error('route-endpoint-capacity');
      state.routeEndpoints[endpoint.id]=endpoint;return endpoint;
    }
    if(command==='cache-geometry')return cacheGeometry(state,payload);
    throw new Error(`Unknown route command: ${command}`);
  }
  const API=Object.freeze({VERSION,ROUTE_TYPES,LIMITS,NEAR_DUPLICATE,ensure,validPoint,splitAtDateline,validateRoute,canonicalRoute,signature,sample,corridorMetrics,conflict,execute});
  globalThis.GH_ROUTE_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('routes',API);if(globalThis.window&&window!==globalThis)window.GH_ROUTE_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
