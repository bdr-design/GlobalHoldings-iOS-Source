(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const clone = value => {
    // Preserve JSON clone semantics (including non-finite numbers and -0),
    // without serializing immutable scalar fields for every fleet record.
    if(value===undefined||value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number')return Number.isFinite(value)?(value===0?0:value):null;
    return JSON.parse(JSON.stringify(value));
  };
  const fmtMoney = value => {
    const sign = value < 0 ? '-' : '';
    const n = Math.abs(Number(value) || 0);
    if (n >= 1e12) return `${sign}$${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `${sign}$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${sign}$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${sign}$${(n / 1e3).toFixed(1)}K`;
    return `${sign}$${n.toFixed(0)}`;
  };
  const fmtNumber = value => new Intl.NumberFormat('ar-SA', {maximumFractionDigits: 0}).format(value || 0);
  const fmtStars = value => { const full=Math.round(clamp(value,0,5)*2)/2; let s=''; for(let i=1;i<=5;i++){ s += i<=full?'★':(i-0.5===full?'⯨':'☆'); } return s; };
  const APP_VERSION = '3.0.0';
  // مؤشر تشخيص حقيقي: هذا الرقم مضمّن داخل app.js نفسه (وليس ملف إعداد منفصل)، فيظهر على الشاشة
  // بالضبط ما يشغّله الجهاز فعليًا الآن. إذا لم يطابق آخر رقم BUILD مرفوع، فهذا دليل قاطع أن نسخة
  // WebApp المحفوظة على الجهاز لم تُستبدل بالنسخة الجديدة من الـIPA، بدل التخمين بلا أي وسيلة تحقق.
  const RUNTIME_BUILD = 340;
  const SAVE_SCHEMA_VERSION = '2.0.0';
  const FOUNDER_PRINCIPAL_ID='PLAYER-FOUNDER';
  // Keep the storage key stable across compatible app releases so existing saves are not orphaned.
  const storageKey = `global-holdings-world-v${SAVE_SCHEMA_VERSION}`;
  const resetMarkerKey = 'global-holdings-reset-epoch';
  let hardResetInProgress=false,hardResetSettlement=Promise.resolve({committed:false});
  let durableCommandInProgress=false;
  let mapInteractionActive=false,lastMarkerFrameAt=0,lastHudRefreshAt=0,lastMapStructureSignature='',visualResyncRequested=false;
  const markerMotionStates=new Map();let markerVisualCarry=new Map();
  const legacyStorageKeys = ['global-holdings-world-v1.2.0','global-holdings-world-v1.1.0','global-holdings-premium-v1.0.0','global-holdings-clean-v0.1.2'];
  const SIM_START = Date.UTC(2026, 0, 1, 0, 0, 0);
  const EARTH_RADIUS_KM = 6371.0088;
  const COMPANY_PLATFORM=window.GH_COMPANY_PLATFORM;
  const MAP_FEATURE_CORE=window.GH_MAP_FEATURE_CORE;
  if(!COMPANY_PLATFORM?.listDefinitions||!COMPANY_PLATFORM?.resolveCompany)throw new Error('Company Platform failed to load before app.js');
  if(!MAP_FEATURE_CORE?.normalizeFilterState||!MAP_FEATURE_CORE?.featureVisible)throw new Error('Map Feature Core failed to load before app.js');
  const assetModeOf=asset=>String(asset?.assetMode||asset?.type||'').trim();
  const routeModeOf=route=>String(route?.routeMode||route?.type||'').trim();
  const assetOwnerCompanyId=asset=>String(asset?.ownerCompanyId||asset?.companyId||COMPANY_PLATFORM.ownerForLegacyAssetMode?.(assetModeOf(asset))||'').trim();
  const routeOwnerCompanyId=route=>String(route?.ownerCompanyId||route?.companyId||COMPANY_PLATFORM.ownerForLegacyRouteMode?.(routeModeOf(route))||'').trim();
  const facilityOwnerCompanyId=facility=>String(facility?.ownerCompanyId||facility?.companyId||facility?.company||'group').trim();
  const isKnownCompanyId=(id,target=window.__GH_STATE__||null)=>COMPANY_PLATFORM.isKnownCompany?.(String(id||'').trim(),target)===true;
  const companyDefinition=id=>COMPANY_PLATFORM.definitionFor?.(state,id)||COMPANY_PLATFORM.getDefinition?.(id)||null;
  function normalizeCanonicalAsset(asset,target=window.__GH_STATE__||null){
    if(!asset||typeof asset!=='object')throw new Error('asset-record-invalid');
    const assetMode=assetModeOf(asset),ownerCompanyId=assetOwnerCompanyId(asset),assetClass=String(asset.assetClass||COMPANY_PLATFORM.assetClassForLegacyMode?.(assetMode)||'').trim(),operationProfileId=String(asset.operationProfileId||(target?COMPANY_PLATFORM.getOperationProfile?.(target,ownerCompanyId):COMPANY_PLATFORM.getOperationProfile?.(ownerCompanyId))||COMPANY_PLATFORM.operationProfileForLegacyMode?.(assetMode)||'').trim();
    if(!assetMode||!ownerCompanyId||!assetClass||!isKnownCompanyId(ownerCompanyId,target))throw new Error(`asset-ownership-unresolved:${asset.id||'unknown'}`);
    asset.assetMode=assetMode;asset.ownerCompanyId=ownerCompanyId;asset.assetClass=assetClass;if(operationProfileId)asset.operationProfileId=operationProfileId;return asset;
  }

  // ---- اقتصاد حقيقي: أسعار ومعدلات مرجعية تُستخدم فعليًا في حساب كل رحلة ----
  const FUEL_PRICE = { jetA1: 0.86, bunker: 640, diesel: 0.98 }; // $/kg وقود طائرات، $/طن وقود سفن، $/لتر ديزل
  const YIELD_RATE = { paxKm: 0.11, cargoTonKm: 0.32, teuNm: 0.031, seaTonNm:0.018, cruiseGuestNm:.34, roadTonKm: 0.15 }; // إيراد لكل وحدة-مسافة
  const UTIL = { air: 0.82, sea: 0.78, road: 0.86 }; // معدل إشغال افتراضي عند التشغيل الطبيعي
  const MAINT_RESERVE_RATE = 0.04; // نسبة من إيراد كل رحلة تُحجز احتياطي صيانة

  function haversine(a, b) {
    const rad = Math.PI / 180;
    const lat1 = a[0] * rad, lat2 = b[0] * rad;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
  }
  function bearingBetween(a, b) {
    const rad = Math.PI / 180, deg = 180 / Math.PI;
    const lat1 = a[0] * rad, lat2 = b[0] * rad, dLon = (b[1] - a[1]) * rad;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * deg + 360) % 360;
  }
  function routeDistance(route) {
    let d = 0;
    for (let i = 0; i < route.length - 1; i++) d += haversine(route[i], route[i + 1]);
    return d;
  }
  function greatCircle(a, b, steps = 36) {
    const rad = Math.PI / 180, deg = 180 / Math.PI;
    const lat1 = a[0] * rad, lon1 = a[1] * rad, lat2 = b[0] * rad, lon2 = b[1] * rad;
    const p1 = [Math.cos(lat1) * Math.cos(lon1), Math.cos(lat1) * Math.sin(lon1), Math.sin(lat1)];
    const p2 = [Math.cos(lat2) * Math.cos(lon2), Math.cos(lat2) * Math.sin(lon2), Math.sin(lat2)];
    const dot = clamp(p1[0]*p2[0] + p1[1]*p2[1] + p1[2]*p2[2], -1, 1);
    const omega = Math.acos(dot), sinOmega = Math.sin(omega);
    if (sinOmega < 1e-8) return [a, b];
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const s1 = Math.sin((1 - t) * omega) / sinOmega;
      const s2 = Math.sin(t * omega) / sinOmega;
      const x = s1 * p1[0] + s2 * p2[0];
      const y = s1 * p1[1] + s2 * p2[1];
      const z = s1 * p1[2] + s2 * p2[2];
      points.push([Math.atan2(z, Math.sqrt(x*x + y*y)) * deg, Math.atan2(y, x) * deg]);
    }
    return points;
  }
  function interpolateRoute(route, progress) {
    if (!route || route.length < 2) return route?.[0] || [0, 0];
    const segs = [];
    let total = 0;
    for (let i = 0; i < route.length - 1; i++) {
      const d = haversine(route[i], route[i + 1]);
      segs.push(d); total += d;
    }
    let target = clamp(progress, 0, 1) * total;
    for (let i = 0; i < segs.length; i++) {
      if (target <= segs[i]) {
        const t = segs[i] === 0 ? 0 : target / segs[i];
        return [
          route[i][0] + (route[i + 1][0] - route[i][0]) * t,
          ((route[i][1] + shortestLongitudeDelta(route[i][1],route[i + 1][1]) * t + 540) % 360) - 180
        ];
      }
      target -= segs[i];
    }
    return route[route.length - 1];
  }

  // ---- مكتبة مرئية محلية موحدة؛ بلا شعارات أو روابط صور خارجية ----
  const PHOTOS = {
    air_narrow_new:'assets/images/air-narrow.webp',air_wide_new:'assets/images/air-widebody.webp',air_cargo_new:'assets/images/air-cargo.webp',
    air_narrow_used:'assets/images/air-narrow.webp',air_cargo_used:'assets/images/air-cargo.webp',
    sea_small_new:'assets/images/ship-container.webp',sea_large_new:'assets/images/ship-container.webp',sea_used:'assets/images/ship-container.webp',
    road_heavy_new:'assets/images/truck-longhaul-v2.webp',road_reefer_new:'assets/images/truck-reefer.webp',road_used:'assets/images/truck-longhaul-v2.webp',
    port_jed:'assets/images/ship-container.webp',port_sin:'assets/images/ship-container.webp',port_rtm:'assets/images/ship-tanker.webp',port_nyc:'assets/images/ship-container.webp',
    facility_hq:'assets/images/company-hq-v2.webp',facility_airport:'assets/images/facility-airport-v2.webp',facility_port:'assets/images/facility-port-v2.webp',
    facility_logistics:'assets/images/facility-logistics-v2.webp',facility_power:'assets/images/company-energy-v2.webp',facility_bank:'assets/images/company-bank-v2.webp'
  };

  // ---- فهرس البنية التحتية العالمي: 28k+ مطار و3.9k ميناء، محلي وقابل للبحث ----
  const WORLD = window.GH_WORLD_DATA || {meta:{airportCount:0,portCount:0},airports:[],ports:[]};
  const airportRowCache=new Map(),portRowCache=new Map(),portKeyCache=new Map(),worldEntityCache=new Map();
  function airportRowByCode(value){const code=String(value||'').toUpperCase();if(!code)return null;if(airportRowCache.has(code))return airportRowCache.get(code);let found=null;for(const row of WORLD.airports)if(row[0]===code||row[1]===code){found=row;break;}airportRowCache.set(code,found);if(found){airportRowCache.set(found[0],found);if(found[1])airportRowCache.set(found[1],found);}return found;}
  function airportRowsForCodes(codes){const requested=[...new Set((codes||[]).map(code=>String(code||'').toUpperCase()).filter(Boolean))],missing=new Set(requested.filter(code=>!airportRowCache.has(code)));if(missing.size)for(const row of WORLD.airports){for(const code of [row[0],row[1]])if(code&&missing.has(code)){airportRowCache.set(code,row);airportRowCache.set(row[0],row);if(row[1])airportRowCache.set(row[1],row);missing.delete(code);}if(!missing.size)break;}for(const code of missing)airportRowCache.set(code,null);return requested.map(code=>airportRowCache.get(code)).filter(Boolean);}
  function portRowByCode(value){const code=String(value||'').toUpperCase();if(!code)return null;if(portRowCache.has(code))return portRowCache.get(code);let found=null;for(const row of WORLD.ports)if(row[0]===code){found=row;break;}portRowCache.set(code,found);if(found)portKeyCache.set(`port:${found[0]}:${found[3]}:${found[4]}`,found);return found;}
  function portRowsForCodes(codes){const requested=[...new Set((codes||[]).map(code=>String(code||'').toUpperCase()).filter(Boolean))],missing=new Set(requested.filter(code=>!portRowCache.has(code)));if(missing.size)for(const row of WORLD.ports){if(missing.has(row[0])){portRowCache.set(row[0],row);portKeyCache.set(`port:${row[0]}:${row[3]}:${row[4]}`,row);missing.delete(row[0]);if(!missing.size)break;}}for(const code of missing)portRowCache.set(code,null);return requested.map(code=>portRowCache.get(code)).filter(Boolean);}
  function portRowByKey(key){key=String(key||'');if(portKeyCache.has(key))return portKeyCache.get(key);const parts=key.split(':'),row=parts[0]==='port'?portRowByCode(parts[1]):null;if(row&&`port:${row[0]}:${row[3]}:${row[4]}`===key){portKeyCache.set(key,row);return row;}portKeyCache.set(key,null);return null;}
  const regionNames = typeof Intl.DisplayNames==='function' ? new Intl.DisplayNames(['ar'],{type:'region'}) : null;
  const logisticsCenterName = place => place?.area ? `مركز ${place.city} — ${place.area}` : `مركز ${place?.label||'موقع مخصص'}`;
  const esc = value => String(value??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const normalizeSearch = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const countryLabel = code => {
    if(!code)return 'غير محدد';
    if(code.length===2){try{return regionNames?.of(code)||code;}catch{return code;}}
    return code.replace(/\b\w/g,c=>c.toUpperCase());
  };
  function rememberWorldEntity(entity){if(entity?.key)worldEntityCache.set(entity.key,entity);return entity||null;}
  function airportEntity(row){
    if(!row)return null;
    return rememberWorldEntity({key:`air:${row[0]}`,kind:'airport',icon:'🛫',code:row[1]||row[0],icao:row[0],iata:row[1],name:row[2],city:row[3]||row[4]||'—',subdivision:row[4],country:countryLabel(row[5]),countryCode:row[5],coords:[row[6],row[7]],elevationFt:row[8],commercial:!!row[1]});
  }
  function portEntity(row){
    if(!row)return null;
    return rememberWorldEntity({key:`port:${row[0]}:${row[3]}:${row[4]}`,kind:'port',icon:'⚓',code:row[0],name:row[1],city:row[1],country:countryLabel(row[2]),coords:[row[3],row[4]],terminal:!!row[5]});
  }
  function directoryWorldEntity(row){
    if(row?.provider==='world-airports'&&Array.isArray(row.coords))return rememberWorldEntity({key:row.sourceProviderKey||row.key,kind:'airport',icon:'🛫',code:row.code,icao:row.icao,iata:row.iata,name:row.name,city:row.city,country:row.country,countryCode:row.countryCode,coords:[...row.coords],elevationFt:row.elevationFt,commercial:!!row.commercial});
    if(row?.provider==='world-ports'&&Array.isArray(row.coords))return rememberWorldEntity({key:row.sourceProviderKey||row.key,kind:'port',icon:'⚓',code:row.code,name:row.name,city:row.city,country:row.country,coords:[...row.coords],terminal:!!row.terminal});
    return null;
  }
  function worldEntityByKey(key){
    key=String(key||'');if(worldEntityCache.has(key))return worldEntityCache.get(key);const parts=key.split(':');
    if(parts[0]==='air')return airportEntity(airportRowByCode(parts[1]));
    if(parts[0]==='port')return portEntity(portRowByKey(key));
    if(parts[0]==='site'){
      const company=parts[1],capital=(window.GH_MOBILITY_CORE?.CAPITALS||[]).find(row=>row.id===parts[2]);
      return capital?directorySiteEntity(capital,company):null;
    }
    return null;
  }
  function facilityPrice(entity){
    if(entity.kind==='company-site')return Number(entity.cost)||0;
    if(entity.kind==='airport')return entity.commercial?36000000:8500000;
    return entity.terminal?24000000:7200000;
  }
  function facilityDailyCost(entity){
    if(entity.kind==='company-site')return Number(entity.dailyCost)||0;
    if(entity.kind==='airport')return entity.commercial?42000:11000;
    return entity.terminal?31000:9000;
  }

  // ---- المنشآت: بيانات تشغيلية حقيقية لكل مطار/ميناء (وليست نصوصًا وصفية فقط) ----
  const facilities = [
    {id:'HQ-RUH', kind:'hq', owned:false, icon:'🏛️', name:'المقر العالمي — الرياض', city:'الرياض', country:'السعودية', coords:[24.7136,46.6753], photo:PHOTOS.facility_hq, detail:'المقر القانوني والإدارة التنفيذية ومركز التحكم العالمي.', capacity:'إدارة المجموعة', cost:0},
    {id:'AP-RUH', kind:'airport', public:true, icon:'🛫', name:'مطار الملك خالد الدولي', city:'الرياض', country:'السعودية', coords:[24.9576,46.6988], photo:PHOTOS.facility_airport,
      iata:'RUH', icao:'OERK', runwayM:4205, elevationM:625, gates:94, landingFeePerTon:14.2, jetA1Price:2.35, congestion:.28, detail:'مطار دولي وقاعدة تشغيل محتملة للطيران والشحن الجوي.', capacity:'ركاب + شحن', cost:0},
    {id:'AP-DXB', kind:'airport', public:true, icon:'🛫', name:'مطار دبي الدولي', city:'دبي', country:'الإمارات', coords:[25.2532,55.3657], photo:PHOTOS.facility_airport,
      iata:'DXB', icao:'OMDB', runwayM:4447, elevationM:10, gates:130, landingFeePerTon:16.8, jetA1Price:2.48, congestion:.61, detail:'عقدة دولية عالية الحركة؛ الرسوم والازدحام يؤثران في اقتصاد الخط.', capacity:'ركاب دولي', cost:0},
    {id:'AP-LHR', kind:'airport', public:true, icon:'🛫', name:'مطار لندن هيثرو', city:'لندن', country:'المملكة المتحدة', coords:[51.4700,-0.4543], photo:PHOTOS.facility_airport,
      iata:'LHR', icao:'EGLL', runwayM:3902, elevationM:25, gates:115, landingFeePerTon:22.4, jetA1Price:2.71, congestion:.74, detail:'مطار محوري؛ فتح قاعدة تشغيلية فيه يحتاج تكلفة تشغيل أعلى.', capacity:'ركاب + شحن', cost:0},
    {id:'AP-SIN', kind:'airport', public:true, icon:'🛫', name:'مطار سنغافورة شانغي', city:'سنغافورة', country:'سنغافورة', coords:[1.3644,103.9915], photo:PHOTOS.facility_airport,
      iata:'SIN', icao:'WSSS', runwayM:4000, elevationM:7, gates:140, landingFeePerTon:15.9, jetA1Price:2.40, congestion:.52, detail:'مطار دولي وعقدة جوية آسيوية.', capacity:'ركاب + شحن', cost:0},
    {id:'PT-JED', kind:'port', public:true, icon:'⚓', name:'ميناء جدة الإسلامي', city:'جدة', country:'السعودية', coords:[21.4858,39.1730], photo:PHOTOS.port_jed,
      code:'SAJED', berths:12, maxDraftM:16.0, craneCount:28, dryStorageTEU:45000, reeferPlugs:3200, crudeStorageBbl:1200000, fuelBunkerBbl:380000, detail:'ميناء حاويات وبوابة للبحر الأحمر؛ زمن الانتظار والمناولة يدخلان في تكلفة الرحلة.', capacity:'حاويات + بضائع', cost:0},
    {id:'PT-SIN', kind:'port', public:true, icon:'⚓', name:'ميناء سنغافورة', city:'سنغافورة', country:'سنغافورة', coords:[1.2640,103.8400], photo:PHOTOS.port_sin,
      code:'SGSIN', berths:18, maxDraftM:18.5, craneCount:45, dryStorageTEU:62000, reeferPlugs:5200, crudeStorageBbl:2100000, fuelBunkerBbl:640000, detail:'عقدة بحرية عالمية ومركز عبور للحاويات.', capacity:'حاويات عالمية', cost:0},
    {id:'PT-RTM', kind:'port', public:true, icon:'⚓', name:'ميناء روتردام', city:'روتردام', country:'هولندا', coords:[51.9500,4.1400], photo:PHOTOS.port_rtm,
      code:'NLRTM', berths:16, maxDraftM:20.0, craneCount:38, dryStorageTEU:58000, reeferPlugs:4800, crudeStorageBbl:3400000, fuelBunkerBbl:520000, detail:'بوابة بحرية رئيسية لأوروبا وشبكات النقل الداخلي.', capacity:'حاويات + طاقة', cost:0},
    {id:'PT-NYC', kind:'port', public:true, icon:'⚓', name:'ميناء نيويورك ونيوجيرسي', city:'نيويورك', country:'الولايات المتحدة', coords:[40.6840,-74.0400], photo:PHOTOS.port_nyc,
      code:'USNYC', berths:14, maxDraftM:15.2, craneCount:32, dryStorageTEU:51000, reeferPlugs:4100, crudeStorageBbl:900000, fuelBunkerBbl:410000, detail:'بوابة بحرية للساحل الشرقي الأمريكي.', capacity:'حاويات + بضائع', cost:0},
    {id:'DP-RUH', kind:'depot', public:true, owned:false, icon:'🚚', name:'مركز تشغيل الرياض', city:'الرياض', country:'السعودية', coords:[24.6485,46.7160], photo:PHOTOS.facility_logistics, bays:38, detail:'Depot للشاحنات والسائقين والصيانة الخفيفة؛ منفصل عن المقر الإداري.', capacity:'120 شاحنة', cost:0},
    {id:'DP-DXB', kind:'depot', public:true, owned:false, icon:'🚚', name:'مركز تشغيل دبي', city:'دبي', country:'الإمارات', coords:[24.9857,55.0750], photo:PHOTOS.facility_logistics, bays:26, detail:'مركز عبور إقليمي للنقل البري وربط الموانئ والأسواق الخليجية.', capacity:'80 شاحنة', cost:0},
    {id:'EN-RUH', kind:'power', public:true, owned:false, icon:'⚡', name:'محطة طاقة المجموعة — الرياض', city:'الرياض', country:'السعودية', coords:[24.5580,46.8920], photo:PHOTOS.facility_power, capacityMW:650, detail:'أصل طاقة تشغيلي داخل المحاكاة، يخضع للطلب والصيانة والتكاليف.', capacity:'650 MW', cost:0},
    {id:'BK-DXB', kind:'bank', public:true, owned:false, icon:'🏦', name:'فرع البنك الإقليمي — دبي', city:'دبي', country:'الإمارات', coords:[25.1972,55.2744], photo:PHOTOS.facility_bank, detail:'فرع مصرفي للمجموعة يدعم التمويل والخزينة والتوسع الإقليمي.', capacity:'خدمات شركات', cost:0}
  ];

  const expansionSites = [
    {id:'EX-FRA', name:'مقر أوروبا — فرانكفورت', city:'فرانكفورت', country:'ألمانيا', coords:[50.1109,8.6821], price:38000000, dailyCost:22000, icon:'🏢'},
    {id:'EX-SIN', name:'مقر آسيا — سنغافورة', city:'سنغافورة', country:'سنغافورة', coords:[1.2903,103.8519], price:44000000, dailyCost:26000, icon:'🏢'},
    {id:'EX-NYC', name:'مقر أمريكا الشمالية — نيويورك', city:'نيويورك', country:'الولايات المتحدة', coords:[40.7128,-74.0060], price:62000000, dailyCost:39000, icon:'🏢'},
    {id:'EX-SHA', name:'مكتب الصين — شنغهاي', city:'شنغهاي', country:'الصين', coords:[31.2304,121.4737], price:35000000, dailyCost:21000, icon:'🏢'},
    {id:'EX-SAO', name:'مقر أمريكا الجنوبية — ساو باولو', city:'ساو باولو', country:'البرازيل', coords:[-23.5505,-46.6333], price:28000000, dailyCost:18000, icon:'🏢'}
  ];

  // ---- كتالوج الأصول: جديد/مستعمل، مواصفات فعلية تدخل في حساب كل رحلة ----
  // Current catalog only. If catalog.js fails to load, the market fails closed rather than resurrecting an old embedded catalog.
  const assetCatalog = window.GH_ASSET_CATALOG || {air:{new:[],used:[]},sea:{new:[],used:[]},road:{new:[],used:[]}};
  function catalogItem(type,id){ const t=assetCatalog[type]; if(!t)return null; return t.new.find(x=>x.id===id)||t.used.find(x=>x.id===id)||null; }

  const routeTemplates = {
    AIR_RUH_LHR:{id:'AIR_RUH_LHR',type:'air',routeMode:'air',ownerCompanyId:'air',name:'الرياض → لندن',from:'الرياض',to:'لندن',fromFacility:'AP-RUH',toFacility:'AP-LHR',route:greatCircle([24.9576,46.6988],[51.4700,-0.4543],42),effectiveSpeedKmh:760,dwellHours:1.1},
    AIR_DXB_SIN:{id:'AIR_DXB_SIN',type:'air',routeMode:'air',ownerCompanyId:'air',name:'دبي → سنغافورة',from:'دبي',to:'سنغافورة',fromFacility:'AP-DXB',toFacility:'AP-SIN',route:greatCircle([25.2532,55.3657],[1.3644,103.9915],42),effectiveSpeedKmh:770,dwellHours:1.2},
    SEA_SIN_JED:{id:'SEA_SIN_JED',type:'sea',routeMode:'sea',ownerCompanyId:'sea',name:'سنغافورة → جدة',from:'سنغافورة',to:'جدة',fromFacility:'PT-SIN',toFacility:'PT-JED',route:[[1.264,103.84],[2.7,101.0],[5.6,96.1],[7.2,82.2],[8.0,75.0],[9.0,65.0],[11.0,55.0],[12.1,48.0],[12.6,43.4],[14.6,42.6],[18.0,40.2],[21.4858,39.173]],effectiveSpeedKmh:31.5,dwellHours:10,cargoDemand:{dry:2380,reefer:340}},
    SEA_RTM_NYC:{id:'SEA_RTM_NYC',type:'sea',routeMode:'sea',ownerCompanyId:'sea',name:'روتردام → نيويورك',from:'روتردام',to:'نيويورك',fromFacility:'PT-RTM',toFacility:'PT-NYC',route:[[51.95,4.14],[51.2,1.6],[50.1,-5.0],[49.0,-15.0],[47.0,-28.0],[44.5,-42.0],[42.3,-56.0],[40.684,-74.04]],effectiveSpeedKmh:32.5,dwellHours:12,cargoDemand:{dry:6100,reefer:820}},
    ROAD_RUH_JED:{id:'ROAD_RUH_JED',referenceOnly:true,type:'road',routeMode:'road',ownerCompanyId:'road',name:'الرياض → جدة',from:'الرياض',to:'جدة',fromFacility:'DP-RUH',toFacility:'PT-JED',route:[[24.6485,46.7160],[24.073,45.280],[23.905,44.720],[23.900,42.920],[23.650,41.850],[22.850,40.500],[21.900,39.800],[21.4858,39.173]],effectiveSpeedKmh:68,dwellHours:2.5},
    ROAD_DXB_RUH:{id:'ROAD_DXB_RUH',referenceOnly:true,type:'road',routeMode:'road',ownerCompanyId:'road',name:'دبي → الرياض',from:'دبي',to:'الرياض',fromFacility:'DP-DXB',toFacility:'DP-RUH',route:[[24.9857,55.075],[24.4539,54.3773],[24.15,52.58],[24.02,51.61],[24.07,50.67],[24.15,49.25],[24.30,48.05],[24.6485,46.716]],effectiveSpeedKmh:66,dwellHours:3}
  };
  function routeLongestLeg(route){
    let longest=0;
    for(let i=0;i<(route?.length||0)-1;i++) longest=Math.max(longest,haversine(route[i],route[i+1]));
    return longest;
  }
  function prepareRoute(r,target=window.__GH_STATE__||null){
    const routeMode=routeModeOf(r),ownerCompanyId=routeOwnerCompanyId(r),operationProfileId=String(r.operationProfileId||(target?COMPANY_PLATFORM.getOperationProfile?.(target,ownerCompanyId):COMPANY_PLATFORM.getOperationProfile?.(ownerCompanyId))||COMPANY_PLATFORM.operationProfileForLegacyMode?.(routeMode)||'').trim();
    if(!routeMode||!ownerCompanyId||!isKnownCompanyId(ownerCompanyId,target))throw new Error(`route-ownership-unresolved:${r?.id||'unknown'}`);
    r.routeMode=routeMode;r.ownerCompanyId=ownerCompanyId;if(!r.type)r.type=routeMode;if(operationProfileId)r.operationProfileId=operationProfileId;
    r.distanceKm=routeMode==='road'&&Number(r.roadNetworkDistanceKm)>0?Number(r.roadNetworkDistanceKm):routeDistance(r.route);
    r.maxLegKm=Number(r.maxLegKm)||routeLongestLeg(r.route);
    r.tripSeconds=r.distanceKm/r.effectiveSpeedKmh*3600;
    return r;
  }
  Object.values(routeTemplates).forEach(prepareRoute);
  const BASE_ROUTE_IDS = new Set(Object.keys(routeTemplates));

  // ---- شبكة الممرات العالمية: الوجهات عامة وليست قواعد يجب شراؤها ----
  // هذه ممرات تشغيلية داخل اللعبة لعرض حركة السفن بصورة معقولة وليست تعليمات ملاحية حقيقية.
  const MARITIME_LANES = {
    LIGURIAN:[43,8],TYRRHENIAN:[40,12],MED_WEST:[40,5],SARDINIA_S:[38.3,9],SICILY_S:[35.6,13.2],ALBORAN:[36.3,-2.5],
    ADRIATIC_N:[43,14.8],ADRIATIC_S:[39.5,19],IONIAN:[36,19],AEGEAN_S:[35.5,23],
    CADIZ:[35.7,-7.2],PORTUGAL_OFFSHORE:[37,-10],FINISTERRE:[43,-10],BISCAY:[48,-6],CHANNEL_W:[50,-1],DOVER:[50.8,1.5],CHANNEL_E:[51.6,2],
    SKAGERRAK:[58,8],KATTEGAT:[57,11.5],
    GULF:[25.3,52.8],HORMUZ:[26.5,56.5],ARABIAN:[18.5,63.0],ADEN:[12.6,46.0],BAB:[12.65,43.35],
    RED_SOUTH:[16.5,41.2],SUEZ_SOUTH:[29.75,32.55],SUEZ_NORTH:[31.28,32.33],MED_EAST:[34.8,25.5],MED_CENTRAL:[36.0,15.0],
    GIBRALTAR:[35.95,-5.6],ENGLISH:[50.2,-4.8],NORTH_SEA:[53.0,3.0],WEST_AFRICA:[7.0,-9.0],SOUTH_ATLANTIC:[-15.0,-20.0],
    CAPE:[-34.6,18.5],EAST_AFRICA:[-16.0,42.0],INDIAN_W:[-10.0,60.0],INDIAN_C:[-10.0,80.0],BAY_BENGAL:[8.0,90.0],
    MALACCA:[4.0,100.0],SINGAPORE:[1.3,103.8],SOUTH_CHINA:[10.0,112.0],PHILIPPINES:[14.0,130.0],JAPAN:[33.0,139.0],
    PACIFIC_W:[10.0,155.0],PACIFIC_C:[10.0,-165.0],PACIFIC_E:[13.0,-115.0],PANAMA_PAC:[8.8,-80.0],PANAMA_ATL:[9.5,-79.7],
    CARIBBEAN:[15.0,-75.0],US_EAST:[32.0,-74.0],NORTH_ATLANTIC:[42.0,-35.0],BRAZIL:[-10.0,-35.0],SOUTH_AMERICA:[-45.0,-58.0],
    CAPE_HORN:[-56.0,-68.0],AUSTRALIA_W:[-20.0,113.0],AUSTRALIA_E:[-25.0,153.0],TASMAN:[-38.0,153.0],NEW_ZEALAND:[-39.0,174.0]
  };
  const MARITIME_EDGES = [
    ['GULF','HORMUZ'],['HORMUZ','ARABIAN'],['ARABIAN','ADEN'],['ADEN','BAB'],['BAB','RED_SOUTH'],['RED_SOUTH','SUEZ_SOUTH'],['SUEZ_SOUTH','SUEZ_NORTH'],
    ['SUEZ_NORTH','MED_EAST'],['MED_EAST','MED_CENTRAL'],['MED_CENTRAL','SICILY_S'],['SICILY_S','SARDINIA_S'],['SARDINIA_S','MED_WEST'],['MED_WEST','ALBORAN'],['ALBORAN','GIBRALTAR'],
    ['LIGURIAN','MED_WEST'],['TYRRHENIAN','SARDINIA_S'],['ADRIATIC_N','ADRIATIC_S'],['ADRIATIC_S','IONIAN'],['IONIAN','MED_CENTRAL'],['AEGEAN_S','IONIAN'],['AEGEAN_S','MED_EAST'],
    ['GIBRALTAR','CADIZ'],['CADIZ','PORTUGAL_OFFSHORE'],['PORTUGAL_OFFSHORE','FINISTERRE'],['FINISTERRE','BISCAY'],['BISCAY','ENGLISH'],
    ['ENGLISH','CHANNEL_W'],['CHANNEL_W','DOVER'],['DOVER','CHANNEL_E'],['CHANNEL_E','NORTH_SEA'],['NORTH_SEA','SKAGERRAK'],['SKAGERRAK','KATTEGAT'],
    ['GIBRALTAR','WEST_AFRICA'],['WEST_AFRICA','SOUTH_ATLANTIC'],['SOUTH_ATLANTIC','BRAZIL'],['SOUTH_ATLANTIC','CAPE'],['CAPE','EAST_AFRICA'],
    ['EAST_AFRICA','ADEN'],['EAST_AFRICA','INDIAN_W'],['INDIAN_W','ARABIAN'],['INDIAN_W','INDIAN_C'],['INDIAN_C','BAY_BENGAL'],['BAY_BENGAL','MALACCA'],
    ['MALACCA','SINGAPORE'],['SINGAPORE','SOUTH_CHINA'],['SOUTH_CHINA','PHILIPPINES'],['PHILIPPINES','JAPAN'],['PHILIPPINES','PACIFIC_W'],
    ['PACIFIC_W','PACIFIC_C'],['PACIFIC_C','PACIFIC_E'],['PACIFIC_E','PANAMA_PAC'],['PANAMA_PAC','PANAMA_ATL'],['PANAMA_ATL','CARIBBEAN'],
    ['CARIBBEAN','US_EAST'],['US_EAST','NORTH_ATLANTIC'],['NORTH_ATLANTIC','ENGLISH'],['NORTH_ATLANTIC','SOUTH_ATLANTIC'],
    ['CARIBBEAN','BRAZIL'],['BRAZIL','SOUTH_AMERICA'],['SOUTH_AMERICA','CAPE_HORN'],['CAPE_HORN','PACIFIC_E'],
    ['INDIAN_C','AUSTRALIA_W'],['AUSTRALIA_W','AUSTRALIA_E'],['AUSTRALIA_E','TASMAN'],['TASMAN','NEW_ZEALAND'],['AUSTRALIA_E','PACIFIC_W']
  ];
  const maritimeGraph = (()=>{
    const graph=new Map(Object.keys(MARITIME_LANES).map(key=>[key,[]]));
    MARITIME_EDGES.forEach(([a,b])=>{
      const distance=haversine(MARITIME_LANES[a],MARITIME_LANES[b]);
      graph.get(a).push([b,distance]);graph.get(b).push([a,distance]);
    });
    return graph;
  })();
  function stitchArcs(points,steps=7){
    const output=[];
    for(let i=0;i<points.length-1;i++){
      const segment=greatCircle(points[i],points[i+1],steps);
      output.push(...(i?segment.slice(1):segment));
    }
    return output;
  }
  function maritimeGateKeys(coords){
    const [lat,lon]=coords;
    if(lat>=21&&lat<=32&&lon>=47&&lon<=59)return ['GULF','HORMUZ'];
    if(lat>=11&&lat<=31&&lon>=31&&lon<=46)return ['RED_SOUTH','BAB','SUEZ_SOUTH'];
    if(lat>=29&&lat<=47&&lon>=-8&&lon<=39)return ['MED_EAST','MED_CENTRAL','GIBRALTAR'];
    if(lat>=48&&lat<=62&&lon>=-12&&lon<=12)return ['ENGLISH','NORTH_SEA'];
    if(lat>=53&&lat<=66&&lon>=9&&lon<=31)return ['NORTH_SEA','ENGLISH']; // بحر البلطيق: سفنه تمر فعليًا بمضايق الدنمارك إلى بحر الشمال
    if(lat>=-35&&lat<=32&&lon>=42&&lon<=82)return ['ADEN','ARABIAN','INDIAN_W'];
    if(lat>=-18&&lat<=28&&lon>=80&&lon<=108)return ['INDIAN_C','BAY_BENGAL','MALACCA'];
    if(lat>=-12&&lat<=34&&lon>=98&&lon<=139)return ['SINGAPORE','SOUTH_CHINA','PHILIPPINES'];
    if(lat>=34&&lat<=41&&lon>=117&&lon<=123)return ['SOUTH_CHINA','JAPAN']; // بحرا بوهاي والأصفر (تيانجين، تشينغداو، داليان)
    if(lat>=24&&lat<=46&&lon>=126&&lon<=148)return ['JAPAN','PHILIPPINES'];
    if(lat>=-48&&lat<=-8&&lon>=108&&lon<=178)return ['AUSTRALIA_W','AUSTRALIA_E','TASMAN'];
    if(lat>=50&&lon<=-160)return ['PACIFIC_C','PACIFIC_W']; // ألاسكا وسلسلة ألوشيان غرب حد صندوق المحيط الهادئ أدناه
    if(lat>=-50&&lat<=60&&lon>=-88&&lon<=-65)return ['US_EAST','CARIBBEAN','PANAMA_ATL'];
    if(lat>=-58&&lat<=49&&lon>=-82&&lon<=-30)return ['CARIBBEAN','BRAZIL','SOUTH_ATLANTIC'];
    if(lat>=-60&&lat<=60&&lon>=-160&&lon<=-100)return ['PACIFIC_E','PACIFIC_C'];
    return Object.keys(MARITIME_LANES).sort((a,b)=>haversine(coords,MARITIME_LANES[a])-haversine(coords,MARITIME_LANES[b])).slice(0,3);
  }
  function shortestMaritimeLane(fromKey,toKey){
    const distance={},previous={},unvisited=new Set(Object.keys(MARITIME_LANES));
    Object.keys(MARITIME_LANES).forEach(key=>distance[key]=Infinity);distance[fromKey]=0;
    while(unvisited.size){
      let current=null;
      for(const key of unvisited)if(current===null||distance[key]<distance[current])current=key;
      if(current===null||distance[current]===Infinity)break;
      unvisited.delete(current);if(current===toKey)break;
      for(const [next,cost] of maritimeGraph.get(current)||[]){
        if(!unvisited.has(next))continue;
        const candidate=distance[current]+cost;
        if(candidate<distance[next]){distance[next]=candidate;previous[next]=current;}
      }
    }
    if(!Number.isFinite(distance[toKey]))return null;
    const keys=[];let current=toKey;
    while(current){keys.unshift(current);if(current===fromKey)break;current=previous[current];}
    return keys[0]===fromKey?{keys,distance:distance[toKey]}:null;
  }
  function buildMaritimeRoute(fromCoords,toCoords){
    // Choose each port approach independently of the other endpoint: a distant
    // destination must never select a shorter land-crossing terminal shortcut.
    const from=maritimeApproach(fromCoords),to=maritimeApproach(toCoords),lane=shortestMaritimeLane(from.key,to.key);
    if(!lane)return null;
    const anchors=[...from.points,...lane.keys.map(key=>MARITIME_LANES[key]),...[...to.points].reverse()];
    return {route:stitchArcs(anchors,5),maxLegKm:routeLongestLeg(anchors),laneNodes:lane.keys,maritimeOnly:true,maritimeGeometryVersion:310};
  }
  function maritimeApproach(coords){
    const [lat,lon]=coords;
    if(lat>=31.1&&lat<=33&&lon>=25&&lon<=35)return {key:'MED_EAST',points:[coords]};
    if(lat>=53&&lat<=66&&lon>=12&&lon<=31)return {key:'KATTEGAT',points:[coords,[54.5,12.5],[54.5,10.9],[55.6,10.9],[56.2,11.2]]};
    if(lat>=40&&lat<=42&&lon>=26&&lon<=30)return {key:'AEGEAN_S',points:[coords,[40.7,28],[40.4,26.8],[40,26.2],[39.5,25.6],[37,25.5],[35.6,24]]};
    if(lat>=36&&lat<=40&&lon>=22&&lon<=28)return {key:'AEGEAN_S',points:[coords,[37.4,24],[36.3,24]]};
    if(lat>=43&&lat<=46&&lon>=12&&lon<=20)return {key:'ADRIATIC_N',points:[coords]};
    if(lat>=39&&lat<=43&&lon>=16&&lon<=22)return {key:'ADRIATIC_S',points:[coords]};
    if(lat>=40&&lat<=45&&lon>=6&&lon<12)return {key:'LIGURIAN',points:[coords]};
    if(lat>=38&&lat<43&&lon>=12&&lon<16)return {key:'TYRRHENIAN',points:[coords]};
    if(lat>=37&&lat<=43&&lon>=-1&&lon<6)return {key:'MED_WEST',points:[coords]};
    if(lat>=36&&lat<=48&&lon>=-11&&lon< -6)return {key:'PORTUGAL_OFFSHORE',points:[coords]};
    const key=maritimeGateKeys(coords).sort((a,b)=>haversine(coords,MARITIME_LANES[a])-haversine(coords,MARITIME_LANES[b]))[0];
    return {key,points:[coords]};
  }
  function rebuildMaritimeRoute(route){
    const from=routeFacility(route.fromFacility),to=routeFacility(route.toFacility);
    if(!from||!to)return false;
    const geometry=buildMaritimeRoute(from.coords,to.coords);
    if(!geometry)return false;
    route.route=geometry.route;route.laneNodes=geometry.laneNodes;route.maritimeOnly=true;route.maritimeGeometryVersion=310;
    route.routingSource='شبكة GH البحرية · ممرات تقديرية وليست ملاحة فعلية';prepareRoute(route);return true;
  }
  function nearestTechnicalAirport(target,previous,destination,maxLegKm,excluded){
    let best=null,bestScore=Infinity;const eligible=worldInfrastructureSpatialIndex('airport',false);
    for(const index of eligible.majorIndices){
      const row=eligible.rows[index];if(excluded.has(row[0]))continue;
      const coords=[row[6],row[7]];
      if(haversine(previous,coords)>maxLegKm*.97)continue;
      const score=haversine(target,coords)+Math.max(0,haversine(coords,destination)-haversine(target,destination))*.16;
      if(score<bestScore){bestScore=score;best={entity:airportEntity(row),coords};}
    }
    return best;
  }
  function buildAirRouteWithTechnicalStops(fromCoords,toCoords,rangeKm){
    const directDistance=haversine(fromCoords,toCoords);
    if(!rangeKm||directDistance<=rangeKm*.88){const route=greatCircle(fromCoords,toCoords,48);return {route,maxLegKm:directDistance,technicalStops:[]};}
    const segmentTarget=Math.max(900,rangeKm*.79);
    const segmentCount=Math.min(9,Math.max(2,Math.ceil(directDistance/segmentTarget)));
    const guide=greatCircle(fromCoords,toCoords,segmentCount*14),anchors=[fromCoords],technicalStops=[],excluded=new Set();
    for(let step=1;step<segmentCount;step++){
      const target=guide[Math.round((guide.length-1)*step/segmentCount)];
      const candidate=nearestTechnicalAirport(target,anchors[anchors.length-1],toCoords,rangeKm,excluded);
      if(!candidate)break;
      anchors.push(candidate.coords);technicalStops.push({code:candidate.entity.code,name:candidate.entity.name,city:candidate.entity.city,country:candidate.entity.country});excluded.add(candidate.entity.icao);
    }
    anchors.push(toCoords);
    const maxLegKm=routeLongestLeg(anchors);
    if(maxLegKm>rangeKm*.995)return null;
    return {route:stitchArcs(anchors,9),maxLegKm,technicalStops};
  }

  // No seeded player fleet: every owned asset must come from a current-game purchase or lease.

  const competitorAssetSeed = [
    {id:'CA-1',type:'air',icon:'✈️',name:'AeroLink 617',route:greatCircle([50.0379,8.5622],[40.6413,-73.7781],36),progress:.49,speed:760,company:'AeroLink Regional'},
    {id:'CS-1',type:'sea',icon:'🚢',name:'BlueHarbor 88',route:[[31.2,121.6],[25,122],[15,120],[5,108],[1.264,103.84]],progress:.58,speed:31,company:'BlueHarbor Shipping'},
    {id:'CT-1',type:'road',icon:'🚛',name:'NorthStar 204',route:[[50.1109,8.6821],[50.0,7.0],[50.8,5.7],[51.2,4.5],[51.9244,4.4777]],progress:.36,speed:70,company:'NorthStar Logistics'}
  ];

  const companies = COMPANY_PLATFORM.listDefinitions().map(definition=>({
    id:definition.kind==='holding'?'holding':definition.id,
    companyId:definition.id,
    icon:definition.identity?.short||definition.id.toUpperCase(),
    name:definition.identity?.legalDefault?.ar||definition.identity?.legalDefault?.en||definition.id,
    sector:definition.identity?.trade?.ar||definition.classification?.primarySectorId||definition.id,
    base:definition.kind==='holding'?'الرياض':'يحدد عند التأسيس'
  }));

  const contracts = [
    {id:'K1',sector:'road',category:'تشغيل',name:'توزيع دوائي مبرد — الخليج',client:'MedAxis International',value:48000000,cost:31000000,termMonths:24,sla:'98.5%',penalty:'حتى 7% عند إخفاق SLA',capacity:'18 شاحنة مبردة',bidBase:1.00,region:'الخليج',payment:'شهري Net 30'},
    {id:'K2',sector:'sea',category:'شحن',name:'حاويات آسيا → البحر الأحمر',client:'Pacific Components',value:122000000,cost:83000000,termMonths:36,sla:'96.0%',penalty:'غرامة تأخير يومية',capacity:'2,400 TEU شهريًا',bidBase:.96,region:'آسيا/البحر الأحمر',payment:'شهري Net 45'},
    {id:'K3',sector:'air',category:'شحن',name:'شحن جوي إلكترونيات عالي الأولوية',client:'Nova Devices',value:66000000,cost:44000000,termMonths:18,sla:'99.0%',penalty:'تعويض خدمة عند التأخير',capacity:'52 طن أسبوعيًا',bidBase:.92,region:'الخليج/آسيا',payment:'كل 14 يومًا'},
    {id:'K4',sector:'power',category:'طاقة',name:'توريد طاقة لمجمع صناعي',client:'Atlas Manufacturing',value:185000000,cost:132000000,termMonths:60,sla:'99.7%',penalty:'تعويض انقطاع',capacity:'110 MW',bidBase:.88,region:'الشرق الأوسط',payment:'شهري Net 30'},
    {id:'K5',sector:'road',category:'عقد رئيسي',name:'شبكة تجارة إلكترونية وطنية',client:'Vertex Commerce Group',value:210000000,cost:142000000,termMonths:48,sla:'99.1%',penalty:'Service credits حتى 9%',capacity:'85 شاحنة + 3 مراكز',bidBase:.82,region:'السعودية',payment:'شهري + حافز SLA'},
    {id:'K6',sector:'sea',category:'عقد رئيسي',name:'برنامج LNG طويل الأجل',client:'Helios Energy Trading',value:590000000,cost:421000000,termMonths:72,sla:'97.8%',penalty:'Demurrage وOff-hire',capacity:'2 ناقلة LNG مخصصة',bidBase:.74,region:'الخليج/شرق آسيا',payment:'كل رحلة + تسوية شهرية'},
    {id:'K7',sector:'air',category:'عقد رئيسي',name:'جسر شحن دوائي عالمي GDP',client:'Orion Biopharma',value:310000000,cost:221000000,termMonths:48,sla:'99.4%',penalty:'تعويض Cold-chain',capacity:'3 طائرات + محطات مناولة',bidBase:.78,region:'أوروبا/الخليج/آسيا',payment:'كل 14 يومًا'},
    {id:'K8',sector:'power',category:'PPA',name:'اتفاقية شراء طاقة متجددة',client:'Crescent Data Centers',value:440000000,cost:286000000,termMonths:120,sla:'99.9%',penalty:'Availability LDs',capacity:'180 MW',bidBase:.72,region:'الخليج',payment:'شهري Indexed'},
    {id:'K9',sector:'road',category:'حكومي',name:'إمداد لوجستي للمرافق الحكومية',client:'National Infrastructure Authority',value:365000000,cost:258000000,termMonths:60,sla:'98.8%',penalty:'غرامات تأخير مرحلية',capacity:'120 مركبة + مستودعات',bidBase:.68,region:'وطني',payment:'شهادات إنجاز شهرية'},
    {id:'K10',sector:'sea',category:'حكومي',name:'خدمات موانئ وسلاسل توريد استراتيجية',client:'National Ports Development Co.',value:480000000,cost:344000000,termMonths:60,sla:'98.2%',penalty:'Berth-window penalties',capacity:'4 سفن + فريق مينائي',bidBase:.70,region:'البحر الأحمر',payment:'شهري Net 45'},
    {id:'K11',sector:'air',category:'VIP/Gov',name:'برنامج نقل تنفيذي وحكومي',client:'Sovereign Mobility Office',value:275000000,cost:186000000,termMonths:36,sla:'99.8%',penalty:'Availability penalties',capacity:'طائرتان VIP + Crew reserve',bidBase:.66,region:'دولي',payment:'Retainer + ساعات طيران'},
    {id:'K12',sector:'bank',category:'تمويل',name:'تسهيلات تمويل سلسلة الموردين',client:'Industrial Supply Alliance',value:155000000,cost:101000000,termMonths:36,sla:'T+1 settlement',penalty:'تعويض تأخير التسوية',capacity:'محفظة 250M',bidBase:.80,region:'الخليج',payment:'رسوم + هامش تمويل'}
  ];

  const competitorSeed = [
    {id:'C1',name:'NorthStar Logistics',sector:'لوجستيات — أوروبا',hq:'فرانكفورت',coords:[50.1109,8.6821],price:138000000,revenue:214000000,ebitda:31000000,debt:44000000,risk:'متوسط',strategy:'شبكات برية كثيفة',marketShare:'8.4%',quality:88,synergy:'شبكات توزيع ومستودعات'},
    {id:'C2',name:'BlueHarbor Shipping',sector:'شحن بحري — آسيا',hq:'سنغافورة',coords:[1.2903,103.8519],price:420000000,revenue:680000000,ebitda:96000000,debt:170000000,risk:'مرتفع',strategy:'توسع بالاستحواذ',marketShare:'5.1%',quality:81,synergy:'خطوط آسيا والموانئ'},
    {id:'C3',name:'AeroLink Regional',sector:'طيران — أوروبا',hq:'فرانكفورت',coords:[50.0379,8.5622],price:285000000,revenue:402000000,ebitda:38000000,debt:126000000,risk:'متوسط',strategy:'شبكة Hub إقليمية',marketShare:'3.7%',quality:84,synergy:'Slots وربط أوروبي'},
    {id:'C4',name:'GridPeak Energy',sector:'طاقة — أمريكا الشمالية',hq:'نيويورك',coords:[40.7128,-74.0060],price:760000000,revenue:910000000,ebitda:184000000,debt:302000000,risk:'منخفض',strategy:'عقود طويلة الأجل',marketShare:'4.5%',quality:93,synergy:'طاقة وتمويل أخضر'},
    {id:'C5',name:'RedSea Freight Systems',sector:'لوجستيات — الشرق الأوسط',hq:'جدة',coords:[21.5433,39.1728],price:192000000,revenue:288000000,ebitda:43000000,debt:51000000,risk:'منخفض',strategy:'ربط الموانئ بالمستودعات',marketShare:'6.2%',quality:90,synergy:'البحر الأحمر والنقل البري'},
    {id:'C6',name:'SkyBridge Cargo',sector:'طيران شحن — الخليج',hq:'دبي',coords:[25.2532,55.3657],price:510000000,revenue:742000000,ebitda:112000000,debt:188000000,risk:'متوسط',strategy:'شحن عالي القيمة',marketShare:'4.9%',quality:91,synergy:'شحن جوي وعقود إلكترونيات'},
    {id:'C7',name:'Nordic Marine Services',sector:'خدمات بحرية — أوروبا',hq:'روتردام',coords:[51.9244,4.4777],price:248000000,revenue:376000000,ebitda:62000000,debt:73000000,risk:'منخفض',strategy:'إدارة سفن وصيانة',marketShare:'2.8%',quality:94,synergy:'صيانة وأحواض جافة'},
    {id:'C8',name:'TransAsia Warehousing',sector:'مستودعات — آسيا',hq:'سنغافورة',coords:[1.3521,103.8198],price:334000000,revenue:498000000,ebitda:79000000,debt:104000000,risk:'متوسط',strategy:'مراكز Fulfillment',marketShare:'4.1%',quality:87,synergy:'مستودعات وتوزيع آسيا'},
    {id:'C9',name:'Atlantic Fleet Support',sector:'صيانة وتوريد — أمريكا',hq:'نيويورك',coords:[40.7128,-74.0060],price:166000000,revenue:255000000,ebitda:39000000,debt:28000000,risk:'منخفض',strategy:'MRO وقطع غيار متعددة القطاعات',marketShare:'3.2%',quality:95,synergy:'خفض تكاليف الصيانة'},
    {id:'C10',name:'GreenCurrent Infrastructure',sector:'طاقة وبنية تحتية — أوروبا',hq:'أمستردام',coords:[52.3676,4.9041],price:615000000,revenue:780000000,ebitda:151000000,debt:214000000,risk:'متوسط',strategy:'طاقة متجددة وتخزين',marketShare:'3.9%',quality:92,synergy:'طاقة نظيفة ومراكز شحن'},
    {id:'C11',name:'Gulf Aviation Services',sector:'خدمات مطارات — الخليج',hq:'الدوحة',coords:[25.2854,51.5310],price:230000000,revenue:345000000,ebitda:52000000,debt:61000000,risk:'منخفض',strategy:'مناولة ووقود وصيانة خطية',marketShare:'5.5%',quality:93,synergy:'خفض رسوم المناولة والصيانة'},
    {id:'C12',name:'Pacific Bunker & Supply',sector:'توريد بحري — آسيا',hq:'سنغافورة',coords:[1.2640,103.8400],price:208000000,revenue:530000000,ebitda:47000000,debt:99000000,risk:'متوسط',strategy:'وقود ومؤن وقطع بحرية',marketShare:'7.1%',quality:89,synergy:'وقود بحري ومؤن'}
  ];
  const strategicPartners=[
    {id:'P1',name:'AeroMRO Global Services',legalName:'AeroMRO Global Services Ltd.',service:'صيانة طائرات وقطع غيار',category:'mro',sector:'air',rating:96,costIndex:1.03,delivery:97,compliance:99,terms:'Net 30 · AOG 24/7',taxId:'AE-MRO-77102'},
    {id:'P2',name:'OceanDock Technical Group',legalName:'OceanDock Technical Group Pte.',service:'أحواض جافة وصيانة سفن',category:'mro',sector:'sea',rating:94,costIndex:.98,delivery:93,compliance:98,terms:'Net 45 · Dock slots',taxId:'SG-ODT-48117'},
    {id:'P3',name:'RoadPro Fleet Services',legalName:'RoadPro Fleet Services LLC',service:'إطارات وصيانة شاحنات',category:'mro',sector:'road',rating:92,costIndex:.94,delivery:95,compliance:96,terms:'Net 30 · Mobile service',taxId:'SA-RPF-55031'},
    {id:'P4',name:'Global Fuel Alliance',legalName:'Global Fuel Alliance Trading FZCO',service:'وقود طيران/ديزل/بنكر',category:'fuel',sector:'all',rating:91,costIndex:.97,delivery:96,compliance:95,terms:'Index + volume rebate',taxId:'AE-GFA-62008'},
    {id:'P5',name:'SecureParts Consortium',legalName:'SecureParts Consortium AG',service:'قطع غيار ومخزون حرج',category:'parts',sector:'all',rating:95,costIndex:1.01,delivery:98,compliance:99,terms:'VMI · SLA 98%',taxId:'CH-SPC-11890'},
    {id:'P6',name:'AeroGround Handling Network',legalName:'AeroGround Handling Network BV',service:'مناولة ورسوم أرضية',category:'handling',sector:'air',rating:90,costIndex:.96,delivery:94,compliance:97,terms:'Station contracts',taxId:'NL-AGH-44620'},
    {id:'P7',name:'Gulf Infrastructure Contractors',legalName:'Gulf Infrastructure Contractors Co.',service:'إنشاء قواعد ومراكز لوجستية ومقار',category:'construction',sector:'all',rating:94,costIndex:.97,delivery:95,compliance:98,terms:'Performance bond 10% · Milestones',taxId:'SA-GIC-72014'},
    {id:'P8',name:'Turner Meridian Projects',legalName:'Turner Meridian Projects International',service:'إدارة إنشاءات ومشاريع مطارات',category:'construction',sector:'air',rating:97,costIndex:1.06,delivery:98,compliance:99,terms:'GMP · Bonded',taxId:'UK-TMP-90352'},
    {id:'P9',name:'HarborWorks Marine Construction',legalName:'HarborWorks Marine Construction Pte.',service:'أرصفة ومحطات ومرافق بحرية',category:'construction',sector:'sea',rating:96,costIndex:1.02,delivery:96,compliance:99,terms:'EPC · Marine warranty',taxId:'SG-HMC-77142'},
    {id:'P10',name:'DesertLink Civil & Logistics',legalName:'DesertLink Civil & Logistics Contracting',service:'مراكز لوجستية وساحات شاحنات',category:'construction',sector:'road',rating:93,costIndex:.92,delivery:94,compliance:97,terms:'Design-build · 8% bond',taxId:'SA-DLC-45110'},
    {id:'P11',name:'GridCore EPC',legalName:'GridCore Energy Projects Ltd.',service:'محطات طاقة وشبكات وتخزين',category:'construction',sector:'power',rating:95,costIndex:1.00,delivery:95,compliance:99,terms:'EPC turnkey · LDs',taxId:'AE-GCE-11844'},
    {id:'P12',name:'CivicBuild Financial Facilities',legalName:'CivicBuild Financial Facilities LLC',service:'فروع بنكية ومقار مؤسسية',category:'construction',sector:'bank',rating:91,costIndex:.95,delivery:93,compliance:98,terms:'Fit-out + security certification',taxId:'AE-CBF-24471'},
    {id:'P13',name:'SkyLease Asset Partners',legalName:'SkyLease Asset Partners PLC',service:'توريد وتمويل طائرات',category:'assets',sector:'air',rating:94,costIndex:1.00,delivery:92,compliance:99,terms:'Delivery slots · escrow',taxId:'IE-SLA-17730'},
    {id:'P14',name:'OceanFleet Brokerage',legalName:'OceanFleet Brokerage Pte.',service:'توريد ووساطة سفن',category:'assets',sector:'sea',rating:93,costIndex:.98,delivery:90,compliance:98,terms:'Class survey · escrow',taxId:'SG-OFB-33190'},
    {id:'P15',name:'Continental Truck Systems',legalName:'Continental Truck Systems GmbH',service:'توريد شاحنات ومقطورات',category:'assets',sector:'road',rating:95,costIndex:.96,delivery:96,compliance:99,terms:'Fleet pricing · warranty',taxId:'DE-CTS-61225'},
    {id:'P16',name:'InterPort Provisions',legalName:'InterPort Provisions & Chandlery Co.',service:'مؤن ومواد غذائية ولوازم بحرية',category:'provisions',sector:'sea',rating:89,costIndex:.93,delivery:94,compliance:95,terms:'Per-call supply · Net 30',taxId:'SG-IPP-70214'},
    {id:'P17',name:'Aviation Navigation Services',legalName:'Aviation Navigation Services International',service:'رسوم ملاحة وتصاريح وSlots',category:'government-services',sector:'air',rating:98,costIndex:1.00,delivery:99,compliance:100,terms:'Regulated tariffs',taxId:'REG-ANS-001'},
    {id:'P18',name:'Road Permit & Toll Clearing',legalName:'Road Permit & Toll Clearing Services',service:'تصاريح ورسوم طرق وموازين',category:'government-services',sector:'road',rating:90,costIndex:1.00,delivery:97,compliance:99,terms:'Regulated + service fee',taxId:'SA-RPT-40111'}
  ];

  const candidates = [
    {id:'H1',name:'Lena Fischer',role:'COO — لوجستيات',city:'فرانكفورت',salary:420000,skill:92,market:'طلب مرتفع'},
    {id:'H2',name:'Kenji Mori',role:'مدير شبكة بحرية',city:'سنغافورة',salary:310000,skill:88,market:'طلب مرتفع'},
    {id:'H3',name:'Aisha Rahman',role:'مدير خزينة',city:'دبي',salary:350000,skill:90,market:'طلب متوسط'},
    {id:'H4',name:'Carlos Mendes',role:'مدير عمليات جوية',city:'مدريد',salary:330000,skill:86,market:'طلب مرتفع'},
    {id:'H5',name:'Mina Park',role:'مدير عقود آسيوية',city:'سيول',salary:295000,skill:89,market:'طلب متوسط'},
    {id:'H6',name:'Omar Haddad',role:'مدير أسطول بري',city:'الرياض',salary:230000,skill:84,market:'طلب مرتفع'},
    {id:'H7',name:'Julia Rossi',role:'مدير استحواذات',city:'ميلانو',salary:390000,skill:91,market:'طلب متوسط'},
    {id:'H8',name:'Daniel Brooks',role:'CFO — قطاع الطاقة',city:'نيويورك',salary:510000,skill:94,market:'طلب مرتفع'},
    {id:'H9',name:'نورة المنصور',role:'الرئيس التنفيذي — بنك المجموعة',city:'الرياض',salary:620000,skill:95,market:'طلب مرتفع'},
    {id:'H10',name:'James Whitmore',role:'مدير المخاطر — بنك المجموعة',city:'لندن',salary:540000,skill:94,market:'طلب مرتفع'},
    {id:'H11',name:'Maya Chen',role:'مدير العمليات — قطاع الطاقة',city:'سنغافورة',salary:525000,skill:93,market:'طلب مرتفع'}
  ];

  // ---- الطاقم التشغيلي: رواتب يومية فعلية + معنويات تدخل في تكلفة كل رحلة ----
  const crewRolesSeed = [
    {id:'pilots', sector:'air', name:'الطيارون', icon:'👨‍✈️', count:6, salaryMin:200, salaryMax:400, morale:91},
    {id:'cabin', sector:'air', name:'طاقم الضيافة', icon:'👩‍✈️', count:14, salaryMin:150, salaryMax:600, morale:91},
    {id:'aeng', sector:'air', name:'مهندسو الطيران', icon:'🛠️', count:5, salaryMin:250, salaryMax:500, morale:94},
    {id:'captains', sector:'sea', name:'قباطنة السفن', icon:'⚓', count:4, salaryMin:220, salaryMax:420, morale:88},
    {id:'sailors', sector:'sea', name:'بحارة وملاحون', icon:'🧑‍✈️', count:22, salaryMin:120, salaryMax:280, morale:85},
    {id:'seng', sector:'sea', name:'مهندسو سفن', icon:'🔧', count:6, salaryMin:200, salaryMax:380, morale:87},
    {id:'drivers', sector:'road', name:'سائقو الشاحنات', icon:'🚚', count:10, salaryMin:90, salaryMax:210, morale:90},
    {id:'mech', sector:'road', name:'فنيو الصيانة', icon:'🔩', count:5, salaryMin:110, salaryMax:230, morale:92}
  ];

  const initialStocks = [
    {sym:'GLTR',name:'Global Transit',price:84.22,change:1.4,marketCap:18400000000,pe:17.8,yield:1.9},
    {sym:'OCEA',name:'Ocean Axis',price:46.81,change:-.8,marketCap:12600000000,pe:10.9,yield:3.2},
    {sym:'AVIA',name:'AviaCore',price:121.55,change:.6,marketCap:23900000000,pe:21.4,yield:.8},
    {sym:'GRID',name:'GridPeak Energy',price:67.12,change:1.1,marketCap:31800000000,pe:15.2,yield:2.6},
    {sym:'BANK',name:'Mercantile Global',price:39.47,change:-.2,marketCap:14700000000,pe:9.7,yield:4.1}
  ];

  const defaultState = {
    saveVersion:SAVE_SCHEMA_VERSION,saveRevision:0,onboardingComplete:false,lastPanel:null,lastPanelArg:null,mapLayer:'standard',
    profile:{name:'المجموعة العالمية القابضة',shortName:'GH',founder:'المؤسس',englishName:'Global Holdings Group',country:'السعودية',city:'الرياض',firstSector:'air',mode:'balanced',legalForm:'شركة قابضة مساهمة مقفلة',currency:'USD',fiscalYear:'calendar',riskAppetite:'balanced',procurementPolicy:'competitive',signingAuthority:'board',reputation:12,creditRating:'BBB',logo:null,logoStyle:'teal'},
    cash:250000000,debt:84000000,groupValue:412000000,todayProfit:0,
    sectorProfitToday:{air:0,sea:0,road:0,power:0,bank:0,mobility:0},
    speed:1,simSeconds:0,lastFinancialDay:0,lastMarketHour:0,
    godMoney:false,infiniteMoney:false,showCompetitors:true,activeFilter:'all',
    assets:[],unlockedSectors:[],openedCompanies:[],ownedCompanies:[],stakes:{},maDeals:{},hired:[],acceptedContracts:[],contractStartDays:{},failedBids:[],
    crew:clone(crewRolesSeed).map(role=>({...role,count:0})),
    portfolio:{},portfolioBook:{},branches:[],globalBases:[],customHubs:[],customRoutes:[],routeEndpoints:{},leasedAssets:[],routeCache:{},market:clone(initialStocks),eventLog:[],alerts:[
      'تم تشغيل الخريطة العالمية الموحدة. ×1 يعمل بزمن حقيقي.',
      'فرصة استحواذ جديدة في قطاع المستودعات والنقل الأوروبي.',
      'عقد توزيع دوائي جديد متاح للمناقصة.'
    ],
    energy:{gasMW:0,solarMW:0,windMW:0,storageMWh:0,availability:0},
    bank:{branches:0,deposits:0,loans:0,npl:0,capitalRatio:0,hqla:0,stableFunding:0,requiredStableFunding:0,wholesaleFunding:0,offBalance:0,feeIncomeYTD:0,provisions:0,corporateClients:{},creditFacilities:[],lettersOfCredit:[],guarantees:[],cashSweeps:[],tradeFinance:[],riskReviews:[],lastLiquidityReview:0},
    treasury:{accounts:[{id:'GH-OPER-001',name:'الحساب الجاري التشغيلي',currency:'USD',balance:250000000},{id:'GH-RES-002',name:'حساب الاحتياطي',currency:'USD',balance:0},{id:'GH-INV-003',name:'حساب الاستثمار',currency:'USD',balance:0}],ledger:[],paymentQueue:[]},
    operations:{projects:[],dailyBriefs:[],riskIndex:18,lastCycleDay:0},companyRegistry:{},companyFinance:{},contractRegistry:{},constructionContracts:[],commercialTenders:[],supplierTransactions:[],finance:{invoices:[],taxPayable:0,taxPaid:0,invoiceSequence:1,payables:[],receivables:[],cheques:[],paymentSequence:1,periods:[],payrollReports:[],taxSettlements:[],debtRecords:[],debtSettlements:[],taxSettlementSequence:1,debtSettlementSequence:1},
    governance:{boardDecision:'pending'},research:{efficiency:0,automation:0,cleanEnergy:0},
    esg:{environment:46,social:58,governance:62},insurancePolicies:[],careerLevel:1,ipo:{listed:false,ticker:''}
  };

  let state,startupLoadMeta=null;
  if(!window.GH_MIGRATION_CORE?.load)throw new Error('Migration Core failed to load before app.js');
  try{
    if(window.webkit?.messageHandlers?.saveBridge&&Number(window.GH_NATIVE_BUILD||0)<251)throw new Error('Native Build251 is required');
    if(window.GH_NATIVE_RECOVERY_BLOCKED)throw new Error('Native recovery required');
    startupLoadMeta=window.GH_MIGRATION_CORE.load({defaultState,storageKey,legacyStorageKeys,resetMarkerKey,saveSchema:window.GH_SAVE_SCHEMA});state=startupLoadMeta.state;
  }catch(error){
    const box=document.createElement('div');box.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#f1f4f9;color:#17283f;display:grid;place-content:center;padding:32px;gap:20px;text-align:center';
    box.id='saveRecovery';const title=document.createElement('h2');title.textContent=String(error.message).includes('Build251')?'يلزم تثبيت تطبيق Build251 المحدث':'تعذر فتح الحفظ بأمان';box.appendChild(title);
    const message=document.createElement('p');message.textContent='احتفظنا بالملف الحالي دون تغييره. صدّر نسخة لاستعادتها أو مراجعتها قبل متابعة اللعب.';box.appendChild(message);
    const button=document.createElement('button');button.textContent='تصدير الحفظ للمراجعة';button.onclick=()=>{const raw=window.__GH_NATIVE_SAVE_JSON__||localStorage.getItem(storageKey)||legacyStorageKeys.map(k=>localStorage.getItem(k)).find(Boolean)||'';const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='GlobalHoldings_Recovery.ghsave';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};box.appendChild(button);document.body.appendChild(box);console.error('SAVE_LOAD_BLOCKED',error);return;
  }
  // One source of truth: pause plus the four user-visible simulation levels.
  // Keep the persisted level IDs stable (Save Schema 2.0.0) while using
  // conservative live rates that remain practical with large active fleets.
  const SAFE_SPEED_VALUES=[0,1,2,3,4];
  const SIMULATION_RATE_BY_LEVEL=Object.freeze({0:0,1:30,2:120,3:300,4:600});
  const SPEED_LABEL_BY_LEVEL=Object.freeze({0:'متوقف',1:'عادي · 30×',2:'سريع · 120×',3:'متسارع · 300×',4:'فائق · 600×'});
  const effectiveSimulationRate=level=>SIMULATION_RATE_BY_LEVEL[SAFE_SPEED_VALUES.includes(Number(level))?Number(level):1];
  const simulationLevelForRate=rate=>SAFE_SPEED_VALUES.find(level=>SIMULATION_RATE_BY_LEVEL[level]===Number(rate))??1;
  if(Number(state.speed)===5||!SAFE_SPEED_VALUES.includes(Number(state.speed)))state.speed=1;
  if(!window.GH_SAVE_SCHEMA?.normalize)throw new Error('Save Schema Core failed to load before app.js');
  state=window.GH_SAVE_SCHEMA.normalize(state,defaultState);
  state=window.GH_MIGRATION_CORE.structural(state,defaultState);
  let startupSignatureRequired=false,startupSignatureResumeSpeed=0;
  if(state.onboardingComplete){
    const auth=window.GH_AUTHORIZATION,store=auth?.ensure?.(state),person=store?.peopleById?.[FOUNDER_PRINCIPAL_ID],signatureId=store?.activeSignatureByPerson?.[FOUNDER_PRINCIPAL_ID],signature=signatureId?store.signatureAssetsById?.[signatureId]:null,mandate=Object.values(store?.mandatesById||{}).find(row=>row?.principalId===FOUNDER_PRINCIPAL_ID&&row.status==='active'&&(row.companyIds||[]).includes('*')&&(row.scopes||[]).includes('*'));
    const valid=Boolean(person&&signature&&auth?.validateVisualSeal?.(signature)?.ok===true&&signature.ownerPersonId===FOUNDER_PRINCIPAL_ID&&mandate?.principalId===FOUNDER_PRINCIPAL_ID);
    if(!valid){startupSignatureRequired=true;startupSignatureResumeSpeed=SAFE_SPEED_VALUES.includes(Number(state.speed))&&Number(state.speed)>0?Number(state.speed):0;state.speed=0;}
  }
  if(!window.GH_DETERMINISM?.ensure)throw new Error('Determinism Core failed to load before app.js');
  window.GH_DETERMINISM.ensure(state);
  if(!window.GH_DIAGNOSTICS?.ensure)throw new Error('Diagnostics Core failed to load before app.js');
  window.GH_DIAGNOSTICS.ensure(state);
  if(!window.GH_CONTROL_PLANE?.bootstrap)throw new Error('Central Control Plane failed to load before app.js');
  if(!window.GH_PERSISTENCE?.saveSlot||!window.GH_WORKFLOW?.run||!window.GH_EVENT_LEDGER?.ensure||!window.GH_DEPENDENCY_CORE?.ensure||!window.GH_POLICY_CORE?.evaluate||!window.GH_LIFECYCLE_CORE?.transition||!window.GH_DELIVERY_MONITOR?.ensure||!window.GH_INTEGRITY_CORE?.check)throw new Error('Business Lifecycle cores failed to load before app.js');
  window.__GH_STATE__=state;
  window.GH_CONTROL_PLANE.bootstrap(state,{
    simulation:{version:window.GH_SIMULATION_CORE?.VERSION||APP_VERSION,role:'Single owner of simulation time'},
    businessWorld:{version:window.GH_BUSINESS_WORLD?.VERSION||APP_VERSION,role:'External party identity, commercial relationships and market events'},
    finance:{version:APP_VERSION,role:'Accounting and money mutation owner'},
    procurement:{version:window.GH_PROCUREMENT_CORE?.VERSION||APP_VERSION,role:'Manual asset purchasing and delivery lifecycle'},
    assets:{version:APP_VERSION,role:'Asset lifecycle owner'},routes:{version:APP_VERSION,role:'Route lifecycle owner'},staffing:{version:window.GH_HR_CORE?.VERSION||APP_VERSION,role:'HR demand, recruitment and workforce lifecycle owner'},
    save:{version:window.GH_PERSISTENCE?.VERSION||APP_VERSION,role:'Browser persistence coordinated with Native Save Vault'},
    update:{version:window.GH_ADVANCED?.VERSION||APP_VERSION,role:'Signed clean-snapshot update lifecycle'},
    nativeBridge:{version:'Build251',role:'WKWebView durable save/update bridge'},diagnostics:{version:window.GH_DIAGNOSTICS?.VERSION||APP_VERSION,role:'Runtime health and evidence collection'}
  });
  window.GH_EVENT_LEDGER.ensure(state);window.GH_DEPENDENCY_CORE.ensure(state);window.GH_DELIVERY_MONITOR.ensure(state);
  const capabilitySnapshot=window.GH_CAPABILITY_REGISTRY?.isSealed?.()?window.GH_CAPABILITY_REGISTRY.snapshot():window.GH_CAPABILITY_REGISTRY?.seal?.();
  const companyPlatformSnapshot=COMPANY_PLATFORM.isSealed?.()?COMPANY_PLATFORM.snapshot():COMPANY_PLATFORM.seal();
  if(!capabilitySnapshot?.sealed||!companyPlatformSnapshot?.sealed)throw new Error('Company extension registries could not be sealed');
  if(!window.GH_DOMAIN_COMMANDS?.sealSecurityPolicy)throw new Error('Domain command security policy owner unavailable');
  window.GH_DOMAIN_COMMANDS.sealSecurityPolicy();
  if(!window.GH_DOMAIN_COMMANDS.isSecurityPolicySealed?.())throw new Error('Domain command security policy could not be sealed');
  window.GH_DIAGNOSTICS.record(state,'COMPANY_PLATFORM_SEALED',{capabilities:capabilitySnapshot.capabilities,adapters:capabilitySnapshot.adapters,definitions:companyPlatformSnapshot.definitions,companyPlatformVersion:companyPlatformSnapshot.version,domainSecurityPolicySealed:true,domainSystemActors:window.GH_DOMAIN_COMMANDS.systemActors?.()||[]});
  state.simulationWorld=state.simulationWorld&&typeof state.simulationWorld==='object'?state.simulationWorld:{};
  if(!Array.isArray(state.simulationWorld.competitors)||state.simulationWorld.competitors.length!==competitorSeed.length)state.simulationWorld.competitors=clone(competitorSeed);
  if(!Array.isArray(state.simulationWorld.competitorAssets)||state.simulationWorld.competitorAssets.length!==competitorAssetSeed.length)state.simulationWorld.competitorAssets=clone(competitorAssetSeed);
  const competitors=state.simulationWorld.competitors;
  const competitorAssets=state.simulationWorld.competitorAssets;
  const simRandom=stream=>window.GH_DETERMINISM.nextFloat(state,stream);
  const nextId=prefix=>window.GH_DETERMINISM.nextId(state,prefix);
  const diag=(type,detail={})=>window.GH_DIAGNOSTICS.record(state,type,detail);
  const nonCritical=(stage,error)=>{diag('NONCRITICAL_ERROR',{stage,message:String(error?.message||error)});console.warn(`[${stage}]`,error);};
  window.GH_MIGRATION_CORE.completeBusinessState(state,{defaultState,initialStocks,crewRolesSeed});
  const legacyBankMigration=window.GH_BANKING_CORE?.migrateLegacyBranches?.(state)||{changed:false,added:0};
  // Company collections are live projections of the platform registry.  Never
  // cache these lists: a newly formed instance must enter UI, finance and map
  // consumers in the same session without a reload.
  function companyTypes(target=state,options={}){
    return COMPANY_PLATFORM.listInstances(target,{includeGroup:false,openedOnly:options.openedOnly===true}).filter(company=>(options.registeredOnly!==true||company.registered||company.opened)&&(options.operationalOnly!==true||company.operational)).map(company=>company.id);
  }
  function companyFinanceTypes(target=state,options={}){
    const books=target?.companyFinance&&typeof target.companyFinance==='object'?target.companyFinance:{};
    const ids=COMPANY_PLATFORM.listInstances(target,{includeGroup:true,openedOnly:options.openedOnly===true,capability:'finance.book'}).filter(company=>(company.id==='group'||company.registered||company.opened)&&(options.operationalOnly!==true||company.operational)).map(company=>company.id);
    return ids.includes('group')?['group',...ids.filter(id=>id!=='group')]:ids;
  }
  const isCompanyType=(value,target=state,options={})=>companyTypes(target,options).includes(String(value||''));
  const isFinanceCompany=(value,target=state,options={})=>companyFinanceTypes(target,options).includes(String(value||''));
  const operationalCompanyInstances=(target=state)=>COMPANY_PLATFORM.listInstances(target,{includeGroup:false,openedOnly:true}).filter(company=>company.operational);
  const operationalCompanyIds=(target=state)=>operationalCompanyInstances(target).map(company=>company.id);
  const companyHasCapability=(target,companyId,capability)=>COMPANY_PLATFORM.hasCapability?.(target,companyId,capability)===true;
  const companyTaxable=(target,companyId)=>COMPANY_PLATFORM.definitionFor?.(target,companyId)?.finance?.vatEnabled!==false;
  const zeroCompanyMap=(target=state)=>Object.fromEntries(operationalCompanyIds(target).map(companyId=>[companyId,0]));
  function uniqueOperationalCompanyForCapability(target,capability){
    const matches=operationalCompanyInstances(target).filter(company=>company.definition?.capabilities?.includes(capability));
    return matches.length===1?matches[0].id:null;
  }
  function resolveOperationalCompanyForSector(target,sector,explicitCompanyId=null){
    sector=String(sector||'').trim();explicitCompanyId=String(explicitCompanyId||'').trim();
    if(explicitCompanyId){
      const company=COMPANY_PLATFORM.resolveCompany(target,explicitCompanyId),sectors=COMPANY_PLATFORM.getSectorIds?.(target,explicitCompanyId)||[];
      return company?.operational&&(!sector||sectors.includes(sector))?explicitCompanyId:null;
    }
    const matches=operationalCompanyInstances(target).filter(company=>(company.definition?.classification?.sectorIds||[]).includes(sector));
    return matches.length===1?matches[0].id:null;
  }
  function contractOwnerCompanyId(contract,target=state){
    const registry=target.contractRegistry?.[contract?.id]||{},explicit=contract?.ownerCompanyId||contract?.companyId||registry.ownerCompanyId||registry.companyId||registry.company;
    return resolveOperationalCompanyForSector(target,contract?.sector,explicit);
  }
  const companyRouteModes=(companyId,target=state)=>COMPANY_PLATFORM.getRouteModes?.(target,companyId)||[];
  const isMobilityCompany=(companyId,target=state)=>COMPANY_PLATFORM.hasCapability?.(target,companyId,'operations.mobility')===true;
  function routingCompanyIds(target=state){
    return COMPANY_PLATFORM.listInstances(target,{includeGroup:false,openedOnly:true}).filter(company=>company.operational&&(company.definition?.classification?.routeModes?.length||company.definition?.capabilities?.includes('operations.mobility'))).map(company=>company.id);
  }
  function routeCompanyFromInput(value,target=state,expectedMode=null){
    value=String(value||'').trim();const direct=COMPANY_PLATFORM.resolveCompany(target,value);if(direct?.operational&&(!expectedMode||companyRouteModes(value,target).includes(expectedMode)))return value;
    const candidates=routingCompanyIds(target).filter(companyId=>(!expectedMode||companyRouteModes(companyId,target).includes(expectedMode))&&companyRouteModes(companyId,target).includes(value));return candidates.length===1?candidates[0]:null;
  }
  function mapFilterFromSelection(selection,target=state,showCompetitors=target.showCompetitors){
    selection=String(selection||'all');
    if(selection==='all')return MAP_FEATURE_CORE.normalizeFilterState({companies:{mode:'all',included:[],excluded:[]},categories:{assets:true,routes:true,facilities:true,infrastructure:false},optionalLayers:{},market:{competitors:Boolean(showCompetitors)}},{state:target,companyPlatform:COMPANY_PLATFORM});
    if(selection==='facility')return MAP_FEATURE_CORE.normalizeFilterState({companies:{mode:'all',included:[],excluded:[]},categories:{assets:false,routes:false,facilities:true,infrastructure:false},optionalLayers:{},market:{competitors:Boolean(showCompetitors)}},{state:target,companyPlatform:COMPANY_PLATFORM});
    if(selection==='airport'||selection==='port')return MAP_FEATURE_CORE.normalizeFilterState({companies:{mode:'all',included:[],excluded:[]},categories:{assets:false,routes:false,facilities:true,infrastructure:true},optionalLayers:{[`infrastructure:${selection}`]:true},market:{competitors:false}},{state:target,companyPlatform:COMPANY_PLATFORM});
    if(COMPANY_PLATFORM.isKnownCompany(selection,target))return MAP_FEATURE_CORE.normalizeFilterState({companies:{mode:'include',included:[selection],excluded:[]},categories:{assets:true,routes:true,facilities:true,infrastructure:false},optionalLayers:{},market:{competitors:Boolean(showCompetitors)}},{state:target,companyPlatform:COMPANY_PLATFORM});
    return MAP_FEATURE_CORE.normalizeFilterState({companies:{mode:'include',included:[],excluded:[]},categories:{assets:false,routes:false,facilities:false,infrastructure:false},optionalLayers:{},market:{competitors:false}},{state:target,companyPlatform:COMPANY_PLATFORM});
  }
  function currentMapFilter(target=state){
    const normalized=target.mapFilterState?MAP_FEATURE_CORE.normalizeFilterState(target.mapFilterState,{state:target,companyPlatform:COMPANY_PLATFORM}):mapFilterFromSelection(target.activeFilter||'all',target,target.showCompetitors);
    return normalized;
  }
  function setMapFilterSelection(selection,target=state){target.activeFilter=String(selection||'all');target.mapFilterState=clone(mapFilterFromSelection(target.activeFilter,target,target.showCompetitors));return target.mapFilterState;}
  state.mapFilterState=clone(currentMapFilter(state));state.showCompetitors=Boolean(state.mapFilterState.market.competitors);
  const mapCompanyVisible=(companyId,target=state)=>MAP_FEATURE_CORE.companyVisible(currentMapFilter(target),companyId,{state:target,companyPlatform:COMPANY_PLATFORM});
  const mapCategoryVisible=(category,target=state)=>MAP_FEATURE_CORE.categoryVisible(currentMapFilter(target),category);
  const mapLayerVisible=(category,companyId=null,layerId='runtime',target=state,market=null)=>MAP_FEATURE_CORE.layerVisible(currentMapFilter(target),{id:layerId,category,companyId,market,defaultVisible:true},{state:target,companyPlatform:COMPANY_PLATFORM});
  const companyFinanceName=type=>window.GH_IDENTITY?.legalName?.(state,type)||(type==='group'?state.profile.name:(state.companyRegistry?.[type]?.legalName||typeName(type)));
  function ensureCompanyFinance(){return window.GH_FINANCE_CORE?.ensure?.(state);}
  function companyBook(type='group'){return window.GH_FINANCE_CORE.book(state,type);}
  const companyOperatingBalance=type=>window.GH_FINANCE_CORE.operating(state,type);
  const companyOperatingBalanceFor=(target,type)=>window.GH_FINANCE_CORE.operating(target,type);
  const companyTotalBalance=type=>window.GH_FINANCE_CORE.total(state,type);
  if(!state.companyBudgets||typeof state.companyBudgets!=='object'||Array.isArray(state.companyBudgets))state.companyBudgets={};
  function companyBudget(type='group'){return window.GH_FINANCE_CORE.budget(state,type);}
  const companyBudgetRemaining=type=>window.GH_FINANCE_CORE.remaining(state,type);
  async function transferWithinCompany(type,amount,toReserve=true){const out=await runAuthorizedDomainCommand('finance','transfer-reserve',{company:type,amount,toReserve});return Number(out.result?.amount)>0;}
  function reconcileConsolidatedCash(){return window.GH_FINANCE_CORE.reconcile(state);}
  function canCompanySpend(type,amount,line=null){return window.GH_FINANCE_CORE.canSpend(state,type,amount,line);}
  const canCompanySpendFor=(target,type,amount,line=null)=>window.GH_FINANCE_CORE.canSpend(target,type,amount,line);
  function companyLedger(type,entry){const b=companyBook(type),row=window.GH_DOCUMENT_PROOF?.ledgerProjection?window.GH_DOCUMENT_PROOF.ledgerProjection(state,entry):clone(entry);b.ledger.unshift(row);return row;}
  async function transferBetweenCompanies(from,to,amount,note='تحويل داخلي بين شركات المجموعة'){const out=await runAuthorizedDomainCommand('finance','transfer',{from,to,amount,note});return out.ok&&out.result?.transferred===true;}
  function transferBetweenCompaniesSystem(target,from,to,amount,note,actor='financial-close'){const out=dispatchSystemCommand({state:target},'finance','transfer',{from,to,amount,note},{actor});return out.ok&&out.result?.transferred===true;}
  async function bulkTransferFromGroup(rows,note='توزيع رأسمالي جماعي من الشركة القابضة'){
    const opened=new Set((state.openedCompanies||[]).filter(t=>isCompanyType(t,state,{openedOnly:true,operationalOnly:true})));
    const clean=(Array.isArray(rows)?rows:[]).map(x=>({company:String(x.company||''),amount:Math.round((Number(x.amount)||0)*100)/100})).filter(x=>opened.has(x.company)&&x.amount>0);
    if(!clean.length)return {ok:false,reason:'لم تحدد أي مبالغ للشركات.'};
    try{const out=await runAuthorizedDomainCommand('finance','bulk-transfer',{rows:clean,note});return {ok:true,...(out.result||{})};}catch(error){return {ok:false,reason:error.message||'تعذر التحويل الجماعي.'};}
  }

  function creditCompany(type,amount,note='إيراد تشغيلي',method='تحويل عميل',taxable=true){const out=dispatchSystemCommand({state},'finance','credit',{company:type,amount,note,method,taxable},{actor:'simulation'});return !!out.result;}
  ensureCompanyFinance();reconcileConsolidatedCash();
  if(!window.GH_BUSINESS_WORLD?.execute)throw new Error('Business World Core failed to load before app.js');
  const competitorBusinessSectors=raw=>{const text=String(raw||'');if(/طيران/.test(text))return ['air'];if(/بحر|شحن بحري|خدمات بحرية/.test(text))return ['sea'];if(/لوجست|مستودع|نقل/.test(text))return ['road'];if(/طاقة|بنية تحتية/.test(text))return ['power'];if(/مصرف|بنك|تمويل/.test(text))return ['bank'];return [];};
  window.GH_BUSINESS_WORLD.execute({state},'sync-world',{
    customers:contracts.map(x=>({name:x.client,sector:x.sector,sectors:[x.sector],industry:x.category||'عميل تجاري'})),
    suppliers:strategicPartners,
    competitors:competitors.map(x=>({...x,sectors:competitorBusinessSectors(x.sector)})),
    opportunities:contracts.map(x=>({...x,status:state.acceptedContracts?.includes(x.id)?'نشط':state.contractRegistry?.[x.id]?.status==='بانتظار التوقيع'?'بانتظار التوقيع':state.contractRegistry?.[x.id]?.status==='منتهي'?'منتهي':state.failedBids?.includes(x.id)?'خسر العرض':'متاحة'}))
  });
  if (!state.governance) state.governance=clone(defaultState.governance);
  if (!state.research) state.research=clone(defaultState.research);
  if (!state.esg) state.esg=clone(defaultState.esg);
  if(!state.sustainability||typeof state.sustainability!=='object')state.sustainability={targetYear:2035,renewableShare:12,safShare:0,shorePower:0,electricRoadShare:0,circularity:42,waterScore:55,supplyChainScore:60,disclosure:68,carbonIntensity:100,programs:{},lastReviewDay:0};
  if (!Array.isArray(state.insurancePolicies)) state.insurancePolicies=[];
  if (!state.ipo) state.ipo=clone(defaultState.ipo);
  if (!Array.isArray(state.globalBases)) state.globalBases=[];
  if (!Array.isArray(state.customHubs)) state.customHubs=[];
  if (!Array.isArray(state.customRoutes)) state.customRoutes=[];
  if (!state.routeEndpoints || Array.isArray(state.routeEndpoints) || typeof state.routeEndpoints!=='object') state.routeEndpoints={};
  if (!Array.isArray(state.leasedAssets)) state.leasedAssets=[];
  if (!state.routeCache || Array.isArray(state.routeCache) || typeof state.routeCache!=='object') state.routeCache={};
  function pruneRouteCache(maxEntries=160){
    const active=new Set([...(state.assets||[]).map(a=>a.routeId).filter(Boolean),...(state.customRoutes||[]).map(r=>r.id).filter(Boolean)]);
    const rows=Object.entries(state.routeCache).filter(([id,v])=>v&&Number.isFinite(Number(v.distanceKm))&&((Array.isArray(v.route)&&v.route.length>=2)||v.canonicalRouteId===id));
    rows.sort((a,b)=>{const av=active.has(a[0])?1:0,bv=active.has(b[0])?1:0;if(av!==bv)return bv-av;const bs=Number(b[1].cachedAtSim),as=Number(a[1].cachedAtSim);if(Number.isFinite(bs)||Number.isFinite(as))return (Number.isFinite(bs)?bs:-1)-(Number.isFinite(as)?as:-1);return Date.parse(b[1].updated||0)-Date.parse(a[1].updated||0);});
    state.routeCache=Object.fromEntries(rows.slice(0,Math.max(20,Math.min(160,maxEntries))));
  }
  pruneRouteCache();
  if(window.GH_ADVANCED)window.GH_ADVANCED.migrate(state);
  window.GH_PERSISTENCE?.migrateMetadata?.(state);
  if(window.GH_REALISM)window.GH_REALISM.migrate(state);
  if(window.GH_FLEET_CORE?.reconcileStaffing)window.GH_FLEET_CORE.reconcileStaffing(state,id=>findFacility(id));
  if (state.saveVersion !== SAVE_SCHEMA_VERSION) state.saveVersion = SAVE_SCHEMA_VERSION;
  state.customRoutes.forEach(route=>{if(route?.id&&Array.isArray(route.route)){routeTemplates[route.id]=prepareRoute(clone(route));}});
  const legacyRouteExclusivity=normalizeLegacyRouteAssignments();
  if(dedupeCustomRoutes()||legacyBankMigration.changed||legacyRouteExclusivity.changed) save();
  // ترحيل المسارات البحرية القديمة التي كانت خطوطًا عامة إلى شبكة الممرات البحرية الحالية.
  let maritimeMigrationChanged=false;
  Object.values(routeTemplates).filter(route=>route.type==='sea'&&route.maritimeGeometryVersion!==310&&!state.assets.some(asset=>asset.routeId===route.id&&asset.phase==='moving')).forEach(route=>{
    if(rebuildMaritimeRoute(route)){maritimeMigrationChanged=true;const saved=state.customRoutes.find(r=>r.id===route.id);if(saved)Object.assign(saved,clone(route));}
  });
  if(maritimeMigrationChanged)save();

  // Normalize legacy documents to the parent company so every document has an accountable legal entity.
  state.finance.invoices.forEach(d=>{if(!d.company)d.company='group';d.companyName=companyFinanceName(d.company);d.accountId=d.accountId||companyBook(d.company).accounts[0].id;});state.finance.cheques.forEach(d=>{if(!d.company)d.company='group';d.companyName=companyFinanceName(d.company);d.accountId=d.accountId||companyBook(d.company).accounts[0].id;if(!d.beneficiary)d.beneficiary=`حساب الموردين المعتمدين — ${companyFinanceName(d.company)}`;});state.finance.payables.forEach(d=>{if(!d.company)d.company='group';});state.finance.receivables.forEach(d=>{if(!d.company)d.company='group';});
  state.finance.periods=Array.isArray(state.finance.periods)?state.finance.periods:[];state.finance.journalEntries=Array.isArray(state.finance.journalEntries)?state.finance.journalEntries:[];state.finance.payrollReports=Array.isArray(state.finance.payrollReports)?state.finance.payrollReports:[];state.finance.taxSettlements=Array.isArray(state.finance.taxSettlements)?state.finance.taxSettlements:[];state.finance.debtRecords=Array.isArray(state.finance.debtRecords)?state.finance.debtRecords:[];state.finance.debtSettlements=Array.isArray(state.finance.debtSettlements)?state.finance.debtSettlements:[];
  // Current-period accrual is not a closed tax obligation. Only migrate the
  // balance not represented by the open VAT period; never crystallize it on reload.
  for(const type of companyFinanceTypes()){const book=companyBook(type),legacy=Math.max(0,(Number(book.taxPayable)||0)-taxAccrualPreview(type).net);if(legacy>0&&!state.finance.periods.some(p=>(p.company||'group')===type&&p.status==='مستحق'))state.finance.periods.unshift({id:`TAX-LEGACY-${type}`,company:type,companyName:companyFinanceName(type),period:'رصيد ضريبي مرحّل قبل Build242',amount:legacy,dueDay:Math.floor(state.simSeconds/86400)+15,status:'مستحق',legacy:true});}
  refreshTaxPayables();
  function cleanupObsoleteStorage(){
    try{
      legacyStorageKeys.forEach(k=>localStorage.removeItem(k));
      localStorage.removeItem('global-holdings-persistent-content');
      const backups=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('global-holdings-pre-update-'))backups.push(k);}
      backups.sort((a,b)=>Number(b.split('-').pop())-Number(a.split('-').pop())).slice(3).forEach(k=>localStorage.removeItem(k));
    }catch(error){console.warn('تعذر تنظيف التخزين القديم',error);}
  }
  cleanupObsoleteStorage();
  let simulationPersistenceTask=null;
  const runtimeInstrumentation={lastCompaction:null,lastSavePreparation:null,pendingCompaction:null,render:{lastFrame:null,lastTargetUpdate:null,lastMarkerAnimation:null,lastStructuralRender:null,maxFrameMs:0,maxTargetUpdateMs:0,maxMarkerAnimationMs:0,maxStructuralRenderMs:0,frameCounter:0,animationCounter:0,samples:[]}};
  const appMetricClock=()=>globalThis.performance?.now?.()??Date.now();
  function recordRenderMetric(kind,durationMs,detail={}){const render=runtimeInstrumentation.render,row={kind,durationMs:Math.max(0,Number(durationMs)||0),recordedAtMs:Date.now(),...detail};if(kind==='frame'){render.lastFrame=row;render.maxFrameMs=Math.max(render.maxFrameMs,row.durationMs);}else if(kind==='target-update'){render.lastTargetUpdate=row;render.maxTargetUpdateMs=Math.max(render.maxTargetUpdateMs,row.durationMs);}else if(kind==='marker-animation'){render.lastMarkerAnimation=row;render.maxMarkerAnimationMs=Math.max(render.maxMarkerAnimationMs,row.durationMs);}else if(kind==='structural-render'){render.lastStructuralRender=row;render.maxStructuralRenderMs=Math.max(render.maxStructuralRenderMs,row.durationMs);}render.samples.push(row);if(render.samples.length>120)render.samples.shift();return row;}
  window.__GH_APP_RUNTIME_INSTRUMENTATION__=runtimeInstrumentation;
  window.GH_APP_RUNTIME_METRICS=Object.freeze({snapshot:()=>JSON.parse(JSON.stringify({lastCompaction:runtimeInstrumentation.lastCompaction,lastSavePreparation:runtimeInstrumentation.lastSavePreparation,render:runtimeInstrumentation.render}))});
  function cancelSimulationPersistence(){
    const task=simulationPersistenceTask;simulationPersistenceTask=null;if(!task)return;
    if(task.idle&&typeof window.cancelIdleCallback==='function')window.cancelIdleCallback(task.handle);
    else if(!task.idle)clearTimeout(task.handle);
  }
  function scheduleSimulationPersistence(){
    if(hardResetInProgress||durableCommandInProgress||window.__GH_DURABLE_COMMAND_CONTEXT__||window.GH_PERSISTENCE.isLocked())return false;
    if(simulationPersistenceTask)return true;
    const task={epoch:Number(state.resetEpoch)||0,idle:typeof window.requestIdleCallback==='function',handle:null};
    simulationPersistenceTask=task;
    const run=()=>{
      if(simulationPersistenceTask!==task)return;
      simulationPersistenceTask=null;
      if(hardResetInProgress||durableCommandInProgress||window.__GH_DURABLE_COMMAND_CONTEXT__||window.GH_PERSISTENCE.isLocked()||(Number(state.resetEpoch)||0)!==task.epoch)return;
      try{
        const metricClock=()=>globalThis.performance?.now?.()??Date.now(),compactionStart=metricClock();compactSimulationState(false);
        const pending={durationMs:Math.max(0,metricClock()-compactionStart),simSeconds:Number(state.simSeconds)||0,saveRevision:Number(state.saveRevision)||0},sink=window.__GH_APP_RUNTIME_INSTRUMENTATION__;
        if(sink){sink.pendingCompaction=pending;sink.lastCompaction={...pending};}save();
      }catch(error){const sink=window.__GH_APP_RUNTIME_INSTRUMENTATION__;if(sink)sink.pendingCompaction=null;console.warn('تعذر حفظ المحاكاة',error);}
    };
    try{task.handle=task.idle?window.requestIdleCallback(run,{timeout:1500}):setTimeout(run,0);}
    catch(error){simulationPersistenceTask=null;throw error;}
    return true;
  }
  function persistStateNow(options={}){
    if(hardResetInProgress||durableCommandInProgress||window.__GH_DURABLE_COMMAND_CONTEXT__||window.GH_PERSISTENCE.isLocked())return false;
    const metricClock=()=>globalThis.performance?.now?.()??Date.now(),runtimeMetrics=window.__GH_APP_RUNTIME_INSTRUMENTATION__||null,pending=runtimeMetrics?.pendingCompaction||null;
    const metric={kind:'save-preparation',simSeconds:Number(state.simSeconds)||0,saveRevisionBefore:Number(state.saveRevision)||0,compactionMs:Number(pending?.durationMs)||0,baselineIntegrityMs:0,prepareMs:0,finalIntegrityMs:0,persistenceSyncMs:0,totalMs:0,ok:false};
    if(runtimeMetrics)runtimeMetrics.pendingCompaction=null;const totalStart=metricClock();
    try{
      let stageStart=metricClock();const priorCriticalIds=new Set(((window.GH_INTEGRITY_CORE.check(state)?.issues)||[]).filter(x=>x.severity==='critical').map(x=>String(x.id||x.code||x.title)));metric.baselineIntegrityMs=Math.max(0,metricClock()-stageStart);
      stageStart=metricClock();pruneRouteCache();reconcileConsolidatedCash();metric.prepareMs=Math.max(0,metricClock()-stageStart);
      stageStart=metricClock();const integrity=window.GH_INTEGRITY_CORE.check(state);metric.finalIntegrityMs=Math.max(0,metricClock()-stageStart);
      const introducedByThisSave=(integrity?.critical||(integrity?.issues||[]).filter(x=>x.severity==='critical')).filter(x=>!priorCriticalIds.has(String(x.id||x.code||x.title)));
      if(introducedByThisSave.length)throw new Error(`Critical integrity failed: ${introducedByThisSave.map(x=>x.code||x.title).join(',')}`);
      stageStart=metricClock();const out=window.GH_PERSISTENCE.commitState(state,{storageKey,appVersion:APP_VERSION});metric.persistenceSyncMs=Math.max(0,metricClock()-stageStart);
      if(!out.ok)throw new Error(out.reason);
      metric.ok=true;metric.deferred=!!out.deferred;metric.saveRevisionAfter=Number(state.saveRevision)||0;metric.totalMs=Math.max(0,metricClock()-totalStart);if(runtimeMetrics)runtimeMetrics.lastSavePreparation={...metric};
      diag(out.deferred?'SAVE_COALESCED':'SAVE_OK',{bytes:out.utf8Bytes??null,saveRevision:state.saveRevision,deferred:!!out.deferred});return true;
    }catch(error){metric.error=String(error.message||error);metric.totalMs=Math.max(0,metricClock()-totalStart);if(runtimeMetrics)runtimeMetrics.lastSavePreparation={...metric};diag('SAVE_FAILED',{message:String(error.message||error)});if(options.throwOnError)throw error;console.warn('تعذر حفظ اللعبة',error);return false;}
  }
  function save(){
    const tx=window.GH_TRANSACTION_CORE;
    if(tx.isActive()){tx.afterCommit(()=>persistStateNow({throwOnError:true}),{critical:true,priority:100,key:'save'});return true;}
    return persistStateNow();
  }
  if(startupLoadMeta?.source==='native'&&startupLoadMeta.needsCanonicalPersist){
    setTimeout(()=>{try{persistStateNow({throwOnError:true});}catch(error){console.warn('تعذر تثبيت Migration الحفظ Native بعد الإقلاع',error);}},0);
  }
  function routeRuntimeForState(target){
    const runtime={};
    for(const id of BASE_ROUTE_IDS)runtime[id]=prepareRoute(clone(routeTemplates[id]),target);
    for(const route of target.customRoutes||[])if(route?.id&&Array.isArray(route.route))runtime[route.id]=prepareRoute(clone(route),target);
    return runtime;
  }
  function replaceLiveState(snapshot){
    cancelSimulationPersistence();
    window.GH_TRANSACTION_CORE.restoreObject(state,snapshot);
    window.GH_REALISM?.reconcilePendingDeliveryCount?.(state,true);
    const runtime=routeRuntimeForState(state);for(const id of Object.keys(routeTemplates))delete routeTemplates[id];Object.assign(routeTemplates,runtime);
    window.__GH_STATE__=state;
  }
  let durableCommandSettlement=Promise.resolve({committed:false,saveRevision:Number(state.saveRevision)||0});
  async function runDurableStateCommand(name,apply,{afterCommit=null,silent=false}={}){
    if(hardResetInProgress||durableCommandInProgress||window.GH_PERSISTENCE.isLocked()){if(!silent)notice('الحفظ مشغول بعملية ذرية أخرى. لم يتغير أي أصل؛ أعد المحاولة بعد لحظات.');return false;}
    durableCommandInProgress=true;
    let draft=null,committed=false,settleDurableCommand=null;
    durableCommandSettlement=new Promise(resolve=>{settleDurableCommand=resolve;});
    try{
      draft=window.GH_TRANSACTION_CORE?.deepClone?window.GH_TRANSACTION_CORE.deepClone(state):clone(state);const runtime=routeRuntimeForState(draft),previousRevision=Math.max(0,Math.floor(Number(state.saveRevision)||0));
      window.__GH_DURABLE_COMMAND_CONTEXT__={name,liveState:state,draft};
      const priorCriticalIds=new Set(((window.GH_INTEGRITY_CORE.check(state)?.issues)||[]).filter(row=>row.severity==='critical').map(row=>String(row.id||row.code||row.title)));
      const value=await apply({state:draft,routes:runtime});if(value===false)throw new Error(`${name}-rejected`);
      draft.saveRevision=previousRevision+1;
      const shouldYieldForValidation=((draft.assets?.length||0)+(draft.mobility?.vehicles?.length||0))>=500;
      if(shouldYieldForValidation)await yieldForInteractivePaint();
      const schema=window.GH_SAVE_SCHEMA.validate(draft);if(!schema.ok)throw new Error(`invalid-draft:${schema.errors.join(',')}`);
      if(shouldYieldForValidation)await yieldForInteractivePaint();
      const integrity=window.GH_INTEGRITY_CORE.check(draft),critical=(integrity?.critical||(integrity?.issues||[]).filter(row=>row.severity==='critical'));
      const introduced=critical.filter(row=>!priorCriticalIds.has(String(row.id||row.code||row.title)));
      if(introduced.length)throw new Error(`critical-integrity:${introduced.map(row=>row.code||row.id||row.title).join(',')}`);
      if(shouldYieldForValidation)await yieldForInteractivePaint();
      await window.GH_PERSISTENCE.commitDurableState(draft,{storageKey,appVersion:APP_VERSION});
      // Storage has already committed. A publication failure is a recovery
      // condition, never a successful rollback and never safe to retry blindly.
      committed=true;replaceLiveState(draft);diag('DURABLE_COMMAND_COMMITTED',{name,saveRevision:state.saveRevision});
      if(afterCommit){try{await afterCommit(value);}catch(error){diag('DURABLE_COMMAND_PRESENTATION_FAILED',{name,saveRevision:state.saveRevision,reason:String(error.message||error)},'warning');console.warn(`Durable command committed but presentation refresh failed [${name}]`,error);if(!silent)notice('تم حفظ العملية بنجاح، لكن تعذر تحديث العرض. أعد فتح القسم لرؤية الحالة المحفوظة.','warning');}}
      return value;
    }catch(error){if(committed){window.GH_PERSISTENCE.markRecoveryRequired('durable-command-publication-failed');state.speed=0;simulationEngine.cancelAdvance?.('durable-publication-failed');diag('DURABLE_COMMAND_POST_COMMIT_FAILURE',{name,saveRevision:state.saveRevision,reason:String(error.message||error)},'critical');console.error(`Durable command failed after durable commit [${name}]`,error);if(!silent)notice('تم حفظ العملية، لكن حدث خطأ بعد الاعتماد. أوقف التشغيل وأعد فتح اللعبة للتحقق من الحالة المحفوظة.','warning');return true;}diag('DURABLE_COMMAND_ROLLED_BACK',{name,reason:String(error.message||error)},'warning');console.warn(`Durable command rolled back [${name}]`,error);if(!silent)notice(`أُلغي الأمر بالكامل ولم يتغير أي أصل: ${String(error.message||error)}`);return false;}
    finally{
      const context=window.__GH_DURABLE_COMMAND_CONTEXT__?.draft===draft?window.__GH_DURABLE_COMMAND_CONTEXT__:null;
      if(context)delete window.__GH_DURABLE_COMMAND_CONTEXT__;durableCommandInProgress=false;
      settleDurableCommand?.({committed,saveRevision:Number(state.saveRevision)||0});
      if(context?.notices?.length)setTimeout(()=>{for(const row of context.notices)notice(row.text,row.kind);},0);
    }
  }
  function authorizationIdempotencyKey(target,domain,name,payload){
    const revision=Math.max(0,Math.floor(Number(target?.saveRevision)||0)),digest=window.GH_AUTHORIZATION?.digest?.({domain,name,payload,revision})||String(revision);
    return `AUTH-${domain}-${name}-${revision}-${String(digest).slice(0,24)}`.slice(0,160);
  }
  function founderAuthorization(target=state,{legalName=null,create=false}={}){
    const auth=window.GH_AUTHORIZATION;if(!auth?.ensure||!auth?.buildActiveEnvelope)throw new Error('authorization-owner-unavailable');
    const store=auth.ensure(target),person=store.peopleById[FOUNDER_PRINCIPAL_ID]||(create?auth.ensurePrincipal(target,{id:FOUNDER_PRINCIPAL_ID,legalName:legalName||target.profile?.founder||'المؤسس',displayName:legalName||target.profile?.founder||'المؤسس',role:'founder'}):null);
    if(!person)return {person:null,signature:null,mandate:null};
    const signatureId=store.activeSignatureByPerson[FOUNDER_PRINCIPAL_ID],signature=signatureId?store.signatureAssetsById[signatureId]:null;
    let mandate=Object.values(store.mandatesById).find(row=>row?.principalId===FOUNDER_PRINCIPAL_ID&&row.status==='active'&&(row.companyIds||[]).includes('*')&&(row.scopes||[]).includes('*'))||null;
    if(create&&!mandate)mandate=auth.createDefaultMandate(target,{id:FOUNDER_PRINCIPAL_ID,legalName:legalName||person.legalName,companyIds:['*'],scopes:['*']});
    return {person,signature,mandate};
  }
  function createFounderSignature(target,strokes,legalName){
    const auth=window.GH_AUTHORIZATION,validation=window.GH_SIGNATURE_PAD?.validate?.(strokes);if(!validation?.ok)throw new Error(validation?.reason||'signature-invalid');
    founderAuthorization(target,{legalName,create:true});const signature=auth.createVisualSeal(target,{ownerPersonId:FOUNDER_PRINCIPAL_ID,strokes,width:640,height:220,ink:'#123248'});const authority=founderAuthorization(target,{legalName,create:true});return {signature,mandate:authority.mandate,person:authority.person};
  }
  function signatureSnapshot(target,signatureId){
    const row=window.GH_AUTHORIZATION?.ensure?.(target)?.signatureAssetsById?.[signatureId];if(!row)return null;
    const validation=window.GH_AUTHORIZATION.validateVisualSeal?.(row);if(!validation?.ok)throw new Error(`approval-signature-invalid:${validation?.reason||'unknown'}`);
    const expected=window.GH_AUTHORIZATION.digest({format:row.format,ownerPersonId:row.ownerPersonId,version:row.version,strokes:row.strokes,width:row.width,height:row.height,ink:row.ink});if(expected!==row.digest)throw new Error('approval-signature-tampered');
    return clone({id:row.id,ownerPersonId:row.ownerPersonId,ownerNameSnapshot:row.ownerNameSnapshot,version:row.version,kind:row.kind,format:row.format,strokes:row.strokes,width:row.width,height:row.height,ink:row.ink,digest:row.digest,createdAtSim:row.createdAtSim});
  }
  function authorizationSignatureMarkup(document={},options={}){
    try{
      const proofId=document.authorizationProofId||document.authorization?.proofId||null;
      const proofVerification=proofId?window.GH_AUTHORIZATION?.verifyProof?.(state,proofId):null;
      if(proofId&&!proofVerification?.ok)throw new Error(`authorization-${proofVerification?.reason||'proof-unavailable'}`);
      if(document.documentProofId){const documentVerification=window.GH_DOCUMENT_PROOF?.verifyDocument?.(state,document);if(!documentVerification?.ok)throw new Error(documentVerification?.reason||'document-proof-invalid');}
      const proof=proofVerification?.proof||null,inline=document.signatureSnapshot||document.authorization?.signatureSnapshot||null;
      const signatureRef=inline?.visualSealAssetId||inline?.signatureAssetId||inline?.id||document.signature?.signatureRef||document.signatureAssetId||document.visualSealAssetId||proof?.visualSealAssetId||proof?.signatureAssetId;
      const snapshot=inline?.strokes?inline:(signatureRef?signatureSnapshot(state,signatureRef):null);
      if(snapshot?.strokes){
        const expected=window.GH_AUTHORIZATION.digest({format:snapshot.format,ownerPersonId:snapshot.ownerPersonId,version:snapshot.version,strokes:snapshot.strokes,width:snapshot.width,height:snapshot.height,ink:snapshot.ink});if(expected!==snapshot.digest)throw new Error('signature-snapshot-digest-mismatch');
        const referenceDigest=inline?.visualSealDigest||inline?.signatureDigest||document.signature?.digest||proof?.visualSealDigest||proof?.signatureDigest,referenceVersion=inline?.visualSealVersion??inline?.signatureVersion??document.signature?.version??proof?.visualSealVersion??proof?.signatureVersion;
        if(referenceDigest&&referenceDigest!==snapshot.digest)throw new Error('signature-reference-digest-mismatch');if(referenceVersion!=null&&Number(referenceVersion)!==Number(snapshot.version))throw new Error('signature-reference-version-mismatch');
        return `<span class="formation-signature-visual" data-signature-version="${Number(snapshot.version)||1}"${proofId?` data-authorization-proof="${esc(proofId)}"`:''}>${window.GH_SIGNATURE_PAD.svgMarkup(snapshot.strokes,{width:snapshot.width,height:snapshot.height,ink:snapshot.ink})}<small>إصدار ${Number(snapshot.version)||1} · بصمة ${esc(String(snapshot.digest).slice(0,12))}</small></span>`;
      }
    }catch(error){return `<span class="legacy-signature-marker signature-invalid">تعذر التحقق من التوقيع المرئي · ${esc(String(error.message||error))}</span>`;}
    const label=document.authorizationKind==='system-unsealed'?'آلي بموجب التفويض — لا يُستخدم اسم نصي كتوقيع':(options.legacyLabel||'مستند تاريخي سابق لنظام التوقيع المرئي');
    return `<span class="legacy-signature-marker">${esc(label)}</span>`;
  }
  function dispatchSystemCommand(ctx,domain,name,payload={},options={}){
    const actor=String(options.actor||'');
    if(!actor)throw new Error(`system-actor-required:${domain}.${name}`);
    const target=ctx?.state||ctx||state,authority=founderAuthorization(target),validSeal=authority.signature&&window.GH_AUTHORIZATION?.validateVisualSeal?.(authority.signature)?.ok===true&&authority.signature.ownerPersonId===FOUNDER_PRINCIPAL_ID&&authority.mandate?.principalId===FOUNDER_PRINCIPAL_ID;
    const commandOptions={...options,actor};if(validSeal)commandOptions.authority={principalId:FOUNDER_PRINCIPAL_ID,mandateId:authority.mandate.id};else delete commandOptions.authority;
    return window.GH_DOMAIN_COMMANDS.dispatchSystem(ctx,domain,name,payload,commandOptions);
  }
  function authorizedDraftDispatch(target,domain,name,payload={},options={}){
    const authority=founderAuthorization(target);if(!authority.signature||!authority.mandate)throw new Error('active-visual-seal-required');
    const envelope=window.GH_AUTHORIZATION.buildActiveEnvelope(target,{domain,name,payload,principalId:FOUNDER_PRINCIPAL_ID,actor:{kind:'player',principalId:FOUNDER_PRINCIPAL_ID},idempotencyKey:options.idempotencyKey||authorizationIdempotencyKey(target,domain,name,payload)});
    return window.GH_DOMAIN_COMMANDS.dispatchEnvelope({...(options.context||{}),state:target},envelope,options.commandOptions||{});
  }
  async function runAuthorizedDomainCommand(domain,name,payload={},options={}){
    if(domain&&typeof domain==='object'&&!Array.isArray(domain)){const request=domain;domain=request.domain;name=request.name;payload=request.payload||{};options={...request,...options};}
    domain=String(domain||'').trim();name=String(name||'').trim();if(!domain||!name)throw new Error('authorized-command-invalid');
    const authority=founderAuthorization(state);if(!authority.signature||!authority.mandate){openSignatureDialog?.({required:true});if(!options.silent)notice('اعتمد توقيعك المرئي أولًا. لم تُنفذ المعاملة.');throw new Error('active-visual-seal-required');}
    if(hardResetInProgress||durableCommandInProgress||window.GH_PERSISTENCE.isLocked())throw new Error('durable-transaction-in-progress');
    const envelope=window.GH_AUTHORIZATION.buildActiveEnvelope(state,{domain,name,payload,principalId:FOUNDER_PRINCIPAL_ID,actor:{kind:'player',principalId:FOUNDER_PRINCIPAL_ID},idempotencyKey:options.idempotencyKey||authorizationIdempotencyKey(state,domain,name,payload)});
    durableCommandInProgress=true;let committed=false,settle=null;durableCommandSettlement=new Promise(resolve=>{settle=resolve;});
    try{
      const result=await window.GH_DOMAIN_COMMANDS.dispatchDurable({...(options.context||{}),state},envelope,{transactionId:options.transactionId,persistence:{storageKey,appVersion:APP_VERSION},publish:(_live,draft)=>replaceLiveState(draft),afterCommit:options.afterCommit});committed=true;diag('AUTHORIZED_COMMAND_COMMITTED',{domain,name,transactionId:result.transactionId,authorizationProofId:result.value?.authorizationProofId});return result.value;
    }catch(error){diag('AUTHORIZED_COMMAND_ROLLED_BACK',{domain,name,reason:String(error?.message||error)},'warning');if(!options.silent)notice(`أُلغيت المعاملة بالكامل: ${String(error?.message||error)}`);throw error;}
    finally{durableCommandInProgress=false;settle?.({committed,saveRevision:Number(state.saveRevision)||0});}
  }
  async function runAuthorizedCompositeCommand(name,apply,options={}){
    const authority=founderAuthorization(state);if(!authority.signature||!authority.mandate){openSignatureDialog?.({required:true});if(!options.silent)notice('اعتمد توقيعك المرئي أولًا. لم تُنفذ المعاملة.');return false;}
    return runDurableStateCommand(`authorized:${name}`,async context=>{
      const dispatch=(domain,command,payload={},dispatchOptions={})=>authorizedDraftDispatch(context.state,domain,command,payload,dispatchOptions);
      const recordAlert=(text,type='operation')=>window.GH_OPERATIONS_CORE.execute({state:context.state},'record-alert',{text,type});
      return apply({...context,dispatch,recordAlert});
    },options);
  }
  function runBusinessOperation(name,apply){
    const tx=window.GH_TRANSACTION_CORE;
    try{return (tx.isActive()?tx.join:tx.execute)(state,{label:name,apply:()=>{const value=apply();if(value===false)throw new Error(name+'-rejected');return value;}}).value;}
    catch(error){console.warn('Business operation rolled back',name,error);if(!tx.isActive())notice('تعذر إكمال العملية؛ تم التراجع عن أثرها: '+String(error.message||error));return false;}
  }
  function pushAlert(text){
    const result=dispatchSystemCommand({state},'operations','record-alert',{id:nextId('EV'),text,type:'operation'},{actor:'system-ui-notification'});
    if(!result?.ok)throw new Error('Operations alert owner unavailable');
    const tx=window.GH_TRANSACTION_CORE;if(tx?.isActive?.())tx.afterCommit(()=>updateKpis());else updateKpis();
    return true;
  }
  const validMoney = amount => Number.isFinite(Number(amount)) && Number(amount)>=0;
  const operatingBalance = () => companyOperatingBalance('group');
  const canSpend = amount => canCompanySpend('group',amount);
  window.GH_INTERACTION_NOTICE=(text)=>pushAlert(String(text||'تعذر تنفيذ الإجراء.'));
  function notice(text,kind='info'){
    text=String(text||'');const context=window.__GH_DURABLE_COMMAND_CONTEXT__;
    if(context){context.notices=Array.isArray(context.notices)?context.notices:[];if(!context.notices.some(row=>row.text===text&&row.kind===kind))context.notices.push({text,kind});return true;}
    if(window.GH_WORKFLOW?.notify)return window.GH_WORKFLOW.notify(text,kind,{state,panel:activeDrawerPanel});pushAlert(text);return true;
  }
  function ask(message,risk='normal'){if(window.GH_WORKFLOW?.confirm)return window.GH_WORKFLOW.confirm(String(message||''),{state,panel:activeDrawerPanel,risk});return typeof window.confirm==='function'?window.confirm(String(message||'')):false;}

  function supplierFor(sector='all',category='all'){const candidates=strategicPartners.filter(p=>(p.sector==='all'||p.sector===sector)&&(category==='all'||p.category===category));return (candidates.length?candidates:strategicPartners).slice().sort((a,b)=>((b.rating||0)+(b.delivery||0)+(b.compliance||0)-(b.costIndex||1)*35)-((a.rating||0)+(a.delivery||0)+(a.compliance||0)-(a.costIndex||1)*35))[0]||null;}
  function constructionBid(sector,facilityKind,baseCost,siteName){const candidates=strategicPartners.filter(p=>p.category==='construction'&&(p.sector==='all'||p.sector===sector));const bids=candidates.map(p=>{const complexity=facilityKind==='airport-base'?1.22:facilityKind==='port-base'?1.27:facilityKind==='power'?1.34:facilityKind==='hq'?1.12:facilityKind==='bank'?1.06:1.0;const quote=Math.round(baseCost*complexity*(p.costIndex||1));const score=(p.rating||0)*.34+(p.delivery||0)*.24+(p.compliance||0)*.28+(100-Math.min(130,(p.costIndex||1)*100))*.14;return {supplier:p,quote,score:Math.round(score*10)/10};}).sort((a,b)=>b.score-a.score||a.quote-b.quote);return {winner:bids[0]||null,bids:bids.slice(0,4),siteName,facilityKind};}
  async function recordPaidCheque(company,amount,beneficiary,note,invoiceNumber=''){
    return runAuthorizedCompositeCommand('record-paid-cheque',({state:draft,dispatch})=>{const issued=dispatch('finance','issue-cheque',{company,amount,beneficiary,note,invoiceNumber,dueDay:Math.floor(draft.simSeconds/86400)}).result;if(!issued?.id)throw new Error('cheque-not-issued');const settled=dispatch('finance','settle-cheque',{id:issued.id}).result;if(settled?.settled!==true)throw new Error('cheque-not-settled');return settled.id;});
  }
  async function payNamedSupplier(company,amount,supplier,note,method='شيك مصدق',budgetLine='capex'){
    try{const out=await runAuthorizedDomainCommand('procurement','supplier-payment',{company,amount,supplier,note,method,budgetLine});return out.result||null;}catch(error){console.warn('supplier payment rejected',error);return null;}
  }
  function awardConstructionDraft(target,dispatch,recordAlert,company,facilityKind,siteName,baseCost){
    const tender=constructionBid(company,facilityKind,baseCost,siteName);if(!tender.winner)return null;const w=tender.winner;
    if(!canCompanySpendFor(target,company,w.quote,'capex')){
      const have=companyOperatingBalanceFor(target,company),gap=Math.max(0,w.quote-have),groupHave=companyOperatingBalanceFor(target,'group');
      if(company!=='group'&&gap>0&&groupHave>=gap){const funded=dispatch('finance','transfer',{from:'group',to:company,amount:gap,note:`تمويل عقد بناء ${siteName} من الشركة القابضة`}).result;if(funded?.transferred===true)recordAlert(`حُوِّل ${fmtMoney(gap)} من الشركة القابضة إلى ${typeName(company)} لتغطية عقد بناء ${siteName}.`,'finance');}
      if(!canCompanySpendFor(target,company,w.quote,'capex'))return {insufficient:true,quote:w.quote,have:companyOperatingBalanceFor(target,company),groupHave,supplier:w.supplier,bids:tender.bids};
    }
    return dispatch('procurement','award-construction',{company,facilityKind,siteName,bid:w,bids:tender.bids.map(x=>({supplier:x.supplier.legalName||x.supplier.name,quote:x.quote,score:x.score}))}).result||null;
  }
  async function awardConstruction(company,facilityKind,siteName,baseCost){
    return runAuthorizedCompositeCommand('award-construction',({state:draft,dispatch,recordAlert})=>awardConstructionDraft(draft,dispatch,recordAlert,company,facilityKind,siteName,baseCost));
  }
  function ensureBankCorporateClients(){
    const names={};for(const type of companyFinanceTypes())names[type]=companyFinanceName(type);
    try{return dispatchSystemCommand({state},'banking','sync-corporate-clients',{names},{actor:'banking-read-model'}).result||state.bank.corporateClients;}catch(error){console.warn('bank client sync rejected',error);return state.bank.corporateClients||{};}
  }
  function bankLiquidityMetrics(){ensureBankCorporateClients();const m=window.GH_REALISM?.bankingMetrics?.(state);if(m)return {lcr:Math.round(m.lcr),nsfr:Math.round(m.nsfr),loanDeposit:Math.round(m.loanDeposit),hqla:m.hqla,outflows:m.stressedOutflows,cet1:m.cet1,tier1:m.tier1,totalCapital:m.totalCapital,provisionCoverage:m.provisionCoverage};const b=state.bank,hqla=Math.max(0,Number(b.hqla)||0),outflows=Math.max(1,(Number(b.deposits)||0)*.18+(Number(b.wholesaleFunding)||0)*.25),lcr=Math.round(hqla/outflows*100),nsfr=Math.round(Math.max(0,Number(b.stableFunding)||0)/Math.max(1,Number(b.requiredStableFunding)||1)*100),loanDeposit=Math.round((Number(b.loans)||0)/Math.max(1,Number(b.deposits)||1)*100);return {lcr,nsfr,loanDeposit,hqla,outflows};}
  async function bankReviewCorporateLimits(){try{return (await runAuthorizedDomainCommand('banking','review-limits',{})).result===true;}catch(error){console.warn(error);return false;}}
  async function bankDrawCorporateFacility(company,amount=10000000){try{return Number((await runAuthorizedDomainCommand('banking','draw-facility',{company,amount})).result)||0;}catch(error){console.warn(error);return false;}}
  async function bankIssueTradeInstrument(kind,company,amount=5000000){try{return (await runAuthorizedDomainCommand('banking','trade-instrument',{kind,company,amount,counterparty:supplierFor(company==='group'?'all':company,'all')?.legalName||'طرف تجاري مسجل'})).result||null;}catch(error){console.warn(error);return null;}}
  async function bankCashSweep(){try{return Number((await runAuthorizedDomainCommand('banking','cash-sweep',{})).result)||0;}catch(error){console.warn(error);return 0;}}
  function refreshTaxPayables(){return window.GH_FINANCE_CORE.reconcile(state);}
  function postInvoice(kind,amount,note,method='تحويل بنكي',taxable=true,status='مدفوعة',company='group',counterparty='',details={}){return window.GH_FINANCE_CORE.invoice(state,{kind,amount,note,method,taxable,status,company,counterparty,...details});}

  function postAccruedExpense(company,amount,note,method='قيد مستحق',dueDay=null,number=null,expenseAccount='مصروف تشغيلي'){
    company=String(company||'');amount=Math.max(0,Number(amount)||0);if(!isFinanceCompany(company)||amount<=0){console.warn('accrual rejected: company-not-found',company);return null;}
    if(number){const existing=state.finance.invoices.find(x=>x.number===String(number));if(existing)return existing;}
    try{return dispatchSystemCommand({state},'finance','accrue-expense',{company,amount,note,method,dueDay,number,expenseAccount},{actor:'financial-close'}).result||null;}catch(error){console.warn('accrual rejected',error);return null;}
  }

  async function issueCheque(amount,note,beneficiary='',company='group',details={}){try{const before=companyOperatingBalance(company),out=await runAuthorizedDomainCommand('finance','issue-cheque',{amount,note,beneficiary,company,...details}),cheque=out.result,after=companyOperatingBalance(company);if(!cheque?.id||cheque.status!=='صادر'||Math.abs(before-after)>.01)throw new Error('cheque-issuance-mutated-cash');pushAlert(`صدر الشيك ${cheque.id} من ${companyFinanceName(company)} لصالح ${beneficiary}. لم يُخصم المبلغ من الحساب حتى صرف الشيك.`);return cheque.id;}catch(error){notice(`تعذر إصدار الشيك: ${String(error.message||error)}`);return null;}}
  function settleCheque(cheque){return dispatchSystemCommand({state},'finance','settle-cheque',{id:cheque?.id},{actor:'finance-scheduler'}).result;}
  async function settleIssuedCheque(id){const cheque=state.finance.cheques.find(row=>row.id===id);if(!cheque){notice('الشيك غير موجود.');return false;}const stayPanel=activeDrawerPanel,stayArg=activeDrawerArg,stayScroll=$('drawerBody')?.scrollTop||0;try{const before=companyOperatingBalance(cheque.company||'group'),out=await runAuthorizedDomainCommand('finance','settle-cheque',{id}),result=out.result,after=companyOperatingBalance(cheque.company||'group');if(result.settled!==true)throw new Error(result.reason||'cheque-not-settled');if(!(state.godMoney&&state.infiniteMoney)&&Math.abs((before-after)-Number(cheque.amount||0))>.01)throw new Error('cheque-current-account-posting-mismatch');pushAlert(`تم صرف الشيك ${id} وخصم ${fmtMoney(cheque.amount)} من الحساب الجاري لـ${companyFinanceName(cheque.company||'group')}.`);updateKpis();if(stayPanel){openDrawer(stayPanel,stayArg);requestAnimationFrame(()=>{if($('drawerBody'))$('drawerBody').scrollTop=stayScroll;});}return true;}catch(error){notice(`تعذر صرف الشيك: ${String(error.message||error)}`);return false;}}
  async function spendCompany(company,amount,note='مصروف تشغيلي',method='تحويل بنكي',taxable=true){if(!validMoney(Number(amount)))return false;const out=await runAuthorizedDomainCommand('finance','spend',{company,amount,note,method:method==='نقدي'?'تحويل بنكي':method,taxable});return !!out.result;}
  function spendCompanySystem(company,amount,note='مصروف تشغيلي',method='تحويل بنكي',taxable=true){if(!validMoney(Number(amount)))return false;const out=dispatchSystemCommand({state},'finance','spend',{company,amount,note,method:method==='نقدي'?'تحويل بنكي':method,taxable},{actor:'financial-close'});return !!out.result;}
  const spend = (amount,note='مصروف تشغيلي',method='تحويل بنكي',taxable=true) => spendCompany('group',amount,note,method,taxable);

  // ---- HR: موظفو المنشآت والقيادات فقط؛ طواقم الأصول يملكها Fleet Core ----
  function hrContext(){return {candidates,getDynamicFacilities};}
  function ensureFacilityWorkforceDraft(target,dispatch,company='all',source='HR authorized facility staffing'){const result=dispatch('hr','hire',{company,source,scope:'facility'},{context:hrContext()}).result;if(!result)throw new Error('HR Core unavailable');return result.facilities||[];}
  async function ensureFacilityWorkforce(company='all',source='HR authorized facility staffing'){const out=await runAuthorizedDomainCommand('hr','hire',{company,source,scope:'facility'},{context:hrContext()});if(!out.result)throw new Error('HR Core unavailable');return out.result.facilities||[];}
  let map, currentTile, layers = {}, routeLayers = [], ownMarkers = new Map(), facilityMarkers = new Map(), competitorMarkers = new Map(), worldMarkers = new Map(), movingFleetClusters = new Map(), movingMobilityClusters = new Map(), renderedAssetIds = new Set(), renderedMobilityIds = new Set(), fleetCanvasRenderer = null, presentationAssetIndex = new Map(), presentationAssetIndexRevision = -1, presentationAssetIndexLength = -1, presentationAssetIndexSource = null, worldSpatialIndexCache = null, mapAssetQueryRequest = null, mapPresentationPlanRequest = null, mapPresentationPlanGeneration = 0;
  const mapAssetQueryEngine=window.GH_MAP_ASSET_QUERY_CORE?.create?.({
    workerFactory:()=>typeof Worker==='function'?new Worker('map-asset-query-worker.js'):null,
    timeoutMs:3000,
    onFailure:error=>nonCritical('map-asset-query-worker-disabled',error),
    onResult:result=>{
      const current=mapAssetQueryRequest;
      if(!map||!current||current.assets!==state.assets||current.revision!==(Number(state.saveRevision)||0)||current.filterKey!==result.filterKey)return;
      if(current.filterKey!==window.GH_MAP_ASSET_QUERY_CORE.filterKey(currentMapFilter().companies))return;
      renderMap();
    }
  })||null;
  const mapPresentationEngine=window.GH_MAP_PRESENTATION_CORE?.create?.({
    workerFactory:()=>typeof Worker==='function'?new Worker('map-presentation-worker.js'):null,
    timeoutMs:2500,
    onFailure:error=>nonCritical('map-presentation-worker-disabled',error),
    onPlan:result=>{
      const current=mapPresentationPlanRequest;
      if(!map||!current||current.key!==result.key||current.assets!==state.assets||current.revision!==(Number(state.saveRevision)||0)||!mapPresentationEngine)return;
      renderMap();
    },
    onPositions:result=>{
      if(!map||mapInteractionActive||result.generation!==mapPresentationPlanGeneration)return;
      const now=(window.performance?.now?.()||Date.now());
      for(const group of result.groups){const cluster=movingFleetClusters.get(`moving:${group.key}`);if(cluster?.marker&&Array.isArray(group.coords))setMapMarkerTarget(`own:moving:${group.key}`,cluster.marker,group.coords,now,false);}
    }
  })||null;
  let financeReportWorkerResult=null,financeReportSnapshotCache=null,financeReportFallbackCache=null;
  const financeReportEngine=window.GH_FINANCE_REPORT_CORE?.create?.({
    workerFactory:()=>typeof Worker==='function'?new Worker('finance-report-worker.js'):null,
    timeoutMs:3000,
    onFailure:error=>nonCritical('finance-report-worker-disabled',error),
    onResult:result=>{financeReportWorkerResult=result;const body=$('drawerBody');if(activeDrawerPanel==='monthlyFinance'&&body?.querySelector?.('.monthly-finance-report')){body.innerHTML=renderMonthlyFinance();window.GH_INTERFACE?.prepare?.(body,activeDrawerPanel,activeDrawerArg,advancedContext());}}
  })||null;
  const mediaAssetEngine=window.GH_MEDIA_ASSET_CORE?.create?.({imageFactory:()=>new Image(),maxConcurrent:3,maxQueued:32,maxCached:24,onFailure:detail=>nonCritical('media-asset-decode',new Error(`${detail.src}:${detail.error||'decode-failed'}`))})||null;
  function mapMovingPlanInput(rows,zoom,limit){
    const routeIndexes=new Int32Array(rows.length),progress=new Float32Array(rows.length),baseCoordinates=new Float32Array(rows.length*2),assetIds=[],owners=[],modes=[],routeKeys=[],routes=[],routeLookup=new Map(),facilities=new Map();let structuralHash=2166136261;
    const hashValue=value=>{const text=String(value??'');for(let char=0;char<text.length;char++){structuralHash^=text.charCodeAt(char);structuralHash=Math.imul(structuralHash,16777619)>>>0;}structuralHash^=255;structuralHash=Math.imul(structuralHash,16777619)>>>0;};
    for(const facility of getDynamicFacilities()){if(Array.isArray(facility?.coords)&&facility.coords.length===2)facilities.set(facility.id,facility.coords);}
    for(let index=0;index<rows.length;index++){
      const asset=rows[index],routeKey=asset.routeId?String(asset.routeId):'',reverse=asset.reverse===true,routeVariant=routeKey?`${routeKey}:${reverse?1:0}`:'';
      let routeIndex=-1;if(routeKey){routeIndex=routeLookup.get(routeVariant);if(routeIndex===undefined){const route=currentAssetRoute(asset);routeIndex=Array.isArray(route)&&route.length?routes.length:-2;routeLookup.set(routeVariant,routeIndex);if(routeIndex>=0)routes.push(route.map(point=>[Number(point[0]),Number(point[1])]));}}
      const base=facilities.get(asset.baseFacility),offset=index*2;
      routeIndexes[index]=routeIndex;progress[index]=asset.phase==='turnaround'?1:Math.max(0,Math.min(1,Number(asset.progress)||0));
      baseCoordinates[offset]=routeIndex===-1&&Array.isArray(base)?Number(base[0]):NaN;baseCoordinates[offset+1]=routeIndex===-1&&Array.isArray(base)?Number(base[1]):NaN;
      const id=String(asset.id||''),owner=assetOwnerCompanyId(asset)||'',mode=assetModeOf(asset)||'asset';assetIds.push(id);owners.push(owner);modes.push(mode);routeKeys.push(routeKey);hashValue(id);hashValue(owner);hashValue(mode);hashValue(routeKey);hashValue(asset.baseFacility||'');hashValue(reverse?1:0);
    }
    const core=window.GH_MAP_ASSET_QUERY_CORE,filterKey=core?.filterKey?.(currentMapFilter().companies)||'all';
    const key=`${Number(state.saveRevision)||0}:${rows.length}:${structuralHash.toString(36)}:${zoom}:${limit}:${selectedAssetId||''}:${filterKey}`;
    return {key,assetIds,owners,modes,routeKeys,routeIndexes,progress,baseCoordinates,routes,zoom,limit,groupLimit:limit,selectedId:selectedAssetId||''};
  }
  function monthlyFinanceReportInput(months=12){
    const reports=Array.isArray(state.finance?.dailyCompanyReports)?state.finance.dailyCompanyReports:[],companyTypes=window.GH_FINANCE_CORE.companyIds(state,{includeGroup:false}),currentMonthKey=window.GH_FINANCE_CORE.calendarMonthForDay(Math.floor((Number(state.simSeconds)||0)/86400)),firstDay=Number(reports[0]?.day)||0,lastDay=Number(reports[reports.length-1]?.day)||0;
    const key=`${Number(state.saveRevision)||0}:${reports.length}:${firstDay}:${lastDay}:${currentMonthKey}:${companyTypes.join(',')}:${months}`;
    if(financeReportSnapshotCache?.key===key&&financeReportSnapshotCache.reports===reports)return {key,snapshot:financeReportSnapshotCache.snapshot};
    const projected=reports.map(report=>{const companies={};for(const type of companyTypes){const source=report.companies?.[type]||{};companies[type]={income:Math.max(0,Number(source.grossRevenue)||0),expenses:Math.max(0,Number(source.expenses)||0),net:Number(source.net)||0};}return {monthKey:window.GH_FINANCE_CORE.calendarMonthForDay(report.day),day:Number(report.day)||0,net:Number(report.net)||0,group:{income:Math.max(0,Number(report.group?.grossRevenue)||0),expenses:Math.max(0,Number(report.group?.expenses)||0)},companies};});
    const snapshot={months,companyTypes,currentMonthKey,reports:projected};financeReportSnapshotCache={key,reports,snapshot};return {key,snapshot};
  }
  function mapVisibleAssetRows(filterState){
    const assets=Array.isArray(state.assets)?state.assets:[],companies=filterState?.companies||{mode:'all',included:[],excluded:[]},revision=Number(state.saveRevision)||0,core=window.GH_MAP_ASSET_QUERY_CORE;
    if(core&&mapAssetQueryEngine){
      const filterKey=core.filterKey(companies);mapAssetQueryRequest={assets,revision,filterKey};
      const allCompaniesFilter=MAP_FEATURE_CORE.normalizeFilterState({...filterState,companies:{mode:'all',included:[],excluded:[]}},{state,companyPlatform:COMPANY_PLATFORM});
      const indexed=mapAssetQueryEngine.request({assets,revision,filter:companies,ownerOf:assetOwnerCompanyId,isKnownOwner:owner=>MAP_FEATURE_CORE.companyVisible(allCompaniesFilter,owner,{state,companyPlatform:COMPANY_PLATFORM})});
      if(indexed.indices instanceof Uint32Array){
        if(indexed.indices.length===assets.length)return assets;
        return Array.from(indexed.indices,index=>assets[index]).filter(Boolean);
      }
    }
    const included=new Set(Array.isArray(companies.included)?companies.included:[]),excluded=new Set(Array.isArray(companies.excluded)?companies.excluded:[]),knownByOwner=new Map(),visible=[],allCompaniesFilter=MAP_FEATURE_CORE.normalizeFilterState({...filterState,companies:{mode:'all',included:[],excluded:[]}},{state,companyPlatform:COMPANY_PLATFORM});
    for(const asset of assets){
      const owner=assetOwnerCompanyId(asset);if(!owner)continue;
      let known=knownByOwner.get(owner);if(known===undefined){known=MAP_FEATURE_CORE.companyVisible(allCompaniesFilter,owner,{state,companyPlatform:COMPANY_PLATFORM});knownByOwner.set(owner,known);}
      if(!known)continue;
      if(companies.mode==='include'?!included.has(owner):excluded.has(owner))continue;
      visible.push(asset);
    }
    return visible;
  }
  const worldInfrastructureIconCache = new Map();
  let mapTilesOffline=false,mapTileFailures=0,mapTileSuccesses=0;
  function panMapTo(coords, zoom=6){if(map&&Array.isArray(coords)&&coords.length===2&&Number.isFinite(coords[0])&&Number.isFinite(coords[1])){const level=Math.max(map.getZoom()||0,zoom),visible=window.GH_INTERFACE.mapViewport(),rect=map.getContainer().getBoundingClientRect(),center=map.project(coords,level);center.x+=rect.width/2-(visible.left-rect.left+visible.width/2);center.y+=rect.height/2-(visible.top-rect.top+visible.height/2);map.setView(map.unproject(center,level),level);}}
  let selectedAssetId = null, selectedMobilityId = null, selectedFacilityId = null, selectedWorldKey = null, worldRenderTimer = null, activeDrawerPanel = null, activeDrawerArg = null;

  function normalizeAsset(asset){return window.GH_FLEET_CORE.normalizeAsset(asset,{route:routeTemplates[asset.routeId],catalogItem:catalogItem(asset.type,asset.catalogId)});}
  function normalizedAssetView(asset){return normalizeAsset(clone(asset));}
  state.assets.forEach(normalizeAsset);

  const maritimePresentationCache=new WeakMap();
  // Map geometry is sampled far more often than simulation state. Keep its
  // cumulative distance table outside saved game state so large fleets do not
  // rebuild the same route geometry on every animation frame.
  const presentationRouteMetricCache=new WeakMap(),reversedPresentationRouteCache=new WeakMap();
  function reversePresentationRoute(points){
    if(!Array.isArray(points))return points;
    let reversed=reversedPresentationRouteCache.get(points);
    if(!reversed){reversed=points.slice().reverse();reversedPresentationRouteCache.set(points,reversed);}
    return reversed;
  }
  function presentationRouteMetrics(route){
    if(!Array.isArray(route)||route.length<2)return null;
    let metrics=presentationRouteMetricCache.get(route);if(metrics)return metrics;
    const cumulative=new Float64Array(route.length);
    for(let i=0;i<route.length-1;i++)cumulative[i+1]=cumulative[i]+haversine(route[i],route[i+1]);
    metrics={cumulative,total:cumulative[cumulative.length-1]};presentationRouteMetricCache.set(route,metrics);return metrics;
  }
  function interpolatePresentationRoute(route,progress){
    if(!route||route.length<2)return route?.[0]||[0,0];
    const metrics=presentationRouteMetrics(route);if(!metrics||!Number.isFinite(metrics.total)||metrics.total<=0)return route[0];
    const normalized=clamp(Number(progress),0,1);if(!Number.isFinite(normalized))return route[route.length-1];
    const target=normalized*metrics.total;if(target>=metrics.total)return route[route.length-1];
    let low=1,high=route.length-1;
    while(low<high){const middle=(low+high)>>1;if(metrics.cumulative[middle]>=target)high=middle;else low=middle+1;}
    const start=low-1,segment=metrics.cumulative[low]-metrics.cumulative[start],ratio=segment===0?0:(target-metrics.cumulative[start])/segment;
    return [route[start][0]+(route[low][0]-route[start][0])*ratio,((route[start][1]+shortestLongitudeDelta(route[start][1],route[low][1])*ratio+540)%360)-180];
  }
  function currentAssetRoute(asset){
    const tpl = routeTemplates[asset.routeId];
    if(!tpl)return null;
    let points=tpl.route;
    // In-flight legacy voyages keep their committed duration/economics. Only
    // their presentation is corrected; idle geometry migrates at next load.
    if(asset.type==='sea'&&tpl.maritimeGeometryVersion!==310){let geometry=maritimePresentationCache.get(tpl);if(!geometry){geometry=buildMaritimeRoute(points[0],points[points.length-1]);if(geometry)maritimePresentationCache.set(tpl,geometry);}if(geometry)points=geometry.route;}
    return asset.reverse ? reversePresentationRoute(points) : points;
  }
  function assetPosition(asset){
    if(asset.routeId){
      const route = currentAssetRoute(asset);
      return interpolatePresentationRoute(route, asset.phase === 'turnaround' ? 1 : asset.progress);
    }
    const base = getDynamicFacilities().find(f=>f.id===asset.baseFacility);
    return Array.isArray(base?.coords)?base.coords:null;
  }
  function assetIcon(type){ return type==='air'?'✈️':type==='sea'?'🚢':'🚛'; }
  function routeBearing(route,progress){
    if(!route||route.length<2)return 0;
    const p=clamp(progress,0,1);
    const a=interpolatePresentationRoute(route,clamp(p-0.01,0,1)), b=interpolatePresentationRoute(route,clamp(p+0.01,0,1));
    if(a[0]===b[0]&&a[1]===b[1]) return 0;
    return bearingBetween(a,b);
  }
  function assetBearing(asset){
    if(!asset.routeId) return 0;
    return routeBearing(currentAssetRoute(asset),asset.phase==='turnaround'?1:asset.progress);
  }
  // ---- أيقونات مركبات حقيقية (خطوط علوية بسيطة، مو رموز إيموجي) تدور فعليًا باتجاه السير ----
  const VEHICLE_SVG = {
    air: '<svg viewBox="0 0 24 24"><path d="M12 1 L14 9 L22 13 L22 15 L14 13 L13 20 L17 22 L17 23 L12 22 L7 23 L7 22 L11 20 L10 13 L2 15 L2 13 L10 9 Z"/></svg>',
    sea: '<svg viewBox="0 0 24 24"><path d="M12 2 L14 9 L14 15 L20 15 L17 21 L7 21 L4 15 L10 15 L10 9 Z"/></svg>',
    road:'<svg viewBox="0 0 24 24"><path d="M3 8 H13 L17 12 H19 V16 H3 Z"/><circle cx="6" cy="17" r="1.7"/><circle cx="16" cy="17" r="1.7"/></svg>'
  };
  const VEHICLE_MARKER_PHOTOS={air:'assets/images/map-aircraft-topdown.png',sea:'assets/images/map-container-ship-topdown.png',road:'assets/images/map-truck-topdown.png',mobility:'assets/images/map-mobility-sedan-topdown.webp'};
  function markerKind(type){return type==='air'?'air':type==='sea'?'sea':type==='mobility'?'mobility':'road';}
  // صورنا العلوية كلها موجّهة إلى أعلى؛ لا تضف انحرافًا خاصًا للشاحنة.
  // الانحراف السابق (-90) كان يجعل الشاحنات تسير بالعرض على الطرق.
  function markerHeading(kind,bearing){return Number(bearing||0);}
  function assetMarkerPhoto(asset){return VEHICLE_MARKER_PHOTOS[markerKind(asset.type)];}
  function vehicleVisualHtml(type,bearing,photo,moving=true,competitor=false){
    const kind=markerKind(type),heading=markerHeading(kind,bearing),className=`vehicle-pin ${kind}${moving?' is-live':''}${competitor?' competitor':''}`,imageSource=photo||VEHICLE_MARKER_PHOTOS[kind];
    mediaAssetEngine?.request?.(imageSource,10);
    const glyph=`<img src="${imageSource}" alt="" draggable="false" decoding="async">`;
    return `<div class="${className}"><span class="vehicle-trail"></span><span class="vehicle-sprite"><span class="vehicle-heading" style="transform:rotate(${heading.toFixed(1)}deg)">${glyph}</span></span><span class="vehicle-beacon"></span></div>`;
  }
  function vehicleMarkerHtml(asset){return vehicleVisualHtml(asset.type,assetBearing(asset),assetMarkerPhoto(asset),asset.phase==='moving');}
  function competitorMarkerHtml(asset){return vehicleVisualHtml(asset.type,routeBearing(asset.route,asset.progress),VEHICLE_MARKER_PHOTOS[markerKind(asset.type)],true,true);}
  function refreshVehicleMarker(marker,type,bearing,moving){
    const element=marker?.getElement?.();if(!element)return;
    const kind=markerKind(type),pin=element.querySelector('.vehicle-pin'),heading=element.querySelector('.vehicle-heading');
    if(pin)pin.classList.toggle('is-live',!!moving);
    if(heading)heading.style.transform=`rotate(${markerHeading(kind,bearing).toFixed(1)}deg)`;
  }
  // ---- أيقونات منشآت حقيقية (مطار/ميناء/مركز لوجستي/طاقة/بنك/مقر) بدل رموز الإيموجي ----
  const FACILITY_SVG = {
    airport: '<svg viewBox="0 0 24 24"><path d="M12 1 L14 9 L22 13 L22 15 L14 13 L13 20 L17 22 L17 23 L12 22 L7 23 L7 22 L11 20 L10 13 L2 15 L2 13 L10 9 Z"/></svg>',
    port:    '<svg viewBox="0 0 24 24"><path d="M12 2 L14 9 L14 15 L20 15 L17 21 L7 21 L4 15 L10 15 L10 9 Z"/></svg>',
    logistics:'<svg viewBox="0 0 24 24"><path d="M3 8 H13 L16 12 H18 V17 H3 Z"/><circle cx="5" cy="17" r="1.7"/><circle cx="15" cy="17" r="1.7"/><path d="M13 8 V5 H21 V12 H18 V9 H13 Z" fill-opacity=".55"/></svg>',
    power:   '<svg viewBox="0 0 24 24"><path d="M13 2 L4 14 H11 L10 22 L20 9 H13 Z"/></svg>',
    bank:    '<svg viewBox="0 0 24 24"><path d="M12 2 L22 8 H2 Z M4 10 V19 H6 V10 M9.5 10 V19 H11.5 V10 M12.5 10 V19 H14.5 V10 M18 10 V19 H20 V10 M2 21 H22 V19 H2 Z"/></svg>',
    mobility:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.8" fill="#07141d"/></svg>',
    hq:      '<svg viewBox="0 0 24 24"><path d="M4 21 V4 H14 V21 M14 9 H20 V21 M4 21 H20"/><path d="M7 6.5 H8.5 V8 H7 Z M10 6.5 H11.5 V8 H10 Z M7 9.5 H8.5 V11 H7 Z M10 9.5 H11.5 V11 H10 Z M7 12.5 H8.5 V14 H7 Z M10 12.5 H11.5 V14 H10 Z M16 11.5 H17.5 V13 H16 Z M16 14.5 H17.5 V16 H16 Z M16 17.5 H17.5 V19 H16 Z" fill-opacity=".6"/></svg>'
  };
  function facilityKindKey(kind){
    if(['airport','airport-base'].includes(kind)) return 'airport';
    if(['port','port-base'].includes(kind)) return 'port';
    if(['depot','logistics'].includes(kind)) return 'logistics';
    if(kind==='power') return 'power';
    if(kind==='bank') return 'bank';
    if(kind==='mobility-center') return 'mobility';
    return 'hq'; // hq, office, acquired وأي نوع إداري آخر
  }
  function facilityMarkerHtml(f){
    const key=facilityKindKey(f.kind),company=facilityOwnerCompanyId(f)||({airport:'air',port:'sea',logistics:'road',power:'power',bank:'bank',mobility:'mobility'}[key]||'group'),logo=window.GH_IDENTITY?.logo?.(state,company);
    return `<div class="marker-core facility-real ${key}" data-company="${esc(company)}">${FACILITY_SVG[key]}${logo?`<img class="facility-brand-logo" src="${esc(logo)}" alt="">`:''}</div>`;
  }
  function facilityVectorMarkup(kind,className='facility-inline-vector'){
    const key=facilityKindKey(kind),svg=(FACILITY_SVG[key]||FACILITY_SVG.hq).replace('<svg ','<svg width="12" height="12" aria-hidden="true" focusable="false" fill="currentColor" ');
    return `<span class="${esc(className)}" aria-hidden="true" style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:7px;background:rgba(13,59,87,.09);color:#0d3b57;vertical-align:middle">${svg}</span>`;
  }
  function typeName(type){const definition=companyDefinition(type);return definition?.identity?.trade?.ar||definition?.identity?.trade?.en||({air:'طيران',sea:'شحن بحري',road:'نقل بري',power:'طاقة',bank:'خدمات مالية',mobility:'تنقل ذكي حسب الطلب'})[type]||'قطاع متنوع';}

  // ---- محرك اقتصاد الرحلة: كل رقم مالي مشتق فعليًا من مواصفات الأصل والمسار والطاقم ----
  function computeTripEconomics(asset, tpl){
    const distanceKm = tpl.distanceKm;
    const hours = (asset.tripSeconds||tpl.tripSeconds)/3600;
    const specs = asset.specs || {};
    let revenue=0, fuelCost=0;
    if(asset.type==='air'){
      const yieldRate = specs.cargo ? YIELD_RATE.cargoTonKm : YIELD_RATE.paxKm;
      revenue = (specs.capacity||0) * UTIL.air * distanceKm * yieldRate * (specs.yieldMultiplier||1);
      fuelCost = (specs.fuelBurnKgPerKm||0) * distanceKm * FUEL_PRICE.jetA1;
    } else if(asset.type==='sea'){
      const distanceNm = distanceKm/1.852;
      const seaYield=specs.capacityUnit==='TEU'?YIELD_RATE.teuNm:specs.capacityUnit==='راكب'?YIELD_RATE.cruiseGuestNm:YIELD_RATE.seaTonNm;
      revenue = (specs.capacity||0) * UTIL.sea * distanceNm * seaYield * (specs.yieldMultiplier||1);
      fuelCost = (specs.fuelTonPerDay||0) * (hours/24) * FUEL_PRICE.bunker;
    } else {
      revenue = (specs.capacity||0) * UTIL.road * distanceKm * YIELD_RATE.roadTonKm * (specs.yieldMultiplier||1);
      fuelCost = specs.electric ? (distanceKm/100)*(specs.energyKWhPer100km||115)*.14 : (distanceKm/100) * (specs.fuelLPer100km||0) * FUEL_PRICE.diesel;
    }
    const monthlyPayroll=Math.max(0,Number(asset.staffing?.monthlyPayroll)||0);
    // الراتب ثابت ويُثبت مرة واحدة في مسير يوم 27؛ لا يصبح تكلفة متغيرة لكل رحلة.
    const crewCost = 0, payrollAllocation=monthlyPayroll/(30*24)*hours;
    const maintReserve = revenue * MAINT_RESERVE_RATE;
    const margin = revenue - fuelCost - crewCost - maintReserve;
    const economics={revenue, fuelCost, crewCost, payrollAllocation,fixedMonthlyPayroll:monthlyPayroll,maintReserve, margin, cashContribution:revenue-fuelCost-maintReserve, hours,distanceKm};
    let adjusted=window.GH_ADVANCED?window.GH_ADVANCED.adjustTripEconomics(state,asset,economics):economics;
    if(window.GH_REALISM)adjusted=window.GH_REALISM.tripModifier(state,asset,adjusted);
    return adjusted;
  }
  function loadLabel(asset){
    const specs=asset.specs||{}; const util = asset.type==='air'?UTIL.air:asset.type==='sea'?UTIL.sea:UTIL.road;
    const used = Math.round((specs.capacity||0)*util);
    return `${fmtNumber(used)} / ${fmtNumber(specs.capacity||0)} ${specs.capacityUnit||''}`;
  }

  function routeFacility(id){return getDynamicFacilities().find(f=>f.id===id);}
  async function requestRoadGeometry(fromCoords,toCoords){
    const result=await window.GH_MAP_PROVIDER.road(fromCoords,toCoords,{compactGeometry:true});
    if(!result.ok){diag('MAP_PROVIDER_DEGRADED',{status:result.status,reason:result.reason},'warning');return null;}
    return result.geometry;
  }
  function applyRoadGeometry(routeId,geometry,saveCache=true){
    const tpl=routeTemplates[routeId];if(!tpl||!geometry?.route)return;
    tpl.route=geometry.route;tpl.routingSource='OSRM · شبكة طرق فعلية';prepareRoute(tpl);
    if(geometry.durationSeconds)tpl.effectiveSpeedKmh=clamp(tpl.distanceKm/(geometry.durationSeconds/3600),42,82);
    tpl.tripSeconds=tpl.distanceKm/tpl.effectiveSpeedKmh*3600;
    if(saveCache)dispatchSystemCommand({state},'routes','cache-geometry',{id:routeId,route:tpl.route,distanceKm:tpl.distanceKm,durationSeconds:geometry.durationSeconds},{actor:'system-routing-provider'});
    state.assets.filter(a=>a.routeId===routeId).forEach(normalizeAsset);
  }
  const ROUTE_CACHE_MAX_AGE_DAYS = 90;
  function isRouteCacheFresh(cached){
    if(!cached?.route&&!cached?.canonicalRouteId)return false;
    const cachedAt=Number(cached.cachedAtSim);
    if(Number.isFinite(cachedAt)&&cachedAt>=0)return (Number(state.simSeconds)||0)-cachedAt < ROUTE_CACHE_MAX_AGE_DAYS*86400;
    if(cached.updated){const legacyAge=Date.now()-new Date(cached.updated).getTime();return Number.isFinite(legacyAge)&&legacyAge<ROUTE_CACHE_MAX_AGE_DAYS*86400000;}
    return true;
  }
  const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
  function operationalRouteIds(type=null){
    const ids=new Set();
    (state.customRoutes||[]).forEach(r=>{if(r?.id&&(!type||r.type===type))ids.add(r.id);});
    state.assets.forEach(a=>{if(a?.routeId&&(!type||a.type===type))ids.add(a.routeId);});
    return ids;
  }
  function operationalRoutes(type=null){
    const ids=operationalRouteIds(type);
    return [...ids].map(id=>routeTemplates[id]).filter(r=>r&&(!type||r.type===type));
  }
  async function hydrateRoadRoutes(){
    // Only routes genuinely owned/used by the player are hydrated. Built-in reference
    // templates must never create route-cache entries or appear as operational routes in a new game.
    const activeIds=operationalRouteIds('road'),changedRouteIds=new Set();let stateChanged=false;
    Object.keys(state.routeCache||{}).forEach(id=>{if(routeTemplates[id]?.referenceOnly&&!activeIds.has(id)){delete state.routeCache[id];stateChanged=true;}});
    const roads=operationalRoutes('road');
    await Promise.all(roads.map(async tpl=>{
      if(tpl.roadGeometryVersion===311&&tpl.roadNetworkDistanceKm>0)return; // Canonical verified road geometry is already saved; never re-request an active trip.
      const cached=state.routeCache[tpl.id];
      if(cached?.canonicalRouteId===tpl.id)return;
      if(isRouteCacheFresh(cached)&&cached.route){applyRoadGeometry(tpl.id,cached,false);changedRouteIds.add(tpl.id);stateChanged=true;return;}
      const from=routeFacility(tpl.fromFacility),to=routeFacility(tpl.toFacility);if(!from||!to)return;
      let geometry=await requestRoadGeometry(from.coords,to.coords);
      if(!geometry){ await delay(1500); geometry=await requestRoadGeometry(from.coords,to.coords); } // محاولة ثانية عند انقطاع مؤقت
      if(geometry){applyRoadGeometry(tpl.id,geometry,true);changedRouteIds.add(tpl.id);stateChanged=true;}
      else if(cached?.route){applyRoadGeometry(tpl.id,cached,false);changedRouteIds.add(tpl.id);stateChanged=true;} // نستمر بالمسار المخزن القديم بدل خط مستقيم مفاجئ
    }));
    if(stateChanged)save();
    if(changedRouteIds.size){
      const selected=selectedAssetId?state.assets.find(asset=>asset.id===selectedAssetId):null;
      // Moving marker targets can consume the new geometry directly. Rebuild only
      // when a selected route polyline itself must change.
      if(selected?.routeId&&changedRouteIds.has(selected.routeId))renderMap();
      else{requestVisualResync();updateMarkerPositions(true);}
    }
  }
  let mobilityStreetHydration=null,lastMobilityStreetHydrationMs=0;
  const mobilityStreetRetries=new Map();
  async function hydrateMobilityStreetRoutes(){
    if(mobilityStreetHydration)return mobilityStreetHydration;
    const wallNow=Date.now(),pending=(window.GH_MOBILITY_CORE?.pendingStreetRoutes?.(state,8)||[]).filter(request=>(mobilityStreetRetries.get(request.key)?.retryAt||0)<=wallNow).slice(0,3);if(!pending.length)return null;
    mobilityStreetHydration=(async()=>{
      let changed=false;
      for(const request of pending){
        let result=null;try{result=await window.GH_MAP_PROVIDER.road(request.fromCoords,request.toCoords);}catch(error){nonCritical('mobility-street-route-provider',error);}
        if(!result?.ok||!result.geometry?.route){const previous=mobilityStreetRetries.get(request.key),attempts=Math.min(8,(previous?.attempts||0)+1),delayMs=Math.min(120000,2500*(2**Math.min(5,attempts-1)));mobilityStreetRetries.set(request.key,{attempts,retryAt:Date.now()+delayMs});continue;}
        try{dispatchSystemCommand({state},'mobility','cache-street-route',{...request,...result.geometry},{actor:'system-mobility-routing-provider'});mobilityStreetRetries.delete(request.key);changed=true;}catch(error){nonCritical('mobility-street-route-cache',error);}
      }
      if(changed){save();renderMap();}
      return changed;
    })().finally(()=>{mobilityStreetHydration=null;});
    return mobilityStreetHydration;
  }

  function setMapLayer(name){
    if(!map)return;const selected=layers[name]?name:'standard',layer=layers[selected]||layers.standard;if(currentTile)map.removeLayer(currentTile);mapTileFailures=0;mapTileSuccesses=0;setMapTilesOffline(false);currentTile=layer.addTo(map);
    state.mapLayer=selected;map.fire('baselayerchange');
    const stage=document.querySelector('.map-stage');stage.classList.remove('map-dark','map-light','map-standard','map-satellite');stage.classList.add(`map-${selected}`);
    document.querySelectorAll('#layerMenu button').forEach(b=>b.classList.toggle('active',b.dataset.layer===selected));
  }

  function setMapTilesOffline(offline){
    const next=!!offline;if(mapTilesOffline===next)return;mapTilesOffline=next;
    const stage=document.querySelector('.map-stage');stage?.classList.toggle('map-tiles-offline',next);
    $('mapStatus')?.classList.toggle('is-offline',next);
    updateMapStatus();
  }
  function observeTileLayer(layer){
    if(!layer?.on)return layer;
    layer.on('tileerror',()=>{if(layer!==currentTile)return;mapTileFailures++;mapTileSuccesses=0;if(mapTileFailures>=2)setMapTilesOffline(true);});
    layer.on('tileload',()=>{if(layer!==currentTile)return;mapTileSuccesses++;if(mapTileSuccesses>=2){mapTileFailures=0;setMapTilesOffline(false);}});
    return layer;
  }

  function initMap(){
    if(!window.L){
      $('map').innerHTML='<div style="height:100%;display:grid;place-items:center;background:#84958a;color:#152024;padding:28px;text-align:center;font-weight:700">تعذر تهيئة الخريطة المحلية. بيانات اللعبة والحفظ لم تتأثر؛ افتح مركز التشخيص للحصول على سبب الخطأ.</div>';
      return;
    }
    map = L.map('map',{zoomControl:true,minZoom:2,maxZoom:19,worldCopyJump:true,preferCanvas:true}).setView([22,28],3);
    const terrainPane=map.createPane('localTerrain');terrainPane.style.zIndex='160';terrainPane.style.pointerEvents='none';
    L.tileLayer('assets/maps/ne2/{z}/{x}/{y}.webp',{pane:'localTerrain',tileSize:L.Browser.retina?128:256,zoomOffset:L.Browser.retina?1:0,maxNativeZoom:L.Browser.retina?3:4,maxZoom:19,minZoom:2,attribution:'Natural Earth'}).addTo(map);
    const osmOptions={maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'};
    layers.standard = observeTileLayer(L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{...osmOptions,minZoom:5}));
    layers.street = observeTileLayer(L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',osmOptions));
    layers.light = layers.standard;
    layers.dark = layers.standard;
    layers.satellite = observeTileLayer(L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'}));
    setMapLayer(['street','satellite'].includes(state.mapLayer)?state.mapLayer:'standard');
    const countryPane=map.createPane('countryLabels');countryPane.style.zIndex='380';countryPane.style.pointerEvents='none';
    const countryLabels=L.layerGroup().addTo(map),updateCountryLabels=()=>{countryLabels.clearLayers();const zoom=map.getZoom();if(zoom>5||state.mapLayer==='street')return;const minimum=zoom<4?20000000:zoom<5?3000000:1000000,size=map.getSize(),placed=[];for(const row of [...(window.GH_MAP_LABELS||[])].sort((a,b)=>b.population-a.population)){if(row.population<minimum)continue;const point=map.latLngToContainerPoint(row.coords),width=Math.min(132,Math.max(40,row.name.length*6)),box={x:point.x-width/2,y:point.y-12,w:width,h:24};if(box.x+box.w<0||box.y+box.h<0||box.x>size.x||box.y>size.y||placed.some(b=>box.x<b.x+b.w+8&&box.x+box.w+8>b.x&&box.y<b.y+b.h+4&&box.y+box.h+4>b.y))continue;placed.push(box);L.marker(row.coords,{pane:'countryLabels',interactive:false,keyboard:false,icon:L.divIcon({className:'ui-country-label',html:esc(row.name),iconSize:[width,24],iconAnchor:[width/2,12]})}).addTo(countryLabels);}};
    map.on('zoomend moveend resize baselayerchange',updateCountryLabels);updateCountryLabels();
    const setInteractionState=active=>{mapInteractionActive=!!active;if(!active){requestVisualResync();updateMarkerPositions(true);}};
    map.on('movestart zoomstart dragstart',()=>setInteractionState(true));
    map.on('moveend dragend',()=>{setInteractionState(false);clearTimeout(worldRenderTimer);worldRenderTimer=setTimeout(renderWorldInfrastructureMarkers,140);});
    // إعادة رسم الطبقات الثقيلة فقط عند توقف التكبير، وليس أثناء الحركة.
    map.on('zoomend',()=>{setInteractionState(false);clearTimeout(worldRenderTimer);worldRenderTimer=setTimeout(renderMap,120);});
    renderMap();
    hydrateRoadRoutes();
  }

  function dynamicFacilitiesFor(target){
    const branches = (target.branches||[]).map(id=>{
      const site=expansionSites.find(x=>x.id===id);
      return site ? {...site,kind:'office',owned:true,photo:PHOTOS.facility_hq,detail:'مقر إقليمي افتتحته المجموعة ويضيف تكاليف تشغيلية وقدرة توسع عالمية.',capacity:'مقر إقليمي'} : null;
    }).filter(Boolean);
    const acquired = competitors.filter(c=>(target.stakes?.[c.id]||0)>=51).map(c=>({id:`ACQ-${c.id}`,kind:'acquired',owned:true,icon:'🏢',photo:PHOTOS.facility_hq,name:`${c.name} — شركة تابعة`,city:c.hq,country:'دولي',coords:c.coords,detail:`حصة المجموعة ${target.stakes[c.id]}%. أصبحت الشركة ضمن نطاق السيطرة التشغيلية.`,capacity:c.sector}));
    const publicEndpoints=Object.values(target.routeEndpoints||{}).filter(endpoint=>endpoint&&endpoint.id&&Array.isArray(endpoint.coords));
    return [...facilities,...(target.globalBases||[]),...(target.customHubs||[]),...publicEndpoints,...branches,...acquired];
  }
  function getDynamicFacilities(){return dynamicFacilitiesFor(state);}
  function routeFacilityFor(target,id){return dynamicFacilitiesFor(target).find(f=>f.id===id)||null;}

  function endpointMatchesWorldEntity(endpoint,entity){
    if(!endpoint||!entity||endpoint.kind!==entity.kind)return false;
    if(endpoint.sourceKey&&endpoint.sourceKey===entity.key)return true;
    if(entity.kind==='airport'&&(endpoint.icao===entity.icao||endpoint.iata&&endpoint.iata===entity.iata))return true;
    if(entity.kind==='port'&&endpoint.code===entity.code&&Array.isArray(endpoint.coords))return haversine(endpoint.coords,entity.coords)<8;
    return false;
  }
  function ensurePublicRouteEndpoint(entity,target=state){
    const existing=dynamicFacilitiesFor(target).find(endpoint=>endpointMatchesWorldEntity(endpoint,entity));
    if(existing)return existing;
    const code=String(entity.icao||entity.code||window.GH_DETERMINISM.nextId(target,'PLACE')).replace(/[^A-Za-z0-9_-]/g,'-');
    const coordKey=`${Math.round((entity.coords?.[0]||0)*100)}-${Math.round((entity.coords?.[1]||0)*100)}`;
    const id=`PUBLIC-${entity.kind==='airport'?'AIR':'SEA'}-${code}-${coordKey}`;
    const endpoint={
      id,sourceKey:entity.key,kind:entity.kind,public:true,routeEndpoint:true,icon:entity.icon,
      photo:entity.kind==='airport'?PHOTOS.facility_airport:PHOTOS.facility_port,
      name:entity.name,city:entity.city,country:entity.country,coords:entity.coords,
      code:entity.code,iata:entity.iata,icao:entity.icao,elevationFt:entity.elevationFt,terminal:entity.terminal,
      capacity:entity.kind==='airport'?'تشغيل جوي عام':'تشغيل بحري عام',
      detail:`${entity.kind==='airport'?'مطار':'ميناء'} عام أضيف إلى شبكة الخطوط. لا يلزم امتلاك قاعدة أو مركز فيه لتشغيل مسار منه أو إليه.`
    };
    window.GH_ROUTE_CORE.execute({state:target},'register-endpoint',{endpoint});
    return endpoint;
  }
  function routeEndpointName(endpoint){return endpoint?.city||endpoint?.name||'وجهة عالمية';}
  function roadLocationName(endpoint){
    if(!endpoint)return 'نقطة تشغيل';
    return endpoint.kind==='logistics'?endpoint.name:(endpoint.city||endpoint.name||'نقطة تشغيل');
  }
  function routeOriginForAsset(asset,target=state,runtime=routeTemplates,facilityIndex=null){
    const findFacility=id=>facilityIndex?.get?.(id)||routeFacilityFor(target,id);
    const base=findFacility(asset.baseFacility);
    if(base)return base;
    const route=runtime[asset.routeId];
    if(route){
      const endpointId=asset.reverse?route.fromFacility:route.toFacility;
      return findFacility(endpointId);
    }
    return null;
  }
  function assetRangeKm(asset){return asset.type==='sea'?(asset.specs?.rangeNm||0)*1.852:(asset.specs?.rangeKm||0);}
  function routeFitsAsset(asset,route){
    const range=assetRangeKm(asset),leg=asset.type==='road'?(route.roadNetworkDistanceKm||route.distanceKm||routeDistance(route.route)):(route.maxLegKm||routeLongestLeg(route.route));
    return !range||leg<=range*1.005;
  }
  function buildPublicRoute(asset,origin,destination,target=state,routeId=null){
    normalizeCanonicalAsset(asset,target);routeId=routeId||window.GH_DETERMINISM.nextId(target,assetModeOf(asset)==='air'?'AIRPUB':'SEAPUB');const type=assetModeOf(asset),ownerCompanyId=assetOwnerCompanyId(asset);
    const geometry=type==='air'
      ? buildAirRouteWithTechnicalStops(origin.coords,destination.coords,assetRangeKm(asset))
      : buildMaritimeRoute(origin.coords,destination.coords);
    if(!geometry)return null;
    const speed=type==='air'
      ? Math.max(420,Math.min((asset.specs?.speedKmh||780)*.88,860))
      : Math.max(18,Math.min((asset.specs?.speedKn||18)*1.852*.87,39));
    const technicalStops=geometry.technicalStops||[];
    const prefix=type==='air'?'AIR':'SEA';
    return prepareRoute({
      id:routeId,type,routeMode:type,ownerCompanyId,
      name:`${routeEndpointName(origin)} → ${routeEndpointName(destination)}`,
      from:routeEndpointName(origin),to:routeEndpointName(destination),fromFacility:origin.id,toFacility:destination.id,
      route:geometry.route,maxLegKm:geometry.maxLegKm,effectiveSpeedKmh:speed,
      dwellHours:type==='air'?1.1+technicalStops.length*.35:9,
      technicalStops,laneNodes:geometry.laneNodes||[],publicAccess:true,...(type==='sea'?{maritimeOnly:true,maritimeGeometryVersion:310}:{}),
      routingSource:type==='air'?(technicalStops.length?'ممر جوي دولي + توقفات تقنية عامة':'ممر جوي دولي مباشر'):'ممرات بحرية عالمية تقديرية'
    },target);
  }
  function globalRouteSector(coords){
    const lat=Number(coords?.[0])||0,lon=((Number(coords?.[1])||0)+540)%360-180,latBand=lat<-23?'S':lat>23?'N':'E',lonBand=Math.floor((lon+180)/45);
    return `${latBand}:${Math.max(0,Math.min(7,lonBand))}`;
  }
  function globalRouteDistanceBand(distanceKm){return distanceKm<2000?'near':distanceKm<6500?'mid':'far';}
  function newRouteDiversityLedger(){return {destinations:new Map(),sectors:new Map(),bands:new Map(),coords:[]};}
  function recordRouteDiversity(ledger,key,coords,distanceKm){
    if(!ledger||!Array.isArray(coords))return;
    const destinationKey=String(key||`${Number(coords[0]).toFixed(3)}:${Number(coords[1]).toFixed(3)}`),sector=globalRouteSector(coords),band=globalRouteDistanceBand(Number(distanceKm)||0);
    ledger.destinations.set(destinationKey,(ledger.destinations.get(destinationKey)||0)+1);ledger.sectors.set(sector,(ledger.sectors.get(sector)||0)+1);ledger.bands.set(band,(ledger.bands.get(band)||0)+1);ledger.coords.push([Number(coords[0]),Number(coords[1])]);
  }
  function worldRouteCandidateSource(type){
    const rows=type==='air'?WORLD.airports:WORLD.ports,project=type==='air'?airportEntity:portEntity,cache=new Map();return Object.freeze({length:rows.length,at(index){if(cache.has(index))return cache.get(index);const raw=rows[index],entity=raw?project(raw):null;cache.set(index,entity);return entity;}});
  }
  function chooseDiverseWorldDestination({source,origin,asset,target,routes,ledger,selectionKey}){
    const length=Math.max(0,Math.trunc(Number(source?.length)||0)),range=assetRangeKm(asset),limit=Math.min(length,900);if(!length||typeof source?.at!=='function'||!origin?.coords)return null;
    const offset=Math.floor(window.GH_DETERMINISM.nextFloat(target,selectionKey)*length),ranked=[];
    for(let index=0;index<limit;index++){
      const candidate=source.at((offset+index*37)%length);if(!candidate?.coords)continue;
      const direct=haversine(origin.coords,candidate.coords);if(direct<35||(range&&direct>range*1.005))continue;
      const key=String(candidate.key||candidate.code||candidate.name||index),sector=globalRouteSector(candidate.coords),band=globalRouteDistanceBand(direct),reuse=ledger.destinations.get(key)||0,sectorUse=ledger.sectors.get(sector)||0,bandUse=ledger.bands.get(band)||0;
      let separation=20000;if(ledger.coords.length)separation=Math.min(...ledger.coords.map(point=>haversine(point,candidate.coords)));
      ranked.push({candidate,index,direct,key,sector,band,reuse,sectorUse,bandUse,separation});
    }
    ranked.sort((a,b)=>a.reuse-b.reuse||a.sectorUse-b.sectorUse||a.bandUse-b.bandUse||b.separation-a.separation||a.index-b.index);
    for(const row of ranked.slice(0,160)){
      const preview=buildPublicRoute(asset,origin,{...row.candidate,id:`PREVIEW-${asset.type}-${row.index}`},target,`PREVIEW-${asset.type.toUpperCase()}-${row.index}`);
      if(!preview||!routeFitsAsset(asset,preview)||window.GH_ROUTE_CORE.conflict(target.customRoutes||[],preview))continue;
      return row;
    }
    return null;
  }
  async function createGlobalRoute(assetId,destinationKey){
    return runAuthorizedCompositeCommand('create-global-route',({state:draft,routes,dispatch})=>{
      const asset=draft.assets.find(item=>item.id===assetId),entity=worldEntityByKey(destinationKey);if(!asset||!entity)throw new Error('الأصل أو الوجهة لم يعودا متاحين');
      const expectedKind=asset.type==='air'?'airport':'port';if(entity.kind!==expectedKind)throw new Error(`يجب اختيار ${asset.type==='air'?'مطار':'ميناء'} لهذا الأصل`);if(asset.phase==='moving')throw new Error('الأصل متحرك ولا يمكن تغيير وجهته');
      const origin=routeOriginForAsset(asset,draft,routes);if(!origin)throw new Error('لا توجد نقطة انطلاق صالحة للأصل');const destination=ensurePublicRouteEndpoint(entity,draft);if(origin.id===destination.id)throw new Error('الوجهة هي موقع الأصل الحالي');
      const route=buildPublicRoute(asset,origin,destination,draft);if(!route||!routeFitsAsset(asset,route))throw new Error('المسار يتجاوز قيود المدى والسلامة');
      const conflict=window.GH_FLEET_CORE.routeConflict(draft,asset.id,route.id,route);if(conflict)throw new Error(`الممر محجوز للأصل ${conflict.name}`);
      const previousRouteId=asset.routeId,replaceable=Boolean(previousRouteId&&(draft.customRoutes||[]).some(row=>row.id===previousRouteId)&&!draft.assets.some(row=>row.id!==asset.id&&row.routeId===previousRouteId));
      dispatch('routes',replaceable?'replace':'create',replaceable?{replaceId:previousRouteId,assetId:asset.id,route}:{route});if(replaceable)delete routes[previousRouteId];routes[route.id]=route;
      dispatch('fleet','assign-route',{id:asset.id,routeId:route.id,baseFacility:asset.baseFacility,phase:'turnaround',route});window.GH_FLEET_CORE.normalizeAsset(asset,{route,catalogItem:catalogItem(asset.type,asset.catalogId)});
      if(!replaceable&&previousRouteId&&previousRouteId!==route.id&&!draft.assets.some(row=>row.routeId===previousRouteId)&&(draft.customRoutes||[]).some(row=>row.id===previousRouteId))window.GH_ROUTE_CORE.execute({state:draft},'delete',{id:previousRouteId});
      window.GH_OPERATIONS_CORE.execute({state:draft},'record-alert',{text:`أُنشئ خط ${asset.type==='air'?'جوي':'بحري'} عام: ${route.name}.`,type:'route'});return {assetId:asset.id,routeId:route.id};
    },{afterCommit:result=>{lastDepartureBlocked=[];renderMap();updateKpis();openDrawer('assetManage',result.assetId);}});
  }
  const yieldFleetPlanning=()=>new Promise(resolve=>setTimeout(resolve,0));
  async function dispatchSharedInternationalNetwork(companyInput){
    const companyId=routeCompanyFromInput(companyInput),type=companyId?companyRouteModes(companyId).find(mode=>['air','sea'].includes(mode)):null;
    if(!companyId||!type)throw new Error('unsupported-shared-international-company');
    await yieldFleetPlanning();
    const label=type==='air'?'الطائرات':'السفن',routeLabel=type==='air'?'الجوية':'البحرية',source=worldRouteCandidateSource(type);
    return runAuthorizedCompositeCommand(`bulk-shared-departure:${companyId}`,async({state:draft,routes,dispatch})=>{
      const eligible=draft.assets.filter(asset=>assetOwnerCompanyId(asset)===companyId&&assetModeOf(asset)===type&&asset.deliveryStatus!=='pending'&&asset.phase!=='moving'&&!asset.departureScheduled&&!asset.salePending).sort((a,b)=>assetRangeKm(a)-assetRangeKm(b)||String(a.id).localeCompare(String(b.id)));
      if(!eligible.length)throw new Error(`لا توجد ${label} متاحة للمغادرة`);
      if(!source.length)throw new Error(`دليل الوجهات ${routeLabel} فارغ`);
      const fleet=window.GH_FLEET_CORE,capacity=fleet.routeCapacity(type),nonTypeRoutes=draft.customRoutes.filter(route=>route.type!==type).length,availableRoutes=Math.max(0,window.GH_ROUTE_CORE.LIMITS.routes-nonTypeRoutes),minimumRoutes=Math.ceil(eligible.length/capacity);
      if(availableRoutes<minimumRoutes)throw new Error(`سعة سجل المسارات لا تكفي لتوزيع أسطول ${label} بأمان؛ المتاح ${availableRoutes} مسار والحد الأدنى المطلوب ${minimumRoutes}`);
      const targetLoad=fleet.automaticRouteTargetLoad(type,eligible.length,availableRoutes),eligibleIds=new Set(eligible.map(asset=>asset.id)),loads=new Map(),waitingByOrigin=new Map(),assignments=[],previousRouteIds=new Set(eligible.map(asset=>asset.routeId).filter(Boolean)),createdRoutes=[],diversity=newRouteDiversityLedger(),diversityRoutes=new Set();
      for(const asset of draft.assets)if(assetOwnerCompanyId(asset)===companyId&&assetModeOf(asset)===type&&asset.routeId&&!eligibleIds.has(asset.id))loads.set(asset.routeId,(loads.get(asset.routeId)||0)+1);
      const registeredRoutes=()=>draft.customRoutes.filter(route=>routeOwnerCompanyId(route)===companyId&&routeModeOf(route)===type&&routes[route.id]);
      for(const asset of eligible){
        const origin=routeOriginForAsset(asset,draft,routes);if(!origin)throw new Error(`${asset.name}: لا توجد نقطة انطلاق ${routeLabel} صالحة`);
        const candidates=registeredRoutes().filter(route=>(loads.get(route.id)||0)<targetLoad&&routeFitsAsset(asset,route)&&(sameUnderlyingFacilityFor(draft,origin.id,route.fromFacility)||sameUnderlyingFacilityFor(draft,origin.id,route.toFacility))).sort((a,b)=>(loads.get(a.id)||0)-(loads.get(b.id)||0)||String(a.id).localeCompare(String(b.id)));
        const existing=candidates[0];
        if(existing){
          loads.set(existing.id,(loads.get(existing.id)||0)+1);assignments.push({asset,route:existing});
          if(!diversityRoutes.has(existing.id)){const fromOrigin=sameUnderlyingFacilityFor(draft,origin.id,existing.fromFacility),point=fromOrigin?existing.route.at(-1):existing.route[0];recordRouteDiversity(diversity,existing.id,point,haversine(origin.coords,point));diversityRoutes.add(existing.id);}
          continue;
        }
        const group=waitingByOrigin.get(origin.id)||{origin,assets:[]};group.assets.push(asset);waitingByOrigin.set(origin.id,group);
      }
      let createdCount=0;
      for(const group of waitingByOrigin.values()){
        group.assets.sort((a,b)=>assetRangeKm(a)-assetRangeKm(b)||String(a.id).localeCompare(String(b.id)));
        for(let offset=0;offset<group.assets.length;offset+=targetLoad){
          const members=group.assets.slice(offset,offset+targetLoad),seedAsset=members[0],choice=chooseDiverseWorldDestination({source,origin:group.origin,asset:seedAsset,target:draft,routes,ledger:diversity,selectionKey:`${type}-fleet:${group.origin.id}:${offset}`}),entity=choice?.candidate;
          if(!entity)throw new Error(`${seedAsset.name}: لا توجد وجهة ${routeLabel} آمنة ومتنوعة ضمن مدى مجموعة الأسطول`);
          const destination=ensurePublicRouteEndpoint(entity,draft),route=buildPublicRoute(seedAsset,group.origin,destination,draft);if(!route)throw new Error(`${seedAsset.name}: تعذر بناء هندسة المسار ${routeLabel}`);
          if(members.some(asset=>!routeFitsAsset(asset,route)))throw new Error(`${seedAsset.name}: المسار المختار لا يناسب كل أصول الدفعة`);
          dispatch('routes','create',{route});routes[route.id]=route;loads.set(route.id,members.length);createdRoutes.push(route);recordRouteDiversity(diversity,entity.key,entity.coords,choice.direct);for(const asset of members)assignments.push({asset,route});
          createdCount++;if(createdCount%3===0)await yieldFleetPlanning();
        }
      }
      if(assignments.length!==eligible.length)throw new Error(`لم يكتمل توزيع جميع ${label} على شبكة التشغيل`);
      const batch=assignments.map(({asset,route})=>({id:asset.id,routeId:route.id,baseFacility:asset.baseFacility,phase:'turnaround',route:routeMatchingFacilityFor(draft,routes,route.id,asset.baseFacility)}));
      const assigned=dispatch('fleet','assign-routes-batch',{assignments:batch}).result;
      if(!Array.isArray(assigned)||assigned.length!==eligible.length)throw new Error(`رفض محرك الأسطول توزيع ${label}`);
      for(const asset of assigned){const route=routeMatchingFacilityFor(draft,routes,asset.routeId,asset.baseFacility);window.GH_FLEET_CORE.normalizeAsset(asset,{route,catalogItem:catalogItem(asset.type,asset.catalogId)});}
      const departures=assigned.map(asset=>({id:asset.id,route:routeMatchingFacilityFor(draft,routes,asset.routeId,asset.baseFacility),load:loadLabel(asset),delaySeconds:fleet.departureDelay(asset)}));
      const departed=dispatch('fleet','depart-batch',{departures}).result;
      if(!Array.isArray(departed)||departed.length!==eligible.length)throw new Error(`رفض محرك الأسطول جدولة مغادرة ${label}`);
      for(const routeId of previousRouteIds)if(!draft.assets.some(asset=>asset.routeId===routeId)&&(draft.customRoutes||[]).some(route=>route.id===routeId)){window.GH_ROUTE_CORE.execute({state:draft},'delete',{id:routeId});delete routes[routeId];}
      const routeIds=[...new Set(assigned.map(asset=>asset.routeId))],moving=assigned.filter(asset=>asset.phase==='moving').length,scheduled=assigned.filter(asset=>asset.departureScheduled).length;
      window.GH_OPERATIONS_CORE.execute({state:draft},'record-alert',{text:`وُزعت ${eligible.length} ${type==='air'?'طائرة':'سفينة'} ذريًا على ${routeIds.length} مسارًا ${routeLabel} مشتركًا؛ ${moving} غادرت و${scheduled} مجدولة بفتحات زمنية، وأُنشئ ${createdRoutes.length} مسار جديد فقط.`,type:'dispatch'});
      return {departed:eligible.length,routeIds,moving,scheduled,createdRoutes:createdRoutes.length,targetLoad};
    },{afterCommit:()=>{lastDepartureBlocked=[];renderMap();updateKpis();openDrawer('routes',companyId);}});
  }
  async function dispatchInternationalNetwork(companyInput){
    const companyId=routeCompanyFromInput(companyInput),mode=companyId?companyRouteModes(companyId).find(value=>['air','sea'].includes(value)):null;
    if(!companyId||!mode){notice('اختر شركة جوية أو بحرية واحدة؛ لا يسمح بأمر مختلط بين شركتين.');return false;}
    return dispatchSharedInternationalNetwork(companyId);
  }
  let roadPlanning=null;
  let roadPlannerWorkerRequestId=0;
  function planRoadRoutesInWorker(input,{signal,onProgress=()=>{}}={}){
    if(typeof Worker!=='function')return Promise.resolve(null);
    let worker;try{worker=new Worker('road-planner-worker.js');}catch(_error){return Promise.resolve(null);}
    const requestId=++roadPlannerWorkerRequestId;
    return new Promise((resolve,reject)=>{
      let settled=false,plannerStarted=false;
      const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',onAbort);try{worker.terminate();}catch{}error?reject(error):resolve(value);};
      const onAbort=()=>{try{worker.postMessage({type:'cancel',requestId});}catch{}finish(new Error('أُلغي حساب المسارات'));};
      worker.onmessage=event=>{const message=event?.data||{};if(message.requestId!==requestId)return;if(message.type==='progress'){plannerStarted=true;onProgress(message.done,message.total);return;}if(message.type==='result'&&Array.isArray(message.plan)){finish(null,message.plan);return;}if(message.type==='error')finish(new Error(String(message.error||'road-planner-worker-failed')));};
      worker.onerror=event=>plannerStarted?finish(event?.error||new Error(event?.message||'road-planner-worker-failed')):finish(null,null);
      worker.onmessageerror=()=>plannerStarted?finish(new Error('road-planner-worker-message-invalid')):finish(null,null);
      if(signal?.aborted){onAbort();return;}signal?.addEventListener('abort',onAbort,{once:true});
      try{worker.postMessage({type:'plan',requestId,input});}catch(error){finish(error);}
    });
  }
  function roadPlanningMarkup(){return roadPlanning?`<p class="road-plan-status" role="status" aria-live="polite">${esc(roadPlanning.text)}</p><button class="secondary-btn cancel-road-plan">إلغاء حساب المسارات</button>`:'';}
  function updateRoadPlanning(done,total){if(!roadPlanning)return;roadPlanning.text=`حساب المسارات ${done} / ${total} — لن تنطلق الشاحنات حتى اكتمال الدفعة`;document.querySelectorAll('.road-plan-status').forEach(node=>{node.textContent=roadPlanning.text;});}
  function roadAssetFingerprint(asset){return JSON.stringify([asset.id,asset.type,asset.baseFacility,asset.routeId,asset.routeSlot,asset.phase,asset.departureScheduled,asset.deliveryStatus,asset.salePending,asset.specs,asset.staffing]);}
  async function dispatchExistingDistinctNetwork(companyInput,assetId=null){
    const companyId=routeCompanyFromInput(companyInput,state,'road'),type='road';
    if(!companyId){notice('اختر شركة لوجستية واحدة صالحة لهذا الأمر.');return false;}
    if(roadPlanning){notice('حساب مسارات اللوجستيات جارٍ بالفعل.');return false;}
    const eligible=state.assets.filter(asset=>assetOwnerCompanyId(asset)===companyId&&assetModeOf(asset)==='road'&&(!assetId||asset.id===assetId)&&asset.deliveryStatus!=='pending'&&asset.phase!=='moving'&&!asset.departureScheduled&&!asset.salePending);
    if(!eligible.length){notice('لا توجد شاحنات متاحة للمغادرة');return false;}
    const snapshot={resetEpoch:state.resetEpoch,assets:state.assets,customRoutes:state.customRoutes,determinism:state.determinism},runtime=routeRuntimeForState(state),preview=eligible.map(asset=>clone(asset)),previewIds=new Set(preview.map(asset=>asset.id)),fingerprints=new Map(preview.map(asset=>[asset.id,roadAssetFingerprint(asset)])),initialLoadByRoute=new Map(),controller=new AbortController(),facilityRows=dynamicFacilitiesFor(state),facilityIndex=new Map(facilityRows.map(facility=>[facility.id,facility]));
    for(const asset of state.assets||[])if(assetOwnerCompanyId(asset)===companyId&&assetModeOf(asset)==='road'&&asset.routeId&&!previewIds.has(asset.id))initialLoadByRoute.set(asset.routeId,(initialLoadByRoute.get(asset.routeId)||0)+1);
    roadPlanning={controller,text:'جاري تجهيز مسارات الشاحنات…'};
    if(activeDrawerPanel==='routes')renderRouteCenterInto();
    const timer=setTimeout(()=>controller.abort(),180000);
    try{
      const roadHardCapacity=window.GH_FLEET_CORE.routeCapacity('road'),nonRoadRouteCount=snapshot.customRoutes.filter(route=>route.type!=='road').length,availableRoadRoutes=Math.max(0,window.GH_ROUTE_CORE.LIMITS.routes-nonRoadRouteCount),minimumRoadRoutes=Math.ceil(preview.length/roadHardCapacity);if(availableRoadRoutes<minimumRoadRoutes)throw new Error('سعة سجل المسارات لا تكفي لتوزيع أسطول الشاحنات بأمان؛ احذف مسارات غير مستخدمة أولًا');
      const targetRouteLoad=window.GH_FLEET_CORE.automaticRouteTargetLoad('road',preview.length,availableRoadRoutes);
      const routeCandidates=Object.values(runtime).filter(route=>!BASE_ROUTE_IDS.has(route.id)||operationalRouteIds('road').has(route.id)),origins=preview.map(asset=>routeOriginForAsset(asset,state,runtime,facilityIndex)),workerInput={assets:preview,routes:routeCandidates,origins,assetOwners:preview.map(asset=>assetOwnerCompanyId(asset)),routeOwners:routeCandidates.map(route=>routeOwnerCompanyId(route)),facilities:facilityRows.map(({id,iata,icao,code})=>({id,iata,icao,code})),initialLoads:Object.fromEntries(initialLoadByRoute),routeCount:snapshot.customRoutes.length,seed:snapshot.determinism?.seed||1,targetRouteLoad,routeCapacity:roadHardCapacity};
      const workerPlan=await planRoadRoutesInWorker(workerInput,{signal:controller.signal,onProgress:updateRoadPlanning});
      const plan=workerPlan||await window.GH_ROAD_PLANNER.plan({assets:preview,routes:routeCandidates,routeCount:snapshot.customRoutes.length,seed:snapshot.determinism?.seed||1,signal:controller.signal,onProgress:updateRoadPlanning,targetRouteLoad,
        originFor:asset=>routeOriginForAsset(asset,state,runtime,facilityIndex),
        routeCapacity:route=>window.GH_FLEET_CORE.routeCapacity(route),
        initialLoad:route=>initialLoadByRoute.get(route.id)||0,
        usable:(asset,route)=>routeModeOf(route)==='road'&&routeOwnerCompanyId(route)===assetOwnerCompanyId(asset)&&routeFitsAsset(asset,route)&&Boolean(asset.baseFacility)&&(sameUnderlyingFacilityFor(state,asset.baseFacility,route.fromFacility)||sameUnderlyingFacilityFor(state,asset.baseFacility,route.toFacility))});
      if(controller.signal.aborted)throw new Error('أُلغي حساب المسارات');
      clearTimeout(timer);document.querySelectorAll('.cancel-road-plan').forEach(button=>{button.disabled=true;});
      return await runAuthorizedCompositeCommand(`bulk-shared-departure:${companyId}`,({state:draft,routes,dispatch})=>{
        const current=draft.assets.filter(asset=>assetOwnerCompanyId(asset)===companyId&&assetModeOf(asset)==='road'&&(!assetId||asset.id===assetId)&&asset.deliveryStatus!=='pending'&&asset.phase!=='moving'&&!asset.departureScheduled&&!asset.salePending);
        if(draft.resetEpoch!==snapshot.resetEpoch||current.length!==preview.length||current.some(asset=>fingerprints.get(asset.id)!==roadAssetFingerprint(asset)))throw new Error('تغيرت الشاحنات أثناء حساب الطرق؛ أعد المحاولة');
        const createdRoutes=new Map(),assignments=[],previousRouteIds=new Set(current.map(asset=>asset.routeId).filter(Boolean));
        for(const row of plan){
          const asset=draft.assets.find(item=>item.id===row.assetId),origin=routeOriginForAsset(asset,draft,routes);
          if(!origin||origin.id!==row.origin.id||facilityOwnerCompanyId(origin)!==companyId||origin.owned!==row.origin.owned||JSON.stringify(origin.coords)!==JSON.stringify(row.origin.coords))throw new Error('تغيرت نقطة انطلاق إحدى الشاحنات أثناء الحساب');
          let route;
          if(row.created){
            const endpoint=routeFacilityFor(draft,row.endpoint.id)||window.GH_ROUTE_CORE.execute({state:draft},'register-endpoint',{endpoint:row.endpoint});
            if(facilityOwnerCompanyId(endpoint)!==companyId||JSON.stringify(endpoint.coords)!==JSON.stringify(row.endpoint.coords))throw new Error('تعارض في وجهة التسليم');
            route=prepareRoute({...row.route,ownerCompanyId:companyId,routeMode:'road',id:window.GH_DETERMINISM.nextId(draft,'ROAD-AUTO')},draft);
            dispatch('routes','create',{route});routes[route.id]=route;createdRoutes.set(row.route.id,route);
          }else if(row.plannedShared){route=createdRoutes.get(row.route.id);if(!route)throw new Error('فقد مسار مشترك أثناء التحقق من الدفعة');}
          else{route=routes[row.route.id];if(!route||JSON.stringify(route)!==JSON.stringify(runtime[row.route.id]))throw new Error('تغير أحد المسارات الموجودة أثناء الحساب');}
          if(!routeFitsAsset(asset,route))throw new Error(`${asset.name}: الطريق يتجاوز مدى الشاحنة`);
          const matched=routeMatchingFacilityFor(draft,routes,route.id,asset.baseFacility);
          assignments.push({id:asset.id,routeId:route.id,baseFacility:asset.baseFacility,phase:'turnaround',route:matched});
        }
        dispatch('fleet','assign-routes-batch',{assignments});
        for(const assignment of assignments){const asset=draft.assets.find(row=>row.id===assignment.id);window.GH_FLEET_CORE.normalizeAsset(asset,{route:assignment.route,catalogItem:catalogItem(asset.type,asset.catalogId)});}
        const departures=current.map(asset=>{const block=departureBlockReasonFor(asset,draft,routes);if(block)throw new Error(`${asset.name}: ${block.text}`);return {id:asset.id,route:routeMatchingFacilityFor(draft,routes,asset.routeId,asset.baseFacility),load:loadLabel(asset),delaySeconds:window.GH_FLEET_CORE.departureDelay(asset)};});
        dispatch('fleet','depart-batch',{departures});
        for(const asset of current){const route=routeMatchingFacilityFor(draft,routes,asset.routeId,asset.baseFacility);window.GH_FLEET_CORE.normalizeAsset(asset,{route,catalogItem:catalogItem(asset.type,asset.catalogId)});}
        for(const routeId of previousRouteIds){const retired=(draft.customRoutes||[]).find(route=>route.id===routeId);if(retired?.automaticRoad===true&&!draft.assets.some(asset=>asset.routeId===routeId)){window.GH_ROUTE_CORE.execute({state:draft},'delete',{id:routeId});delete routes[routeId];}}
        const routeCount=new Set(assignments.map(row=>row.routeId)).size;
        window.GH_OPERATIONS_CORE.execute({state:draft},'record-alert',{text:`جُدولت ${current.length} شاحنة ذريًا على ${routeCount} مسار أسطول لشركة ${companyFinanceName(companyId)}؛ أُنشئ ${createdRoutes.size} مسارًا تلقائيًا.`,type:'dispatch'});return {departed:current.length,type,companyId,routeCount,createdRoutes:createdRoutes.size};
      },{afterCommit:()=>{lastDepartureBlocked=[];renderMap();updateKpis();}});
    }catch(error){notice(String(error.message||error));return false;}
    finally{clearTimeout(timer);roadPlanning=null;if(activeDrawerPanel==='routes')renderRouteCenterInto();}
  }
  function clearWorldInfrastructureMarkers(){
    worldMarkers.forEach(marker=>{try{map.removeLayer(marker)}catch(error){nonCritical('map-layer-remove',error);}});worldMarkers.clear();
  }
  function worldInfrastructureLatitudeBands(rows,bandDeg,filter){
    const bands=Array.from({length:Math.ceil(180/bandDeg)},()=>[]);for(let index=0;index<rows.length;index++){const row=rows[index],lat=Number(filter==='airport'?row[6]:row[3]);if(!Number.isFinite(lat))continue;const band=Math.max(0,Math.min(bands.length-1,Math.floor((Math.max(-90,Math.min(89.999999,lat))+90)/bandDeg)));bands[band].push(index);}return Object.freeze({rows,bands:Object.freeze(bands.map(Object.freeze)),bandDeg,filter});
  }
  function worldInfrastructureMajorIndexes(rows,filter){const out=[];for(let index=0;index<rows.length;index++){const row=rows[index];if(filter==='airport'?Boolean(row[1]):Boolean(row[5]))out.push(index);}return Object.freeze(out);}
  function worldInfrastructureSpatialIndex(filter,needFine=false){
    if(!worldSpatialIndexCache)worldSpatialIndexCache={};
    let group=worldSpatialIndexCache[filter];if(!group){const rows=filter==='airport'?WORLD.airports:WORLD.ports;group={rows,majorIndices:null,fine:null};worldSpatialIndexCache[filter]=group;}
    if(needFine&&!group.fine)group.fine=worldInfrastructureLatitudeBands(group.rows,2,filter);
    if(!needFine&&!group.majorIndices)group.majorIndices=worldInfrastructureMajorIndexes(group.rows,filter);
    return group;
  }
  function worldInfrastructureRowIndexes(filter,bounds,zoom,limit=Infinity){
    const group=worldInfrastructureSpatialIndex(filter,zoom>=5);
    if(zoom<5){const indexes=[];for(const index of group.majorIndices){const row=group.rows[index],coords=filter==='airport'?[row[6],row[7]]:[row[3],row[4]];if(!bounds.contains(coords))continue;indexes.push(index);if(indexes.length>=limit)break;}return indexes;}
    const fine=group.fine,bandDeg=fine.bandDeg,south=Math.max(-90,Math.min(90,bounds.getSouth())),north=Math.max(-90,Math.min(90,bounds.getNorth())),start=Math.max(0,Math.min(fine.bands.length-1,Math.floor((south+90)/bandDeg))),end=Math.max(0,Math.min(fine.bands.length-1,Math.floor((Math.min(89.999999,north)+90)/bandDeg))),indexes=[];
    for(let band=start;band<=end;band++)for(const index of fine.bands[band]){const row=fine.rows[index],coords=filter==='airport'?[row[6],row[7]]:[row[3],row[4]];if(bounds.contains(coords))indexes.push(index);}
    indexes.sort((a,b)=>a-b);return Number.isFinite(limit)?indexes.slice(0,limit):indexes;
  }

  function worldInfrastructureIcon(filter){
    if(worldInfrastructureIconCache.has(filter))return worldInfrastructureIconCache.get(filter);
    const vector=FACILITY_SVG[filter].replace('<svg ','<svg width="12" height="12" aria-hidden="true" focusable="false" fill="currentColor" '),icon=L.divIcon({className:`world-infrastructure-marker ${filter}`,html:`<span aria-hidden="true" style="display:grid;place-items:center;width:22px;height:22px;border:1px solid rgba(255,255,255,.94);border-radius:50%;background:rgba(8,38,55,.9);color:#fff;box-shadow:0 2px 8px rgba(4,23,34,.24)">${vector}</span>`,iconSize:[22,22],iconAnchor:[11,11]});worldInfrastructureIconCache.set(filter,icon);return icon;
  }
  function renderWorldInfrastructureMarkers(){
    if(!map)return;
    const filter=state.activeFilter||'all',filterState=currentMapFilter();if(!mapCategoryVisible('infrastructure')||!['airport','port'].includes(filter)||filterState.optionalLayers[`infrastructure:${filter}`]!==true){clearWorldInfrastructureMarkers();return;}
    const bounds=map.getBounds(),zoom=map.getZoom(),limit=zoom<5?90:180,rows=filter==='airport'?WORLD.airports:WORLD.ports,indexes=worldInfrastructureRowIndexes(filter,bounds,zoom,limit),desired=new Map();
    for(const index of indexes){const row=rows[index],entity=filter==='airport'?airportEntity(row):portEntity(row);desired.set(entity.key,entity);}
    for(const [key,marker] of worldMarkers)if(!desired.has(key)){try{map.removeLayer(marker)}catch(error){nonCritical('map-layer-remove',error);}worldMarkers.delete(key);}
    const icon=worldInfrastructureIcon(filter);for(const [key,entity] of desired){if(worldMarkers.has(key))continue;const marker=L.marker(entity.coords,{icon,zIndexOffset:180}).addTo(map);marker.on('click',()=>showWorldEntity(key));worldMarkers.set(key,marker);}
    $('mapStatus').textContent=`${desired.size} ${filter==='airport'?'مطارًا':'ميناءً'} في نطاق العرض · كبّر الخريطة لمزيد من المنشآت · الفهرس الكامل ${fmtNumber(filter==='airport'?WORLD.meta.airportCount:WORLD.meta.portCount)}`;
  }

  function mapRenderBudget(zoom,kind='standard'){
    if(kind==='mobility')return zoom<4?10:zoom<6?18:zoom<9?26:36;
    if(kind==='routes')return zoom<4?12:zoom<6?20:zoom<9?32:48;
    if(kind==='facilities')return zoom<4?24:zoom<6?40:zoom<9?60:84;
    return zoom<4?24:zoom<6?36:zoom<9?54:72;
  }
  function fleetClusterHtml(type,count,label=''){
    const key=markerKind(type),symbol=key==='mobility'?'M':key==='air'?'AIR':key==='sea'?'SEA':'LOG';
    return `<div class="fleet-map-cluster ${key}" title="${esc(label)}"><span>${symbol}</span><b>${fmtNumber(count)}</b></div>`;
  }
  function addFleetCluster(key,coords,type,count,label,onClick){
    if(!Array.isArray(coords)||coords.length!==2||count<=0)return;
    const icon=L.divIcon({className:`fleet-cluster-marker ${type}`,html:fleetClusterHtml(type,count,label),iconSize:[34,34],iconAnchor:[17,17]});
    const marker=L.marker(markerDisplayStart(`own:${key}`,coords),{icon,zIndexOffset:610}).addTo(map).bindTooltip(`${esc(label)} · ${fmtNumber(count)} أصل`,{direction:'top',permanent:false,opacity:.9});
    marker.on('click',onClick);ownMarkers.set(key,marker);return marker;
  }
  function averageMapPoint(rows,positionOf){let lat=0,lng=0,count=0;for(const row of rows){const point=positionOf(row);if(!Array.isArray(point)||!Number.isFinite(point[0])||!Number.isFinite(point[1]))continue;lat+=point[0];lng+=point[1];count++;}return count?[lat/count,lng/count]:null;}
  function movingHeroSelection(rows,zoom,limit){
    const representatives=new Map();for(const asset of rows){const owner=assetOwnerCompanyId(asset),key=asset.routeId?`${owner}:${asset.routeId}`:`${owner}:${asset.id}`;if(asset.id===selectedAssetId||!representatives.has(key))representatives.set(key,asset);}
    return fairAssetSelection([...representatives.values()],limit,selectedAssetId);
  }
  const identityRouteColor=(companyId,mode='')=>companyDefinition(companyId)?.identity?.palette?.route||window.GH_IDENTITY?.brand?.(companyId)?.route||({air:'#2d72df',sea:'#119c94',road:'#df8a3d',mobility:'#1a9a6b'}[mode||companyId]||'#14a89a');
  function compactFleetMarker(asset,position,zoom,totalMoving){
    if(!fleetCanvasRenderer)fleetCanvasRenderer=L.canvas({padding:.3});
    const radius=totalMoving>700?(zoom<4?1.5:2):totalMoving>300?(zoom<4?1.8:2.4):(zoom<4?2.2:zoom<6?2.8:3.4);
    const marker=L.circleMarker(markerDisplayStart(`own:${asset.id}`,position),{renderer:fleetCanvasRenderer,radius,weight:0,fill:true,fillColor:identityRouteColor(assetOwnerCompanyId(asset),assetModeOf(asset)),fillOpacity:selectedAssetId===asset.id ? .98 : .8,interactive:true}).addTo(map);
    marker.bindTooltip(`${esc(asset.name)} · ${esc(typeName(asset.type))}`,{direction:'top',permanent:false,opacity:.88});marker.on('click',()=>showAsset(asset.id));return marker;
  }
  function facilityRenderGroups(rows,zoom){
    const selected=rows.find(row=>row.id===selectedFacilityId),rest=rows.filter(row=>row.id!==selectedFacilityId),limit=mapRenderBudget(zoom,'facilities');let cell=zoom<4?20:zoom<6?8:zoom<9?2:.28,groups;
    const build=()=>{const out=new Map();for(const facility of rest){const point=facility.coords;if(!Array.isArray(point))continue;const key=`${Math.floor((point[0]+90)/cell)}:${Math.floor((point[1]+180)/cell)}`,group=out.get(key)||{key,facilities:[]};group.facilities.push(facility);out.set(key,group);}return [...out.values()];};
    groups=build();while(groups.length>Math.max(3,limit-(selected?1:0))&&cell<180){cell*=1.65;groups=build();}for(const group of groups)group.coords=averageMapPoint(group.facilities,row=>row.coords);if(selected)groups.unshift({key:`selected:${selected.id}`,facilities:[selected],coords:selected.coords,selected:true});return groups;
  }
  function facilityClusterHtml(count){return `<div class="facility-map-cluster"><span>شبكة</span><b>${fmtNumber(count)}</b></div>`;}
  function fairAssetSelection(rows,limit,pinnedId=null){
    const pinned=pinnedId?rows.find(row=>row.id===pinnedId):null,groups=new Map();for(const row of rows){if(row.id===pinnedId)continue;const key=assetOwnerCompanyId(row)||`unknown:${assetModeOf(row)}`,queue=groups.get(key)||[];queue.push(row);groups.set(key,queue);}const queues=[...groups].sort((a,b)=>a[0].localeCompare(b[0])).map(([,queue])=>queue.sort((a,b)=>String(a.id).localeCompare(String(b.id)))),picked=pinned?[pinned]:[];
    let cursor=0;while(picked.length<limit&&queues.some(queue=>queue.length)){const queue=queues[cursor%queues.length];if(queue.length)picked.push(queue.shift());cursor++;}
    return picked;
  }

  function renderMap(){
    if(!map)return;
    const filter=state.activeFilter||'all',filterState=currentMapFilter(),zoom=map.getZoom(),visibleAssets=mapCategoryVisible('assets')?mapVisibleAssetRows(filterState):[];
    captureMarkerVisualPositions();markerMotionStates.clear();
    routeLayers.forEach(layer=>{try{map.removeLayer(layer)}catch(error){nonCritical('map-route-remove',error);}}); routeLayers=[];
    ownMarkers.forEach(marker=>{try{map.removeLayer(marker)}catch(error){nonCritical('map-layer-remove',error);}}); ownMarkers.clear();
    movingFleetClusters.clear();movingMobilityClusters.clear();
    facilityMarkers.forEach(marker=>{try{map.removeLayer(marker)}catch(error){nonCritical('map-layer-remove',error);}}); facilityMarkers.clear();
    competitorMarkers.forEach(marker=>{try{map.removeLayer(marker)}catch(error){nonCritical('map-layer-remove',error);}}); competitorMarkers.clear();

    renderedAssetIds=new Set();renderedMobilityIds=new Set();
    // Route geometry is presentation-on-demand only. Keep operational route data in
    // state, but never paint the whole network: on iPhone that turns route count
    // into continuous Leaflet/polyline work. Only the explicitly selected asset
    // may own a visible route layer.
    const selectedRouteAsset=mapCategoryVisible('routes')&&selectedAssetId
      ? visibleAssets.find(asset=>asset.id===selectedAssetId&&asset.routeId)
      : null;
    if(selectedRouteAsset){
      const route=currentAssetRoute(selectedRouteAsset),color=identityRouteColor(assetOwnerCompanyId(selectedRouteAsset),assetModeOf(selectedRouteAsset));
      const line=L.polyline(window.GH_ROUTE_CORE.splitAtDateline(route),{color,weight:3.4,opacity:.96,dashArray:selectedRouteAsset.type==='air'?'7 9':null,lineCap:'round',smoothFactor:1.8,interactive:false}).addTo(map);routeLayers.push(line);
    }
    const standardBudget=mapRenderBudget(zoom,'standard'),movingAssets=visibleAssets.filter(asset=>asset.phase==='moving'),presentationInput=movingAssets.length&&mapPresentationEngine&&!mapPresentationEngine.isDisabled()?mapMovingPlanInput(movingAssets,zoom,standardBudget):null,presentationRequest=presentationInput?mapPresentationEngine.requestPlan(presentationInput):{ready:false,worker:false},presentationPlan=presentationRequest.ready?presentationRequest.plan:null;
    mapPresentationPlanRequest=presentationInput?{key:presentationInput.key,assets:state.assets,revision:Number(state.saveRevision)||0}:null;
    mapPresentationPlanGeneration=presentationPlan?.generation||0;
    const movingHeroes=presentationPlan?[...presentationPlan.heroIndices].map(index=>movingAssets[index]).filter(Boolean):movingHeroSelection(movingAssets,zoom,standardBudget),movingHeroIds=new Set(movingHeroes.map(asset=>asset.id));
    const movingClusterBudget=Math.max(4,standardBudget-movingHeroes.length);
    const stationary=visibleAssets.filter(asset=>asset.phase!=='moving'),stationaryGroups=new Map();
    for(const asset of stationary){const ownerCompanyId=assetOwnerCompanyId(asset),key=`${ownerCompanyId}:${asset.baseFacility||'unbased'}`,row=stationaryGroups.get(key)||{type:assetModeOf(asset),ownerCompanyId,baseFacility:asset.baseFacility,assets:[]};row.assets.push(asset);stationaryGroups.set(key,row);}
    const individual=[...movingHeroes],workerPending=presentationRequest.worker===true&&presentationRequest.pending===true,nonHeroMoving=presentationPlan||workerPending?[]:movingAssets.filter(asset=>!movingHeroIds.has(asset.id)),movingGroups=presentationPlan?presentationPlan.groups.map(group=>({...group,assets:Array.from(presentationPlan.members.slice(group.start,group.start+group.count),index=>movingAssets[index]).filter(Boolean)})):workerPending?[]:movingAssetRenderGroups(nonHeroMoving,zoom,movingClusterBudget);
    for(const group of movingGroups){
      if(!group.assets.length)continue;const coords=group.coords||averageMapPoint(group.assets,assetPosition),key=`moving:${group.key}`,label=`${companyFinanceName(group.owner)} · أصول متحركة`;
      const marker=addFleetCluster(key,coords,group.mode,group.count||group.assets.length,label,()=>openDrawer('assets',group.mode));if(marker)movingFleetClusters.set(key,{marker,assetIds:group.assets.map(asset=>asset.id)});
    }
    let stationarySlots=Math.max(0,standardBudget-individual.length);
    const orderedStationaryGroups=[...stationaryGroups].sort((a,b)=>Number(b[1].assets.some(asset=>asset.id===selectedAssetId))-Number(a[1].assets.some(asset=>asset.id===selectedAssetId))||b[1].assets.length-a[1].assets.length);
    for(const [key,group] of orderedStationaryGroups){
      const selected=group.assets.find(asset=>asset.id===selectedAssetId);
      let clusteredAssets=group.assets;
      if(selected){individual.push(selected);stationarySlots=Math.max(0,stationarySlots-1);clusteredAssets=group.assets.filter(asset=>asset.id!==selected.id);}
      if(!selected&&group.assets.length<=3&&stationarySlots>=group.assets.length){for(const asset of group.assets)individual.push(asset);stationarySlots-=group.assets.length;continue;}
      if(!clusteredAssets.length)continue;
      const base=findFacility(group.baseFacility),coords=base?.coords||assetPosition(group.assets[0]),label=base?.name||'مركز تشغيل';
      addFleetCluster(`cluster:${key}`,coords,group.type,clusteredAssets.length,label,()=>openDrawer('assets',group.type));
    }
    const uniqueIndividuals=[...new Map(individual.map(asset=>[asset.id,asset])).values()];
    for(const asset of uniqueIndividuals){
      const position=assetPosition(asset);if(!position){nonCritical('asset-position-missing',new Error(`Missing position for ${asset.id}`));continue;}
      const moving=asset.phase==='moving',icon=L.divIcon({className:`asset-marker ${asset.type}${moving?' is-moving':''}`,html:vehicleMarkerHtml(asset),iconSize:[42,42],iconAnchor:[21,21]});
      const marker=L.marker(markerDisplayStart(`own:${asset.id}`,position),{icon,zIndexOffset:selectedAssetId===asset.id?760:700}).addTo(map);
      marker.on('click',()=>showAsset(asset.id));ownMarkers.set(asset.id,marker);renderedAssetIds.add(asset.id);
    }

    if(mapLayerVisible('assets','mobility','mobility-fleet')){
      const mobilityLimit=mapRenderBudget(zoom,'mobility'),mobilityVehicles=state.mobility?.vehicles||[],activeMobilityIds=new Set((state.mobility?.activeTrips||[]).map(trip=>trip.vehicleId)),availableByCenter=new Map();
      for(const vehicle of mobilityVehicles)if(!activeMobilityIds.has(vehicle.id)){const centerId=vehicle.centerId||'RUH',ids=availableByCenter.get(centerId)||[];ids.push(vehicle.id);availableByCenter.set(centerId,ids);}
      // Keep small fleets individually visible with a compact sedan sprite and an
      // iPhone-sized interaction target. Larger parked fleets stay
      // aggregated at their center so buying hundreds of cars cannot flood the map.
      const individualAvailableIds=[];
      for(const ids of availableByCenter.values())if(ids.length<=3)individualAvailableIds.push(...ids);
      if(selectedMobilityId&&!individualAvailableIds.includes(selectedMobilityId))individualAvailableIds.unshift(selectedMobilityId);
      const mobilityRows=window.GH_MOBILITY_CORE?.liveVehicles?.(state,mobilityLimit,{movingOnly:true,includeIds:individualAvailableIds})||[],renderedAvailableByCenter=new Map();
      for(const vehicle of mobilityRows){
        const pos=interpolatePresentationRoute(vehicle.route,vehicle.progress),moving=vehicle.phase==='moving',heading=routeBearing(vehicle.route,vehicle.progress);
        if(selectedMobilityId===vehicle.id&&moving&&mapCategoryVisible('routes')){const selectedLine=L.polyline(vehicle.route,{color:identityRouteColor('mobility','mobility'),weight:3.2,opacity:.92,lineCap:'round',smoothFactor:1.2,interactive:false}).addTo(map);routeLayers.push(selectedLine);}
        const icon=L.divIcon({className:`asset-marker mobility mobility-car-marker${moving?' is-moving':''}${selectedMobilityId===vehicle.id?' is-selected':''}`,html:vehicleVisualHtml('mobility',heading,null,moving),iconSize:[44,44],iconAnchor:[22,22]});
        const marker=L.marker(markerDisplayStart(`own:mobility:${vehicle.id}`,pos),{icon,zIndexOffset:selectedMobilityId===vehicle.id?750:680,title:`${vehicle.name} · ${moving?'متحركة':'متاحة'}`,keyboard:true,riseOnHover:true}).addTo(map);
        marker.bindTooltip(`${esc(vehicle.name)} · ${moving?(vehicle.routeVerified?'على شبكة الشوارع':'بانتظار تثبيت مسار الشارع'):'متاحة في المركز'}`,{direction:'top',permanent:false,opacity:.88});
        marker.on('click',()=>{selectedAssetId=null;selectedMobilityId=vehicle.id;renderMap();openDrawer('mobilityAsset',vehicle.id);});ownMarkers.set(`mobility:${vehicle.id}`,marker);renderedMobilityIds.add(vehicle.id);
        if(!moving){const centerId=vehicle.centerId||'RUH';renderedAvailableByCenter.set(centerId,(renderedAvailableByCenter.get(centerId)||0)+1);}
      }
      for(const cluster of (window.GH_MOBILITY_CORE?.movingClusters?.(state,[...renderedMobilityIds])||[])){const key=`mobility-moving-cluster:${cluster.centerId}`,label=`${cluster.city} · سيارات متحركة${cluster.waiting?` · ${cluster.waiting} بانتظار المسار`:''}`,marker=addFleetCluster(key,cluster.coords,'mobility',cluster.count,label,()=>openDrawer('assets','mobility'));if(marker)movingMobilityClusters.set(key,{marker,centerId:cluster.centerId});}
      // Every parked owned car remains represented by its centre cluster. There are
      // finitely many supported capitals, so truncating this list only hid ownership.
      for(const cluster of (window.GH_MOBILITY_CORE?.centerClusters?.(state)||[]).map(row=>({...row,available:Math.max(0,row.available-(renderedAvailableByCenter.get(row.centerId)||0))})).filter(row=>row.available>0).sort((a,b)=>b.available-a.available))addFleetCluster(`mobility-cluster:${cluster.centerId}`,cluster.coords,'mobility',cluster.available,`${cluster.city} · سيارات متاحة`,()=>openDrawer('assets','mobility'));
    }

    if(mapCategoryVisible('facilities')){
      const assetBaseIds=new Set(state.assets.map(a=>a.baseFacility).filter(Boolean));
      const visibleFacilities=getDynamicFacilities().filter(f=>{
        // المنشآت المرجعية تخدم الحسابات والدليل فقط؛ لا تظهر كملكية عند بداية لعبة جديدة.
        const belongsToPlayer=f.owned===true||assetBaseIds.has(f.id);
        if(!belongsToPlayer)return false;
        const owner=facilityOwnerCompanyId(f);if(owner&&!mapCompanyVisible(owner))return false;
        return filter==='airport'?['airport','airport-base'].includes(f.kind):filter==='port'?['port','port-base'].includes(f.kind):true;
      });
      for(const group of facilityRenderGroups(visibleFacilities,zoom)){
        if(group.facilities.length===1){const f=group.facilities[0],cls=`${f.owned?'owned':f.public?'public':''}${selectedFacilityId===f.id?' selected':''}`,icon=L.divIcon({className:`facility-marker ${cls}`,html:facilityMarkerHtml(f),iconSize:[44,44],iconAnchor:[22,22]}),marker=L.marker(f.coords,{icon,zIndexOffset:selectedFacilityId===f.id?650:400,keyboard:true,riseOnHover:true}).addTo(map);marker.on('click',()=>{selectedFacilityId=f.id;openFacility(f.id);});facilityMarkers.set(f.id,marker);continue;}
        const ids=group.facilities.map(row=>row.id),icon=L.divIcon({className:'facility-cluster-marker',html:facilityClusterHtml(group.facilities.length),iconSize:[44,44],iconAnchor:[22,22]}),marker=L.marker(group.coords,{icon,zIndexOffset:430,keyboard:true,riseOnHover:true}).addTo(map).bindTooltip(`${fmtNumber(group.facilities.length)} منشأة مملوكة ممثلة هنا`,{direction:'top',permanent:false,opacity:.9});marker.on('click',()=>{if(zoom<11)map.setView(group.coords,Math.min(11,zoom+2));else openDrawer('expansion',{focusIds:ids});});facilityMarkers.set(`facility-cluster:${group.key}`,marker);
      }
    }

    if(filterState.market.competitors&&mapCategoryVisible('assets')){
      const bounds=map.getBounds();
      const competitorLimit=zoom<4?8:zoom<6?16:32;
      let shownAssets=0;
      competitorAssets.forEach(a=>{
        if(filterState.companies.mode==='include'&&!filterState.companies.included.some(companyId=>COMPANY_PLATFORM.getRouteModes(companyId).includes(a.type)))return;
        const pos=interpolatePresentationRoute(a.route,a.progress);
        if(!bounds.contains(pos) || shownAssets>=competitorLimit)return;
        const icon=L.divIcon({className:'competitor-marker',html:competitorMarkerHtml(a),iconSize:[46,46],iconAnchor:[23,23]});
        const marker=L.marker(markerDisplayStart(`competitor:${a.id}`,pos),{icon,zIndexOffset:300}).addTo(map).bindPopup(`<b>${a.name}</b><br>${a.company}<br><span style="color:#9fb0b5">منافس — حركة سوقية</span>`);
        competitorMarkers.set(a.id,marker);shownAssets++;
      });
      let shownHq=0;
      competitors.forEach(c=>{
        if((state.stakes[c.id]||0)>=51)return;
        if(!mapCategoryVisible('facilities'))return;
        if(!bounds.contains(c.coords) || shownHq>=(zoom<4?4:8))return;
        const icon=L.divIcon({className:'facility-marker competitor',html:`<div class="marker-core facility-real hq">${FACILITY_SVG.hq}</div>`,iconSize:[44,44],iconAnchor:[22,22]});
        const marker=L.marker(c.coords,{icon,zIndexOffset:250}).addTo(map).bindPopup(`<b>${c.name}</b><br>${c.sector}<br>الحصة السوقية: ${c.marketShare}`);
        competitorMarkers.set(`HQ-${c.id}`,marker);shownHq++;
      });
    }
    updateMapStatus();renderWorldInfrastructureMarkers();lastMapStructureSignature=mapStructureSignature();updateMarkerPositions(true);
  }

  let mapStatusCache={at:0,revision:-1,assetLength:-1,moving:0,idle:0,turn:0,routed:0,ownedFacilities:0};
  function updateMapStatus(){
    if(mapCategoryVisible('infrastructure')&&['airport','port'].includes(state.activeFilter))return;
    const now=performance.now(),revision=Math.max(0,Math.floor(Number(state.saveRevision)||0)),assetLength=state.assets?.length||0,mobility=window.GH_MOBILITY_CORE?.snapshot?.(state)||{moving:0,vehicles:0};
    if(now-mapStatusCache.at>=1500||mapStatusCache.revision!==revision||mapStatusCache.assetLength!==assetLength){
      let moving=0,idle=0,turn=0;for(const asset of state.assets||[]){if(asset.phase==='moving')moving++;else if(asset.phase==='idle')idle++;else if(asset.phase==='turnaround')turn++;}
      mapStatusCache={at:now,revision,assetLength,moving,idle,turn,routed:operationalRoutes('road').filter(r=>r.routingSource).length,ownedFacilities:getDynamicFacilities().filter(f=>f?.owned).length};
    }
    const offline=mapTilesOffline?'تضاريس محلية · ':'';$('mapStatus').textContent=`${offline}${mapStatusCache.moving+mobility.moving} في الحركة · ${mapStatusCache.turn} في المحطات · ${assetLength} أصل${mobility.vehicles?' · '+mobility.vehicles+' سيارة':''}`;$('mapStatus').title=`${mapStatusCache.idle} متوقف · ${mapStatusCache.ownedFacilities} منشأة · ${mapStatusCache.routed} مسار بري`;
  }

  function markerPoint(value){if(Array.isArray(value)&&value.length===2&&value.every(Number.isFinite))return [Number(value[0]),Number(value[1])];if(value&&Number.isFinite(Number(value.lat))&&Number.isFinite(Number(value.lng)))return [Number(value.lat),Number(value.lng)];return null;}
  function shortestLongitudeDelta(from,to){return ((Number(to)-Number(from)+540)%360)-180;}
  function interpolateMarkerPoint(from,to,t){const lat=from[0]+(to[0]-from[0])*t,lng=from[1]+shortestLongitudeDelta(from[1],to[1])*t;return [lat,((lng+540)%360)-180];}
  function markerMotionProfile(rate){if(rate>=600)return {maxPixelsPerSecond:8};if(rate>=300)return {maxPixelsPerSecond:9};if(rate>=120)return {maxPixelsPerSecond:10};if(rate>=60)return {maxPixelsPerSecond:11};if(rate>0)return {maxPixelsPerSecond:12};return {maxPixelsPerSecond:0};}
  function boundedStepRatio(distancePixels,maxPixels){const distance=Math.max(0,Number(distancePixels)||0),limit=Math.max(0,Number(maxPixels)||0);return distance<=limit||distance===0?1:limit/distance;}
  function markerScreenDistance(from,to){try{if(!map)return 0;const adjusted=[to[0],from[1]+shortestLongitudeDelta(from[1],to[1])],zoom=Number(map.getZoom?.());if(map.project&&Number.isFinite(zoom)){const a=map.project(from,zoom),b=map.project(adjusted,zoom);if(Number.isFinite(a?.x)&&Number.isFinite(a?.y)&&Number.isFinite(b?.x)&&Number.isFinite(b?.y))return Math.hypot(b.x-a.x,b.y-a.y);}if(!map.latLngToContainerPoint)return 0;const a=map.latLngToContainerPoint(from),b=map.latLngToContainerPoint(adjusted);return Number.isFinite(a?.x)&&Number.isFinite(a?.y)&&Number.isFinite(b?.x)&&Number.isFinite(b?.y)?Math.hypot(b.x-a.x,b.y-a.y):0;}catch(error){nonCritical('map-marker-screen-distance',error);return 0;}}
  function closestRouteProgress(route,point){if(!Array.isArray(route)||route.length<2||!markerPoint(point))return null;let best=0,bestDistance=Infinity;for(let i=0;i<=64;i++){const progress=i/64,distance=haversine(interpolatePresentationRoute(route,progress),point);if(distance<bestDistance){bestDistance=distance;best=progress;}}return best;}
  function samePresentationPoint(a,b){const from=markerPoint(a),to=markerPoint(b);return Boolean(from&&to&&haversine(from,to)<=.5);}
  function routeBridgeSegment(route,routeKey,visualProgress,targetProgress=1){return {route,routeKey,visualProgress:clamp(Number(visualProgress)||0,0,1),targetProgress:clamp(Number(targetProgress)||0,0,1)};}
  function queuePresentationBridge(row,route,routeKey,previousRoute,previousRouteKey,previousProgress){
    if(!route||!previousRoute||!Number.isFinite(previousProgress))return false;
    const segments=Array.isArray(row.routeBridge)?row.routeBridge:[];
    if(segments.length>4)return false;
    if(!segments.length){const start=clamp(previousProgress,0,1);if(start<.999999)segments.push(routeBridgeSegment(previousRoute,previousRouteKey,start,1));}
    const tail=segments[segments.length-1],tailPoint=tail?interpolatePresentationRoute(tail.route,tail.targetProgress):interpolatePresentationRoute(previousRoute,1),routeStart=interpolatePresentationRoute(route,0);
    if(!samePresentationPoint(tailPoint,routeStart)){
      const returnRoute=reversePresentationRoute(route);
      if(segments.length>=4||!samePresentationPoint(tailPoint,interpolatePresentationRoute(returnRoute,0))||!samePresentationPoint(interpolatePresentationRoute(returnRoute,1),routeStart))return false;
      segments.push(routeBridgeSegment(returnRoute,`${routeKey}:return`,0,1));
    }
    row.routeBridge=segments;row.visualProgress=0;return true;
  }
  function captureMarkerVisualPositions(){
    const carry=new Map(),capture=(prefix,markers)=>markers.forEach((marker,key)=>{
      const point=markerPoint(marker?.getLatLng?.());if(!point)return;
      const row=markerMotionStates.get(`${prefix}${key}`),bridge=row?.routeBridge?.[0],route=bridge?.route||row?.route||null,visualProgress=Number.isFinite(bridge?.visualProgress)?bridge.visualProgress:(Number.isFinite(row?.visualProgress)?row.visualProgress:null);
      carry.set(`${prefix}${key}`,{point,route,routeKey:bridge?.routeKey||row?.routeKey||null,visualProgress});
    });capture('own:',ownMarkers);capture('competitor:',competitorMarkers);markerVisualCarry=carry;
  }
  function markerDisplayStart(key,target){const clean=markerPoint(target);if(!clean)return target;const carry=markerVisualCarry.get(key),point=markerPoint(carry?.point||carry);if(!point)return clean;const latGap=Math.abs(clean[0]-point[0]),lngGap=Math.abs(shortestLongitudeDelta(point[1],clean[1]));return latGap<=45&&lngGap<=120?point:clean;}
  function fadeResyncMarker(row,now){const target=markerPoint(row.target);if(!target)return;try{row.marker.setOpacity?.(0);row.marker.setLatLng(target);row.current=target;row.routeBridge=[];row.visualProgress=Number.isFinite(row.targetProgress)?row.targetProgress:null;row.lastAt=now;row.needsResync=false;const reveal=()=>{try{row.marker.setOpacity?.(1);}catch(_error){}};if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(reveal));else reveal();}catch(error){nonCritical('map-marker-resync',error);}}
  function requestVisualResync(){visualResyncRequested=true;for(const row of markerMotionStates.values())row.needsResync=true;}
  function setMapMarkerTarget(key,marker,target,now,force=false,motion={}){
    const clean=markerPoint(target);if(!marker||!clean)return;
    let row=markerMotionStates.get(key),current=markerPoint(marker.getLatLng?.())||clean;
    if(!row){const carry=markerVisualCarry.get(key),carriedRoute=Array.isArray(carry?.route)?carry.route:null;row={key,marker,current,target:clean,lastAt:now,route:carriedRoute,routeKey:carriedRoute?carry.routeKey||null:null,visualProgress:Number.isFinite(carry?.visualProgress)?carry.visualProgress:null,targetProgress:null,routeBridge:[],needsResync:false};markerMotionStates.set(key,row);}
    row.marker=marker;row.target=clean;if(motion.type)row.markerType=markerKind(motion.type);if(motion.moving!==undefined)row.markerMoving=!!motion.moving;
    const route=Array.isArray(motion.route)&&motion.route.length>=2?motion.route:null,routeKey=route?String(motion.routeKey||key):null,targetProgress=Number.isFinite(Number(motion.progress))?clamp(Number(motion.progress),0,1):null;
    const previousRoute=row.route,previousRouteKey=row.routeKey;let previousProgress=row.visualProgress;if(previousRoute&&!Number.isFinite(previousProgress))previousProgress=closestRouteProgress(previousRoute,row.current);
    // Route keys are the stable presentation identity. Some providers rebuild
    // an equivalent point array when their live view is refreshed; treating
    // that as a new route would create a needless bridge on every frame.
    const routeChanged=Boolean(previousRoute&&route&&(previousRouteKey&&routeKey?previousRouteKey!==routeKey:previousRoute!==route));
    let bridged=false;
    if(route){
      row.route=route;row.routeKey=routeKey;row.targetProgress=targetProgress;
      if(routeChanged)bridged=queuePresentationBridge(row,route,routeKey,previousRoute,previousRouteKey,previousProgress);
      else if(Number.isFinite(previousProgress)&&Number.isFinite(targetProgress)&&targetProgress+.002<previousProgress&&!(row.routeBridge?.length))bridged=queuePresentationBridge(row,route,routeKey,route,routeKey,previousProgress);
      if(!bridged&&(!Number.isFinite(row.visualProgress)||routeChanged))row.visualProgress=closestRouteProgress(route,row.current);
      if(!bridged&&Number.isFinite(row.visualProgress)&&Number.isFinite(targetProgress)&&targetProgress+.002<row.visualProgress)row.needsResync=true;
      if(bridged)row.needsResync=false;
    }else{row.route=null;row.routeKey=null;row.targetProgress=null;row.visualProgress=null;row.routeBridge=[];}
    const latGap=Math.abs(clean[0]-row.current[0]),lngGap=Math.abs(shortestLongitudeDelta(row.current[1],clean[1]));if((latGap>45||lngGap>120)&&!route)row.needsResync=true;
    if(force&&visualResyncRequested)row.needsResync=true;
  }
  function advanceRouteSegment(route,visualProgress,targetProgress,current,maxPixels){
    if(!route||!Number.isFinite(visualProgress)||!Number.isFinite(targetProgress)||targetProgress+.000001<visualProgress)return null;
    const targetPoint=interpolatePresentationRoute(route,targetProgress),remaining=markerScreenDistance(current,targetPoint);if(remaining<=maxPixels)return {point:targetPoint,progress:targetProgress};
    let low=visualProgress,high=targetProgress,best=low;for(let i=0;i<12;i++){const mid=(low+high)/2,point=interpolatePresentationRoute(route,mid),distance=markerScreenDistance(current,point);if(distance<=maxPixels){best=mid;low=mid;}else high=mid;}
    return {point:interpolatePresentationRoute(route,best),progress:best};
  }
  function advanceRouteMotion(row,maxPixels){
    const bridge=row.routeBridge?.[0];
    if(bridge){const step=advanceRouteSegment(bridge.route,bridge.visualProgress,bridge.targetProgress,row.current,maxPixels);if(!step){row.needsResync=true;return null;}bridge.visualProgress=step.progress;if(step.progress>=bridge.targetProgress-.000001){row.routeBridge.shift();if(!row.routeBridge.length)row.visualProgress=0;}return {...step,bridge:true};}
    if(!row.route||!Number.isFinite(row.visualProgress)||!Number.isFinite(row.targetProgress))return null;
    if(row.targetProgress+0.002<row.visualProgress){if(queuePresentationBridge(row,row.route,row.routeKey,row.route,row.routeKey,row.visualProgress))return advanceRouteMotion(row,maxPixels);row.needsResync=true;return null;}
    return advanceRouteSegment(row.route,row.visualProgress,row.targetProgress,row.current,maxPixels);
  }
  function animateMapMarkerPositions(now){
    if(!markerMotionStates.size||mapInteractionActive||document.hidden)return;
    const profile=markerMotionProfile(effectiveSimulationRate(state.speed));
    for(const [key,row] of markerMotionStates){try{
      if(!row.marker?._map){markerMotionStates.delete(key);continue;}
      const elapsed=Math.max(0,Number(now)-Number(row.lastAt||now));row.lastAt=now;if(row.needsResync){fadeResyncMarker(row,now);continue;}
      // Respect intentional presentation sampling without treating each sample
      // as a 50ms frame. Stalls still have bounded, non-authoritative catch-up.
      const maxFrameMs=Math.min(300,Math.max(50,presentationFrameInterval())),maxPixels=profile.maxPixelsPerSecond*Math.min(maxFrameMs,elapsed)/1000;if(maxPixels<=0)continue;
      const routeStep=advanceRouteMotion(row,maxPixels);if(row.needsResync){fadeResyncMarker(row,now);continue;}
      let next=routeStep?.point;
      if(routeStep){if(!routeStep.bridge)row.visualProgress=routeStep.progress;}
      else{const distance=markerScreenDistance(row.current,row.target),ratio=boundedStepRatio(distance,maxPixels);next=interpolateMarkerPoint(row.current,row.target,ratio);}
      if(next){const moved=next[0]!==row.current[0]||next[1]!==row.current[1];if(routeStep&&moved&&((routeStep.bridge&&row.markerType)||key.startsWith('own:mobility:')))refreshVehicleMarker(row.marker,row.markerType||'mobility',bearingBetween(row.current,next),row.markerMoving!==false);if(moved)row.marker.setLatLng(next);row.current=next;}
    }catch(error){markerMotionStates.delete(key);nonCritical('map-marker-motion',error);}}
    visualResyncRequested=false;
  }
  window.GH_VISUAL_MOTION=Object.freeze({MIN_FRAME_MS:50,MAX_FRAME_MS:300,profile:markerMotionProfile,boundedStepRatio,interpolateRoute:interpolatePresentationRoute});
  function mapStructureSignature(){if(!map)return'';const zoom=Math.floor(Number(map.getZoom?.())||0),assetRows=(state.assets||[]).map(a=>`${a.id}:${assetOwnerCompanyId(a)}:${assetModeOf(a)}:${a.phase==='moving'?'M':'S'}:${a.baseFacility||''}:${a.routeId||''}`).join('|'),mobilityRows=(state.mobility?.vehicles||[]).map(v=>`${v.id}:${v.status==='moving'?'M':'S'}:${v.centerId||''}`).join('|'),facilityRows=getDynamicFacilities().filter(f=>f?.owned).map(f=>`${f.id}:${f.kind}:${facilityOwnerCompanyId(f)}:${f.commissioned===false?0:1}`).join('|');return `${JSON.stringify(currentMapFilter())};${zoom};${selectedAssetId||''};${selectedMobilityId||''};${selectedFacilityId||''};${assetRows};${mobilityRows};${facilityRows}`;}

  function presentationAssetLookup(){
    const revision=Math.max(0,Math.floor(Number(state.saveRevision)||0)),length=state.assets?.length||0;
    if(presentationAssetIndexRevision!==revision||presentationAssetIndexLength!==length||presentationAssetIndexSource!==state.assets){
      presentationAssetIndex=new Map((state.assets||[]).map(asset=>[asset.id,asset]));presentationAssetIndexRevision=revision;presentationAssetIndexLength=length;presentationAssetIndexSource=state.assets;
    }
    return presentationAssetIndex;
  }
  function movingAssetRenderGroups(rows,zoom,limit){
    let cell=zoom<4?28:zoom<6?12:zoom<9?4:1.2,groups=[];
    // Grid coarsening changes bucket sizes, not committed asset positions.
    const positioned=[];for(const asset of rows){const point=assetPosition(asset);if(Array.isArray(point))positioned.push({asset,point,owner:assetOwnerCompanyId(asset)||'unknown',mode:assetModeOf(asset)||'asset'});}
    const build=()=>{const out=new Map();for(const {asset,point,owner,mode} of positioned){const key=`${owner}:${mode}:${Math.floor((point[0]+90)/cell)}:${Math.floor((point[1]+180)/cell)}`,group=out.get(key)||{key,owner,mode,assets:[]};group.assets.push(asset);out.set(key,group);}return [...out.values()];};
    groups=build();while(groups.length>Math.max(4,limit)&&cell<180){cell*=1.7;groups=build();}
    return groups;
  }
  function updateMarkerPositions(force=false){
    if(!map)return;
    const now=(window.performance?.now?.()||Date.now());
    if(!force){
      if(mapInteractionActive)return;
      const fleetSize=(state.assets?.length||0)+(state.mobility?.vehicles?.length||0),rate=effectiveSimulationRate(state.speed),markerInterval=fleetSize>400?180:fleetSize>180?125:rate>=300?70:95;
      if(now-lastMarkerFrameAt<markerInterval)return;
    }
    const previousMarkerFrameAt=lastMarkerFrameAt;lastMarkerFrameAt=now;
    const assetIndex=presentationAssetLookup();
    // Visual targets are derived from committed simulation state, but interpolation
    // is presentation-only and never writes progress, simSeconds, finance or saves.
    for(const id of renderedAssetIds){const a=assetIndex.get(id),m=ownMarkers.get(id);if(a&&m){const onRoute=a.phase==='moving'||a.phase==='turnaround',route=onRoute?currentAssetRoute(a):null,progress=route?(a.phase==='turnaround'?1:a.progress):null,motionKey=`own:${id}`;setMapMarkerTarget(motionKey,m,assetPosition(a),now,force,{route,routeKey:route?`${a.routeId}:${a.reverse?1:0}`:null,progress,type:a.type,moving:a.phase==='moving'});const bridge=markerMotionStates.get(motionKey)?.routeBridge?.[0];refreshVehicleMarker(m,a.type,bridge?routeBearing(bridge.route,bridge.visualProgress):assetBearing(a),a.phase==='moving'||!!bridge);}}
    let movingCentersQueued=false;
    if(mapPresentationEngine&&!mapPresentationEngine.isDisabled()&&mapPresentationPlanGeneration){
      const ids=mapPresentationEngine.getAssetIds();if(ids.length){const progress=new Float32Array(ids.length);for(let index=0;index<ids.length;index++){const asset=assetIndex.get(ids[index]);progress[index]=asset?.phase==='turnaround'?1:Math.max(0,Math.min(1,Number(asset?.progress)||0));}movingCentersQueued=mapPresentationEngine.requestPositions(progress);}
    }
    if(!movingCentersQueued)for(const [key,cluster] of movingFleetClusters){const assets=cluster.assetIds.map(id=>assetIndex.get(id)).filter(Boolean),point=averageMapPoint(assets,assetPosition);if(point)setMapMarkerTarget(`own:${key}`,cluster.marker,point,now,force);}
    const liveIds=[...renderedMobilityIds];for(const vehicle of (window.GH_MOBILITY_CORE?.liveVehicles?.(state,Math.max(1,liveIds.length),{onlyIds:liveIds})||[])){const m=ownMarkers.get(`mobility:${vehicle.id}`);if(m){const motionKey=`own:mobility:${vehicle.id}`,route=vehicle.phase==='moving'?vehicle.route:null;setMapMarkerTarget(motionKey,m,interpolatePresentationRoute(vehicle.route,vehicle.progress),now,force,{route,routeKey:route?`${vehicle.id}:${vehicle.routeKey||vehicle.route?.length||0}`:null,progress:route?vehicle.progress:null,type:'mobility',moving:vehicle.phase==='moving'});const row=markerMotionStates.get(motionKey),bridge=row?.routeBridge?.[0],visualProgress=bridge?.visualProgress??row?.visualProgress??vehicle.progress;refreshVehicleMarker(m,'mobility',routeBearing(bridge?.route||vehicle.route,visualProgress),vehicle.phase==='moving'||!!bridge);}}
    const mobilityClusterIndex=new Map((window.GH_MOBILITY_CORE?.movingClusters?.(state,liveIds)||[]).map(cluster=>[cluster.centerId,cluster]));for(const [key,cluster] of movingMobilityClusters){const live=mobilityClusterIndex.get(cluster.centerId);if(live?.coords)setMapMarkerTarget(`own:${key}`,cluster.marker,live.coords,now,force);}
    competitorAssets.forEach(a=>{const m=competitorMarkers.get(a.id);if(m){setMapMarkerTarget(`competitor:${a.id}`,m,interpolatePresentationRoute(a.route,a.progress),now,force,{route:a.route,routeKey:`${a.id}:${a.route?.length||0}`,progress:a.progress,type:a.type,moving:true});refreshVehicleMarker(m,a.type,routeBearing(a.route,a.progress),true);}});
    if(previousMarkerFrameAt===0&&force)animateMapMarkerPositions(now);
  }

  function simDate(){ return new Date(SIM_START + state.simSeconds*1000); }
  function formatSimDate(){
    const d=simDate();
    const date=new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(d);
    const hh=String(d.getUTCHours()).padStart(2,'0'), mm=String(d.getUTCMinutes()).padStart(2,'0');
    return `${date} · ${hh}:${mm}`;
  }
  function formatSimDateCompact(){
    return new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(simDate());
  }
  const calendarDayStartSeconds=date=>Math.max(0,Math.floor((Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())-SIM_START)/1000));
  const calendarKey=date=>`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
  const calendarDateFromKey=key=>{const m=String(key||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))):null;};
  let calendarViewMonth=null,calendarSelectedKey='';
  function calendarMaxTargetDate(){const now=simDate(),target=new Date(Date.UTC(now.getUTCFullYear()+1,now.getUTCMonth(),now.getUTCDate()));return target;}
  function calendarAdvanceTargetDays(days){const now=Math.max(0,Number(state.simSeconds)||0),currentDay=Math.floor(now/86400);return Math.max(now+1,(currentDay+Math.max(1,Math.floor(Number(days)||1)))*86400);}
  function calendarAdvanceTargetYear(){const d=simDate(),y=d.getUTCFullYear()+1,m=d.getUTCMonth(),day=d.getUTCDate(),last=new Date(Date.UTC(y,m+1,0)).getUTCDate();return calendarDayStartSeconds(new Date(Date.UTC(y,m,Math.min(day,last))));}
  function requestCalendarAdvance(target,reason,label){
    const active=simulationEngine.snapshot().manualAdvance;if(active){notice('هناك تقديم زمني جارٍ الآن. أوقفه أولًا ثم اختر مدة جديدة.');return false;}
    const now=Math.max(0,Number(state.simSeconds)||0),next=Math.floor(Number(target)||0);if(!Number.isFinite(next)||next<=now){notice('اختر تاريخًا لاحقًا عن التاريخ الحالي.');return false;}
    const max=366*86400;if(next-now>max+1){notice('للحفاظ على سلامة المحاكاة يمكن التقديم حتى سنة واحدة في كل عملية.');return false;}
    // Calendar advance is a bounded cooperative workload independent from the player's live-speed selection.
    // The simulation core keeps the current atomic slice alive under device pressure instead of restarting it.
    // the simulation core still commits every hour/day boundary atomically.
    const request=simulationEngine.advanceTo(next,{speed:SIMULATION_RATE_BY_LEVEL[4],batchSeconds:3600,reason,maxSeconds:366*86400});
    if(!request.accepted){notice('تعذر تقديم التاريخ الآن؛ لم يُكتب أي وقت مباشرة.');return false;}
    pushAlert(`بدأ تقديم التقويم ${label||''} عبر محرك المحاكاة الآمن.`);updateDayStepControl();renderSimulationCalendar();return true;
  }
  function renderSimulationCalendar(){
    const grid=$('simCalendarGrid'),panel=$('simCalendarPanel');if(!grid||!panel)return;
    const current=simDate(),currentStart=new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth(),current.getUTCDate())),max=calendarMaxTargetDate();
    if(!calendarViewMonth)calendarViewMonth=new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth(),1));
    const minMonth=Date.UTC(current.getUTCFullYear(),current.getUTCMonth(),1),maxMonth=Date.UTC(max.getUTCFullYear(),max.getUTCMonth(),1),viewMs=calendarViewMonth.getTime();
    if(viewMs<minMonth)calendarViewMonth=new Date(minMonth);if(viewMs>maxMonth)calendarViewMonth=new Date(maxMonth);
    const y=calendarViewMonth.getUTCFullYear(),m=calendarViewMonth.getUTCMonth();
    if($('simCalendarMonthLabel'))$('simCalendarMonthLabel').textContent=new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{month:'long',year:'numeric',timeZone:'UTC'}).format(calendarViewMonth);
    if($('simCalendarCurrent'))$('simCalendarCurrent').textContent=formatSimDate();
    const firstDow=new Date(Date.UTC(y,m,1)).getUTCDay(),offset=(firstDow+1)%7,days=new Date(Date.UTC(y,m+1,0)).getUTCDate(),cells=[];
    for(let i=0;i<offset;i++)cells.push('<span class="sim-cal-blank" aria-hidden="true"></span>');
    for(let day=1;day<=days;day++){
      const d=new Date(Date.UTC(y,m,day)),key=calendarKey(d),past=d<currentStart,beyond=d>max,today=key===calendarKey(currentStart),selected=key===calendarSelectedKey;
      const disabled=past||beyond;cells.push(`<button type="button" class="sim-cal-day${today?' is-today':''}${selected?' is-selected':''}" data-calendar-date="${key}" ${disabled?'disabled data-disabled-reason="هذا اليوم خارج فترة التقديم المتاحة"':''}>${day}</button>`);
    }
    grid.innerHTML=cells.join('');
    const prev=$('simCalendarPrev'),next=$('simCalendarNext');
    for(const [btn,disabled,reason] of [[prev,calendarViewMonth.getTime()<=minMonth,'هذا أول شهر متاح'],[next,calendarViewMonth.getTime()>=maxMonth,'هذا آخر شهر متاح ضمن السنة القادمة']])if(btn){btn.disabled=disabled;if(disabled)btn.dataset.disabledReason=reason;else delete btn.dataset.disabledReason;}
    updateCalendarAdvanceControl();
    grid.querySelectorAll('[data-calendar-date]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();calendarSelectedKey=btn.dataset.calendarDate||'';renderSimulationCalendar();}));
  }
  function toggleSimulationCalendar(force){const panel=$('simCalendarPanel'),toggle=$('simCalendarToggle');if(!panel||!toggle)return;const open=typeof force==='boolean'?force:panel.classList.contains('hidden');panel.classList.toggle('hidden',!open);toggle.setAttribute('aria-expanded',open?'true':'false');if(open){const d=simDate();calendarViewMonth=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1));calendarSelectedKey='';renderSimulationCalendar();}}
  function formatDuration(seconds){
    if(seconds<=0)return 'الآن';
    if(seconds<3600)return `${Math.ceil(seconds/60)} دقيقة`;
    if(seconds<86400)return `${(seconds/3600).toFixed(seconds<10800?1:0)} ساعة`;
    return `${(seconds/86400).toFixed(seconds<259200?1:0)} يوم`;
  }
  function updateCalendarAdvanceControl(){
    const go=$('simCalendarGo');if(!go)return;
    const selected=calendarDateFromKey(calendarSelectedKey),active=!!window.GH_SIM_KERNEL?.snapshot?.().manualAdvance;
    const reason=active?'يوجد تقديم زمني جارٍ':!selected?'اختر تاريخًا قادمًا أولًا':calendarDayStartSeconds(selected)<=Number(state.simSeconds)?'اختر يومًا بعد التاريخ الحالي':selected>calendarMaxTargetDate()?'اختر تاريخًا ضمن السنة القادمة':'';
    go.disabled=!!reason;if(reason)go.dataset.disabledReason=reason;else delete go.dataset.disabledReason;
  }
  function updateDayStepControl(){
    const button=$('simNextDay'),advance=window.GH_SIM_KERNEL?.snapshot?.().manualAdvance;
    if(button){
      if(advance){button.textContent='إيقاف التقديم';button.title=`إيقاف التقديم الجاري؛ المتبقي ${formatDuration(advance.remaining)}`;button.setAttribute('aria-label',button.title);button.dataset.advancing='true';}
      else{button.textContent='+ يوم';button.title='تقديم آمن إلى بداية اليوم التالي عبر محرك المحاكاة';button.setAttribute('aria-label',button.title);delete button.dataset.advancing;}
    }
    const status=$('simAdvanceStatus');if(status)status.textContent=advance?`جارٍ التقديم · ${formatDuration(advance.remaining)} متبقي`:'جاهز للتقديم';
    document.querySelectorAll('[data-calendar-advance]').forEach(btn=>{btn.disabled=!!advance;if(advance)btn.dataset.disabledReason='يوجد تقديم زمني جارٍ';else delete btn.dataset.disabledReason;});
    updateCalendarAdvanceControl();
  }

  function updateKpis(){
    if(window.GH_IDENTITY)window.GH_IDENTITY.applyDocument(state);else{$('groupName').textContent=state.profile.name;$('brandMark').textContent=(state.profile.shortName||'GH').slice(0,4).toUpperCase();}
    $('cashKpi').textContent=state.godMoney&&state.infiniteMoney?'∞':fmtMoney(state.cash);
    $('debtKpi').textContent=fmtMoney(state.debt);
    $('valueKpi').textContent=fmtMoney(state.groupValue);
    $('profitKpi').textContent=`${state.todayProfit>=0?'+':''}${fmtMoney(state.todayProfit)}`;
    $('profitKpi').classList.toggle('positive',state.todayProfit>=0);
    $('profitKpi').classList.toggle('negative',state.todayProfit<0);
    $('alertCount').textContent=Math.min(99,state.alerts.length);
    if($('executionLogCount'))$('executionLogCount').textContent='✓';
    $('simDate').textContent=formatSimDateCompact();
    if($('simDay'))$('simDay').textContent=`اليوم ${Math.floor(Math.max(0,Number(state.simSeconds)||0)/86400)+1}`;
    updateDayStepControl();
    $('godMoneyToggle').checked=!!state.godMoney;
    $('infiniteToggle').checked=!!state.infiniteMoney;
  }

  const pendingSaleFinalizations=new Set();
  let saleFinalizeTimer=null;
  function queueAssetSaleFinalize(assetId){
    if(!assetId)return;
    pendingSaleFinalizations.add(assetId);
    if(saleFinalizeTimer!==null)return;
    const flush=()=>{
      saleFinalizeTimer=null;
      const batch=[...pendingSaleFinalizations].slice(0,16);
      for(const id of batch){pendingSaleFinalizations.delete(id);try{finalizeAssetSale(id,true);}catch(error){console.warn('تعذر إكمال بيع أصل مؤجل',id,error);}}
      if(pendingSaleFinalizations.size)saleFinalizeTimer=setTimeout(flush,0);
    };
    saleFinalizeTimer=setTimeout(flush,0);
  }

  function makeSimulationEffects(){
    return {todayProfit:0,groupValue:0,sectorProfit:{},tripProfit:{},tripRevenue:{},tripFuel:{},tripMaintenance:{},tripCount:{},cash:{},alerts:[],saleIds:[],retiredRouteIds:[]};
  }
  function mergeSimulationEffects(target,source){
    target.todayProfit+=Number(source.todayProfit)||0;target.groupValue+=Number(source.groupValue)||0;
    for(const key of ['sectorProfit','tripProfit','tripRevenue','tripFuel','tripMaintenance','tripCount','cash']){
      for(const companyId of Object.keys(source[key]||{}))target[key][companyId]=(target[key][companyId]||0)+(Number(source[key][companyId])||0);
    }
    target.alerts.push(...source.alerts);target.saleIds.push(...source.saleIds);target.retiredRouteIds.push(...source.retiredRouteIds);
  }
  const SIMULATION_ASSET_FIELDS=['phase','dwellRemaining','reverse','progress','fuel','condition','from','to','load','baseFacility','lastTrip','routeId','routeSignature','routeSlot','departureScheduled','departureScheduledAt','releaseExclusiveRouteOnArrival','simCarrySeconds','lastTransitionGuardDay','crewBlocked','simulationFault'];
  const SIMULATION_ASSET_GUARD_FIELDS=[...SIMULATION_ASSET_FIELDS,'salePending','tripSeconds','type','assetMode','ownerCompanyId','assetClass','operationProfileId','name','ownership','monthlyLease','purchasePrice','catalogId','specs','staffing'];
  function simulationAssetGuard(asset,includeRoute=true){
    if(!asset)return 'missing';
    const guarded={};for(const field of SIMULATION_ASSET_GUARD_FIELDS)guarded[field]=asset[field];
    if(includeRoute)guarded.routeTemplate=asset.routeId&&routeTemplates[asset.routeId]?routeTemplates[asset.routeId]:null;
    return JSON.stringify(guarded);
  }
  function simulationAssetSnapshot(asset,guard=simulationAssetGuard(asset,false)){
    // The immutable guard is also the exact input snapshot. Decode only the
    // asset being processed, inside the existing budgeted chunk; do not clone
    // the entire fleet twice before the first chunk can yield to the display.
    return {id:asset.id,...JSON.parse(guard)};
  }
  function simulationContextGuard(){
    // Only inputs read by trip economics belong in this optimistic conflict
    // guard. Serializing logs, documents and UI state on every slice scaled
    // with save age rather than with the actual work being simulated.
    const companies={};for(const company of COMPANY_PLATFORM.listInstances(state,{includeGroup:false,openedOnly:true})){const model=state.advanced?.companies?.[company.id]||{},serviceLevel=Number(model.serviceLevel),automation=Number(model.automation);companies[company.id]={serviceLevel:Number.isFinite(serviceLevel)?serviceLevel:0,automation:Number.isFinite(automation)?automation:0};}
    const realism=state.realism||{},economy=realism.economy||{},market=realism.market||{};
    return JSON.stringify({
      companies,
      research:state.research||{},sustainability:state.sustainability||{},
      economy:{jetFuel:economy.jetFuel,bunker:economy.bunker,diesel:economy.diesel,airDemand:economy.airDemand,seaDemand:economy.seaDemand,roadDemand:economy.roadDemand},
      market:{share:market.share||{},competitorPressure:market.competitorPressure||{}},reputation:realism.reputation||{}
    });
  }

  // Pure simulation draft: asset and effects are local to the slice. Nothing is committed to state here.
  function processAssetDraft(asset, simAdvance, effects, simMeta={}){
    normalizeAsset(asset);
    if(asset.simulationFault)return;
    let remaining=Math.max(0,Number(simAdvance)||0)+Math.max(0,Number(asset.simCarrySeconds)||0);
    asset.simCarrySeconds=0;
    if(asset.phase==='idle'||!asset.routeId||remaining<=0)return;
    const tpl=routeTemplates[asset.routeId];
    if(!tpl){asset.simulationFault={code:'ROUTE_RUNTIME_MISSING',at:Number(simMeta.from)||Number(state.simSeconds)||0,detail:`Route runtime missing: ${String(asset.routeId).slice(0,80)}`};asset.crewBlocked=true;effects.alerts.push(`${asset.name||asset.id}: عُزل الأصل لأن تعريف مساره غير متاح. لم يتقدم الأصل أو الزمن التشغيلي الخاص به؛ أعد تعيين المسار بعد المراجعة.`);return;}
    let transitions=0,completedTrips=0,totalTripMargin=0,lastEco=null;
    while(remaining>1e-6&&transitions<96&&asset.routeId&&asset.phase!=='idle'){
      transitions++;
      if(asset.phase==='turnaround'){
        const dwell=Math.max(0,Number(asset.dwellRemaining)||0);
        if(dwell>remaining){asset.dwellRemaining=dwell-remaining;remaining=0;break;}
        remaining=Math.max(0,remaining-dwell);
        if(asset.staffing?.mode!=='automatic-fixed'||asset.staffing.ready!==true){if(!asset.crewBlocked)effects.alerts.push(`${asset.name}: تكوين الطاقم الثابت غير مكتمل؛ أوقفت هذه الرحلة دون التأثير على بقية اللعبة.`);asset.crewBlocked=true;remaining=0;break;}
        window.GH_FLEET_CORE.departDraft(asset,routeMatchingFacility(asset.routeId,asset.baseFacility),{crewReady:true,load:loadLabel(asset)});
        continue;
      }
      const duration=Number(asset.tripSeconds||tpl.tripSeconds);
      if(!Number.isFinite(duration)||duration<=0){asset.progress=0;asset.phase='idle';asset.routeId=null;asset.routeSignature=null;effects.alerts.push(`${asset.name}: أوقف النظام المسار لأن مدة الرحلة غير صالحة.`);remaining=0;break;}
      const progress=clamp(Number(asset.progress)||0,0,1),timeToArrival=Math.max(0,(1-progress)*duration);
      const travel=Math.min(remaining,timeToArrival),delta=duration>0?travel/duration:0;
      asset.progress=clamp(progress+delta,0,1);
      asset.fuel=clamp(asset.fuel-delta*(asset.type==='air'?55:asset.type==='sea'?43:49),4,100);
      asset.condition=clamp(asset.condition-delta*(asset.type==='air'?.08:asset.type==='sea'?.05:.11),55,100);
      remaining=Math.max(0,remaining-travel);
      if(asset.progress<1-1e-9)break;
      asset.progress=1;asset.phase='turnaround';asset.dwellRemaining=Math.max(0,Number(tpl.dwellHours)||0)*3600+window.GH_FLEET_CORE.departureDelay(asset);asset.departureScheduled=true;asset.departureScheduledAt=Math.max(0,(Number(simMeta.to)||Number(state.simSeconds)||0)-remaining)+asset.dwellRemaining;
      asset.baseFacility=asset.reverse?tpl.fromFacility:tpl.toFacility;
      const eco=computeTripEconomics(asset,tpl);asset.lastTrip=eco;lastEco=eco;completedTrips++;totalTripMargin+=Number(eco.margin)||0;
      const ownerCompanyId=assetOwnerCompanyId(asset);if(!ownerCompanyId)throw new Error(`asset-owner-company-missing:${asset.id}`);
      effects.todayProfit+=Number(eco.margin)||0;effects.sectorProfit[ownerCompanyId]=(effects.sectorProfit[ownerCompanyId]||0)+(Number(eco.margin)||0);effects.tripProfit[ownerCompanyId]=(effects.tripProfit[ownerCompanyId]||0)+(Number(eco.margin)||0);
      const tripCash=Number.isFinite(eco.cashContribution)?eco.cashContribution:(eco.revenue-eco.fuelCost-eco.maintReserve);
      // Infinite-money mode bypasses liquidity constraints only; it must never
      // suppress economic accruals. Daily close requires gross revenue, costs,
      // trip count and net profit to describe the same completed trips.
      effects.cash[ownerCompanyId]=(effects.cash[ownerCompanyId]||0)+(Number(tripCash)||0);effects.tripRevenue[ownerCompanyId]=(effects.tripRevenue[ownerCompanyId]||0)+Math.max(0,Number(eco.revenue)||0);effects.tripFuel[ownerCompanyId]=(effects.tripFuel[ownerCompanyId]||0)+Math.max(0,Number(eco.fuelCost)||0);effects.tripMaintenance[ownerCompanyId]=(effects.tripMaintenance[ownerCompanyId]||0)+Math.max(0,Number(eco.maintReserve)||0);effects.tripCount[ownerCompanyId]=(effects.tripCount[ownerCompanyId]||0)+1;
      effects.groupValue+=Math.max(0,Number(eco.margin)||0)*.08;
      if(asset.releaseExclusiveRouteOnArrival){const retiredRouteId=asset.routeId;asset.phase='idle';asset.routeId=null;asset.routeSignature=null;asset.releaseExclusiveRouteOnArrival=false;asset.progress=0;asset.dwellRemaining=0;if(retiredRouteId)effects.retiredRouteIds.push(retiredRouteId);effects.alerts.push(`${asset.name}: اكتمل المسار القديم المشترك وتوقف الأصل بأمان لإسناد مسار مستقل.`);remaining=0;break;}
      if(asset.salePending){const ownedStop=findFacility(asset.baseFacility);if(ownedStop?.owned){asset.phase='idle';asset.routeId=null;asset.routeSignature=null;asset.progress=0;asset.dwellRemaining=0;effects.saleIds.push(asset.id);remaining=0;break;}asset.dwellRemaining=0;effects.alerts.push(`${asset.name}: وصل محطة عامة ضمن أمر البيع؛ سيعود تلقائيًا إلى مركز المجموعة قبل تنفيذ البيع.`);}
    }
    if(transitions>=96&&remaining>1e-6){
      asset.simCarrySeconds=Math.min(86400,Math.max(0,remaining));
      const day=Math.floor((Number(simMeta.to)||state.simSeconds||0)/86400);
      if(asset.lastTransitionGuardDay!==day){asset.lastTransitionGuardDay=day;effects.alerts.push(`${asset.name}: بلغ حد حماية انتقالات المحاكاة؛ تم حفظ ${formatDuration(asset.simCarrySeconds)} كزمن مرحّل وسيُستكمل في الشريحة التالية دون فقد.`);}
    }else asset.simCarrySeconds=0;
    if(completedTrips===1&&lastEco)effects.alerts.push(`${asset.name} أكمل رحلة. إيراد ${fmtMoney(lastEco.revenue)} − وقود ${fmtMoney(lastEco.fuelCost)} − صيانة ${fmtMoney(lastEco.maintReserve)} = هامش الرحلة ${fmtMoney(lastEco.margin)}. الراتب الثابت يُصرف في مسير 27.`);
    else if(completedTrips>1)effects.alerts.push(`${asset.name} أكمل ${completedTrips} رحلات أثناء تقديم الوقت بإجمالي هامش ${fmtMoney(totalTripMargin)}.`);
  }

  function simulationCalendarDate(day=state.lastFinancialDay){return new Date(SIM_START+Math.max(0,Math.floor(Number(day)||0))*86400000);}
  function payrollCalendarMeta(day=state.lastFinancialDay){const date=simulationCalendarDate(day),monthKey=`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;return {date,monthKey,dayOfMonth:date.getUTCDate(),label:new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{month:'long',year:'numeric',timeZone:'UTC'}).format(date)};}
  function executivePayrollCompany(id,target=state){
    const sector=({H4:'air',H2:'sea',H1:'road',H6:'road',H8:'power',H11:'power',H9:'bank',H10:'bank'})[id];
    return sector?resolveOperationalCompanyForSector(target,sector):'group';
  }
  function monthlyPayrollSnapshot(){
    window.GH_HR_CORE?.ensure?.(state);const companyIds=operationalCompanyIds(state),rows={group:{company:'group',amount:0,headcount:0}};for(const company of companyIds)rows[company]={company,amount:0,headcount:0};
    for(const company of companyIds.filter(companyId=>companyHasCapability(state,companyId,'operations.fleet'))){rows[company].amount+=Number(window.GH_FLEET_CORE?.monthlyPayroll?.(state,company))||0;rows[company].headcount+=Number(window.GH_FLEET_CORE?.headcount?.(state,company))||0;}
    const mobilityCompany=uniqueOperationalCompanyForCapability(state,'operations.mobility'),mobility=window.GH_MOBILITY_CORE?.snapshot?.(state)||{};if(mobilityCompany){rows[mobilityCompany].amount+=Number(mobility.monthlyPayroll)||0;rows[mobilityCompany].headcount+=Number(mobility.drivers)||0;}
    const facilityContracts=(state.advanced?.labor?.employmentContracts||[]).filter(contract=>contract?.status==='ساري'&&!contract.automaticAssetStaffing&&contract.role==='تشغيل منشأة');
    for(const contract of facilityContracts){const company=rows[contract.company]?contract.company:'group',count=Math.max(1,Number(contract.count)||1);rows[company].amount+=(Number(contract.salary)||0)*count;rows[company].headcount+=count;}
    const officialManagerContracts=(state.advanced?.labor?.employmentContracts||[]).filter(contract=>contract?.status==='ساري'&&contract.officialManager===true&&!contract.automaticAssetStaffing);
    for(const contract of officialManagerContracts){const company=rows[contract.company]?contract.company:'group';rows[company].amount+=(Number(contract.salary)||0)/12;rows[company].headcount+=1;}
    for(const id of state.hired||[]){const person=candidates.find(candidate=>candidate.id===id);if(!person)continue;const company=executivePayrollCompany(id)||'group';rows[company].amount+=(Number(person.salary)||0)/12;rows[company].headcount+=1;}
    for(const [company,row] of Object.entries(rows)){const index=window.GH_HR_CORE?.salaryMultiplier?.(state,company)||1;row.salaryIndex=index;row.lastRaisePct=Number(state.advanced?.labor?.salaryPolicy?.[company]?.lastRaisePct)||0;row.amount*=index;}
    for(const row of Object.values(rows))row.amount=Math.max(0,Math.round(row.amount));
    return rows;
  }
  function payrollReportForMonth(monthKey){return (state.finance?.payrollReports||[]).find(report=>report.monthKey===monthKey||window.GH_FINANCE_CORE?.calendarMonthForDay?.(report.day)===monthKey)||null;}
  function settleOutstandingPayroll(){
    const payables=(state.finance?.payables||[]).map(item=>({item,invoice:(state.finance?.invoices||[]).find(invoice=>invoice.number===item.number)})).filter(({item,invoice})=>invoice?.payrollShortfall===true||item?.payrollShortfall===true).sort((a,b)=>(Number(a.item.dueDay)||0)-(Number(b.item.dueDay)||0));
    let settled=0,total=0,funded=0;
    for(const {item,invoice} of payables){const company=item.company||invoice?.company||'group',amount=Math.max(0,Number(item.total??item.amount)||0);if(!amount)continue;const opening=companyOperatingBalance(company);if(company!=='group'&&opening<amount){const gap=amount-opening;if(gap>0&&companyOperatingBalance('group')>=gap&&transferBetweenCompaniesSystem(state,'group',company,gap,`تمويل آلي لتسوية رواتب مستحقة · ${item.number}`,'payroll-scheduler'))funded+=gap;}if(companyOperatingBalance(company)<amount)continue;try{dispatchSystemCommand({state},'finance','settle-payable',{number:item.number},{actor:'payroll-scheduler'});settled++;total+=amount;}catch(error){console.warn('تعذر تسوية راتب مستحق',item.number,error);}}
    if(settled)pushAlert(`سويت الرواتب المستحقة تلقائيًا: ${settled} حوالة بقيمة ${fmtMoney(total)}${funded?`، منها ${fmtMoney(funded)} تمويل داخلي من القابضة`:''}.`);
    return {settled,total,funded};
  }

  function processFinancialDay(processedDay=null){
    const currentDay=Math.floor(state.simSeconds/86400),day=processedDay==null?currentDay:Math.max(0,Math.floor(Number(processedDay)||0));let financialDaysProcessed=0;
    if(day<=state.lastFinancialDay)return;
    if(day-state.lastFinancialDay!==1)throw new Error(`Non-sequential financial boundary: ${state.lastFinancialDay} -> ${day}`);
    while(state.lastFinancialDay<day&&financialDaysProcessed<1){
      state.lastFinancialDay++;financialDaysProcessed++;
      for(const c of state.finance.cheques.filter(c=>c.status==='صادر'&&c.dueDay<=state.lastFinancialDay)){
        const result=settleCheque(c);
        if(result.settled===true)pushAlert(`تم صرف الشيك ${result.id} من حساب ${companyFinanceName(result.company)} وتسجيله في الدفتر المالي.`);
        else pushAlert(`ارتجع الشيك ${result.id} لعدم كفاية رصيد أو ميزانية ${companyFinanceName(result.company)}.`);
      }

      const tripAccruals=dispatchSystemCommand({state},'finance','consume-trip-accruals',{}, {actor:'financial-close'}).result;
      const tripProfit=tripAccruals.profit,tripRevenue=tripAccruals.revenue,tripFuel=tripAccruals.fuel,tripMaintenance=tripAccruals.maintenance,tripCount=tripAccruals.count,tripCash=tripAccruals.cash||{};
      // Scalable accounting source of truth: one daily settlement batch per company,
      // not three financial documents per individual trip. Trip cash stays in a
      // persisted clearing bucket during the day, then reaches each company's
      // current account exactly once at this atomic day boundary.
      const companyIds=operationalCompanyIds(state),companyIdSet=new Set(companyIds),accrualCompanyIds=new Set([...Object.keys(tripProfit||{}),...Object.keys(tripRevenue||{}),...Object.keys(tripFuel||{}),...Object.keys(tripMaintenance||{}),...Object.keys(tripCount||{}),...Object.keys(tripCash||{})]);
      for(const companyId of accrualCompanyIds)if(!companyIdSet.has(companyId)&&[tripProfit,tripRevenue,tripFuel,tripMaintenance,tripCount,tripCash].some(bucket=>Math.abs(Number(bucket?.[companyId])||0)>.005))throw new Error(`trip-accrual-company-not-operational:${companyId}`);
      for(const companyId of companyIds){
        const count=Math.max(0,Number(tripCount[companyId])||0),revenue=Math.max(0,Number(tripRevenue[companyId])||0),fuel=Math.max(0,Number(tripFuel[companyId])||0),maint=Math.max(0,Number(tripMaintenance[companyId])||0),taxable=companyTaxable(state,companyId),clearing='مركز التسوية التشغيلية اليومية',invoiceNumbers=[],profile=window.GH_FINANCE_CORE.collectionProfile(companyId,state),mobility=isMobilityCompany(companyId,state);
        const post=(...args)=>{const doc=postInvoice(...args);invoiceNumbers.push(doc.number);return doc;};
        if(revenue>0)post('دخل',revenue,`تسوية رحلات يومية ${typeName(companyId)} · ${count} رحلة`,'تسوية تشغيل يومية',taxable,'مدفوعة',companyId,profile.source,{settlementAccount:clearing});
        if(fuel>0)post('مصروف',fuel,`تكلفة تشغيل رحلات يومية ${typeName(companyId)} · ${count} رحلة`,'تسوية مورد تشغيل يومية',taxable,'مدفوعة',companyId,mobility?'السائقون ومزودو التشغيل':'موردو الوقود المعتمدون',{settlementAccount:clearing});
        if(maint>0)post('مصروف',maint,`مخصص صيانة رحلات يومية ${typeName(companyId)} · ${count} رحلة`,'مخصص صيانة يومي',false,'مدفوعة',companyId,'مراكز الصيانة المعتمدة',{settlementAccount:clearing});
        const amount=Number(tripCash[companyId])||0;if(Math.abs(amount)>=.005||revenue>0){const before=companyOperatingBalance(companyId),settlement=dispatchSystemCommand({state},'finance','settle-daily-cash',{company:companyId,amount,grossAmount:revenue,deductions:fuel+maint,tripCount:count,invoiceNumbers,day:state.lastFinancialDay,reference:`DAY-CASH-${companyId}-${state.lastFinancialDay}`,note:`تحويل صافي تشغيل اليوم ${state.lastFinancialDay} إلى الحساب الجاري · ${typeName(companyId)}`},{actor:'financial-close'}).result,after=companyOperatingBalance(companyId);if(Math.abs((after-before)-Number(settlement?.amount||0))>.01)throw new Error(`daily-profit-current-account-mismatch:${companyId}`);if(settlement?.shortfall>0)pushAlert(`رحّلت تسوية نقدية غير مغطاة بقيمة ${fmtMoney(settlement.shortfall)} في ${typeName(companyId)} إلى إقفال اليوم التالي دون إسقاطها.`);}
      }
      const companyContractRevenue=zeroCompanyMap(state),companyContractCost=zeroCompanyMap(state),contractDailyRows=[];
      const contractTerms={};for(const id of (state.acceptedContracts||[])){const c=contracts.find(x=>x.id===id);if(!c)continue;const companyId=contractOwnerCompanyId(c,state);if(!companyId)throw new Error(`contract-owner-unresolved-or-ambiguous:${id}`);const termDays=Math.max(1,Number(c.termMonths)||1)*30,dailyRevenue=c.value/termDays,dailyCost=c.cost/termDays;contractTerms[id]=termDays;companyContractRevenue[companyId]=(companyContractRevenue[companyId]||0)+dailyRevenue;companyContractCost[companyId]=(companyContractCost[companyId]||0)+dailyCost;contractDailyRows.push({id,companyId,sector:c.sector,client:c.client,name:c.name,revenue:dailyRevenue,cost:dailyCost});}const expiredContracts=dispatchSystemCommand({state},'contracts','tick-day',{day:state.lastFinancialDay,terms:contractTerms},{actor:'simulation'}).result?.expired||[];for(const id of expiredContracts){const c=contracts.find(x=>x.id===id);if(c)pushAlert(`اكتمل عقد ${c.name} وانتهت مدته التشغيلية بعد ${c.termMonths} شهرًا.`);}
      // Bank and energy daily owners must close first. The accounting read model
      // below then consumes the report for this same day, never yesterday's values.
      const advancedCost=window.GH_ADVANCED?window.GH_ADVANCED.onFinancialDay(state,state.lastFinancialDay):0;
      const payrollMeta=payrollCalendarMeta(state.lastFinancialDay),payrollPlan=monthlyPayrollSnapshot(),payrollDueToday=payrollMeta.dayOfMonth>=27&&!payrollReportForMonth(payrollMeta.monthKey);
      const leaseByCompany=zeroCompanyMap(state);state.assets.forEach(asset=>{const companyId=assetOwnerCompanyId(asset);if(asset.ownership==='lease'&&companyIdSet.has(companyId))leaseByCompany[companyId]=(leaseByCompany[companyId]||0)+(Number(asset.monthlyLease)||0)/30;});
      const baseByCompany=zeroCompanyMap(state),facilityIncomeByCompany=zeroCompanyMap(state);
      const dailyFacilities=getDynamicFacilities(),facilityCosts=window.GH_FACILITY_CORE.dailyOperatingCosts(state,{facilities:dailyFacilities});for(const companyId of companyIds)baseByCompany[companyId]=Number(facilityCosts.byCompany[companyId])||0;
      dailyFacilities.filter(f=>f.owned).forEach(f=>{const companyId=facilityOwnerCompanyId(f);if(companyIdSet.has(companyId)){const model=state.advanced?.facilities?.[f.id];if(model)facilityIncomeByCompany[companyId]+=(Number(model.expectedRevenue)||0)/365;}});
      const eco=window.GH_ECONOMICS_CORE?.sectorEconomics?.(state,{day:state.lastFinancialDay,preferDailyReport:true})||{power:32000,bank:26000,detail:{}};const ed=eco.detail||{};
      const operatingRevenue=zeroCompanyMap(state),operatingExpense=zeroCompanyMap(state);for(const companyId of companyIds){operatingRevenue[companyId]=(companyContractRevenue[companyId]||0)+(facilityIncomeByCompany[companyId]||0)+Math.max(0,Number(ed.companyRevenue?.[companyId])||0);operatingExpense[companyId]=(companyContractCost[companyId]||0)+(baseByCompany[companyId]||0)+(leaseByCompany[companyId]||0)+Math.max(0,Number(ed.companyExpense?.[companyId])||0);}
      // The section totals include premises for disclosure. Only their residual
      // expense is added here: baseByCompany already owns the premises posting.
      const energyCompany=uniqueOperationalCompanyForCapability(state,'operations.energy'),bankCompany=uniqueOperationalCompanyForCapability(state,'operations.bank');
      if(energyCompany){operatingRevenue[energyCompany]+=Math.max(0,Number(ed.powerRevenue)||0);operatingExpense[energyCompany]+=Math.max(0,Number(ed.powerExpense)||0)-Math.max(0,Number(ed.powerFacilityExpense)||0)+Math.max(0,Number(ed.powerDebtInterest)||0);}
      if(bankCompany){operatingRevenue[bankCompany]+=Math.max(0,Number(ed.bankRevenue)||0);operatingExpense[bankCompany]+=Math.max(0,Number(ed.bankExpenseToPost??ed.bankExpense)||0);}
      // Corporate facility interest is transferred and journaled by Banking Core.
      // Keep it in bank P&L, but exclude it from the cash credit posted by this close.
      const cashOperatingRevenue={...operatingRevenue},cashOperatingExpense={...operatingExpense};if(bankCompany)cashOperatingRevenue[bankCompany]=(companyContractRevenue[bankCompany]||0)+(facilityIncomeByCompany[bankCompany]||0)+Math.max(0,Number(ed.companyRevenue?.[bankCompany])||0)+Math.max(0,Number(ed.bankCashRevenueToPost??ed.bankRevenue)||0);if(energyCompany)cashOperatingExpense[energyCompany]=Math.max(0,Number(cashOperatingExpense[energyCompany]||0)-Math.max(0,Number(ed.takeOrPayAccrued)||0));
      // رواتب المنشآت لا تُخصم يوميًا هنا؛ تُصرف مرة واحدة في مسير يوم 27.
      const daily=Object.fromEntries(companyIds.map(companyId=>[companyId,(Number(operatingRevenue[companyId])||0)-(Number(operatingExpense[companyId])||0)]));
      for(const companyId of companyIds){
        const taxable=companyTaxable(state,companyId),revenue=Math.max(0,Number(cashOperatingRevenue[companyId])||0),expense=Math.max(0,Number(cashOperatingExpense[companyId])||0),contractRows=contractDailyRows.filter(row=>row.companyId===companyId),contractRevenue=contractRows.reduce((sum,row)=>sum+Math.max(0,Number(row.revenue)||0),0);
        for(const row of contractRows)if(row.revenue>0)dispatchSystemCommand({state},'finance','credit',{company:companyId,amount:row.revenue,note:`إيراد عقد يومي · ${row.name}`,taxable,reference:`CONTRACT-COLLECT-${row.id}-${state.lastFinancialDay}`,counterparty:row.client,sourceRefs:[row.id,`CONTRACT-DAY-${row.id}-${state.lastFinancialDay}`]},{actor:'financial-close'});
        const residualRevenue=Math.max(0,revenue-contractRevenue);if(residualRevenue>0)dispatchSystemCommand({state},'finance','credit',{company:companyId,amount:residualRevenue,note:`إيراد يومي ${typeName(companyId)} · منشآت/تشغيل غير تعاقدي`,taxable,reference:`OPER-COLLECT-${companyId}-${state.lastFinancialDay}`,periodDay:state.lastFinancialDay,sourceRefs:[`OPER-${companyId}-${state.lastFinancialDay}`]},{actor:'financial-close'});
        if(expense>0){const available=companyOperatingBalance(companyId),paid=Math.min(available,expense);if(paid>0)spendCompanySystem(companyId,paid,`مصروف يومي ${typeName(companyId)} · عقود/منشآت/إيجارات`,'قيد تشغيلي يومي',taxable);if(paid<expense){const due=expense-paid,number=`${companyId.toUpperCase()}-ACC-${state.lastFinancialDay}`;postAccruedExpense(companyId,due,'مصروف تشغيلي مستحق مرحّل من الإقفال اليومي','قيد مستحق',state.lastFinancialDay+7,number,'مصروف تشغيلي');}}
      }
      const closedSectorProfit=Object.fromEntries(companyIds.map(companyId=>[companyId,(Number(tripProfit[companyId])||0)+(Number(daily[companyId])||0)]));
      if(payrollDueToday)for(const companyId of companyIds)closedSectorProfit[companyId]-=Number(payrollPlan[companyId]?.amount)||0;
      const companyDaily={};for(const companyId of companyIds){const tripGross=Math.max(0,Number(tripRevenue[companyId])||0),operatingGross=Math.max(0,Number(operatingRevenue[companyId])||0),companyNet=Number(closedSectorProfit[companyId])||0;companyDaily[companyId]={tripRevenue:tripGross,operatingRevenue:operatingGross,grossRevenue:tripGross+operatingGross,expenses:Math.max(0,tripGross+operatingGross-companyNet),net:companyNet,tripCount:Math.max(0,Number(tripCount[companyId])||0)};}
      const overhead=42500+state.assets.length*80,realismCost=window.GH_REALISM?window.GH_REALISM.onDay(state,state.lastFinancialDay):0,groupCost=overhead+advancedCost+realismCost,groupPayrollExpense=payrollDueToday?payrollPlan.group.amount:0;
      if(groupCost>0){const paid=Math.min(companyOperatingBalance('group'),groupCost);if(paid>0)spendCompanySystem('group',paid,'إقفال يومي الشركة القابضة · إدارة وامتثال','قيد يومي',false);if(paid<groupCost){const due=groupCost-paid,number=`GH-ACC-${state.lastFinancialDay}`;postAccruedExpense('group',due,'عجز الشركة القابضة المرحّل','قيد مستحق',state.lastFinancialDay+7,number,'مصروفات إدارية وتشغيلية');}}
      settleOutstandingPayroll();reconcileConsolidatedCash();const net=Object.values(closedSectorProfit).reduce((a,b)=>a+(Number(b)||0),0)-groupCost-groupPayrollExpense;dispatchSystemCommand({state},'finance','record-daily-close',{day:state.lastFinancialDay,sectors:closedSectorProfit,companies:companyDaily,net},{actor:'financial-close'});dispatchSystemCommand({state},'corporate','adjust-group-value',{delta:net*.03},{actor:'financial-close'});runOperationsCycle(net);
      // رواتب تقويمية في تاريخ 27؛ إذا وصل حفظ قديم بعد التاريخ تُنفّذ مرة واحدة للشهر نفسه.
      if(payrollDueToday){
        const reportId=`PAYROLL-${payrollMeta.monthKey}`,payrollItems=[...companyIds,'group'].map(company=>payrollPlan[company]).filter(row=>row&&row.amount>0),lines=[];
        for(const item of payrollItems){
          const company=item.company,amount=item.amount;if(amount<=0)continue;
          const note=`مسير رواتب يوم 27 · ${companyFinanceName(company)}`,opening=companyOperatingBalance(company);
          let autoFunding=0;
          if(company!=='group'&&opening<amount){
            const gap=amount-opening,availableAtGroup=companyOperatingBalance('group');
            if(gap>0&&availableAtGroup>=gap&&transferBetweenCompaniesSystem(state,'group',company,gap,`تمويل آلي لمسير رواتب يوم 27 · ${reportId}`,'payroll-scheduler'))autoFunding=gap;
          }
          const paid=Math.min(amount,companyOperatingBalance(company));let paymentRef=null,dueRef=null;
          if(paid>0){const doc=dispatchSystemCommand({state},'finance','pay-payroll',{company,amount:paid,note,reportId},{actor:'payroll-scheduler'}).result;paymentRef=doc?.transferReference||doc?.number||null;}
          const due=Math.max(0,amount-paid);
          if(due>0){const number=`PAY-${company.toUpperCase()}-${payrollMeta.monthKey}`,doc=dispatchSystemCommand({state},'finance','accrue-payroll',{company,amount:due,note:`رواتب مستحقة يوم 27 · ${companyFinanceName(company)}`,number,dueDay:state.lastFinancialDay,reportId},{actor:'payroll-scheduler'}).result;dueRef=doc?.number||number;}
          lines.push({company,companyName:companyFinanceName(company),amount,paid,due,autoFunding,paymentRef,dueRef,headcount:item.headcount});
        }
        const report=dispatchSystemCommand({state},'finance','record-payroll-report',{report:{id:reportId,day:state.lastFinancialDay,month:payrollMeta.label,monthKey:payrollMeta.monthKey,calendarDate:payrollMeta.date.toISOString().slice(0,10),lines}},{actor:'payroll-scheduler'}).result;
        pushAlert(report?.due>0?`صدر تقرير رواتب يوم 27: صُرف ${fmtMoney(report.paid)} وسُجل ${fmtMoney(report.due)} كرواتب مستحقة، بلا انتظار اعتماد.`:`صدر تقرير رواتب يوم 27 وصُرف كامل المسير بقيمة ${fmtMoney(report?.paid||0)} عبر التحويلات.`);
      }
      const nextCalendarDate=simulationCalendarDate(state.lastFinancialDay+1),isCalendarMonthEnd=nextCalendarDate.getUTCMonth()!==payrollMeta.date.getUTCMonth();
      if(isCalendarMonthEnd){
        const payroll=Object.values(payrollPlan).reduce((sum,row)=>sum+(Number(row.amount)||0),0);
        dispatchSystemCommand({state},'finance','close-vat-period',{day:state.lastFinancialDay},{actor:'financial-close'});reconcileConsolidatedCash();pushAlert(`إغلاق شهري مستقل لكل شركة. إجمالي الرواتب ${fmtMoney(payroll)} وصافي المجموعة اليومي ${fmtMoney(net)}.`);
      }
    }
  }

  function runOperationsCycle(net){
    const moving=state.assets.filter(a=>a.phase==='moving').length,readiness=state.assets.length?state.assets.reduce((s,a)=>s+a.condition,0)/state.assets.length:100;
    const brief=dispatchSystemCommand({state},'operations','daily-brief',{day:state.lastFinancialDay,net,moving,readiness,debt:state.debt,groupValue:state.groupValue},{actor:'simulation'}).result;
    if(brief.risk>=55)pushAlert(`مؤشر التشغيل: مخاطر تشغيلية مرتفعة (${brief.risk}/100). افحص الصيانة والسيولة قبل فتح التزامات جديدة.`);
    else if(state.lastFinancialDay%7===0)pushAlert(`مؤشر التشغيل الأسبوعي: ${moving} أصلًا متحركًا، جاهزية الأسطول ${Math.round(readiness)}%، صافي اليوم ${fmtMoney(net)}.`);
  }

  function processMarket(processedHour=null){
    const currentHour=Math.floor(state.simSeconds/3600),hour=processedHour==null?currentHour:Math.max(0,Math.floor(Number(processedHour)||0));
    if(hour<=state.lastMarketHour)return;
    if(hour-state.lastMarketHour!==1)throw new Error(`Non-sequential market boundary: ${state.lastMarketHour} -> ${hour}`);
    state.lastMarketHour=hour;
    dispatchSystemCommand({state},'market','tick-prices',{hour},{actor:'simulation-market'});
    if(window.GH_REALISM)window.GH_REALISM.onHour(state,hour);
    if(window.GH_ADVANCED){const marketCycle=()=>{window.GH_ADVANCED.onMarketHour(state,hour);window.GH_DELIVERY_MONITOR?.reconcile?.(state);return {hour};};const cp=window.GH_CONTROL_PLANE;if(cp?.execute)cp.execute(state,{name:'MARKET_HOURLY_CYCLE',domain:'market',actor:'simulation-market',correlationId:`MARKET-HOUR-${hour}`},marketCycle,{atomic:false,integrity:true,deferIntegrityToTransaction:window.GH_TRANSACTION_CORE?.isActive?.()===true});else marketCycle();}
  }

  // ---------------------------------------------------------------------------
  // SIMULATION CORE 2.1 — one authoritative clock, sharded work and exact boundaries.
  // No legacy frame-coupled catch-up loops remain. Rendering never owns game time.
  // ---------------------------------------------------------------------------
  function financeAuditArchive(){
    state.finance=state.finance&&typeof state.finance==='object'?state.finance:{};
    const a=state.finance.auditArchive&&typeof state.finance.auditArchive==='object'?state.finance.auditArchive:(state.finance.auditArchive={records:{},digests:[]});
    a.records=a.records&&typeof a.records==='object'?a.records:{};a.digests=Array.isArray(a.digests)?a.digests:[];return a;
  }
  function auditChecksum(rows){let h=2166136261>>>0;const text=JSON.stringify(rows);for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h.toString(16).padStart(8,'0');}
  function auditRowId(row){return String(row?.number||row?.id||row?.reference||row?.sourceRef||row?.documentNumber||'');}
  function auditSequence(row){let max=0;for(const value of [row?.id,row?.reference,row?.sourceRef,row?.documentNumber]){const match=String(value||'').match(/(\d+)(?!.*\d)/);if(match){const n=Number(match[1]);if(Number.isSafeInteger(n))max=Math.max(max,n);}}return max;}
  function ledgerAggregate(row){
    const amount=Math.max(0,Number(row?.amount)||0),kind=String(row?.kind||''),from=String(row?.from||''),note=String(row?.note||''),intercompany=['intercompany','bank-credit','cash-sweep'].includes(kind)?amount:0;
    if(['intercompany','internal','bank-credit','cash-sweep'].includes(kind))return {income:0,expense:0,intercompany};
    const income=from.includes('عميل')||note.includes('إيراد')||note.includes('فاتورة رحلة')?amount:0;return {income,expense:income?0:amount,intercompany};
  }
  function buildAuditDigest(kind,rows){
    if(!rows.length)return null;const ordered=[...rows].sort((a,b)=>(Number(a?.at)||0)-(Number(b?.at)||0)),currentDay=Math.floor((Number(state.simSeconds)||0)/86400),daily=new Map();let total=0,maxSequence=0,intercompanyTotal=0;
    for(const row of ordered){const amount=Math.max(0,Number(row?.total??row?.amount)||0),at=Math.max(0,Number(row?.at)||0),day=Math.floor(at/86400),metrics=kind.startsWith('companyLedger-')?ledgerAggregate(row):{income:0,expense:0,intercompany:0};total+=amount;maxSequence=Math.max(maxSequence,auditSequence(row));intercompanyTotal+=metrics.intercompany;if(kind.startsWith('companyLedger-')&&day>=currentDay-29){const d=daily.get(day)||{day,income:0,expense:0,intercompany:0,count:0,total:0};d.income+=metrics.income;d.expense+=metrics.expense;d.intercompany+=metrics.intercompany;d.count++;d.total+=amount;daily.set(day,d);}}
    return {schema:'gh-finance-audit-digest-v2',id:`AUD-${kind}-${currentDay}`,kind,count:ordered.length,total,firstAt:Math.max(0,Number(ordered[0]?.at)||0),lastAt:Math.max(0,Number(ordered.at(-1)?.at)||0),idRange:[auditRowId(ordered[0]),auditRowId(ordered.at(-1))],checksum:auditChecksum(ordered),maxSequence,intercompanyTotal,recentDaily:[...daily.values()].sort((a,b)=>a.day-b.day).slice(-30),at:Number(state.simSeconds)||0};
  }
  function mergeAuditDigest(digest){
    if(!digest)return;const archive=financeAuditArchive(),existing=archive.digests.find(row=>row?.kind===digest.kind&&row?.schema==='gh-finance-audit-digest-v2');if(!existing){archive.digests=archive.digests.filter(row=>row?.kind!==digest.kind);archive.digests.push(digest);return;}
    const currentDay=Math.floor((Number(state.simSeconds)||0)/86400),daily=new Map();for(const row of [...(existing.recentDaily||[]),...(digest.recentDaily||[])]){const day=Math.max(0,Math.floor(Number(row?.day)||0));if(day<currentDay-29)continue;const d=daily.get(day)||{day,income:0,expense:0,intercompany:0,count:0,total:0};d.income+=Math.max(0,Number(row?.income)||0);d.expense+=Math.max(0,Number(row?.expense)||0);d.intercompany+=Math.max(0,Number(row?.intercompany)||0);d.count+=Math.max(0,Math.floor(Number(row?.count)||0));d.total+=Math.max(0,Number(row?.total)||0);daily.set(day,d);}
    const merged={schema:'gh-finance-audit-digest-v2',id:existing.id||digest.id,kind:digest.kind,count:(Number(existing.count)||0)+(Number(digest.count)||0),total:(Number(existing.total)||0)+(Number(digest.total)||0),firstAt:Math.min(...[Number(existing.firstAt)||0,Number(digest.firstAt)||0].filter(Boolean)),lastAt:Math.max(Number(existing.lastAt)||0,Number(digest.lastAt)||0),idRange:[String(existing.idRange?.[0]||digest.idRange?.[0]||''),String(digest.idRange?.[1]||existing.idRange?.[1]||'')],checksum:auditChecksum([existing.checksum,digest.checksum,existing.count,digest.count,existing.total,digest.total]),maxSequence:Math.max(Number(existing.maxSequence)||0,Number(digest.maxSequence)||0),intercompanyTotal:(Number(existing.intercompanyTotal)||0)+(Number(digest.intercompanyTotal)||0),recentDaily:[...daily.values()].sort((a,b)=>a.day-b.day).slice(-30),at:Number(state.simSeconds)||0};
    archive.digests=archive.digests.filter(row=>row!==existing&&row?.kind!==digest.kind);archive.digests.push(merged);
  }
  function archiveFull(kind,rows){if(!rows.length)return;const copies=rows.map(row=>clone(row)),archive=financeAuditArchive(),bucket=Array.isArray(archive.records[kind])?archive.records[kind]:[];archive.records[kind]=[...bucket,...copies];}
  function archiveRetention(kind){
    const openNumbers=kind==='invoices'?new Set([...(state.finance?.payables||[]),...(state.finance?.receivables||[])].map(row=>String(row?.number||''))):null;
    return row=>{if(kind==='invoices')return openNumbers.has(String(row?.number||''))||!['مدفوعة','مسددة','محصلة'].includes(row?.status);if(kind==='cheques')return !['مصروف','ملغى'].includes(row?.status);if(kind==='taxPeriods')return !['مسددة','صفر'].includes(row?.status);if(kind==='transfers')return !['منفذة','مسددة','ملغى','ملغاة'].includes(row?.status);return false;};
  }
  function archiveTrim(arr,max,kind){
    if(!Array.isArray(arr)||arr.length<=max)return arr;const keep=archiveRetention(kind),retained=arr.slice(0,max),removed=[];for(let index=max;index<arr.length;index++)(keep(arr[index])?retained:removed).push(arr[index]);if(!removed.length)return arr;archiveFull(kind,removed);arr.length=0;for(const row of retained)arr.push(row);return arr;
  }
  function compactAggregatableHistory(arr,kind,detailCutoff){
    if(!Array.isArray(arr)||!arr.length)return false;const retained=[],proofRows=[],aggregateRows=[];for(const row of arr){const at=Math.max(0,Number(row?.at)||0);if(at>=detailCutoff)retained.push(row);else if(row?.documentProofId)proofRows.push(row);else aggregateRows.push(row);}if(!proofRows.length&&!aggregateRows.length)return false;
    // Build every fallible result before publishing state mutations. The outer transaction then protects all buckets atomically.
    const proofCopies=proofRows.map(row=>clone(row)),digest=buildAuditDigest(kind,aggregateRows);arr.length=0;for(const row of retained)arr.push(row);if(proofCopies.length)archiveFull(kind,proofCopies);if(digest)mergeAuditDigest(digest);return true;
  }
  function compactSimulationState(force=false){
    const day=Math.floor((state.simSeconds||0)/86400);if(!force&&state.simulationKernel?.lastCompactDay===day)return;
    const detailCutoff=Math.max(0,(day-2)*86400),targets=[[state.finance?.invoices,2500,'invoices'],[state.finance?.cheques,1200,'cheques'],[state.finance?.transfers,1200,'transfers'],[state.finance?.periods,240,'taxPeriods'],[state.supplierTransactions,3000,'supplierTransactions']],tails=[[state.alerts,32],[state.eventLog,280],[state.operations?.dailyBriefs,24],[state.bank?.cashSweeps,48]];
    const ledgerHistory=(Array.isArray(state.finance?.journalEntries)&&state.finance.journalEntries.some(row=>(Number(row?.at)||0)<detailCutoff))||Object.entries(state.companyFinance||{}).some(([,book])=>Array.isArray(book?.ledger)&&book.ledger.some(row=>(Number(row?.at)||0)<detailCutoff));
    const hasHistory=ledgerHistory||targets.some(([rows,max,kind])=>{if(!Array.isArray(rows)||rows.length<=max)return false;const keep=archiveRetention(kind);for(let i=max;i<rows.length;i++)if(!keep(rows[i]))return true;return false;});if(!hasHistory&&!tails.some(([rows,max])=>Array.isArray(rows)&&rows.length>max))return;
    const tx=window.GH_TRANSACTION_CORE;if(!tx?.execute||!tx?.join)throw new Error('compaction-transaction-owner-unavailable');
    const apply=()=>{const trim=(arr,max)=>{if(Array.isArray(arr)&&arr.length>max)arr.length=max;};compactAggregatableHistory(state.finance?.journalEntries,'journalEntries',detailCutoff);for(const type of companyFinanceTypes())compactAggregatableHistory(companyBook(type)?.ledger,`companyLedger-${type}`,detailCutoff);for(const [rows,max,kind] of targets)archiveTrim(rows,max,kind);trim(state.treasury?.ledger,1200);trim(state.alerts,32);trim(state.eventLog,280);trim(state.operations?.dailyBriefs,24);trim(state.bank?.cashSweeps,48);state.simulationKernel=state.simulationKernel&&typeof state.simulationKernel==='object'?state.simulationKernel:{};state.simulationKernel.lastCompactDay=day;};
    const result=(tx.isActive()?tx.join:tx.execute)(state,{label:'simulation-history-compaction',apply});if(!result.committed)throw new Error(result.reason||'compaction-rejected');
  }

  function normalizeSimulationClocks(){
    const currentDay=Math.max(0,Math.floor((Number(state.simSeconds)||0)/86400)),currentHour=Math.max(0,Math.floor((Number(state.simSeconds)||0)/3600));
    state.timeRecovery=state.timeRecovery&&typeof state.timeRecovery==='object'?state.timeRecovery:{};
    let d=Math.max(0,Math.floor(Number(state.lastFinancialDay)||0)),h=Math.max(0,Math.floor(Number(state.lastMarketHour)||0));
    if(d>currentDay){diag('BOUNDARY_MARKER_AHEAD',{kind:'day',from:d,to:currentDay});d=currentDay;}
    if(h>currentHour){diag('BOUNDARY_MARKER_AHEAD',{kind:'hour',from:h,to:currentHour});h=currentHour;}
    state.lastFinancialDay=d;state.lastMarketHour=h;
    state.timeRecovery.financialTarget=currentDay;state.timeRecovery.marketTarget=currentHour;
    state.timeRecovery.active=d<currentDay||h<currentHour;
    if(state.timeRecovery.active)diag('BOUNDARY_RECOVERY_QUEUED',{financialFrom:d,financialTo:currentDay,marketFrom:h,marketTo:currentHour});
  }
  normalizeSimulationClocks();

  function processOneRecoveryBoundary(){
    const r=state.timeRecovery||{};if(!r.active)return false;
    const nextDay=state.lastFinancialDay<Number(r.financialTarget||0)?state.lastFinancialDay+1:null;
    const nextHour=state.lastMarketHour<Number(r.marketTarget||0)?state.lastMarketHour+1:null;
    if(nextDay===null&&nextHour===null){r.active=false;diag('BOUNDARY_RECOVERY_COMPLETE');return false;}
    const dayAt=nextDay===null?Infinity:nextDay*86400,hourAt=nextHour===null?Infinity:nextHour*3600;
    const kind=dayAt<=hourAt?'day':'hour',value=kind==='day'?nextDay:nextHour;
    try{
      const outcome=window.GH_TRANSACTION_CORE.execute(state,{label:`boundary-recovery:${kind}:${value}`,auditWrites:globalThis.__GH_BUILD339_WRITE_AUDIT__===true,apply:()=>{
        if(kind==='day')processFinancialDay(value);else processMarket(value);
        diag(kind==='day'?'BOUNDARY_DAY_RECOVERED':'BOUNDARY_HOUR_RECOVERED',{value});return true;
      }});
      if(!outcome.committed)throw new Error(outcome.reason||'recovery-commit-rejected');
      r.active=state.lastFinancialDay<Number(r.financialTarget||0)||state.lastMarketHour<Number(r.marketTarget||0);
      return true;
    }catch(error){
      state.speed=0;r.failed=true;r.lastError=String(error?.message||error);diag('BOUNDARY_RECOVERY_FAILED',{kind,value,error:r.lastError});
      pushAlert('تم إيقاف المحاكاة وقائيًا: تعذر استرداد حد زمني مفقود دون تخطيه. لم يتم تقديم الوقت.');return false;
    }
  }


  const SIMULATION_TRANSACTION_SCOPE=Object.freeze([
    'simSeconds','assets','simulationWorld','todayProfit','groupValue','sectorProfitToday',
    'tripProfitAccrued','tripRevenueAccrued','tripFuelAccrued','tripMaintenanceAccrued','tripCountAccrued','companyFinance','finance','treasury','cash','debt',
    'alerts','eventLog','diagnostics','sequences','simulationKernel','realism','mobility','advanced','businessLedger','dependencyGraph','controlPlane','leasedAssets','customRoutes','routeEndpoints','routeCache'
  ]);
  // When the procurement owner proves there is no delivery work, an ordinary
  // slice cannot mutate realism/advanced. Excluding their historical stores from
  // the rollback snapshot removes megabytes of synchronous clone work without
  // weakening rollback for slices that can actually deliver assets.
  const SIMULATION_STEADY_TRANSACTION_SCOPE=Object.freeze(SIMULATION_TRANSACTION_SCOPE.filter(key=>key!=='realism'&&key!=='advanced'));

  function createSimulationSliceJob(sliceSeconds,meta={}){
    if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core 2.2 is required before simulation starts');
    const tx=window.GH_TRANSACTION_CORE;
    // Snapshot every asset at the logical start of the slice. No draft may read a later live asset state.
    // Geometry is guarded once per distinct route, while every asset retains its
    // own full input guard. Caches are slice-local: no stale cross-frame route hash.
    const routeGuards=new Map();
    const assetSeeds=(state.assets||[]).map(asset=>{
      if(asset.routeId&&!routeGuards.has(asset.routeId))routeGuards.set(asset.routeId,JSON.stringify(routeTemplates[asset.routeId]||null));
      return {id:asset.id,guard:simulationAssetGuard(asset,false)};
    });
    const contextGuard=simulationContextGuard();
    const competitorSeeds=(competitorAssets||[]).map(a=>({guard:JSON.stringify(a),snapshot:{...a}}));
    const records=[],journal=makeSimulationEffects(),speed=Number(meta.speed)||state.speed;
    const simMeta={speed,from:Number(meta.from)||state.simSeconds,to:Number(meta.to)||(state.simSeconds+sliceSeconds),infiniteMoney:!!(state.godMoney&&state.infiniteMoney)};
    const boundary=meta.boundary||{};
    let assetCursor=0,competitorCursor=0,finished=false,cancelled=false;
    return {
      runChunk(maxItems,budget={}){
        if(cancelled)return true;
        let count=0;const deadline=Number(budget.deadline),withinBudget=()=>count===0||!Number.isFinite(deadline)||performance.now()<deadline;
        while(assetCursor<assetSeeds.length&&count<maxItems&&withinBudget()){
          const seed=assetSeeds[assetCursor++];let draft=simulationAssetSnapshot(seed,seed.guard),effects=makeSimulationEffects();
          try{processAssetDraft(draft,sliceSeconds,effects,simMeta);}
          catch(error){
            // Discard every partial operational/financial effect before isolating
            // this asset. Only its fault marker and notification may be committed.
            draft=simulationAssetSnapshot(seed,seed.guard);effects=makeSimulationEffects();
            draft.simulationFault={code:'ASSET_SIMULATION_ISOLATED',at:simMeta.from,detail:String(error?.message||error).slice(0,180)};draft.crewBlocked=true;
            effects.alerts.push(`${draft.name||draft.id}: عُزل خلل هذا الأصل وحده وبقيت بقية الشركات والمحاكاة عاملة. أعد تعيين مساره أو نفّذ صيانته لإعادة الفحص.`);
          }
          records.push({id:seed.id,guard:seed.guard,draft,effects});count++;
        }
        while(assetCursor>=assetSeeds.length&&competitorCursor<competitorSeeds.length&&count<maxItems&&withinBudget()){
          const seed=competitorSeeds[competitorCursor++],a={...seed.snapshot},d=routeDistance(a.route),trip=d/a.speed*3600;
          if(Number.isFinite(trip)&&trip>0)a.progress=(a.progress+sliceSeconds/trip)%1;
          seed.draft=a;count++;
        }
        finished=assetCursor>=assetSeeds.length&&competitorCursor>=competitorSeeds.length;return finished;
      },
      finish(info={}){
        if(cancelled||!finished)return {committed:false,reason:'job-not-finished'};
        // Validation and application are synchronous inside the same transaction;
        // build one authoritative index and validate each input exactly once.
        let outcome,commitAssets;
        const hasBoundary=(boundary.day!==null&&boundary.day!==undefined)||(boundary.hour!==null&&boundary.hour!==undefined);
        // Query the delivery owner immediately before the synchronous transaction.
        // JavaScript cannot interleave a purchase between this probe and execute().
        // Boundaries still use full-state rollback; pending delivery slices keep the
        // original broad scope because delivery may mutate Fleet/HR/Realism atomically.
        const deliveryWorkPending=hasBoundary?true:(window.GH_REALISM?.hasPendingDeliveries?.(state)!==false);
        const declaredWriteRoots=hasBoundary?null:(deliveryWorkPending?SIMULATION_TRANSACTION_SCOPE:SIMULATION_STEADY_TRANSACTION_SCOPE),writeAudit=globalThis.__GH_BUILD339_WRITE_AUDIT__===true;
        outcome=tx.execute(state,{
            label:`simulation:${simMeta.from}->${simMeta.to}`,
            // Ordinary slices mutate a bounded domain. Hour/day callbacks can touch many
            // business systems, so boundaries deliberately retain full-state rollback.
            scope:declaredWriteRoots,
            // Build 339 architecture audit is opt-in and runtime-only. When enabled it
            // proves actual root writes against this declaration before we replace rollback storage.
            writeRoots:declaredWriteRoots,
            auditWrites:writeAudit,
            validate:()=>{
              if(cancelled)return {ok:false,reason:'cancelled-before-commit'};
              if(Number(state.simSeconds)!==Number(simMeta.from))return {ok:false,reason:'time-conflict'};
              commitAssets=new Map((state.assets||[]).map(asset=>[asset.id,asset]));
              if((state.assets?.length||0)!==assetSeeds.length||commitAssets.size!==assetSeeds.length||records.some(rec=>simulationAssetGuard(commitAssets.get(rec.id),false)!==rec.guard))return {ok:false,reason:'asset-conflict'};
              for(const [routeId,guard] of routeGuards)if(JSON.stringify(routeTemplates[routeId]||null)!==guard)return {ok:false,reason:'route-conflict'};
              if(simulationContextGuard()!==contextGuard)return {ok:false,reason:'simulation-context-conflict'};
              if(competitorAssets.length!==competitorSeeds.length||competitorSeeds.some((seed,i)=>JSON.stringify(competitorAssets[i])!==seed.guard))return {ok:false,reason:'competitor-conflict'};
              return {ok:true};
            },
            apply:()=>{
              state.simSeconds=simMeta.to;
              for(const rec of records){
                const current=commitAssets.get(rec.id);
                if(!current)throw new Error(`Atomic asset disappeared during commit: ${rec.id}`);
                for(const field of SIMULATION_ASSET_FIELDS){const value=rec.draft[field];current[field]=value&&typeof value==='object'?clone(value):value;}
                if(rec.draft.simulationFault?.code==='ASSET_SIMULATION_ISOLATED'&&rec.draft.simulationFault.at===simMeta.from)diag('ASSET_SIMULATION_ISOLATED',{assetId:rec.id,reason:rec.draft.simulationFault.detail});
                mergeSimulationEffects(journal,rec.effects);
              }
              for(const routeId of new Set(journal.retiredRouteIds))if(!state.assets.some(asset=>asset.routeId===routeId)&&(state.customRoutes||[]).some(route=>route.id===routeId))window.GH_ROUTE_CORE.execute({state},'delete',{id:routeId});
              for(let i=0;i<competitorAssets.length;i++)competitorAssets[i].progress=competitorSeeds[i].draft.progress;
              window.GH_FINANCE_CORE.execute({state},'apply-simulation-journal',{journal});
              window.GH_CORPORATE_CORE.execute({state},'adjust-group-value',{delta:Number(journal.groupValue)||0});
              for(const text of journal.alerts)window.GH_OPERATIONS_CORE.execute({state},'record-alert',{text,type:'simulation'});
              // Delivery cadence is slice-based, not day-based. This keeps procurement responsive under ×1…×4
              // while remaining inside the same atomic transaction as time and asset state.
              if(deliveryWorkPending&&window.GH_REALISM?.onSimulationTime)window.GH_REALISM.onSimulationTime(state,simMeta.to);
              window.GH_MOBILITY_CORE?.onSimulationTime?.({state},simMeta.to);

              // Boundary work is inside the SAME transaction as assets and time. A failure rolls all of it back.
              // Midnight closes the financial day first, then the hourly market checkpoint at the same timestamp.
              if(boundary.day!==null&&boundary.day!==undefined)processFinancialDay(boundary.day);
              if(boundary.hour!==null&&boundary.hour!==undefined)processMarket(boundary.hour);

              state.simulationKernel=state.simulationKernel||{};
              state.simulationKernel.lastAtomicCommit={from:simMeta.from,to:simMeta.to,assets:records.length,day:boundary.day??null,hour:boundary.hour??null,at:state.simSeconds,core:'2.4.1'};
              return true;
            }
          });
        if(!outcome.committed)return {committed:false,retry:true,reason:outcome.reason||'transaction-rejected'};
        for(const routeId of new Set(journal.retiredRouteIds))if(!BASE_ROUTE_IDS.has(routeId)&&!(state.customRoutes||[]).some(route=>route.id===routeId))delete routeTemplates[routeId];
        for(const id of new Set(journal.saleIds))queueAssetSaleFinalize(id);
        return {committed:true,boundary:{day:boundary.day??null,hour:boundary.hour??null}};
      },
      cancel(info={}){
        cancelled=true;records.length=0;journal.alerts.length=0;journal.saleIds.length=0;journal.retiredRouteIds.length=0;
        state.simulationKernel=state.simulationKernel||{};
        state.simulationKernel.lastAtomicCancel={reason:info.reason||'cancelled',from:simMeta.from,to:simMeta.to,at:state.simSeconds};
      }
    };
  }

  if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core compatibility check failed before app.js');
  if(!window.GH_SIMULATION_CORE?.create)throw new Error('Simulation Core failed to load before app.js');
  let lastRealtimeHealthMs=0,lastUiRefreshMs=0;
  const REALTIME_HEALTH_MS=10000;
  const GLOBAL_HALT_IDS=Object.freeze(['CONTROL_JOURNAL_CHAIN_BREAK','CONTROL_JOURNAL_HASH_MISMATCH','CONTROL_JOURNAL_HEAD_MISMATCH','SAVE_SCHEMA_INTEGRITY','TIME_MONOTONICITY','TRANSACTION_ROLLBACK_FAILED','NATIVE_SAVE_RECOVERY_FAILED']);
  function requiresGlobalHalt(...reports){
    const issues=reports.flatMap(report=>Array.isArray(report?.issues)?report.issues:[]);
    return issues.some(issue=>issue?.severity==='critical'&&GLOBAL_HALT_IDS.some(id=>String(issue.id||issue.code||'').startsWith(id)));
  }
  let runtimeGovernor={level:'green',avgChunkMs:0,avgWorkMs:0};
  const simulationEngine=window.GH_SIMULATION_CORE.create({
    getSpeed:()=>effectiveSimulationRate(state.speed),
    setSpeed:(value,meta)=>{
      state.speed=simulationLevelForRate(value);
      if(['watchdog','conflict-watchdog','governor-red'].includes(meta?.reason)){
        document.querySelectorAll('#speedMenu button[data-speed]').forEach(b=>b.classList.toggle('active',Number(b.dataset.speed)===1));
        if($('speedLabel'))$('speedLabel').textContent=SPEED_LABEL_BY_LEVEL[1];
        pushAlert(meta.reason==='conflict-watchdog'?'خفض محرك الحماية السرعة إلى المستوى العادي بسبب تعارضات متكررة. لم يُنفذ أي Commit جزئي.':meta.reason==='governor-red'?'خفض حاكم الأداء السرعة إلى المستوى العادي لأن متوسط معالجة الشرائح دخل المستوى RED. تم إسقاط backlog بدل مطاردته.':'خفض محرك الحماية السرعة إلى المستوى العادي بسبب حمل معالجة مرتفع. لم تتم إعادة تشغيل زمن متراكم.');
      }
    },
    getSimTime:()=>state.simSeconds,
    setSimTime:value=>{state.simSeconds=value;},
    createSliceJob:createSimulationSliceJob,
    getManualSliceLimit:()=>{
      const limits=[window.GH_REALISM?.simulationSliceLimit?.(state),window.GH_MOBILITY_CORE?.simulationSliceLimit?.(state)].map(Number).filter(value=>Number.isFinite(value)&&value>0);
      return limits.length?Math.min(...limits):3600;
    },
    onMaintenance:hour=>{diag('SIM_MAINTENANCE',{hour});window.GH_CONTROL_PLANE?.appendEvent?.(state,{type:'SIMULATION_MAINTENANCE',domain:'simulation',actor:'simulation-core',correlationId:`SIM-HOUR-${hour}`,detail:{hour}});compactSimulationState(false);const health=window.GH_DIAGNOSTICS.runHealthCheck(state,{appVersion:APP_VERSION,saveSchemaVersion:SAVE_SCHEMA_VERSION,simulation:simulationEngine.snapshot()});const central=window.GH_CONTROL_PLANE?.check?.(state);if(requiresGlobalHalt(health,central)){simulationEngine.cancelAdvance?.('global-halt');state.speed=0;pushAlert('أُوقفت المحاكاة لأن خللًا في سلامة الحفظ أو سجل الأوامر قد يهدد الحالة كاملة. مشكلات القطاعات الأخرى تبقى معزولة داخل قطاعها.');}},
    onRender:({now,speed,jobActive})=>{
      if(now-lastUiRefreshMs>=500){lastUiRefreshMs=now;updateKpis();updateMapStatus();if(selectedAssetId&&!$('assetCard').classList.contains('hidden'))refreshAssetCard(selectedAssetId);}
      try{window.GH_DIAGNOSTICS.recorderSample?.(state,simulationEngine.snapshot(),{nowMs:Date.now(),context:{governor:runtimeGovernor}});}catch(error){console.warn('تعذر أخذ عينة مسجل عطل المحاكاة',error);}
      // Diagnostics may use wall-clock cadence for UI health only. No business decision
      // is executed from this render callback.
      if(!jobActive&&!document.hidden&&!hardResetInProgress){
        const now=performance.now();
        if(now-lastMobilityStreetHydrationMs>=1200){lastMobilityStreetHydrationMs=now;void hydrateMobilityStreetRoutes();}
        if(now-lastRealtimeHealthMs>=REALTIME_HEALTH_MS){lastRealtimeHealthMs=now;try{const beforeEvents=state.diagnostics?.events?.length||0;window.GH_DIAGNOSTICS.runHealthCheck(state,{appVersion:APP_VERSION,saveSchemaVersion:SAVE_SCHEMA_VERSION,simulation:simulationEngine.snapshot()},{recordEvent:false,trackTransitions:true});const afterEvents=state.diagnostics?.events?.length||0;if(afterEvents!==beforeEvents)save();if(activeDrawerPanel==='diagnostics')openDrawer('diagnostics');}catch(error){console.warn('تعذر تحديث صحة النظام الدوري',error);}}
      }
    },
    onPersist:()=>scheduleSimulationPersistence(),
    onAdvance:detail=>{
      const active=!!detail?.active;updateDayStepControl();if(!active)renderSimulationCalendar();
      if(detail?.failed){
        const reason=String(detail.reason||'manual-advance-failed');
        state.simulationKernel=state.simulationKernel||{};state.simulationKernel.lastAdvanceFailure={reason,stage:String(detail.stage||''),from:Number(detail.from)||state.simSeconds,to:Number(detail.to)||state.simSeconds,at:state.simSeconds,retries:Number(detail.retries)||0,error:String(detail.error||'').slice(0,240)};
        diag('SIM_CALENDAR_ADVANCE_FAILED',state.simulationKernel.lastAdvanceFailure,'warning');
        window.GH_DIAGNOSTICS.recorderEvent?.(state,'CALENDAR_ADVANCE_FAILED',state.simulationKernel.lastAdvanceFailure,'warning',{nowMs:Date.now()});
        pushAlert(`توقف تقديم التاريخ وقائيًا عند آخر حالة معتمدة (${formatSimDate()}). السبب: ${reason}. لم تُعتمد حركة أصل أو إيراد جزئي.`);
      }
    },
    isSuspended:()=>hardResetInProgress,
    onFatal:error=>{simulationEngine.cancelAdvance?.('simulation-fatal');state.speed=0;diag('SIM_FATAL',{message:String(error?.message||error)});console.error('Simulation Core fatal error',error);try{pushAlert('أوقف محرك المحاكاة الوقت لحماية الحفظ بعد خطأ داخلي.');}catch(alertError){console.error('تعذر تسجيل تنبيه خطأ المحاكاة',alertError);}},
    onWarning:({stage,error})=>{diag('SIM_WARNING',{stage,message:String(error?.message||error)});console.warn(`Simulation Core warning [${stage}]`,error);},
    onThrottle:({took,reason,stage})=>{diag('SIM_THROTTLE',{took,reason,stage});console.warn(`Simulation watchdog throttled after ${Math.round(took)}ms ${stage||'work'} stage`);},
    onGovernor:({level,avgChunkMs,avgWorkMs,stage,took})=>{diag('SIM_GOVERNOR',{level,avgChunkMs,avgWorkMs,stage,took});runtimeGovernor={level,avgChunkMs,avgWorkMs,stage,took};}
  },{minRealSliceSeconds:1,allowedSpeeds:[0,30,120,300,600],fallbackSpeed:30,frameBudgetMs:4,manualFrameBudgetMs:10,chunkItems:32,manualChunkItems:64,renderEveryNormalMs:260,renderEveryFastMs:650,persistEveryNormalMs:20000,persistEveryFastMs:45000,maintenanceEveryHours:12,manualBatchSeconds:3600,manualMinBatchSeconds:300,manualRetryLimit:3});
  window.GH_SIM_KERNEL={version:window.GH_SIMULATION_CORE.VERSION,transactionVersion:window.GH_TRANSACTION_CORE.VERSION,snapshot:()=>simulationEngine.snapshot(),health:()=>simulationEngine.health()};
  window.GH_DIAGNOSTICS.installGlobalHandlers(()=>state,()=>({appVersion:APP_VERSION,simulation:simulationEngine.snapshot()}));
  window.GH_CONTROL_PLANE?.installDOMObserver?.(()=>state);
  diag('DIAGNOSTICS_READY',{version:window.GH_DIAGNOSTICS.VERSION});
  window.GH_CONTROL_PLANE?.appendEvent?.(state,{type:'RUNTIME_READY',domain:'control',detail:{appVersion:APP_VERSION,simulationCore:window.GH_SIMULATION_CORE.VERSION,transactionCore:window.GH_TRANSACTION_CORE.VERSION}});
  if($('runtimeBuildBadge'))$('runtimeBuildBadge').textContent=`BUILD${RUNTIME_BUILD} · v${APP_VERSION}`;
  document.addEventListener('visibilitychange',()=>{diag(document.hidden?'WEBKIT_HIDDEN':'WEBKIT_VISIBLE');simulationEngine.setHidden(document.hidden);if(!document.hidden){requestVisualResync();updateMarkerPositions(true);}},{passive:true});
  let savePressureNoticeShown=false;
  window.addEventListener('gh-persistence-status',event=>{
    const detail=event.detail||{};
    if(detail.validated)window.GH_CONTROL_PLANE.recordBridge(state,detail.ok?'SAVE_ACK':'SAVE_NACK',detail,detail.ok?'info':'critical');
    if(detail.ok===false&&detail.requiresNativeReconciliation){
      state.speed=0;window.GH_CONTROL_PLANE.incident(state,{fingerprint:'NATIVE_SAVE_ACK_UNCERTAIN',severity:'critical',domain:'save',code:'NATIVE_SAVE_ACK_UNCERTAIN',title:'يلزم توفيق نسخة الحفظ الأصلية',detail:'تعذر تأكيد الحفظ؛ توقفت المحاكاة وتتاح إعادة فتح آخر جيل مكتمل وتصدير سبب العطل.',evidence:detail});
      cancelSimulationPersistence();
      if(!$('nativeSaveReconcile')){
        const box=document.createElement('div');box.id='nativeSaveReconcile';box.setAttribute('role','alertdialog');box.setAttribute('aria-modal','true');
        box.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#f1f4f9;color:#17283f;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;overflow:auto';
        const title=document.createElement('h2');title.textContent='توقف الحفظ مؤقتًا لحماية بياناتك';
        const text=document.createElement('p');text.textContent='لم يصل تأكيد حفظ موثوق. أُوقفت المحاكاة، ولن تُحذف بياناتك أو تبدأ مجموعة جديدة. أعد فتح آخر حفظ مكتمل من المخزن الأصلي.';
        const reason=document.createElement('code');reason.id='nativeSaveReconcileReason';reason.textContent=String(detail.reason||detail.message||'native-save-ack-uncertain').slice(0,300);reason.style.cssText='max-width:100%;overflow-wrap:anywhere;user-select:text;font-size:12px';
        const retry=document.createElement('button');retry.id='nativeSaveReconcileRetry';retry.className='primary-btn';retry.textContent='إعادة فتح آخر حفظ مكتمل';retry.addEventListener('click',()=>{retry.disabled=true;retry.textContent='جارٍ إعادة فتح الحفظ…';try{window.location.reload();}catch(error){retry.disabled=false;retry.textContent='إعادة المحاولة';reason.textContent=String(error.message||error).slice(0,300);}});
        const exportButton=document.createElement('button');exportButton.id='nativeSaveReconcileExport';exportButton.className='secondary-btn';exportButton.textContent='تصدير تقرير العطل';exportButton.addEventListener('click',()=>{try{exportDiagnosticsFile();}catch(error){reason.textContent=String(error.message||error).slice(0,300);}});
        box.append(title,text,reason,retry,exportButton);document.body.appendChild(box);retry.focus();
        // No automatic reload loop. A deliberate retry is gated by the native
        // navigation owner, which obtains one verified snapshot before boot.
      }
    }else if(detail.ok===false&&detail.requiresMemoryRollback){
      const recovered=window.GH_PERSISTENCE.recoverBrowserState(detail.storageKey||storageKey);
      if(recovered.ok){replaceLiveState(recovered.state);window.GH_PERSISTENCE.acknowledgeRecovery();window.GH_CONTROL_PLANE.incident(state,{fingerprint:'NATIVE_SAVE_COMMIT_RECOVERED',severity:'warning',domain:'save',code:'NATIVE_SAVE_COMMIT_RECOVERED',title:'رُفضت مرآة الحفظ واستُعيدت آخر نسخة مكتملة',detail:String(detail.reason||detail.message||'Native save rejected'),autoManaged:true,evidence:detail});renderMap();updateKpis();if(activeDrawerPanel)openDrawer(activeDrawerPanel,activeDrawerArg);}
      else{state.speed=0;window.GH_CONTROL_PLANE.incident(state,{fingerprint:'NATIVE_SAVE_RECOVERY_FAILED',severity:'critical',domain:'save',code:'NATIVE_SAVE_RECOVERY_FAILED',title:'تعذر استرداد آخر حفظ مكتمل',detail:String(recovered.reason||detail.reason||'Recovery failed'),evidence:detail});}
    }else if(detail.ok===false&&(detail.critical||detail.rollbackError)){state.speed=0;window.GH_CONTROL_PLANE.incident(state,{fingerprint:'NATIVE_SAVE_COMMIT_FAILED',severity:'critical',domain:'save',code:'NATIVE_SAVE_COMMIT_FAILED',title:'تعذر تثبيت الحفظ واسترداده',detail:String(detail.reason||detail.message||'Native save rejected'),evidence:detail});}
    if(detail.warning){diag('SAVE_SIZE_PRESSURE',detail,'warning');if(!savePressureNoticeShown){savePressureNoticeShown=true;notice('اقترب الحفظ من حد السعة. يُنصح بتصدير نسخة احتياطية؛ سيوقف النظام أي كتابة تتجاوز الحد الآمن.');}}
  });
  window.addEventListener('gh-native-recovery',()=>{state.speed=0;diag('WEBKIT_PROCESS_RECOVERY',{source:'native-save-vault'});window.GH_CONTROL_PLANE?.recordBridge?.(state,'WEBKIT_RECOVERY',{source:'native-save-vault'},'warning');pushAlert('تم استرداد آخر حفظ Native مكتمل بعد إعادة تشغيل محرك WebKit. المحاكاة متوقفة مؤقتًا للمراجعة.');save();});
  window.addEventListener('gh-update-lifecycle',event=>{const detail=event.detail||{},phase=String(detail.phase||'LIFECYCLE'),severity=['BOOT_CONFIRM_FAILED','FAILED'].includes(phase)?'critical':['ROLLBACK_STARTED','ROLLED_BACK'].includes(phase)?'warning':'info';diag(`UPDATE_${phase}`,detail,severity);window.GH_CONTROL_PLANE?.recordBridge?.(state,`UPDATE_${phase}`,detail,severity);if(severity==='critical')window.GH_CONTROL_PLANE?.incident?.(state,{fingerprint:`UPDATE:${phase}`,severity:'critical',domain:'update',code:`UPDATE_${phase}`,title:'خلل في دورة التحديث',detail:String(detail.message||detail.reason||phase||'Update lifecycle failure'),evidence:detail});save();});


  function assetStatus(asset){
    if(asset.phase==='idle')return 'متوقف — بانتظار تعيين مسار';
    if(asset.phase==='turnaround'&&asset.departureScheduled)return 'مجدول للمغادرة ضمن دفعة الأسطول';
    if(asset.phase==='turnaround')return asset.type==='air'?'دوران وتجهيز بالمطار':asset.type==='sea'?'مناولة بالميناء':'تحميل/راحة وتشغيل';
    return asset.type==='air'?'في الجو':asset.type==='sea'?'في البحر':'على الطريق';
  }
  function refreshAssetCard(id){
    const source=state.assets.find(x=>x.id===id);if(!source)return;const a=normalizedAssetView(source),tpl=routeTemplates[a.routeId];
    $('assetIcon').textContent=a.icon||assetIcon(a.type); $('assetName').textContent=a.name; $('assetCompany').textContent=a.company;
    $('assetRoute').textContent=tpl?`${a.from} ← ${a.to} · ${fmtNumber(tpl.distanceKm)} كم`:`${a.model||typeName(a.type)} · متوقف في القاعدة`;
    $('assetStatus').textContent=assetStatus(a);
    if(a.phase==='moving'&&tpl){
      const remaining=(1-a.progress)*(a.tripSeconds||tpl.tripSeconds);
      $('assetEta').textContent=formatDuration(remaining); $('assetDistance').textContent=`${fmtNumber((1-a.progress)*tpl.distanceKm)} كم`;
      $('assetSpeed').textContent=a.type==='sea'?`${(tpl.effectiveSpeedKmh/1.852).toFixed(1)} عقدة`:`${fmtNumber(tpl.effectiveSpeedKmh)} كم/س`;
    }else if(a.phase==='turnaround'){
      $('assetEta').textContent=formatDuration(a.dwellRemaining||0); $('assetDistance').textContent='0 كم'; $('assetSpeed').textContent='متوقف';
    }else{
      $('assetEta').textContent='—'; $('assetDistance').textContent='—'; $('assetSpeed').textContent='—';
    }
    $('assetFuel').textContent=`${Math.round(a.fuel)}%`; $('assetLoad').textContent=a.routeId?loadLabel(a):'بدون حمولة';
    $('assetMargin').textContent=a.lastTrip?fmtMoney(a.lastTrip.margin):'—';
  }
  function showAsset(id){ selectedMobilityId=null; selectedAssetId=id; refreshAssetCard(id); $('assetCard').classList.remove('hidden'); closeMapPopovers(); renderMap(); }

  function findFacility(id){ return getDynamicFacilities().find(f=>f.id===id) || expansionSites.find(f=>f.id===id); }
  function shipCountsForPorts(ports){
    const idsByCity=new Map(),portIds=new Set(),counts=new Map();for(const port of ports){portIds.add(port.id);const city=String(port.city||'');if(!city)continue;const ids=idsByCity.get(city);if(ids)ids.push(port.id);else idsByCity.set(city,[port.id]);}
    for(const asset of state.assets||[]){if(asset.type!=='sea')continue;const matched=new Set();if(asset.phase==='turnaround')for(const city of new Set([asset.to,asset.from].filter(Boolean)))for(const id of idsByCity.get(String(city))||[])matched.add(id);if(!asset.routeId&&portIds.has(asset.baseFacility))matched.add(asset.baseFacility);for(const id of matched)counts.set(id,(counts.get(id)||0)+1);}return counts;
  }
  function planesAtAirport(f){ return state.assets.filter(a=>a.type==='air' && ((a.phase==='turnaround'&&(a.to===f.city||a.from===f.city)) || (a.baseFacility===f.id && !a.routeId))).length; }
  function openFacility(id){
    const f=findFacility(id); if(!f)return;
    if(f.owned){openDrawer('facilityManage',{id:f.id,tab:'command'});return;}
    openDrawerContent('البنية التحتية',f.name,`
      <article class="list-item">
        ${f.photo?`<div class="asset-thumb"><img src="${f.photo}" alt="${f.name}" loading="lazy"></div>`:''}
        <div class="list-item-head"><div><h3>${f.icon||'🏢'} ${f.name}</h3><p>${f.city} · ${f.country}${f.code?` · ${f.code}`:''}${f.iata?` · ${f.iata}/${f.icao}`:''}</p></div><span class="tag">${f.owned?'تابع للمجموعة':'بنية عامة'}</span></div>
        <p>${f.detail||''}</p>
      </article>
      ${f.kind==='airport'?airportOperationalCard(f):''}${f.kind==='port'?portOperationalCard(f):''}${['depot','logistics'].includes(f.kind)?depotOperationalCard(f):''}${['airport-base','port-base'].includes(f.kind)?globalBaseOperationalCard(f):''}
    `);
  }
  function facilityKind(k){return {hq:'مقر رئيسي',airport:'مطار',port:'ميناء',depot:'مركز تشغيل',logistics:'شركة لوجستية','mobility-center':'مركز تنقل حضري',power:'محطة طاقة',bank:'فرع بنك',office:'مقر إقليمي',acquired:'شركة مستحوذ عليها','airport-base':'قاعدة طيران','port-base':'قاعدة بحرية'}[k]||'منشأة';}
  function airportOperationalCard(f){
    return `<article class="list-item"><h3>الملف التشغيلي للمطار</h3>
      <div class="metric-row"><div><span>طول المدرج</span><b>${fmtNumber(f.runwayM)} م</b></div><div><span>الارتفاع</span><b>${fmtNumber(f.elevationM)} م</b></div><div><span>البوابات</span><b>${f.gates}</b></div></div>
      <div class="metric-row"><div><span>رسوم الهبوط</span><b>$${f.landingFeePerTon}/طن</b></div><div><span>Jet A-1</span><b>$${f.jetA1Price}/كغم</b></div><div><span>الازدحام</span><b>${Math.round(f.congestion*100)}%</b></div></div>
      <div class="metric-row two"><div><span>طائراتنا هنا الآن</span><b>${planesAtAirport(f)}</b></div><div><span>IATA/ICAO</span><b>${f.iata}/${f.icao}</b></div></div>
    </article>`;
  }
  function portOperationalCard(f){
    return `<article class="list-item"><h3>الملف التشغيلي للميناء</h3>
      <table class="port-table"><tbody>
        <tr><td>🟨 تخزين جاف</td><td>${fmtNumber(f.dryStorageTEU)} TEU</td></tr>
        <tr><td>🟥 منافذ تبريد</td><td>${fmtNumber(f.reeferPlugs)} Reefer</td></tr>
        <tr><td>🟩 خزين نفط خام</td><td>${fmtNumber(f.crudeStorageBbl)} برميل</td></tr>
        <tr><td>🔵 وقود تزويد</td><td>${fmtNumber(f.fuelBunkerBbl)} برميل</td></tr>
      </tbody></table>
      <div class="metric-row"><div><span>الأرصفة</span><b>${f.berths}</b></div><div><span>الغاطس الأقصى</span><b>${f.maxDraftM} م</b></div><div><span>الرافعات</span><b>${f.craneCount}</b></div></div>
      <div class="metric-row two"><div><span>سفننا هنا الآن</span><b>${shipCountsForPorts([f]).get(f.id)||0}</b></div><div><span>الرمز</span><b>${f.code}</b></div></div>
    </article>`;
  }
  function depotOperationalCard(f){return `<article class="list-item"><h3>مركز النقل البري</h3><p>المقر الإداري منفصل عن الـDepot. هنا تتم إدارة السائقين، المواقف، الصيانة، الوقود وتحضير الرحلات البرية.</p><div class="metric-row"><div><span>مواقف الشاحنات</span><b>${f.bays||'—'}</b></div><div><span>الصيانة</span><b>متاحة</b></div><div><span>السائقون</span><b>سوق عمل</b></div></div></article>`;}
  function globalBaseOperationalCard(f){return `<article class="list-item"><h3>ملف القاعدة العالمية</h3><div class="metric-row"><div><span>رمز المنشأة</span><b>${f.code||f.iata||'—'}</b></div><div><span>تشغيل يومي</span><b>${fmtMoney(f.dailyCost||0)}</b></div><div><span>الاستثمار</span><b>${fmtMoney(f.cost||0)}</b></div></div><p>يمكن اختيار هذه القاعدة عند شراء أصل جديد، كما تظهر كنقطة انطلاق/وصول عند إنشاء شبكة تشغيل متوافقة.</p></article>`;}

  let worldQuery='',worldKind='all',worldCountry='',worldCity='',worldPage=0,worldDirectoryIntent={},worldSearchTimer=null,globalRouteQuery='',directoryIndex=null,drawerSearchRevision=0;
  function cancelDrawerSearch(){if(worldSearchTimer!==null)clearTimeout(worldSearchTimer);worldSearchTimer=null;drawerSearchRevision++;}
  function scheduleDrawerSearch(panel,apply,delay=180){cancelDrawerSearch();const revision=drawerSearchRevision;worldSearchTimer=setTimeout(()=>{worldSearchTimer=null;if(revision===drawerSearchRevision&&activeDrawerPanel===panel&&$('drawer').getAttribute('aria-hidden')==='false')apply();},delay);}
  function directoryCompanyRows(target=state){return COMPANY_PLATFORM.listInstances(target,{includeGroup:false}).filter(company=>company.definition?.facilities?.directoryProviderIds?.length).map(company=>{const identity=COMPANY_PLATFORM.resolveIdentity(target,company.id),providers=company.definition.facilities.directoryProviderIds;return {id:company.id,opened:company.opened,operational:company.operational,code:identity?.shortName||company.definition.identity?.short||company.id,label:identity?.tradeName||identity?.legalName||company.id,providers:[...providers],kind:company.definition.facilities.primaryKind};});}
  const isDirectoryCompany=(value,target=state)=>directoryCompanyRows(target).some(company=>company.id===String(value||''));
  function setDirectoryCompany(kind,intent={}){cancelDrawerSearch();worldKind=isDirectoryCompany(kind)?String(kind):'all';worldCountry='';worldCity='';worldPage=0;worldQuery='';worldDirectoryIntent=worldKind==='power'?{energyKind:ENERGY_PROJECTS[intent.energyKind]?intent.energyKind:'solar'}:{};}
  function openWorldDirectory(kind='all',intent={}){setDirectoryCompany(kind,intent);openDrawer('network');$('drawerBody').scrollTop=0;}
  function facilityDirectoryIndex(){if(!directoryIndex)directoryIndex=window.GH_DIRECTORY_CORE.create({airports:WORLD.airports,ports:WORLD.ports,capitals:window.GH_MOBILITY_CORE.CAPITALS});return directoryIndex;}
  const featuredAirportCodes=['OERK','OMDB','EGLL','WSSS','KJFK','KLAX','EDDF','LFPG','RJTT','VHHH','YSSY','SBGR','FAOR','VIDP','ZBAA','CYYZ','HECA','LTFM'];
  const featuredPortCodes=['SAJED','SGSIN','NLRTM','USNYC','CNSHA','CNSZX','DEHAM','BEANR','AEJEA','KRPUS','MYPKG','BRSSZ','ESVLC','GBFXT','JPTYO'];
  // Compatibility values for the six Build 332 definitions.  Future manifests
  // provide the same fields through definition.facilities.siteTemplate (or
  // config/template aliases) and require no app switch or new UI code.
  const LEGACY_FACILITY_SITE_TEMPLATES=Object.freeze({
    road:{label:'مركز لوجستي',cost:8500000,dailyCost:12500,capacity:'42 موقفًا · حتى 140 شاحنة',deliveryCapacity:140,photo:PHOTOS.facility_logistics},
    power:{label:'محطة طاقة',cost:82000000,dailyCost:38000,capacity:'مشروع شمسي 100MW كبداية',photo:PHOTOS.facility_power},
    bank:{label:'فرع مصرفي',cost:15000000,dailyCost:18500,capacity:'حسابات وودائع وبطاقات وتمويل أفراد وشركات',photo:PHOTOS.facility_bank},
    mobility:{label:'مركز تنقل حضري',cost:4500000,dailyCost:9800,capacity:'120 سيارة · عاصمة فقط',deliveryCapacity:120,photo:PHOTOS.facility_logistics}
  });
  const ENERGY_PROJECTS=Object.freeze({solar:{cost:82000000,key:'solarMW',amount:100,name:'محطة شمسية 100MW',leadDays:120},wind:{cost:145000000,key:'windMW',amount:120,name:'مزرعة رياح 120MW',leadDays:180},storage:{cost:64000000,key:'storageMWh',amount:500,name:'بطاريات تخزين 500MWh',leadDays:75},gas:{cost:210000000,key:'gasMW',amount:220,name:'محطة غاز مرنة 220MW',leadDays:240}});
  function facilitySiteTemplate(company,target=state){
    const definition=COMPANY_PLATFORM.definitionFor?.(target,company);if(!definition?.facilities?.directoryProviderIds?.includes('world-capitals'))return null;
    const facilities=definition.facilities,provided=facilities.siteTemplate||facilities.config||facilities.template||{},legacy=LEGACY_FACILITY_SITE_TEMPLATES[definition.id]||LEGACY_FACILITY_SITE_TEMPLATES[company]||{},kind=String(provided.facilityKind||provided.kind||facilities.primaryKind||'').trim();if(!kind||!facilities.allowedKinds?.includes(kind))return null;
    const capital=Math.max(1,Number(definition.founding?.defaultCapital)||1),cost=Number(provided.cost??provided.baseCost??legacy.cost??Math.max(1000000,Math.round(capital*.25))),dailyCost=Number(provided.dailyCost??provided.operatingCost??legacy.dailyCost??Math.max(1000,Math.round(cost/2200))),capacity=String(provided.capacityLabel||provided.capacity||legacy.capacity||'قدرة تشغيلية تحددها إدارة المنشأة'),label=String(provided.label||provided.name||legacy.label||facilityKind(kind)),deliveryCapacity=Math.max(0,Math.floor(Number(provided.deliveryCapacity??legacy.deliveryCapacity)||0)),photo=String(provided.photo||provided.photoPath||legacy.photo||definition.identity?.hero||PHOTOS.facility_hq),iconCandidate=String(provided.iconKey||provided.icon||definition.map?.markerProfileId||kind),iconKey=Object.prototype.hasOwnProperty.call(FACILITY_SVG,iconCandidate)?iconCandidate:facilityKindKey(kind),groupValueFactor=Math.max(0,Math.min(1,Number(provided.groupValueFactor??.72)));
    if(!Number.isFinite(cost)||cost<=0||!Number.isFinite(dailyCost)||dailyCost<0)return null;
    return Object.freeze({definitionId:definition.definitionId,definitionVersion:definition.definitionVersion,kind,label,cost,dailyCost,capacity,deliveryCapacity,photo,iconKey,groupValueFactor,manager:String(provided.manager||`مدير ${label}`),detail:String(provided.detail||`${label} تابع لـ${COMPANY_PLATFORM.resolveIdentity(target,company)?.legalName||company}.`)});
  }
  function directorySiteEntity(capital,company,options={}){const meta=facilitySiteTemplate(company);if(!capital||!meta)return null;const energyKind=company==='power'&&ENERGY_PROJECTS[options.energyKind||worldDirectoryIntent.energyKind||'solar']?options.energyKind||worldDirectoryIntent.energyKind||'solar':null,energy=energyKind?ENERGY_PROJECTS[energyKind]:null;return {key:`site:${company}:${capital.id}`,kind:'company-site',company,ownerCompanyId:company,capitalId:capital.id,iconKey:meta.iconKey,code:capital.id,name:`${energy?.name||meta.label} · ${capital.city}`,city:capital.city,country:capital.country,coords:[...capital.coords],cost:energy?.cost||meta.cost,dailyCost:meta.dailyCost,capacity:energy?`${energy.amount} ${energy.key==='storageMWh'?'MWh':'MW'} · إنشاء ثم تشغيل تجاري`:meta.capacity,deliveryCapacity:meta.deliveryCapacity,photo:meta.photo,facilityKind:meta.kind,templateDefinitionId:meta.definitionId,templateDefinitionVersion:meta.definitionVersion,energyKind:energyKind||undefined};}
  function canonicalDirectorySite(input,expectedCompany){
    const key=typeof input==='string'?input:String(input?.key||input?.sourceKey||'');
    const entity=worldEntityByKey(key);
    if(!entity||entity.kind!=='company-site'||entity.company!==expectedCompany)return null;
    try{window.GH_FACILITY_CORE.verifyDirectorySite(entity,expectedCompany,state);return entity;}catch(error){nonCritical('directory-site-validation',error);return null;}
  }
  function directorySiteOwned(entity){return getDynamicFacilities().find(f=>f?.owned&&companyOfFacility(f)===entity.company&&(f.sourceKey===entity.key||(f.capitalId===entity.capitalId&&f.kind===entity.facilityKind)));}
  function worldSearchResults(){return facilityDirectoryIndex().search({state,company:worldKind,country:worldCountry,city:worldCity,text:worldQuery,page:worldPage,pageSize:24});}
  function globalBaseFor(key,companyId=null,target=state){return (target.globalBases||[]).find(base=>base.sourceKey===key&&(!companyId||companyOfFacility(base)===companyId));}
  const companyOfFacility=f=>window.GH_HR_CORE.companyOfFacility(f);
  function worldEntityCompanyCandidates(entity,target=state,{operationalOnly=false}={}){
    if(entity?.kind==='company-site')return isDirectoryCompany(entity.company,target)?[entity.company]:[];const provider=entity?.kind==='airport'?'world-airports':entity?.kind==='port'?'world-ports':null;if(!provider)return [];
    return directoryCompanyRows(target).filter(company=>company.providers.includes(provider)&&(!operationalOnly||company.operational)).map(company=>company.id);
  }
  function directoryEntityByKey(key,companyId,target=state){
    const entity=worldEntityByKey(key);if(!entity)return null;if(entity.kind==='company-site')return entity.company===companyId?entity:null;
    companyId=String(companyId||'');if(!worldEntityCompanyCandidates(entity,target).includes(companyId))return null;const definition=COMPANY_PLATFORM.definitionFor(target,companyId),kind=definition?.facilities?.primaryKind;if(!kind||!definition.facilities.allowedKinds.includes(kind))return null;return {...entity,company:companyId,ownerCompanyId:companyId,facilityKind:kind};
  }
  function directoryOffer(entity){
    const company=String(entity?.company||entity?.ownerCompanyId||''),kind=entity?.facilityKind;if(!company||!kind||!worldEntityCompanyCandidates(entity).includes(company))return {company:null,kind:null,daily:0,quote:0};
    const cost=entity.kind==='company-site'?entity.cost:facilityPrice(entity),daily=entity.kind==='company-site'?entity.dailyCost:facilityDailyCost(entity);
    return {company,kind,daily,quote:constructionBid(company,kind,cost,entity.name).winner?.quote||0};
  }
  function worldResultCard(row){
    const sourceKey=row.key,baseEntity=directoryWorldEntity(row),entity=baseEntity?{...baseEntity,company:row.company||row.companyId,ownerCompanyId:row.company||row.companyId,facilityKind:row.facilityKind}:directoryEntityByKey(sourceKey,row.company||row.companyId);if(!entity)return '';
    const {company,kind,daily,quote}=directoryOffer(entity),opened=entity.kind==='company-site'?directorySiteOwned(entity):globalBaseFor(entity.key,company),companyOpen=COMPANY_PLATFORM.resolveCompany(state,company)?.operational===true;
    const account=state.companyFinance?.[company]?.accounts?.[0],gap=Math.max(0,quote-(Number(account?.balance)||0)),capacity=entity.capacity||(company==='air'?'300 طائرة':'120 سفينة');
    const status=opened?'منشأة مملوكة':companyOpen?'متاح للفتح':`أسس ${typeName(company)} أولًا`;
    return `<article class="list-item world-result" data-company="${company}" data-key="${esc(entity.key)}"><div class="list-item-head"><div><h3>${facilityVectorMarkup(entity.iconKey||kind)} ${esc(entity.name)}</h3><p>${esc(row.country)} · ${esc(row.city)} · ${esc(entity.code)}</p></div><span class="tag ${opened?'positive':''}">${esc(facilityKind(kind))}</span></div>
      <div class="directory-scope"><b>${esc(companyFinanceName(company))}</b><span>${esc(typeName(company))} · ${esc(status)}</span></div>
      <div class="metric-row"><div><span>${opened?'قيمة الإنشاء المسجلة':'قيمة عقد الإنشاء'}</span><b>${fmtNumber(opened?.cost??quote)} USD</b></div><div><span>${company==='power'?'تشغيل يومي بعد الإنجاز':'تشغيل يومي'}</span><b>${fmtMoney(daily)}</b></div><div><span>القدرة</span><b>${esc(capacity)}</b></div></div>
      <p class="directory-payment">الحساب الجاري: ${esc(companyFinanceName(company))} · <bdi>${esc(account?.id||'غير متاح')}</bdi>${!opened&&companyOpen&&gap>0?`<br>تمويل مطلوب من القابضة: ${fmtNumber(gap)} USD، ثم يُخصم العقد من حساب الشركة.`:''}</p>
      <div class="action-row">${opened?`<button class="primary-btn" data-open="facilityManage" data-arg="${esc(opened.id)}">إدارة المنشأة</button>`:`<button class="primary-btn open-directory-site" data-key="${esc(entity.key)}" data-company="${company}" data-energy-kind="${entity.energyKind||''}" data-quote="${quote}" ${companyOpen&&quote>0?'':'disabled'}>فتح المنشأة</button>`}<button class="secondary-btn world-focus" data-key="${esc(entity.key)}">عرض الموقع</button><button class="secondary-btn" data-open="companyFacilities" data-arg="${company}">منشآت الشركة</button></div></article>`;
  }
  function renderWorldNetwork(){
    const result=worldSearchResults(),companyChips=directoryCompanyRows();
    const options=(rows,selected)=>rows.map(row=>`<option value="${esc(row.id)}" ${row.id===selected?'selected':''}>${esc(row.label)} (${fmtNumber(row.count)})</option>`).join('');
    const selectedCompany=companyChips.find(row=>row.id===worldKind),airportOnly=Boolean(selectedCompany?.providers.includes('world-airports')&&!selectedCompany.providers.some(provider=>provider!=='world-airports')),scope=worldKind==='all'?'كل الشركات':companyFinanceName(worldKind),coverage=worldKind==='all'?'المواقع العالمية التي تعرّفها كل شركة':selectedCompany?.providers.includes('world-airports')?'المطارات المسجلة':selectedCompany?.providers.includes('world-ports')?'الموانئ المسجلة':selectedCompany?.providers.includes('world-capitals')?'العواصم المعتمدة':'دليل الشركة المسجل';
    return `<div class="list world-directory" data-company="${worldKind}"><article class="list-item registry-hero"><h3>فتح القواعد والمراكز</h3><p>${airportOnly?'اختر الدولة ثم المطار مباشرة؛ البحث يشمل اسم المطار والمدينة وIATA وICAO.':'اختر الشركة، ثم الدولة والمدينة والموقع.'} كل منشأة مرتبطة بشركتها وحسابها الجاري.</p><div class="directory-scope"><b>${esc(scope)}</b><span>المواقع المتاحة: ${coverage}</span></div></article>
      <div class="world-company-strip">${companyChips.map(company=>`<button class="world-company-chip ${worldKind===company.id?'active':''}" data-world-company="${esc(company.id)}" aria-pressed="${worldKind===company.id}"><b>${esc(company.code)}</b><span>${esc(company.label)}</span><small>${company.opened?'شركة مؤسسة':'الشركة غير مؤسسة'}</small></button>`).join('')}</div>
      <div class="directory-filters"><label>الشركة<select id="worldKind"><option value="all" ${worldKind==='all'?'selected':''}>كل الشركات</option>${companyChips.map(company=>`<option value="${esc(company.id)}" ${worldKind===company.id?'selected':''}>${esc(company.label)}</option>`).join('')}</select></label><label>الدولة<select id="worldCountry"><option value="">كل الدول</option>${options(result.countries,worldCountry)}</select></label>${airportOnly?'':`<label>المدينة<select id="worldCity" ${worldCountry?'':'disabled'}><option value="">${worldCountry?'كل المدن':'اختر الدولة أولًا'}</option>${worldCountry?options(result.cities,worldCity):''}</select></label>`}${worldKind==='power'?`<label>نوع المشروع<select id="worldEnergyKind">${Object.entries(ENERGY_PROJECTS).map(([id,item])=>`<option value="${id}" ${worldDirectoryIntent.energyKind===id?'selected':''}>${esc(item.name)}</option>`).join('')}</select></label>`:''}<label class="directory-search-label">بحث في المواقع<input id="worldSearch" value="${esc(worldQuery)}" placeholder="${airportOnly?'اسم المطار أو المدينة أو IATA أو ICAO':'اسم المدينة أو الدولة أو رمز الموقع'}" autocomplete="off"></label></div>
      <div class="directory-pagination"><button class="secondary-btn" data-world-page="${result.page-1}" ${result.page===0?'disabled':''}>السابق</button><span>${fmtNumber(result.total)} موقع · صفحة ${result.pages?result.page+1:0} / ${result.pages}</span><button class="secondary-btn" data-world-page="${result.page+1}" ${result.page+1>=result.pages?'disabled':''}>التالي</button></div>
      <div class="world-results-grid">${result.rows.map(worldResultCard).join('')||'<div class="empty">لا توجد مواقع مطابقة لهذه الخيارات. غيّر الدولة أو المدينة أو البحث.</div>'}</div></div>`;
  }
  function renderWorldNetworkInto(restoreFocus=false){
    if(activeDrawerPanel!=='network'||$('drawer').getAttribute('aria-hidden')==='true')return;
    $('drawerBody').innerHTML=renderWorldNetwork();window.GH_INTERFACE.prepare($('drawerBody'),activeDrawerPanel,activeDrawerArg,advancedContext());bindDrawerActions();
    if(restoreFocus){const input=$('worldSearch');input?.focus();input?.setSelectionRange(input.value.length,input.value.length);}
  }
  function focusWorldEntity(key){
    const entity=worldEntityByKey(key);if(!entity||!map)return;selectedWorldKey=key;setMapFilterSelection(entity.kind==='company-site'?'facility':entity.kind==='airport'?'airport':'port');
    document.querySelectorAll('.filter-btn').forEach(b=>{const selected=b.dataset.filter===state.activeFilter;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});map.setView(entity.coords,entity.kind==='airport'?8:9);renderMap();closeDrawer();
  }
  function showWorldEntity(key){
    const entity=worldEntityByKey(key);if(!entity)return;selectedWorldKey=key;
    const country=facilityDirectoryIndex().countryMetadata(entity.countryCode||entity.country).label,candidates=worldEntityCompanyCandidates(entity).map(company=>directoryEntityByKey(key,company)).filter(Boolean),choices=candidates.map(candidate=>{const offer=directoryOffer(candidate);return `<div class="directory-scope"><b>${esc(companyFinanceName(offer.company))}</b><span>${esc(typeName(offer.company))} · عقد ${fmtNumber(offer.quote)} USD · تشغيل ${fmtMoney(offer.daily)}</span><button class="primary-btn open-facility-directory" data-kind="${esc(offer.company)}">فتح دليل الشركة</button></div>`;}).join('');
    openDrawerContent('الدليل العالمي',entity.name,`<article class="list-item"><h3>${facilityVectorMarkup(entity.iconKey||entity.facilityKind||entity.kind)} ${esc(entity.name)}</h3><p>${esc(entity.city)} · ${esc(country)} · ${esc(entity.code)}</p>${choices||'<p>لا توجد شركة معرفة لهذا النوع من المنشآت.</p>'}<div class="action-row"><button class="secondary-btn world-focus" data-key="${esc(key)}">عرض الموقع</button></div></article>`);
  }
  async function openGlobalBase(key,opts={}){
    const company=String(opts.companyId||''),entity=directoryEntityByKey(key,company);if(!entity||!['airport','port'].includes(entity.kind)){notice('تعذر فتح القاعدة: الموقع أو الشركة المالكة غير معروفين.');return false;}
    const result=await runAuthorizedCompositeCommand(`open-global-base:${company}`,({state:draft,dispatch,recordAlert})=>{const instance=COMPANY_PLATFORM.requireCompany(draft,company,{registered:true,operational:true,capability:'finance.book'}),draftEntity=directoryEntityByKey(key,company,draft);if(!instance||!draftEntity)throw new Error('global-facility-company-invalid');if(globalBaseFor(key,company,draft))throw new Error('facility-already-open');const baseCost=facilityPrice(draftEntity),dailyCost=facilityDailyCost(draftEntity),facilityKind=draftEntity.facilityKind,build=awardConstructionDraft(draft,dispatch,recordAlert,company,facilityKind,`قاعدة ${draftEntity.name}`,baseCost);if(!build||build.insufficient)throw new Error('construction-funding-unavailable');const id=window.GH_DETERMINISM.nextId(draft,'BASE'),air=draftEntity.kind==='airport',airIdentity=air?{iata:String(draftEntity.iata||''),icao:String(draftEntity.icao||''),countryCode:String(draftEntity.countryCode||''),...(Number.isFinite(Number(draftEntity.elevationFt))?{elevationFt:Number(draftEntity.elevationFt)}:{})}:{terminal:Boolean(draftEntity.terminal)},facility={id,sourceKey:key,ownerCompanyId:company,kind:facilityKind,owned:true,deliveryCapacity:air?300:120,photo:air?PHOTOS.facility_airport:PHOTOS.facility_port,name:`قاعدة ${draftEntity.name}`,city:draftEntity.city,country:draftEntity.country,coords:[...draftEntity.coords],code:draftEntity.code,...airIdentity,cost:build.amount,dailyCost,capacity:air?'300 طائرة · تشغيل جوي وشحن':'120 سفينة · تشغيل بحري ولوجستي',contractor:build.contractor,constructionContractId:build.id,detail:`قاعدة عالمية تابعة لـ${COMPANY_PLATFORM.resolveIdentity(draft,company)?.legalName||company} في ${draftEntity.name}.`};const created=dispatch('facilities','create',{facility,bucket:'globalBases',groupValueAdd:build.amount*.76}).result;if(!created||created.ownerCompanyId!==company)throw new Error('facility-owner-mismatch');ensureFacilityWorkforceDraft(draft,dispatch,company,'فتح قاعدة جديدة');recordAlert(`افتتحت ${facility.name} بعقد ${build.id} وربطت وجهة التسليم والموارد البشرية بالشركة المالكة.`,'facility');return {id};},{silent:Boolean(opts.silent),afterCommit:({id})=>{updateKpis();renderMap();panMapTo(entity.coords,6);if(!opts.silent)openFacility(id);}});return Boolean(result);
  }
  async function openLogisticsHub(site,opts={}){
    site=canonicalDirectorySite(site,'road');if(!site){notice('اختر موقع المركز من الدليل العالمي.');return false;}const coords=[...site.coords],place={city:site.city,country:site.country,label:site.city};
    const result=await runAuthorizedCompositeCommand('open-logistics-hub',({state:draft,dispatch,recordAlert})=>{if(!draft.openedCompanies.includes('road'))throw new Error('company-not-open');if(dynamicFacilitiesFor(draft).some(f=>f.sourceKey===site.key))throw new Error('facility-already-open');const baseCost=8500000,dailyCost=12500,name=logisticsCenterName(place),build=awardConstructionDraft(draft,dispatch,recordAlert,'road','logistics',name,baseCost);if(!build||build.insufficient)throw new Error('construction-funding-unavailable');const id=window.GH_DETERMINISM.nextId(draft,'HUB'),facility={id,sourceKey:site.key,capitalId:site.capitalId,company:'road',ownerCompanyId:'road',kind:'logistics',owned:true,deliveryCapacity:140,icon:'🚚',photo:PHOTOS.facility_logistics,name,city:place.city,country:place.country,coords,bays:42,dailyCost,cost:build.amount,contractor:build.contractor,constructionContractId:build.id,detail:'مركز لوجستي أنشئ عبر المشتريات المعتمدة.',capacity:'140 شاحنة',manager:'مدير المركز اللوجستي',tasks:[{id:window.GH_DETERMINISM.nextId(draft,'TASK'),title:'تجهيز أرصفة التحميل وتعيين فريق التشغيل الأول',status:'قيد التنفيذ',createdAt:draft.simSeconds||0}]};dispatch('facilities','create',{facility,bucket:'customHubs',groupValueAdd:build.amount*.72});ensureFacilityWorkforceDraft(draft,dispatch,'road','فتح مركز لوجستي');recordAlert(`افتتح ${name} وربط بـHR والتشغيل.`,'facility');return {id};},{silent:Boolean(opts.silent),afterCommit:({id})=>{updateKpis();renderMap();panMapTo(coords,6);if(!opts.silent)openFacility(id);}});return Boolean(result);
  }
  function mobilityCapital(id){return (window.GH_MOBILITY_CORE?.CAPITALS||[]).find(c=>c.id===String(id||''))||null;}
  async function openMobilityCapitalCenter(capitalId,opts={}){
      const site=canonicalDirectorySite(`site:mobility:${capitalId}`,'mobility'),capital=site?mobilityCapital(site.capitalId):null;
      if(!site||!capital){if(!opts.silent)notice('اختر عاصمة معتمدة من سجل GH Mobility.');return false;}
      const result=await runAuthorizedCompositeCommand('open-mobility-center',({state:draft,dispatch,recordAlert})=>{if(!draft.openedCompanies.includes('mobility'))throw new Error('company-not-open');if(dynamicFacilitiesFor(draft).some(f=>f.company==='mobility'&&f.kind==='mobility-center'&&f.capitalId===capital.id))throw new Error('facility-already-open');const build=awardConstructionDraft(draft,dispatch,recordAlert,'mobility','mobility-center',`مركز GH Mobility · ${capital.city}`,4500000);if(!build||build.insufficient)throw new Error('construction-funding-unavailable');const id=`MOB-CENTER-${capital.id}`,facility={id,sourceKey:site.key,company:'mobility',ownerCompanyId:'mobility',kind:'mobility-center',owned:true,capitalOnly:true,capitalId:site.capitalId,deliveryCapacity:120,icon:'🚘',photo:PHOTOS.facility_logistics,name:`مركز GH Mobility · ${site.city}`,city:site.city,country:site.country,coords:[...site.coords],bays:120,dailyCost:9800,cost:build.amount,capacity:'تشغيل حضري محلي · 120 سيارة',manager:'مدير مركز التنقل الحضري',contractor:build.contractor,constructionContractId:build.id,detail:`مركز تشغيلي في عاصمة ${site.country}. لا يُسمح بإنشائه خارج العواصم المعتمدة.`,tasks:[{id:window.GH_DETERMINISM.nextId(draft,'TASK'),title:'تجهيز المركز لاستقبال السيارات المشتراة',status:'قيد التنفيذ',createdAt:draft.simSeconds||0}]};dispatch('facilities','create',{facility,bucket:'customHubs',groupValueAdd:build.amount*.72});window.GH_MOBILITY_CORE?.ensure?.(draft);draft.mobility.capitalCenters.unshift({id:facility.id,capitalId:capital.id,city:capital.city,country:capital.country,coords:[...capital.coords],facilityId:facility.id,openedAt:draft.simSeconds||0});ensureFacilityWorkforceDraft(draft,dispatch,'mobility',`فتح مركز عاصمة ${capital.city}`);recordAlert(`افتتح ${facility.name} في العاصمة وربط بالحساب الجاري والموارد البشرية.`,'facility');return {id};},{silent:Boolean(opts.silent),afterCommit:()=>{updateKpis();renderMap();panMapTo(capital.coords,6);if(!opts.silent)openDrawer('companyFacilities',{type:'mobility'});}});return Boolean(result);
  }
  async function openGenericFacilitySite(input,opts={}){
    const company=String(input?.company||''),site=canonicalDirectorySite(input,company),template=facilitySiteTemplate(company);if(!site||!template){if(!opts.silent)notice('تعريف المنشأة أو موقعها غير مكتمل.');return false;}
    const result=await runAuthorizedCompositeCommand(`open-facility:${company}`,({state:draft,dispatch,recordAlert})=>{
      const instance=COMPANY_PLATFORM.requireCompany(draft,company,{registered:true,operational:true,capability:'finance.book'}),draftTemplate=facilitySiteTemplate(company,draft);if(!instance||!draftTemplate)throw new Error('facility-template-unavailable');
      const verified=window.GH_FACILITY_CORE.verifyDirectorySite(site,company,draft);if(dynamicFacilitiesFor(draft).some(f=>companyOfFacility(f)===company&&(f.sourceKey===verified.key||(f.capitalId===verified.capitalId&&f.kind===verified.facilityKind))))throw new Error('facility-already-open');
      const name=`${draftTemplate.label} · ${verified.city}`,build=awardConstructionDraft(draft,dispatch,recordAlert,company,draftTemplate.kind,name,draftTemplate.cost);if(!build||build.insufficient)throw new Error('construction-funding-unavailable');
      const id=window.GH_DETERMINISM.nextId(draft,'FACILITY'),facility={id,sourceKey:verified.key,capitalId:verified.capitalId,ownerCompanyId:company,kind:draftTemplate.kind,owned:true,photo:draftTemplate.photo,name,city:verified.city,country:verified.country,coords:[...verified.coords],dailyCost:draftTemplate.dailyCost,cost:build.amount,capacity:draftTemplate.capacity,manager:draftTemplate.manager,contractor:build.contractor,constructionContractId:build.id,detail:draftTemplate.detail,templateDefinitionId:draftTemplate.definitionId,templateDefinitionVersion:draftTemplate.definitionVersion,tasks:[{id:window.GH_DETERMINISM.nextId(draft,'TASK'),title:`تجهيز ${draftTemplate.label} وبدء خطة التشغيل`,status:'قيد التنفيذ',createdAt:draft.simSeconds||0}]};if(draftTemplate.deliveryCapacity>0)facility.deliveryCapacity=draftTemplate.deliveryCapacity;
      const created=dispatch('facilities','create',{facility,bucket:'customHubs',groupValueAdd:build.amount*draftTemplate.groupValueFactor}).result;if(!created||created.ownerCompanyId!==company)throw new Error('facility-owner-mismatch');ensureFacilityWorkforceDraft(draft,dispatch,company,`فتح ${draftTemplate.label}`);recordAlert(`افتتح ${name} بعقد ${build.id} وربط بدفتر ${COMPANY_PLATFORM.resolveIdentity(draft,company)?.legalName||company} والموارد البشرية.`,`facility`);return {id};
    },{silent:Boolean(opts.silent),afterCommit:({id})=>{updateKpis();renderMap();panMapTo(site.coords,6);if(!opts.silent)openFacility(id);}});return Boolean(result);
  }
  async function openDirectorySite(key,selection={}){
    const requestedCompany=String(selection.company||''),entity=directoryEntityByKey(key,requestedCompany);if(!entity){notice('تعذر قراءة موقع الدليل العالمي أو الشركة المالكة.');return false;}
    const offer=directoryOffer(entity),company=offer.company;
    if(!isCompanyType(company)||(selection.company&&selection.company!==company)||(worldKind!=='all'&&worldKind!==company)){notice('تغير نطاق الشركة؛ اختر الموقع مجددًا من دليلها.');return false;}
    if(!state.openedCompanies.includes(company)){notice(`أسس ${typeName(company)} أولًا قبل شراء المنشأة.`);return false;}
    if((selection.quote!==undefined&&Number(selection.quote)!==offer.quote)||(company==='power'&&selection.energyKind!==undefined&&selection.energyKind!==entity.energyKind)){notice('تغير عرض الإنشاء؛ راجع السعر ونوع المشروع مجددًا.');renderWorldNetworkInto();return false;}
    const opened=entity.kind==='company-site'?directorySiteOwned(entity):globalBaseFor(key,company);if(opened){renderWorldNetworkInto();return false;}
    const opts={silent:true};let result=false;
    if(entity.kind!=='company-site')result=await openGlobalBase(key,{...opts,companyId:company});
    else if(company==='road')result=await openLogisticsHub(entity,opts);
    else if(company==='mobility')result=await openMobilityCapitalCenter(entity.capitalId,opts);
    else if(company==='power')result=await buildEnergy(entity.energyKind||'solar',entity.key,opts);
    else if(company==='bank')result=await openBankBranch(entity.key,opts);
    else result=await openGenericFacilitySite(entity,opts);
    if(result)renderWorldNetworkInto();return result;
  }
  function renderCompanyFacilities(type){
    const company=String(type||'');if(!isCompanyType(company)||!isDirectoryCompany(company))return '<div class="empty">معرف الشركة أو دليل منشآتها غير متاح.</div>';const owned=getDynamicFacilities().filter(f=>f?.owned&&companyOfFacility(f)===company),providers=COMPANY_PLATFORM.definitionFor(state,company)?.facilities?.directoryProviderIds||[],warmStats=directoryIndex?.statsFor(state,company)||null;
    const rows=owned.map(f=>`<article class="facility-compact-row" data-company="${company}"><div><b>${esc(f.name||facilityKind(f.kind))}</b><small>${esc(f.city||'—')} · ${esc(f.country||'—')} · ${esc(facilityKind(f.kind))}</small></div><button class="secondary-btn" data-open="facilityManage" data-arg="${esc(f.id)}">إدارة المنشأة</button></article>`).join('');
    const directorySites=warmStats?.sites??providers.reduce((sum,provider)=>sum+(provider==='world-airports'?Number(WORLD.meta.airportCount)||WORLD.airports.length:provider==='world-ports'?Number(WORLD.meta.portCount)||WORLD.ports.length:provider==='world-capitals'?(window.GH_MOBILITY_CORE?.CAPITALS?.length||0):0),0),directoryType=providers.includes('world-airports')?'مطارات':providers.includes('world-ports')?'موانئ':providers.includes('world-capitals')?'عواصم':'مواقع',coverage=providers.includes('world-airports')?'مواقع من سجل المطارات العالمي.':providers.includes('world-ports')?'مواقع من سجل الموانئ العالمي.':'مواقع في العواصم المعتمدة.';return `<div class="list company-facilities" data-company="${company}"><article class="list-item registry-hero"><h3>قواعد ومراكز ${esc(companyFinanceName(company))}</h3><div class="directory-scope"><b>${esc(typeName(company))}</b><span>الحساب الجاري: <bdi>${esc(state.companyFinance?.[company]?.accounts?.[0]?.id||'غير متاح')}</bdi></span></div><div class="metric-row"><div><span>المنشآت المملوكة</span><b>${owned.length}</b></div><div><span>مواقع الدليل</span><b>${fmtNumber(directorySites)}</b></div><div><span>نوع الدليل</span><b>${esc(directoryType)}</b></div></div><p>${coverage} افتح الدليل عند الحاجة لاختيار الموقع والعقد.</p><div class="action-row"><button class="primary-btn open-facility-directory" data-kind="${company}">فتح منشأة جديدة</button></div></article><div class="section-mini">المنشآت المملوكة لهذه الشركة</div>${rows||'<div class="empty">لا توجد قواعد أو مراكز مملوكة بعد.</div>'}</div>`;
  }
  function worldSearchFieldIncludes(value,query){const text=String(value||'').toLowerCase();if(text.includes(query))return true;for(let index=0;index<text.length;index++)if(text.charCodeAt(index)>127)return normalizeSearch(text).includes(query);return false;}
  function globalRouteResults(type){
    const kind=type==='air'?'airport':'port',query=normalizeSearch(globalRouteQuery),results=[];
    if(!query){
      const codes=kind==='airport'?featuredAirportCodes:featuredPortCodes;
      const featuredRows=kind==='airport'?airportRowsForCodes(codes):portRowsForCodes(codes);for(const row of featuredRows)results.push(kind==='airport'?airportEntity(row):portEntity(row));
      return results.slice(0,24);
    }
    const rows=kind==='airport'?WORLD.airports:WORLD.ports,rawQuery=String(globalRouteQuery||'').trim(),code=rawQuery.toUpperCase(),exact=kind==='airport'?airportRowByCode(code):portRowByCode(code);
    if(exact)return [kind==='airport'?airportEntity(exact):portEntity(exact)];
    const fieldCount=kind==='airport'?6:3;for(const row of rows){let matched=false;for(let index=0;index<fieldCount;index++){if(worldSearchFieldIncludes(row[index],query)){matched=true;break;}}if(matched)results.push(kind==='airport'?airportEntity(row):portEntity(row));if(results.length>=48)break;}
    return results.sort((a,b)=>Number(b.commercial||b.terminal)-Number(a.commercial||a.terminal)||a.name.localeCompare(b.name)).slice(0,36);
  }
  function renderGlobalRoute(arg){
    const assetId=arg&&typeof arg==='object'?arg.assetId:null,destinationKey=arg&&typeof arg==='object'?arg.destinationKey:null;
    if(destinationKey){
      const destination=worldEntityByKey(destinationKey);
      if(!destination)return '<div class="empty">تعذر قراءة المنشأة العالمية.</div>';
      const type=destination.kind==='airport'?'air':'sea';
      const assets=state.assets.filter(asset=>asset.type===type&&asset.phase!=='moving');
      const assetsHtml=assets.length
        ? assets.map(asset=>`<article class="list-item sector-${asset.type}"><div class="list-item-head"><div><h3>${asset.icon} ${esc(asset.name)}</h3><p>الموقع الحالي: ${esc(routeEndpointName(routeOriginForAsset(asset)))} · المدى ${fmtNumber(assetRangeKm(asset))} كم</p></div><span class="tag">${assetStatus(asset)}</span></div><div class="action-row"><button class="primary-btn create-global-route" data-asset="${asset.id}" data-key="${esc(destination.key)}">إنشاء وتشغيل المسار</button></div></article>`).join('')
        : `<div class="empty">لا يوجد أصل ${type==='air'?'جوي':'بحري'} متاح الآن. انتظر وصول أصل متحرك أو اشتر أصلًا جديدًا.</div>`;
      return `<div class="list"><article class="list-item registry-hero"><div class="list-item-head"><div><h3>وجهة ${type==='air'?'جوية':'بحرية'} عامة</h3><p>${esc(destination.name)} · ${esc(destination.city)}. اختر الأصل الذي سيغادر من موقعه الحالي؛ لا يلزم امتلاك قاعدة في الوجهة.</p></div><span class="tag positive">${type==='air'?'AIR':'SEA'}</span></div></article>${assetsHtml}</div>`;
    }
    const asset=state.assets.find(item=>item.id===assetId);
    if(!asset||!['air','sea'].includes(asset.type))return '<div class="empty">اختر طائرة أو سفينة لإنشاء مسار عالمي.</div>';
    const origin=routeOriginForAsset(asset),results=globalRouteResults(asset.type);
    if(!origin)return '<div class="empty">تعذر تحديد موقع الأصل الحالي.</div>';
    const kindLabel=asset.type==='air'?'مطارًا':'ميناءً';
    const resultsHtml=results.length
      ? results.map(entity=>`<article class="list-item world-result"><div class="list-item-head"><div><h3>${entity.icon} ${esc(entity.name)}</h3><p>${esc(entity.city)} · ${esc(entity.country)} · ${esc(entity.code)}</p></div><span class="tag">${entity.kind==='airport'?'مطار عام':'ميناء عام'}</span></div><div class="action-row"><button class="secondary-btn world-focus" data-key="${esc(entity.key)}">عرض</button><button class="primary-btn create-global-route" data-asset="${asset.id}" data-key="${esc(entity.key)}">إنشاء من ${esc(routeEndpointName(origin))}</button></div></article>`).join('')
      : '<div class="empty">لا توجد وجهة مطابقة. جرّب الرمز أو الاسم بالإنجليزية.</div>';
    const resultLabel=globalRouteQuery?`${results.length} وجهة مطابقة`:'وجهات دولية بارزة — اكتب للبحث في السجل الكامل';
    return `<div class="list"><article class="list-item registry-hero"><div class="list-item-head"><div><h3>${asset.icon} مسار عالمي مباشر</h3><p>نقطة الانطلاق: ${esc(routeEndpointName(origin))}. ابحث في جميع ${asset.type==='air'?fmtNumber(WORLD.meta.airportCount):fmtNumber(WORLD.meta.portCount)} ${kindLabel}؛ الوجهة عامة ولا تحتاج إلى قاعدة مملوكة.</p></div><span class="tag positive">${asset.type==='air'?'AIR':'SEA'}</span></div><div class="metric-row two"><div><span>مدى الأصل</span><b>${fmtNumber(assetRangeKm(asset))} كم</b></div><div><span>الموقع الحالي</span><b>${esc(routeEndpointName(origin))}</b></div></div></article><div class="world-search global-route-search"><input id="globalRouteSearch" value="${esc(globalRouteQuery)}" placeholder="ابحث بالمدينة أو الرمز الدولي أو اسم ${asset.type==='air'?'المطار':'الميناء'}" autocomplete="off"></div><div class="section-mini">${resultLabel}</div>${resultsHtml}</div>`;
  }
  function renderGlobalRouteInto(assetId,restoreFocus=false){
    $('drawerBody').innerHTML=renderGlobalRoute({assetId});window.GH_INTERFACE.prepare($('drawerBody'),activeDrawerPanel,activeDrawerArg,advancedContext());bindDrawerActions();
    if(restoreFocus){const input=$('globalRouteSearch');input?.focus();input?.setSelectionRange(input.value.length,input.value.length);}
  }

  const panelMeta={
    formationContract:['المجموعة القابضة','عقد التأسيس'],leadershipHub:['القيادة التنفيذية','مركز القيادة والقرار'],executionLog:['القيادة التنفيذية','سجل التنفيذ'],actionCenter:['القيادة التنفيذية','مركز المهام'],companies:['المجموعة والشركات','الشركات التابعة'],control:['التشغيل والأصول','مركز التشغيل والشبكة'],governanceHub:['الحوكمة والمخاطر','مركز الرقابة والامتثال'],systemHub:['النظام والسلامة','الصحة والصيانة'],network:['التشغيل والأصول','الدليل العالمي'],routes:['التشغيل والأصول','مركز المسارات المستقل'],globalRoute:['التشغيل والأصول','مسار عالمي مباشر'],companyFacilities:['التشغيل والأصول','قواعد ومراكز الشركة'],market:['المالية والخزينة','الأسواق والمحفظة'],contracts:['التشغيل والأصول','العقود والعملاء'],businessWorld:['القيادة التنفيذية','السوق التجاري والعلاقات'],ma:['القيادة التنفيذية','الاستحواذات والاستثمارات'],labor:['الموارد البشرية','وظائف المنشآت والتنظيم'],assets:['التشغيل والأصول','الأصول المملوكة'],assetMarket:['التشغيل والأصول','متجر الأصول'],assetManage:['التشغيل والأصول','إدارة الأصل'],mobilityAsset:['التشغيل والأصول','إدارة سيارة Mobility'],expansion:['التشغيل والأصول','الشبكة والمنشآت'],finance:['المالية والخزينة','المركز المالي'],monthlyFinance:['المالية والخزينة','الدخل والمصروفات الشهرية'],invoices:['المالية والخزينة','مركز المستندات والالتزامات'],news:['القيادة التنفيذية','غرفة الأحداث'],settings:['النظام والسلامة','الحفظ والإعدادات'],diagnostics:['النظام والسلامة','مركز التشخيص'],energy:['المجموعة والشركات','مركز إنتاج الطاقة'],bank:['المجموعة والشركات','مركز بنك المجموعة'],governance:['الحوكمة والمخاطر','مجلس الإدارة'],insurance:['الحوكمة والمخاطر','التأمين وإدارة المخاطر'],research:['القيادة التنفيذية','البحث والتطوير'],esg:['القيادة التنفيذية','الاستدامة'],career:['القيادة التنفيذية','نضج المجموعة'],realism:['القيادة التنفيذية','واقعية الاقتصاد'],ports:['التشغيل والأصول','شبكة الموانئ']
  };

  const panelRoot = panel => window.GH_ADVANCED?.root(panel) || ({
    formationContract:'companies',leadershipHub:'leadership',executionLog:'leadership',realism:'leadership',ma:'leadership',research:'leadership',esg:'leadership',career:'leadership',news:'leadership',
    companies:'companies',companyManage:'companies',energy:'companies',bank:'companies',
    control:'control',network:'control',routes:'control',globalRoute:'control',companyFacilities:'companies',contracts:'control',labor:'control',expansion:'control',ports:'control',procurement:'control',assets:'control',assetMarket:'control',assetManage:'control',mobilityAsset:'control',facilityManage:'control',
    market:'finance',finance:'finance',monthlyFinance:'finance',invoices:'finance',treasury:'finance',
    governanceHub:'governance',governance:'governance',audit:'governance',legal:'governance',insurance:'governance',cyber:'governance',safety:'governance',
    systemHub:'system',settings:'system',updates:'system',diagnostics:'system',controlPlane:'system'
  })[panel] || 'map';
  function setActiveNav(key){
    document.querySelectorAll('.side-nav button').forEach(b=>b.classList.toggle('active',(b.dataset.nav||'')===(['system','governance','mapTools'].includes(key)?'more':key)));
    document.querySelectorAll('.bottom-nav button').forEach(b=>{
      const candidate=b.hasAttribute('data-mobile-map')?'map':panelRoot(b.dataset.panel);
      b.classList.toggle('active',candidate===key);
    });
  }
  function drawerUsesBackdrop(){ return false; }

  async function hardResetGame(){
    if(hardResetInProgress||durableCommandInProgress||window.GH_PERSISTENCE.isLocked())return false;
    const previousState=clone(state);hardResetInProgress=true;state.speed=0;
    let settleHardReset=null,resetDurabilityEstablished=false;
    hardResetSettlement=new Promise(resolve=>{settleHardReset=resolve;});
    try{
      const cleanupKeys=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith('global-holdings-'))cleanupKeys.push(k);}
      await window.GH_GAME_LIFECYCLE.reset(state,defaultState,{storageKey,resetMarkerKey,appVersion:APP_VERSION,checkpoint:previousState,cleanupKeys,clearManualSlots:true,prepare:next=>{
        window.GH_ADVANCED.migrate(next);window.GH_REALISM.migrate(next);window.GH_EVENT_LEDGER.ensure(next);window.GH_DEPENDENCY_CORE.ensure(next);window.GH_DELIVERY_MONITOR.ensure(next);window.GH_FINANCE_CORE.ensure(next);window.GH_DIAGNOSTICS.ensure(next);window.GH_CONTROL_PLANE.bootstrap(next);next.advanced.saveSlots=[null,null,null];
      }});
      resetDurabilityEstablished=true;
      selectedAssetId=null;
      Object.keys(routeTemplates).forEach(id=>{if(!BASE_ROUTE_IDS.has(id))delete routeTemplates[id];});
      closeDrawer();closeGod();closeMapPopovers();$('assetCard')?.classList.add('hidden');
      const founder=$('founderFlow');founder.classList.remove('hidden');founder.removeAttribute('aria-hidden');founder.style.setProperty('display','grid','important');founder.scrollTop=0;
      const shell=$('app');shell.setAttribute('aria-hidden','true');shell.style.pointerEvents='none';
      updateFounderLogoPreview();simulationEngine.reset(performance.now(),'new-group');updateKpis();renderMap();updateMapStatus();return true;
    }catch(error){
      if(error.requiresNativeReload){
        resetDurabilityEstablished=true;state.speed=0;
        notice('تم اعتماد إعادة التعيين في الحفظ Native لكن تعذر تحديث الذاكرة؛ ستُعاد مزامنة اللعبة من الحفظ الدائم الآن.');
        location.reload();
        return false;
      }
      window.GH_TRANSACTION_CORE.restoreObject(state,previousState);
      if(error.critical){state.speed=0;window.GH_CONTROL_PLANE.incident(state,{fingerprint:'RESET_COMPENSATION_FAILED',code:'RESET_COMPENSATION_FAILED',severity:'critical',domain:'save',title:'فشل استرداد الحفظ',detail:String(error.compensationError||error.rollbackError)});}
      notice(error.critical?'تعذر تأكيد استرداد الحفظ. أوقفت المحاكاة لحماية التقدم؛ صدّر تقرير الدعم.':'تعذر إكمال إعادة اللعبة؛ تم الاحتفاظ بالحالة السابقة.');return false;
    }finally{
      hardResetInProgress=false;
      settleHardReset?.({committed:resetDurabilityEstablished,resetEpoch:Number(state.resetEpoch)||0,saveRevision:Number(state.saveRevision)||0});
    }
  }

  // Public fail-safe used only by the explicit New Group control.
  window.GH_FORCE_NEW_GAME=()=>hardResetGame();

  function runFullDiagnostics(options={}){
    const legacy=window.GH_DIAGNOSTICS.runHealthCheck(state,{appVersion:APP_VERSION,saveSchemaVersion:SAVE_SCHEMA_VERSION,simulation:simulationEngine.snapshot()},{recordEvent:options.recordEvent===true,trackTransitions:options.trackTransitions!==false});
    const central=window.GH_CONTROL_PLANE?.check?.(state,{openWarnings:options.openWarnings===true});
    return central?{...legacy,centralControl:central,status:central.status==='critical'?'critical':legacy.status==='critical'?'critical':central.status==='warning'||legacy.status==='warning'?'warning':'healthy'}:legacy;
  }
  function exportControlPlaneFile(kind='diagnostic',id=null){
    const cp=window.GH_CONTROL_PLANE;if(!cp)return null;const out=kind==='incident'?cp.exportIncident(state,id):kind==='health'?cp.exportHealth(state):kind==='trace'?cp.trace(state,id):kind==='support'?cp.exportSupport(state):cp.exportDiagnostic(state);
    const ext={incident:'ghincident',health:'ghhealth',trace:'ghtrace',support:'ghsupport',diagnostic:'ghdiagnostic'}[kind]||'ghdiagnostic',filename=`GlobalHoldings_${kind}_v${APP_VERSION}_${Date.now()}.${ext}`,json=JSON.stringify(out,null,2),bridge=window.webkit?.messageHandlers?.diagnosticBridge;
    if(bridge)bridge.postMessage({action:'exportDiagnostic',filename,json});else{const blob=new Blob([json],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500);}
    cp.appendEvent(state,{type:'CONTROL_EXPORT',domain:'control',actor:'player',detail:{kind,filename,id}});return out;
  }
  function exportDiagnosticsFile(){return exportControlPlaneFile('diagnostic');}
  function startSimulationFaultRecorder(){
    const out=window.GH_DIAGNOSTICS.recorderStart?.(state,simulationEngine.snapshot(),{nowMs:Date.now(),context:{appVersion:APP_VERSION,build:RUNTIME_BUILD,saveSchemaVersion:SAVE_SCHEMA_VERSION}})||null;
    if(out)diag('SIM_FAULT_RECORDER_STARTED',{simSeconds:state.simSeconds,speed:state.speed});
    return out;
  }
  function finishSimulationFaultRecorder(){
    const summary=window.GH_DIAGNOSTICS.recorderStop?.(state,simulationEngine.snapshot(),{nowMs:Date.now(),context:{appVersion:APP_VERSION,build:RUNTIME_BUILD,saveSchemaVersion:SAVE_SCHEMA_VERSION}})||null;
    if(summary){diag('SIM_FAULT_RECORDER_FINISHED',{status:summary.status,events:summary.events,samples:summary.samples,simDelta:summary.simDelta});save();}
    return summary;
  }
  function simulationFaultRecorder(){return window.GH_DIAGNOSTICS.recorderSnapshot?.(state)||null;}

  function advancedContext(){
    return {state,fmtMoney,fmtNumber,formatDuration,esc,typeName,facilityKind,findFacility,competitors,assetCatalog,WORLD,storageKey,
    candidates,getDynamicFacilities,strategicPartners,supplierFor,awardConstruction,payNamedSupplier,canSpend,spend,canCompanySpend,spendCompany,companyOperatingBalance,companyTotalBalance,companyBudget,companyBudgetRemaining,transferBetweenCompanies,bulkTransferFromGroup,transferWithinCompany,creditCompany,companyPerformance:(type,days=30)=>window.GH_FINANCE_CORE.performance(state,type,days),pushAlert,save,runDurableStateCommand,runAuthorizedDomainCommand,dispatchAuthorizedDomain:runAuthorizedDomainCommand,dispatchSystemCommand,authorizationSignatureMarkup,openSignatureDialog,activeAuthorization:()=>clone(founderAuthorization(state)),signatureStatus:()=>{const authority=founderAuthorization(state);return {principalId:FOUNDER_PRINCIPAL_ID,ready:Boolean(authority.signature&&authority.mandate),signatureId:authority.signature?.id||null,signatureVersion:authority.signature?.version||null,mandateId:authority.mandate?.id||null,mandateVersion:authority.mandate?.version||null};},updateKpis,renderMap,panMapTo,openDrawer,openWorldDirectory,buyAsset,issueCheque,routeRuntimeSnapshot:()=>clone(routeTemplates),restoreRouteRuntime:snapshot=>{for(const key of Object.keys(routeTemplates))delete routeTemplates[key];Object.assign(routeTemplates,clone(snapshot||{}));},assignRoute,ensureFacilityWorkforce,ensureBankCorporateClients,bankLiquidityMetrics,bankReviewCorporateLimits,bankDrawCorporateFacility,bankIssueTradeInstrument,bankCashSweep,hardResetGame,worldEntityByKey,appVersion:APP_VERSION,runtimeBuild:RUNTIME_BUILD,saveSchemaVersion:SAVE_SCHEMA_VERSION,runDiagnostics:runFullDiagnostics,exportDiagnostics:exportDiagnosticsFile,startFaultRecorder:startSimulationFaultRecorder,finishFaultRecorder:finishSimulationFaultRecorder,faultRecorder:simulationFaultRecorder,exportControlPlane:exportControlPlaneFile,controlPlane:()=>window.GH_CONTROL_PLANE?.ensure?.(state),controlHealth:()=>window.GH_CONTROL_PLANE?.check?.(state),controlTrace:id=>window.GH_CONTROL_PLANE?.trace?.(state,id),clearDiagnostics:()=>window.GH_DIAGNOSTICS.clear(state),diagnostics:()=>state.diagnostics,businessIntegrity:()=>window.GH_INTEGRITY_CORE.check(state),businessLedger:()=>window.GH_EVENT_LEDGER.summary(state),deliveryClosure:()=>window.GH_DELIVERY_MONITOR.reconcile(state),dependencyGraph:()=>state.dependencyGraph,getSimulationSpeed:()=>state.speed,setSimulationSpeed:value=>setSpeed(value),currentPanel:activeDrawerPanel,currentArg:activeDrawerArg};
  }

  // Native imports arrive after iOS has already validated and atomically
  // installed the WebApp files. Apply their simulation settings exactly once
  // through the same code path used by the in-game update center.
  window.GH_RUNTIME={
    businessIntegrity:()=>window.GH_INTEGRITY_CORE?.check?.(state),
    exportDiagnostics:()=>window.GH_DIAGNOSTICS.exportBundle(state,{appVersion:APP_VERSION,saveSchemaVersion:SAVE_SCHEMA_VERSION,simulation:simulationEngine.snapshot()}),
    persistForBackground:async()=>{
      const revisionAtRequest=Math.max(0,Math.floor(Number(state.saveRevision)||0)),resetEpochAtRequest=Number(state.resetEpoch)||0;
      let waitedForLifecycle=false,durabilityEstablished=false;
      while(durableCommandInProgress||hardResetInProgress){
        const pending=[];
        if(durableCommandInProgress)pending.push(durableCommandSettlement);
        if(hardResetInProgress)pending.push(hardResetSettlement);
        waitedForLifecycle=true;diag('BACKGROUND_SAVE_WAIT_LIFECYCLE',{saveRevision:revisionAtRequest,resetEpoch:resetEpochAtRequest,durableCommandInProgress,hardResetInProgress});
        const settled=await Promise.all(pending);
        if(settled.some(row=>row?.committed===true))durabilityEstablished=true;
      }
      // A Native-acknowledged durable command or reset already established the
      // newest logical state. Coalesce instead of racing a second revision.
      if(waitedForLifecycle&&(durabilityEstablished||Math.max(0,Math.floor(Number(state.saveRevision)||0))>revisionAtRequest||(Number(state.resetEpoch)||0)!==resetEpochAtRequest)){
        await window.GH_PERSISTENCE.drain();diag('BACKGROUND_SAVE_COALESCED',{saveRevision:Number(state.saveRevision)||0,resetEpoch:Number(state.resetEpoch)||0});
        return {saveRevision:Number(state.saveRevision)||0,simSeconds:Number(state.simSeconds)||0,resetEpoch:Number(state.resetEpoch)||0,coalesced:true};
      }
      if(!persistStateNow({throwOnError:true}))throw new Error('background-save-rejected');
      await window.GH_PERSISTENCE.drain();diag('BACKGROUND_SAVE_OK',{saveRevision:Number(state.saveRevision)||0,resetEpoch:Number(state.resetEpoch)||0});
      return {saveRevision:Number(state.saveRevision)||0,simSeconds:Number(state.simSeconds)||0,resetEpoch:Number(state.resetEpoch)||0,coalesced:false};
    },
    applyNativeUpdate:async payload=>{
      if(!window.GH_ADVANCED?.applyNativeUpdate)return false;
      return window.GH_ADVANCED.applyNativeUpdate(payload,advancedContext());
    }
  };

  const drawerScrollMemory={};
  function openDrawer(panel, arg){
    if($('godPanel').classList.contains('open'))closeGod();
    cancelDrawerSearch();window.GH_INTERFACE.navigate(panel,arg);
    const previousPanel=activeDrawerPanel,previousScroll=$('drawerBody').scrollTop,previousArg=activeDrawerArg;
    if(previousPanel)drawerScrollMemory[previousPanel]=previousScroll;
    activeDrawerPanel=panel;activeDrawerArg=arg;
    $('drawer').dataset.panel=String(panel||'');
    state.lastPanel=panel;state.lastPanelArg=arg??null;
    const [eyebrow,title]=window.GH_ADVANCED?.meta(panel,arg)||panelMeta[panel]||['الإدارة','لوحة'];
    $('drawerEyebrow').textContent=eyebrow; $('drawerTitle').textContent=title; $('drawerBody').innerHTML=renderPanel(panel,arg); window.GH_INTERFACE.prepare($('drawerBody'),activeDrawerPanel,activeDrawerArg,advancedContext());bindDrawerActions();
    $('drawerBody').scrollTop=previousPanel===panel&&JSON.stringify(previousArg)===JSON.stringify(arg)?previousScroll:['companyFacilities','network'].includes(panel)?0:(drawerScrollMemory[panel]||0);
    if(drawerUsesBackdrop()) $('backdrop').classList.remove('hidden'); else $('backdrop').classList.add('hidden');
    $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden','false'); setActiveNav(panelRoot(panel));
    closeMapPopovers(); $('assetCard').classList.add('hidden');
    requestAnimationFrame(()=>map?.invalidateSize({animate:false}));
  }
  function openDrawerContent(eyebrow,title,html){
    if($('godPanel').classList.contains('open'))closeGod();
    cancelDrawerSearch();
    if(activeDrawerPanel)drawerScrollMemory[activeDrawerPanel]=$('drawerBody').scrollTop;
    activeDrawerPanel='content';activeDrawerArg=null;
    $('drawer').dataset.panel='content';
    $('drawerEyebrow').textContent=eyebrow; $('drawerTitle').textContent=title; $('drawerBody').innerHTML=`<div class="list">${html}</div>`; window.GH_INTERFACE.prepare($('drawerBody'),activeDrawerPanel,activeDrawerArg,advancedContext());bindDrawerActions();
    $('drawerBody').scrollTop=drawerScrollMemory.content||0;
    if(drawerUsesBackdrop()) $('backdrop').classList.remove('hidden'); else $('backdrop').classList.add('hidden');
    $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden','false'); closeMapPopovers(); setActiveNav('map');
    requestAnimationFrame(()=>map?.invalidateSize({animate:false}));
  }
  function closeDrawer(){ window.GH_INTERFACE.resetHistory(); cancelDrawerSearch(); delete $('drawer').dataset.panel; $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden','true'); $('backdrop').classList.add('hidden'); setActiveNav('map'); state.lastPanel=null;state.lastPanelArg=null; requestAnimationFrame(()=>map?.invalidateSize({animate:false})); }
  $('workspaceBack').addEventListener('click',()=>window.GH_INTERFACE.back(openDrawer));
  const ADVANCED_OWNED_PANELS=new Set(['realism','companies','leadershipHub','workspaceHub','peopleHub','actionCenter','governanceHub','systemHub','executionLog','facilityManage','companyManage','treasury','audit','legal','procurement','cyber','safety','energy','bank','governance','insurance','research','esg','career','news','businessWorld','labor','ma','settings','updates','diagnostics','controlPlane','conference']);
  function renderPanel(panel,arg){
    const advanced=window.GH_ADVANCED?.render(panel,arg,advancedContext());
    if(advanced!==null&&advanced!==undefined)return advanced;
    // Advanced-owned panels deliberately fail closed. Keeping a second renderer here caused
    // stale UI/logic to survive upgrades and made two implementations compete for ownership.
    if(ADVANCED_OWNED_PANELS.has(panel))return '<div class="empty">تعذر تحميل مكوّن الإدارة لهذا القسم. أعد فتح اللعبة بدل تشغيل واجهة قديمة احتياطية.</div>';
    if(panel==='control')return renderControl(); if(panel==='market')return renderMarket();
    if(panel==='contracts')return renderContracts(); if(panel==='assets')return renderOwnedAssets(arg); if(panel==='assetMarket')return renderAssetMarket(arg);
    if(panel==='formationContract')return renderFormationContract(); if(panel==='expansion')return renderExpansion(arg); if(panel==='companyFacilities')return renderCompanyFacilities(typeof arg==='object'?arg.type:arg); if(panel==='finance')return renderFinance(); if(panel==='monthlyFinance')return renderMonthlyFinance(); if(panel==='invoices')return renderInvoices(arg);
    if(panel==='assetManage')return renderAssetManage(arg); if(panel==='mobilityAsset')return renderMobilityAsset(arg); if(panel==='ports')return renderPorts();
    if(panel==='network')return renderWorldNetwork(); if(panel==='routes')return renderRouteCenter(arg); if(panel==='globalRoute')return renderGlobalRoute(arg);
    return '<div class="empty">القسم غير متاح.</div>';
  }

  // ---- لوحة المجموعة: نظرة قابضة + بطاقات شركات بمؤشرات قطاعية حقيقية (أسلوب صورة المرجع) ----
  function renderControl(){
    const card=(panel,code,title,copy)=>`<button class="command-btn" data-open="${panel}"><span>${code}</span><div><b>${title}</b><small>${copy}</small></div></button>`;
    const pendingDeliveries=(state.realism?.procurement?.deliveries||[]).filter(d=>d.status!=='delivered');
    const pendingDeliveryValue=pendingDeliveries.reduce((n,d)=>n+(Number(d.asset?.purchasePrice)||0),0);
    return `<div class="workspace-intro operations-intro"><span>OPERATIONS DOMAIN · 2.6</span><b>من الطلب إلى الحركة الفعلية: شبكة → منشأة → أصل → جاهزية → مسار → عقد → تنفيذ. HR والمال والحوكمة تبقى مجالات مستقلة.</b></div>
      <div class="metric-row"><div><span>الأصول</span><b>${state.assets.length}</b></div><div><span>طلبات شراء قيد التسليم</span><b>${pendingDeliveries.length}</b></div><div><span>قيمة الطلبات المعلّقة</span><b>${fmtMoney(pendingDeliveryValue)}</b></div></div>
      <div class="section-heading"><h3>الشبكة والبنية التحتية</h3><p>حدد أين تعمل المجموعة قبل إضافة القدرة.</p></div><div class="command-grid grouped workspace-card-grid">${card('expansion','HUB','الشبكة والمنشآت','كل القواعد والمراكز والفروع في سجل واحد')}${card('globalRoute','NET','الشبكة الجوية والبحرية','وجهات · مدى · تشغيل عالمي')}${card('routes','ROAD','الشبكة البرية','طرق · نقاط تسليم · هامش')}</div>
      <div class="section-heading"><h3>القدرة والأصول</h3><p>الشراء يدوي بالكامل: اختر الأصل والكمية والقاعدة ثم راقب التسليم. لا توجد قرارات شراء أو مسارات آلية.</p></div><div class="command-grid grouped workspace-card-grid">${card('assetMarket','BUY','شراء الأصول','اختر الأصل والكمية والقاعدة وطريقة التملك مباشرة')}${card('assets','FLT','إدارة الأساطيل','ملكية · حالة · صيانة · تعيين · بيع')}</div>
      <div class="section-heading"><h3>التجارة والتنفيذ</h3><p>حول القدرة المتاحة إلى التزام تجاري وتشغيل قابل للقياس.</p></div><div class="command-grid grouped workspace-card-grid">${card('contracts','COM','العقود والعملاء','مناقصات · SLA · تنفيذ · فوترة')}${card('businessWorld','B2B','السوق التجاري','عملاء · مشترون · رعايات · إعلانات · منافسون')}</div>
      <article class="list-item domain-crosslink"><div><b>القوى البشرية</b><small>طاقم كل أصل وراتبه يُنشآن تلقائيًا مع الشراء. افتح HR فقط لوظائف المنشآت والقيادات.</small></div><button class="secondary-btn" data-open="peopleHub">فتح HR والأفراد</button></article>`;
  }


  function renderContracts(){
    const available=contracts.filter(c=>!state.acceptedContracts.includes(c.id));
    const accepted=contracts.filter(c=>state.acceptedContracts.includes(c.id));
    const awaiting=available.filter(c=>state.contractRegistry[c.id]?.status==='بانتظار التوقيع');
    const open=available.filter(c=>!state.contractRegistry[c.id]);
    const construction=state.constructionContracts||[],tenders=state.commercialTenders||[];const activeValue=accepted.reduce((n,c)=>n+c.value,0);
    return `<div class="list"><article class="list-item"><div class="list-item-head"><div><h3>مركز العقود الكبرى والمناقصات</h3><p>عقود عملاء · مناقصات حكومية · PPA · عقود بناء وموردين، مع تتبع الترسية والسداد.</p></div><span class="tag positive">COMMERCIAL</span></div><div class="metric-row"><div><span>قيمة العقود النشطة</span><b>${fmtMoney(activeValue)}</b></div><div><span>عقود نشطة</span><b>${accepted.length}</b></div><div><span>عقود إنشاء</span><b>${construction.length}</b></div></div></article>${construction.length?`<div class="section-mini">عقود الإنشاء والترسية</div>${construction.slice(0,20).map(x=>`<article class="list-item"><div class="list-item-head"><div><h3>${esc(x.siteName)}</h3><p>المقاول: ${esc(x.contractor)} · ${esc(x.paymentRef||'')}</p></div><span class="tag positive">${esc(x.status)}</span></div><div class="metric-row"><div><span>قيمة الترسية</span><b>${fmtMoney(x.amount)}</b></div><div><span>درجة التقييم</span><b>${x.awardScore}/100</b></div><div><span>طريقة السداد</span><b>${esc(x.method)}</b></div></div><p>المنافسون: ${(x.bids||[]).map(b=>`${esc(b.supplier)} (${fmtMoney(b.quote)})`).join(' · ')}</p></article>`).join('')}`:''}${awaiting.length?`<div class="section-mini">عروض فائزة بانتظار التوقيع</div>${awaiting.map(c=>{const eligible=eligibleContractCompanyIds(c);return `<article class="list-item sector-${c.sector}"><div class="list-item-head"><div><h3>${c.name}</h3><p>${c.client} · عقد جاهز للتوقيع الإلكتروني.</p></div><span class="tag positive">بانتظار التوقيع</span></div><div class="metric-row two"><div><span>دفعة مقدمة</span><b>${fmtMoney(c.value*.1)}</b></div><div><span>رقم العقد</span><b>${state.contractRegistry[c.id].number}</b></div></div><div class="action-row"><label>الشركة المنفذة<select class="contract-company-select" data-id="${esc(c.id)}">${eligible.map(companyId=>`<option value="${esc(companyId)}">${esc(companyFinanceName(companyId))}</option>`).join('')}</select></label><button class="primary-btn sign-contract" data-id="${c.id}" ${eligible.length?'':'disabled data-disabled-reason="لا توجد شركة تشغيلية مؤهلة"'}>توقيع واعتماد العقد</button></div></article>`;}).join('')}`:''}<div class="section-mini">مناقصات متاحة</div>${open.map(c=>{
      const margin=c.value-c.cost;
      return `<article class="list-item sector-${c.sector}"><div class="list-item-head"><div><h3>${c.name}</h3><p>${c.client} · ${typeName(c.sector)}</p></div><span class="tag">${c.termMonths} شهر</span></div><div class="metric-row"><div><span>قيمة العقد</span><b>${fmtMoney(c.value)}</b></div><div><span>هامش كامل</span><b>${fmtMoney(margin)}</b></div><div><span>SLA</span><b>${c.sla}</b></div></div><p>القدرة المطلوبة: ${c.capacity}<br>المخاطر التعاقدية: ${c.penalty}</p><div class="action-row"><button class="primary-btn bid-contract" data-id="${c.id}" data-mode="balanced">تقديم عرض متوازن</button><button class="secondary-btn inspect-contract" data-id="${c.id}">تفاصيل العقد</button></div></article>`;
    }).join('')||'<div class="empty">لا توجد مناقصات جديدة حاليًا.</div>'}
    ${accepted.length?`<div class="section-mini">عقود موقعة</div>${accepted.map(c=>{const start=state.contractStartDays[c.id]||0,elapsed=Math.max(0,Math.floor(state.simSeconds/86400)-start),total=c.termMonths*30,progress=Math.min(100,Math.round(elapsed/Math.max(1,total)*100)),doc=state.contractRegistry[c.id];return `<article class="list-item sector-${c.sector}"><div class="list-item-head"><div><h3>${c.name}</h3><p>${c.client} · ${doc?.number||'عقد نشط'}</p></div><span class="tag positive">نشط</span></div><div class="metric-row"><div><span>القيمة</span><b>${fmtMoney(c.value)}</b></div><div><span>الهامش اليومي</span><b>${fmtMoney((c.value-c.cost)/(c.termMonths*30))}</b></div><div><span>SLA</span><b>${c.sla}</b></div></div><div class="progress-bar"><span style="width:${progress}%"></span></div><p>تنفيذ العقد ${progress}% · الفوترة شهرية والتحصيل إلى الحساب الجاري ضمن الإغلاق المالي.</p></article>`;}).join('')}`:''}</div>`;
  }


  // ---- الطاقم وسوق العمل: تنفيذيون + طاقم تشغيلي برواتب ومعنويات فعلية ----

  function portfolioValue(){return Object.entries(state.portfolio).reduce((sum,[sym,qty])=>sum+(state.market.find(s=>s.sym===sym)?.price||0)*qty,0);}
  function portfolioCost(){return Object.entries(state.portfolio).reduce((sum,[sym,qty])=>sum+(state.portfolioBook[sym]?.avgCost||state.market.find(s=>s.sym===sym)?.price||0)*qty,0);}
  function renderMarket(){
    const nav=portfolioValue(),cost=portfolioCost(),pnl=nav-cost;
    return `<div class="list"><article class="list-item"><div class="list-item-head"><div><h3>محفظة المجموعة</h3><p>السوق يتحرك وفق زمن المحاكاة وتذبذب اقتصادي مبسط.</p></div><span class="tag">${fmtMoney(nav)}</span></div><div class="metric-row"><div><span>التكلفة</span><b>${fmtMoney(cost)}</b></div><div><span>ربح/خسارة غير محققة</span><b class="${pnl>=0?'positive':'negative'}">${fmtMoney(pnl)}</b></div><div><span>مراكز مفتوحة</span><b>${Object.keys(state.portfolio).length}</b></div></div></article>${state.market.map(s=>{
      const qty=state.portfolio[s.sym]||0;
      const avg=state.portfolioBook[s.sym]?.avgCost||0,positionPnl=qty?(s.price-avg)*qty:0;
      return `<article class="list-item"><div class="stockline"><div><strong>${s.sym} · ${s.name}</strong><small>Market Cap ${fmtMoney(s.marketCap)} · P/E ${s.pe} · Yield ${s.yield}%</small></div><div><strong>${fmtMoney(s.price)}</strong><small class="${s.change>=0?'positive':'negative'}">${s.change>=0?'+':''}${s.change.toFixed(2)}%</small></div></div>${qty?`<div class="metric-row two"><div><span>المركز</span><b>${fmtNumber(qty)} سهم · متوسط ${fmtMoney(avg)}</b></div><div><span>النتيجة غير المحققة</span><b class="${positionPnl>=0?'positive':'negative'}">${fmtMoney(positionPnl)}</b></div></div>`:''}<div class="action-row"><button class="primary-btn buy-stock" data-id="${s.sym}">شراء 1,000</button><button class="secondary-btn sell-stock" data-id="${s.sym}" ${qty<1000?'disabled':''}>بيع 1,000${qty?` · تملك ${fmtNumber(qty)}`:''}</button></div></article>`;
    }).join('')}</div>`;
  }

  // ---- شراء الأصول: جديد/مستعمل بمواصفات فعلية (أسلوب صور المرجع) ----
  function specRow(item){
    const s=item.specs;
    if(item.icon==='✈️'){
      return `<div class="spec-row"><span>المدى</span><b>${fmtNumber(s.rangeKm)} كم</b></div><div class="spec-row"><span>السرعة</span><b>${fmtNumber(s.speedKmh)} كم/س</b></div><div class="spec-row"><span>السعة</span><b>${fmtNumber(s.capacity)} ${s.capacityUnit}</b></div><div class="spec-row"><span>المدرج المطلوب</span><b>${fmtNumber(s.runwayM)} م</b></div><div class="spec-row"><span>MTOW</span><b>${fmtNumber(s.mtowTon)} طن</b></div><div class="spec-row"><span>استهلاك الوقود</span><b>${s.fuelBurnKgPerKm} كغم/كم</b></div><div class="spec-row"><span>صيانة/ساعة</span><b>${fmtMoney(s.maintenancePerFlightHour)}</b></div><div class="spec-row"><span>الاعتمادية</span><b>${s.reliability}%</b></div>`;
    }
    if(item.icon==='🚢'){
      return `<div class="spec-row"><span>المدى</span><b>${fmtNumber(s.rangeNm)} ميل بحري</b></div><div class="spec-row"><span>السرعة القصوى</span><b>${s.speedKn} عقدة</b></div><div class="spec-row"><span>السعة</span><b>${fmtNumber(s.capacity)} ${s.capacityUnit}</b></div><div class="spec-row"><span>الغاطس</span><b>${s.draftM} م</b></div><div class="spec-row"><span>الأبعاد</span><b>${s.lengthM}×${s.beamM} م</b></div><div class="spec-row"><span>استهلاك الوقود</span><b>${s.fuelTonPerDay} طن/يوم</b></div><div class="spec-row"><span>الطاقم</span><b>${fmtNumber(s.crew)}</b></div><div class="spec-row"><span>الاعتمادية</span><b>${s.reliability}%</b></div>`;
    }
    return `<div class="spec-row"><span>المدى</span><b>${fmtNumber(s.rangeKm)} كم</b></div><div class="spec-row"><span>السرعة</span><b>${fmtNumber(s.speedKmh)} كم/س</b></div><div class="spec-row"><span>السعة</span><b>${fmtNumber(s.capacity)} ${s.capacityUnit}</b></div><div class="spec-row"><span>نظام الدفع</span><b>${s.drivetrain}</b></div><div class="spec-row"><span>${s.electric?'استهلاك الطاقة':'استهلاك الوقود'}</span><b>${s.electric?`${s.energyKWhPer100km} kWh/100كم`:`${s.fuelLPer100km} لتر/100كم`}</b></div><div class="spec-row"><span>المحاور</span><b>${s.axles}</b></div><div class="spec-row"><span>صيانة/كم</span><b>$${s.maintenancePerKm}</b></div><div class="spec-row"><span>السلامة</span><b>${s.safety}/100</b></div>`;
  }
  let marketFilterType='air', marketFilterTab='new',marketSegment='all',marketQuery='',marketCompare=[],ownedFilterType='all',ownedFilterStatus='all',ownedQuery='',routeFilterType='all',routeQuery='',routeAssignQuery='';
  function companyAssetClassForMode(target,companyId,assetMode,requestedAssetClass=''){
    const definition=COMPANY_PLATFORM.definitionFor?.(target,companyId)||companyDefinition(companyId);if(!definition)return null;
    const mode=String(assetMode||'').trim(),assetClasses=definition.classification?.assetClasses||[],routeModes=definition.classification?.routeModes||[],legacyModes=definition.legacy?.assetOwnerModes||[];
    if(!mode||(!routeModes.includes(mode)&&!legacyModes.includes(mode)))return null;
    const requested=String(requestedAssetClass||'').trim();if(requested)return assetClasses.includes(requested)?requested:null;
    const legacyClass=String(definition.legacy?.assetClassByMode?.[mode]||COMPANY_PLATFORM.assetClassForLegacyMode?.(mode)||'').trim();
    if(legacyClass&&assetClasses.includes(legacyClass))return legacyClass;
    return assetClasses.length===1?assetClasses[0]:null;
  }
  function companySupportsAssetMode(target,companyId,assetMode,assetClass=''){return Boolean(companyAssetClassForMode(target,companyId,assetMode,assetClass));}
  function assetMarketCatalogs(target=state){
    const catalogs=new Map(),adapters=window.GH_COMPANY_ADAPTERS;
    if(!adapters?.resolveAdapter||!adapters?.invokeAdapter)return [];
    // Catalog visibility comes from active definitions and their operations
    // providers, not from the player's funded/opened-company collection.
    // Purchase eligibility remains a separate, owner-scoped transaction check.
    for(const company of COMPANY_PLATFORM.listInstances(target,{includeGroup:false})){
      if(!company.known||company.definition?.lifecycle!=='active'||!company.definition?.classification?.assetClasses?.length)continue;
      const binding=adapters.resolveAdapter(target,company.id,'operations',{registered:false});
      if(!Object.values(binding.engines).some(engine=>typeof engine.purchaseCatalogs==='function'))continue;
      const rows=adapters.invokeAdapter(target,company.id,'operations','purchaseCatalogs',[],{registered:false});
      const supportedModes=[...(company.definition?.classification?.routeModes||[]),...(company.definition?.legacy?.assetOwnerModes||[])];
      for(const row of rows){
        if(!supportedModes.includes(row?.mode)||!company.definition.classification.assetClasses.includes(row?.assetClass))continue;
        if(!row?.mode||!Array.isArray(row.new)||!Array.isArray(row.used)||(!row.new.length&&!row.used.length))continue;
        const existing=catalogs.get(row.mode);
        if(existing){if(existing.view!==row.view||existing.assetClass!==row.assetClass)throw new Error(`asset-catalog-provider-conflict:${row.mode}`);existing.companies.push(company);}
        else catalogs.set(row.mode,{...row,companies:[company]});
      }
    }
    return [...catalogs.values()];
  }
  function assetMarketModes(target=state){return assetMarketCatalogs(target).map(catalog=>catalog.mode);}
  function assetMarketModeFor(value,target=state){
    value=String(value||'');const catalogs=assetMarketCatalogs(target);
    return catalogs.find(catalog=>catalog.mode===value)?.mode||catalogs.find(catalog=>catalog.companies.some(company=>company.id===value))?.mode||catalogs[0]?.mode||null;
  }
  function assetMarketTypeTabs(activeType){
    return `<div class="tabs small">${assetMarketCatalogs().map(catalog=>{
      const operating=catalog.companies.filter(company=>company.operational),companies=operating.length?operating:catalog.companies;
      const label=[...new Set(companies.map(company=>COMPANY_PLATFORM.resolveIdentity(state,company.id)?.shortName||company.id))].join(' · ');
      return `<button class="tab-btn ${activeType===catalog.mode?'active':''}" data-markettype="${esc(catalog.mode)}">${esc(label)}</button>`;
    }).join('')}</div>`;
  }
  function assetMarketReadiness(catalog){
    if(!catalog||catalog.companies.some(company=>company.operational))return '';
    return '<article class="list-item"><h3>كتالوج متاح للاطلاع</h3><p>لشراء هذه الأصول، أسّس شركة متوافقة وموّل حسابها وافتح منشأة تسليم مملوكة لها. عرض الكتالوج لا ينشئ شركة أو حسابًا أو أصلًا.</p><button class="secondary-btn" data-open="companies" data-arg="subs">فتح الشركات التابعة</button></article>';
  }
  function compatibleBases(type,companyId=null,target=state,assetClass=''){
    const facility=window.GH_FACILITY_CORE;return dynamicFacilitiesFor(target).filter(f=>{const owner=facilityOwnerCompanyId(f);if(f?.owned!==true||companyId&&owner!==companyId||COMPANY_PLATFORM.resolveCompany(target,owner)?.operational!==true)return false;const resolvedClass=companyAssetClassForMode(target,owner,type,assetClass);return Boolean(resolvedClass&&facility?.isAssetFacilityCompatible?.({assetMode:type,ownerCompanyId:owner,assetClass:resolvedClass},f,target)===true);});
  }
  function facilityFreeAssetCapacity(base){return window.GH_FACILITY_CORE?.availableAssetCapacity?.(state,base)||0;}
  function allocateAssetPurchase(type,qty,preferredBaseId,ownerCompanyId,assetClass=''){
    const bases=compatibleBases(type,ownerCompanyId,state,assetClass).filter(base=>facilityFreeAssetCapacity(base)>0).sort((a,b)=>Number(b.id===preferredBaseId)-Number(a.id===preferredBaseId)||facilityFreeAssetCapacity(b)-facilityFreeAssetCapacity(a)||String(a.id).localeCompare(String(b.id))),allocations=[];
    let remaining=Math.max(0,Math.floor(Number(qty)||0));for(const base of bases){const count=Math.min(remaining,facilityFreeAssetCapacity(base));if(count>0)allocations.push({base,qty:count});remaining-=count;if(remaining===0)break;}
    if(remaining>0)throw new Error(`سعة القواعد المتاحة لا تكفي: المتاح ${qty-remaining} من ${qty}. افتح قاعدة إضافية أو وسّع السعة.`);return allocations;
  }
  function assetComparePanel(items){
    if(!marketCompare.length)return '';
    const selected=marketCompare.map(id=>items.find(x=>x.id===id)||catalogItem(marketFilterType,id)).filter(Boolean);
    return `<article class="list-item comparison"><div class="list-item-head"><div><h3>المقارنة المباشرة</h3><p>حتى ثلاثة أصول ضمن القطاع الحالي.</p></div><span class="tag">${selected.length}/3</span></div><div class="compare-grid">${selected.map(a=>`<div><b>${esc(a.name)}</b><span>${fmtMoney(a.price)}</span><span>${a.specs.rangeKm?`${fmtNumber(a.specs.rangeKm)} كم`:`${fmtNumber(a.specs.rangeNm)} NM`}</span><span>${fmtNumber(a.specs.capacity)} ${a.specs.capacityUnit}</span><button class="compare-asset active" data-id="${a.id}">إزالة</button></div>`).join('')}</div></article>`;
  }
  function renderMobilityMarketBody(){
    const catalog=assetMarketCatalogs().find(row=>row.view==='mobility'),typeTabs=assetMarketTypeTabs(catalog?.mode||''),mobilityCompanies=(catalog?.companies||[]).filter(company=>company.operational).map(company=>company.id),centers=getDynamicFacilities().filter(f=>f.owned===true&&mobilityCompanies.includes(companyOfFacility(f))&&f.kind==='mobility-center'),classes=catalog?.new||[],centerOptions=centers.map(center=>`<option value="${esc(center.capitalId)}">${esc(companyFinanceName(companyOfFacility(center)))} · ${esc(center.name)} · ${esc(center.city)}</option>`).join('');
    const cards=classes.map(spec=>`<article class="list-item sector-mobility asset-market-card mobility-market-card"><div class="list-item-head"><div><h3>${spec.icon} ${esc(spec.name)}</h3><p>${esc(spec.manufacturer)} · ${spec.capacity} ركاب</p></div><span class="tag positive">جديد</span></div><div class="spec-grid"><div class="spec-row"><span>الطرازات</span><b>${esc(spec.models.join(' · '))}</b></div><div class="spec-row"><span>السعة</span><b>${spec.capacity} ركاب</b></div><div class="spec-row"><span>تعرفة/كم</span><b>$${Number(spec.rate).toFixed(2)}</b></div><div class="spec-row"><span>السائق</span><b>1 ثابت · راتب $6,000/شهر</b></div></div><div class="asset-price"><b>${fmtMoney(spec.cost)}</b><small>تسليم فوري للمركز المختار وتوظيف السائق تلقائيًا</small></div>${centers.length?`<div class="route-builder manual-mobility-purchase"><label>مركز التسليم<select class="mobility-purchase-center">${centerOptions}</select></label><label>العدد<input class="mobility-purchase-qty" type="number" min="1" max="50" value="1"></label></div><div class="action-row"><button class="primary-btn manual-buy-mobility" data-class="${esc(spec.id)}">شراء وتسليم الآن</button></div>`:'<div class="empty">لا يوجد مركز Mobility مملوك. افتح مركز عاصمة أولًا؛ لن تُنشأ أي سيارة أو سائق قبله.</div>'}</article>`).join('');
    return `${typeTabs}${assetMarketReadiness(catalog)}<article class="list-item fleet-sale-bar"><div><b>متجر سيارات التنقل الذكي</b><small>شراء يدوي فقط · لا أسطول تأسيسي · لا أصل افتراضي</small></div>${mobilityCompanies.map(company=>`<button class="secondary-btn" data-open="companyFacilities" data-arg="${esc(company)}">إدارة المراكز</button>`).join('')}</article>${cards||'<div class="empty">كتالوج Mobility غير متاح.</div>'}`;
  }
  function renderAssetMarketBody(activeType,activeTab){
    const catalog=assetMarketCatalogs().find(row=>row.mode===activeType);
    if(catalog?.view==='mobility')return renderMobilityMarketBody();
    const typeTabs=assetMarketTypeTabs(activeType);
    const condTabs = `<div class="tabs"><button class="tab-btn ${activeTab==='new'?'active':''}" data-markettab="new">أصل جديد</button><button class="tab-btn ${activeTab==='used'?'active':''}" data-markettab="used">سوق مستعمل</button></div>`;
    const source = catalog?.[activeTab]||[];
    const segments=[...new Set(source.map(x=>x.segment))];
    const filterBar=`<div class="asset-filters"><input id="assetSearch" value="${esc(marketQuery)}" placeholder="بحث في الطراز أو الفئة"><select id="assetSegment"><option value="all">كل الفئات</option>${segments.map(s=>`<option value="${esc(s)}" ${marketSegment===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div>`;
    const q=normalizeSearch(marketQuery);const items=source.filter(a=>(marketSegment==='all'||a.segment===marketSegment)&&(!q||normalizeSearch(`${a.name} ${a.segment} ${a.description}`).includes(q)));
    const bases=compatibleBases(activeType),hasDeliveryBase=bases.length>0;
    const list = items.map(a=>`<article class="list-item sector-${activeType} asset-market-card"><div class="asset-thumb"><img src="${a.photo}" alt="${esc(a.name)}" loading="lazy"><span class="thumb-tag">${activeTab==='new'?'جديد':`مستعمل ${a.condition}%`}</span></div><div class="list-item-head"><div><h3>${a.icon} ${esc(a.name)}</h3><p>${esc(a.segment)} · ${esc(a.description)}</p></div><span class="tag">★ ${a.rating}</span></div><div class="spec-grid">${specRow(a)}</div>
      <div class="ownership-grid"><div><span>التسليم</span><b>${a.delivery}</b></div><div><span>الضمان</span><b>${a.warranty}</b></div><div><span>قيمة بعد 5 سنوات</span><b>${a.residual5y}%</b></div><div><span>الانبعاثات</span><b>${a.specs.co2Band}</b></div></div>
      <div class="asset-price">${a.priceOriginal?`<s>${fmtMoney(a.priceOriginal)}</s> `:''}<b>${fmtMoney(a.price)}</b><small>تأجير ${fmtMoney(a.leaseMonthly)}/شهر · دفعة تمويل ${Math.round(a.downPayment*100)}%</small></div>
      <div class="asset-request-routing"><div><span>شراء يدوي مباشر</span><b>أنت تختار الأصل والعدد والقاعدة وطريقة التملك</b><small>${hasDeliveryBase?'تحدد القاعدة الشركة المالكة صراحةً، ثم يبقى كامل التوزيع داخل منشآت الشركة نفسها وفي معاملة واحدة.':'افتح منشأة تسليم متوافقة أولًا؛ لن يسمح النظام بشراء أصل بلا وجهة وصول صحيحة.'}</small></div>${hasDeliveryBase?`<div class="route-builder manual-asset-purchase"><label>الشركة وقاعدة التسليم الأولى<select class="manual-asset-base">${bases.map(f=>`<option value="${esc(f.id)}" data-company="${esc(facilityOwnerCompanyId(f))}">${esc(companyFinanceName(facilityOwnerCompanyId(f)))} · ${esc(f.name)} · ${esc(f.city)} · متاح ${fmtNumber(facilityFreeAssetCapacity(f))}/${fmtNumber(window.GH_FACILITY_CORE.assetCapacity(f))}</option>`).join('')}</select></label><label>العدد<input class="manual-asset-qty" type="number" min="1" max="${window.GH_PROCUREMENT_CORE?.MAX_ASSET_PURCHASE_QUANTITY||1000}" value="1"></label><label>التملك<select class="manual-asset-mode"><option value="cash">شراء نقدي</option><option value="finance">تمويل</option><option value="lease">تأجير تشغيلي</option></select></label></div>`:''}<div class="action-row"><button class="primary-btn manual-buy-asset" data-type="${activeType}" data-tab="${activeTab}" data-id="${a.id}" ${hasDeliveryBase?'':'disabled'}>شراء وتسليم الآن</button><button class="secondary-btn compare-asset ${marketCompare.includes(a.id)?'active':''}" data-id="${a.id}">${marketCompare.includes(a.id)?'إزالة من المقارنة':'قارن'}</button></div></div></article>`).join('');
    const fleetCompanies=operationalCompanyInstances(state).filter(company=>activeType==='mobility'?company.definition?.capabilities?.includes('operations.mobility'):(company.definition?.classification?.routeModes||[]).includes(activeType));
    const fleetSale=fleetCompanies.map(company=>{const ownedCount=state.assets.filter(asset=>assetOwnerCompanyId(asset)===company.id&&assetModeOf(asset)===activeType).length,pendingSale=state.assets.filter(asset=>assetOwnerCompanyId(asset)===company.id&&assetModeOf(asset)===activeType&&asset.salePending).length;return `<article class="list-item fleet-sale-bar"><div><b>إدارة أصول ${esc(companyFinanceName(company.id))}</b><small>${ownedCount} أصل مملوك · ${pendingSale} أمر بيع قيد العودة</small></div><button class="danger-soft sell-all-assets" data-company="${esc(company.id)}" ${ownedCount?'':'disabled'}>بيع جميع أصول الشركة</button></article>`;}).join('');
    return `${typeTabs}${assetMarketReadiness(catalog)}${condTabs}${filterBar}${fleetSale}<div class="section-mini">الشراء والتسليم والطاقم الثابت تتم فورًا وبشكل ذري. يبقى اختيار المسار والمغادرة بيدك.</div>${assetComparePanel(source)}${list||'<div class="empty">لا توجد أصول متاحة بهذا الفلتر.</div>'}`;
  }
  function renderAssetMarket(arg){
    if(typeof arg==='string')marketFilterType=assetMarketModeFor(arg)||marketFilterType;marketFilterType=assetMarketModeFor(marketFilterType)||'';
    if(!marketFilterType)return '<div class="empty">لا يوجد كتالوج أصول متاح من مزوّدي الشركات المسجلين.</div>';
    return `<div class="list">${renderAssetMarketBody(marketFilterType,marketFilterTab)}</div>`;
  }

  function renderOwnedAssets(arg){
    const assetCompanies=operationalCompanyInstances(state).filter(company=>company.definition?.capabilities?.includes('operations.fleet')||company.definition?.capabilities?.includes('operations.mobility'));
    const assetCompanyIds=new Set(assetCompanies.map(company=>company.id));
    if(typeof arg==='string'){
      if(arg==='all'||assetCompanyIds.has(arg))ownedFilterType=arg;
      else{const compatible=assetCompanies.filter(company=>(company.definition?.classification?.routeModes||[]).includes(arg)||(arg==='mobility'&&company.definition?.capabilities?.includes('operations.mobility')));ownedFilterType=compatible.length===1?compatible[0].id:'all';}
    }
    if(ownedFilterType!=='all'&&!assetCompanyIds.has(ownedFilterType))ownedFilterType='all';
    const mobilityCompany=uniqueOperationalCompanyForCapability(state,'operations.mobility'),allStandard=(state.assets||[]).filter(asset=>assetCompanyIds.has(assetOwnerCompanyId(asset))),allMobility=mobilityCompany?(state.mobility?.vehicles||[]):[],total=allStandard.length+allMobility.length,moving=allStandard.filter(asset=>asset.phase==='moving').length+allMobility.filter(vehicle=>vehicle.status==='moving').length;
    const tabs=[['all','الكل'],...assetCompanies.map(company=>[company.id,COMPANY_PLATFORM.resolveIdentity(state,company.id)?.shortName||companyFinanceName(company.id)])].map(([id,label])=>`<button class="tab-btn ${ownedFilterType===id?'active':''}" data-ownedtype="${esc(id)}">${esc(label)}</button>`).join('');
    const summary=assetCompanies.map(company=>{const mobility=company.id===mobilityCompany,rows=mobility?allMobility:allStandard.filter(asset=>assetOwnerCompanyId(asset)===company.id),movingCount=rows.filter(row=>row.phase==='moving'||row.status==='moving').length,serviceCount=rows.filter(row=>Number(row.condition)<85).length,short=COMPANY_PLATFORM.resolveIdentity(state,company.id)?.shortName||company.id;return `<button class="command-btn owned-sector-summary" data-ownedtype="${esc(company.id)}"><span>${esc(short)}</span><div><b>${esc(companyFinanceName(company.id))}</b><small>${fmtNumber(rows.length)} أصل · ${fmtNumber(movingCount)} متحرك · ${fmtNumber(serviceCount)} يحتاج صيانة</small></div></button>`;}).join('');
    let standard=[],mobility=[];
    if(ownedFilterType!=='all'){
      const q=normalizeSearch(ownedQuery),matchStatus=row=>ownedFilterStatus==='all'||ownedFilterStatus==='moving'?(ownedFilterStatus==='all'||row.phase==='moving'||row.status==='moving'):ownedFilterStatus==='ready'?(row.phase==='turnaround'||row.status==='available'):ownedFilterStatus==='service'?Number(row.condition)<85:(!['moving','turnaround'].includes(row.phase)&&row.status!=='moving');
      if(ownedFilterType===mobilityCompany)mobility=allMobility.filter(row=>matchStatus(row)&&(!q||normalizeSearch(`${row.name} ${row.model} ${row.assetClass} ${row.baseLocation}`).includes(q)));
      else standard=allStandard.filter(row=>assetOwnerCompanyId(row)===ownedFilterType&&matchStatus(row)&&(!q||normalizeSearch(`${row.name} ${row.model} ${row.id} ${findFacility(row.baseFacility)?.name||''}`).includes(q)));
    }
    const matchingCount=standard.length+mobility.length,displayStandard=standard.slice(0,80),displayMobility=mobility.slice(0,80);
    const standardCards=displayStandard.map(source=>{const asset=normalizedAssetView(source),base=findFacility(asset.baseFacility),staff=asset.staffing||{},ownerCompanyId=assetOwnerCompanyId(asset);return `<article class="list-item sector-${assetModeOf(asset)} owned-asset-row"><div class="list-item-head"><div><h3>${asset.icon||assetIcon(assetModeOf(asset))} ${esc(asset.name)}</h3><p>${esc(companyFinanceName(ownerCompanyId))} · ${esc(asset.model||typeName(ownerCompanyId))} · ${esc(base?.name||'دون مركز')}</p></div><span class="tag ${asset.phase==='moving'?'positive':''}">${esc(assetStatus(asset))}</span></div><div class="metric-row"><div><span>الحالة</span><b>${Math.round(asset.condition)}%</b></div><div><span>الطاقم الثابت</span><b>${fmtNumber(staff.total||0)}</b></div><div><span>راتب شهري</span><b>${fmtMoney(staff.monthlyPayroll||0)}</b></div></div><div class="action-row"><button class="primary-btn" data-open="assetManage" data-arg="${esc(asset.id)}">إدارة الأصل</button><button class="secondary-btn focus-owned-asset" data-id="${esc(asset.id)}">عرض على الخريطة</button>${!asset.routeId?`<button class="secondary-btn" data-open="routes" data-arg="${esc(ownerCompanyId)}">فتح مسارات الشركة</button>`:''}</div></article>`;}).join('');
    const mobilityCards=displayMobility.map(vehicle=>{const center=window.GH_MOBILITY_CORE?.centerMeta?.(state,vehicle.centerId);return `<article class="list-item sector-mobility owned-asset-row"><div class="list-item-head"><div><h3>${vehicle.icon||'🚙'} ${esc(vehicle.name)}</h3><p>${esc(vehicle.model||vehicle.assetClass)} · ${esc(center?.city||vehicle.baseLocation||'—')}</p></div><span class="tag ${vehicle.status==='moving'?'positive':''}">${vehicle.status==='moving'?'في رحلة':'متاحة'}</span></div><div class="metric-row"><div><span>الحالة</span><b>${Math.round(vehicle.condition||0)}%</b></div><div><span>البطارية</span><b>${Math.round(vehicle.battery||0)}%</b></div><div><span>الرحلات</span><b>${fmtNumber(vehicle.totalTrips||0)}</b></div><div><span>الراتب</span><b>${fmtMoney(vehicle.staffing?.monthlyPayroll||6000)}/شهر</b></div></div><div class="action-row"><button class="primary-btn" data-open="mobilityAsset" data-arg="${esc(vehicle.id)}">إدارة السيارة</button><button class="secondary-btn focus-mobility-asset" data-id="${esc(vehicle.id)}">عرض على الخريطة</button></div></article>`;}).join('');
    const filters=ownedFilterType==='all'?'':`<article class="list-item"><div class="asset-filters"><input id="ownedAssetSearch" value="${esc(ownedQuery)}" placeholder="بحث بالاسم أو الطراز أو المركز"><select id="ownedAssetStatus"><option value="all" ${ownedFilterStatus==='all'?'selected':''}>كل الحالات</option><option value="moving" ${ownedFilterStatus==='moving'?'selected':''}>متحركة</option><option value="ready" ${ownedFilterStatus==='ready'?'selected':''}>جاهزة/متاحة</option><option value="idle" ${ownedFilterStatus==='idle'?'selected':''}>متوقفة</option><option value="service" ${ownedFilterStatus==='service'?'selected':''}>تحتاج صيانة</option></select></div><p class="section-mini">${fmtNumber(matchingCount)} نتيجة${matchingCount>80?' · يعرض أول 80 فقط لحماية الأداء، استخدم البحث للوصول المباشر.':''}</p></article>`;
    const content=ownedFilterType==='all'?`<div class="command-grid grouped workspace-card-grid">${summary}</div>`:`${filters}${standardCards}${mobilityCards}${!matchingCount?'<div class="empty">لا توجد أصول مملوكة تطابق هذا القسم والفلتر.</div>':''}`;
    const selectedDefinition=ownedFilterType==='all'?null:companyDefinition(ownedFilterType),marketMode=selectedDefinition?.capabilities?.includes('operations.mobility')?'mobility':(selectedDefinition?.classification?.routeModes||[]).find(mode=>assetCatalog[mode])||'air';
    return `<div class="list"><article class="list-item registry-hero"><div class="list-item-head"><div><h3>سجل الأصول المملوكة</h3><p>كل شركة مستقلة حتى عند مشاركة شركة أخرى نوع الأصل أو نمط المسار نفسه.</p></div><span class="tag positive">OWNED ONLY</span></div><div class="metric-row"><div><span>إجمالي الأصول</span><b>${fmtNumber(total)}</b></div><div><span>متحركة الآن</span><b>${fmtNumber(moving)}</b></div><div><span>رواتب أصول شهرية</span><b>${fmtMoney((window.GH_FLEET_CORE?.monthlyPayroll?.(state)||0)+(window.GH_MOBILITY_CORE?.snapshot?.(state)?.monthlyPayroll||0))}</b></div></div><div class="tabs small">${tabs}</div><div class="action-row"><button class="secondary-btn" data-open="assetMarket" data-arg="${esc(marketMode)}">شراء أصل جديد</button><button class="secondary-btn" data-open="routes" data-arg="${esc(ownedFilterType)}">مركز المسارات</button></div></article>${content}</div>`;
  }

  // ---- الموانئ: سعة تخزين حقيقية لكل صنف بضاعة (أسلوب صور المرجع) ----
  function renderPorts(){
    const corePorts=facilities.filter(f=>f.kind==='port');
    const openedPorts=state.globalBases.filter(f=>f.kind==='port-base').map(f=>({...f,photo:PHOTOS.port_jed,dryStorageTEU:f.terminal?18000:6500,reeferPlugs:f.terminal?1500:420,crudeStorageBbl:f.terminal?900000:180000,fuelBunkerBbl:f.terminal?420000:95000,berths:f.terminal?12:5,maxDraftM:f.terminal?18.5:12.5,craneCount:f.terminal?28:8}));
    const ports=[...corePorts,...openedPorts],shipCounts=shipCountsForPorts(ports);
    return `<div class="list"><article class="list-item registry-hero"><div class="list-item-head"><div><h3>شبكة الموانئ التابعة</h3><p>تظهر هنا الموانئ الأساسية وكل قاعدة بحرية تفتحها من الدليل العالمي.</p></div><span class="tag positive">${ports.length} منشأة</span></div><div class="action-row"><button class="primary-btn" data-open="network">فتح الدليل العالمي</button></div></article>${ports.map(f=>`<article class="list-item sector-sea"><div class="card-photo-row"><div class="thumb-sm"><img src="${f.photo}" alt="${esc(f.name)}" loading="lazy"></div><div class="card-photo-body"><div class="list-item-head"><div><h3>⚓ ${esc(f.name)}</h3><p>${esc(f.city)} · ${esc(f.code||'قاعدة بحرية')}</p></div><span class="tag">${shipCounts.get(f.id)||0} سفينة</span></div></div></div>
      <table class="port-table"><tbody>
        <tr><td>🟨 تخزين جاف</td><td>${fmtNumber(f.dryStorageTEU)} TEU</td></tr>
        <tr><td>🟥 منافذ تبريد</td><td>${fmtNumber(f.reeferPlugs)} Reefer</td></tr>
        <tr><td>🟩 خزين نفط خام</td><td>${fmtNumber(f.crudeStorageBbl)} برميل</td></tr>
        <tr><td>🔵 وقود تزويد</td><td>${fmtNumber(f.fuelBunkerBbl)} برميل</td></tr>
      </tbody></table>
      <div class="metric-row"><div><span>الأرصفة</span><b>${f.berths}</b></div><div><span>الغاطس</span><b>${f.maxDraftM} م</b></div><div><span>الرافعات</span><b>${f.craneCount}</b></div></div>
    </article>`).join('')}</div>`;
  }

  let facilitySectorFilter='all';
  function renderFacilitiesHub(arg={}){
    const directoryCompanies=directoryCompanyRows(),requested=typeof arg==='object'?arg.sector:null,allowed=new Set(['all','group',...directoryCompanies.map(company=>company.id)]);if(allowed.has(requested))facilitySectorFilter=requested;if(!allowed.has(facilitySectorFilter))facilitySectorFilter='all';
    const focusIds=new Set(Array.isArray(arg?.focusIds)?arg.focusIds:[]),allOwned=getDynamicFacilities().filter(row=>row?.owned===true),rows=focusIds.size?allOwned.filter(row=>focusIds.has(row.id)):allOwned.filter(row=>facilitySectorFilter==='all'||companyOfFacility(row)===facilitySectorFilter),daily=rows.reduce((sum,row)=>sum+(Number(row.dailyCost)||0),0),visibleFacilityIds=new Set(rows.map(row=>row.id)),assetCountByFacility=new Map();let assets=0;
    for(const asset of state.assets||[]){const baseId=asset.baseFacility;if(!baseId)continue;assetCountByFacility.set(baseId,(assetCountByFacility.get(baseId)||0)+1);if(visibleFacilityIds.has(baseId))assets++;}
    const sectors=[['all','الكل'],['group',COMPANY_PLATFORM.resolveIdentity(state,'group')?.shortName||'القابضة'],...directoryCompanies.map(company=>[company.id,company.label])];
    const tabs=sectors.map(([id,label])=>`<button class="tab-btn ${facilitySectorFilter===id&&!focusIds.size?'active':''}" data-facilitysector="${id}">${label}<small>${id==='all'?allOwned.length:allOwned.filter(row=>companyOfFacility(row)===id).length}</small></button>`).join('');
    const cards=rows.sort((a,b)=>String(companyOfFacility(a)).localeCompare(String(companyOfFacility(b)))||String(a.name).localeCompare(String(b.name))).map(f=>`<article class="list-item facility-register-row ${selectedFacilityId===f.id?'selected-register-row':''}"><div class="list-item-head"><div><h3>${facilityVectorMarkup(f.kind)} ${esc(f.name)}</h3><p>${esc(typeName(companyOfFacility(f)))} · ${esc(f.city||'—')} · ${esc(f.country||'—')} · ${esc(facilityKind(f.kind))}</p></div><span class="tag ${f.commissioned===false?'':'positive'}">${f.commissioned===false?'قيد الإنشاء':'تشغيل'}</span></div><div class="metric-row"><div><span>التكلفة اليومية</span><b>${fmtMoney(f.dailyCost||0)}</b></div><div><span>الأصول المرتبطة</span><b>${assetCountByFacility.get(f.id)||0}</b></div><div><span>المعرّف</span><b>${esc(f.id)}</b></div></div><div class="action-row"><button class="primary-btn" data-open="facilityManage" data-arg="${esc(f.id)}">إدارة المنشأة</button><button class="secondary-btn" data-focus-facility="${esc(f.id)}">عرض على الخريطة</button></div></article>`).join('');
    const directoryActions=`<div class="action-row facility-create-actions">${directoryCompanies.map(company=>`<button class="secondary-btn open-facility-directory" data-kind="${esc(company.id)}">${esc(company.label)} · ${esc(facilityKind(company.kind))}</button>`).join('')}</div>`;
    const hqSection=focusIds.size||!['all','group'].includes(facilitySectorFilter)?'':`<div class="section-mini">مقار إقليمية متاحة — لا تنشئ أصولًا تلقائيًا</div>${expansionSites.map(site=>{const owned=state.branches.includes(site.id);return `<article class="facility-compact-row"><div><b>${site.icon} ${esc(site.name)}</b><small>${esc(site.city)} · ${esc(site.country)} · ${fmtMoney(site.dailyCost)}/يوم</small></div>${owned?`<button class="secondary-btn" data-focus-facility="${esc(site.id)}">على الخريطة</button>`:`<button class="primary-btn open-branch" data-id="${esc(site.id)}">فتح ${fmtMoney(site.price)}</button>`}</article>`;}).join('')}`;
    return `<div class="list"><article class="list-item registry-hero"><div class="list-item-head"><div><h3>الشبكة والمنشآت</h3><p>سجل واحد واضح لكل مقر وقاعدة ومركز وفرع. الإنشاء والإدارة والعرض على الخريطة من هنا دون خيارات مدفونة.</p></div><span class="tag positive">${focusIds.size?'مجموعة خريطة':'UNIFIED REGISTER'}</span></div><div class="metric-row"><div><span>منشآت مملوكة</span><b>${fmtNumber(allOwned.length)}</b></div><div><span>المعروض</span><b>${fmtNumber(rows.length)}</b></div><div><span>تكلفة يومية</span><b>${fmtMoney(daily)}</b></div><div><span>أصول مرتبطة</span><b>${fmtNumber(assets)}</b></div></div><div class="tabs small facility-sector-tabs">${tabs}</div>${directoryActions}</article>${cards||'<div class="empty">لا توجد منشآت مملوكة في هذا القطاع. استخدم أزرار الفتح أعلاه؛ لا تُنشأ أصول تلقائيًا.</div>'}${hqSection}</div>`;
  }
  function renderExpansion(arg){return renderFacilitiesHub(arg);}

  let lastDepartureBlocked=[];
  function routeGeometrySignature(route){return window.GH_ROUTE_CORE.signature(route)||String(route?.id||'');}
  function normalizeLegacyRouteAssignments(){
    const sharedSlots=new Map();let changed=false,released=0,pending=0;
    const clearAssignment=asset=>{asset.routeId=null;asset.routeSignature=null;asset.routeSlot=null;asset.departureScheduled=false;delete asset.departureScheduledAt;asset.releaseExclusiveRouteOnArrival=false;asset.phase='idle';asset.progress=0;asset.dwellRemaining=0;changed=true;released++;};
    // All transport modes now use bounded route slots, including aviation.
    // This pass repairs duplicate/missing slots on one canonical route without
    // conflating shared use of the same route with duplicate route geometry.
    for(const asset of state.assets||[]){
      if(!asset?.routeId)continue;
      const route=routeTemplates[asset.routeId],signature=route?window.GH_ROUTE_CORE.signature(route):String(asset.routeSignature||asset.routeId);
      if(asset.routeSignature!==signature){asset.routeSignature=signature;changed=true;}
      let used=sharedSlots.get(asset.routeId);if(!used){used=new Set();sharedSlots.set(asset.routeId,used);}
      let slot=Number.isInteger(asset.routeSlot)&&asset.routeSlot>=0&&!used.has(asset.routeSlot)?asset.routeSlot:0;while(used.has(slot))slot++;
      const capacity=window.GH_FLEET_CORE.routeCapacity(route||asset.type);
      if(slot>=capacity){
        if(asset.phase==='moving'){if(asset.releaseExclusiveRouteOnArrival!==true){asset.releaseExclusiveRouteOnArrival=true;changed=true;}pending++;}
        else clearAssignment(asset);
        continue;
      }
      used.add(slot);if(asset.routeSlot!==slot){asset.routeSlot=slot;changed=true;}if(asset.releaseExclusiveRouteOnArrival===true){asset.releaseExclusiveRouteOnArrival=false;changed=true;}
    }
    // Legacy aviation saves may contain two different route IDs that describe
    // the same/near-same corridor. Sharing one route ID is valid; duplicating
    // the corridor under different IDs is not. Moving duplicates finish safely,
    // while stationary duplicates are released for a fresh canonical assignment.
    const airRouteIds=[...new Set((state.assets||[]).filter(asset=>asset.type==='air'&&asset.routeId).map(asset=>asset.routeId))],groups=[];
    for(const routeId of airRouteIds){
      const route=routeTemplates[routeId];if(!route)continue;
      const signature=window.GH_ROUTE_CORE.signature(route),group=groups.find(row=>{const other=routeTemplates[row[0]];return other&&(window.GH_ROUTE_CORE.signature(other)===signature||window.GH_ROUTE_CORE.corridorMetrics(other,route).duplicate);});
      if(group)group.push(routeId);else groups.push([routeId]);
    }
    for(const routeIds of groups){
      if(routeIds.length<2)continue;
      const users=(state.assets||[]).filter(asset=>asset.type==='air'&&routeIds.includes(asset.routeId)),moving=users.find(asset=>asset.phase==='moving'),canonicalId=moving?.routeId||routeIds[0];
      for(const asset of users){
        if(asset.routeId===canonicalId){if(asset.releaseExclusiveRouteOnArrival===true){asset.releaseExclusiveRouteOnArrival=false;changed=true;}continue;}
        if(asset.phase==='moving'){if(asset.releaseExclusiveRouteOnArrival!==true){asset.releaseExclusiveRouteOnArrival=true;changed=true;}pending++;}
        else clearAssignment(asset);
      }
    }
    return {changed,released,pending};
  }
  function dedupeCustomRoutes(type=null){try{const result=dispatchSystemCommand({state},'routes','dedupe',{type},{actor:'system-route-maintenance'}).result||{};for(const id of result.removedIds||[])delete routeTemplates[id];return Number(result.removed||0);}catch(error){console.warn('route dedupe rejected',error);return 0;}}
  function roadFacilityOptions(companyId='road'){
    return getDynamicFacilities().filter(f=>f.owned&&['depot','logistics'].includes(f.kind)&&facilityOwnerCompanyId(f)===companyId);
  }
  function renderRouteCenter(arg){
    const routeCompanies=routingCompanyIds();if(typeof arg==='string'&&(arg==='all'||routeCompanies.includes(arg)))routeFilterType=arg;if(routeFilterType!=='all'&&!routeCompanies.includes(routeFilterType))routeFilterType='all';
    const selectedCompanyId=routeFilterType==='all'?null:routeFilterType,selectedModes=selectedCompanyId?companyRouteModes(selectedCompanyId):[],selectedMode=selectedModes.find(mode=>['air','sea','road'].includes(mode))||null,selectedMobility=Boolean(selectedCompanyId&&isMobilityCompany(selectedCompanyId)),points=selectedMode==='road'?roadFacilityOptions(selectedCompanyId):[],seen=new Set(),allRoutes=operationalRoutes().filter(r=>{const sig=`${routeOwnerCompanyId(r)}:${routeGeometrySignature(r)}`;if(seen.has(sig))return false;seen.add(sig);return true;}),mobility=window.GH_MOBILITY_CORE?.snapshot?.(state)||{vehicles:0,moving:0,activeTrips:0};
    const tabs=[['all','الملخص'],...routeCompanies.map(companyId=>[companyId,COMPANY_PLATFORM.resolveIdentity?.(state,companyId)?.shortName||typeName(companyId)])].map(([id,label])=>`<button class="tab-btn ${routeFilterType===id?'active':''}" data-routetype="${esc(id)}">${esc(label)}</button>`).join('');
    const companyRows=companyId=>isMobilityCompany(companyId)?(state.mobility?.vehicles||[]):state.assets.filter(asset=>assetOwnerCompanyId(asset)===companyId),sectorSummary=routeCompanies.map(companyId=>{const rows=companyRows(companyId),mobilityCompany=isMobilityCompany(companyId),mode=companyRouteModes(companyId)[0]||'mobility',assigned=mobilityCompany?rows.length:rows.filter(a=>a.routeId).length,moving=rows.filter(a=>a.phase==='moving'||a.status==='moving').length,ready=mobilityCompany?rows.filter(a=>a.status==='available').length:rows.filter(a=>a.routeId&&a.phase==='turnaround'&&!a.departureScheduled).length;return `<button class="command-btn sector-${esc(mode)}" data-routetype="${esc(companyId)}"><span>${esc(COMPANY_PLATFORM.resolveIdentity?.(state,companyId)?.shortName||companyId.toUpperCase())}</span><div><b>${esc(typeName(companyId))}</b><small>${rows.length} أصل · ${assigned} مكلّف · ${moving} متحرك · ${ready} جاهز</small></div></button>`;}).join('');
    const selectedAssets=!selectedCompanyId||selectedMobility?[]:state.assets.filter(asset=>assetOwnerCompanyId(asset)===selectedCompanyId),routes=!selectedCompanyId||selectedMobility?[]:allRoutes.filter(route=>routeOwnerCompanyId(route)===selectedCompanyId),assigned=selectedAssets.filter(a=>a.routeId).length,idle=selectedAssets.filter(a=>!a.routeId).length,ready=selectedAssets.filter(a=>a.routeId&&a.phase==='turnaround'&&!a.departureScheduled).length,moving=selectedAssets.filter(a=>a.phase==='moving').length,internationalReady=selectedAssets.filter(a=>['air','sea'].includes(assetModeOf(a))&&a.deliveryStatus!=='pending'&&a.phase!=='moving'&&!a.departureScheduled&&!a.salePending).length;
    const idleRows=selectedAssets.filter(a=>!a.routeId).slice(0,60).map(a=>`<div class="spec-row"><span>${esc(a.icon||assetIcon(assetModeOf(a)))} ${esc(a.name)} · ${esc(findFacility(a.baseFacility)?.name||'دون مركز')}</span><span class="tag">${assetModeOf(a)==='road'?'جاهزة لمسار تلقائي':'اختره من بطاقة مسار أدناه'}</span></div>`).join('');
    const routeAssets=new Map();for(const asset of selectedAssets){if(!asset.routeId)continue;const linked=routeAssets.get(asset.routeId)||[];linked.push(asset);routeAssets.set(asset.routeId,linked);}
    const routeNeedle=normalizeSearch(routeQuery),routeAssetNeedle=normalizeSearch(routeAssignQuery),matchingRoutes=routes.filter(r=>!routeNeedle||normalizeSearch(`${r.name} ${r.from} ${r.to} ${r.routingSource||''}`).includes(routeNeedle)),displayRoutes=matchingRoutes.slice(0,80),assignmentLimit=40,routeConflictBatch=window.GH_FLEET_CORE.routeConflicts(state,displayRoutes);
    const routeCards=displayRoutes.map(r=>{
      const linked=routeAssets.get(r.id)||[],turn=linked.filter(a=>a.phase==='turnaround'&&!a.departureScheduled).length,scheduled=linked.filter(a=>a.phase==='turnaround'&&a.departureScheduled).length,inMotion=linked.filter(a=>a.phase==='moving').length,primary=linked[0],scored=linked.filter(a=>a.lastTrip),avgMargin=scored.length?scored.reduce((n,a)=>n+(Number(a.lastTrip.margin)||0),0)/scored.length:null,avgRevenue=scored.length?scored.reduce((n,a)=>n+(Number(a.lastTrip.revenue)||0),0)/scored.length:null;
      const capacity=window.GH_FLEET_CORE.routeCapacity(r),routeConflict=linked.length>=capacity?null:routeConflictBatch.get(r.id),assignable=[];let assignableMore=false;
      if(linked.length<capacity&&!routeConflict)for(const asset of selectedAssets){if(asset.routeId||asset.phase==='moving'||asset.salePending||asset.deliveryStatus==='pending'||!routeFitsAsset(asset,r)||!asset.baseFacility||!(sameUnderlyingFacility(asset.baseFacility,r.fromFacility)||sameUnderlyingFacility(asset.baseFacility,r.toFacility)))continue;if(routeAssetNeedle&&!normalizeSearch(`${asset.name||''} ${asset.id||''} ${asset.catalogId||''}`).includes(routeAssetNeedle))continue;if(assignable.length>=assignmentLimit){assignableMore=true;break;}assignable.push(asset);}
      return {r,linked,turn,scheduled,inMotion,primary,avgMargin,avgRevenue,assignable,assignableMore,capacity};
    }).sort((a,b)=>(b.avgMargin??-Infinity)-(a.avgMargin??-Infinity)).map((x,i)=>{
      const {r,linked,turn,scheduled,inMotion,primary,avgMargin,avgRevenue,assignable,assignableMore,capacity}=x;
      const assignment=assignable.length?`<div class="route-builder route-inline-assignment"><label>الأصل المتاح<select class="route-asset-select" data-route="${esc(r.id)}">${assignable.map(asset=>`<option value="${esc(asset.id)}">${esc(asset.icon||assetIcon(asset.type))} ${esc(asset.name)}</option>`).join('')}</select></label>${assignableMore?`<small>يعرض أول ${assignmentLimit} أصلًا مطابقًا؛ استخدم بحث الأصول للوصول للبقية.</small>`:''}</div><div class="action-row"><button class="primary-btn assign-route-center" data-route="${esc(r.id)}">تعيين أصل للمسار (${linked.length}/${capacity})</button></div>`:'';
      return `<article class="list-item sector-${esc(routeModeOf(r)||'road')}"><div class="list-item-head"><div><h3>${esc(r.name)}</h3><p>${esc(r.from)} → ${esc(r.to)} · ${esc(r.routingSource||'مسار تشغيلي مسجل')}</p></div><span class="tag ${avgMargin==null?'':avgMargin>=0?'positive':'negative'}">${avgMargin==null?`${linked.length}/${capacity} أصل`:`#${i+1} · ${fmtMoney(avgMargin)}/رحلة`}</span></div><div class="metric-row"><div><span>المسافة</span><b>${fmtNumber(r.distanceKm)} كم</b></div><div><span>المدة</span><b>${formatDuration(r.tripSeconds)}</b></div><div><span>متحركة</span><b>${inMotion}</b></div><div><span>جاهزة / مجدولة</span><b>${turn} / ${scheduled}</b></div></div>${avgRevenue!=null?`<div class="metric-row two"><div><span>متوسط الإيراد الفعلي</span><b class="positive">${fmtMoney(avgRevenue)}</b></div><div><span>متوسط الهامش الفعلي</span><b class="${avgMargin>=0?'positive':'negative'}">${fmtMoney(avgMargin)}</b></div></div>`:''}${assignment}<div class="action-row">${primary?`<button class="secondary-btn" data-open="assetManage" data-arg="${esc(primary.id)}">إدارة أحد أصول المسار</button>`:''}<button class="primary-btn depart-route" data-route="${esc(r.id)}" data-company="${esc(routeOwnerCompanyId(r))}" ${turn?'':'disabled'}>جدولة مغادرة الجاهز (${turn})</button></div></article>`;
    }).join('');
    const overview=routeFilterType==='all'?`<div class="command-grid grouped workspace-card-grid">${sectorSummary}</div>`:'';
    let workspace='';
    if(selectedCompanyId&&['air','sea','road'].includes(selectedMode)){
      const international=['air','sea'].includes(selectedMode),manualReady=selectedAssets.filter(asset=>asset.deliveryStatus!=='pending'&&asset.phase!=='moving'&&!asset.departureScheduled&&!asset.salePending),bulkReady=manualReady.length,manualAssets=international?manualReady.filter(asset=>!routeAssetNeedle||normalizeSearch(`${asset.name||''} ${asset.id||''} ${asset.catalogId||''}`).includes(routeAssetNeedle)).slice(0,80):manualReady,manualAssetsMore=international&&manualReady.length>manualAssets.length;
      const manualRoute=international&&manualAssets.length?`<div class="route-builder"><label>الأصل لمسار يدوي<select id="manualGlobalAsset">${manualAssets.map(asset=>`<option value="${esc(asset.id)}">${esc(asset.icon||assetIcon(asset.type))} ${esc(asset.name)}</option>`).join('')}</select></label>${manualAssetsMore?'<small>يعرض أول 80 أصلًا مطابقًا؛ استخدم بحث الأصول للوصول للبقية.</small>':''}</div><div class="action-row"><button class="secondary-btn open-global-route-selected">إنشاء مسار يدوي للأصل المحدد</button></div>`:'';
      workspace=`<article class="list-item sector-${selectedMode}"><div class="list-item-head"><div><h3>تشغيل ${esc(companyFinanceName(selectedCompanyId))}</h3><p>المسارات والأصول والأوامر هنا مقفلة على الشركة المالكة، حتى عند مشاركة نمط التشغيل مع شركة أخرى.</p></div><span class="tag positive">${selectedAssets.length} أصل</span></div><div class="metric-row"><div><span>بلا مسار</span><b>${idle}</b></div><div><span>مكلّفة</span><b>${assigned}</b></div><div><span>متحركة</span><b>${moving}</b></div><div><span>جاهزة</span><b>${ready}</b></div></div><div class="action-row">${international?`<button class="primary-btn dispatch-international-network" data-company="${esc(selectedCompanyId)}" ${internationalReady?'':'disabled'}>${selectedMode==='sea'?'توزيع وتشغيل الأسطول البحري':'توزيع وتشغيل الشبكة الجوية'} (${internationalReady})</button><button class="secondary-btn depart-all-assets" data-company="${esc(selectedCompanyId)}" ${ready?'':'disabled'}>تشغيل المسارات المعيّنة فقط (${ready})</button>`:`<button class="primary-btn dispatch-existing-network" data-company="${esc(selectedCompanyId)}" ${bulkReady&&!roadPlanning?'':'disabled'}>توزيع وتشغيل أسطول الشاحنات (${bulkReady})</button><button class="secondary-btn depart-all-assets" data-company="${esc(selectedCompanyId)}" ${ready&&!roadPlanning?'':'disabled'}>تشغيل المسارات المعيّنة فقط (${ready})</button><p class="section-mini">تُنشأ مسارات طريق مشتركة ذات سعة محددة وتُوزع شاحنات هذه الشركة وحدها عليها بفتحات مغادرة متدرجة.</p>${roadPlanningMarkup()}`}</div>${selectedMode==='air'?'<p class="section-mini">تُوزع طائرات الشركة على خطوط مشتركة بسعة محددة وفتحات إقلاع متدرجة؛ ملكية كل مسار تبقى صريحة.</p>':''}${manualRoute}</article><article class="list-item"><div class="asset-filters"><input id="routeSearch" value="${esc(routeQuery)}" placeholder="بحث باسم المسار أو نقطة الانطلاق أو الوجهة"><input id="routeAssetSearch" value="${esc(routeAssignQuery)}" placeholder="بحث أصل متاح للتعيين بالاسم أو المعرّف"></div><p class="section-mini">${fmtNumber(matchingRoutes.length)} من ${fmtNumber(routes.length)} مسار${matchingRoutes.length>80?' · يعرض أول 80 فقط لحماية الأداء، استخدم البحث للوصول المباشر.':''}</p></article>${idleRows?`<article class="list-item"><h3>أصول تنتظر تعيين مسار</h3>${idleRows}</article>`:''}`;
      if(selectedMode==='road'){const options=points.map(f=>`<option value="${esc(f.id)}">${esc(f.name)} · ${esc(f.city)}</option>`).join('');workspace+=`<article class="list-item"><h3>إنشاء مسار بري يدوي</h3><p>اختياري لرحلة تحددها بنفسك بين مركزين تابعين للشركة نفسها.</p>${points.length?`<div class="route-builder"><label>نقطة الانطلاق<select id="roadFrom">${options}</select></label><label>الوجهة<select id="roadTo">${[...points].reverse().map(f=>`<option value="${esc(f.id)}">${esc(f.name)} · ${esc(f.city)}</option>`).join('')}</select></label></div><div class="action-row">${points.length>=2?`<button class="secondary-btn build-road-route" data-company="${esc(selectedCompanyId)}">بين قاعدتين</button>`:''}<button class="secondary-btn" data-open="companyFacilities" data-arg="${esc(selectedCompanyId)}">إضافة مركز</button></div>`:'<div class="empty">افتح مركزًا لوجستيًا مملوكًا أولًا.</div>'}</article>`;}
      workspace+=`<div class="section-mini">${matchingRoutes.length} مسار ${esc(companyFinanceName(selectedCompanyId))} مطابق</div>${routeCards||'<div class="empty">لا توجد مسارات مطابقة. غيّر البحث أو أنشئ مسارًا جديدًا.</div>'}`;
    }
    if(selectedMobility){const centers=window.GH_MOBILITY_CORE?.centerClusters?.(state)||[];workspace=`<article class="list-item sector-mobility"><div class="list-item-head"><div><h3>مسارات ${esc(companyFinanceName(selectedCompanyId))} على شبكة الشوارع</h3><p>كل رحلة تستخدم هندسة قيادة فعلية من مزود الطرق؛ تبقى السيارة عند نقطة الالتقاط إذا تعذر جلب المسار.</p></div><span class="tag positive">${mobility.activeTrips||0} رحلة نشطة</span></div><div class="metric-row"><div><span>السيارات</span><b>${mobility.vehicles||0}</b></div><div><span>المتحركة</span><b>${mobility.moving||0}</b></div><div><span>المتاحة</span><b>${mobility.available||0}</b></div><div><span>الممر</span><b>Street v3</b></div></div><div class="action-row"><button class="primary-btn" data-open="assets" data-arg="${esc(selectedCompanyId)}">إدارة السيارات</button><button class="secondary-btn" data-open="companyFacilities" data-arg="${esc(selectedCompanyId)}">إدارة المراكز</button></div></article>${centers.map(center=>{const detail=window.GH_MOBILITY_CORE.centerSnapshot(state,center.centerId);return `<article class="list-item"><div class="list-item-head"><div><h3>${esc(center.city)}</h3><p>${esc(center.country||'')} · مركز حضري مستقل</p></div><span class="tag">${center.vehicles} سيارة</span></div><div class="metric-row"><div><span>متحركة</span><b>${detail.moving}</b></div><div><span>متاحة</span><b>${detail.available}</b></div><div><span>رحلات نشطة</span><b>${detail.activeTrips}</b></div><div><span>ربح فعلي</span><b class="positive">${fmtMoney(detail.platformRevenue)}</b></div></div></article>`;}).join('')||'<div class="empty">لا توجد مراكز أو سيارات Mobility مملوكة.</div>'}`;}
    const blockers=lastDepartureBlocked.length&&!selectedMobility?`<article class="list-item"><h3>تعطّل ${lastDepartureBlocked.length} أصل عن آخر انطلاق</h3>${lastDepartureBlocked.filter(b=>routeFilterType==='all'||b.companyId===selectedCompanyId).slice(0,30).map(b=>`<div class="spec-row"><span>${esc(b.name)}</span><span>${esc(b.text)}</span></div>`).join('')}</article>`:'';
    return `<div class="list"><article class="list-item registry-hero"><div class="list-item-head"><div><h3>مركز المسارات المستقل</h3><p>الجوي والبحري والبري وMobility منفصلة بالكامل؛ لا توجد قائمة مختلطة ولا قرار آلي قد يغير مسارًا.</p></div><span class="tag positive">ROUTE CONTROL</span></div><div class="tabs small">${tabs}</div></article>${overview}${blockers}${workspace}</div>`;
  }

  async function createRoadRouteFromForm(){
    const button=document.querySelector('.build-road-route'),companyId=routeCompanyFromInput(button?.dataset?.company||routeFilterType,state,'road'),fromId=$('roadFrom')?.value,toId=$('roadTo')?.value;if(!fromId||!toId||fromId===toId){notice('اختر مركزي تشغيل مختلفين تابعين للشركة نفسها.');return false;}
    const from=routeFacility(fromId),to=routeFacility(toId);if(!companyId||!from||!to||!from.owned||!to.owned||facilityOwnerCompanyId(from)!==companyId||facilityOwnerCompanyId(to)!==companyId){notice('رُفض المسار: نقطتا التشغيل يجب أن تكونا مملوكتين للشركة المحددة وحدها.');return false;}
    if(button?.disabled)return false;const label=button?.textContent;if(button){button.disabled=true;button.textContent='جاري حساب الطريق…';}
    try{
    const geometry=await requestRoadGeometry(from.coords,to.coords);if(!geometry){notice('لم يجد مزود الطرق اتصالًا بريًا صالحًا. لم يُنشأ أي سجل أو خط بديل.');return false;}
    return await runAuthorizedCompositeCommand('create-road-route',({state:draft,dispatch})=>{
      const draftFrom=routeFacilityFor(draft,fromId),draftTo=routeFacilityFor(draft,toId);if(!draftFrom||!draftTo||!draftFrom.owned||!draftTo.owned||facilityOwnerCompanyId(draftFrom)!==companyId||facilityOwnerCompanyId(draftTo)!==companyId)throw new Error('تغيرت ملكية إحدى نقطتي التشغيل أثناء الحساب');
      const id=window.GH_DETERMINISM.nextId(draft,'ROAD-CUSTOM'),durationHours=Math.max(.25,geometry.durationSeconds/3600),fromName=roadLocationName(draftFrom),toName=roadLocationName(draftTo),route=prepareRoute({id,type:'road',routeMode:'road',ownerCompanyId:companyId,name:`${fromName} → ${toName}`,from:fromName,to:toName,fromFacility:draftFrom.id,toFacility:draftTo.id,route:geometry.route,roadGeometryVersion:311,roadNetworkDistanceKm:geometry.distanceKm,maxLegKm:geometry.distanceKm,effectiveSpeedKmh:clamp(geometry.distanceKm/durationHours,42,82),dwellHours:2.5,routingSource:'OSRM · شبكة طرق فعلية'},draft);
      dispatch('routes','create-with-cache',{route,distanceKm:route.distanceKm,durationSeconds:geometry.durationSeconds});window.GH_OPERATIONS_CORE.execute({state:draft},'record-alert',{text:`أُنشئ مسار بري فعلي من ${route.from} إلى ${route.to} بطول ${fmtNumber(route.distanceKm)} كم.`,type:'route'});return {routeId:id};
    },{afterCommit:()=>{renderMap();updateKpis();openDrawer('routes',companyId);}});
    }catch(error){notice(`تعذر حساب الطريق: ${String(error.message||error)}`);return false;}finally{if(button?.isConnected){button.disabled=false;button.textContent=label;}}
  }
  function companyLogoMarkup(type,size='normal'){
    if(window.GH_IDENTITY?.logoMarkup)return window.GH_IDENTITY.logoMarkup(state,type,size);
    const record=type==='group'?state.profile:(state.companyRegistry?.[type]||{}),identity=COMPANY_PLATFORM.resolveIdentity?.(state,type),definition=COMPANY_PLATFORM.definitionFor?.(state,type)||companyDefinition(type),logo=record.logo||identity?.logo||null,style=record.logoStyle||definition?.classification?.primarySectorId||state.profile.logoStyle||'teal',abbr=identity?.shortName||definition?.identity?.short||'CO';
    return `<div class="company-logo-badge ${size==='small'?'small':size==='tiny'?'tiny':''}" data-style="${esc(style)}">${logo?`<img src="${esc(logo)}" alt="">`:`<span>${esc(abbr)}</span>`}</div>`;
  }
  function renderFinance(){
    const opened=companyFinanceTypes(state,{openedOnly:true}).filter((value,index,rows)=>rows.indexOf(value)===index),subs=opened.filter(t=>t!=='group'),debtRatio=Math.round(state.debt/Math.max(1,state.debt+state.groupValue)*100),groupBalance=companyOperatingBalance('group');
    const entityCard=type=>{const b=companyBook(type),oper=b.accounts[0],reserve=b.accounts[1]||{balance:0},budget=companyBudget(type),budgetRemain=companyBudgetRemaining(type),inv=(state.finance.invoices||[]).filter(x=>(x.company||'group')===type),pending=inv.filter(x=>!['مسددة','محصلة','مدفوعة'].includes(x.status)).reduce((n,x)=>n+(Number(x.total)||0),0),budgetPct=budget.enabled&&budget.limit?Math.min(100,Math.round((budget.spent/budget.limit)*100)):0;return `<article class="finance-company-card-v202"><header class="finance-card-head-v202"><div class="finance-card-identity-v202">${companyLogoMarkup(type,'small')}<div><h3>${esc(companyFinanceName(type))}</h3><small>${esc(oper.id)}</small></div></div><div class="finance-card-balance-v202"><span>الرصيد التشغيلي</span><strong>${fmtMoney(oper.balance)}</strong></div></header><div class="finance-card-metrics-v202"><div><span>الاحتياطي</span><b>${fmtMoney(reserve.balance||0)}</b></div><div><span>الدين</span><b>${fmtMoney(b.debt||0)}</b></div><div><span>مستندات مفتوحة</span><b>${fmtMoney(pending)}</b></div><div><span>الميزانية المتبقية</span><b>${budgetRemain===Infinity?'غير محددة':fmtMoney(budgetRemain)}</b></div></div>${budget.enabled?`<div class="finance-budget-progress"><span style="width:${budgetPct}%"></span></div>`:''}<footer class="finance-card-actions-v202"><button class="primary-btn finance-entity-docs" data-company="${type}">المستندات</button><button class="secondary-btn company-reserve-transfer" data-company="${type}" data-direction="reserve">+1M للاحتياطي</button><button class="secondary-btn company-reserve-transfer" data-company="${type}" data-direction="operating">−1M من الاحتياطي</button>${b.taxPayable>0?`<button class="secondary-btn pay-taxes" data-company="${type}">سداد الضريبة</button>`:''}</footer></article>`;};
    const bulkRows=subs.map(t=>`<label class="bulk-company-row"><span>${companyLogoMarkup(t,'tiny')}<b>${esc(companyFinanceName(t))}</b><small>${fmtMoney(companyOperatingBalance(t))}</small></span><input class="bulk-transfer-amount" data-company="${t}" type="number" min="0" step="1000" value="0" inputmode="decimal"></label>`).join('');
    return `<div class="finance-v202"><section class="finance-overview-v202"><div><span class="eyebrow">FINANCE DOMAIN · 2.5.0</span><p>المجال المالي الوحيد للمجموعة: دفاتر الشركات، الخزينة، المستندات، الأسواق والبنك.</p></div><span class="finance-risk-badge ${debtRatio<35?'good':''}">الدين <b>${debtRatio}%</b></span></section>
      <section class="finance-domain-nav"><button class="command-btn" data-open="monthlyFinance"><span>P&amp;L</span><div><b>الدخل والعجز الشهري</b><small>دخل · مصروف · فائض/عجز · كل شركة</small></div></button><button class="command-btn" data-open="treasury"><span>TRY</span><div><b>الخزينة والسيولة</b><small>تمويل · احتياطي · تحوط · ضغط</small></div></button><button class="command-btn" data-open="invoices"><span>DOC</span><div><b>المستندات والالتزامات</b><small>مستندات · ذمم · ضرائب · ديون · أرباح</small></div></button><button class="command-btn" data-open="market"><span>MKT</span><div><b>الأسواق والمحفظة</b><small>استثمار · مراكز · مؤشرات</small></div></button><button class="command-btn" data-open="bank"><span>BNK</span><div><b>بنك المجموعة</b><small>ائتمان · ودائع · سيولة · عملاء</small></div></button></section>
      <section class="finance-kpi-strip-v202"><div><span>السيولة الموحدة</span><b>${state.godMoney&&state.infiniteMoney?'∞':fmtMoney(state.cash)}</b></div><div><span>سيولة القابضة</span><b>${fmtMoney(groupBalance)}</b></div><div><span>إجمالي الديون</span><b>${fmtMoney(state.debt)}</b></div><div><span>قيمة المجموعة</span><b>${fmtMoney(state.groupValue)}</b></div></section>
      <section class="finance-section-v202"><div class="finance-section-head-v202"><div><h3>دفاتر الشركات</h3><p>رصيد واحتياطي ودين وميزانية كل كيان بدون تداخل.</p></div><button class="secondary-btn view-invoices">كل المستندات</button></div><div class="finance-company-list-v202">${opened.map(entityCard).join('')}</div></section>
      <section class="finance-section-v202 finance-transfers-v202"><div class="finance-section-head-v202"><div><h3>التحويلات الداخلية</h3><p>تحويل مباشر أو توزيع جماعي من القابضة؛ جميع العمليات موثقة في الأستاذ.</p></div></div>
        <article class="finance-transfer-panel-v202"><div class="finance-subhead-v202"><b>تحويل مباشر</b><small>بين كيانين داخل المجموعة</small></div><div class="company-transfer-form finance-direct-form-v202"><label>من<select id="companyTransferFrom">${opened.map(t=>`<option value="${t}">${esc(companyFinanceName(t))}</option>`).join('')}</select></label><label>إلى<select id="companyTransferTo">${opened.slice().reverse().map(t=>`<option value="${t}">${esc(companyFinanceName(t))}</option>`).join('')}</select></label><label class="wide">المبلغ<input id="companyTransferAmount" type="number" min="1" step="1000" value="5000000" inputmode="decimal"></label></div><button class="primary-btn company-transfer-submit">تنفيذ التحويل</button></article>
        <article class="finance-transfer-panel-v202 bulk"><div class="finance-subhead-v202"><div><b>توزيع جماعي من القابضة</b><small>عملية ذرية واحدة لجميع الشركات</small></div><span id="bulkTransferTotal" class="tag">$0</span></div>${subs.length?`<div class="bulk-transfer-toolbar"><label>مبلغ التوزيع<input id="bulkTransferPool" type="number" min="0" step="1000" value="${Math.min(25000000,Math.max(0,Math.floor(groupBalance*.1)))}"></label><button class="secondary-btn bulk-transfer-equal">بالتساوي</button><button class="secondary-btn bulk-transfer-needs">حسب الاحتياج</button></div><div class="bulk-transfer-list">${bulkRows}</div><button class="primary-btn bulk-transfer-submit">تنفيذ جميع التحويلات</button>`:'<div class="empty">افتح شركة تابعة أولًا لاستخدام التوزيع الجماعي.</div>'}</article>
      </section>
      <section class="finance-section-v202"><div class="finance-section-head-v202"><div><h3>تمويل القابضة</h3><p>الدين ورأس المال منفصلان عن التحويلات التشغيلية.</p></div></div><div class="finance-funding-actions"><button class="primary-btn add-credit">خط ائتمان +$50M</button><button class="secondary-btn issue-bond">سندات 5 سنوات +$100M</button><button class="secondary-btn repay-debt">سداد $25M</button>${state.ipo.listed?`<button class="secondary-btn" disabled data-disabled-reason="المجموعة مدرجة بالفعل بالرمز ${esc(state.ipo.ticker||'')}.">مُدرجة · ${esc(state.ipo.ticker||'')}</button>`:`<button class="secondary-btn launch-ipo" ${state.groupValue<1000000000?'disabled data-disabled-reason="قيمة المجموعة أقل من الحد الأدنى للطرح العام ($1B)."':''}>طرح عام أولي (IPO) · ~${fmtMoney(state.groupValue*.18)}</button>`}</div></section>${renderAccountingStatement()}${window.GH_REALISM?window.GH_REALISM.financeHTML(state):''}</div>`;
  }
  function renderAccountingStatement(){const f=state.finance,revenue=f.invoices.filter(x=>x.kind==='دخل').reduce((s,x)=>s+x.amount,0),expense=f.invoices.filter(x=>x.kind==='مصروف').reduce((s,x)=>s+x.amount,0),assets=state.cash+state.assets.reduce((s,a)=>s+(a.purchasePrice||0)*.7,0),liabilities=state.debt+f.payables.reduce((s,x)=>s+x.total,0);return `<article class="list-item"><h3>الملخص المحاسبي التشغيلي</h3><div class="metric-row"><div><span>الإيرادات المثبتة</span><b class="positive">${fmtMoney(revenue)}</b></div><div><span>المصروفات المثبتة</span><b>${fmtMoney(expense)}</b></div><div><span>صافي المستندات</span><b class="${revenue-expense>=0?'positive':'negative'}">${fmtMoney(revenue-expense)}</b></div></div><div class="metric-row two"><div><span>الأصول المقدرة</span><b>${fmtMoney(assets)}</b></div><div><span>الالتزامات</span><b>${fmtMoney(liabilities)}</b></div></div></article>`;}
  function metricsMarkup(items){return `<div class="metric-row">${items.map(([label,value,cls=''])=>`<div><span>${esc(label)}</span><b class="${cls}">${value}</b></div>`).join('')}</div>`;}
  function monthlyFinanceReportRows(){const input=monthlyFinanceReportInput(12),workerResult=financeReportEngine?.request?.(input);if(workerResult?.ready)return workerResult.months;if(financeReportWorkerResult?.key===input.key)return financeReportWorkerResult.months;if(financeReportFallbackCache?.key===input.key)return financeReportFallbackCache.months;const months=window.GH_FINANCE_CORE.monthlyStatement(state,{months:12});financeReportFallbackCache={key:input.key,months};return months;}
  function renderMonthlyFinance(){const months=monthlyFinanceReportRows(),current=months[0]||{monthKey:'—',reportedDays:0,income:0,expenses:0,net:0,deficit:0,surplus:0,companies:[]},opened=new Set(state.openedCompanies||[]),companyRows=current.companies.filter(row=>opened.has(row.company));return `<div class="list monthly-finance-report"><article class="list-item registry-hero"><div class="list-item-head"><div><h3>قائمة الدخل والمصروفات الشهرية</h3><p>تُجمع من الإقفالات اليومية المسجلة لكل شركة؛ العجز قيمة سالبة فعلية وليس مؤشرًا تجميليًا.</p></div><span class="tag ${current.net>=0?'positive':'negative'}">${esc(current.monthKey)}</span></div>${metricsMarkup([['الدخل',fmtMoney(current.income)],['المصروفات',fmtMoney(current.expenses)],['الفائض',fmtMoney(current.surplus)],['العجز',fmtMoney(current.deficit)]])}<p class="section-mini">أيام مقفلة داخل الشهر: ${fmtNumber(current.reportedDays)}</p></article><article class="list-item"><h3>نتيجة الشركات · ${esc(current.monthKey)}</h3>${companyRows.map(row=>`<div class="monthly-company-row"><div><b>${esc(companyFinanceName(row.company))}</b><small>دخل ${fmtMoney(row.income)} · مصروف ${fmtMoney(row.expenses)}</small></div><strong class="${row.net>=0?'positive':'negative'}">${row.net>=0?'فائض':'عجز'} ${fmtMoney(Math.abs(row.net))}</strong></div>`).join('')||'<div class="empty">لا توجد شركات ذات إقفالات في الشهر الحالي.</div>'}</article><article class="list-item"><h3>السجل الشهري</h3><div class="monthly-history-table"><div class="monthly-history-head"><b>الشهر</b><b>الدخل</b><b>المصروف</b><b>النتيجة</b></div>${months.map(row=>`<div><span>${esc(row.monthKey)}<small>${row.reportedDays} يوم</small></span><b>${fmtMoney(row.income)}</b><b>${fmtMoney(row.expenses)}</b><b class="${row.net>=0?'positive':'negative'}">${row.net>=0?'+':'−'}${fmtMoney(Math.abs(row.net))}</b></div>`).join('')}</div></article></div>`;}
  function truncateText(str,n){str=String(str??'');return str.length>n?str.slice(0,n-1)+'…':str;}
  function accountOwnerLabel(accountId){for(const t of companyFinanceTypes()){const b=companyBook(t);if((b.accounts||[]).some(x=>x.id===accountId))return companyFinanceName(t);}return String(accountId||'طرف خارجي');}
  function companyKeyForAccount(accountId){if(!accountId)return null;for(const t of companyFinanceTypes()){const b=companyBook(t);if((b.accounts||[]).some(x=>x.id===accountId))return t;}return null;}
  function documentCompanyKey(doc={}){if(doc.company!=null){if(isFinanceCompany(doc.company))return doc.company;throw new Error(`document-company-unknown:${String(doc.company)}`);}return companyKeyForAccount(doc.accountId)||companyKeyForAccount(doc.from)||companyKeyForAccount(doc.to)||'group';}
  function financeDocumentIdentity(company){const account=companyBook(company).accounts[0]?.id||'—',identity=COMPANY_PLATFORM.resolveIdentity?.(state,company),definition=COMPANY_PLATFORM.definitionFor?.(state,company)||companyDefinition(company);return {company,name:companyFinanceName(company),account,mark:identity?.shortName||definition?.identity?.short||'CO'};}
  const GENERIC_FINANCE_PARTIES=new Set(['طرف تعاقدي','طرف تعاقدي مسجل','عميل تعاقدي','عميل تعاقدي مسجل','جهة تمويل','مستفيد غير محدد','طرف خارجي']);
  function formalFinanceParty(name,company='group',role='supplier'){const value=String(name||'').trim();if(value&&!GENERIC_FINANCE_PARTIES.has(value))return value;return role==='customer'?`حساب العملاء المعتمدين — ${companyFinanceName(company)}`:`حساب الموردين المعتمدين — ${companyFinanceName(company)}`;}
  function legalPartyRecord(name){const key=String(name||'').trim();return strategicPartners.find(p=>[p.name,p.legalName].filter(Boolean).includes(key))||null;}
  function arabicNumberWords(value){
    value=Math.max(0,Math.floor(Number(value)||0));if(value===0)return'صفر';
    const small=['','واحد','اثنان','ثلاثة','أربعة','خمسة','ستة','سبعة','ثمانية','تسعة','عشرة','أحد عشر','اثنا عشر','ثلاثة عشر','أربعة عشر','خمسة عشر','ستة عشر','سبعة عشر','ثمانية عشر','تسعة عشر'],tens=['','','عشرون','ثلاثون','أربعون','خمسون','ستون','سبعون','ثمانون','تسعون'],hundreds=['','مائة','مائتان','ثلاثمائة','أربعمائة','خمسمائة','ستمائة','سبعمائة','ثمانمائة','تسعمائة'];
    const belowThousand=n=>{const parts=[],h=Math.floor(n/100),rest=n%100;if(h)parts.push(hundreds[h]);if(rest){if(rest<20)parts.push(small[rest]);else{const one=rest%10,ten=Math.floor(rest/10);parts.push(one?`${small[one]} و${tens[ten]}`:tens[ten]);}}return parts.join(' و');};
    const scales=[[1000000000000,'تريليون','تريليونان','تريليونات'],[1000000000,'مليار','ملياران','مليارات'],[1000000,'مليون','مليونان','ملايين'],[1000,'ألف','ألفان','آلاف']],parts=[];let rest=value;
    for(const [size,one,two,many] of scales){const chunk=Math.floor(rest/size);if(!chunk)continue;parts.push(chunk===1?one:chunk===2?two:`${belowThousand(chunk)} ${chunk>=3&&chunk<=10?many:one}`);rest%=size;}
    if(rest)parts.push(belowThousand(rest));return parts.join(' و');
  }
  function amountInWords(amount,currency='USD'){const numeric=Math.max(0,Number(amount)||0),whole=Math.floor(numeric),cents=Math.round((numeric-whole)*100),unit=currency==='SAR'?'ريال سعودي':'دولار أمريكي';return `فقط ${arabicNumberWords(whole)} ${unit}${cents?` و${arabicNumberWords(cents)} سنتًا`:''} لا غير`;}
  function chequeDateFromSeconds(seconds){return new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(new Date(SIM_START+Math.max(0,Number(seconds)||0)*1000));}
  function chequeDateFromDay(day){return chequeDateFromSeconds(Math.max(0,Number(day)||0)*86400);}
  function transferDirection(x,company){const fromKey=companyKeyForAccount(x.from),toKey=companyKeyForAccount(x.to);if(fromKey&&toKey){if(fromKey===company&&toKey!==company)return {key:'outgoing',label:'حوالة صادرة',watermark:'OUTGOING'};if(toKey===company&&fromKey!==company)return {key:'incoming',label:'حوالة واردة',watermark:'INCOMING'};return {key:'internal',label:'تحويل داخلي',watermark:'INTERNAL'};}if(fromKey===company)return {key:'outgoing',label:'حوالة صادرة',watermark:'OUTGOING'};if(toKey===company)return {key:'incoming',label:'حوالة واردة',watermark:'INCOMING'};return {key:'internal',label:'إشعار تحويل مصرفي',watermark:'TRANSFER'};}
  // Financial documents resolve the current legal-entity identity at render time. No historical logo snapshot is persisted.
  function fmtDocumentMoney(value){return `<bdi class="document-money" dir="ltr">${Number(value||0).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2})}</bdi>`;}
  function chequeArt(c){
    const company=documentCompanyKey(c),i=financeDocumentIdentity(company),beneficiary=formalFinanceParty(c.beneficiary,company,'supplier'),partner=legalPartyRecord(beneficiary),statusClass=c.status==='مرتجع'?'failed':c.status==='صادر'?'pending':'',currency=c.currency||'USD',issuedDate=chequeDateFromSeconds(c.issuedAt),dueDate=chequeDateFromDay(c.dueDay),number=c.chequeNumber||c.id,purpose=c.purposeDetail||c.note||'دفعة مصرفية',signatureVisual=authorizationSignatureMarkup(c,{legacyLabel:'شيك تاريخي سابق لنظام التوقيع المرئي'});
    return `<div class="document-card cheque-document-card"><article class="financial-paper cheque-paper authority-inspired cheque-instrument"><div class="cheque-security-pattern" aria-hidden="true"></div><header class="cheque-bank-row"><div class="cheque-bank-brand">${companyLogoMarkup(company,'small')}<div><small>DRAWEE BANK · المصرف المسحوب عليه</small><b>${esc(c.draweeBank||'Global Holdings Treasury Bank')}</b><span>${esc(c.paymentPlace||'المركز المالي الرئيسي')}</span></div></div><div class="cheque-title"><b>شيك</b><small>CHEQUE</small></div><div class="cheque-number"><span>رقم الشيك</span><b dir="ltr">${esc(number)}</b><span>التاريخ · ${esc(issuedDate)}</span></div></header><section class="cheque-order-row"><div><small>ادفعوا بموجب هذا الشيك دون قيد أو شرط لأمر / PAY TO THE ORDER OF</small><strong>${esc(beneficiary)}</strong></div><b class="cheque-numeric-amount" dir="ltr">${esc(currency)} ${Number(c.amount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b></section><div class="cheque-amount-words"><span>المبلغ كتابة / AMOUNT IN WORDS</span><b>${esc(amountInWords(c.amount,currency))}</b></div><div class="cheque-particulars"><div><span>الساحب / DRAWER</span><b>${esc(c.drawer||i.name)}</b></div><div><span>الحساب / ACCOUNT</span><b dir="ltr">${esc(c.accountId||i.account)}</b></div><div><span>مكان الإصدار</span><b>${esc(c.issuePlace||'الرياض، المملكة العربية السعودية')}</b></div><div><span>مكان الوفاء</span><b>${esc(c.paymentPlace||'المركز المالي الرئيسي')}</b></div><div><span>تاريخ الاستحقاق</span><b>${esc(dueDate)}</b></div><div><span>النوع والحالة</span><b><i class="doc-status ${statusClass}">${esc(c.status||'صادر')}</i> · ${esc(c.type||'شيك مصرفي')}</b></div><div><span>معرف المستفيد الرسمي</span><b dir="ltr">${esc(partner?.taxId||c.beneficiaryTaxId||'—')}</b></div></div><footer class="cheque-signature-row"><div class="cheque-memo-block"><span>سبب الشيك / PURPOSE</span><b>${esc(purpose)}</b><small>مرجع الفاتورة: ${esc(c.invoiceNumber||'—')}</small></div><div class="cheque-entity-seal"><b>${esc(i.mark)}</b><span>ختم الساحب</span></div><div class="cheque-signature"><span>توقيع الساحب المفوض</span>${signatureVisual}<small>AUTHORIZED VISUAL SEAL</small></div></footer><div class="cheque-micr" dir="ltr">⑆ ${esc(String(number).replace(/[^A-Z0-9-]/gi,''))} ⑆ ${esc(String(c.accountId||i.account).replace(/[^A-Z0-9-]/gi,''))} ⑈ ${esc(currency)}</div></article>${c.status==='صادر'?`<div class="action-row cheque-actions"><button class="primary-btn settle-cheque-now" data-id="${esc(c.id)}">صرف الشيك الآن</button><span class="section-mini">الإصدار وحده لا يخصم الرصيد؛ الخصم يتم عند الصرف.</span></div>`:''}</div>`;
  }
  function invoiceArt(d){const company=documentCompanyKey(d),counterparty=formalFinanceParty(d.counterparty,company,d.kind==='دخل'?'customer':'supplier'),party=legalPartyRecord(counterparty),statusClass=d.status==='شيك مرتجع'?'failed':(!['مسددة','محصلة','مدفوعة'].includes(d.status)?'pending':''),signatureVisual=authorizationSignatureMarkup(d,{legacyLabel:'فاتورة تاريخية سابقة لنظام التوقيع المرئي'});return `<div class="document-card"><div class="invoice-paper official-invoice-v316"><div class="doc-paper-head"><div class="doc-paper-brand">${companyLogoMarkup(company,'small')}<div><b>${esc(companyFinanceName(company))}</b><small>${esc(d.accountId||companyBook(company).accounts[0].id)}</small></div></div><span class="doc-number">${esc(d.number)}</span></div><div class="invoice-body"><div class="invoice-title">${d.kind==='دخل'?'فاتورة مبيعات':'فاتورة مورد / مصروف'}</div><div class="invoice-row"><span>الاسم الرسمي للطرف المقابل</span><strong>${esc(counterparty)}</strong></div><div class="invoice-row"><span>المعرف الرسمي / الضريبي</span><strong>${esc(party?.taxId||'—')}</strong></div><div class="invoice-row"><span>الوصف</span><strong>${esc(truncateText(d.note,56))}</strong></div><div class="invoice-row"><span>القيمة قبل الضريبة</span><strong>${fmtDocumentMoney(d.subtotal??Math.max(0,(d.total||0)-(d.tax||0)))}</strong></div><div class="invoice-row"><span>ضريبة القيمة المضافة</span><strong>${fmtDocumentMoney(d.tax||0)}</strong></div><div class="invoice-row"><span>طريقة السداد</span><strong>${esc(d.method||'تحويل بنكي')}</strong></div><div class="invoice-row invoice-total"><span>الإجمالي</span><strong>${fmtDocumentMoney(d.total)}</strong></div></div><div class="invoice-footer"><span class="doc-status ${statusClass}">${esc(d.status||'مدفوعة')}</span><span class="document-authorization-seal">${signatureVisual}</span><span>يوم ${Math.floor((d.at||0)/86400)+1}</span></div></div></div>`;}
  function collectionDetails(x){if(!x.collection)return '';return `<div class="authority-grid financial-grid collection-details"><div><span>قناة التحصيل</span><b>${esc(x.channel||'تحصيل تعاقدي')}</b></div><div><span>الإيراد الإجمالي</span><b>${fmtMoney(x.grossAmount??x.amount)}</b></div><div><span>تكاليف التسوية</span><b>${fmtMoney(x.deductions||0)}</b></div><div><span>رصيد مرحّل / غير مسوّى</span><b>${fmtMoney(x.carriedAdjustment||0)} / ${fmtMoney(x.shortfall||0)}</b></div><div><span>الفواتير المرتبطة</span><b>${esc((x.invoiceNumbers||[]).join(' · ')||'—')}</b></div><div><span>مراجع التشغيل والعقود</span><b>${esc((x.sourceRefs||[]).join(' · ')||'—')}</b></div></div>`;}
  function transferPurposeMeta(x,sandboxCover=false){
    if(sandboxCover)return {category:'تغطية وضع اللعب',detail:'تغطية داخلية بسبب تفعيل الأموال غير المحدودة؛ ليست حوالة من شركة أو مستثمر خارجي.',method:'قيد تمويل داخلي',documents:'—',refs:x.reference||x.id||'—'};
    const category=String(x.purposeCategory||x.label||({
      'revenue-collection':'تحصيل إيراد',
      'daily-operating-settlement':'تسوية تشغيل يومية',
      'payable-settlement':'سداد ذمة مورد',
      'cheque-settlement':'تسوية شيك',
      'intercompany':'تحويل بين شركات المجموعة',
      'debt-financing':'تمويل دين',
      'debt-repayment':'سداد دين',
      'founder-investment':'استثمار رأسمالي',
      'founder-withdrawal':'سحب رأسمالي'
    })[x.kind]||'حركة مالية');
    const detail=String(x.purposeDetail||x.note||x.service||'حركة مالية مسجلة');
    const method=String(x.paymentMethod||x.channel||(x.kind==='cheque-settlement'?'شيك مصرفي':'تحويل بنكي'));
    const documents=[x.documentNumber,...(x.invoiceNumbers||[])].filter(Boolean).join(' · ')||'—';
    const refs=(x.sourceRefs||[]).filter(Boolean).join(' · ')||x.chequeNumber||x.reference||x.id||'—';
    return {category,detail,method,documents,refs};
  }
  function transferArt(x){
    const company=documentCompanyKey(x),i=financeDocumentIdentity(company),ref=x.reference||x.id||`TR-${Math.floor(x.at||0)}-${String(Math.round(x.amount||0)).slice(-7)}`,
      sandboxCover=x.kind==='sandbox-capital-cover'||x.fundingSource==='sandbox-unlimited-money'||String(x.from||'')==='حقوق ملكية وضع اللعب',
      fromParty=x.fromPartyId?window.GH_BUSINESS_WORLD?.resolveParty?.(state,x.fromPartyId):null,toParty=x.toPartyId?window.GH_BUSINESS_WORLD?.resolveParty?.(state,x.toPartyId):null,
      dir=sandboxCover?{key:'incoming',label:'تغطية وضع اللعب',watermark:'GAME MODE'}:transferDirection(x,company),
      rawFrom=sandboxCover?'تمويل وضع اللعب':(fromParty?.legalName||fromParty?.displayName||accountOwnerLabel(x.from)),rawTo=toParty?.legalName||toParty?.displayName||accountOwnerLabel(x.to),
      fromName=formalFinanceParty(rawFrom,company,dir.key==='incoming'?'customer':'supplier'),toName=formalFinanceParty(rawTo,company,dir.key==='outgoing'?'supplier':'customer'),
      day=Math.floor((x.at||0)/86400)+1,status=x.status||(x.kind==='payroll-accrual'?'مستحقة':'منفذة'),statusClass=status==='منفذة'?'':status.includes('جزئي')||status.includes('مستحق')?'pending':'',purpose=transferPurposeMeta(x,sandboxCover),before=Number.isFinite(Number(x.accountBalanceBefore))?Number(x.accountBalanceBefore):null,after=Number.isFinite(Number(x.accountBalanceAfter))?Number(x.accountBalanceAfter):null,
      account=dir.key==='incoming'?(x.toAccount||x.to||i.account):(x.from||i.account),signed=dir.key==='incoming'?'+':dir.key==='outgoing'?'−':'',signatureVisual=authorizationSignatureMarkup(x,{legacyLabel:'حوالة تاريخية سابقة لنظام التوقيع المرئي'});
    return `<div class="document-card transfer-document-v316"><article class="financial-paper transfer-paper authority-inspired transfer-v316 ${dir.key}"><div class="financial-watermark">${dir.watermark}</div><header class="transfer-v316-head"><div class="transfer-v316-brand">${companyLogoMarkup(company,'small')}<div><small>GLOBAL HOLDINGS · TREASURY DOCUMENT</small><h3>${dir.label}</h3><p>${esc(i.name)}</p></div></div><div class="transfer-v316-ref"><span>مرجع العملية</span><b dir="ltr">${esc(ref)}</b><i class="doc-status ${statusClass}">${esc(status)}</i></div></header><section class="transfer-v316-hero"><div><span>قيمة الحركة</span><strong class="${dir.key}">${signed}${fmtDocumentMoney(x.netAmount??x.amount)}</strong><small>${esc(purpose.category)} · يوم القيمة ${day}</small></div><div><span>الحساب المتأثر</span><b dir="ltr">${esc(account||'—')}</b><small>${esc(purpose.method)}</small></div></section><section class="transfer-v316-parties"><div><span>${sandboxCover?'مصدر التغطية':'الآمر / Remitter'}</span><b>${esc(fromName)}</b><small dir="ltr">${esc(sandboxCover?'GAME-MODE-FUNDING':x.from||'—')}</small></div><div class="transfer-flow-mark">${dir.key==='incoming'?'←':dir.key==='outgoing'?'→':'⇄'}</div><div><span>المستفيد / Beneficiary</span><b>${esc(toName)}</b><small dir="ltr">${esc(x.to||'—')}</small></div></section><section class="transfer-v316-details"><div class="wide"><span>سبب الحركة المالية</span><b>${esc(purpose.category)}</b><small>${esc(purpose.detail)}</small></div><div><span>المستند المرتبط</span><b>${esc(purpose.documents)}</b></div><div><span>مرجع العقد / التشغيل</span><b dir="ltr">${esc(purpose.refs)}</b></div>${before!==null?`<div><span>الرصيد قبل</span><b>${fmtDocumentMoney(before)}</b></div><div><span>الرصيد بعد</span><b>${fmtDocumentMoney(after)}</b></div>`:''}</section>${collectionDetails(x)}<footer class="transfer-v316-footer"><span>${esc(ref)} · D${day}</span><span class="document-authorization-seal">${signatureVisual}</span><b>${sandboxCover?'قيد داخلي لوضع اللعب':'مستند مالي واحد مرتبط بالأستاذ والحساب'}</b></footer></article></div>`;
  }
  function payrollArt(report,company='all'){
    const lines=(report.lines||[]).filter(line=>company==='all'||line.company===company),total=lines.reduce((sum,line)=>sum+(Number(line.amount)||0),0),paid=lines.reduce((sum,line)=>sum+(Number(line.paid)||0),0),due=Math.max(0,total-paid),identity=financeDocumentIdentity(company==='all'?'group':company),signatureVisual=authorizationSignatureMarkup(report,{legacyLabel:'تقرير رواتب تاريخي سابق لنظام التوقيع المرئي'});
    return `<div class="document-card"><article class="financial-paper payroll-paper authority-inspired"><div class="financial-watermark">PAYROLL</div><header class="authority-head">${companyLogoMarkup(company==='all'?'group':company,'small')}<div><small>OFFICIAL PAYROLL REPORT · GLOBAL HOLDINGS</small><h3>تقرير صرف الرواتب</h3><p>${company==='all'?'المجموعة والشركات':esc(identity.name)}</p></div><strong>${esc(report.id)}</strong></header><div class="authority-meta"><span>شهر المحاكاة <b>${report.month||'—'}</b></span><span>يوم الصرف <b>27</b></span><span>الحالة <b class="doc-status ${due?'pending':''}">${due?'مسجل مع مستحق':'مصروف بالكامل'}</b></span></div><section class="financial-subject"><div><small>إجمالي المسير</small><h4>${fmtDocumentMoney(total)}</h4><p>توظيف الأصول ورواتبها محسوبة تلقائيًا من سجل الملكية الفعلي.</p></div><strong class="financial-amount positive">${fmtDocumentMoney(paid)}</strong></section><div class="payroll-lines">${lines.map(line=>`<div class="invoice-row"><span>${esc(line.companyName)} · ${fmtNumber(line.headcount||0)} موظف</span><strong>${fmtDocumentMoney(line.paid)}${line.due?` · مستحق ${fmtDocumentMoney(line.due)}`:''}</strong></div>`).join('')}</div><div class="authority-grid financial-grid"><div><span>إجمالي الرواتب</span><b>${fmtDocumentMoney(total)}</b></div><div><span>المصروف</span><b>${fmtDocumentMoney(paid)}</b></div><div><span>التمويل الآلي</span><b>${fmtDocumentMoney(lines.reduce((sum,line)=>sum+(Number(line.autoFunding)||0),0))}</b></div><div><span>المستحق</span><b>${fmtDocumentMoney(due)}</b></div></div><footer class="authority-footer"><span>${esc(report.id)} · يوم ${report.day}</span><span class="document-authorization-seal">${signatureVisual}</span></footer></article></div>`;
  }
  function taxSettlementArt(row){const company=documentCompanyKey(row),i=financeDocumentIdentity(company),day=Math.floor((Number(row.paidAt)||0)/86400)+1,signatureVisual=authorizationSignatureMarkup(row,{legacyLabel:'تسوية ضريبية تاريخية سابقة لنظام التوقيع المرئي'});return `<div class="document-card"><article class="financial-paper authority-inspired settlement-paper tax-settlement-paper"><div class="financial-watermark">TAX SETTLEMENT</div><header class="authority-head">${companyLogoMarkup(company,'small')}<div><small>OFFICIAL TAX SETTLEMENT · GLOBAL HOLDINGS</small><h3>ورقة تسوية ضريبية</h3><p>${esc(i.name)}</p></div><strong>${esc(row.settlementNumber||row.id)}</strong></header><div class="authority-meta"><span>الجهة الضريبية<b>${esc(row.taxAuthority||'هيئة الزكاة والضريبة والجمارك')}</b></span><span>الرقم الضريبي<b dir="ltr">${esc(row.taxNumber||'غير مسجل')}</b></span><span>الحالة<b class="doc-status">${esc(row.status||'مسددة بالكامل')}</b></span></div><section class="settlement-hero"><div><span>إجمالي التسوية</span><strong>${fmtDocumentMoney(row.amountPaid||0)}</strong></div><div><span>الفترات</span><b>${esc((row.periods||[]).join(' · ')||'—')}</b></div></section><div class="authority-grid financial-grid"><div><span>أصل الاستحقاق</span><b>${fmtDocumentMoney(row.originalAmount||0)}</b></div><div><span>التسويات</span><b>${fmtDocumentMoney(row.adjustments||0)}</b></div><div><span>المبلغ المسدد</span><b>${fmtDocumentMoney(row.amountPaid||0)}</b></div><div><span>المتبقي</span><b>${fmtDocumentMoney(row.remaining||0)}</b></div><div><span>الحساب المسدد منه</span><b dir="ltr">${esc(row.accountId||i.account)}</b></div><div><span>مرجع التحويل</span><b dir="ltr">${esc(row.paymentReference||'—')}</b></div><div><span>رقم القيد</span><b dir="ltr">${esc(row.journalEntryId||'—')}</b></div><div><span>يوم السداد</span><b>${day}</b></div></div><footer class="authority-footer"><span>${esc(row.id)} · محفوظ في سجل التسويات الضريبية</span><span class="document-authorization-seal">${signatureVisual}</span></footer></article></div>`;}
  function debtSettlementArt(row){const company=documentCompanyKey(row),i=financeDocumentIdentity(company),day=Math.floor((Number(row.paidAt)||0)/86400)+1,signatureVisual=authorizationSignatureMarkup(row,{legacyLabel:'تسوية دين تاريخية سابقة لنظام التوقيع المرئي'});return `<div class="document-card"><article class="financial-paper authority-inspired settlement-paper debt-settlement-paper"><div class="financial-watermark">DEBT SETTLEMENT</div><header class="authority-head">${companyLogoMarkup(company,'small')}<div><small>DEBT PAYMENT CONFIRMATION · GLOBAL HOLDINGS</small><h3>إشعار تسوية دين</h3><p>${esc(i.name)}</p></div><strong>${esc(row.reference||row.id)}</strong></header><section class="settlement-hero"><div><span>المبلغ المسدد</span><strong>${fmtDocumentMoney(row.amount||0)}</strong></div><div><span>الجهة الممولة</span><b>${esc(formalFinanceParty(row.lender,company,'supplier'))}</b></div></section><div class="authority-grid financial-grid"><div><span>الحساب</span><b dir="ltr">${esc(row.accountId||i.account)}</b></div><div><span>رقم القيد</span><b dir="ltr">${esc(row.journalEntryId||'—')}</b></div><div><span>الرصيد قبل</span><b>${fmtDocumentMoney(row.accountBalanceBefore||0)}</b></div><div><span>الرصيد بعد</span><b>${fmtDocumentMoney(row.accountBalanceAfter||0)}</b></div><div><span>الديون المخصصة</span><b>${esc((row.allocations||[]).map(x=>x.debtId).join(' · ')||'رصيد دين')}</b></div><div><span>يوم السداد</span><b>${day}</b></div></div><footer class="authority-footer"><span>${esc(row.reference||row.id)}</span><span class="document-authorization-seal">${signatureVisual}</span></footer></article></div>`;}
  function debtRecordCard(row){const company=documentCompanyKey(row),due=row.dueDay==null?'غير محدد':`يوم ${Number(row.dueDay)+1}`,outstanding=Number(row.outstanding)||0,preset=Math.max(1,Math.min(outstanding,25000000));return `<article class="list-item debt-register-card"><div class="list-item-head"><div><h3>${esc(row.type||'التزام تمويلي')}</h3><p>${esc(formalFinanceParty(row.lender,company,'supplier'))} · ${esc(row.id)}</p></div><span class="tag ${outstanding<=.005?'positive':''}">${esc(row.status||'قائم')}</span></div><div class="metric-row"><div><span>أصل الدين</span><b>${fmtMoney(row.originalAmount||0)}</b></div><div><span>القائم</span><b>${fmtMoney(outstanding)}</b></div><div><span>الاستحقاق</span><b>${due}</b></div><div><span>القيد</span><b>${esc(row.journalEntryId||'—')}</b></div></div>${outstanding>.005?`<div class="debt-payment-control"><label>مبلغ السداد<input class="debt-payment-amount" data-debt-id="${esc(row.id)}" type="number" min="1" max="${Math.ceil(outstanding)}" step="1000" value="${Math.round(preset)}"></label><button class="primary-btn repay-debt-record" data-company="${company}" data-debt-id="${esc(row.id)}">سداد هذا الدين</button></div>`:''}</article>`;}
  function renderProfitFlow(validCompany){
    const types=validCompany==='all'?['group',...(state.openedCompanies||[])].filter((v,i,a)=>a.indexOf(v)===i):[validCompany],allowed=new Set(types),arrivals=(state.finance.transfers||[]).filter(x=>{const company=x.beneficiaryCompany||x.company,kind=String(x.kind||''),profitTagged=/ربح|أرباح|profit/i.test([x.purposeCategory,x.purposeDetail,x.note,x.label].filter(Boolean).join(' ')),cashArrival=x.collection===true&&['revenue-collection','daily-operating-settlement','intercompany-interest'].includes(kind);return allowed.has(company)&&Number(x.amount)>0&&(cashArrival||profitTagged);}).sort((a,b)=>(Number(b.at)||0)-(Number(a.at)||0)).slice(0,60),totals=types.map(type=>({type,amount:arrivals.filter(x=>(x.beneficiaryCompany||x.company)===type).reduce((n,x)=>n+(Number(x.amount)||0),0),count:arrivals.filter(x=>(x.beneficiaryCompany||x.company)===type).length})).filter(x=>x.count);
    if(!arrivals.length)return '<div class="empty">لا توجد حوالات أرباح أو تحصيلات داخلة للحساب حتى الآن.</div>';
    return `<article class="list-item profit-arrivals-intro"><div class="list-item-head"><div><h3>حوالات الأرباح الواردة</h3><p>هذا القسم يعرض فقط الحركات النقدية التي دخلت فعليًا من التشغيل أو التحصيل. لا يعرض الربح المحاسبي غير المحصل.</p></div><span class="tag positive">${arrivals.length} حركة</span></div><div class="profit-arrival-summary">${totals.map(x=>`<div>${companyLogoMarkup(x.type,'tiny')}<span>${esc(companyFinanceName(x.type))}<small>${x.count} حوالة</small></span><b>${fmtMoney(x.amount)}</b></div>`).join('')}</div></article><div class="profit-arrival-list">${arrivals.map(x=>{const company=x.beneficiaryCompany||x.company,account=companyBook(company).accounts[0],sourceParty=x.fromPartyId?window.GH_BUSINESS_WORLD?.resolveParty?.(state,x.fromPartyId):null,source=formalFinanceParty(sourceParty?.legalName||sourceParty?.displayName||x.from,company,'customer'),purpose=transferPurposeMeta(x,false),day=Math.floor((Number(x.at)||0)/86400)+1,signatureVisual=authorizationSignatureMarkup(x,{legacyLabel:'حوالة أرباح تاريخية سابقة لنظام التوقيع المرئي'});return `<article class="profit-arrival-card"><header><div>${companyLogoMarkup(company,'small')}<span><b>${esc(companyFinanceName(company))}</b><small>${esc(x.reference||x.id||'—')}</small></span></div><i class="doc-status">${esc(x.status||'منفذة')}</i></header><section><div><span>وصل إلى الحساب</span><strong>+${fmtMoney(x.netAmount??x.amount)}</strong><small dir="ltr">${esc(x.toAccount||x.to||account.id)}</small></div><div><span>مصدر الحوالة</span><b>${esc(source)}</b><small>${esc(purpose.category)} · يوم ${day}</small></div></section><footer><span>${esc(purpose.detail)}</span><span class="document-authorization-seal">${signatureVisual}</span><b>${esc(purpose.method)}</b></footer></article>`;}).join('')}</div>`;
  }

  function taxAccrualPreview(company){const b=companyBook(company),v=b?.vat||{},output=Math.max(0,(Number(v.output)||0)-(Number(v.periodOutputStart)||0)),input=Math.max(0,(Number(v.input)||0)-(Number(v.periodInputStart)||0)),credit=Math.max(0,Number(v.creditCarry)||0);return {output,input,credit,net:Math.max(0,output-input-credit)};}
  function renderInvoices(arg){
    const company=typeof arg==='object'?arg.company:arg||'all',rawTab=typeof arg==='object'?(arg.tab||'overview'):'overview',validCompany=isFinanceCompany(company)?company:'all';
    let tab=rawTab,view=typeof arg==='object'?(arg.view||''):'',direction=typeof arg==='object'?(arg.direction||'all'):'all';
    const legacy={all:['overview',''],collections:['profits',''],profitFlow:['profits',''],cheques:['documents','cheques'],invoices:['documents','invoices'],transfers:['documents','transfers'],incoming:['documents','transfers','incoming'],outgoing:['documents','transfers','outgoing'],internal:['documents','transfers','internal'],payroll:['documents','payroll'],receivables:['obligations','receivables']};
    if(legacy[tab]){const map=legacy[tab];tab=map[0];view=view||map[1];direction=map[2]||direction;}if(!['overview','documents','obligations','profits'].includes(tab))tab='overview';
    const docs=(state.finance.invoices||[]).filter(d=>validCompany==='all'||(d.company||'group')===validCompany),cheques=(state.finance.cheques||[]).filter(d=>validCompany==='all'||(d.company||'group')===validCompany),transfers=(state.treasury.ledger||[]).filter(x=>validCompany==='all'||x.company===validCompany||String(x.from||'').startsWith(validCompany==='group'?'GH':validCompany.toUpperCase())||String(x.to||'').startsWith(validCompany==='group'?'GH':validCompany.toUpperCase())).slice(0,60),payrollReports=(state.finance.payrollReports||[]).filter(report=>validCompany==='all'||(report.lines||[]).some(line=>line.company===validCompany)),ar=(state.finance.receivables||[]).filter(d=>validCompany==='all'||(d.company||'group')===validCompany),ap=(state.finance.payables||[]).filter(d=>validCompany==='all'||(d.company||'group')===validCompany),periods=(state.finance.periods||[]).filter(d=>validCompany==='all'||(d.company||'group')===validCompany),taxSettlements=(state.finance.taxSettlements||[]).filter(d=>validCompany==='all'||(d.company||'group')===validCompany),debtRecords=(state.finance.debtRecords||[]).filter(d=>validCompany==='all'||(d.company||'group')===validCompany),debtSettlements=(state.finance.debtSettlements||[]).filter(d=>validCompany==='all'||(d.company||'group')===validCompany);
    const tabs=[['overview','نظرة عامة'],['documents','المستندات'],['obligations','الالتزامات'],['profits','الأرباح']];let body='';
    if(tab==='overview'){const dueTax=periods.filter(x=>x.status==='مستحق').reduce((n,x)=>n+(Number(x.amount)||0),0),openDebt=debtRecords.reduce((n,x)=>n+(Number(x.outstanding)||0),0);body=`<article class="list-item finance-clean-overview"><div class="list-item-head"><div><h3>المركز المالي</h3><p>أربع مساحات فقط: مستندات، التزامات، أرباح، وملخص. كل عملية لها سجل واحد دون تكرار.</p></div><span class="tag positive">CLEAN LEDGER</span></div><div class="finance-clean-kpis"><div><span>ذمم لنا</span><b>${fmtMoney(ar.reduce((s,x)=>s+(Number(x.total)||0),0))}</b></div><div><span>ذمم علينا</span><b>${fmtMoney(ap.reduce((s,x)=>s+(Number(x.total)||0),0))}</b></div><div><span>ضرائب مستحقة</span><b>${fmtMoney(dueTax)}</b></div><div><span>ديون قائمة</span><b>${fmtMoney(openDebt)}</b></div></div></article><article class="list-item"><h3>حالة السجلات</h3><div class="metric-row"><div><span>فواتير</span><b>${docs.length}</b></div><div><span>شيكات</span><b>${cheques.length}</b></div><div><span>تحويلات</span><b>${transfers.length}</b></div><div><span>تسويات ضريبية</span><b>${taxSettlements.length}</b></div></div></article>`;}
    if(tab==='documents'){
      view=['transfers','cheques','invoices','payroll','settlements'].includes(view)?view:'transfers';
      const typeSelect=`<article class="list-item finance-compact-filter"><div><h3>المستندات الرسمية</h3><p>اختر نوع السجل من قائمة واحدة بدل ازدحام الأزرار.</p></div><label>نوع المستند<select id="financeDocumentType"><option value="transfers" ${view==='transfers'?'selected':''}>الحوالات</option><option value="cheques" ${view==='cheques'?'selected':''}>الشيكات</option><option value="invoices" ${view==='invoices'?'selected':''}>الفواتير</option><option value="payroll" ${view==='payroll'?'selected':''}>تقارير الرواتب</option><option value="settlements" ${view==='settlements'?'selected':''}>التسويات الرسمية</option></select></label></article>`;
      if(view==='transfers'){direction=['all','incoming','outgoing','internal'].includes(direction)?direction:'all';const filtered=direction==='all'?transfers:transfers.filter(x=>transferDirection(x,documentCompanyKey(x)).key===direction);body=`${typeSelect}<article class="list-item finance-inline-filter"><label>اتجاه الحوالة<select id="financeTransferDirection"><option value="all" ${direction==='all'?'selected':''}>الكل</option><option value="incoming" ${direction==='incoming'?'selected':''}>واردة</option><option value="outgoing" ${direction==='outgoing'?'selected':''}>صادرة</option><option value="internal" ${direction==='internal'?'selected':''}>داخلية</option></select></label><span class="tag">${filtered.length}</span></article>${filtered.length?`<div class="doc-art-grid">${filtered.map(transferArt).join('')}</div>`:'<div class="empty">لا توجد حوالات مطابقة.</div>'}`;}
      if(view==='cheques'){const issueCompany=validCompany==='all'?'group':validCompany,currentDay=Math.floor((state.simSeconds||0)/86400),partnerNames=strategicPartners.map(p=>p.legalName||p.name);body=`${typeSelect}<article class="list-item cheque-issuer-v316"><div class="list-item-head"><div><h3>إصدار شيك مصرفي</h3><p>الاسم القانوني للمستفيد إلزامي. الإصدار لا يخصم النقد؛ الخصم يحدث عند صرف الشيك فقط.</p></div><span class="tag">OFFICIAL PAYEE</span></div><div class="company-transfer-form cheque-issue-form"><label>الشركة<select id="chequeCompany">${['group',...(state.openedCompanies||[])].filter((v,i,a)=>a.indexOf(v)===i).map(t=>`<option value="${t}" ${t===issueCompany?'selected':''}>${esc(companyFinanceName(t))}</option>`).join('')}</select></label><label>المبلغ<input id="chequeAmount" type="number" min="1" step="1000" value="1000000"></label><label>الاسم القانوني للمستفيد<input id="chequeBeneficiary" list="chequeBeneficiaries" maxlength="120" value="${esc(partnerNames[0]||'')}" placeholder="الاسم الرسمي الكامل"><datalist id="chequeBeneficiaries">${partnerNames.map(name=>`<option value="${esc(name)}"></option>`).join('')}</datalist></label><label>سبب الشيك<input id="chequeNote" maxlength="120" value="سداد التزام تجاري"></label><label>يوم الاستحقاق<input id="chequeDueDay" type="number" min="${currentDay}" value="${currentDay}"></label><label>المصرف المسحوب عليه<input id="chequeDraweeBank" maxlength="90" value="Global Holdings Treasury Bank"></label><label>مكان الإصدار<input id="chequeIssuePlace" maxlength="90" value="الرياض، المملكة العربية السعودية"></label></div><div class="action-row"><button class="primary-btn create-cheque-doc">إصدار الشيك</button></div></article>${cheques.length?`<div class="doc-art-grid cheque-grid-wide">${cheques.slice(0,80).map(chequeArt).join('')}</div>`:'<div class="empty">لا توجد شيكات لهذا الكيان.</div>'}`;}
      if(view==='invoices'){const issueCompany=validCompany==='all'?'group':validCompany;body=`${typeSelect}<article class="list-item"><h3>إصدار فاتورة / مطالبة</h3><p>الطرف المقابل يُحفظ باسمه القانوني، والفاتورة المستحقة تُنشئ ذمة واحدة فقط.</p><div class="company-transfer-form"><label>الشركة<select id="invoiceCompany">${['group',...(state.openedCompanies||[])].filter((v,i,a)=>a.indexOf(v)===i).map(t=>`<option value="${t}" ${t===issueCompany?'selected':''}>${esc(companyFinanceName(t))}</option>`).join('')}</select></label><label>النوع<select id="invoiceKind"><option value="دخل">فاتورة عميل</option><option value="مصروف">فاتورة مورد</option></select></label><label>المبلغ الإجمالي<input id="invoiceAmount" type="number" min="1" step="1000" value="1000000"></label><label>الاسم القانوني للطرف المقابل<input id="invoiceCounterparty" list="invoiceCounterparties" maxlength="120" value="${esc(strategicPartners[0]?.legalName||strategicPartners[0]?.name||'')}" placeholder="الاسم الرسمي الكامل"><datalist id="invoiceCounterparties">${strategicPartners.map(p=>`<option value="${esc(p.legalName||p.name)}"></option>`).join('')}</datalist></label><label>الوصف<input id="invoiceNote" maxlength="100" value="خدمات تشغيلية"></label></div><div class="action-row"><button class="primary-btn create-invoice-doc">إصدار الفاتورة</button></div></article>${docs.length?`<div class="doc-art-grid">${docs.slice(0,80).map(invoiceArt).join('')}</div>`:'<div class="empty">لا توجد فواتير لهذا الكيان.</div>'}`;}
      if(view==='payroll')body=`${typeSelect}${payrollReports.length?`<div class="doc-art-grid">${payrollReports.slice(0,40).map(report=>payrollArt(report,validCompany)).join('')}</div>`:'<div class="empty">سيظهر تقرير الرواتب عند إنشاء مسير فعلي.</div>'}`;
      if(view==='settlements'){const official=[...taxSettlements.map(row=>({kind:'tax',row})),...debtSettlements.map(row=>({kind:'debt',row}))].sort((a,b)=>(Number(b.row.paidAt)||0)-(Number(a.row.paidAt)||0)).slice(0,60);body=`${typeSelect}<article class="list-item"><div class="list-item-head"><div><h3>التسويات الرسمية المحفوظة</h3><p>عرض موحد لنفس مستندات التسوية الأصلية دون إنشاء نسخ مكررة.</p></div><span class="tag">${official.length}</span></div></article>${official.length?`<div class="doc-art-grid">${official.map(item=>item.kind==='tax'?taxSettlementArt(item.row):debtSettlementArt(item.row)).join('')}</div>`:'<div class="empty">لا توجد تسويات رسمية محفوظة بعد.</div>'}`;}
    }
    if(tab==='obligations'){
      view=['payables','receivables','taxes','debts'].includes(view)?view:'payables';const selector=`<article class="list-item finance-compact-filter"><div><h3>الالتزامات والتسويات</h3><p>الذمم والضرائب والديون في سجل واضح واحد؛ لا تُخلط مع المستندات.</p></div><label>نوع الالتزام<select id="financeObligationType"><option value="payables" ${view==='payables'?'selected':''}>ذمم علينا</option><option value="receivables" ${view==='receivables'?'selected':''}>ذمم لنا</option><option value="taxes" ${view==='taxes'?'selected':''}>الضرائب والتسويات</option><option value="debts" ${view==='debts'?'selected':''}>الديون والتمويل</option></select></label></article>`;
      if(view==='receivables')body=`${selector}${ar.length?`<article class="list-item"><div class="list-item-head"><h3>الذمم المدينة</h3><span class="tag">${ar.length}</span></div>${ar.slice(0,80).map(x=>`<div class="department-row"><span>${esc(x.number)}<small>${esc(formalFinanceParty(x.counterparty,x.company||'group','customer'))} · ${esc(x.note)} · ${fmtMoney(x.total||x.amount)}</small></span><button class="secondary-btn collect-receivable" data-number="${x.number}">تحصيل الذمة</button></div>`).join('')}</article>`:'<div class="empty">لا توجد ذمم مدينة مفتوحة.</div>'}`;
      if(view==='payables')body=`${selector}${ap.length?`<article class="list-item"><div class="list-item-head"><div><h3>الذمم الدائنة</h3><p>كل ذمة تُسدد بتحويل واحد أو بشيك واحد؛ لا يوجد تنفيذ مزدوج.</p></div><span class="tag">${ap.length}</span></div>${ap.slice(0,80).map(x=>{const issued=(state.finance.cheques||[]).find(ch=>ch.invoiceNumber===x.number&&ch.status==='صادر');return `<div class="department-row payable-method-row"><span>${esc(x.number)}<small>${esc(formalFinanceParty(x.counterparty,x.company||'group','supplier'))} · ${esc(x.note)} · ${fmtMoney(x.total||x.amount)}</small></span>${issued?`<div><span class="tag">شيك صادر · ${esc(issued.id)}</span><button class="secondary-btn settle-cheque-now" data-id="${esc(issued.id)}">صرف الشيك</button></div>`:`<div class="action-row compact"><button class="secondary-btn settle-payable-transfer" data-number="${x.number}">تحويل بنكي</button><button class="primary-btn issue-payable-cheque" data-number="${x.number}">إصدار شيك</button></div>`}</div>`;}).join('')}</article>`:'<div class="empty">لا توجد ذمم دائنة مفتوحة.</div>'}`;
      if(view==='taxes'){const due=periods.filter(x=>x.status==='مستحق'),dueTotal=due.reduce((n,x)=>n+(Number(x.amount)||0),0),taxTypes=(validCompany==='all'?companyFinanceTypes(state,{openedOnly:true}):[validCompany]).filter((v,i,a)=>a.indexOf(v)===i),accrualRows=taxTypes.map(type=>({type,preview:taxAccrualPreview(type),due:periods.filter(x=>(x.company||'group')===type&&x.status==='مستحق').reduce((n,x)=>n+(Number(x.amount)||0),0),paid:Number(companyBook(type).taxPaid)||0})),accruedTotal=accrualRows.reduce((n,x)=>n+x.preview.net,0),recentPeriods=[...periods].sort((a,b)=>(Number(b.dueDay)||0)-(Number(a.dueDay)||0)).slice(0,24);body=`${selector}<article class="list-item tax-obligation-card"><div class="list-item-head"><div><h3>الضرائب والتسويات</h3><p>تظهر الضريبة المتراكمة مباشرة حتى قبل نهاية الشهر، ثم تتحول عند الإقفال إلى التزام مستحق قابل للسداد.</p></div><span class="tag ${dueTotal?'negative':accruedTotal?'':'positive'}">مستحق ${fmtMoney(dueTotal)}</span></div><div class="finance-clean-kpis tax-live-kpis"><div><span>متراكم قبل الإقفال</span><b>${fmtMoney(accruedTotal)}</b></div><div><span>مستحق رسمي</span><b>${fmtMoney(dueTotal)}</b></div><div><span>فترات مسجلة</span><b>${periods.length}</b></div><div><span>تسويات محفوظة</span><b>${taxSettlements.length}</b></div></div>${accrualRows.map(row=>`<div class="tax-company-live-row"><span>${companyLogoMarkup(row.type,'tiny')}<b>${esc(companyFinanceName(row.type))}</b><small>مخرجات ${fmtMoney(row.preview.output)} · مدخلات ${fmtMoney(row.preview.input)} · رصيد مرحّل ${fmtMoney(row.preview.credit)}</small></span><strong>متراكم ${fmtMoney(row.preview.net)}<small>مستحق ${fmtMoney(row.due)}</small></strong>${row.due>0?`<button class="primary-btn pay-taxes" data-company="${row.type}">تسديد الضريبة</button>`:''}</div>`).join('')}<p class="section-mini">إذا لم ينتهِ الشهر بعد يظهر المتراكم فقط. بعد الإقفال الشهري يظهر الالتزام الرسمي وموعد الاستحقاق تلقائيًا.</p></article><article class="list-item"><div class="list-item-head"><div><h3>الفترات الضريبية</h3><p>حتى الفترات ذات الرصيد صفر تبقى ظاهرة حتى تعرف أن الإقفال الضريبي تم فعلًا.</p></div><span class="tag">${recentPeriods.length}</span></div>${recentPeriods.length?recentPeriods.map(x=>`<div class="spec-row"><span>${esc(x.period)}<small>${esc(x.id)} · ${esc(companyFinanceName(x.company||'group'))} · الاستحقاق يوم ${Number(x.dueDay)+1}</small></span><b>${fmtMoney(x.amount)} · ${esc(x.status||'—')}</b></div>`).join(''):'<p class="section-mini">لا توجد فترة مقفلة بعد؛ سيظهر أول إقفال عند نهاية الشهر التقويمي.</p>'}</article>${taxSettlements.length?`<div class="doc-art-grid">${taxSettlements.slice(0,30).map(taxSettlementArt).join('')}</div>`:'<div class="empty">لا توجد تسويات ضريبية محفوظة بعد.</div>'}`;}
      if(view==='debts'){const openTotal=debtRecords.reduce((n,x)=>n+(Number(x.outstanding)||0),0);body=`${selector}<article class="list-item"><div class="list-item-head"><div><h3>سجل الديون</h3><p>كل دين يُسدد من بطاقته وبالمبلغ الذي تحدده. السداد يخصم مرة واحدة من حساب الشركة ويصدر قيدًا وإشعار تسوية مرتبطين بنفس الدين.</p></div><span class="tag ${openTotal?'negative':'positive'}">قائم ${fmtMoney(openTotal)}</span></div></article>${debtRecords.length?debtRecords.slice(0,40).map(debtRecordCard).join(''):'<div class="empty">لا توجد التزامات تمويلية مسجلة.</div>'}${debtSettlements.length?`<article class="list-item"><h3>تسويات الدين المنفذة</h3></article><div class="doc-art-grid">${debtSettlements.slice(0,30).map(debtSettlementArt).join('')}</div>`:''}`;}
    }
    if(tab==='profits')body=renderProfitFlow(validCompany);
    const companyOptions=['all','group',...(state.openedCompanies||[])].filter((v,i,a)=>a.indexOf(v)===i).map(t=>`<option value="${t}" ${t===validCompany?'selected':''}>${t==='all'?'كل الشركات':esc(companyFinanceName(t))}</option>`).join('');
    return `<div class="list finance-documents finance-documents-v316"><article class="list-item finance-doc-hub-v316"><div class="list-item-head"><div><h3>المالية والمستندات</h3><p>واجهة مختصرة دون تكرار: كل زر ينفذ وظيفة واحدة، وكل حركة تحفظ في سجلها الأصلي.</p></div><span class="tag positive">FINANCE</span></div><label class="finance-doc-entity">الكيان<select id="financeDocsCompany" data-tab="${tab}" data-view="${view}" data-direction="${direction}">${companyOptions}</select></label><div class="finance-doc-tabs finance-doc-tabs-v316">${tabs.map(([id,label])=>`<button class="finance-doc-tab ${tab===id?'active':''}" type="button" aria-pressed="${tab===id}" data-tab="${id}" data-company="${validCompany}">${label}</button>`).join('')}</div></article>${body}</div>`;
  }



  function renderAssetManage(id){
    const source=state.assets.find(x=>x.id===id);if(!source)return '<div class="empty">الأصل غير موجود.</div>';const a=normalizedAssetView(source),tpl=routeTemplates[a.routeId];
    const eco=a.lastTrip;
    const cat=catalogItem(a.type,a.catalogId);
    return `<div class="list"><article class="list-item sector-${a.type}">
    ${cat&&cat.photo?`<div class="asset-thumb"><img src="${cat.photo}" alt="${a.name}" loading="lazy"></div>`:''}
    <div class="list-item-head"><div><h3>${a.icon} ${a.name}</h3><p>${a.model||typeName(a.type)} · سنة ${a.year||2026}</p></div><span class="tag">حالة ${a.condition.toFixed(1)}%</span></div><div class="metric-row"><div><span>الوقود</span><b>${Math.round(a.fuel)}%</b></div><div><span>المسار</span><b>${tpl?tpl.name:'غير معين'}</b></div><div><span>الوضع</span><b>${assetStatus(a)}</b></div></div><div class="metric-row"><div><span>الملكية</span><b>${a.ownership==='lease'?'تأجير تشغيلي':a.ownership==='finance'?'تمويل':'مملوك'}</b></div><div><span>القيمة الأصلية</span><b>${fmtMoney(a.purchasePrice||cat?.price||0)}</b></div><div><span>الالتزام الشهري</span><b>${a.ownership==='lease'?fmtMoney(a.monthlyLease):'—'}</b></div></div></article>
    ${eco?`<article class="list-item"><h3>تفصيل آخر دورة تشغيل</h3><div class="metric-row"><div><span>الإيراد</span><b class="positive">${fmtMoney(eco.revenue)}</b></div><div><span>الوقود</span><b class="negative">-${fmtMoney(eco.fuelCost)}</b></div><div><span>الراتب الثابت</span><b>${fmtMoney(eco.fixedMonthlyPayroll||a.staffing?.monthlyPayroll||0)}/شهر</b></div></div><div class="metric-row two" style="margin-top:6px"><div><span>احتياطي صيانة</span><b class="negative">-${fmtMoney(eco.maintReserve)}</b></div><div><span>هامش الرحلة قبل مسير 27</span><b class="${eco.margin>=0?'positive':'negative'}">${fmtMoney(eco.margin)}</b></div></div></article>`:''}
    <article class="list-item"><div class="list-item-head"><div><h3>الطاقم الثابت والراتب</h3><p>أُنشئ تلقائيًا مع التسليم، وهو جزء من الأصل ولا يحتاج إلى إجراء في HR.</p></div><span class="tag ${a.staffing?.ready?'positive':'negative'}">${a.staffing?.ready?'جاهز':'غير مكتمل'}</span></div><div class="metric-row"><div><span>إجمالي الطاقم</span><b>${fmtNumber(a.staffing?.total||0)}</b></div><div><span>الراتب الشهري</span><b>${fmtMoney(a.staffing?.monthlyPayroll||0)}</b></div><div><span>العقد</span><b>${esc(a.staffing?.contractId||'—')}</b></div></div>${(a.staffing?.roles||[]).map(role=>`<div class="spec-row"><span>${esc(role.name)}</span><b>${fmtNumber(role.count)} · ${fmtMoney(role.monthlyPayroll)}/شهر</b></div>`).join('')}</article>
    ${a.simulationFault?`<article class="list-item danger-zone"><h3>عزل وقائي لهذا الأصل فقط</h3><p class="warning">أوقف المحرك هذا الأصل بعد خلل محلي (${esc(a.simulationFault.code||'ASSET_SIMULATION_ISOLATED')}) كي تبقى بقية الشركات واللعبة عاملة. نفّذ الصيانة أو أعد تعيين مساره لإزالة العزل بعد الفحص.</p><small>${esc(a.simulationFault.detail||'لم تتوفر تفاصيل إضافية.')}</small></article>`:''}
    <div class="action-row"><button class="primary-btn" data-open="routes" data-arg="${esc(a.type)}">${a.routeId?'فتح مسار الأصل':'اختيار مسار من مركز المسارات'}</button>${a.type==='road'&&!a.routeId&&a.phase!=='moving'&&!a.salePending?`<button class="secondary-btn depart-now" data-id="${a.id}">تشغيل بمسار تلقائي</button>`:''}${a.phase==='turnaround'&&a.routeId&&!a.departureScheduled?`<button class="secondary-btn depart-now" data-id="${a.id}">غادر الآن</button>`:''}<button class="secondary-btn focus-owned-asset" data-id="${a.id}">عرض على الخريطة</button><button class="secondary-btn service-asset" data-id="${a.id}" ${a.phase==='moving'?'disabled':''}>صيانة وتعبئة</button><button class="danger-soft sell-asset" data-id="${a.id}" ${a.salePending?'disabled':''}>${a.salePending?'أمر البيع قيد العودة':'بيع الأصل'}</button></div>${a.salePending?'<p class="warning">أمر البيع نشط: سيكمل الأصل الرحلة الحالية فقط، ثم يتوقف في مركز/قاعدة الوصول ويباع تلقائيًا. لن يتم البيع أثناء الرحلة.</p>':a.phase==='moving'?'<p class="warning">الصيانة وتغيير المسار مقفلان أثناء الحركة. يمكنك إصدار أمر بيع وسيتم التنفيذ تلقائيًا بعد الوصول.</p>':''}</div>`;
  }
  function renderMobilityAsset(id){
    const vehicle=window.GH_MOBILITY_CORE?.findVehicle?.(state,id);if(!vehicle)return '<div class="empty">سيارة Mobility غير موجودة.</div>';
    const center=window.GH_MOBILITY_CORE?.centerMeta?.(state,vehicle.centerId),trip=(state.mobility?.activeTrips||[]).find(row=>row.vehicleId===vehicle.id),driver=(state.mobility?.drivers||[]).find(row=>row.id===(trip?.driverId||vehicle.driverId)||row.assetId===vehicle.id)||null;
    return `<div class="list"><article class="list-item sector-mobility"><div class="list-item-head"><div><h3>${vehicle.icon||'🚙'} ${esc(vehicle.name)}</h3><p>${esc(vehicle.model||vehicle.assetClass)} · ${esc(center?.city||vehicle.baseLocation||'—')}</p></div><span class="tag ${vehicle.status==='moving'?'positive':''}">${vehicle.status==='moving'?'في رحلة':'متاحة'}</span></div><div class="metric-row"><div><span>الحالة</span><b>${Math.round(vehicle.condition||0)}%</b></div><div><span>البطارية</span><b>${Math.round(vehicle.battery||0)}%</b></div><div><span>الرحلات</span><b>${fmtNumber(vehicle.totalTrips||0)}</b></div><div><span>المسافة</span><b>${fmtNumber(vehicle.totalKm||0)} كم</b></div></div><div class="metric-row"><div><span>المركز</span><b>${esc(center?.city||'—')}</b></div><div><span>السائق الثابت</span><b>${esc(driver?.name||'مخصص تلقائيًا')}</b></div><div><span>الراتب الشهري</span><b>${fmtMoney(6000)}</b></div></div>${trip?`<div class="spec-row"><span>الرحلة الحالية</span><b>${Math.round((trip.progress||0)*100)}% · ${fmtNumber(trip.distanceKm||0)} كم</b></div>`:''}</article><div class="action-row"><button class="primary-btn focus-mobility-asset" data-id="${esc(vehicle.id)}">عرض على الخريطة</button><button class="secondary-btn service-mobility-asset" data-id="${esc(vehicle.id)}" ${vehicle.status==='moving'?'disabled':''}>صيانة وشحن</button><button class="danger-soft sell-mobility-asset" data-id="${esc(vehicle.id)}" ${vehicle.status==='moving'?'disabled':''}>بيع السيارة</button></div>${vehicle.status==='moving'?'<p class="warning">الصيانة والبيع مقفلان حتى تنتهي الرحلة الحالية.</p>':''}</div>`;
  }
  let buttonOperationSequence=0;
  function beginButtonOperation(button,label='جارٍ التنفيذ…'){
    if(!button||!button.isConnected||button.disabled||button.dataset.busy)return null;
    const previous={disabled:button.disabled,text:button.textContent},token=`busy-${++buttonOperationSequence}`;
    button.dataset.busy=token;button.disabled=true;button.setAttribute('aria-busy','true');if(label)button.textContent=label;
    return ()=>{if(!button.isConnected||button.dataset.busy!==token)return;delete button.dataset.busy;button.disabled=previous.disabled;button.removeAttribute('aria-busy');button.textContent=previous.text;};
  }
  function yieldForInteractivePaint(timeoutMs=80){
    return new Promise(resolve=>{
      let done=false,timer=null;
      const finish=()=>{if(done)return;done=true;if(timer!==null)clearTimeout(timer);resolve();};
      timer=setTimeout(finish,Math.max(0,Number(timeoutMs)||0));
      try{if(typeof requestAnimationFrame==='function')requestAnimationFrame(finish);else finish();}catch(_error){finish();}
    });
  }
  function bindDrawerActions(){
    document.querySelectorAll('[data-open]').forEach(b=>{b.dataset.interactionBound='1';b.addEventListener('click',()=>globalThis.GH_INTERACTION?.run?globalThis.GH_INTERACTION.run(b,()=>openDrawer(b.dataset.open,b.dataset.arg||undefined),{action:`open:${b.dataset.open}`,state}):openDrawer(b.dataset.open,b.dataset.arg||undefined));});
    const god1=$('drawerGodBtn'),god2=$('moreGodBtn'); if(god1)god1.addEventListener('click',openGod); if(god2)god2.addEventListener('click',openGod);
    document.querySelectorAll('.inspect-contract').forEach(b=>b.addEventListener('click',()=>inspectContract(b.dataset.id)));
    document.querySelectorAll('.bid-contract').forEach(b=>b.addEventListener('click',()=>bidContract(b.dataset.id)));
    document.querySelectorAll('.diligence').forEach(b=>{b.dataset.interactionBound='1';b.addEventListener('click',()=>globalThis.GH_INTERACTION?.run?globalThis.GH_INTERACTION.run(b,()=>dueDiligence(b.dataset.id),{action:'ma-due-diligence',state}):dueDiligence(b.dataset.id));});
    document.querySelectorAll('.acquire-stake').forEach(b=>{b.dataset.interactionBound='1';b.addEventListener('click',()=>globalThis.GH_INTERACTION?.run?globalThis.GH_INTERACTION.run(b,()=>acquireStake(b.dataset.id,Number(b.dataset.stake)),{action:'ma-acquire-stake',state}):acquireStake(b.dataset.id,Number(b.dataset.stake)));});
    document.querySelectorAll('.hire').forEach(b=>b.addEventListener('click',()=>hire(b.dataset.id)));
    document.querySelectorAll('.buy-stock').forEach(b=>b.addEventListener('click',()=>tradeStock(b.dataset.id,1000)));
    document.querySelectorAll('.sell-stock').forEach(b=>b.addEventListener('click',()=>tradeStock(b.dataset.id,-1000)));
    document.querySelectorAll('.compare-asset').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.id;if(marketCompare.includes(id))marketCompare=marketCompare.filter(x=>x!==id);else if(marketCompare.length<3)marketCompare.push(id);else{notice('يمكن مقارنة ثلاثة أصول كحد أقصى.');return;}renderAssetMarketInto();}));
    document.querySelectorAll('.open-branch').forEach(b=>b.addEventListener('click',()=>{const release=beginButtonOperation(b,'جارٍ فتح المقر…');if(!release)return;try{openBranch(b.dataset.id);}finally{release();}}));
    document.querySelectorAll('.open-directory-site').forEach(b=>b.addEventListener('click',async()=>{if(activeDrawerPanel!=='network')return;const release=beginButtonOperation(b,'جارٍ إنشاء المنشأة…');if(!release)return;try{await openDirectorySite(b.dataset.key,{company:b.dataset.company,energyKind:b.dataset.energyKind,quote:b.dataset.quote});}finally{release();}}));
    document.querySelectorAll('.open-facility-directory').forEach(b=>b.addEventListener('click',()=>openWorldDirectory(b.dataset.kind||'all')));
    document.querySelectorAll('[data-facilitysector]').forEach(b=>b.addEventListener('click',()=>openDrawer('expansion',{sector:b.dataset.facilitysector||'all'})));
    document.querySelectorAll('[data-focus-facility]').forEach(b=>b.addEventListener('click',()=>focusFacility(b.dataset.focusFacility)));
    document.querySelectorAll('[data-world-company]').forEach(b=>b.addEventListener('click',()=>{setDirectoryCompany(b.dataset.worldCompany);renderWorldNetworkInto();$('drawerBody').scrollTop=0;}));
    document.querySelectorAll('[data-world-page]').forEach(b=>b.addEventListener('click',()=>{cancelDrawerSearch();worldPage=Math.max(0,Number(b.dataset.worldPage)||0);renderWorldNetworkInto();$('drawerBody').scrollTop=0;}));
    document.querySelectorAll('.open-global-route-selected').forEach(b=>b.addEventListener('click',()=>{const assetId=$('manualGlobalAsset')?.value;if(!assetId){notice('اختر أصلًا متاحًا أولًا.');return;}globalRouteQuery='';openDrawer('globalRoute',{assetId});}));
    document.querySelectorAll('.world-focus').forEach(b=>b.addEventListener('click',()=>focusWorldEntity(b.dataset.key)));
    document.querySelectorAll('.build-road-route').forEach(b=>b.addEventListener('click',createRoadRouteFromForm));
    document.querySelectorAll('[data-routetype]').forEach(b=>b.addEventListener('click',()=>{const next=b.dataset.routetype||'all';if(next!==routeFilterType){routeQuery='';routeAssignQuery='';}routeFilterType=next;openDrawer('routes',routeFilterType);}));
    const routeSearch=document.getElementById('routeSearch');if(routeSearch)routeSearch.addEventListener('input',e=>{routeQuery=e.target.value;scheduleDrawerSearch('routes',()=>renderRouteCenterInto(true),160);});
    const routeAssetSearch=document.getElementById('routeAssetSearch');if(routeAssetSearch)routeAssetSearch.addEventListener('input',e=>{routeAssignQuery=e.target.value;scheduleDrawerSearch('routes',()=>renderRouteCenterInto('routeAssetSearch'),160);});
    document.querySelectorAll('.dispatch-international-network').forEach(b=>b.addEventListener('click',async()=>{const release=beginButtonOperation(b,'جارٍ توزيع الأسطول…');if(!release)return;try{await dispatchInternationalNetwork(b.dataset.company||null);}finally{release();}}));
    document.querySelectorAll('.cancel-road-plan').forEach(b=>b.addEventListener('click',()=>roadPlanning?.controller.abort()));
    document.querySelectorAll('.dispatch-existing-network').forEach(b=>b.addEventListener('click',async()=>{const release=beginButtonOperation(b,'جارٍ حساب مسارات الأسطول…');if(!release)return;try{await dispatchExistingDistinctNetwork(b.dataset.company||null);}finally{release();}}));
    document.querySelectorAll('.depart-all-assets').forEach(b=>b.addEventListener('click',async()=>{const release=beginButtonOperation(b,'جارٍ جدولة المغادرة…');if(!release)return;try{const companyId=b.dataset.company||null,ok=await departRouteAssets(null,companyId);if(ok)openDrawer('routes',companyId||'all');}finally{release();}}));
    document.querySelectorAll('.manual-buy-asset').forEach(b=>b.addEventListener('click',()=>manualPurchaseFromCard(b)));
    document.querySelectorAll('.manual-buy-mobility').forEach(b=>b.addEventListener('click',()=>manualMobilityPurchaseFromCard(b)));
    document.querySelectorAll('[data-ownedtype]').forEach(b=>b.addEventListener('click',()=>{ownedFilterStatus='all';ownedQuery='';openDrawer('assets',b.dataset.ownedtype);}));
    const ownedSearch=document.getElementById('ownedAssetSearch');if(ownedSearch)ownedSearch.addEventListener('input',e=>{ownedQuery=e.target.value;scheduleDrawerSearch('assets',()=>renderOwnedAssetsInto(true),160);});
    const ownedStatus=document.getElementById('ownedAssetStatus');if(ownedStatus)ownedStatus.addEventListener('change',e=>{ownedFilterStatus=e.target.value;renderOwnedAssetsInto();});
    document.querySelectorAll('.focus-owned-asset').forEach(b=>b.addEventListener('click',()=>focusOwnedAsset(b.dataset.id)));
    document.querySelectorAll('.focus-mobility-asset').forEach(b=>b.addEventListener('click',()=>focusMobilityAsset(b.dataset.id)));
    document.querySelectorAll('.service-mobility-asset').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.busy)return;b.dataset.busy='1';b.disabled=true;if(!serviceMobilityAsset(b.dataset.id)){delete b.dataset.busy;b.disabled=false;}}));
    document.querySelectorAll('.sell-mobility-asset').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.busy)return;b.dataset.busy='1';b.disabled=true;if(!sellMobilityAsset(b.dataset.id)){delete b.dataset.busy;b.disabled=false;}}));
    document.querySelectorAll('.create-global-route').forEach(b=>b.addEventListener('click',async()=>{const release=beginButtonOperation(b,'جارٍ إنشاء المسار…');if(!release)return;try{await createGlobalRoute(b.dataset.asset,b.dataset.key);}finally{release();}}));
    document.querySelectorAll('.assign-route-center').forEach(b=>b.addEventListener('click',async()=>{const routeId=b.dataset.route,select=[...document.querySelectorAll('.route-asset-select')].find(row=>row.dataset.route===routeId),assetId=select?.value;if(!assetId){notice('اختر أصلًا متاحًا لهذا المسار.');return;}const release=beginButtonOperation(b,'جارٍ تعيين المسار…');if(!release)return;try{await assignRoute(assetId,routeId,{returnToRoutes:true});}finally{release();}}));
    document.querySelectorAll('.service-asset').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.busy)return;b.dataset.busy='1';b.disabled=true;if(!serviceAsset(b.dataset.id)){delete b.dataset.busy;b.disabled=false;}}));
    document.querySelectorAll('.depart-now').forEach(b=>b.addEventListener('click',async()=>{const release=beginButtonOperation(b,'جارٍ جدولة المغادرة…');if(!release)return;try{await departNow(b.dataset.id);}finally{release();}}));
    document.querySelectorAll('.depart-route').forEach(b=>b.addEventListener('click',async()=>{const release=beginButtonOperation(b,'جارٍ جدولة المسار…');if(!release)return;try{const companyId=b.dataset.company||routeOwnerCompanyId(routeTemplates[b.dataset.route]),ok=await departRouteAssets(b.dataset.route,companyId);if(ok)openDrawer('routes',companyId);}finally{release();}}));
    document.querySelectorAll('.sell-asset').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.busy)return;b.dataset.busy='1';b.disabled=true;if(!sellAsset(b.dataset.id)){delete b.dataset.busy;b.disabled=false;}}));
    document.querySelectorAll('.sell-all-assets').forEach(b=>b.addEventListener('click',()=>sellAllAssets(b.dataset.company)));
    document.querySelectorAll('.new-game-direct').forEach(b=>b.addEventListener('click',async event=>{event.preventDefault();event.stopPropagation();b.disabled=true;try{await hardResetGame();}finally{b.disabled=false;}}));
    document.querySelectorAll('.add-credit').forEach(b=>b.addEventListener('click',async()=>{try{await runAuthorizedDomainCommand('finance','raise-debt',{company:'group',amount:50000000,note:'تفعيل خط ائتمان للمجموعة',liabilityAccount:'تسهيلات ائتمانية مستحقة',lender:'بنك المجموعة العالمي — إدارة الائتمان المؤسسي',termDays:360});pushAlert('تم تفعيل خط ائتمان بقيمة $50M وتسجيله في سجل الديون.');updateKpis();openDrawer('invoices',{company:'group',tab:'obligations',view:'debts'});}catch(error){notice(`تعذر تفعيل الائتمان: ${error.message}`);}}));
    document.querySelectorAll('.issue-bond').forEach(b=>b.addEventListener('click',async()=>{try{await runAuthorizedDomainCommand('finance','raise-debt',{company:'group',amount:100000000,note:'إصدار سندات لخمس سنوات',liabilityAccount:'سندات مستحقة الدفع',lender:'أمناء إصدار سندات المجموعة العالمية',termDays:1800});pushAlert(`أصدرت المجموعة سندات لخمس سنوات بقيمة $100M وفق التصنيف ${state.profile.creditRating} وسُجل الالتزام رسميًا.`);updateKpis();openDrawer('invoices',{company:'group',tab:'obligations',view:'debts'});}catch(error){notice(`تعذر إصدار السندات: ${error.message}`);}}));
    document.querySelectorAll('.launch-ipo').forEach(b=>b.addEventListener('click',async()=>{if(state.ipo.listed||state.groupValue<1000000000)return;const ticker=(state.profile.shortName||'GH').toUpperCase(),proceeds=state.groupValue*.18,result=await runAuthorizedCompositeCommand('launch-ipo',({state:draft,dispatch,recordAlert})=>{dispatch('finance','raise-equity',{company:'group',amount:proceeds,note:'متحصلات الطرح العام الأولي',equityAccount:'رأس مال وعلاوة إصدار',source:'مستثمرو الطرح العام'});dispatch('corporate','set-ipo',{listed:true,ticker});dispatch('corporate','adjust-group-value',{delta:draft.groupValue*.12});recordAlert(`اكتمل الطرح العام للمجموعة بالرمز ${ticker} وجمعت ${fmtMoney(proceeds)}.`,'finance');return true;},{afterCommit:()=>{updateKpis();openDrawer('finance');}});if(!result)notice('تعذر اعتماد الطرح العام؛ لم يتغير رأس المال أو حالة الإدراج.');}));
    document.querySelectorAll('.repay-debt').forEach(b=>b.addEventListener('click',async()=>{const release=beginButtonOperation(b,'جارٍ سداد الدين…');if(!release)return;const company=String(b.dataset.company||'');try{if(!isFinanceCompany(company))throw new Error(`company-not-found:${company}`);const debt=Number(companyBook(company).debt)||0,requested=Math.max(1,Number(b.dataset.amount)||25000000),amount=Math.min(requested,debt);if(amount<=0){pushAlert(`لا يوجد دين قائم على ${companyFinanceName(company)}.`);return;}const r=(await runAuthorizedDomainCommand('finance','repay-debt',{company,amount,note:'سداد أصل دين'})).result;pushAlert(`تم سداد ${fmtMoney(r.amount)} من دين ${companyFinanceName(company)} وتسجيل إشعار التسوية ${r.reference||''}.`);updateKpis();openDrawer('invoices',{company,tab:'obligations',view:'debts'});}catch(error){notice(`تعذر سداد الدين: ${error.message}`);}finally{release();}}));
    document.querySelectorAll('.repay-debt-record').forEach(b=>b.addEventListener('click',async()=>{const release=beginButtonOperation(b,'جارٍ تسجيل السداد…');if(!release)return;const company=String(b.dataset.company||''),debtId=String(b.dataset.debtId||'');try{if(!isFinanceCompany(company))throw new Error(`company-not-found:${company}`);const record=(state.finance?.debtRecords||[]).find(x=>x.id===debtId&&(x.company||'group')===company),input=[...document.querySelectorAll('.debt-payment-amount')].find(x=>x.dataset.debtId===debtId),requested=Math.max(0,Number(input?.value)||0),amount=Math.min(requested,Number(record?.outstanding)||0);if(!record||amount<=0){notice('أدخل مبلغ سداد صالحًا لهذا الدين.');return;}const r=(await runAuthorizedDomainCommand('finance','repay-debt',{company,debtId,amount,note:`سداد ${debtId}`})).result;if(!r.amount){notice('لم يتم تسجيل أي سداد على هذا الدين.');return;}pushAlert(`تم سداد ${fmtMoney(r.amount)} من ${debtId} وتسجيل التسوية ${r.reference||''}.`);updateKpis();openDrawer('invoices',{company,tab:'obligations',view:'debts'});}catch(error){notice(`تعذر سداد الدين: ${error.message}`);}finally{release();}}));
    
    document.querySelectorAll('.collect-receivable').forEach(b=>b.addEventListener('click',()=>collectReceivable(b.dataset.number)));
    document.querySelectorAll('.settle-payable-transfer').forEach(b=>b.addEventListener('click',()=>settlePayable(b.dataset.number,'transfer')));
    document.querySelectorAll('.issue-payable-cheque').forEach(b=>b.addEventListener('click',()=>settlePayable(b.dataset.number,'cheque')));
    document.querySelectorAll('.settle-cheque-now').forEach(b=>b.addEventListener('click',()=>settleIssuedCheque(b.dataset.id)));
    document.querySelectorAll('.pay-taxes').forEach(b=>b.addEventListener('click',()=>payTaxes(b.dataset.company||'group')));
    document.querySelectorAll('.view-invoices').forEach(b=>b.addEventListener('click',()=>viewInvoices(b.dataset.company||'all')));
    document.querySelectorAll('.finance-entity-docs').forEach(b=>b.addEventListener('click',()=>openDrawer('invoices',{company:b.dataset.company||'all',tab:'overview'})));
    document.querySelectorAll('.finance-doc-tab').forEach(b=>b.addEventListener('click',()=>openDrawer('invoices',{company:b.dataset.company||'all',tab:b.dataset.tab||'overview'})));
    const docsCompany=$('financeDocsCompany');if(docsCompany)docsCompany.addEventListener('change',()=>openDrawer('invoices',{company:docsCompany.value,tab:docsCompany.dataset.tab||'overview',view:docsCompany.dataset.view||'',direction:docsCompany.dataset.direction||'all'}));
    const documentType=$('financeDocumentType');if(documentType)documentType.addEventListener('change',()=>openDrawer('invoices',{company:docsCompany?.value||'all',tab:'documents',view:documentType.value,direction:'all'}));
    const transferDirectionSelect=$('financeTransferDirection');if(transferDirectionSelect)transferDirectionSelect.addEventListener('change',()=>openDrawer('invoices',{company:docsCompany?.value||'all',tab:'documents',view:'transfers',direction:transferDirectionSelect.value}));
    const obligationType=$('financeObligationType');if(obligationType)obligationType.addEventListener('change',()=>openDrawer('invoices',{company:docsCompany?.value||'all',tab:'obligations',view:obligationType.value}));
    document.querySelectorAll('.create-cheque-doc').forEach(btn=>btn.addEventListener('click',async()=>{const company=$('chequeCompany')?.value||'group',amount=Number($('chequeAmount')?.value)||0,beneficiary=($('chequeBeneficiary')?.value||'').trim(),note=($('chequeNote')?.value||'سداد التزام تجاري').trim(),dueDay=Math.max(Math.floor((state.simSeconds||0)/86400),Math.floor(Number($('chequeDueDay')?.value)||0)),draweeBank=($('chequeDraweeBank')?.value||'Global Holdings Treasury Bank').trim(),issuePlace=($('chequeIssuePlace')?.value||'الرياض، المملكة العربية السعودية').trim();if(amount<=0){notice('أدخل مبلغ شيك صالحًا.');return;}if(!beneficiary||GENERIC_FINANCE_PARTIES.has(beneficiary)||!draweeBank||!issuePlace){notice('أكمل الاسم القانوني الرسمي للمستفيد والمصرف ومكان الإصدار.');return;}const id=await issueCheque(amount,note,beneficiary,company,{draweeBank,issuePlace,paymentPlace:issuePlace,dueDay});if(id)openDrawer('invoices',{company,tab:'documents',view:'cheques'});}));
    document.querySelectorAll('.create-invoice-doc').forEach(btn=>btn.addEventListener('click',async()=>{const company=$('invoiceCompany')?.value||'group',kind=$('invoiceKind')?.value==='مصروف'?'مصروف':'دخل',amount=Number($('invoiceAmount')?.value)||0,note=($('invoiceNote')?.value||'خدمات تشغيلية').trim(),counterparty=($('invoiceCounterparty')?.value||'').trim();if(amount<=0){notice('أدخل مبلغ فاتورة صالحًا.');return;}if(!counterparty||GENERIC_FINANCE_PARTIES.has(counterparty)){notice('أدخل الاسم القانوني الرسمي للطرف المقابل.');return;}try{await runAuthorizedDomainCommand('finance','issue-invoice',{kind,amount,note,method:kind==='دخل'?'تحويل عميل':'تحويل بنكي',taxable:true,status:'مستحقة',company,counterparty});pushAlert(`تم إصدار ${kind==='دخل'?'فاتورة عميل':'فاتورة مورد'} على ${companyFinanceName(company)} بقيمة ${fmtMoney(amount)}.`);openDrawer('invoices',{company,tab:'documents',view:'invoices'});}catch(error){notice(`تعذر إصدار الفاتورة: ${error.message}`);}}));
    document.querySelectorAll('.company-reserve-transfer').forEach(b=>b.addEventListener('click',async()=>{const company=b.dataset.company||'group',toReserve=b.dataset.direction!=='operating';if(!await transferWithinCompany(company,1000000,toReserve)){notice('الرصيد غير كافٍ لهذه الحركة الداخلية.');return;}pushAlert(`${companyFinanceName(company)}: ${toReserve?'تم تحويل $1M إلى الاحتياطي':'تمت إعادة $1M إلى الحساب الجاري'}.`);openDrawer('finance');}));
    document.querySelectorAll('.company-transfer-submit').forEach(b=>b.addEventListener('click',async()=>{const from=$('companyTransferFrom')?.value,to=$('companyTransferTo')?.value,amount=Number($('companyTransferAmount')?.value)||0;if(from===to){notice('اختر شركتين مختلفتين للتحويل.');return;}if(!await transferBetweenCompanies(from,to,amount,`تمويل داخلي من ${companyFinanceName(from)} إلى ${companyFinanceName(to)}`)){notice('تعذر التحويل: تحقق من المبلغ ورصيد الحساب المصدر.');return;}pushAlert(`تم تحويل ${fmtMoney(amount)} من ${companyFinanceName(from)} إلى ${companyFinanceName(to)}.`);updateKpis();openDrawer('finance');}));
    const bulkInputs=[...document.querySelectorAll('.bulk-transfer-amount')];
    const refreshBulkTotal=()=>{const total=bulkInputs.reduce((n,i)=>n+(Math.max(0,Number(i.value)||0)),0),el=$('bulkTransferTotal');if(el)el.textContent=fmtMoney(total);return total;};
    bulkInputs.forEach(i=>i.addEventListener('input',refreshBulkTotal));refreshBulkTotal();
    document.querySelectorAll('.bulk-transfer-equal').forEach(b=>b.addEventListener('click',()=>{const pool=Math.max(0,Number($('bulkTransferPool')?.value)||0);if(!bulkInputs.length)return;const each=Math.floor(pool/bulkInputs.length/1000)*1000;let used=0;bulkInputs.forEach((i,idx)=>{const val=idx===bulkInputs.length-1?Math.max(0,pool-used):each;i.value=Math.round(val);used+=val;});refreshBulkTotal();}));
    document.querySelectorAll('.bulk-transfer-needs').forEach(b=>b.addEventListener('click',()=>{const pool=Math.max(0,Number($('bulkTransferPool')?.value)||0);if(!bulkInputs.length)return;const rows=bulkInputs.map(i=>{const t=i.dataset.company,bud=companyBudget(t),remaining=companyBudgetRemaining(t),cash=companyOperatingBalance(t),operatingFloor=5000000+(state.assets||[]).filter(a=>a.type===t).length*350000,need=Math.max(250000,operatingFloor-cash)+(Number.isFinite(remaining)?Math.max(0,remaining)*.18:0);return {i,need};});const totalNeed=rows.reduce((n,x)=>n+x.need,0)||rows.length;let used=0;rows.forEach((x,idx)=>{const val=idx===rows.length-1?Math.max(0,pool-used):Math.floor(pool*x.need/totalNeed/1000)*1000;x.i.value=Math.round(val);used+=val;});refreshBulkTotal();}));
    document.querySelectorAll('.bulk-transfer-submit').forEach(b=>b.addEventListener('click',async()=>{const rows=bulkInputs.map(i=>({company:i.dataset.company,amount:Number(i.value)||0})).filter(x=>x.amount>0),result=await bulkTransferFromGroup(rows);if(!result.ok){notice(result.reason||'تعذر تنفيذ التوزيع الجماعي.');return;}pushAlert(`تم توزيع ${fmtMoney(result.total)} من القابضة على ${result.count} شركة · ${result.batchId}.`);updateKpis();openDrawer('finance');}));
    
    document.querySelectorAll('.sign-contract').forEach(b=>b.addEventListener('click',()=>signContract(b.dataset.id,b.closest('article')?.querySelector('.contract-company-select')?.value||null)));
    document.querySelectorAll('[data-companytab]').forEach(b=>b.addEventListener('click',()=>openDrawer('companies',b.dataset.companytab)));
    document.querySelectorAll('[data-labortab]').forEach(b=>b.addEventListener('click',()=>openDrawer('labor',b.dataset.labortab)));
    
    document.querySelectorAll('.open-company').forEach(b=>b.addEventListener('click',()=>openCompany(b.dataset.type)));
    document.querySelectorAll('[data-markettype]').forEach(b=>b.addEventListener('click',()=>{marketFilterType=b.dataset.markettype;marketSegment='all';marketCompare=[];renderAssetMarketInto();}));
    document.querySelectorAll('[data-markettab]').forEach(b=>b.addEventListener('click',()=>{marketFilterTab=b.dataset.markettab;marketSegment='all';marketCompare=[];renderAssetMarketInto();}));
    const assetSearch=$('assetSearch');if(assetSearch)assetSearch.addEventListener('input',e=>{marketQuery=e.target.value;scheduleDrawerSearch('assetMarket',()=>renderAssetMarketInto(true));});
    const assetSegment=$('assetSegment');if(assetSegment)assetSegment.addEventListener('change',e=>{marketSegment=e.target.value;renderAssetMarketInto();});
    const worldSearch=$('worldSearch');if(worldSearch)worldSearch.addEventListener('input',e=>{worldQuery=e.target.value;worldPage=0;scheduleDrawerSearch('network',()=>renderWorldNetworkInto(true));});
    const worldKindSelect=$('worldKind');if(worldKindSelect)worldKindSelect.addEventListener('change',e=>{setDirectoryCompany(e.target.value);renderWorldNetworkInto();$('drawerBody').scrollTop=0;});
    const worldCountrySelect=$('worldCountry');if(worldCountrySelect)worldCountrySelect.addEventListener('change',e=>{cancelDrawerSearch();worldCountry=e.target.value;worldCity='';worldPage=0;worldQuery='';renderWorldNetworkInto();});
    const worldCitySelect=$('worldCity');if(worldCitySelect)worldCitySelect.addEventListener('change',e=>{cancelDrawerSearch();worldCity=e.target.value;worldPage=0;worldQuery='';renderWorldNetworkInto();});
    const energyKindSelect=$('worldEnergyKind');if(energyKindSelect)energyKindSelect.addEventListener('change',e=>{cancelDrawerSearch();worldDirectoryIntent={energyKind:ENERGY_PROJECTS[e.target.value]?e.target.value:'solar'};renderWorldNetworkInto();});
    const globalRouteSearch=$('globalRouteSearch');if(globalRouteSearch)globalRouteSearch.addEventListener('input',e=>{globalRouteQuery=e.target.value;const assetId=activeDrawerArg?.assetId;scheduleDrawerSearch('globalRoute',()=>renderGlobalRouteInto(assetId,true));});
    document.querySelectorAll('.energy-build').forEach(b=>b.addEventListener('click',()=>openWorldDirectory('power',{energyKind:b.dataset.kind||'solar'})));
    document.querySelectorAll('.board-approve').forEach(b=>b.addEventListener('click',()=>setBoardDecision('approved')));
    document.querySelectorAll('.board-defer').forEach(b=>b.addEventListener('click',()=>setBoardDecision('deferred')));
    document.querySelectorAll('.buy-insurance').forEach(b=>b.addEventListener('click',()=>buyInsurance(b.dataset.sector)));
    document.querySelectorAll('.fund-research').forEach(b=>b.addEventListener('click',()=>fundResearch(b.dataset.project)));
    
    document.querySelectorAll('.company-name-save').forEach(btn=>btn.addEventListener('click',async()=>{const type=btn.dataset.company,input=document.querySelector(`.company-name-input[data-company=\"${type}\"]`),name=String(input?.value||'').trim();if(!type||name.length<2){notice('أدخل اسمًا صالحًا للشركة.');return;}const oldName=companyFinanceName(type);try{await runAuthorizedDomainCommand('corporate','rename-company',{type,legalName:name});pushAlert(`تم تغيير اسم ${oldName} إلى ${name}. جميع المستندات والقيود تعرض الاسم الجديد تلقائيًا.`);updateKpis();type==='group'?openDrawer('companies','holding'):openDrawer('companyManage',{type,tab:'overview'});}catch(error){notice(`تعذر تغيير الاسم: ${error.message}`);}}));
    document.querySelectorAll('.company-logo-upload input').forEach(input=>input.addEventListener('change',async()=>{const type=input.dataset.company;if(!type||!input.files?.[0])return;try{const data=await compressLogoFile(input.files[0]);await runAuthorizedDomainCommand('corporate','set-logo',{type,logo:data});pushAlert(`تم تحديث شعار ${companyFinanceName(type)}؛ جميع المستندات التاريخية ستعرض الهوية الجديدة تلقائيًا.`);type==='group'?openDrawer('companies','holding'):openDrawer('companyManage',{type,tab:'overview'});}catch(error){notice(error.message||'تعذر معالجة الشعار.');}}));
    document.querySelectorAll('.company-logo-clear').forEach(btn=>btn.addEventListener('click',async()=>{const type=btn.dataset.company;try{await runAuthorizedDomainCommand('corporate','set-logo',{type,logo:null});type==='group'?openDrawer('companies','holding'):openDrawer('companyManage',{type,tab:'overview'});}catch(error){notice(`تعذر إزالة الشعار: ${error.message}`);}}));
    if(window.GH_ADVANCED)window.GH_ADVANCED.bind(document,advancedContext());
    window.GH_UI_QUALITY?.enhance?.($('drawerBody'),{panel:activeDrawerPanel,state});
  }
  function renderAssetMarketInto(restoreFocus=false){
    $('drawerBody').innerHTML=`<div class="list">${renderAssetMarketBody(marketFilterType,marketFilterTab)}</div>`; window.GH_INTERFACE.prepare($('drawerBody'),activeDrawerPanel,activeDrawerArg,advancedContext());bindDrawerActions();
    if(restoreFocus){const input=$('assetSearch');input?.focus();input?.setSelectionRange(input.value.length,input.value.length);}
  }
  function renderOwnedAssetsInto(restoreFocus=false){
    $('drawerBody').innerHTML=renderOwnedAssets(ownedFilterType);window.GH_INTERFACE.prepare($('drawerBody'),activeDrawerPanel,activeDrawerArg,advancedContext());bindDrawerActions();
    if(restoreFocus){const input=document.getElementById('ownedAssetSearch');input?.focus();input?.setSelectionRange(input.value.length,input.value.length);}
  }
  function renderRouteCenterInto(restoreFocus=false){
    $('drawerBody').innerHTML=renderRouteCenter(routeFilterType);window.GH_INTERFACE.prepare($('drawerBody'),activeDrawerPanel,activeDrawerArg,advancedContext());bindDrawerActions();
    const focusId=restoreFocus===true?'routeSearch':typeof restoreFocus==='string'?restoreFocus:null;if(focusId){const input=document.getElementById(focusId);input?.focus();input?.setSelectionRange(input.value.length,input.value.length);}
  }

  async function buildEnergy(kind,site,opts={}){
    site=canonicalDirectorySite(site,'power');const p=ENERGY_PROJECTS[kind];if(!p||!site){notice('اختر مشروع طاقة وموقعًا صالحين.');return false;}
    const result=await runAuthorizedCompositeCommand('build-energy',({state:draft,dispatch,recordAlert})=>{if(!draft.openedCompanies.includes('power'))throw new Error('company-not-open');if(dynamicFacilitiesFor(draft).some(f=>f.sourceKey===site.key))throw new Error('facility-already-open');const siteName=`${p.name} · ${site.city}`,build=awardConstructionDraft(draft,dispatch,recordAlert,'power','power',siteName,p.cost);if(!build||build.insufficient)throw new Error('construction-funding-unavailable');dispatch('procurement','configure-construction',{id:build.id,capacityKey:p.key,capacityAmount:p.amount,energyKind:kind,commissioned:false,leadDays:p.leadDays});const facility={id:window.GH_DETERMINISM.nextId(draft,'POWER-SITE'),sourceKey:site.key,capitalId:site.capitalId,company:'power',ownerCompanyId:'power',kind:'power',energyKind:kind,capacityKey:p.key,capacityAmount:p.amount,projectLeadDays:p.leadDays,owned:true,icon:'⚡',photo:PHOTOS.facility_power,name:siteName,city:site.city,country:site.country,coords:[...site.coords],cost:build.amount,dailyCost:0,plannedDailyCost:site.dailyCost||38000,capacity:`قيد الإنشاء · ${p.amount} ${p.key==='storageMWh'?'MWh':'MW'}`,commissioned:false,status:'قيد الإنشاء',contractor:build.contractor,constructionContractId:build.id,detail:'لا تدخل القدرة التشغيلية أو الإيراد قبل اكتمال الاختبارات والتشغيل التجاري.'};dispatch('facilities','create',{facility,bucket:'customHubs',groupValueAdd:build.amount*.38});ensureFacilityWorkforceDraft(draft,dispatch,'power','تجهيز فريق مشروع ومحطة طاقة');window.GH_ENERGY_CORE?.ensure?.(draft);recordAlert(`أرسى عقد ${siteName} على ${build.contractor} بمدة ${p.leadDays} يوم محاكاة، وربط فريق المحطة آليًا بمسير الرواتب. لا يبدأ الدخل قبل التشغيل التجاري.`,'facility');return true;},{silent:Boolean(opts.silent),afterCommit:()=>{updateKpis();renderMap();if(!opts.silent)openDrawer('energy');}});return Boolean(result);
  }
  async function openBankBranch(site,opts={}){
    site=canonicalDirectorySite(site,'bank');if(!site){notice('اختر موقع الفرع من الدليل العالمي.');return false;}
    const result=await runAuthorizedCompositeCommand('open-bank-branch',({state:draft,dispatch,recordAlert})=>{if(!draft.openedCompanies.includes('bank'))throw new Error('company-not-open');if(dynamicFacilitiesFor(draft).some(f=>f.sourceKey===site.key))throw new Error('facility-already-open');const baseCost=15000000,branchNumber=Number(draft.bank?.branches||0)+1,siteName=`فرع بنك المجموعة · ${site.city} #${branchNumber}`,build=awardConstructionDraft(draft,dispatch,recordAlert,'bank','bank',siteName,baseCost);if(!build||build.insufficient)throw new Error('construction-funding-unavailable');const facilityId=window.GH_DETERMINISM.nextId(draft,'BANK-BRANCH'),facility={id:facilityId,sourceKey:site.key,capitalId:site.capitalId,company:'bank',ownerCompanyId:'bank',kind:'bank',owned:true,icon:'🏦',photo:PHOTOS.facility_bank,name:siteName,city:site.city,country:site.country,coords:[...site.coords],cost:build.amount,dailyCost:site.dailyCost||18500,capacity:'فرع مصرفي عالمي · حسابات وتحويلات وبطاقات وتمويل',contractor:build.contractor,constructionContractId:build.id,detail:'فرع تشغيلي يبدأ من صفر ثم يجذب عملاء وودائع في الإقفال اليومي، ويمكنه إنشاء محافظ تمويل يدوية.'};dispatch('facilities','create',{facility,bucket:'customHubs',groupValueAdd:build.amount*.7});const branch=dispatch('banking','open-branch',{branchId:`BR-${facilityId}`,facilityId,site,servicesActive:true,services:['حسابات وودائع','تحويلات ومدفوعات'],serviceModel:'أساسي'}).result;ensureFacilityWorkforceDraft(draft,dispatch,'bank','فتح فرع بنكي');recordAlert(`افتتح ${siteName} بالخدمات الأساسية. وسّع خدمات الفرع يدويًا من مركز البنك حسب خطتك التجارية.`,'facility');return branch;},{silent:Boolean(opts.silent),afterCommit:()=>{updateKpis();renderMap();if(!opts.silent)openDrawer('bank');}});return result||false;
  }
  async function setBoardDecision(status){try{const res=(await runAuthorizedDomainCommand('governance','board-decision',{status})).result;pushAlert(status==='approved'?(res.highRisks?`اعتمد المجلس البرنامج اعتمادًا مشروطًا مع ${res.highRisks} مخاطر مرتفعة يجب متابعتها.`:'اعتمد مجلس الإدارة برنامج التوسع الاستراتيجي دون تحفظات مرتفعة.'):`أحال مجلس الإدارة برنامج التوسع إلى مراجعة المخاطر${res.highRisks?` بسبب ${res.highRisks} حالة مرتفعة`:''}.`);openDrawer('governance');}catch(error){notice(`تعذر تسجيل قرار المجلس: ${error.message}`);}}
  function insuranceQuote(sector){const assets=state.assets.filter(a=>a.type===sector),exposure=assets.reduce((n,a)=>n+(Number(a.purchasePrice)||0)*Math.max(.45,(Number(a.condition)||100)/100),0),renewal=Number(state.realism?.insurance?.renewalIndex)||100,base=Math.max(750000,exposure*.0035);return Math.round(base*(renewal/100)/10000)*10000;}
  async function buyInsurance(sector){const cost=insuranceQuote(sector);try{await runAuthorizedDomainCommand('governance','insurance-policy',{sector,premium:cost,renewalIndex:Number(state.realism?.insurance?.renewalIndex)||100,deductiblePct:.02,coveragePct:.92});pushAlert(`تم تفعيل وثيقة ${typeName(sector)} بقسط ${fmtMoney(cost)} وحد تحمل 2% وتغطية أساسية 92%.`);updateKpis();openDrawer('insurance');}catch(error){if(String(error.message).includes('policy-exists'))pushAlert(`قطاع ${typeName(sector)} مغطى بوثيقة تأمين بالفعل.`);else notice(`تعذر إصدار الوثيقة: ${error.message}`);}}
  async function fundResearch(project){
    const cost=25000000;if(!Object.prototype.hasOwnProperty.call(state.research,project)){pushAlert('مشروع البحث غير معروف.');return false;}if(state.research[project]>=100){pushAlert('اكتمل هذا المشروع بالفعل بنسبة 100%.');openDrawer('research');return false;}
    return runAuthorizedCompositeCommand('fund-research',({state:draft,dispatch,recordAlert})=>{const result=dispatch('governance','research-fund',{project,cost,progress:25}).result,meta=draft.advanced?.researchPrograms?.[project];if(result.progress>=100&&meta)dispatch('corporate','adjust-group-value',{delta:Number(meta.spent||0)*.35});recordAlert(result.progress>=100?`اكتمل مشروع ${project} ودخل التشغيل. الأثر سيظهر داخل تكاليف التشغيل والمحاكاة بدل زيادة رقمية منفصلة.`:`تم تمويل مرحلة البحث. تقدم المشروع ${result.progress}% وإنفاقه المتراكم ${fmtMoney(meta?.spent||cost)}.`,'governance');return result;},{afterCommit:()=>{updateKpis();openDrawer('research');}});
  }
  function inspectContract(id){const c=contracts.find(x=>x.id===id);if(!c){pushAlert('تعذر فتح تفاصيل هذه المناقصة؛ قد تكون تغيّرت. أعد فتح قسم العقود.');return;}notice(`${c.name}\n\nقيمة العقد: ${fmtMoney(c.value)}\nالتكلفة المتوقعة: ${fmtMoney(c.cost)}\nهامش كامل: ${fmtMoney(c.value-c.cost)}\nSLA: ${c.sla}\nالقدرة المطلوبة: ${c.capacity}\nالغرامات: ${c.penalty}`);}
  function eligibleContractCompanyIds(contract,target=state){
    return operationalCompanyInstances(target).filter(company=>{
      if(!(company.definition?.classification?.sectorIds||[]).includes(contract.sector))return false;
      if(company.definition?.capabilities?.includes('operations.fleet'))return (target.assets||[]).some(asset=>assetOwnerCompanyId(asset)===company.id&&Number(asset.condition)>=65);
      if(company.definition?.capabilities?.includes('operations.mobility'))return uniqueOperationalCompanyForCapability(target,'operations.mobility')===company.id&&Boolean(target.mobility?.vehicles?.length);
      return dynamicFacilitiesFor(target).some(facility=>facility.owned&&facilityOwnerCompanyId(facility)===company.id);
    }).map(company=>company.id);
  }
  function hasContractCapacity(contract){return eligibleContractCompanyIds(contract).length>0;}
  async function bidContract(id){const c=contracts.find(x=>x.id===id);if(!c){pushAlert('تعذر تقديم العرض؛ المناقصة لم تعد متاحة. أعد فتح قسم العقود.');return;}if(state.acceptedContracts.includes(id)){pushAlert('هذه المناقصة موقّعة بالفعل ولا يمكن تقديم عرض جديد عليها.');return;}if(!hasContractCapacity(c)){notice(`لا يمكن تقديم العرض: المجموعة لا تملك قدرة تشغيلية صالحة في قطاع ${typeName(c.sector)}.`);return;}const reputation=.78+state.hired.length*.012+state.branches.length*.01,winChance=clamp(c.bidBase*reputation,.45,.93),won=simRandom('contract-bid')<winChance,rival=won?null:window.GH_BUSINESS_WORLD?.competitorForSector?.(state,c.sector);try{await runAuthorizedDomainCommand('contracts','bid',{id,won,number:won?nextId('GH-CN'):null,client:c.client,sector:c.sector,title:c.name,value:c.value,termMonths:c.termMonths,competitorId:rival?.id||null,competitorName:rival?.displayName||null});pushAlert(won?`فازت المجموعة بمناقصة ${c.name}. العقد بانتظار توقيعك قبل بدء التشغيل.`:`لم يفز عرض المجموعة بمناقصة ${c.name}. تمت الترسية على ${rival?.displayName||'منافس آخر'} وسُجلت النتيجة في السوق التجاري.`);openDrawer('contracts');}catch(error){notice(`تعذر تسجيل نتيجة المناقصة: ${error.message}`);}}
  async function signContract(id,companyInput=null){const c=contracts.find(x=>x.id===id);if(!c){pushAlert('تعذر توقيع هذا العقد؛ لم يعد متاحًا.');return;}const eligible=eligibleContractCompanyIds(c),companyId=companyInput&&eligible.includes(companyInput)?companyInput:(eligible.length===1?eligible[0]:null);if(!companyId){notice(eligible.length?'اختر الشركة المنفذة لهذا العقد قبل التوقيع.':'لا توجد شركة تشغيلية مؤهلة لهذا العقد.');return false;}try{const doc=(await runAuthorizedDomainCommand('contracts','sign',{id,company:companyId,companyId,ownerCompanyId:companyId,sector:c.sector,deposit:Math.round(c.value*.1),name:c.name,client:c.client,value:c.value,termMonths:c.termMonths,taxable:companyTaxable(state,companyId)})).result;pushAlert(`تم توقيع ${doc.number} باسم ${companyFinanceName(companyId)} مع ${c.client} وتحويل الدفعة المقدمة إلى حساب الشركة المنفذة.`);updateKpis();openDrawer('contracts');return true;}catch(error){notice(`تعذر توقيع العقد: ${error.message}`);return false;}}
  async function dueDiligence(id){const c=competitors.find(x=>x.id===id);if(!c){pushAlert('تعذر فتح ملف العناية الواجبة لهذه الشركة.');return false;}const leverage=c.debt/Math.max(1,c.ebitda),margin=c.ebitda/Math.max(1,c.revenue),riskScore=Math.round((c.risk==='مرتفع'?68:c.risk==='متوسط'?42:24)+Math.min(22,leverage*6)-Math.min(12,margin*30)),synergy=Math.round(c.ebitda*(.08+((c.quality||80)/100)*.08));try{await runAuthorizedDomainCommand('market','due-diligence',{id,riskScore,score:riskScore,leverage,margin,synergy,quality:c.quality||80});notice(`العناية الواجبة — ${c.name}\n\nقيمة المنشأة: ${fmtMoney(c.price)}\nEBITDA: ${fmtMoney(c.ebitda)}\nصافي الهامش التشغيلي: ${(margin*100).toFixed(1)}%\nالدين/EBITDA: ${leverage.toFixed(2)}x\nمؤشر المخاطر: ${riskScore}/100\nوفورات تكامل سنوية متوقعة: ${fmtMoney(synergy)}\n\nالخطوة التالية: بناء عرض ثم شراء حصة/سيطرة.`);return true;}catch(error){notice(`تعذر إكمال العناية الواجبة: ${error.message}`);return false;}}
  async function acquireStake(id,target){const c=competitors.find(x=>x.id===id);if(!c){pushAlert('تعذر تنفيذ العملية؛ الشركة غير متاحة.');return;}const current=state.stakes[id]||0;if(target<=current){pushAlert(`المجموعة تملك بالفعل ${current}% من ${c.name}.`);return;}const deal=state.maDeals[id];if(!deal?.dd){await dueDiligence(id);pushAlert('تم إعداد العناية الواجبة أولًا. راجع الملف ثم أعد تنفيذ العرض.');return;}const delta=target-current,premium=target>=51&&current<51?1.18:target>=100?1.12:1.06,riskAdj=1+(deal.dd.riskScore||40)/1000,cost=c.price*(delta/100)*premium*riskAdj;if(!ask(`عرض استحواذ على ${c.name}\n\nالحصة الجديدة: ${target}%\nالقيمة: ${fmtMoney(cost)}\nعلاوة/مخاطر مضمنة\nوفورات سنوية متوقعة: ${fmtMoney(deal.dd.synergy||0)}\n\nاعتماد العرض والإغلاق؟`))return;return runAuthorizedCompositeCommand('acquire-stake',({state:draft,dispatch,recordAlert})=>{dispatch('market','acquire-stake',{id,name:c.name,stake:target,amount:cost,premium,synergy:deal.dd.synergy||0});if(target>=51)ensureFacilityWorkforceDraft(draft,dispatch,'all',`دمج ${c.name}`);recordAlert(`${target>=51?'أغلقت صفقة السيطرة على':'تم الاستثمار في'} ${c.name}: ${target}%. بدأ برنامج التكامل التشغيلي.`,'market');return true;},{afterCommit:()=>{updateKpis();renderMap();openDrawer('ma');}});}

  async function hire(id){const c=candidates.find(x=>x.id===id);if(!c){pushAlert('تعذر التوظيف؛ هذا المرشح لم يعد متاحًا.');return;}try{const center=findFacility('HQ-RUH')?.name||'المقر الرئيسي';await runAuthorizedDomainCommand('hr','hire-executive',{candidateId:id,company:executivePayrollCompany(id),center,source:'استقطاب قيادة فردي'},{context:{candidates}});pushAlert(`انضم ${c.name} إلى المجموعة بمنصب ${c.role} بعقد عمل ساري وربط مالي بالمقر الرئيسي.`);openDrawer('labor','contracts');}catch(error){notice(`تعذر التوظيف: ${error.message}`);}}
  async function tradeStock(sym,qty){try{const result=(await runAuthorizedDomainCommand('market','trade-stock',{sym,qty})).result;pushAlert(`${qty>0?'شراء':'بيع'} ${fmtNumber(Math.abs(qty))} سهم من ${sym} بقيمة ${fmtMoney(result.value)}.`);updateKpis();openDrawer('market');return true;}catch(error){notice(`تعذر تنفيذ الصفقة: ${error.message}`);return false;}}
  async function openCompany(type){
    type=String(type||'').trim();const definition=COMPANY_PLATFORM.getDefinition(type),companyName=definition?.identity?.legalDefault?.ar||definition?.identity?.legalDefault?.en||type,cost=Number(definition?.founding?.defaultCapital)||0;
    if(!definition||definition.kind!=='subsidiary'||definition.lifecycle!=='active'||cost<=0){pushAlert('تعذر تأسيس هذه الشركة؛ تعريف الشركة غير متاح أو غير صالح للتأسيس.');return false;}
    if(state.openedCompanies.includes(type)){pushAlert(`${companyFinanceName(type)} مؤسَّسة بالفعل.`);openDrawer('companies','subs');return false;}
    const authority=founderAuthorization(state);if(!authority.signature||!authority.mandate){openSignatureDialog({required:true});notice('اعتمد توقيعك المرئي قبل تأسيس شركة جديدة.');return false;}
    const location=window.GH_GAME_LIFECYCLE.FOUNDING_LOCATIONS.find(row=>row.city===state.profile?.city)||{id:'GROUP-HQ',city:state.profile?.city||'الرياض',country:state.profile?.country||'السعودية'};
    let plan;try{plan=window.GH_FORMATION_ENGINE.prepare({entityKind:'company',companyId:type,legalName:companyName,displayName:definition.identity?.trade?.ar||companyName,shortName:definition.identity?.short||type.toUpperCase(),englishName:definition.identity?.legalDefault?.en||'',founder:state.profile?.founder,location,capital:cost,currency:state.profile?.currency||'USD',riskAppetite:state.profile?.riskAppetite,procurementPolicy:state.profile?.procurementPolicy,signingAuthority:state.profile?.signingAuthority,signatureRef:authority.signature.id,signatureVersion:authority.signature.version,createdAt:Number(state.simSeconds)||0});window.GH_FORMATION_ENGINE.validatePlan(plan);}catch(error){notice(`تعذر تجهيز خطة التأسيس: ${error.message}`);return false;}
    const result=await runDurableStateCommand(`open-company:${type}`,({state:draft})=>{
      const draftAuthority=founderAuthorization(draft),stamp=plan.planHash.slice(0,10).toUpperCase(),short=(draft.profile.shortName||'GH').toUpperCase(),payload={companyId:type,definitionId:plan.definitionId,capital:plan.capital.amount,legalName:plan.identity.legalName,shortName:plan.identity.shortName,owner:draft.profile.name,authorizedSignatory:draft.profile.founder,logoStyle:type,riskAppetite:plan.governance.riskAppetite,procurementPolicy:plan.governance.procurementPolicy,signingAuthority:plan.governance.signingAuthority,taxId:`${short}-${type.toUpperCase()}-${stamp}`,commercialRegistration:`CR-${simDate().getUTCFullYear()}-${stamp}`,businessLicense:`LIC-${type.toUpperCase()}-${stamp}`,formationContract:`INC-${type.toUpperCase()}-${stamp}`,invoices:[{id:`INV-${type.toUpperCase()}-${stamp}`,status:'تأسيس',amount:plan.capital.amount,issuedAt:draft.simSeconds,note:'قيد رأس المال المدفوع عند التأسيس'}]};
      if(!draftAuthority.signature||draftAuthority.signature.id!==plan.signature.signatureRef||draftAuthority.signature.version!==plan.signature.version)throw new Error('formation-signature-version-conflict');
      window.GH_FORMATION_ENGINE.validatePlan(plan);const receipt=authorizedDraftDispatch(draft,'corporate','open-company',payload,{idempotencyKey:plan.planId}),record=receipt.result;if(!record||record.companyId!==type)throw new Error('formation-company-record-mismatch');record.formationPlan={id:plan.planId,hash:plan.planHash,definitionId:plan.definitionId,definitionVersion:plan.definitionVersion,capital:clone(plan.capital),governance:clone(plan.governance),location:clone(plan.location),signature:clone(plan.signature),createdAt:plan.createdAt};record.signatureSnapshot=signatureSnapshot(draft,plan.signature.signatureRef);record.authorizationProofId=receipt.authorizationProofId||null;window.GH_OPERATIONS_CORE.execute({state:draft},'record-alert',{text:`تأسست ${plan.identity.legalName} بحساب قانوني ومالي فقط. الأصول والمنشآت والقدرات تبدأ من صفر ولا تُنشأ إلا بشراء يدوي.`,type:'formation'});return {companyId:type,record,planId:plan.planId};
    },{silent:true,afterCommit:()=>{syncMapCompanyFilterButtons();updateKpis();renderMap();openDrawer('companies','subs');}});
    if(!result){notice(`لم تُفتح ${companyName}. لم يعتمد الحفظ الدائم أي أثر.`);return false;}return true;
  }
  // ضمان وصول زر التأسيس حتى داخل اللوحات التي يعيد GH Advanced رسمها على الهاتف.
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('.open-company');if(!button)return;
    event.preventDefault();event.stopPropagation();openCompany(button.dataset.type);
  },true);
  async function collectReceivable(number){try{const result=(await runAuthorizedDomainCommand('finance','collect-receivable',{number})).result;pushAlert(`تم تحصيل ${fmtMoney(result.amount)} إلى حساب ${companyFinanceName(result.company)}.`);updateKpis();openDrawer('invoices',{company:result.company,tab:'obligations',view:'receivables'});}catch(error){pushAlert('هذه الذمة محصّلة بالفعل أو لم تعد موجودة.');openDrawer('invoices');}}
  async function settlePayable(number,method='transfer'){const stayPanel=activeDrawerPanel,stayArg=activeDrawerArg,stayScroll=$('drawerBody')?.scrollTop||0;try{const result=(await runAuthorizedDomainCommand('finance','settle-payable',{number,method})).result;if(method==='cheque')pushAlert(`صدر الشيك ${result.chequeId} بقيمة ${fmtMoney(result.amount)} لسداد الذمة ${number}. ستبقى الذمة مفتوحة حتى صرف الشيك.`);else pushAlert(`تم سداد ${fmtMoney(result.amount)} بتحويل بنكي من حساب ${companyFinanceName(result.company)}.`);updateKpis();if(stayPanel){openDrawer(stayPanel,stayArg);requestAnimationFrame(()=>{if($('drawerBody'))$('drawerBody').scrollTop=stayScroll;});}return result;}catch(error){notice(`تعذر سداد الذمة: ${error.message}`);return null;}}
  async function payTaxes(company='group'){company=String(company||'');try{if(!isFinanceCompany(company))throw new Error(`company-not-found:${company}`);const result=(await runAuthorizedDomainCommand('finance','pay-taxes',{company})).result;if(!result.amount){pushAlert(`لا توجد فترة ضريبية مستحقة على ${companyFinanceName(company)}.`);return;}pushAlert(`تم سداد ضريبة ${companyFinanceName(company)} بقيمة ${fmtMoney(result.amount)} وحفظ ورقة التسوية ${result.settlementId}.`);updateKpis();openDrawer('invoices',{company,tab:'obligations',view:'taxes'});}catch(error){notice(`تعذر سداد الضريبة: ${error.message}`);}}

  function viewInvoices(company='all'){openDrawer('invoices',{company,tab:'overview'});}
  async function manualPurchaseFromCard(button){
    const card=button?.closest?.('.asset-market-card'),type=button?.dataset?.type,tab=button?.dataset?.tab,id=button?.dataset?.id;
    const baseSelect=card?.querySelector('.manual-asset-base'),baseId=baseSelect?.value,ownerCompanyId=baseSelect?.selectedOptions?.[0]?.dataset?.company||facilityOwnerCompanyId(findFacility(baseId)),qty=card?.querySelector('.manual-asset-qty')?.value,mode=card?.querySelector('.manual-asset-mode')?.value||'cash';
    if(!type||!id||!baseId){notice('اختر أصلًا وقاعدة تسليم متوافقة.');return null;}
    const release=beginButtonOperation(button,'جارٍ الشراء والتسليم…');if(!release)return null;
    try{
      // Large batches yield for visible busy feedback, but never make the
      // operation lifecycle depend on WebKit delivering an animation frame.
      if(Math.max(1,Math.floor(Number(qty)||1))>=64)await yieldForInteractivePaint();
      const orderId=await buyAsset(type,tab,id,mode,qty,baseId,true,null,ownerCompanyId);
      if(!orderId)throw new Error('asset-purchase-rejected');
      pushAlert(`سُجل أمر الشراء اليدوي ${orderId}. لم ينشئ النظام أصلًا إضافيًا أو مسارًا أو قرارًا نيابةً عنك.`);updateKpis();openDrawer('assetMarket',type);return orderId;
    }catch(error){
      notice('لم يُنفذ الشراء ولم يحدث أي خصم. راجع الرصيد والمورد والسعة.');return null;
    }finally{release();}
  }
  async function manualMobilityPurchaseFromCard(button){
    const card=button?.closest?.('.mobility-market-card'),classId=button?.dataset?.class,centerId=card?.querySelector('.mobility-purchase-center')?.value,quantity=Math.max(1,Math.min(50,Math.round(Number(card?.querySelector('.mobility-purchase-qty')?.value)||1)));
    if(!classId||!centerId){notice('اختر طرازًا ومركز تسليم مملوكًا.');return null;}
    const release=beginButtonOperation(button,'جارٍ شراء وتسليم السيارات…');if(!release)return null;
    try{const result=(await runAuthorizedDomainCommand('mobility','buy-fleet',{quantity,centerId,classId})).result;if(!result)throw new Error('محرك Mobility غير متاح');pushAlert(`تم شراء وتسليم ${quantity} سيارة إلى ${window.GH_MOBILITY_CORE.centerMeta(state,centerId)?.city||centerId}، وتعيين ${quantity} سائق برواتب ثابتة تلقائيًا.`);updateKpis();renderMap();openDrawer('assets','mobility');return result;}catch(error){notice(`ألغي شراء سيارات Mobility بالكامل: ${error.message}`);return null;}finally{release();}
  }
  function focusOwnedAsset(id){const asset=state.assets.find(row=>row.id===id);if(!asset)return;selectedMobilityId=null;selectedAssetId=id;setMapFilterSelection(assetOwnerCompanyId(asset)||'all');save();renderMap();panMapTo(assetPosition(asset),7);closeDrawer();showAsset(id);}
  function focusMobilityAsset(id){const vehicle=window.GH_MOBILITY_CORE?.findVehicle?.(state,id),position=window.GH_MOBILITY_CORE?.vehiclePosition?.(state,id);if(!vehicle||!position)return;selectedAssetId=null;selectedMobilityId=id;setMapFilterSelection('mobility');save();renderMap();panMapTo(position,13);closeDrawer();}
  function focusFacility(id){const facility=findFacility(id);if(!facility?.coords)return;selectedAssetId=null;selectedMobilityId=null;selectedFacilityId=facility.id;setMapFilterSelection('facility');save();renderMap();panMapTo(facility.coords,9);closeDrawer();}
  async function serviceMobilityAsset(id){try{const result=(await runAuthorizedDomainCommand('mobility','service-vehicle',{id})).result;if(!result)throw new Error('سيارة غير موجودة');pushAlert(`اكتملت صيانة وشحن ${result.name} وأصبحت الحالة والبطارية 100%.`);updateKpis();openDrawer('mobilityAsset',id);return true;}catch(error){notice(`تعذر صيانة السيارة: ${error.message}`);return false;}}
  async function sellMobilityAsset(id){const vehicle=window.GH_MOBILITY_CORE?.findVehicle?.(state,id);if(!vehicle)return false;if(!ask(`بيع ${vehicle.name}؟\nلن يتم البيع أثناء الرحلة.`,'high'))return false;try{const result=(await runAuthorizedDomainCommand('mobility','sell-vehicle',{id})).result;if(!result?.vehicle)throw new Error('لم يرجع محرك Mobility إثبات البيع');pushAlert(`تم بيع ${result.vehicle.name} بقيمة ${fmtMoney(result.proceeds)} وإنهاء وظيفة السائق المرتبطة بها.`);if(selectedMobilityId===id)selectedMobilityId=null;updateKpis();renderMap();openDrawer('assets','mobility');return true;}catch(error){notice(`تعذر بيع السيارة: ${error.message}`);return false;}}
  async function buyAsset(type,tab,id,mode='cash',qty=1,baseId=null,silent=false,requestRef=null,requestedOwnerCompanyId=null){
    const item=catalogItem(type,id),maxQty=window.GH_PROCUREMENT_CORE?.MAX_ASSET_PURCHASE_QUANTITY||1000;if(!item){if(!silent)notice('تعذر تنفيذ الشراء؛ هذا الأصل لم يعد متاحًا في الكتالوج.');return null;}qty=clamp(Math.floor(Number(qty)||1),1,maxQty);baseId=baseId||item.base;
    const base=findFacility(baseId);if(!base){if(!silent)notice('تعذر تنفيذ الشراء: قاعدة التسليم غير موجودة.');return null;}
    const ownerCompanyId=String(requestedOwnerCompanyId||facilityOwnerCompanyId(base)||'').trim(),owner=COMPANY_PLATFORM.resolveCompany(state,ownerCompanyId),assetClass=companyAssetClassForMode(state,ownerCompanyId,type,item.assetClass||'');
    if(!ownerCompanyId||!owner?.operational||facilityOwnerCompanyId(base)!==ownerCompanyId||!assetClass){if(!silent)notice('تعذر تنفيذ الشراء: الشركة المالكة أو فئة الأصل غير متوافقة مع قاعدة التسليم.');return null;}
    const compatible=window.GH_FACILITY_CORE?.isAssetFacilityCompatible?.({assetMode:type,ownerCompanyId,assetClass},base,state)===true;
    if(!compatible){if(!silent)notice('قاعدة التسليم لا تدعم هذا النوع من الأصول.');return null;}
    const assetSupplier=supplierFor(type,'assets');if(!assetSupplier){if(!silent)notice('تعذر تنفيذ الشراء: لا يوجد مورد أصول مؤهل.');return null;}
    const totalPrice=Number(item.price)*qty,upfront=mode==='cash'?totalPrice:mode==='finance'?totalPrice*(item.downPayment||.2):Number(item.leaseMonthly||0)*3*qty;
    if(!Number.isFinite(totalPrice)||totalPrice<=0||!Number.isFinite(upfront)||upfront<0){if(!silent)notice('تعذر تنفيذ الشراء بسبب بيانات سعر غير صالحة.');return null;}
    let allocations;try{allocations=allocateAssetPurchase(type,qty,base.id,ownerCompanyId,assetClass);}catch(error){if(!silent)notice(String(error.message||error));return null;}
    const fundingGap=ownerCompanyId==='group'||canCompanySpend(ownerCompanyId,upfront,'capex')?0:Math.max(0,upfront-companyOperatingBalance(ownerCompanyId));
    const realism=window.GH_REALISM?.migrate(state),leadBase=Number(realism?.procurement?.leadTimes?.[type])||(type==='air'?120:type==='sea'?210:21),documentLeadDays=tab==='used'?Math.max(5,Math.round(leadBase*.12)):mode==='lease'?Math.max(7,Math.round(leadBase*.18)):leadBase;
    try{return await runAuthorizedCompositeCommand('asset-purchase',({state:draft,dispatch,recordAlert})=>{
      if(fundingGap>0){
        if(companyOperatingBalanceFor(draft,'group')<fundingGap||dispatch('finance','transfer',{from:'group',to:ownerCompanyId,amount:fundingGap,note:`تمويل شراء أصول يدوي · ${item.name} × ${qty}`}).result?.transferred!==true)throw new Error('تعذر تمويل الشركة التابعة داخل معاملة الشراء.');
        recordAlert(`حُوِّل ${fmtMoney(fundingGap)} من الشركة القابضة إلى ${typeName(ownerCompanyId)} لتغطية شراء ${item.name}.`,'finance');
      }
      const paymentMethod='شيك مصرفي',results=[],allAssetIds=[],allDeliveryOrderIds=[],commandRef=requestRef||window.GH_DETERMINISM.nextId(draft,'MANUAL-ASSET');let allocatedPrice=0,allocatedUpfront=0;
      for(const [index,allocation] of allocations.entries()){
        const last=index===allocations.length-1,allocationPrice=last?totalPrice-allocatedPrice:Number(item.price)*allocation.qty,allocationUpfront=last?upfront-allocatedUpfront:upfront*(allocation.qty/qty),allocationRef=`${commandRef}-${index+1}`;
        if(facilityOwnerCompanyId(allocation.base)!==ownerCompanyId)throw new Error('asset-purchase-cross-company-allocation');
        const result=dispatch('procurement','purchase-assets',{type,ownerCompanyId,assetClass,tab,item,mode,qty:allocation.qty,base:allocation.base,supplier:assetSupplier,manual:true,requestRef:allocationRef,upfront:allocationUpfront,totalPrice:allocationPrice,paymentMethod,documentLeadDays,leadSeconds:0,immediateDelivery:true,companyName:companyFinanceName(ownerCompanyId)},{idempotencyKey:allocationRef}).result;
        if(!result?.orderId||Number(result.count)!==allocation.qty)throw new Error('Procurement Core لم ينشئ عقد التسليم كاملًا.');results.push(result);allAssetIds.push(...result.assetIds);allDeliveryOrderIds.push(...result.deliveryOrderIds);allocatedPrice+=allocationPrice;allocatedUpfront+=allocationUpfront;
      }
      const result={orderId:results[0]?.orderId||null,count:allAssetIds.length,assetIds:allAssetIds,deliveryOrderIds:allDeliveryOrderIds,allocations:allocations.map(row=>({baseId:row.base.id,baseName:row.base.name,qty:row.qty}))};if(result.count!==qty)throw new Error('لم تكتمل كل توزيعات أمر الشراء.');
      window.GH_REALISM?.onSimulationTime?.(draft,draft.simSeconds);
      const purchasedAssetIds=new Set(result.assetIds),deliveryById=new Map((draft.realism?.procurement?.deliveries||[]).map(row=>[row.id,row]));
      const deliveredIds=new Set((draft.assets||[]).filter(asset=>purchasedAssetIds.has(asset.id)&&asset.deliveryStatus==='delivered'&&asset.staffing?.ready===true).map(asset=>asset.id));
      if(deliveredIds.size!==qty||result.deliveryOrderIds.some(orderId=>deliveryById.get(orderId)?.status!=='delivered'))throw new Error('تعذر إثبات التسليم والطاقم داخل معاملة الشراء.');
      const distribution=result.allocations.map(row=>`${row.baseName}: ${row.qty}`).join(' · ');recordAlert(`تم شراء وتسليم ${qty} × ${item.name} وتوزيعها ذريًا (${distribution})، مع تكوين الطاقم الثابت والراتب تلقائيًا. مرجع المورد ${result.orderId}.`,'procurement');return result.orderId;
      },{silent,afterCommit:()=>{updateKpis();if(!silent)openDrawer('assetMarket',type);}});
    }catch(error){
      console.error('فشل معاملة شراء الأصل',error);if(!silent)notice('أُلغي الشراء بالكامل ولم يعتمد أي خصم أو تسليم بسبب فشل المعاملة الوقائية.');return null;
    }
  }

  async function openBranch(id,opts={}){
    const site=expansionSites.find(x=>x.id===id);if(!site){pushAlert('تعذر فتح هذا المقر؛ الموقع غير متاح.');return false;}
    const result=await runAuthorizedCompositeCommand('open-regional-hq',({state:draft,dispatch,recordAlert})=>{if((draft.branches||[]).includes(id))throw new Error('facility-already-open');const build=awardConstructionDraft(draft,dispatch,recordAlert,'group','hq',site.name,site.price);if(!build||build.insufficient)throw new Error('construction-funding-unavailable');dispatch('facilities','open-regional-hq',{id,groupValueAdd:build.amount*.7});ensureFacilityWorkforceDraft(draft,dispatch,'group','فتح مقر إقليمي');recordAlert(`أرسى إنشاء ${site.name} على ${build.contractor}.`,'facility');return true;},{silent:Boolean(opts.silent),afterCommit:()=>{updateKpis();renderMap();if(!opts.silent)openFacility(id);}});return Boolean(result);
  }
  function sameUnderlyingFacilityFor(target,baseFacilityId,routeFacilityId){
    if(!baseFacilityId||!routeFacilityId)return false;
    if(baseFacilityId===routeFacilityId)return true;
    const a=routeFacilityFor(target,baseFacilityId),b=routeFacilityFor(target,routeFacilityId);
    if(!a||!b)return false;
    return Boolean((a.iata&&a.iata===b.iata)||(a.icao&&a.icao===b.icao)||(a.code&&a.code===b.code));
  }
  function sameUnderlyingFacility(baseFacilityId,routeFacilityId){return sameUnderlyingFacilityFor(state,baseFacilityId,routeFacilityId);}
  function routeMatchingFacilityFor(target,runtime,routeId,baseFacility){
    const r=runtime[routeId];if(!r||!baseFacility||baseFacility===r.fromFacility||baseFacility===r.toFacility)return r;
    if(sameUnderlyingFacilityFor(target,baseFacility,r.fromFacility))return {...r,fromFacility:baseFacility};
    if(sameUnderlyingFacilityFor(target,baseFacility,r.toFacility))return {...r,toFacility:baseFacility};
    return r;
  }
  function routeMatchingFacility(routeId,baseFacility){
    return routeMatchingFacilityFor(state,routeTemplates,routeId,baseFacility);
  }
  async function assignRoute(assetId,routeId,opts={}){
    return runAuthorizedCompositeCommand('assign-route',({state:draft,routes,dispatch})=>{
      const asset=draft.assets.find(row=>row.id===assetId),route=routes[routeId];
      if(!asset||!route||assetModeOf(asset)!==routeModeOf(route)||!assetOwnerCompanyId(asset)||assetOwnerCompanyId(asset)!==routeOwnerCompanyId(route))throw new Error('الأصل أو المسار لا يتبعان الشركة نفسها');
      if(asset.phase==='moving'||asset.salePending||asset.deliveryStatus==='pending')throw new Error('الأصل غير متاح لتغيير المسار');
      if(!routeFitsAsset(asset,route))throw new Error('المسار يتجاوز مدى الأصل أو قيود التشغيل');
      if(!asset.baseFacility||(!sameUnderlyingFacilityFor(draft,asset.baseFacility,route.fromFacility)&&!sameUnderlyingFacilityFor(draft,asset.baseFacility,route.toFacility)))throw new Error('الأصل ليس موجودًا في إحدى نقطتي المسار');
      const conflict=window.GH_FLEET_CORE.routeConflict(draft,asset.id,route.id,route);if(conflict)throw new Error(asset.type==='air'?`المسار أو ممر مماثل محجوز للأصل ${conflict.name}`:`مسار الأسطول بلغ سعته التشغيلية (${window.GH_FLEET_CORE.routeCapacity(route)} أصل).`);
      const matched=routeMatchingFacilityFor(draft,routes,route.id,asset.baseFacility);
      dispatch('fleet','assign-route',{id:asset.id,routeId:route.id,baseFacility:asset.baseFacility,phase:'turnaround',route:matched});
      window.GH_FLEET_CORE.normalizeAsset(asset,{route:matched,catalogItem:catalogItem(asset.type,asset.catalogId)});
      window.GH_OPERATIONS_CORE.execute({state:draft},'record-alert',{text:`عُيّن ${asset.name} لمسار ${assetModeOf(asset)==='air'?'حصري':'أسطول مشترك'} ${route.name}.`,type:'route'});return {assetId:asset.id,companyId:assetOwnerCompanyId(asset)};
    },{silent:Boolean(opts.silent),afterCommit:result=>{lastDepartureBlocked=[];renderMap();updateKpis();openDrawer(opts.returnToRoutes?'routes':'assetManage',opts.returnToRoutes?result.companyId:result.assetId);}});
  }
  async function serviceAsset(id){
    const a=state.assets.find(x=>x.id===id);if(!a){notice('الأصل غير موجود');return false;}if(a.phase==='moving'){notice('لا يمكن صيانة الأصل أثناء الحركة');return false;}const cost=a.type==='air'?78000:a.type==='sea'?145000:2800,supplier=a.type==='air'?'Global MRO Aviation':a.type==='sea'?'Oceanic Technical Services':'RoadFleet Maintenance';try{const result=(await runAuthorizedDomainCommand('fleet','service',{id,cost,supplier,note:`صيانة وتعبئة كاملة ${a.name} · ${supplier}`,method:'تحويل صيانة',taxable:true})).result;if(!result)throw new Error('لم يرجع محرك الأسطول إثبات الصيانة');pushAlert(`اكتملت صيانة وتعبئة ${a.name} لدى ${supplier} بقيمة ${fmtMoney(cost)} وأصبحت الحالة 100%.`);updateKpis();openDrawer('assetManage',id);return true;}catch(error){notice(`تعذر صيانة الأصل: ${error.message}`);return false;}
  }
  // مصدر واحد لسبب تعطل أصل بعينه. الطاقم جزء ثابت من سجل الأصل ولا ينتظر قسم HR.
  function departureBlockReasonFor(asset,target=state,runtime=routeTemplates){
    const tpl=runtime[asset.routeId];
    if(!tpl)return {code:'no-route-data',text:'لا يوجد مسار تشغيلي صالح مرتبط بهذا الأصل.'};
    if(routeModeOf(tpl)!==assetModeOf(asset)||!assetOwnerCompanyId(asset)||routeOwnerCompanyId(tpl)!==assetOwnerCompanyId(asset))return {code:'route-company-mismatch',text:'المسار لا يتبع الشركة المالكة لهذا الأصل.'};
    if(asset.deliveryStatus==='pending'||asset.salePending)return {code:'asset-unavailable',text:'الأصل قيد التسليم أو البيع ولا يقبل أمر مغادرة.'};
    if(!routeFitsAsset(asset,tpl))return {code:'route-range-invalid',text:'المسار يتجاوز مدى الأصل أو قيود التشغيل.'};
    if(!asset.baseFacility||(!sameUnderlyingFacilityFor(target,asset.baseFacility,tpl.fromFacility)&&!sameUnderlyingFacilityFor(target,asset.baseFacility,tpl.toFacility)))return {code:'asset-location-mismatch',text:'موقع الأصل لا يطابق إحدى نقطتي المسار.'};
    if(asset.staffing?.mode!=='automatic-fixed'||asset.staffing.ready!==true)return {code:'asset-staffing-invalid',text:'سجل الطاقم الثابت لهذا الأصل غير مكتمل. أعد فحص الأصل؛ لا توجد موافقة HR مطلوبة.'};
    const conflict=window.GH_FLEET_CORE.routeConflict(target,asset.id,tpl.id,tpl);if(conflict)return asset.type==='air'?{code:'route-not-exclusive',text:`المسار أو ممر مماثل مستخدم بواسطة ${conflict.name}.`}:{code:'route-capacity-full',text:`مسار الأسطول تجاوز سعته التشغيلية (${window.GH_FLEET_CORE.routeCapacity(tpl)} أصل).`};
    return null;
  }
  function departureBlockReason(asset){return departureBlockReasonFor(asset,state,routeTemplates);}
  async function departRouteAssets(routeId,companyInput='road',assetId=null){
    const route=routeId?routeTemplates[routeId]:null,companyId=routeOwnerCompanyId(route)||routeCompanyFromInput(companyInput),type=routeModeOf(route)||companyRouteModes(companyId).find(mode=>['air','sea','road'].includes(mode));
    if(!companyId||!['air','sea','road'].includes(type)){notice('اختر شركة تشغيل واحدة للمغادرة؛ لا يُسمح بأمر مختلط.');return false;}
    const preview=state.assets.filter(asset=>assetOwnerCompanyId(asset)===companyId&&assetModeOf(asset)===type&&asset.routeId&&(!routeId||asset.routeId===routeId)&&(!assetId||asset.id===assetId)&&asset.phase==='turnaround'&&!asset.departureScheduled);
    if(!preview.length){notice('لا توجد أصول جاهزة للمغادرة ضمن هذا النطاق.');return false;}
    const previewBlocked=preview.map(asset=>{const block=departureBlockReason(asset);return block?{id:asset.id,name:asset.name,type:assetModeOf(asset),companyId:assetOwnerCompanyId(asset),...block}:null;}).filter(Boolean);
    if(previewBlocked.length){lastDepartureBlocked=previewBlocked;notice(`أُلغي الأمر بالكامل قبل تحريك أي أصل: ${previewBlocked.slice(0,3).map(row=>`${row.name} — ${row.text}`).join(' · ')}${previewBlocked.length>3?' …':''}`);return false;}
    return runAuthorizedCompositeCommand(`atomic-departure:${companyId}`,({state:draft,routes,dispatch})=>{
      const candidates=draft.assets.filter(asset=>assetOwnerCompanyId(asset)===companyId&&assetModeOf(asset)===type&&asset.routeId&&(!routeId||asset.routeId===routeId)&&(!assetId||asset.id===assetId)&&asset.phase==='turnaround'&&!asset.departureScheduled);if(candidates.length!==preview.length)throw new Error('تغيرت قائمة الأصول أثناء تجهيز الأمر');
      for(const asset of candidates){
        const block=departureBlockReasonFor(asset,draft,routes);if(block)throw new Error(`${asset.name}: ${block.text}`);
      }
      const departures=candidates.map(asset=>({id:asset.id,route:routeMatchingFacilityFor(draft,routes,asset.routeId,asset.baseFacility),load:loadLabel(asset),delaySeconds:window.GH_FLEET_CORE.departureDelay(asset)}));
      dispatch('fleet','depart-batch',{departures});
      for(const asset of candidates){const route=routeMatchingFacilityFor(draft,routes,asset.routeId,asset.baseFacility);window.GH_FLEET_CORE.normalizeAsset(asset,{route,catalogItem:catalogItem(asset.type,asset.catalogId)});}
      const routeCount=new Set(candidates.map(asset=>asset.routeId)).size;
      window.GH_OPERATIONS_CORE.execute({state:draft},'record-alert',{text:type==='air'?`مغادرة جوية ذرّية لشركة ${companyFinanceName(companyId)}: غادرت ${candidates.length} طائرة على ${routeCount} مسارًا مع فواصل مغادرة آمنة.`:`جُدولت مغادرة ${candidates.length} أصلًا من ${companyFinanceName(companyId)} ذريًا على ${routeCount} مسار أسطول مشترك.`,type:'dispatch'});return {departed:candidates.length,type,companyId,routeCount};
    },{afterCommit:()=>{lastDepartureBlocked=[];renderMap();updateKpis();}});
  }
  async function departNow(id){
    const asset=state.assets.find(row=>row.id===id);if(!asset){notice('تعذر تنفيذ المغادرة؛ الأصل غير موجود.');return false;}
    if(assetModeOf(asset)==='road'&&!asset.routeId&&asset.phase!=='moving')return dispatchExistingDistinctNetwork(assetOwnerCompanyId(asset),id);
    if(asset.phase!=='turnaround'){notice(`${asset.name} غادر بالفعل أو لم يصل بعد إلى محطة تشغيل.`);return false;}
    if(asset.departureScheduled){notice(`${asset.name} مجدول بالفعل ضمن دفعة الأسطول.`);return false;}
    const ok=await departRouteAssets(asset.routeId,assetOwnerCompanyId(asset),id);if(ok)openDrawer('assetManage',id);return ok;
  }
  function saleEstimate(a){const item=catalogItem(a.type,a.catalogId),basis=Number(a.purchasePrice)||Number(item?.price)||1000000;return a.ownership==='lease'?-(Number(a.monthlyLease)||0)*2:basis*.72*(Number(a.condition||100)/100);}
  async function disposeAsset(id,{automatic=false,bulk=false}={}){
    const a=state.assets.find(x=>x.id===id);if(!a)return false;if(a.salePending&&!automatic)return true;
    const proceeds=Math.max(0,saleEstimate(a)),fee=a.ownership==='lease'?Math.max(0,(Number(a.monthlyLease)||0)*2):0;
    if(!automatic&&!bulk&&!ask(a.ownership==='lease'?`إنهاء عقد تأجير ${a.name}؟ رسوم الإنهاء ${fmtMoney(fee)}.`:`بيع ${a.name} بالقيمة التقديرية ${fmtMoney(proceeds)}؟ إذا كان متحركًا فسيكمل الرحلة ثم يعود إلى مركز مملوك.`,'high'))return false;
    try{const current=state.assets.find(x=>x.id===id);if(!current)throw new Error('الأصل لم يعد موجودًا');const ownerCompanyId=assetOwnerCompanyId(current),payload={id,proceeds,fee,atOwnedCenter:Boolean(findFacility(current.baseFacility)?.owned),buyer:'مشتري أصل معتمد'},result=automatic?dispatchSystemCommand({state},'fleet','dispose',payload,{actor:'system-fleet-auto-disposal'}).result:(await runAuthorizedDomainCommand('fleet','dispose',payload)).result;if(!result)throw new Error('لم يرجع محرك الأسطول نتيجة البيع');if(result.status==='scheduled')pushAlert(`سُجل بيع ${current.name}: يكمل الرحلة الحالية أو يعود من المحطة العامة، ثم ينفذ البيع تلقائيًا في أول مركز مملوك.`);else if(result.status==='returned')pushAlert(`أعيد ${current.name} وأنهي عقد التأجير مقابل ${fmtMoney(result.fee)}.`);else pushAlert(`تم بيع ${current.name} وتحويل ${fmtMoney(result.proceeds)} إلى حساب ${companyFinanceName(ownerCompanyId)}.`);if(result.status!=='scheduled'&&selectedAssetId===id){selectedAssetId=null;$('assetCard').classList.add('hidden');}renderMap();updateKpis();if(!automatic&&!bulk)openDrawer(result.status==='scheduled'?'assetManage':'assets',result.status==='scheduled'?id:ownerCompanyId);return result.status;}catch(error){notice(`تعذر بيع الأصل: ${error.message}`);return false;}
  }
  function finalizeAssetSale(id,automatic=false){const a=state.assets.find(x=>x.id===id);if(!a||a.phase==='moving')return false;return disposeAsset(id,{automatic});}
  function requestAssetSale(id,bulk=false){return disposeAsset(id,{bulk});}
  async function sellAllAssets(companyInput){
    const companyId=routeCompanyFromInput(companyInput,state)||String(companyInput||''),company=COMPANY_PLATFORM.resolveCompany(state,companyId);if(!company?.operational){notice('تعذر تحديد الشركة المالكة لأمر البيع.');return false;}
    const rows=state.assets.filter(asset=>assetOwnerCompanyId(asset)===companyId&&!asset.salePending);if(!rows.length){pushAlert(`لا توجد أصول ${companyFinanceName(companyId)} متاحة لإصدار أوامر بيع.`);return;}
    const moving=rows.filter(a=>a.phase==='moving').length,estimated=rows.reduce((n,a)=>n+Math.max(0,saleEstimate(a)),0);
    if(!ask(`إصدار أمر بيع لجميع أصول ${companyFinanceName(companyId)} (${rows.length})؟ ${moving?`${moving} أصل سيكمل الرحلة الحالية ثم يعود/يتوقف في مركز الوصول قبل البيع. `:''}القيمة التقديرية للأصول المملوكة ${fmtMoney(estimated)}.`))return;
    return runAuthorizedCompositeCommand(`dispose-fleet:${companyId}`,({state:draft,dispatch,recordAlert})=>{let sold=0,scheduled=0,returned=0;for(const a of rows){const current=draft.assets.find(row=>row.id===a.id);if(!current||assetOwnerCompanyId(current)!==companyId)throw new Error(`asset-owner-conflict:${a.id}`);const proceeds=Math.max(0,saleEstimate(a)),fee=a.ownership==='lease'?Math.max(0,(Number(a.monthlyLease)||0)*2):0,result=dispatch('fleet','dispose',{id:a.id,proceeds,fee,atOwnedCenter:Boolean(dynamicFacilitiesFor(draft).find(f=>f.id===a.baseFacility&&facilityOwnerCompanyId(f)===companyId)?.owned),buyer:'مشتري أصول معتمد'}).result;if(result.status==='sold')sold++;else if(result.status==='returned')returned++;else scheduled++;}recordAlert(`أمر البيع الجماعي لشركة ${companyFinanceName(companyId)}: بيع ${sold}، إعادة ${returned} مؤجر، وجدولة ${scheduled} بعد الوصول. لا بيع في منتصف الرحلة.`,'fleet');return {sold,returned,scheduled};},{afterCommit:()=>{updateKpis();renderMap();openDrawer('assets',companyId);}});
  }
  function sellAsset(id){return requestAssetSale(id,false);}

  function openGod(){closeDrawer();syncGodCompanies();$('backdrop').classList.remove('hidden');$('godPanel').classList.add('open');$('godPanel').setAttribute('aria-hidden','false');updateKpis();syncGodEntityStatus();loadGodBudget();$('godDebtInput').value=Math.round(companyBook($('godDebtCompanySelect').value).debt||0);setGodTab($('godPanel').dataset.tab||'cash');}
  function closeGod(){$('godPanel').classList.remove('open');$('godPanel').setAttribute('aria-hidden','true');$('backdrop').classList.add('hidden');}
  function feedback(text){$('godFeedback').textContent=text;setTimeout(()=>{if($('godFeedback').textContent===text)$('godFeedback').textContent='';},2400);}

  function positionMapPopover(button,popover){
    if(!button||!popover||popover.classList.contains('hidden'))return;
    const stage=document.querySelector('.map-stage');if(!stage)return;
    const sr=stage.getBoundingClientRect(),br=button.getBoundingClientRect();
    // Temporarily measure after display; clamp the panel to the visible map-stage bounds.
    const pw=Math.max(1,popover.offsetWidth||popover.getBoundingClientRect().width||180);
    const ph=Math.max(1,popover.offsetHeight||popover.getBoundingClientRect().height||120);
    const margin=8;
    let left=br.left-sr.left;
    left=Math.max(margin,Math.min(left,Math.max(margin,sr.width-pw-margin)));
    let top=br.bottom-sr.top+6;
    if(top+ph>sr.height-margin)top=Math.max(margin,br.top-sr.top-ph-6);
    popover.style.setProperty('left',`${Math.round(left)}px`,'important');
    popover.style.setProperty('right','auto','important');
    popover.style.setProperty('top',`${Math.round(top)}px`,'important');
    popover.style.setProperty('bottom','auto','important');
  }
  function refreshOpenMapPopoverPositions(){
    positionMapPopover($('filterToggle'),$('filterPopover'));
    positionMapPopover($('layerBtn'),$('layerMenu'));
  }
  function closeMapPopovers(){$('filterPopover').classList.add('hidden');$('layerMenu').classList.add('hidden');}
  function syncMapCompanyFilterButtons(){
    const sections=[...document.querySelectorAll('#filterPopover .filter-section')],grid=sections.find(section=>section.querySelector('b')?.textContent?.includes('التشغيل'))?.querySelector('.filter-grid');if(!grid)return;
    grid.replaceChildren();for(const company of COMPANY_PLATFORM.listInstances(state,{includeGroup:false,openedOnly:true}).filter(row=>row.operational)){
      const identity=COMPANY_PLATFORM.resolveIdentity(state,company.id),definition=company.definition,button=document.createElement('button'),title=document.createElement('span'),detail=document.createElement('small'),selected=company.id===state.activeFilter;button.type='button';button.className=`filter-btn${selected?' active':''}`;button.dataset.filter=company.id;button.setAttribute('aria-pressed',String(selected));title.textContent=identity?.tradeName||identity?.shortName||identity?.legalName||company.id;detail.textContent=definition?.classification?.routeModes?.length?'الأصول والمسارات والمنشآت':'منشآت الشركة وتشغيلها';button.append(title,detail);grid.append(button);
    }
  }
  function advanceToNextSimulationDay(){
    const active=simulationEngine.snapshot().manualAdvance;
    if(active){simulationEngine.cancelAdvance('manual-calendar-cancelled');updateDayStepControl();renderSimulationCalendar();return false;}
    return requestCalendarAdvance(calendarAdvanceTargetDays(1),'calendar-next-day','بيوم واحد');
  }
  let resumeSpeed=startupSignatureResumeSpeed>0?startupSignatureResumeSpeed:(state.speed>0?state.speed:1);
  function setSpeed(value,options={}){if(state.speed>0)resumeSpeed=state.speed;const next=Number(value);simulationEngine.cancelAdvance?.('user-speed-change');state.speed=SAFE_SPEED_VALUES.includes(next)?next:1;simulationEngine.reset(performance.now(),'user-speed-change');document.querySelectorAll('#speedMenu button[data-speed]').forEach(b=>b.classList.toggle('active',Number(b.dataset.speed)===state.speed));$('speedLabel').textContent=SPEED_LABEL_BY_LEVEL[state.speed];$('speedToggle').querySelector('span').textContent=state.speed===0?'▶':'Ⅱ';$('speedToggle').setAttribute('aria-pressed',String(state.speed===0));updateDayStepControl();if(options.persist!==false)save();}

  function openWorld(){closeDrawer();closeGod();closeMapPopovers();$('assetCard').classList.add('hidden');setActiveNav('map');updateMapStatus();}
  document.querySelectorAll('[data-panel]').forEach(btn=>btn.addEventListener('click',()=>openDrawer(btn.dataset.panel)));
  $('mapNavBtn').addEventListener('click',openWorld);
  $('brandBtn').addEventListener('click',openWorld);
  $('worldDirectoryBtn').addEventListener('click',()=>openWorldDirectory());
  document.querySelectorAll('[data-mobile-map]').forEach(btn=>btn.addEventListener('click',openWorld));
  $('alertsBtn').addEventListener('click',()=>openDrawer('news')); $('healthBtn')?.addEventListener('click',()=>openDrawer('diagnostics')); $('settingsBtn').addEventListener('click',()=>openDrawer('settings'));
  $('executionLogBtn')?.addEventListener('click',()=>openDrawer('executionLog'));
  $('drawerClose').addEventListener('click',closeDrawer); $('godClose').addEventListener('click',closeGod);
  $('backdrop').addEventListener('click',()=>{$('godPanel').classList.contains('open')?closeGod():closeDrawer();});
  $('assetClose').addEventListener('click',()=>{$('assetCard').classList.add('hidden');selectedAssetId=null;renderMap();});
  $('assetManageBtn').addEventListener('click',()=>{if(selectedAssetId)openDrawer('assetManage',selectedAssetId);});
  syncMapCompanyFilterButtons();
  $('filterToggle').addEventListener('click',e=>{e.stopPropagation();const pop=$('filterPopover'),opening=pop.classList.contains('hidden');if(opening)syncMapCompanyFilterButtons();pop.classList.toggle('hidden');$('layerMenu').classList.add('hidden');if(opening)requestAnimationFrame(()=>positionMapPopover($('filterToggle'),pop));});
  $('layerBtn').addEventListener('click',e=>{e.stopPropagation();const pop=$('layerMenu'),opening=pop.classList.contains('hidden');pop.classList.toggle('hidden');$('filterPopover').classList.add('hidden');if(opening)requestAnimationFrame(()=>positionMapPopover($('layerBtn'),pop));});
  $('speedToggle').addEventListener('click',e=>{e.stopPropagation();setSpeed(state.speed===0?resumeSpeed:0);$('filterPopover').classList.add('hidden');$('layerMenu').classList.add('hidden');});
  $('simNextDay')?.addEventListener('click',advanceToNextSimulationDay);
  $('simCalendarToggle')?.addEventListener('click',e=>{e.stopPropagation();toggleSimulationCalendar();});
  $('simCalendarPanel')?.addEventListener('click',e=>e.stopPropagation());
  document.querySelectorAll('[data-calendar-advance]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();const kind=btn.dataset.calendarAdvance;if(kind==='year')requestCalendarAdvance(calendarAdvanceTargetYear(),'calendar-next-year','بسنة تقويمية');else requestCalendarAdvance(calendarAdvanceTargetDays(Number(kind)||1),`calendar-plus-${kind}-days`,`${kind} يوم`);}));
  $('simCalendarPrev')?.addEventListener('click',e=>{e.stopPropagation();if(!calendarViewMonth)return;calendarViewMonth=new Date(Date.UTC(calendarViewMonth.getUTCFullYear(),calendarViewMonth.getUTCMonth()-1,1));renderSimulationCalendar();});
  $('simCalendarNext')?.addEventListener('click',e=>{e.stopPropagation();if(!calendarViewMonth)return;calendarViewMonth=new Date(Date.UTC(calendarViewMonth.getUTCFullYear(),calendarViewMonth.getUTCMonth()+1,1));renderSimulationCalendar();});
  $('simCalendarGo')?.addEventListener('click',e=>{e.stopPropagation();const selected=calendarDateFromKey(calendarSelectedKey);if(selected&&requestCalendarAdvance(calendarDayStartSeconds(selected),'calendar-date-picker',`إلى ${calendarSelectedKey}`))toggleSimulationCalendar(false);});
  $('fitWorldBtn').addEventListener('click',()=>{if(map)map.setView([22,28],3);closeMapPopovers();});
  document.addEventListener('click',e=>{if(!e.target.closest('.map-popover')&&!e.target.closest('.map-fab')&&!e.target.closest('.speed-dock'))closeMapPopovers();if(!e.target.closest('#simClockChip')&&!e.target.closest('#simCalendarPanel'))toggleSimulationCalendar(false);});
  $('filterPopover').addEventListener('click',e=>{const btn=e.target.closest?.('.filter-btn');if(!btn||!$('filterPopover').contains(btn))return;e.stopPropagation();const camera=map?{center:map.getCenter(),zoom:map.getZoom()}:null;setMapFilterSelection(btn.dataset.filter);document.querySelectorAll('.filter-btn').forEach(b=>{const selected=b===btn;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});save();renderMap();if(camera&&map){const current=map.getCenter();if(map.getZoom()!==camera.zoom||Math.abs(current.lat-camera.center.lat)>1e-9||Math.abs(current.lng-camera.center.lng)>1e-9)map.setView(camera.center,camera.zoom,{animate:false});}});
  $('competitorToggle').addEventListener('change',e=>{state.showCompetitors=e.target.checked;const next=clone(currentMapFilter());next.market.competitors=state.showCompetitors;state.mapFilterState=clone(MAP_FEATURE_CORE.normalizeFilterState(next,{state,companyPlatform:COMPANY_PLATFORM}));save();renderMap();});
  document.querySelectorAll('.map-popover button,.map-popover input,.speed-menu button').forEach(el=>el.addEventListener('click',e=>e.stopPropagation()));
  window.addEventListener('resize',()=>requestAnimationFrame(refreshOpenMapPopoverPositions),{passive:true});
  window.addEventListener('orientationchange',()=>setTimeout(refreshOpenMapPopoverPositions,80),{passive:true});
  document.querySelectorAll('#layerMenu button').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();setMapLayer(btn.dataset.layer);save();/* keep menu open for consecutive choices */}));
  document.querySelectorAll('#speedMenu button[data-speed]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();setSpeed(btn.dataset.speed);/* keep menu open */}));

  function founderInvestmentDraft(draft,dispatch,recordAlert,type,amount,note='استثمار المؤسس عبر Good Mode'){
    amount=Math.max(0,Number(amount)||0);if(!amount)return null;const result=dispatch('finance','founder-investment',{company:type,amount,note}).result;if(type==='group')dispatch('corporate','adjust-group-value',{delta:amount*.25});recordAlert(`وردت حوالة استثمار من المؤسس ${result.ref} بقيمة ${fmtMoney(amount)} إلى ${companyFinanceName(type)} وسُجلت العملية كمعتمدة ومنفذة للمراجعة.`,'finance');return result.ref;
  }
  function founderCapitalWithdrawalDraft(draft,dispatch,recordAlert,type,amount,note='تسوية Good Mode'){amount=Math.max(0,Number(amount)||0);if(!amount)return null;const result=dispatch('finance','founder-withdrawal',{company:type,amount,note}).result;recordAlert(`صدر خطاب سحب رأسمالي ${result.ref} بقيمة ${fmtMoney(result.amount)} من ${companyFinanceName(type)}.`,'finance');return result.ref;}
  const godEntity=()=>{const value=$('godEntitySelect')?.value;if(!isFinanceCompany(value))throw new Error(`company-not-found:${String(value||'')}`);return value;};
  const syncGodEntityStatus=()=>{const type=godEntity(),el=$('godEntityStatus');if(el)el.textContent=`${companyFinanceName(type)} · الجاري ${fmtMoney(companyOperatingBalance(type))} · الإجمالي ${fmtMoney(companyTotalBalance(type))} · الدين ${fmtMoney(companyBook(type).debt||0)}`;};
  const budgetLineIds={payroll:'godBudgetPayroll',fuel:'godBudgetFuel',maintenance:'godBudgetMaintenance',marketing:'godBudgetMarketing',insurance:'godBudgetInsurance',technology:'godBudgetTechnology',capex:'godBudgetCapex',other:'godBudgetOther'};
  const loadGodBudget=()=>{const type=$('companyBudgetSelect').value,b=companyBudget(type);$('companyBudgetInput').value=Math.round(b.limit||0);for(const [k,id] of Object.entries(budgetLineIds))$(id).value=Math.round(Number(b.lines?.[k])||0);$('companyBudgetStatus').textContent=b.enabled?`المنفق ${fmtMoney(b.spent)} · المحجوز ${fmtMoney(b.reserved||0)} · المتبقي ${fmtMoney(companyBudgetRemaining(type))} · حد 30 يوم ${fmtMoney(b.limit)}`:'لا يوجد حد ميزانية مفعل';};
  function setGodTab(key){
    const tabs=[...document.querySelectorAll('[data-god-tab]')];if(!tabs.some(t=>t.dataset.godTab===key))return;
    $('godPanel').dataset.tab=key;for(const tab of tabs){const selected=tab.dataset.godTab===key;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;$(`godPage-${tab.dataset.godTab}`).hidden=!selected;}
    $('godPanel').querySelector('.god-body').scrollTop=0;$('godFeedback').textContent='';
  }
  function syncGodCompanies(){
    const types=companyFinanceTypes(state,{openedOnly:true}).filter((t,i,a)=>a.indexOf(t)===i);
    for(const id of ['godEntitySelect','companyBudgetSelect','godDebtCompanySelect']){const select=$(id),selected=select.value;select.replaceChildren(...types.map(type=>new Option(companyFinanceName(type),type)));select.value=types.includes(selected)?selected:'group';}
  }
  document.querySelectorAll('[data-god-tab]').forEach((tab,index,tabs)=>{tab.addEventListener('click',()=>setGodTab(tab.dataset.godTab));tab.addEventListener('keydown',e=>{let next;if(e.key==='ArrowLeft')next=(index+1)%tabs.length;else if(e.key==='ArrowRight')next=(index+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;e.preventDefault();setGodTab(tabs[next].dataset.godTab);tabs[next].focus();});});
  function godNumber(id){const input=$(id),value=Number(input.value);if(input.value.trim()===''||!Number.isFinite(value)||value<0)throw new Error('أدخل مبلغًا صالحًا لا يقل عن صفر');return value;}
  async function runGodAction(name,apply){
    const message=await runAuthorizedCompositeCommand(`god:${name}`,context=>apply(context),{silent:true});
    updateKpis();syncGodEntityStatus();if(message!==false){feedback(message);return true;}feedback('تعذر تنفيذ التعديل؛ تم التراجع عنه.');return false;
  }
  $('godMoneyToggle').addEventListener('change',e=>runGodAction('rules',({state:draft,dispatch})=>{draft.godMoney=e.target.checked;if(!draft.godMoney)draft.infiniteMoney=false;dispatch('operations','record-alert',{id:window.GH_DETERMINISM.nextId(draft,'EV'),text:`[God Mode] ${draft.godMoney?'تفعيل':'إيقاف'} أدوات التحكم المالي.`,type:'god-mode'});return draft.godMoney?'تم تفعيل God Money.':'تم إيقاف God Money.';}));
  $('infiniteToggle').addEventListener('change',e=>runGodAction('infinite',({state:draft,dispatch})=>{if(e.target.checked)draft.godMoney=true;draft.infiniteMoney=e.target.checked;dispatch('operations','record-alert',{id:window.GH_DETERMINISM.nextId(draft,'EV'),text:`[God Mode] ${draft.infiniteMoney?'تفعيل':'إيقاف'} تجاوز قيد السيولة؛ التكاليف الاقتصادية تبقى مسجلة.`,type:'god-mode'});return draft.infiniteMoney?'تم تجاوز قيد السيولة.':'تم تفعيل القيود المالية الطبيعية.';}));
  $('godEntitySelect').addEventListener('change',syncGodEntityStatus);
  function addGodMoney(amount,note){return runGodAction('invest',({state:draft,dispatch,recordAlert})=>{if(!Number.isFinite(amount)||amount<=0)throw new Error('أدخل مبلغًا أكبر من صفر');const ref=founderInvestmentDraft(draft,dispatch,recordAlert,godEntity(),amount,note);if(!ref)throw new Error('تعذر تسجيل حوالة المؤسس');return `حوالة مؤسس ${ref} · ${fmtMoney(amount)}.`;});}
  $('addMoneyBtn').addEventListener('click',()=>addGodMoney(Number($('addMoneyInput').value),'استثمار مباشر عبر Good Mode'));
  document.querySelectorAll('.quick-money button').forEach(b=>b.addEventListener('click',()=>addGodMoney(Number(b.dataset.money),'استثمار سريع عبر Good Mode')));
  $('setMoneyBtn').addEventListener('click',()=>runGodAction('set-cash',({state:draft,dispatch,recordAlert})=>{const type=godEntity(),target=godNumber('setMoneyInput'),delta=target-companyOperatingBalanceFor(draft,type);if(delta===0)return 'الرصيد الحالي يطابق المبلغ المستهدف.';const ref=delta>0?founderInvestmentDraft(draft,dispatch,recordAlert,type,delta,'استثمار المؤسس للوصول إلى الرصيد المستهدف'):founderCapitalWithdrawalDraft(draft,dispatch,recordAlert,type,-delta,'سحب رأسمالي للوصول إلى الرصيد المستهدف');if(!ref)throw new Error('تعذر الوصول إلى الرصيد المستهدف');return `تم الوصول إلى ${fmtMoney(target)} عبر ${delta>0?'حوالة استثمار مؤسس':'سحب رأسمالي موثق'}.`;}));
  $('setCompanyBudgetBtn').addEventListener('click',async()=>{const ok=await runGodAction('budget-limit',({dispatch,recordAlert})=>{const type=$('companyBudgetSelect').value,n=godNumber('companyBudgetInput');dispatch('finance','set-budget',{company:type,limit:n});const text=n>0?`ميزانية ${companyFinanceName(type)}: ${fmtMoney(n)} / 30 يوم`:`تم إلغاء حد الميزانية عن ${companyFinanceName(type)}`;recordAlert(`[God Mode] ${text}. الرصيد البنكي لم يتغير.`,'god-mode');return text;});if(ok)loadGodBudget();});
  $('companyBudgetSelect').addEventListener('change',loadGodBudget);
  $('budgetAutoSplitBtn').addEventListener('click',()=>{const total=Math.max(0,Number($('companyBudgetInput').value)||0),ratios={payroll:.21,fuel:.22,maintenance:.10,marketing:.05,insurance:.04,technology:.05,capex:.25,other:.08};let assigned=0;for(const [k,id] of Object.entries(budgetLineIds)){const amount=k==='other'?Math.max(0,total-assigned):Math.floor(total*ratios[k]);$(id).value=amount;assigned+=amount;}feedback('تم توزيع الميزانية؛ احفظ الخطة لاعتمادها.');});
  $('saveBudgetPlanBtn').addEventListener('click',async()=>{const ok=await runGodAction('budget-plan',({dispatch,recordAlert})=>{const type=$('companyBudgetSelect').value,lines={};for(const [k,id] of Object.entries(budgetLineIds))lines[k]=godNumber(id);const total=Object.values(lines).reduce((n,x)=>n+x,0);dispatch('finance','set-budget',{company:type,limit:total,lines});recordAlert(`[God Mode] اعتماد خطة ميزانية تفصيلية لـ ${companyFinanceName(type)} بقيمة ${fmtMoney(total)} دون تغيير السيولة.`,'god-mode');return `اعتمدت الخطة التفصيلية: ${fmtMoney(total)}.`;});if(ok)loadGodBudget();});
  $('resetCompanyBudgetBtn').addEventListener('click',async()=>{const ok=await runGodAction('budget-reset',({dispatch})=>{const type=$('companyBudgetSelect').value;dispatch('finance','reset-budget',{company:type});return `ألغيت ميزانية ${companyFinanceName(type)} فقط.`;});if(ok)loadGodBudget();});
  $('godDebtCompanySelect').addEventListener('change',()=>{$('godDebtInput').value=Math.round(companyBook($('godDebtCompanySelect').value).debt||0);});
  $('setGodDebtBtn').addEventListener('click',()=>runGodAction('set-debt',({dispatch,recordAlert})=>{const type=$('godDebtCompanySelect').value,n=godNumber('godDebtInput');dispatch('finance','set-debt',{company:type,amount:n});recordAlert(`[God Mode] تعيين دين ${companyFinanceName(type)} إلى ${fmtMoney(n)}.`,'god-mode');return `تم تحديث دين ${companyFinanceName(type)}.`;}));
  $('clearDebtBtn').addEventListener('click',async()=>{const ok=await runGodAction('clear-debts',({state:draft,dispatch,recordAlert})=>{const d=draft.debt;for(const t of companyFinanceTypes(draft))dispatch('finance','set-debt',{company:t,amount:0});recordAlert(`[God Mode] تصفير ديون المجموعة ${fmtMoney(d)}.`,'god-mode');return `تم تصفير ${fmtMoney(d)} من الديون.`;});if(ok)$('godDebtInput').value=0;});
  syncGodEntityStatus();loadGodBudget();

  let founderLogoData=null,founderLogoStyle='teal',founderLogoRequest=0,founderLogoLoading=false,founderReviewedInput=null,founderSubmitting=false,founderSignaturePad=null,signatureDialogPad=null,signatureDialogRequired=false,pendingAuthorizedResumeSpeed=startupSignatureResumeSpeed;
  function founderInput(){return {name:$('founderName').value,founder:$('founderOwner').value,shortName:$('founderShort').value,englishName:$('founderEnglishName').value,locationId:$('founderLocation').value,mode:$('founderMode').value,logo:founderLogoData,logoStyle:founderLogoStyle,riskAppetite:$('founderRisk').value,procurementPolicy:$('founderProcurement').value,signingAuthority:$('founderAuthority').value};}
  function founderFeedback(message=''){const box=$('founderError');box.textContent=message;box.hidden=!message;if(message)box.focus?.();}
  function ensureFounderSignaturePad(){if(!founderSignaturePad){const mount=$('founderSignatureMount');if(!mount||!window.GH_SIGNATURE_PAD?.mount)throw new Error('FOUNDING_SIGNATURE_PAD_UNAVAILABLE');founderSignaturePad=window.GH_SIGNATURE_PAD.mount(mount,{title:'توقيع المؤسس المرئي'});}return founderSignaturePad;}
  function setSignatureDialogError(message=''){const node=$('signatureDialogError');if(!node)return;node.textContent=message;node.hidden=!message;}
  function closeSignatureDialog(force=false){const dialog=$('signatureDialog');if(!dialog?.open)return;if(signatureDialogRequired&&!force){setSignatureDialogError('يمكنك الإغلاق، لكن المعاملات اليدوية الحساسة ستبقى متوقفة حتى اعتماد توقيع صالح.');}dialog.close();signatureDialogRequired=false;signatureDialogPad?.destroy?.();signatureDialogPad=null;$('signatureDialogMount')?.replaceChildren();}
  function openSignatureDialog(options={}){
    const dialog=$('signatureDialog'),mount=$('signatureDialogMount');if(!dialog||!mount||!window.GH_SIGNATURE_PAD?.mount)return false;signatureDialogRequired=Boolean(options.required);setSignatureDialogError();signatureDialogPad?.destroy?.();mount.replaceChildren();signatureDialogPad=window.GH_SIGNATURE_PAD.mount(mount,{title:'الإصدار الجديد من توقيع المعاملات'});if(!dialog.open)dialog.showModal();return true;
  }
  async function saveSignatureDialog(){
    let strokes;try{strokes=signatureDialogPad?.export();if(!strokes)throw new Error('ارسم توقيعًا واضحًا داخل المساحة.');}catch(error){setSignatureDialogError(error.message==='signature-too-short'?'أكمل التوقيع بخط أوضح وأطول.':String(error.message||error));return false;}
    $('signatureDialogSave').disabled=true;const result=await runDurableStateCommand('replace-founder-signature',({state:draft})=>{const created=createFounderSignature(draft,strokes,draft.profile?.founder);window.GH_OPERATIONS_CORE.execute({state:draft},'record-alert',{text:`اعتمد الإصدار ${created.signature.version} من التوقيع المرئي للمعاملات الجديدة. المستندات السابقة تحتفظ بإصدارها.`,type:'authorization'});return {signatureId:created.signature.id,version:created.signature.version};},{silent:true});$('signatureDialogSave').disabled=false;
    if(!result){setSignatureDialogError('لم يُحفظ التوقيع، ولم يتغير الإصدار المعتمد. تحقق من الحفظ وأعد المحاولة.');return false;}closeSignatureDialog(true);const resumeSpeed=SAFE_SPEED_VALUES.includes(Number(pendingAuthorizedResumeSpeed))&&Number(pendingAuthorizedResumeSpeed)>0?Number(pendingAuthorizedResumeSpeed):0;pendingAuthorizedResumeSpeed=0;if(resumeSpeed)setSpeed(resumeSpeed);else updateKpis();window.GH_WORKFLOW?.notify?.(`أصبح الإصدار ${result.version} من توقيعك المرئي معتمدًا للمعاملات الجديدة.${resumeSpeed?` استعيدت سرعة المحاكاة ${SPEED_LABEL_BY_LEVEL[resumeSpeed]}.`:''}`,'success',{state,panel:activeDrawerPanel,ephemeral:true});return true;
  }
  window.GH_OPEN_SIGNATURE_DIALOG=openSignatureDialog;
  $('signatureDialogClose')?.addEventListener('click',()=>closeSignatureDialog());
  $('signatureDialogCancel')?.addEventListener('click',()=>closeSignatureDialog());
  $('signatureDialogSave')?.addEventListener('click',saveSignatureDialog);
  document.addEventListener('click',event=>{const trigger=event.target.closest?.('[data-open-signature]');if(trigger){event.preventDefault();openSignatureDialog();}});
  function updateFounderLogoPreview(){
    const box=$('founderLogoPreview');if(!box)return;box.dataset.style=founderLogoStyle;
    const short=($('founderShort')?.value||'GH').slice(0,4).toUpperCase();
    box.innerHTML=founderLogoData?`<img src="${esc(founderLogoData)}" alt="شعار المجموعة">`:`<span>${esc(short)}</span>`;
    document.querySelectorAll('.inc-logo-option').forEach(button=>{const selected=button.dataset.logoStyle===founderLogoStyle&&!founderLogoData;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
    $('founderLogoClear').hidden=!founderLogoData;$('founderReview').disabled=founderLogoLoading||founderSubmitting;
  }
  function updateFounderCapitalPreview(){const value=window.GH_GAME_LIFECYCLE.FOUNDING_CAPITALS[$('founderMode').value];$('founderCapitalPreview').textContent=Number.isFinite(value)?`$${value.toLocaleString('en-US')}`:'—';founderReviewedInput=null;}
  function formationDocumentMarkup(document){
    const signed=document.status==='signed',articles=document.articles||window.GH_GAME_LIFECYCLE.FOUNDING_ARTICLES;
    const signatureVisual=authorizationSignatureMarkup(document,{legacyLabel:'عقد تاريخي بلا توقيع مرئي محفوظ'});
    return `<article class="formation-paper${signed?' is-signed':''}" aria-label="عقد تأسيس المجموعة">
      <header class="formation-header"><div><small dir="ltr">GLOBAL HOLDINGS / INCORPORATION</small><h2>عقد تأسيس المجموعة</h2><p>${esc(document.legalForm)}</p></div><div class="formation-monogram" data-compact="${String(document.shortName||'GH').length>2}" aria-hidden="true"><b>${esc(document.shortName||'GH')}</b></div></header>
      <div class="formation-reference"><span class="formation-status">${signed?'عقد معتمد':'نسخة للمراجعة'}</span><span>${signed?`سنة التأسيس · ${esc(document.year)}`:'رقم العقد يصدر عند الاعتماد'}</span></div>
      <dl class="formation-identity">
        <div class="formation-company"><dt>اسم المجموعة</dt><dd>${esc(document.name)}${document.englishName?`<bdi>${esc(document.englishName)}</bdi>`:''}</dd></div>
        <div class="formation-capital"><dt>رأس المال عند التأسيس</dt><dd>${Number(document.capital).toLocaleString('en-US')} <span class="formation-currency">USD</span></dd><dd class="formation-capital-note">${signed?'رأس المال المعتمد في العقد':'يودع كاملًا في الحساب الجاري للقابضة بعد الاعتماد'}</dd></div>
        <div class="formation-detail"><dt>المؤسس والمالك</dt><dd>${esc(document.founder)}</dd></div><div class="formation-detail"><dt>المقر الرئيسي</dt><dd>${esc(document.city)} · ${esc(document.country)}</dd></div>
        <div class="formation-detail"><dt>المخاطر</dt><dd>${esc(document.riskAppetite||'متوازنة')}</dd></div><div class="formation-detail"><dt>سلطة الاعتماد</dt><dd>${esc(document.signingAuthority||'المؤسس')}</dd></div>
      </dl>
      <div class="formation-terms"><div class="formation-terms-title"><h3>بنود التأسيس</h3><span>${String(articles.length).padStart(2,'0')} مواد</span></div>
        ${articles.map((article,index)=>`<section class="formation-article"><span class="formation-article-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><div><h4>${esc(article.title)}</h4><p>${esc(article.text)}</p></div></section>`).join('')}
      </div>
      <div class="formation-signature"><div><small>التوقيع المرئي المعتمد</small>${signatureVisual}</div><span>${signed?'تم الاعتماد':'بانتظار التوقيع'}</span></div>
      <footer class="formation-footer">${signed?`<span>رقم العقد · <bdi>${esc(document.id)}</bdi></span><span>الحساب الجاري · <bdi>${esc(document.accountId)}</bdi></span>`:'<span>نسخة العقد تحفظ في ملف المجموعة عند التأسيس.</span><span dir="ltr">GH / 01</span>'}</footer>
    </article>`;
  }
  function renderFormationContract(){const document=state.companyRegistry?.group?.formationDocument;if(!document)return '<div class="empty">لا توجد نسخة تفصيلية للعقد في هذا الحفظ القديم.</div>';return `<div class="list">${formationDocumentMarkup(document)}<button class="secondary-btn" data-open="companies">العودة إلى المجموعة</button></div>`;}
  function reviewFounder(){
    if(founderSubmitting||founderLogoLoading)return false;
    try{founderReviewedInput=window.GH_GAME_LIFECYCLE.prepareFounding(founderInput());}catch(error){founderFeedback(error.message);return false;}
    try{ensureFounderSignaturePad();}catch(error){founderFeedback(error.message);return false;}founderFeedback();$('founderContractPreview').innerHTML=formationDocumentMarkup(founderReviewedInput);
    $('founderForm').classList.add('is-reviewing');
    $('founderDataPane').hidden=true;$('founderReviewPane').hidden=false;
    $('founderDataStep').removeAttribute('aria-current');$('founderGovernanceStep').removeAttribute('aria-current');$('founderReviewStep').setAttribute('aria-current','step');
    $('founderFlow').scrollTop=0;$('founderReviewTitle').focus?.();return true;
  }
  function editFounder(){
    if(founderSubmitting)return;founderReviewedInput=null;
    $('founderForm').classList.remove('is-reviewing');
    $('founderReviewPane').hidden=true;$('founderDataPane').hidden=false;
    $('founderReviewStep').removeAttribute('aria-current');$('founderDataStep').setAttribute('aria-current','step');$('founderGovernanceStep').setAttribute('aria-current','step');
    founderFeedback();$('founderFlow').scrollTop=0;$('founderName').focus?.();
  }
  function compressLogoFile(file){return new Promise((resolve,reject)=>{const allowed=new Set(['image/png','image/jpeg','image/webp']);if(!file||!allowed.has(String(file.type).toLowerCase())){reject(new Error('اختر شعارًا بصيغة PNG أو JPEG أو WebP.'));return;}if(file.size>8*1024*1024){reject(new Error('حجم الصورة كبير جدًا. الحد 8MB قبل الضغط.'));return;}const reader=new FileReader();reader.onerror=()=>reject(new Error('تعذر قراءة الصورة من الاستديو.'));reader.onload=()=>{const img=new Image();img.onerror=()=>reject(new Error('ملف الصورة غير قابل للقراءة.'));img.onload=()=>{const sourceWidth=Math.floor(Number(img.naturalWidth)||0),sourceHeight=Math.floor(Number(img.naturalHeight)||0);if(sourceWidth<1||sourceHeight<1||sourceWidth*sourceHeight>16000000){reject(new Error('أبعاد الشعار غير صالحة أو كبيرة جدًا للمعالجة الآمنة.'));return;}const max=360,scale=Math.min(1,max/Math.max(sourceWidth,sourceHeight)),w=Math.max(1,Math.round(sourceWidth*scale)),h=Math.max(1,Math.round(sourceHeight*scale)),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const c=canvas.getContext('2d',{alpha:true});if(!c){reject(new Error('تعذر تجهيز مساحة الصورة.'));return;}c.clearRect(0,0,w,h);c.drawImage(img,0,0,w,h);let data;try{data=canvas.toDataURL('image/webp',.76);if(!data.startsWith('data:image/webp'))data=canvas.toDataURL('image/jpeg',.78);}catch{data=canvas.toDataURL('image/jpeg',.78);}if(data.length>280000){reject(new Error('الشعار ما زال كبيرًا بعد الضغط. اختر صورة أبسط أو أقل تفاصيل.'));return;}resolve(data);};img.src=String(reader.result);};reader.readAsDataURL(file);});}
  document.querySelectorAll('.inc-logo-option').forEach(button=>button.addEventListener('click',()=>{founderLogoRequest++;founderLogoLoading=false;founderLogoStyle=button.dataset.logoStyle;founderLogoData=null;$('founderLogoUpload').value='';$('founderLogoStatus').textContent='';updateFounderLogoPreview();}));
  $('founderLogoUpload')?.addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;const request=++founderLogoRequest;founderLogoLoading=true;$('founderLogoStatus').textContent='جارٍ تجهيز الشعار…';updateFounderLogoPreview();
    try{const logo=await compressLogoFile(file);if(request!==founderLogoRequest)return;founderLogoData=logo;$('founderLogoStatus').textContent='الشعار جاهز';founderFeedback();}
    catch(error){if(request!==founderLogoRequest)return;founderFeedback(error.message||'تعذر تجهيز الشعار.');event.target.value='';$('founderLogoStatus').textContent='';}
    finally{if(request===founderLogoRequest){founderLogoLoading=false;updateFounderLogoPreview();}}
  });
  $('founderLogoClear')?.addEventListener('click',()=>{founderLogoRequest++;founderLogoLoading=false;founderLogoData=null;$('founderLogoUpload').value='';$('founderLogoStatus').textContent='';updateFounderLogoPreview();});
  $('founderShort')?.addEventListener('input',updateFounderLogoPreview);
  $('founderMode').addEventListener('change',updateFounderCapitalPreview);
  $('founderLocation').innerHTML=window.GH_GAME_LIFECYCLE.FOUNDING_LOCATIONS.map(row=>`<option value="${row.id}">${esc(row.city)} · ${esc(row.country)}</option>`).join('');
  $('founderLocation').value='RUH';
  $('founderReview').addEventListener('click',reviewFounder);$('founderBack').addEventListener('click',editFounder);
  updateFounderLogoPreview();updateFounderCapitalPreview();

  async function finishFounder(){
    if(founderSubmitting||state.onboardingComplete||founderLogoLoading)return false;
    if(!founderReviewedInput){reviewFounder();return false;}
    try{if(JSON.stringify(window.GH_GAME_LIFECYCLE.prepareFounding(founderInput()))!==JSON.stringify(founderReviewedInput)){editFounder();founderFeedback('تغيرت البيانات. راجع العقد مجددًا قبل التوقيع.');return false;}}catch(error){editFounder();founderFeedback(error.message);return false;}
    let strokes;try{strokes=ensureFounderSignaturePad().export();}catch(error){founderFeedback(error.message==='signature-too-short'?'أكمل توقيعك بخط أوضح وأطول قبل اعتماد العقد.':String(error.message||error));return false;}
    founderSubmitting=true;founderFeedback();$('founderForm').setAttribute('aria-busy','true');
    $('founderSubmit').disabled=true;$('founderBack').disabled=true;$('founderSubmit').textContent='جارٍ اعتماد العقد وحفظه…';
    const result=await runDurableStateCommand('found-group',({state:draft})=>{const authority=createFounderSignature(draft,strokes,founderReviewedInput.founder),plan=window.GH_GAME_LIFECYCLE.prepareFormationPlan(founderReviewedInput,authority.signature,{createdAt:Number(draft.simSeconds)||0});return window.GH_GAME_LIFECYCLE.foundGroup(draft,plan,defaultState,{nextId:prefix=>window.GH_DETERMINISM.nextId(draft,prefix),simYear:()=>new Date(SIM_START+(Number(draft.simSeconds)||0)*1000).getUTCFullYear(),fmtMoney,signatureSnapshot,dispatchAuthorized:(target,domain,name,payload,options)=>authorizedDraftDispatch(target,domain,name,payload,options)});},{silent:true});
    founderSubmitting=false;$('founderForm').removeAttribute('aria-busy');$('founderSubmit').disabled=false;$('founderBack').disabled=false;$('founderSubmit').textContent='توقيع العقد وتأسيس المجموعة';
    if(!result){founderFeedback('لم يُعتمد العقد ولم يُضف رأس المال. تعذر تأكيد الحفظ؛ أعد المحاولة بعد زوال السبب.');return false;}
    $('founderFlow').classList.add('hidden');$('founderContractPreview').innerHTML='';founderSignaturePad?.destroy?.();founderSignaturePad=null;$('founderSignatureMount')?.replaceChildren();$('app').removeAttribute('inert');$('app').removeAttribute('aria-hidden');$('app').style.pointerEvents='';
    updateKpis();renderMap();return true;
  }
  $('founderForm').addEventListener('submit',event=>{event.preventDefault();return finishFounder();});
  if(!state.onboardingComplete){$('founderFlow').classList.remove('hidden');$('app').setAttribute('inert','');$('app').setAttribute('aria-hidden','true');}

  updateKpis();setSpeed(state.speed,{persist:false});$('competitorToggle').checked=!!state.showCompetitors;
  document.querySelectorAll('.filter-btn').forEach(b=>{const selected=b.dataset.filter===state.activeFilter;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
  initMap();
  if(startupSignatureRequired){state.speed=0;setTimeout(()=>{openSignatureDialog({required:true});startupSignatureRequired=false;pendingAuthorizedResumeSpeed=startupSignatureResumeSpeed;setSignatureDialogError('المحاكاة متوقفة وقائيًا. اعتمد توقيع المؤسس المرئي قبل استئناف العمليات الآلية أو اليدوية.');updateKpis();},0);}
  if(state.onboardingComplete&&state.lastPanel){
    try{ openDrawer(state.lastPanel,state.lastPanelArg??undefined); }
    catch(error){ state.lastPanel=null;state.lastPanelArg=null;diag('RESTORE_LAST_PANEL_FAILED',{message:String(error?.message||error)},'warning'); }
  }

  let lastMapRenderAt=0,lastPresentationPaintAt=0,lastMarkerAnimationAt=0,lastLoopRafTimestamp=null;
  const latestSimulationTransaction=()=>window.GH_TRANSACTION_CORE?.telemetry?.()?.lastSimulation||null;
  function recordGuardedDiagnosticFrame(now,callbackStartMs,guardReason){const callbackEndMs=appMetricClock(),fleetSize=(state.assets?.length||0)+(state.mobility?.vehicles?.length||0);window.GH_DIAGNOSTICS?.recorderFrame?.(state,{rafTimestampMs:Number(now),callbackStartMs,callbackEndMs,simSeconds:state.simSeconds,visible:!document.hidden,hidden:!!document.hidden,panel:activeDrawerPanel||'map',mapActive:!!map,fleetSize,ownMarkers:ownMarkers.size,mobilityMarkers:renderedMobilityIds.size,simulationStage:guardReason,guardReason},{transactionProvider:latestSimulationTransaction});}
  function presentationFrameInterval(){const fleetSize=(state.assets?.length||0)+(state.mobility?.vehicles?.length||0),advancing=!!simulationEngine.snapshot().manualAdvance;if(document.hidden)return 1000;if(activeDrawerPanel||advancing)return fleetSize>2000?300:fleetSize>750?220:fleetSize>250?150:100;if(fleetSize>3000)return 220;if(fleetSize>1500)return 180;if(fleetSize>750)return 140;if(fleetSize>400)return 110;if(fleetSize>180)return 80;return 55;}
  function loop(now){
    const frameIntervalMs=lastLoopRafTimestamp===null?null:Math.max(0,now-lastLoopRafTimestamp);lastLoopRafTimestamp=now;
    const frameRecorderActive=window.GH_DIAGNOSTICS?.recorderIsActive?.(state)===true,recorderCallbackStartMs=frameRecorderActive?appMetricClock():0;
    if(window.GH_CONFERENCE?.isPresentationActive?.()){simulationEngine.reset(now,'conference-3d');if(frameRecorderActive)recordGuardedDiagnosticFrame(now,recorderCallbackStartMs,'conference-3d');requestAnimationFrame(loop);return;}
    if(hardResetInProgress||durableCommandInProgress||window.GH_PERSISTENCE.isLocked()){simulationEngine.reset(now,'lifecycle-lock');if(frameRecorderActive)recordGuardedDiagnosticFrame(now,recorderCallbackStartMs,'lifecycle-lock');requestAnimationFrame(loop);return;}
    if(processOneRecoveryBoundary()){simulationEngine.reset(now,'boundary-recovery');if(frameRecorderActive)recordGuardedDiagnosticFrame(now,recorderCallbackStartMs,'boundary-recovery');requestAnimationFrame(loop);return;}
    const renderMetrics=runtimeInstrumentation.render,measureFrame=frameRecorderActive||(++renderMetrics.frameCounter%30)===0,frameStarted=measureFrame?appMetricClock():0;let simulationMs=0,targetUpdateMs=0,markerAnimationMs=0,structuralRenderMs=0,targetUpdated=false,markerAnimated=false,structureRendered=false;
    let stageStarted=measureFrame?appMetricClock():0;simulationEngine.frame(now);if(measureFrame)simulationMs=Math.max(0,appMetricClock()-stageStarted);
    // The simulation remains authoritative on every frame. Expensive target
    // collection is sampled separately from bounded visible-marker animation.
    // Device thermal/memory acceptance still requires a real iPhone trace.
    const presentationEvery=presentationFrameInterval();
    if(now-lastPresentationPaintAt>=presentationEvery){lastPresentationPaintAt=now;stageStarted=appMetricClock();updateMarkerPositions();targetUpdateMs=Math.max(0,appMetricClock()-stageStarted);targetUpdated=true;recordRenderMetric('target-update',targetUpdateMs,{fleetSize:(state.assets?.length||0)+(state.mobility?.vehicles?.length||0),ownMarkers:ownMarkers.size,mobilityMarkers:renderedMobilityIds.size});}
    // Target collection may scan a fleet; interpolation touches only the bounded
    // visible marker set. Keep it independent of fleet size and of game time.
    if(!document.hidden&&now-lastMarkerAnimationAt>=32){lastMarkerAnimationAt=now;const measureAnimation=frameRecorderActive||(++renderMetrics.animationCounter%15)===0;if(measureAnimation)stageStarted=appMetricClock();animateMapMarkerPositions(now);if(measureAnimation){markerAnimationMs=Math.max(0,appMetricClock()-stageStarted);markerAnimated=true;recordRenderMetric('marker-animation',markerAnimationMs,{ownMarkers:ownMarkers.size,mobilityMarkers:renderedMobilityIds.size});}}
    const fleetSizeForMap=(state.assets?.length||0)+(state.mobility?.vehicles?.length||0),mapStructureInterval=fleetSizeForMap>3000?30000:fleetSizeForMap>1000?20000:8000;if(map&&now-lastMapRenderAt>=mapStructureInterval){lastMapRenderAt=now;if(mapStructureSignature()!==lastMapStructureSignature){stageStarted=appMetricClock();renderMap();structuralRenderMs=Math.max(0,appMetricClock()-stageStarted);structureRendered=true;recordRenderMetric('structural-render',structuralRenderMs,{fleetSize:fleetSizeForMap,ownMarkers:ownMarkers.size,mobilityMarkers:renderedMobilityIds.size});}}
    const simulationSnapshot=frameRecorderActive?simulationEngine.snapshot():null,callbackEndMs=measureFrame?appMetricClock():0,frameWorkMs=measureFrame?Math.max(0,callbackEndMs-frameStarted):0;
    if(measureFrame)recordRenderMetric('frame',frameWorkMs,{frameIntervalMs,simulationMs,targetUpdateMs,markerAnimationMs,structuralRenderMs,targetUpdated,markerAnimated,structureRendered,fleetSize:fleetSizeForMap,ownMarkers:ownMarkers.size,mobilityMarkers:renderedMobilityIds.size});
    if(frameRecorderActive)window.GH_DIAGNOSTICS.recorderFrame(state,{rafTimestampMs:Number(now),callbackStartMs:frameStarted,callbackEndMs,simSeconds:state.simSeconds,simulationMs,targetUpdateMs,markerAnimationMs,structuralRenderMs,targetUpdated,markerAnimated,structureRendered,fleetSize:fleetSizeForMap,ownMarkers:ownMarkers.size,mobilityMarkers:renderedMobilityIds.size,panel:activeDrawerPanel||'map',mapActive:!!map,visible:!document.hidden,hidden:!!document.hidden,simulationStage:simulationSnapshot?.lastWorkStage,simulationGovernor:simulationSnapshot?.governor,simulationBacklog:simulationSnapshot?.backlog,simulationJobActive:simulationSnapshot?.jobActive,manualAdvance:!!simulationSnapshot?.manualAdvance,lastCreateMs:simulationSnapshot?.lastCreateMs,lastChunkMs:simulationSnapshot?.lastChunkMs,lastFinishMs:simulationSnapshot?.lastFinishMs,lastCycleMs:simulationSnapshot?.lastCycleMs},{transactionProvider:latestSimulationTransaction});
    requestAnimationFrame(loop);
  }
  simulationEngine.reset(performance.now());
  requestAnimationFrame(loop);
  // A Clean Atomic update is not considered booted until every core above, the
  // save migration, map initialization and simulation scheduler reached here.
  // Native keeps the previous WebApp until this confirmation succeeds.
  setTimeout(()=>{
    try{
      const schema=window.GH_SAVE_SCHEMA?.validate?.(state),integrity=window.GH_INTEGRITY_CORE?.check?.(state);
      if(schema&&!schema.ok){state.speed=0;diag('UPDATE_BOOT_SCHEMA_REJECTED',{version:APP_VERSION,errors:schema.errors},'critical');return;}
      if(integrity?.critical?.length){state.speed=0;diag('UPDATE_BOOT_INTEGRITY_REJECTED',{version:APP_VERSION,issues:integrity.critical.map(x=>x.id||x.code||x.title)},'critical');return;}
      const bridge=window.webkit?.messageHandlers?.updateBridge;
      if(bridge){diag('UPDATE_BOOT_CONFIRM_REQUEST',{version:APP_VERSION,build:RUNTIME_BUILD});bridge.postMessage({action:'confirmUpdateBoot',version:APP_VERSION,build:RUNTIME_BUILD});}
    }catch(error){state.speed=0;diag('UPDATE_BOOT_CONFIRM_BRIDGE_FAILED',{version:APP_VERSION,message:String(error?.message||error)},'critical');console.error('Native update boot confirmation failed',error);}
  },0);
})();
