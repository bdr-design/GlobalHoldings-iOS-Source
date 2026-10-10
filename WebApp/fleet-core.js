(()=>{
  'use strict';
  const VERSION='3.0.0';
  const ROLE_DEFAULTS=Object.freeze({
    // Build 358: market pay per day (monthly ÷ 30) — a captain and first officer average 18,000$ a month, cabin
    // crew 3,900$, licensed engineers 6,900$; a master or chief officer 13,500$, ratings 2,250$, marine engineers
    // 8,400$; a truck driver 3,300$, a fleet mechanic 4,200$.
    pilots:{name:'الطيارون',dailyRate:600},
    cabin:{name:'طاقم الضيافة',dailyRate:130},
    aeng:{name:'مهندسو الطيران',dailyRate:230},
    captains:{name:'قباطنة السفن',dailyRate:450},
    sailors:{name:'بحارة وملاحون',dailyRate:75},
    seng:{name:'مهندسو السفن',dailyRate:280},
    drivers:{name:'سائقو الشاحنات',dailyRate:110},
    mech:{name:'فنيو الصيانة',dailyRate:140}
  });
  // Every transport mode shares canonical route geometry across a bounded fleet.
  // Aircraft preserve separation through unique route slots and staggered
  // departures rather than persisting one heavy route per aircraft. This keeps
  // large fleets below route/save limits while retaining explicit capacity.
  const ROUTE_FLEET_CAPACITY=Object.freeze({air:24,sea:24,road:64});
  const ROUTE_DEPARTURE_INTERVAL_SECONDS=Object.freeze({air:180,sea:60,road:15});
  // Build 358 (million-asset): ROUTE_FLEET_CAPACITY is a route's departure slots (slot x interval keeps aircraft
  // apart) and its capacity unless its record carries more (route.fleetCapacity, at most ROUTE_MAX_FLEET_CAPACITY).
  // The route registry holds 240 routes, so the base capacity alone stops at 5,760 aircraft; bulk dispatch raises a
  // route's capacity when a fleet outgrows that. Slots past the base share the base slots' departure times.
  const ROUTE_MAX_FLEET_CAPACITY=Object.freeze({air:8192,sea:8192,road:8192});
  // Hard capacity protects assignment integrity; automatic dispatch deliberately
  // targets a much lower density so normal fleets spread across the world
  // instead of filling one corridor to its safety ceiling.
  const AUTOMATIC_ROUTE_DENSITY=Object.freeze({
    air:Object.freeze([{maxFleet:60,target:4},{maxFleet:180,target:8},{maxFleet:360,target:12},{maxFleet:Infinity,target:16}]),
    sea:Object.freeze([{maxFleet:80,target:4},{maxFleet:180,target:6},{maxFleet:Infinity,target:10}]),
    road:Object.freeze([{maxFleet:128,target:8},{maxFleet:512,target:24},{maxFleet:Infinity,target:48}])
  });

  const clone=value=>globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
  const simDay=state=>Math.floor((Number(state?.simSeconds)||0)/86400);
  const platform=()=>globalThis.GH_COMPANY_PLATFORM||null;
  const assetMode=asset=>String(asset?.assetMode||asset?.type||'').trim();
  const routeMode=route=>String(route?.routeMode||route?.type||'').trim();
  const fleetData=()=>{const api=globalThis.GH_FLEET_DATA||(typeof require==='function'?require('./fleet-access-core.js'):null);if(!api)throw new Error('fleet-data-access-unavailable');return api;};
  // Read-only catalog query for the existing operations provider. Discovery
  // never requires a funded company and never calls ensure() or finance.
  function purchaseCatalogs(ctx){
    const definition=ctx?.definition||platform()?.definitionFor?.(ctx?.state,ctx?.companyId);
    if(!definition?.capabilities?.includes('operations.fleet'))return [];
    const classes=definition.classification?.assetClasses||[],catalogs=globalThis.GH_ASSET_CATALOG||{};
    const modes=new Set([...(definition.classification?.routeModes||[]),...(definition.legacy?.assetOwnerModes||[])]);
    return [...modes].flatMap(mode=>{
      const assetClass=definition.legacy?.assetClassByMode?.[mode]||platform()?.assetClassForLegacyMode?.(mode)||(classes.length===1?classes[0]:null);
      if(!assetClass||!classes.includes(assetClass)||!Object.hasOwn(catalogs,mode))return [];
      const catalog=catalogs[mode],newItems=Array.isArray(catalog?.new)?catalog.new:[],usedItems=Array.isArray(catalog?.used)?catalog.used:[];
      return newItems.length||usedItems.length?[{mode,view:'fleet',assetClass,new:newItems,used:usedItems}]:[];
    });
  }
  function assetOwnerCompanyId(asset){
    const mode=assetMode(asset);
    const P=platform();return String(asset?.ownerCompanyId||asset?.companyId||P?.ownerForLegacyAssetMode?.(mode)||(!P&&['air','sea','road'].includes(mode)?mode:'')).trim();
  }
  function routeOwnerCompanyId(route){
    const mode=routeMode(route);
    const P=platform();return String(route?.ownerCompanyId||route?.companyId||route?.company||P?.ownerForLegacyRouteMode?.(mode)||(!P&&['air','sea','road'].includes(mode)?mode:'')).trim();
  }
  function requireFleetAsset(state,asset,{operational=true}={}){
    const P=platform(),companyId=assetOwnerCompanyId(asset),mode=assetMode(asset);
    if(!companyId||!mode)throw new Error('asset-ownership-missing');
    if(P){const company=P.requireCompany(state,companyId,{operational,capability:'operations.fleet'});if(!company.definition.classification.assetClasses.includes(String(asset.assetClass||P.assetClassForLegacyMode(mode)||'')))throw new Error('asset-class-owner-mismatch');}
    else if(!['air','sea','road'].includes(mode)||companyId!==mode)throw new Error('asset-owner-company-invalid');
    return {companyId,mode};
  }
  function requireFleetRoute(state,route,{operational=true}={}){
    const P=platform(),companyId=routeOwnerCompanyId(route),mode=routeMode(route);
    if(!companyId||!mode)throw new Error('route-ownership-missing');
    if(P){const company=P.requireCompany(state,companyId,{operational,capability:'operations.fleet'});if(!company.definition.classification.routeModes.includes(mode))throw new Error('route-mode-owner-mismatch');}
    else if(!['air','sea','road'].includes(mode)||companyId!==mode)throw new Error('route-owner-company-invalid');
    return {companyId,mode};
  }
  function nextId(state,prefix){
    state.sequences=state.sequences&&typeof state.sequences==='object'?state.sequences:{};
    const key=`fleetCore_${prefix}`;
    state.sequences[key]=(Number(state.sequences[key])||0)+1;
    return `${prefix}-${String(state.sequences[key]).padStart(7,'0')}`;
  }
  // Fleet Data Access owns the asset container (legacy array or columnar store).
  function ensure(state){return fleetData().ensure(state);}
  const disposalBatches=new WeakMap();
  function find(state,id){const batch=disposalBatches.get(state);return batch?(batch.assetById.get(id)||null):fleetData().get(state,id);}
  function removeAsset(state,asset){
    const batch=disposalBatches.get(state);
    if(batch){if(batch.assetById.get(asset?.id)!==asset)return false;batch.assetById.delete(asset.id);batch.removed.add(asset.id);return true;}
    return fleetData().remove(state,asset);
  }
  function removeLeasedAsset(state,assetId){
    const batch=disposalBatches.get(state);
    if(batch){batch.leasedRemoved.add(assetId);return;}
    state.leasedAssets=Array.isArray(state.leasedAssets)?state.leasedAssets.filter(id=>id!==assetId):[];
  }
  function withDisposalBatch(state,apply){
    if(!state||typeof state!=='object'||typeof apply!=='function')throw new TypeError('fleet-disposal-batch-invalid');
    if(!globalThis.GH_TRANSACTION_CORE?.isActive?.())throw new Error('fleet-disposal-batch-requires-full-transaction');
    const active=disposalBatches.get(state);
    if(active){active.depth++;try{const value=apply();if(value?.then)throw new Error('fleet-disposal-batch-must-be-synchronous');return value;}finally{active.depth--;}}
    const fleet=fleetData();fleet.ensure(state);const batch={depth:1,assetById:fleet.indexById(state),removed:new Set(),leasedRemoved:new Set(),contractById:null,crewDirty:false};disposalBatches.set(state,batch);
    try{const value=apply();if(value?.then)throw new Error('fleet-disposal-batch-must-be-synchronous');return value;}
    finally{
      disposalBatches.delete(state);
      if(batch.removed.size)fleet.removeMany(state,[...batch.removed]);
      if(batch.leasedRemoved.size)state.leasedAssets=(Array.isArray(state.leasedAssets)?state.leasedAssets:[]).filter(id=>!batch.leasedRemoved.has(id));
      if(batch.crewDirty)synchronizeCrew(state);
    }
  }
  const corridorIndex=routes=>{const owner=globalThis.GH_ROUTE_CORE;if(!owner?.corridorIndex)throw new Error('route-owner-unavailable');return owner.corridorIndex(routes);};
  function routeSignature(route){
    if(!globalThis.GH_ROUTE_CORE?.signature)throw new Error('route-owner-unavailable');
    return globalThis.GH_ROUTE_CORE.signature(route);
  }
  function routeCapacity(routeOrType){
    const type=typeof routeOrType==='string'?routeOrType:routeMode(routeOrType),base=ROUTE_FLEET_CAPACITY[type]||1;
    if(!routeOrType||typeof routeOrType!=='object')return base;
    const stored=routeOrType.fleetCapacity;
    return Number.isSafeInteger(stored)&&stored>base?Math.min(stored,ROUTE_MAX_FLEET_CAPACITY[type]||base):base;
  }
  // The per-route capacity that `count` assets of a mode need over `routes` routes: the base when they fit, else
  // the even share, never above the mode's maximum.
  function requiredRouteCapacity(type,count,routes){
    const base=ROUTE_FLEET_CAPACITY[type]||1,max=ROUTE_MAX_FLEET_CAPACITY[type]||base,n=Math.max(0,Math.floor(Number(count)||0)),r=Math.max(1,Math.floor(Number(routes)||0));
    return Math.min(max,Math.max(base,Math.ceil(n/r)));
  }
  function automaticRouteTargetLoad(type,fleetCount,maxRoutes=Infinity,hardCapacity=null){
    const hard=Number.isSafeInteger(hardCapacity)&&hardCapacity>0?hardCapacity:routeCapacity(type),count=Math.max(0,Math.floor(Number(fleetCount)||0));
    if(count<=1)return 1;
    const tiers=AUTOMATIC_ROUTE_DENSITY[type]||[{maxFleet:Infinity,target:hard}],preferred=Math.min(hard,(tiers.find(row=>count<=row.maxFleet)||tiers.at(-1)).target);
    const minimumRoutes=Math.ceil(count/hard),preferredRoutes=Math.ceil(count/preferred),limit=Number.isFinite(Number(maxRoutes))?Math.max(1,Math.floor(Number(maxRoutes))):preferredRoutes;
    const routeCount=Math.max(minimumRoutes,Math.min(preferredRoutes,Math.max(minimumRoutes,limit)));
    return Math.min(hard,Math.max(1,Math.ceil(count/routeCount)));
  }
  function departureDelay(asset){
    const mode=assetMode(asset),slot=Math.max(0,Math.floor(Number(asset?.routeSlot)||0));
    return slot%(ROUTE_FLEET_CAPACITY[mode]||1)*(ROUTE_DEPARTURE_INTERVAL_SECONDS[mode]||0);
  }
  // Build 358 (million-asset): the users of each (company, mode, route) are counted per class of rows (one cached class
  // scan per fleet revision) instead of listing every routed asset; a check needs only a group's size and its first
  // user other than the asset being placed (a view made on demand), and each company's air routes in order of their
  // first user, exactly what the full lists gave.
  const ROUTE_USER_FIELDS=Object.freeze(['ownerCompanyId','companyId','assetMode','type','routeId']);
  function routeConflictContext(state){
    const fleet=fleetData(),routeIndex=new Map((state.customRoutes||[]).filter(Boolean).map(row=>[row.id,row])),groups=new Map(),airRouteOrderByCompany=new Map(),signatureCache=new Map();
    fleet.forEachFieldClasses(state,ROUTE_USER_FIELDS,(row,count,info)=>{
      if(!count||!row.routeId)return;const companyId=assetOwnerCompanyId(row),mode=assetMode(row);if(!companyId||!mode)return;
      const key=`${companyId}\u0000${mode}\u0000${row.routeId}`;let group=groups.get(key);
      if(!group){group={companyId,mode,routeId:row.routeId,count:0,first:info.index,users:null};groups.set(key,group);}group.count+=count;if(info.index<group.first)group.first=info.index;
    });
    for(const group of [...groups.values()].filter(group=>group.mode==='air').sort((a,b)=>a.first-b.first)){const order=airRouteOrderByCompany.get(group.companyId);if(order)order.push(group.routeId);else airRouteOrderByCompany.set(group.companyId,[group.routeId]);}
    const signature=route=>{if(!route)return null;if(signatureCache.has(route))return signatureCache.get(route);const value=routeSignature(route);signatureCache.set(route,value);return value;};
    // The group's first two users (views, row order): enough to skip the one asset being placed.
    const firstUsers=group=>{
      if(group.users)return group.users;const users=[];
      fleet.scan(state,ROUTE_USER_FIELDS,(row,index)=>{if(row.routeId!==group.routeId||assetMode(row)!==group.mode||assetOwnerCompanyId(row)!==group.companyId)return;users.push(fleet.viewAt(state,index));if(users.length>=2)return fleet.STOP;},{from:group.first});
      group.users=users;return users;
    };
    const firstUserOtherThan=(group,assetId)=>firstUsers(group).find(row=>row.id!==assetId)||null;
    const memberOf=(group,assetId)=>{if(assetId===null||assetId===undefined)return false;const asset=fleet.get(state,assetId);return !!asset&&asset.routeId===group.routeId&&assetMode(asset)===group.mode&&assetOwnerCompanyId(asset)===group.companyId;};
    // Build 359 (a million assets: the route centre checked every route against every other, 0.7 s for 3,000 aircraft):
    // the company's air routes that may duplicate `route`, in the order above: the registered ones the corridor index
    // names (an endpoint near its first point) and every unregistered one (compared by its users' signature).
    const airIndexes=new Map(),airCandidates=(companyId,route)=>{
      const order=airRouteOrderByCompany.get(companyId)||[];let known=airIndexes.get(companyId);
      if(!known){const position=new Map(order.map((id,at)=>[id,at])),registered=order.map(id=>routeIndex.get(id)).filter(Boolean);known={position,unregistered:order.filter(id=>!routeIndex.has(id)),corridors:globalThis.GH_ROUTE_CORE.corridorIndex(registered)};airIndexes.set(companyId,known);}
      const ids=new Set(known.unregistered);for(const other of known.corridors.candidates(route))ids.add(other.id);
      return [...ids].filter(id=>known.position.has(id)).sort((a,b)=>known.position.get(a)-known.position.get(b));
    };
    return {routeIndex,groups,airRouteOrderByCompany,airCandidates,signature,firstUserOtherThan,memberOf};
  }
  function routeConflictWithContext(state,assetId,routeId,route,context){
    const routeOwner=requireFleetRoute(state,route);if(!routeOwner.mode||!routeId)return null;const ctx=context||routeConflictContext(state),key=`${routeOwner.companyId}\u0000${routeOwner.mode}\u0000${routeId}`,same=ctx.groups.get(key);
    // The former loop returned the first other user once the other users reached the route's capacity.
    if(same&&same.count-(ctx.memberOf(same,assetId)?1:0)>=routeCapacity(route))return ctx.firstUserOtherThan(same,assetId);
    if(routeOwner.mode!=='air')return null;const signature=ctx.signature(route),routeOrder=ctx.airCandidates(routeOwner.companyId,route);
    for(const otherRouteId of routeOrder){if(otherRouteId===routeId)continue;const group=ctx.groups.get(`${routeOwner.companyId}\u0000air\u0000${otherRouteId}`);const other=group?ctx.firstUserOtherThan(group,assetId):null;if(!other)continue;const registered=ctx.routeIndex.get(otherRouteId),otherSignature=registered?ctx.signature(registered):other.routeSignature;if(signature&&otherSignature&&signature===otherSignature)return other;if(registered&&globalThis.GH_ROUTE_CORE?.corridorMetrics?.(registered,route)?.duplicate)return other;}
    return null;
  }
  // Build 359 (the road dispatch checked every truck with a context built from the whole fleet: 14 s for one command):
  // a caller checking many assets against one unchanged state passes one context (routeConflictContext) to every check.
  function routeConflict(state,assetId,routeId,route,context=null){return routeConflictWithContext(state,assetId,routeId,route,context||routeConflictContext(state));}
  function routeConflicts(state,routes){const ctx=routeConflictContext(state),out=new Map();for(const route of routes||[]){if(!route?.id)continue;out.set(route.id,routeConflictWithContext(state,null,route.id,route,ctx));}return out;}
  function applyRouteAssignment(asset,p,slot,signature=routeSignature(p.route)){
    asset.routeId=p.routeId||null;asset.routeSignature=signature;asset.releaseExclusiveRouteOnArrival=false;asset.baseFacility=p.baseFacility??asset.baseFacility;asset.phase=p.phase||'turnaround';asset.progress=0;asset.dwellRemaining=0;asset.crewBlocked=false;asset.routeSlot=slot;asset.departureScheduled=false;delete asset.departureScheduledAt;delete asset.simulationFault;
    const reverse=asset.baseFacility===p.route.toFacility;asset.reverse=reverse;asset.from=reverse?p.route.to:p.route.from;asset.to=reverse?p.route.from:p.route.to;return asset;
  }
  // Every live asset holding a route (a truthy routeId; both callers pass over the others) outside `skipIds`, in row
  // order, with whether requireFleetAsset accepts it (asked once per owner, mode and class): what the former passes over
  // drafts of the whole fleet read, without a draft per asset.
  // Build 371 (a million assets: every 500-asset chunk of a dispatch decoded all rows, 80 full passes per command): the
  // rows come from GH_FLEET_DATA.scanRouted, and fn returns SKIP_ROUTE once it needs no later holder of that route.
  const ROUTE_HOLDER_FIELDS=Object.freeze(['id','routeId','routeSlot','phase','releaseExclusiveRouteOnArrival','ownerCompanyId','companyId','assetMode','type','assetClass']);
  function scanRouteHolders(state,skipIds,fn){
    const fleet=fleetData(),owners=new Map();
    fleet.scanRouted(state,ROUTE_HOLDER_FIELDS,row=>{
      if(skipIds&&skipIds.has(row.id))return undefined;
      const key=`${row.ownerCompanyId}\u0000${row.companyId}\u0000${row.assetMode}\u0000${row.type}\u0000${row.assetClass}`;let owned=owners.get(key);
      if(owned===undefined){try{requireFleetAsset(state,row);owned=true;}catch(_error){owned=false;}owners.set(key,owned);}
      return fn(row,owned);
    });
  }
  // Build 358 (million-asset): a batch may name each distinct route once (`routes`, keyed by the row's routeRef)
  // instead of carrying the route on every row, so a 12,000-asset command is not 12,000 copies of route geometry.
  function batchRoute(row,routeTable){
    if(row?.route)return row.route;
    const ref=row?.routeRef;if(typeof ref!=='string'||!routeTable||typeof routeTable!=='object'||!Object.prototype.hasOwnProperty.call(routeTable,ref))return undefined;
    return routeTable[ref];
  }
  function assignRoutesBatch(state,rows,routeTable=null){
    if(!Array.isArray(rows)||!rows.length)throw new Error('route-assignment-batch-empty');
    // Drafts: the assignment below edits assets in place; commit() applies it. Build 358 (million-asset): only the
    // assets being assigned get drafts; the slots the other assets hold come from one row pass in row order.
    const fleet=fleetData(),requested=new Set(),batchIds=new Set(rows.map(row=>row?.id).filter(Boolean));
    if(batchIds.size!==rows.length)throw new Error('route-assignment-batch-duplicate');
    const assetById=new Map();for(const id of batchIds){const draft=fleet.draft(state,id);if(draft)assetById.set(id,draft);}
    const prepared=[],slotUsage=new Map(),fixedAirRoutes=[],batchRouteIds=new Set(rows.map(row=>row?.routeId).filter(Boolean)),firstAirHolder=new Set();
    // Slots are read below for the batch's routes only, and occupyAir keeps the first air holder of a route: any other
    // route is passed over after its first holder outside the batch.
    scanRouteHolders(state,batchIds,(other,owned)=>{
      if(assetMode(other)==='air'&&other.routeId&&!firstAirHolder.has(other.routeId)){firstAirHolder.add(other.routeId);fixedAirRoutes.push([other.routeId,other.id]);}
      if(!batchRouteIds.has(other.routeId))return fleetData().SKIP_ROUTE;
      if(!other.routeId||!owned)return;
      let used=slotUsage.get(other.routeId);if(!used){used=new Set();slotUsage.set(other.routeId,used);}
      const preferred=Number.isInteger(other.routeSlot)&&other.routeSlot>=0?other.routeSlot:null;
      if(preferred!=null&&!used.has(preferred))used.add(preferred);else{let slot=0;while(used.has(slot))slot++;used.add(slot);}
    });

    // Air corridor conflict validation is batch-indexed. The former path rebuilt a
    // shadow state and rescanned every aircraft for every assignment (O(n²)),
    // which could block WebKit for several seconds with 300 aircraft. Capacity
    // remains enforced by slotUsage below; this index only guards duplicate
    // geometry across different route IDs and preserves the same invariant.
    // Build 359 (a million assets): an occupied route is compared only with the routes the corridor index names (an
    // endpoint near its first point), the first in occupation order as before, not with every occupied route.
    const airRouteIndex=new Map((state.customRoutes||[]).filter(route=>routeMode(route)==='air').map(route=>[route.id,route])),
      airOccupiedByRoute=new Map(),airOccupationOrder=new Map(),airSignatureCache=new Map(),airValidatedRoutes=new Set(),airCorridors=corridorIndex();
    const occupyAir=(routeId,assetId)=>{if(airOccupiedByRoute.has(routeId))return;airOccupiedByRoute.set(routeId,assetId);airOccupationOrder.set(routeId,airOccupationOrder.size);const route=airRouteIndex.get(routeId);if(route)airCorridors.add(route);};
    for(const [routeId,assetId] of fixedAirRoutes)occupyAir(routeId,assetId);
    const airSignature=route=>{
      if(!route)return '';
      if(airSignatureCache.has(route.id))return airSignatureCache.get(route.id);
      const signature=routeSignature(route);airSignatureCache.set(route.id,signature);return signature;
    };
    const validateAirRoute=(route,assetId)=>{
      if(airValidatedRoutes.has(route.id))return;
      airRouteIndex.set(route.id,route);const signature=airSignature(route);
      const others=[...new Set(airCorridors.candidates(route).map(other=>other.id))].filter(id=>id!==route.id&&airOccupiedByRoute.has(id)&&airRouteIndex.has(id)).sort((a,b)=>airOccupationOrder.get(a)-airOccupationOrder.get(b)).map(id=>airRouteIndex.get(id));
      for(const otherRoute of others){
        const otherSignature=airSignature(otherRoute);
        if((signature&&otherSignature&&signature===otherSignature)||globalThis.GH_ROUTE_CORE?.corridorMetrics?.(otherRoute,route)?.duplicate)throw new Error(`asset-route-capacity-or-corridor:${airOccupiedByRoute.get(otherRoute.id)}`);
      }
      airValidatedRoutes.add(route.id);occupyAir(route.id,assetId);
    };

    for(const p of rows){
      const asset=p?.id?assetById.get(p.id):null,route=batchRoute(p,routeTable);if(!asset||requested.has(asset.id))throw new Error('route-assignment-contract');requested.add(asset.id);
      const assetOwner=requireFleetAsset(state,asset),routeOwner=requireFleetRoute(state,route);
      if(!route||route.id!==p.routeId||routeOwner.mode!==assetOwner.mode||routeOwner.companyId!==assetOwner.companyId||asset.phase==='moving'||asset.salePending||asset.deliveryStatus==='pending'||(p.phase!=null&&p.phase!=='turnaround')||(p.baseFacility!=null&&p.baseFacility!==asset.baseFacility)||![route.fromFacility,route.toFacility].includes(asset.baseFacility))throw new Error('route-assignment-contract');
      if(assetOwner.mode==='air')validateAirRoute(route,asset.id);
      let used=slotUsage.get(p.routeId);if(!used){used=new Set();slotUsage.set(p.routeId,used);}
      let slot=0;const preferred=asset.routeId===p.routeId&&Number.isInteger(asset.routeSlot)&&asset.routeSlot>=0?asset.routeSlot:null;
      if(preferred!=null&&!used.has(preferred))slot=preferred;else{while(used.has(slot))slot++;}
      if(slot>=routeCapacity(route))throw new Error(`asset-route-capacity:${p.routeId}`);used.add(slot);
      prepared.push({asset,input:p.route===route?p:{...p,route},slot});
    }
    // One signature per route object (rows of one route share it), not one per asset.
    const signatures=new Map();for(const row of prepared){let signature=signatures.get(row.input.route);if(signature===undefined){signature=routeSignature(row.input.route);signatures.set(row.input.route,signature);}applyRouteAssignment(row.asset,row.input,row.slot,signature);}
    fleet.commit(state,prepared.map(row=>row.asset));
    return prepared.map(row=>fleet.plain(row.asset));
  }
  function crewRole(id){const fixed=ROLE_DEFAULTS[id]||{name:id,dailyRate:0};return {id,name:fixed.name,dailyRate:fixed.dailyRate};}
  function staffingPlan(asset){
    // Build 358: the crew is the model's (catalogue crewPlan: crew sets for the aircraft's utilisation, a ship's
    // complement, a truck's drivers); an asset without one keeps the plain plan of its mode.
    const mode=assetMode(asset),DEFAULT={air:{pilots:10,cabin:16,aeng:4},sea:{captains:2,sailors:16,seng:4},road:{drivers:2,mech:1}}[mode];
    if(!DEFAULT)throw new Error('asset-staffing-type-unsupported');
    const plan=asset?.specs?.crewPlan&&typeof asset.specs.crewPlan==='object'?asset.specs.crewPlan:DEFAULT,counts={};
    for(const role of Object.keys(DEFAULT))counts[role]=Math.max(0,Math.round(Number(plan[role])||0));
    const roles=Object.entries(counts).filter(([,count])=>count>0).map(([id,count])=>{
      const role=crewRole(id);
      return {...role,count,monthlyPayroll:role.dailyRate*30*count};
    });
    const total=roles.reduce((sum,role)=>sum+role.count,0);
    const monthlyPayroll=roles.reduce((sum,role)=>sum+role.monthlyPayroll,0);
    if(!total||!Number.isFinite(monthlyPayroll))throw new Error('asset-staffing-plan-invalid');
    return {mode:'automatic-fixed',ready:true,roles,total,monthlyPayroll};
  }
  function laborLedger(state){
    state.advanced=state.advanced||{};
    const labor=state.advanced.labor=state.advanced.labor&&typeof state.advanced.labor==='object'?state.advanced.labor:{};
    labor.employmentContracts=Array.isArray(labor.employmentContracts)?labor.employmentContracts:[];
    labor.hiringLog=Array.isArray(labor.hiringLog)?labor.hiringLog:[];
    return labor;
  }
  function synchronizeCrew(state){
    state.crew=Array.isArray(state.crew)?state.crew:[];
    for(const id of Object.keys(ROLE_DEFAULTS)){
      let saved=state.crew.find(role=>role.id===id);
      if(!saved){const fallback=ROLE_DEFAULTS[id];saved={id,sector:['pilots','cabin','aeng'].includes(id)?'air':['captains','sailors','seng'].includes(id)?'sea':'road',name:fallback.name,count:0,salaryMin:fallback.dailyRate,salaryMax:fallback.dailyRate,morale:90};state.crew.push(saved);}
      saved.count=0;
    }
    // Build 358 (million-asset): staffing is a purchase-batch profile field, so assets are counted per class of rows
    // with the same staffing (GH_FLEET_DATA.forEachFieldClasses) instead of one view per asset: a class adds its size
    // times each role count. Integer sums do not depend on order, so that is the per-asset result; if any count is not
    // an integer the per-asset loop runs instead, in row order.
    const add=(staffing,times)=>{
      if(staffing?.mode!=='automatic-fixed'||staffing.ready!==true)return;
      for(const role of staffing.roles||[]){const saved=state.crew.find(row=>row.id===role.id);if(saved)saved.count=(Number(saved.count)||0)+(Number(role.count)||0)*times;}
    };
    const fleet=fleetData(),classes=[];let integral=typeof fleet.forEachFieldClasses==='function';
    if(integral)fleet.forEachFieldClasses(state,['staffing'],(row,count)=>{if(!count)return;classes.push([row.staffing,count]);if(!(row.staffing?.roles||[]).every(role=>Number.isSafeInteger(Number(role.count)||0)))integral=false;});
    if(integral)for(const [staffing,count] of classes)add(staffing,count);
    else fleet.forEach(state,asset=>add(asset.staffing,1));
    return state.crew;
  }
  function provisionStaffing(state,asset,base){
    const owner=requireFleetAsset(state,asset);
    if(asset.staffing?.mode==='automatic-fixed'&&asset.staffing.ready===true){synchronizeCrew(state);return asset.staffing;}
    const plan=staffingPlan(asset,state),labor=laborLedger(state),contractId=nextId(state,'EMP-AUTO');
    const center=base?.name||asset.baseLocation||asset.baseFacility||'المركز التشغيلي';
    const contract={
      id:contractId,company:owner.companyId,ownerCompanyId:owner.companyId,assetId:asset.id,name:`طاقم ثابت · ${asset.name}`,
      role:'طاقم تشغيلي مرتبط بالأصل',count:plan.total,center,salary:plan.monthlyPayroll,
      startDay:simDay(state),termMonths:1200,status:'ساري',source:'توظيف آلي ثابت عند شراء الأصل',
      automaticAssetStaffing:true,permanent:true
    };
    labor.employmentContracts.unshift(contract);
    labor.hiringLog.unshift({id:nextId(state,'HR-AUTO'),at:Number(state.simSeconds)||0,company:owner.companyId,source:'توظيف أصل آلي ثابت',assetId:asset.id,total:plan.total,monthlyPayroll:plan.monthlyPayroll,coverageBefore:100,coverageAfter:100});
    labor.hiringLog=labor.hiringLog.slice(0,200);
    const staffing={...plan,contractId,provisionedAt:Number(state.simSeconds)||0,center};
    if(fleetData().isView(asset))fleetData().update(state,asset,{staffing,crewBlocked:false});else{asset.staffing=staffing;asset.crewBlocked=false;}
    synchronizeCrew(state);
    return staffing;
  }
  // A procurement receipt owns one employment contract for its entire batch.
  // Each asset still keeps its own role plan and payroll amount for display and
  // accounting; only the contract and hiring-log records are shared.
  function provisionStaffingBatch(state,rows,{synchronize=true}={}){
    const labor=laborLedger(state),groups=new Map(),contracts=[],hiring=[];
    for(const row of rows){
      const asset=row?.asset,base=row?.base;if(!asset)continue;
      if(asset.staffing?.mode==='automatic-fixed'&&asset.staffing.ready===true)continue;
      const owner=requireFleetAsset(state,asset),plan=staffingPlan(asset,state),deliveryOrderId=String(row.deliveryId||row.deliveryOrderId||asset.deliveryOrderId||asset.id),center=base?.name||asset.baseLocation||asset.baseFacility||'المركز التشغيلي';
      let group=groups.get(deliveryOrderId);if(!group){group={deliveryOrderId,company:owner.companyId,center,rows:[],headcount:0,payroll:0};groups.set(deliveryOrderId,group);}
      if(group.company!==owner.companyId)throw new Error('delivery-crew-company-mismatch');
      group.rows.push({asset,plan,center});group.headcount+=plan.total;group.payroll+=plan.monthlyPayroll;
    }
    for(const group of groups.values()){
      // Build 358 (million-asset): the batch's ids as a compact list (GH_FLEET_DATA.idLists), shared by the contract and the hiring log as a value.
      const contractId=nextId(state,'EMP-AUTO'),ids=group.rows.map(row=>row.asset.id),assetIds=fleetData().idLists.of(ids),first=group.rows[0],contract={id:contractId,company:group.company,ownerCompanyId:group.company,assetId:ids[0],assetIds,deliveryOrderId:group.deliveryOrderId,assetCount:ids.length,name:`طاقم ثابت · ${first.asset.name}${ids.length>1?` + ${ids.length-1}`:''}`,role:'طاقم تشغيلي مرتبط بدفعة الأصول',count:group.headcount,center:group.center,salary:group.payroll,startDay:simDay(state),termMonths:1200,status:'ساري',source:'توظيف آلي ثابت عند شراء دفعة الأصول',automaticAssetStaffing:true,permanent:true};
      contracts.push(contract);
      hiring.push({id:nextId(state,'HR-AUTO'),at:Number(state.simSeconds)||0,company:group.company,source:'توظيف دفعة أصول آلي ثابت',deliveryOrderId:group.deliveryOrderId,assetIds,total:group.headcount,monthlyPayroll:group.payroll,coverageBefore:100,coverageAfter:100});
      for(const row of group.rows){row.asset.staffing={...row.plan,contractId,provisionedAt:Number(state.simSeconds)||0,center:row.center};row.asset.crewBlocked=false;}
    }
    if(contracts.length)labor.employmentContracts.unshift(...contracts.reverse());
    if(hiring.length){labor.hiringLog.unshift(...hiring.reverse());labor.hiringLog=labor.hiringLog.slice(0,200);}
    if(synchronize)synchronizeCrew(state);return contracts.length;
  }
  function recordDeliveryBatch(state,rows){
    if(!Array.isArray(rows)||!rows.length)throw new Error('delivery-batch-empty');
    const deliveries=state.realism?.procurement?.deliveries;if(!Array.isArray(deliveries))throw new Error('delivery-store-unavailable');
    const deliveryById=new Map(deliveries.map(row=>[row.id,row])),baseById=new Map([...(state.globalBases||[]),...(state.customHubs||[])].map(base=>[base.id,base])),invoiceByNumber=new Map((state.finance?.invoices||[]).map(row=>[row.number,row])),chequeById=new Map((state.finance?.cheques||[]).map(row=>[row.id,row])),fleet=fleetData(),batchIds=new Set(),occupancy=new Map(),additions=new Map(),prepared=[];
    for(const [base,count] of fleet.countByFields(state,['baseFacility'],asset=>asset.baseFacility))occupancy.set(base,count);
    const requested=new Set();
    for(const input of rows){
      const snaps=Array.isArray(input?.assets)?input.assets:input?.asset?[input.asset]:[];
      if(!snaps.length||!input.baseId||!input.deliveryId||requested.has(input.deliveryId))throw new Error('delivery-contract');requested.add(input.deliveryId);
      const delivery=deliveryById.get(input.deliveryId),base=baseById.get(input.baseId),receiptAssets=Array.isArray(delivery?.assets)?delivery.assets:delivery?.asset?[delivery.asset]:[],payment=delivery?.payment,document=payment?.kind==='invoice'?invoiceByNumber.get(payment.ref):chequeById.get(payment?.ref),facilityOwner=globalThis.GH_FACILITY_CORE;
      const receiptIds=new Set(receiptAssets.map(asset=>asset?.id));
      if(!delivery||delivery.status!=='pending'||delivery.deliveryOrderId&&delivery.deliveryOrderId!==input.deliveryId||receiptAssets.length!==snaps.length||snaps.some(snap=>!snap?.id||!receiptIds.has(snap.id))||delivery.baseId!==input.baseId||!base?.owned)throw new Error('delivery-destination-contract');
      const owners=new Set(snaps.map(snap=>requireFleetAsset(state,snap).companyId)),ownerCompanyId=owners.values().next().value,baseOwner=String(base?.ownerCompanyId||base?.companyId||base?.company||'');
      if(owners.size!==1||!ownerCompanyId||baseOwner!==ownerCompanyId)throw new Error('delivery-destination-contract');
      if(!document||!['مدفوعة','مسددة','مصروف'].includes(document.status)||document.company!==ownerCompanyId||Number(document.amount)<Number(payment.amount))throw new Error('delivery-payment-unverified');
      for(const snap of snaps){if(batchIds.has(snap.id)||fleet.has(state,snap.id))throw new Error('duplicate-asset-id');if(snap.deliveryOrderId&&snap.deliveryOrderId!==input.deliveryId)throw new Error('delivery-order-asset-mismatch');if(facilityOwner?.isAssetFacilityCompatible&&!facilityOwner.isAssetFacilityCompatible(snap,base,state))throw new Error('delivery-facility-asset-incompatible');batchIds.add(snap.id);}
      additions.set(base.id,(additions.get(base.id)||0)+snaps.length);prepared.push({input,delivery,base,snaps,ownerCompanyId});
    }
    const facilityOwner=globalThis.GH_FACILITY_CORE;if(!facilityOwner?.assetCapacity)throw new Error('facility-capacity-owner-missing');
    for(const [baseId,count] of additions){const base=baseById.get(baseId),capacity=facilityOwner.assetCapacity(base);if((occupancy.get(baseId)||0)+count>capacity)throw new Error('delivery-base-full');}
    // Build 358 (million-asset): leased assets are no longer appended to state.leasedAssets, a list nothing reads (a
    // lease is the asset's own ownership field) that every purchase copied whole. Disposal still removes ids from it,
    // so the lists of earlier saves empty out.
    const deliveredRows=[];
    for(const {input,delivery,base,snaps,ownerCompanyId} of prepared)for(const snap of snaps){const delivered={...snap,ownerCompanyId,deliveryOrderId:input.deliveryId,requestRef:delivery.requestRef,paymentRef:delivery.payment.ref,baseFacility:input.baseId,phase:input.phase||'idle',routeId:null,routeSignature:null,routeSlot:null,departureScheduled:false,progress:0,fuel:100,deliveryStatus:'delivered',deliveredDay:input.deliveredDay,deliveredAtSeconds:input.deliveredAtSeconds};deliveredRows.push({asset:delivered,base,deliveryId:input.deliveryId});}
    // Fixed crews are attached before the assets join the fleet; the crew roster is
    // then recounted once from the whole fleet.
    provisionStaffingBatch(state,deliveredRows,{synchronize:false});
    fleet.addMany(state,deliveredRows.map(row=>row.asset));synchronizeCrew(state);return deliveredRows.map(row=>row.asset);
  }
  function releaseStaffing(state,asset,reason){
    const batch=disposalBatches.get(state);if(batch&&!batch.contractById)batch.contractById=new Map(laborLedger(state).employmentContracts.map(row=>[row.id,row]));
    const contractId=asset?.staffing?.contractId,contract=batch?.contractById?(batch.contractById.get(contractId)||null):laborLedger(state).employmentContracts.find(row=>row.id===contractId);
    if(contract&&contract.status==='ساري'){
      // The contract's id list is a value (GH_FLEET_DATA.idLists): the asset leaves through a new list.
      const ids=fleetData().idLists;
      if(ids.is(contract.assetIds)){
        const index=ids.indexOf(contract.assetIds,asset?.id);
        if(index>=0){contract.assetIds=ids.without(contract.assetIds,index);contract.assetCount=ids.length(contract.assetIds);contract.count=Math.max(0,(Number(contract.count)||0)-(Number(asset.staffing?.total)||0));contract.salary=Math.max(0,(Number(contract.salary)||0)-(Number(asset.staffing?.monthlyPayroll)||0));contract.assetId=ids.at(contract.assetIds,0)||null;}
      }
      if(!ids.is(contract.assetIds)||ids.length(contract.assetIds)===0){contract.status='منتهي';contract.endedDay=simDay(state);contract.endReason=reason||'خروج الأصل من الملكية';}
    }
    if(asset?.staffing){asset.staffing.ready=false;asset.staffing.releasedAt=Number(state.simSeconds)||0;}
    if(batch)batch.crewDirty=true;else synchronizeCrew(state);
  }
  // Build 358 (million-asset): runs at every load. A contract's members are looked up by id (the id index), not through
  // a map of every asset; the assets left to staff are found by one pass over the rows (GH_FLEET_DATA.scan) that reads
  // only delivery status, phase and staffing, so only those assets get views (requireFleetAsset has no side effect, so
  // checking it after the cheap skips is the former order's outcome).
  function reconcileStaffing(state,facilityResolver){
    const fleet=fleetData(),ids=fleet.idLists;
    for(const contract of laborLedger(state).employmentContracts){
      if(contract?.automaticAssetStaffing!==true)continue;
      const members=ids.is(contract.assetIds)?ids.toArray(contract.assetIds):[contract.assetId],linked=members.map(id=>fleet.get(state,id)).filter(asset=>asset?.staffing?.contractId===contract.id&&asset.staffing?.mode==='automatic-fixed'&&asset.staffing.ready===true);
      if(linked.length&&ids.is(contract.assetIds)){contract.assetIds=ids.of(linked.map(asset=>asset.id));contract.assetId=linked[0].id;contract.assetCount=linked.length;contract.count=linked.reduce((sum,asset)=>sum+(Number(asset.staffing.total)||0),0);contract.salary=linked.reduce((sum,asset)=>sum+(Number(asset.staffing.monthlyPayroll)||0),0);}
      if(linked.length&&Array.isArray(contract.roles))delete contract.roles;
    }
    const unstaffed=[];
    fleet.scan(state,['deliveryStatus','phase','staffing'],(asset,index)=>{if(asset.deliveryStatus==='pending'||asset.phase==='delivery')return;if(asset.staffing?.mode==='automatic-fixed'&&asset.staffing.ready===true)return;unstaffed.push(index);});
    let provisioned=0;
    for(const index of unstaffed){
      const asset=fleet.viewAt(state,index);if(!asset)continue;
      try{requireFleetAsset(state,asset);}catch(_error){continue;}
      const base=typeof facilityResolver==='function'?facilityResolver(asset.baseFacility):null;
      provisionStaffing(state,asset,base);provisioned++;
    }
    synchronizeCrew(state);
    return provisioned;
  }
  function payrollSummary(state){
    return fleetData().payrollTotals(state);
  }
  function monthlyPayroll(state,company='all'){
    const summary=payrollSummary(state);return company==='all'?Object.values(summary).reduce((sum,row)=>sum+row.amount,0):Number(summary[company]?.amount)||0;
  }
  function headcount(state,company='all'){
    const summary=payrollSummary(state);return company==='all'?Object.values(summary).reduce((sum,row)=>sum+row.headcount,0):Number(summary[company]?.headcount)||0;
  }

  function normalizeAsset(asset,context={}){
    const tpl=context.route;
    // Build 359: a route's speedFactor (the maritime CII plan's slow steaming, GH_GOVERNANCE_CORE.seaSpeedFactor) slows
    // every voyage on it; 1 on any other route.
    const speed=tpl&&Number(tpl.speedFactor)>0&&Number(tpl.speedFactor)<=1?Number(tpl.speedFactor):1;
    if(tpl){
      asset.distanceKm=tpl.distanceKm;asset.tripSeconds=tpl.tripSeconds/speed;asset.effectiveSpeedKmh=tpl.effectiveSpeedKmh*speed;asset.dwellHours=tpl.dwellHours;
      asset.from=asset.reverse?tpl.to:tpl.from;asset.to=asset.reverse?tpl.from:tpl.to;
    }
    if(!asset.phase)asset.phase=asset.routeId?'moving':'idle';
    if(typeof asset.progress!=='number')asset.progress=0;
    if(typeof asset.fuel!=='number')asset.fuel=100;
    if(typeof asset.condition!=='number')asset.condition=100;
    if(!asset.specs){const item=context.catalogItem;if(item)asset.specs=clone(item.specs);}
    if(tpl&&asset.specs){
      const mode=assetMode(asset),rated=mode==='air'?(asset.specs.speedKmh||tpl.effectiveSpeedKmh)*.9:mode==='sea'?(asset.specs.speedKn||tpl.effectiveSpeedKmh/1.852)*1.852*.88:(asset.specs.speedKmh||tpl.effectiveSpeedKmh)*.76;
      asset.effectiveSpeedKmh=Math.max(20,Math.min(rated,tpl.effectiveSpeedKmh*1.08)*speed);asset.tripSeconds=asset.distanceKm/asset.effectiveSpeedKmh*3600;
    }
    return asset;
  }
  function departDraft(asset,route,{crewReady,load}={}){
    if(asset.phase!=='turnaround')throw new Error('asset-not-ready-to-depart');
    if(!route||route.id!==asset.routeId||routeMode(route)!==assetMode(asset)||routeOwnerCompanyId(route)!==assetOwnerCompanyId(asset)||![route.fromFacility,route.toFacility].includes(asset.baseFacility))throw new Error('route-departure-contract');
    if(crewReady!==true||asset.staffing?.ready!==true)throw new Error('asset-fixed-crew-not-ready');
    asset.reverse=asset.baseFacility===route.toFacility;asset.phase='moving';asset.progress=0;asset.dwellRemaining=0;asset.fuel=100;asset.crewBlocked=false;asset.departureScheduled=false;delete asset.departureScheduledAt;delete asset.simulationFault;
    asset.from=asset.reverse?route.to:route.from;asset.to=asset.reverse?route.from:route.to;if(load!=null)asset.load=load;return asset;
  }
  function departBatch(state,rows,routeTable=null){
    if(!Array.isArray(rows)||!rows.length)throw new Error('departure-batch-empty');
    // Drafts: the departures below edit assets in place; commit() applies them. Build 358 (million-asset): only the
    // departing assets get drafts; route occupancy comes from one row pass in row order.
    const fleet=fleetData(),assetById=new Map(),requested=new Set(),prepared=[],
      routeIndex=new Map((state.customRoutes||[]).filter(Boolean).map(route=>[route.id,route])),routeOccupancy=new Map(),routeOwner=new Map();
    for(const p of rows)if(p?.id&&!assetById.has(p.id)){const draft=fleet.draft(state,p.id);if(draft)assetById.set(p.id,draft);}
    for(const p of rows){const route=batchRoute(p,routeTable);if(route?.id&&!routeIndex.has(route.id))routeIndex.set(route.id,route);}
    const affectedRoutes=new Set(rows.map(p=>batchRoute(p,routeTable)?.id));
    // Counts are read below for the affected routes only; any other route needs only whether it has a counted holder
    // and the first one (its place in the occupation order and the reported owner), so it is passed over after it.
    scanRouteHolders(state,null,(asset,owned)=>{
      if(!asset.routeId||asset.releaseExclusiveRouteOnArrival===true&&asset.phase==='moving'||!owned)return;
      routeOccupancy.set(asset.routeId,(routeOccupancy.get(asset.routeId)||0)+1);if(!routeOwner.has(asset.routeId))routeOwner.set(asset.routeId,asset.id);
      if(!affectedRoutes.has(asset.routeId))return fleetData().SKIP_ROUTE;
    });
    for(const [routeId,count] of routeOccupancy){if(!affectedRoutes.has(routeId))continue;
      const route=routeIndex.get(routeId);if(route&&count>routeCapacity(route))throw new Error(`asset-route-capacity:${routeOwner.get(routeId)||routeId}`);
    }
    // Validate duplicate aviation corridors once per occupied route pair rather
    // than rescanning the entire fleet for every departing aircraft.
    const occupiedAirRoutes=[...routeOccupancy.keys()].map(id=>routeIndex.get(id)).filter(route=>routeMode(route)==='air'),signatureCache=new Map();
    const signature=route=>{if(signatureCache.has(route.id))return signatureCache.get(route.id);const value=routeSignature(route);signatureCache.set(route.id,value);return value;};
    // Build 359 (a million assets): each route is compared only with the routes the corridor index names; the first
    // duplicate pair in the former pair order (i, then j) is the one reported.
    {const position=new Map(occupiedAirRoutes.map((route,at)=>[route,at])),corridors=corridorIndex(occupiedAirRoutes);let found=null;
      for(let i=0;i<occupiedAirRoutes.length;i++){
        const a=occupiedAirRoutes[i];
        for(const b of corridors.candidates(a)){const j=position.get(b);if(j===undefined||j<=i||found&&(i>found[0]||i===found[0]&&j>=found[1]))continue;if(!affectedRoutes.has(a.id)&&!affectedRoutes.has(b.id))continue;const sa=signature(a),sb=signature(b);
          if((sa&&sb&&sa===sb)||globalThis.GH_ROUTE_CORE?.corridorMetrics?.(a,b)?.duplicate)found=[i,j];}
        if(found&&found[0]===i)break;
      }
      if(found){const b=occupiedAirRoutes[found[1]];throw new Error(`asset-route-capacity:${routeOwner.get(b.id)||b.id}`);}}
    for(const p of rows){
      const asset=p?.id?assetById.get(p.id):null,route=batchRoute(p,routeTable);if(!asset||requested.has(asset.id))throw new Error('departure-batch-contract');requested.add(asset.id);
      const assetOwner=requireFleetAsset(state,asset),routeOwner=requireFleetRoute(state,route);
      if(asset.phase!=='turnaround'||!route||route.id!==asset.routeId||routeOwner.mode!==assetOwner.mode||routeOwner.companyId!==assetOwner.companyId||![route.fromFacility,route.toFacility].includes(asset.baseFacility)||asset.staffing?.ready!==true)throw new Error('route-departure-contract');
      prepared.push({asset,route,load:p.load,delaySeconds:Math.max(0,Number(p.delaySeconds)||0)});
    }
    for(const row of prepared){
      if(row.delaySeconds>0){row.asset.phase='turnaround';row.asset.progress=0;row.asset.dwellRemaining=row.delaySeconds;row.asset.departureScheduled=true;row.asset.departureScheduledAt=(Number(state.simSeconds)||0)+row.delaySeconds;row.asset.crewBlocked=false;row.asset.from=row.asset.baseFacility===row.route.toFacility?row.route.to:row.route.from;row.asset.to=row.asset.baseFacility===row.route.toFacility?row.route.from:row.route.to;if(row.load!=null)row.asset.load=row.load;}
      else departDraft(row.asset,row.route,{crewReady:true,load:row.load});
    }
    fleet.commit(state,prepared.map(row=>row.asset));
    return prepared.map(row=>fleet.plain(row.asset));
  }
  function validate(ctx,cmd,p={}){
    const state=ctx.state||ctx,asset=p.id?find(state,p.id):null;
    if(['service','assign-route','depart','request-sale','finalize-sale','return-lease','sell','dispose'].includes(cmd)&&!asset)return {ok:false,reason:'asset-not-found'};
    if(cmd==='service'&&asset.phase==='moving')return {ok:false,reason:'asset-moving'};
    return true;
  }
  function execute(ctx,cmd,p={}){
    const state=ctx.state||ctx,asset=p.id?find(state,p.id):null;
    if(cmd==='service'){
      const owner=requireFleetAsset(state,asset),cost=Math.max(0,Number(p.cost)||0),supplier=p.supplier||'شبكة الصيانة المعتمدة';let payment=null;if(cost>0){const finance=globalThis.GH_FINANCE_CORE;if(!finance?.execute)throw new Error('finance-core-missing');payment=finance.execute({state},'pay-by-cheque',{company:owner.companyId,amount:cost,note:p.note||`صيانة ${asset.name}`,beneficiary:supplier,line:'maintenance',taxable:p.taxable!==false,requestRef:`MAINT-${asset.id}-${Math.floor(Number(state.simSeconds)||0)}`});if(!payment?.cheque?.id||payment.cheque.status!=='مصروف')throw new Error('maintenance-cheque-not-cleared');}
      const fleet=fleetData();return fleet.plain(fleet.update(state,asset,{fuel:100,condition:100,crewBlocked:false,simulationFault:undefined,lastMaintenanceAt:Number(state.simSeconds)||0,lastMaintenanceCost:cost,lastMaintenanceSupplier:supplier,lastMaintenanceCheque:payment?.cheque?.id||null,lastMaintenanceInvoice:payment?.invoice?.number||null}));
    }
    if(cmd==='assign-route')return assignRoutesBatch(state,[p])[0];
    if(cmd==='assign-routes-batch')return assignRoutesBatch(state,p.assignments,p.routes);
    if(cmd==='depart')return departBatch(state,[p])[0];
    if(cmd==='depart-batch')return departBatch(state,p.departures,p.routes);
    if(cmd==='request-sale'){
      const fleet=fleetData(),draft=fleet.draft(state,asset);
      draft.salePending=true;draft.saleRequestedAt=Number(state.simSeconds)||0;draft.saleReturnMode=p.returnMode||'owned-center';draft.saleStatus=draft.phase==='moving'?'finish-current-trip':'returning';
      if(draft.phase!=='moving'&&p.clearRoute){draft.routeId=null;draft.routeSignature=null;draft.routeSlot=null;draft.departureScheduled=false;draft.phase=p.phase||'idle';draft.progress=0;draft.dwellRemaining=0;}else if(draft.phase!=='moving'&&p.departSoon)draft.dwellRemaining=0;
      fleet.commit(state,[draft]);return fleet.plain(draft);
    }
    if(cmd==='finalize-sale'){
      if(asset.phase==='moving')throw new Error('asset-moving');const removed=fleetData().released(asset);if(!removeAsset(state,asset))return false;releaseStaffing(state,removed,'بيع الأصل');return removed;
    }
    if(cmd==='return-lease'){
      if(asset.phase==='moving')throw new Error('asset-moving');const owner=requireFleetAsset(state,asset),fee=Math.max(0,Number(p.fee)||0);if(fee&&!globalThis.GH_FINANCE_CORE?.execute)throw new Error('finance-core-missing');
      if(fee)globalThis.GH_FINANCE_CORE.execute({state},'spend',{company:owner.companyId,amount:fee,note:`رسوم إنهاء تأجير ${asset.name}`,method:'تحويل بنكي',taxable:false,line:'capex'});
      removeLeasedAsset(state,asset.id);
      const removed=fleetData().released(asset);if(!removeAsset(state,asset))throw new Error('asset-not-found');releaseStaffing(state,removed,'إعادة أصل مؤجر');return {asset:removed,fee};
    }
    if(cmd==='sell'){
      if(asset.phase==='moving')throw new Error('asset-moving');const owner=requireFleetAsset(state,asset),proceeds=Math.max(0,Number(p.proceeds)||0);if(proceeds<=0)throw new Error('invalid-sale-proceeds');if(!globalThis.GH_FINANCE_CORE?.execute)throw new Error('finance-core-missing');
      globalThis.GH_FINANCE_CORE.execute({state},'credit',{company:owner.companyId,amount:proceeds,note:`بيع أصل ${asset.name}`,method:'تحويل مشتري',taxable:false,counterparty:p.buyer||'مشتري أصل'});
      const removed=fleetData().released(asset);if(!removeAsset(state,asset))throw new Error('asset-not-found');releaseStaffing(state,removed,'بيع الأصل');
      const corporate=globalThis.GH_CORPORATE_CORE;if(!corporate?.execute)throw new Error('corporate-core-missing');corporate.execute({state},'adjust-group-value',{delta:-proceeds*.18});return {asset:removed,proceeds};
    }
    if(cmd==='dispose'){
      if(asset.phase==='moving'||(asset.phase==='turnaround'&&p.atOwnedCenter===false&&asset.routeId)){
        const fleet=fleetData(),draft=fleet.draft(state,asset);
        draft.salePending=true;draft.saleRequestedAt=Number(state.simSeconds)||0;draft.saleReturnMode='owned-center';draft.saleStatus=draft.phase==='moving'?'finish-current-trip':'returning';if(draft.phase!=='moving')draft.dwellRemaining=0;fleet.commit(state,[draft]);return {status:'scheduled',asset:fleet.plain(draft),proceeds:0,fee:0};
      }
      if(asset.ownership==='lease'){const out=execute(ctx,'return-lease',{id:asset.id,fee:Math.max(0,Number(p.fee)||0)});return {status:'returned',asset:out.asset,fee:out.fee,proceeds:0};}
      const out=execute(ctx,'sell',{id:asset.id,proceeds:p.proceeds,buyer:p.buyer});return {status:'sold',asset:out.asset,proceeds:out.proceeds,fee:0};
    }
    if(cmd==='record-delivery')return recordDeliveryBatch(state,[p])[0];
    if(cmd==='record-delivery-batch')return recordDeliveryBatch(state,p.deliveries);
    if(cmd==='reconcile-staffing')return reconcileStaffing(state,p.facilityResolver);
    throw new Error(`Unknown fleet command: ${cmd}`);
  }
  const API={VERSION,purchaseCatalogs,ROLE_DEFAULTS,ROUTE_FLEET_CAPACITY,ROUTE_MAX_FLEET_CAPACITY,requiredRouteCapacity,ROUTE_DEPARTURE_INTERVAL_SECONDS,AUTOMATIC_ROUTE_DENSITY,assetMode,assetOwnerCompanyId,routeMode,routeOwnerCompanyId,requireFleetAsset,requireFleetRoute,normalizeAsset,departDraft,departureDelay,routeCapacity,automaticRouteTargetLoad,routeSignature,routeConflict,routeConflictContext,routeConflicts,assignRoutesBatch,departBatch,ensure,find,validate,execute,staffingPlan,provisionStaffing,reconcileStaffing,synchronizeCrew,payrollSummary,monthlyPayroll,headcount,recordDeliveryBatch,withDisposalBatch};
  globalThis.GH_FLEET_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('fleet',API);if(globalThis.window&&window!==globalThis)window.GH_FLEET_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
