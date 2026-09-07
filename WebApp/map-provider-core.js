(()=>{
  'use strict';
  const VERSION='2.9.0';
  function create({fetchImpl=(...args)=>globalThis.fetch(...args),now=()=>Date.now(),timeoutMs=12000,failureLimit=3,cooldownMs=30000}={}){
    let failures=0,openUntil=0,lastError=null;
    const valid=c=>Array.isArray(c)&&c.length===2&&c.every(Number.isFinite)&&Math.abs(c[0])<=90&&Math.abs(c[1])<=180;
    async function road(from,to){
      if(!valid(from)||!valid(to))return {ok:false,status:'invalid-coordinates'};
      if(now()<openUntil)return {ok:false,status:'circuit-open',retryAt:openUntil};
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const url=`https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=false`;
        const response=await fetchImpl(url,{signal:controller.signal});if(!response.ok)throw new Error(`routing-http-${response.status}`);
        const data=await response.json(),route=data?.routes?.[0],coords=route?.geometry?.coordinates;
        if(data.code!=='Ok'||!Array.isArray(coords)||coords.length<2||coords.length>100000||coords.some(c=>!valid([c[1],c[0]]))||!Number.isFinite(route.distance)||route.distance<=0||!Number.isFinite(route.duration)||route.duration<=0)throw new Error('routing-response-invalid');
        failures=0;openUntil=0;lastError=null;return {ok:true,status:'available',geometry:{route:coords.map(([lng,lat])=>[lat,lng]),distanceKm:route.distance/1000,durationSeconds:route.duration}};
      }catch(error){failures++;lastError=String(error.message||error);if(failures>=failureLimit)openUntil=now()+cooldownMs;return {ok:false,status:'degraded',reason:lastError,retryAt:openUntil};}
      finally{clearTimeout(timer);}
    }
    return Object.freeze({road,health:()=>({status:now()<openUntil?'circuit-open':failures?'degraded':'available',failures,openUntil,lastError})});
  }
  const provider=create();
  const API=Object.freeze({VERSION,create,road:provider.road,health:provider.health});
  globalThis.GH_MAP_PROVIDER=API;if(globalThis.window&&window!==globalThis)window.GH_MAP_PROVIDER=API;
})();
