'use strict';
const assert=require('assert');
const fs=require('fs');
const {harness,minimal}=require('./helpers/core-harness');

const {s}=harness(['transaction-core','domain-command-core','finance-core','corporate-core','hr-core','fleet-core','mobility-core']);
const state={...minimal(),profile:{name:'Build 302 Group'},groupValue:1000000000,openedCompanies:['air','mobility'],companyRegistry:{air:{legalName:'Build 302 Air'},mobility:{legalName:'Build 302 Mobility'}},advanced:{labor:{employmentContracts:[],hiringLog:[]}},crew:[],assets:[],globalBases:[],customHubs:[]};
s.GH_FINANCE_CORE.ensure(state);s.GH_CORPORATE_CORE.ensure(state);
s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=1000000;
s.GH_FINANCE_CORE.book(state,'mobility').accounts[0].balance=1000000;
s.GH_FINANCE_CORE.reconcile(state);

// Asset staffing and its salary table belong to Fleet Core, not the legacy HR roster.
state.crew=[{id:'pilots',name:'legacy',salaryMin:1,salaryMax:1,morale:1}];const fixedAirStaffing=s.GH_FLEET_CORE.staffingPlan({type:'air'},state);assert.strictEqual(fixedAirStaffing.total,12);assert.strictEqual(fixedAirStaffing.monthlyPayroll,126000);

// Standard maintenance is one domain command: one payment, full service, no partial state.
const serviceAsset={id:'AIR-302-SERVICE',type:'air',name:'Build 302 Aircraft',phase:'idle',condition:61,fuel:19,ownership:'owned',purchasePrice:1000000,staffing:{mode:'automatic-fixed',ready:true,roles:[],total:0,monthlyPayroll:0,contractId:'EMP-302'}};
state.assets.push(serviceAsset);state.advanced.labor.employmentContracts.push({id:'EMP-302',assetId:serviceAsset.id,status:'ساري'});
const beforeService=s.GH_FINANCE_CORE.operating(state,'air');
const serviced=s.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','service',{id:serviceAsset.id,cost:78000,supplier:'Build 302 MRO',note:'Build 302 service'},{actor:'test'}).result;
assert.strictEqual(serviced.condition,100);assert.strictEqual(serviced.fuel,100);
assert.strictEqual(s.GH_FINANCE_CORE.operating(state,'air'),beforeService-78000);
assert.strictEqual(state.finance.invoices.filter(row=>row.note==='Build 302 service').length,1);

// Insufficient maintenance funds roll the whole command back, including condition/fuel.
const unfundedAsset={id:'AIR-302-ROLLBACK',type:'air',name:'Rollback Aircraft',phase:'idle',condition:44,fuel:12,ownership:'owned',purchasePrice:900000,staffing:{mode:'automatic-fixed',ready:true,roles:[],total:0,monthlyPayroll:0}};
state.assets.push(unfundedAsset);s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=0;s.GH_FINANCE_CORE.reconcile(state);
const invoicesBeforeRollback=state.finance.invoices.length;
assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','service',{id:unfundedAsset.id,cost:78000,note:'Must roll back'},{actor:'test'}),/insufficient/);
assert.strictEqual(unfundedAsset.condition,44);assert.strictEqual(unfundedAsset.fuel,12);assert.strictEqual(state.finance.invoices.length,invoicesBeforeRollback);
s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=1000000;s.GH_FINANCE_CORE.reconcile(state);

// Disposal credits the owning company and removes the asset + fixed staffing atomically.
const beforeSale=s.GH_FINANCE_CORE.operating(state,'air'),beforeValue=state.groupValue;
const disposal=s.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','dispose',{id:serviceAsset.id,proceeds:720000,atOwnedCenter:true,buyer:'Build 302 Buyer'},{actor:'test'}).result;
assert.strictEqual(disposal.status,'sold');assert(!state.assets.some(row=>row.id===serviceAsset.id));
assert.strictEqual(s.GH_FINANCE_CORE.operating(state,'air'),beforeSale+720000);
assert.strictEqual(state.groupValue,beforeValue-129600);
assert.strictEqual(state.advanced.labor.employmentContracts[0].status,'منتهي');

