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
  const ARABIC_INTEGER_FORMAT=new Intl.NumberFormat('ar-SA',{maximumFractionDigits:0});
  function fmtNumber(value){return ARABIC_INTEGER_FORMAT.format(value||0);}
  function formatDuration(seconds){
    if(seconds<=0)return 'الآن';
    if(seconds<3600)return `${Math.ceil(seconds/60)} دقيقة`;
    if(seconds<86400)return `${(seconds/3600).toFixed(seconds<10800?1:0)} ساعة`;
    return `${(seconds/86400).toFixed(seconds<259200?1:0)} يوم`;
  }
  function loadLabel(asset){
    const specs=asset.specs||{},used=Math.round((specs.capacity||0)*marketOf(asset).load);
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
  // A company pays the market price for the fuel it has not hedged and its swap price for the share it has
  // (GH_MARKET_CORE hedge-fuel). The factor scales the reference-priced fuel cost of a trip.
  const FUEL_OF_MODE=Object.freeze({air:'jet',sea:'bunker',road:'diesel'}),FUEL_MARKET=Object.freeze({jet:['jetFuel',.86],bunker:['bunker',640],diesel:['diesel',.98]});
  function fuelPriceFactor(economy,mode,hedge){const [field,reference]=FUEL_MARKET[FUEL_OF_MODE[mode]||'diesel'],market=number(economy?.[field],reference),share=Math.max(0,Math.min(.8,number(hedge?.share)));return (share>0?share*number(hedge.price,market)+(1-share)*market:market)/reference;}
  // Build 358: what a trip earns and costs follows the real asset, at 2025-26 market levels. Each market has its own
  // tariff; a one-way trade (bulk, crude, products, cars, fuel and chemical tankers) sails or drives back empty, so its
  // load is averaged over both legs. Fuel is at the reference price (fuelPriceFactor scales it to the market).
  //   air-pax      economy fare 45$ + 0.075$/km to 3,000 km, 0.055$/km beyond; premium ×1.7, business ×3.8, first ×6.5;
  //                belly cargo 0.28$ per tonne-km; airport and navigation charges from MTOW and distance.
  //   air-freight  0.30$ per tonne-km on long haul, up to 0.55$ on short haul.
  //   air-charter  the hourly charter rate for 75% of the hours (positioning legs fly empty).
  //   sea          container 260$ + 0.11$/nm per TEU; dry bulk 4$ + 0.0016$/nm per tonne; crude 3$ + 0.0018$/nm, products
  //                ×1.35; cars 130$ + 0.08$/nm each; ferry 25$ + 0.12$/nm per passenger with vehicles; cruise 230$ per
  //                guest-night; LNG, LPG, offshore and heavy-lift on a day rate with the charterer paying fuel; tugs on
  //                a day rate at 65% use. Port dues from the hull length.
  //   road         per tonne-km: general 0.075$, container 0.085$, fuel 0.095$, reefer 0.10$, chemical 0.12$, heavy
  //                0.16$, urban distribution 0.25$; cars 0.12$ each per km; parcel vans 1.30$ per km driven. Reefer
  //                units burn 2.5 l/h; electricity 0.14$/kWh; hydrogen 12$/kg.
  const MARKETS=Object.freeze({
    'air-pax':{load:.82},'air-freight':{load:.75},'air-charter':{load:.75},
    container:{load:.82},'dry-bulk':{load:.95*.5},crude:{load:.97*.5},product:{load:.95*.6},'car-carrier':{load:.85*.6},ropax:{load:.70},cruise:{load:.95},
    lng:{load:1,charter:true},lpg:{load:1,charter:true},offshore:{load:1,charter:true},'heavy-lift':{load:1,charter:true},tug:{load:.65},
    parcel:{load:1},urban:{load:.70},general:{load:.82},reefer:{load:.80},fuel:{load:.5},chemical:{load:.5},container_road:{load:.75},heavy:{load:.6},vehicles:{load:.7}
  });
  const CABIN=Object.freeze({economy:[1,.84],premium:[1.7,.78],business:[3.8,.70],first:[6.5,.55]});
  const ROAD_RATE=Object.freeze({general:.075,container:.085,fuel:.095,reefer:.10,chemical:.12,heavy:.16,urban:.25});
  // A spec without a market (a fixture or an asset from before the real catalogue) reads as the plain market of its mode.
  function marketId(asset){
    const specs=asset?.specs||{},mode=assetMode(asset);if(specs.market)return specs.market;
    if(mode==='air')return specs.cargo?'air-freight':'air-pax';
    if(mode==='sea')return specs.capacityUnit==='TEU'?'container':specs.capacityUnit==='راكب'?'cruise':'dry-bulk';
    return 'general';
  }
  function marketOf(asset){const id=marketId(asset),key=assetMode(asset)==='road'&&id==='container'?'container_road':id;return {id,...(MARKETS[key]||MARKETS.general)};}
  function economyFare(km){return 45+.075*Math.min(km,3000)+.055*Math.max(0,km-3000);}
  function baseTripEconomics(asset,distanceKm,hours){
    const specs=asset?.specs||{},mode=assetMode(asset),market=marketOf(asset),km=Math.max(0,number(distanceKm)),h=Math.max(0,number(hours)),capacity=Math.max(0,number(specs.capacity));
    let revenue=0,fuelCost=0,maintenance=0,fees=0;
    if(mode==='air'){
      if(market.id==='air-charter')revenue=number(specs.charterPerHour)*h*.75;
      else if(market.id==='air-freight')revenue=capacity*market.load*km*(.30+.60*Math.max(0,(2000-km)/2000));
      else{
        const cabin=specs.cabin||{economy:capacity},fare=economyFare(km);
        for(const [cls,[factor,load]] of Object.entries(CABIN))revenue+=Math.max(0,number(cabin[cls]))*load*fare*factor;
        revenue+=Math.max(0,number(specs.bellyCargoT))*.60*km*.28;
      }
      fuelCost=number(specs.fuelBurnKgPerKm)*km*.86;
      maintenance=number(specs.maintenancePerBlockHour)*h;
      const mtow=Math.max(0,number(specs.mtowTon));fees=mtow*10+(km/100)*Math.sqrt(mtow/50)*60;
    }else if(mode==='sea'){
      // Bulk and tanker rates per tonne fall with ship size (a Handysize earns more per tonne than a Capesize).
      const nm=km/1.852,load=market.load,size=Math.pow(Math.max(1,capacity)/60000,-.15);
      if(market.charter)revenue=number(specs.dayRate)*h/24;
      else if(market.id==='tug')revenue=number(specs.dayRate)*h/24*load;
      else if(market.id==='container')revenue=capacity*load*(260+.11*nm);
      else if(market.id==='dry-bulk')revenue=capacity*load*(6+.0028*nm)*size;
      else if(market.id==='crude')revenue=capacity*load*(4+.0022*nm)*size;
      else if(market.id==='product')revenue=capacity*load*(4+.0022*nm)*size*1.35;
      else if(market.id==='car-carrier')revenue=capacity*load*(130+.08*nm);
      else if(market.id==='ropax')revenue=capacity*load*(25+.12*nm)*1.6;
      else if(market.id==='cruise')revenue=capacity*load*(h/24)*230;
      // A harbour tug burns full power only while towing, about a third of its day.
      fuelCost=market.charter?0:number(specs.fuelTonPerDay)*(h/24)*640*(market.id==='tug'?.35:1);
      maintenance=number(specs.maintenancePerDay)*h/24;
      // Port dues by length; the carrier also pays terminal handling and equipment per box, and handling per car.
      fees=Math.max(0,number(specs.lengthM))*150+(market.id==='container'?capacity*load*320:market.id==='car-carrier'?capacity*load*45:0);
    }else{
      const load=market.load;
      if(market.id==='parcel')revenue=km*1.30;
      else if(market.id==='vehicles')revenue=capacity*load*km*.12;
      else revenue=capacity*load*km*(ROAD_RATE[market.id]||ROAD_RATE.general);
      fuelCost=specs.hydrogen?(km/100)*number(specs.hydrogenKgPer100km)*12:specs.electric?(km/100)*number(specs.energyKWhPer100km)*.14:(km/100)*number(specs.fuelLPer100km)*.98;
      if(market.id==='reefer')fuelCost+=h*2.5*.98;
      maintenance=number(specs.maintenancePerKm)*km;
    }
    return {revenue,fuelCost,maintenance,fees,market:market.id,load:market.load};
  }
  function computeTripEconomics(asset,route,ctx){
    const distanceKm=route.distanceKm,hours=(asset.tripSeconds||route.tripSeconds)/3600,base=baseTripEconomics(asset,distanceKm,hours);let revenue=base.revenue,fuelCost=base.fuelCost,fees=base.fees;
    const monthlyPayroll=Math.max(0,number(asset.staffing?.monthlyPayroll)),payrollAllocation=monthlyPayroll/(30*24)*hours,maintReserve=base.maintenance,owner=assetOwner(asset);let crewCost=0;
    const company=ctx.companies?.[owner]||{},serviceLevel=clampPercent(company.serviceLevel),automation=clampPercent(company.automation),research=ctx.research||{},sustainability=ctx.sustainability||{};
    const serviceRevenue=1+Math.max(-.05,Math.min(.08,(serviceLevel-85)*.002));
    // Fleet wear (GH_REALISM.fleetWear, from the company's maintenance policy): worn assets burn more and run late.
    const wear=Math.max(0,Math.min(.45,number(company.fleetWear))),wearRevenue=1-wear*.15,wearFuel=1+wear*.2;
    // Crew shortage (GH_REALISM.crewShortage): that share of trips does not fly, so earns and burns nothing.
    const flown=1-Math.max(0,Math.min(.5,number(company.crewShortage)));
    // The appointed manager (GH_HR_CORE.managerSkill, 0 when none): a skilled one sells and runs better; none costs 3%
    // of revenue. A context without the field (an older caller) is neutral.
    const skill=Math.max(0,Math.min(100,number(company.managerSkill))),managed=company.managerSkill===undefined?1:skill>0?1+(skill-80)*.002:.97;
    const fuelEfficiency=1-Math.min(.12,(number(research.efficiency)/100)*.08+(automation/100)*.025);
    const crewEfficiency=1-Math.min(.10,(number(research.automation)/100)*.05+(automation/100)*.035);
    const maintenanceEfficiency=1-Math.min(.08,(automation/100)*.04+(number(research.efficiency)/100)*.025);
    const mode=assetMode(asset),economy=ctx.economy||{},market=ctx.market||{},shareMap=market.share||{},pressureMap=market.competitorPressure||{},reputation=ctx.reputation||{};
    const sustainabilityFuel=mode==='air'?1-Math.min(.06,number(sustainability.safShare)*.0004):mode==='sea'?1-Math.min(.05,number(sustainability.shorePower)*.00025):1-Math.min(.08,number(sustainability.electricRoadShare)*.00045);
    const share=number(shareMap[owner]??shareMap[mode],5),pressure=number(pressureMap[owner]??pressureMap[mode],50),rep=number(reputation[owner]??reputation[mode],70);
    const demand=mode==='air'?number(economy.airDemand,100):mode==='sea'?number(economy.seaDemand,100):number(economy.roadDemand,100);
    const demandFactor=clamp((demand/100)*(1+(rep-70)*.003)*(1+(share-5)*.006)*(1-(pressure-50)*.0015),.65,1.35);
    revenue*=serviceRevenue*demandFactor*wearRevenue*flown*managed;fuelCost*=fuelEfficiency*sustainabilityFuel*wearFuel*flown;fees*=flown;crewCost*=crewEfficiency;let maintenance=maintReserve*maintenanceEfficiency*flown;
    const economyFuel=fuelPriceFactor(economy,mode,ctx.fuelHedges?.[owner]?.[FUEL_OF_MODE[mode]||'diesel']);
    fuelCost*=economyFuel;
    const researchEfficiency=clamp(number(research.efficiency)/100,0,1),researchAutomation=clamp(number(research.automation)/100,0,1),cleanEnergy=clamp(number(research.cleanEnergy)/100,0,1);
    fuelCost*=1-researchEfficiency*.055-cleanEnergy*.018;maintenance*=1-researchEfficiency*.045;crewCost*=1-researchAutomation*.025;
    if(mode==='air'&&number(sustainability.safShare)>0)fuelCost*=1-Math.min(.03,number(sustainability.safShare)/100*.03);
    if(mode==='road'&&number(sustainability.electricRoadShare)>0)fuelCost*=1-Math.min(.08,number(sustainability.electricRoadShare)/100*.08);
    const margin=revenue-fuelCost-crewCost-maintenance-fees;
    return {revenue,fuelCost,crewCost,fees,payrollAllocation,fixedMonthlyPayroll:monthlyPayroll,maintReserve:maintenance,margin,cashContribution:revenue-fuelCost-maintenance-fees,hours,distanceKm,modifiers:{serviceRevenue,fuelEfficiency,crewEfficiency,maintenanceEfficiency},market:{demandFactor,share,pressure},capabilityEffects:{efficiencyResearch:researchEfficiency,automationResearch:researchAutomation,cleanEnergyResearch:cleanEnergy}};
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
  const API=Object.freeze({VERSION,MAX_BATCH_ITEMS,WRITE_FIELDS,makeEffects,validateBatch,validateResults,processRow,processBatch(input){validateBatch(input);return input.rows.map(row=>processRow(row,input));},
    // Fleet Core v4 shares the exact trip economics and labels with the slice engine.
    computeTripEconomics,baseTripEconomics,marketOf,fuelPriceFactor,FUEL_OF_MODE,loadLabel,normalizeAsset,assetOwner,assetMode,routeMode,routeOwner,fmtMoney,formatDuration});
  return API;
});
