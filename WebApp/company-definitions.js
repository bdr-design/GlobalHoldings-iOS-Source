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
  const identity=(legalAr,legalEn,tradeAr,tradeEn,short,logo,accent,secondary,route,hero,legacyLegalNames=[],horizontalLogo=logo)=>({
    legalDefault:{ar:legalAr,en:legalEn},trade:{ar:tradeAr,en:tradeEn},short,
    legacyLegalNames,marks:{default:logo,symbol:logo,horizontal:horizontalLogo,seal:logo,mono:logo},
    palette:{accent,secondary,route,onAccent:'#ffffff'},hero
  });
  // Build 358: how the group's name brands each subsidiary (GH_COMPANY_PLATFORM.brandedIdentity): «العساف» + «للطيران».
  // Logo family «ج» (GH_IDENTITY.familyLogo): the sector glyph above a band that carries the group's abbreviation.
  const GLYPH=Object.freeze({
    air:'<path d="M17 54 77 24 58 47l20 9-9 8-25-5-14 16-7-6 8-15-14 6z" fill="#fff"/><path d="m52 45 25-21-18 27z" fill="#75dcd1"/>',
    sea:'<path d="M26 30h44v24H26z" fill="#fff" opacity=".94"/><path d="M19 51h58l-8 17c-13 8-29 8-42 0z" fill="#fff"/><path d="M19 75c9 5 18 5 28 0 9-5 18-5 30 0" fill="none" stroke="#66ddd0" stroke-width="7" stroke-linecap="round"/><path d="M35 21h25v9H35z" fill="#e5bd68"/>',
    road:'<path d="M18 33h46v30H18zM64 43h11l8 10v10H64z" fill="#fff"/><circle cx="32" cy="68" r="8" fill="#e9b66a"/><circle cx="69" cy="68" r="8" fill="#e9b66a"/><path d="M29 24h42M65 18l8 6-8 6" fill="none" stroke="#75ddcf" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
    power:'<circle cx="48" cy="48" r="28" fill="none" stroke="#f8fbfa" stroke-width="8"/><path d="M53 18 31 53h17l-6 25 24-38H49z" fill="#e8bd5f"/><path d="M18 48h10M68 48h10M48 18v8M48 70v8" stroke="#73dbce" stroke-width="5" stroke-linecap="round"/>',
    bank:'<path d="M16 39 48 20l32 19v8H16zM22 51h9v22h-9zm21 0h10v22H43zm22 0h9v22h-9zM16 77h64v8H16z" fill="#fff"/><circle cx="48" cy="35" r="6" fill="#e3bd67"/><path d="M21 43h54" stroke="#77dfd1" stroke-width="4"/>',
    mobility:'<path d="M48 16c-17 0-30 12-30 28 0 21 30 39 30 39s30-18 30-39c0-16-13-28-30-28z" fill="#fff"/><path d="M31 50h34l-4-13H35zM29 50h38v13H29z" fill="#1a9a6b"/><circle cx="37" cy="64" r="5" fill="#e5bc67"/><circle cx="59" cy="64" r="5" fill="#e5bc67"/><path d="M38 43h20" stroke="#8be6d9" stroke-width="4" stroke-linecap="round"/>',
    insurance:'<path d="M48 16 22 26v20c0 17 11 29 26 34 15-5 26-17 26-34V26z" fill="#fff"/><path d="m36 48 9 9 16-18" fill="none" stroke="#1f7a8c" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 30h36" stroke="#e6bd65" stroke-width="4" stroke-linecap="round"/>',
    realestate:'<path d="M18 80V44l18-12v48zM40 80V24l22-10v66zM66 80V40l14 8v32z" fill="#fff"/><path d="M47 30h8M47 42h8M47 54h8M47 66h8M24 52h6M24 64h6" stroke="#b5703a" stroke-width="4" stroke-linecap="round"/><path d="M14 82h68" stroke="#e7bd66" stroke-width="5" stroke-linecap="round"/>'});
  // Build 358: how the group's name brands each subsidiary (GH_COMPANY_PLATFORM.brandedIdentity): «العساف» + «للطيران».
  const BRAND=Object.freeze({air:{ar:'للطيران',en:'Aviation',short:'AIR',glyph:GLYPH.air},sea:{ar:'للشحن البحري',en:'Marine',short:'MARINE',glyph:GLYPH.sea},road:{ar:'للنقل',en:'Logistics',short:'LOGISTICS',glyph:GLYPH.road},
    power:{ar:'للطاقة',en:'Energy',short:'ENERGY',glyph:GLYPH.power},bank:{prefix:'بنك',legalAr:'المصرفية',en:'Bank',short:'BANK',glyph:GLYPH.bank},mobility:{ar:'للتنقل الذكي',en:'Mobility',short:'MOBILITY',glyph:GLYPH.mobility},
    insurance:{ar:'للتأمين',en:'Insurance',short:'INSURANCE',glyph:GLYPH.insurance},realestate:{ar:'للتطوير العقاري',en:'Real Estate',short:'REAL ESTATE',glyph:GLYPH.realestate}});
  const subsidiary=(data)=>({
    ...data,identity:{...data.identity,brand:BRAND[data.id]||null},schema:FORMAT,definitionVersion:1,kind:'subsidiary',lifecycle:'active',
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
      identity:identity('المجموعة العالمية القابضة','Global Holdings Group','جلوبال هولدينغز','Global Holdings','GH','assets/identity/approved/group-symbol.webp','#d0a34a','#0d3b57','#d0a34a','assets/images/company-hq-v2.webp',[],'assets/identity/approved/group-horizontal.webp'),
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
      identity:identity('شركة جلوبال هولدينغز للطيران','Global Holdings Aviation Company','جي إتش إير','GH AIR','GH AIR','assets/identity/approved/air-symbol.webp','#2d72df','#123f69','#2d72df','assets/images/air-cargo.webp',['الشركة العالمية للطيران'],'assets/identity/approved/air-horizontal.webp'),
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
      identity:identity('شركة جلوبال هولدينغز للشحن البحري','Global Holdings Marine Shipping Company','جي إتش مارين','GH MARINE','GH MARINE','assets/identity/approved/sea-symbol.webp','#119c94','#0c5961','#12a99c','assets/images/ship-container.webp',['الشركة العالمية للشحن البحري'],'assets/identity/approved/sea-horizontal.webp'),
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
      identity:identity('شركة جلوبال هولدينغز للخدمات اللوجستية','Global Holdings Logistics Company','جي إتش لوجستيكس','GH LOGISTICS','GH LOGISTICS','assets/identity/approved/road-symbol.webp','#df8a3d','#65391f','#e08b3e','assets/images/facility-logistics-v2.webp',['اللوجستيات العالمية'],'assets/identity/approved/road-horizontal.webp'),
      classification:{primarySectorId:'road',sectorIds:['road'],operationProfileId:'fleet-route-road-v1',assetClasses:['truck'],routeModes:['road']},
      capabilities:['operations.fleet','asset.truck','route.road','facility.logistics'],
      founding:{defaultCapital:12000000,minimumCapital:12000000,documentPrefix:'LOG'},
      finance:{accountPrefix:'ROAD',documentPrefix:'LOG',collectionProfileId:'logistics-revenue-v1'},
      hr:{managerRoleProfileId:'ceo-logistics-v1',staffingProfileId:'fleet-road-v1'},
      facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['logistics'],primaryKind:'logistics',siteTemplate:{label:'مركز لوجستي',facilityKind:'logistics',cost:8500000,dailyCost:12500,capacity:'42 موقفًا · سعة أسطول حتى 1,000,000 شاحنة',deliveryCapacity:1000000,photo:'assets/images/facility-logistics-v2.webp',iconKey:'logistics',groupValueFactor:.72}},
      ui:{extensions:['fleet-company']},map:{layerProviderIds:['fleet-assets','company-facilities'],filterGroup:'transport',markerProfileId:'road'},
      conference:{providerId:'fleet-company-v1'},adapters:{operations:'fleet-route-road-v1',facilities:'logistics-network-v1',map:'fleet-map-v1',conference:'fleet-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:['road'],routeOwnerModes:['road'],assetClassByMode:{road:'truck'}}
    }),
    subsidiary({
      id:'power',definitionId:'gh-energy-v1',order:40,
      instancePolicy:{mode:'canonical-only',stateScope:'legacy-root'},
      identity:identity('شركة جلوبال هولدينغز للطاقة','Global Holdings Energy Company','جي إتش إنرجي','GH ENERGY','GH ENERGY','assets/identity/approved/power-symbol.webp','#d0a33f','#5c4a1e','#d0a33f','assets/images/company-energy-v2.webp',['الطاقة العالمية','شركة الطاقة العالمية'],'assets/identity/approved/power-horizontal.webp'),
      classification:{primarySectorId:'power',sectorIds:['power'],operationProfileId:'energy-project-v1',assetClasses:['energy-project'],routeModes:[]},
      capabilities:['operations.energy','facility.energy'],
      founding:{defaultCapital:55000000,minimumCapital:55000000,documentPrefix:'NRG'},
      finance:{accountPrefix:'POWER',documentPrefix:'NRG',collectionProfileId:'energy-revenue-v1'},
      hr:{managerRoleProfileId:'ceo-energy-v1',staffingProfileId:'energy-project-v1'},
      facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['power'],primaryKind:'power',siteTemplate:{label:'محطة طاقة',facilityKind:'power',cost:82000000,dailyCost:12000,capacity:'مشروع شمسي 100MW كبداية',deliveryCapacity:0,photo:'assets/images/company-energy-v2.webp',iconKey:'power',groupValueFactor:.38}},
      ui:{extensions:['energy-company']},map:{layerProviderIds:['energy-projects','company-facilities'],filterGroup:'infrastructure',markerProfileId:'power'},
      conference:{providerId:'energy-company-v1'},adapters:{operations:'energy-project-v1',facilities:'energy-sites-v1',map:'company-map-v1',conference:'energy-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
    }),
    subsidiary({
      id:'bank',definitionId:'gh-bank-v1',order:50,
      instancePolicy:{mode:'canonical-only',stateScope:'legacy-root'},
      identity:identity('شركة جلوبال هولدينغز المصرفية','Global Holdings Banking Company','جي إتش بنك','GH BANK','GH BANK','assets/identity/approved/bank-symbol.webp','#735bc7','#34286c','#735bc7','assets/images/company-bank-v2.webp',['بنك المجموعة'],'assets/identity/approved/bank-horizontal.webp'),
      classification:{primarySectorId:'bank',sectorIds:['bank'],operationProfileId:'banking-services-v1',assetClasses:[],routeModes:[]},
      capabilities:['operations.bank','facility.bank'],
      founding:{defaultCapital:75000000,minimumCapital:75000000,documentPrefix:'BNK'},
      finance:{accountPrefix:'BANK',documentPrefix:'BNK',collectionProfileId:'banking-revenue-v1',internalBankEligible:false,cashPoolEligible:false},
      hr:{managerRoleProfileId:'ceo-bank-v1',staffingProfileId:'bank-branch-v1'},
      facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['bank'],primaryKind:'bank',siteTemplate:{label:'فرع مصرفي',facilityKind:'bank',cost:15000000,dailyCost:5500,capacity:'حسابات وودائع وبطاقات وتمويل أفراد وشركات',deliveryCapacity:0,photo:'assets/images/company-bank-v2.webp',iconKey:'bank',groupValueFactor:.72}},
      ui:{extensions:['bank-company']},map:{layerProviderIds:['bank-branches','company-facilities'],filterGroup:'services',markerProfileId:'bank'},
      conference:{providerId:'bank-company-v1'},adapters:{operations:'banking-services-v1',facilities:'bank-network-v1',map:'company-map-v1',conference:'bank-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
    }),
    subsidiary({
      id:'mobility',definitionId:'gh-mobility-v1',order:60,
      instancePolicy:{mode:'canonical-only',stateScope:'legacy-root'},
      identity:identity('شركة جلوبال هولدينغز للتنقل الذكي','Global Holdings Smart Mobility Company','جي إتش موبيليتي','GH MOBILITY','GH MOBILITY','assets/identity/approved/mobility-symbol.webp','#1a9a6b','#15563f','#1a9a6b','assets/images/company-system-v2.webp',['GH Mobility للتنقل الذكي'],'assets/identity/approved/mobility-horizontal.webp'),
      classification:{primarySectorId:'mobility',sectorIds:['mobility'],operationProfileId:'mobility-fleet-v1',assetClasses:['mobility-vehicle'],routeModes:[]},
      capabilities:['operations.mobility','asset.mobility-vehicle','facility.mobility'],
      founding:{defaultCapital:120000000,minimumCapital:120000000,documentPrefix:'MOVE'},
      finance:{accountPrefix:'MOBILITY',documentPrefix:'MOVE',collectionProfileId:'mobility-revenue-v1'},
      hr:{managerRoleProfileId:'ceo-mobility-v1',staffingProfileId:'mobility-center-v1'},
      facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['mobility-center'],primaryKind:'mobility-center',siteTemplate:{label:'مركز تنقل حضري',facilityKind:'mobility-center',cost:4500000,dailyCost:2200,capacity:'3,000 سيارة · عاصمة فقط',deliveryCapacity:3000,photo:'assets/images/facility-logistics-v2.webp',iconKey:'mobility',groupValueFactor:.72}},
      // Mobility vehicles are managed inside the company and never drawn on the world map.
      // Owned city centers remain ordinary facilities and stay visible there.
      ui:{extensions:['mobility-company']},map:{layerProviderIds:['company-facilities'],filterGroup:'services',markerProfileId:'mobility'},
      conference:{providerId:'mobility-company-v1'},adapters:{operations:'mobility-fleet-v1',facilities:'mobility-network-v1',map:'mobility-map-v1',conference:'mobility-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:['mobility'],routeOwnerModes:[],assetClassByMode:{mobility:'mobility-vehicle'}}
    }),
    // Build 358 (owner request): two management companies without a fleet. Their offices come from the world directory
    // (one per capital); the customer base of each office is its country's population (GH_INSURANCE_CORE,
    // GH_REALESTATE_CORE), and the player runs them through pricing, underwriting, development and leasing decisions.
    subsidiary({
      id:'insurance',definitionId:'gh-insurance-v1',order:70,
      instancePolicy:{mode:'canonical-only',stateScope:'legacy-root'},
      identity:identity('شركة جلوبال هولدينغز للتأمين','Global Holdings Insurance Company','جي إتش للتأمين','GH INSURANCE','GH INSURANCE','assets/identity/approved/insurance-symbol.webp','#1f7a8c','#16495a','#1f7a8c','assets/images/company-system-v2.webp',[],'assets/identity/approved/insurance-horizontal.webp'),
      classification:{primarySectorId:'insurance',sectorIds:['insurance'],operationProfileId:'insurance-services-v1',assetClasses:[],routeModes:[]},
      capabilities:['operations.insurance','facility.insurance'],
      founding:{defaultCapital:60000000,minimumCapital:60000000,documentPrefix:'INS'},
      finance:{accountPrefix:'INSURANCE',documentPrefix:'INS',collectionProfileId:'insurance-revenue-v1'},
      hr:{managerRoleProfileId:'ceo-insurance-v1',staffingProfileId:'insurance-office-v1'},
      facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['insurance'],primaryKind:'insurance',siteTemplate:{label:'مكتب تأمين',facilityKind:'insurance',cost:6000000,dailyCost:9500,capacity:'مبيعات وثائق ومركز مطالبات لسكان الدولة',deliveryCapacity:0,photo:'assets/images/company-system-v2.webp',iconKey:'insurance',groupValueFactor:.72}},
      ui:{extensions:['insurance-company']},map:{layerProviderIds:['company-facilities'],filterGroup:'services',markerProfileId:'insurance'},
      conference:{providerId:'generic-company-v1'},adapters:{operations:'insurance-services-v1',facilities:'insurance-network-v1',map:'company-map-v1',conference:'generic-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
    }),
    subsidiary({
      id:'realestate',definitionId:'gh-realestate-v1',order:80,
      instancePolicy:{mode:'canonical-only',stateScope:'legacy-root'},
      identity:identity('شركة جلوبال هولدينغز للتطوير العقاري','Global Holdings Real Estate Development Company','جي إتش العقارية','GH REAL ESTATE','GH REAL ESTATE','assets/identity/approved/realestate-symbol.webp','#b5703a','#5a3a22','#b5703a','assets/images/company-hq-v2.webp',[],'assets/identity/approved/realestate-horizontal.webp'),
      classification:{primarySectorId:'realestate',sectorIds:['realestate'],operationProfileId:'real-estate-v1',assetClasses:[],routeModes:[]},
      capabilities:['operations.realestate','facility.realestate'],
      founding:{defaultCapital:150000000,minimumCapital:150000000,documentPrefix:'RLE'},
      finance:{accountPrefix:'REALESTATE',documentPrefix:'RLE',collectionProfileId:'realestate-revenue-v1'},
      hr:{managerRoleProfileId:'ceo-realestate-v1',staffingProfileId:'realestate-office-v1'},
      facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['realestate'],primaryKind:'realestate',siteTemplate:{label:'مكتب تطوير وتأجير عقاري',facilityKind:'realestate',cost:5000000,dailyCost:1800,capacity:'مبيعات وتأجير ومشاريع في المدينة',deliveryCapacity:0,photo:'assets/images/company-hq-v2.webp',iconKey:'realestate',groupValueFactor:.72}},
      ui:{extensions:['realestate-company']},map:{layerProviderIds:['company-facilities'],filterGroup:'services',markerProfileId:'realestate'},
      conference:{providerId:'generic-company-v1'},adapters:{operations:'real-estate-v1',facilities:'realestate-network-v1',map:'company-map-v1',conference:'generic-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
    }),
    // Customer-first companies. They have no map asset classes: their value is
    // created by customer contracts, recurring bills and retail transactions.
    subsidiary({
      id:'telecom',definitionId:'gh-telecom-v1',order:90,
      instancePolicy:{mode:'canonical-only',stateScope:'legacy-root'},
      identity:identity('شركة جلوبال هولدينغز للاتصالات','Global Holdings Telecom Company','جي إتش تيليكوم','GH TELECOM','GH TEL','assets/identity/approved/telecom-symbol.webp','#1688a8','#123f59','#1688a8','assets/images/company-system-v2.webp',[],'assets/identity/approved/telecom-horizontal.webp'),
      classification:{primarySectorId:'telecom',sectorIds:['telecom'],operationProfileId:'telecom-customer-cycle-v1',assetClasses:[],routeModes:[]},
      capabilities:['operations.telecom','facility.telecom'],
      founding:{defaultCapital:45000000,minimumCapital:45000000,documentPrefix:'TEL'},
      finance:{accountPrefix:'TELECOM',documentPrefix:'TEL',collectionProfileId:'telecom-revenue-v1'},
      hr:{managerRoleProfileId:'ceo-telecom-v1',staffingProfileId:'telecom-customer-operations-v1'},
      facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['telecom-branch'],primaryKind:'telecom-branch',siteTemplate:{label:'فرع اتصالات',facilityKind:'telecom-branch',cost:5200000,dailyCost:4200,capacity:'مبيعات الشركات وخدمة المشتركين والفوترة والتحصيل',deliveryCapacity:0,photo:'assets/images/company-system-v2.webp',iconKey:'telecom',groupValueFactor:.72}},
      ui:{extensions:['telecom-customer-company']},map:{layerProviderIds:['company-facilities'],filterGroup:'services',markerProfileId:'telecom'},
      conference:{providerId:'generic-company-v1'},adapters:{operations:'telecom-customer-v1',conference:'generic-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
    }),
    subsidiary({
      id:'dealership',definitionId:'gh-dealership-v1',order:100,
      instancePolicy:{mode:'canonical-only',stateScope:'legacy-root'},
      identity:identity('شركة جلوبال هولدينغز لوكالات السيارات','Global Holdings Automotive Retail Company','جي إتش أوتو','GH AUTO','GH AUTO','assets/identity/approved/dealership-symbol.webp','#c47b35','#57371f','#cf8135','assets/images/company-system-v2.webp',[],'assets/identity/approved/dealership-horizontal.webp'),
      classification:{primarySectorId:'dealership',sectorIds:['dealership','automotive-retail'],operationProfileId:'automotive-retail-customer-cycle-v1',assetClasses:[],routeModes:[]},
      capabilities:['operations.dealer','facility.dealership'],
      founding:{defaultCapital:65000000,minimumCapital:65000000,documentPrefix:'AUTO'},
      finance:{accountPrefix:'AUTORETAIL',documentPrefix:'AUTO',collectionProfileId:'dealership-revenue-v1'},
      hr:{managerRoleProfileId:'ceo-dealership-v1',staffingProfileId:'automotive-retail-v1'},
      facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['dealership-branch'],primaryKind:'dealership-branch',siteTemplate:{label:'وكالة سيارات',facilityKind:'dealership-branch',cost:8500000,dailyCost:6800,capacity:'عرض السيارات والمبيعات وخدمة ما بعد البيع وتمويل العملاء',deliveryCapacity:0,photo:'assets/images/company-system-v2.webp',iconKey:'dealership',groupValueFactor:.72}},
      ui:{extensions:['automotive-retail-company']},map:{layerProviderIds:['company-facilities'],filterGroup:'services',markerProfileId:'dealership'},
      conference:{providerId:'generic-company-v1'},adapters:{operations:'dealership-retail-v1',conference:'generic-company-v1'},
      legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
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
