(()=>{
  'use strict';
  const VERSION='3.0.0';
  const ROUTE_WAIT_TIMEOUT_SECONDS=900;
  // Vehicles one purchase may buy (the fleet companies buy up to GH_PROCUREMENT_CORE.MAX_ASSET_PURCHASE_QUANTITY).
  const MAX_FLEET_PURCHASE_QUANTITY=3000;
  let mapStructureVersion=0;
  const centerFleetCountCache=new WeakMap();
  const simulationIndexCache=new WeakMap();
  function noteMapStructureChange(){mapStructureVersion=(mapStructureVersion+1)>>>0;}
  const ZONES=Object.freeze([
    {id:'KAFD',name:'مركز الملك عبدالله المالي',coords:[24.767,46.643],weight:1.25},{id:'OLAYA',name:'العليا',coords:[24.711,46.674],weight:1.18},
    {id:'AIRPORT',name:'مطار الملك خالد',coords:[24.958,46.702],weight:1.12},{id:'DIRIYAH',name:'الدرعية',coords:[24.735,46.575],weight:.92},
    {id:'MALQA',name:'الملقا',coords:[24.798,46.608],weight:1.02},{id:'RIMAL',name:'الرمال',coords:[24.846,46.813],weight:.84},
    {id:'INDUSTRIAL',name:'المدينة الصناعية',coords:[24.529,46.789],weight:.78},{id:'STATION',name:'محطة قطار الرياض',coords:[24.648,46.716],weight:.98},
    {id:'QURTUBAH',name:'قرطبة',coords:[24.808,46.747],weight:1.04},{id:'NAKHEEL',name:'النخيل',coords:[24.738,46.618],weight:1.08},
    {id:'SULAIMANIYAH',name:'السليمانية',coords:[24.703,46.706],weight:1.1},{id:'SHIFA',name:'الشفا',coords:[24.565,46.668],weight:.82}
  ]);
  // Real models keep the asset ledger useful while the simulation still
  // aggregates by class (so the map stays light even with a large fleet).
  const CLASSES=Object.freeze([
    {id:'eco-ev',name:'GH Go Electric',manufacturer:'Tesla · BYD · Hyundai',models:['Tesla Model 3','BYD Seal','Hyundai Ioniq 6'],count:260,cost:42000,capacity:4,rate:1.05,base:2.8,icon:'🚙'},
    {id:'comfort',name:'GH Comfort',manufacturer:'Toyota · Hyundai · Kia',models:['Toyota Camry Hybrid','Hyundai Sonata Hybrid','Kia K8'],count:120,cost:61000,capacity:4,rate:1.42,base:4.5,icon:'🚘'},
    {id:'premium',name:'GH Black',manufacturer:'Mercedes-Benz · BMW · Genesis',models:['Mercedes-Benz E-Class','BMW i5','Genesis G80'],count:60,cost:108000,capacity:4,rate:2.35,base:9,icon:'🚖'},
    {id:'accessible-van',name:'GH Access',manufacturer:'Toyota · Mercedes-Benz · Ford',models:['Toyota Sienna','Mercedes-Benz V-Class','Ford E-Transit'],count:40,cost:79000,capacity:6,rate:1.72,base:5.5,icon:'🚐'}
  ]);
  // The vehicle catalog is owned here, not by GH_ASSET_CATALOG. Expose the
  // same read-only query as the other operations providers without ensure().
  function purchaseCatalogs(ctx){
    const definition=ctx?.definition||globalThis.GH_COMPANY_PLATFORM?.definitionFor?.(ctx?.state,ctx?.companyId);
    if(!definition?.capabilities?.includes('operations.mobility')||!definition.classification?.assetClasses?.includes('mobility-vehicle'))return [];
    return CLASSES.length?[{mode:'mobility',view:'mobility',assetClass:'mobility-vehicle',new:CLASSES,used:[]}]:[];
  }
  // Mobility centres are capital-only. The compact registry covers the main
  // countries served by the network and never accepts arbitrary map points.
  const CAPITALS=Object.freeze([
    {id:'RUH',country:'السعودية',city:'الرياض',coords:[24.7136,46.6753]},
    {id:'AUH',country:'الإمارات',city:'أبوظبي',coords:[24.4539,54.3773]},
    {id:'DOH',country:'قطر',city:'الدوحة',coords:[25.2854,51.531]},
    {id:'KWI',country:'الكويت',city:'مدينة الكويت',coords:[29.3759,47.9774]},
    {id:'CAI',country:'مصر',city:'القاهرة',coords:[30.0444,31.2357]},
    {id:'ANK',country:'تركيا',city:'أنقرة',coords:[39.9334,32.8597]},
    {id:'BER',country:'ألمانيا',city:'برلين',coords:[52.52,13.405]},
    {id:'LON',country:'المملكة المتحدة',city:'لندن',coords:[51.5074,-0.1278]},
    {id:'PAR',country:'فرنسا',city:'باريس',coords:[48.8566,2.3522]},
    {id:'MAD',country:'إسبانيا',city:'مدريد',coords:[40.4168,-3.7038]},
    {id:'ROM',country:'إيطاليا',city:'روما',coords:[41.9028,12.4964]},
    {id:'WAS',country:'الولايات المتحدة',city:'واشنطن العاصمة',coords:[38.9072,-77.0369]},
    {id:'OTT',country:'كندا',city:'أوتاوا',coords:[45.4215,-75.6972]},
    {id:'MEX',country:'المكسيك',city:'مكسيكو سيتي',coords:[19.4326,-99.1332]},
    {id:'BSB',country:'البرازيل',city:'برازيليا',coords:[-15.7939,-47.8828]},
    {id:'NBO',country:'كينيا',city:'نيروبي',coords:[-1.2921,36.8219]},
    {id:'DEL',country:'الهند',city:'نيودلهي',coords:[28.6139,77.209]},
    {id:'SIN',country:'سنغافورة',city:'سنغافورة',coords:[1.3521,103.8198]},
    {id:'TYO',country:'اليابان',city:'طوكيو',coords:[35.6762,139.6503]},
    {id:'CAN',country:'أستراليا',city:'كانبرا',coords:[-35.2809,149.13]},
    {id:'BGW',country:'العراق',city:'بغداد',coords:[33.3152,44.3661]},
    {id:'DAM',country:'سوريا',city:'دمشق',coords:[33.5138,36.2765]},
    {id:'BEY',country:'لبنان',city:'بيروت',coords:[33.8938,35.5018]},
    {id:'AMM',country:'الأردن',city:'عمّان',coords:[31.9454,35.9284]},
    {id:'JRS',country:'فلسطين',city:'رام الله',coords:[31.9038,35.2034]},
    {id:'SAH',country:'اليمن',city:'صنعاء',coords:[15.3694,44.191]},
    {id:'MCT',country:'عُمان',city:'مسقط',coords:[23.5859,58.4059]},
    {id:'BAH',country:'البحرين',city:'المنامة',coords:[26.2285,50.586]},
    {id:'THR',country:'إيران',city:'طهران',coords:[35.6892,51.389]},
    {id:'NIC',country:'قبرص',city:'نيقوسيا',coords:[35.1856,33.3823]},
    {id:'TBS',country:'جورجيا',city:'تبليسي',coords:[41.7151,44.8271]},
    {id:'EVN',country:'أرمينيا',city:'يريفان',coords:[40.1792,44.4991]},
    {id:'GYD',country:'أذربيجان',city:'باكو',coords:[40.4093,49.8671]},
    {id:'NQZ',country:'كازاخستان',city:'أستانا',coords:[51.1694,71.4491]},
    {id:'TAS',country:'أوزبكستان',city:'طشقند',coords:[41.2995,69.2401]},
    {id:'ASB',country:'تركمانستان',city:'عشق آباد',coords:[37.9601,58.3261]},
    {id:'DYU',country:'طاجيكستان',city:'دوشنبي',coords:[38.5598,68.787]},
    {id:'FRU',country:'قيرغيزستان',city:'بيشكك',coords:[42.8746,74.5698]},
    {id:'KBL',country:'أفغانستان',city:'كابل',coords:[34.5553,69.2075]},
    {id:'ISB',country:'باكستان',city:'إسلام آباد',coords:[33.6844,73.0479]},
    {id:'ULN',country:'منغوليا',city:'أولان باتور',coords:[47.8864,106.9057]},
    {id:'DAC',country:'بنغلاديش',city:'دكا',coords:[23.8103,90.4125]},
    {id:'CMB',country:'سريلانكا',city:'كولومبو',coords:[6.9271,79.8612]},
    {id:'KTM',country:'نيبال',city:'كاتماندو',coords:[27.7172,85.324]},
    {id:'PBH',country:'بوتان',city:'تيمفو',coords:[27.4712,89.6339]},
    {id:'MLE',country:'المالديف',city:'ماليه',coords:[4.1755,73.5093]},
    {id:'BJS',country:'الصين',city:'بكين',coords:[39.9042,116.4074]},
    {id:'SEL',country:'كوريا الجنوبية',city:'سول',coords:[37.5665,126.978]},
    {id:'FNJ',country:'كوريا الشمالية',city:'بيونغ يانغ',coords:[39.0392,125.7625]},
    {id:'TPE',country:'تايوان',city:'تايبيه',coords:[25.033,121.5654]},
    {id:'JKT',country:'إندونيسيا',city:'جاكرتا',coords:[-6.2088,106.8456]},
    {id:'KUL',country:'ماليزيا',city:'كوالالمبور',coords:[3.139,101.6869]},
    {id:'BKK',country:'تايلاند',city:'بانكوك',coords:[13.7563,100.5018]},
    {id:'HAN',country:'فيتنام',city:'هانوي',coords:[21.0285,105.8542]},
    {id:'MNL',country:'الفلبين',city:'مانيلا',coords:[14.5995,120.9842]},
    {id:'NYT',country:'ميانمار',city:'نايبيداو',coords:[19.7633,96.0785]},
    {id:'PNH',country:'كمبوديا',city:'بنوم بنه',coords:[11.5564,104.9282]},
    {id:'VTE',country:'لاوس',city:'فيينتيان',coords:[17.9757,102.6331]},
    {id:'BWN',country:'بروناي',city:'بندر سري بكاوان',coords:[4.9031,114.9398]},
    {id:'DIL',country:'تيمور الشرقية',city:'ديلي',coords:[-8.5569,125.5603]},
    {id:'LIS',country:'البرتغال',city:'لشبونة',coords:[38.7223,-9.1393]},
    {id:'AMS',country:'هولندا',city:'أمستردام',coords:[52.3676,4.9041]},
    {id:'BRU',country:'بلجيكا',city:'بروكسل',coords:[50.8503,4.3517]},
    {id:'BRN',country:'سويسرا',city:'برن',coords:[46.948,7.4474]},
    {id:'VIE',country:'النمسا',city:'فيينا',coords:[48.2082,16.3738]},
    {id:'WAW',country:'بولندا',city:'وارسو',coords:[52.2297,21.0122]},
    {id:'PRG',country:'التشيك',city:'براغ',coords:[50.0755,14.4378]},
    {id:'BTS',country:'سلوفاكيا',city:'براتيسلافا',coords:[48.1486,17.1077]},
    {id:'BUD',country:'المجر',city:'بودابست',coords:[47.4979,19.0402]},
    {id:'OTP',country:'رومانيا',city:'بوخارست',coords:[44.4268,26.1025]},
    {id:'SOF',country:'بلغاريا',city:'صوفيا',coords:[42.6977,23.3219]},
    {id:'ATH',country:'اليونان',city:'أثينا',coords:[37.9838,23.7275]},
    {id:'BEG',country:'صربيا',city:'بلغراد',coords:[44.7866,20.4489]},
    {id:'ZAG',country:'كرواتيا',city:'زغرب',coords:[45.815,15.9819]},
    {id:'SJJ',country:'البوسنة والهرسك',city:'سراييفو',coords:[43.8563,18.4131]},
    {id:'LJU',country:'سلوفينيا',city:'ليوبليانا',coords:[46.0569,14.5058]},
    {id:'TGD',country:'الجبل الأسود',city:'بودغوريتسا',coords:[42.4304,19.2594]},
    {id:'SKP',country:'مقدونيا الشمالية',city:'سكوبيه',coords:[41.9973,21.428]},
    {id:'TIA',country:'ألبانيا',city:'تيرانا',coords:[41.3275,19.8187]},
    {id:'PRN',country:'كوسوفو',city:'بريشتينا',coords:[42.6629,21.1655]},
    {id:'KBP',country:'أوكرانيا',city:'كييف',coords:[50.4501,30.5234]},
    {id:'MSQ',country:'بيلاروسيا',city:'مينسك',coords:[53.9006,27.559]},
    {id:'MOW',country:'روسيا',city:'موسكو',coords:[55.7558,37.6173]},
    {id:'STO',country:'السويد',city:'ستوكهولم',coords:[59.3293,18.0686]},
    {id:'OSL',country:'النرويج',city:'أوسلو',coords:[59.9139,10.7522]},
    {id:'CPH',country:'الدنمارك',city:'كوبنهاغن',coords:[55.6761,12.5683]},
    {id:'HEL',country:'فنلندا',city:'هلسنكي',coords:[60.1699,24.9384]},
    {id:'REK',country:'آيسلندا',city:'ريكيافيك',coords:[64.1466,-21.9426]},
    {id:'DUB',country:'أيرلندا',city:'دبلن',coords:[53.3498,-6.2603]},
    {id:'LUX',country:'لوكسمبورغ',city:'مدينة لوكسمبورغ',coords:[49.6116,6.1319]},
    {id:'MLA',country:'مالطا',city:'فاليتا',coords:[35.8989,14.5146]},
    {id:'TLL',country:'إستونيا',city:'تالين',coords:[59.437,24.7536]},
    {id:'RIX',country:'لاتفيا',city:'ريغا',coords:[56.9496,24.1052]},
    {id:'VNO',country:'ليتوانيا',city:'فيلنيوس',coords:[54.6872,25.2797]},
    {id:'KIV',country:'مولدوفا',city:'كيشيناو',coords:[47.0105,28.8638]},
    {id:'ALV',country:'أندورا',city:'أندورا لا فيلا',coords:[42.5063,1.5218]},
    {id:'MCM',country:'موناكو',city:'موناكو',coords:[43.7384,7.4246]},
    {id:'SAI',country:'سان مارينو',city:'سان مارينو',coords:[43.9424,12.4578]},
    {id:'VDZ',country:'ليختنشتاين',city:'فادوتس',coords:[47.141,9.5209]},
    {id:'RBA',country:'المغرب',city:'الرباط',coords:[34.0209,-6.8417]},
    {id:'ALG',country:'الجزائر',city:'الجزائر العاصمة',coords:[36.7538,3.0588]},
    {id:'TUN',country:'تونس',city:'تونس العاصمة',coords:[36.8065,10.1815]},
    {id:'TIP',country:'ليبيا',city:'طرابلس',coords:[32.8872,13.1913]},
    {id:'KRT',country:'السودان',city:'الخرطوم',coords:[15.5007,32.5599]},
    {id:'JUB',country:'جنوب السودان',city:'جوبا',coords:[4.8594,31.5713]},
    {id:'ADD',country:'إثيوبيا',city:'أديس أبابا',coords:[9.032,38.7469]},
    {id:'MGQ',country:'الصومال',city:'مقديشو',coords:[2.0469,45.3182]},
    {id:'JIB',country:'جيبوتي',city:'مدينة جيبوتي',coords:[11.8251,42.5903]},
    {id:'ASM',country:'إريتريا',city:'أسمرة',coords:[15.3229,38.9251]},
    {id:'KLA',country:'أوغندا',city:'كمبالا',coords:[0.3476,32.5825]},
    {id:'DOD',country:'تنزانيا',city:'دودوما',coords:[-6.163,35.7516]},
    {id:'KGL',country:'رواندا',city:'كيغالي',coords:[-1.9403,30.0619]},
    {id:'GID',country:'بوروندي',city:'غيتيغا',coords:[-3.4264,29.9306]},
    {id:'FIH',country:'الكونغو الديمقراطية',city:'كينشاسا',coords:[-4.4419,15.2663]},
    {id:'BZV',country:'الكونغو',city:'برازافيل',coords:[-4.2634,15.2429]},
    {id:'BGF',country:'أفريقيا الوسطى',city:'بانغي',coords:[4.3947,18.5582]},
    {id:'YAO',country:'الكاميرون',city:'ياوندي',coords:[3.848,11.5021]},
    {id:'NDJ',country:'تشاد',city:'انجامينا',coords:[12.1348,15.0557]},
    {id:'NIM',country:'النيجر',city:'نيامي',coords:[13.5127,2.1128]},
    {id:'ABV',country:'نيجيريا',city:'أبوجا',coords:[9.0765,7.3986]},
    {id:'PNV',country:'بنين',city:'بورتو نوفو',coords:[6.4969,2.6289]},
    {id:'LFW',country:'توغو',city:'لومي',coords:[6.1725,1.2314]},
    {id:'ACC',country:'غانا',city:'أكرا',coords:[5.6037,-0.187]},
    {id:'YAM',country:'ساحل العاج',city:'ياموسوكرو',coords:[6.8276,-5.2893]},
    {id:'MLW',country:'ليبيريا',city:'مونروفيا',coords:[6.3156,-10.8074]},
    {id:'FNA',country:'سيراليون',city:'فريتاون',coords:[8.4657,-13.2317]},
    {id:'CKY',country:'غينيا',city:'كوناكري',coords:[9.6412,-13.5784]},
    {id:'OXB',country:'غينيا بيساو',city:'بيساو',coords:[11.8636,-15.5977]},
    {id:'DKR',country:'السنغال',city:'داكار',coords:[14.7167,-17.4677]},
    {id:'BJL',country:'غامبيا',city:'بانجول',coords:[13.4549,-16.579]},
    {id:'BKO',country:'مالي',city:'باماكو',coords:[12.6392,-8.0029]},
    {id:'OUA',country:'بوركينا فاسو',city:'واغادوغو',coords:[12.3714,-1.5197]},
    {id:'NKC',country:'موريتانيا',city:'نواكشوط',coords:[18.0735,-15.9582]},
    {id:'RAI',country:'الرأس الأخضر',city:'برايا',coords:[14.933,-23.5133]},
    {id:'LBV',country:'الغابون',city:'ليبرفيل',coords:[0.4162,9.4673]},
    {id:'SSG',country:'غينيا الاستوائية',city:'مالابو',coords:[3.7523,8.7742]},
    {id:'TMS',country:'ساو تومي وبرينسيب',city:'ساو تومي',coords:[0.3302,6.7333]},
    {id:'LAD',country:'أنغولا',city:'لواندا',coords:[-8.8399,13.2894]},
    {id:'LUN',country:'زامبيا',city:'لوساكا',coords:[-15.3875,28.3228]},
    {id:'HRE',country:'زيمبابوي',city:'هراري',coords:[-17.8252,31.0335]},
    {id:'MPM',country:'موزمبيق',city:'مابوتو',coords:[-25.9692,32.5732]},
    {id:'LLW',country:'ملاوي',city:'ليلونغوي',coords:[-13.9626,33.7741]},
    {id:'WDH',country:'ناميبيا',city:'ويندهوك',coords:[-22.5609,17.0658]},
    {id:'GBE',country:'بوتسوانا',city:'غابورون',coords:[-24.6282,25.9231]},
    {id:'PRY',country:'جنوب أفريقيا',city:'بريتوريا',coords:[-25.7479,28.2293]},
    {id:'MSU',country:'ليسوتو',city:'ماسيرو',coords:[-29.3142,27.4869]},
    {id:'MTS',country:'إسواتيني',city:'مبابان',coords:[-26.3054,31.1367]},
    {id:'TNR',country:'مدغشقر',city:'أنتاناناريفو',coords:[-18.8792,47.5079]},
    {id:'MRU',country:'موريشيوس',city:'بورت لويس',coords:[-20.1609,57.5012]},
    {id:'SEZ',country:'سيشل',city:'فيكتوريا',coords:[-4.6191,55.4513]},
    {id:'YVA',country:'جزر القمر',city:'موروني',coords:[-11.7172,43.2473]},
    {id:'HAV',country:'كوبا',city:'هافانا',coords:[23.1136,-82.3666]},
    {id:'KIN',country:'جامايكا',city:'كينغستون',coords:[17.9712,-76.7936]},
    {id:'PAP',country:'هايتي',city:'بورت أو برنس',coords:[18.5944,-72.3074]},
    {id:'SDQ',country:'جمهورية الدومينيكان',city:'سانتو دومينغو',coords:[18.4861,-69.9312]},
    {id:'NAS',country:'الباهاما',city:'ناسو',coords:[25.0343,-77.3963]},
    {id:'BZE',country:'بليز',city:'بلموبان',coords:[17.251,-88.759]},
    {id:'GUA',country:'غواتيمالا',city:'مدينة غواتيمالا',coords:[14.6349,-90.5069]},
    {id:'TGU',country:'هندوراس',city:'تيغوسيغالبا',coords:[14.0723,-87.1921]},
    {id:'SAL',country:'السلفادور',city:'سان سلفادور',coords:[13.6929,-89.2182]},
    {id:'MGA',country:'نيكاراغوا',city:'ماناغوا',coords:[12.115,-86.2362]},
    {id:'SJO',country:'كوستاريكا',city:'سان خوسيه',coords:[9.9281,-84.0907]},
    {id:'PTY',country:'بنما',city:'مدينة بنما',coords:[8.9824,-79.5199]},
    {id:'POS',country:'ترينيداد وتوباغو',city:'بورت أوف سبين',coords:[10.6549,-61.5019]},
    {id:'BGI',country:'بربادوس',city:'بريدجتاون',coords:[13.1132,-59.5988]},
    {id:'BUE',country:'الأرجنتين',city:'بوينس آيرس',coords:[-34.6037,-58.3816]},
    {id:'SCL',country:'تشيلي',city:'سانتياغو',coords:[-33.4489,-70.6693]},
    {id:'LIM',country:'بيرو',city:'ليما',coords:[-12.0464,-77.0428]},
    {id:'BOG',country:'كولومبيا',city:'بوغوتا',coords:[4.711,-74.0721]},
    {id:'CCS',country:'فنزويلا',city:'كاراكاس',coords:[10.4806,-66.9036]},
    {id:'UIO',country:'الإكوادور',city:'كيتو',coords:[-0.1807,-78.4678]},
    {id:'LPB',country:'بوليفيا',city:'لاباز',coords:[-16.5,-68.15]},
    {id:'ASU',country:'باراغواي',city:'أسونسيون',coords:[-25.2637,-57.5759]},
    {id:'MVD',country:'الأوروغواي',city:'مونتيفيديو',coords:[-34.9011,-56.1645]},
    {id:'GEO',country:'غيانا',city:'جورجتاون',coords:[6.8013,-58.1551]},
    {id:'PBM',country:'سورينام',city:'باراماريبو',coords:[5.852,-55.2038]},
    {id:'WLG',country:'نيوزيلندا',city:'ويلينغتون',coords:[-41.2865,174.7762]},
    {id:'POM',country:'بابوا غينيا الجديدة',city:'بورت مورسبي',coords:[-9.4438,147.1803]},
    {id:'SUV',country:'فيجي',city:'سوفا',coords:[-18.1416,178.4419]},
    {id:'HIR',country:'جزر سليمان',city:'هونيارا',coords:[-9.428,159.9498]},
    {id:'VLI',country:'فانواتو',city:'بورت فيلا',coords:[-17.7333,168.3273]},
    {id:'APW',country:'ساموا',city:'آبيا',coords:[-13.8506,-171.7513]},
    {id:'TBU',country:'تونغا',city:'نوكوعالوفا',coords:[-21.1789,-175.1982]},
    {id:'TRW',country:'كيريباس',city:'تاراوا الجنوبية',coords:[1.3382,173.0176]},
    {id:'PNI',country:'ميكرونيسيا',city:'باليكير',coords:[6.9248,158.1611]},
    {id:'MAJ',country:'جزر مارشال',city:'ماجورو',coords:[7.1164,171.1858]},
    {id:'ROR',country:'بالاو',city:'نغيرولمود',coords:[7.5006,134.6242]},
    {id:'INU',country:'ناورو',city:'يارين',coords:[-0.5477,166.9209]},
    {id:'FUN',country:'توفالو',city:'فونافوتي',coords:[-8.5199,179.1979]}
  ]);
  const clone=v=>globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));
  const now=s=>Math.max(0,Number(s.simSeconds)||0);
  const platform=()=>globalThis.GH_COMPANY_PLATFORM||null;
  const facilityOwnerCompanyId=facility=>String(facility?.ownerCompanyId||facility?.companyId||facility?.company||'').trim();
  function mobilityOwnerCompanyId(state,explicit='',{operational=false}={}){
    const companyId=String(explicit||state?.mobility?.ownerCompanyId||'mobility').trim(),P=platform();
    if(P){const company=P.requireCompany(state,companyId,{operational,capability:'operations.mobility'});if(company.status==='compatibility-hold')throw new Error(`mobility-company-compatibility-hold:${companyId}`);return company.id;}
    if(companyId!=='mobility'||operational&&!(state?.openedCompanies||[]).includes(companyId))throw new Error('mobility-company-not-open');return companyId;
  }
  const hash=text=>{let h=2166136261>>>0;for(const c of String(text)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;};
  const random=(seed,min=0,max=1)=>min+(hash(seed)/4294967295)*(max-min);
  const distance=(a,b)=>{const r=Math.PI/180,dLat=(b[0]-a[0])*r,dLon=(b[1]-a[1])*r,x=Math.sin(dLat/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));};

  // Build 350: the OSRM street polyline (~9 KB) is needed only while a trip is ACTIVE. Archived trips are history rows that
  // no screen renders; keeping the geometry made the 1,200-row archive ~10 MB (two thirds of every rollback snapshot and a
  // large part of every save). Everything else about the trip, including routeVersion/routeVerified/routeSource and
  // distanceKm, is kept exactly as before.
  // Rollback contract for Transaction Core row-level snapshots: every write to state.mobility stays at row level
  // (a field of mobility, a collection's membership, or a field of a collection member); nested arrays and objects
  // inside a member are replaced, never edited in place. Archived trips, events and cached street routes are never
  // edited after insertion. tests/build358-row-snapshot-rollback.cjs proves exact rollback of real simulation slices.
  const IMMUTABLE_ROWS=new Set(['tripArchive','events','streetRoutes']);
  const ROLLBACK_POLICY=Object.freeze({level:'rows',immutable:Object.freeze([...IMMUTABLE_ROWS])});
  // The same rows are shared, sealed, between a durable draft and the live state.
  (globalThis.GH_TRANSACTION_CORE?.registerSealedCollections||((root,keys)=>(globalThis.__GH_PENDING_SEALED_COLLECTIONS__=globalThis.__GH_PENDING_SEALED_COLLECTIONS__||[]).push([root,keys])))('mobility',[...IMMUTABLE_ROWS]);
  function archivedTrip(trip,outcome){const {route,...rest}=trip;void route;return {...rest,...outcome};}
  function ensure(state,explicitOwner='',options={}){
    const ownerCompanyId=mobilityOwnerCompanyId(state,explicitOwner),m=state.mobility=state.mobility&&typeof state.mobility==='object'?state.mobility:{};
    if(m.ownerCompanyId&&String(m.ownerCompanyId)!==ownerCompanyId)throw new Error('mobility-state-owner-conflict');m.ownerCompanyId=ownerCompanyId;
    m.schema='gh-mobility-v4';m.version=VERSION;
    for(const key of ['vehicles','drivers','rideRequests','activeTrips','tripArchive','events','capitalCenters'])m[key]=Array.isArray(m[key])?m[key]:[];
    // Archived trips and events are immutable once written (ROLLBACK_POLICY): a legacy row is replaced, not edited.
    const wasCanonicalRouteSchema=m.routeSchemaVersion===3,buildSimulationIndexes=options?.simulationIndexes===true,validatedIndexes=buildSimulationIndexes?{vehiclesByCenter:new Map(),driversByCenter:new Map(),fleetCounts:new Map(),dedicatedDriverIds:new Set()}:null;
    for(const key of ['vehicles','drivers','rideRequests','activeTrips','tripArchive','events','capitalCenters']){const rows=m[key];for(let index=0;index<rows.length;index++){let row=rows[index];if(!row){rows.splice(index--,1);continue;}if(row.ownerCompanyId&&String(row.ownerCompanyId)!==ownerCompanyId)throw new Error(`mobility-row-owner-conflict:${key}:${row.id||'unknown'}`);const strip=key==='tripArchive'&&Object.prototype.hasOwnProperty.call(row,'route');if(row.ownerCompanyId!==ownerCompanyId||strip){if(IMMUTABLE_ROWS.has(key)){const {route,...rest}=row;void route;row=rows[index]={...(strip?rest:row),ownerCompanyId};}else row.ownerCompanyId=ownerCompanyId;}if(validatedIndexes&&key==='vehicles'){const centerId=row.centerId||'RUH',group=validatedIndexes.vehiclesByCenter.get(centerId)||[];group.push(row);validatedIndexes.vehiclesByCenter.set(centerId,group);validatedIndexes.fleetCounts.set(centerId,(validatedIndexes.fleetCounts.get(centerId)||0)+1);if(row.driverId)validatedIndexes.dedicatedDriverIds.add(row.driverId);}else if(validatedIndexes&&key==='drivers'){const centerId=row.centerId||'RUH',group=validatedIndexes.driversByCenter.get(centerId)||[];group.push(row);validatedIndexes.driversByCenter.set(centerId,group);}}}
    m.status=m.vehicles.length?'active':'not-launched';
    m.zones=clone(ZONES);m.sequence=Math.max(0,Number(m.sequence)||0);
    m.lastDemandAtByCenter=m.lastDemandAtByCenter&&typeof m.lastDemandAtByCenter==='object'?m.lastDemandAtByCenter:{};
    m.streetRoutes=m.streetRoutes&&typeof m.streetRoutes==='object'&&!Array.isArray(m.streetRoutes)?m.streetRoutes:{};
    for(const center of m.capitalCenters)if(center?.capitalId&&!(center.capitalId in m.lastDemandAtByCenter))m.lastDemandAtByCenter[center.capitalId]=now(state);
    // Route migration is a one-time save repair. Rewalking and reallocating the
    // complete fleet on every marker refresh made large Mobility fleets scale
    // with render frequency instead of actual simulation work.
    if(m.routeSchemaVersion!==3){
      for(const [index,vehicle] of m.vehicles.entries()){const spec=CLASSES.find(x=>x.id===vehicle.assetClass);if(!spec)continue;const serial=Math.max(1,Number(String(vehicle.id||'').split('-').pop())||index+1);vehicle.manufacturer=vehicle.manufacturer||spec.manufacturer;vehicle.model=vehicle.model||spec.models[(serial-1)%spec.models.length];vehicle.realModel=vehicle.realModel||vehicle.model;vehicle.routeLocked=true;vehicle.routeVersion=3;vehicle.routeSource='OSRM · شبكة الشوارع الفعلية';vehicle.centerId=vehicle.centerId||'RUH';vehicle.baseLocation=vehicle.baseLocation||(vehicle.centerId==='RUH'?'الرياض':centerMeta(state,vehicle.centerId)?.city)||'الرياض';}
      for(const driver of m.drivers)driver.centerId=driver.centerId||'RUH';
      for(const request of m.rideRequests)request.centerId=request.centerId||'RUH';
      // Legacy synthetic L-shaped routes were not streets. Keep the vehicle at
      // pickup until the road provider supplies a verified geometry.
      for(const trip of m.activeTrips){trip.centerId=trip.centerId||'RUH';const zones=zonesFor(state,trip.centerId),from=zones.find(z=>z.id===trip.fromZone)||zones[0],key=streetRouteKey(trip.centerId,trip.fromZone,trip.toZone),cached=m.streetRoutes[key],verified=validStreetRoute(cached?.route);trip.route=verified?clone(cached.route):[[...from.coords],[...from.coords]];trip.routeLocked=true;trip.routeVersion=3;trip.routeVerified=verified;trip.progress=verified?Math.max(0,Math.min(1,Number(trip.progress)||0)):0;trip.dueAt=verified&&Number.isFinite(Number(trip.dueAt))?Number(trip.dueAt):null;trip.routeSource=verified?'OSRM · شبكة الشوارع الفعلية':'بانتظار مسار شارع موثّق';if(verified)trip.routingDeadlineAt=null;else{trip.acceptedAt=now(state);trip.routingDeadlineAt=trip.acceptedAt+ROUTE_WAIT_TIMEOUT_SECONDS;}if(!verified&&cached)delete m.streetRoutes[key];}
      m.routeSchemaVersion=3;
    }
    const legacyKpis=m.kpis||{};m.kpis={requests:0,accepted:0,completed:0,cancelled:0,grossBookings:0,driverPayouts:0,platformRevenue:0,avgRating:4.91,acceptanceRate:100,completionRate:100,...legacyKpis};
    if(!Number.isFinite(Number(legacyKpis.accepted)))m.kpis.accepted=Math.max(Number(m.kpis.completed)||0,(Number(m.kpis.requests)||0)-(Number(m.kpis.cancelled)||0)-m.rideRequests.filter(request=>request.status==='queued').length);
    m.kpisByCenter=m.kpisByCenter&&typeof m.kpisByCenter==='object'?m.kpisByCenter:{};
    // Reuse the vehicle/driver rows already owner-validated above. The simulation still
    // checks every row at the trusted boundary, but avoids a second fleet-wide pass.
    if(validatedIndexes&&wasCanonicalRouteSchema&&m.routeSchemaVersion===3)simulationIndexCache.set(m,{vehicles:m.vehicles,vehicleLength:m.vehicles.length,drivers:m.drivers,driverLength:m.drivers.length,indexes:validatedIndexes});
    else if(buildSimulationIndexes)simulationIndexCache.delete(m);
    return m;
  }
  function centerKpis(m,capitalId){return m.kpisByCenter[capitalId]||(m.kpisByCenter[capitalId]={completed:0,grossBookings:0,driverPayouts:0,platformRevenue:0});}
  function capitalMeta(capitalId){const cap=CAPITALS.find(c=>c.id===String(capitalId||''));return cap?{capitalId:cap.id,city:cap.city,country:cap.country,coords:[...cap.coords]}:null;}
  function centerMeta(state,capitalId){
    const saved=(state.mobility?.capitalCenters||[]).find(c=>c.capitalId===capitalId);
    if(saved)return saved;
    const ownerCompanyId=mobilityOwnerCompanyId(state),facility=(state.customHubs||[]).find(f=>f.owned===true&&facilityOwnerCompanyId(f)===ownerCompanyId&&f.kind==='mobility-center'&&f.capitalId===capitalId);
    return facility?{id:facility.id,facilityId:facility.id,capitalId,city:facility.city,country:facility.country,coords:[...facility.coords]}:null;
  }
  function capitalZones(capital){
    const [lat,lon]=capital.coords;
    const ring=[
      {suffix:'CBD',label:`وسط ${capital.city}`,dLat:0,dLon:0,weight:1.22},
      {suffix:'AIRPORT',label:`مطار ${capital.city}`,dLat:.14,dLon:.09,weight:1.1},
      {suffix:'BUSINESS',label:`الحي التجاري · ${capital.city}`,dLat:.05,dLon:-.08,weight:1.15},
      {suffix:'NORTH',label:`الضاحية الشمالية · ${capital.city}`,dLat:.11,dLon:-.02,weight:.9},
      {suffix:'SOUTH',label:`الضاحية الجنوبية · ${capital.city}`,dLat:-.11,dLon:.02,weight:.88},
      {suffix:'STATION',label:`محطة النقل المركزية · ${capital.city}`,dLat:-.04,dLon:-.1,weight:1}
    ];
    return ring.map(z=>({id:`${capital.id}-${z.suffix}`,name:z.label,coords:[lat+z.dLat,lon+z.dLon],weight:z.weight}));
  }
  function zonesFor(state,capitalId){
    const meta=centerMeta(state,capitalId);if(!meta)return ZONES;
    if(capitalId==='RUH')return ZONES;
    return capitalZones({id:capitalId,city:meta.city,coords:meta.coords});
  }
  function activeCenters(state,m){
    const list=[],seen=new Set();
    for(const c of m.capitalCenters||[])if(c?.capitalId&&!seen.has(c.capitalId)){seen.add(c.capitalId);list.push({capitalId:c.capitalId,city:c.city,zones:zonesFor(state,c.capitalId)});}
    return list;
  }
  function id(m,prefix){m.sequence++;return `${prefix}-${String(m.sequence).padStart(7,'0')}`;}
  function classCounts(total,classId=null){const exact=classId&&CLASSES.find(spec=>spec.id===classId);if(exact)return [{spec:exact,count:total}];const denominator=CLASSES.reduce((sum,spec)=>sum+spec.count,0),rows=CLASSES.map(spec=>({spec,count:Math.floor(total*spec.count/denominator)}));let left=total-rows.reduce((sum,row)=>sum+row.count,0);for(let i=0;left>0;i++,left--)rows[i%rows.length].count++;return rows;}
  function vehicleBatch(m,total,centerId,cityLabel,zones,classId=null){let serial=m.vehicles.length;const created=[];for(const {spec,count} of classCounts(total,classId))for(let i=0;i<count;i++){const model=spec.models[serial%spec.models.length];serial++;const vehicle={id:id(m,'MOB-V'),ownerCompanyId:m.ownerCompanyId,assetClass:spec.id,platformAssetClass:'mobility-vehicle',name:`${spec.name} · ${model} ${String(serial).padStart(4,'0')}`,manufacturer:spec.manufacturer,model,realModel:model,icon:spec.icon,capacity:spec.capacity,purchasePrice:spec.cost,ownership:'owned',condition:100,battery:100,status:'available',centerId,zoneId:zones[(serial-1)%zones.length].id,baseLocation:cityLabel,tripId:null,totalTrips:0,totalKm:0,routeLocked:true,routeVersion:3,routeSource:'OSRM · شبكة الشوارع الفعلية',commissionedAt:m.lastPurchaseAt||0};m.vehicles.push(vehicle);created.push(vehicle);}return created;}
  function driverBatch(state,m,vehicles,source='شراء يدوي',centerId,cityLabel,zones){const company=m.ownerCompanyId,first=m.drivers.length,created=[],hr=globalThis.GH_HR_CORE?.ensure?.(state);if(!hr)throw new Error('hr-core-missing');hr.hiringLog=Array.isArray(hr.hiringLog)?hr.hiringLog:[];for(let i=0;i<vehicles.length;i++){const vehicle=vehicles[i],driver={id:id(m,'DRV'),ownerCompanyId:company,name:`سائق ${String(first+i+1).padStart(4,'0')}`,status:'online',rating:Number(random(`driver:${first+i}`,4.72,4.99).toFixed(2)),centerId,zoneId:zones[(first+i)%zones.length].id,tripId:null,totalTrips:0,earnings:0,monthlySalary:6000,assetId:vehicle.id,automaticAssetStaffing:true};vehicle.driverId=driver.id;vehicle.staffing={mode:'automatic-fixed',ready:true,roles:[{id:'mobility-driver',name:'سائق تنقل حضري',count:1,monthlyPayroll:6000}],total:1,monthlyPayroll:6000,driverId:driver.id};m.drivers.push(driver);created.push(driver);hr.employmentContracts.unshift({id:id(m,'EMP-MOB'),assetId:vehicle.id,company,ownerCompanyId:company,name:`سائق ثابت · ${vehicle.name}`,role:'سائق تنقل حضري',count:1,center:`شبكة ${cityLabel} الحضرية`,salary:6000,startDay:Math.floor(now(state)/86400),termMonths:1200,status:'ساري',source,automaticAssetStaffing:true,permanent:true});}if(created.length){hr.hiringLog.unshift({id:id(m,'HR-MOB'),at:now(state),company,ownerCompanyId:company,source,total:created.length,monthlyPayroll:created.length*6000,centerId,coverageBefore:100,coverageAfter:100});hr.hiringLog=hr.hiringLog.slice(0,200);}return created;}
  const acquisitionCost=(total,classId=null)=>classCounts(total,classId).reduce((sum,row)=>sum+row.spec.cost*row.count,0);
  function recordFleetPurchase(state,m,total,note,centerId,cityLabel,zones,classId=null){const company=m.ownerCompanyId,center=(state.customHubs||[]).find(f=>f.owned===true&&facilityOwnerCompanyId(f)===company&&f.kind==='mobility-center'&&f.capitalId===centerId);if(!center)throw new Error('mobility-center-not-open');const occupied=m.vehicles.filter(v=>v.centerId===centerId).length,capacity=Math.max(1,Number(center.bays)||Number(globalThis.GH_FACILITY_CORE?.DEFAULT_ASSET_CAPACITY?.['mobility-center'])||3000);if(occupied+total>capacity)throw new Error(`mobility-center-capacity:${Math.max(0,capacity-occupied)}/${capacity}`);const capex=acquisitionCost(total,classId);if(!globalThis.GH_FINANCE_CORE?.execute)throw new Error('finance-core-missing');const payment=globalThis.GH_FINANCE_CORE.execute({state},'pay-by-cheque',{company,amount:capex,note,beneficiary:'مورّدو أسطول GH Mobility',taxable:false,line:'capex',requestRef:id(m,`MOBILITY-${centerId}`)});if(!payment?.cheque?.id||payment.cheque.status!=='مصروف')throw new Error('mobility-cheque-not-cleared');m.lastPurchaseAt=now(state);const vehicles=vehicleBatch(m,total,centerId,cityLabel,zones,classId),drivers=driverBatch(state,m,vehicles,'تجهيز آلي ثابت مرتبط بشراء المركبات',centerId,cityLabel,zones);m.events.unshift({id:id(m,'MOB-EV'),ownerCompanyId:company,at:now(state),type:'MANUAL_FLEET_PURCHASE',centerId,vehiclesAdded:vehicles.length,driversAdded:drivers.length,capex,classId:classId||'mixed',chequeId:payment.cheque.id,invoiceNumber:payment.invoice.number});return {ownerCompanyId:company,capex,vehicles,drivers,chequeId:payment.cheque.id,invoiceNumber:payment.invoice.number};}
  function streetRouteKey(centerId,fromZone,toZone){return `${centerId||'RUH'}:${fromZone||''}:${toZone||''}`;}
  function validStreetRoute(route){return Array.isArray(route)&&route.length>=2&&route.length<=10000&&route.every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)&&Math.abs(point[0])<=90&&Math.abs(point[1])<=180);}
  // Retained only as a compatibility helper for old tests/extensions. Runtime
  // trips never use this synthetic shape after schema v4.
  function urbanPath(from,to){const a=from?.coords,b=to?.coords;if(!Array.isArray(a)||!Array.isArray(b))return [[0,0],[0,0]];const latDelta=b[0]-a[0],lonDelta=b[1]-a[1],laneLon=a[1]+lonDelta*.46,laneLat=a[0]+latDelta*.58;return [[...a],[a[0],laneLon],[laneLat,laneLon],[laneLat,b[1]],[...b]];}
  function routePosition(route,progress){if(!Array.isArray(route)||route.length<2)return route?.[0]||[0,0];let total=0;const lengths=route.slice(0,-1).map((point,i)=>{const d=distance(point,route[i+1]);total+=d;return d;});let target=Math.max(0,Math.min(1,Number(progress)||0))*total;for(let i=0;i<lengths.length;i++){const d=lengths[i];if(target<=d){const t=d?target/d:0;return [route[i][0]+(route[i+1][0]-route[i][0])*t,route[i][1]+(route[i+1][1]-route[i][1])*t];}target-=d;}return [...route[route.length-1]];}
  function zone(zones,index){return zones[((index%zones.length)+zones.length)%zones.length];}
  function generate(m,zones,at,centerId){const seq=m.sequence+1,from=zone(zones,hash(`from:${centerId}:${seq}:${Math.floor(at/45)}`)),to=zone(zones,zones.indexOf(from)+1+Math.floor(random(`to:${centerId}:${seq}`,0,zones.length-1))),km=Math.max(2.2,distance(from.coords,to.coords)*1.22),pick=random(`class:${centerId}:${seq}`),service=pick>.94?CLASSES[2]:pick>.82?CLASSES[3]:pick>.56?CLASSES[1]:CLASSES[0],surge=Number((1+Math.max(0,random(`surge:${centerId}:${Math.floor(at/900)}`,-.08,.55))).toFixed(2)),fare=Number((service.base+km*service.rate*surge).toFixed(2));m.rideRequests.push({id:id(m,'RIDE'),ownerCompanyId:m.ownerCompanyId,requestedAt:at,status:'queued',centerId,fromZone:from.id,toZone:to.id,distanceKm:Number(km.toFixed(2)),service:service.id,surge,fare});m.kpis.requests++;}
  function simulationIndexes(m){let cached=simulationIndexCache.get(m);if(!cached||cached.vehicles!==m.vehicles||cached.vehicleLength!==m.vehicles.length||cached.drivers!==m.drivers||cached.driverLength!==m.drivers.length){const vehiclesByCenter=new Map(),driversByCenter=new Map(),fleetCounts=new Map(),dedicatedDriverIds=new Set();for(const vehicle of m.vehicles){const centerId=vehicle.centerId||'RUH',rows=vehiclesByCenter.get(centerId)||[];rows.push(vehicle);vehiclesByCenter.set(centerId,rows);fleetCounts.set(centerId,(fleetCounts.get(centerId)||0)+1);if(vehicle.driverId)dedicatedDriverIds.add(vehicle.driverId);}for(const driver of m.drivers){const centerId=driver.centerId||'RUH',rows=driversByCenter.get(centerId)||[];rows.push(driver);driversByCenter.set(centerId,rows);}cached={vehicles:m.vehicles,vehicleLength:m.vehicles.length,drivers:m.drivers,driverLength:m.drivers.length,indexes:{vehiclesByCenter,driversByCenter,fleetCounts,dedicatedDriverIds}};simulationIndexCache.set(m,cached);}const activeRouteKeys=new Set();for(const trip of m.activeTrips)activeRouteKeys.add(streetRouteKey(trip.centerId,trip.fromZone,trip.toZone));return {...cached.indexes,activeRouteKeys};}
  function dispatch(m,at,centerId,zones,indexes){
    let assigned=0;
    const queued=m.rideRequests.filter(request=>request.status==='queued'&&request.centerId===centerId);if(!queued.length)return 0;
    const available=(indexes.vehiclesByCenter.get(centerId)||[]).filter(v=>v.status==='available'),onlineDrivers=(indexes.driversByCenter.get(centerId)||[]).filter(d=>d.status==='online'),driverById=new Map(onlineDrivers.map(driver=>[driver.id,driver])),driverByAsset=new Map(onlineDrivers.filter(driver=>driver.assetId).map(driver=>[driver.assetId,driver])),legacyDrivers=onlineDrivers.filter(driver=>!driver.assetId&&!indexes.dedicatedDriverIds.has(driver.id)),byClass=new Map(),claimedVehicles=new Set(),claimedDrivers=new Set();
    for(const vehicle of available){const queue=byClass.get(vehicle.assetClass)||[];queue.push(vehicle);byClass.set(vehicle.assetClass,queue);}
    const driverFor=vehicle=>{const fixed=driverById.get(vehicle.driverId)||driverByAsset.get(vehicle.id);if(fixed&&!claimedDrivers.has(fixed.id))return fixed;while(legacyDrivers.length){const fallback=legacyDrivers.pop();if(!claimedDrivers.has(fallback.id))return fallback;}return null;};
    const takeFrom=(queue,pickupZone)=>{while(queue.length){let index=queue.findIndex(vehicle=>vehicle.zoneId===pickupZone&&!claimedVehicles.has(vehicle.id));if(index<0)index=queue.length-1;const [vehicle]=queue.splice(index,1);if(!vehicle||claimedVehicles.has(vehicle.id))continue;const driver=driverFor(vehicle);if(!driver)continue;claimedVehicles.add(vehicle.id);claimedDrivers.add(driver.id);return {vehicle,driver};}return null;};
    const takeAssignment=(service,pickupZone)=>takeFrom(byClass.get(service)||[],pickupZone)||takeFrom(available,pickupZone);
    for(const request of queued){
      const exclusiveKey=streetRouteKey(centerId,request.fromZone,request.toZone);if(indexes.activeRouteKeys.has(exclusiveKey))continue;
      const assignment=takeAssignment(request.service,request.fromZone);if(!assignment)break;const {vehicle,driver}=assignment;
      const from=zones.find(z=>z.id===request.fromZone)||zones[0],to=zones.find(z=>z.id===request.toZone)||from,key=exclusiveKey,cached=m.streetRoutes[key],verified=validStreetRoute(cached?.route),route=verified?clone(cached.route):[[...from.coords],[...from.coords]],pickup=45+Math.round(random(`pickup:${request.id}`,25,150)),roadSeconds=Math.max(180,Number(cached?.durationSeconds)||Math.round(request.distanceKm/30*3600)),duration=pickup+roadSeconds;request.status='active';request.acceptedAt=at;request.vehicleId=vehicle.id;request.driverId=driver.id;request.tripId=id(m,'TRIP');vehicle.status='moving';vehicle.tripId=request.tripId;vehicle.routeLocked=true;vehicle.routeVersion=3;driver.status='on-trip';driver.tripId=request.tripId;m.activeTrips.push({id:request.tripId,ownerCompanyId:m.ownerCompanyId,requestId:request.id,vehicleId:vehicle.id,driverId:driver.id,centerId,fromZone:request.fromZone,toZone:request.toZone,exclusiveRouteKey:key,acceptedAt:at,startedAt:at,routingReadyAt:verified?at:null,routingDeadlineAt:verified?null:at+ROUTE_WAIT_TIMEOUT_SECONDS,dueAt:verified?at+duration:null,duration,pickupSeconds:pickup,distanceKm:Number(cached?.distanceKm)||request.distanceKm,fare:request.fare,progress:0,route,routeLocked:true,routeVersion:3,routeVerified:verified,routeSource:verified?'OSRM · شبكة الشوارع الفعلية':'بانتظار مسار شارع موثّق'});indexes.activeRouteKeys.add(key);m.kpis.accepted++;assigned++;
    }
    if(assigned)noteMapStructureChange();return assigned;
  }
  function launch(ctx){const state=ctx.state||ctx,owner=mobilityOwnerCompanyId(state,ctx.ownerCompanyId,{operational:true}),m=ensure(state,owner);if(!m.capitalCenters.length)throw new Error('mobility-center-required');if(!m.vehicles.length)throw new Error('mobility-purchase-required');m.status='active';m.launchedAt=m.launchedAt||now(state);return snapshot(state);}
  function buyFleet(ctx,{quantity=1,centerId='',classId=null,ownerCompanyId=''}={}){const state=ctx.state||ctx,owner=mobilityOwnerCompanyId(state,ownerCompanyId,{operational:true}),m=ensure(state,owner),qty=Math.max(1,Math.min(MAX_FLEET_PURCHASE_QUANTITY,Math.round(Number(quantity)||1))),meta=centerMeta(state,centerId);if(!meta)throw new Error('mobility-center-not-open');if(classId&&!CLASSES.some(spec=>spec.id===classId))throw new Error('mobility-class-invalid');const zones=zonesFor(state,centerId),transaction=globalThis.GH_TRANSACTION_CORE;if(!transaction?.execute)throw new Error('transaction-core-missing');const runner=transaction.isActive()?transaction.join:transaction.execute,out=runner(state,{label:'mobility-asset-purchase',apply:()=>{if(!(centerId in m.lastDemandAtByCenter))m.lastDemandAtByCenter[centerId]=now(state);recordFleetPurchase(state,m,qty,`شراء يدوي وتسليم فوري · GH Mobility · ${meta.city} · ${qty} مركبة`,centerId,meta.city,zones,classId);const facility=(state.customHubs||[]).find(row=>row?.owned===true&&row.kind==='mobility-center'&&facilityOwnerCompanyId(row)===owner&&row.capitalId===centerId),hr=globalThis.GH_HR_CORE;if(!facility||!hr?.executeHiring)throw new Error('mobility-facility-hr-missing');hr.executeHiring(state,{facilityId:facility.id},owner,'توسعة آلية لفريق مركز التنقل حسب الأسطول الفعلي','facility');noteMapStructureChange();m.status='active';m.launchedAt=m.launchedAt||now(state);return snapshot(state);}});return out.value;}
  function complete(state,m,at,indexes=null){
    const company=m.ownerCompanyId,done=[];
    for(const trip of m.activeTrips)if(trip.routeVerified===true&&Number.isFinite(Number(trip.dueAt))&&Number(trip.dueAt)<=at)done.push(trip);
    if(!done.length){const expiredCompleted=m.rideRequests.length>1600||m.rideRequests.some(request=>request.status==='completed'&&at-Number(request.completedAt||0)>=86400);if(expiredCompleted)m.rideRequests=m.rideRequests.filter(request=>request.status!=='completed'||at-Number(request.completedAt||0)<86400).slice(-1600);return 0;}
    const doneIds=new Set(done.map(trip=>trip.id)),open=m.activeTrips.filter(trip=>!doneIds.has(trip.id));
    let gross=0,payout=0;const perCenter={},requestIndex=new Map(m.rideRequests.map(row=>[row.id,row])),vehicleTrips=new Map(done.map(trip=>[trip.vehicleId,trip])),driverTrips=new Map(done.map(trip=>[trip.driverId,trip]));
    for(const trip of done){if(trip.ownerCompanyId!==company)throw new Error(`mobility-trip-owner-conflict:${trip.id}`);const request=requestIndex.get(trip.requestId),driverPay=trip.fare*.10,platform=trip.fare-driverPay,cid=trip.centerId||'RUH';if(indexes)indexes.activeRouteKeys.delete(streetRouteKey(trip.centerId,trip.fromZone,trip.toZone));if(request){request.status='completed';request.completedAt=trip.dueAt;}gross+=trip.fare;payout+=driverPay;const pc=perCenter[cid]||(perCenter[cid]={completed:0,gross:0,payout:0});pc.completed++;pc.gross+=trip.fare;pc.payout+=driverPay;m.tripArchive.unshift(archivedTrip(trip,{status:'completed',completedAt:trip.dueAt,driverPayout:driverPay,platformRevenue:platform}));}
    for(const vehicle of m.vehicles){const trip=vehicleTrips.get(vehicle.id);if(!trip)continue;vehicle.status='available';vehicle.zoneId=trip.toZone;vehicle.tripId=null;vehicle.totalTrips++;vehicle.totalKm+=trip.distanceKm;vehicle.battery=Math.max(18,vehicle.battery-trip.distanceKm*.42);if(vehicle.battery<30)vehicle.battery=100;}
    for(const driver of m.drivers){const trip=driverTrips.get(driver.id);if(!trip)continue;const driverPay=trip.fare*.10;driver.status='online';driver.zoneId=trip.toZone;driver.tripId=null;driver.totalTrips++;driver.earnings+=driverPay;}
    m.activeTrips=open;m.tripArchive=m.tripArchive.slice(0,1200);m.rideRequests=m.rideRequests.filter(request=>request.status!=='completed'||at-Number(request.completedAt||0)<86400).slice(-1600);
    const operatingCost=payout+gross*.16,profit=gross-operatingCost,money={[company]:profit},revenue={[company]:gross},costs={[company]:operatingCost},count={[company]:done.length};m.kpis.completed+=done.length;m.kpis.grossBookings+=gross;m.kpis.driverPayouts+=payout;m.kpis.platformRevenue+=profit;
    for(const cid of Object.keys(perCenter)){const pc=perCenter[cid],centerOpCost=pc.payout+pc.gross*.16,centerProfit=pc.gross-centerOpCost,ck=centerKpis(m,cid);ck.completed+=pc.completed;ck.grossBookings+=pc.gross;ck.driverPayouts+=pc.payout;ck.platformRevenue+=centerProfit;}
    globalThis.GH_FINANCE_CORE?.execute?.({state},'apply-simulation-journal',{journal:{todayProfit:profit,sectorProfit:money,tripProfit:money,tripRevenue:revenue,tripFuel:costs,tripMaintenance:{[company]:0},tripCount:count,cash:money}});globalThis.GH_CORPORATE_CORE?.execute?.({state},'adjust-group-value',{delta:Math.max(0,profit)*.08});noteMapStructureChange();return done.length;
  }
  function releaseRoutingTimeouts(m,at,indexes=null){
    const expired=m.activeTrips.filter(trip=>trip.routeVerified!==true&&at>=Math.max(Number(trip.routingDeadlineAt)||0,(Number(trip.acceptedAt)||0)+ROUTE_WAIT_TIMEOUT_SECONDS));if(!expired.length)return 0;
    const ids=new Set(expired.map(trip=>trip.id)),requests=new Map(m.rideRequests.map(row=>[row.id,row])),vehicleTrips=new Map(expired.map(trip=>[trip.vehicleId,trip])),driverTrips=new Map(expired.map(trip=>[trip.driverId,trip]));
    for(const trip of expired){if(indexes)indexes.activeRouteKeys.delete(streetRouteKey(trip.centerId,trip.fromZone,trip.toZone));const request=requests.get(trip.requestId),reason='تعذر تثبيت مسار شارع خلال 15 دقيقة';if(request){request.status='cancelled';request.cancelledAt=at;request.cancelReason=reason;}m.kpis.cancelled++;m.tripArchive.unshift(archivedTrip(trip,{status:'cancelled',cancelledAt:at,cancelReason:reason}));m.events.unshift({id:id(m,'MOB-EV'),at,type:'ROUTE_TIMEOUT_RELEASED',tripId:trip.id,vehicleId:trip.vehicleId,driverId:trip.driverId,centerId:trip.centerId});}
    for(const vehicle of m.vehicles){const trip=vehicleTrips.get(vehicle.id);if(!trip)continue;vehicle.status='available';vehicle.zoneId=trip.fromZone||vehicle.zoneId;vehicle.tripId=null;}for(const driver of m.drivers){const trip=driverTrips.get(driver.id);if(!trip)continue;driver.status='online';driver.zoneId=trip.fromZone||driver.zoneId;driver.tripId=null;}m.activeTrips=m.activeTrips.filter(trip=>!ids.has(trip.id));m.tripArchive=m.tripArchive.slice(0,1200);m.events=m.events.slice(0,600);noteMapStructureChange();return expired.length;
  }
  function advanceMobilityState(state,m,target,indexes=null){
    const at=Math.max(now(state),Number(target)||0);
    if(m.status!=='active'||!m.vehicles.length)return managementSnapshot(state);
    mobilityOwnerCompanyId(state,m.ownerCompanyId,{operational:true});
    indexes=indexes||simulationIndexes(m);
    releaseRoutingTimeouts(m,at,indexes);
    complete(state,m,at,indexes);
    for(const center of activeCenters(state,m)){
      const cid=center.capitalId,zones=center.zones;
      if(!(cid in m.lastDemandAtByCenter))m.lastDemandAtByCenter[cid]=at;
      const fleetCount=indexes.fleetCounts.get(cid)||0,queueCap=Math.max(8,Math.min(80,fleetCount*2)),demandInterval=Math.max(30,Math.round(105-Math.min(60,fleetCount*1.5)));let generated=0,next=m.lastDemandAtByCenter[cid]+demandInterval,queuedCount=m.rideRequests.reduce((count,request)=>count+(request.centerId===cid&&request.status==='queued'?1:0),0);
      while(next<=at&&generated<240&&queuedCount<queueCap){generate(m,zones,next,cid);generated++;queuedCount++;next+=demandInterval;}
      m.lastDemandAtByCenter[cid]=next<=at?at:Math.max(m.lastDemandAtByCenter[cid],next-demandInterval);
      dispatch(m,at,cid,zones,indexes);
      for(const request of m.rideRequests.filter(row=>row.centerId===cid&&row.status==='queued'&&at-row.requestedAt>600)){request.status='cancelled';request.cancelledAt=at;request.cancelReason='لم تتوفر مركبة خلال 10 دقائق';m.kpis.cancelled++;}
    }
    for(const t of m.activeTrips)t.progress=t.routeVerified===true?Math.max(0,Math.min(1,(at-t.startedAt)/Math.max(1,t.duration))):0;
    m.kpis.acceptanceRate=m.kpis.requests?Math.round(m.kpis.accepted/m.kpis.requests*1000)/10:100;
    m.kpis.completionRate=m.kpis.requests?Math.round(m.kpis.completed/m.kpis.requests*1000)/10:100;
    return managementSnapshot(state);
  }
  function onSimulationTime(ctx,target){const state=ctx.state||ctx,m=ensure(state,'',{simulationIndexes:true});return advanceMobilityState(state,m,target,simulationIndexes(m));}
  // Mobility creates, dispatches and completes work at sub-hour timestamps (demand every 30-105 s, a bounded queue, 10-minute
  // request expiry). Its model therefore needs to be stepped every MOBILITY_STEP_SECONDS. Until Build 350 that was enforced by
  // shrinking EVERY simulation slice of the whole group to 600 s while the service was active, which multiplied the fixed
  // per-slice cost of the entire fleet by six (a 30-day calendar advance ran about five times slower once Mobility opened).
  // Build 351 keeps the model's cadence exactly and moves it inside the slice: advanceThrough() runs the same sequence of
  // onSimulationTime() calls, each with simSeconds set to that step, as consecutive 600-second slices used to.
  const MOBILITY_STEP_SECONDS=600;
  function advanceThrough(ctx,from,to){
    const state=ctx.state||ctx,start=Number(from),end=Number(to),raw=state?.mobility;
    if(!(raw?.status==='active'&&Array.isArray(raw?.vehicles)&&raw.vehicles.length)||!Number.isFinite(start)||!Number.isFinite(end)||end-start<=MOBILITY_STEP_SECONDS+1e-9)return onSimulationTime(ctx,end);
    const m=ensure(state,'',{simulationIndexes:true}),indexes=simulationIndexes(m);
    const restore=state.simSeconds;
    try{for(let at=start+MOBILITY_STEP_SECONDS;at<end-1e-9;at+=MOBILITY_STEP_SECONDS){state.simSeconds=at;advanceMobilityState(state,m,at,indexes);}}
    finally{state.simSeconds=restore;}
    return advanceMobilityState(state,m,end,indexes);
  }
  function simulationSliceLimit(){return 3600;}
  function snapshot(state){const m=ensure(state),moving=m.vehicles.filter(v=>v.status==='moving').length,queued=m.rideRequests.filter(r=>r.status==='queued').length;return {ownerCompanyId:m.ownerCompanyId,status:m.status,vehicles:m.vehicles.length,available:m.vehicles.length-moving,moving,drivers:m.drivers.length,online:m.drivers.filter(d=>d.status==='online').length,queued,activeTrips:m.activeTrips.length,completed:m.kpis.completed,grossBookings:m.kpis.grossBookings,driverPayouts:m.kpis.driverPayouts,platformRevenue:m.kpis.platformRevenue,acceptanceRate:m.kpis.acceptanceRate,completionRate:m.kpis.completionRate,avgRating:m.kpis.avgRating,zones:m.zones.length,centers:activeCenters(state,m).length,monthlyPayroll:m.drivers.reduce((sum,driver)=>sum+(Number(driver.monthlySalary)||6000),0)};}
  // Read-only dashboard projection: current v4 saves maintain one driver per vehicle and one active trip per moving
  // vehicle. Reuse their bounded counts instead of rescanning a large fleet whenever the company panel is opened.
  // Older/unmigrated saves take the canonical validation path once before the fast projection is used.
  function managementSnapshot(state){const m=state?.mobility;if(!m||m.schema!=='gh-mobility-v4'||m.routeSchemaVersion!==3)return snapshot(state);const vehiclesRows=Array.isArray(m.vehicles)?m.vehicles:[],driverRows=Array.isArray(m.drivers)?m.drivers:[],tripRows=Array.isArray(m.activeTrips)?m.activeTrips:[],requestRows=Array.isArray(m.rideRequests)?m.rideRequests:[],zoneRows=Array.isArray(m.zones)?m.zones:[],moving=Math.min(vehiclesRows.length,tripRows.length),drivers=driverRows.length,vehicles=vehiclesRows.length,queued=requestRows.reduce((count,row)=>count+(row?.status==='queued'?1:0),0),payroll=drivers*6000;return {ownerCompanyId:m.ownerCompanyId,status:m.status,vehicles,available:Math.max(0,vehicles-moving),moving,drivers,online:Math.max(0,drivers-moving),queued,activeTrips:tripRows.length,completed:Number(m.kpis?.completed)||0,grossBookings:Number(m.kpis?.grossBookings)||0,driverPayouts:Number(m.kpis?.driverPayouts)||0,platformRevenue:Number(m.kpis?.platformRevenue)||0,acceptanceRate:Number(m.kpis?.acceptanceRate)||0,completionRate:Number(m.kpis?.completionRate)||0,avgRating:Number(m.kpis?.avgRating)||0,zones:zoneRows.length,centers:activeCenters(state,m).length,monthlyPayroll:payroll};}
  function readMobilityState(state){const m=state?.mobility;return m?.schema==='gh-mobility-v4'&&m.routeSchemaVersion===3&&Array.isArray(m.vehicles)&&Array.isArray(m.drivers)&&Array.isArray(m.rideRequests)&&Array.isArray(m.activeTrips)&&Array.isArray(m.capitalCenters)?m:ensure(state);}
  // إحصاء محلي لمركز عاصمة واحد بعينه (يُستخدم في إدارة منشأة ذلك المركز تحديدًا، بدل الرقم الإجمالي العالمي).
  function centerSnapshot(state,capitalId){const m=ensure(state),vehicles=m.vehicles.filter(v=>v.centerId===capitalId),drivers=m.drivers.filter(d=>d.centerId===capitalId),moving=vehicles.filter(v=>v.status==='moving').length,fin=m.kpisByCenter[capitalId]||{completed:0,grossBookings:0,driverPayouts:0,platformRevenue:0};return {capitalId,vehicles:vehicles.length,moving,available:vehicles.length-moving,drivers:drivers.length,online:drivers.filter(d=>d.status==='online').length,activeTrips:m.activeTrips.filter(t=>t.centerId===capitalId).length,completed:fin.completed,grossBookings:fin.grossBookings,driverPayouts:fin.driverPayouts,platformRevenue:fin.platformRevenue};}
  // اختيار عادل: يجمع حسب المركز أولًا (المتحركة أولًا داخل كل مركز)، ثم يوزّع سقف العرض
  // بالتناوب بين المراكز، حتى لا يبتلع أسطول مدينة كبيرة (كالرياض) كل خانات العرض ويجعل مدينة
  // أصغر تبدو مختفية تمامًا عن الخريطة رغم أنها تعمل فعليًا.
  function selectForDisplay(vehicles,limit){
    const byCenter=new Map();
    for(const v of vehicles){const key=v.centerId||'RUH';if(!byCenter.has(key))byCenter.set(key,[]);byCenter.get(key).push(v);}
    for(const list of byCenter.values())list.sort((a,b)=>(b.status==='moving')-(a.status==='moving'));
    const queues=[...byCenter.values()],picked=[];
    let i=0;while(picked.length<limit&&queues.some(q=>q.length)){const q=queues[i%queues.length];if(q.length)picked.push(q.shift());i++;}
    return picked;
  }
  function liveVehicles(state,limit=120,options={}){
    const m=ensure(state),requested=Number(limit),max=Math.max(0,Math.min(500,Number.isFinite(requested)?requested:120)),includeIds=new Set((options.includeIds||[]).filter(Boolean)),onlyIds=Array.isArray(options.onlyIds)?new Set(options.onlyIds.filter(Boolean)):null,tripByVehicle=new Map(m.activeTrips.map(t=>[t.vehicleId,t]));
    let source=m.vehicles.filter(vehicle=>(!onlyIds||onlyIds.has(vehicle.id))&&(!options.movingOnly||tripByVehicle.has(vehicle.id)||includeIds.has(vehicle.id)));
    const pinned=source.filter(vehicle=>includeIds.has(vehicle.id)),rest=source.filter(vehicle=>!includeIds.has(vehicle.id)),ordered=[...pinned,...selectForDisplay(rest,Math.max(0,max-pinned.length))].slice(0,max),zonesCache=new Map();
    const zoneMap=centerId=>{if(!zonesCache.has(centerId))zonesCache.set(centerId,new Map(zonesFor(state,centerId).map(z=>[z.id,z])));return zonesCache.get(centerId);};
    return ordered.map(vehicle=>{const centerId=vehicle.centerId||'RUH',trip=tripByVehicle.get(vehicle.id),zones=zonesFor(state,centerId),from=zoneMap(centerId).get(trip?.fromZone||vehicle.zoneId)||zones[0],to=zoneMap(centerId).get(trip?.toZone||vehicle.zoneId)||from,progress=trip?Math.max(0,Math.min(1,Number(trip.progress)||0)):0,route=trip&&validStreetRoute(trip.route)?trip.route:[[...from.coords],[...from.coords]];return {id:vehicle.id,ownerCompanyId:vehicle.ownerCompanyId,name:vehicle.name,manufacturer:vehicle.manufacturer,model:vehicle.model,icon:vehicle.icon,type:'mobility',assetMode:'mobility',platformAssetClass:'mobility-vehicle',centerId,phase:trip?'moving':'idle',status:vehicle.status,coords:routePosition(route,progress),route,progress,routeLocked:true,routeVersion:3,routeVerified:!!trip?.routeVerified,tripId:trip?.id||null,driverId:trip?.driverId||null,from:from.name,to:to.name,battery:vehicle.battery,totalTrips:vehicle.totalTrips};});
  }
  function centerClusters(state){const m=readMobilityState(state),rows=[],seen=new Set();let cached=centerFleetCountCache.get(m);if(!cached||cached.vehicles!==m.vehicles||cached.length!==m.vehicles.length||cached.routeSchemaVersion!==m.routeSchemaVersion){const counts=new Map();for(const vehicle of m.vehicles){const centerId=vehicle.centerId||'RUH';counts.set(centerId,(counts.get(centerId)||0)+1);}cached={vehicles:m.vehicles,length:m.vehicles.length,routeSchemaVersion:m.routeSchemaVersion,counts,activeTrips:null,activeTripLength:-1,movingByCenter:new Map()};centerFleetCountCache.set(m,cached);}if(cached.activeTrips!==m.activeTrips||cached.activeTripLength!==m.activeTrips.length){const movingByCenter=new Map();for(const trip of m.activeTrips){const centerId=trip.centerId||'RUH';movingByCenter.set(centerId,(movingByCenter.get(centerId)||0)+1);}cached.activeTrips=m.activeTrips;cached.activeTripLength=m.activeTrips.length;cached.movingByCenter=movingByCenter;}for(const center of m.capitalCenters){const centerId=center?.capitalId;if(!centerId||seen.has(centerId))continue;seen.add(centerId);const vehicles=cached.counts.get(centerId)||0;if(!vehicles)continue;const meta=centerMeta(state,centerId);if(!meta?.coords)continue;const moving=cached.movingByCenter.get(centerId)||0,fin=m.kpisByCenter?.[centerId]||{};rows.push({centerId,city:meta.city,country:meta.country,coords:[...meta.coords],vehicles,moving,available:Math.max(0,vehicles-moving),activeTrips:moving,platformRevenue:Number(fin.platformRevenue)||0});}return rows;}
  function vehiclePosition(state,vehicleId){const m=ensure(state),vehicle=m.vehicles.find(row=>row.id===vehicleId);if(!vehicle)return null;const zones=zonesFor(state,vehicle.centerId),trip=m.activeTrips.find(row=>row.vehicleId===vehicleId);if(trip){const from=zones.find(zone=>zone.id===trip.fromZone)||zones[0],route=validStreetRoute(trip.route)?trip.route:[[...from.coords],[...from.coords]];return routePosition(route,trip.progress);}return zones.find(zone=>zone.id===vehicle.zoneId)?.coords||centerMeta(state,vehicle.centerId)?.coords||null;}
  function pendingStreetRoutes(state,limit=4){const m=ensure(state),seen=new Set(),rows=[];for(const trip of m.activeTrips){const key=streetRouteKey(trip.centerId,trip.fromZone,trip.toZone);if(trip.routeVerified||validStreetRoute(m.streetRoutes[key]?.route)||seen.has(key))continue;const zones=zonesFor(state,trip.centerId),from=zones.find(zone=>zone.id===trip.fromZone),to=zones.find(zone=>zone.id===trip.toZone);if(!from?.coords||!to?.coords)continue;seen.add(key);rows.push({key,centerId:trip.centerId,fromZone:trip.fromZone,toZone:trip.toZone,fromCoords:[...from.coords],toCoords:[...to.coords]});if(rows.length>=Math.max(1,Math.min(8,Number(limit)||4)))break;}return rows;}
  function cacheStreetRoute(ctx,p={}){const state=ctx.state||ctx,m=ensure(state),route=clone(p.route);if(!validStreetRoute(route))throw new Error('mobility-street-route-invalid');const key=streetRouteKey(p.centerId,p.fromZone,p.toZone),row={key,centerId:p.centerId||'RUH',fromZone:String(p.fromZone||''),toZone:String(p.toZone||''),route,distanceKm:Math.max(0,Number(p.distanceKm)||0),durationSeconds:Math.max(1,Number(p.durationSeconds)||1),cachedAtSim:now(state),source:'OSRM'};m.streetRoutes[key]=row;for(const trip of m.activeTrips.filter(item=>streetRouteKey(item.centerId,item.fromZone,item.toZone)===key)){const readyAt=now(state),pickup=Math.min(195,Math.max(45,Number(trip.pickupSeconds)||90));trip.route=clone(route);trip.routeVerified=true;trip.routeVersion=3;trip.routeSource='OSRM · شبكة الشوارع الفعلية';trip.routingReadyAt=readyAt;trip.startedAt=readyAt;trip.distanceKm=row.distanceKm||trip.distanceKm;trip.duration=pickup+row.durationSeconds;trip.dueAt=readyAt+trip.duration;trip.progress=0;}const keys=Object.keys(m.streetRoutes);if(keys.length>1600)keys.sort((a,b)=>Number(m.streetRoutes[a]?.cachedAtSim)-Number(m.streetRoutes[b]?.cachedAtSim)).slice(0,keys.length-1600).forEach(old=>delete m.streetRoutes[old]);return row;}
  function findVehicle(state,vehicleId){return ensure(state).vehicles.find(vehicle=>vehicle.id===vehicleId)||null;}
  function serviceVehicle(ctx,{id:vehicleId}={}){const state=ctx.state||ctx,m=ensure(state),company=mobilityOwnerCompanyId(state,m.ownerCompanyId,{operational:true}),vehicle=findVehicle(state,vehicleId);if(!vehicle)throw new Error('mobility-vehicle-not-found');if(vehicle.ownerCompanyId!==company)throw new Error('mobility-vehicle-owner-conflict');if(vehicle.status==='moving')throw new Error('mobility-vehicle-moving');if(!globalThis.GH_FINANCE_CORE?.execute)throw new Error('finance-core-missing');const transaction=globalThis.GH_TRANSACTION_CORE;if(!transaction?.execute)throw new Error('transaction-core-missing');const runner=transaction.isActive()?transaction.join:transaction.execute,out=runner(state,{label:'mobility-vehicle-service',apply:()=>{const payment=globalThis.GH_FINANCE_CORE.execute({state},'pay-by-cheque',{company,amount:850,note:`صيانة ${vehicle.name}`,beneficiary:'GH Mobility Service Network',line:'maintenance',requestRef:`MOB-MAINT-${vehicle.id}-${Math.floor(now(state))}`});if(!payment?.cheque?.id||payment.cheque.status!=='مصروف')throw new Error('mobility-maintenance-cheque-not-cleared');vehicle.condition=100;vehicle.battery=100;vehicle.lastServiceAt=now(state);vehicle.lastServiceCheque=payment.cheque.id;vehicle.lastServiceInvoice=payment.invoice.number;m.events.unshift({id:id(m,'MOB-EV'),ownerCompanyId:company,at:now(state),type:'VEHICLE_SERVICED',vehicleId,chequeId:payment.cheque.id,invoiceNumber:payment.invoice.number});return vehicle;}});return out.value;}
  function sellVehicle(ctx,{id:vehicleId}={}){const state=ctx.state||ctx,m=ensure(state),company=mobilityOwnerCompanyId(state,m.ownerCompanyId,{operational:true}),vehicle=findVehicle(state,vehicleId);if(!vehicle)throw new Error('mobility-vehicle-not-found');if(vehicle.ownerCompanyId!==company)throw new Error('mobility-vehicle-owner-conflict');if(vehicle.status==='moving')throw new Error('mobility-vehicle-moving');if(!globalThis.GH_FINANCE_CORE?.execute)throw new Error('finance-core-missing');const hrApi=globalThis.GH_HR_CORE,hr=hrApi?.ensure?.(state);if(!hr)throw new Error('hr-core-missing');const transaction=globalThis.GH_TRANSACTION_CORE;if(!transaction?.execute)throw new Error('transaction-core-missing');const runner=transaction.isActive()?transaction.join:transaction.execute,out=runner(state,{label:'mobility-vehicle-sale',apply:()=>{const proceeds=Math.round((Number(vehicle.purchasePrice)||0)*.6);globalThis.GH_FINANCE_CORE.execute({state},'credit',{company,amount:proceeds,note:`بيع ${vehicle.name}`,method:'تحويل مشتري',taxable:false,counterparty:'سوق المركبات المعتمدة'});m.vehicles=m.vehicles.filter(row=>row.id!==vehicleId);noteMapStructureChange();const driver=m.drivers.find(row=>row.id===vehicle.driverId||row.assetId===vehicleId);if(driver)m.drivers=m.drivers.filter(row=>row.id!==driver.id);const contracts=hr.employmentContracts;const exact=contracts.find(row=>row.assetId===vehicleId&&row.automaticAssetStaffing&&row.status==='ساري'),legacy=contracts.find(row=>(row.ownerCompanyId||row.company)===company&&row.automaticAssetStaffing&&row.status==='ساري'&&String(row.center||'').includes(vehicle.baseLocation)),contract=exact||legacy;if(contract){contract.count=Math.max(0,(Number(contract.count)||0)-1);contract.salary=Math.max(0,(Number(contract.salary)||0)-6000);if(!contract.count){contract.status='منتهي';contract.endedDay=Math.floor(now(state)/86400);}}const facility=(state.customHubs||[]).find(row=>row?.owned===true&&row.kind==='mobility-center'&&facilityOwnerCompanyId(row)===company&&row.capitalId===vehicle.centerId);if(facility)hrApi.reconcileFacilityStaffing?.(state,{facilityId:facility.id,reason:'مواءمة فريق مركز التنقل بعد تقليص الأسطول'});m.status=m.vehicles.length?'active':'not-launched';m.events.unshift({id:id(m,'MOB-EV'),ownerCompanyId:company,at:now(state),type:'VEHICLE_SOLD',vehicleId,proceeds});return {vehicle,proceeds,ownerCompanyId:company};}});return out.value;}
  function renderFleet(ctx){const m=ensure(ctx.state),s=managementSnapshot(ctx.state),money=ctx.fmtMoney||String,groups=new Map(),byCenter=new Map(),centerNames=new Map(),specById=new Map(CLASSES.map(spec=>[spec.id,spec]));for(const center of m.capitalCenters)if(center?.capitalId)centerNames.set(center.capitalId,center.city||center.capitalId);for(const hub of (ctx.state.customHubs||[]))if(hub?.owned===true&&hub.kind==='mobility-center'&&facilityOwnerCompanyId(hub)===m.ownerCompanyId&&hub.capitalId&&!centerNames.has(hub.capitalId))centerNames.set(hub.capitalId,hub.city||hub.capitalId);for(const vehicle of m.vehicles){const spec=specById.get(vehicle.assetClass);if(!spec)continue;const key=`${spec.id}:${vehicle.model}`,group=groups.get(key)||{spec,model:vehicle.model,count:0,value:0};group.count++;group.value+=Number(vehicle.purchasePrice)||0;groups.set(key,group);const centerId=vehicle.centerId||'RUH',center=byCenter.get(centerId)||{city:centerNames.get(centerId)||vehicle.baseLocation||'—',count:0};center.count++;byCenter.set(centerId,center);}return `<article class="list-item"><div class="list-item-head"><div><h3>ملخص أسطول GH Mobility</h3><p>كل سيارة أصل مملوك مستقل ويمكن فتحه من سجل الأصول الموحد.</p></div><span class="tag positive">${s.vehicles} أصل</span></div>${byCenter.size?`<div class="metric-row">${[...byCenter.values()].map(c=>`<div><span>${ctx.esc?ctx.esc(c.city):c.city}</span><b>${c.count}</b></div>`).join('')}</div>`:''}${[...groups.values()].slice(0,8).map(x=>`<div class="spec-row"><span>${x.spec.icon} ${x.model}</span><b>${x.count} · ${money(x.value)}</b></div>`).join('')||'<div class="empty">لا توجد سيارات مملوكة بعد.</div>'}<div class="action-row"><button class="primary-btn" data-open="assets" data-arg="mobility">فتح الأصول المملوكة</button><button class="secondary-btn" data-open="assetMarket" data-arg="mobility">شراء سيارات</button></div></article>`;}
  function render(ctx){
    const state=ctx.state,s=managementSnapshot(state),money=ctx.fmtMoney||String,number=ctx.fmtNumber||String,perf=ctx.companyPerformance?.('mobility',30)||null;
    const companyFinance=perf?`<article class="list-item"><div class="list-item-head"><div><h3>النتيجة المالية للشركة · آخر 30 يومًا</h3><p>الأرقام من دفتر الشركة والإقفالات المالية. صافي الشركة يشمل المصروفات المسجلة على Mobility.</p></div><span class="tag">${number(perf.reportedDays||0)} يومًا مسجلًا</span></div><div class="metric-row"><div><span>الإيرادات</span><b>${money(perf.grossRevenue||0)}</b></div><div><span>المصروفات</span><b>${money(perf.expenses||0)}</b></div><div><span>الصافي المسجل</span><b class="${Number(perf.net||0)>=0?'positive':'negative'}">${money(perf.net||0)}</b></div></div></article>`:'';
    if(!s.vehicles)return `<article class="list-item"><h3>تشغيل التنقل</h3><p>ابدأ بفتح فرع مدينة من دليل المواقع، ثم اشترِ الأسطول من متجر الأصول. المركبات والرحلات تُدار داخل الشركة، وتبقى الفروع وحدها على الخريطة.</p><div class="metric-row"><div><span>الفروع المفتوحة</span><b>${s.centers}</b></div><div><span>المركبات</span><b>0</b></div><div><span>الرواتب الشهرية</span><b>${money(0)}</b></div></div><div class="action-row"><button class="primary-btn" data-open="companyFacilities" data-arg="mobility">إدارة فروع المدن</button><button class="secondary-btn" data-open="assetMarket" data-arg="mobility">شراء سيارات</button></div></article>${companyFinance}${renderBranchOperations(ctx)}`;
    return `<article class="list-item"><div class="list-item-head"><div><h3>تشغيل خدمات التنقل</h3><p>إدارة الطلبات والأسطول والفروع من هذه اللوحة. تتبع المركبات الحي متاح في تفاصيل الأصول، ولا يرسمها على الخريطة.</p></div><span class="tag positive">${s.centers} فرع · ${s.activeTrips} رحلة نشطة</span></div><div class="metric-row"><div><span>الأسطول المملوك</span><b>${number(s.vehicles)}</b></div><div><span>المتاح للخدمة</span><b>${number(s.available)}</b></div><div><span>السائقون</span><b>${number(s.drivers)}</b></div></div><div class="metric-row"><div><span>طلبات مكتملة</span><b>${number(s.completed)}</b></div><div><span>قيد الإسناد</span><b>${number(s.queued)}</b></div><div><span>رواتب شهرية</span><b>${money(s.monthlyPayroll)}</b></div></div><div class="action-row"><button class="primary-btn" data-open="companyFacilities" data-arg="mobility">إدارة الفروع</button><button class="secondary-btn" data-open="assets" data-arg="mobility">سجل المركبات والسائقين</button><button class="secondary-btn" data-open="assetMarket" data-arg="mobility">شراء مركبات</button></div></article>${companyFinance}${renderBranchOperations(ctx)}`;
  }
  // ربحية كل مدينة على حدة، محسوبة من نفس أرباح الرحلات الفعلية لا الأسطول فقط - حتى يعرف اللاعب أي مركز يستاهل التوسع فيه.
  function renderBranchOperations(ctx){
    const state=ctx.state,m=state.mobility||{},money=ctx.fmtMoney||String,number=ctx.fmtNumber||String,rows=activeCenters(state,m).map(center=>({...center,facilityId:centerMeta(state,center.capitalId)?.facilityId||''})).slice(0,32);
    return `<article class="list-item"><div class="list-item-head"><div><h3>الفروع ومصادر الدخل</h3><p>مؤشرات كل فرع تراكمية منذ افتتاحه. صافي الشركة المالي أعلاه هو المرجع لفترة 30 يومًا.</p></div><span class="tag">${rows.length} فرع</span></div>${rows.length?rows.map(row=>{const fin=m.kpisByCenter?.[row.capitalId]||{},gross=Math.max(0,Number(fin.grossBookings)||0),payout=Math.max(0,Number(fin.driverPayouts)||0),variable=gross*.16,contribution=Number(fin.platformRevenue)||0;return `<article class="list-item mobility-branch-row"><div class="list-item-head"><div><h3>${ctx.esc?ctx.esc(row.city):row.city}</h3><p>طلبات مكتملة منذ بدء التشغيل: ${number(fin.completed||0)}</p></div><span class="tag">فرع خدمة</span></div><div class="metric-row"><div><span>قيمة الحجوزات التراكمية</span><b>${money(gross)}</b></div><div><span>حصة السائقين المتغيرة</span><b>${money(payout)}</b></div><div><span>تكلفة التشغيل التقديرية في نموذج الرحلة (16%)</span><b>${money(variable)}</b></div></div><div class="spec-row"><span>مساهمة الرحلات قبل الرواتب الثابتة وتكاليف الفرع</span><b>${money(contribution)}</b></div><p class="muted">تكلفة 16% تقدير داخل المحاكاة وليست فاتورة دفترية. لا تُعرض ربحية صافية للفرع حتى تُسند إليه تكاليفه الثابتة في الدفتر المالي.</p><div class="action-row">${row.facilityId?`<button class="primary-btn" data-open="facilityManage" data-arg="${ctx.esc?ctx.esc(row.facilityId):row.facilityId}">إدارة الفرع</button>`:''}</div></article>`;}).join(''):'<div class="empty">افتح أول فرع من دليل المدن لبدء التشغيل.</div>'}</article>`;
  }
  function execute(ctx,cmd,p={}){if(cmd==='buy-fleet')return buyFleet(ctx,p);if(cmd==='service-vehicle')return serviceVehicle(ctx,p);if(cmd==='sell-vehicle')return sellVehicle(ctx,p);if(cmd==='cache-street-route')return cacheStreetRoute(ctx,p);if(cmd==='launch')return launch(ctx);throw new Error(`Unknown Mobility command: ${cmd}`);}
  // System commands that only write state.mobility (Domain Command Core snapshots this scope, not the whole game).
  function transactionScope(name){return name==='cache-street-route'?{scope:['mobility'],rowRoots:{mobility:ROLLBACK_POLICY}}:null;}
  const API={VERSION,MAX_FLEET_PURCHASE_QUANTITY,ROLLBACK_POLICY,transactionScope,purchaseCatalogs,ROUTE_WAIT_TIMEOUT_SECONDS,ZONES,CLASSES,CAPITALS,mobilityOwnerCompanyId,mapStructureRevision:()=>mapStructureVersion,ensure,launch,buyFleet,onSimulationTime,advanceThrough,simulationSliceLimit,snapshot,managementSnapshot,centerSnapshot,centerClusters,liveVehicles,vehiclePosition,pendingStreetRoutes,cacheStreetRoute,routePosition,urbanPath,zonesFor,capitalMeta,centerMeta,findVehicle,serviceVehicle,sellVehicle,render,renderFleet,execute};globalThis.GH_MOBILITY_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('mobility',API);if(globalThis.window&&window!==globalThis)window.GH_MOBILITY_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
