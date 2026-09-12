'use strict';
const assert = require('assert');
const {scenario} = require('./helpers/business-scenario.js');

// 1) مركز عاصمة مفتوح يجب أن يحصل على أسطول وسائقين ومناطق وطلبات مستقلة فعليًا عن الرياض،
// وليس مجرد اسم عاصمة مضاف إلى سجل بلا أثر تشغيلي (هذا كان الخلل الموصوف قبل هذا الإصلاح).
(function multiCenterIndependence(){
  const s = scenario();
  s.load('mobility-core');
  const {state, ctx, s: sandbox} = s;
  s.command('corporate','open-company',{type:'mobility',capital:500000000,legalName:'Test Mobility'});
  sandbox.GH_MOBILITY_CORE.launch(ctx);

  state.mobility.capitalCenters.unshift({id:'MOB-CENTER-LON',capitalId:'LON',city:'لندن',country:'المملكة المتحدة',coords:[51.5074,-0.1278],facilityId:'MOB-CENTER-LON',openedAt:state.simSeconds});
  sandbox.GH_MOBILITY_CORE.buyFleet(ctx,{quantity:60,centerId:'LON'});

  const ruhVehicles = state.mobility.vehicles.filter(v=>v.centerId==='RUH');
  const lonVehicles = state.mobility.vehicles.filter(v=>v.centerId==='LON');
  assert(ruhVehicles.length>=480,'founding RUH fleet must remain intact');
  assert.strictEqual(lonVehicles.length,60,'a center-scoped purchase must add vehicles to that center only');
  assert(lonVehicles.every(v=>v.baseLocation==='لندن'),'LON vehicles must carry the LON city label, not الرياض');
  assert(lonVehicles.every(v=>String(v.zoneId).startsWith('LON-')),'LON vehicles must use LON local zones, not RUH neighborhoods');
  assert(ruhVehicles.every(v=>!String(v.zoneId).startsWith('LON-')),'RUH vehicles must never be assigned LON zones');

  const at0=state.simSeconds;
  for(let i=0;i<300;i++){state.simSeconds=at0+i;sandbox.GH_MOBILITY_CORE.onSimulationTime(ctx,state.simSeconds);}
  const lonActivity=state.mobility.rideRequests.filter(r=>r.centerId==='LON').length+state.mobility.activeTrips.filter(t=>t.centerId==='LON').length+state.mobility.tripArchive.filter(t=>t.centerId==='LON').length;
  assert(lonActivity>0,'an opened capital center with its own fleet must generate its own independent ride demand');
  for(const t of state.mobility.activeTrips){const vehicle=state.mobility.vehicles.find(v=>v.id===t.vehicleId);if(vehicle)assert.strictEqual(vehicle.centerId,t.centerId,'a trip must never mix a vehicle from one center with another center\u2019s route');}

  // 3) عدالة العرض على الخريطة: مركز صغير يجب ألا يختفي خلف مركز أكبر ضمن سقف العرض.
  const shown=sandbox.GH_MOBILITY_CORE.liveVehicles(state,120);
  const shownRUH=shown.filter(v=>v.centerId==='RUH').length,shownLON=shown.filter(v=>v.centerId==='LON').length;
  assert(shownLON>=15,'a smaller center must still get fair map representation, not be crowded out entirely');
  assert(shownRUH>0,'the larger center must still be represented too');
})();

// 2) ترحيل حفظة قديمة (بنية أحادية المركز قبل هذا الإصلاح) دون فقدان بيانات وبلا كسر.
(function legacySaveMigration(){
  const s = scenario();
  s.load('mobility-core');
  const {state, ctx, s: sandbox} = s;
  s.command('corporate','open-company',{type:'mobility',capital:500000000,legalName:'Test Mobility'});

  state.mobility = {
    schema:'gh-mobility-v2',version:'2.9.1',status:'active',launchedAt:1000,lastDemandAt:5000,
    vehicles:[{id:'MOB-V-0000001',assetClass:'eco-ev',name:'legacy',status:'available',zoneId:'KAFD',battery:80,condition:95,totalTrips:3,totalKm:120}],
    drivers:[{id:'DRV-0000001',name:'legacy driver',status:'online',zoneId:'KAFD',totalTrips:3,earnings:500}],
    rideRequests:[],activeTrips:[],tripArchive:[{id:'TRIP-1',fare:50}],
    events:[],capitalCenters:[],sequence:10,
    kpis:{requests:20,completed:3,cancelled:0,grossBookings:500,driverPayouts:300,platformRevenue:50,avgRating:4.9,acceptanceRate:100,completionRate:100}
  };

  const m = sandbox.GH_MOBILITY_CORE.ensure(state);
  assert.strictEqual(m.vehicles[0].centerId,'RUH','legacy vehicles must migrate to RUH by default');
  assert.strictEqual(m.drivers[0].centerId,'RUH','legacy drivers must migrate to RUH by default');
  assert.strictEqual(m.lastDemandAtByCenter.RUH,5000,'the old single lastDemandAt counter must migrate exactly into RUH, not reset');
  assert.strictEqual(m.tripArchive.length,1,'old trip archive must not be lost');
  assert.strictEqual(m.kpis.completed,3,'old cumulative KPIs must not be reset');

  sandbox.GH_MOBILITY_CORE.onSimulationTime(ctx,state.simSeconds+100); // must not throw on migrated legacy state
})();

// 3) الإيرادات/المصاريف الفعلية لـMobility يجب أن تنعكس بدقة على الحساب الجاري دون تكرار أو فقدان.
(function financePostingIntegrity(){
  const s = scenario();
  s.load('mobility-core');
  const {state, ctx, s: sandbox} = s;
  s.command('corporate','open-company',{type:'mobility',capital:500000000,legalName:'Test Mobility'});
  sandbox.GH_MOBILITY_CORE.launch(ctx);

  const book=()=>sandbox.GH_FINANCE_CORE.book(state,'mobility');
  const balanceBefore=book().accounts[0].balance;
  let at=state.simSeconds;
  for(let i=0;i<3000;i+=30){at+=30;state.simSeconds=at;sandbox.GH_MOBILITY_CORE.onSimulationTime(ctx,at);}
  const snap=sandbox.GH_MOBILITY_CORE.snapshot(state),delta=book().accounts[0].balance-balanceBefore;
  assert(snap.completed>0,'trips must complete within this window to verify posting');
  assert(Math.abs(delta-snap.platformRevenue)<0.01,'the actual current-account delta must exactly match reported platform revenue \u2014 no duplication, no loss');

  const dup1=sandbox.GH_FINANCE_CORE.execute({state},'record-simulation-revenue',{company:'mobility',gross:99999,expenses:0,net:99999,reference:'SIM-TEST-DUP-1',note:'test'});
  const dup2=sandbox.GH_FINANCE_CORE.execute({state},'record-simulation-revenue',{company:'mobility',gross:99999,expenses:0,net:99999,reference:'SIM-TEST-DUP-1',note:'test'});
  assert.strictEqual(dup1.idempotent,false,'first post with a given reference must record');
  assert.strictEqual(dup2.idempotent,true,'a repeated post with the same reference must be rejected, not double-booked');
})();

console.log('Mobility multi-center independence + legacy-save migration + finance-posting integrity BUILD258 firewall: PASS');
