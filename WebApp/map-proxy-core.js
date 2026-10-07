'use strict';

// Pure map-proxy allocator. It never changes candidates or game state: it only returns references to the candidates
// selected for presentation. At world zoom every visible country is represented (when the shared budget permits), then
// the remaining budget follows sqrt(activity) Hamilton apportionment. Assets without a country participate through
// stable screen/geographic cells. Selection inside a region is a deterministic, nested round-robin across facilities,
// owner/mode pairs and routes. Screen-space decluttering scans the complete fair order, so rejected points are
// backfilled instead of silently shrinking the visible fleet.
((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_MAP_PROXY_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const VERSION='GH-MAP-PROXY-359.1.0',DEFAULT_LIMIT=300;
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const text=value=>value==null?'':String(value).trim();
  const compareText=(a,b)=>a<b?-1:a>b?1:0;
  // Missing fields must stay missing so coordinate fallbacks such as `position`
  // are consulted. Number(null) and Number('') are both zero, which previously
  // made every position-only app candidate look as though it were at [0, 0].
  const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
  const number=value=>finite(value)?Number(value):null;
  const pick=(value,keys)=>{for(const key of keys)if(value&&own(value,key)&&value[key]!=null&&value[key]!=='')return value[key];return null;};
  const canonicalLongitude=value=>{
    const n=number(value);if(n==null)return null;
    const normalized=((n+180)%360+360)%360-180;
    return Object.is(normalized,-0)?0:normalized;
  };
  function coordinates(candidate){
    const position=candidate?.position,coordinate=candidate?.coordinate||candidate?.coordinates;
    let lat=number(pick(candidate,['lat','latitude'])),lon=canonicalLongitude(pick(candidate,['lng','lon','longitude']));
    if(lat==null&&Array.isArray(position))lat=number(position[0]);
    if(lon==null&&Array.isArray(position))lon=canonicalLongitude(position[1]);
    if(lat==null&&Array.isArray(coordinate))lat=number(coordinate[0]);
    if(lon==null&&Array.isArray(coordinate))lon=canonicalLongitude(coordinate[1]);
    if(lat==null&&position&&typeof position==='object')lat=number(pick(position,['lat','latitude']));
    if(lon==null&&position&&typeof position==='object')lon=canonicalLongitude(pick(position,['lng','lon','longitude']));
    return {lat,lon};
  }
  function screenPoint(candidate,project){
    if(typeof project==='function'){
      try{
        const projected=project(candidate);
        if(Array.isArray(projected)&&finite(projected[0])&&finite(projected[1]))return {x:Number(projected[0]),y:Number(projected[1])};
        if(projected&&finite(projected.x)&&finite(projected.y))return {x:Number(projected.x),y:Number(projected.y)};
      }catch{}
    }
    const x=number(pick(candidate,['screenX','x'])),y=number(pick(candidate,['screenY','y']));
    return x==null||y==null?null:{x,y};
  }
  function boundsObject(input){
    if(!input)return null;
    if(Array.isArray(input)&&Array.isArray(input[0])&&Array.isArray(input[1]))return {south:input[0][0],west:input[0][1],north:input[1][0],east:input[1][1]};
    const call=name=>typeof input[name]==='function'?input[name]():null;
    return {
      south:pick(input,['south','minLat'])??call('getSouth'),north:pick(input,['north','maxLat'])??call('getNorth'),
      west:pick(input,['west','minLng','minLon'])??call('getWest'),east:pick(input,['east','maxLng','maxLon'])??call('getEast')
    };
  }
  function paddingValue(input){
    if(input==null)return {lat:0,lon:0};
    if(finite(input)){const n=Math.max(0,Number(input));return {lat:n,lon:n};}
    return {lat:Math.max(0,Number(pick(input,['lat','latitude','y']))||0),lon:Math.max(0,Number(pick(input,['lng','lon','longitude','x']))||0)};
  }
  function normalizeBounds(input,padding){
    const raw=boundsObject(input),south=number(raw?.south),north=number(raw?.north),rawWest=number(raw?.west),rawEast=number(raw?.east);
    if(south==null||north==null||rawWest==null||rawEast==null)return null;
    const pad=paddingValue(padding),low=Math.max(-90,Math.min(south,north)-pad.lat),high=Math.min(90,Math.max(south,north)+pad.lat);
    const delta=rawEast-rawWest,rawSpan=((delta%360)+360)%360,full=Math.abs(delta)>=360||rawSpan+pad.lon*2>=360;
    if(full)return {south:low,north:high,fullLongitude:true,west:-180,east:180};
    return {south:low,north:high,fullLongitude:false,west:canonicalLongitude(rawWest-pad.lon),east:canonicalLongitude(rawEast+pad.lon)};
  }
  function inBounds(point,bounds){
    if(!bounds)return true;
    // Unknown geography must not consume an on-screen budget. The selected proxy is admitted before this check.
    if(point.lat==null||point.lon==null)return false;
    if(point.lat<bounds.south||point.lat>bounds.north)return false;
    if(bounds.fullLongitude)return true;
    return bounds.west<=bounds.east?point.lon>=bounds.west&&point.lon<=bounds.east:point.lon>=bounds.west||point.lon<=bounds.east;
  }
  const fingerprint=candidate=>{
    const geo=coordinates(candidate);
    return [pick(candidate,['countryId','countryCode','country','iso2']),pick(candidate,['facilityId','baseId','hubId']),pick(candidate,['ownerCompanyId','companyId','ownerId']),pick(candidate,['mode','routeMode','assetMode','type']),pick(candidate,['routeId','assignedRouteId']),geo.lat,geo.lon].map(text).join('|');
  };
  function stableId(candidate){
    const explicit=pick(candidate,['id','assetId','uuid','key']);
    if(explicit!=null&&text(explicit))return text(explicit);
    // Content-derived fallback: unlike an array index this remains stable when the source array is reordered.
    let hash=2166136261;const source=fingerprint(candidate);
    for(let i=0;i<source.length;i++){hash^=source.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return `anonymous-${(hash>>>0).toString(16).padStart(8,'0')}`;
  }
  function explicitCountry(candidate){
    const direct=pick(candidate,['countryId','countryCode','country','iso2']),facility=candidate?.facility;
    return text(direct??pick(facility,['countryId','countryCode','country','iso2']));
  }
  function regionKey(row,options){
    if(row.country)return `country:${row.country}`;
    const screenSize=Math.max(1,Number(options.screenCellSize)||96);
    if(row.screen)return `screen:${Math.floor(row.screen.x/screenSize)}:${Math.floor(row.screen.y/screenSize)}`;
    const geoSize=Math.max(.1,Number(options.geographicCellSize)||10);
    if(row.geo.lat!=null&&row.geo.lon!=null)return `geo:${Math.floor((row.geo.lat+90)/geoSize)}:${Math.floor((row.geo.lon+180)/geoSize)}`;
    return `unknown:${row.owner}:${row.mode}`;
  }
  const rowCompare=(a,b)=>compareText(a.id,b.id)||compareText(a.fingerprint,b.fingerprint)||a.index-b.index;
  function roundRobin(iterators){
    const active=iterators.slice();let cursor=0;
    return {next(){
      while(active.length){
        if(cursor>=active.length)cursor=0;const value=active[cursor].next();
        if(value!==null&&value!==undefined){cursor=(cursor+1)%active.length;return value;}
        active.splice(cursor,1);
      }
      return null;
    }};
  }
  function arrayIterator(rows){
    const ordered=rows.slice().sort(rowCompare);let index=0;return {next:()=>index<ordered.length?ordered[index++]:null};
  }
  function sequenceForRegion(rows){
    const facilities=new Map();
    for(const row of rows){
      const facility=row.facility,owner=row.owner,mode=row.mode,route=row.route;
      let owners=facilities.get(facility);if(!owners){owners=new Map();facilities.set(facility,owners);}const ownerMode=`${owner}\u0000${mode}`;
      let routes=owners.get(ownerMode);if(!routes){routes=new Map();owners.set(ownerMode,routes);}let list=routes.get(route);if(!list){list=[];routes.set(route,list);}list.push(row);
    }
    const facilitySequences=[];
    for(const facility of [...facilities.keys()].sort(compareText)){
      const owners=facilities.get(facility),ownerSequences=[];
      for(const ownerMode of [...owners.keys()].sort(compareText)){
        const routes=owners.get(ownerMode),routeSequences=[];
        for(const route of [...routes.keys()].sort(compareText))routeSequences.push(arrayIterator(routes.get(route)));
        ownerSequences.push(roundRobin(routeSequences));
      }
      facilitySequences.push(roundRobin(ownerSequences));
    }
    return roundRobin(facilitySequences);
  }
  function apportion(groups,seats,selectedRegion,representatives){
    const target=new Map(groups.map(group=>[group.key,0]));if(seats<=0||!groups.length)return target;
    let remaining=seats;
    if(representatives&&groups.length<=seats){for(const group of groups){target.set(group.key,1);remaining--;}}
    else if(representatives){
      // If the number of active regions exceeds the visual budget, retain the selected region and then the busiest.
      const priority=groups.slice().sort((a,b)=>(b.rows.length-a.rows.length)||compareText(a.key,b.key));
      if(selectedRegion){const selected=priority.findIndex(group=>group.key===selectedRegion);if(selected>0)priority.unshift(priority.splice(selected,1)[0]);}
      for(const group of priority.slice(0,seats)){target.set(group.key,1);remaining--;}
    }else if(selectedRegion&&target.has(selectedRegion)){target.set(selectedRegion,1);remaining--;}
    while(remaining>0){
      const eligible=groups.filter(group=>(target.get(group.key)||0)<group.rows.length);if(!eligible.length)break;
      const totalWeight=eligible.reduce((sum,group)=>sum+Math.sqrt(group.rows.length),0),shares=[];let granted=0;
      for(const group of eligible){
        const capacity=group.rows.length-target.get(group.key),exact=remaining*Math.sqrt(group.rows.length)/totalWeight,floor=Math.min(capacity,Math.floor(exact));
        if(floor){target.set(group.key,target.get(group.key)+floor);granted+=floor;}
        shares.push({group,remainder:exact-Math.floor(exact)});
      }
      remaining-=granted;if(!remaining)break;
      shares.sort((a,b)=>(b.remainder-a.remainder)||compareText(a.group.key,b.group.key));let progressed=false;
      for(const share of shares){if(!remaining)break;const key=share.group.key;if(target.get(key)>=share.group.rows.length)continue;target.set(key,target.get(key)+1);remaining--;progressed=true;}
      if(!progressed)break;
    }
    return target;
  }
  function selectRows(groups,limit,selected,radius,representatives){
    const selectedRegion=selected?.regionKey||null,target=apportion(groups,Math.min(limit,groups.reduce((sum,group)=>sum+group.rows.length,0)),selectedRegion,representatives),
      keptByRegion=new Map(groups.map(group=>[group.key,0])),used=new Set(),result=[],
      size=Math.max(1,radius),radius2=radius*radius,cells=new Map(),key=(x,y)=>`${x}:${y}`;
    const collides=point=>{const cx=Math.floor(point.x/size),cy=Math.floor(point.y/size);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const list=cells.get(key(cx+dx,cy+dy));if(!list)continue;for(const other of list){const x=point.x-other.x,y=point.y-other.y;if(x*x+y*y<radius2)return true;}}return false;};
    const add=point=>{const k=key(Math.floor(point.x/size),Math.floor(point.y/size));let list=cells.get(k);if(!list){list=[];cells.set(k,list);}list.push(point);};
    const accept=row=>{
      if(!row||used.has(row))return false;used.add(row);
      if(radius>0&&row.screen&&collides(row.screen))return false;
      if(radius>0&&row.screen)add(row.screen);result.push(row.value);keptByRegion.set(row.regionKey,(keptByRegion.get(row.regionKey)||0)+1);return true;
    };
    if(selected)accept(selected);
    const takeAccepted=group=>{
      while(true){const row=group.sequence.next();if(!row)return false;if(accept(row))return true;}
    };
    // At world zoom, find a non-overlapping representative for every active region before spending its extra quota.
    if(representatives)for(const group of groups){if(result.length>=limit)break;if((target.get(group.key)||0)>0&&(keptByRegion.get(group.key)||0)===0)takeAccepted(group);}
    // Fill Hamilton quotas in geographic rounds. A collision consumes no seat; the same region is searched for a
    // replacement before another region can take that reserved seat.
    let progress=true;
    while(result.length<limit&&progress){progress=false;for(const group of groups){if(result.length>=limit)break;const wanted=target.get(group.key)||0;if((keptByRegion.get(group.key)||0)<wanted&&takeAccepted(group))progress=true;}}
    // If a region cannot fill its quota (for example all its points overlap), reuse the otherwise idle capacity by
    // round-robin scanning the remaining candidates until the shared cap is full or no non-overlapping point remains.
    progress=true;while(result.length<limit&&progress){progress=false;for(const group of groups){if(result.length>=limit)break;if(takeAccepted(group))progress=true;}}
    return result;
  }
  function allocate(candidates,options={}){
    if(!Array.isArray(candidates))throw new TypeError('map-proxy-candidates-invalid');
    const limit=Math.max(0,Math.min(Number.isFinite(Number(options.limit))?Math.floor(Number(options.limit)):DEFAULT_LIMIT,candidates.length));if(!limit)return [];
    const selectedId=text(options.selectedId),sourceBounds=options.paddedBounds||options.viewport||options.bounds,
      bounds=normalizeBounds(sourceBounds,options.paddedBounds?0:(options.viewportPadding??options.paddingDegrees??options.padding)),isActive=typeof options.isActive==='function'?options.isActive:null,rows=[];
    for(let index=0;index<candidates.length;index++){
      const value=candidates[index];if(!value||isActive&&!isActive(value))continue;
      const id=stableId(value),geo=coordinates(value);if(id!==selectedId&&!inBounds(geo,bounds))continue;
      const screen=screenPoint(value,options.project),country=explicitCountry(value),
        facility=text(pick(value,['facilityId','baseId','hubId']))||'~no-facility',owner=text(pick(value,['ownerCompanyId','companyId','ownerId']))||'~no-owner',
        mode=text(pick(value,['mode','routeMode','assetMode','type']))||'~no-mode',route=text(pick(value,['routeId','assignedRouteId']))||'~no-route',
        row={value,index,id,geo,screen,country,facility,owner,mode,route,fingerprint:id,regionKey:''};
      row.regionKey=regionKey(row,options);rows.push(row);
    }
    if(!rows.length)return [];
    const selected=selectedId?rows.find(row=>row.id===selectedId)||null:null,regions=new Map();
    for(const row of rows){let list=regions.get(row.regionKey);if(!list){list=[];regions.set(row.regionKey,list);}list.push(row);}
    const groups=[...regions.keys()].sort(compareText).map(key=>{const regionRows=regions.get(key);return {key,rows:regionRows,sequence:sequenceForRegion(regionRows)};}),
      radius=Math.max(0,Number(options.declutterRadius??options.radius)||0),zoom=number(options.zoom),globalZoom=number(options.globalZoom)??4,
      representatives=options.world===true||options.global===true||(options.world!==false&&options.global!==false&&(zoom==null||zoom<=globalZoom));
    return selectRows(groups,limit,selected,radius,representatives);
  }
  return Object.freeze({VERSION,allocate});
});
