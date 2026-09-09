(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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
  const APP_VERSION = '2.9.1';
  const SAVE_SCHEMA_VERSION = '2.0.0';
  // Keep the storage key stable across compatible app releases so existing saves are not orphaned.
  const storageKey = `global-holdings-world-v${SAVE_SCHEMA_VERSION}`;
  const resetMarkerKey = 'global-holdings-reset-epoch';
  let hardResetInProgress=false;
  let mapInteractionActive=false,lastMarkerFrameAt=0,lastHudRefreshAt=0;
  const legacyStorageKeys = ['global-holdings-world-v1.2.0','global-holdings-world-v1.1.0','global-holdings-premium-v1.0.0','global-holdings-clean-v0.1.2'];
  const SIM_START = Date.UTC(2026, 0, 1, 0, 0, 0);
  const EARTH_RADIUS_KM = 6371.0088;

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
          route[i][1] + (route[i + 1][1] - route[i][1]) * t
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
  const airportIndex = new Map(WORLD.airports.map(row=>[row[0],row]));
  const portIndex = new Map(WORLD.ports.map(row=>[`${row[0]}:${row[3]}:${row[4]}`,row]));
  const regionNames = typeof Intl.DisplayNames==='function' ? new Intl.DisplayNames(['ar'],{type:'region'}) : null;
  const countryNameOf = code => { try{ return (code && regionNames) ? (regionNames.of(code)||code) : (code||'—'); }catch{ return code||'—'; } };
  // ---- تسمية تلقائية للموقع: دليل أحياء محلي أولًا، ثم أقرب مدينة من فهرس المطارات ----
  // لا نعتمد على reverse geocoding خارجي حتى تعمل تسمية النقطة في iPhone دون اتصال.
  // أمثلة الرياض هنا مقصودة كي يتحول اختيار حي النسيم فعلًا إلى "مركز الرياض — حي النسيم".
  const LOCAL_PLACE_AREAS = [
    {city:'الرياض',area:'حي النسيم',country:'السعودية',coords:[24.7475,46.7955],radiusKm:15},
    {city:'الرياض',area:'حي الملز',country:'السعودية',coords:[24.6740,46.7315],radiusKm:15},
    {city:'الرياض',area:'حي العليا',country:'السعودية',coords:[24.6990,46.6810],radiusKm:15},
    {city:'الرياض',area:'حي العقيق',country:'السعودية',coords:[24.7820,46.6400],radiusKm:17},
    {city:'الرياض',area:'حي الياسمين',country:'السعودية',coords:[24.8350,46.6460],radiusKm:18},
    {city:'الرياض',area:'الدرعية',country:'السعودية',coords:[24.7390,46.5750],radiusKm:17},
    {city:'جدة',area:'حي الحمراء',country:'السعودية',coords:[21.5260,39.1660],radiusKm:17},
    {city:'جدة',area:'حي الروضة',country:'السعودية',coords:[21.5700,39.1570],radiusKm:17},
    {city:'مكة المكرمة',area:'العزيزية',country:'السعودية',coords:[21.3890,39.8570],radiusKm:18},
    {city:'المدينة المنورة',area:'المنطقة المركزية',country:'السعودية',coords:[24.4670,39.6110],radiusKm:18},
    {city:'الدمام',area:'حي الفيصلية',country:'السعودية',coords:[26.4120,50.1040],radiusKm:18},
    {city:'دبي',area:'القَرْهود',country:'الإمارات',coords:[25.2440,55.3550],radiusKm:14},
    {city:'دبي',area:'جبل علي',country:'الإمارات',coords:[25.0150,55.0680],radiusKm:17},
    {city:'الدوحة',area:'الخليج الغربي',country:'قطر',coords:[25.3270,51.5310],radiusKm:16},
    {city:'الكويت',area:'شرق',country:'الكويت',coords:[29.3770,47.9900],radiusKm:16}
  ];
  function nearestPlace(coords){
    let nearbyArea=null, nearbyAreaDistance=Infinity;
    for(const area of LOCAL_PLACE_AREAS){
      const d=haversine(coords,area.coords);
      if(d<nearbyAreaDistance){nearbyAreaDistance=d;nearbyArea=area;}
    }
    if(nearbyArea&&nearbyAreaDistance<=nearbyArea.radiusKm){
      return {city:nearbyArea.city,area:nearbyArea.area,country:nearbyArea.country,distanceKm:Math.round(nearbyAreaDistance),label:`${nearbyArea.city} — ${nearbyArea.area}`};
    }
    let best=null, bestDist=Infinity;
    for(const row of WORLD.airports){
      const [,, , city, region, country, lat, lon] = row;
      if(!city) continue; // تجاهل المدرجات بلا اسم مدينة معروف
      const d = haversine(coords,[lat,lon]);
      if(d<bestDist){bestDist=d;best={city,region,country};}
    }
    if(!best) return {city:'موقع مخصص',country:'—',label:'موقع مخصص'};
    const countryLabel=countryNameOf(best.country);
    return {city:best.city,country:countryLabel,distanceKm:Math.round(bestDist),label:bestDist<=60?best.city:`قرب ${best.city}`};
  }
  const logisticsCenterName = place => place?.area ? `مركز ${place.city} — ${place.area}` : `مركز ${place?.label||'موقع مخصص'}`;
  const esc = value => String(value??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const normalizeSearch = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const countryLabel = code => {
    if(!code)return 'غير محدد';
    if(code.length===2){try{return regionNames?.of(code)||code;}catch{return code;}}
    return code.replace(/\b\w/g,c=>c.toUpperCase());
  };
  function airportEntity(row){
    if(!row)return null;
    return {key:`air:${row[0]}`,kind:'airport',icon:'🛫',code:row[1]||row[0],icao:row[0],iata:row[1],name:row[2],city:row[3]||row[4]||'—',subdivision:row[4],country:countryLabel(row[5]),countryCode:row[5],coords:[row[6],row[7]],elevationFt:row[8],commercial:!!row[1]};
  }
  function portEntity(row){
    if(!row)return null;
    return {key:`port:${row[0]}:${row[3]}:${row[4]}`,kind:'port',icon:'⚓',code:row[0],name:row[1],city:row[1],country:countryLabel(row[2]),coords:[row[3],row[4]],terminal:!!row[5]};
  }
  function worldEntityByKey(key){
    const parts=String(key||'').split(':');
    if(parts[0]==='air')return airportEntity(airportIndex.get(parts[1]));
    if(parts[0]==='port')return portEntity(portIndex.get(`${parts[1]}:${parts[2]}:${parts[3]}`));
    return null;
  }
  function facilityPrice(entity){
    if(entity.kind==='airport')return entity.commercial?36000000:8500000;
    return entity.terminal?24000000:7200000;
  }
  function facilityDailyCost(entity){
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
    AIR_RUH_LHR:{id:'AIR_RUH_LHR',type:'air',name:'الرياض → لندن',from:'الرياض',to:'لندن',fromFacility:'AP-RUH',toFacility:'AP-LHR',route:greatCircle([24.9576,46.6988],[51.4700,-0.4543],42),effectiveSpeedKmh:760,dwellHours:1.1},
    AIR_DXB_SIN:{id:'AIR_DXB_SIN',type:'air',name:'دبي → سنغافورة',from:'دبي',to:'سنغافورة',fromFacility:'AP-DXB',toFacility:'AP-SIN',route:greatCircle([25.2532,55.3657],[1.3644,103.9915],42),effectiveSpeedKmh:770,dwellHours:1.2},
    SEA_SIN_JED:{id:'SEA_SIN_JED',type:'sea',name:'سنغافورة → جدة',from:'سنغافورة',to:'جدة',fromFacility:'PT-SIN',toFacility:'PT-JED',route:[[1.264,103.84],[2.7,101.0],[5.6,96.1],[7.2,82.2],[8.0,75.0],[9.0,65.0],[11.0,55.0],[12.1,48.0],[12.6,43.4],[14.6,42.6],[18.0,40.2],[21.4858,39.173]],effectiveSpeedKmh:31.5,dwellHours:10,cargoDemand:{dry:2380,reefer:340}},
    SEA_RTM_NYC:{id:'SEA_RTM_NYC',type:'sea',name:'روتردام → نيويورك',from:'روتردام',to:'نيويورك',fromFacility:'PT-RTM',toFacility:'PT-NYC',route:[[51.95,4.14],[51.2,1.6],[50.1,-5.0],[49.0,-15.0],[47.0,-28.0],[44.5,-42.0],[42.3,-56.0],[40.684,-74.04]],effectiveSpeedKmh:32.5,dwellHours:12,cargoDemand:{dry:6100,reefer:820}},
    ROAD_RUH_JED:{id:'ROAD_RUH_JED',referenceOnly:true,type:'road',name:'الرياض → جدة',from:'الرياض',to:'جدة',fromFacility:'DP-RUH',toFacility:'PT-JED',route:[[24.6485,46.7160],[24.073,45.280],[23.905,44.720],[23.900,42.920],[23.650,41.850],[22.850,40.500],[21.900,39.800],[21.4858,39.173]],effectiveSpeedKmh:68,dwellHours:2.5},
    ROAD_DXB_RUH:{id:'ROAD_DXB_RUH',referenceOnly:true,type:'road',name:'دبي → الرياض',from:'دبي',to:'الرياض',fromFacility:'DP-DXB',toFacility:'DP-RUH',route:[[24.9857,55.075],[24.4539,54.3773],[24.15,52.58],[24.02,51.61],[24.07,50.67],[24.15,49.25],[24.30,48.05],[24.6485,46.716]],effectiveSpeedKmh:66,dwellHours:3}
  };
  function routeLongestLeg(route){
    let longest=0;
    for(let i=0;i<(route?.length||0)-1;i++) longest=Math.max(longest,haversine(route[i],route[i+1]));
    return longest;
  }
  function prepareRoute(r){
    r.distanceKm=routeDistance(r.route);
    r.maxLegKm=Number(r.maxLegKm)||routeLongestLeg(r.route);
    r.tripSeconds=r.distanceKm/r.effectiveSpeedKmh*3600;
    return r;
  }
  Object.values(routeTemplates).forEach(prepareRoute);
  const BASE_ROUTE_IDS = new Set(Object.keys(routeTemplates));

  // ---- شبكة الممرات العالمية: الوجهات عامة وليست قواعد يجب شراؤها ----
  // هذه ممرات تشغيلية داخل اللعبة لعرض حركة السفن بصورة معقولة وليست تعليمات ملاحية حقيقية.
  const MARITIME_LANES = {
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
    ['SUEZ_NORTH','MED_EAST'],['MED_EAST','MED_CENTRAL'],['MED_CENTRAL','GIBRALTAR'],['GIBRALTAR','ENGLISH'],['ENGLISH','NORTH_SEA'],
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
    if(lat>=-35&&lat<=32&&lon>=42&&lon<=82)return ['ADEN','ARABIAN','INDIAN_W'];
    if(lat>=-18&&lat<=28&&lon>=80&&lon<=108)return ['INDIAN_C','BAY_BENGAL','MALACCA'];
    if(lat>=-12&&lat<=34&&lon>=98&&lon<=139)return ['SINGAPORE','SOUTH_CHINA','PHILIPPINES'];
    if(lat>=24&&lat<=46&&lon>=126&&lon<=148)return ['JAPAN','PHILIPPINES'];
    if(lat>=-48&&lat<=-8&&lon>=108&&lon<=178)return ['AUSTRALIA_W','AUSTRALIA_E','TASMAN'];
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
    let best=null;
    for(const fromKey of maritimeGateKeys(fromCoords))for(const toKey of maritimeGateKeys(toCoords)){
      const lane=shortestMaritimeLane(fromKey,toKey);if(!lane)continue;
      const total=lane.distance+haversine(fromCoords,MARITIME_LANES[fromKey])+haversine(MARITIME_LANES[toKey],toCoords);
      if(!best||total<best.total)best={...lane,total,fromKey,toKey};
    }
    if(!best){const route=greatCircle(fromCoords,toCoords,44);return {route,maxLegKm:routeLongestLeg(route),laneNodes:[]};}
    // نستخدم عقد الممرات البحرية فقط؛ لا نرسم "اختصارًا" عبر مدينة أو يابسة.
    // البوابتان الطرفيتان تمثلان رصيف الميناء ثم القناة البحرية الخارجة منه.
    const anchors=[fromCoords,...best.keys.map(key=>MARITIME_LANES[key]),toCoords];
    return {route:stitchArcs(anchors,5),maxLegKm:routeLongestLeg(anchors),laneNodes:best.keys,maritimeOnly:true};
  }
  function rebuildMaritimeRoute(route){
    const from=routeFacility(route.fromFacility),to=routeFacility(route.toFacility);
    if(!from||!to)return false;
    const geometry=buildMaritimeRoute(from.coords,to.coords);
    route.route=geometry.route;route.laneNodes=geometry.laneNodes;route.maritimeOnly=true;
    route.routingSource='شبكة GH البحرية · ممرات ومضائق فقط';prepareRoute(route);return true;
  }
  function nearestTechnicalAirport(target,previous,destination,maxLegKm,excluded){
    let best=null,bestScore=Infinity;
    for(const row of WORLD.airports){
      if(!row[1]||excluded.has(row[0]))continue;
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

  const companies = [
    {id:'holding',icon:'🏛️',name:'المجموعة العالمية القابضة',sector:'إدارة واستثمارات',base:'الرياض'},
    {id:'air',icon:'✈️',name:'الشركة العالمية للطيران',sector:'طيران ركاب وشحن',base:'الرياض / دبي'},
    {id:'sea',icon:'🚢',name:'الشركة العالمية للشحن البحري',sector:'حاويات ونقل بحري',base:'سنغافورة / جدة'},
    {id:'road',icon:'🚛',name:'اللوجستيات العالمية',sector:'نقل بري ومستودعات',base:'الرياض / دبي'},
    {id:'power',icon:'⚡',name:'الطاقة العالمية',sector:'توليد وبيع الطاقة',base:'الرياض'},
    {id:'bank',icon:'🏦',name:'بنك المجموعة',sector:'خدمات شركات وتمويل',base:'دبي'}
    ,{id:'mobility',icon:'🚕',name:'GH Mobility للتنقل الذكي',sector:'رحلات حسب الطلب ومنصة شركاء قيادة',base:'الرياض'}
  ];

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
    {id:'H8',name:'Daniel Brooks',role:'CFO — قطاع الطاقة',city:'نيويورك',salary:510000,skill:94,market:'طلب مرتفع'}
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
    saveVersion:SAVE_SCHEMA_VERSION,saveRevision:0,onboardingComplete:false,
    profile:{name:'المجموعة العالمية القابضة',shortName:'GH',founder:'المؤسس',englishName:'Global Holdings Group',country:'السعودية',city:'الرياض',firstSector:'air',mode:'balanced',legalForm:'شركة قابضة مساهمة مقفلة',currency:'USD',fiscalYear:'calendar',riskAppetite:'balanced',procurementPolicy:'competitive',signingAuthority:'board',reputation:12,creditRating:'BBB',logo:null,logoStyle:'teal'},
    cash:250000000,debt:84000000,groupValue:412000000,todayProfit:0,
    sectorProfitToday:{air:0,sea:0,road:0,power:0,bank:0,mobility:0},
    speed:1,simSeconds:0,lastFinancialDay:0,lastMarketHour:0,
    godMoney:false,infiniteMoney:false,showCompetitors:true,activeFilter:'all',
    assets:[],unlockedSectors:[],openedCompanies:[],ownedCompanies:[],stakes:{},maDeals:{},hired:[],acceptedContracts:[],contractStartDays:{},failedBids:[],
    crew:clone(crewRolesSeed),
    portfolio:{},portfolioBook:{},branches:[],globalBases:[],customHubs:[],customRoutes:[],routeEndpoints:{},leasedAssets:[],routeCache:{},market:clone(initialStocks),eventLog:[],alerts:[
      'تم تشغيل الخريطة العالمية الموحدة. ×1 يعمل بزمن حقيقي.',
      'فرصة استحواذ جديدة في قطاع المستودعات والنقل الأوروبي.',
      'عقد توزيع دوائي جديد متاح للمناقصة.'
    ],
    energy:{gasMW:350,solarMW:220,windMW:80,storageMWh:1600,availability:94.6},
    bank:{branches:1,deposits:320000000,loans:210000000,npl:1.9,capitalRatio:16.4,hqla:118000000,stableFunding:385000000,requiredStableFunding:318000000,wholesaleFunding:92000000,offBalance:0,feeIncomeYTD:0,provisions:16800000,corporateClients:{},creditFacilities:[],lettersOfCredit:[],guarantees:[],cashSweeps:[],tradeFinance:[],riskReviews:[],lastLiquidityReview:0},
    treasury:{accounts:[{id:'GH-OPER-001',name:'الحساب الجاري التشغيلي',currency:'USD',balance:250000000},{id:'GH-RES-002',name:'حساب الاحتياطي',currency:'USD',balance:0},{id:'GH-INV-003',name:'حساب الاستثمار',currency:'USD',balance:0}],ledger:[],paymentQueue:[]},
    operations:{projects:[],dailyBriefs:[],riskIndex:18,lastCycleDay:0},companyRegistry:{},companyFinance:{},contractRegistry:{},constructionContracts:[],commercialTenders:[],supplierTransactions:[],finance:{invoices:[],taxPayable:0,taxPaid:0,invoiceSequence:1,payables:[],receivables:[],cheques:[],paymentSequence:1,periods:[]},
    governance:{boardDecision:'pending'},research:{efficiency:0,automation:0,cleanEnergy:0},
    esg:{environment:46,social:58,governance:62},insurancePolicies:[],careerLevel:1,ipo:{listed:false,ticker:''}
  };

  let state;
  if(!window.GH_MIGRATION_CORE?.load)throw new Error('Migration Core failed to load before app.js');
  try{
    if(window.webkit?.messageHandlers?.saveBridge&&Number(window.GH_NATIVE_BUILD||0)<251)throw new Error('Native Build251 is required');
    if(window.GH_NATIVE_RECOVERY_BLOCKED)throw new Error('Native recovery required');
    ({state}=window.GH_MIGRATION_CORE.load({defaultState,storageKey,legacyStorageKeys,resetMarkerKey,saveSchema:window.GH_SAVE_SCHEMA}));
  }catch(error){
    const box=document.createElement('div');box.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#071c25;color:white;display:grid;place-content:center;padding:32px;gap:20px;text-align:center';
    box.id='saveRecovery';const title=document.createElement('h2');title.textContent=String(error.message).includes('Build251')?'يلزم تثبيت تطبيق Build251 المحدث':'تعذر فتح الحفظ بأمان';box.appendChild(title);
    const message=document.createElement('p');message.textContent='احتفظنا بالملف الحالي دون تغييره. صدّر نسخة لاستعادتها أو مراجعتها قبل متابعة اللعب.';box.appendChild(message);
    const button=document.createElement('button');button.textContent='تصدير الحفظ للمراجعة';button.onclick=()=>{const raw=localStorage.getItem(storageKey)||legacyStorageKeys.map(k=>localStorage.getItem(k)).find(Boolean)||'';const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='GlobalHoldings_Recovery.ghsave';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};box.appendChild(button);document.body.appendChild(box);console.error('SAVE_LOAD_BLOCKED',error);return;
  }
  // 2.3.4: multiplier-only speeds. Speed changes time rate only, never business rules.
  const SAFE_SPEED_VALUES=[0,1,2,4];
  if(!SAFE_SPEED_VALUES.includes(Number(state.speed))) state.speed=1;
  if(!window.GH_SAVE_SCHEMA?.normalize)throw new Error('Save Schema Core failed to load before app.js');
  state=window.GH_SAVE_SCHEMA.normalize(state,defaultState);
  state=window.GH_MIGRATION_CORE.structural(state,defaultState);
  if(!window.GH_DETERMINISM?.ensure)throw new Error('Determinism Core failed to load before app.js');
  window.GH_DETERMINISM.ensure(state);
  if(!window.GH_DIAGNOSTICS?.ensure)throw new Error('Diagnostics Core failed to load before app.js');
  window.GH_DIAGNOSTICS.ensure(state);
  if(!window.GH_CONTROL_PLANE?.bootstrap)throw new Error('Central Control Plane failed to load before app.js');
  if(!window.GH_PERSISTENCE?.saveSlot||!window.GH_WORKFLOW?.run||!window.GH_EVENT_LEDGER?.ensure||!window.GH_DEPENDENCY_CORE?.ensure||!window.GH_POLICY_CORE?.evaluate||!window.GH_LIFECYCLE_CORE?.transition||!window.GH_DEMAND_CLOSURE?.ensure||!window.GH_INTEGRITY_CORE?.check)throw new Error('Business Lifecycle cores failed to load before app.js');
  window.__GH_STATE__=state;
  window.GH_CONTROL_PLANE.bootstrap(state,{
    simulation:{version:window.GH_SIMULATION_CORE?.VERSION||APP_VERSION,role:'Single owner of simulation time'},
    finance:{version:APP_VERSION,role:'Accounting and money mutation owner'},
    procurement:{version:window.GH_PROCUREMENT_CORE?.VERSION||APP_VERSION,role:'Manual asset purchasing and delivery lifecycle'},
    assets:{version:APP_VERSION,role:'Asset lifecycle owner'},routes:{version:APP_VERSION,role:'Route lifecycle owner'},staffing:{version:window.GH_HR_CORE?.VERSION||APP_VERSION,role:'HR demand, recruitment and workforce lifecycle owner'},
    ai:{version:window.GH_ADVANCED?.VERSION||APP_VERSION,role:'Supervised executive planning and diagnostics'},
    save:{version:window.GH_PERSISTENCE?.VERSION||APP_VERSION,role:'Browser persistence coordinated with Native Save Vault'},
    update:{version:window.GH_ADVANCED?.VERSION||APP_VERSION,role:'Signed clean-snapshot update lifecycle'},
    nativeBridge:{version:'Build251',role:'WKWebView durable save/update bridge'},diagnostics:{version:window.GH_DIAGNOSTICS?.VERSION||APP_VERSION,role:'Runtime health and evidence collection'}
  });
  window.GH_EVENT_LEDGER.ensure(state);window.GH_DEPENDENCY_CORE.ensure(state);window.GH_DEMAND_CLOSURE.ensure(state);
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
  const COMPANY_FINANCE_TYPES=['group','air','sea','road','power','bank','mobility'];
  const companyFinanceName=type=>{if(type==='group')return state.profile.name;const record=state.companyRegistry?.[type];return record?.legalName||typeName(type);};
  function makeCompanyBook(type,balance=0){return window.GH_FINANCE_CORE.makeBook?window.GH_FINANCE_CORE.makeBook(state,type,balance):null;}
  function ensureCompanyFinance(){return window.GH_FINANCE_CORE?.ensure?.(state);}
  function companyBook(type='group'){return window.GH_FINANCE_CORE.book(state,type);}
  const companyOperatingBalance=type=>window.GH_FINANCE_CORE.operating(state,type);
  const companyTotalBalance=type=>window.GH_FINANCE_CORE.total(state,type);
  if(!state.companyBudgets||typeof state.companyBudgets!=='object'||Array.isArray(state.companyBudgets))state.companyBudgets={};
  function companyBudget(type='group'){return window.GH_FINANCE_CORE.budget(state,type);}
  const companyBudgetRemaining=type=>window.GH_FINANCE_CORE.remaining(state,type);
  function budgetLineFor(note='',method=''){return window.GH_FINANCE_CORE.lineFor(note,method);}
  function budgetLineRemaining(type,line){return window.GH_FINANCE_CORE.lineRemaining(state,type,line);}
  function consumeCompanyBudget(type,amount,line=null){window.GH_FINANCE_CORE.consumeBudget(state,type,amount,line);return true;}
  function reserveCompanyBudget(type,amount,line='other'){return window.GH_FINANCE_CORE.reserveBudget(state,type,amount,line);}
  function consumeReservedCompanyBudget(type,amount,line='other'){window.GH_FINANCE_CORE.consumeReserved(state,type,amount,line);return true;}
  function releaseCompanyBudgetReservation(type,amount,line='other'){return window.GH_FINANCE_CORE.releaseReserved(state,type,amount,line);}

  function transferWithinCompany(type,amount,toReserve=true){return Number(window.GH_DOMAIN_COMMANDS.dispatch(advancedContext(),'finance','transfer-reserve',{company:type,amount,toReserve},{actor:'finance-ui'}).result?.amount)>0;}
  function consolidatedCash(){return COMPANY_FINANCE_TYPES.reduce((n,t)=>n+companyTotalBalance(t),0);}
  function reconcileConsolidatedCash(){return window.GH_FINANCE_CORE.reconcile(state);}
  function canCompanySpend(type,amount,line=null){return window.GH_FINANCE_CORE.canSpend(state,type,amount,line);}
  function companyLedger(type,entry){const b=companyBook(type);b.ledger.unshift(entry);}
  function transferBetweenCompanies(from,to,amount,note='تحويل داخلي بين شركات المجموعة'){const out=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','transfer',{from,to,amount,note},{actor:'finance'});return out.ok&&out.result?.transferred===true;}
  function bulkTransferFromGroup(rows,note='توزيع رأسمالي جماعي من الشركة القابضة'){
    const opened=new Set((state.openedCompanies||[]).filter(t=>['air','sea','road','power','bank','mobility'].includes(t)));
    const clean=(Array.isArray(rows)?rows:[]).map(x=>({company:String(x.company||''),amount:Math.round((Number(x.amount)||0)*100)/100})).filter(x=>opened.has(x.company)&&x.amount>0);
    if(!clean.length)return {ok:false,reason:'لم تحدد أي مبالغ للشركات.'};
    try{const out=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','bulk-transfer',{rows:clean,note},{actor:'finance-ui'});return {ok:true,...(out.result||{})};}catch(error){return {ok:false,reason:error.message||'تعذر التحويل الجماعي.'};}
  }

  function creditCompany(type,amount,note='إيراد تشغيلي',method='تحويل عميل',taxable=true){const out=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','credit',{company:type,amount,note,method,taxable},{actor:'simulation'});return !!out.result;}
  ensureCompanyFinance();reconcileConsolidatedCash();
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
  function pruneRouteCache(maxEntries=220){
    const active=new Set([...(state.assets||[]).map(a=>a.routeId).filter(Boolean),...(state.customRoutes||[]).map(r=>r.id).filter(Boolean)]);
    const rows=Object.entries(state.routeCache).filter(([,v])=>v&&Array.isArray(v.route)&&v.route.length>=2&&Number.isFinite(Number(v.distanceKm)));
    rows.sort((a,b)=>{const av=active.has(a[0])?1:0,bv=active.has(b[0])?1:0;if(av!==bv)return bv-av;const bs=Number(b[1].cachedAtSim),as=Number(a[1].cachedAtSim);if(Number.isFinite(bs)||Number.isFinite(as))return (Number.isFinite(bs)?bs:-1)-(Number.isFinite(as)?as:-1);return Date.parse(b[1].updated||0)-Date.parse(a[1].updated||0);});
    state.routeCache=Object.fromEntries(rows.slice(0,Math.max(40,maxEntries)));
  }
  pruneRouteCache();
  if(window.GH_ADVANCED)window.GH_ADVANCED.migrate(state);
  window.GH_PERSISTENCE?.migrateMetadata?.(state);
  if(window.GH_REALISM)window.GH_REALISM.migrate(state);
  if (state.saveVersion !== SAVE_SCHEMA_VERSION) state.saveVersion = SAVE_SCHEMA_VERSION;
  state.customRoutes.forEach(route=>{if(route?.id&&Array.isArray(route.route)){routeTemplates[route.id]=prepareRoute(clone(route));}});
  if(dedupeCustomRoutes()) save();
  // ترحيل المسارات البحرية القديمة التي كانت خطوطًا عامة إلى شبكة الممرات البحرية الحالية.
  let maritimeMigrationChanged=false;
  Object.values(routeTemplates).filter(route=>route.type==='sea'&&!route.maritimeOnly).forEach(route=>{
    if(rebuildMaritimeRoute(route)){maritimeMigrationChanged=true;const saved=state.customRoutes.find(r=>r.id===route.id);if(saved)Object.assign(saved,clone(route));}
  });
  if(maritimeMigrationChanged)save();

  // Normalize legacy documents to the parent company so every document has an accountable legal entity.
  state.finance.invoices.forEach(d=>{if(!d.company)d.company='group';d.companyName=companyFinanceName(d.company);d.accountId=d.accountId||companyBook(d.company).accounts[0].id;});state.finance.cheques.forEach(d=>{if(!d.company)d.company='group';d.companyName=companyFinanceName(d.company);d.accountId=d.accountId||companyBook(d.company).accounts[0].id;if(!d.beneficiary)d.beneficiary='طرف تعاقدي مسجل';});state.finance.payables.forEach(d=>{if(!d.company)d.company='group';});state.finance.receivables.forEach(d=>{if(!d.company)d.company='group';});
  state.finance.periods=Array.isArray(state.finance.periods)?state.finance.periods:[];state.finance.journalEntries=Array.isArray(state.finance.journalEntries)?state.finance.journalEntries:[];
  for(const type of COMPANY_FINANCE_TYPES){const book=companyBook(type),legacy=Math.max(0,Number(book.taxPayable)||0);if(legacy>0&&!state.finance.periods.some(p=>(p.company||'group')===type&&p.status==='مستحق'))state.finance.periods.unshift({id:`TAX-LEGACY-${type}`,company:type,companyName:companyFinanceName(type),period:'رصيد ضريبي مرحّل قبل Build242',amount:legacy,dueDay:Math.floor(state.simSeconds/86400)+15,status:'مستحق',legacy:true});}
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
  function persistStateNow(options={}){
    if(hardResetInProgress||window.GH_PERSISTENCE.isLocked())return false;
    const previousRevision=Math.max(0,Math.floor(Number(state.saveRevision)||0));
    try{
      pruneRouteCache();reconcileConsolidatedCash();state.saveRevision=previousRevision+1;
      const integrity=window.GH_INTEGRITY_CORE.check(state);if(integrity?.critical?.length)throw new Error(`Critical integrity failed: ${integrity.critical.map(x=>x.code||x.title).join(',')}`);
      const out=window.GH_PERSISTENCE.commitState(state,{storageKey,appVersion:APP_VERSION});
      if(!out.ok)throw new Error(out.reason);
      diag('SAVE_OK',{bytes:out.utf8Bytes,saveRevision:state.saveRevision});return true;
    }catch(error){state.saveRevision=previousRevision;diag('SAVE_FAILED',{message:String(error.message||error)});if(options.throwOnError)throw error;console.warn('تعذر حفظ اللعبة',error);return false;}
  }
  function save(){
    const tx=window.GH_TRANSACTION_CORE;
    if(tx.isActive()){tx.afterCommit(()=>persistStateNow({throwOnError:true}),{critical:true,priority:100,key:'save'});return true;}
    return persistStateNow();
  }
  function runBusinessOperation(name,apply){
    const tx=window.GH_TRANSACTION_CORE;
    try{return (tx.isActive()?tx.join:tx.execute)(state,{label:name,apply:()=>{const value=apply();if(value===false)throw new Error(name+'-rejected');return value;}}).value;}
    catch(error){console.warn('Business operation rolled back',name,error);if(!tx.isActive())notice('تعذر إكمال العملية؛ تم التراجع عن أثرها: '+String(error.message||error));return false;}
  }
  function pushAlert(text){
    const result=window.GH_DOMAIN_COMMANDS?.dispatch?.({state},'operations','record-alert',{id:nextId('EV'),text,type:'operation'},{actor:'ui-notification'});
    if(!result?.ok)throw new Error('Operations alert owner unavailable');
    const tx=window.GH_TRANSACTION_CORE;if(tx?.isActive?.())tx.afterCommit(()=>updateKpis());else updateKpis();
    return true;
  }
  const validMoney = amount => Number.isFinite(Number(amount)) && Number(amount)>=0;
  const operatingBalance = () => companyOperatingBalance('group');
  const canSpend = amount => canCompanySpend('group',amount);
  window.GH_INTERACTION_NOTICE=(text)=>pushAlert(String(text||'تعذر تنفيذ الإجراء.'));
  function notice(text,kind='info'){if(window.GH_WORKFLOW?.notify)return window.GH_WORKFLOW.notify(String(text||''),kind,{state,panel:activeDrawerPanel});pushAlert(String(text||''));return true;}
  function ask(message,risk='normal'){if(window.GH_WORKFLOW?.confirm)return window.GH_WORKFLOW.confirm(String(message||''),{state,panel:activeDrawerPanel,risk});return typeof window.confirm==='function'?window.confirm(String(message||'')):false;}

  function supplierFor(sector='all',category='all'){const candidates=strategicPartners.filter(p=>(p.sector==='all'||p.sector===sector)&&(category==='all'||p.category===category));return (candidates.length?candidates:strategicPartners).slice().sort((a,b)=>((b.rating||0)+(b.delivery||0)+(b.compliance||0)-(b.costIndex||1)*35)-((a.rating||0)+(a.delivery||0)+(a.compliance||0)-(a.costIndex||1)*35))[0]||null;}
  function constructionBid(sector,facilityKind,baseCost,siteName){const candidates=strategicPartners.filter(p=>p.category==='construction'&&(p.sector==='all'||p.sector===sector));const bids=candidates.map(p=>{const complexity=facilityKind==='airport-base'?1.22:facilityKind==='port-base'?1.27:facilityKind==='power'?1.34:facilityKind==='hq'?1.12:facilityKind==='bank'?1.06:1.0;const quote=Math.round(baseCost*complexity*(p.costIndex||1));const score=(p.rating||0)*.34+(p.delivery||0)*.24+(p.compliance||0)*.28+(100-Math.min(130,(p.costIndex||1)*100))*.14;return {supplier:p,quote,score:Math.round(score*10)/10};}).sort((a,b)=>b.score-a.score||a.quote-b.quote);return {winner:bids[0]||null,bids:bids.slice(0,4),siteName,facilityKind};}
  function recordPaidCheque(company,amount,beneficiary,note,invoiceNumber=''){
    return runBusinessOperation('recordPaidCheque',()=>{const issued=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','issue-cheque',{company,amount,beneficiary,note,invoiceNumber,dueDay:Math.floor(state.simSeconds/86400)},{actor:'finance-service'}).result;if(!issued?.id)return null;const settled=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','settle-cheque',{id:issued.id},{actor:'finance-service'}).result;if(settled?.settled!==true)throw new Error('cheque-not-settled');return settled.id;
    });
  }
  function payNamedSupplier(company,amount,supplier,note,method='شيك مصدق',budgetLine='capex'){
    try{const out=window.GH_DOMAIN_COMMANDS.dispatch({state},'procurement','supplier-payment',{company,amount,supplier,note,method,budgetLine},{actor:'procurement'});return out.result||null;}catch(error){console.warn('supplier payment rejected',error);return null;}
  }
  function awardConstruction(company,facilityKind,siteName,baseCost){
    const tender=constructionBid(company,facilityKind,baseCost,siteName);if(!tender.winner)return null;const w=tender.winner;if(!canCompanySpend(company,w.quote,'capex'))return {insufficient:true,quote:w.quote,supplier:w.supplier,bids:tender.bids};
    try{const out=window.GH_DOMAIN_COMMANDS.dispatch({state},'procurement','award-construction',{company,facilityKind,siteName,bid:w,bids:tender.bids.map(x=>({supplier:x.supplier.legalName||x.supplier.name,quote:x.quote,score:x.score}))},{actor:'procurement'});return out.result||null;}catch(error){console.warn('construction award rejected',error);return null;}
  }
  function ensureBankCorporateClients(){
    const names={};for(const type of ['group','air','sea','road','power','mobility'])names[type]=companyFinanceName(type);
    try{return window.GH_DOMAIN_COMMANDS.dispatch({state},'banking','sync-corporate-clients',{names},{actor:'banking-read-model'}).result||state.bank.corporateClients;}catch(error){console.warn('bank client sync rejected',error);return state.bank.corporateClients||{};}
  }
  function bankLiquidityMetrics(){ensureBankCorporateClients();const m=window.GH_REALISM?.bankingMetrics?.(state);if(m)return {lcr:Math.round(m.lcr),nsfr:Math.round(m.nsfr),loanDeposit:Math.round(m.loanDeposit),hqla:m.hqla,outflows:m.stressedOutflows,cet1:m.cet1,tier1:m.tier1,totalCapital:m.totalCapital,provisionCoverage:m.provisionCoverage};const b=state.bank,hqla=Math.max(0,Number(b.hqla)||0),outflows=Math.max(1,(Number(b.deposits)||0)*.18+(Number(b.wholesaleFunding)||0)*.25),lcr=Math.round(hqla/outflows*100),nsfr=Math.round(Math.max(0,Number(b.stableFunding)||0)/Math.max(1,Number(b.requiredStableFunding)||1)*100),loanDeposit=Math.round((Number(b.loans)||0)/Math.max(1,Number(b.deposits)||1)*100);return {lcr,nsfr,loanDeposit,hqla,outflows};}
  function bankReviewCorporateLimits(){try{return window.GH_DOMAIN_COMMANDS.dispatch({state},'banking','review-limits',{}, {actor:'bank'}).result===true;}catch(error){console.warn(error);return false;}}
  function bankDrawCorporateFacility(company,amount=10000000){try{return Number(window.GH_DOMAIN_COMMANDS.dispatch({state},'banking','draw-facility',{company,amount},{actor:'bank'}).result)||0;}catch(error){console.warn(error);return false;}}
  function bankIssueTradeInstrument(kind,company,amount=5000000){try{return window.GH_DOMAIN_COMMANDS.dispatch({state},'banking','trade-instrument',{kind,company,amount,counterparty:supplierFor(company==='group'?'all':company,'all')?.legalName||'طرف تجاري مسجل'},{actor:'bank'}).result||null;}catch(error){console.warn(error);return null;}}
  function bankCashSweep(){try{return Number(window.GH_DOMAIN_COMMANDS.dispatch({state},'banking','cash-sweep',{}, {actor:'bank'}).result)||0;}catch(error){console.warn(error);return 0;}}
  function postJournalEntry(company,description,lines,sourceRef=''){return window.GH_FINANCE_CORE.journal(state,company,description,lines,sourceRef);}
  function refreshTaxPayables(){return window.GH_FINANCE_CORE.reconcile(state);}
  function postInvoice(kind,amount,note,method='تحويل بنكي',taxable=true,status='مدفوعة',company='group',counterparty=''){return window.GH_FINANCE_CORE.invoice(state,{kind,amount,note,method,taxable,status,company,counterparty});}

  function postAccruedExpense(company,amount,note,method='قيد مستحق',dueDay=null,number=null,expenseAccount='مصروف تشغيلي'){
    company=COMPANY_FINANCE_TYPES.includes(company)?company:'group';amount=Math.max(0,Number(amount)||0);if(amount<=0)return null;
    if(number){const existing=state.finance.invoices.find(x=>x.number===String(number));if(existing)return existing;}
    try{return window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','accrue-expense',{company,amount,note,method,dueDay,number,expenseAccount},{actor:'finance-service'}).result||null;}catch(error){console.warn('accrual rejected',error);return null;}
  }

  function issueCheque(amount,note,beneficiary='',company='group'){const out=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','issue-cheque',{amount,note,beneficiary,company},{actor:'finance-ui'});if(!out.result){pushAlert('تعذر إصدار الشيك: تحقق من المستفيد والميزانية.');return null;}pushAlert(`صدر الشيك ${out.result.id} من حساب ${companyFinanceName(company)} لصالح ${beneficiary}.`);save();return out.result.id;}
  function settleCheque(cheque){return window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','settle-cheque',{id:cheque?.id},{actor:'finance-scheduler'}).result;}
  function spendCompany(company,amount,note='مصروف تشغيلي',method='تحويل بنكي',taxable=true){if(!validMoney(Number(amount)))return false;const out=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','spend',{company,amount,note,method:method==='نقدي'?'تحويل بنكي':method,taxable},{actor:'domain-service'});return !!out.result;}
  const spend = (amount,note='مصروف تشغيلي',method='تحويل بنكي',taxable=true) => spendCompany('group',amount,note,method,taxable);

  // ---- الطاقم: رواتب ومعنويات فعلية ----
  function crewByRole(id){ return state.crew.find(c=>c.id===id); }
  function crewAvgSalary(role){ return (role.salaryMin+role.salaryMax)/2; }
  function crewSectorPayroll(sector){ return state.crew.filter(c=>c.sector===sector).reduce((s,c)=>s+c.count*crewAvgSalary(c),0); }
  function crewSectorMorale(sector){ const list=state.crew.filter(c=>c.sector===sector); if(!list.length)return 100; return list.reduce((s,c)=>s+c.morale,0)/list.length; }
  function crewCostPerHour(sector){ return crewSectorPayroll(sector)/24; }
  // ---- HR 2.5: مصدر واحد فقط للاحتياج والتوظيف والعقود ----
  function hrContext(){return {candidates,getDynamicFacilities};}
  function requiredCrewForFleet(sector,assetCount=state.assets.filter(a=>a.type===sector).length){return window.GH_HR_CORE?.requiredCrewForFleet?.(state,sector,assetCount)||{};}
  function ensureCrewForFleet(sector,source='HR authorized staffing'){const result=window.GH_DOMAIN_COMMANDS.dispatch({state,...hrContext()},'hr','hire',{company:sector,source,scope:'crew'},{actor:'hr-ui'}).result;if(!result)throw new Error('HR Core unavailable');if(result.total)pushAlert(`HR: تم سد عجز ${typeName(sector)} بعدد ${result.total} وفق التفويض.`);return result.crew||[];}
  function ensureFacilityWorkforce(company='all',source='HR authorized facility staffing'){const result=window.GH_DOMAIN_COMMANDS.dispatch({state,...hrContext()},'hr','hire',{company,source,scope:'facility'},{actor:'hr-ui'}).result;if(!result)throw new Error('HR Core unavailable');return result.facilities||[];}
  function ensureCompanyWorkforce(company,source='HR authorized company staffing'){const result=window.GH_DOMAIN_COMMANDS.dispatch({state,...hrContext()},'hr','hire',{company,source},{actor:'hr-ui'}).result;if(!result)throw new Error('HR Core unavailable');return result;}
  function ensureExecutiveWorkforce(source='HR authorized executive staffing'){const result=window.GH_DOMAIN_COMMANDS.dispatch({state,...hrContext()},'hr','hire',{company:'all',source,scope:'executive'},{actor:'hr-ui'}).result;if(!result)throw new Error('HR Core unavailable');return result.executives||[];}
  function ensureAllWorkforce(source='HR authorized full workforce completion'){const result=window.GH_DOMAIN_COMMANDS.dispatch({state,...hrContext()},'hr','hire',{company:'all',source},{actor:'hr-ui'}).result;if(!result)throw new Error('HR Core unavailable');if(result.total)pushAlert(`HR: اكتمل سد العجز الشامل — ${result.total} تعيين، والتغطية أصبحت ${result.coverageAfter}%.`);else pushAlert('HR: لا يوجد عجز وظيفي حاليًا.');return result;}
  function workforceNeedSnapshot(){return window.GH_HR_CORE?.snapshot?.(state,hrContext(),'all')||{crewMissing:0,facilityMissing:0,executiveMissing:0,total:0,coverage:100,gaps:[]};}
  function rankRoutesForAsset(assetId){
    const asset=state.assets.find(a=>a.id===assetId);if(!asset)return[];
    return Object.entries(routeTemplates).filter(([,r])=>r&&r.type===asset.type&&routeFitsAsset(asset,r)&&( !asset.baseFacility||asset.baseFacility===r.fromFacility||asset.baseFacility===r.toFacility)).map(([routeId,r])=>{const eco=computeTripEconomics(asset,r),margin=Number(eco.margin)||0,revenue=Math.max(1,Number(eco.revenue)||1),marginPct=margin/revenue,conditionPenalty=Math.max(0,85-(Number(asset.condition)||100))*1500,riskPenalty=(Number(r.maxLegKm)||routeLongestLeg(r.route)||0)*2,score=margin+marginPct*250000-conditionPenalty-riskPenalty;return{routeId,from:r.from,to:r.to,margin,revenue,marginPct,score,duration:Number(r.tripSeconds)||0,maxLegKm:Number(r.maxLegKm)||routeLongestLeg(r.route)||0};}).sort((a,b)=>b.score-a.score);
  }
  function adjustCrew(id,pct){
    const c=crewByRole(id); if(!c){pushAlert('تعذر تعديل الرواتب؛ فئة الطاقم غير موجودة.');return;}
    c.salaryMin=Math.round(c.salaryMin*(1+pct)); c.salaryMax=Math.round(c.salaryMax*(1+pct));
    const moraleDelta=pct>0?Math.min(3,Math.max(.1,pct*50)):Math.max(-5,pct*100);
    c.morale=clamp(c.morale+moraleDelta,0,100);
    pushAlert(`${pct>0?'رفع':'خفض'} راتب فئة "${c.name}" بنسبة ${Math.abs(pct*100).toFixed(0)}%. المعنويات الآن ${Math.round(c.morale)}%.`);
    save(); openDrawer('labor','crew');
  }

  let map, currentTile, layers = {}, routeLayers = [], ownMarkers = new Map(), facilityMarkers = new Map(), competitorMarkers = new Map(), worldMarkers = new Map();
  let selectedAssetId = null, selectedWorldKey = null, placingHub = false, placementMode = 'hub', roadDraftStart = null, placementDraft = null, placementPreviewMarker = null, worldRenderTimer = null, activeDrawerPanel = null, activeDrawerArg = null;
  let hubPlacementGesture={timer:null,start:null,triggered:false,ignoreClickUntil:0};

  function normalizeAsset(asset){return window.GH_FLEET_CORE.normalizeAsset(asset,{route:routeTemplates[asset.routeId],catalogItem:catalogItem(asset.type,asset.catalogId)});}
  state.assets.forEach(normalizeAsset);

  function currentAssetRoute(asset){
    const tpl = routeTemplates[asset.routeId];
    if(!tpl)return null;
    return asset.reverse ? [...tpl.route].reverse() : tpl.route;
  }
  function assetPosition(asset){
    if(asset.routeId){
      const route = currentAssetRoute(asset);
      return interpolateRoute(route, asset.phase === 'turnaround' ? 1 : asset.progress);
    }
    const base = getDynamicFacilities().find(f=>f.id===asset.baseFacility) || facilities[0];
    return base.coords;
  }
  function assetIcon(type){ return type==='air'?'✈️':type==='sea'?'🚢':'🚛'; }
  function routeBearing(route,progress){
    if(!route||route.length<2)return 0;
    const p=clamp(progress,0,1);
    const a=interpolateRoute(route,clamp(p-0.01,0,1)), b=interpolateRoute(route,clamp(p+0.01,0,1));
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
  const VEHICLE_MARKER_PHOTOS={air:'assets/images/map-aircraft-topdown.png',sea:'assets/images/map-container-ship-topdown.png',road:'assets/images/map-truck-topdown.png'};
  function markerKind(type){return type==='air'?'air':type==='sea'?'sea':type==='mobility'?'mobility':'road';}
  // صورنا العلوية كلها موجّهة إلى أعلى؛ لا تضف انحرافًا خاصًا للشاحنة.
  // الانحراف السابق (-90) كان يجعل الشاحنات تسير بالعرض على الطرق.
  function markerHeading(kind,bearing){return Number(bearing||0);}
  function assetMarkerPhoto(asset){return VEHICLE_MARKER_PHOTOS[markerKind(asset.type)];}
  function vehicleVisualHtml(type,bearing,photo,moving=true,competitor=false){
    const kind=markerKind(type),heading=markerHeading(kind,bearing),className=`vehicle-pin ${kind}${moving?' is-live':''}${competitor?' competitor':''}`;
    const glyph=kind==='mobility'?'<span class="mobility-dot-glyph" aria-hidden="true"></span>':`<img src="${photo||VEHICLE_MARKER_PHOTOS[kind]}" alt="" draggable="false">`;
    return `<div class="${className}"><span class="vehicle-trail"></span><span class="vehicle-sprite" style="transform:rotate(${heading.toFixed(1)}deg)">${glyph}</span><span class="vehicle-beacon"></span></div>`;
  }
  function vehicleMarkerHtml(asset){return vehicleVisualHtml(asset.type,assetBearing(asset),assetMarkerPhoto(asset),asset.phase==='moving');}
  function competitorMarkerHtml(asset){return vehicleVisualHtml(asset.type,routeBearing(asset.route,asset.progress),VEHICLE_MARKER_PHOTOS[markerKind(asset.type)],true,true);}
  function refreshVehicleMarker(marker,type,bearing,moving){
    const element=marker?.getElement?.();if(!element)return;
    const kind=markerKind(type),pin=element.querySelector('.vehicle-pin'),heading=element.querySelector('.vehicle-sprite');
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
    const key=facilityKindKey(f.kind);
    return `<div class="marker-core facility-real ${key}">${FACILITY_SVG[key]}</div>`;
  }
  function typeName(type){ return ({air:'طيران',sea:'شحن بحري',road:'نقل بري',power:'طاقة',bank:'خدمات مالية',mobility:'تنقل ذكي حسب الطلب'})[type]||'قطاع متنوع'; }

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
      revenue = (specs.capacity||0) * UTIL.road * distanceKm * YIELD_RATE.roadTonKm;
      fuelCost = specs.electric ? (distanceKm/100)*(specs.energyKWhPer100km||115)*.14 : (distanceKm/100) * (specs.fuelLPer100km||0) * FUEL_PRICE.diesel;
    }
    const moraleFactor = clamp(crewSectorMorale(asset.type)/100, .7, 1.05);
    revenue *= moraleFactor;
    const crewCost = crewCostPerHour(asset.type) * hours;
    const maintReserve = revenue * MAINT_RESERVE_RATE;
    const margin = revenue - fuelCost - crewCost - maintReserve;
    const economics={revenue, fuelCost, crewCost, maintReserve, margin, cashContribution:revenue-fuelCost-maintReserve, hours,distanceKm};
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
    const result=await window.GH_MAP_PROVIDER.road(fromCoords,toCoords);
    if(!result.ok){diag('MAP_PROVIDER_DEGRADED',{status:result.status,reason:result.reason},'warning');return null;}
    return result.geometry;
  }
  function fallbackRoadGeometry(fromCoords,toCoords){
    if(!Array.isArray(fromCoords)||!Array.isArray(toCoords))return null;
    const route=greatCircle(fromCoords,toCoords,Math.max(3,Math.min(18,Math.ceil(haversine(fromCoords,toCoords)/90))));
    const distanceKm=haversine(fromCoords,toCoords)*1.18,effectiveSpeedKmh=62;
    return {route,distanceKm,durationSeconds:distanceKm/effectiveSpeedKmh*3600,fallback:true};
  }
  function applyRoadGeometry(routeId,geometry,saveCache=true){
    const tpl=routeTemplates[routeId];if(!tpl||!geometry?.route)return;
    tpl.route=geometry.route;tpl.routingSource='OSRM · شبكة طرق فعلية';prepareRoute(tpl);
    if(geometry.durationSeconds)tpl.effectiveSpeedKmh=clamp(tpl.distanceKm/(geometry.durationSeconds/3600),42,82);
    tpl.tripSeconds=tpl.distanceKm/tpl.effectiveSpeedKmh*3600;
    if(saveCache)window.GH_DOMAIN_COMMANDS.dispatch({state},'routes','cache-geometry',{id:routeId,route:tpl.route,distanceKm:tpl.distanceKm,durationSeconds:geometry.durationSeconds},{actor:'routing-provider'});
    state.assets.filter(a=>a.routeId===routeId).forEach(normalizeAsset);
  }
  const ROUTE_CACHE_MAX_AGE_DAYS = 90;
  function isRouteCacheFresh(cached){
    if(!cached?.route) return false;
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
    const activeIds=operationalRouteIds('road');
    Object.keys(state.routeCache||{}).forEach(id=>{if(routeTemplates[id]?.referenceOnly&&!activeIds.has(id))delete state.routeCache[id];});
    const roads=operationalRoutes('road');
    await Promise.all(roads.map(async tpl=>{
      const cached=state.routeCache[tpl.id];
      if(isRouteCacheFresh(cached)){applyRoadGeometry(tpl.id,cached,false);return;}
      const from=routeFacility(tpl.fromFacility),to=routeFacility(tpl.toFacility);if(!from||!to)return;
      let geometry=await requestRoadGeometry(from.coords,to.coords);
      if(!geometry){ await delay(1500); geometry=await requestRoadGeometry(from.coords,to.coords); } // محاولة ثانية عند انقطاع مؤقت
      if(geometry) applyRoadGeometry(tpl.id,geometry,true);
      else if(cached?.route) applyRoadGeometry(tpl.id,cached,false); // نستمر بالمسار المخزن القديم بدل خط مستقيم مفاجئ
    }));
    save();renderMap();
  }

  function setMapLayer(name){
    if(!map)return;const layer=layers[name]||layers.dark;if(currentTile)map.removeLayer(currentTile);currentTile=layer.addTo(map);
    const stage=document.querySelector('.map-stage');stage.classList.remove('map-dark','map-light','map-standard','map-satellite');stage.classList.add(`map-${name}`);
    document.querySelectorAll('#layerMenu button').forEach(b=>b.classList.toggle('active',b.dataset.layer===name));
  }

  function initMap(){
    if(!window.L){
      $('map').innerHTML='<div style="height:100%;display:grid;place-items:center;background:#84958a;color:#152024;padding:28px;text-align:center;font-weight:700">تعذر تحميل محرك الخريطة. يلزم اتصال بالإنترنت لطبقة الخريطة، بينما بيانات اللعبة محفوظة محليًا.</div>';
      return;
    }
    map = L.map('map',{zoomControl:true,minZoom:2,maxZoom:19,worldCopyJump:true,preferCanvas:true}).setView([22,28],3);
    const osmOptions={maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'};
    layers.standard = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',osmOptions);
    layers.street = layers.standard;
    layers.light = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',osmOptions);
    layers.dark = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',osmOptions);
    layers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'});
    setMapLayer('dark');
    const setInteractionState=active=>{mapInteractionActive=!!active; if(!active) updateMarkerPositions(true);};
    map.on('movestart zoomstart dragstart',()=>setInteractionState(true));
    map.on('moveend dragend',()=>{setInteractionState(false);clearTimeout(worldRenderTimer);worldRenderTimer=setTimeout(renderWorldInfrastructureMarkers,140);});
    // إعادة رسم الطبقات الثقيلة فقط عند توقف التكبير، وليس أثناء الحركة.
    map.on('zoomend',()=>{setInteractionState(false);clearTimeout(worldRenderTimer);worldRenderTimer=setTimeout(renderWorldInfrastructureMarkers,120);});
    map.on('click',event=>handleMapPlacement(event,'tap'));
    map.on('contextmenu',event=>{
      if(!placingHub)return;
      event.originalEvent?.preventDefault?.();event.originalEvent?.stopPropagation?.();
      hubPlacementGesture.ignoreClickUntil=Date.now()+900;
      handleMapPlacement(event,'long-press');
    });
    bindHubPlacementGestures();
    bindMapPlacementControls();
    renderMap();
    hydrateRoadRoutes();
  }

  function getDynamicFacilities(){
    const branches = state.branches.map(id=>{
      const site=expansionSites.find(x=>x.id===id);
      return site ? {...site,kind:'office',owned:true,photo:PHOTOS.facility_hq,detail:'مقر إقليمي افتتحته المجموعة ويضيف تكاليف تشغيلية وقدرة توسع عالمية.',capacity:'مقر إقليمي'} : null;
    }).filter(Boolean);
    const acquired = competitors.filter(c=>(state.stakes[c.id]||0)>=51).map(c=>({id:`ACQ-${c.id}`,kind:'acquired',owned:true,icon:'🏢',photo:PHOTOS.facility_hq,name:`${c.name} — شركة تابعة`,city:c.hq,country:'دولي',coords:c.coords,detail:`حصة المجموعة ${state.stakes[c.id]}%. أصبحت الشركة ضمن نطاق السيطرة التشغيلية.`,capacity:c.sector}));
    const publicEndpoints=Object.values(state.routeEndpoints||{}).filter(endpoint=>endpoint&&endpoint.id&&Array.isArray(endpoint.coords));
    return [...facilities,...state.globalBases,...state.customHubs,...publicEndpoints,...branches,...acquired];
  }

  function endpointMatchesWorldEntity(endpoint,entity){
    if(!endpoint||!entity||endpoint.kind!==entity.kind)return false;
    if(endpoint.sourceKey&&endpoint.sourceKey===entity.key)return true;
    if(entity.kind==='airport'&&(endpoint.icao===entity.icao||endpoint.iata&&endpoint.iata===entity.iata))return true;
    if(entity.kind==='port'&&endpoint.code===entity.code&&Array.isArray(endpoint.coords))return haversine(endpoint.coords,entity.coords)<8;
    return false;
  }
  function ensurePublicRouteEndpoint(entity){
    const existing=getDynamicFacilities().find(endpoint=>endpointMatchesWorldEntity(endpoint,entity));
    if(existing)return existing;
    const code=String(entity.icao||entity.code||nextId('PLACE')).replace(/[^A-Za-z0-9_-]/g,'-');
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
    state.routeEndpoints[id]=endpoint;
    return endpoint;
  }
  function routeEndpointName(endpoint){return endpoint?.city||endpoint?.name||'وجهة عالمية';}
  function roadLocationName(endpoint){
    if(!endpoint)return 'نقطة تشغيل';
    return endpoint.kind==='logistics'?endpoint.name:(endpoint.city||endpoint.name||'نقطة تشغيل');
  }
  function routeOriginForAsset(asset){
    const base=routeFacility(asset.baseFacility);
    if(base)return base;
    const route=routeTemplates[asset.routeId];
    if(route){
      const endpointId=asset.reverse?route.fromFacility:route.toFacility;
      return routeFacility(endpointId);
    }
    return null;
  }
  function assetRangeKm(asset){return asset.type==='sea'?(asset.specs?.rangeNm||0)*1.852:(asset.specs?.rangeKm||0);}
  function routeFitsAsset(asset,route){
    const range=assetRangeKm(asset),leg=route.maxLegKm||routeLongestLeg(route.route);
    return !range||leg<=range*1.005;
  }
  function buildPublicRoute(asset,origin,destination){
    const routeId=nextId(asset.type==='air'?'AIRPUB':'SEAPUB'),type=asset.type;
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
      id:routeId,type,
      name:`${routeEndpointName(origin)} → ${routeEndpointName(destination)}`,
      from:routeEndpointName(origin),to:routeEndpointName(destination),fromFacility:origin.id,toFacility:destination.id,
      route:geometry.route,maxLegKm:geometry.maxLegKm,effectiveSpeedKmh:speed,
      dwellHours:type==='air'?1.1+technicalStops.length*.35:9,
      technicalStops,laneNodes:geometry.laneNodes||[],publicAccess:true,
      routingSource:type==='air'?(technicalStops.length?'ممر جوي دولي + توقفات تقنية عامة':'ممر جوي دولي مباشر'):'ممرات بحرية عالمية تقديرية'
    });
  }
  function createGlobalRoute(assetId,destinationKey){
    return runBusinessOperation('createGlobalRoute',()=>{
    const asset=state.assets.find(item=>item.id===assetId),entity=worldEntityByKey(destinationKey);if(!asset||!entity){notice('تعذر إنشاء المسار؛ الأصل أو الوجهة لم يعودا متاحين. أعد المحاولة.');return;}const expectedKind=asset.type==='air'?'airport':'port';if(entity.kind!==expectedKind){notice(`اختر ${asset.type==='air'?'مطارًا':'ميناءً'} لتشغيل هذا الأصل.`);return;}if(asset.phase==='moving'){notice('لا يمكن تغيير الوجهة أثناء حركة الأصل. انتظر الوصول أولًا.');return;}const origin=routeOriginForAsset(asset);if(!origin){notice('تعذر تحديد موقع الأصل الحالي. افتح ملف الأصل ثم أعد المحاولة.');return;}const destination=ensurePublicRouteEndpoint(entity);if(origin.id===destination.id){notice('الأصل موجود بالفعل في هذه المنشأة. اختر وجهة مختلفة.');return;}const route=buildPublicRoute(asset,origin,destination);if(!route||!routeFitsAsset(asset,route)){notice('لا يمكن تشغيل هذا الأصل على المسار المحدد ضمن قيود المدى والسلامة.');return;}
    window.GH_DOMAIN_COMMANDS.dispatch({state},'routes','create',{route},{actor:'route-planner'});
    window.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','assign-route',{id:asset.id,routeId:route.id,route},{actor:'route-planner'});
    window.GH_FLEET_CORE.normalizeAsset(asset,{route,catalogItem:catalogItem(asset.type,asset.catalogId)});
    pushAlert(`أُنشئ خط ${asset.type==='air'?'جوي':'بحري'} عام: ${route.name}.`);save();
    window.GH_TRANSACTION_CORE.afterCommit(()=>{routeTemplates[route.id]=route;renderMap();openDrawer('assetManage',asset.id);});return true;
    });
  }
  function resetHubPlacementGesture(){
    if(hubPlacementGesture.timer)clearTimeout(hubPlacementGesture.timer);
    hubPlacementGesture={timer:null,start:null,triggered:false,ignoreClickUntil:hubPlacementGesture.ignoreClickUntil||0};
  }
  function bindHubPlacementGestures(){
    const container=map?.getContainer?.();if(!container)return;
    // WKWebView/Leaflet may stop bubbling touch events; capture Pointer Events
    // before Leaflet receives them so iPhone long-press is reliable.
    const begin=(x,y)=>{
      if(!placingHub)return;
      resetHubPlacementGesture();hubPlacementGesture.start={x,y};
      hubPlacementGesture.timer=setTimeout(()=>{
        const start=hubPlacementGesture.start;if(!placingHub||!start)return;
        const rect=container.getBoundingClientRect(),point=L.point(start.x-rect.left,start.y-rect.top);
        hubPlacementGesture.timer=null;hubPlacementGesture.triggered=true;hubPlacementGesture.ignoreClickUntil=Date.now()+1100;
        handleMapPlacement({latlng:map.containerPointToLatLng(point)},'long-press');
      },520);
    };
    container.addEventListener('pointerdown',event=>{if(event.pointerType==='touch')begin(event.clientX,event.clientY);},true);
    container.addEventListener('pointermove',event=>{if(event.pointerType==='touch')cancelOnMove({touches:[event]});},true);
    container.addEventListener('pointerup',event=>{if(event.pointerType==='touch')resetHubPlacementGesture();},true);
    container.addEventListener('pointercancel',resetHubPlacementGesture,true);
    const cancelOnMove=event=>{
      const start=hubPlacementGesture.start,touch=event.touches?.[0];
      if(!start||!touch)return;
      if(Math.hypot(touch.clientX-start.x,touch.clientY-start.y)>14)resetHubPlacementGesture();
    };
    container.addEventListener('touchstart',event=>{
      if(!placingHub||event.touches?.length!==1)return;
      const touch=event.touches[0];begin(touch.clientX,touch.clientY);
    },{passive:true});
    container.addEventListener('touchmove',cancelOnMove,{passive:true});
    container.addEventListener('touchend',resetHubPlacementGesture,{passive:true});
    container.addEventListener('touchcancel',resetHubPlacementGesture,{passive:true});
  }
  function startHubPlacement(){
    placementMode='hub';resetHubPlacementGesture();placingHub=true;closeDrawer();closeMapPopovers();document.querySelector('.map-stage').classList.add('placing-hub');
    $('mapStatus').textContent='وضع إنشاء مركز: اضغط مرة واحدة على الموقع، ثم راجع الاسم واعتمد الفتح · التكلفة $8.5M';
  }
  function startBasePlacement(){
    placementMode='base';resetHubPlacementGesture();placingHub=true;closeDrawer();closeMapPopovers();document.querySelector('.map-stage').classList.add('placing-hub');
    $('mapStatus').textContent='وضع فتح قاعدة عالمية: اضغط مرة واحدة في أي دولة، ثم اعتمد الموقع الظاهر · التكلفة $24M';
  }
  function startRoadRoutePlacement(){
    placementMode='road-route';roadDraftStart=null;resetHubPlacementGesture();placingHub=true;closeDrawer();closeMapPopovers();document.querySelector('.map-stage').classList.add('placing-hub');
    $('mapStatus').textContent='وضع مسار بري: اضغط على قاعدة أو مركز مملوك كبداية، ثم اضغط على الوجهة. لن يظهر أي خط قبل التأكيد.';
  }
  function clearPlacementPreview(){placementDraft=null;if(placementPreviewMarker&&map)try{map.removeLayer(placementPreviewMarker)}catch(error){nonCritical('map-preview-remove',error);}placementPreviewMarker=null;}
  function showPlacementReview(coords){
    const isBase=placementMode==='base',place=nearestPlace(coords),cost=isBase?24000000:8500000,name=isBase?`قاعدة ${place.city} — ${place.area||'المركز الإقليمي'}`:logisticsCenterName(place);
    const demand=Math.round(58+Math.min(27,Math.abs(coords[1])*0.22)+Math.min(10,state.assets.length*.4)),risk=Math.round(18+Math.min(42,Math.abs(coords[0]-24)*.55)),score=Math.round(demand-risk*.35-(state.cash<cost?35:0));
    placementDraft={coords,place,isBase,cost,name,study:{demand,risk,score}};if(placementPreviewMarker&&map)try{map.removeLayer(placementPreviewMarker)}catch(error){nonCritical('map-preview-replace',error);}
    placementPreviewMarker=L.circleMarker(coords,{radius:11,color:'#25d7bd',weight:3,fillColor:'#06202a',fillOpacity:.92,interactive:false}).addTo(map);
    $('mapStatus').innerHTML=`<b>${esc(name)}</b><br><span>${esc(place.country)} · ${fmtMoney(cost)}</span><small>GH AI: طلب ${demand}/100 · مخاطر ${risk}/100 · جدوى ${score}/100</small><div class="map-status-actions"><button type="button" id="confirmMapPlacement" ${score<35?'disabled':''}>اعتماد توصية AI</button><button type="button" id="cancelMapPlacement">تغيير</button></div>`;
  }
  function confirmPlacement(){
    return runBusinessOperation('confirmPlacement',()=>{
    if(!placementDraft?.coords){notice('اختر موقعًا صالحًا على الخريطة أولًا.');return;}const [lat,lng]=placementDraft.coords,name=String(placementDraft.name||'مركز لوجستي جديد').trim(),price=18000000;
    try{window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','spend',{company:'road',amount:price,note:`إنشاء مركز لوجستي · ${name}`,method:'شيك مصدق',line:'capex'},{actor:'facility-placement'});const facility={id:nextId('HUB'),kind:'logistics',owned:true,name,city:name,country:'مخصص',coords:[lat,lng],capacity:240,dailyCost:32000,photo:PHOTOS.facility_hq};window.GH_DOMAIN_COMMANDS.dispatch({state},'facilities','create',{facility,bucket:'customHubs',groupValueAdd:price*.72},{actor:'facility-placement'});ensureFacilityWorkforce('road',`تشغيل ${name}`);pushAlert(`تم إنشاء ${name} وربطه بمنظومة المرافق والموارد البشرية.`);save();clearPlacementPreview();renderMap();openDrawer('roadNetwork');}catch(error){notice(`تعذر إنشاء المركز: ${error.message}`);}

    });
  }
  function bindMapPlacementControls(){
    $('mapStatus').addEventListener('click',event=>{if(event.target.closest('#confirmMapPlacement')){event.stopPropagation();confirmPlacement();}else if(event.target.closest('#cancelMapPlacement')){event.stopPropagation();clearPlacementPreview();$('mapStatus').textContent='اختر موقعًا آخر على الخريطة.';}});
  }
  function nearestRoadFacility(coords,maxKm=45){
    return roadFacilityOptions().map(f=>({f,d:haversine(coords,f.coords)})).filter(x=>x.d<=maxKm).sort((a,b)=>a.d-b.d)[0]?.f||null;
  }
  async function createRoadRouteFromMap(from,toCoords){const geometry=await requestRoadGeometry(from.coords,toCoords);if(!geometry)return null;const id=nextId('ROAD-MAP'),toName=placementDraft?.name||'نقطة طريق',route=prepareRoute({id,type:'road',name:`${roadLocationName(from)} → ${toName}`,from:roadLocationName(from),to:toName,fromFacility:from.id,toFacility:null,route:geometry.route,effectiveSpeedKmh:clamp(geometry.distanceKm/Math.max(.25,geometry.durationSeconds/3600),42,82),dwellHours:2.5,routingSource:'OSRM · شبكة طرق فعلية'});try{window.GH_DOMAIN_COMMANDS.dispatch({state},'routes','create',{route:clone(route)},{actor:'route-map'});window.GH_DOMAIN_COMMANDS.dispatch({state},'routes','cache-geometry',{id,route:route.route,distanceKm:route.distanceKm,durationSeconds:geometry.durationSeconds},{actor:'route-map'});routeTemplates[id]=route;return route;}catch(error){console.warn('map road route rejected',error);return null;}}
  function handleMapPlacement(event,source='tap'){
    if(!placingHub||(source==='tap'&&Date.now()<hubPlacementGesture.ignoreClickUntil))return;
    const coords=[Number(event.latlng.lat.toFixed(5)),Number(event.latlng.lng.toFixed(5))];
    if(placementMode==='road-route'){
      if(!roadDraftStart){const from=nearestRoadFacility(coords);if(!from){notice('اختر نقطة قريبة من قاعدة أو مركز لوجستي تملكه. افتح واحدًا أولًا ثم حاول مجددًا.');return;}roadDraftStart=from;$('mapStatus').textContent=`بداية المسار: ${from.name}. اضغط على الوجهة الآن؛ لن يظهر خط قبل الاعتماد.`;return;}
      const from=roadDraftStart;roadDraftStart=null;placingHub=false;resetHubPlacementGesture();document.querySelector('.map-stage').classList.remove('placing-hub');createRoadRouteFromMap(from,coords);return;
    }
    showPlacementReview(coords);
  }
  function renderWorldInfrastructureMarkers(){
    if(!map)return;
    worldMarkers.forEach(marker=>{try{map.removeLayer(marker)}catch(error){nonCritical('map-layer-remove',error);}});worldMarkers.clear();
    const filter=state.activeFilter||'all';if(filter!=='airport'&&filter!=='port')return;
    const bounds=map.getBounds(),zoom=map.getZoom(),limit=zoom<5?90:180;
    const rows=filter==='airport'?WORLD.airports:WORLD.ports;let shown=0;
    for(let i=0;i<rows.length&&shown<limit;i++){
      const row=rows[i];
      if(filter==='airport'&&zoom<5&&!row[1])continue;
      if(filter==='port'&&zoom<5&&!row[5])continue;
      const entity=filter==='airport'?airportEntity(row):portEntity(row);if(!bounds.contains(entity.coords))continue;
      const icon=L.divIcon({className:`world-dot ${filter}`,html:`<span>${entity.icon}</span>`,iconSize:[22,22],iconAnchor:[11,11]});
      const marker=L.marker(entity.coords,{icon,zIndexOffset:180}).addTo(map);
      marker.on('click',()=>showWorldEntity(entity.key));worldMarkers.set(entity.key,marker);shown++;
    }
    $('mapStatus').textContent=`${shown} ${filter==='airport'?'مطارًا':'ميناءً'} في نطاق العرض · كبّر الخريطة لمزيد من المنشآت · الفهرس الكامل ${fmtNumber(filter==='airport'?WORLD.meta.airportCount:WORLD.meta.portCount)}`;
  }

  function renderMap(){
    if(!map)return;
    routeLayers.forEach(layer=>{try{map.removeLayer(layer)}catch(error){nonCritical('map-route-remove',error);}}); routeLayers=[];
    ownMarkers.forEach(marker=>{try{map.removeLayer(marker)}catch(error){nonCritical('map-layer-remove',error);}}); ownMarkers.clear();
    facilityMarkers.forEach(marker=>{try{map.removeLayer(marker)}catch(error){nonCritical('map-layer-remove',error);}}); facilityMarkers.clear();
    competitorMarkers.forEach(marker=>{try{map.removeLayer(marker)}catch(error){nonCritical('map-layer-remove',error);}}); competitorMarkers.clear();
    worldMarkers.forEach(marker=>{try{map.removeLayer(marker)}catch(error){nonCritical('map-layer-remove',error);}}); worldMarkers.clear();

    const filter = state.activeFilter || 'all';
    const zoom=map.getZoom();
    const routedAssets=state.assets.filter(a=>a.routeId);
    const routeKeys=new Set();
    state.assets.forEach(asset=>{
      normalizeAsset(asset);
      const visible = filter==='all'||filter===asset.type;
      if(asset.routeId){
        const route=currentAssetRoute(asset);
        const color=asset.type==='air'?'#547f99':asset.type==='sea'?'#3f7682':'#8c7551';
        const key=`${asset.type}:${asset.routeId}`;
        const isSelected=selectedAssetId===asset.id;
        // عند التكبير البعيد لا نرسم عشرات الخطوط: خط واحد لكل ممر، وتفاصيله عند اختيار الأصل/الطبقة.
        const showLine=visible && (isSelected || zoom>=5 || (zoom>=3 && !routeKeys.has(key)));
        if(showLine){
          routeKeys.add(key);
          const line=L.polyline(route,{color,weight:isSelected?3.2:2,opacity:isSelected?.92:(zoom<5?.30:.62),dashArray:asset.type==='air'?'7 9':null,lineCap:'round',smoothFactor:1.6}).addTo(map);
          routeLayers.push(line);
        }
      }
      if(!visible)return;
      const moving=asset.routeId && asset.phase==='moving';
      const html=vehicleMarkerHtml(asset);
      const icon=L.divIcon({className:`asset-marker ${asset.type}${moving?' is-moving':''}`,html,iconSize:[46,46],iconAnchor:[23,23]});
      const marker=L.marker(assetPosition(asset),{icon,zIndexOffset:700}).addTo(map);
      marker.on('click',()=>showAsset(asset.id)); ownMarkers.set(asset.id,marker);
    });

    if(filter==='all'||filter==='mobility'){
      // Keep the live fleet on one shared SVG renderer: each vehicle is only a
      // tiny path (not a DOM car icon), while the explicit renderer preserves
      // a stable class for hit-testing/QA even though the base map prefers
      // canvas for heavier layers.
      const mobilityRenderer=layers.mobilityRenderer||(layers.mobilityRenderer=L.svg({padding:.1}));
      for(const vehicle of (window.GH_MOBILITY_CORE?.liveVehicles?.(state,120)||[])){
        const pos=interpolateRoute(vehicle.route,vehicle.progress),moving=vehicle.phase==='moving';
        // Mobility is represented by one tiny canvas point rather than a DOM
        // car icon. It stays on the exact registered route and keeps the map
        // cheap when hundreds of vehicles are active.
        const marker=L.circleMarker(pos,{renderer:mobilityRenderer,className:'asset-marker mobility mobility-point',radius:2.6,color:'#050505',weight:1,opacity:.94,fillColor:'#000000',fillOpacity:.98,interactive:true,bubblingMouseEvents:false}).addTo(map);
        marker.bindTooltip(`${esc(vehicle.name)} · ${moving?'رحلة نشطة':'متاح'}`,{direction:'top',permanent:false,opacity:.88});
        marker.on('click',()=>openDrawer('companyManage',{type:'mobility',tab:'operations'}));ownMarkers.set(`mobility:${vehicle.id}`,marker);
      }
    }

    if(['all','facility','airport','port'].includes(filter)){
      const staticFacilityIds=new Set(facilities.map(f=>f.id));
      const assetBaseIds=new Set(state.assets.map(a=>a.baseFacility).filter(Boolean));
      getDynamicFacilities().filter(f=>{
        // المنشآت المرجعية تخدم الحسابات والدليل فقط؛ لا تظهر كملكية عند بداية لعبة جديدة.
        const belongsToPlayer=!staticFacilityIds.has(f.id)||assetBaseIds.has(f.id);
        if(!belongsToPlayer)return false;
        return filter==='airport'?['airport','airport-base'].includes(f.kind):filter==='port'?['port','port-base'].includes(f.kind):true;
      }).forEach(f=>{
        const cls=f.owned?'owned':f.public?'public':'';
        const icon=L.divIcon({className:`facility-marker ${cls}`,html:facilityMarkerHtml(f),iconSize:[26,26],iconAnchor:[13,13]});
        const marker=L.marker(f.coords,{icon,zIndexOffset:400}).addTo(map);
        marker.on('click',()=>openFacility(f.id)); facilityMarkers.set(f.id,marker);
      });
    }

    if(state.showCompetitors && (filter==='all'||['air','sea','road'].includes(filter))){
      const bounds=map.getBounds();
      const competitorLimit=zoom<4?8:zoom<6?16:32;
      let shownAssets=0;
      competitorAssets.forEach(a=>{
        if(filter!=='all'&&filter!==a.type)return;
        const pos=interpolateRoute(a.route,a.progress);
        if(!bounds.contains(pos) || shownAssets>=competitorLimit)return;
        const icon=L.divIcon({className:'competitor-marker',html:competitorMarkerHtml(a),iconSize:[46,46],iconAnchor:[23,23]});
        const marker=L.marker(pos,{icon,zIndexOffset:300}).addTo(map).bindPopup(`<b>${a.name}</b><br>${a.company}<br><span style="color:#9fb0b5">منافس — حركة سوقية</span>`);
        competitorMarkers.set(a.id,marker);shownAssets++;
      });
      let shownHq=0;
      competitors.forEach(c=>{
        if((state.stakes[c.id]||0)>=51)return;
        if(filter!=='all'&&filter!=='facility')return;
        if(!bounds.contains(c.coords) || shownHq>=(zoom<4?4:8))return;
        const icon=L.divIcon({className:'facility-marker competitor',html:`<div class="marker-core facility-real hq">${FACILITY_SVG.hq}</div>`,iconSize:[25,25],iconAnchor:[12,12]});
        const marker=L.marker(c.coords,{icon,zIndexOffset:250}).addTo(map).bindPopup(`<b>${c.name}</b><br>${c.sector}<br>الحصة السوقية: ${c.marketShare}`);
        competitorMarkers.set(`HQ-${c.id}`,marker);shownHq++;
      });
    }
    updateMapStatus();renderWorldInfrastructureMarkers();
  }

  function updateMapStatus(){
    if(placingHub)return;
    if(['airport','port'].includes(state.activeFilter))return;
    const mobility=window.GH_MOBILITY_CORE?.snapshot?.(state)||{moving:0,vehicles:0};
    const moving=state.assets.filter(a=>a.phase==='moving').length+mobility.moving;
    const idle=state.assets.filter(a=>a.phase==='idle').length;
    const turn=state.assets.filter(a=>a.phase==='turnaround').length;
    const routed=operationalRoutes('road').filter(r=>r.routingSource).length;
    $('mapStatus').textContent=`${moving} متحرك · ${turn} في محطة · ${idle} متوقف · ${state.assets.length+mobility.vehicles} أصل · ${routed} مسار بري فعلي`;
  }

  function updateMarkerPositions(force=false){
    if(!map)return;
    const now=(window.performance?.now?.()||Date.now());
    if(!force){
      if(mapInteractionActive)return;
      const markerInterval=state.speed>=4?120:90;
      if(now-lastMarkerFrameAt<markerInterval)return;
    }
    lastMarkerFrameAt=now;
    state.assets.forEach(a=>{const m=ownMarkers.get(a.id);if(m){m.setLatLng(assetPosition(a));refreshVehicleMarker(m,a.type,assetBearing(a),a.phase==='moving');}});
    for(const vehicle of (window.GH_MOBILITY_CORE?.liveVehicles?.(state,120)||[])){const m=ownMarkers.get(`mobility:${vehicle.id}`);if(m)m.setLatLng(interpolateRoute(vehicle.route,vehicle.progress));}
    competitorAssets.forEach(a=>{const m=competitorMarkers.get(a.id);if(m){m.setLatLng(interpolateRoute(a.route,a.progress));refreshVehicleMarker(m,a.type,routeBearing(a.route,a.progress),true);}});
  }

  function simDate(){ return new Date(SIM_START + state.simSeconds*1000); }
  function formatSimDate(){
    const d=simDate();
    const date=new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(d);
    const hh=String(d.getUTCHours()).padStart(2,'0'), mm=String(d.getUTCMinutes()).padStart(2,'0');
    return `${date} · ${hh}:${mm}`;
  }
  function formatDuration(seconds){
    if(seconds<=0)return 'الآن';
    if(seconds<3600)return `${Math.ceil(seconds/60)} دقيقة`;
    if(seconds<86400)return `${(seconds/3600).toFixed(seconds<10800?1:0)} ساعة`;
    return `${(seconds/86400).toFixed(seconds<259200?1:0)} يوم`;
  }

  function updateKpis(){
    $('groupName').textContent=state.profile.name;
    $('brandMark').textContent=(state.profile.shortName||'GH').slice(0,4).toUpperCase();
    $('cashKpi').textContent=state.godMoney&&state.infiniteMoney?'∞':fmtMoney(state.cash);
    $('debtKpi').textContent=fmtMoney(state.debt);
    $('valueKpi').textContent=fmtMoney(state.groupValue);
    $('profitKpi').textContent=`${state.todayProfit>=0?'+':''}${fmtMoney(state.todayProfit)}`;
    $('profitKpi').classList.toggle('positive',state.todayProfit>=0);
    $('profitKpi').classList.toggle('negative',state.todayProfit<0);
    $('alertCount').textContent=Math.min(99,state.alerts.length);
    const aiCount=(state.advanced?.ai?.requests||[]).filter(r=>r.status==='بانتظار التفويض').length;if($('aiRequestCount'))$('aiRequestCount').textContent=Math.min(99,aiCount);
    $('simDate').textContent=formatSimDate();
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
    return {todayProfit:0,groupValue:0,sectorProfit:{},tripProfit:{},tripRevenue:{},tripFuel:{},tripMaintenance:{},tripCount:{},cash:{},alerts:[],saleIds:[]};
  }
  function mergeSimulationEffects(target,source){
    target.todayProfit+=Number(source.todayProfit)||0;target.groupValue+=Number(source.groupValue)||0;
    for(const type of ['air','sea','road','power','bank']){
      target.sectorProfit[type]=(target.sectorProfit[type]||0)+(Number(source.sectorProfit[type])||0);
      target.tripProfit[type]=(target.tripProfit[type]||0)+(Number(source.tripProfit[type])||0);
      target.tripRevenue[type]=(target.tripRevenue[type]||0)+(Number(source.tripRevenue[type])||0);
      target.tripFuel[type]=(target.tripFuel[type]||0)+(Number(source.tripFuel[type])||0);target.tripMaintenance[type]=(target.tripMaintenance[type]||0)+(Number(source.tripMaintenance[type])||0);target.tripCount[type]=(target.tripCount[type]||0)+(Number(source.tripCount[type])||0);
      target.cash[type]=(target.cash[type]||0)+(Number(source.cash[type])||0);
    }
    target.alerts.push(...source.alerts);target.saleIds.push(...source.saleIds);
  }
  const SIMULATION_ASSET_FIELDS=['phase','dwellRemaining','reverse','progress','fuel','condition','from','to','load','baseFacility','lastTrip','routeId','simCarrySeconds','lastTransitionGuardDay','crewBlocked'];
  const SIMULATION_ASSET_GUARD_FIELDS=[...SIMULATION_ASSET_FIELDS,'salePending','tripSeconds','type','name','ownership','monthlyLease','purchasePrice','specs'];
  function simulationAssetGuard(asset){
    if(!asset)return 'missing';
    const guarded={};for(const field of SIMULATION_ASSET_GUARD_FIELDS)guarded[field]=asset[field]===undefined?null:asset[field];
    guarded.routeTemplate=asset.routeId&&routeTemplates[asset.routeId]?routeTemplates[asset.routeId]:null;
    return JSON.stringify(guarded);
  }
  function simulationContextGuard(){
    return JSON.stringify({
      profile:state.profile,crew:state.crew,advanced:state.advanced,realism:state.realism,
      energy:state.energy,bank:state.bank,governance:state.governance,research:state.research,esg:state.esg,
      openedCompanies:state.openedCompanies,companyRegistry:state.companyRegistry,insurancePolicies:state.insurancePolicies
    });
  }

  // Pure simulation draft: asset and effects are local to the slice. Nothing is committed to state here.
  function processAssetDraft(asset, simAdvance, effects, simMeta={}){
    normalizeAsset(asset);
    let remaining=Math.max(0,Number(simAdvance)||0)+Math.max(0,Number(asset.simCarrySeconds)||0);
    asset.simCarrySeconds=0;
    if(asset.phase==='idle'||!asset.routeId||remaining<=0)return;
    const tpl=routeTemplates[asset.routeId];
    if(!tpl)return;
    let transitions=0,completedTrips=0,totalTripMargin=0,lastEco=null;
    const infinite=!!simMeta.infiniteMoney;
    while(remaining>1e-6&&transitions<96&&asset.routeId&&asset.phase!=='idle'){
      transitions++;
      if(asset.phase==='turnaround'){
        const dwell=Math.max(0,Number(asset.dwellRemaining)||0);
        if(dwell>remaining){asset.dwellRemaining=dwell-remaining;remaining=0;break;}
        remaining=Math.max(0,remaining-dwell);
        const hr=window.GH_HR_CORE;
        if(!hr?.snapshot||hr.snapshot(state,hrContext(),asset.type).crewMissing>0){if(!asset.crewBlocked)effects.alerts.push(`${asset.name}: أوقفت المغادرة حتى استكمال الطاقم المطلوب.`);asset.crewBlocked=true;remaining=0;break;}
        window.GH_FLEET_CORE.departDraft(asset,tpl,{crewReady:true,load:loadLabel(asset)});
        continue;
      }
      const duration=Number(asset.tripSeconds||tpl.tripSeconds);
      if(!Number.isFinite(duration)||duration<=0){asset.progress=0;asset.phase='idle';asset.routeId=null;effects.alerts.push(`${asset.name}: أوقف النظام المسار لأن مدة الرحلة غير صالحة.`);remaining=0;break;}
      const progress=clamp(Number(asset.progress)||0,0,1),timeToArrival=Math.max(0,(1-progress)*duration);
      const travel=Math.min(remaining,timeToArrival),delta=duration>0?travel/duration:0;
      asset.progress=clamp(progress+delta,0,1);
      asset.fuel=clamp(asset.fuel-delta*(asset.type==='air'?55:asset.type==='sea'?43:49),4,100);
      asset.condition=clamp(asset.condition-delta*(asset.type==='air'?.08:asset.type==='sea'?.05:.11),55,100);
      remaining=Math.max(0,remaining-travel);
      if(asset.progress<1-1e-9)break;
      asset.progress=1;asset.phase='turnaround';asset.dwellRemaining=Math.max(0,Number(tpl.dwellHours)||0)*3600;
      asset.baseFacility=asset.reverse?tpl.fromFacility:tpl.toFacility;
      const eco=computeTripEconomics(asset,tpl);asset.lastTrip=eco;lastEco=eco;completedTrips++;totalTripMargin+=Number(eco.margin)||0;
      effects.todayProfit+=Number(eco.margin)||0;effects.sectorProfit[asset.type]=(effects.sectorProfit[asset.type]||0)+(Number(eco.margin)||0);effects.tripProfit[asset.type]=(effects.tripProfit[asset.type]||0)+(Number(eco.margin)||0);
      const tripCash=Number.isFinite(eco.cashContribution)?eco.cashContribution:(eco.revenue-eco.fuelCost-eco.maintReserve);
      if(!infinite){
        effects.cash[asset.type]=(effects.cash[asset.type]||0)+(Number(tripCash)||0);effects.tripRevenue[asset.type]=(effects.tripRevenue[asset.type]||0)+Math.max(0,Number(eco.revenue)||0);effects.tripFuel[asset.type]=(effects.tripFuel[asset.type]||0)+Math.max(0,Number(eco.fuelCost)||0);effects.tripMaintenance[asset.type]=(effects.tripMaintenance[asset.type]||0)+Math.max(0,Number(eco.maintReserve)||0);effects.tripCount[asset.type]=(effects.tripCount[asset.type]||0)+1;
      }
      effects.groupValue+=Math.max(0,Number(eco.margin)||0)*.08;
      if(asset.salePending){const ownedStop=findFacility(asset.baseFacility);if(ownedStop?.owned){asset.phase='idle';asset.routeId=null;asset.progress=0;asset.dwellRemaining=0;effects.saleIds.push(asset.id);remaining=0;break;}asset.dwellRemaining=0;effects.alerts.push(`${asset.name}: وصل محطة عامة ضمن أمر البيع؛ سيعود تلقائيًا إلى مركز المجموعة قبل تنفيذ البيع.`);}
    }
    if(transitions>=96&&remaining>1e-6){
      asset.simCarrySeconds=Math.min(86400,Math.max(0,remaining));
      const day=Math.floor((Number(simMeta.to)||state.simSeconds||0)/86400);
      if(asset.lastTransitionGuardDay!==day){asset.lastTransitionGuardDay=day;effects.alerts.push(`${asset.name}: بلغ حد حماية انتقالات المحاكاة؛ تم حفظ ${formatDuration(asset.simCarrySeconds)} كزمن مرحّل وسيُستكمل في الشريحة التالية دون فقد.`);}
    }else asset.simCarrySeconds=0;
    if(completedTrips===1&&lastEco)effects.alerts.push(`${asset.name} أكمل رحلة. إيراد ${fmtMoney(lastEco.revenue)} − وقود ${fmtMoney(lastEco.fuelCost)} − طاقم ${fmtMoney(lastEco.crewCost)} − صيانة ${fmtMoney(lastEco.maintReserve)} = هامش ${fmtMoney(lastEco.margin)}.`);
    else if(completedTrips>1)effects.alerts.push(`${asset.name} أكمل ${completedTrips} رحلات أثناء تقديم الوقت بإجمالي هامش ${fmtMoney(totalTripMargin)}.`);
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

      const tripAccruals=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','consume-trip-accruals',{}, {actor:'financial-close'}).result;
      const tripProfit=tripAccruals.profit,tripRevenue=tripAccruals.revenue,tripFuel=tripAccruals.fuel,tripMaintenance=tripAccruals.maintenance,tripCount=tripAccruals.count;
      // Scalable accounting source of truth: one daily settlement batch per company,
      // not three financial documents per individual trip. Cash has already moved
      // atomically with the trips; these documents record that cash movement once.
      for(const type of ['air','sea','road']){const count=Math.max(0,Number(tripCount[type])||0),revenue=Math.max(0,Number(tripRevenue[type])||0),fuel=Math.max(0,Number(tripFuel[type])||0),maint=Math.max(0,Number(tripMaintenance[type])||0);if(revenue>0)postInvoice('دخل',revenue,`تسوية رحلات يومية ${typeName(type)} · ${count} رحلة`,'تسوية تشغيل يومية',true,'مدفوعة',type,'مركز تسوية العملاء');if(fuel>0)postInvoice('مصروف',fuel,`وقود رحلات يومية ${typeName(type)} · ${count} رحلة`,'تسوية مورد وقود يومية',true,'مدفوعة',type,'موردو الوقود المعتمدون');if(maint>0)postInvoice('مصروف',maint,`مخصص صيانة رحلات يومية ${typeName(type)} · ${count} رحلة`,'مخصص صيانة يومي',false,'مدفوعة',type,'مراكز الصيانة المعتمدة');}
      const sectorContractRevenue={air:0,sea:0,road:0,power:0,bank:0,mobility:0},sectorContractCost={air:0,sea:0,road:0,power:0,bank:0,mobility:0};
      const contractTerms={};for(const id of (state.acceptedContracts||[])){const c=contracts.find(x=>x.id===id);if(!c)continue;contractTerms[id]=Math.max(1,Number(c.termMonths)||1)*30;sectorContractRevenue[c.sector]=(sectorContractRevenue[c.sector]||0)+c.value/(c.termMonths*30);sectorContractCost[c.sector]=(sectorContractCost[c.sector]||0)+c.cost/(c.termMonths*30);}const expiredContracts=window.GH_DOMAIN_COMMANDS.dispatch({state},'contracts','tick-day',{day:state.lastFinancialDay,terms:contractTerms},{actor:'simulation'}).result?.expired||[];for(const id of expiredContracts){const c=contracts.find(x=>x.id===id);if(c)pushAlert(`اكتمل عقد ${c.name} وانتهت مدته التشغيلية بعد ${c.termMonths} شهرًا.`);}
      const crewBySector={air:crewSectorPayroll('air'),sea:crewSectorPayroll('sea'),road:crewSectorPayroll('road'),power:0,bank:0,mobility:0}; // daily-rate basis; cash payroll settles on day 27 of each 30-day simulation month
      const leaseBySector={air:0,sea:0,road:0,power:0,bank:0,mobility:0};state.assets.forEach(a=>{if(a.ownership==='lease')leaseBySector[a.type]=(leaseBySector[a.type]||0)+(a.monthlyLease||0)/30;});
      const baseBySector={air:0,sea:0,road:0,power:0,bank:0,mobility:0},facilityIncomeBySector={air:0,sea:0,road:0,power:0,bank:0,mobility:0},facilityStaffBySector={air:0,sea:0,road:0,power:0,bank:0,mobility:0};
      getDynamicFacilities().filter(f=>f.owned).forEach(f=>{const sector=['airport','airport-base'].includes(f.kind)?'air':['port','port-base'].includes(f.kind)?'sea':['logistics','depot'].includes(f.kind)?'road':f.kind==='power'?'power':f.kind==='bank'?'bank':f.kind==='mobility-center'?'mobility':null;if(sector){baseBySector[sector]+=(f.dailyCost||0);const m=state.advanced?.facilities?.[f.id];if(m){facilityIncomeBySector[sector]+=(Number(m.expectedRevenue)||0)/365;facilityStaffBySector[sector]+=(Number(m.staff)||0)*48+(Number(m.level)||0)*900;}}});
      const eco=window.GH_ECONOMICS_CORE?.sectorEconomics?.(state)||{power:32000,bank:26000,detail:{}};const ed=eco.detail||{};
      const operatingRevenue={air:sectorContractRevenue.air+facilityIncomeBySector.air,sea:sectorContractRevenue.sea+facilityIncomeBySector.sea,road:sectorContractRevenue.road+facilityIncomeBySector.road,power:sectorContractRevenue.power+facilityIncomeBySector.power+Math.max(0,Number(ed.powerRevenue)||0),bank:sectorContractRevenue.bank+facilityIncomeBySector.bank+Math.max(0,Number(ed.bankRevenue)||0),mobility:facilityIncomeBySector.mobility};
      const operatingExpense={air:sectorContractCost.air+baseBySector.air+facilityStaffBySector.air+leaseBySector.air,sea:sectorContractCost.sea+baseBySector.sea+facilityStaffBySector.sea+leaseBySector.sea,road:sectorContractCost.road+baseBySector.road+facilityStaffBySector.road+leaseBySector.road,power:sectorContractCost.power+baseBySector.power+facilityStaffBySector.power+Math.max(0,Number(ed.powerExpense)||0),bank:sectorContractCost.bank+baseBySector.bank+facilityStaffBySector.bank+Math.max(0,Number(ed.bankExpense)||0),mobility:baseBySector.mobility+facilityStaffBySector.mobility};
      const daily={air:operatingRevenue.air-operatingExpense.air,sea:operatingRevenue.sea-operatingExpense.sea,road:operatingRevenue.road-operatingExpense.road,power:operatingRevenue.power-operatingExpense.power,bank:operatingRevenue.bank-operatingExpense.bank,mobility:operatingRevenue.mobility-operatingExpense.mobility};
      for(const type of ['air','sea','road','power','bank','mobility']){
        const revenue=Math.max(0,Number(operatingRevenue[type])||0),expense=Math.max(0,Number(operatingExpense[type])||0);if(revenue>0)window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','credit',{company:type,amount:revenue,note:`إيراد يومي ${typeName(type)} · عقود/منشآت`,method:'قيد تشغيلي يومي',taxable:false,counterparty:'مركز التسوية التشغيلي'},{actor:'financial-close'});if(expense>0){const available=companyOperatingBalance(type),paid=Math.min(available,expense);if(paid>0)spendCompany(type,paid,`مصروف يومي ${typeName(type)} · عقود/منشآت/إيجارات`,'قيد تشغيلي يومي',false);if(paid<expense){const due=expense-paid,number=`${type.toUpperCase()}-ACC-${state.lastFinancialDay}`;postAccruedExpense(type,due,'مصروف تشغيلي مستحق مرحّل من الإقفال اليومي','قيد مستحق',state.lastFinancialDay+7,number,'مصروف تشغيلي');}}
      }
      const closedSectorProfit={air:(tripProfit.air||0)+daily.air,sea:(tripProfit.sea||0)+daily.sea,road:(tripProfit.road||0)+daily.road,power:(tripProfit.power||0)+daily.power,bank:(tripProfit.bank||0)+daily.bank,mobility:(tripProfit.mobility||0)+daily.mobility};
      const executiveAnnualPayroll=state.hired.reduce((sum,id)=>sum+(candidates.find(c=>c.id===id)?.salary||0),0),executiveDailyAccrual=executiveAnnualPayroll/365,overhead=42500+state.assets.length*80,advancedCost=window.GH_ADVANCED?window.GH_ADVANCED.onFinancialDay(state,state.lastFinancialDay):0,realismCost=window.GH_REALISM?window.GH_REALISM.onDay(state,state.lastFinancialDay):0,groupCost=overhead+advancedCost+realismCost;
      if(groupCost>0){const paid=Math.min(companyOperatingBalance('group'),groupCost);if(paid>0)spendCompany('group',paid,'إقفال يومي الشركة القابضة · إدارة وامتثال','قيد يومي',false);if(paid<groupCost){const due=groupCost-paid,number=`GH-ACC-${state.lastFinancialDay}`;postAccruedExpense('group',due,'عجز الشركة القابضة المرحّل','قيد مستحق',state.lastFinancialDay+7,number,'مصروفات إدارية وتشغيلية');}}
      reconcileConsolidatedCash();const net=Object.values(closedSectorProfit).reduce((a,b)=>a+(Number(b)||0),0)-groupCost;window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','record-daily-close',{sectors:closedSectorProfit,net},{actor:'financial-close'});window.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','adjust-group-value',{delta:net*.03},{actor:'financial-close'});runOperationsCycle(net);
      // Midnight closes through Finance Core; current-day KPIs are reset by the domain owner.
      const simulationDayOfMonth=((state.lastFinancialDay-1)%30)+1;
      if(simulationDayOfMonth===27){
        const payrollItems=[['group',executiveAnnualPayroll/12],['air',crewBySector.air*30],['sea',crewBySector.sea*30],['road',crewBySector.road*30]];
        payrollItems.forEach(([company,raw])=>{const amount=Math.max(0,Math.round(Number(raw)||0));if(amount<=0)return;const note=`مسير رواتب يوم 27 · ${companyFinanceName(company)}`;if(canCompanySpend(company,amount)){spendCompany(company,amount,note,'تحويل رواتب',false);pushAlert(`تم صرف رواتب ${companyFinanceName(company)} بقيمة ${fmtMoney(amount)} عبر تحويلات الرواتب.`);}else{const number=`PAY-${company.toUpperCase()}-${state.lastFinancialDay}`;if(!state.finance.payables.some(x=>x.number===number))postAccruedExpense(company,amount,'رواتب مستحقة — نقص سيولة','تحويل رواتب',state.lastFinancialDay,number,'مصروف رواتب وأجور');const existing=(state.advanced?.ai?.requests||[]).some(x=>x.ref===number);if(!existing)window.GH_DOMAIN_COMMANDS.dispatch({state},'ai','submit',{id:`AI-FUND-${number}`,ref:number,company,kind:'funding',title:`تمويل رواتب ${companyFinanceName(company)}`,reason:`حساب الشركة لا يغطي مسير يوم 27 بقيمة ${fmtMoney(amount)}.`,cost:amount,supplier:'الخزينة المركزية',method:'تحويل داخلي',createdDay:state.lastFinancialDay,createdHour:Math.floor((state.simSeconds||0)/3600)},{actor:'financial-close'});pushAlert(`GH AI: رواتب ${companyFinanceName(company)} لم تُصرف لنقص السيولة ورفعت للمركز للموافقة على التمويل.`);}});
      }
      if(state.lastFinancialDay%30===0){
        const payroll=executiveAnnualPayroll/12+Object.values(crewBySector).reduce((a,b)=>a+b,0)*30;
        window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','close-vat-period',{day:state.lastFinancialDay},{actor:'financial-close'});reconcileConsolidatedCash();pushAlert(`إغلاق شهري مستقل لكل شركة. إجمالي الرواتب ${fmtMoney(payroll)} وصافي المجموعة اليومي ${fmtMoney(net)}.`);
      }
    }
  }

  function runOperationsCycle(net){
    const moving=state.assets.filter(a=>a.phase==='moving').length,readiness=state.assets.length?state.assets.reduce((s,a)=>s+a.condition,0)/state.assets.length:100;
    const brief=window.GH_DOMAIN_COMMANDS.dispatch({state},'operations','daily-brief',{day:state.lastFinancialDay,net,moving,readiness,debt:state.debt,groupValue:state.groupValue},{actor:'simulation'}).result;
    if(brief.risk>=55)pushAlert(`GH Intelligence: مخاطر تشغيلية مرتفعة (${brief.risk}/100). أوصى بفحص الصيانة والسيولة قبل فتح التزامات جديدة.`);
    else if(state.lastFinancialDay%7===0)pushAlert(`GH Intelligence: موجز أسبوعي — ${moving} أصلًا متحركًا، جاهزية الأسطول ${Math.round(readiness)}%، صافي اليوم ${fmtMoney(net)}.`);
  }

  function processMarket(processedHour=null){
    const currentHour=Math.floor(state.simSeconds/3600),hour=processedHour==null?currentHour:Math.max(0,Math.floor(Number(processedHour)||0));
    if(hour<=state.lastMarketHour)return;
    if(hour-state.lastMarketHour!==1)throw new Error(`Non-sequential market boundary: ${state.lastMarketHour} -> ${hour}`);
    state.lastMarketHour=hour;
    window.GH_DOMAIN_COMMANDS.dispatch({state},'market','tick-prices',{hour},{actor:'simulation-market'});
    if(window.GH_REALISM)window.GH_REALISM.onHour(state,hour);
    if(window.GH_ADVANCED){const advCtx=advancedContext();const aiCycle=()=>{window.GH_ADVANCED.onMarketHour(state,hour);if(window.GH_ADVANCED.proactiveReview)window.GH_ADVANCED.proactiveReview(advCtx,true,null,hour);window.GH_DEMAND_CLOSURE?.reconcile?.(state);return {hour,requests:state.advanced?.ai?.requests?.length||0};};const cp=window.GH_CONTROL_PLANE;if(cp?.execute)cp.execute(state,{name:'AI_HOURLY_EXECUTIVE_CYCLE',domain:'ai',actor:'GH Intelligence',correlationId:`AI-HOUR-${hour}`},aiCycle,{atomic:false,integrity:true});else aiCycle();}
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
  function archiveTrim(arr,max,kind){
    if(!Array.isArray(arr)||arr.length<=max)return arr;const removed=arr.splice(max),a=financeAuditArchive(),bucket=Array.isArray(a.records[kind])?a.records[kind]:(a.records[kind]=[]);bucket.push(...removed.map(x=>clone(x)));
    const archiveMax=12000;if(bucket.length>archiveMax){const overflow=bucket.splice(0,bucket.length-archiveMax),ids=overflow.map(x=>String(x?.number||x?.id||x?.sourceRef||'')).filter(Boolean),total=overflow.reduce((n,x)=>n+Math.max(0,Number(x?.total??x?.amount)||0),0);a.digests.push({id:`AUD-${kind}-${Math.floor(state.simSeconds/86400)}-${a.digests.length+1}`,kind,count:overflow.length,total,firstAt:Number(overflow[0]?.at)||0,lastAt:Number(overflow[overflow.length-1]?.at)||0,sourceDocumentIds:ids,sources:overflow.map(x=>({id:String(x?.number||x?.id||''),sourceRef:String(x?.sourceRef||x?.documentNumber||''),company:String(x?.company||''),amount:Math.max(0,Number(x?.total??x?.amount)||0),at:Number(x?.at)||0})),checksum:auditChecksum(overflow),at:state.simSeconds});if(a.digests.length>3000)a.digests=a.digests.slice(-3000);}
    return arr;
  }
  function compactOpenFinanceBucket(bucket,label,maxItems=480,keepRecent=320){
    if(!Array.isArray(bucket)||bucket.length<=maxItems)return bucket;
    const recent=bucket.slice(0,keepRecent),older=bucket.slice(keepRecent),groups=new Map();
    for(const item of older){
      const company=COMPANY_FINANCE_TYPES.includes(item?.company)?item.company:'group',kind=String(item?.kind||label),status=String(item?.status||'مستحق'),key=`${company}|${kind}|${status}`;
      const row=groups.get(key)||{company,companyName:companyFinanceName(company),kind,status,amount:0,total:0,tax:0,dueDay:Number(item?.dueDay)||Math.floor(state.simSeconds/86400),count:0,sourceDocumentIds:[]};
      row.amount+=Math.max(0,Number(item?.amount??item?.total)||0);row.total+=Math.max(0,Number(item?.total??item?.amount)||0);row.tax+=Math.max(0,Number(item?.tax)||0);row.dueDay=Math.min(row.dueDay,Number(item?.dueDay)||row.dueDay);row.count++;const sourceId=String(item?.number||item?.id||'');if(sourceId)row.sourceDocumentIds.push(sourceId);groups.set(key,row);
    }
    const stamp=Math.floor(state.simSeconds/86400);
    const consolidated=[...groups.values()].filter(x=>x.total>0).map((x,i)=>({number:`${label==='ذمم مدينة'?'AR':'AP'}-CONSOL-${x.company.toUpperCase()}-${stamp}-${i+1}`,company:x.company,companyName:x.companyName,kind:x.kind,amount:x.amount,tax:x.tax,total:x.total,note:`${label} تاريخية مجمعة وقائيًا · ${x.count} سجل`,method:'قيد تجميعي وقائي',status:x.status,at:state.simSeconds,dueDay:x.dueDay,consolidated:true,sourceCount:x.count,sourceDocumentIds:x.sourceDocumentIds}));
    return [...recent,...consolidated];
  }
  function compactSimulationState(force=false){
    const day=Math.floor((state.simSeconds||0)/86400);
    state.simulationKernel=state.simulationKernel&&typeof state.simulationKernel==='object'?state.simulationKernel:{};
    if(!force&&state.simulationKernel.lastCompactDay===day)return;
    state.simulationKernel.lastCompactDay=day;
    const trim=(arr,max)=>{if(Array.isArray(arr)&&arr.length>max)arr.length=max;};
    archiveTrim(state.treasury?.ledger,5000,'treasuryLedger');archiveTrim(state.finance?.journalEntries,5000,'journalEntries');archiveTrim(state.finance?.invoices,2500,'invoices');archiveTrim(state.finance?.cheques,1200,'cheques');archiveTrim(state.finance?.transfers,1200,'transfers');archiveTrim(state.finance?.periods,240,'taxPeriods');archiveTrim(state.supplierTransactions,3000,'supplierTransactions');
    for(const type of COMPANY_FINANCE_TYPES)archiveTrim(companyBook(type)?.ledger,5000,`companyLedger-${type}`);
    if(state.finance){state.finance.payables=compactOpenFinanceBucket(state.finance.payables,'ذمم دائنة',5000,3500);state.finance.receivables=compactOpenFinanceBucket(state.finance.receivables,'ذمم مدينة',5000,3500);}
    trim(state.alerts,32);trim(state.eventLog,280);trim(state.operations?.dailyBriefs,24);trim(state.bank?.cashSweeps,48);
    const ai=state.advanced?.ai;if(ai){trim(ai.monitoringLetters,72);trim(ai.delegations,180);trim(ai.executionLog,220);trim(ai.requestArchive,220);}
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
      const outcome=window.GH_TRANSACTION_CORE.execute(state,{label:`boundary-recovery:${kind}:${value}`,apply:()=>{
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
    'alerts','eventLog','sequences','simulationKernel','realism','mobility','advanced','businessLedger','dependencyGraph','controlPlane','leasedAssets'
  ]);

  function createSimulationSliceJob(sliceSeconds,meta={}){
    if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core 2.2 is required before simulation starts');
    const tx=window.GH_TRANSACTION_CORE;
    // Snapshot every asset at the logical start of the slice. No draft may read a later live asset state.
    const assetSeeds=(state.assets||[]).map(asset=>({id:asset.id,guard:simulationAssetGuard(asset),snapshot:clone(asset)}));
    const contextGuard=simulationContextGuard();
    const competitorSeeds=(competitorAssets||[]).map(a=>({guard:JSON.stringify(a),snapshot:{...a}}));
    const records=[],journal=makeSimulationEffects(),speed=Number(meta.speed)||state.speed;
    const simMeta={speed,from:Number(meta.from)||state.simSeconds,to:Number(meta.to)||(state.simSeconds+sliceSeconds),infiniteMoney:!!(state.godMoney&&state.infiniteMoney)};
    const boundary=meta.boundary||{};
    let ai=0,ci=0,finished=false,cancelled=false;
    return {
      runChunk(maxItems){
        if(cancelled)return true;
        let count=0;
        while(ai<assetSeeds.length&&count<maxItems){
          const seed=assetSeeds[ai++],draft=clone(seed.snapshot),effects=makeSimulationEffects();
          processAssetDraft(draft,sliceSeconds,effects,simMeta);records.push({id:seed.id,guard:seed.guard,draft,effects});count++;
        }
        while(ai>=assetSeeds.length&&ci<competitorSeeds.length&&count<maxItems){
          const seed=competitorSeeds[ci++],a={...seed.snapshot},d=routeDistance(a.route),trip=d/a.speed*3600;
          if(Number.isFinite(trip)&&trip>0)a.progress=(a.progress+sliceSeconds/trip)%1;
          seed.draft=a;count++;
        }
        finished=ai>=assetSeeds.length&&ci>=competitorSeeds.length;return finished;
      },
      finish(info={}){
        if(cancelled||!finished)return {committed:false,reason:'job-not-finished'};
        const liveAssets=new Map((state.assets||[]).map(a=>[a.id,a]));
        const conflict=records.find(rec=>simulationAssetGuard(liveAssets.get(rec.id))!==rec.guard);
        if(conflict)return {committed:false,retry:true,reason:'asset-conflict',assetId:conflict.id};
        if(simulationContextGuard()!==contextGuard)return {committed:false,retry:true,reason:'simulation-context-conflict'};
        if(competitorAssets.length!==competitorSeeds.length||competitorSeeds.some((seed,i)=>JSON.stringify(competitorAssets[i])!==seed.guard))return {committed:false,retry:true,reason:'competitor-conflict'};

        let outcome;
        const hasBoundary=(boundary.day!==null&&boundary.day!==undefined)||(boundary.hour!==null&&boundary.hour!==undefined);
        outcome=tx.execute(state,{
            label:`simulation:${simMeta.from}->${simMeta.to}`,
            // Ordinary slices mutate a bounded domain. Hour/day callbacks can touch many
            // business systems, so boundaries deliberately retain full-state rollback.
            scope:hasBoundary?null:SIMULATION_TRANSACTION_SCOPE,
            validate:()=>{
              if(cancelled)return {ok:false,reason:'cancelled-before-commit'};
              if(Number(state.simSeconds)!==Number(simMeta.from))return {ok:false,reason:'time-conflict'};
              if(records.some(rec=>simulationAssetGuard((state.assets||[]).find(a=>a.id===rec.id))!==rec.guard))return {ok:false,reason:'asset-conflict'};
              if(simulationContextGuard()!==contextGuard)return {ok:false,reason:'simulation-context-conflict'};
              return {ok:true};
            },
            apply:()=>{
              state.simSeconds=simMeta.to;
              for(const rec of records){
                const current=(state.assets||[]).find(a=>a.id===rec.id);
                if(!current)throw new Error(`Atomic asset disappeared during commit: ${rec.id}`);
                for(const field of SIMULATION_ASSET_FIELDS)current[field]=clone(rec.draft[field]);
                mergeSimulationEffects(journal,rec.effects);
              }
              for(let i=0;i<competitorAssets.length;i++)competitorAssets[i].progress=competitorSeeds[i].draft.progress;
              window.GH_FINANCE_CORE.execute({state},'apply-simulation-journal',{journal});
              window.GH_CORPORATE_CORE.execute({state},'adjust-group-value',{delta:Number(journal.groupValue)||0});
              for(const text of journal.alerts)window.GH_OPERATIONS_CORE.execute({state},'record-alert',{text,type:'simulation'});
              // Delivery cadence is slice-based, not day-based. This keeps procurement responsive under ×1…×4
              // while remaining inside the same atomic transaction as time and asset state.
              if(window.GH_REALISM?.onSimulationTime)window.GH_REALISM.onSimulationTime(state,simMeta.to);
              window.GH_MOBILITY_CORE?.onSimulationTime?.({state},simMeta.to);

              // Boundary work is inside the SAME transaction as assets and time. A failure rolls all of it back.
              // Midnight closes the financial day first, then the hourly market/AI checkpoint at the same timestamp.
              if(boundary.day!==null&&boundary.day!==undefined)processFinancialDay(boundary.day);
              if(boundary.hour!==null&&boundary.hour!==undefined)processMarket(boundary.hour);

              state.simulationKernel=state.simulationKernel||{};
              state.simulationKernel.lastAtomicCommit={from:simMeta.from,to:simMeta.to,assets:records.length,day:boundary.day??null,hour:boundary.hour??null,at:state.simSeconds,core:'2.4.1'};
              return true;
            }
          });
        if(!outcome.committed)return {committed:false,retry:true,reason:outcome.reason||'transaction-rejected'};
        for(const id of new Set(journal.saleIds))queueAssetSaleFinalize(id);
        return {committed:true,boundary:{day:boundary.day??null,hour:boundary.hour??null}};
      },
      cancel(info={}){
        cancelled=true;records.length=0;journal.alerts.length=0;journal.saleIds.length=0;
        state.simulationKernel=state.simulationKernel||{};
        state.simulationKernel.lastAtomicCancel={reason:info.reason||'cancelled',from:simMeta.from,to:simMeta.to,at:state.simSeconds};
      }
    };
  }

  if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core compatibility check failed before app.js');
  if(!window.GH_SIMULATION_CORE?.create)throw new Error('Simulation Core failed to load before app.js');
  let lastRealtimeHealthMs=0;
  const REALTIME_HEALTH_MS=10000;
  const simulationEngine=window.GH_SIMULATION_CORE.create({
    getSpeed:()=>state.speed,
    setSpeed:(value,meta)=>{
      state.speed=SAFE_SPEED_VALUES.includes(Number(value))?Number(value):1;
      if(['watchdog','conflict-watchdog','governor-red'].includes(meta?.reason)){
        document.querySelectorAll('#speedMenu button[data-speed]').forEach(b=>b.classList.toggle('active',Number(b.dataset.speed)===1));
        if($('speedLabel'))$('speedLabel').textContent='×1';
        pushAlert(meta.reason==='conflict-watchdog'?'خفض محرك الحماية السرعة إلى ×1 بسبب تعارضات متكررة. لم يُنفذ أي Commit جزئي.':meta.reason==='governor-red'?'خفض حاكم الأداء السرعة إلى ×1 لأن متوسط معالجة الشرائح دخل المستوى RED. تم إسقاط backlog بدل مطاردته.':'خفض محرك الحماية السرعة إلى ×1 بسبب حمل معالجة مرتفع. لم تتم إعادة تشغيل زمن متراكم.');
      }
    },
    getSimTime:()=>state.simSeconds,
    setSimTime:value=>{state.simSeconds=value;},
    createSliceJob:createSimulationSliceJob,
    onMaintenance:hour=>{diag('SIM_MAINTENANCE',{hour});window.GH_CONTROL_PLANE?.appendEvent?.(state,{type:'SIMULATION_MAINTENANCE',domain:'simulation',actor:'simulation-core',correlationId:`SIM-HOUR-${hour}`,detail:{hour}});compactSimulationState(false);const health=window.GH_DIAGNOSTICS.runHealthCheck(state,{appVersion:APP_VERSION,saveSchemaVersion:SAVE_SCHEMA_VERSION,simulation:simulationEngine.snapshot()});const central=window.GH_CONTROL_PLANE?.check?.(state);if(health.status==='critical'||central?.status==='critical')state.speed=0;},
    onRender:({speed,jobActive})=>{
      updateMarkerPositions();updateKpis();updateMapStatus();if(selectedAssetId&&!$('assetCard').classList.contains('hidden'))refreshAssetCard(selectedAssetId);state.simulationKernel={...(state.simulationKernel||{}),...simulationEngine.snapshot(),coreVersion:window.GH_SIMULATION_CORE.VERSION,transactionVersion:window.GH_TRANSACTION_CORE.VERSION};
      // Diagnostics may use wall-clock cadence for UI health only. Executive AI business decisions
      // are simulation-time owned and execute only through the normal supervised authorization path.
      if(!jobActive&&!document.hidden&&!hardResetInProgress){
        const now=performance.now();
        if(now-lastRealtimeHealthMs>=REALTIME_HEALTH_MS){lastRealtimeHealthMs=now;try{const beforeEvents=state.diagnostics?.events?.length||0;window.GH_DIAGNOSTICS.runHealthCheck(state,{appVersion:APP_VERSION,saveSchemaVersion:SAVE_SCHEMA_VERSION,simulation:simulationEngine.snapshot()},{recordEvent:false,trackTransitions:true});const afterEvents=state.diagnostics?.events?.length||0;if(afterEvents!==beforeEvents)save();if(activeDrawerPanel==='diagnostics')openDrawer('diagnostics');}catch(error){console.warn('تعذر تحديث صحة النظام الدوري',error);}}
      }
    },
    onPersist:()=>{if(hardResetInProgress)return;const run=()=>{try{compactSimulationState(true);save();}catch(error){console.warn('تعذر حفظ المحاكاة',error);}};if(typeof window.requestIdleCallback==='function')window.requestIdleCallback(run,{timeout:1500});else setTimeout(run,0);},
    isSuspended:()=>hardResetInProgress,
    onFatal:error=>{state.speed=0;diag('SIM_FATAL',{message:String(error?.message||error)});console.error('Simulation Core fatal error',error);try{pushAlert('أوقف محرك المحاكاة الوقت لحماية الحفظ بعد خطأ داخلي.');}catch(alertError){console.error('تعذر تسجيل تنبيه خطأ المحاكاة',alertError);}},
    onWarning:({stage,error})=>{diag('SIM_WARNING',{stage,message:String(error?.message||error)});console.warn(`Simulation Core warning [${stage}]`,error);},
    onThrottle:({took,reason})=>{diag('SIM_THROTTLE',{took,reason});console.warn(`Simulation watchdog throttled after ${Math.round(took)}ms chunk`);},
    onGovernor:({level,avgChunkMs})=>{diag('SIM_GOVERNOR',{level,avgChunkMs});state.simulationKernel=state.simulationKernel||{};state.simulationKernel.governor=level;}
  });
  window.GH_SIM_KERNEL={version:window.GH_SIMULATION_CORE.VERSION,transactionVersion:window.GH_TRANSACTION_CORE.VERSION,snapshot:()=>simulationEngine.snapshot(),health:()=>simulationEngine.health()};
  window.GH_DIAGNOSTICS.installGlobalHandlers(()=>state,()=>({appVersion:APP_VERSION,simulation:simulationEngine.snapshot()}));
  window.GH_CONTROL_PLANE?.installDOMObserver?.(()=>state);
  diag('DIAGNOSTICS_READY',{version:window.GH_DIAGNOSTICS.VERSION});
  window.GH_CONTROL_PLANE?.appendEvent?.(state,{type:'RUNTIME_READY',domain:'control',detail:{appVersion:APP_VERSION,simulationCore:window.GH_SIMULATION_CORE.VERSION,transactionCore:window.GH_TRANSACTION_CORE.VERSION}});
  document.addEventListener('visibilitychange',()=>{diag(document.hidden?'WEBKIT_HIDDEN':'WEBKIT_VISIBLE');simulationEngine.setHidden(document.hidden);},{passive:true});
  let savePressureNoticeShown=false;
  window.addEventListener('gh-persistence-status',event=>{
    const detail=event.detail||{};
    if(detail.validated)window.GH_CONTROL_PLANE.recordBridge(state,detail.ok?'SAVE_ACK':'SAVE_NACK',detail,detail.ok?'info':'critical');
    if(detail.ok===false){state.speed=0;window.GH_CONTROL_PLANE.incident(state,{fingerprint:'NATIVE_SAVE_COMMIT_FAILED',severity:'critical',domain:'save',code:'NATIVE_SAVE_COMMIT_FAILED',title:'تعذر تثبيت الحفظ',detail:String(detail.reason||detail.message||'Native save rejected'),evidence:detail});}
    if(detail.warning){diag('SAVE_SIZE_PRESSURE',detail,'warning');if(!savePressureNoticeShown){savePressureNoticeShown=true;notice('اقترب الحفظ من حد السعة. يُنصح بتصدير نسخة احتياطية؛ سيوقف النظام أي كتابة تتجاوز الحد الآمن.');}}
  });
  window.addEventListener('gh-native-recovery',()=>{state.speed=0;diag('WEBKIT_PROCESS_RECOVERY',{source:'native-save-vault'});window.GH_CONTROL_PLANE?.recordBridge?.(state,'WEBKIT_RECOVERY',{source:'native-save-vault'},'warning');pushAlert('تم استرداد آخر حفظ Native مكتمل بعد إعادة تشغيل محرك WebKit. المحاكاة متوقفة مؤقتًا للمراجعة.');save();});
  window.addEventListener('gh-update-lifecycle',event=>{const detail=event.detail||{},phase=String(detail.phase||'LIFECYCLE'),severity=['BOOT_CONFIRM_FAILED','FAILED'].includes(phase)?'critical':['ROLLBACK_STARTED','ROLLED_BACK'].includes(phase)?'warning':'info';diag(`UPDATE_${phase}`,detail,severity);window.GH_CONTROL_PLANE?.recordBridge?.(state,`UPDATE_${phase}`,detail,severity);if(severity==='critical')window.GH_CONTROL_PLANE?.incident?.(state,{fingerprint:`UPDATE:${phase}`,severity:'critical',domain:'update',code:`UPDATE_${phase}`,title:'خلل في دورة التحديث',detail:String(detail.message||detail.reason||phase||'Update lifecycle failure'),evidence:detail});save();});


  function assetStatus(asset){
    if(asset.phase==='idle')return 'متوقف — بانتظار تعيين مسار';
    if(asset.phase==='turnaround')return asset.type==='air'?'دوران وتجهيز بالمطار':asset.type==='sea'?'مناولة بالميناء':'تحميل/راحة وتشغيل';
    return asset.type==='air'?'في الجو':asset.type==='sea'?'في البحر':'على الطريق';
  }
  function refreshAssetCard(id){
    const a=state.assets.find(x=>x.id===id); if(!a)return;
    normalizeAsset(a); const tpl=routeTemplates[a.routeId];
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
  function showAsset(id){ selectedAssetId=id; refreshAssetCard(id); $('assetCard').classList.remove('hidden'); closeMapPopovers(); }

  function findFacility(id){ return getDynamicFacilities().find(f=>f.id===id) || expansionSites.find(f=>f.id===id); }
  function shipsAtPort(f){ return state.assets.filter(a=>a.type==='sea' && ((a.phase==='turnaround'&&(a.to===f.city||a.from===f.city)) || (a.baseFacility===f.id && !a.routeId))).length; }
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
      <div class="metric-row two"><div><span>سفننا هنا الآن</span><b>${shipsAtPort(f)}</b></div><div><span>الرمز</span><b>${f.code}</b></div></div>
    </article>`;
  }
  function depotOperationalCard(f){return `<article class="list-item"><h3>مركز النقل البري</h3><p>المقر الإداري منفصل عن الـDepot. هنا تتم إدارة السائقين، المواقف، الصيانة، الوقود وتحضير الرحلات البرية.</p><div class="metric-row"><div><span>مواقف الشاحنات</span><b>${f.bays||'—'}</b></div><div><span>الصيانة</span><b>متاحة</b></div><div><span>السائقون</span><b>سوق عمل</b></div></div></article>`;}
  function globalBaseOperationalCard(f){return `<article class="list-item"><h3>ملف القاعدة العالمية</h3><div class="metric-row"><div><span>رمز المنشأة</span><b>${f.code||f.iata||'—'}</b></div><div><span>تشغيل يومي</span><b>${fmtMoney(f.dailyCost||0)}</b></div><div><span>الاستثمار</span><b>${fmtMoney(f.cost||0)}</b></div></div><p>يمكن اختيار هذه القاعدة عند شراء أصل جديد، كما تظهر كنقطة انطلاق/وصول عند إنشاء شبكة تشغيل متوافقة.</p></article>`;}

  let worldQuery='',worldKind='all',worldSearchTimer=null,globalRouteQuery='',globalRouteSearchTimer=null;
  const featuredAirportCodes=['OERK','OMDB','EGLL','WSSS','KJFK','KLAX','EDDF','LFPG','RJTT','VHHH','YSSY','SBGR','FAOR','VIDP','ZBAA','CYYZ','HECA','LTFM'];
  const featuredPortCodes=['SAJED','SGSIN','NLRTM','USNYC','CNSHA','CNSZX','DEHAM','BEANR','AEJEA','KRPUS','MYPKG','BRSSZ','ESVLC','GBFXT','JPTYO'];
  function worldSearchResults(){
    const q=normalizeSearch(worldQuery),results=[];
    if(!q){
      if(worldKind!=='port')featuredAirportCodes.forEach(code=>{const row=airportIndex.get(code);if(row)results.push(airportEntity(row));});
      if(worldKind!=='airport')featuredPortCodes.forEach(code=>{const row=WORLD.ports.find(x=>x[0]===code);if(row)results.push(portEntity(row));});
      return results.slice(0,36);
    }
    if(worldKind!=='port'){
      for(const row of WORLD.airports){const text=normalizeSearch(`${row[0]} ${row[1]} ${row[2]} ${row[3]} ${row[4]} ${row[5]}`);if(text.includes(q))results.push(airportEntity(row));if(results.length>=48)break;}
    }
    if(worldKind!=='airport'&&results.length<72){
      for(const row of WORLD.ports){const text=normalizeSearch(`${row[0]} ${row[1]} ${row[2]}`);if(text.includes(q))results.push(portEntity(row));if(results.length>=72)break;}
    }
    return results.sort((a,b)=>(Number(b.commercial||b.terminal)-Number(a.commercial||a.terminal))||a.name.localeCompare(b.name)).slice(0,60);
  }
  function globalBaseFor(key){return state.globalBases.find(base=>base.sourceKey===key);}
  const companyOfFacility=f=>window.GH_HR_CORE.companyOfFacility(f);
  function worldResultCard(entity){
    const opened=globalBaseFor(entity.key),cost=facilityPrice(entity),daily=facilityDailyCost(entity),company=entity.kind==='airport'?'air':'sea';
    const owned=getDynamicFacilities().filter(f=>f.owned&&companyOfFacility(f)===company&&Array.isArray(f.coords));
    const nearest=owned.map(f=>({f,d:haversine(f.coords,entity.coords)})).sort((a,b)=>a.d-b.d)[0];
    const linked=state.assets.filter(a=>a.type===company&&a.routeId).filter(a=>{const r=routeTemplates[a.routeId];return r&&(r.toFacility===opened?.id||r.fromFacility===opened?.id||r.to===entity.city||r.from===entity.city);}).length;
    const readiness=state.openedCompanies.includes(company)?(nearest?`أقرب قاعدة ${fmtNumber(nearest.d)} كم`:'الشركة مفتوحة بلا قاعدة قريبة'):`${typeName(company)} غير مفتوحة`;
    const detail=entity.kind==='airport'
      ? `${entity.iata?`${entity.iata} · `:''}${entity.icao} · ارتفاع ${fmtNumber(entity.elevationFt)} قدم`
      : `${entity.code} · ${entity.terminal?'محطة خطوط بحرية':'ميناء/مرسى مسجل'}`;
    return `<article class="list-item world-result"><div class="list-item-head"><div><h3>${entity.icon} ${esc(entity.name)}</h3><p>${esc(entity.city)} · ${esc(entity.country)} · ${esc(detail)}</p></div><span class="tag ${opened?'positive':''}">${opened?'قاعدة مفتوحة':entity.kind==='airport'?'مطار عام':'ميناء عام'}</span></div>
      <div class="metric-row"><div><span>فتح القاعدة</span><b>${fmtMoney(cost)}</b></div><div><span>تشغيل يومي</span><b>${fmtMoney(daily)}</b></div><div><span>ارتباطات تشغيلية</span><b>${linked}</b></div></div>
      <div class="world-readiness"><span>جاهزية الشبكة</span><b>${esc(readiness)}</b><small dir="ltr">${entity.coords[0].toFixed(3)}, ${entity.coords[1].toFixed(3)}</small></div>
      <p>يمكن تشغيل خط ${entity.kind==='airport'?'جوي':'بحري'} إليه مباشرة؛ فتح القاعدة اختياري ويضيف إدارة محلية، كادرًا وتكلفة تشغيلية مستقلة للشركة المختصة.</p>
      <div class="action-row"><button class="secondary-btn world-focus" data-key="${esc(entity.key)}">عرض على الخريطة</button><button class="primary-btn" data-open="routes">إدارة المسارات</button><button class="secondary-btn" data-open="companyFacilities" data-arg="${company}">${opened?'إدارة قاعدة الشركة':'إدارة قواعد الشركة'}</button></div></article>`;
  }
  function renderWorldNetwork(){
    const results=worldSearchResults();
    const openedBases=(state.globalBases||[]).length,publicEndpoints=Object.values(state.routeEndpoints||{}).filter(x=>x?.routeEndpoint).length;
    return `<div class="list"><article class="list-item registry-hero"><div class="list-item-head"><div><h3>الدليل العالمي للشبكة والتوسع</h3><p>دليل موحّد للمطارات والموانئ ونقاط التشغيل العامة. استخدمه لبناء مسارات مباشرة، فتح قواعد عالمية، ومقارنة الجاهزية الاستثمارية للمواقع الجديدة دون مغادرة مركز العمليات.</p></div><span class="tag positive">WORLD</span></div><div class="metric-row"><div><span>مطارات ومهابط</span><b>${fmtNumber(WORLD.meta.airportCount)}</b></div><div><span>موانئ ومحطات</span><b>${fmtNumber(WORLD.meta.portCount)}</b></div><div><span>قواعد المجموعة</span><b>${fmtNumber(openedBases)}</b></div><div><span>نقاط تسليم عامة</span><b>${fmtNumber(publicEndpoints)}</b></div></div></article>
      <div class="world-search"><input id="worldSearch" value="${esc(worldQuery)}" placeholder="ابحث بالاسم، المدينة، IATA، ICAO أو UN/LOCODE" autocomplete="off"><select id="worldKind"><option value="all" ${worldKind==='all'?'selected':''}>الكل</option><option value="airport" ${worldKind==='airport'?'selected':''}>المطارات</option><option value="port" ${worldKind==='port'?'selected':''}>الموانئ</option></select></div>
      <div class="world-company-strip"><button class="world-company-chip" data-open="companyManage" data-arg="air"><b>AIR</b><span>الطيران</span><small>${state.openedCompanies.includes('air')?`${state.assets.filter(a=>a.type==='air').length} أصل`:'غير مفتوحة'}</small></button><button class="world-company-chip" data-open="companyManage" data-arg="sea"><b>SEA</b><span>البحر</span><small>${state.openedCompanies.includes('sea')?`${state.assets.filter(a=>a.type==='sea').length} أصل`:'غير مفتوحة'}</small></button><button class="world-company-chip" data-open="companyManage" data-arg="road"><b>LOG</b><span>اللوجستيات</span><small>${state.openedCompanies.includes('road')?`${state.assets.filter(a=>a.type==='road').length} أصل`:'غير مفتوحة'}</small></button><button class="world-company-chip" data-open="companyManage" data-arg="mobility"><b>MOVE</b><span>التنقل الحضري</span><small>${state.openedCompanies.includes('mobility')?`${window.GH_MOBILITY_CORE?.snapshot?.(state)?.vehicles||0} سيارة`:'غير مفتوحة'}</small></button></div>
      <div class="action-row infrastructure-actions"><button class="primary-btn" data-open="companyFacilities" data-arg="road">قواعد ومراكز LOG</button><button class="secondary-btn" data-open="companyFacilities" data-arg="air">قواعد AIR</button><button class="secondary-btn" data-open="routes">مركز المسارات</button><button class="secondary-btn" data-open="ports">القواعد البحرية</button></div>
      <div class="section-mini">${worldQuery?`${results.length} نتيجة مطابقة`:'منشآت عالمية بارزة — اكتب للبحث في السجل الكامل. كل نتيجة تعرض تكلفة فتح القاعدة، التشغيل اليومي، وإمكانية التشغيل المباشر.'}</div>${results.map(worldResultCard).join('')||'<div class="empty">لا توجد نتيجة مطابقة. جرّب الرمز الدولي أو اسم المدينة بالإنجليزية.</div>'}</div>`;
  }
  function renderWorldNetworkInto(restoreFocus=false){
    $('drawerBody').innerHTML=renderWorldNetwork();bindDrawerActions();
    if(restoreFocus){const input=$('worldSearch');input?.focus();input?.setSelectionRange(input.value.length,input.value.length);}
  }
  function focusWorldEntity(key){
    const entity=worldEntityByKey(key);if(!entity||!map)return;selectedWorldKey=key;state.activeFilter=entity.kind==='airport'?'airport':'port';
    document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.activeFilter));map.setView(entity.coords,entity.kind==='airport'?8:9);renderMap();closeDrawer();
  }
  function showWorldEntity(key){
    const entity=worldEntityByKey(key);if(!entity)return;const opened=globalBaseFor(key),cost=facilityPrice(entity),daily=facilityDailyCost(entity);selectedWorldKey=key;
    const company=entity.kind==='airport'?'air':'sea';openDrawerContent('الدليل العالمي',entity.name,`<article class="list-item"><div class="list-item-head"><div><h3>${entity.icon} ${esc(entity.name)}</h3><p>${esc(entity.city)} · ${esc(entity.country)} · ${esc(entity.code)}</p></div><span class="tag ${opened?'positive':''}">${opened?'تابع للمجموعة':'منشأة عامة'}</span></div><p>${entity.kind==='airport'?'يمكن تشغيل خط جوي عام إلى هذا المطار دون شراء قاعدة فيه.':'يمكن تشغيل خط بحري عام إلى هذا الميناء دون شراء قاعدة فيه.'}</p><div class="metric-row"><div><span>فتح القاعدة</span><b>${fmtMoney(cost)}</b></div><div><span>تكلفة يومية</span><b>${fmtMoney(daily)}</b></div><div><span>النوع</span><b>${entity.kind==='airport'?'مطار':'ميناء'}</b></div></div><div class="metric-row two"><div><span>خط العرض</span><b>${entity.coords[0].toFixed(5)}</b></div><div><span>خط الطول</span><b>${entity.coords[1].toFixed(5)}</b></div></div><div class="action-row"><button class="secondary-btn world-focus" data-key="${esc(key)}">تركيز الخريطة</button><button class="primary-btn" data-open="routes">إدارة المسارات</button><button class="secondary-btn" data-open="companyFacilities" data-arg="${company}">${opened?'إدارة قاعدة الشركة':'إدارة قواعد الشركة'}</button></div></article>`);
  }
  function openGlobalBase(key,opts={}){
    return runBusinessOperation('openGlobalBase',()=>{
    const entity=worldEntityByKey(key);if(!entity){pushAlert('تعذر فتح القاعدة: الموقع غير معروف أو تغيّرت بياناته.');return false;}if(globalBaseFor(key)){pushAlert(`القاعدة في ${entity.name} مفتوحة بالفعل.`);return false;}const baseCost=facilityPrice(entity),dailyCost=facilityDailyCost(entity),company=entity.kind==='airport'?'air':'sea',facilityKind=entity.kind==='airport'?'airport-base':'port-base',build=awardConstruction(company,facilityKind,`قاعدة ${entity.name}`,baseCost);if(!build||build.insufficient){if(!opts.silent)notice(`رصيد حساب ${typeName(company)} غير كافٍ لعقد البناء.`);return false;}const safeCode=String(entity.code||nextId('BASE')).replace(/[^a-z0-9]/gi,'-'),id=`BASE-${entity.kind==='airport'?'AIR':'SEA'}-${safeCode}-${state.globalBases.length+1}`,facility={id,sourceKey:key,company,kind:facilityKind,owned:true,icon:entity.icon,photo:entity.kind==='airport'?PHOTOS.facility_airport:PHOTOS.facility_port,name:`قاعدة ${entity.name}`,city:entity.city,country:entity.country,coords:entity.coords,code:entity.code,iata:entity.iata,icao:entity.icao,elevationFt:entity.elevationFt,terminal:entity.terminal,cost:build.amount,dailyCost,capacity:entity.kind==='airport'?'تشغيل جوي وشحن':'تشغيل بحري ولوجستي',contractor:build.contractor,constructionContractId:build.id,detail:`قاعدة عالمية افتتحتها المجموعة في ${entity.name}.`};
    try{window.GH_DOMAIN_COMMANDS.dispatch({state},'facilities','create',{facility,bucket:'globalBases',groupValueAdd:build.amount*.76},{actor:'expansion'});ensureFacilityWorkforce(company,'فتح قاعدة جديدة');pushAlert(`افتتحت ${facility.name} بعقد ${build.id}، وربطت وجهة التسليم والـHR بالقاعدة نفسها.`);save();updateKpis();renderMap();if(!opts.silent)openFacility(id);return true;}catch(error){notice(`ألغي فتح القاعدة بالكامل: ${error.message}`);return false;}

    });
  }
  function openLogisticsHubAI(coords,opts={}){
    return runBusinessOperation('openLogisticsHubAI',()=>{
    const place=nearestPlace(coords),baseCost=8500000,dailyCost=12500,name=logisticsCenterName(place),build=awardConstruction('road','logistics',name,baseCost);if(!build||build.insufficient){pushAlert('لم يُفتح المركز اللوجستي؛ التمويل المتاح لا يغطي أفضل عرض بناء.');return false;}const id=nextId('HUB'),facility={id,company:'road',kind:'logistics',owned:true,icon:'🚚',photo:PHOTOS.facility_logistics,name,city:place.city,country:place.country,coords,bays:42,dailyCost,cost:build.amount,contractor:build.contractor,constructionContractId:build.id,detail:'مركز لوجستي أنشئ عبر المشتريات المعتمدة.',capacity:'140 شاحنة',manager:'مدير المركز اللوجستي',tasks:[{id:nextId('TASK'),title:'تجهيز أرصفة التحميل وتعيين فريق التشغيل الأول',status:'قيد التنفيذ',createdAt:state.simSeconds||0}]};
    try{window.GH_DOMAIN_COMMANDS.dispatch({state},'facilities','create',{facility,bucket:'customHubs',groupValueAdd:build.amount*.72},{actor:'expansion'});ensureFacilityWorkforce('road','فتح مركز لوجستي');pushAlert(`افتتح ${name} وربط بـHR والتشغيل.`);save();updateKpis();renderMap();if(!opts.silent)openFacility(id);return true;}catch(error){notice(`ألغي فتح المركز بالكامل: ${error.message}`);return false;}

    });
  }
  function mobilityCapital(id){return (window.GH_MOBILITY_CORE?.CAPITALS||[]).find(c=>c.id===String(id||''))||null;}
  function openMobilityCapitalCenter(capitalId,opts={}){
    return runBusinessOperation('openMobilityCapitalCenter',()=>{
      const capital=mobilityCapital(capitalId);
      if(!capital){if(!opts.silent)notice('اختر عاصمة معتمدة من سجل GH Mobility.');return false;}
      if(!state.openedCompanies.includes('mobility')){if(!opts.silent)notice('أسس GH Mobility أولًا قبل فتح مركز عاصمة.');return false;}
      const existing=getDynamicFacilities().find(f=>f.company==='mobility'&&f.kind==='mobility-center'&&f.capitalId===capital.id);
      if(existing){if(!opts.silent)openFacility(existing.id);return false;}
      const build=awardConstruction('mobility','mobility-center',`مركز GH Mobility · ${capital.city}`,4500000);
      if(!build||build.insufficient){if(!opts.silent)notice('رصيد حساب GH Mobility لا يغطي أفضل عرض إنشاء للمركز.');return false;}
      const id=`MOB-CENTER-${capital.id}`,facility={id,company:'mobility',kind:'mobility-center',owned:true,capitalOnly:true,capitalId:capital.id,icon:'●',photo:PHOTOS.facility_logistics,name:`مركز GH Mobility · ${capital.city}`,city:capital.city,country:capital.country,coords:[...capital.coords],bays:120,dailyCost:9800,cost:build.amount,capacity:'تشغيل حضري محلي · 120 سيارة',manager:'مدير مركز التنقل الحضري',contractor:build.contractor,constructionContractId:build.id,detail:`مركز تشغيلي في عاصمة ${capital.country}. لا يُسمح بإنشائه خارج العواصم المعتمدة.`,tasks:[{id:nextId('TASK'),title:'توزيع الأسطول الحضري وربط شركاء القيادة',status:'قيد التنفيذ',createdAt:state.simSeconds||0}]};
      try{
        window.GH_DOMAIN_COMMANDS.dispatch({state},'facilities','create',{facility,bucket:'customHubs',groupValueAdd:build.amount*.72},{actor:'mobility-facility'});
        window.GH_MOBILITY_CORE?.ensure?.(state);state.mobility.capitalCenters.unshift({id:facility.id,capitalId:capital.id,city:capital.city,country:capital.country,coords:[...capital.coords],facilityId:facility.id,openedAt:state.simSeconds||0});
        ensureFacilityWorkforce('mobility',`فتح مركز عاصمة ${capital.city}`);pushAlert(`افتتح ${facility.name} في العاصمة وربط بالحساب الجاري والموارد البشرية.`);save();updateKpis();renderMap();if(!opts.silent)openDrawer('companyFacilities',{type:'mobility'});return true;
      }catch(error){notice(`ألغي فتح مركز العاصمة بالكامل: ${error.message}`);return false;}
    });
  }
  function renderCompanyFacilities(type){
    const company=['air','sea','road','power','bank','mobility'].includes(type)?type:'group',owned=getDynamicFacilities().filter(f=>f?.owned&&companyOfFacility(f)===company),name=typeName(company),metricBox=items=>`<div class="metric-row">${items.map(x=>`<div><span>${x[0]}</span><b>${x[1]}</b></div>`).join('')}</div>`;
    if(company==='mobility'){
      const centers=new Map(owned.filter(f=>f.kind==='mobility-center').map(f=>[f.capitalId,f]));
      const capitalRows=(window.GH_MOBILITY_CORE?.CAPITALS||[]).map(cap=>{const center=centers.get(cap.id);return `<article class="facility-compact-row"><div><b>${esc(cap.city)}</b><small>${esc(cap.country)} · عاصمة معتمدة · ${center?esc(center.id):'غير مفتوحة'}</small></div>${center?`<button class="secondary-btn" data-open="facilityManage" data-arg="${esc(center.id)}">إدارة المركز</button>`:`<button class="primary-btn mobility-open-capital-center" data-capital="${esc(cap.id)}">فتح المركز</button>`}</article>`;}).join('');
      return `<div class="list"><article class="list-item registry-hero"><div class="list-item-head"><div><h3>قواعد ومراكز GH Mobility</h3><p>سجل مستقل للشركة الجديدة. المراكز تُفتح في العواصم فقط، وتبقى مشتريات السيارات والمسارات خارج هذا القسم.</p></div><span class="tag positive">CAPITALS ONLY</span></div>${metricBox([['المراكز المفتوحة',centers.size],['العواصم المتاحة',(window.GH_MOBILITY_CORE?.CAPITALS||[]).length],['سيارات الشركة',window.GH_MOBILITY_CORE?.snapshot?.(state)?.vehicles||0]])}</article><div class="section-mini">اختر عاصمة لفتح مركز تشغيل حضري</div>${capitalRows||'<div class="empty">سجل العواصم غير متاح.</div>'}</div>`;
    }
    const rows=owned.map(f=>`<article class="facility-compact-row"><div><b>${esc(f.name||facilityKind(f.kind))}</b><small>${esc(f.city||'—')} · ${esc(f.country||'—')} · ${esc(facilityKind(f.kind))}</small></div><button class="secondary-btn" data-open="facilityManage" data-arg="${esc(f.id)}">إدارة</button></article>`).join('');
    const action=company==='road'?'<button class="primary-btn place-logistics">إضافة مركز لوجستي</button>':(['air','sea'].includes(company)?'<button class="primary-btn" data-open="network">استعراض الدليل العالمي</button>':'');
    const worldCodes=company==='air'?featuredAirportCodes:company==='sea'?featuredPortCodes:[];
    const worldRows=worldCodes.slice(0,12).map(code=>{const row=company==='air'?airportIndex.get(code):WORLD.ports.find(x=>x[0]===code);if(!row)return '';const entity=company==='air'?airportEntity(row):portEntity(row),open=globalBaseFor(entity.key);return `<article class="facility-compact-row facility-global-option"><div><b>${esc(entity.name)}</b><small>${esc(entity.city)} · ${esc(entity.country)} · ${esc(entity.code)} · ${open?'قاعدة مفتوحة':'منشأة عامة'}</small></div>${open?`<button class="secondary-btn" data-open="facilityManage" data-arg="${esc(open.id)}">إدارة</button>`:`<button class="secondary-btn open-global-base" data-key="${esc(entity.key)}">فتح قاعدة</button>`}</article>`;}).join('');
    const worldSection=['air','sea'].includes(company)?`<div class="section-mini">مواقع عالمية مرشحة لقاعدة ${company==='air'?'جوية':'بحرية'} — الإنشاء هنا فقط</div>${worldRows||'<div class="empty">تعذر تحميل سجل الوجهات.</div>'}`:'';
    return `<div class="list"><article class="list-item registry-hero"><div class="list-item-head"><div><h3>قواعد ومراكز ${esc(name)}</h3><p>عرض مختصر لمنشآت هذه الشركة فقط. الإنشاء والميزانية والموظفون مرتبطون بحسابها ولا تختلط بأقسام الشركات الأخرى.</p></div><span class="tag positive">SEPARATE REGISTER</span></div>${metricBox([['المنشآت المملوكة',owned.length],['التشغيل اليومي',fmtMoney(owned.reduce((n,f)=>n+(Number(f.dailyCost)||0),0))],['القطاع',esc(name)]])}<div class="action-row">${action}</div></article>${rows||'<div class="empty">لا توجد قواعد أو مراكز مملوكة بعد.</div>'}${worldSection}</div>`;
  }
  function globalRouteResults(type){
    const kind=type==='air'?'airport':'port',query=normalizeSearch(globalRouteQuery),results=[];
    if(!query){
      const codes=kind==='airport'?featuredAirportCodes:featuredPortCodes;
      codes.forEach(code=>{
        const row=kind==='airport'?airportIndex.get(code):WORLD.ports.find(item=>item[0]===code);
        if(row)results.push(kind==='airport'?airportEntity(row):portEntity(row));
      });
      return results.slice(0,24);
    }
    const rows=kind==='airport'?WORLD.airports:WORLD.ports;
    for(const row of rows){
      const text=kind==='airport'?`${row[0]} ${row[1]} ${row[2]} ${row[3]} ${row[4]} ${row[5]}`:`${row[0]} ${row[1]} ${row[2]}`;
      if(normalizeSearch(text).includes(query))results.push(kind==='airport'?airportEntity(row):portEntity(row));
      if(results.length>=48)break;
    }
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
    $('drawerBody').innerHTML=renderGlobalRoute({assetId});bindDrawerActions();
    if(restoreFocus){const input=$('globalRouteSearch');input?.focus();input?.setSelectionRange(input.value.length,input.value.length);}
  }

  const panelMeta={
    leadershipHub:['القيادة التنفيذية','مركز القيادة والقرار'],companies:['المجموعة والشركات','الشركات التابعة'],control:['التشغيل والأصول','مركز التشغيل والشبكة'],governanceHub:['الحوكمة والمخاطر','مركز الرقابة والامتثال'],systemHub:['النظام والسلامة','الصحة والصيانة'],network:['التشغيل والأصول','الدليل العالمي'],routes:['التشغيل والأصول','مركز المسارات المستقل'],globalRoute:['التشغيل والأصول','مسار عالمي مباشر'],companyFacilities:['التشغيل والأصول','قواعد ومراكز الشركة'],market:['المالية والخزينة','الأسواق والمحفظة'],more:['النظام والسلامة','الصحة والصيانة'],contracts:['التشغيل والأصول','العقود والعملاء'],ma:['القيادة التنفيذية','الاستحواذات والاستثمارات'],labor:['الموارد البشرية','الطواقم والتنظيم'],assets:['التشغيل والأصول','الأساطيل والأصول'],expansion:['التشغيل والأصول','القواعد والمراكز'],finance:['المالية والخزينة','المركز المالي'],invoices:['المالية والخزينة','المستندات والذمم'],news:['القيادة التنفيذية','غرفة الأحداث'],settings:['النظام والسلامة','الحفظ والإعدادات'],diagnostics:['النظام والسلامة','مركز التشخيص'],competitors:['القيادة التنفيذية','المنافسة'],energy:['المجموعة والشركات','مركز إنتاج الطاقة'],bank:['المالية والخزينة','بنك المجموعة'],governance:['الحوكمة والمخاطر','مجلس الإدارة'],insurance:['الحوكمة والمخاطر','التأمين وإدارة المخاطر'],research:['القيادة التنفيذية','البحث والتطوير'],esg:['القيادة التنفيذية','الاستدامة'],career:['القيادة التنفيذية','نضج المجموعة']
  };

  const panelRoot = panel => window.GH_ADVANCED?.root(panel) || ({
    leadershipHub:'leadership',intelligence:'leadership',aiApprovals:'leadership',programs:'leadership',realism:'leadership',ma:'leadership',research:'leadership',esg:'leadership',career:'leadership',news:'leadership',competitors:'leadership',
    companies:'companies',companyManage:'companies',energy:'companies',
    control:'control',network:'control',routes:'control',globalRoute:'control',companyFacilities:'companies',contracts:'control',labor:'control',expansion:'control',ports:'control',procurement:'control',assets:'control',assetManage:'control',assignRoute:'control',facilityManage:'control',
    market:'finance',finance:'finance',invoices:'finance',treasury:'finance',bank:'finance',
    governanceHub:'governance',governance:'governance',audit:'governance',legal:'governance',insurance:'governance',cyber:'governance',safety:'governance',
    systemHub:'system',settings:'system',updates:'system',diagnostics:'system',controlPlane:'system',more:'system'
  })[panel] || 'map';
  function setActiveNav(key){
    document.querySelectorAll('.side-nav button').forEach(b=>b.classList.toggle('active',(b.dataset.nav||'')===key));
    document.querySelectorAll('.bottom-nav button').forEach(b=>{
      const candidate=b.hasAttribute('data-mobile-map')?'map':panelRoot(b.dataset.panel);
      b.classList.toggle('active',candidate===key);
    });
  }
  function drawerUsesBackdrop(){ return window.matchMedia('(max-width:760px) and (orientation:portrait)').matches; }

  async function hardResetGame(){
    if(hardResetInProgress)return false;
    const previousState=clone(state);hardResetInProgress=true;state.speed=0;
    try{
      const cleanupKeys=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith('global-holdings-'))cleanupKeys.push(k);}
      await window.GH_GAME_LIFECYCLE.reset(state,defaultState,{storageKey,resetMarkerKey,appVersion:APP_VERSION,checkpoint:previousState,cleanupKeys,prepare:next=>{
        window.GH_ADVANCED.migrate(next);window.GH_REALISM.migrate(next);window.GH_EVENT_LEDGER.ensure(next);window.GH_DEPENDENCY_CORE.ensure(next);window.GH_DEMAND_CLOSURE.ensure(next);window.GH_FINANCE_CORE.ensure(next);window.GH_DIAGNOSTICS.ensure(next);window.GH_CONTROL_PLANE.bootstrap(next);next.advanced.saveSlots=[null,null,null];
      }});
      selectedAssetId=null;placingHub=false;resetHubPlacementGesture();
      Object.keys(routeTemplates).forEach(id=>{if(!BASE_ROUTE_IDS.has(id))delete routeTemplates[id];});
      closeDrawer();closeGod();closeMapPopovers();$('assetCard')?.classList.add('hidden');
      const founder=$('founderFlow');founder.classList.remove('hidden');founder.removeAttribute('aria-hidden');founder.style.setProperty('display','grid','important');founder.scrollTop=0;
      const shell=$('app');shell.setAttribute('aria-hidden','true');shell.style.pointerEvents='none';
      updateFounderLogoPreview();simulationEngine.reset(performance.now(),'new-group');updateKpis();renderMap();updateMapStatus();return true;
    }catch(error){
      window.GH_TRANSACTION_CORE.restoreObject(state,previousState);
      if(error.critical){state.speed=0;window.GH_CONTROL_PLANE.incident(state,{fingerprint:'RESET_COMPENSATION_FAILED',code:'RESET_COMPENSATION_FAILED',severity:'critical',domain:'save',title:'فشل استرداد الحفظ',detail:String(error.compensationError||error.rollbackError)});}
      notice(error.critical?'تعذر تأكيد استرداد الحفظ. أوقفت المحاكاة لحماية التقدم؛ صدّر تقرير الدعم.':'تعذر إكمال إعادة اللعبة؛ تم الاحتفاظ بالحالة السابقة.');return false;
    }finally{hardResetInProgress=false;}
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

  function advancedContext(){
    return {state,fmtMoney,fmtNumber,formatDuration,esc,typeName,facilityKind,findFacility,competitors,assetCatalog,WORLD,storageKey,
    candidates,getDynamicFacilities,strategicPartners,supplierFor,awardConstruction,payNamedSupplier,canSpend,spend,canCompanySpend,spendCompany,companyOperatingBalance,companyTotalBalance,companyBudget,companyBudgetRemaining,transferBetweenCompanies,bulkTransferFromGroup,transferWithinCompany,creditCompany,pushAlert,save,updateKpis,renderMap,openDrawer,buyAsset,issueCheque,suggestRoutesOnly,routeRuntimeSnapshot:()=>clone(routeTemplates),restoreRouteRuntime:snapshot=>{for(const key of Object.keys(routeTemplates))delete routeTemplates[key];Object.assign(routeTemplates,clone(snapshot||{}));},rankRoutesForAsset,assignRoute,ensureCrewForFleet,ensureFacilityWorkforce,ensureCompanyWorkforce,ensureExecutiveWorkforce,ensureAllWorkforce,workforceNeedSnapshot,requiredCrewForFleet,ensureBankCorporateClients,bankLiquidityMetrics,bankReviewCorporateLimits,bankDrawCorporateFacility,bankIssueTradeInstrument,bankCashSweep,hardResetGame,worldEntityByKey,openGlobalBase,openLogisticsHubAI,buildEnergy,openBankBranch,openBranch,expansionSites:expansionSites.map(x=>({...x})),roadHubCandidates:LOCAL_PLACE_AREAS.map(p=>({...p})),appVersion:APP_VERSION,saveSchemaVersion:SAVE_SCHEMA_VERSION,runDiagnostics:runFullDiagnostics,exportDiagnostics:exportDiagnosticsFile,exportControlPlane:exportControlPlaneFile,controlPlane:()=>window.GH_CONTROL_PLANE?.ensure?.(state),controlHealth:()=>window.GH_CONTROL_PLANE?.check?.(state),controlTrace:id=>window.GH_CONTROL_PLANE?.trace?.(state,id),clearDiagnostics:()=>window.GH_DIAGNOSTICS.clear(state),diagnostics:()=>state.diagnostics,businessIntegrity:()=>window.GH_INTEGRITY_CORE.check(state),businessLedger:()=>window.GH_EVENT_LEDGER.summary(state),demandClosure:()=>window.GH_DEMAND_CLOSURE.reconcile(state),dependencyGraph:()=>state.dependencyGraph,currentPanel:activeDrawerPanel,currentArg:activeDrawerArg};
  }

  // Native imports arrive after iOS has already validated and atomically
  // installed the WebApp files. Apply their simulation settings exactly once
  // through the same code path used by the in-game update center.
  window.GH_RUNTIME={
    businessIntegrity:()=>window.GH_INTEGRITY_CORE?.check?.(state),
    exportDiagnostics:()=>window.GH_DIAGNOSTICS.exportBundle(state,{appVersion:APP_VERSION,saveSchemaVersion:SAVE_SCHEMA_VERSION,simulation:simulationEngine.snapshot()}),
    applyNativeUpdate:async payload=>{
      if(!window.GH_ADVANCED?.applyNativeUpdate)return false;
      return window.GH_ADVANCED.applyNativeUpdate(payload,advancedContext());
    }
  };

  const drawerScrollMemory={};
  function openDrawer(panel, arg){
    const previousPanel=activeDrawerPanel,previousScroll=$('drawerBody').scrollTop;
    if(previousPanel)drawerScrollMemory[previousPanel]=previousScroll;
    activeDrawerPanel=panel;activeDrawerArg=arg;
    const [eyebrow,title]=window.GH_ADVANCED?.meta(panel)||panelMeta[panel]||['الإدارة','لوحة'];
    $('drawerEyebrow').textContent=eyebrow; $('drawerTitle').textContent=title; $('drawerBody').innerHTML=renderPanel(panel,arg); bindDrawerActions();
    $('drawerBody').scrollTop=previousPanel===panel?previousScroll:(drawerScrollMemory[panel]||0);
    if(drawerUsesBackdrop()) $('backdrop').classList.remove('hidden'); else $('backdrop').classList.add('hidden');
    $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden','false'); setActiveNav(panelRoot(panel));
    closeMapPopovers(); $('assetCard').classList.add('hidden');
    setTimeout(()=>{ if(map)map.invalidateSize(); },260);
  }
  function openDrawerContent(eyebrow,title,html){
    if(activeDrawerPanel)drawerScrollMemory[activeDrawerPanel]=$('drawerBody').scrollTop;
    activeDrawerPanel='content';activeDrawerArg=null;
    $('drawerEyebrow').textContent=eyebrow; $('drawerTitle').textContent=title; $('drawerBody').innerHTML=`<div class="list">${html}</div>`; bindDrawerActions();
    $('drawerBody').scrollTop=drawerScrollMemory.content||0;
    if(drawerUsesBackdrop()) $('backdrop').classList.remove('hidden'); else $('backdrop').classList.add('hidden');
    $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden','false'); closeMapPopovers(); setActiveNav('map');
    setTimeout(()=>{ if(map)map.invalidateSize(); },260);
  }
  function closeDrawer(){ $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden','true'); $('backdrop').classList.add('hidden'); setActiveNav('map'); setTimeout(()=>{if(map)map.invalidateSize();},260); }
  const ADVANCED_OWNED_PANELS=new Set(['realism','companies','leadershipHub','workspaceHub','peopleHub','actionCenter','governanceHub','systemHub','more','intelligence','aiApprovals','programs','facilityManage','companyManage','treasury','audit','legal','procurement','cyber','safety','energy','bank','governance','insurance','research','esg','career','news','labor','ma','settings','updates','diagnostics','controlPlane']);
  function renderPanel(panel,arg){
    const advanced=window.GH_ADVANCED?.render(panel,arg,advancedContext());
    if(advanced!==null&&advanced!==undefined)return advanced;
    // Advanced-owned panels deliberately fail closed. Keeping a second renderer here caused
    // stale UI/logic to survive upgrades and made two implementations compete for ownership.
    if(ADVANCED_OWNED_PANELS.has(panel))return '<div class="empty">تعذر تحميل مكوّن الإدارة لهذا القسم. أعد فتح اللعبة بدل تشغيل واجهة قديمة احتياطية.</div>';
    if(panel==='control')return renderControl(); if(panel==='market')return renderMarket();
    if(panel==='contracts')return renderContracts(); if(panel==='assets'||panel==='assetMarket')return renderAssetMarket(arg);
    if(panel==='expansion')return renderExpansion(); if(panel==='companyFacilities')return renderCompanyFacilities(typeof arg==='object'?arg.type:arg); if(panel==='finance')return renderFinance(); if(panel==='invoices')return renderInvoices(arg);
    if(panel==='competitors')return renderCompetitors(); if(panel==='assetManage')return renderAssetManage(arg); if(panel==='assignRoute')return renderAssignRoute(arg); if(panel==='ports')return renderPorts();
    if(panel==='network')return renderWorldNetwork(); if(panel==='routes')return renderRouteCenter(); if(panel==='globalRoute')return renderGlobalRoute(arg);
    return '<div class="empty">القسم غير متاح.</div>';
  }

  // ---- لوحة المجموعة: نظرة قابضة + بطاقات شركات بمؤشرات قطاعية حقيقية (أسلوب صورة المرجع) ----
  function sectorStats(type){
    const assets=state.assets.filter(a=>a.type===type);
    const routesActive=new Set(assets.filter(a=>a.routeId).map(a=>a.routeId)).size;
    const capacityTotal=assets.reduce((s,a)=>s+((a.specs&&a.specs.capacity)||0),0);
    const avgCondition=assets.length?assets.reduce((s,a)=>s+a.condition,0)/assets.length:100;
    return {fleetCount:assets.length, routesActive, capacityTotal, avgCondition, dailyProfit:state.sectorProfitToday[type]||0};
  }

  function renderControl(){
    const card=(panel,code,title,copy)=>`<button class="command-btn" data-open="${panel}"><span>${code}</span><div><b>${title}</b><small>${copy}</small></div></button>`;
    const activeDeliveries=(state.realism?.procurement?.deliveries||[]).filter(d=>d.status!=='delivered').length;
    const openAssetRequests=(state.realism?.procurement?.deliveries||[]).filter(d=>d.status!=='delivered').length;
    return `<div class="workspace-intro operations-intro"><span>OPERATIONS DOMAIN · 2.6</span><b>من الطلب إلى الحركة الفعلية: شبكة → منشأة → أصل → جاهزية → مسار → عقد → تنفيذ. HR والمال والحوكمة تبقى مجالات مستقلة.</b></div>
      <div class="metric-row"><div><span>الأصول</span><b>${state.assets.length}</b></div><div><span>قيد الوصول</span><b>${openAssetRequests}</b></div><div><span>توريدات جارية</span><b>${activeDeliveries}</b></div></div>
      <div class="section-heading"><h3>الشبكة والبنية التحتية</h3><p>حدد أين تعمل المجموعة قبل إضافة القدرة.</p></div><div class="command-grid grouped workspace-card-grid">${card('network','WORLD','الدليل العالمي',`${fmtNumber(WORLD.meta.airportCount)} مطار · ${fmtNumber(WORLD.meta.portCount)} ميناء`)}${card('expansion','HUB','القواعد والمراكز','افتتاح · سعة · إدارة · جاهزية')}${card('globalRoute','NET','الشبكة الجوية والبحرية','وجهات · مدى · تشغيل عالمي')}${card('routes','ROAD','الشبكة البرية','طرق · نقاط تسليم · هامش')}</div>
      <div class="section-heading"><h3>القدرة والأصول</h3><p>الشراء يدوي بالكامل: اختر الأصل والكمية والقاعدة ثم راقب التسليم. AI يقترح فقط.</p></div><div class="command-grid grouped workspace-card-grid">${card('procurement','BUY','الشراء اليدوي','اختيار أصل · كمية · قاعدة · تسليم')}${card('assets','FLT','إدارة الأساطيل','ملكية · حالة · صيانة · تعيين · بيع')}</div>
      <div class="section-heading"><h3>التجارة والتنفيذ</h3><p>حول القدرة المتاحة إلى التزام تجاري وتشغيل قابل للقياس.</p></div><div class="command-grid grouped workspace-card-grid">${card('contracts','COM','العقود والعملاء','مناقصات · SLA · تنفيذ · فوترة')}</div>
      <article class="list-item domain-crosslink"><div><b>تحتاج موظفين أو طواقم؟</b><small>إدارة HR مستقلة عن التشغيل حتى لا يصبح التوظيف أثرًا جانبيًا لشراء أصل.</small></div><button class="secondary-btn" data-open="peopleHub">فتح HR والأفراد</button></article>`;
  }


  function renderContracts(){
    const available=contracts.filter(c=>!state.acceptedContracts.includes(c.id));
    const accepted=contracts.filter(c=>state.acceptedContracts.includes(c.id));
    const awaiting=available.filter(c=>state.contractRegistry[c.id]?.status==='بانتظار التوقيع');
    const open=available.filter(c=>!state.contractRegistry[c.id]);
    const construction=state.constructionContracts||[],tenders=state.commercialTenders||[];const activeValue=accepted.reduce((n,c)=>n+c.value,0);
    return `<div class="list"><article class="list-item"><div class="list-item-head"><div><h3>مركز العقود الكبرى والمناقصات</h3><p>عقود عملاء · مناقصات حكومية · PPA · عقود بناء وموردين، مع تتبع الترسية والسداد.</p></div><span class="tag positive">COMMERCIAL</span></div><div class="metric-row"><div><span>قيمة العقود النشطة</span><b>${fmtMoney(activeValue)}</b></div><div><span>عقود نشطة</span><b>${accepted.length}</b></div><div><span>عقود إنشاء</span><b>${construction.length}</b></div></div></article>${construction.length?`<div class="section-mini">عقود الإنشاء والترسية</div>${construction.slice(0,20).map(x=>`<article class="list-item"><div class="list-item-head"><div><h3>${esc(x.siteName)}</h3><p>المقاول: ${esc(x.contractor)} · ${esc(x.paymentRef||'')}</p></div><span class="tag positive">${esc(x.status)}</span></div><div class="metric-row"><div><span>قيمة الترسية</span><b>${fmtMoney(x.amount)}</b></div><div><span>درجة AI</span><b>${x.awardScore}/100</b></div><div><span>طريقة السداد</span><b>${esc(x.method)}</b></div></div><p>المنافسون: ${(x.bids||[]).map(b=>`${esc(b.supplier)} (${fmtMoney(b.quote)})`).join(' · ')}</p></article>`).join('')}`:''}${awaiting.length?`<div class="section-mini">عروض فائزة بانتظار التوقيع</div>${awaiting.map(c=>`<article class="list-item sector-${c.sector}"><div class="list-item-head"><div><h3>${c.name}</h3><p>${c.client} · عقد جاهز للتوقيع الإلكتروني.</p></div><span class="tag positive">بانتظار التوقيع</span></div><div class="metric-row two"><div><span>دفعة مقدمة</span><b>${fmtMoney(c.value*.1)}</b></div><div><span>رقم العقد</span><b>${state.contractRegistry[c.id].number}</b></div></div><div class="action-row"><button class="primary-btn sign-contract" data-id="${c.id}">توقيع واعتماد العقد</button></div></article>`).join('')}`:''}<div class="section-mini">مناقصات متاحة</div>${open.map(c=>{
      const margin=c.value-c.cost;
      return `<article class="list-item sector-${c.sector}"><div class="list-item-head"><div><h3>${c.name}</h3><p>${c.client} · ${typeName(c.sector)}</p></div><span class="tag">${c.termMonths} شهر</span></div><div class="metric-row"><div><span>قيمة العقد</span><b>${fmtMoney(c.value)}</b></div><div><span>هامش كامل</span><b>${fmtMoney(margin)}</b></div><div><span>SLA</span><b>${c.sla}</b></div></div><p>القدرة المطلوبة: ${c.capacity}<br>المخاطر التعاقدية: ${c.penalty}</p><div class="action-row"><button class="primary-btn bid-contract" data-id="${c.id}" data-mode="balanced">تقديم عرض متوازن</button><button class="secondary-btn inspect-contract" data-id="${c.id}">تفاصيل العقد</button><button class="secondary-btn" data-ai-prompt="حلل مناقصة ${esc(c.name)} بقيمة ${fmtMoney(c.value)} وهامش ${fmtMoney(margin)} وSLA ${esc(c.sla)}">تحليل GH AI</button></div></article>`;
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
  let marketFilterType='air', marketFilterTab='new',marketSegment='all',marketQuery='',marketCompare=[];
  function compatibleBases(type){
    return getDynamicFacilities().filter(f=>f.owned && (type==='air'?['airport-base'].includes(f.kind)&&f.company==='air':type==='sea'?['port-base'].includes(f.kind)&&f.company==='sea':['depot','logistics'].includes(f.kind)&&f.company==='road'));
  }
  function assetComparePanel(items){
    if(!marketCompare.length)return '';
    const selected=marketCompare.map(id=>items.find(x=>x.id===id)||catalogItem(marketFilterType,id)).filter(Boolean);
    return `<article class="list-item comparison"><div class="list-item-head"><div><h3>المقارنة المباشرة</h3><p>حتى ثلاثة أصول ضمن القطاع الحالي.</p></div><span class="tag">${selected.length}/3</span></div><div class="compare-grid">${selected.map(a=>`<div><b>${esc(a.name)}</b><span>${fmtMoney(a.price)}</span><span>${a.specs.rangeKm?`${fmtNumber(a.specs.rangeKm)} كم`:`${fmtNumber(a.specs.rangeNm)} NM`}</span><span>${fmtNumber(a.specs.capacity)} ${a.specs.capacityUnit}</span><button class="compare-asset active" data-id="${a.id}">إزالة</button></div>`).join('')}</div></article>`;
  }
  function renderAssetMarketBody(activeType,activeTab){
    const typeTabs = `<div class="tabs small"><button class="tab-btn ${activeType==='air'?'active':''}" data-markettype="air">AIR · الطائرات</button><button class="tab-btn ${activeType==='sea'?'active':''}" data-markettype="sea">SEA · السفن</button><button class="tab-btn ${activeType==='road'?'active':''}" data-markettype="road">ROAD · الشاحنات</button></div>`;
    const condTabs = `<div class="tabs"><button class="tab-btn ${activeTab==='new'?'active':''}" data-markettab="new">أصل جديد</button><button class="tab-btn ${activeTab==='used'?'active':''}" data-markettab="used">سوق مستعمل</button></div>`;
    const source = (assetCatalog[activeType]||{})[activeTab]||[];
    const segments=[...new Set(source.map(x=>x.segment))];
    const filterBar=`<div class="asset-filters"><input id="assetSearch" value="${esc(marketQuery)}" placeholder="بحث في الطراز أو الفئة"><select id="assetSegment"><option value="all">كل الفئات</option>${segments.map(s=>`<option value="${esc(s)}" ${marketSegment===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div>`;
    const q=normalizeSearch(marketQuery);const items=source.filter(a=>(marketSegment==='all'||a.segment===marketSegment)&&(!q||normalizeSearch(`${a.name} ${a.segment} ${a.description}`).includes(q)));
    const bases=compatibleBases(activeType),hasDeliveryBase=bases.length>0;
    const list = items.map(a=>`<article class="list-item sector-${activeType} asset-market-card"><div class="asset-thumb"><img src="${a.photo}" alt="${esc(a.name)}" loading="lazy"><span class="thumb-tag">${activeTab==='new'?'جديد':`مستعمل ${a.condition}%`}</span></div><div class="list-item-head"><div><h3>${a.icon} ${esc(a.name)}</h3><p>${esc(a.segment)} · ${esc(a.description)}</p></div><span class="tag">★ ${a.rating}</span></div><div class="spec-grid">${specRow(a)}</div>
      <div class="ownership-grid"><div><span>التسليم</span><b>${a.delivery}</b></div><div><span>الضمان</span><b>${a.warranty}</b></div><div><span>قيمة بعد 5 سنوات</span><b>${a.residual5y}%</b></div><div><span>الانبعاثات</span><b>${a.specs.co2Band}</b></div></div>
      <div class="asset-price">${a.priceOriginal?`<s>${fmtMoney(a.priceOriginal)}</s> `:''}<b>${fmtMoney(a.price)}</b><small>تأجير ${fmtMoney(a.leaseMonthly)}/شهر · دفعة تمويل ${Math.round(a.downPayment*100)}%</small></div>
      <div class="asset-request-routing"><div><span>شراء يدوي مباشر</span><b>أنت تختار الأصل والعدد والقاعدة وطريقة التملك</b><small>${hasDeliveryBase?'لا توجد دراسة أو موافقة AI ولا إنشاء تلقائي لمسار أو طاقم.':'افتح منشأة تسليم متوافقة أولًا؛ لن يسمح النظام بشراء أصل بلا وجهة وصول صحيحة.'}</small></div>${hasDeliveryBase?`<div class="route-builder manual-asset-purchase"><label>قاعدة التسليم<select class="manual-asset-base">${bases.map(f=>`<option value="${esc(f.id)}">${esc(f.name)} · ${esc(f.city)}</option>`).join('')}</select></label><label>العدد<input class="manual-asset-qty" type="number" min="1" max="50" value="1"></label><label>التملك<select class="manual-asset-mode"><option value="cash">شراء نقدي</option><option value="finance">تمويل</option><option value="lease">تأجير تشغيلي</option></select></label></div>`:''}<div class="action-row"><button class="primary-btn manual-buy-asset" data-type="${activeType}" data-tab="${activeTab}" data-id="${a.id}" ${hasDeliveryBase?'':'disabled'}>شراء يدوي</button><button class="secondary-btn compare-asset ${marketCompare.includes(a.id)?'active':''}" data-id="${a.id}">${marketCompare.includes(a.id)?'إزالة من المقارنة':'قارن'}</button></div></div></article>`).join('');
    const ownedCount=state.assets.filter(a=>a.type===activeType).length,pendingSale=state.assets.filter(a=>a.type===activeType&&a.salePending).length;
    const fleetSale=`<article class="list-item fleet-sale-bar"><div><b>إدارة أصول ${typeName(activeType)}</b><small>${ownedCount} أصل مملوك · ${pendingSale} أمر بيع قيد العودة</small></div><button class="danger-soft sell-all-assets" data-type="${activeType}" ${ownedCount?'':'disabled'}>بيع جميع أصول القطاع</button></article>`;
    return `${typeTabs}${condTabs}${filterBar}${fleetSale}<div class="section-mini">الشراء يدوي بالكامل. بعد الوصول عيّن المسار والطاقم يدويًا، ثم استخدم زر تحريك جميع الأصول الجاهزة.</div>${assetComparePanel(source)}${list||'<div class="empty">لا توجد أصول متاحة بهذا الفلتر.</div>'}`;
  }
  function renderAssetMarket(arg){
    if(typeof arg==='string' && assetCatalog[arg]) marketFilterType=arg;
    return `<div class="list">${renderAssetMarketBody(marketFilterType,marketFilterTab)}</div>`;
  }

  // ---- الموانئ: سعة تخزين حقيقية لكل صنف بضاعة (أسلوب صور المرجع) ----
  function renderPorts(){
    const corePorts=facilities.filter(f=>f.kind==='port');
    const openedPorts=state.globalBases.filter(f=>f.kind==='port-base').map(f=>({...f,photo:PHOTOS.port_jed,dryStorageTEU:f.terminal?18000:6500,reeferPlugs:f.terminal?1500:420,crudeStorageBbl:f.terminal?900000:180000,fuelBunkerBbl:f.terminal?420000:95000,berths:f.terminal?12:5,maxDraftM:f.terminal?18.5:12.5,craneCount:f.terminal?28:8}));
    const ports=[...corePorts,...openedPorts];
    return `<div class="list"><article class="list-item registry-hero"><div class="list-item-head"><div><h3>شبكة الموانئ التابعة</h3><p>تظهر هنا الموانئ الأساسية وكل قاعدة بحرية تفتحها من الدليل العالمي.</p></div><span class="tag positive">${ports.length} منشأة</span></div><div class="action-row"><button class="primary-btn" data-open="network">فتح الدليل العالمي</button></div></article>${ports.map(f=>`<article class="list-item sector-sea"><div class="card-photo-row"><div class="thumb-sm"><img src="${f.photo}" alt="${esc(f.name)}" loading="lazy"></div><div class="card-photo-body"><div class="list-item-head"><div><h3>⚓ ${esc(f.name)}</h3><p>${esc(f.city)} · ${esc(f.code||'قاعدة بحرية')}</p></div><span class="tag">${shipsAtPort(f)} سفينة</span></div></div></div>
      <table class="port-table"><tbody>
        <tr><td>🟨 تخزين جاف</td><td>${fmtNumber(f.dryStorageTEU)} TEU</td></tr>
        <tr><td>🟥 منافذ تبريد</td><td>${fmtNumber(f.reeferPlugs)} Reefer</td></tr>
        <tr><td>🟩 خزين نفط خام</td><td>${fmtNumber(f.crudeStorageBbl)} برميل</td></tr>
        <tr><td>🔵 وقود تزويد</td><td>${fmtNumber(f.fuelBunkerBbl)} برميل</td></tr>
      </tbody></table>
      <div class="metric-row"><div><span>الأرصفة</span><b>${f.berths}</b></div><div><span>الغاطس</span><b>${f.maxDraftM} م</b></div><div><span>الرافعات</span><b>${f.craneCount}</b></div></div>
    </article>`).join('')}</div>`;
  }

  function renderExpansion(){
    return `<div class="list"><div class="section-mini">فتح المقر لا ينشئ أسطولًا تلقائيًا. هو كيان إداري/إقليمي مستقل يظهر على نفس الخريطة.</div>${expansionSites.map(s=>{
      const owned=state.branches.includes(s.id);
      return `<article class="list-item"><div class="list-item-head"><div><h3>${s.icon} ${s.name}</h3><p>${s.city} · ${s.country}</p></div><span class="tag">${owned?'مفتوح':fmtMoney(s.price)}</span></div><div class="metric-row"><div><span>تكلفة يومية</span><b>${fmtMoney(s.dailyCost)}</b></div><div><span>الوظيفة</span><b>مقر إقليمي</b></div><div><span>الحالة</span><b>${owned?'تشغيل':'متاح'}</b></div></div>${owned?'':`<div class="action-row"><button class="primary-btn open-branch" data-id="${s.id}">فتح المقر</button></div>`}</article>`;
    }).join('')}</div>`;
  }

  let lastDepartureBlocked=[];
  function routeCoordKey(coords){return Array.isArray(coords)&&coords.length>=2?`${Number(coords[0]).toFixed(3)},${Number(coords[1]).toFixed(3)}`:'';}
  function routePairSignature(route){
    if(!route)return'';const path=Array.isArray(route.route)?route.route:[],first=path[0],last=path[path.length-1],a=routeCoordKey(first)||String(route.fromFacility||route.from||'').trim(),b=routeCoordKey(last)||String(route.toFacility||route.to||'').trim();return `${route.type||'x'}:${[a,b].sort().join('::')}`;
  }
  function endpointPairSignature(type,a,b){const x=routeCoordKey(a?.coords)||String(a?.id||a?.name||''),y=routeCoordKey(b?.coords)||String(b?.id||b?.name||'');return `${type}:${[x,y].sort().join('::')}`;}
  function dedupeCustomRoutes(type=null){try{const result=window.GH_DOMAIN_COMMANDS.dispatch({state},'routes','dedupe',{type},{actor:'route-maintenance'}).result||{};for(const id of Object.keys(result.redirect||{}))delete routeTemplates[id];return Number(result.removed||0);}catch(error){console.warn('route dedupe rejected',error);return 0;}}
  function roadRouteUsageSignature(sig){return state.assets.filter(a=>a.type==='road'&&a.routeId&&routePairSignature(routeTemplates[a.routeId])===sig).length;}
  function ensureRoadPublicEndpoint(place){if(!place?.id)return null;const id=`ROAD-PUB-${place.id}`,endpoint={id,name:place.name||place.city||place.id,city:place.city||place.name||place.id,country:place.country||'',coords:place.coords,kind:'road-public',routeEndpoint:true,owned:false};try{window.GH_DOMAIN_COMMANDS.dispatch({state},'routes','register-endpoint',{endpoint},{actor:'route-planner'});return endpoint;}catch(error){console.warn('road endpoint rejected',error);return null;}}
  function roadFacilityOptions(){
    return getDynamicFacilities().filter(f=>f.owned&&['depot','logistics','port-base','airport-base'].includes(f.kind));
  }
  function renderRouteCenter(){
    dedupeCustomRoutes();
    const points=roadFacilityOptions(),seen=new Set(),routes=operationalRoutes().filter(r=>{const sig=routePairSignature(r);if(seen.has(sig))return false;seen.add(sig);return true;});
    const assigned=state.assets.filter(a=>a.routeId).length,idle=state.assets.filter(a=>!a.routeId).length,ready=state.assets.filter(a=>a.routeId&&a.phase==='turnaround').length,suggestions=Array.isArray(state.advanced?.routeSuggestions)?state.advanced.routeSuggestions:[],mobility=window.GH_MOBILITY_CORE?.snapshot?.(state)||{vehicles:0,moving:0,activeTrips:0};
    const options=points.map(f=>`<option value="${esc(f.id)}">${esc(f.name)} · ${esc(f.city)}</option>`).join('');
    const routeTypeLabel=type=>type==='air'?'طائرات':type==='sea'?'سفن':'شاحنات';
    const idleRows=state.assets.filter(a=>!a.routeId).slice(0,36).map(a=>`<div class="spec-row"><span>${esc(a.icon||assetIcon(a.type))} ${esc(a.name)} · ${esc(typeName(a.type))}</span><button class="secondary-btn" data-open="assignRoute" data-arg="${esc(a.id)}">اختيار مسار</button></div>`).join('');
    const routeCards=routes.map(r=>{const linked=state.assets.filter(a=>a.routeId===r.id),turn=linked.filter(a=>a.phase==='turnaround').length,primary=linked[0],label=routeTypeLabel(r.type);return `<article class="list-item sector-${esc(r.type||'road')}"><div class="list-item-head"><div><h3>${esc(r.name)}</h3><p>${esc(r.from)} → ${esc(r.to)} · ${esc(r.type||'road').toUpperCase()}</p></div><span class="tag ${r.routingSource?'positive':''}">${linked.length} ${label}</span></div><div class="metric-row"><div><span>المسافة</span><b>${fmtNumber(r.distanceKm)} كم</b></div><div><span>زمن الرحلة</span><b>${formatDuration(r.tripSeconds)}</b></div><div><span>جاهزة الآن</span><b>${turn}</b></div></div><div class="action-row">${primary?`<button class="secondary-btn" data-open="assetManage" data-arg="${esc(primary.id)}">إدارة أصل الخط</button>`:''}<button class="secondary-btn depart-route" data-route="${esc(r.id)}" data-type="${esc(r.type||'road')}" ${turn?'':'disabled'}>مغادرة كل ${label}</button></div><p>${esc(r.routingSource||'مسار تشغيلي مسجل في مركز المسارات.')}</p></article>`;}).join('');
    const air=state.assets.find(a=>a.type==='air'),sea=state.assets.find(a=>a.type==='sea');
    const globalButtons=`${air?`<button class="secondary-btn open-global-route-center" data-asset="${esc(air.id)}">إنشاء/تعيين مسار جوي</button>`:''}${sea?`<button class="secondary-btn open-global-route-center" data-asset="${esc(sea.id)}">إنشاء/تعيين مسار بحري</button>`:''}`;
    return `<div class="list"><article class="list-item"><div class="list-item-head"><div><h3>مركز المسارات المستقل</h3><p>كل إنشاء وتعيين ومغادرة للمسارات الجوية والبحرية والبرية هنا فقط. GH AI يقترح هندسة الطريق؛ لا ينشئ ولا يعيّن ولا يحرّك دون قرارك.</p></div><span class="tag positive">MANUAL CONTROL</span></div><div class="metric-row"><div><span>أصول بلا مسار</span><b>${idle}</b></div><div><span>أصول مكلّفة</span><b>${assigned}</b></div><div><span>جاهزة للمغادرة</span><b>${ready}</b></div><div><span>Mobility</span><b>${mobility.moving}/${mobility.vehicles} متحركة</b></div></div><div class="action-row"><button class="secondary-btn suggest-routes" ${state.assets.length?'':'disabled'}>اقتراح AI فقط</button><button class="primary-btn depart-all-assets" ${ready?'':'disabled'}>تحريك جميع الأصول الجاهزة</button>${globalButtons}</div></article>
      ${lastDepartureBlocked.length?`<article class="list-item"><h3>تعطّل ${lastDepartureBlocked.length} أصل عن الانطلاق</h3><p>سبب كل أصل تحديدًا من آخر أمر مغادرة جماعي.</p>${lastDepartureBlocked.map(b=>`<div class="spec-row"><span>${esc(b.name)} · ${esc(typeName(b.type))}</span><span>${esc(b.text)}</span></div>`).join('')}</article>`:''}
      ${suggestions.length?`<article class="list-item"><h3>اقتراحات AI غير المنفذة</h3><p>لا يتغير أي أصل حتى تفتح تعيينه وتختار بنفسك.</p>${suggestions.slice(0,30).map(x=>`<div class="spec-row"><span>${esc(x.assetName)} · ${esc(x.from)} ← ${esc(x.to)}</span><button class="secondary-btn" data-open="assignRoute" data-arg="${esc(x.assetId)}">تعيين يدوي</button></div>`).join('')}</article>`:''}
      ${idleRows?`<article class="list-item"><h3>أصول تنتظر تعيينًا</h3><p>اختيار المسار يتم من هذا المركز فقط، ولا يُنشئ شراءً أو قاعدة جديدة.</p>${idleRows}</article>`:''}
      <article class="list-item"><h3>إنشاء مسار بري يدوي</h3><p>اختر نقطتي التشغيل بنفسك. لا يضيف AI وجهات أو قواعد أو مسارات تلقائيًا.</p>${points.length?`<div class="route-builder"><label>نقطة الانطلاق<select id="roadFrom">${options}</select></label><label>الوجهة<select id="roadTo">${[...points].reverse().map(f=>`<option value="${esc(f.id)}">${esc(f.name)} · ${esc(f.city)}</option>`).join('')}</select></label></div><div class="action-row"><button class="primary-btn start-road-route">إنشاء من الخريطة</button>${points.length>=2?'<button class="secondary-btn build-road-route">بين قاعدتين</button>':''}<button class="secondary-btn" data-open="companyFacilities" data-arg="road">إضافة مركز من سجل LOG</button></div>`:'<div class="empty">افتح مركزًا لوجستيًا من سجل LOG أولًا ليكون نقطة الانطلاق.</div>'}</article>
      <div class="section-mini">المسارات التشغيلية الفريدة لكل الشركات</div>${routeCards||'<div class="empty">لا توجد مسارات مكلّفة بعد. أنشئها من هذا المركز ثم عيّن الأصول يدويًا.</div>'}<article class="list-item sector-mobility"><div class="list-item-head"><div><h3>مسارات Mobility الحضرية</h3><p>المسارات داخل المدن ثابتة ومقفلة لكل رحلة، وتظهر السيارات كنقاط سوداء صغيرة على خطها الدقيق.</p></div><span class="tag positive">${mobility.activeTrips||0} رحلة نشطة</span></div><div class="metric-row"><div><span>السيارات</span><b>${mobility.vehicles||0}</b></div><div><span>المتحركة</span><b>${mobility.moving||0}</b></div><div><span>هندسة المسار</span><b>ثابتة</b></div></div></article></div>`;
  }

  function suggestRoutesOnly(type=null){
    const suggestions=[];
    for(const asset of state.assets.filter(a=>!type||a.type===type)){
      const best=rankRoutesForAsset(asset.id)[0];
      if(best)suggestions.push({assetId:asset.id,assetName:asset.name,type:asset.type,routeId:best.routeId,from:best.from,to:best.to,score:Math.round(best.score),margin:best.margin,createdAt:state.simSeconds||0});
    }
    state.advanced=state.advanced||{};state.advanced.routeSuggestions=suggestions;save();
    pushAlert(suggestions.length?`اقترح AI ${suggestions.length} تعيينًا دون إنشاء أو تنفيذ أي مسار. افتح كل أصل واعتمد اختياره يدويًا.`:'لا توجد مسارات يدوية متوافقة ليقترحها AI. أنشئ المسارات أولًا.');
    openDrawer('routes');return suggestions;
  }

  async function createRoadRouteFromForm(){const fromId=$('roadFrom')?.value,toId=$('roadTo')?.value;if(!fromId||!toId||fromId===toId){notice('اختر نقطتي تشغيل مختلفتين.');return;}const from=routeFacility(fromId),to=routeFacility(toId);if(!from||!to)return;const button=document.querySelector('.build-road-route');if(button){button.disabled=true;button.textContent='جاري حساب الطريق…';}const geometry=await requestRoadGeometry(from.coords,to.coords);if(!geometry){notice('لم يجد محرك الطرق اتصالًا بريًا صالحًا بين النقطتين. اختر نقطتين متصلتين بالطرق.');openDrawer('routes');return;}const id=nextId('ROAD-CUSTOM'),durationHours=Math.max(.25,geometry.durationSeconds/3600),fromName=roadLocationName(from),toName=roadLocationName(to),route=prepareRoute({id,type:'road',name:`${fromName} → ${toName}`,from:fromName,to:toName,fromFacility:from.id,toFacility:to.id,route:geometry.route,effectiveSpeedKmh:clamp(geometry.distanceKm/durationHours,42,82),dwellHours:2.5,routingSource:'OSRM · شبكة طرق فعلية'});try{window.GH_DOMAIN_COMMANDS.dispatch({state},'routes','create',{route:clone(route)},{actor:'route-planner'});window.GH_DOMAIN_COMMANDS.dispatch({state},'routes','cache-geometry',{id,route:route.route,distanceKm:route.distanceKm,durationSeconds:geometry.durationSeconds},{actor:'route-planner'});routeTemplates[id]=route;pushAlert(`أُنشئ مسار بري فعلي من ${route.from} إلى ${route.to} بطول ${fmtNumber(route.distanceKm)} كم.`);save();renderMap();openDrawer('routes');}catch(error){notice(`تعذر إنشاء المسار: ${error.message}`);}}
  function activateAutomaticRoute(asset,route){
    asset=state.assets.find(x=>x.id===asset.id)||asset;
    if(asset.phase==='moving'&&asset.routeId)return {ok:true,reused:true};
    const tx=window.GH_TRANSACTION_CORE;
    try{const result=tx.execute(state,{label:`activate-route:${asset.id}`,apply:()=>{if(!state.customRoutes.some(r=>r.id===route.id))window.GH_DOMAIN_COMMANDS.dispatch({state},'routes','create',{route:clone(route)},{actor:'ai-route'});if(asset.routeId!==route.id||asset.phase!=='turnaround')window.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','assign-route',{id:asset.id,routeId:route.id,baseFacility:asset.baseFacility,phase:'turnaround',route},{actor:'ai-route'});window.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','depart',{id:asset.id,route,load:loadLabel(asset)},{actor:'ai-route'});normalizeAsset(asset);delete asset.activationError;asset.activatedAt=state.simSeconds||0;return true;}});routeTemplates[route.id]=route;return {ok:result.value===true,reused:asset.routeId===route.id};}
    catch(error){const live=state.assets.find(x=>x.id===asset.id)||asset;live.activationError=String(error.message||error);live.activationAttempts=(Number(live.activationAttempts)||0)+1;console.warn('automatic route activation rejected',live.id,error);return {ok:false,error:live.activationError};}
  }
  async function createAutomaticRoutes(assetIds=null,options={}){
    dedupeCustomRoutes();
    const wanted=Array.isArray(assetIds)?new Set(assetIds):null;
    const idle=state.assets.filter(a=>a.phase!=='moving'&&['air','sea','road'].includes(a.type)&&(!wanted||wanted.has(a.id)));let created=0,skipped=0,lastRoadRequest=0;const failures=[];
    const routeUsage=new Map();state.assets.forEach(a=>{const r=routeTemplates[a.routeId];if(r)routeUsage.set(routePairSignature(r),(routeUsage.get(routePairSignature(r))||0)+1);});
    for(let assetIndex=0;assetIndex<idle.length;assetIndex++){
      const asset=idle[assetIndex],origin=routeOriginForAsset(asset);if(!origin){asset.activationError='missing-owned-origin';failures.push({id:asset.id,reason:asset.activationError});skipped++;continue;}
      const assigned=asset.routeId&&(routeTemplates[asset.routeId]||state.customRoutes.find(r=>r.id===asset.routeId));if(assigned){const activation=activateAutomaticRoute(asset,assigned);if(activation.ok){created++;continue;}const live=state.assets.find(x=>x.id===asset.id);if(live){live.routeId=null;live.phase='idle';}}
      if(asset.type==='road'){
        const owned=roadFacilityOptions().filter(f=>f.id!==origin.id);
        const publicCandidates=(LOCAL_PLACE_AREAS||[]).filter(p=>Array.isArray(p.coords)&&haversine(origin.coords,p.coords)>18&&haversine(origin.coords,p.coords)<1250).map(p=>ensureRoadPublicEndpoint(p));
        const candidates=[...owned,...publicCandidates].filter((f,i,list)=>list.findIndex(x=>x.id===f.id)===i).map(f=>{const sig=endpointPairSignature('road',origin,f),distance=haversine(origin.coords,f.coords),usage=routeUsage.get(sig)||0;return{f,sig,distance,usage,score:usage*1e7+Math.abs(distance-420)*900+(f.owned?-450000:0)};}).sort((a,b)=>a.score-b.score);
        let selected=null;
        for(const candidate of candidates.slice(0,Math.min(8,candidates.length))){if(!routeUsage.has(candidate.sig)||candidate.usage===Math.min(...candidates.map(x=>x.usage))){selected=candidate;break;}}
        selected=selected||candidates[0];if(!selected){skipped++;continue;}
        const existing=operationalRoutes('road').find(r=>routePairSignature(r)===selected.sig);
        if(existing){const activation=activateAutomaticRoute(asset,existing);if(activation.ok){routeUsage.set(selected.sig,(routeUsage.get(selected.sig)||0)+1);created++;}else{failures.push({id:asset.id,reason:activation.error});skipped++;}continue;}
        let geometry=null;if(options.deterministic)geometry=fallbackRoadGeometry(origin.coords,selected.f.coords);else{const wait=Math.max(0,450-(Date.now()-lastRoadRequest));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));lastRoadRequest=Date.now();geometry=await requestRoadGeometry(origin.coords,selected.f.coords)||fallbackRoadGeometry(origin.coords,selected.f.coords);}if(!geometry){skipped++;continue;}
        const route=prepareRoute({id:nextId('ROAD-AUTO'),type:'road',name:`${roadLocationName(origin)} → ${roadLocationName(selected.f)}`,from:roadLocationName(origin),to:roadLocationName(selected.f),fromFacility:origin.id,toFacility:selected.f.id,route:geometry.route,effectiveSpeedKmh:clamp(geometry.distanceKm/Math.max(.25,geometry.durationSeconds/3600),42,82),dwellHours:2.5,routingSource:geometry.fallback?'GH AI Network · مسار حتمي احتياطي':'GH AI Network · OSRM · تنويع ربحي'});
        const eco=computeTripEconomics(asset,route);route.aiScore=Math.round((eco.margin||0)+(eco.margin/Math.max(1,eco.revenue))*250000-(selected.usage*150000));route.aiMargin=eco.margin;route.aiMarginPct=eco.margin/Math.max(1,eco.revenue);
        if(!geometry.fallback)window.GH_DOMAIN_COMMANDS.dispatch({state},'routes','cache-geometry',{id:route.id,route:route.route,distanceKm:route.distanceKm,durationSeconds:geometry.durationSeconds},{actor:'ai-route'});{const activation=activateAutomaticRoute(asset,route);if(activation.ok){routeUsage.set(selected.sig,(routeUsage.get(selected.sig)||0)+1);created++;}else{failures.push({id:asset.id,reason:activation.error});skipped++;}}continue;
      }
      const kind=asset.type==='air'?'airport':'port',range=assetRangeKm(asset),rawWorld=kind==='airport'?WORLD.airports:WORLD.ports,step=Math.max(1,Math.floor(rawWorld.length/220));
      const globalCandidates=rawWorld.filter((_,i)=>i%step===0).map(row=>kind==='airport'?airportEntity(row):portEntity(row)).filter(entity=>entity?.name).map(entity=>({...entity,id:entity.key}));
      const candidates=[...facilities.filter(f=>f.kind===kind),...globalCandidates].filter((f,i,list)=>f.id!==origin.id&&list.findIndex(x=>x.id===f.id)===i).map(f=>{const distance=haversine(origin.coords,f.coords),sig=endpointPairSignature(asset.type,origin,f),usage=routeUsage.get(sig)||0;return{...f,distance,sig,usage};}).filter(f=>!range||f.distance<=range*.88).sort((a,b)=>a.usage-b.usage||Math.abs(a.distance-range*.52)-Math.abs(b.distance-range*.52));
      const target=candidates[0];if(!target){asset.activationError='no-compatible-destination';failures.push({id:asset.id,reason:asset.activationError});skipped++;continue;}const existing=Object.values(routeTemplates).find(r=>r.type===asset.type&&routePairSignature(r)===target.sig);if(existing){const activation=activateAutomaticRoute(asset,existing);if(activation.ok){routeUsage.set(target.sig,target.usage+1);created++;}else{failures.push({id:asset.id,reason:activation.error});skipped++;}continue;}
      const endpoint=ensurePublicRouteEndpoint({...target,key:`auto:${target.id}`}),route=buildPublicRoute(asset,origin,endpoint);if(!route||!routeFitsAsset(asset,route)){asset.activationError='route-outside-asset-envelope';failures.push({id:asset.id,reason:asset.activationError});skipped++;continue;}route.id=nextId(`${asset.type.toUpperCase()}-AUTO`);route.name=`GH AI · ${route.name}`;const eco=computeTripEconomics(asset,route);route.aiScore=Math.round((eco.margin||0)+(eco.margin/Math.max(1,eco.revenue))*250000-target.usage*200000);route.aiMargin=eco.margin;route.aiMarginPct=eco.margin/Math.max(1,eco.revenue);{const activation=activateAutomaticRoute(asset,route);if(activation.ok){routeUsage.set(target.sig,target.usage+1);created++;}else{failures.push({id:asset.id,reason:activation.error});skipped++;}}
    }
    dedupeCustomRoutes();save();renderMap();if(!options.silent){pushAlert(created?`GH AI شغّل ${created} أصلًا على شبكة متنوعة${failures.length?`، وبقي ${failures.length} في إعادة المحاولة`:''}.`:`لم يُنشأ مسار تلقائي. راجع القواعد والمدى واتصال الطرق.`);openDrawer('routes');}return {expected:idle.length,activated:created,skipped,failures,moving:wanted?state.assets.filter(a=>wanted.has(a.id)&&a.phase==='moving').length:state.assets.filter(a=>a.phase==='moving').length};
  }


  function renderCompetitors(){
    const rivals=competitors.map(c=>`<article class="list-item"><div class="list-item-head"><div><h3>${c.name}</h3><p>${c.sector} · ${c.hq}</p></div><span class="tag">حصة ${c.marketShare}</span></div><div class="metric-row"><div><span>الإيرادات</span><b>${fmtMoney(c.revenue)}</b></div><div><span>EBITDA</span><b>${fmtMoney(c.ebitda)}</b></div><div><span>جودة التشغيل</span><b>${c.quality||80}/100</b></div></div><p>${c.strategy} · فرصة التكامل: ${c.synergy||'تشغيلية'}.</p><div class="action-row"><button class="secondary-btn diligence" data-id="${c.id}">ملف استحواذ</button></div></article>`).join('');
    const partners=strategicPartners.map(p=>`<article class="list-item"><div class="list-item-head"><div><h3>${p.name}</h3><p>${p.service}</p></div><span class="tag positive">${p.rating}/100</span></div><p>القطاع: ${p.sector==='all'?'متعدد القطاعات':typeName(p.sector)} · شروط: ${p.terms}</p></article>`).join('');
    return `<div class="section-mini">المنافسون وأهداف الاستحواذ</div><div class="list">${rivals}</div><div class="section-mini">شبكة الموردين وشركاء الصيانة والتوريد</div><div class="list">${partners}</div>`;
  }


  function companyLogoMarkup(type,size='normal'){
    const record=type==='group'?state.profile:(state.companyRegistry?.[type]||{}),logo=record.logo||null,style=record.logoStyle||type||state.profile.logoStyle||'teal',abbr=type==='group'?(state.profile.shortName||'GH'):({air:'AIR',sea:'SEA',road:'LOG',power:'NRG',bank:'BNK',mobility:'MOVE'}[type]||'CO');
    return `<div class="company-logo-badge ${size==='small'?'small':''}" data-style="${esc(style)}">${logo?`<img src="${esc(logo)}" alt="">`:`<span>${esc(abbr)}</span>`}</div>`;
  }
  function renderFinance(){
    reconcileConsolidatedCash();ensureBankCorporateClients();
    const opened=['group',...(state.openedCompanies||[]).filter(t=>['air','sea','road','power','bank','mobility'].includes(t))],subs=opened.filter(t=>t!=='group'),debtRatio=Math.round(state.debt/Math.max(1,state.debt+state.groupValue)*100),groupBalance=companyOperatingBalance('group');
    const entityCard=type=>{const b=companyBook(type),oper=b.accounts[0],reserve=b.accounts[1]||{balance:0},budget=companyBudget(type),budgetRemain=companyBudgetRemaining(type),inv=(state.finance.invoices||[]).filter(x=>(x.company||'group')===type),pending=inv.filter(x=>!['مسددة','محصلة','مدفوعة'].includes(x.status)).reduce((n,x)=>n+(Number(x.total)||0),0),budgetPct=budget.enabled&&budget.limit?Math.min(100,Math.round((budget.spent/budget.limit)*100)):0;return `<article class="finance-company-card-v202"><header class="finance-card-head-v202"><div class="finance-card-identity-v202">${companyLogoMarkup(type,'small')}<div><h3>${esc(companyFinanceName(type))}</h3><small>${esc(oper.id)}</small></div></div><div class="finance-card-balance-v202"><span>الرصيد التشغيلي</span><strong>${fmtMoney(oper.balance)}</strong></div></header><div class="finance-card-metrics-v202"><div><span>الاحتياطي</span><b>${fmtMoney(reserve.balance||0)}</b></div><div><span>الدين</span><b>${fmtMoney(b.debt||0)}</b></div><div><span>مستندات مفتوحة</span><b>${fmtMoney(pending)}</b></div><div><span>الميزانية المتبقية</span><b>${budgetRemain===Infinity?'غير محددة':fmtMoney(budgetRemain)}</b></div></div>${budget.enabled?`<div class="finance-budget-progress"><span style="width:${budgetPct}%"></span></div>`:''}<footer class="finance-card-actions-v202"><button class="primary-btn finance-entity-docs" data-company="${type}">المستندات</button><button class="secondary-btn company-reserve-transfer" data-company="${type}" data-direction="reserve">+1M للاحتياطي</button><button class="secondary-btn company-reserve-transfer" data-company="${type}" data-direction="operating">−1M من الاحتياطي</button>${b.taxPayable>0?`<button class="secondary-btn pay-taxes" data-company="${type}">سداد الضريبة</button>`:''}</footer></article>`;};
    const bulkRows=subs.map(t=>`<label class="bulk-company-row"><span>${companyLogoMarkup(t,'tiny')}<b>${esc(companyFinanceName(t))}</b><small>${fmtMoney(companyOperatingBalance(t))}</small></span><input class="bulk-transfer-amount" data-company="${t}" type="number" min="0" step="1000" value="0" inputmode="decimal"></label>`).join('');
    return `<div class="finance-v202"><section class="finance-overview-v202"><div><span class="eyebrow">FINANCE DOMAIN · 2.5.0</span><p>المجال المالي الوحيد للمجموعة: دفاتر الشركات، الخزينة، المستندات، الأسواق والبنك.</p></div><span class="finance-risk-badge ${debtRatio<35?'good':''}">الدين <b>${debtRatio}%</b></span></section>
      <section class="finance-domain-nav"><button class="command-btn" data-open="treasury"><span>TRY</span><div><b>الخزينة والسيولة</b><small>تمويل · احتياطي · تحوط · ضغط</small></div></button><button class="command-btn" data-open="invoices"><span>DOC</span><div><b>المستندات والذمم</b><small>فواتير · شيكات · تحويلات · تحصيل</small></div></button><button class="command-btn" data-open="market"><span>MKT</span><div><b>الأسواق والمحفظة</b><small>استثمار · مراكز · مؤشرات</small></div></button><button class="command-btn" data-open="bank"><span>BNK</span><div><b>بنك المجموعة</b><small>ائتمان · ودائع · سيولة · عملاء</small></div></button></section>
      <section class="finance-kpi-strip-v202"><div><span>السيولة الموحدة</span><b>${state.godMoney&&state.infiniteMoney?'∞':fmtMoney(state.cash)}</b></div><div><span>سيولة القابضة</span><b>${fmtMoney(groupBalance)}</b></div><div><span>إجمالي الديون</span><b>${fmtMoney(state.debt)}</b></div><div><span>قيمة المجموعة</span><b>${fmtMoney(state.groupValue)}</b></div></section>
      <section class="finance-section-v202"><div class="finance-section-head-v202"><div><h3>دفاتر الشركات</h3><p>رصيد واحتياطي ودين وميزانية كل كيان بدون تداخل.</p></div><button class="secondary-btn view-invoices">كل المستندات</button></div><div class="finance-company-list-v202">${opened.map(entityCard).join('')}</div></section>
      <section class="finance-section-v202 finance-transfers-v202"><div class="finance-section-head-v202"><div><h3>التحويلات الداخلية</h3><p>تحويل مباشر أو توزيع جماعي من القابضة؛ جميع العمليات موثقة في الأستاذ.</p></div></div>
        <article class="finance-transfer-panel-v202"><div class="finance-subhead-v202"><b>تحويل مباشر</b><small>بين كيانين داخل المجموعة</small></div><div class="company-transfer-form finance-direct-form-v202"><label>من<select id="companyTransferFrom">${opened.map(t=>`<option value="${t}">${esc(companyFinanceName(t))}</option>`).join('')}</select></label><label>إلى<select id="companyTransferTo">${opened.slice().reverse().map(t=>`<option value="${t}">${esc(companyFinanceName(t))}</option>`).join('')}</select></label><label class="wide">المبلغ<input id="companyTransferAmount" type="number" min="1" step="1000" value="5000000" inputmode="decimal"></label></div><button class="primary-btn company-transfer-submit">تنفيذ التحويل</button></article>
        <article class="finance-transfer-panel-v202 bulk"><div class="finance-subhead-v202"><div><b>توزيع جماعي من القابضة</b><small>عملية ذرية واحدة لجميع الشركات</small></div><span id="bulkTransferTotal" class="tag">$0</span></div>${subs.length?`<div class="bulk-transfer-toolbar"><label>مبلغ التوزيع<input id="bulkTransferPool" type="number" min="0" step="1000" value="${Math.min(25000000,Math.max(0,Math.floor(groupBalance*.1)))}"></label><button class="secondary-btn bulk-transfer-equal">بالتساوي</button><button class="secondary-btn bulk-transfer-needs">حسب الاحتياج</button></div><div class="bulk-transfer-list">${bulkRows}</div><button class="primary-btn bulk-transfer-submit">تنفيذ جميع التحويلات</button>`:'<div class="empty">افتح شركة تابعة أولًا لاستخدام التوزيع الجماعي.</div>'}</article>
      </section>
      <section class="finance-section-v202"><div class="finance-section-head-v202"><div><h3>تمويل القابضة</h3><p>الدين ورأس المال منفصلان عن التحويلات التشغيلية.</p></div></div><div class="finance-funding-actions"><button class="primary-btn add-credit">خط ائتمان +$50M</button><button class="secondary-btn issue-bond">سندات 5 سنوات +$100M</button><button class="secondary-btn repay-debt">سداد $25M</button></div></section>${renderAccountingStatement()}${window.GH_REALISM?window.GH_REALISM.financeHTML(state):''}</div>`;
  }
  function renderAccountingStatement(){const f=state.finance,revenue=f.invoices.filter(x=>x.kind==='دخل').reduce((s,x)=>s+x.amount,0),expense=f.invoices.filter(x=>x.kind==='مصروف').reduce((s,x)=>s+x.amount,0),assets=state.cash+state.assets.reduce((s,a)=>s+(a.purchasePrice||0)*.7,0),liabilities=state.debt+f.payables.reduce((s,x)=>s+x.total,0);return `<article class="list-item"><h3>الملخص المحاسبي التشغيلي</h3><div class="metric-row"><div><span>الإيرادات المثبتة</span><b class="positive">${fmtMoney(revenue)}</b></div><div><span>المصروفات المثبتة</span><b>${fmtMoney(expense)}</b></div><div><span>صافي المستندات</span><b class="${revenue-expense>=0?'positive':'negative'}">${fmtMoney(revenue-expense)}</b></div></div><div class="metric-row two"><div><span>الأصول المقدرة</span><b>${fmtMoney(assets)}</b></div><div><span>الالتزامات</span><b>${fmtMoney(liabilities)}</b></div></div></article>`;}
  function truncateText(str,n){str=String(str??'');return str.length>n?str.slice(0,n-1)+'…':str;}
  function accountOwnerLabel(accountId){for(const t of COMPANY_FINANCE_TYPES){const b=companyBook(t);if((b.accounts||[]).some(x=>x.id===accountId))return companyFinanceName(t);}return String(accountId||'طرف خارجي');}
  function companyKeyForAccount(accountId){if(!accountId)return null;for(const t of COMPANY_FINANCE_TYPES){const b=companyBook(t);if((b.accounts||[]).some(x=>x.id===accountId))return t;}return null;}
  function documentCompanyKey(doc={}){if(COMPANY_FINANCE_TYPES.includes(doc.company))return doc.company;return companyKeyForAccount(doc.accountId)||companyKeyForAccount(doc.from)||companyKeyForAccount(doc.to)||'group';}
  function financeDocumentIdentity(company){const record=company==='group'?state.profile:(state.companyRegistry?.[company]||{}),account=companyBook(company).accounts[0]?.id||'—';return {company,name:companyFinanceName(company),account,signatory:record.authorizedSignatory||state.profile.founder||'المفوض بالتوقيع',mark:company==='group'?(state.profile.shortName||'GH'):({air:'AIR',sea:'SEA',road:'LOG',power:'NRG',bank:'BNK',mobility:'MOVE'}[company]||'CO')};}
  function transferDirection(x,company){const fromKey=companyKeyForAccount(x.from),toKey=companyKeyForAccount(x.to);if(fromKey&&toKey){if(fromKey===company&&toKey!==company)return {key:'outgoing',label:'حوالة صادرة',watermark:'OUTGOING'};if(toKey===company&&fromKey!==company)return {key:'incoming',label:'حوالة واردة',watermark:'INCOMING'};return {key:'internal',label:'تحويل داخلي',watermark:'INTERNAL'};}if(fromKey===company)return {key:'outgoing',label:'حوالة صادرة',watermark:'OUTGOING'};if(toKey===company)return {key:'incoming',label:'حوالة واردة',watermark:'INCOMING'};return {key:'internal',label:'إشعار تحويل مصرفي',watermark:'TRANSFER'};}
  // Financial documents resolve the current legal-entity identity at render time. No historical logo snapshot is persisted.
  function chequeArt(c){const company=documentCompanyKey(c),i=financeDocumentIdentity(company),statusClass=c.status==='مرتجع'?'failed':c.status==='صادر'?'pending':'',daysLeft=Math.max(0,c.dueDay-Math.floor((state.simSeconds||0)/86400)),issuedDay=Math.floor((c.issuedAt||0)/86400)+1;return `<div class="document-card"><article class="financial-paper cheque-paper authority-inspired"><div class="financial-watermark">CHEQUE</div><header class="authority-head">${companyLogoMarkup(company,'small')}<div><small>OFFICIAL BANKING INSTRUMENT · GLOBAL HOLDINGS</small><h3>شيك مصرفي</h3><p>${esc(i.name)}</p></div><strong>${esc(c.id)}</strong></header><div class="authority-meta"><span>الحساب <b dir="ltr">${esc(c.accountId||i.account)}</b></span><span>يوم الإصدار <b>${issuedDay}</b></span><span>الحالة <b class="doc-status ${statusClass}">${esc(c.status)}</b></span></div><section class="financial-subject"><div><small>ادفعوا لأمر</small><h4>${esc(c.beneficiary||'مستفيد غير محدد')}</h4><p>${esc(c.note||'شيك مصرفي')}</p></div><strong class="financial-amount">${fmtMoney(c.amount)}</strong></section><div class="authority-grid financial-grid"><div><span>مرجع الفاتورة</span><b>${esc(c.invoiceNumber||'—')}</b></div><div><span>تاريخ الاستحقاق</span><b>${c.status==='صادر'?`خلال ${daysLeft} يوم`:`اليوم ${c.dueDay}`}</b></div><div><span>العملة</span><b>USD</b></div><div><span>نوع الأداة</span><b>${esc(c.type||'شيك مصرفي')}</b></div></div><div class="authority-signatures financial-signatures"><div><small>المفوض بالتوقيع</small><b>${esc(i.signatory)}</b></div><div class="authority-stamp"><b>${esc(i.mark)}</b><small>ختم الكيان</small></div><div><small>وحدة التنفيذ</small><b>الخزينة المركزية</b></div></div><footer class="authority-footer"><span>مرجع: ${esc(c.id)} · ${esc(c.invoiceNumber||'بدون فاتورة')}</span><span>مستند مالي مسجل في دفتر ${esc(i.name)}</span></footer></article></div>`;}
  function invoiceArt(d){const company=documentCompanyKey(d),statusClass=d.status==='شيك مرتجع'?'failed':(!['مسددة','محصلة','مدفوعة'].includes(d.status)?'pending':'');return `<div class="document-card"><div class="invoice-paper"><div class="doc-paper-head"><div class="doc-paper-brand">${companyLogoMarkup(company,'small')}<div><b>${esc(companyFinanceName(company))}</b><small>${esc(d.accountId||companyBook(company).accounts[0].id)}</small></div></div><span class="doc-number">${esc(d.number)}</span></div><div class="invoice-body"><div class="invoice-title">${d.kind==='دخل'?'فاتورة مبيعات':'فاتورة مورد / مصروف'}</div><div class="invoice-row"><span>الطرف المقابل</span><strong>${esc(d.counterparty||'—')}</strong></div><div class="invoice-row"><span>الوصف</span><strong>${esc(truncateText(d.note,42))}</strong></div><div class="invoice-row"><span>القيمة الإجمالية</span><strong>${fmtMoney(d.total)}</strong></div><div class="invoice-row"><span>ضريبة ضمنية</span><strong>${fmtMoney(d.tax||0)}</strong></div><div class="invoice-row"><span>طريقة السداد</span><strong>${esc(d.method||'تحويل بنكي')}</strong></div><div class="invoice-row invoice-total"><span>الإجمالي</span><strong>${fmtMoney(d.total)}</strong></div></div><div class="invoice-footer"><span class="doc-status ${statusClass}">${esc(d.status||'مدفوعة')}</span><span>يوم ${Math.floor((d.at||0)/86400)+1}</span></div></div></div>`;}
  function transferArt(x){const company=documentCompanyKey(x),i=financeDocumentIdentity(company),ref=`TR-${Math.floor(x.at||0)}-${String(Math.round(x.amount||0)).slice(-7)}`,fromName=accountOwnerLabel(x.from),toName=accountOwnerLabel(x.to),dir=transferDirection(x,company),day=Math.floor((x.at||0)/86400)+1;return `<div class="document-card"><article class="financial-paper transfer-paper authority-inspired ${dir.key}"><div class="financial-watermark">${dir.watermark}</div><header class="authority-head">${companyLogoMarkup(company,'small')}<div><small>OFFICIAL FUNDS TRANSFER · GLOBAL HOLDINGS</small><h3>${dir.label}</h3><p>${esc(i.name)}</p></div><strong>${esc(ref)}</strong></header><div class="authority-meta"><span>الكيان المسجل <b>${esc(i.name)}</b></span><span>يوم القيمة <b>${day}</b></span><span>الحالة <b class="doc-status">منفذ</b></span></div><section class="financial-subject transfer-subject"><div><small>${dir.key==='incoming'?'مصدر الأموال':dir.key==='outgoing'?'المستفيد':'مسار التحويل'}</small><h4>${dir.key==='incoming'?esc(fromName):dir.key==='outgoing'?esc(toName):`${esc(fromName)} ← ${esc(toName)}`}</h4><p>${esc(x.note||'تحويل بنكي')}</p></div><strong class="financial-amount ${dir.key}">${dir.key==='incoming'?'+':dir.key==='outgoing'?'−':''}${fmtMoney(x.amount)}</strong></section><div class="transfer-parties"><div><span>الآمر / Remitter</span><b>${esc(fromName)}</b><small dir="ltr">${esc(x.from||'—')}</small></div><div class="transfer-flow-mark">${dir.key==='incoming'?'←':dir.key==='outgoing'?'→':'⇄'}</div><div><span>المستفيد / Beneficiary</span><b>${esc(toName)}</b><small dir="ltr">${esc(x.to||'—')}</small></div></div><div class="authority-grid financial-grid"><div><span>مرجع العملية</span><b dir="ltr">${esc(ref)}</b></div><div><span>المبلغ</span><b>${fmtMoney(x.amount)}</b></div><div><span>العملة</span><b>USD</b></div><div><span>التصنيف</span><b>${dir.label}</b></div></div><div class="authority-signatures financial-signatures"><div><small>جهة القيد</small><b>${esc(i.name)}</b></div><div class="authority-stamp"><b>${esc(i.mark)}</b><small>تم التنفيذ</small></div><div><small>وحدة المعالجة</small><b>الخزينة / الأستاذ</b></div></div><footer class="authority-footer"><span>${esc(ref)} · Value date D${day}</span><span>قيد مصرفي منفذ وموثق في الأستاذ</span></footer></article></div>`;}
  function renderInvoices(arg){
    const company=typeof arg==='object'?arg.company:arg||'all',tab=typeof arg==='object'?(arg.tab||'all'):'all',validCompany=COMPANY_FINANCE_TYPES.includes(company)?company:'all';
    const docs=(state.finance.invoices||[]).filter(d=>validCompany==='all'||(d.company||'group')===validCompany),cheques=(state.finance.cheques||[]).filter(d=>validCompany==='all'||(d.company||'group')===validCompany),transfers=(state.treasury.ledger||[]).filter(x=>validCompany==='all'||x.company===validCompany||String(x.from||'').startsWith(validCompany==='group'?'GH':validCompany.toUpperCase())||String(x.to||'').startsWith(validCompany==='group'?'GH':validCompany.toUpperCase())).slice(0,60),ar=(state.finance.receivables||[]).filter(d=>validCompany==='all'||(d.company||'group')===validCompany),ap=(state.finance.payables||[]).filter(d=>validCompany==='all'||(d.company||'group')===validCompany);
    const tabs=[['all','الملخص'],['cheques','الشيكات'],['invoices','الفواتير'],['transfers','التحويلات'],['receivables','الذمم']];
    let body='';if(tab==='all')body=`<article class="list-item"><div class="metric-row"><div><span>فواتير</span><b>${docs.length}</b></div><div><span>شيكات</span><b>${cheques.length}</b></div><div><span>تحويلات</span><b>${transfers.length}</b></div></div><div class="metric-row two"><div><span>ذمم عملاء</span><b>${fmtMoney(ar.reduce((s,x)=>s+x.total,0))}</b></div><div><span>ذمم موردين</span><b>${fmtMoney(ap.reduce((s,x)=>s+x.total,0))}</b></div></div></article>`;
    if(tab==='cheques'){const issueCompany=validCompany==='all'?'group':validCompany;body=`<article class="list-item"><h3>إصدار شيك مصرفي</h3><div class="company-transfer-form"><label>الشركة<select id="chequeCompany">${['group',...(state.openedCompanies||[])].filter((v,i,a)=>a.indexOf(v)===i).map(t=>`<option value="${t}" ${t===issueCompany?'selected':''}>${esc(companyFinanceName(t))}</option>`).join('')}</select></label><label>المبلغ<input id="chequeAmount" type="number" min="1" step="1000" value="1000000"></label><label>المستفيد<select id="chequeBeneficiary">${strategicPartners.map(p=>`<option value="${esc(p.legalName||p.name)}">${esc(p.name)} · ${esc(p.service)}</option>`).join('')}</select></label><label>البيان<input id="chequeNote" maxlength="72" value="سداد موردين"></label></div><div class="action-row"><button class="primary-btn create-cheque-doc">إصدار الشيك</button></div></article>${cheques.length?`<div class="doc-art-grid">${cheques.map(chequeArt).join('')}</div>`:'<div class="empty">لا توجد شيكات لهذا الكيان.</div>'}`;}
    if(tab==='invoices'){const issueCompany=validCompany==='all'?'group':validCompany;body=`<article class="list-item"><h3>إنشاء فاتورة / مطالبة</h3><p>إنشاء الفاتورة لا يحرك النقد تلقائيًا؛ تسجل كذمة حتى التحصيل أو السداد.</p><div class="company-transfer-form"><label>الشركة<select id="invoiceCompany">${['group',...(state.openedCompanies||[])].filter((v,i,a)=>a.indexOf(v)===i).map(t=>`<option value="${t}" ${t===issueCompany?'selected':''}>${esc(companyFinanceName(t))}</option>`).join('')}</select></label><label>النوع<select id="invoiceKind"><option value="دخل">فاتورة عميل</option><option value="مصروف">فاتورة مورد</option></select></label><label>المبلغ الإجمالي<input id="invoiceAmount" type="number" min="1" step="1000" value="1000000"></label><label>الطرف المقابل<select id="invoiceCounterparty">${strategicPartners.map(p=>`<option value="${esc(p.legalName||p.name)}">${esc(p.name)}</option>`).join('')}</select></label><label>الوصف<input id="invoiceNote" maxlength="80" value="خدمات تشغيلية"></label></div><div class="action-row"><button class="primary-btn create-invoice-doc">إصدار الفاتورة</button></div></article>${docs.length?`<div class="doc-art-grid">${docs.slice(0,80).map(invoiceArt).join('')}</div>`:'<div class="empty">لا توجد فواتير لهذا الكيان.</div>'}`;}
    if(tab==='transfers')body=transfers.length?`<div class="doc-art-grid">${transfers.map(transferArt).join('')}</div>`:'<div class="empty">لا توجد تحويلات مسجلة.</div>';
    if(tab==='receivables')body=`${ar.length?`<article class="list-item"><h3>ذمم العملاء</h3>${ar.map(x=>`<div class="department-row"><span>${esc(x.number)}<small>${esc(x.note)} · ${esc(companyFinanceName(x.company||'group'))}</small></span><button class="secondary-btn collect-receivable" data-number="${x.number}">تحصيل</button></div>`).join('')}</article>`:''}${ap.length?`<article class="list-item"><h3>ذمم الموردين</h3>${ap.map(x=>`<div class="department-row"><span>${esc(x.number)}<small>${esc(x.note)} · ${esc(companyFinanceName(x.company||'group'))}</small></span><button class="secondary-btn settle-payable" data-number="${x.number}">سداد</button></div>`).join('')}</article>`:''}${!ar.length&&!ap.length?'<div class="empty">لا توجد ذمم مفتوحة.</div>':''}`;
    const companyOptions=['all','group',...(state.openedCompanies||[])].filter((v,i,a)=>a.indexOf(v)===i).map(t=>`<option value="${t}" ${t===validCompany?'selected':''}>${t==='all'?'كل الشركات':esc(companyFinanceName(t))}</option>`).join('');
    return `<div class="list"><article class="list-item"><div class="list-item-head"><div><h3>مركز المستندات المالية</h3><p>شيكات وفواتير وتحويلات وذمم منفصلة حسب الكيان القانوني، بتنسيق مناسب لشاشة iPhone.</p></div><span class="tag positive">DOCS</span></div><label>الكيان<select id="financeDocsCompany">${companyOptions}</select></label><div class="finance-doc-tabs">${tabs.map(([id,label])=>`<button class="finance-doc-tab ${tab===id?'active':''}" data-tab="${id}" data-company="${validCompany}">${label}</button>`).join('')}</div></article>${body}</div>`;
  }



  function renderAssetManage(id){
    const a=state.assets.find(x=>x.id===id); if(!a)return '<div class="empty">الأصل غير موجود.</div>';
    normalizeAsset(a); const tpl=routeTemplates[a.routeId];
    const eco=a.lastTrip;
    const cat=catalogItem(a.type,a.catalogId);
    return `<div class="list"><article class="list-item sector-${a.type}">
    ${cat&&cat.photo?`<div class="asset-thumb"><img src="${cat.photo}" alt="${a.name}" loading="lazy"></div>`:''}
    <div class="list-item-head"><div><h3>${a.icon} ${a.name}</h3><p>${a.model||typeName(a.type)} · سنة ${a.year||2026}</p></div><span class="tag">حالة ${a.condition.toFixed(1)}%</span></div><div class="metric-row"><div><span>الوقود</span><b>${Math.round(a.fuel)}%</b></div><div><span>المسار</span><b>${tpl?tpl.name:'غير معين'}</b></div><div><span>الوضع</span><b>${assetStatus(a)}</b></div></div><div class="metric-row"><div><span>الملكية</span><b>${a.ownership==='lease'?'تأجير تشغيلي':a.ownership==='finance'?'تمويل':'مملوك'}</b></div><div><span>القيمة الأصلية</span><b>${fmtMoney(a.purchasePrice||cat?.price||0)}</b></div><div><span>الالتزام الشهري</span><b>${a.ownership==='lease'?fmtMoney(a.monthlyLease):'—'}</b></div></div></article>
    ${eco?`<article class="list-item"><h3>تفصيل آخر دورة تشغيل</h3><div class="metric-row"><div><span>الإيراد</span><b class="positive">${fmtMoney(eco.revenue)}</b></div><div><span>الوقود</span><b class="negative">-${fmtMoney(eco.fuelCost)}</b></div><div><span>الطاقم</span><b class="negative">-${fmtMoney(eco.crewCost)}</b></div></div><div class="metric-row two" style="margin-top:6px"><div><span>احتياطي صيانة</span><b class="negative">-${fmtMoney(eco.maintReserve)}</b></div><div><span>الهامش الصافي</span><b class="${eco.margin>=0?'positive':'negative'}">${fmtMoney(eco.margin)}</b></div></div></article>`:''}
    <div class="action-row"><button class="primary-btn" data-open="routes">فتح مركز المسارات</button><button class="secondary-btn service-asset" data-id="${a.id}" ${a.phase==='moving'?'disabled':''}>صيانة وتعبئة</button><button class="secondary-btn" data-ai-prompt="حلل الأصل ${esc(a.name)} وحالته ${a.condition.toFixed(1)}% ومساره ${tpl?esc(tpl.name):'غير معين'}">تحليل GH AI</button><button class="danger-soft sell-asset" data-id="${a.id}" ${a.salePending?'disabled':''}>${a.salePending?'أمر البيع قيد العودة':'بيع الأصل'}</button></div>${a.salePending?'<p class="warning">أمر البيع نشط: سيكمل الأصل الرحلة الحالية فقط، ثم يتوقف في مركز/قاعدة الوصول ويباع تلقائيًا. لن يتم البيع أثناء الرحلة.</p>':a.phase==='moving'?'<p class="warning">الصيانة وتغيير المسار مقفلان أثناء الحركة. يمكنك إصدار أمر بيع وسيتم التنفيذ تلقائيًا بعد الوصول.</p>':''}</div>`;
  }
  function renderAssignRoute(id){
    const a=state.assets.find(x=>x.id===id);if(!a)return '<div class="empty">الأصل غير موجود.</div>';
    const routes=Object.values(routeTemplates).filter(r=>r.type===a.type);
    const globalRouteAction=['air','sea'].includes(a.type)?`<article class="list-item registry-hero"><div class="list-item-head"><div><h3>${a.type==='air'?'مطارات العالم':'موانئ العالم'} بلا قيود قواعد</h3><p>ابدأ من موقع ${esc(routeEndpointName(routeOriginForAsset(a)))} واختر أي ${a.type==='air'?'مطار':'ميناء'} عام في الدليل العالمي. فتح قاعدة في الوجهة ليس شرطًا للتشغيل.</p></div><span class="tag positive">GLOBAL</span></div><div class="action-row"><button class="primary-btn choose-global-destination" data-asset="${a.id}">اختيار وجهة عالمية</button></div></article>`:'';
    return `<div class="list"><article class="list-item"><h3>${a.icon} ${a.name}</h3><p>اختر مسارًا متوافقًا مع نوع الأصل. المسافة والوقت محسوبان من هندسة المسار وسرعته التشغيلية.</p></article>${globalRouteAction}${routes.map(r=>{
      const demand = r.cargoDemand ? `<div class="metric-row two" style="margin-top:6px"><div><span>طلب جاف</span><b>${fmtNumber(r.cargoDemand.dry)} TEU</b></div><div><span>طلب مبرّد</span><b>${fmtNumber(r.cargoDemand.reefer)} TEU</b></div></div>` : '';
      const technical=r.technicalStops?.length?`<p>توقفات تقنية عامة: ${r.technicalStops.map(stop=>esc(stop.city||stop.code)).join(' ← ')}.</p>`:'';
      const maritime=r.type==='sea'&&r.publicAccess?'<p>يتبع المسار ممرات بحرية عالمية تقديرية داخل المحاكاة.</p>':'';
      return `<article class="list-item"><div class="list-item-head"><div><h3>${r.name}</h3><p>${fmtNumber(r.distanceKm)} كم · ${formatDuration(r.tripSeconds)}</p></div><span class="tag">${a.type==='sea'?`${(r.effectiveSpeedKmh/1.852).toFixed(1)} عقدة`:`${fmtNumber(r.effectiveSpeedKmh)} كم/س`}</span></div>${demand}${technical}${maritime}<div class="action-row"><button class="primary-btn choose-route" data-asset="${a.id}" data-route="${r.id}">تعيين وتشغيل</button></div></article>`;
    }).join('')}</div>`;
  }

  function bindDrawerActions(){
    // AI is a strict, dedicated workspace: contextual screens must not expose
    // prompts or shortcuts into it.
    if(activeDrawerPanel!=='intelligence')document.querySelectorAll('[data-ai-prompt]').forEach(button=>button.remove());
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
    document.querySelectorAll('.open-branch').forEach(b=>b.addEventListener('click',()=>openBranch(b.dataset.id)));
    document.querySelectorAll('.open-global-base').forEach(b=>b.addEventListener('click',()=>openGlobalBase(b.dataset.key)));
    document.querySelectorAll('.open-global-route').forEach(b=>b.addEventListener('click',()=>openDrawer('globalRoute',{destinationKey:b.dataset.key})));
    document.querySelectorAll('.open-global-route-center').forEach(b=>b.addEventListener('click',()=>{globalRouteQuery='';openDrawer('globalRoute',{assetId:b.dataset.asset});}));
    document.querySelectorAll('.mobility-open-capital-center').forEach(b=>b.addEventListener('click',()=>openMobilityCapitalCenter(b.dataset.capital)));
    document.querySelectorAll('.world-focus').forEach(b=>b.addEventListener('click',()=>focusWorldEntity(b.dataset.key)));
    document.querySelectorAll('.place-logistics').forEach(b=>b.addEventListener('click',startHubPlacement));
    document.querySelectorAll('.place-global-base').forEach(b=>b.addEventListener('click',startBasePlacement));
    document.querySelectorAll('.build-road-route').forEach(b=>b.addEventListener('click',createRoadRouteFromForm));
    document.querySelectorAll('.start-road-route').forEach(b=>b.addEventListener('click',startRoadRoutePlacement));
    document.querySelectorAll('.suggest-routes').forEach(b=>b.addEventListener('click',()=>suggestRoutesOnly()));
    document.querySelectorAll('.depart-all-assets').forEach(b=>b.addEventListener('click',()=>{departRouteAssets(null,null);openDrawer('routes');}));
    document.querySelectorAll('.manual-buy-asset').forEach(b=>b.addEventListener('click',()=>manualPurchaseFromCard(b)));
    document.querySelectorAll('[data-assign]').forEach(b=>b.addEventListener('click',()=>openDrawer('assignRoute',b.dataset.assign)));
    document.querySelectorAll('.choose-global-destination').forEach(b=>b.addEventListener('click',()=>{globalRouteQuery='';openDrawer('globalRoute',{assetId:b.dataset.asset});}));
    document.querySelectorAll('.create-global-route').forEach(b=>b.addEventListener('click',()=>createGlobalRoute(b.dataset.asset,b.dataset.key)));
    document.querySelectorAll('.choose-route').forEach(b=>b.addEventListener('click',()=>assignRoute(b.dataset.asset,b.dataset.route)));
    document.querySelectorAll('.service-asset').forEach(b=>b.addEventListener('click',()=>serviceAsset(b.dataset.id)));
    document.querySelectorAll('.depart-now').forEach(b=>b.addEventListener('click',()=>departNow(b.dataset.id)));
    document.querySelectorAll('.depart-route').forEach(b=>b.addEventListener('click',()=>{departRouteAssets(b.dataset.route,b.dataset.type||'road');openDrawer('routes');}));
    document.querySelectorAll('.sell-asset').forEach(b=>b.addEventListener('click',()=>sellAsset(b.dataset.id)));
    document.querySelectorAll('.sell-all-assets').forEach(b=>b.addEventListener('click',()=>sellAllAssets(b.dataset.type)));
    document.querySelectorAll('.reset-save').forEach(b=>b.addEventListener('click',async()=>{await hardResetGame();}));
    document.querySelectorAll('.new-game-direct').forEach(b=>b.addEventListener('click',async event=>{event.preventDefault();event.stopPropagation();b.disabled=true;try{await hardResetGame();}finally{b.disabled=false;}}));
    document.querySelectorAll('.add-credit').forEach(b=>b.addEventListener('click',()=>{try{window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','raise-debt',{company:'group',amount:50000000,note:'تفعيل خط ائتمان للمجموعة',liabilityAccount:'تسهيلات ائتمانية مستحقة'},{actor:'finance-ui'});pushAlert('تم تفعيل خط ائتمان بقيمة $50M على المجموعة.');save();updateKpis();openDrawer('finance');}catch(error){notice(`تعذر تفعيل الائتمان: ${error.message}`);}}));
    document.querySelectorAll('.issue-bond').forEach(b=>b.addEventListener('click',()=>{try{window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','raise-debt',{company:'group',amount:100000000,note:'إصدار سندات لخمس سنوات',liabilityAccount:'سندات مستحقة الدفع',lender:'حملة السندات'},{actor:'finance-ui'});pushAlert(`أصدرت المجموعة سندات لخمس سنوات بقيمة $100M وفق التصنيف ${state.profile.creditRating}.`);save();updateKpis();openDrawer('finance');}catch(error){notice(`تعذر إصدار السندات: ${error.message}`);}}));
    document.querySelectorAll('.launch-ipo').forEach(b=>b.addEventListener('click',()=>{if(state.ipo.listed||state.groupValue<1000000000)return;try{const ticker=(state.profile.shortName||'GH').toUpperCase(),proceeds=state.groupValue*.18;window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','raise-equity',{company:'group',amount:proceeds,note:'متحصلات الطرح العام الأولي',equityAccount:'رأس مال وعلاوة إصدار',source:'مستثمرو الطرح العام'},{actor:'finance-ui'});window.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','set-ipo',{listed:true,ticker},{actor:'finance-ui'});window.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','adjust-group-value',{delta:state.groupValue*.12},{actor:'finance-ui'});pushAlert(`اكتمل الطرح العام للمجموعة بالرمز ${ticker} وجمعت ${fmtMoney(proceeds)}.`);save();updateKpis();openDrawer('finance');}catch(error){notice(`تعذر الطرح: ${error.message}`);}}));
    document.querySelectorAll('.repay-debt').forEach(b=>b.addEventListener('click',()=>{const groupDebt=Number(companyBook('group').debt)||0,amount=Math.min(25000000,groupDebt);if(amount<=0){pushAlert('لا يوجد دين على الشركة القابضة للسداد.');return;}try{const r=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','repay-debt',{company:'group',amount,note:'سداد أصل دين'},{actor:'finance-ui'}).result;pushAlert(`تم سداد ${fmtMoney(r.amount)} من دين الشركة القابضة.`);save();updateKpis();openDrawer('finance');}catch(error){notice(`تعذر سداد الدين: ${error.message}`);}}));
    document.querySelectorAll('.treasury-transfer').forEach(b=>b.addEventListener('click',treasuryTransfer));
    document.querySelectorAll('.treasury-statement').forEach(b=>b.addEventListener('click',treasuryStatement));
    document.querySelectorAll('.collect-receivable').forEach(b=>b.addEventListener('click',()=>collectReceivable(b.dataset.number)));
    document.querySelectorAll('.settle-payable').forEach(b=>b.addEventListener('click',()=>settlePayable(b.dataset.number)));
    document.querySelectorAll('.pay-taxes').forEach(b=>b.addEventListener('click',()=>payTaxes(b.dataset.company||'group')));
    document.querySelectorAll('.view-invoices').forEach(b=>b.addEventListener('click',()=>viewInvoices(b.dataset.company||'all')));
    document.querySelectorAll('.finance-entity-docs').forEach(b=>b.addEventListener('click',()=>openDrawer('invoices',{company:b.dataset.company||'all',tab:'all'})));
    document.querySelectorAll('.finance-doc-tab').forEach(b=>b.addEventListener('click',()=>openDrawer('invoices',{company:b.dataset.company||'all',tab:b.dataset.tab||'all'})));
    const docsCompany=$('financeDocsCompany');if(docsCompany)docsCompany.addEventListener('change',()=>openDrawer('invoices',{company:docsCompany.value,tab:'all'}));
    document.querySelectorAll('.create-cheque-doc').forEach(btn=>btn.addEventListener('click',()=>{const company=$('chequeCompany')?.value||'group',amount=Number($('chequeAmount')?.value)||0,beneficiary=($('chequeBeneficiary')?.value||'').trim(),note=($('chequeNote')?.value||'سداد موردين').trim();if(amount<=0){notice('أدخل مبلغ شيك صالحًا.');return;}const id=issueCheque(amount,note,beneficiary,company);if(id)openDrawer('invoices',{company,tab:'cheques'});}));
    document.querySelectorAll('.create-invoice-doc').forEach(btn=>btn.addEventListener('click',()=>{const company=$('invoiceCompany')?.value||'group',kind=$('invoiceKind')?.value==='مصروف'?'مصروف':'دخل',amount=Number($('invoiceAmount')?.value)||0,note=($('invoiceNote')?.value||'خدمات تشغيلية').trim();if(amount<=0){notice('أدخل مبلغ فاتورة صالحًا.');return;}postInvoice(kind,amount,note,kind==='دخل'?'تحويل عميل':'تحويل بنكي',true,'مستحقة',company,$('invoiceCounterparty')?.value||'');pushAlert(`تم إصدار ${kind==='دخل'?'فاتورة عميل':'فاتورة مورد'} على ${companyFinanceName(company)} بقيمة ${fmtMoney(amount)}.`);save();openDrawer('invoices',{company,tab:'invoices'});}));
    document.querySelectorAll('.company-reserve-transfer').forEach(b=>b.addEventListener('click',()=>{const company=b.dataset.company||'group',toReserve=b.dataset.direction!=='operating';if(!transferWithinCompany(company,1000000,toReserve)){notice('الرصيد غير كافٍ لهذه الحركة الداخلية.');return;}pushAlert(`${companyFinanceName(company)}: ${toReserve?'تم تحويل $1M إلى الاحتياطي':'تمت إعادة $1M إلى الحساب الجاري'}.`);save();openDrawer('finance');}));
    document.querySelectorAll('.company-transfer-submit').forEach(b=>b.addEventListener('click',()=>{const from=$('companyTransferFrom')?.value,to=$('companyTransferTo')?.value,amount=Number($('companyTransferAmount')?.value)||0;if(from===to){notice('اختر شركتين مختلفتين للتحويل.');return;}if(!transferBetweenCompanies(from,to,amount,`تمويل داخلي من ${companyFinanceName(from)} إلى ${companyFinanceName(to)}`)){notice('تعذر التحويل: تحقق من المبلغ ورصيد الحساب المصدر.');return;}pushAlert(`تم تحويل ${fmtMoney(amount)} من ${companyFinanceName(from)} إلى ${companyFinanceName(to)}.`);save();updateKpis();openDrawer('finance');}));
    const bulkInputs=[...document.querySelectorAll('.bulk-transfer-amount')];
    const refreshBulkTotal=()=>{const total=bulkInputs.reduce((n,i)=>n+(Math.max(0,Number(i.value)||0)),0),el=$('bulkTransferTotal');if(el)el.textContent=fmtMoney(total);return total;};
    bulkInputs.forEach(i=>i.addEventListener('input',refreshBulkTotal));refreshBulkTotal();
    document.querySelectorAll('.bulk-transfer-equal').forEach(b=>b.addEventListener('click',()=>{const pool=Math.max(0,Number($('bulkTransferPool')?.value)||0);if(!bulkInputs.length)return;const each=Math.floor(pool/bulkInputs.length/1000)*1000;let used=0;bulkInputs.forEach((i,idx)=>{const val=idx===bulkInputs.length-1?Math.max(0,pool-used):each;i.value=Math.round(val);used+=val;});refreshBulkTotal();}));
    document.querySelectorAll('.bulk-transfer-needs').forEach(b=>b.addEventListener('click',()=>{const pool=Math.max(0,Number($('bulkTransferPool')?.value)||0);if(!bulkInputs.length)return;const rows=bulkInputs.map(i=>{const t=i.dataset.company,bud=companyBudget(t),remaining=companyBudgetRemaining(t),cash=companyOperatingBalance(t),operatingFloor=5000000+(state.assets||[]).filter(a=>a.type===t).length*350000,need=Math.max(250000,operatingFloor-cash)+(Number.isFinite(remaining)?Math.max(0,remaining)*.18:0);return {i,need};});const totalNeed=rows.reduce((n,x)=>n+x.need,0)||rows.length;let used=0;rows.forEach((x,idx)=>{const val=idx===rows.length-1?Math.max(0,pool-used):Math.floor(pool*x.need/totalNeed/1000)*1000;x.i.value=Math.round(val);used+=val;});refreshBulkTotal();}));
    document.querySelectorAll('.bulk-transfer-submit').forEach(b=>b.addEventListener('click',()=>{const rows=bulkInputs.map(i=>({company:i.dataset.company,amount:Number(i.value)||0})).filter(x=>x.amount>0),result=bulkTransferFromGroup(rows);if(!result.ok){notice(result.reason||'تعذر تنفيذ التوزيع الجماعي.');return;}pushAlert(`تم توزيع ${fmtMoney(result.total)} من القابضة على ${result.count} شركة · ${result.batchId}.`);save();updateKpis();openDrawer('finance');}));
    document.querySelectorAll('.issue-cheque').forEach(b=>b.addEventListener('click',()=>{const company=b.dataset.company||'group';if(!canCompanySpend(company,1000000)){notice(`رصيد حساب ${companyFinanceName(company)} غير كافٍ لإصدار الشيك.`);return;}issueCheque(1000000,'سداد موردين دوري',supplierFor('all','parts')?.legalName||supplierFor('all','parts')?.name||'SecureParts Consortium AG',company);openDrawer('invoices',{company,tab:'cheques'});}));
    document.querySelectorAll('.sign-contract').forEach(b=>b.addEventListener('click',()=>signContract(b.dataset.id)));
    document.querySelectorAll('[data-companytab]').forEach(b=>b.addEventListener('click',()=>openDrawer('companies',b.dataset.companytab)));
    document.querySelectorAll('[data-labortab]').forEach(b=>b.addEventListener('click',()=>openDrawer('labor',b.dataset.labortab)));
    document.querySelectorAll('.crew-raise').forEach(b=>b.addEventListener('click',()=>adjustCrew(b.dataset.id,.06)));
    document.querySelectorAll('.crew-cut').forEach(b=>b.addEventListener('click',()=>adjustCrew(b.dataset.id,-.03)));
    document.querySelectorAll('.manage-sector').forEach(b=>b.addEventListener('click',()=>openDrawer(b.dataset.type==='power'?'energy':b.dataset.type==='bank'?'bank':'assets',b.dataset.type)));
    document.querySelectorAll('.open-company').forEach(b=>b.addEventListener('click',()=>openCompany(b.dataset.type)));
    document.querySelectorAll('[data-markettype]').forEach(b=>b.addEventListener('click',()=>{marketFilterType=b.dataset.markettype;marketSegment='all';marketCompare=[];renderAssetMarketInto();}));
    document.querySelectorAll('[data-markettab]').forEach(b=>b.addEventListener('click',()=>{marketFilterTab=b.dataset.markettab;marketSegment='all';marketCompare=[];renderAssetMarketInto();}));
    const assetSearch=$('assetSearch');if(assetSearch)assetSearch.addEventListener('input',e=>{marketQuery=e.target.value;clearTimeout(worldSearchTimer);worldSearchTimer=setTimeout(()=>renderAssetMarketInto(true),180);});
    const assetSegment=$('assetSegment');if(assetSegment)assetSegment.addEventListener('change',e=>{marketSegment=e.target.value;renderAssetMarketInto();});
    const worldSearch=$('worldSearch');if(worldSearch)worldSearch.addEventListener('input',e=>{worldQuery=e.target.value;clearTimeout(worldSearchTimer);worldSearchTimer=setTimeout(()=>renderWorldNetworkInto(true),180);});
    const worldKindSelect=$('worldKind');if(worldKindSelect)worldKindSelect.addEventListener('change',e=>{worldKind=e.target.value;renderWorldNetworkInto();});
    const globalRouteSearch=$('globalRouteSearch');if(globalRouteSearch)globalRouteSearch.addEventListener('input',e=>{globalRouteQuery=e.target.value;clearTimeout(globalRouteSearchTimer);globalRouteSearchTimer=setTimeout(()=>renderGlobalRouteInto(activeDrawerArg?.assetId,true),180);});
    document.querySelectorAll('.energy-build').forEach(b=>b.addEventListener('click',()=>buildEnergy(b.dataset.kind)));
    document.querySelectorAll('.bank-branch').forEach(b=>b.addEventListener('click',openBankBranch));
    document.querySelectorAll('.bank-loan').forEach(b=>b.addEventListener('click',issueBankLoans));
    document.querySelectorAll('.board-approve').forEach(b=>b.addEventListener('click',()=>setBoardDecision('approved')));
    document.querySelectorAll('.board-defer').forEach(b=>b.addEventListener('click',()=>setBoardDecision('deferred')));
    document.querySelectorAll('.buy-insurance').forEach(b=>b.addEventListener('click',()=>buyInsurance(b.dataset.sector)));
    document.querySelectorAll('.fund-research').forEach(b=>b.addEventListener('click',()=>fundResearch(b.dataset.project)));
    document.querySelectorAll('.esg-invest').forEach(b=>b.addEventListener('click',investESG));
    document.querySelectorAll('.company-name-save').forEach(btn=>btn.addEventListener('click',()=>{const type=btn.dataset.company,input=document.querySelector(`.company-name-input[data-company=\"${type}\"]`),name=String(input?.value||'').trim();if(!type||name.length<2){notice('أدخل اسمًا صالحًا للشركة.');return;}const oldName=companyFinanceName(type);try{window.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','rename-company',{type,legalName:name},{actor:'identity'});pushAlert(`تم تغيير اسم ${oldName} إلى ${name}. جميع المستندات والقيود تعرض الاسم الجديد تلقائيًا.`);save();updateKpis();type==='group'?openDrawer('companies','holding'):openDrawer('companyManage',{type,tab:'overview'});}catch(error){notice(`تعذر تغيير الاسم: ${error.message}`);}}));
    document.querySelectorAll('.company-logo-upload input').forEach(input=>input.addEventListener('change',async()=>{const type=input.dataset.company;if(!type||!input.files?.[0])return;try{const data=await compressLogoFile(input.files[0]);window.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','set-logo',{type,logo:data},{actor:'identity'});pushAlert(`تم تحديث شعار ${companyFinanceName(type)}؛ جميع المستندات التاريخية ستعرض الهوية الجديدة تلقائيًا.`);save();type==='group'?openDrawer('companies','holding'):openDrawer('companyManage',{type,tab:'overview'});}catch(error){notice(error.message||'تعذر معالجة الشعار.');}}));
    document.querySelectorAll('.company-logo-clear').forEach(btn=>btn.addEventListener('click',()=>{const type=btn.dataset.company;try{window.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','set-logo',{type,logo:null},{actor:'identity'});save();type==='group'?openDrawer('companies','holding'):openDrawer('companyManage',{type,tab:'overview'});}catch(error){notice(`تعذر إزالة الشعار: ${error.message}`);}}));
    if(window.GH_ADVANCED)window.GH_ADVANCED.bind(document,advancedContext());
    window.GH_UI_QUALITY?.enhance?.($('drawerBody'),{panel:activeDrawerPanel,state});
  }
  function renderAssetMarketInto(restoreFocus=false){
    $('drawerBody').innerHTML=`<div class="list">${renderAssetMarketBody(marketFilterType,marketFilterTab)}</div>`; bindDrawerActions();
    if(restoreFocus){const input=$('assetSearch');input?.focus();input?.setSelectionRange(input.value.length,input.value.length);}
  }

  function buildEnergy(kind,opts={}){
    return runBusinessOperation('buildEnergy',()=>{
    const projects={solar:{cost:82000000,key:'solarMW',amount:100,name:'محطة شمسية 100MW'},wind:{cost:145000000,key:'windMW',amount:120,name:'مزرعة رياح 120MW'},storage:{cost:64000000,key:'storageMWh',amount:500,name:'بطاريات تخزين 500MWh'}};const p=projects[kind];if(!p)return false;const build=awardConstruction('power','power',p.name,p.cost);if(!build||build.insufficient){if(!opts.silent)notice('رصيد شركة الطاقة لا يغطي عرض EPC الأفضل.');return false;}
    try{window.GH_DOMAIN_COMMANDS.dispatch({state},'procurement','configure-construction',{id:build.id,capacityKey:p.key,capacityAmount:p.amount,energyKind:kind,commissioned:false},{actor:'energy-development'});window.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','adjust-group-value',{delta:build.amount*.38},{actor:'energy-development'});pushAlert(`أرسى عقد ${p.name} على ${build.contractor}. القدرة لا تضاف قبل Commissioning.`);save();updateKpis();if(!opts.silent)openDrawer('energy');return true;}catch(error){notice(`تعذر اعتماد مشروع الطاقة: ${error.message}`);return false;}

    });
  }
  function openBankBranch(opts={}){
    return runBusinessOperation('openBankBranch',()=>{const baseCost=15000000,build=awardConstruction('bank','bank',`فرع بنك المجموعة #${Number(state.bank?.branches||0)+1}`,baseCost);if(!build||build.insufficient){if(!opts.silent)notice('رصيد حساب البنك لا يغطي تجهيز الفرع.');return false;}try{const branches=window.GH_DOMAIN_COMMANDS.dispatch({state},'banking','open-branch',{depositSeed:70000000},{actor:'bank-expansion'}).result;window.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','adjust-group-value',{delta:build.amount*.7},{actor:'bank-expansion'});ensureFacilityWorkforce('bank','فتح فرع بنكي');pushAlert(`تم تجهيز الفرع رقم ${branches} بواسطة ${build.contractor}.`);save();updateKpis();if(!opts.silent)openDrawer('bank');return true;}catch(error){notice(`تعذر افتتاح الفرع: ${error.message}`);return false;}
    });
  }
  function issueBankLoans(){
    return runBusinessOperation('issueBankLoans',()=>{const amount=50000000,rb=state.realism?.banking||{},currentRwa=Math.max(1,Number(rb.rwa)||Number(state.bank.loans)||1),currentCet1=Number(rb.cet1)||Number(state.bank.capitalRatio)||16.4,capital=currentRwa*currentCet1/100,projectedRwa=currentRwa+amount*.72,projectedCet1=capital/projectedRwa*100,projectedLdr=(Number(state.bank.loans||0)+amount)/Math.max(1,Number(state.bank.deposits)||1)*100;if(projectedCet1<13){notice(`رفض التمويل: CET1 المتوقع ${projectedCet1.toFixed(1)}% أقل من الحد الداخلي 13%. عزز رأس مال البنك أولًا.`);return;}if(projectedLdr>95){notice(`رفض التمويل: القروض/الودائع سترتفع إلى ${projectedLdr.toFixed(0)}%. عزز الودائع أو التمويل المستقر أولًا.`);return;}try{window.GH_DOMAIN_COMMANDS.dispatch({state},'banking','fund-loan-portfolio',{amount},{actor:'bank-credit'});window.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','adjust-group-value',{delta:amount*.92},{actor:'bank-credit'});pushAlert(`اعتمد بنك المجموعة محفظة ${fmtMoney(amount)} بعد اختبار رأس المال والسيولة. CET1 المتوقع ${projectedCet1.toFixed(1)}%.`);save();updateKpis();openDrawer('bank');}catch(error){notice(`رفض تمويل المحفظة: ${error.message}`);}
    });
  }
  function setBoardDecision(status){try{const res=window.GH_DOMAIN_COMMANDS.dispatch({state},'governance','board-decision',{status},{actor:'board'}).result;pushAlert(status==='approved'?(res.highRisks?`اعتمد المجلس البرنامج اعتمادًا مشروطًا مع ${res.highRisks} مخاطر مرتفعة يجب متابعتها.`:'اعتمد مجلس الإدارة برنامج التوسع الاستراتيجي دون تحفظات مرتفعة.'):`أحال مجلس الإدارة برنامج التوسع إلى مراجعة المخاطر${res.highRisks?` بسبب ${res.highRisks} حالة مرتفعة`:''}.`);save();openDrawer('governance');}catch(error){notice(`تعذر تسجيل قرار المجلس: ${error.message}`);}}
  function insuranceQuote(sector){const assets=state.assets.filter(a=>a.type===sector),exposure=assets.reduce((n,a)=>n+(Number(a.purchasePrice)||0)*Math.max(.45,(Number(a.condition)||100)/100),0),renewal=Number(state.realism?.insurance?.renewalIndex)||100,base=Math.max(750000,exposure*.0035);return Math.round(base*(renewal/100)/10000)*10000;}
  function buyInsurance(sector){const cost=insuranceQuote(sector);try{window.GH_DOMAIN_COMMANDS.dispatch({state},'governance','insurance-policy',{sector,premium:cost,renewalIndex:Number(state.realism?.insurance?.renewalIndex)||100,deductiblePct:.02,coveragePct:.92},{actor:'risk'});pushAlert(`تم تفعيل وثيقة ${typeName(sector)} بقسط ${fmtMoney(cost)} وحد تحمل 2% وتغطية أساسية 92%.`);save();updateKpis();openDrawer('insurance');}catch(error){if(String(error.message).includes('policy-exists'))pushAlert(`قطاع ${typeName(sector)} مغطى بوثيقة تأمين بالفعل.`);else notice(`تعذر إصدار الوثيقة: ${error.message}`);}}
  function fundResearch(project){
    return runBusinessOperation('fundResearch',()=>{const cost=25000000;if(!Object.prototype.hasOwnProperty.call(state.research,project)){pushAlert('مشروع البحث غير معروف.');return;}if(state.research[project]>=100){pushAlert('اكتمل هذا المشروع بالفعل بنسبة 100%.');openDrawer('research');return;}try{const result=window.GH_DOMAIN_COMMANDS.dispatch({state},'governance','research-fund',{project,cost,progress:25},{actor:'research'}).result;const meta=state.advanced?.researchPrograms?.[project];if(result.progress>=100&&meta)window.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','adjust-group-value',{delta:Number(meta.spent||0)*.35},{actor:'research'});pushAlert(result.progress>=100?`اكتمل مشروع ${project} ودخل التشغيل. الأثر سيظهر داخل تكاليف التشغيل والمحاكاة بدل زيادة رقمية منفصلة.`:`تم تمويل مرحلة البحث. تقدم المشروع ${result.progress}% وإنفاقه المتراكم ${fmtMoney(meta?.spent||cost)}.`);save();updateKpis();openDrawer('research');}catch(error){notice(`تعذر تمويل البحث: ${error.message}`);}
    });
  }
  function investESG(){
    return runBusinessOperation('investESG',()=>{const cost=10000000;try{window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','spend',{company:'group',amount:cost,note:'برنامج ESG مؤسسي',method:'تحويل بنكي',line:'other'},{actor:'esg'});window.GH_DOMAIN_COMMANDS.dispatch({state},'governance','esg-invest',{environment:4,social:2,governance:1},{actor:'esg'});pushAlert('تم تنفيذ برنامج ESG جديد وتحسنت السمعة المؤسسية.');save();updateKpis();openDrawer('esg');}catch(error){notice(`تعذر تنفيذ برنامج ESG: ${error.message}`);}
    });
  }

  function inspectContract(id){const c=contracts.find(x=>x.id===id);if(!c){pushAlert('تعذر فتح تفاصيل هذه المناقصة؛ قد تكون تغيّرت. أعد فتح قسم العقود.');return;}notice(`${c.name}\n\nقيمة العقد: ${fmtMoney(c.value)}\nالتكلفة المتوقعة: ${fmtMoney(c.cost)}\nهامش كامل: ${fmtMoney(c.value-c.cost)}\nSLA: ${c.sla}\nالقدرة المطلوبة: ${c.capacity}\nالغرامات: ${c.penalty}`);}
  function hasContractCapacity(contract){
    if(contract.sector==='power') return facilities.some(f=>f.kind==='power'&&f.owned);
    if(contract.sector==='bank') return facilities.some(f=>f.kind==='bank'&&f.owned);
    return state.assets.some(a=>a.type===contract.sector&&a.condition>=65);
  }
  function bidContract(id){const c=contracts.find(x=>x.id===id);if(!c){pushAlert('تعذر تقديم العرض؛ المناقصة لم تعد متاحة. أعد فتح قسم العقود.');return;}if(state.acceptedContracts.includes(id)){pushAlert('هذه المناقصة موقّعة بالفعل ولا يمكن تقديم عرض جديد عليها.');return;}if(!hasContractCapacity(c)){notice(`لا يمكن تقديم العرض: المجموعة لا تملك قدرة تشغيلية صالحة في قطاع ${typeName(c.sector)}.`);return;}const reputation=.78+state.hired.length*.012+state.branches.length*.01,winChance=clamp(c.bidBase*reputation,.45,.93),won=simRandom('contract-bid')<winChance;try{window.GH_DOMAIN_COMMANDS.dispatch({state},'contracts','bid',{id,won,number:won?nextId('GH-CN'):null,client:c.client,sector:c.sector},{actor:'commercial'});pushAlert(won?`فازت المجموعة بمناقصة ${c.name}. العقد بانتظار توقيعك قبل بدء التشغيل.`:`لم يفز عرض المجموعة بمناقصة ${c.name}. المنافسون قدموا عرضًا أقوى هذه الجولة.`);save();openDrawer('contracts');}catch(error){notice(`تعذر تسجيل نتيجة المناقصة: ${error.message}`);}}
  function signContract(id){const c=contracts.find(x=>x.id===id);if(!c){pushAlert('تعذر توقيع هذا العقد؛ لم يعد متاحًا.');return;}try{const doc=window.GH_DOMAIN_COMMANDS.dispatch({state},'contracts','sign',{id,company:c.sector,sector:c.sector,deposit:Math.round(c.value*.1),name:c.name,client:c.client,taxable:true},{actor:'commercial'}).result;pushAlert(`تم توقيع ${doc.number} مع ${c.client} وتحويل الدفعة المقدمة إلى الحساب الجاري.`);save();updateKpis();openDrawer('contracts');}catch(error){notice(`تعذر توقيع العقد: ${error.message}`);}}
  function dueDiligence(id){const c=competitors.find(x=>x.id===id);if(!c){pushAlert('تعذر فتح ملف العناية الواجبة لهذه الشركة.');return;}const leverage=c.debt/Math.max(1,c.ebitda),margin=c.ebitda/Math.max(1,c.revenue),riskScore=Math.round((c.risk==='مرتفع'?68:c.risk==='متوسط'?42:24)+Math.min(22,leverage*6)-Math.min(12,margin*30)),synergy=Math.round(c.ebitda*(.08+((c.quality||80)/100)*.08));try{window.GH_DOMAIN_COMMANDS.dispatch({state},'market','due-diligence',{id,riskScore,score:riskScore,leverage,margin,synergy,quality:c.quality||80},{actor:'ma'});notice(`العناية الواجبة — ${c.name}\n\nقيمة المنشأة: ${fmtMoney(c.price)}\nEBITDA: ${fmtMoney(c.ebitda)}\nصافي الهامش التشغيلي: ${(margin*100).toFixed(1)}%\nالدين/EBITDA: ${leverage.toFixed(2)}x\nمؤشر المخاطر: ${riskScore}/100\nوفورات تكامل سنوية متوقعة: ${fmtMoney(synergy)}\n\nالخطوة التالية: بناء عرض ثم شراء حصة/سيطرة.`);save();}catch(error){notice(`تعذر إكمال العناية الواجبة: ${error.message}`);}}
  function acquireStake(id,target){const c=competitors.find(x=>x.id===id);if(!c){pushAlert('تعذر تنفيذ العملية؛ الشركة غير متاحة.');return;}const current=state.stakes[id]||0;if(target<=current){pushAlert(`المجموعة تملك بالفعل ${current}% من ${c.name}.`);return;}const deal=state.maDeals[id];if(!deal?.dd){dueDiligence(id);pushAlert('تم إعداد العناية الواجبة أولًا. راجع الملف ثم أعد تنفيذ العرض.');return;}const delta=target-current,premium=target>=51&&current<51?1.18:target>=100?1.12:1.06,riskAdj=1+(deal.dd.riskScore||40)/1000,cost=c.price*(delta/100)*premium*riskAdj;if(!ask(`عرض استحواذ على ${c.name}\n\nالحصة الجديدة: ${target}%\nالقيمة: ${fmtMoney(cost)}\nعلاوة/مخاطر مضمنة\nوفورات سنوية متوقعة: ${fmtMoney(deal.dd.synergy||0)}\n\nاعتماد العرض والإغلاق؟`))return;try{window.GH_DOMAIN_COMMANDS.dispatch({state},'market','acquire-stake',{id,name:c.name,stake:target,amount:cost,premium,synergy:deal.dd.synergy||0},{actor:'ma'});if(target>=51)ensureFacilityWorkforce('all',`دمج ${c.name}`);pushAlert(`${target>=51?'أغلقت صفقة السيطرة على':'تم الاستثمار في'} ${c.name}: ${target}%. بدأ برنامج التكامل التشغيلي.`);save();updateKpis();renderMap();openDrawer('ma');}catch(error){notice(`تعذر إغلاق الصفقة: ${error.message}`);}}

  function hire(id){const c=candidates.find(x=>x.id===id);if(!c){pushAlert('تعذر التوظيف؛ هذا المرشح لم يعد متاحًا.');return;}try{const center=findFacility('HQ-RUH')?.name||'المقر الرئيسي';window.GH_DOMAIN_COMMANDS.dispatch({state,candidates},'hr','hire-executive',{candidateId:id,company:'group',center,source:'استقطاب قيادة فردي'},{actor:'hr'});pushAlert(`انضم ${c.name} إلى المجموعة بمنصب ${c.role} بعقد عمل ساري وربط مالي بالمقر الرئيسي.`);save();openDrawer('labor','contracts');}catch(error){notice(`تعذر التوظيف: ${error.message}`);}}
  function tradeStock(sym,qty){try{const result=window.GH_DOMAIN_COMMANDS.dispatch({state},'market','trade-stock',{sym,qty},{actor:'market-ui'}).result;pushAlert(`${qty>0?'شراء':'بيع'} ${fmtNumber(Math.abs(qty))} سهم من ${sym} بقيمة ${fmtMoney(result.value)}.`);save();updateKpis();openDrawer('market');return true;}catch(error){notice(`تعذر تنفيذ الصفقة: ${error.message}`);return false;}}
  function openCompany(type){
    const company=companies.find(c=>c.id===type),cost={air:25000000,sea:30000000,road:12000000,power:55000000,bank:75000000,mobility:120000000}[type];if(!company||!cost){pushAlert('تعذر تأسيس هذه الشركة؛ القطاع غير معروف.');return;}if(state.openedCompanies.includes(type)){pushAlert(`${company.name} مؤسَّسة بالفعل.`);openDrawer('companies','subs');return;}const stamp=nextId('COMPANY').split('-').pop(),short=(state.profile.shortName||'GH').toUpperCase();
    try{window.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type,capital:cost,legalName:company.name,owner:state.profile.name,authorizedSignatory:state.profile.founder,logoStyle:type,taxId:`${short}-${type.toUpperCase()}-${stamp}`,commercialRegistration:`CR-${simDate().getUTCFullYear()}-${stamp}`,businessLicense:`LIC-${type.toUpperCase()}-${stamp}`,formationContract:`INC-${type.toUpperCase()}-${stamp}`,invoices:[{id:`INV-${type.toUpperCase()}-0001`,status:'تأسيس',amount:cost,issuedAt:state.simSeconds,note:'قيد رأس المال المدفوع عند التأسيس'}]},{actor:'corporate-ui'});pushAlert(`تأسست ${company.name} بمنظومة شركة مستقلة وحساب مالي موثق.`);save();updateKpis();openDrawer('companies','subs');}catch(error){pushAlert(`لم تُفتح ${company.name}: ${error.message}`);}
  }
  // ضمان وصول زر التأسيس حتى داخل اللوحات التي يعيد GH Advanced رسمها على الهاتف.
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('.open-company');if(!button)return;
    event.preventDefault();event.stopPropagation();openCompany(button.dataset.type);
  },true);
  function treasuryTransfer(event){const requested=Number(event?.currentTarget?.dataset.amount)||10000000,returnToCurrent=event?.currentTarget?.dataset.direction==='return';try{const result=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','transfer-reserve',{company:'group',amount:requested,direction:returnToCurrent?'to-operating':'to-reserve'},{actor:'treasury'}).result;pushAlert(`تم تحويل ${fmtMoney(result.amount||requested)} ${returnToCurrent?'من الاحتياطي إلى الحساب الجاري':'من الحساب الجاري إلى الاحتياطي'}.`);save();updateKpis();openDrawer('finance');}catch(error){notice(`تعذر تحويل الاحتياطي: ${error.message}`);}}
  function renderTreasuryStatementContent(){
    const f=state.finance,accounts=state.treasury.accounts,ledger=state.treasury.ledger.slice(0,30);
    const cheques=f.cheques||[],cIssued=cheques.filter(c=>c.status==='صادر'),cSettled=cheques.filter(c=>c.status==='مصروف'),cBounced=cheques.filter(c=>c.status==='مرتجع');
    const ar=f.receivables||[],ap=f.payables||[],arTotal=ar.reduce((s,x)=>s+x.total,0),apTotal=ap.reduce((s,x)=>s+x.total,0);
    const revenue=f.invoices.filter(x=>x.kind==='دخل').reduce((s,x)=>s+x.amount,0),expense=f.invoices.filter(x=>x.kind==='مصروف').reduce((s,x)=>s+x.amount,0);
    return `<article class="list-item"><div class="list-item-head"><div><h3>أرصدة الحسابات</h3><p>لقطة لحظية لكل حساب داخل خزينة المجموعة.</p></div><span class="tag positive">${fmtMoney(accounts.reduce((s,a)=>s+a.balance,0))}</span></div>${accounts.map(a=>`<div class="department-row"><span>${esc(a.name)}<small>${a.id}</small></span><div class="progress-bar"><span style="width:${Math.min(100,a.balance/Math.max(1,state.cash)*100)}%"></span></div><b>${fmtMoney(a.balance)}</b></div>`).join('')}</article>
    <article class="list-item"><h3>الملخص المالي</h3><div class="metric-row"><div><span>إيرادات موثقة</span><b class="positive">${fmtMoney(revenue)}</b></div><div><span>مصروفات موثقة</span><b>${fmtMoney(expense)}</b></div><div><span>صافي الدخل</span><b class="${revenue-expense>=0?'positive':'negative'}">${fmtMoney(revenue-expense)}</b></div></div><div class="metric-row two"><div><span>ذمم عملاء مستحقة</span><b>${fmtMoney(arTotal)}</b></div><div><span>ذمم موردين مستحقة</span><b>${fmtMoney(apTotal)}</b></div></div></article>
    <article class="list-item"><div class="list-item-head"><div><h3>حالة الشيكات</h3><p>صادر بانتظار الاستحقاق، مصروف من الحساب الجاري، أو مرتجع لعدم كفاية الرصيد.</p></div><span class="tag">${cheques.length} شيك</span></div><div class="metric-row"><div><span>صادرة</span><b>${cIssued.length}</b></div><div><span>مصروفة</span><b class="positive">${cSettled.length}</b></div><div><span>مرتجعة</span><b class="${cBounced.length?'negative':''}">${cBounced.length}</b></div></div>${cheques.length?`<div class="doc-art-grid">${cheques.slice(0,20).map(c=>chequeArt(c)).join('')}</div>`:'<p>لا توجد شيكات مُصدرة بعد.</p>'}</article>
    <article class="list-item"><h3>آخر قيود الخزينة</h3>${ledger.length?ledger.map(x=>`<div class="department-row"><span>${esc(x.note)}<small>${esc(x.from)} ← ${esc(x.to)}</small></span><div class="progress-bar"><span style="width:100%"></span></div><b>${fmtMoney(x.amount)}</b></div>`).join(''):'<p>لا توجد قيود مسجلة بعد.</p>'}</article>`;
  }
  function treasuryStatement(){
    openDrawerContent('كشف الحساب','كشف حساب المجموعة',renderTreasuryStatementContent());
  }
  function collectReceivable(number){try{const result=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','collect-receivable',{number},{actor:'finance-ui'}).result;pushAlert(`تم تحصيل ${fmtMoney(result.amount)} إلى حساب ${companyFinanceName(result.company)}.`);save();updateKpis();openDrawer('invoices',{company:result.company,tab:'receivables'});}catch(error){pushAlert('هذه الذمة محصّلة بالفعل أو لم تعد موجودة.');openDrawer('invoices');}}
  function settlePayable(number){try{const result=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','settle-payable',{number},{actor:'finance-ui'}).result;pushAlert(`تم سداد ${fmtMoney(result.amount)} من حساب ${companyFinanceName(result.company)}.`);save();updateKpis();openDrawer('invoices',{company:result.company,tab:'receivables'});}catch(error){notice(`تعذر سداد الذمة: ${error.message}`);}}
  function payTaxes(company='group'){company=COMPANY_FINANCE_TYPES.includes(company)?company:'group';try{const result=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','pay-taxes',{company},{actor:'finance-ui'}).result;if(!result.amount){pushAlert(`لا توجد فترة ضريبية مستحقة على ${companyFinanceName(company)}.`);return;}pushAlert(`تم سداد ضريبة ${companyFinanceName(company)} بقيمة ${fmtMoney(result.amount)} عن ${result.count} فترة.`);save();openDrawer('finance');}catch(error){notice(`تعذر سداد الضريبة: ${error.message}`);}}

  function viewInvoices(company='all'){openDrawer('invoices',{company,tab:'all'});}
  function manualPurchaseFromCard(button){
    const card=button?.closest?.('.asset-market-card'),type=button?.dataset?.type,tab=button?.dataset?.tab,id=button?.dataset?.id;
    const baseId=card?.querySelector('.manual-asset-base')?.value,qty=card?.querySelector('.manual-asset-qty')?.value,mode=card?.querySelector('.manual-asset-mode')?.value||'cash';
    if(!type||!id||!baseId){notice('اختر أصلًا وقاعدة تسليم متوافقة.');return null;}
    button.disabled=true;const orderId=buyAsset(type,tab,id,mode,qty,baseId,false,true,nextId('MANUAL-ASSET'));
    if(!orderId){button.disabled=false;notice('لم يُنفذ الشراء ولم يحدث أي خصم. راجع الرصيد والمورد والسعة.');return null;}
    pushAlert(`سُجل أمر الشراء اليدوي ${orderId}. لم ينشئ AI أصلًا أو مسارًا أو قرارًا نيابةً عنك.`);save();updateKpis();openDrawer('assetMarket',type);return orderId;
  }
  function buyAsset(type,tab,id,mode='cash',qty=1,baseId=null,alreadyPaid=false,silent=false,requestRef=null){
    const item=catalogItem(type,id);if(!item){if(!silent)notice('تعذر تنفيذ الشراء؛ هذا الأصل لم يعد متاحًا في الكتالوج.');return null;}qty=clamp(Math.floor(Number(qty)||1),1,50);baseId=baseId||item.base;
    const base=findFacility(baseId);if(!base){if(!silent)notice('تعذر تنفيذ الشراء: قاعدة التسليم غير موجودة.');return null;}
    const compatible=type==='air'?['airport','airport-base'].includes(base.kind):type==='sea'?['port','port-base'].includes(base.kind):['depot','logistics','airport-base','port-base'].includes(base.kind);
    if(!compatible){if(!silent)notice('قاعدة التسليم لا تدعم هذا النوع من الأصول.');return null;}
    const assetSupplier=supplierFor(type,'assets');if(!assetSupplier&&!alreadyPaid){if(!silent)notice('تعذر تنفيذ الشراء: لا يوجد مورد أصول مؤهل.');return null;}
    const totalPrice=Number(item.price)*qty,upfront=mode==='cash'?totalPrice:mode==='finance'?totalPrice*(item.downPayment||.2):Number(item.leaseMonthly||0)*3*qty;
    if(!Number.isFinite(totalPrice)||totalPrice<=0||!Number.isFinite(upfront)||upfront<0){if(!silent)notice('تعذر تنفيذ الشراء بسبب بيانات سعر غير صالحة.');return null;}
    const realism=window.GH_REALISM?.migrate(state),leadBase=Number(realism?.procurement?.leadTimes?.[type])||(type==='air'?120:type==='sea'?210:21),documentLeadDays=tab==='used'?Math.max(5,Math.round(leadBase*.12)):mode==='lease'?Math.max(7,Math.round(leadBase*.18)):leadBase,baseWindow=type==='air'?90:type==='sea'?150:60,leadSeconds=tab==='used'?Math.max(120,Math.round(baseWindow*.4)):mode==='lease'?Math.max(180,Math.round(baseWindow*.55)):baseWindow;
    try{
      const tx=window.GH_TRANSACTION_CORE,out=(tx.isActive()?tx.join:tx.execute)(state,{label:'asset-purchase',apply:()=>{
      const paymentMethod=mode==='cash'?'شيك مصدق':mode==='finance'?'تحويل دفعة مقدمة':'تحويل إيجار تشغيلي';
      const result=window.GH_DOMAIN_COMMANDS.dispatch({state},'procurement','purchase-assets',{type,tab,item,mode,qty,base,supplier:assetSupplier,prepaid:Boolean(alreadyPaid),manual:Boolean(requestRef&&String(requestRef).startsWith('MANUAL-')),requestRef,upfront,totalPrice,paymentMethod,documentLeadDays,leadSeconds,companyName:companyFinanceName(type)},{actor:'asset-purchase'}).result;
      if(!result?.orderId||Number(result.count)!==qty)throw new Error('Procurement Core لم ينشئ عقد التسليم كاملًا.');
      pushAlert(`تم اعتماد ${qty} × ${item.name} من ${assetSupplier?.legalName||assetSupplier?.name||'المورد المختار'}. عقد المورد يسجل Lead Time قدره ${documentLeadDays} يومًا، ونافذة الاستلام التشغيلية داخل اللعبة ${formatDuration(leadSeconds)}؛ لن يدخل الأصل الأسطول قبل وصوله فعليًا إلى ${base.name}.`);
      save();tx.afterCommit(()=>{updateKpis();if(!silent)openDrawer('assetMarket',type);});return result.orderId;
      }});return out.value;
    }catch(error){
      console.error('فشل معاملة شراء الأصل',error);if(!silent)notice('أُلغي الشراء بالكامل ولم يعتمد أي خصم أو تسليم بسبب فشل المعاملة الوقائية.');return null;
    }
  }

  function openBranch(id,opts={}){
    return runBusinessOperation('openBranch',()=>{const site=expansionSites.find(x=>x.id===id);if(!site){pushAlert('تعذر فتح هذا المقر؛ الموقع غير متاح.');return false;}if(state.branches.includes(id)){pushAlert(`${site.name} مفتوح بالفعل.`);return false;}const build=awardConstruction('group','hq',site.name,site.price);if(!build||build.insufficient){if(!opts.silent)notice('رصيد القابضة لا يغطي أفضل عرض إنشاء للمقر.');return false;}try{window.GH_DOMAIN_COMMANDS.dispatch({state},'facilities','open-regional-hq',{id,groupValueAdd:build.amount*.7},{actor:'facility-expansion'});ensureFacilityWorkforce('group','فتح مقر إقليمي');pushAlert(`أرسى إنشاء ${site.name} على ${build.contractor}.`);save();updateKpis();renderMap();if(!opts.silent)openFacility(id);return true;}catch(error){notice(`تعذر فتح المقر: ${error.message}`);return false;}
    });
  }
  function assignRoute(assetId,routeId,opts={}){const a=state.assets.find(x=>x.id===assetId),r=routeTemplates[routeId];if(!a||!r||a.type!==r.type){notice('تعذر تعيين هذا المسار؛ الأصل أو المسار غير متطابقين.');return false;}if(a.phase==='moving'){notice('لا يمكن تغيير المسار أثناء الحركة.');return false;}if(!routeFitsAsset(a,r)){notice('المسار يتجاوز مدى الأصل أو قيود التشغيل.');return false;}if(a.baseFacility&&a.baseFacility!==r.fromFacility&&a.baseFacility!==r.toFacility){notice('الأصل ليس موجودًا في إحدى نقطتي هذا المسار.');return false;}try{window.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','assign-route',{id:assetId,routeId,baseFacility:a.baseFacility,phase:'turnaround',route:r},{actor:'operations'});normalizeAsset(a);pushAlert(`${a.name} أصبح جاهزًا على مسار ${a.from} → ${a.to}.`);save();renderMap();if(!opts.silent)openDrawer('assetManage',assetId);return true;}catch(error){notice(`تعذر تعيين المسار: ${error.message}`);return false;}}
  function serviceAsset(id){
    return runBusinessOperation('serviceAsset',()=>{const a=state.assets.find(x=>x.id===id);if(!a){notice('الأصل غير موجود.');return false;}if(a.phase==='moving'){notice('لا يمكن صيانة الأصل أثناء الحركة.');return false;}const cost=a.type==='air'?78000:a.type==='sea'?145000:2800,supplier=a.type==='air'?'Global MRO Aviation':a.type==='sea'?'Oceanic Technical Services':'RoadFleet Maintenance';try{window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','spend',{company:a.type,amount:cost,note:`فاتورة صيانة ${a.name} · ${supplier}`,method:'تحويل بنكي',line:'maintenance'},{actor:'maintenance'});window.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','service',{id,conditionGain:6},{actor:'maintenance'});pushAlert(`اعتمدت صيانة ${a.name} لدى ${supplier}.`);save();updateKpis();openDrawer('assetManage',id);return true;}catch(error){notice(`تعذر الصيانة: ${error.message}`);return false;}
    });
  }
  // مصدر وحيد وموحّد لسبب تعطّل انطلاق أي أصل. يستعمل نفس منطق HR Core الذي تعتمده دورة المحاكاة التلقائية
  // (انظر استخدام hr.snapshot(...).crewMissing في دورة التقدّم الزمني)، بدل عتبة ثابتة مكررة ومنفصلة كانت هنا سابقًا.
  function departureBlockReason(asset){
    const tpl=routeTemplates[asset.routeId];
    if(!tpl)return {code:'no-route-data',text:'لا يوجد مسار تشغيلي صالح مرتبط بهذا الأصل.'};
    const hr=window.GH_HR_CORE;
    if(hr?.snapshot){
      const need=hr.snapshot(state,hrContext(),asset.type);
      if(need.crewMissing>0){
        const gaps=need.crew.filter(g=>g.missing>0).map(g=>`${g.missing} ${g.name}`).join('، ');
        return {code:'no-crew',text:`نقص طاقم ${typeName(asset.type)}: ${gaps||'كادر غير مكتمل'}. استخدم سد الاحتياج في الموارد البشرية.`};
      }
    }
    return null;
  }
  function departRouteAssets(routeId,type='road'){
    const candidates=state.assets.filter(a=>(!type||a.type===type)&&(!routeId||a.routeId===routeId)&&a.phase==='turnaround');
    let departed=0;const blockedDetails=[];
    for(const a of candidates){
      const block=departureBlockReason(a);
      if(block){blockedDetails.push({id:a.id,name:a.name,type:a.type,code:block.code,text:block.text});continue;}
      try{
        const ok=window.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','depart',{id:a.id,route:routeTemplates[a.routeId],load:loadLabel(a)},{actor:'dispatch'}).result;
        if(ok){normalizeAsset(a);departed++;}
        else blockedDetails.push({id:a.id,name:a.name,type:a.type,code:'dispatch-rejected',text:'رفض النظام أمر المغادرة دون سبب مُعاد.'});
      }catch(error){blockedDetails.push({id:a.id,name:a.name,type:a.type,code:'dispatch-error',text:error.message});}
    }
    lastDepartureBlocked=blockedDetails;
    try{window.GH_DOMAIN_COMMANDS.dispatch({state},'operations','record-alert',{text:`أمر مغادرة جماعي: غادر ${departed} من أصل ${candidates.length} أصلًا جاهزًا${routeId?' على المسار نفسه':''}. المتعطل: ${blockedDetails.length}.`,type:'dispatch'},{actor:'dispatch'});}catch(error){console.warn('operations log rejected',error);}
    if(departed)pushAlert(`أمر مغادرة جماعي: غادر ${departed} أصلًا${routeId?' على المسار نفسه':''} فورًا.`);
    if(blockedDetails.length)pushAlert(`تعذر تحريك ${blockedDetails.length} أصل: ${blockedDetails.slice(0,3).map(b=>`${b.name} — ${b.text}`).join(' · ')}${blockedDetails.length>3?' …':''}`);
    save();renderMap();return{departed,blocked:blockedDetails.length,blockedDetails};
  }
  function departNow(id){
    const a=state.assets.find(x=>x.id===id);if(!a){pushAlert('تعذر تنفيذ المغادرة؛ الأصل غير موجود.');return;}
    if(a.phase!=='turnaround'){pushAlert(`${a.name} غادر بالفعل أو لم يصل بعد إلى محطة تشغيل.`);save();openDrawer('assetManage',id);return;}
    const sameRoute=a.routeId?state.assets.filter(x=>x.type===a.type&&x.routeId===a.routeId&&x.phase==='turnaround').length:1;
    if(a.routeId&&sameRoute>1){departRouteAssets(a.routeId,a.type);openDrawer('assetManage',id);return;}
    const block=departureBlockReason(a);
    if(block){pushAlert(`أوقف ${a.name}: ${block.text}`);save();openDrawer('assetManage',id);return;}
    try{window.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','depart',{id,route:routeTemplates[a.routeId],load:loadLabel(a)},{actor:'dispatch'});normalizeAsset(a);pushAlert(`${a.name} غادر فورًا بأمر مباشر.`);save();renderMap();openDrawer('assetManage',id);}catch(error){notice(`تعذر تنفيذ المغادرة: ${error.message}`);}
  }
  function saleEstimate(a){const item=catalogItem(a.type,a.catalogId);return a.ownership==='lease'?-(Number(a.monthlyLease)||0)*2:(Number(item?.price)||1000000)*.72*(Number(a.condition||100)/100);}
  function finalizeAssetSale(id,automatic=false){const a=state.assets.find(x=>x.id===id);if(!a||a.phase==='moving')return false;try{if(a.ownership==='lease'){const fee=Math.max(0,(Number(a.monthlyLease)||0)*2);if(!automatic&&!ask(`إنهاء عقد تأجير ${a.name}؟ رسوم الإنهاء ${fmtMoney(fee)}.`))return false;window.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','return-lease',{id,fee},{actor:'fleet-disposal'});pushAlert(`أعيد ${a.name} من مركز التشغيل وأنهي عقد التأجير مقابل ${fmtMoney(fee)}.`);}else{const proceeds=Math.max(0,saleEstimate(a));if(!automatic&&!ask(`بيع ${a.name} مقابل قيمة تقديرية ${fmtMoney(proceeds)}؟`))return false;window.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','sell',{id,proceeds,buyer:'مشتري أصل معتمد'},{actor:'fleet-disposal'});pushAlert(`تم بيع ${a.name} من مركز التشغيل مقابل ${fmtMoney(proceeds)}.`);}save();updateKpis();if(selectedAssetId===id){selectedAssetId=null;$('assetCard').classList.add('hidden');}renderMap();return true;}catch(error){notice(`تعذر إغلاق عملية الأصل: ${error.message}`);return false;}}
  function requestAssetSale(id,bulk=false){const a=state.assets.find(x=>x.id===id);if(!a){if(!bulk)notice('تعذر تنفيذ العملية؛ هذا الأصل غير موجود.');return false;}if(a.salePending)return true;if(!bulk&&a.phase!=='moving'&&!ask(`إصدار أمر بيع ${a.name}؟ سيتم البيع من مركز التشغيل ولن يحدث أي بيع أثناء رحلة.`))return false;const atOwnedCenter=findFacility(a.baseFacility)?.owned;try{if(a.phase==='moving'){window.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','request-sale',{id,returnMode:'owned-center'},{actor:'fleet-disposal'});pushAlert(`صدر أمر بيع ${a.name}. سيكمل الرحلة الحالية؛ وإذا كانت الوجهة محطة عامة فسيعود تلقائيًا إلى مركز المجموعة قبل البيع.`);save();renderMap();if(!bulk)openDrawer('assetManage',id);return true;}if(a.phase==='turnaround'&&!atOwnedCenter&&a.routeId){window.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','request-sale',{id,returnMode:'owned-center',departSoon:true},{actor:'fleet-disposal'});pushAlert(`صدر أمر بيع ${a.name}. الأصل في محطة عامة وسيعود تلقائيًا إلى مركز المجموعة قبل البيع.`);save();renderMap();if(!bulk)openDrawer('assetManage',id);return true;}window.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','request-sale',{id,returnMode:'owned-center',clearRoute:true,phase:'idle'},{actor:'fleet-disposal'});save();return finalizeAssetSale(id,true);}catch(error){notice(`تعذر إصدار أمر البيع: ${error.message}`);return false;}}
  function sellAllAssets(type){
    const rows=state.assets.filter(a=>a.type===type&&!a.salePending);if(!rows.length){pushAlert(`لا توجد أصول ${typeName(type)} متاحة لإصدار أوامر بيع.`);return;}
    const moving=rows.filter(a=>a.phase==='moving').length,estimated=rows.reduce((n,a)=>n+Math.max(0,saleEstimate(a)),0);
    if(!ask(`إصدار أمر بيع لجميع أصول ${typeName(type)} (${rows.length})؟ ${moving?`${moving} أصل سيكمل الرحلة الحالية ثم يعود/يتوقف في مركز الوصول قبل البيع. `:''}القيمة التقديرية للأصول المملوكة ${fmtMoney(estimated)}.`))return;
    rows.forEach(a=>requestAssetSale(a.id,true));save();updateKpis();renderMap();openDrawer('market',type);pushAlert(`صدر أمر بيع جماعي لـ ${rows.length} أصل من ${typeName(type)}. لا يتم بيع أي أصل في منتصف الرحلة.`);
  }
  function sellAsset(id){return requestAssetSale(id,false);}

  function openGod(){closeDrawer();$('backdrop').classList.remove('hidden');$('godPanel').classList.add('open');$('godPanel').setAttribute('aria-hidden','false');updateKpis();}
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
  function closeMapPopovers(){$('filterPopover').classList.add('hidden');$('layerMenu').classList.add('hidden');$('speedMenu').classList.add('hidden');}
  function setSpeed(value){const next=Number(value);state.speed=SAFE_SPEED_VALUES.includes(next)?next:1;simulationEngine.reset(performance.now(),'user-speed-change');document.querySelectorAll('#speedMenu button[data-speed]').forEach(b=>b.classList.toggle('active',Number(b.dataset.speed)===state.speed));$('speedLabel').textContent=state.speed===0?'متوقف':`×${state.speed}`;save();}

  function openWorld(){placingHub=false;resetHubPlacementGesture();document.querySelector('.map-stage').classList.remove('placing-hub');closeDrawer();closeGod();closeMapPopovers();$('assetCard').classList.add('hidden');setActiveNav('map');updateMapStatus();}
  document.querySelectorAll('[data-panel]').forEach(btn=>btn.addEventListener('click',()=>openDrawer(btn.dataset.panel)));
  $('mapNavBtn').addEventListener('click',openWorld);
  $('brandBtn').addEventListener('click',openWorld);
  $('worldDirectoryBtn').addEventListener('click',()=>openDrawer('network'));
  document.querySelectorAll('[data-mobile-map]').forEach(btn=>btn.addEventListener('click',openWorld));
  $('alertsBtn').addEventListener('click',()=>openDrawer('news')); $('healthBtn')?.addEventListener('click',()=>openDrawer('diagnostics')); $('settingsBtn').addEventListener('click',()=>openDrawer('settings'));
  $('aiRequestsBtn')?.addEventListener('click',()=>openDrawer('aiApprovals'));
  $('drawerClose').addEventListener('click',closeDrawer); $('godClose').addEventListener('click',closeGod);
  $('backdrop').addEventListener('click',()=>{$('godPanel').classList.contains('open')?closeGod():closeDrawer();});
  $('assetClose').addEventListener('click',()=>{$('assetCard').classList.add('hidden');selectedAssetId=null;});
  $('assetManageBtn').addEventListener('click',()=>{if(selectedAssetId)openDrawer('assetManage',selectedAssetId);});
  $('filterToggle').addEventListener('click',e=>{e.stopPropagation();const pop=$('filterPopover'),opening=pop.classList.contains('hidden');pop.classList.toggle('hidden');$('layerMenu').classList.add('hidden');$('speedMenu').classList.add('hidden');if(opening)requestAnimationFrame(()=>positionMapPopover($('filterToggle'),pop));});
  $('layerBtn').addEventListener('click',e=>{e.stopPropagation();const pop=$('layerMenu'),opening=pop.classList.contains('hidden');pop.classList.toggle('hidden');$('filterPopover').classList.add('hidden');$('speedMenu').classList.add('hidden');if(opening)requestAnimationFrame(()=>positionMapPopover($('layerBtn'),pop));});
  $('speedToggle').addEventListener('click',e=>{e.stopPropagation();$('speedMenu').classList.toggle('hidden');$('filterPopover').classList.add('hidden');$('layerMenu').classList.add('hidden');});
  $('fitWorldBtn').addEventListener('click',()=>{if(map)map.setView([22,28],3);closeMapPopovers();});
  document.addEventListener('click',e=>{if(!e.target.closest('.map-popover')&&!e.target.closest('.map-fab')&&!e.target.closest('.speed-dock'))closeMapPopovers();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&placingHub){placingHub=false;resetHubPlacementGesture();document.querySelector('.map-stage').classList.remove('placing-hub');updateMapStatus();}});
  document.querySelectorAll('.filter-btn').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();state.activeFilter=btn.dataset.filter;document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b===btn));save();renderMap();}));
  $('competitorToggle').addEventListener('change',e=>{state.showCompetitors=e.target.checked;save();renderMap();});
  document.querySelectorAll('.map-popover button,.map-popover input,.speed-menu button').forEach(el=>el.addEventListener('click',e=>e.stopPropagation()));
  window.addEventListener('resize',()=>requestAnimationFrame(refreshOpenMapPopoverPositions),{passive:true});
  window.addEventListener('orientationchange',()=>setTimeout(refreshOpenMapPopoverPositions,80),{passive:true});
  document.querySelectorAll('#layerMenu button').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();setMapLayer(btn.dataset.layer);/* keep menu open for consecutive choices */}));
  document.querySelectorAll('#speedMenu button[data-speed]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();setSpeed(btn.dataset.speed);/* keep menu open */}));

  function founderInvestmentTransfer(type,amount,note='استثمار المؤسس عبر Good Mode'){
    return runBusinessOperation('founderInvestmentTransfer',()=>{amount=Math.max(0,Number(amount)||0);if(!amount)return null;try{const result=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','founder-investment',{company:type,amount,note},{actor:'founder'}).result;if(type==='group')window.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','adjust-group-value',{delta:amount*.25},{actor:'founder'});const founder=state.profile?.founder||'المؤسس';window.GH_DOMAIN_COMMANDS.dispatch({state},'ai','record-letter',{letter:{id:`LTR-${result.ref}`,requestId:result.ref,company:type,title:'خطاب إثبات استثمار مؤسس',scope:`إثبات حوالة استثمار رأسمالي واردة من ${founder} إلى ${companyFinanceName(type)} بقيمة ${fmtMoney(amount)}. لا تصنف كإيراد تشغيلي ولا كقرض.`,authorizedAmount:amount,supplier:founder,method:'حوالة بنكية واردة',status:'منفذ',authorizedBy:founder,day:Math.floor((state.simSeconds||0)/86400),founderInvestment:true}},{actor:'founder'});pushAlert(`وردت حوالة استثمار من المؤسس ${result.ref} بقيمة ${fmtMoney(amount)} إلى ${companyFinanceName(type)} وصدر خطاب الإثبات الرسمي.`);return result.ref;}catch(error){notice(`تعذر تسجيل استثمار المؤسس: ${error.message}`);return null;}
    });
  }
  function founderCapitalWithdrawal(type,amount,note='تسوية Good Mode'){amount=Math.max(0,Number(amount)||0);if(!amount)return null;try{const result=window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','founder-withdrawal',{company:type,amount,note},{actor:'founder'}).result;pushAlert(`صدر خطاب سحب رأسمالي ${result.ref} بقيمة ${fmtMoney(result.amount)} من ${companyFinanceName(type)}.`);return result.ref;}catch(error){notice(`تعذر السحب الرأسمالي: ${error.message}`);return null;}}
  const godEntity=()=>COMPANY_FINANCE_TYPES.includes($('godEntitySelect')?.value)?$('godEntitySelect').value:'group';
  const syncGodEntityStatus=()=>{const type=godEntity(),el=$('godEntityStatus');if(el)el.textContent=`${companyFinanceName(type)} · الجاري ${fmtMoney(companyOperatingBalance(type))} · الإجمالي ${fmtMoney(companyTotalBalance(type))} · الدين ${fmtMoney(companyBook(type).debt||0)}`;};
  const budgetLineIds={payroll:'godBudgetPayroll',fuel:'godBudgetFuel',maintenance:'godBudgetMaintenance',marketing:'godBudgetMarketing',insurance:'godBudgetInsurance',technology:'godBudgetTechnology',capex:'godBudgetCapex',other:'godBudgetOther'};
  const loadGodBudget=()=>{const type=$('companyBudgetSelect').value,b=companyBudget(type);$('companyBudgetInput').value=Math.round(b.limit||0);for(const [k,id] of Object.entries(budgetLineIds))$(id).value=Math.round(Number(b.lines?.[k])||0);$('companyBudgetStatus').textContent=b.enabled?`المنفق ${fmtMoney(b.spent)} · المحجوز ${fmtMoney(b.reserved||0)} · المتبقي ${fmtMoney(companyBudgetRemaining(type))} · حد 30 يوم ${fmtMoney(b.limit)}`:'لا يوجد حد ميزانية مفعل';};
  $('godMoneyToggle').addEventListener('change',e=>{state.godMoney=e.target.checked;if(!state.godMoney){state.infiniteMoney=false;$('infiniteToggle').checked=false;}pushAlert(`[God Mode] ${state.godMoney?'تفعيل':'إيقاف'} أدوات التحكم المالي.`);save();updateKpis();feedback(state.godMoney?'تم تفعيل God Money.':'تم إيقاف God Money.');});
  $('infiniteToggle').addEventListener('change',e=>{if(e.target.checked&&!state.godMoney){state.godMoney=true;$('godMoneyToggle').checked=true;}state.infiniteMoney=e.target.checked;pushAlert(`[God Mode] ${state.infiniteMoney?'تفعيل':'إيقاف'} تجاوز قيد السيولة؛ التكاليف الاقتصادية تبقى مسجلة.`);save();updateKpis();feedback(state.infiniteMoney?'تم تجاوز قيد السيولة.':'تم تفعيل القيود المالية الطبيعية.');});
  $('godEntitySelect').addEventListener('change',syncGodEntityStatus);
  $('addMoneyBtn').addEventListener('click',()=>{const type=godEntity(),n=Math.max(0,Number($('addMoneyInput').value)||0);const ref=founderInvestmentTransfer(type,n,'استثمار مباشر عبر Good Mode');save();updateKpis();syncGodEntityStatus();feedback(ref?`تمت حوالة الاستثمار ${ref} بقيمة ${fmtMoney(n)}.`:'أدخل مبلغًا أكبر من صفر.');});
  document.querySelectorAll('.quick-money button').forEach(b=>b.addEventListener('click',()=>{const type=godEntity(),n=Number(b.dataset.money),ref=founderInvestmentTransfer(type,n,'استثمار سريع عبر Good Mode');save();updateKpis();syncGodEntityStatus();feedback(ref?`حوالة مؤسس ${ref} · ${fmtMoney(n)}.`:'تعذر إنشاء الحوالة.');}));
  $('setMoneyBtn').addEventListener('click',()=>{const type=godEntity(),target=Math.max(0,Number($('setMoneyInput').value)||0),current=companyOperatingBalance(type),delta=target-current;if(delta>0)founderInvestmentTransfer(type,delta,'استثمار المؤسس للوصول إلى الرصيد المستهدف');else if(delta<0)founderCapitalWithdrawal(type,-delta,'سحب رأسمالي للوصول إلى الرصيد المستهدف');save();updateKpis();syncGodEntityStatus();feedback(`تم الوصول إلى ${fmtMoney(target)} عبر ${delta>=0?'حوالة استثمار مؤسس':'سحب رأسمالي موثق'}.`);});
  $('setCompanyBudgetBtn').addEventListener('click',()=>{const type=$('companyBudgetSelect').value,n=Math.max(0,Number($('companyBudgetInput').value)||0);window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','set-budget',{company:type,limit:n},{actor:'founder-controls'});const text=n>0?`ميزانية ${companyFinanceName(type)}: ${fmtMoney(n)} / 30 يوم`:`تم إلغاء حد الميزانية عن ${companyFinanceName(type)}`;pushAlert(`[God Mode] ${text}. الرصيد البنكي لم يتغير.`);save();updateKpis();loadGodBudget();feedback(text);});
  $('companyBudgetSelect').addEventListener('change',loadGodBudget);
  $('budgetAutoSplitBtn').addEventListener('click',()=>{const total=Math.max(0,Number($('companyBudgetInput').value)||0),ratios={payroll:.21,fuel:.22,maintenance:.10,marketing:.05,insurance:.04,technology:.05,capex:.25,other:.08};for(const [k,id] of Object.entries(budgetLineIds))$(id).value=Math.round(total*ratios[k]);feedback('تم توزيع الميزانية على بنود تشغيلية؛ احفظ الخطة لاعتمادها.');});
  $('saveBudgetPlanBtn').addEventListener('click',()=>{const type=$('companyBudgetSelect').value,lines={};for(const [k,id] of Object.entries(budgetLineIds))lines[k]=Math.max(0,Number($(id).value)||0);const total=Object.values(lines).reduce((n,x)=>n+x,0);window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','set-budget',{company:type,limit:total,lines},{actor:'founder-controls'});$('companyBudgetInput').value=Math.round(total);pushAlert(`[God Mode] اعتماد خطة ميزانية تفصيلية لـ ${companyFinanceName(type)} بقيمة ${fmtMoney(total)} دون تغيير السيولة.`);save();loadGodBudget();feedback(`اعتمدت الخطة التفصيلية: ${fmtMoney(total)}.`);});
  $('resetCompanyBudgetBtn').addEventListener('click',()=>{const type=$('companyBudgetSelect').value;window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','reset-budget',{company:type},{actor:'founder-controls'});save();loadGodBudget();feedback(`ألغيت ميزانية ${companyFinanceName(type)} فقط.`);});
  $('godDebtCompanySelect').addEventListener('change',()=>{$('godDebtInput').value=Math.round(companyBook($('godDebtCompanySelect').value).debt||0);});
  $('setGodDebtBtn').addEventListener('click',()=>{const type=$('godDebtCompanySelect').value,n=Math.max(0,Number($('godDebtInput').value)||0);window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','set-debt',{company:type,amount:n},{actor:'founder-controls'});pushAlert(`[God Mode] تعيين دين ${companyFinanceName(type)} إلى ${fmtMoney(n)}.`);save();updateKpis();feedback(`تم تحديث دين ${companyFinanceName(type)}.`);});
  $('clearDebtBtn').addEventListener('click',()=>{const d=state.debt;for(const t of COMPANY_FINANCE_TYPES)window.GH_DOMAIN_COMMANDS.dispatch({state},'finance','set-debt',{company:t,amount:0},{actor:'founder-controls'});pushAlert(`[God Mode] تصفير ديون المجموعة ${fmtMoney(d)}.`);save();updateKpis();feedback(`تم تصفير ${fmtMoney(d)} من الديون.`);});
  syncGodEntityStatus();loadGodBudget();

  let founderLogoData=null,founderLogoStyle='teal';
  function updateFounderLogoPreview(){const box=$('founderLogoPreview');if(!box)return;box.dataset.style=founderLogoStyle;const short=($('founderShort')?.value||'GH').slice(0,4).toUpperCase();box.innerHTML=founderLogoData?`<img src="${esc(founderLogoData)}" alt="شعار المجموعة">`:`<span>${esc(short)}</span>`;document.querySelectorAll('.logo-preset').forEach(b=>b.classList.toggle('active',b.dataset.logoStyle===founderLogoStyle));}
  function compressLogoFile(file){return new Promise((resolve,reject)=>{if(!file||!String(file.type).startsWith('image/')){reject(new Error('اختر صورة شعار صالحة.'));return;}if(file.size>8*1024*1024){reject(new Error('حجم الصورة كبير جدًا. الحد 8MB قبل الضغط.'));return;}const reader=new FileReader();reader.onerror=()=>reject(new Error('تعذر قراءة الصورة من الاستديو.'));reader.onload=()=>{const img=new Image();img.onerror=()=>reject(new Error('ملف الصورة غير قابل للقراءة.'));img.onload=()=>{const max=360,scale=Math.min(1,max/Math.max(img.naturalWidth||1,img.naturalHeight||1)),w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale)),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const c=canvas.getContext('2d');c.clearRect(0,0,w,h);c.drawImage(img,0,0,w,h);let data;try{data=canvas.toDataURL('image/webp',.76);if(!data.startsWith('data:image/webp'))data=canvas.toDataURL('image/jpeg',.78);}catch{data=canvas.toDataURL('image/jpeg',.78);}if(data.length>280000){reject(new Error('الشعار ما زال كبيرًا بعد الضغط. اختر صورة أبسط أو أقل تفاصيل.'));return;}resolve(data);};img.src=String(reader.result);};reader.readAsDataURL(file);});}
  document.querySelectorAll('.logo-preset').forEach(btn=>btn.addEventListener('click',()=>{founderLogoStyle=btn.dataset.logoStyle||'teal';founderLogoData=null;updateFounderLogoPreview();}));
  $('founderLogoUpload')?.addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{founderLogoData=await compressLogoFile(file);updateFounderLogoPreview();}catch(error){notice(error.message||'تعذر معالجة الشعار.');e.target.value='';}});
  $('founderLogoClear')?.addEventListener('click',()=>{founderLogoData=null;updateFounderLogoPreview();});
  $('founderShort')?.addEventListener('input',updateFounderLogoPreview);updateFounderLogoPreview();

  function finishFounder(useDemo=false){
    if(useDemo){
      // Quick start is intentionally clean: no legacy demo fleet, subsidiaries, routes or owned operating facilities.
      if($('founderName'))$('founderName').value=defaultState.profile.name;
      if($('founderShort'))$('founderShort').value=defaultState.profile.shortName;
      if($('founderOwner'))$('founderOwner').value=defaultState.profile.founder;
      if($('founderEnglishName'))$('founderEnglishName').value=defaultState.profile.englishName;
      if($('founderMode'))$('founderMode').value='balanced';
      if($('founderSector'))$('founderSector').value='air';
      return finishFounder(false);
    }else{
      const mode=$('founderMode').value,firstSector=$('founderSector').value;
      try{window.GH_GAME_LIFECYCLE.foundGroup(state,{name:$('founderName').value.trim(),shortName:$('founderShort').value.trim(),founder:$('founderOwner').value.trim(),englishName:$('founderEnglishName')?.value.trim(),country:$('founderCountry').value,city:$('founderCity').value,firstSector,mode,legalForm:$('founderLegalForm')?.value,currency:$('founderCurrency')?.value,fiscalYear:$('founderFiscal')?.value,riskAppetite:$('founderRisk')?.value,procurementPolicy:$('founderProcurement')?.value,signingAuthority:$('founderAuthority')?.value,logo:founderLogoData||null,logoStyle:founderLogoStyle||'teal'},defaultState,{nextId,typeName,fmtMoney,simYear:()=>simDate().getUTCFullYear(),onCommit:()=>persistStateNow({throwOnError:true})});}catch(error){const feedback=$('founderError');feedback.hidden=false;feedback.textContent='تعذر حفظ التأسيس. بقيت الحالة السابقة محفوظة؛ حرر مساحة أو صدّر نسخة ثم أعد المحاولة.';diag('FOUNDING_FAILED',{reason:String(error.message)},'warning');return false;}

    }
    $('founderError').textContent='';$('founderError').hidden=true;const founder=$('founderFlow');founder?.classList.add('hidden');if(founder){founder.style.removeProperty('display');founder.style.removeProperty('visibility');founder.style.removeProperty('opacity');founder.style.removeProperty('pointer-events');founder.style.removeProperty('z-index');}const appShell=$('app');if(appShell){appShell.removeAttribute('aria-hidden');appShell.style.pointerEvents='';}updateKpis();renderMap();
  }
  $('founderForm').addEventListener('submit',e=>{e.preventDefault();finishFounder(false);});
  $('skipFounder').addEventListener('click',()=>finishFounder(true));
  if(!state.onboardingComplete)$('founderFlow').classList.remove('hidden');

  updateKpis();setSpeed(state.speed);$('competitorToggle').checked=!!state.showCompetitors;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.activeFilter));
  initMap();

  function loop(now){
    if(hardResetInProgress||window.GH_PERSISTENCE.isLocked()){simulationEngine.reset(now,'lifecycle-lock');requestAnimationFrame(loop);return;}
    if(processOneRecoveryBoundary()){simulationEngine.reset(now,'boundary-recovery');requestAnimationFrame(loop);return;}
    simulationEngine.frame(now);
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
      if(bridge){diag('UPDATE_BOOT_CONFIRM_REQUEST',{version:APP_VERSION});bridge.postMessage({action:'confirmUpdateBoot',version:APP_VERSION});}
    }catch(error){state.speed=0;diag('UPDATE_BOOT_CONFIRM_BRIDGE_FAILED',{version:APP_VERSION,message:String(error?.message||error)},'critical');console.error('Native update boot confirmation failed',error);}
  },0);
})();
