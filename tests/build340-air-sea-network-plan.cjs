'use strict';

const assert=require('node:assert/strict');
const Core=require('../WebApp/air-sea-network-core.js');

function inputFor(count){
  const originCount=8,assets=Array.from({length:count},(_,index)=>({id:`AIR-${String(index).padStart(6,'0')}`,originId:`ORIGIN-${index%originCount}`,rangeKm:700+((index*97)%9000)}));
  const routes=[];for(let origin=0;origin<originCount;origin++)for(let slot=0;slot<8;slot++)routes.push({id:`R-${String(origin).padStart(2,'0')}-${slot}`,fromFacility:`ORIGIN-${origin}`,toFacility:`DEST-${slot}`,legKm:500+slot*1400});
  const initialLoads=Object.fromEntries(routes.map((route,index)=>[route.id,index%5===0?18:index%3===0?37:5]));
  const originRoutes=Array.from({length:originCount},(_,origin)=>({originId:`ORIGIN-${origin}`,routeIds:routes.filter(route=>route.fromFacility===`ORIGIN-${origin}`).map(route=>route.id)}));
  return {targetLoad:40,routeCapacity:100,assets,routes,originRoutes,initialLoads};
}
function reference(input){
  const assets=input.assets.slice().sort((a,b)=>Number(a.rangeKm)-Number(b.rangeKm)||String(a.id).localeCompare(String(b.id))),routes=new Map(input.routes.map(row=>[row.id,row])),originRoutes=new Map(input.originRoutes.map(row=>[row.originId,row.routeIds])),loads=new Map(Object.entries(input.initialLoads)),assignments=[],waiting=new Map();
  for(const asset of assets){const candidates=(originRoutes.get(asset.originId)||[]).map(id=>routes.get(id)).filter(route=>route&&(loads.get(route.id)||0)<input.targetLoad&&(!asset.rangeKm||route.legKm<=asset.rangeKm*1.005)).sort((a,b)=>(loads.get(a.id)||0)-(loads.get(b.id)||0)||String(a.id).localeCompare(String(b.id))),route=candidates[0];if(route){loads.set(route.id,(loads.get(route.id)||0)+1);assignments.push({assetId:asset.id,routeId:route.id});}else{const ids=waiting.get(asset.originId)||[];ids.push(asset.id);waiting.set(asset.originId,ids);}}
  return {sortedAssetIds:assets.map(row=>row.id),assignments,waitingGroups:[...waiting].map(([originId,assetIds])=>({originId,assetIds}))};
}
function summarize(plan){return {sortedAssetIds:plan.sortedAssetIds,assignments:plan.assignments,waitingGroups:plan.waitingGroups};}
function destinationInputFor(count=900){
  const samples=Array.from({length:count},(_,index)=>({sampleIndex:index,worldIndex:600+index,key:`air:${index%113}`,coords:[-48+((index*17)%96),-175+((index*43)%350)]}));
  const destinations=Array.from({length:23},(_,index)=>[`air:${index*5}`,index%4]),sectors=Array.from({length:8},(_,index)=>[['S','E','N'][index%3]+`:${index}`,index%5]),bands=[['near',7],['mid',2],['far',1]],coords=Array.from({length:41},(_,index)=>[-40+index*1.8,-170+index*7.9]);
  return {originCoords:[24.7,46.7],rangeKm:9000,samples,ledger:{destinations,sectors,bands,coords}};
}
function destinationReference(input){
  const haversine=(a,b)=>{const rad=Math.PI/180,lat1=a[0]*rad,lat2=b[0]*rad,dLat=(b[0]-a[0])*rad,dLon=(b[1]-a[1])*rad,h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return 2*6371.0088*Math.asin(Math.sqrt(h));},sectorOf=coords=>{const lat=Number(coords[0])||0,lon=((Number(coords[1])||0)+540)%360-180,band=lat<-23?'S':lat>23?'N':'E',lonBand=Math.floor((lon+180)/45);return `${band}:${Math.max(0,Math.min(7,lonBand))}`;},distanceBand=distance=>distance<2000?'near':distance<6500?'mid':'far',destinations=new Map(input.ledger.destinations),sectors=new Map(input.ledger.sectors),bands=new Map(input.ledger.bands),ranked=[];
  for(const sample of input.samples){const direct=haversine(input.originCoords,sample.coords);if(direct<35||(input.rangeKm&&direct>input.rangeKm*1.005))continue;const sector=sectorOf(sample.coords),band=distanceBand(direct);let separation=20000;if(input.ledger.coords.length)separation=Math.min(...input.ledger.coords.map(point=>haversine(point,sample.coords)));ranked.push({sampleIndex:sample.sampleIndex,worldIndex:sample.worldIndex,direct,reuse:destinations.get(sample.key)||0,sectorUse:sectors.get(sector)||0,bandUse:bands.get(band)||0,separation});}
  ranked.sort((a,b)=>a.reuse-b.reuse||a.sectorUse-b.sectorUse||a.bandUse-b.bandUse||b.separation-a.separation||a.sampleIndex-b.sampleIndex);return ranked.slice(0,160);
}

