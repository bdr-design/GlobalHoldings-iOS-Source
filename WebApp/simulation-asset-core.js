'use strict';

((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_SIMULATION_ASSET_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const VERSION='GH-SIMULATION-ASSET-CORE-340.1.0';
  const MAX_BATCH_ITEMS=256,MAX_TEXT=512;
  const WRITE_FIELDS=Object.freeze(['phase','dwellRemaining','reverse','progress','fuel','condition','from','to','load','baseFacility','lastTrip','routeId','routeSignature','routeSlot','departureScheduled','departureScheduledAt','releaseExclusiveRouteOnArrival','simCarrySeconds','lastTransitionGuardDay','crewBlocked','simulationFault']);
  const EFFECT_MAPS=Object.freeze(['sectorProfit','tripProfit','tripRevenue','tripFuel','tripMaintenance','tripCount','cash']);
  const clone=value=>typeof globalThis.structuredClone==='function'?globalThis.structuredClone(value):JSON.parse(JSON.stringify(value));
  const number=(value,fallback=0)=>{const result=Number(value);return Number.isFinite(result)?result:fallback;};
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,number(value)));
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);

  function makeEffects(){return {todayProfit:0,groupValue:0,sectorProfit:{},tripProfit:{},tripRevenue:{},tripFuel:{},tripMaintenance:{},tripCount:{},cash:{},alerts:[],saleIds:[],retiredRouteIds:[]};}
  function finiteMap(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(row=>Number.isFinite(Number(row)));}
  function validEffects(effects){
    return !!effects&&Number.isFinite(effects.todayProfit)&&Number.isFinite(effects.groupValue)&&EFFECT_MAPS.every(key=>finiteMap(effects[key]))&&['alerts','saleIds','retiredRouteIds'].every(key=>Array.isArray(effects[key])&&effects[key].length<=512&&effects[key].every(row=>typeof row==='string'&&row.length<=MAX_TEXT));
  }
  function routeMode(route){return String(route?.routeMode||route?.type||'').trim();}
  function assetMode(asset){return String(asset?.assetMode||asset?.type||'').trim();}
  function routeOwner(route){return String(route?.ownerCompanyId||route?.companyId||route?.company||'').trim();}
  function assetOwner(asset){return String(asset?.ownerCompanyId||asset?.companyId||(['air','sea','road'].includes(assetMode(asset))?assetMode(asset):'')).trim();}
  function fmtMoney(value){
    const sign=value<0?'-':'',n=Math.abs(number(value));
    if(n>=1e12)return `${sign}$${(n/1e12).toFixed(2)}T`;
    if(n>=1e9)return `${sign}$${(n/1e9).toFixed(2)}B`;
    if(n>=1e6)return `${sign}$${(n/1e6).toFixed(1)}M`;
    if(n>=1e3)return `${sign}$${(n/1e3).toFixed(1)}K`;
    return `${sign}$${n.toFixed(0)}`;
  }
  function fmtNumber(value){return new Intl.NumberFormat('ar-SA',{maximumFractionDigits:0}).format(value||0);}
  function formatDuration(seconds){
    if(seconds<=0)return 'الآن';
    if(seconds<3600)return `${Math.ceil(seconds/60)} دقيقة`;
    if(seconds<86400)return `${(seconds/3600).toFixed(seconds<10800?1:0)} ساعة`;
    return `${(seconds/86400).toFixed(seconds<259200?1:0)} يوم`;
  }
  function loadLabel(asset){
    const specs=asset.specs||{},util=asset.type==='air'?.82:asset.type==='sea'?.78:.86,used=Math.round((specs.capacity||0)*util);
    return `${fmtNumber(used)} / ${fmtNumber(specs.capacity||0)} ${specs.capacityUnit||''}`;
  }
  function normalizeAsset(asset,route,catalogSpecs){
    if(route){
      asset.distanceKm=route.distanceKm;asset.tripSeconds=route.tripSeconds;asset.effectiveSpeedKmh=route.effectiveSpeedKmh;asset.dwellHours=route.dwellHours;
      asset.from=asset.reverse?route.to:route.from;asset.to=asset.reverse?route.from:route.to;
    }
    if(!asset.phase)asset.phase=asset.routeId?'moving':'idle';
    if(typeof asset.progress!=='number')asset.progress=0;
    if(typeof asset.fuel!=='number')asset.fuel=100;
    if(typeof asset.condition!=='number')asset.condition=100;
    if(!asset.specs&&catalogSpecs)asset.specs=clone(catalogSpecs);
    if(route&&asset.specs){
      const mode=assetMode(asset),rated=mode==='air'?(asset.specs.speedKmh||route.effectiveSpeedKmh)*.9:mode==='sea'?(asset.specs.speedKn||route.effectiveSpeedKmh/1.852)*1.852*.88:(asset.specs.speedKmh||route.effectiveSpeedKmh)*.76;
      asset.effectiveSpeedKmh=Math.max(20,Math.min(rated,route.effectiveSpeedKmh*1.08));asset.tripSeconds=asset.distanceKm/asset.effectiveSpeedKmh*3600;
    }
    return asset;
  }
  function clampPercent(value){return Math.max(0,Math.min(100,number(value)));}
  function computeTripEconomics(asset,route,ctx){
    const distanceKm=route.distanceKm,hours=(asset.tripSeconds||route.tripSeconds)/3600,specs=asset.specs||{};let revenue=0,fuelCost=0;
    if(asset.type==='air'){
      const yieldRate=specs.cargo?.32:.11;
      revenue=(specs.capacity||0)*.82*distanceKm*yieldRate*(specs.yieldMultiplier||1);
      fuelCost=(specs.fuelBurnKgPerKm||0)*distanceKm*.86;
    }else if(asset.type==='sea'){
      const distanceNm=distanceKm/1.852,seaYield=specs.capacityUnit==='TEU'?.031:specs.capacityUnit==='راكب'?.34:.018;
      revenue=(specs.capacity||0)*.78*distanceNm*seaYield*(specs.yieldMultiplier||1);
      fuelCost=(specs.fuelTonPerDay||0)*(hours/24)*640;
    }else{
      revenue=(specs.capacity||0)*.86*distanceKm*.15*(specs.yieldMultiplier||1);
      fuelCost=specs.electric?(distanceKm/100)*(specs.energyKWhPer100km||115)*.14:(distanceKm/100)*(specs.fuelLPer100km||0)*.98;
    }
    const monthlyPayroll=Math.max(0,number(asset.staffing?.monthlyPayroll)),payrollAllocation=monthlyPayroll/(30*24)*hours,maintReserve=revenue*.04,owner=assetOwner(asset);let crewCost=0;
    const company=ctx.companies?.[owner]||{},serviceLevel=clampPercent(company.serviceLevel),automation=clampPercent(company.automation),research=ctx.research||{},sustainability=ctx.sustainability||{};
    const serviceRevenue=1+Math.max(-.05,Math.min(.08,(serviceLevel-85)*.002));
    const fuelEfficiency=1-Math.min(.12,(number(research.efficiency)/100)*.08+(automation/100)*.025);
    const crewEfficiency=1-Math.min(.10,(number(research.automation)/100)*.05+(automation/100)*.035);
    const maintenanceEfficiency=1-Math.min(.08,(automation/100)*.04+(number(research.efficiency)/100)*.025);
    const mode=assetMode(asset),economy=ctx.economy||{},market=ctx.market||{},shareMap=market.share||{},pressureMap=market.competitorPressure||{},reputation=ctx.reputation||{};
    const sustainabilityFuel=mode==='air'?1-Math.min(.06,number(sustainability.safShare)*.0004):mode==='sea'?1-Math.min(.05,number(sustainability.shorePower)*.00025):1-Math.min(.08,number(sustainability.electricRoadShare)*.00045);
    const share=number(shareMap[owner]??shareMap[mode],5),pressure=number(pressureMap[owner]??pressureMap[mode],50),rep=number(reputation[owner]??reputation[mode],70);
    const demand=mode==='air'?number(economy.airDemand,100):mode==='sea'?number(economy.seaDemand,100):number(economy.roadDemand,100);
    const demandFactor=clamp((demand/100)*(1+(rep-70)*.003)*(1+(share-5)*.006)*(1-(pressure-50)*.0015),.65,1.35);
    revenue*=serviceRevenue*demandFactor;fuelCost*=fuelEfficiency*sustainabilityFuel;crewCost*=crewEfficiency;let maintenance=maintReserve*maintenanceEfficiency;
    const economyFuel=mode==='air'?number(economy.jetFuel,.86)/.86:mode==='sea'?number(economy.bunker,640)/640:number(economy.diesel,.98)/.98;
    fuelCost*=economyFuel;
    const researchEfficiency=clamp(number(research.efficiency)/100,0,1),researchAutomation=clamp(number(research.automation)/100,0,1),cleanEnergy=clamp(number(research.cleanEnergy)/100,0,1);
    fuelCost*=1-researchEfficiency*.055-cleanEnergy*.018;maintenance*=1-researchEfficiency*.045;crewCost*=1-researchAutomation*.025;
    if(mode==='air'&&number(sustainability.safShare)>0)fuelCost*=1-Math.min(.03,number(sustainability.safShare)/100*.03);
    if(mode==='road'&&number(sustainability.electricRoadShare)>0)fuelCost*=1-Math.min(.08,number(sustainability.electricRoadShare)/100*.08);
    const margin=revenue-fuelCost-crewCost-maintenance;
    return {revenue,fuelCost,crewCost,payrollAllocation,fixedMonthlyPayroll:monthlyPayroll,maintReserve:maintenance,margin,cashContribution:revenue-fuelCost-maintenance,hours,distanceKm,modifiers:{serviceRevenue,fuelEfficiency,crewEfficiency,maintenanceEfficiency},market:{demandFactor,share,pressure},capabilityEffects:{efficiencyResearch:researchEfficiency,automationResearch:researchAutomation,cleanEnergyResearch:cleanEnergy}};
  }
  function departDraft(asset,route){
    const owner=assetOwner(asset);
    if(asset.phase!=='turnaround')throw new Error('asset-not-ready-to-depart');
    if(!route||route.id!==asset.routeId||routeMode(route)!==assetMode(asset)||routeOwner(route)!==owner||![route.fromFacility,route.toFacility].includes(asset.baseFacility))throw new Error('route-departure-contract');
    if(asset.staffing?.mode!=='automatic-fixed'||asset.staffing?.ready!==true)throw new Error('asset-fixed-crew-not-ready');
    asset.reverse=asset.baseFacility===route.toFacility;asset.phase='moving';asset.progress=0;asset.dwellRemaining=0;asset.fuel=100;asset.crewBlocked=false;asset.departureScheduled=false;delete asset.departureScheduledAt;delete asset.simulationFault;
    asset.from=asset.reverse?route.to:route.from;asset.to=asset.reverse?route.from:route.to;asset.load=loadLabel(asset);return asset;
  }
  function isolate(row,simMeta,error){
    const draft=clone(row.asset),effects=makeEffects();draft.simulationFault={code:'ASSET_SIMULATION_ISOLATED',at:simMeta.from,detail:String(error?.message||error).slice(0,180)};draft.crewBlocked=true;
    effects.alerts.push(`${draft.name||draft.id}: عُزل خلل هذا الأصل وحده وبقيت بقية الشركات والمحاكاة عاملة. أعد تعيين مساره أو نفّذ صيانته لإعادة الفحص.`);
    return {id:row.id,patch:patchFor(draft),effects};
  }
  function patchFor(asset){const patch={};for(const field of WRITE_FIELDS)patch[field]=asset[field];return patch;}
  function processOne(row,simAdvance,simMeta,ctx){
    const asset=normalizeAsset(clone(row.asset),row.route||null,row.catalogSpecs||null),effects=makeEffects();
    if(asset.simulationFault)return {id:row.id,patch:patchFor(asset),effects};
    let remaining=Math.max(0,number(simAdvance))+Math.max(0,number(asset.simCarrySeconds));asset.simCarrySeconds=0;
    if(asset.phase==='idle'||!asset.routeId||remaining<=0)return {id:row.id,patch:patchFor(asset),effects};
    const route=row.route||null;
    if(!route){asset.simulationFault={code:'ROUTE_RUNTIME_MISSING',at:number(simMeta.from)||number(ctx.simSeconds),detail:`Route runtime missing: ${String(asset.routeId).slice(0,80)}`};asset.crewBlocked=true;effects.alerts.push(`${asset.name||asset.id}: عُزل الأصل لأن تعريف مساره غير متاح. لم يتقدم الأصل أو الزمن التشغيلي الخاص به؛ أعد تعيين المسار بعد المراجعة.`);return {id:row.id,patch:patchFor(asset),effects};}
    let transitions=0,completedTrips=0,totalTripMargin=0,lastEco=null;
    while(remaining>1e-6&&transitions<96&&asset.routeId&&asset.phase!=='idle'){
      transitions++;
      if(asset.phase==='turnaround'){
        const dwell=Math.max(0,number(asset.dwellRemaining));
        if(dwell>remaining){asset.dwellRemaining=dwell-remaining;remaining=0;break;}
        remaining=Math.max(0,remaining-dwell);
        if(asset.staffing?.mode!=='automatic-fixed'||asset.staffing.ready!==true){if(!asset.crewBlocked)effects.alerts.push(`${asset.name}: تكوين الطاقم الثابت غير مكتمل؛ أوقفت هذه الرحلة دون التأثير على بقية اللعبة.`);asset.crewBlocked=true;remaining=0;break;}
        departDraft(asset,route);continue;
      }
      const duration=Number(asset.tripSeconds||route.tripSeconds);
      if(!Number.isFinite(duration)||duration<=0){asset.progress=0;asset.phase='idle';asset.routeId=null;asset.routeSignature=null;effects.alerts.push(`${asset.name}: أوقف النظام المسار لأن مدة الرحلة غير صالحة.`);remaining=0;break;}
      const progress=clamp(number(asset.progress),0,1),timeToArrival=Math.max(0,(1-progress)*duration),travel=Math.min(remaining,timeToArrival),delta=duration>0?travel/duration:0;
      asset.progress=clamp(progress+delta,0,1);asset.fuel=clamp(asset.fuel-delta*(asset.type==='air'?55:asset.type==='sea'?43:49),4,100);asset.condition=clamp(asset.condition-delta*(asset.type==='air'?.08:asset.type==='sea'?.05:.11),55,100);
      remaining=Math.max(0,remaining-travel);if(asset.progress<1-1e-9)break;
      asset.progress=1;asset.phase='turnaround';asset.dwellRemaining=Math.max(0,number(route.dwellHours))*3600+Math.max(0,number(row.departureDelay));asset.departureScheduled=true;asset.departureScheduledAt=Math.max(0,(number(simMeta.to)||number(ctx.simSeconds))-remaining)+asset.dwellRemaining;
      asset.baseFacility=asset.reverse?route.fromFacility:route.toFacility;
      const eco=computeTripEconomics(asset,route,ctx);asset.lastTrip=eco;lastEco=eco;completedTrips++;totalTripMargin+=number(eco.margin);
      const ownerCompanyId=assetOwner(asset);if(!ownerCompanyId)throw new Error(`asset-owner-company-missing:${asset.id}`);
      effects.todayProfit+=number(eco.margin);effects.sectorProfit[ownerCompanyId]=(effects.sectorProfit[ownerCompanyId]||0)+number(eco.margin);effects.tripProfit[ownerCompanyId]=(effects.tripProfit[ownerCompanyId]||0)+number(eco.margin);
      const tripCash=Number.isFinite(eco.cashContribution)?eco.cashContribution:(eco.revenue-eco.fuelCost-eco.maintReserve);
      effects.cash[ownerCompanyId]=(effects.cash[ownerCompanyId]||0)+(Number(tripCash)||0);effects.tripRevenue[ownerCompanyId]=(effects.tripRevenue[ownerCompanyId]||0)+Math.max(0,Number(eco.revenue)||0);effects.tripFuel[ownerCompanyId]=(effects.tripFuel[ownerCompanyId]||0)+Math.max(0,Number(eco.fuelCost)||0);effects.tripMaintenance[ownerCompanyId]=(effects.tripMaintenance[ownerCompanyId]||0)+Math.max(0,Number(eco.maintReserve)||0);effects.tripCount[ownerCompanyId]=(effects.tripCount[ownerCompanyId]||0)+1;
      effects.groupValue+=Math.max(0,Number(eco.margin)||0)*.08;
      if(asset.releaseExclusiveRouteOnArrival){const retiredRouteId=asset.routeId;asset.phase='idle';asset.routeId=null;asset.routeSignature=null;asset.releaseExclusiveRouteOnArrival=false;asset.progress=0;asset.dwellRemaining=0;if(retiredRouteId)effects.retiredRouteIds.push(retiredRouteId);effects.alerts.push(`${asset.name}: اكتمل المسار القديم المشترك وتوقف الأصل بأمان لإسناد مسار مستقل.`);remaining=0;break;}
      if(asset.salePending){if(ctx.ownedFacilities?.includes(asset.baseFacility)){asset.phase='idle';asset.routeId=null;asset.routeSignature=null;asset.progress=0;asset.dwellRemaining=0;effects.saleIds.push(asset.id);remaining=0;break;}asset.dwellRemaining=0;effects.alerts.push(`${asset.name}: وصل محطة عامة ضمن أمر البيع؛ سيعود تلقائيًا إلى مركز المجموعة قبل تنفيذ البيع.`);}
    }
    if(transitions>=96&&remaining>1e-6){asset.simCarrySeconds=Math.min(86400,Math.max(0,remaining));const day=Math.floor((number(simMeta.to)||number(ctx.simSeconds))/86400);if(asset.lastTransitionGuardDay!==day){asset.lastTransitionGuardDay=day;effects.alerts.push(`${asset.name}: بلغ حد حماية انتقالات المحاكاة؛ تم حفظ ${formatDuration(asset.simCarrySeconds)} كزمن مرحّل وسيُستكمل في الشريحة التالية دون فقد.`);}}
    else asset.simCarrySeconds=0;
    if(completedTrips===1&&lastEco)effects.alerts.push(`${asset.name} أكمل رحلة. إيراد ${fmtMoney(lastEco.revenue)} − وقود ${fmtMoney(lastEco.fuelCost)} − صيانة ${fmtMoney(lastEco.maintReserve)} = هامش الرحلة ${fmtMoney(lastEco.margin)}. الراتب الثابت يُصرف في مسير 27.`);
    else if(completedTrips>1)effects.alerts.push(`${asset.name} أكمل ${completedTrips} رحلات أثناء تقديم الوقت بإجمالي هامش ${fmtMoney(totalTripMargin)}.`);
    return {id:row.id,patch:patchFor(asset),effects};
  }
  function validateBatch(input){
    if(!input||input.type!=='process'||!Number.isSafeInteger(input.requestId)||input.requestId<1||!Array.isArray(input.rows)||input.rows.length<1||input.rows.length>MAX_BATCH_ITEMS||!input.context||typeof input.context!=='object'||!Number.isFinite(Number(input.simAdvance))||!input.simMeta||!Number.isFinite(Number(input.simMeta.from))||!Number.isFinite(Number(input.simMeta.to)))throw new TypeError('simulation-asset-batch-invalid');
    const ids=new Set();
    for(const row of input.rows){if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||!row.asset||row.asset.id!==row.id||row.route!==null&&(!row.route||row.route.id!==row.asset.routeId)||!Number.isFinite(Number(row.departureDelay)))throw new TypeError('simulation-asset-row-invalid');ids.add(row.id);}
    return true;
  }
  function validateResults(rows,results){
    if(!Array.isArray(rows)||!Array.isArray(results)||rows.length!==results.length)return false;
    for(let index=0;index<rows.length;index++){
      const input=rows[index],result=results[index],patch=result?.patch,effects=result?.effects,owner=assetOwner(input.asset);
      if(!result||result.id!==input.id||!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).length!==WRITE_FIELDS.length||WRITE_FIELDS.some(field=>!own(patch,field))||!validEffects(result.effects))return false;
      if(EFFECT_MAPS.some(key=>Object.keys(effects[key]||{}).some(companyId=>companyId!==owner))||effects.saleIds.some(id=>id!==input.id)||effects.retiredRouteIds.some(id=>id!==input.asset.routeId))return false;
      if(patch.lastTrip!==null&&patch.lastTrip!==undefined&&(!patch.lastTrip||typeof patch.lastTrip!=='object'||Array.isArray(patch.lastTrip)))return false;
      if(patch.simulationFault!==null&&patch.simulationFault!==undefined&&(!patch.simulationFault||typeof patch.simulationFault!=='object'||typeof patch.simulationFault.code!=='string'))return false;
      if(['progress','fuel','condition','dwellRemaining','simCarrySeconds'].some(field=>patch[field]!==undefined&&!Number.isFinite(Number(patch[field]))))return false;
      if(patch.phase!==undefined&&typeof patch.phase!=='string'||patch.routeId!==undefined&&patch.routeId!==null&&typeof patch.routeId!=='string'||patch.baseFacility!==undefined&&patch.baseFacility!==null&&typeof patch.baseFacility!=='string'||patch.crewBlocked!==undefined&&typeof patch.crewBlocked!=='boolean')return false;
    }
    return true;
  }
  function processRow(row,input){
    try{return processOne(row,input.simAdvance,input.simMeta,input.context);}
    catch(error){return isolate(row,input.simMeta,error);}
  }
  const API=Object.freeze({VERSION,MAX_BATCH_ITEMS,WRITE_FIELDS,makeEffects,validateBatch,validateResults,processRow,processBatch(input){validateBatch(input);return input.rows.map(row=>processRow(row,input));}});
  return API;
});
