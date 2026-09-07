(() => {
  'use strict';

  const photo = name => `assets/images/${name}.webp`;
  const air = (id,name,segment,price,image,rangeKm,speedKmh,capacity,fuelBurnKgPerKm,extra={}) => ({
    id,name,segment,icon:'✈️',base:extra.base||'AP-RUH',price,photo:photo(image),
    leaseMonthly:Math.round(price*.0092),downPayment:.20,delivery:extra.delivery||'8–18 شهر',warranty:extra.warranty||'5 سنوات',
    residual5y:extra.residual5y||62,rating:extra.rating||4.4,description:extra.description||'منصة حديثة بهيكل اقتصادي وتشغيل رقمي كامل.',
    specs:{rangeKm,speedKmh,capacity,capacityUnit:extra.cargo?'طن':'راكب',fuelBurnKgPerKm,cargo:!!extra.cargo,
      runwayM:extra.runwayM||2100,crew:extra.crew||2,mtowTon:extra.mtowTon||70,maintenancePerFlightHour:extra.maintenance||980,
      co2Band:extra.co2Band||'B',reliability:extra.reliability||98.4,yieldMultiplier:extra.yieldMultiplier||1}
  });
  const ship = (id,name,segment,price,image,rangeNm,speedKn,capacity,capacityUnit,fuelTonPerDay,draftM,extra={}) => ({
    id,name,segment,icon:'🚢',base:extra.base||'PT-JED',price,photo:photo(image),
    leaseMonthly:Math.round(price*.0084),downPayment:.25,delivery:extra.delivery||'14–30 شهر',warranty:extra.warranty||'3 سنوات',
    residual5y:extra.residual5y||68,rating:extra.rating||4.3,description:extra.description||'تصميم بحري حديث مع إدارة وقود وصيانة تنبؤية.',
    specs:{rangeNm,speedKn,capacity,capacityUnit,fuelTonPerDay,draftM,lengthM:extra.lengthM||210,beamM:extra.beamM||32,
      crew:extra.crew||24,engine:extra.engine||'ثنائي الوقود',maintenancePerDay:extra.maintenance||14500,
      co2Band:extra.co2Band||'B',reliability:extra.reliability||97.8,yieldMultiplier:extra.yieldMultiplier||1}
  });
  const truck = (id,name,segment,price,image,rangeKm,speedKmh,capacity,extra={}) => ({
    id,name,segment,icon:'🚛',base:extra.base||'DP-RUH',price,photo:photo(image),
    leaseMonthly:Math.round(price*.018),downPayment:.15,delivery:extra.delivery||'4–18 أسبوع',warranty:extra.warranty||'4 سنوات / 600 ألف كم',
    residual5y:extra.residual5y||48,rating:extra.rating||4.2,description:extra.description||'مركبة أسطول متصلة بالتليماتكس والصيانة التنبؤية.',
    specs:{rangeKm,speedKmh,capacity,capacityUnit:extra.capacityUnit||'طن',fuelLPer100km:extra.fuelLPer100km||0,
      electric:!!extra.electric,hydrogen:!!extra.hydrogen,energyKWhPer100km:extra.energyKWhPer100km||0,
      refrigerated:!!extra.refrigerated,autonomous:!!extra.autonomous,tanker:!!extra.tanker,container:!!extra.container,
      axles:extra.axles||5,drivetrain:extra.drivetrain||'ديزل Euro VI',maintenancePerKm:extra.maintenancePerKm||.18,
      co2Band:extra.co2Band||'C',safety:extra.safety||92,reliability:extra.reliability||97.2}
  });

  const airNew = [
    air('N-A4','Regional 48 · توربيني إقليمي','إقليمي',23500000,'air-regional',1900,555,48,1.02,{runwayM:1250,mtowTon:23,maintenance:520,delivery:'6–10 أشهر',residual5y:66,co2Band:'A'}),
    air('N-A5','Regional 78 · توربيني عالي الكفاءة','إقليمي',31500000,'air-regional',3300,630,78,1.35,{runwayM:1450,mtowTon:29,maintenance:610,co2Band:'A'}),
    air('N-A6','Regional Jet 100 · نفاث إقليمي','إقليمي',48500000,'air-narrow',4600,830,100,1.72,{runwayM:1750,mtowTon:52,maintenance:780}),
    air('N-A7','Single Aisle 150 · ممر واحد اقتصادي','ممر واحد',54500000,'air-narrow',6100,828,150,2.12,{runwayM:1950,mtowTon:69,maintenance:910}),
    air('N-A1','Single Aisle 180 · ممر واحد حديث','ممر واحد',62000000,'air-narrow',6300,828,180,2.40,{runwayM:2100,mtowTon:79,maintenance:980}),
    air('N-A8','Single Aisle 220 · كثافة عالية','ممر واحد',74500000,'air-narrow',6500,835,220,2.72,{runwayM:2350,mtowTon:92,maintenance:1090}),
    air('N-A9','Mid-Market 260 · مدى متوسط ممتد','ثنائي الممر',128000000,'air-widebody',10500,890,260,4.35,{runwayM:2600,mtowTon:168,maintenance:1960,base:'AP-DXB'}),
    air('N-A10','Widebody 290 · عريضة بعيدة المدى','ثنائي الممر',172000000,'air-widebody',14500,903,290,5.35,{runwayM:2850,mtowTon:242,maintenance:2550,base:'AP-DXB'}),
    air('N-A2','Widebody 325 · عريضة بعيدة المدى','ثنائي الممر',188000000,'air-widebody',15000,903,325,6.10,{runwayM:3000,mtowTon:278,maintenance:2840,base:'AP-DXB'}),
    air('N-A11','Widebody 410 · سعة عالمية','ثنائي الممر',247000000,'air-widebody',14200,905,410,7.45,{runwayM:3200,mtowTon:352,maintenance:3380,base:'AP-DXB'}),
    air('N-A12','Feeder Freighter 27T · شحن إقليمي','شحن',42000000,'air-cargo',3900,650,27,3.10,{cargo:true,runwayM:1750,mtowTon:61,maintenance:920}),
    air('N-A13','Express Freighter 62T · شحن سريع','شحن',128000000,'air-cargo',7300,850,62,6.35,{cargo:true,runwayM:2550,mtowTon:185,maintenance:2350,base:'AP-DXB'}),
    air('N-A3','Global Freighter 112T · شحن بعيد','شحن',210000000,'air-cargo',8200,878,112,9.80,{cargo:true,runwayM:3100,mtowTon:347,maintenance:3880,base:'AP-SIN'}),
    air('N-A14','Executive 12 · رجال أعمال','تنفيذي',41500000,'air-executive',9400,890,12,1.62,{runwayM:1650,mtowTon:42,maintenance:1480,yieldMultiplier:6.2,residual5y:71}),
    air('N-A15','Executive 16 · فائق المدى','تنفيذي',73500000,'air-executive',13800,904,16,2.10,{runwayM:1850,mtowTon:54,maintenance:2010,yieldMultiplier:7.5,residual5y:73,base:'AP-DXB'}),
    air('N-A16','VIP Airliner 44 · نقل تنفيذي','VIP',109000000,'air-executive',12100,890,44,3.28,{runwayM:2300,mtowTon:112,maintenance:2480,yieldMultiplier:4.8,residual5y:69,base:'AP-DXB'}),
    air('N-A17','Ultra Long Range 360 · عريضة اقتصادية','ثنائي الممر',232000000,'air-widebody',16200,905,360,6.65,{runwayM:3100,mtowTon:315,maintenance:3150,base:'AP-SIN',reliability:99.0}),
    air('N-A18','Heavy Freighter 132T · شحن استراتيجي','شحن',246000000,'air-cargo',8700,880,132,10.6,{cargo:true,runwayM:3150,mtowTon:365,maintenance:4140,base:'AP-DXB',yieldMultiplier:1.45}),
    air('N-A19','Commuter 30 · إقليمي خفيف','إقليمي',14800000,'air-regional',1500,515,30,.72,{runwayM:980,mtowTon:14,maintenance:390,co2Band:'A'}),
    air('N-A20','Regional 120 · نفاث مرن','إقليمي',56500000,'air-narrow',5200,835,120,1.88,{runwayM:1800,mtowTon:59,maintenance:840}),
    air('N-A21','Single Aisle LR 190 · مدى ممتد','ممر واحد',81500000,'air-narrow',8700,838,190,2.58,{runwayM:2200,mtowTon:86,maintenance:1160,co2Band:'A'}),
    air('N-A22','Widebody 250 · اقتصاد بعيد','ثنائي الممر',149000000,'air-widebody',13200,900,250,4.72,{runwayM:2700,mtowTon:205,maintenance:2180,co2Band:'A'}),
    air('N-A23','Widebody 375 · شبكة عالمية','ثنائي الممر',259000000,'air-widebody',17100,907,375,6.82,{runwayM:3150,mtowTon:329,maintenance:3260,co2Band:'A',reliability:99.1}),
    air('N-A24','Cargo 45T · شحن متوسط','شحن',76000000,'air-cargo',5600,790,45,4.25,{cargo:true,runwayM:2200,mtowTon:118,maintenance:1620}),
    air('N-A25','Cargo 95T · شحن عابر للقارات','شحن',184000000,'air-cargo',9600,868,95,8.1,{cargo:true,runwayM:2950,mtowTon:292,maintenance:3460,yieldMultiplier:1.25}),
    air('N-A26','Executive 8 · أعمال إقليمي','تنفيذي',23800000,'air-executive',6100,825,8,1.08,{runwayM:1250,mtowTon:23,maintenance:970,yieldMultiplier:5.5}),
    air('N-A27','Executive 19 · Global Elite','تنفيذي',89500000,'air-executive',15100,910,19,2.26,{runwayM:1900,mtowTon:58,maintenance:2180,yieldMultiplier:8.0,co2Band:'A'}),
    air('N-A28','VIP 70 · وفود وحكومات','VIP',154000000,'air-executive',13900,900,70,3.9,{runwayM:2450,mtowTon:137,maintenance:2730,yieldMultiplier:5.1})
  ];

  const seaNew = [
    ship('N-S9','Feeder 1,300 TEU · مغذّية','حاويات',31000000,'ship-container',7600,18.5,1300,'TEU',24,8.9,{lengthM:156,beamM:25,crew:18}),
    ship('N-S1','Feedermax 2,800 TEU · حاويات','حاويات',48000000,'ship-container',9000,19,2800,'TEU',38,11.2,{lengthM:210,beamM:32,crew:21}),
    ship('N-S10','Panamax 5,100 TEU · حاويات','حاويات',79000000,'ship-container',10500,21,5100,'TEU',52,13.2,{lengthM:280,beamM:32.3,crew:23}),
    ship('N-S2','Neo-Panamax 8,500 TEU · حاويات','حاويات',112000000,'ship-container',11000,22,8500,'TEU',68,14.6,{lengthM:335,beamM:48,crew:25,base:'PT-SIN'}),
    ship('N-S11','Ultra 15,000 TEU · حاويات عملاقة','حاويات',168000000,'ship-container',12800,22.5,15000,'TEU',91,15.8,{lengthM:366,beamM:51,crew:26,base:'PT-SIN'}),
    ship('N-S12','Handysize 38,000T · بضائع سائبة','بضائع سائبة',41000000,'ship-bulk',9800,14,38000,'طن',25,10.4,{lengthM:180,beamM:30,crew:21}),
    ship('N-S5','Kamsarmax 82,000T · بضائع سائبة','بضائع سائبة',56000000,'ship-bulk',10500,14.5,82000,'طن',33,14.4,{lengthM:229,beamM:32.3,crew:22}),
    ship('N-S13','Aframax 115,000T · ناقلة نفط','ناقلات',76000000,'ship-tanker',11800,15,115000,'طن',43,15.0,{lengthM:245,beamM:44,crew:25,base:'PT-RTM'}),
    ship('N-S3','Suezmax 160,000T · ناقلة نفط','ناقلات',98000000,'ship-tanker',12500,15.5,160000,'طن',54,17.2,{lengthM:274,beamM:48,crew:27,base:'PT-RTM'}),
    ship('N-S14','VLCC 300,000T · ناقلة نفط عملاقة','ناقلات',142000000,'ship-tanker',13800,15.2,300000,'طن',78,20.5,{lengthM:333,beamM:60,crew:29,base:'PT-RTM'}),
    ship('N-S4','LNG 174,000m³ · ناقلة غاز','غاز',218000000,'ship-lng',11800,19.5,82000,'طن',76,12.1,{lengthM:295,beamM:46,crew:31,base:'PT-SIN',yieldMultiplier:1.4,engine:'LNG ثنائي الوقود'}),
    ship('N-S15','LPG 84,000m³ · ناقلة غاز','غاز',104000000,'ship-lng',11000,17.5,46000,'طن',49,12.0,{lengthM:228,beamM:36,crew:27,base:'PT-SIN',yieldMultiplier:1.25}),
    ship('N-S6','Ro-Ro 6,700LM · سيارات ومقطورات','Ro-Ro',124000000,'ship-roro',8800,21,11200,'طن',61,9.8,{lengthM:238,beamM:34,crew:28,base:'PT-RTM',yieldMultiplier:1.2}),
    ship('N-S16','General Cargo 22,000T · بضائع عامة','بضائع عامة',39000000,'ship-bulk',9200,15,22000,'طن',27,9.6,{lengthM:168,beamM:26,crew:20}),
    ship('N-S7','Cruise 3,850 · سفينة سياحية','سياحي',690000000,'ship-cruise',7200,22,3850,'راكب',145,8.8,{lengthM:316,beamM:39,crew:1280,base:'PT-SIN',yieldMultiplier:1.15,warranty:'4 سنوات'}),
    ship('N-S17','Expedition 720 · سياحة فاخرة','سياحي',248000000,'ship-cruise',9100,18,720,'راكب',54,7.4,{lengthM:183,beamM:28,crew:390,base:'PT-RTM',yieldMultiplier:2.2}),
    ship('N-S8','Harbor Tug 85T · دعم موانئ','دعم موانئ',18500000,'ship-support',2800,13,620,'طن',8,5.4,{lengthM:36,beamM:13,crew:9,yieldMultiplier:4.5}),
    ship('N-S18','Offshore Support 1,200T · إمداد بحري','دعم موانئ',46000000,'ship-support',5200,15,1200,'طن',15,6.2,{lengthM:82,beamM:18,crew:22,yieldMultiplier:2.8}),
    ship('N-S19','PCTC 7,600 · ناقلة سيارات عالمية','Ro-Ro',148000000,'ship-roro',10400,20,13600,'طن',58,10.1,{lengthM:230,beamM:36,crew:29,base:'PT-SIN',yieldMultiplier:1.32}),
    ship('N-S20','ULCV 24,000 TEU · حاويات فائقة','حاويات',236000000,'ship-container',13200,22,24000,'TEU',108,16.0,{lengthM:400,beamM:61,crew:28,base:'PT-SIN',reliability:98.6}),
    ship('N-S21','Micro Feeder 750 TEU · ساحلية','حاويات',22000000,'ship-container',5400,17,750,'TEU',16,7.2,{lengthM:128,beamM:21,crew:15}),
    ship('N-S22','Eco 3,600 TEU · حاويات اقتصادية','حاويات',61000000,'ship-container',9800,20,3600,'TEU',39,11.8,{lengthM:238,beamM:35,crew:21,co2Band:'A'}),
    ship('N-S23','Mega 18,500 TEU · حاويات عالمية','حاويات',194000000,'ship-container',13000,22,18500,'TEU',96,15.9,{lengthM:385,beamM:58,crew:27,base:'PT-SIN'}),
    ship('N-S24','Supramax 58,000T · بضائع سائبة','بضائع سائبة',49000000,'ship-bulk',10300,14.3,58000,'طن',29,12.7,{lengthM:200,beamM:32,crew:21}),
    ship('N-S25','Newcastlemax 210,000T · سائبة ضخمة','بضائع سائبة',91000000,'ship-bulk',12600,14.5,210000,'طن',58,18.4,{lengthM:300,beamM:50,crew:25}),
    ship('N-S26','MR Tanker 50,000T · منتجات نفطية','ناقلات',53000000,'ship-tanker',9800,15.2,50000,'طن',28,11.2,{lengthM:183,beamM:32,crew:22}),
    ship('N-S27','LR2 115,000T · منتجات بعيدة','ناقلات',84000000,'ship-tanker',11600,15.5,115000,'طن',42,15.1,{lengthM:250,beamM:44,crew:25}),
    ship('N-S28','LNG 200K · ناقلة غاز متقدمة','غاز',248000000,'ship-lng',12400,20,94000,'طن',80,12.5,{lengthM:305,beamM:48,crew:31,co2Band:'A',yieldMultiplier:1.48}),
    ship('N-S29','RoPax 2,200 · ركاب ومركبات','Ro-Ro',188000000,'ship-roro',6200,23,2200,'راكب',72,7.9,{lengthM:215,beamM:31,crew:185,yieldMultiplier:1.65}),
    ship('N-S30','Heavy Lift 18,000T · مشاريع','متخصص',88000000,'ship-support',8200,15,18000,'طن',33,9.1,{lengthM:168,beamM:36,crew:32,yieldMultiplier:2.1})
  ];

  const roadNew = [
    truck('N-T8','Urban Van 2T · توصيل سريع','حضري',72000,'truck-urban',330,120,2,{electric:true,energyKWhPer100km:31,drivetrain:'كهربائي 400V',axles:2,co2Band:'A',safety:94}),
    truck('N-T7','Urban Electric 8T · توزيع حضري','حضري',129000,'truck-urban',420,75,8,{electric:true,energyKWhPer100km:72,drivetrain:'كهربائي 600V',axles:2,co2Band:'A',safety:95}),
    truck('N-T9','Rigid 12T · توزيع إقليمي','توزيع',116000,'truck-longhaul-v2',1100,88,12,{fuelLPer100km:22,axles:3,safety:91}),
    truck('N-T1','Long Haul 24T · شاحنة ثقيلة','نقل ثقيل',168000,'truck-longhaul-v2',1800,90,24,{fuelLPer100km:32,axles:5,safety:93}),
    truck('N-T10','Heavy Haul 30T · حمولة ثقيلة','نقل ثقيل',205000,'truck-longhaul-v2',1600,85,30,{fuelLPer100km:38,axles:6,safety:92}),
    truck('N-T2','Cold Chain 20T · شاحنة تبريد','تبريد',214000,'truck-reefer',1600,88,20,{fuelLPer100km:35,refrigerated:true,capacityUnit:'طن مبرد',axles:5,safety:95}),
    truck('N-T3','Electric Long Haul 21T · كهربائية','كهربائي',248000,'truck-electric',800,90,21,{electric:true,energyKWhPer100km:118,drivetrain:'كهربائي 800V',co2Band:'A',safety:96}),
    truck('N-T11','Hydrogen Long Haul 22T · هيدروجين','هيدروجين',312000,'truck-electric',1050,90,22,{hydrogen:true,drivetrain:'خلية وقود 300kW',co2Band:'A',safety:95,delivery:'18–28 أسبوع'}),
    truck('N-T4','Autonomous Ready 24T · ذاتية','ذاتي',286000,'truck-autonomous',1500,86,24,{fuelLPer100km:29,autonomous:true,drivetrain:'ديزل هجين L4-ready',safety:98}),
    truck('N-T5','Fuel Tanker 36,000L · ناقلة وقود','صهريج',198000,'truck-tanker',1300,82,29,{fuelLPer100km:38,tanker:true,axles:6,safety:97}),
    truck('N-T12','Chemical Tanker 30,000L · كيميائيات','صهريج',236000,'truck-tanker',1250,80,27,{fuelLPer100km:39,tanker:true,axles:6,safety:98,warranty:'5 سنوات للخزان'}),
    truck('N-T6','Intermodal 30T · ناقلة حاويات','حاويات',182000,'truck-container',1700,88,30,{fuelLPer100km:34,container:true,axles:5,safety:94}),
    truck('N-T13','Low Loader 45T · معدات ثقيلة','متخصص',264000,'truck-container',1200,75,45,{fuelLPer100km:46,axles:7,safety:96}),
    truck('N-T14','Car Carrier 20T · ناقلة مركبات','متخصص',225000,'truck-container',1450,82,20,{fuelLPer100km:36,axles:5,safety:94}),
    truck('N-T15','Mining Haul 55T · تعدين ومحاجر','طرق وعرة',398000,'truck-longhaul-v2',950,68,55,{fuelLPer100km:64,axles:6,drivetrain:'ديزل دفع ثقيل',safety:95,delivery:'20–34 أسبوع'}),
    truck('N-T16','Executive Support 3T · دعم VIP','تنفيذي',158000,'truck-urban',620,130,3,{electric:true,energyKWhPer100km:44,drivetrain:'كهربائي فاخر',co2Band:'A',safety:98,yieldMultiplier:2.2}),
    truck('N-T17','e-Regional 18T · شاحنة كهربائية إقليمية','كهربائي',274000,'truck-electric',980,88,18,{electric:true,energyKWhPer100km:104,drivetrain:'كهربائي 800V',co2Band:'A',safety:97,reliability:98.1}),
    truck('N-T18','Mega Reefer 26T · تبريد بعيد','تبريد',298000,'truck-reefer',1850,86,26,{fuelLPer100km:37,refrigerated:true,capacityUnit:'طن مبرد',axles:6,safety:97,reliability:98.0}),
    truck('N-T19','City EV 4T · توصيل كهربائي','حضري',94000,'truck-urban',390,105,4,{electric:true,energyKWhPer100km:42,axles:2,co2Band:'A',safety:96}),
    truck('N-T20','Regional 16T · توزيع سريع','توزيع',142000,'truck-longhaul-v2',1350,90,16,{fuelLPer100km:25,axles:3,safety:93}),
    truck('N-T21','Hybrid 22T · نقل هجين','نقل ثقيل',227000,'truck-longhaul-v2',1500,90,22,{fuelLPer100km:24,drivetrain:'هجين ديزل/كهرباء',co2Band:'B',safety:96}),
    truck('N-T22','Battery 27T · كهربائية ثقيلة','كهربائي',348000,'truck-electric',1150,88,27,{electric:true,energyKWhPer100km:126,drivetrain:'كهربائي 900V',co2Band:'A',safety:98}),
    truck('N-T23','Hydrogen 30T · خلية وقود','هيدروجين',385000,'truck-electric',1350,90,30,{hydrogen:true,drivetrain:'خلية وقود 420kW',co2Band:'A',safety:97}),
    truck('N-T24','Pharma Reefer 18T · أدوية','تبريد',262000,'truck-reefer',1400,88,18,{fuelLPer100km:31,refrigerated:true,capacityUnit:'طن دوائي',axles:4,safety:99}),
    truck('N-T25','Food Reefer 28T · أغذية','تبريد',318000,'truck-reefer',1900,86,28,{fuelLPer100km:38,refrigerated:true,capacityUnit:'طن مبرد',axles:6,safety:97}),
    truck('N-T26','Fuel Tanker 45KL · صهريج كبير','صهريج',248000,'truck-tanker',1450,80,34,{fuelLPer100km:42,tanker:true,axles:7,safety:99}),
    truck('N-T27','Intermodal 34T · حاويات مزدوجة','حاويات',214000,'truck-container',1800,86,34,{fuelLPer100km:36,container:true,axles:6,safety:96}),
    truck('N-T28','Autonomous EV 20T · ذاتية كهربائية','ذاتي',412000,'truck-autonomous',1050,85,20,{electric:true,autonomous:true,energyKWhPer100km:110,drivetrain:'كهربائي L4-ready',co2Band:'A',safety:99}),
    truck('N-T29','Construction Mixer 26T · خرسانة','إنشاءات',238000,'truck-longhaul-v2',750,72,26,{fuelLPer100km:44,axles:6,safety:95}),
    truck('N-T30','Recovery 18T · إنقاذ أساطيل','دعم',198000,'truck-longhaul-v2',900,78,18,{fuelLPer100km:29,axles:4,safety:98,yieldMultiplier:2.4})
  ];

  const used = (item,id,condition,discount,year,image=item.photo) => ({...item,id,condition,priceOriginal:item.price,price:Math.round(item.price*discount),photo:image,
    leaseMonthly:Math.round(item.leaseMonthly*.72),delivery:'جاهز خلال 2–6 أسابيع',warranty:'فحص معتمد 12 شهر',
    residual5y:Math.max(24,item.residual5y-22),rating:Math.max(3.4,item.rating-.5),description:`مستعمل موديل ${year} مع سجل صيانة وفحص هيكلي موثق.`});

  window.GH_ASSET_CATALOG = {
    air:{new:airNew,used:[
      used(airNew.find(x=>x.id==='N-A1'),'U-A1',82,.55,2021,photo('air-narrow')),
      used(airNew.find(x=>x.id==='N-A3'),'U-A2',76,.56,2020,photo('air-cargo')),
      used(airNew.find(x=>x.id==='N-A5'),'U-A3',88,.68,2023,photo('air-regional')),
      used(airNew.find(x=>x.id==='N-A10'),'U-A4',79,.58,2019,photo('air-widebody')),
      used(airNew.find(x=>x.id==='N-A21'),'U-A5',91,.76,2024,photo('air-narrow')),
      used(airNew.find(x=>x.id==='N-A24'),'U-A6',84,.67,2022,photo('air-cargo'))
    ]},
    sea:{new:seaNew,used:[
      used(seaNew.find(x=>x.id==='N-S1'),'U-S1',74,.44,2014,photo('ship-container')),
      used(seaNew.find(x=>x.id==='N-S3'),'U-S2',81,.59,2018,photo('ship-tanker')),
      used(seaNew.find(x=>x.id==='N-S5'),'U-S3',77,.52,2016,photo('ship-bulk')),
      used(seaNew.find(x=>x.id==='N-S6'),'U-S4',86,.66,2021,photo('ship-roro')),
      used(seaNew.find(x=>x.id==='N-S22'),'U-S5',90,.74,2023,photo('ship-container')),
      used(seaNew.find(x=>x.id==='N-S26'),'U-S6',83,.64,2020,photo('ship-tanker'))
    ]},
    road:{new:roadNew,used:[
      used(roadNew.find(x=>x.id==='N-T1'),'U-T1',68,.55,2020,photo('truck-longhaul-v2')),
      used(roadNew.find(x=>x.id==='N-T2'),'U-T2',79,.63,2022,photo('truck-reefer')),
      used(roadNew.find(x=>x.id==='N-T6'),'U-T3',84,.69,2023,photo('truck-container')),
      used(roadNew.find(x=>x.id==='N-T5'),'U-T4',73,.58,2019,photo('truck-tanker')),
      used(roadNew.find(x=>x.id==='N-T22'),'U-T5',92,.78,2024,photo('truck-electric')),
      used(roadNew.find(x=>x.id==='N-T24'),'U-T6',87,.71,2023,photo('truck-reefer'))
    ]}
  };
})();