// A moving asset is never deleted mid-trip; its sale becomes a safe arrival task.
const movingAsset={id:'AIR-302-MOVING',type:'air',name:'Moving Aircraft',phase:'moving',routeId:'AIR-ROUTE-302',condition:95,fuel:76,ownership:'owned',purchasePrice:2000000,staffing:{mode:'automatic-fixed',ready:true,roles:[],total:0,monthlyPayroll:0}};
state.assets.push(movingAsset);const airBeforeScheduledSale=s.GH_FINANCE_CORE.operating(state,'air');
const scheduled=s.GH_DOMAIN_COMMANDS.dispatch({state},'fleet','dispose',{id:movingAsset.id,proceeds:1400000,atOwnedCenter:false},{actor:'test'}).result;
assert.strictEqual(scheduled.status,'scheduled');assert(state.assets.some(row=>row.id===movingAsset.id));assert.strictEqual(movingAsset.salePending,true);assert.strictEqual(s.GH_FINANCE_CORE.operating(state,'air'),airBeforeScheduledSale);

// Closed company income remains queryable after the midnight KPI reset.
state.simSeconds=5*86400;
s.GH_FINANCE_CORE.execute({state},'record-daily-close',{day:5,sectors:{air:310000},companies:{air:{grossRevenue:500000,expenses:190000,net:310000,tripRevenue:440000,operatingRevenue:60000,tripCount:4}},net:267500});
assert.strictEqual(state.sectorProfitToday.air,0);
const performance=s.GH_FINANCE_CORE.performance(state,'air',30);
assert.strictEqual(performance.lastDayGross,500000);assert.strictEqual(performance.lastDayExpenses,190000);assert.strictEqual(performance.lastDayNet,310000);assert.strictEqual(performance.net,310000);assert.strictEqual(performance.tripCount,4);