for(const count of [4300,20000]){
  const input=inputFor(count),before=JSON.stringify(input),expected=reference(input),started=performance.now(),actual=Core.plan(input),elapsedMs=+(performance.now()-started).toFixed(2);
  assert.deepEqual(summarize(actual),expected,`${count} asset Worker plan preserves current ordering, allocation, route capacity, range and origin rules`);
  assert.equal(Core.validatePlan(input,actual),true);assert.equal(JSON.stringify(input),before,'the planning core cannot alter source DTOs');
  const cooperative=Core.createPlanner(input);while(!cooperative.isDone())cooperative.runChunk(127);assert.deepEqual(summarize(cooperative.result()),expected,'cooperative fallback has exact assignment parity');
  const invalid={...actual,assignments:[...actual.assignments,{...actual.assignments[0]}]};assert.equal(Core.validatePlan(input,invalid),false,'duplicate asset publication is rejected');
  console.log(JSON.stringify({suite:'build340-air-sea-network-plan',assets:count,assignments:actual.assignments.length,createdRouteGroups:actual.waitingGroups.reduce((sum,row)=>sum+Math.ceil(row.assetIds.length/input.targetLoad),0),candidateChecks:actual.candidateChecks,nodePlanningMs:elapsedMs,parity:true,environment:`Node ${process.version}; synthetic immutable DTOs; not iPhone performance`}));
}
assert.throws(()=>Core.validate({...inputFor(1),targetLoad:101}),/capacity-invalid/);
console.log('PASS air/sea bulk route plan parity, stable ordering, capacity/range/ownership origin filters, immutable input, cooperative fallback and stale plan contract');
{
  const input=destinationInputFor(),before=JSON.stringify(input),expected=destinationReference(input),started=performance.now(),actual=Core.rankDestinations(input),elapsedMs=+(performance.now()-started).toFixed(2);
  assert.deepEqual(actual.ranked,expected,'destination ranking preserves the previous geography, range, diversity and stable tie-break rules');
  assert.equal(Core.validateDestinationPlan(input,actual),true);assert.equal(JSON.stringify(input),before,'destination ranking does not change its ledger or candidate DTO');
  const cooperative=Core.createDestinationPlanner(input);while(!cooperative.isDone())cooperative.runChunk(19);assert.deepEqual(cooperative.result(),actual,'cooperative destination fallback is exact');
  const stale={...actual,ranked:actual.ranked.map((row,index)=>index===0?{...row,direct:row.direct+1}:row)};assert.equal(Core.validateDestinationPlan(input,stale),false,'a result inconsistent with the frozen candidate DTO is rejected');
  console.log(JSON.stringify({suite:'build340-air-sea-destination-ranking',candidates:input.samples.length,returned:actual.ranked.length,nodeRankingMs:elapsedMs,parity:true,environment:`Node ${process.version}; synthetic immutable world DTOs; not iPhone performance`}));
}
