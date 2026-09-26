'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Core=require('../WebApp/simulation-asset-core.js');

const app=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8');
const start=app.indexOf('  function processAssetDraft('),end=app.indexOf('\n  function simulationCalendarDate(',start);
assert(start>=0&&end>start,'Build 340 compatibility processor is present for the equivalence gate');
const legacySource=app.slice(start,end).trim();
const clone=value=>structuredClone(value);
const WRITE_FIELDS=Core.WRITE_FIELDS;

const route={id:'R-TEST',type:'air',routeMode:'air',ownerCompanyId:'air',from:'ألف',to:'باء',fromFacility:'F-A',toFacility:'F-B',distanceKm:100,effectiveSpeedKmh:100,tripSeconds:4000,dwellHours:.1};
const economicsState={
  simSeconds:7200,
  advanced:{companies:{air:{serviceLevel:91,automation:23}}},
  research:{efficiency:37,automation:21,cleanEnergy:18},
  sustainability:{safShare:32,shorePower:17,electricRoadShare:12},
  realism:{schema:'2.0.0',economy:{jetFuel:.91,bunker:700,diesel:1.05,airDemand:108,seaDemand:96,roadDemand:103},market:{share:{air:9},competitorPressure:{air:42}},reputation:{air:76}}
};
const engineContext={
  companies:{air:{serviceLevel:91,automation:23}},research:{...economicsState.research},sustainability:{...economicsState.sustainability},
  economy:{...economicsState.realism.economy},market:clone(economicsState.realism.market),reputation:{...economicsState.realism.reputation},ownedFacilities:['F-B'],simSeconds:economicsState.simSeconds
};
function makeAsset(overrides={}){
  return {
    id:'A-1',name:'طائرة اختبار',type:'air',assetMode:'air',ownerCompanyId:'air',assetClass:'aircraft',operationProfileId:'air-operations',
    phase:'moving',routeId:route.id,routeSignature:'R-TEST-SIG',routeSlot:0,reverse:false,progress:.9,fuel:71,condition:96,
    from:route.from,to:route.to,baseFacility:route.fromFacility,load:'82 / 100 راكب',dwellRemaining:0,departureScheduled:false,
    salePending:false,tripSeconds:4000,specs:{capacity:100,capacityUnit:'راكب',speedKmh:100,fuelBurnKgPerKm:2,yieldMultiplier:1.1,cargo:false},
    staffing:{mode:'automatic-fixed',ready:true,monthlyPayroll:120000},simCarrySeconds:0,crewBlocked:false,
    ...overrides
  };
}
function legacyFormatMoney(value){const sign=value<0?'-':'',n=Math.abs(Number(value)||0);if(n>=1e12)return `${sign}$${(n/1e12).toFixed(2)}T`;if(n>=1e9)return `${sign}$${(n/1e9).toFixed(2)}B`;if(n>=1e6)return `${sign}$${(n/1e6).toFixed(1)}M`;if(n>=1e3)return `${sign}$${(n/1e3).toFixed(1)}K`;return `${sign}$${n.toFixed(0)}`;}
const legacyFormatNumber=value=>new Intl.NumberFormat('ar-SA',{maximumFractionDigits:0}).format(value||0);
const legacyClamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function legacyNormalize(asset){
  const tpl=asset.routeId===route.id?route:null;
  if(tpl){asset.distanceKm=tpl.distanceKm;asset.tripSeconds=tpl.tripSeconds;asset.effectiveSpeedKmh=tpl.effectiveSpeedKmh;asset.dwellHours=tpl.dwellHours;asset.from=asset.reverse?tpl.to:tpl.from;asset.to=asset.reverse?tpl.from:tpl.to;}
  if(!asset.phase)asset.phase=asset.routeId?'moving':'idle';if(typeof asset.progress!=='number')asset.progress=0;if(typeof asset.fuel!=='number')asset.fuel=100;if(typeof asset.condition!=='number')asset.condition=100;
  if(!asset.specs)asset.specs={};
  if(tpl&&asset.specs){const mode=asset.assetMode||asset.type,rated=mode==='air'?(asset.specs.speedKmh||tpl.effectiveSpeedKmh)*.9:mode==='sea'?(asset.specs.speedKn||tpl.effectiveSpeedKmh/1.852)*1.852*.88:(asset.specs.speedKmh||tpl.effectiveSpeedKmh)*.76;asset.effectiveSpeedKmh=Math.max(20,Math.min(rated,tpl.effectiveSpeedKmh*1.08));asset.tripSeconds=asset.distanceKm/asset.effectiveSpeedKmh*3600;}
  return asset;
}
function legacyEconomics(asset,tpl){
  const distanceKm=tpl.distanceKm,hours=(asset.tripSeconds||tpl.tripSeconds)/3600,specs=asset.specs||{};let revenue=0,fuelCost=0;
  if(asset.type==='air'){const yieldRate=specs.cargo?.32:.11;revenue=(specs.capacity||0)*.82*distanceKm*yieldRate*(specs.yieldMultiplier||1);fuelCost=(specs.fuelBurnKgPerKm||0)*distanceKm*.86;}
  else if(asset.type==='sea'){const distanceNm=distanceKm/1.852,seaYield=specs.capacityUnit==='TEU'?.031:specs.capacityUnit==='راكب'?.34:.018;revenue=(specs.capacity||0)*.78*distanceNm*seaYield*(specs.yieldMultiplier||1);fuelCost=(specs.fuelTonPerDay||0)*(hours/24)*640;}
  else{revenue=(specs.capacity||0)*.86*distanceKm*.15*(specs.yieldMultiplier||1);fuelCost=specs.electric?(distanceKm/100)*(specs.energyKWhPer100km||115)*.14:(distanceKm/100)*(specs.fuelLPer100km||0)*.98;}
  const monthlyPayroll=Math.max(0,Number(asset.staffing?.monthlyPayroll)||0),crewCost=0,payrollAllocation=monthlyPayroll/(30*24)*hours,maintReserve=revenue*.04,model=economicsState.advanced.companies.air;
  const serviceRevenue=1+Math.max(-.05,Math.min(.08,(model.serviceLevel-85)*.002)),fuelEfficiency=1-Math.min(.12,(economicsState.research.efficiency||0)/100*.08+model.automation/100*.025),crewEfficiency=1-Math.min(.10,(economicsState.research.automation||0)/100*.05+model.automation/100*.035),maintenanceEfficiency=1-Math.min(.08,model.automation/100*.04+(economicsState.research.efficiency||0)/100*.025),su=economicsState.sustainability,sustainabilityFuel=1-Math.min(.06,(su.safShare||0)*.0004);
  revenue*=serviceRevenue;fuelCost*=fuelEfficiency*sustainabilityFuel;let maintenance=maintReserve*maintenanceEfficiency;const mode=asset.assetMode||asset.type,real=economicsState.realism,share=real.market.share.air??5,pressure=real.market.competitorPressure.air??50,rep=real.reputation.air??70,demand=real.economy.airDemand;
  const demandFactor=legacyClamp((demand/100)*(1+(rep-70)*.003)*(1+(share-5)*.006)*(1-(pressure-50)*.0015),.65,1.35);revenue*=demandFactor;fuelCost*=real.economy.jetFuel/.86;
  const eff=legacyClamp((Number(economicsState.research.efficiency)||0)/100,0,1),auto=legacyClamp((Number(economicsState.research.automation)||0)/100,0,1),clean=legacyClamp((Number(economicsState.research.cleanEnergy)||0)/100,0,1);
  fuelCost*=1-eff*.055-clean*.018;maintenance*=1-eff*.045;let adjustedCrew=crewCost*(1-auto*.025);if((Number(su.safShare)||0)>0)fuelCost*=1-Math.min(.03,(Number(su.safShare)||0)/100*.03);
  const margin=revenue-fuelCost-adjustedCrew-maintenance;return {revenue,fuelCost,crewCost:adjustedCrew,payrollAllocation,fixedMonthlyPayroll:monthlyPayroll,maintReserve:maintenance,margin,cashContribution:revenue-fuelCost-maintenance,hours,distanceKm,modifiers:{serviceRevenue,fuelEfficiency,crewEfficiency,maintenanceEfficiency},market:{demandFactor,share,pressure},capabilityEffects:{efficiencyResearch:eff,automationResearch:auto,cleanEnergyResearch:clean}};
}
function legacyDepart(asset,tpl){
  if(asset.phase!=='turnaround')throw new Error('asset-not-ready-to-depart');
  if(!tpl||tpl.id!==asset.routeId||(tpl.routeMode||tpl.type)!==(asset.assetMode||asset.type)||(tpl.ownerCompanyId||tpl.companyId||tpl.company)!==(asset.ownerCompanyId||asset.companyId||asset.assetMode||asset.type)||![tpl.fromFacility,tpl.toFacility].includes(asset.baseFacility))throw new Error('route-departure-contract');
  if(asset.staffing?.ready!==true)throw new Error('asset-fixed-crew-not-ready');asset.reverse=asset.baseFacility===tpl.toFacility;asset.phase='moving';asset.progress=0;asset.dwellRemaining=0;asset.fuel=100;asset.crewBlocked=false;asset.departureScheduled=false;delete asset.departureScheduledAt;delete asset.simulationFault;asset.from=asset.reverse?tpl.to:tpl.from;asset.to=asset.reverse?tpl.from:tpl.to;asset.load=`${legacyFormatNumber(Math.round(asset.specs.capacity*.82))} / ${legacyFormatNumber(asset.specs.capacity)} ${asset.specs.capacityUnit||''}`;return asset;
}
const fleet={
  normalizeAsset:legacyNormalize,
  routeMatchingFacility:(id)=>id===route.id?route:null,
  computeTripEconomics:legacyEconomics,
  loadLabel:asset=>`${legacyFormatNumber(Math.round(asset.specs.capacity*.82))} / ${legacyFormatNumber(asset.specs.capacity)} ${asset.specs.capacityUnit||''}`,
  assetOwnerCompanyId:asset=>asset.ownerCompanyId||asset.companyId||(['air','sea','road'].includes(asset.assetMode||asset.type)?asset.assetMode||asset.type:''),
  findFacility:id=>({owned:id==='F-B'}),clamp:legacyClamp,
  formatDuration:seconds=>seconds<=0?'الآن':seconds<3600?`${Math.ceil(seconds/60)} دقيقة`:seconds<86400?`${(seconds/3600).toFixed(seconds<10800?1:0)} ساعة`:`${(seconds/86400).toFixed(seconds<259200?1:0)} يوم`,
  fmtMoney:legacyFormatMoney,fmtNumber:legacyFormatNumber,
  window:{GH_FLEET_CORE:{departDraft:legacyDepart,departureDelay:asset=>Math.max(0,Math.floor(Number(asset.routeSlot)||0))*180}}
};
const legacyProcess=vm.runInNewContext(`(${legacySource})`,fleet);
function legacyEffects(){return {todayProfit:0,groupValue:0,sectorProfit:{},tripProfit:{},tripRevenue:{},tripFuel:{},tripMaintenance:{},tripCount:{},cash:{},alerts:[],saleIds:[],retiredRouteIds:[]};}
function runLegacy(asset,advance,{from=7200,to=7200+advance}={}){
  let draft=clone(asset),effects=legacyEffects();fleet.state=economicsState;fleet.routeTemplates={[route.id]:route};
  try{legacyProcess(draft,advance,effects,{from,to});}
  catch(error){draft=clone(asset);effects=legacyEffects();draft.simulationFault={code:'ASSET_SIMULATION_ISOLATED',at:from,detail:String(error?.message||error).slice(0,180)};draft.crewBlocked=true;effects.alerts.push(`${draft.name||draft.id}: عُزل خلل هذا الأصل وحده وبقيت بقية الشركات والمحاكاة عاملة. أعد تعيين مساره أو نفّذ صيانته لإعادة الفحص.`);}
  return {id:asset.id,patch:Object.fromEntries(WRITE_FIELDS.map(field=>[field,draft[field]])),effects};
}
function runCore(asset,advance,{from=7200,to=7200+advance}={}){
  const dto={id:asset.id,guard:'owner-kept-guard',asset:clone(asset),route:asset.routeId===route.id?route:null,catalogSpecs:null,departureDelay:Math.max(0,Math.floor(Number(asset.routeSlot)||0))*180};
  return Core.processRow(dto,{simAdvance:advance,simMeta:{from,to},context:engineContext});
}

