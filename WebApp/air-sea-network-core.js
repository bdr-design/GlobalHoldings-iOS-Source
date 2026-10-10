'use strict';

((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_AIR_SEA_NETWORK_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const VERSION='GH-AIR-SEA-NETWORK-340.1.0';
  const compareId=(a,b)=>String(a).localeCompare(String(b));
  function validate(input){
    if(!input||!Array.isArray(input.assets)||input.assets.length>20000||!Array.isArray(input.routes)||input.routes.length>2000||!Array.isArray(input.originRoutes)||input.originRoutes.length>20000)throw new TypeError('air-sea-network-input-invalid');
    if(!Number.isInteger(input.targetLoad)||input.targetLoad<1||!Number.isInteger(input.routeCapacity)||input.routeCapacity<input.targetLoad)throw new TypeError('air-sea-network-capacity-invalid');
    if(input.assets.some(row=>!row||typeof row.id!=='string'||!row.id||typeof row.originId!=='string'||!row.originId||!Number.isFinite(Number(row.rangeKm))||Number(row.rangeKm)<0))throw new TypeError('air-sea-network-asset-invalid');
    if(new Set(input.assets.map(row=>row.id)).size!==input.assets.length)throw new TypeError('air-sea-network-asset-duplicate');
    if(input.routes.some(row=>!row||typeof row.id!=='string'||!row.id||typeof row.fromFacility!=='string'||typeof row.toFacility!=='string'||!Number.isFinite(Number(row.legKm))||Number(row.legKm)<0))throw new TypeError('air-sea-network-route-invalid');
    if(new Set(input.routes.map(row=>row.id)).size!==input.routes.length)throw new TypeError('air-sea-network-route-duplicate');
    if(input.originRoutes.some(row=>!row||typeof row.originId!=='string'||!Array.isArray(row.routeIds)))throw new TypeError('air-sea-network-origin-routes-invalid');
    return true;
  }
  function createPlanner(input){
    validate(input);
    const assets=input.assets.slice().sort((a,b)=>Number(a.rangeKm)-Number(b.rangeKm)||compareId(a.id,b.id));
    const routeById=new Map(input.routes.map(route=>[route.id,route]));
    const originRoutes=new Map(input.originRoutes.map(row=>[row.originId,row.routeIds.filter(id=>routeById.has(id))]));
    const loads=new Map(Object.entries(input.initialLoads||{}).map(([id,count])=>[id,Math.max(0,Math.floor(Number(count)||0))]));
    const assignments=[],waitingByOrigin=new Map();let cursor=0,candidateChecks=0;
    function runChunk(limit=256){
      const budget=Math.max(1,Math.floor(Number(limit)||256)),end=Math.min(assets.length,cursor+budget);
      while(cursor<end){
        const asset=assets[cursor++],routeIds=originRoutes.get(asset.originId)||[];let selected=null,selectedLoad=input.targetLoad;
        for(const routeId of routeIds){
          const route=routeById.get(routeId);if(!route)continue;candidateChecks++;
          const load=loads.get(routeId)||0;if(load>=input.targetLoad)continue;
          if(asset.rangeKm&&route.legKm>asset.rangeKm*1.005)continue;
          if(!selected||load<selectedLoad||(load===selectedLoad&&compareId(routeId,selected)<0)){selected=routeId;selectedLoad=load;}
        }
        if(selected){loads.set(selected,(loads.get(selected)||0)+1);assignments.push({assetId:asset.id,routeId:selected});}
        else{let group=waitingByOrigin.get(asset.originId);if(!group){group=[];waitingByOrigin.set(asset.originId,group);}group.push(asset.id);}
      }
      return cursor>=assets.length;
    }
    function result(){
      if(cursor<assets.length)throw new Error('air-sea-network-plan-incomplete');
      return {
        version:VERSION,
        sortedAssetIds:assets.map(row=>row.id),
        assignments:assignments.map(row=>({...row})),
        waitingGroups:[...waitingByOrigin].map(([originId,assetIds])=>({originId,assetIds:assetIds.slice()})),
        candidateChecks
      };
    }
    return Object.freeze({runChunk,isDone:()=>cursor>=assets.length,result});
  }
  function plan(input){const planner=createPlanner(input);planner.runChunk(Math.max(1,input.assets.length));return planner.result();}
  function validatePlan(input,plan){
    validate(input);
    if(!plan||plan.version!==VERSION||!Array.isArray(plan.sortedAssetIds)||!Array.isArray(plan.assignments)||!Array.isArray(plan.waitingGroups)||plan.sortedAssetIds.length!==input.assets.length) return false;
    const assetById=new Map(input.assets.map(row=>[row.id,row])),routeById=new Map(input.routes.map(row=>[row.id,row])),originRoutes=new Map(input.originRoutes.map(row=>[row.originId,new Set(row.routeIds)])),seen=new Set(),planned=new Set(),loads=new Map(Object.entries(input.initialLoads||{}).map(([id,count])=>[id,Math.max(0,Math.floor(Number(count)||0))]));
    for(let i=0;i<plan.sortedAssetIds.length;i++){
      const asset=assetById.get(plan.sortedAssetIds[i]);if(!asset||seen.has(asset.id))return false;seen.add(asset.id);
      if(i>0){const prev=assetById.get(plan.sortedAssetIds[i-1]);if(Number(prev.rangeKm)>Number(asset.rangeKm)||Number(prev.rangeKm)===Number(asset.rangeKm)&&compareId(prev.id,asset.id)>0)return false;}
    }
    for(const row of plan.assignments){
      const asset=assetById.get(row?.assetId),route=routeById.get(row?.routeId);if(!asset||!route||planned.has(asset.id)||!originRoutes.get(asset.originId)?.has(route.id))return false;
      if(asset.rangeKm&&route.legKm>asset.rangeKm*1.005)return false;
      const load=(loads.get(route.id)||0)+1;if(load>input.targetLoad)return false;loads.set(route.id,load);planned.add(asset.id);
    }
    for(const group of plan.waitingGroups){
      if(!group||typeof group.originId!=='string'||!Array.isArray(group.assetIds)||!group.assetIds.length)return false;
      for(const id of group.assetIds){const asset=assetById.get(id);if(!asset||asset.originId!==group.originId||planned.has(id))return false;planned.add(id);}
    }
    return input.assets.every(asset=>seen.has(asset.id)&&planned.has(asset.id));
  }
  function validateDestinationInput(input){
    if(!input||!Array.isArray(input.originCoords)||input.originCoords.length!==2||!Array.isArray(input.samples)||input.samples.length>900||!input.ledger||!Array.isArray(input.ledger.destinations)||!Array.isArray(input.ledger.sectors)||!Array.isArray(input.ledger.bands)||!Array.isArray(input.ledger.coords)||input.ledger.coords.length>2000)throw new TypeError('air-sea-destination-input-invalid');
    if(!input.samples.every((row,index)=>row&&Number.isSafeInteger(row.sampleIndex)&&row.sampleIndex>=0&&row.sampleIndex<900&&(index===0||input.samples[index-1].sampleIndex<row.sampleIndex)&&Number.isSafeInteger(row.worldIndex)&&typeof row.key==='string'&&Array.isArray(row.coords)&&row.coords.length===2&&Number.isFinite(Number(row.coords[0]))&&Number.isFinite(Number(row.coords[1]))))throw new TypeError('air-sea-destination-sample-invalid');
    if(!input.ledger.destinations.every(row=>Array.isArray(row)&&typeof row[0]==='string'&&Number.isFinite(Number(row[1])))||!input.ledger.sectors.every(row=>Array.isArray(row)&&typeof row[0]==='string'&&Number.isFinite(Number(row[1])))||!input.ledger.bands.every(row=>Array.isArray(row)&&typeof row[0]==='string'&&Number.isFinite(Number(row[1])))||!input.ledger.coords.every(row=>Array.isArray(row)&&row.length===2&&Number.isFinite(Number(row[0]))&&Number.isFinite(Number(row[1]))))throw new TypeError('air-sea-destination-ledger-invalid');
    if(!Number.isFinite(Number(input.rangeKm))||Number(input.rangeKm)<0)throw new TypeError('air-sea-destination-range-invalid');
    return true;
  }
  function haversine(a,b){const rad=Math.PI/180,lat1=a[0]*rad,lat2=b[0]*rad,dLat=(b[0]-a[0])*rad,dLon=(b[1]-a[1])*rad,h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return 2*6371.0088*Math.asin(Math.sqrt(h));}
  function routeSector(coords){const lat=Number(coords?.[0])||0,lon=((Number(coords?.[1])||0)+540)%360-180,latBand=lat<-23?'S':lat>23?'N':'E',lonBand=Math.floor((lon+180)/45);return `${latBand}:${Math.max(0,Math.min(7,lonBand))}`;}
  function routeDistanceBand(distance){return distance<2000?'near':distance<6500?'mid':'far';}
  function destinationContext(input){return {destinations:new Map(input.ledger.destinations),sectors:new Map(input.ledger.sectors),bands:new Map(input.ledger.bands),coords:input.ledger.coords};}
  function rankSample(input,sample,context=destinationContext(input),includeSeparation=true){
    const direct=haversine(input.originCoords,sample.coords),range=Number(input.rangeKm)||0;if(direct<35||(range&&direct>range*1.005))return null;
    const sector=routeSector(sample.coords),band=routeDistanceBand(direct),reuse=Number(context.destinations.get(sample.key))||0,sectorUse=Number(context.sectors.get(sector))||0,bandUse=Number(context.bands.get(band))||0;
    let separation=20000;if(includeSeparation&&context.coords.length){separation=Infinity;for(const point of context.coords)separation=Math.min(separation,haversine(point,sample.coords));}
    return {sampleIndex:sample.sampleIndex,worldIndex:sample.worldIndex,direct,reuse,sectorUse,bandUse,separation};
  }
  const compareDestination=(a,b)=>a.reuse-b.reuse||a.sectorUse-b.sectorUse||a.bandUse-b.bandUse||b.separation-a.separation||a.sampleIndex-b.sampleIndex;
  function createDestinationPlanner(input){
    validateDestinationInput(input);let cursor=0;const ranked=[],context=destinationContext(input);
    function runChunk(limit=48){const budget=Math.max(1,Math.floor(Number(limit)||48)),end=Math.min(input.samples.length,cursor+budget);while(cursor<end){const row=rankSample(input,input.samples[cursor],context);if(row)ranked.push(row);cursor++;}return cursor>=input.samples.length;}
    function result(){if(cursor<input.samples.length)throw new Error('air-sea-destination-plan-incomplete');ranked.sort(compareDestination);return {version:VERSION,ranked:ranked.slice(0,900).map(row=>({...row}))};}
    return Object.freeze({runChunk,isDone:()=>cursor>=input.samples.length,result});
  }
  function rankDestinations(input){const planner=createDestinationPlanner(input);planner.runChunk(Math.max(1,input.samples.length));return planner.result();}
  function validateDestinationPlan(input,plan){
    try{validateDestinationInput(input);}catch{return false;}
    if(!plan||plan.version!==VERSION||!Array.isArray(plan.ranked)||plan.ranked.length>900)return false;
    const samples=new Map(input.samples.map(row=>[row.sampleIndex,row])),context=destinationContext(input);let previous=null;
    for(const row of plan.ranked){const sample=samples.get(row?.sampleIndex),expected=sample&&rankSample(input,sample,context,false);if(!expected||row.worldIndex!==expected.worldIndex||['direct','reuse','sectorUse','bandUse'].some(key=>!Number.isFinite(Number(row[key]))||Math.abs(Number(row[key])-expected[key])>1e-7)||!Number.isFinite(Number(row.separation))||Number(row.separation)<0||Number(row.separation)>20000.001)return false;if(previous&&compareDestination(previous,row)>0)return false;previous=row;}
    return true;
  }
  function createDestinationWindowCursor(length,start=0){
    const total=Math.max(0,Math.floor(Number(length)||0));let cursor=0;
    if(!Number.isSafeInteger(total)||total>1000000)throw new TypeError('air-sea-destination-pool-size-invalid');
    let stride=1;if(total>1){stride=37%total||1;while(gcd(stride,total)!==1)stride=(stride+1)%total||1;}
    const offset=total?((Math.floor(Number(start)||0)%total)+total)%total:0;
    function next(limit=900){const size=Math.max(1,Math.min(900,Math.floor(Number(limit)||900))),count=Math.min(size,total-cursor),positions=new Array(count);for(let index=0;index<count;index++)positions[index]=(offset+((cursor+index)*stride)%total)%total;cursor+=count;return positions;}
    return Object.freeze({next,isDone:()=>cursor>=total,visited:()=>cursor,total,stride,offset});
  }
  function gcd(a,b){while(b){const next=a%b;a=b;b=next;}return a;}
  function rankWorldDistances(input){
    const coords=input?.coordinates,origin=input?.originCoords;if(!(coords instanceof Float64Array)||coords.length%2||!Array.isArray(origin)||origin.length!==2||coords.length/2>1000000||!origin.every(value=>Number.isFinite(Number(value))))throw new TypeError('air-sea-distance-index-input-invalid');
    const count=coords.length/2,rad=Math.PI/180,originLat=Number(origin[0])*rad,originLon=Number(origin[1])*rad,distances=new Float64Array(count),ordered=Array.from({length:count},(_,index)=>index);
    for(let index=0;index<count;index++){
      const lat=coords[index*2],lon=coords[index*2+1];if(!Number.isFinite(lat)||!Number.isFinite(lon)){distances[index]=Infinity;continue;}
      const latRad=lat*rad,deltaLat=latRad-originLat,deltaLon=lon*rad-originLon,h=Math.sin(deltaLat/2)**2+Math.cos(originLat)*Math.cos(latRad)*Math.sin(deltaLon/2)**2;
      distances[index]=2*6371.0088*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
    }
    ordered.sort((a,b)=>{const difference=distances[a]-distances[b];return Number.isNaN(difference)||difference===0?a-b:difference;});
    return {version:VERSION,indices:Uint32Array.from(ordered),distances};
  }
  function validateWorldDistanceIndex(input,index){
    const count=input?.coordinates?.length/2;if(!Number.isSafeInteger(count)||count<0||count>1000000||!index||index.version!==VERSION||!(index.indices instanceof Uint32Array)||!(index.distances instanceof Float64Array)||index.indices.length!==count||index.distances.length!==count)return false;
    const seen=new Uint8Array(count);for(let row=0;row<count;row++){const item=index.indices[row],distance=index.distances[item];if(item>=count||seen[item]||Number.isNaN(distance)||distance<0)return false;seen[item]=1;if(row&&index.distances[index.indices[row-1]]>distance)return false;}return true;
  }
  return Object.freeze({VERSION,validate,createPlanner,plan,validatePlan,validateDestinationInput,createDestinationPlanner,rankDestinations,validateDestinationPlan,createDestinationWindowCursor,rankWorldDistances,validateWorldDistanceIndex});
});
