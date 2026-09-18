(()=>{
  'use strict';
  const VERSION='3.0.0',BATCH_SIZE=12,MAX_ATTEMPTS=6,DEFAULT_ROUTE_CAPACITY=64;
  const copy=value=>structuredClone(value);
  function fail(result){if(result.status==='cancelled')throw new Error('أُلغي حساب المسارات');if(result.status==='circuit-open')throw new Error('مزود الطرق غير متاح مؤقتًا؛ أعد المحاولة بعد 30 ثانية');throw new Error('تعذر الاتصال بمزود الطرق؛ لم تُعتمد أي رحلة. أعد المحاولة عند استقرار الاتصال');}
  function pointFor(origin,asset,index,attempt,seed){
    const hash=globalThis.GH_DETERMINISM.hashString(`${seed}:${origin.id}`),angle=((hash%360)+index*137.507764+attempt*53.13)*Math.PI/180;
    const range=Number(asset.specs?.rangeKm)||330,radius=Math.min(180,range*.42)*(0.2+0.8*Math.sqrt(((index*0.61803398875+attempt*.271+hash/4294967296)%1)));
    const lat=Math.max(-84,Math.min(84,origin.coords[0]+Math.sin(angle)*radius/111.32)),lng=origin.coords[1]+Math.cos(angle)*radius/(111.32*Math.max(.1,Math.cos(origin.coords[0]*Math.PI/180)));
    return [lat,((lng+540)%360)-180];
  }
  function makeRoute(origin,geometry,index){
    const end=geometry.route.at(-1),key=`${end[0].toFixed(5)}:${end[1].toFixed(5)}`,id=`ROAD-AUTO-PREVIEW-${index}`,endpoint={id:`PUBLIC-ROAD-${key}`,sourceKey:`road-delivery:${key}`,kind:'logistics',company:'road',owned:false,public:true,routeEndpoint:true,icon:'🚚',name:`نقطة تسليم · ${origin.city||origin.name} · ${index+1}`,city:origin.city||origin.name,country:origin.country||'',coords:[...end],capacity:'نقطة تسليم عامة',detail:'وجهة نقل مولدة داخل اللعبة ومتصلة بشبكة الطرق؛ ليست مركزًا مملوكًا.'};
    return {endpoint,route:{id,type:'road',company:'road',name:`${origin.name} → ${endpoint.name}`,from:origin.name,to:endpoint.name,fromFacility:origin.id,toFacility:endpoint.id,route:geometry.route,roadGeometryVersion:311,roadNetworkDistanceKm:geometry.distanceKm,distanceKm:geometry.distanceKm,maxLegKm:geometry.distanceKm,effectiveSpeedKmh:Math.max(42,Math.min(82,geometry.distanceKm/(geometry.durationSeconds/3600))),tripSeconds:geometry.durationSeconds,dwellHours:2.5,publicAccess:true,automaticRoad:true,routingSource:'OSRM · شبكة طرق فعلية · وجهة نقل تلقائية'}};
  }
  // Planning performs network reads only. One verified road geometry serves a
  // bounded fleet slot pool; callers still revalidate and commit every asset in
  // one durable command. This prevents route-count and save-size growth from
  // scaling linearly with the number of purchased trucks.
  async function plan({assets,routes,originFor,usable,provider=globalThis.GH_MAP_PROVIDER,seed=1,routeCount=routes.length,routeCapacity=()=>DEFAULT_ROUTE_CAPACITY,targetRouteLoad=null,initialLoad=()=>0,signal,onProgress=()=>{},intervalMs=1100}){
    const core=globalThis.GH_ROUTE_CORE,selectedRoutes=[],result=[],reserved=routes.filter(r=>r.type==='road'),ordered=[...assets].sort((a,b)=>(Number(a.specs?.rangeKm)||Infinity)-(Number(b.specs?.rangeKm)||Infinity)||String(a.id).localeCompare(String(b.id))),loads=new Map(),waitingByOrigin=new Map();
    const hardCapacity=Math.max(1,Math.floor(Number(routeCapacity({type:'road'}))||DEFAULT_ROUTE_CAPACITY)),automaticCapacity=Math.max(1,Math.min(hardCapacity,Math.floor(Number(targetRouteLoad)||hardCapacity)));
    const conflict=(list,route)=>core.conflict(list,route),remember=route=>{if(!selectedRoutes.some(row=>row.id===route.id))selectedRoutes.push(route);};
    for(const route of routes)loads.set(route.id,Math.max(0,Math.floor(Number(initialLoad(route))||0)));
    for(const [index,asset]of ordered.entries()){
      const origin=originFor(asset);if(!origin||!core.validPoint(origin.coords)||origin.company!=='road')throw new Error(`${asset.name}: لا توجد نقطة انطلاق لوجستية صالحة`);
      if(asset.staffing?.mode!=='automatic-fixed'||asset.staffing.ready!==true)throw new Error(`${asset.name}: سجل الطاقم الثابت غير مكتمل`);
      const candidates=routes.filter(route=>usable(asset,route)&&(loads.get(route.id)||0)<Math.min(automaticCapacity,Math.max(1,Math.floor(Number(routeCapacity(route))||DEFAULT_ROUTE_CAPACITY)))).sort((a,b)=>(loads.get(b.id)||0)-(loads.get(a.id)||0)||String(a.id).localeCompare(String(b.id)));
      const existing=candidates[0];
      if(existing){loads.set(existing.id,(loads.get(existing.id)||0)+1);remember(existing);result.push({assetId:asset.id,origin:copy(origin),route:copy(existing),created:false,shared:true});continue;}
      const group=waitingByOrigin.get(origin.id)||[];group.push({asset,origin,index});waitingByOrigin.set(origin.id,group);
    }
    const pending=[];
    for(const group of waitingByOrigin.values()){
      group.sort((a,b)=>(Number(a.asset.specs?.rangeKm)||Infinity)-(Number(b.asset.specs?.rangeKm)||Infinity)||String(a.asset.id).localeCompare(String(b.asset.id)));
      const capacity=automaticCapacity;
      for(let index=0;index<group.length;index+=capacity){const members=group.slice(index,index+capacity);pending.push({asset:members[0].asset,origin:members[0].origin,index:members[0].index,members,attempt:0});}
    }
    if(routeCount+pending.length>core.LIMITS.routes)throw new Error('سعة سجل المسارات لا تكفي لمجموعات الأسطول؛ احذف المسارات غير المستخدمة أولًا');
    let calls=0,lastCall=0;
    function check(){if(signal?.aborted)throw new Error('أُلغي حساب المسارات');if(calls>=80)throw new Error('لم تكتمل مسارات الأسطول ضمن حد المحاولات؛ لم تُعتمد أي رحلة');}
    async function fetchGroup(rows){
      check();const wait=Math.max(0,lastCall+intervalMs-Date.now());if(wait)await new Promise(resolve=>setTimeout(resolve,wait));check();lastCall=Date.now();calls++;
      const pairs=rows.map(row=>({from:row.origin.coords,to:pointFor(row.origin,row.asset,row.index,row.attempt,seed)})),response=await provider.roadBatch(pairs,{signal});check();
      if(response.ok)return response.geometries;
      if(response.status==='no-route'||response.reason==='routing-endpoint-too-far'||response.reason==='routing-geometry-too-complex'){
        if(rows.length===1)return [null];const middle=Math.ceil(rows.length/2);return [...await fetchGroup(rows.slice(0,middle)),...await fetchGroup(rows.slice(middle))];
      }
      fail(response);
    }
    onProgress(result.length,assets.length);
    while(pending.length){
      check();const originId=pending[0].origin.id,group=pending.filter(row=>row.origin.id===originId).slice(0,BATCH_SIZE),geometries=await fetchGroup(group);
      for(const [i,row]of group.entries()){
        const g=geometries[i];let planned=null;
        if(g){const candidate=makeRoute(row.origin,g,row.index),range=Math.min(...row.members.map(member=>Number(member.asset.specs?.rangeKm)||Infinity));
          if(g.distanceKm>=3&&g.distanceKm<=range*1.005&&!conflict(reserved,candidate.route)&&!conflict(selectedRoutes,candidate.route))planned=candidate;
        }
        if(planned){
          remember(planned.route);loads.set(planned.route.id,row.members.length);
          row.members.forEach((member,index)=>result.push({assetId:member.asset.id,origin:copy(row.origin),...copy(planned),created:index===0,plannedShared:index>0,shared:true}));pending.splice(pending.indexOf(row),1);
        }else if(++row.attempt>=MAX_ATTEMPTS)throw new Error(`${row.asset.name}: تعذر إيجاد طريق للأسطول ضمن مدى الشاحنات؛ لم تُعتمد أي رحلة`);
      }
      onProgress(result.length,assets.length);
    }
    check();return result;
  }
  const API=Object.freeze({VERSION,BATCH_SIZE,MAX_ATTEMPTS,DEFAULT_ROUTE_CAPACITY,plan,pointFor,makeRoute});globalThis.GH_ROAD_PLANNER=API;if(globalThis.window&&window!==globalThis)window.GH_ROAD_PLANNER=API;
})();
