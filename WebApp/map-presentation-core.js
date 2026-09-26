'use strict';

((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_MAP_PRESENTATION_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const VERSION='GH-MAP-PRESENTATION-340.2.0';
  const finitePoint=point=>Array.isArray(point)&&point.length===2&&Number.isFinite(point[0])&&Number.isFinite(point[1]);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
  const shortestLongitudeDelta=(a,b)=>((b-a+540)%360)-180;

  function interpolateRoute(points,progress){
    if(!Array.isArray(points)||points.length<2||points.some(point=>!finitePoint(point)))return points?.[0]||[0,0];
    const radians=Math.PI/180,cumulative=new Float64Array(points.length);let total=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dLat=(b[0]-a[0])*radians,dLon=shortestLongitudeDelta(a[1],b[1])*radians,lat1=a[0]*radians,lat2=b[0]*radians;
      const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
      total+=2*6371.0088*Math.asin(Math.sqrt(h));cumulative[i]=total;
    }
    if(!(total>0))return [points[0][0],points[0][1]];
    const target=clamp(progress,0,1)*total;if(target>=total){const last=points[points.length-1];return [last[0],last[1]];}
    let low=1,high=points.length-1;
    while(low<high){const middle=(low+high)>>1;if(cumulative[middle]>=target)high=middle;else low=middle+1;}
    const start=low-1,segment=cumulative[low]-cumulative[start],ratio=segment===0?0:(target-cumulative[start])/segment,a=points[start],b=points[low];
    return [a[0]+(b[0]-a[0])*ratio,((a[1]+shortestLongitudeDelta(a[1],b[1])*ratio+540)%360)-180];
  }

  function buildPlan(input={}){
    const ids=input.assetIds,owners=input.owners,modes=input.modes,routeKeys=input.routeKeys,routeIndexes=input.routeIndexes,progress=input.progress,baseCoordinates=input.baseCoordinates,routes=input.routes;
    const count=Array.isArray(ids)?ids.length:-1;
    if(count<0||!Array.isArray(owners)||!Array.isArray(modes)||!Array.isArray(routeKeys)||owners.length!==count||modes.length!==count||routeKeys.length!==count||!(routeIndexes instanceof Int32Array)||routeIndexes.length!==count||!(progress instanceof Float32Array)||progress.length!==count||!(baseCoordinates instanceof Float32Array)||baseCoordinates.length!==count*2||!Array.isArray(routes))throw new TypeError('map-presentation-input-invalid');
    for(let i=0;i<count;i++)if(!ids[i]||routeIndexes[i]<-2||routeIndexes[i]>=routes.length)throw new TypeError('map-presentation-row-invalid');
    const pointAt=index=>{
      const routeIndex=routeIndexes[index];
      if(routeIndex===-2)return [0,0];
      if(routeIndex>=0){const points=routes[routeIndex];return interpolateRoute(points,progress[index]);}
      const lat=baseCoordinates[index*2],lng=baseCoordinates[index*2+1];return Number.isFinite(lat)&&Number.isFinite(lng)?[lat,lng]:null;
    };
    const reps=new Map();
    for(let i=0;i<count;i++){
      const owner=owners[i]||'',key=routeKeys[i]?`${owner}:${routeKeys[i]}`:`${owner}:${ids[i]}`;
      if(ids[i]===input.selectedId||!reps.has(key))reps.set(key,i);
    }
    const representativeIndices=[...reps.values()],pinned=input.selectedId?representativeIndices.find(index=>ids[index]===input.selectedId):undefined;
    const queues=new Map();
    for(const index of representativeIndices){if(ids[index]===input.selectedId)continue;const key=owners[index]||`unknown:${modes[index]||'asset'}`,queue=queues.get(key)||[];queue.push(index);queues.set(key,queue);}
    const ordered=[...queues].sort((a,b)=>a[0].localeCompare(b[0])).map(([,queue])=>queue.sort((a,b)=>String(ids[a]).localeCompare(String(ids[b]))));
    const heroes=pinned===undefined?[]:[pinned];let cursor=0,limit=Math.max(0,Math.floor(Number(input.limit)||0));
    while(heroes.length<limit&&ordered.some(queue=>queue.length)){const queue=ordered[cursor%ordered.length];if(queue.length)heroes.push(queue.shift());cursor++;}
    const heroSet=new Set(heroes),zoom=Number(input.zoom)||0;let cell=zoom<4?28:zoom<6?12:zoom<9?4:1.2,groups=[];
    const build=()=>{
      const byKey=new Map();
      for(let index=0;index<count;index++){
        if(heroSet.has(index))continue;const point=pointAt(index);if(!point)continue;
        const owner=owners[index]||'unknown',mode=modes[index]||'asset',key=`${owner}:${mode}:${Math.floor((point[0]+90)/cell)}:${Math.floor((point[1]+180)/cell)}`;
        let group=byKey.get(key);if(!group){group={key,owner,mode,indices:[],lat:0,lng:0};byKey.set(key,group);}
        group.indices.push(index);group.lat+=point[0];group.lng+=point[1];
      }
      return [...byKey.values()];
    };
    groups=build();const groupLimit=Math.max(4,Math.floor(Number(input.groupLimit)||0)-heroes.length);
    while(groups.length>groupLimit&&cell<180){cell*=1.7;groups=build();}
    const members=[],resultGroups=[];
    for(const group of groups){
      const start=members.length;members.push(...group.indices);
      resultGroups.push({key:group.key,owner:group.owner,mode:group.mode,start,count:group.indices.length,coords:[group.lat/group.indices.length,group.lng/group.indices.length]});
    }
    return {version:VERSION,key:String(input.key||''),generation:Number(input.generation)||0,assetCount:count,heroIndices:Uint32Array.from(heroes),members:Uint32Array.from(members),groups:resultGroups};
  }

  function updateGroupCenters(snapshot,progress){
    if(!snapshot||!(progress instanceof Float32Array)||progress.length!==snapshot.assetCount)throw new TypeError('map-presentation-progress-invalid');
    const pointAt=index=>{
      const routeIndex=snapshot.routeIndexes[index];
      if(routeIndex===-2)return [0,0];
      if(routeIndex>=0)return interpolateRoute(snapshot.routes[routeIndex],progress[index]);
      const lat=snapshot.baseCoordinates[index*2],lng=snapshot.baseCoordinates[index*2+1];return Number.isFinite(lat)&&Number.isFinite(lng)?[lat,lng]:null;
    };
    return snapshot.groups.map(group=>{let lat=0,lng=0,count=0;for(let cursor=group.start;cursor<group.start+group.count;cursor++){const point=pointAt(snapshot.members[cursor]);if(!point)continue;lat+=point[0];lng+=point[1];count++;}return {key:group.key,coords:count?[lat/count,lng/count]:null};});
  }

  function create(options={}){
    let worker=null,disabled=false,generation=0,nextRequestId=0,pendingPlan=null,cachedPlan=null,snapshot=null,pendingPositions=null,positionInFlight=false;
    const timeoutMs=Math.max(250,Number(options.timeoutMs)||2500),workerFactory=options.workerFactory;
    const clearTimer=request=>{if(request?.timer)clearTimeout(request.timer);};
    function disable(error){
      if(disabled)return;disabled=true;clearTimer(pendingPlan);clearTimer(pendingPositions);pendingPlan=null;pendingPositions=null;positionInFlight=false;cachedPlan=null;
      try{worker?.terminate?.();}catch{}worker=null;
      try{options.onFailure?.(error instanceof Error?error:new Error(String(error||'map-presentation-worker-failed')));}catch{}
    }
    function ensureWorker(){
      if(disabled||worker)return worker;
      try{if(typeof workerFactory!=='function')throw new Error('map-presentation-worker-unavailable');worker=workerFactory();if(!worker||typeof worker.postMessage!=='function')throw new Error('map-presentation-worker-invalid');worker.onmessage=handleMessage;worker.onerror=event=>disable(event?.error||new Error(event?.message||'map-presentation-worker-error'));worker.onmessageerror=()=>disable(new Error('map-presentation-message-error'));return worker;}
      catch(error){disable(error);return null;}
    }
    function handleMessage(event){
      const message=event?.data||{};
      if(message.type==='error'){const current=(pendingPlan&&message.generation===pendingPlan.generation)||(pendingPositions&&message.generation===pendingPositions.generation);if(current)disable(new Error(String(message.error||'map-presentation-worker-error')));return;}
      if(message.type==='plan-result'){
        if(!pendingPlan||message.requestId!==pendingPlan.requestId||message.generation!==pendingPlan.generation||message.key!==pendingPlan.key)return;
        if(message.version!==VERSION||!(message.heroIndices instanceof Uint32Array)||!(message.members instanceof Uint32Array)||!Array.isArray(message.groups)||message.assetCount!==snapshot?.assetCount||message.heroIndices.length>message.assetCount||message.members.length>message.assetCount){disable(new Error('map-presentation-result-invalid'));return;}
        const heroSet=new Set();for(const index of message.heroIndices){if(index>=message.assetCount||heroSet.has(index)){disable(new Error('map-presentation-hero-invalid'));return;}heroSet.add(index);}
        const keys=new Set(),membership=new Set();
        for(const group of message.groups){if(!group||typeof group.key!=='string'||keys.has(group.key)||!Number.isInteger(group.start)||!Number.isInteger(group.count)||group.count<1||group.start<0||group.start+group.count>message.members.length||!Array.isArray(group.coords)||group.coords.length!==2||!group.coords.every(Number.isFinite)){disable(new Error('map-presentation-group-invalid'));return;}keys.add(group.key);for(let i=group.start;i<group.start+group.count;i++){const index=message.members[i];if(index>=message.assetCount||heroSet.has(index)||membership.has(index)){disable(new Error('map-presentation-membership-invalid'));return;}membership.add(index);}}
        const completed=pendingPlan;clearTimer(completed);pendingPlan=null;cachedPlan={key:message.key,generation:message.generation,heroIndices:message.heroIndices,members:message.members,groups:message.groups};
        try{options.onPlan?.({key:completed.key,generation:completed.generation,assetCount:message.assetCount,plan:cachedPlan});}catch{}
        return;
      }
      if(message.type==='positions-result'){
        if(!pendingPositions||message.requestId!==pendingPositions.requestId||message.generation!==pendingPositions.generation)return;
        if(!Array.isArray(message.groups)||message.groups.some(group=>!group||typeof group.key!=='string'||(group.coords!==null&&(!Array.isArray(group.coords)||group.coords.length!==2||!group.coords.every(Number.isFinite))))){disable(new Error('map-presentation-position-result-invalid'));return;}
        const completed=pendingPositions;clearTimer(completed);pendingPositions=null;positionInFlight=false;
        try{options.onPositions?.({generation:completed.generation,groups:message.groups});}catch{}
        if(snapshot?.queuedProgress){const progress=snapshot.queuedProgress;snapshot.queuedProgress=null;requestPositions(progress);}
      }
    }
    function requestPlan(input={}){
      let active=ensureWorker();if(!active)return {ready:false,worker:false,reason:'worker-disabled'};
      const key=String(input.key||''),rows=input.assetIds;
      if(!key||!Array.isArray(rows))return {ready:false,worker:false,reason:'input-invalid'};
      if(cachedPlan?.key===key)return {ready:true,worker:true,generation:cachedPlan.generation,plan:cachedPlan};
      if(pendingPlan?.key===key)return {ready:false,worker:true,pending:true,generation:pendingPlan.generation};
      if(pendingPlan||pendingPositions){clearTimer(pendingPlan);clearTimer(pendingPositions);pendingPlan=null;pendingPositions=null;positionInFlight=false;try{worker?.terminate?.();}catch{}worker=null;active=ensureWorker();if(!active)return {ready:false,worker:false,reason:'worker-disabled'};}
      cachedPlan=null;
      generation++;const requestId=++nextRequestId,request={requestId,generation,key,timer:null};pendingPlan=request;
      snapshot={key,generation,assetCount:rows.length,assetIds:rows.slice(),owners:input.owners.slice(),modes:input.modes.slice(),routeKeys:input.routeKeys.slice(),routeIndexes:input.routeIndexes.slice(),baseCoordinates:input.baseCoordinates.slice(),routes:input.routes.map(route=>route.map(point=>[point[0],point[1]])),groups:null,queuedProgress:null};
      request.timer=setTimeout(()=>disable(new Error('map-presentation-worker-timeout')),timeoutMs);
      try{active.postMessage({type:'plan',requestId,generation,key,assetIds:input.assetIds,owners:input.owners,modes:input.modes,routeKeys:input.routeKeys,routeIndexes:input.routeIndexes,progress:input.progress,baseCoordinates:input.baseCoordinates,routes:input.routes,zoom:input.zoom,limit:input.limit,groupLimit:input.groupLimit,selectedId:input.selectedId},[input.routeIndexes.buffer,input.progress.buffer,input.baseCoordinates.buffer]);}
      catch(error){disable(error);return {ready:false,worker:false,reason:'plan-post-failed'};}
      return {ready:false,worker:true,pending:true,generation};
    }
    function requestPositions(progress){
      const active=ensureWorker();if(!active||!cachedPlan||!snapshot||!(progress instanceof Float32Array)||progress.length!==snapshot.assetCount)return false;
      if(positionInFlight){snapshot.queuedProgress=progress;return true;}
      const requestId=++nextRequestId,request={requestId,generation:cachedPlan.generation,timer:null};pendingPositions=request;positionInFlight=true;
      request.timer=setTimeout(()=>disable(new Error('map-presentation-position-timeout')),timeoutMs);
      try{active.postMessage({type:'positions',requestId,generation:cachedPlan.generation,progress},[progress.buffer]);}
      catch(error){disable(error);return false;}
      return true;
    }
    function getAssetIds(){return snapshot?.key===cachedPlan?.key?snapshot.assetIds.slice():[];}
    return Object.freeze({requestPlan,requestPositions,getAssetIds,isDisabled:()=>disabled,disable:()=>disable(new Error('map-presentation-worker-disabled')),version:VERSION});
  }

  return Object.freeze({VERSION,interpolateRoute,buildPlan,updateGroupCenters,create});
});
