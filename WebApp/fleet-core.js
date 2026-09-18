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
  function routeConflict(state,assetId,routeId,route){
    const signature=routeSignature(route),routeIndex=new Map((state.customRoutes||[]).filter(Boolean).map(row=>[row.id,row]));
    return ensure(state).find(other=>{
      if(other.id===assetId||!other.routeId||other.type!==route?.type)return false;
      if(other.routeId===routeId)return true;
      const registered=routeIndex.get(other.routeId),otherSignature=registered?routeSignature(registered):other.routeSignature;
      if(signature&&otherSignature&&signature===otherSignature)return true;
      return Boolean(registered&&globalThis.GH_ROUTE_CORE?.corridorMetrics?.(registered,route)?.duplicate);
    })||null;
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
    for(const {input,delivery,base,snap} of prepared){const delivered={...snap,deliveryOrderId:input.deliveryId,requestRef:delivery.requestRef,paymentRef:delivery.payment.ref,baseFacility:input.baseId,phase:input.phase||'idle',routeId:null,routeSignature:null,progress:0,fuel:100,deliveryStatus:'delivered',deliveredDay:input.deliveredDay,deliveredAtSeconds:input.deliveredAtSeconds};state.assets.push(delivered);deliveredRows.push({asset:delivered,base});if(delivered.ownership==='lease')leased.add(delivered.id);}
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
    asset.reverse=asset.baseFacility===route.toFacility;asset.phase='moving';asset.progress=0;asset.dwellRemaining=0;asset.fuel=100;asset.crewBlocked=false;delete asset.simulationFault;
    asset.from=asset.reverse?route.to:route.from;asset.to=asset.reverse?route.from:route.to;if(load!=null)asset.load=load;return asset;
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
    if(cmd==='assign-route'){
      if(!p.route||p.route.id!==p.routeId||p.route.type!==asset.type||(p.route.company||p.route.type)!==asset.type||asset.phase==='moving'||(p.phase!=null&&p.phase!=='turnaround')||(p.baseFacility!=null&&p.baseFacility!==asset.baseFacility)||![p.route.fromFacility,p.route.toFacility].includes(asset.baseFacility))throw new Error('route-assignment-contract');
      const conflict=routeConflict(state,asset.id,p.routeId,p.route);if(conflict)throw new Error(`asset-route-exclusive:${conflict.id}`);
      asset.routeId=p.routeId||null;asset.routeSignature=routeSignature(p.route);asset.releaseExclusiveRouteOnArrival=false;asset.baseFacility=p.baseFacility??asset.baseFacility;asset.phase=p.phase||'turnaround';asset.progress=0;asset.dwellRemaining=0;asset.crewBlocked=false;delete asset.simulationFault;
      const reverse=asset.baseFacility===p.route.toFacility;asset.reverse=reverse;asset.from=reverse?p.route.to:p.route.from;asset.to=reverse?p.route.from:p.route.to;return asset;
    }
    if(cmd==='depart'){const conflict=routeConflict(state,asset.id,asset.routeId,p.route);if(conflict)throw new Error(`asset-route-exclusive:${conflict.id}`);return departDraft(asset,p.route,{crewReady:asset.staffing?.ready===true,load:p.load});}
    if(cmd==='request-sale'){
      asset.salePending=true;asset.saleRequestedAt=Number(state.simSeconds)||0;asset.saleReturnMode=p.returnMode||'owned-center';asset.saleStatus=asset.phase==='moving'?'finish-current-trip':'returning';
      if(asset.phase!=='moving'&&p.clearRoute){asset.routeId=null;asset.routeSignature=null;asset.phase=p.phase||'idle';asset.progress=0;asset.dwellRemaining=0;}else if(asset.phase!=='moving'&&p.departSoon)asset.dwellRemaining=0;
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
  const API={VERSION,ROLE_DEFAULTS,normalizeAsset,departDraft,routeSignature,routeConflict,ensure,find,validate,execute,staffingPlan,provisionStaffing,reconcileStaffing,synchronizeCrew,monthlyPayroll,headcount,recordDeliveryBatch};
  globalThis.GH_FLEET_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('fleet',API);if(globalThis.window&&window!==globalThis)window.GH_FLEET_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