// Every legacy Mobility trip is held at pickup until a real street route is cached.
state.customHubs.push({id:'MOB-RUH',kind:'mobility-center',company:'mobility',owned:true,capitalId:'RUH',city:'الرياض',country:'السعودية',coords:[24.7136,46.6753]});
state.mobility={capitalCenters:[{id:'MOB-RUH',facilityId:'MOB-RUH',capitalId:'RUH',city:'الرياض',country:'السعودية',coords:[24.7136,46.6753]}],vehicles:[{id:'MOB-V-302-A',assetClass:'eco-ev',name:'Moving car',status:'moving',centerId:'RUH',zoneId:'KAFD',condition:90,battery:80,purchasePrice:38000,driverId:'DRV-302-A'},{id:'MOB-V-302-B',assetClass:'comfort',name:'Idle car',status:'available',centerId:'RUH',zoneId:'OLAYA',condition:72,battery:31,purchasePrice:56000,driverId:'DRV-302-B'}],drivers:[{id:'DRV-302-A',assetId:'MOB-V-302-A',status:'on-trip',centerId:'RUH',monthlySalary:6000},{id:'DRV-302-B',assetId:'MOB-V-302-B',status:'online',centerId:'RUH',monthlySalary:6000}],rideRequests:[],activeTrips:[{id:'TRIP-302',vehicleId:'MOB-V-302-A',driverId:'DRV-302-A',centerId:'RUH',fromZone:'KAFD',toZone:'AIRPORT',startedAt:0,dueAt:1000,duration:1000,progress:.4,distanceKm:25,fare:100,route:[[90,90],[-90,-90]],routeLocked:false}],tripArchive:[],events:[],sequence:2,kpis:{},lastDemandAtByCenter:{RUH:state.simSeconds}};
state.advanced.labor.employmentContracts.push({id:'EMP-MOB-302-B',assetId:'MOB-V-302-B',company:'mobility',count:1,salary:6000,status:'ساري',automaticAssetStaffing:true});
const mobility=s.GH_MOBILITY_CORE.ensure(state),pickup=s.GH_MOBILITY_CORE.ZONES.find(z=>z.id==='KAFD').coords;
assert.strictEqual(mobility.activeTrips[0].routeLocked,true);assert.strictEqual(mobility.activeTrips[0].routeVersion,3);assert.strictEqual(mobility.activeTrips[0].routeVerified,false);assert.deepStrictEqual(Array.from(mobility.activeTrips[0].route,point=>Array.from(point)),[Array.from(pickup),Array.from(pickup)]);
assert.strictEqual(mobility.activeTrips[0].dueAt,null);assert.strictEqual(mobility.activeTrips[0].progress,0);const blockedTripCash=s.GH_FINANCE_CORE.operating(state,'mobility');s.GH_MOBILITY_CORE.onSimulationTime({state},state.simSeconds);assert.strictEqual(mobility.activeTrips.some(row=>row.id==='TRIP-302'),true,'unverified street trip completed in the background');assert.strictEqual(s.GH_FINANCE_CORE.operating(state,'mobility'),blockedTripCash,'unverified street trip posted income');
const migratedRoute=mobility.activeTrips[0].route;s.GH_MOBILITY_CORE.ensure(state);assert.strictEqual(mobility.activeTrips[0].route,migratedRoute,'locked route migration must not reallocate the whole trip geometry on every render');
const live=s.GH_MOBILITY_CORE.liveVehicles(state,10,{movingOnly:true});assert.strictEqual(live.length,1);assert.strictEqual(live[0].id,'MOB-V-302-A');assert.deepStrictEqual(Array.from(live[0].route,point=>Array.from(point)),[Array.from(pickup),Array.from(pickup)]);
const airport=s.GH_MOBILITY_CORE.ZONES.find(z=>z.id==='AIRPORT').coords,verifiedStreetRoute=[Array.from(pickup),[24.80,46.67],[24.88,46.71],Array.from(airport)];s.GH_MOBILITY_CORE.cacheStreetRoute({state},{centerId:'RUH',fromZone:'KAFD',toZone:'AIRPORT',route:verifiedStreetRoute,distanceKm:28,durationSeconds:2100});assert.strictEqual(mobility.activeTrips[0].routeVerified,true);assert.strictEqual(mobility.activeTrips[0].routeSource,'OSRM · شبكة الشوارع الفعلية');assert.strictEqual(mobility.activeTrips[0].progress,0);assert(mobility.activeTrips[0].dueAt>state.simSeconds);assert.deepStrictEqual(Array.from(mobility.activeTrips[0].route,point=>Array.from(point)),verifiedStreetRoute);
const clusters=s.GH_MOBILITY_CORE.centerClusters(state);assert.strictEqual(clusters.length,1);assert.strictEqual(clusters[0].available,1);
const mobilityCashBeforeService=s.GH_FINANCE_CORE.operating(state,'mobility');const servicedCar=s.GH_DOMAIN_COMMANDS.dispatch({state},'mobility','service-vehicle',{id:'MOB-V-302-B'},{actor:'test'}).result;assert.strictEqual(servicedCar.condition,100);assert.strictEqual(servicedCar.battery,100);assert.strictEqual(s.GH_FINANCE_CORE.operating(state,'mobility'),mobilityCashBeforeService-850);
assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatch({state},'mobility','sell-vehicle',{id:'MOB-V-302-A'},{actor:'test'}),/moving/);
const mobilityCashBeforeTrip=s.GH_FINANCE_CORE.operating(state,'mobility'),verifiedDueAt=mobility.activeTrips.find(row=>row.id==='TRIP-302').dueAt;mobility.lastDemandAtByCenter.RUH=verifiedDueAt+1;s.GH_MOBILITY_CORE.onSimulationTime({state},verifiedDueAt+1);const mobilityTripProfit=100-(100*.10+100*.16);assert(Math.abs(s.GH_FINANCE_CORE.operating(state,'mobility')-(mobilityCashBeforeTrip+mobilityTripProfit))<1e-9);assert(s.GH_FINANCE_CORE.performance(state,'mobility').currentNet>0);assert(state.finance.invoices.some(row=>row.company==='mobility'&&row.simulation===true));
const hrCore=s.GH_HR_CORE;s.GH_HR_CORE=undefined;const mobilityCashBeforeMissingHr=s.GH_FINANCE_CORE.operating(state,'mobility');assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatch({state},'mobility','sell-vehicle',{id:'MOB-V-302-B'},{actor:'test'}),/hr-core-missing/);assert.strictEqual(s.GH_FINANCE_CORE.operating(state,'mobility'),mobilityCashBeforeMissingHr);assert(state.mobility.vehicles.some(row=>row.id==='MOB-V-302-B'));assert(state.mobility.drivers.some(row=>row.id==='DRV-302-B'));s.GH_HR_CORE=hrCore;
const mobilityCashBeforeSale=s.GH_FINANCE_CORE.operating(state,'mobility'),soldCar=s.GH_DOMAIN_COMMANDS.dispatch({state},'mobility','sell-vehicle',{id:'MOB-V-302-B'},{actor:'test'}).result;assert.strictEqual(soldCar.proceeds,33600);assert.strictEqual(s.GH_FINANCE_CORE.operating(state,'mobility'),mobilityCashBeforeSale+33600);assert(!state.mobility.vehicles.some(row=>row.id==='MOB-V-302-B'));assert(!state.mobility.drivers.some(row=>row.id==='DRV-302-B'));assert.strictEqual(state.advanced.labor.employmentContracts.find(row=>row.id==='EMP-MOB-302-B').status,'منتهي');

