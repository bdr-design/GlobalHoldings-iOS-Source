'use strict';

((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_ROAD_PLANNER_WORKER_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const VERSION='GH-ROAD-PLANNER-WORKER-340.2.0';
  const text=value=>String(value||'');
  function sameFacility(aId,bId,facilities){
    if(!aId||!bId)return false;if(aId===bId)return true;
    const a=facilities[aId],b=facilities[bId];if(!a||!b)return false;
    return Boolean((a.iata&&a.iata===b.iata)||(a.icao&&a.icao===b.icao)||(a.code&&a.code===b.code));
  }
  function validate(input){
    if(!input||!Array.isArray(input.assets)||input.assets.length>20000||!Array.isArray(input.routes)||input.routes.length>500||!Array.isArray(input.origins)||input.origins.length!==input.assets.length||!Array.isArray(input.facilities)||input.facilities.length>10000)throw new TypeError('road-worker-input-invalid');
    if(input.assets.some(asset=>!asset?.id)||input.routes.some(route=>!route?.id||!Array.isArray(route.route)))throw new TypeError('road-worker-row-invalid');
    return true;
  }
  function routeLength(points){
    if(!Array.isArray(points))return Infinity;
    let total=0;for(let index=1;index<points.length;index++){
      const a=points[index-1],b=points[index],r=Math.PI/180,dLat=(b[0]-a[0])*r,dLon=(b[1]-a[1])*r,lat1=a[0]*r,lat2=b[0]*r,h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
      total+=12742.0176*Math.asin(Math.min(1,Math.sqrt(h)));
    }
    return total;
  }
  async function plan(input,options={}){
    validate(input);
    const planner=options.planner||globalThis.GH_ROAD_PLANNER,routeCore=options.routeCore||globalThis.GH_ROUTE_CORE,provider=options.provider||globalThis.GH_MAP_PROVIDER;
    if(!planner?.plan||!routeCore?.conflict||!provider?.roadBatch)throw new Error('road-worker-engine-unavailable');
    const origins=new Map(input.assets.map((asset,index)=>[asset.id,input.origins[index]])),ownersByAsset=new Map(input.assets.map((asset,index)=>[asset.id,input.assetOwners?.[index]||text(asset.ownerCompanyId||asset.companyId||'road')])),ownersByRoute=new Map(input.routes.map((route,index)=>[route.id,input.routeOwners?.[index]||text(route.ownerCompanyId||route.companyId||route.company||'road')])),facilityRows=Object.fromEntries(input.facilities.map(row=>[row.id,row])),loadRows=input.initialLoads||{};
    const ownerForAsset=asset=>ownersByAsset.get(asset.id)||'';
    const ownerForRoute=route=>ownersByRoute.get(route.id)||'';
    return planner.plan({
      assets:input.assets,routes:input.routes,originFor:asset=>origins.get(asset.id),provider,seed:input.seed,routeCount:input.routeCount,
      targetRouteLoad:input.targetRouteLoad,routeCapacity:()=>input.routeCapacity,initialLoad:route=>loadRows[route.id]||0,
      signal:options.signal,onProgress:options.onProgress,intervalMs:input.intervalMs,yieldEvery:input.yieldEvery,yieldControl:options.yieldControl,
      usable:(asset,route)=>{
        const range=Number(asset.specs?.rangeKm)||0,leg=Number(route.roadNetworkDistanceKm)||Number(route.distanceKm)||routeLength(route.route);
        return route.routeMode==='road'||route.type==='road'?ownerForRoute(route)===ownerForAsset(asset)&&(!range||leg<=range*1.005)&&Boolean(asset.baseFacility)&&(sameFacility(asset.baseFacility,route.fromFacility,facilityRows)||sameFacility(asset.baseFacility,route.toFacility,facilityRows)):false;
      }
    });
  }
  return Object.freeze({VERSION,sameFacility,validate,plan});
});
