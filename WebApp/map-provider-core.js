(()=>{
  'use strict';
  const VERSION='3.0.0';
  const valid=c=>Array.isArray(c)&&c.length===2&&c.every(Number.isFinite)&&Math.abs(c[0])<=90&&Math.abs(c[1])<=180;
  function distance(a,b){const r=Math.PI/180,h=Math.sin((b[0]-a[0])*r/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin((b[1]-a[1])*r/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));}
  // Keep real road vertices with a bounded 20 m geometric error, never invent a straight fallback.
  function compact(points,toleranceKm=.02){
    const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
    while(stack.length){const [start,end]=stack.pop(),a=points[start],b=points[end],scale=Math.cos(a[0]*Math.PI/180),bx=(b[1]-a[1])*111.32*scale,by=(b[0]-a[0])*111.32,length=bx*bx+by*by;let far=-1,max=toleranceKm*toleranceKm;
      for(let i=start+1;i<end;i++){const px=(points[i][1]-a[1])*111.32*scale,py=(points[i][0]-a[0])*111.32,t=length?Math.max(0,Math.min(1,(px*bx+py*by)/length)):0,d=(px-t*bx)**2+(py-t*by)**2;if(d>max){max=d;far=i;}}
      if(far>=0){keep.add(far);stack.push([start,far],[far,end]);}
    }
    return [...keep].sort((a,b)=>a-b).map(i=>[...points[i]]);
  }
  function geometry(raw,coords,from,to,compactGeometry=false){
    if(!Array.isArray(coords)||coords.length<2||coords.length>100000||coords.some(c=>!Array.isArray(c)||c.length!==2||!valid([c[1],c[0]]))||!Number.isFinite(raw.distance)||raw.distance<=0||!Number.isFinite(raw.duration)||raw.duration<=0)throw new Error('routing-response-invalid');
    const points=coords.map(([lng,lat])=>[lat,lng]);
    if(compactGeometry&&(distance(from,points[0])>5||distance(to,points.at(-1))>20))throw new Error('routing-endpoint-too-far');
    const route=compactGeometry?compact(points):points,limit=globalThis.GH_ROUTE_CORE?.LIMITS?.pointsPerRoute||2048;
    if(compactGeometry&&route.length>limit)throw new Error('routing-geometry-too-complex');
    return {route,distanceKm:raw.distance/1000,durationSeconds:raw.duration};
  }
  function create({fetchImpl=(...args)=>globalThis.fetch(...args),now=()=>Date.now(),timeoutMs=12000,batchTimeoutMs=30000,failureLimit=3,cooldownMs=30000}={}){
    let failures=0,openUntil=0,lastError=null;
    async function request(url,parse,signal,deadlineMs=timeoutMs){
      if(signal?.aborted)return {ok:false,status:'cancelled'};
      if(now()<openUntil)return {ok:false,status:'circuit-open',retryAt:openUntil};
      const controller=new AbortController();let timer,onAbort;
      // Race both fetch and body decoding; abort alone does not settle every WebView/network implementation.
      const deadline=new Promise((_resolve,reject)=>{onAbort=()=>{controller.abort();reject(new Error('routing-cancelled'));};signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{controller.abort();reject(new Error('routing-timeout'));},deadlineMs);});
      try{
        const result=await Promise.race([deadline,(async()=>{const response=await fetchImpl(url,{signal:controller.signal});const data=await response.json();if(['NoRoute','NoSegment'].includes(data.code))return {ok:false,status:'no-route',reason:data.code};if(!response.ok)throw new Error(`routing-http-${response.status}`);if(data.code!=='Ok')throw new Error('routing-response-invalid');return parse(data);})()]);
        failures=0;openUntil=0;lastError=null;return result;
      }catch(error){const reason=String(error.message||error);if(signal?.aborted)return {ok:false,status:'cancelled'};if(['routing-endpoint-too-far','routing-geometry-too-complex'].includes(reason))return {ok:false,status:'geometry-rejected',reason};failures++;lastError=reason;if(failures>=failureLimit)openUntil=now()+cooldownMs;return {ok:false,status:'degraded',reason,retryAt:openUntil};}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
    }
    async function road(from,to,{signal,compactGeometry=false}={}){
      if(!valid(from)||!valid(to))return {ok:false,status:'invalid-coordinates'};
      const url=`https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=false`;
      return request(url,data=>({ok:true,status:'available',geometry:geometry(data.routes?.[0]||{},data.routes?.[0]?.geometry?.coordinates,from,to,compactGeometry)}),signal);
    }
    async function roadBatch(pairs,{signal}={}){
      if(!Array.isArray(pairs)||!pairs.length||pairs.length>12||pairs.some(p=>!valid(p.from)||!valid(p.to)))return {ok:false,status:'invalid-coordinates'};
      // 2n waypoints; legs 0,2,4... are the requested journeys. Connector legs are discarded.
      const coordinates=pairs.flatMap(p=>[p.from,p.to]).map(p=>`${p[1]},${p[0]}`).join(';');
      const url=`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=false&geometries=geojson&steps=true&continue_straight=false`;
      return request(url,data=>{
        const legs=data.routes?.[0]?.legs;if(!Array.isArray(legs)||legs.length!==pairs.length*2-1)throw new Error('routing-batch-legs-invalid');
        const geometries=pairs.map((pair,index)=>{const leg=legs[index*2],coords=[];if(!Array.isArray(leg.steps))throw new Error('routing-batch-steps-invalid');for(const step of leg.steps){if(!Array.isArray(step.geometry?.coordinates))throw new Error('routing-batch-geometry-invalid');for(const point of step.geometry.coordinates){if(!coords.length||JSON.stringify(coords.at(-1))!==JSON.stringify(point))coords.push(point);}}try{return geometry(leg,coords,pair.from,pair.to,true);}catch(error){if(['routing-endpoint-too-far','routing-geometry-too-complex'].includes(error.message))return null;throw error;}});
        return {ok:true,status:'available',geometries};
      },signal,batchTimeoutMs);
    }
    return Object.freeze({road,roadBatch,health:()=>({status:now()<openUntil?'circuit-open':failures?'degraded':'available',failures,openUntil,lastError})});
  }
  const provider=create();
  const API=Object.freeze({VERSION,create,compact,distance,road:provider.road,roadBatch:provider.roadBatch,health:provider.health});
  globalThis.GH_MAP_PROVIDER=API;if(globalThis.window&&window!==globalThis)window.GH_MAP_PROVIDER=API;
})();
