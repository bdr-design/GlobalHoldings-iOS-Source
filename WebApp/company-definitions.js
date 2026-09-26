(()=>{
  'use strict';

  const VERSION='GH-COMPANY-DEFINITIONS-1.0.0';
  const FORMAT='gh-company-definition/v1';
  const COMMON_CAPABILITIES=['company.core','finance.book','finance.budget','finance.tax','hr.management','documents.identity','documents.signature','map.company','conference.participant'];
  const COMMON_CHECKLIST=['commercial-registration','tax-file','bank-account','signing-authority','procurement-policy','workforce-plan'];
  const deepFreeze=value=>{
    if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
    for(const child of Object.values(value))deepFreeze(child);
    return Object.freeze(value);
  };
  const identity=(legalAr,legalEn,tradeAr,tradeEn,short,logo,accent,secondary,route,hero,legacyLegalNames=[])=>({
    legalDefault:{ar:legalAr,en:legalEn},trade:{ar:tradeAr,en:tradeEn},short,
    legacyLegalNames,marks:{default:logo,symbol:logo,horizontal:logo,seal:logo,mono:logo},
    palette:{accent,secondary,route,onAccent:'#ffffff'},hero
  });
  const subsidiary=(data)=>({
    ...data,schema:FORMAT,definitionVersion:1,kind:'subsidiary',lifecycle:'active',
    instancePolicy:{mode:'multi',stateScope:'company',...(data.instancePolicy||{})},
    capabilities:[...COMMON_CAPABILITIES,...data.capabilities],
    founding:{legalForm:'شركة تابعة مملوكة للمجموعة',checklistIds:[...COMMON_CHECKLIST],...data.founding},
    finance:{currency:'USD',vatEnabled:true,internalBankEligible:true,...data.finance},
    hr:{...data.hr},facilities:{directoryProviderIds:[],allowedKinds:[],primaryKind:null,...data.facilities},
    ui:{shell:'generic-company-v1',tabs:['overview','management','operations','assets','people','finance','risk'],extensions:[],...data.ui},
    map:{layerProviderIds:['company-facilities'],filterGroup:'companies',...data.map},
    conference:{providerId:'generic-company-v1',order:data.order,...data.conference},
    adapters:{lifecycle:'generic-company-v1',finance:'standard-company-finance-v1',hr:'standard-company-hr-v1',documents:'legal-documents-v1',...data.adapters}
  });

  const BUILTIN_DEFINITIONS=deepFreeze([
    {
      schema:FORMAT,id:'group',definitionId:'gh-holding-v1',definitionVersion:1,order:0,kind:'holding',lifecycle:'active',
      identity:identity('المجموعة العالمية القابضة','Global Holdings Group','جلوبال هولدينغز','Global Holdings','GH','assets/identity/group-default.svg','#d0a34a','#0d3b57','#d0a34a','assets/images/company-hq-v2.webp'),
      classification:{primarySectorId:'holding',sectorIds:['holding'],operationProfileId:'holding-governance-v1',assetClasses:[],routeModes:[]},
      capabilities:['company.core','finance.book','finance.budget','finance.tax','documents.identity','documents.signature','conference.host','governance.group','treasury.parent','map.company'],
      founding:{defaultCapital:250000000,minimumCapital:1,legalForm:'شركة قابضة مساهمة مقفلة',checklistIds:['founder-identity','group-name','registered-office','capitalization','signing-authority']},
      finance:{accountPrefix:'GH',documentPrefix:'GH',collectionProfileId:'holding-revenue-v1',currency:'USD',vatEnabled:true,internalBankEligible:false},
      hr:{managerRoleProfileId:'group-chair-v1',staffingProfileId:'holding-office-v1'},
      facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['headquarters'],primaryKind:'headquarters',siteTemplate:{label:'مقر إقليمي',facilityKind:'headquarters',cost:18000000,dailyCost:30000,capacity:'مقر إداري وتشغيلي إقليمي',deliveryCapacity:0,photo:'assets/images/company-hq-v2.webp',iconKey:'hq',groupValueFactor:.72}},
      ui:{shell:'holding-company-v1',tabs:['overview','governance','companies','treasury','conference'],extensions:['holding-governance']},
      map:{layerProviderIds:['group-headquarters','company-facilities'],filterGroup:'group'},conference:{providerId:'group-host-v1',order:0},
      adapters:{lifecycle:'holding-company-v1',operations:'holding-governance-v1',finance:'group-treasury-v1',hr:'group-governance-v1',facilities:'holding-facilities-v1',map:'company-map-v1',conference:'group-host-v1',documents:'legal-documents-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
    },
    subsidiary({
      id:'air',definitionId:'gh-air-v1',order:10,
      identity:identity('شركة جلوبال هولدينغز للطيران','Global Holdings Aviation Company','جي إتش إير','GH AIR','GH AIR','assets/identity/gh-air.svg','#2d72df','#123f69','#2d72df','assets/images/air-cargo.webp',['الشركة العالمية للطيران']),
      classification:{primarySectorId:'air',sectorIds:['air'],operationProfileId:'fleet-route-air-v1',assetClasses:['aircraft'],routeModes:['air']},
      capabilities:['operations.fleet','asset.aircraft','route.air','facility.airport'],
      founding:{defaultCapital:25000000,minimumCapital:25000000,documentPrefix:'AIR'},
      finance:{accountPrefix:'AIR',documentPrefix:'AIR',collectionProfileId:'aviation-revenue-v1'},
      hr:{managerRoleProfileId:'ceo-aviation-v1',staffingProfileId:'fleet-air-v1'},
      facilities:{directoryProviderIds:['world-airports'],allowedKinds:['airport-base'],primaryKind:'airport-base'},
      ui:{extensions:['fleet-company']},map:{layerProviderIds:['fleet-assets','company-facilities'],filterGroup:'transport',markerProfileId:'air'},
      conference:{providerId:'fleet-company-v1'},adapters:{operations:'fleet-route-air-v1',facilities:'airport-network-v1',map:'fleet-map-v1',conference:'fleet-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:['air'],routeOwnerModes:['air'],assetClassByMode:{air:'aircraft'}}
    }),
    subsidiary({
      id:'sea',definitionId:'gh-marine-v1',order:20,
      identity:identity('شركة جلوبال هولدينغز للشحن البحري','Global Holdings Marine Shipping Company','جي إتش مارين','GH MARINE','GH MARINE','assets/identity/gh-marine.svg','#119c94','#0c5961','#12a99c','assets/images/ship-container.webp',['الشركة العالمية للشحن البحري']),
      classification:{primarySectorId:'sea',sectorIds:['sea'],operationProfileId:'fleet-route-sea-v1',assetClasses:['vessel'],routeModes:['sea']},
      capabilities:['operations.fleet','asset.vessel','route.sea','facility.port'],
      founding:{defaultCapital:30000000,minimumCapital:30000000,documentPrefix:'SEA'},
      finance:{accountPrefix:'SEA',documentPrefix:'SEA',collectionProfileId:'marine-revenue-v1'},
      hr:{managerRoleProfileId:'ceo-marine-v1',staffingProfileId:'fleet-sea-v1'},
      facilities:{directoryProviderIds:['world-ports'],allowedKinds:['port-base'],primaryKind:'port-base'},
      ui:{extensions:['fleet-company']},map:{layerProviderIds:['fleet-assets','company-facilities'],filterGroup:'transport',markerProfileId:'sea'},
      conference:{providerId:'fleet-company-v1'},adapters:{operations:'fleet-route-sea-v1',facilities:'port-network-v1',map:'fleet-map-v1',conference:'fleet-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:['sea'],routeOwnerModes:['sea'],assetClassByMode:{sea:'vessel'}}
    }),
    subsidiary({
      id:'road',definitionId:'gh-logistics-v1',order:30,
      identity:identity('شركة جلوبال هولدينغز للخدمات اللوجستية','Global Holdings Logistics Company','جي إتش لوجستيكس','GH LOGISTICS','GH LOGISTICS','assets/identity/gh-logistics.svg','#df8a3d','#65391f','#e08b3e','assets/images/facility-logistics-v2.webp',['اللوجستيات العالمية']),
      classification:{primarySectorId:'road',sectorIds:['road'],operationProfileId:'fleet-route-road-v1',assetClasses:['truck'],routeModes:['road']},
      capabilities:['operations.fleet','asset.truck','route.road','facility.logistics'],
      founding:{defaultCapital:12000000,minimumCapital:12000000,documentPrefix:'LOG'},
      finance:{accountPrefix:'ROAD',documentPrefix:'LOG',collectionProfileId:'logistics-revenue-v1'},
      hr:{managerRoleProfileId:'ceo-logistics-v1',staffingProfileId:'fleet-road-v1'},
      facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['logistics'],primaryKind:'logistics',siteTemplate:{label:'مركز لوجستي',facilityKind:'logistics',cost:8500000,dailyCost:12500,capacity:'42 موقفًا · حتى 140 شاحنة',deliveryCapacity:140,photo:'assets/images/facility-logistics-v2.webp',iconKey:'logistics',groupValueFactor:.72}},
      ui:{extensions:['fleet-company']},map:{layerProviderIds:['fleet-assets','company-facilities'],filterGroup:'transport',markerProfileId:'road'},
      conference:{providerId:'fleet-company-v1'},adapters:{operations:'fleet-route-road-v1',facilities:'logistics-network-v1',map:'fleet-map-v1',conference:'fleet-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:['road'],routeOwnerModes:['road'],assetClassByMode:{road:'truck'}}
    }),
    subsidiary({
      id:'power',definitionId:'gh-energy-v1',order:40,
      instancePolicy:{mode:'canonical-only',stateScope:'legacy-root'},
      identity:identity('شركة جلوبال هولدينغز للطاقة','Global Holdings Energy Company','جي إتش إنرجي','GH ENERGY','GH ENERGY','assets/identity/gh-energy.svg','#d0a33f','#5c4a1e','#d0a33f','assets/images/company-energy-v2.webp',['الطاقة العالمية','شركة الطاقة العالمية']),
      classification:{primarySectorId:'power',sectorIds:['power'],operationProfileId:'energy-project-v1',assetClasses:['energy-project'],routeModes:[]},
      capabilities:['operations.energy','facility.energy'],
      founding:{defaultCapital:55000000,minimumCapital:55000000,documentPrefix:'NRG'},
      finance:{accountPrefix:'POWER',documentPrefix:'NRG',collectionProfileId:'energy-revenue-v1'},
      hr:{managerRoleProfileId:'ceo-energy-v1',staffingProfileId:'energy-project-v1'},
      facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['power'],primaryKind:'power',siteTemplate:{label:'محطة طاقة',facilityKind:'power',cost:82000000,dailyCost:38000,capacity:'مشروع شمسي 100MW كبداية',deliveryCapacity:0,photo:'assets/images/company-energy-v2.webp',iconKey:'power',groupValueFactor:.38}},
      ui:{extensions:['energy-company']},map:{layerProviderIds:['energy-projects','company-facilities'],filterGroup:'infrastructure',markerProfileId:'power'},
      conference:{providerId:'energy-company-v1'},adapters:{operations:'energy-project-v1',facilities:'energy-sites-v1',map:'company-map-v1',conference:'energy-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
    }),
    subsidiary({
      id:'bank',definitionId:'gh-bank-v1',order:50,
      instancePolicy:{mode:'canonical-only',stateScope:'legacy-root'},
      identity:identity('شركة جلوبال هولدينغز المصرفية','Global Holdings Banking Company','جي إتش بنك','GH BANK','GH BANK','assets/identity/gh-bank.svg','#735bc7','#34286c','#735bc7','assets/images/company-bank-v2.webp',['بنك المجموعة']),
      classification:{primarySectorId:'bank',sectorIds:['bank'],operationProfileId:'banking-services-v1',assetClasses:[],routeModes:[]},
      capabilities:['operations.bank','facility.bank'],
      founding:{defaultCapital:75000000,minimumCapital:75000000,documentPrefix:'BNK'},
      finance:{accountPrefix:'BANK',documentPrefix:'BNK',collectionProfileId:'banking-revenue-v1',internalBankEligible:false,cashPoolEligible:false},
      hr:{managerRoleProfileId:'ceo-bank-v1',staffingProfileId:'bank-branch-v1'},
      facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['bank'],primaryKind:'bank',siteTemplate:{label:'فرع مصرفي',facilityKind:'bank',cost:15000000,dailyCost:18500,capacity:'حسابات وودائع وبطاقات وتمويل أفراد وشركات',deliveryCapacity:0,photo:'assets/images/company-bank-v2.webp',iconKey:'bank',groupValueFactor:.72}},
      ui:{extensions:['bank-company']},map:{layerProviderIds:['bank-branches','company-facilities'],filterGroup:'services',markerProfileId:'bank'},
      conference:{providerId:'bank-company-v1'},adapters:{operations:'banking-services-v1',facilities:'bank-network-v1',map:'company-map-v1',conference:'bank-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
    }),
    subsidiary({
      id:'mobility',definitionId:'gh-mobility-v1',order:60,
      instancePolicy:{mode:'canonical-only',stateScope:'legacy-root'},
      identity:identity('شركة جلوبال هولدينغز للتنقل الذكي','Global Holdings Smart Mobility Company','جي إتش موبيليتي','GH MOBILITY','GH MOBILITY','assets/identity/gh-mobility.svg','#1a9a6b','#15563f','#1a9a6b','assets/images/company-system-v2.webp',['GH Mobility للتنقل الذكي']),
      classification:{primarySectorId:'mobility',sectorIds:['mobility'],operationProfileId:'mobility-fleet-v1',assetClasses:['mobility-vehicle'],routeModes:[]},
      capabilities:['operations.mobility','asset.mobility-vehicle','facility.mobility'],
      founding:{defaultCapital:120000000,minimumCapital:120000000,documentPrefix:'MOVE'},
      finance:{accountPrefix:'MOBILITY',documentPrefix:'MOVE',collectionProfileId:'mobility-revenue-v1'},
      hr:{managerRoleProfileId:'ceo-mobility-v1',staffingProfileId:'mobility-center-v1'},
      facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['mobility-center'],primaryKind:'mobility-center',siteTemplate:{label:'مركز تنقل حضري',facilityKind:'mobility-center',cost:4500000,dailyCost:9800,capacity:'120 سيارة · عاصمة فقط',deliveryCapacity:120,photo:'assets/images/facility-logistics-v2.webp',iconKey:'mobility',groupValueFactor:.72}},
      ui:{extensions:['mobility-company']},map:{layerProviderIds:['mobility-fleet','company-facilities'],filterGroup:'transport',markerProfileId:'mobility'},
      conference:{providerId:'mobility-company-v1'},adapters:{operations:'mobility-fleet-v1',facilities:'mobility-network-v1',map:'mobility-map-v1',conference:'mobility-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:['mobility'],routeOwnerModes:[],assetClassByMode:{mobility:'mobility-vehicle'}}
    })
  ]);
  const BUILTIN_COMPANY_IDS=Object.freeze(BUILTIN_DEFINITIONS.filter(row=>row.kind!=='holding').map(row=>row.id));
  const byId=new Map(BUILTIN_DEFINITIONS.map(row=>[row.id,row]));
  const byDefinitionId=new Map(BUILTIN_DEFINITIONS.map(row=>[row.definitionId,row]));
  const list=()=>[...BUILTIN_DEFINITIONS];
  const get=id=>byId.get(String(id||''))||byDefinitionId.get(String(id||''))||null;

  const API=Object.freeze({VERSION,FORMAT,BUILTIN_DEFINITIONS,BUILTIN_COMPANY_IDS,list,get});
  globalThis.GH_COMPANY_DEFINITIONS=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_COMPANY_DEFINITIONS=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