// Large dispatch batches assign each vehicle/driver once without repeated full-fleet searches.
const scaleState={...minimal(),customHubs:[{id:'MOB-SCALE',kind:'mobility-center',company:'mobility',owned:true,capitalId:'RUH',city:'الرياض',country:'السعودية',coords:[24.7136,46.6753]}]};
scaleState.mobility={routeSchemaVersion:3,capitalCenters:[{id:'MOB-SCALE',facilityId:'MOB-SCALE',capitalId:'RUH',city:'الرياض',country:'السعودية',coords:[24.7136,46.6753]}],vehicles:[],drivers:[],rideRequests:[],activeTrips:[],tripArchive:[],events:[],sequence:0,kpis:{},lastDemandAtByCenter:{RUH:0}};
for(let i=0;i<1200;i++){scaleState.mobility.vehicles.push({id:`SCALE-V-${i}`,assetClass:i%2?'eco-ev':'comfort',name:`Scale ${i}`,status:'available',centerId:'RUH',zoneId:'KAFD',condition:100,battery:100,totalTrips:0,totalKm:0,driverId:`SCALE-D-${i}`});scaleState.mobility.drivers.push({id:`SCALE-D-${i}`,assetId:`SCALE-V-${i}`,status:'online',centerId:'RUH',zoneId:'KAFD',totalTrips:0,earnings:0,monthlySalary:6000});}
for(let i=0;i<500;i++)scaleState.mobility.rideRequests.push({id:`SCALE-R-${i}`,status:'queued',centerId:'RUH',fromZone:'KAFD',toZone:'AIRPORT',distanceKm:30,service:i%2?'eco-ev':'comfort',fare:80});
s.GH_MOBILITY_CORE.onSimulationTime({state:scaleState},0);
assert.strictEqual(scaleState.mobility.activeTrips.length,500);assert.strictEqual(new Set(scaleState.mobility.activeTrips.map(row=>row.vehicleId)).size,500);assert.strictEqual(new Set(scaleState.mobility.activeTrips.map(row=>row.driverId)).size,500);assert(scaleState.mobility.activeTrips.every(row=>scaleState.mobility.vehicles.find(vehicle=>vehicle.id===row.vehicleId)?.driverId===row.driverId),'large dispatch broke the fixed vehicle-driver pairing');

