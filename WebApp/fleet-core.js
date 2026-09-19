(()=>{
  'use strict';
  const VERSION='3.0.0';
  const ROLE_DEFAULTS=Object.freeze({
    pilots:{name:'الطيارون',dailyRate:300},
    cabin:{name:'طاقم الضيافة',dailyRate:375},
    aeng:{name:'مهندسو الطيران',dailyRate:375},
    captains:{name:'قباطنة السفن',dailyRate:320},
    sailors:{name:'بحارة وملاحون',dailyRate:200},
    seng:{name:'مهندسو السفن',dailyRate:290},
    drivers:{name:'سائقو الشاحنات',dailyRate:150},
    mech:{name:'فنيو الصيانة',dailyRate:170}
  });
  // Every transport mode shares canonical route geometry across a bounded fleet.
  // Aircraft preserve separation through unique route slots and staggered
  // departures rather than persisting one heavy route per aircraft. This keeps
  // large fleets below route/save limits while retaining explicit capacity.
  const ROUTE_FLEET_CAPACITY=Object.freeze({air:24,sea:24,road:64});
  const ROUTE_DEPARTURE_INTERVAL_SECONDS=Object.freeze({air:180,sea:60,road:15});
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
  function nextId(state,prefix){
    state.sequences=state.sequences&&typeof state.sequences==='object'?state.sequences:{};
    const key=`fleetCore_${prefix}`;
    state.sequences[key]=(Number(state.sequences[key])||0)+1;
    return `${prefix}-${String(state.sequences[key]).padStart(7,'0')}`;
  }
  function ensure(state){state.assets=Array.isArray(state.assets)?state.assets:[];return state.assets;}
  function find(state,id){return ensure(state).find(asset=>asset.id===id)||null;}
  function routeSignature(route){
    if(!globalThis.GH_ROUTE_CORE?.signature)throw new Error('route-owner-unavailable');
    return globalThis.GH_ROUTE_CORE.signature(route);
  }
  function routeCapacity(routeOrType){
    const type=typeof routeOrType==='string'?routeOrType:routeOrType?.type;
    return ROUTE_FLEET_CAPACITY[type]||1;
  }
  function automaticRouteTargetLoad(type,fleetCount,maxRoutes=Infinity){
    const hard=routeCapacity(type),count=Math.max(0,Math.floor(Number(fleetCount)||0));
    if(count<=1)return 1;
    const tiers=AUTOMATIC_ROUTE_DENSITY[type]||[{maxFleet:Infinity,target:hard}],preferred=Math.min(hard,(tiers.find(row=>count<=row.maxFleet)||tiers.at(-1)).target);
    const minimumRoutes=Math.ceil(count/hard),preferredRoutes=Math.ceil(count/preferred),limit=Number.isFinite(Number(maxRoutes))?Math.max(1,Math.floor(Number(maxRoutes))):preferredRoutes;
    const routeCount=Math.max(minimumRoutes,Math.min(preferredRoutes,Math.max(minimumRoutes,limit)));
    return Math.min(hard,Math.max(1,Math.ceil(count/routeCount)));
  }
  function departureDelay(asset){
    const slot=Math.max(0,Math.floor(Number(asset?.routeSlot)||0));
    return slot*(ROUTE_DEPARTURE_INTERVAL_SECONDS[asset?.type]||0);
  }
  function routeConflict(state,assetId,routeId,route){
    if(!route?.type||!routeId)return null;
    const sameRouteUsers=ensure(state).filter(other=>other.id!==assetId&&other.type===route.type&&other.routeId===routeId);
    if(sameRouteUsers.length>=routeCapacity(route))return sameRouteUsers[0]||null;
    if(route.type!=='air')return null;
    const signature=routeSignature(route),routeIndex=new Map((state.customRoutes||[]).filter(Boolean).map(row=>[row.id,row]));
    return ensure(state).find(other=>{
      if(other.id===assetId||!other.routeId||other.type!=='air'||other.routeId===routeId)return false;
      const registered=routeIndex.get(other.routeId),otherSignature=registered?routeSignature(registered):other.routeSignature;
      if(signature&&otherSignature&&signature===otherSignature)return true;
      return Boolean(registered&&globalThis.GH_ROUTE_CORE?.corridorMetrics?.(registered,route)?.duplicate);
    })||null;
  }
  function applyRouteAssignment(asset,p,slot){
    asset.routeId=p.routeId||null;asset.routeSignature=routeSignature(p.route);asset.releaseExclusiveRouteOnArrival=false;asset.baseFacility=p.baseFacility??asset.baseFacility;asset.phase=p.phase||'turnaround';asset.progress=0;asset.dwellRemaining=0;asset.crewBlocked=false;asset.routeSlot=slot;asset.departureScheduled=false;delete asset.departureScheduledAt;delete asset.simulationFault;
    const reverse=asset.baseFacility===p.route.toFacility;asset.reverse=reverse;asset.from=reverse?p.route.to:p.route.from;asset.to=reverse?p.route.from:p.route.to;return asset;
  }
  function assignRoutesBatch(state,rows){
    if(!Array.isArray(rows)||!rows.length)throw new Error('route-assignment-batch-empty');
    const assets=ensure(state),assetById=new Map(assets.map(asset=>[asset.id,asset])),requested=new Set(),batchIds=new Set(rows.map(row=>row?.id).filter(Boolean));
    if(batchIds.size!==rows.length)throw new Error('route-assignment-batch-duplicate');
    const fixedAssets=assets.filter(asset=>!batchIds.has(asset.id)),prepared=[],slotUsage=new Map();
    for(const other of fixedAssets){
      if(!other?.routeId||!['air','sea','road'].includes(other.type))continue;
      let used=slotUsage.get(other.routeId);if(!used){used=new Set();slotUsage.set(other.routeId,used);}
      const preferred=Number.isInteger(other.routeSlot)&&other.routeSlot>=0?other.routeSlot:null;
      if(preferred!=null&&!used.has(preferred))used.add(preferred);else{let slot=0;while(used.has(slot))slot++;used.add(slot);}
    }

    // Air corridor conflict validation is batch-indexed. The former path rebuilt a
    // shadow state and rescanned every aircraft for every assignment (O(n²)),
    // which could block WebKit for several seconds with 300 aircraft. Capacity
    // remains enforced by slotUsage below; this index only guards duplicate
    // geometry across different route IDs and preserves the same invariant.
    const airRouteIndex=new Map((state.customRoutes||[]).filter(route=>route?.type==='air').map(route=>[route.id,route])),
      airOccupiedByRoute=new Map(),airSignatureCache=new Map(),airValidatedRoutes=new Set();
    for(const other of fixedAssets)if(other?.type==='air'&&other.routeId&&!airOccupiedByRoute.has(other.routeId))airOccupiedByRoute.set(other.routeId,other.id);
    const airSignature=route=>{
      if(!route)return '';
      if(airSignatureCache.has(route.id))return airSignatureCache.get(route.id);
      const signature=routeSignature(route);airSignatureCache.set(route.id,signature);return signature;
    };
    const validateAirRoute=(route,assetId)=>{
      if(airValidatedRoutes.has(route.id))return;
      airRouteIndex.set(route.id,route);const signature=airSignature(route);
      for(const [otherRouteId,ownerId] of airOccupiedByRoute){
        if(otherRouteId===route.id)continue;
        const otherRoute=airRouteIndex.get(otherRouteId);if(!otherRoute)continue;
        const otherSignature=airSignature(otherRoute);
        if((signature&&otherSignature&&signature===otherSignature)||globalThis.GH_ROUTE_CORE?.corridorMetrics?.(otherRoute,route)?.duplicate)throw new Error(`asset-route-capacity-or-corridor:${ownerId}`);
      }
      airValidatedRoutes.add(route.id);if(!airOccupiedByRoute.has(route.id))airOccupiedByRoute.set(route.id,assetId);
    };

    for(const p of rows){
      const asset=p?.id?assetById.get(p.id):null,route=p?.route;if(!asset||requested.has(asset.id))throw new Error('route-assignment-contract');requested.add(asset.id);
      if(!route||route.id!==p.routeId||route.type!==asset.type||(route.company||route.type)!==asset.type||asset.phase==='moving'||asset.salePending||asset.deliveryStatus==='pending'||(p.phase!=null&&p.phase!=='turnaround')||(p.baseFacility!=null&&p.baseFacility!==asset.baseFacility)||![route.fromFacility,route.toFacility].includes(asset.baseFacility))throw new Error('route-assignment-contract');
      if(asset.type==='air')validateAirRoute(route,asset.id);
      let used=slotUsage.get(p.routeId);if(!used){used=new Set();slotUsage.set(p.routeId,used);}
      let slot=0;const preferred=asset.routeId===p.routeId&&Number.isInteger(asset.routeSlot)&&asset.routeSlot>=0?asset.routeSlot:null;
      if(preferred!=null&&!used.has(preferred))slot=preferred;else{while(used.has(slot))slot++;}
      if(slot>=routeCapacity(route))throw new Error(`asset-route-capacity:${p.routeId}`);used.add(slot);
      prepared.push({asset,input:p,slot});
    }
    for(const row of prepared)applyRouteAssignment(row.asset,row.input,row.slot);
    return prepared.map(row=>row.asset);
  }
  function crewRole(id){const fixed=ROLE_DEFAULTS[id]||{name:id,dailyRate:0};return {id,name:fixed.name,dailyRate:fixed.dailyRate};}
  function staffingPlan(asset){
    let counts={};
    if(asset?.type==='air'){
      counts={pilots:4,cabin:6,aeng:2};
    }else if(asset?.type==='sea'){
      counts={captains:2,sailors:14,seng:4};
    }else if(asset?.type==='road'){
      counts={drivers:2,mech:1};
    }else{
      throw new Error('asset-staffing-type-unsupported');
    }
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
    for(const asset of ensure(state)){
      if(asset.staffing?.mode!=='automatic-fixed'||asset.staffing.ready!==true)continue;
      for(const role of asset.staffing.roles||[]){const saved=state.crew.find(row=>row.id===role.id);if(saved)saved.count=(Number(saved.count)||0)+(Number(role.count)||0);}
    }
    return state.crew;
  }
  function provisionStaffing(state,asset,base){
    if(asset.staffing?.mode==='automatic-fixed'&&asset.staffing.ready===true){synchronizeCrew(state);return asset.staffing;}
    const plan=staffingPlan(asset,state),labor=laborLedger(state),contractId=nextId(state,'EMP-AUTO');
    const center=base?.name||asset.baseLocation||asset.baseFacility||'المركز التشغيلي';
    const contract={
      id:contractId,company:asset.type,assetId:asset.id,name:`طاقم ثابت · ${asset.name}`,
      role:'طاقم تشغيلي مرتبط بالأصل',count:plan.total,center,salary:plan.monthlyPayroll,
      startDay:simDay(state),termMonths:1200,status:'ساري',source:'توظيف آلي ثابت عند شراء الأصل',
      automaticAssetStaffing:true,permanent:true,roles:clone(plan.roles)
    };
    labor.employmentContracts.unshift(contract);
    labor.hiringLog.unshift({id:nextId(state,'HR-AUTO'),at:Number(state.simSeconds)||0,company:asset.type,source:'توظيف أصل آلي ثابت',assetId:asset.id,total:plan.total,monthlyPayroll:plan.monthlyPayroll,coverageBefore:100,coverageAfter:100});
    labor.hiringLog=labor.hiringLog.slice(0,200);
    asset.staffing={...plan,contractId,provisionedAt:Number(state.simSeconds)||0,center};
    asset.crewBlocked=false;
    synchronizeCrew(state);
    return asset.staffing;
  }
  // Large deliveries must retain one staffing contract per asset, but they must
  // not rescan the entire fleet after every single contract. This batch helper
  // is deliberately internal to Fleet Core so procurement and UI never own
  // staffing or asset creation.
  function provisionStaffingBatch(state,rows){
    const labor=laborLedger(state),contracts=[],hiring=[];
    for(const row of rows){
      const asset=row?.asset,base=row?.base;if(!asset)continue;
      if(asset.staffing?.mode==='automatic-fixed'&&asset.staffing.ready===true)continue;
      const plan=staffingPlan(asset,state),contractId=nextId(state,'EMP-AUTO'),center=base?.name||asset.baseLocation||asset.baseFacility||'المركز التشغيلي';
      contracts.push({id:contractId,company:asset.type,assetId:asset.id,name:`طاقم ثابت · ${asset.name}`,role:'طاقم تشغيلي مرتبط بالأصل',count:plan.total,center,salary:plan.monthlyPayroll,startDay:simDay(state),termMonths:1200,status:'ساري',source:'توظيف آلي ثابت عند شراء الأصل',automaticAssetStaffing:true,permanent:true,roles:clone(plan.roles)});
      hiring.push({id:nextId(state,'HR-AUTO'),at:Number(state.simSeconds)||0,company:asset.type,source:'توظيف أصل آلي ثابت',assetId:asset.id,total:plan.total,monthlyPayroll:plan.monthlyPayroll,coverageBefore:100,coverageAfter:100});
      asset.staffing={...plan,contractId,provisionedAt:Number(state.simSeconds)||0,center};asset.crewBlocked=false;
    }
    if(contracts.length)labor.employmentContracts.unshift(...contracts.reverse());
    if(hiring.length){labor.hiringLog.unshift(...hiring.reverse());labor.hiringLog=labor.hiringLog.slice(0,200);}
    synchronizeCrew(state);return contracts.length;
  }
  function recordDeliveryBatch(state,rows){
    if(!Array.isArray(rows)||!rows.length)throw new Error('delivery-batch-empty');
    const deliveries=state.realism?.procurement?.deliveries;if(!Array.isArray(deliveries))throw new Error('delivery-store-unavailable');
    const deliveryById=new Map(deliveries.map(row=>[row.id,row])),baseById=new Map([...(state.globalBases||[]),...(state.customHubs||[])].map(base=>[base.id,base])),invoiceByNumber=new Map((state.finance?.invoices||[]).map(row=>[row.number,row])),chequeById=new Map((state.finance?.cheques||[]).map(row=>[row.id,row])),assetIds=new Set((state.assets||[]).map(asset=>asset.id)),occupancy=new Map(),additions=new Map(),prepared=[];
    for(const asset of state.assets||[])occupancy.set(asset.baseFacility,(occupancy.get(asset.baseFacility)||0)+1);
    const requested=new Set();
    for(const input of rows){
      if(!input?.asset||!input.baseId||!input.deliveryId||requested.has(input.deliveryId))throw new Error('delivery-contract');requested.add(input.deliveryId);
      const delivery=deliveryById.get(input.deliveryId),base=baseById.get(input.baseId),snap=input.asset,payment=delivery?.payment,document=payment?.kind==='invoice'?invoiceByNumber.get(payment.ref):chequeById.get(payment?.ref);
      if(!delivery||delivery.status!=='pending'||delivery.asset?.id!==snap.id||delivery.baseId!==input.baseId||!base?.owned||base.company!==snap.type)throw new Error('delivery-destination-contract');
      if(!document||!['مدفوعة','مسددة','مصروف'].includes(document.status)||document.company!==snap.type||Number(document.amount)<Number(payment.amount))throw new Error('delivery-payment-unverified');
      if(assetIds.has(snap.id))throw new Error('duplicate-asset-id');assetIds.add(snap.id);additions.set(base.id,(additions.get(base.id)||0)+1);prepared.push({input,delivery,base,snap});
    }
    const facilityOwner=globalThis.GH_FACILITY_CORE;if(!facilityOwner?.assetCapacity)throw new Error('facility-capacity-owner-missing');
    for(const [baseId,count] of additions){const base=baseById.get(baseId),capacity=facilityOwner.assetCapacity(base);if((occupancy.get(baseId)||0)+count>capacity)throw new Error('delivery-base-full');}
    const deliveredRows=[],leased=new Set(Array.isArray(state.leasedAssets)?state.leasedAssets:[]);
    for(const {input,delivery,base,snap} of prepared){const delivered={...snap,deliveryOrderId:input.deliveryId,requestRef:delivery.requestRef,paymentRef:delivery.payment.ref,baseFacility:input.baseId,phase:input.phase||'idle',routeId:null,routeSignature:null,routeSlot:null,departureScheduled:false,progress:0,fuel:100,deliveryStatus:'delivered',deliveredDay:input.deliveredDay,deliveredAtSeconds:input.deliveredAtSeconds};state.assets.push(delivered);deliveredRows.push({asset:delivered,base});if(delivered.ownership==='lease')leased.add(delivered.id);}
    state.leasedAssets=[...leased];provisionStaffingBatch(state,deliveredRows);return deliveredRows.map(row=>row.asset);
  }
  function releaseStaffing(state,asset,reason){
    const contract=laborLedger(state).employmentContracts.find(row=>row.id===asset?.staffing?.contractId);
    if(contract&&contract.status==='ساري'){contract.status='منتهي';contract.endedDay=simDay(state);contract.endReason=reason||'خروج الأصل من الملكية';}
    if(asset?.staffing){asset.staffing.ready=false;asset.staffing.releasedAt=Number(state.simSeconds)||0;}
    synchronizeCrew(state);
  }
  function reconcileStaffing(state,facilityResolver){
    let provisioned=0;
    for(const asset of ensure(state)){
      if(!['air','sea','road'].includes(asset.type))continue;
      if(asset.deliveryStatus==='pending'||asset.phase==='delivery')continue;
      if(asset.staffing?.mode==='automatic-fixed'&&asset.staffing.ready===true)continue;
      const base=typeof facilityResolver==='function'?facilityResolver(asset.baseFacility):null;
      provisionStaffing(state,asset,base);provisioned++;
    }
    synchronizeCrew(state);
    return provisioned;
  }
  function monthlyPayroll(state,company='all'){
    return ensure(state).filter(asset=>asset.staffing?.ready===true&&(company==='all'||asset.type===company)).reduce((sum,asset)=>sum+(Number(asset.staffing.monthlyPayroll)||0),0);
  }
  function headcount(state,company='all'){
    return ensure(state).filter(asset=>asset.staffing?.ready===true&&(company==='all'||asset.type===company)).reduce((sum,asset)=>sum+(Number(asset.staffing.total)||0),0);
  }

  function normalizeAsset(asset,context={}){
    const tpl=context.route;
    if(tpl){
      asset.distanceKm=tpl.distanceKm;asset.tripSeconds=tpl.tripSeconds;asset.effectiveSpeedKmh=tpl.effectiveSpeedKmh;asset.dwellHours=tpl.dwellHours;
      asset.from=asset.reverse?tpl.to:tpl.from;asset.to=asset.reverse?tpl.from:tpl.to;
    }
    if(!asset.phase)asset.phase=asset.routeId?'moving':'idle';
    if(typeof asset.progress!=='number')asset.progress=0;
    if(typeof asset.fuel!=='number')asset.fuel=100;
    if(typeof asset.condition!=='number')asset.condition=100;
    if(!asset.specs){const item=context.catalogItem;if(item)asset.specs=clone(item.specs);}
    if(tpl&&asset.specs){
      const rated=asset.type==='air'?(asset.specs.speedKmh||tpl.effectiveSpeedKmh)*.9:asset.type==='sea'?(asset.specs.speedKn||tpl.effectiveSpeedKmh/1.852)*1.852*.88:(asset.specs.speedKmh||tpl.effectiveSpeedKmh)*.76;
      asset.effectiveSpeedKmh=Math.max(20,Math.min(rated,tpl.effectiveSpeedKmh*1.08));asset.tripSeconds=asset.distanceKm/asset.effectiveSpeedKmh*3600;
    }
    return asset;
  }
  function departDraft(asset,route,{crewReady,load}={}){
    if(asset.phase!=='turnaround')throw new Error('asset-not-ready-to-depart');
    if(!route||route.id!==asset.routeId||route.type!==asset.type||![route.fromFacility,route.toFacility].includes(asset.baseFacility))throw new Error('route-departure-contract');
    if(crewReady!==true||asset.staffing?.ready!==true)throw new Error('asset-fixed-crew-not-ready');
    asset.reverse=asset.baseFacility===route.toFacility;asset.phase='moving';asset.progress=0;asset.dwellRemaining=0;asset.fuel=100;asset.crewBlocked=false;asset.departureScheduled=false;delete asset.departureScheduledAt;delete asset.simulationFault;
    asset.from=asset.reverse?route.to:route.from;asset.to=asset.reverse?route.from:route.to;if(load!=null)asset.load=load;return asset;
  }
  function departBatch(state,rows){
    if(!Array.isArray(rows)||!rows.length)throw new Error('departure-batch-empty');
    const assets=ensure(state),assetById=new Map(assets.map(asset=>[asset.id,asset])),requested=new Set(),prepared=[],
      routeIndex=new Map((state.customRoutes||[]).filter(Boolean).map(route=>[route.id,route])),routeOccupancy=new Map(),routeOwner=new Map();
    for(const asset of assets){
      if(!asset?.routeId||!['air','sea','road'].includes(asset.type))continue;
      routeOccupancy.set(asset.routeId,(routeOccupancy.get(asset.routeId)||0)+1);if(!routeOwner.has(asset.routeId))routeOwner.set(asset.routeId,asset.id);
    }
    for(const p of rows)if(p?.route?.id&&!routeIndex.has(p.route.id))routeIndex.set(p.route.id,p.route);
    for(const [routeId,count] of routeOccupancy){
      const route=routeIndex.get(routeId);if(route&&count>routeCapacity(route))throw new Error(`asset-route-capacity:${routeOwner.get(routeId)||routeId}`);
    }
    // Validate duplicate aviation corridors once per occupied route pair rather
    // than rescanning the entire fleet for every departing aircraft.
    const occupiedAirRoutes=[...routeOccupancy.keys()].map(id=>routeIndex.get(id)).filter(route=>route?.type==='air'),signatureCache=new Map();
    const signature=route=>{if(signatureCache.has(route.id))return signatureCache.get(route.id);const value=routeSignature(route);signatureCache.set(route.id,value);return value;};
    for(let i=0;i<occupiedAirRoutes.length;i++)for(let j=i+1;j<occupiedAirRoutes.length;j++){
      const a=occupiedAirRoutes[i],b=occupiedAirRoutes[j],sa=signature(a),sb=signature(b);
      if((sa&&sb&&sa===sb)||globalThis.GH_ROUTE_CORE?.corridorMetrics?.(a,b)?.duplicate)throw new Error(`asset-route-capacity:${routeOwner.get(b.id)||b.id}`);
    }
    for(const p of rows){
      const asset=p?.id?assetById.get(p.id):null,route=p?.route;if(!asset||requested.has(asset.id))throw new Error('departure-batch-contract');requested.add(asset.id);
      if(asset.phase!=='turnaround'||!route||route.id!==asset.routeId||route.type!==asset.type||![route.fromFacility,route.toFacility].includes(asset.baseFacility)||asset.staffing?.ready!==true)throw new Error('route-departure-contract');
      prepared.push({asset,route,load:p.load,delaySeconds:Math.max(0,Number(p.delaySeconds)||0)});
    }
    for(const row of prepared){
      if(row.delaySeconds>0){row.asset.phase='turnaround';row.asset.progress=0;row.asset.dwellRemaining=row.delaySeconds;row.asset.departureScheduled=true;row.asset.departureScheduledAt=(Number(state.simSeconds)||0)+row.delaySeconds;row.asset.crewBlocked=false;row.asset.from=row.asset.baseFacility===row.route.toFacility?row.route.to:row.route.from;row.asset.to=row.asset.baseFacility===row.route.toFacility?row.route.from:row.route.to;if(row.load!=null)row.asset.load=row.load;}
      else departDraft(row.asset,row.route,{crewReady:true,load:row.load});
    }
    return prepared.map(row=>row.asset);
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
      const cost=Math.max(0,Number(p.cost)||0),supplier=p.supplier||'شبكة الصيانة المعتمدة';let payment=null;if(cost>0){const finance=globalThis.GH_FINANCE_CORE;if(!finance?.execute)throw new Error('finance-core-missing');payment=finance.execute({state},'pay-by-cheque',{company:asset.type,amount:cost,note:p.note||`صيانة ${asset.name}`,beneficiary:supplier,line:'maintenance',taxable:p.taxable!==false,requestRef:`MAINT-${asset.id}-${Math.floor(Number(state.simSeconds)||0)}`});if(!payment?.cheque?.id||payment.cheque.status!=='مصروف')throw new Error('maintenance-cheque-not-cleared');}
      asset.fuel=100;asset.condition=100;asset.crewBlocked=false;delete asset.simulationFault;asset.lastMaintenanceAt=Number(state.simSeconds)||0;asset.lastMaintenanceCost=cost;asset.lastMaintenanceSupplier=supplier;asset.lastMaintenanceCheque=payment?.cheque?.id||null;asset.lastMaintenanceInvoice=payment?.invoice?.number||null;return asset;
    }
    if(cmd==='assign-route')return assignRoutesBatch(state,[p])[0];
    if(cmd==='assign-routes-batch')return assignRoutesBatch(state,p.assignments);
    if(cmd==='depart')return departBatch(state,[p])[0];
    if(cmd==='depart-batch')return departBatch(state,p.departures);
    if(cmd==='request-sale'){
      asset.salePending=true;asset.saleRequestedAt=Number(state.simSeconds)||0;asset.saleReturnMode=p.returnMode||'owned-center';asset.saleStatus=asset.phase==='moving'?'finish-current-trip':'returning';
      if(asset.phase!=='moving'&&p.clearRoute){asset.routeId=null;asset.routeSignature=null;asset.routeSlot=null;asset.departureScheduled=false;asset.phase=p.phase||'idle';asset.progress=0;asset.dwellRemaining=0;}else if(asset.phase!=='moving'&&p.departSoon)asset.dwellRemaining=0;
      return asset;
    }
    if(cmd==='finalize-sale'){
      if(asset.phase==='moving')throw new Error('asset-moving');const idx=state.assets.findIndex(row=>row.id===asset.id);if(idx<0)return false;state.assets.splice(idx,1);releaseStaffing(state,asset,'بيع الأصل');return asset;
    }
    if(cmd==='return-lease'){
      if(asset.phase==='moving')throw new Error('asset-moving');const fee=Math.max(0,Number(p.fee)||0);if(fee&&!globalThis.GH_FINANCE_CORE?.execute)throw new Error('finance-core-missing');
      if(fee)globalThis.GH_FINANCE_CORE.execute({state},'spend',{company:asset.type,amount:fee,note:`رسوم إنهاء تأجير ${asset.name}`,method:'تحويل بنكي',taxable:false,line:'capex'});
      state.leasedAssets=Array.isArray(state.leasedAssets)?state.leasedAssets:[];state.leasedAssets=state.leasedAssets.filter(id=>id!==asset.id);
      const idx=state.assets.findIndex(row=>row.id===asset.id);if(idx<0)throw new Error('asset-not-found');state.assets.splice(idx,1);releaseStaffing(state,asset,'إعادة أصل مؤجر');return {asset,fee};
    }
    if(cmd==='sell'){
      if(asset.phase==='moving')throw new Error('asset-moving');const proceeds=Math.max(0,Number(p.proceeds)||0);if(proceeds<=0)throw new Error('invalid-sale-proceeds');if(!globalThis.GH_FINANCE_CORE?.execute)throw new Error('finance-core-missing');
      globalThis.GH_FINANCE_CORE.execute({state},'credit',{company:asset.type,amount:proceeds,note:`بيع أصل ${asset.name}`,method:'تحويل مشتري',taxable:false,counterparty:p.buyer||'مشتري أصل'});
      const idx=state.assets.findIndex(row=>row.id===asset.id);if(idx<0)throw new Error('asset-not-found');state.assets.splice(idx,1);releaseStaffing(state,asset,'بيع الأصل');
      const corporate=globalThis.GH_CORPORATE_CORE;if(!corporate?.execute)throw new Error('corporate-core-missing');corporate.execute({state},'adjust-group-value',{delta:-proceeds*.18});return {asset,proceeds};
    }
    if(cmd==='dispose'){
      if(asset.phase==='moving'||(asset.phase==='turnaround'&&p.atOwnedCenter===false&&asset.routeId)){
        asset.salePending=true;asset.saleRequestedAt=Number(state.simSeconds)||0;asset.saleReturnMode='owned-center';asset.saleStatus=asset.phase==='moving'?'finish-current-trip':'returning';if(asset.phase!=='moving')asset.dwellRemaining=0;return {status:'scheduled',asset,proceeds:0,fee:0};
      }
      if(asset.ownership==='lease'){const out=execute(ctx,'return-lease',{id:asset.id,fee:Math.max(0,Number(p.fee)||0)});return {status:'returned',asset:out.asset,fee:out.fee,proceeds:0};}
      const out=execute(ctx,'sell',{id:asset.id,proceeds:p.proceeds,buyer:p.buyer});return {status:'sold',asset:out.asset,proceeds:out.proceeds,fee:0};
    }
    if(cmd==='record-delivery')return recordDeliveryBatch(state,[p])[0];
    if(cmd==='record-delivery-batch')return recordDeliveryBatch(state,p.deliveries);
    if(cmd==='reconcile-staffing')return reconcileStaffing(state,p.facilityResolver);
    throw new Error(`Unknown fleet command: ${cmd}`);
  }
  const API={VERSION,ROLE_DEFAULTS,ROUTE_FLEET_CAPACITY,ROUTE_DEPARTURE_INTERVAL_SECONDS,AUTOMATIC_ROUTE_DENSITY,normalizeAsset,departDraft,departureDelay,routeCapacity,automaticRouteTargetLoad,routeSignature,routeConflict,assignRoutesBatch,departBatch,ensure,find,validate,execute,staffingPlan,provisionStaffing,reconcileStaffing,synchronizeCrew,monthlyPayroll,headcount,recordDeliveryBatch};
  globalThis.GH_FLEET_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('fleet',API);if(globalThis.window&&window!==globalThis)window.GH_FLEET_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