const cases=[
  {name:'completed trip, economics, scheduled departure and cash',asset:makeAsset(),advance:1200},
  {name:'fixed crew unavailable in turnaround',asset:makeAsset({phase:'turnaround',progress:1,dwellRemaining:0,staffing:{mode:'automatic-fixed',ready:false,monthlyPayroll:90000}}),advance:600},
  {name:'sale finalized at owned stop',asset:makeAsset({progress:.9,salePending:true,baseFacility:'F-A'}),advance:1200},
  {name:'exclusive route retires on arrival',asset:makeAsset({progress:.99,releaseExclusiveRouteOnArrival:true}),advance:1200},
  {name:'transition cap preserves carry time',asset:makeAsset({tripSeconds:1,progress:0,routeSlot:0}),advance:1000000},
  {name:'invalid owner isolates one asset',asset:makeAsset({ownerCompanyId:'',companyId:'',assetMode:'unknown'}),advance:1200}
];
for(const scenario of cases){
  const expected=runLegacy(scenario.asset,scenario.advance),actual=runCore(scenario.asset,scenario.advance);
  assert.deepEqual(actual,expected,scenario.name);
  console.log('PASS',scenario.name);
}

const count=20000,rows=Array.from({length:count},(_,index)=>({id:`IDLE-${index}`,asset:{id:`IDLE-${index}`,type:'air',assetMode:'air',ownerCompanyId:'air',phase:'idle',routeId:null,progress:0,fuel:100,condition:100,specs:{capacity:1}},route:null,catalogSpecs:null,departureDelay:0}));
const request={type:'process',requestId:1,rows,context:engineContext,simAdvance:300,simMeta:{from:7200,to:7500}},before=JSON.stringify(rows.slice(0,4)),started=performance.now();
const output=[];for(let offset=0;offset<rows.length;offset+=Core.MAX_BATCH_ITEMS){const batch={...request,rows:rows.slice(offset,offset+Core.MAX_BATCH_ITEMS)};Core.validateBatch(batch);const result=Core.processBatch(batch);assert(Core.validateResults(batch.rows,result));output.push(...result);}
const elapsed=performance.now()-started;
assert.equal(output.length,count);assert.equal(output[0].id,'IDLE-0');assert.equal(output[count-1].id,`IDLE-${count-1}`);assert.equal(JSON.stringify(rows.slice(0,4)),before,'worker planning must not mutate immutable input rows');
const corrupted=output.slice();corrupted[0]={...corrupted[0],id:'STALE'};assert.equal(Core.validateResults(rows,corrupted),false,'stale or unordered plans must be rejected');
console.log('PASS 20,000 DTOs in bounded 256-row batches; plan parity checks valid; input unchanged');
console.log(JSON.stringify({rows:count,batchSize:Core.MAX_BATCH_ITEMS,nodePlanningMs:Number(elapsed.toFixed(2)),environment:'Node synthetic core test; not iPhone performance'}));