// Source guards for the lightweight map and separated registries.
const app=fs.readFileSync('WebApp/app.js','utf8'),catalog=fs.readFileSync('WebApp/catalog.js','utf8'),css=fs.readFileSync('WebApp/styles.css','utf8'),hrSource=fs.readFileSync('WebApp/hr-core.js','utf8');
assert(app.includes("mapRenderBudget(zoom,'mobility')"));assert(app.includes('centerClusters?.(state)'));assert(app.includes("routeFilterType='all',routeQuery=''"));assert(app.includes('ownedAssetSearch'));assert(app.includes('routeSearch'));
assert(app.includes('stationaryClusterBudget'));assert(app.includes('f.owned===true||assetBaseIds.has(f.id)'));
assert(app.includes("document.querySelectorAll('.service-asset')")&&app.includes("document.querySelectorAll('.sell-asset')")&&app.includes("'fleet','service'")&&app.includes("'fleet','dispose'"));assert(app.includes("document.querySelectorAll('.service-mobility-asset')")&&app.includes("document.querySelectorAll('.sell-mobility-asset')"));
assert(app.includes('const routeAssets=new Map()'));assert(app.includes('matchingRoutes.slice(0,80)'));assert(!app.includes("function renderRouteCenter(arg){\n    if(typeof arg==='string'&&['all','air','sea','road','mobility'].includes(arg))routeFilterType=arg;\n    dedupeCustomRoutes();"));
assert(app.includes('{minRealSliceSeconds:.5}'));assert(app.includes('snapshot:simulationAssetSnapshot(asset)'));assert(!app.includes('profile:state.profile,crew:state.crew,advanced:state.advanced,realism:state.realism'));
assert(app.includes('const validationAssets=new Map')&&app.includes('const commitAssets=new Map'));assert(!app.includes("(state.assets||[]).find(a=>a.id===rec.id)"));
assert(app.includes("if(!openedCompanySet.has(type)){companyDaily[type]={tripRevenue:0,operatingRevenue:0,grossRevenue:0,expenses:0,net:0,tripCount:0}"));
assert(app.includes('YIELD_RATE.roadTonKm * (specs.yieldMultiplier||1)'));assert(catalog.includes("reliability:extra.reliability||97.2,yieldMultiplier:extra.yieldMultiplier||1"));
assert(app.includes('basis=Number(a.purchasePrice)||Number(item?.price)||1000000'));
assert(!hrSource.includes('CREW_STANDARDS')&&!hrSource.includes('requiredCrewForFleet'),'HR retained a second asset-crew demand owner');assert(!app.includes('crewSectorMorale'),'legacy HR morale still reduces fixed-crew trip income');
assert(css.includes('.mobility-dot-marker{display:grid!important;place-items:center!important'));assert(css.includes('.mobility-street-dot{display:block;width:6px;height:6px'));assert(css.includes('width:auto!important;min-width:0!important')&&!css.includes('brand-copy{display:block!important;flex:1 1 auto!important;width:0!important'));assert(app.includes('const assetIndex=new Map((state.assets||[]).map'));assert(!app.includes('function suggestRoutesOnly'));

// App-level batching limits expensive atomic fleet commits to two per real second.
const simulation=require('../WebApp/simulation-core.js');let wall=0,simTime=0,slices=0;
const engine=simulation.create({getSpeed:()=>1,setSpeed:()=>{},getSimTime:()=>simTime,setSimTime:value=>{simTime=value;},createSliceJob:()=>({runChunk:()=>true,finish:()=>{slices++;return {committed:true};},cancel(){}})},{nowMs:()=>wall,frameBudgetMs:1000,minRealSliceSeconds:.5});
for(let frame=1;frame<=60;frame++){wall=frame*(1000/60);engine.frame(wall);}
assert(Math.abs(simTime-1)<1e-6);assert.strictEqual(slices,2);

console.log('BUILD302 fleet/map/assets/income: PASS');
