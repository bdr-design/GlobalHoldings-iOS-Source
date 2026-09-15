(()=>{
  'use strict';
  const VERSION='3.0.0',FLEET_BASELINE=480;
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
  const hash=text=>{let h=2166136261>>>0;for(const c of String(text)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;};
  const random=(seed,min=0,max=1)=>min+(hash(seed)/4294967295)*(max-min);
  const distance=(a,b)=>{const r=Math.PI/180,dLat=(b[0]-a[0])*r,dLon=(b[1]-a[1])*r,x=Math.sin(dLat/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));};

  function ensure(state){
    const m=state.mobility=state.mobility&&typeof state.mobility==='object'?state.mobility:{};
    m.schema='gh-mobility-v3';m.version=VERSION;m.status=m.status||'not-launched';
    for(const key of ['vehicles','drivers','rideRequests','activeTrips','tripArchive','events','capitalCenters'])m[key]=Array.isArray(m[key])?m[key].filter(Boolean):[];
    m.zones=clone(ZONES);m.sequence=Math.max(0,Number(m.sequence)||0);
    m.lastDemandAtByCenter=m.lastDemandAtByCenter&&typeof m.lastDemandAtByCenter==='object'?m.lastDemandAtByCenter:{};
    if(!('RUH' in m.lastDemandAtByCenter))m.lastDemandAtByCenter.RUH=Math.max(0,Number(m.lastDemandAt)||0);
    for(const center of m.capitalCenters)if(center?.capitalId&&!(center.capitalId in m.lastDemandAtByCenter))m.lastDemandAtByCenter[center.capitalId]=now(state);
    for(const vehicle of m.vehicles){const spec=CLASSES.find(x=>x.id===vehicle.assetClass);if(!spec)continue;const serial=Math.max(1,Number(String(vehicle.id||'').split('-').pop())||m.vehicles.indexOf(vehicle)+1);vehicle.manufacturer=vehicle.manufacturer||spec.manufacturer;vehicle.model=vehicle.model||spec.models[(serial-1)%spec.models.length];vehicle.realModel=vehicle.realModel||vehicle.model;vehicle.routeLocked=vehicle.routeLocked!==false;vehicle.centerId=vehicle.centerId||'RUH';vehicle.baseLocation=vehicle.baseLocation||(vehicle.centerId==='RUH'?'الرياض':centerMeta(state,vehicle.centerId)?.city)||'الرياض';}
    for(const driver of m.drivers)driver.centerId=driver.centerId||'RUH';
    for(const request of m.rideRequests)request.centerId=request.centerId||'RUH';
    for(const trip of m.activeTrips)trip.centerId=trip.centerId||'RUH';
    m.kpis={requests:0,completed:0,cancelled:0,grossBookings:0,driverPayouts:0,platformRevenue:0,avgRating:4.91,acceptanceRate:100,completionRate:100,...(m.kpis||{})};
    m.kpisByCenter=m.kpisByCenter&&typeof m.kpisByCenter==='object'?m.kpisByCenter:{};
    return m;
  }
  function centerKpis(m,capitalId){return m.kpisByCenter[capitalId]||(m.kpisByCenter[capitalId]={completed:0,grossBookings:0,driverPayouts:0,platformRevenue:0});}
  function centerMeta(state,capitalId){
    if(capitalId==='RUH'){const cap=CAPITALS.find(c=>c.id==='RUH');return {capitalId:'RUH',city:cap?.city||'الرياض',country:cap?.country||'السعودية',coords:cap?.coords||[24.7136,46.6753]};}
    return (state.mobility?.capitalCenters||[]).find(c=>c.capitalId===capitalId)||null;
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
    if(capitalId==='RUH')return ZONES;
    const meta=centerMeta(state,capitalId);if(!meta)return ZONES;
    return capitalZones({id:capitalId,city:meta.city,coords:meta.coords});
  }
  function activeCenters(state,m){
    const list=[{capitalId:'RUH',city:'الرياض',zones:ZONES}];
    for(const c of m.capitalCenters||[])if(c?.capitalId)list.push({capitalId:c.capitalId,city:c.city,zones:zonesFor(state,c.capitalId)});
    return list;
  }
  function id(m,prefix){m.sequence++;return `${prefix}-${String(m.sequence).padStart(7,'0')}`;}
  function classCounts(total){const rows=CLASSES.map(spec=>({spec,count:Math.floor(total*spec.count/FLEET_BASELINE)}));let left=total-rows.reduce((n,x)=>n+x.count,0);for(let i=0;left>0;i++,left--)rows[i%rows.length].count++;return rows;}
  function vehicleBatch(m,total,centerId,cityLabel,zones){let serial=m.vehicles.length;for(const {spec,count} of classCounts(total))for(let i=0;i<count;i++){const model=spec.models[serial%spec.models.length];serial++;m.vehicles.push({id:id(m,'MOB-V'),assetClass:spec.id,name:`${spec.name} · ${model} ${String(serial).padStart(4,'0')}`,manufacturer:spec.manufacturer,model,realModel:model,icon:spec.icon,capacity:spec.capacity,purchasePrice:spec.cost,ownership:'owned',condition:100,battery:100,status:'available',centerId,zoneId:zones[(serial-1)%zones.length].id,baseLocation:cityLabel,tripId:null,totalTrips:0,totalKm:0,routeLocked:true,routeSource:'GH Mobility · مسار حضري ثابت',commissionedAt:0});}}
  function driverBatch(state,m,count,source='شراء يدوي',centerId,cityLabel,zones){const first=m.drivers.length;for(let i=0;i<count;i++)m.drivers.push({id:id(m,'DRV'),name:`شريك قيادة ${String(first+i+1).padStart(4,'0')}`,status:'online',rating:Number(random(`driver:${first+i}`,4.72,4.99).toFixed(2)),centerId,zoneId:zones[(first+i)%zones.length].id,tripId:null,totalTrips:0,earnings:0});const hr=globalThis.GH_HR_CORE?.ensure?.(state);if(hr&&count)hr.employmentContracts.unshift({id:id(m,'EMP-MOB'),company:'mobility',name:`${count} × شريك قيادة وتشغيل`,role:'شريك قيادة',count,center:`شبكة ${cityLabel} الحضرية`,salary:0,startDay:Math.floor(now(state)/86400),termMonths:24,status:'ساري',source});}
  const acquisitionCost=total=>classCounts(total).reduce((n,x)=>n+x.spec.cost*x.count,0);
  function recordFleetPurchase(state,m,total,note,centerId,cityLabel,zones){const capex=acquisitionCost(total);globalThis.GH_FINANCE_CORE?.execute?.({state},'spend',{company:'mobility',amount:capex,note,method:'تحويل شراء أصول يدوي',taxable:false,line:'capex',counterparty:'مورّدو أسطول GH Mobility'});vehicleBatch(m,total,centerId,cityLabel,zones);driverBatch(state,m,Math.ceil(total*1.35),'تجهيز تشغيلي مرتبط بشراء يدوي',centerId,cityLabel,zones);m.events.unshift({id:id(m,'MOB-EV'),at:now(state),type:'MANUAL_FLEET_PURCHASE',centerId,vehiclesAdded:total,driversAdded:Math.ceil(total*1.35),capex});return capex;}
  // A fixed corridor is used for every pair of city zones. There is no
  // per-frame or per-trip random offset, so vehicles cannot drift away from
  // their registered path and repeat runs produce the same geometry.
  function urbanPath(from,to){const a=from.coords,b=to.coords,latDelta=b[0]-a[0],lonDelta=b[1]-a[1];return [[...a],[a[0],a[1]+lonDelta*.22],[a[0]+latDelta*.42,a[1]+lonDelta*.22],[a[0]+latDelta*.68,b[1]-lonDelta*.22],[b[0],b[1]-lonDelta*.08],[...b]];}
  function routePosition(route,progress){if(!Array.isArray(route)||route.length<2)return route?.[0]||[0,0];let total=0;const lengths=route.slice(0,-1).map((point,i)=>{const d=distance(point,route[i+1]);total+=d;return d;});let target=Math.max(0,Math.min(1,Number(progress)||0))*total;for(let i=0;i<lengths.length;i++){const d=lengths[i];if(target<=d){const t=d?target/d:0;return [route[i][0]+(route[i+1][0]-route[i][0])*t,route[i][1]+(route[i+1][1]-route[i][1])*t];}target-=d;}return [...route[route.length-1]];}
  function zone(zones,index){return zones[((index%zones.length)+zones.length)%zones.length];}
  function generate(m,zones,at,centerId){const seq=m.sequence+1,from=zone(zones,hash(`from:${centerId}:${seq}:${Math.floor(at/45)}`)),to=zone(zones,zones.indexOf(from)+1+Math.floor(random(`to:${centerId}:${seq}`,0,zones.length-1))),km=Math.max(2.2,distance(from.coords,to.coords)*1.22),pick=random(`class:${centerId}:${seq}`),service=pick>.94?CLASSES[2]:pick>.82?CLASSES[3]:pick>.56?CLASSES[1]:CLASSES[0],surge=Number((1+Math.max(0,random(`surge:${centerId}:${Math.floor(at/900)}`,-.08,.55))).toFixed(2)),fare=Number((service.base+km*service.rate*surge).toFixed(2));m.rideRequests.push({id:id(m,'RIDE'),requestedAt:at,status:'queued',centerId,fromZone:from.id,toZone:to.id,distanceKm:Number(km.toFixed(2)),service:service.id,surge,fare});m.kpis.requests++;}
  function dispatch(m,at,centerId,zones){let assigned=0;for(const request of m.rideRequests){if(request.status!=='queued'||request.centerId!==centerId)continue;const vehicle=m.vehicles.find(v=>v.centerId===centerId&&v.status==='available'&&v.assetClass===request.service)||m.vehicles.find(v=>v.centerId===centerId&&v.status==='available'),driver=m.drivers.find(d=>d.centerId===centerId&&d.status==='online');if(!vehicle||!driver)break;const from=zones.find(z=>z.id===request.fromZone)||zones[0],to=zones.find(z=>z.id===request.toZone)||from,pickup=45+Math.round(random(`pickup:${request.id}`,25,150)),duration=pickup+Math.max(180,Math.round(request.distanceKm/30*3600));request.status='active';request.acceptedAt=at;request.vehicleId=vehicle.id;request.driverId=driver.id;request.tripId=id(m,'TRIP');vehicle.status='moving';vehicle.tripId=request.tripId;driver.status='on-trip';driver.tripId=request.tripId;m.activeTrips.push({id:request.tripId,requestId:request.id,vehicleId:vehicle.id,driverId:driver.id,centerId,fromZone:request.fromZone,toZone:request.toZone,startedAt:at,dueAt:at+duration,duration,distanceKm:request.distanceKm,fare:request.fare,progress:0,route:urbanPath(from,to),routeLocked:true,routeSource:'GH Mobility · مسار حضري ثابت'});assigned++;}return assigned;}
  function seedDemand(m,zones,at,count,centerId){for(let i=0;i<count;i++)generate(m,zones,at+i,centerId);dispatch(m,at,centerId,zones);}
  function launch(ctx){const state=ctx.state||ctx,m=ensure(state);if(!(state.openedCompanies||[]).includes('mobility'))throw new Error('mobility-company-not-open');if(m.status==='active')return snapshot(state);const capex=recordFleetPurchase(state,m,FLEET_BASELINE,'شراء يدوي لأسطول GH Mobility الأساسي · الرياض','RUH','الرياض',ZONES);m.status='active';m.launchedAt=now(state);m.lastDemandAtByCenter.RUH=now(state);seedDemand(m,ZONES,now(state),72,'RUH');m.events.unshift({id:id(m,'MOB-EV'),at:now(state),type:'NETWORK_LAUNCHED',centerId:'RUH',vehicles:m.vehicles.length,drivers:m.drivers.length,capex});return snapshot(state);}
  function buyFleet(ctx,{quantity=48,centerId='RUH'}={}){const state=ctx.state||ctx,m=ensure(state),qty=Math.max(4,Math.min(240,Math.round(Number(quantity)||48)));if(m.status!=='active')return launch(ctx);const meta=centerMeta(state,centerId);if(!meta)throw new Error('mobility-center-not-open');const zones=zonesFor(state,centerId);if(!(centerId in m.lastDemandAtByCenter))m.lastDemandAtByCenter[centerId]=now(state);recordFleetPurchase(state,m,qty,`شراء يدوي لدفعة GH Mobility · ${meta.city} · ${qty} مركبة`,centerId,meta.city,zones);seedDemand(m,zones,now(state),Math.min(36,Math.ceil(qty*.15)),centerId);return snapshot(state);}
  function ensureBaseline(ctx){const state=ctx.state||ctx,m=ensure(state);if(m.status!=='active')return 0;const ruhCount=m.vehicles.filter(v=>v.centerId==='RUH').length;if(ruhCount>=FLEET_BASELINE)return 0;const missing=FLEET_BASELINE-ruhCount;recordFleetPurchase(state,m,missing,`ترقية مسجلة لخط الأساس التأسيسي · الرياض · ${missing} مركبة`,'RUH','الرياض',ZONES);seedDemand(m,ZONES,now(state),72,'RUH');return missing;}
  function complete(state,m,at){const done=m.activeTrips.filter(t=>t.dueAt<=at),open=m.activeTrips.filter(t=>t.dueAt>at);let gross=0,payout=0;const perCenter={};for(const trip of done){const request=m.rideRequests.find(r=>r.id===trip.requestId),vehicle=m.vehicles.find(v=>v.id===trip.vehicleId),driver=m.drivers.find(d=>d.id===trip.driverId),driverPay=trip.fare*.73,platform=trip.fare-driverPay,cid=trip.centerId||'RUH';if(request){request.status='completed';request.completedAt=trip.dueAt;}if(vehicle){vehicle.status='available';vehicle.zoneId=trip.toZone;vehicle.tripId=null;vehicle.totalTrips++;vehicle.totalKm+=trip.distanceKm;vehicle.battery=Math.max(18,vehicle.battery-trip.distanceKm*.42);if(vehicle.battery<30)vehicle.battery=100;}if(driver){driver.status='online';driver.zoneId=trip.toZone;driver.tripId=null;driver.totalTrips++;driver.earnings+=driverPay;}gross+=trip.fare;payout+=driverPay;const pc=perCenter[cid]||(perCenter[cid]={completed:0,gross:0,payout:0});pc.completed++;pc.gross+=trip.fare;pc.payout+=driverPay;m.tripArchive.unshift({...trip,status:'completed',completedAt:trip.dueAt,driverPayout:driverPay,platformRevenue:platform});}m.activeTrips=open;m.tripArchive=m.tripArchive.slice(0,1200);m.rideRequests=m.rideRequests.filter(r=>r.status!=='completed'||at-r.completedAt<86400).slice(-1600);if(done.length){const operatingCost=payout+gross*.055,profit=gross-operatingCost;m.kpis.completed+=done.length;m.kpis.grossBookings+=gross;m.kpis.driverPayouts+=payout;m.kpis.platformRevenue+=profit;for(const cid of Object.keys(perCenter)){const pc=perCenter[cid],centerOpCost=pc.payout+pc.gross*.055,centerProfit=pc.gross-centerOpCost,ck=centerKpis(m,cid);ck.completed+=pc.completed;ck.grossBookings+=pc.gross;ck.driverPayouts+=pc.payout;ck.platformRevenue+=centerProfit;}globalThis.GH_FINANCE_CORE?.execute?.({state},'apply-simulation-journal',{journal:{todayProfit:profit,sectorProfit:{mobility:profit},tripProfit:{mobility:profit},tripRevenue:{mobility:gross},tripFuel:{mobility:operatingCost},tripMaintenance:{mobility:0},tripCount:{mobility:done.length}}});globalThis.GH_FINANCE_CORE?.execute?.({state},'record-simulation-revenue',{company:'mobility',gross,expenses:operatingCost,net:profit,note:`إيراد رحلات GH Mobility · ${done.length} رحلة`,counterparty:'عملاء GH Mobility'});globalThis.GH_CORPORATE_CORE?.execute?.({state},'adjust-group-value',{delta:Math.max(0,profit)*.08});}return done.length;}
  function onSimulationTime(ctx,target){
    const state=ctx.state||ctx,m=ensure(state),at=Math.max(now(state),Number(target)||0);
    if(m.status!=='active'){m.lastDemandAtByCenter.RUH=at;return snapshot(state);}
    ensureBaseline(ctx);
    complete(state,m,at);
    for(const center of activeCenters(state,m)){
      const cid=center.capitalId,zones=center.zones;
      if(!(cid in m.lastDemandAtByCenter))m.lastDemandAtByCenter[cid]=at;
      let generated=0,next=m.lastDemandAtByCenter[cid]+45;
      while(next<=at&&generated<480){generate(m,zones,next,cid);generated++;next+=45;}
      m.lastDemandAtByCenter[cid]=next<=at?at:Math.max(m.lastDemandAtByCenter[cid],next-45);
      dispatch(m,at,cid,zones);
    }
    for(const t of m.activeTrips)t.progress=Math.max(0,Math.min(1,(at-t.startedAt)/Math.max(1,t.duration)));
    m.kpis.acceptanceRate=m.kpis.requests?Math.round((m.kpis.requests-m.rideRequests.filter(r=>r.status==='queued').length)/m.kpis.requests*1000)/10:100;
    m.kpis.completionRate=m.kpis.requests?Math.round(m.kpis.completed/m.kpis.requests*1000)/10:100;
    return snapshot(state);
  }
  function snapshot(state){const m=ensure(state),moving=m.vehicles.filter(v=>v.status==='moving').length,queued=m.rideRequests.filter(r=>r.status==='queued').length;return {status:m.status,vehicles:m.vehicles.length,available:m.vehicles.length-moving,moving,drivers:m.drivers.length,online:m.drivers.filter(d=>d.status==='online').length,queued,activeTrips:m.activeTrips.length,completed:m.kpis.completed,grossBookings:m.kpis.grossBookings,driverPayouts:m.kpis.driverPayouts,platformRevenue:m.kpis.platformRevenue,acceptanceRate:m.kpis.acceptanceRate,completionRate:m.kpis.completionRate,avgRating:m.kpis.avgRating,zones:m.zones.length,centers:1+(m.capitalCenters||[]).length};}
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
  function liveVehicles(state,limit=120){const m=ensure(state),zonesCache=new Map(),zoneFor=(centerId,zid)=>{if(!zonesCache.has(centerId))zonesCache.set(centerId,new Map(zonesFor(state,centerId).map(z=>[z.id,z])));return zonesCache.get(centerId).get(zid);},tripByVehicle=new Map(m.activeTrips.map(t=>[t.vehicleId,t])),ordered=selectForDisplay(m.vehicles,Math.max(0,Number(limit)||120));return ordered.map(vehicle=>{const centerId=vehicle.centerId||'RUH',trip=tripByVehicle.get(vehicle.id),from=zoneFor(centerId,trip?.fromZone||vehicle.zoneId)||zonesFor(state,centerId)[0],to=zoneFor(centerId,trip?.toZone||vehicle.zoneId)||from,progress=trip?Math.max(0,Math.min(1,Number(trip.progress)||0)):0,route=trip?.route?.length?clone(trip.route):[[...from.coords],[...to.coords]];return {id:vehicle.id,name:vehicle.name,manufacturer:vehicle.manufacturer,model:vehicle.model,icon:vehicle.icon,type:'mobility',centerId,phase:trip?'moving':'idle',status:vehicle.status,coords:routePosition(route,progress),route,progress,routeLocked:vehicle.routeLocked!==false,tripId:trip?.id||null,driverId:trip?.driverId||null,from:from.name,to:to.name,battery:vehicle.battery,totalTrips:vehicle.totalTrips};});}
  function renderFleet(ctx){const m=ensure(ctx.state),s=snapshot(ctx.state),money=ctx.fmtMoney||String,groups=[];for(const spec of CLASSES)for(const model of spec.models){const vehicles=m.vehicles.filter(v=>v.assetClass===spec.id&&v.model===model);if(vehicles.length)groups.push({spec,model,vehicles});}const byCenter=activeCenters(ctx.state,m).map(c=>({...c,count:m.vehicles.filter(v=>(v.centerId||'RUH')===c.capitalId).length})).filter(c=>c.count>0);return `<article class="list-item"><div class="list-item-head"><div><h3>سجل أسطول GH Mobility الحقيقي</h3><p>طرازات سيارات فعلية مسجلة كأصول مملوكة؛ المسارات والشراء منفصلان، وكل نقطة على الخريطة خفيفة.</p></div><span class="tag positive">${s.vehicles} أصل</span></div>${byCenter.length>1?`<div class="metric-row">${byCenter.map(c=>`<div><span>${ctx.esc?ctx.esc(c.city):c.city}</span><b>${c.count}</b></div>`).join('')}</div>`:''}${groups.map(x=>`<div class="spec-row"><span>${x.spec.icon} ${x.model} · ${x.spec.name} · ${x.vehicles.filter(v=>v.status==='moving').length} متحركة</span><b>${x.vehicles.length} · ${money(x.vehicles.reduce((n,v)=>n+(Number(v.purchasePrice)||0),0))}</b></div>`).join('')||'<div class="empty">لا توجد سيارات مملوكة بعد. استخدم الشراء اليدوي.</div>'}<div class="action-row"><button class="primary-btn" data-gh-action="mobility-buy-fleet">شراء دفعة سيارات يدوية للرياض · 48 مركبة</button></div></article>`;}
  function render(ctx){const s=snapshot(ctx.state),money=ctx.fmtMoney||String;if(s.status!=='active')return `<article class="list-item"><h3>إطلاق GH Mobility يدويًا</h3><p>الزر يشتري ويسجل أسطولًا كبيرًا من سيارات حقيقية (Tesla، BYD، Toyota، Mercedes-Benz وغيرها) ويجهز شركاء القيادة في الرياض. لا يتخذ AI قرار شراء. مراكز العواصم الأخرى تُفتح وتُموّل بأسطولها الخاص من سجل قواعد ومراكز الشركة.</p><div class="metric-row"><div><span>الأسطول الأساسي</span><b>${FLEET_BASELINE} مركبة</b></div><div><span>الطرازات الواقعية</span><b>12 طرازًا</b></div><div><span>مناطق الرياض</span><b>${ZONES.length}</b></div></div><div class="action-row"><button class="primary-btn" data-gh-action="mobility-launch">شراء وإطلاق الأسطول يدويًا</button></div></article>`;return `<article class="list-item"><div class="list-item-head"><div><h3>مركز GH Mobility اللحظي</h3><p>سيارات فعلية، مسار حضري ثابت لكل مدينة على حدة، ونقطة سوداء واحدة لكل مركبة متحركة. التحصيل يسجل مباشرة في دفتر الشركة.</p></div><span class="tag positive">LIVE · ${s.centers} مدينة</span></div><div class="metric-row"><div><span>المركبات</span><b>${s.vehicles}</b></div><div><span>في رحلات</span><b>${s.moving}</b></div><div><span>السائقون المتاحون</span><b>${s.online}</b></div></div><div class="metric-row"><div><span>رحلات مكتملة</span><b>${s.completed}</b></div><div><span>إجمالي الحجوزات</span><b>${money(s.grossBookings)}</b></div><div><span>إيراد المنصة</span><b>${money(s.platformRevenue)}</b></div></div></article>${renderCityProfitability(ctx)}${renderFleet(ctx)}`;}
  // ربحية كل مدينة على حدة، محسوبة من نفس أرباح الرحلات الفعلية لا الأسطول فقط - حتى يعرف اللاعب أي مركز يستاهل التوسع فيه.
  function renderCityProfitability(ctx){
    const m=ensure(ctx.state),money=ctx.fmtMoney||String,rows=activeCenters(ctx.state,m).map(c=>({...c,fin:centerSnapshot(ctx.state,c.capitalId)})).filter(c=>c.fin.vehicles>0);
    if(rows.length<2)return '';
    rows.sort((a,b)=>b.fin.platformRevenue-a.fin.platformRevenue);
    return `<article class="list-item"><div class="list-item-head"><div><h3>ربحية المدن</h3><p>كل مدينة مركز مستقل ماليًا وتشغيليًا؛ هذا ما جنته فعليًا حتى الآن، وليس تقديرًا.</p></div><span class="tag">${rows.length} مدينة نشطة</span></div>${rows.map(c=>`<div class="spec-row"><span>${ctx.esc?ctx.esc(c.city):c.city} · ${c.fin.vehicles} مركبة · ${c.fin.completed} رحلة</span><b class="${c.fin.platformRevenue>=0?'positive':'negative'}">${money(c.fin.platformRevenue)}</b></div>`).join('')}</article>`;
  }
  const API={VERSION,FLEET_BASELINE,ZONES,CLASSES,CAPITALS,ensure,launch,buyFleet,ensureBaseline,onSimulationTime,snapshot,centerSnapshot,liveVehicles,routePosition,urbanPath,zonesFor,centerMeta,render,renderFleet};globalThis.GH_MOBILITY_CORE=API;if(globalThis.window&&window!==globalThis)window.GH_MOBILITY_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
