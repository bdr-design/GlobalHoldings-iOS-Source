'use strict';
const assert=require('assert');
const fs=require('fs');
const {harness,minimal}=require('./helpers/core-harness');

const {s}=harness(['transaction-core','domain-command-core','finance-core','corporate-core','banking-core','energy-core','mobility-core','economics-core']);
const F=s.GH_FINANCE_CORE,B=s.GH_BANKING_CORE,E=s.GH_ENERGY_CORE,M=s.GH_MOBILITY_CORE,X=s.GH_ECONOMICS_CORE;

function fundedState(opened=[]){
  const state={...minimal(),profile:{name:'Build 305 Group',founder:'المؤسس',hq:'الرياض'},openedCompanies:[...opened],unlockedSectors:[...opened],companyRegistry:{},advanced:{economy:{electricityPriceMWh:95,gasCostMWh:41,carbonPriceTon:38,depositRate:.03}},customHubs:[],assets:[]};
  F.ensure(state);for(const company of ['group',...opened])F.book(state,company).accounts[0].balance=500_000_000;F.reconcile(state);return state;
}

// A linked cheque is a one-to-one settlement instrument. Company, amount and
// beneficiary mismatches are rejected before a sequence, cheque or cash mutates.
{
  const state=fundedState(['air','road']);
  const invoice=s.GH_DOMAIN_COMMANDS.dispatch({state},'finance','accrue-expense',{company:'air',amount:1_000_000,note:'قطع غيار',counterparty:'Supplier A',line:'maintenance'},{actor:'test'}).result;
  const before={cash:F.operating(state,'air'),paymentSequence:state.finance.paymentSequence,cheques:state.finance.cheques.length,payables:state.finance.payables.length,status:invoice.status};
  assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatch({state},'finance','issue-cheque',{company:'road',amount:1_000_000,beneficiary:'Supplier A',invoiceNumber:invoice.number},{actor:'test'}),/company-mismatch/);
  assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatch({state},'finance','issue-cheque',{company:'air',amount:900_000,beneficiary:'Supplier A',invoiceNumber:invoice.number},{actor:'test'}),/amount-mismatch/);
  assert.deepStrictEqual({cash:F.operating(state,'air'),paymentSequence:state.finance.paymentSequence,cheques:state.finance.cheques.length,payables:state.finance.payables.length,status:invoice.status},before);
  const cheque=s.GH_DOMAIN_COMMANDS.dispatch({state},'finance','issue-cheque',{company:'air',amount:1_000_000,beneficiary:'Supplier A',invoiceNumber:invoice.number},{actor:'test'}).result;
  const cashBeforeSettlement=F.operating(state,'air');cheque.amount=999_999;
  assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatch({state},'finance','settle-cheque',{id:cheque.id},{actor:'test'}),/amount-mismatch/);
  assert.strictEqual(F.operating(state,'air'),cashBeforeSettlement);assert.strictEqual(cheque.status,'صادر');assert(state.finance.payables.some(row=>row.number===invoice.number));
  cheque.amount=1_000_000;const settled=s.GH_DOMAIN_COMMANDS.dispatch({state},'finance','settle-cheque',{id:cheque.id},{actor:'test'}).result;
  assert.strictEqual(settled.settled,true);assert.strictEqual(invoice.status,'مسددة');assert.strictEqual(F.operating(state,'air'),cashBeforeSettlement-1_000_000);
}

// Journal identity is monotonic even when the live array has been archived.
{
  const state=fundedState();state.finance.journalEntries=[{id:'JE-00005000',company:'group',description:'archived boundary',lines:[{account:'A',debit:1,credit:0},{account:'B',debit:0,credit:1}],at:0}];delete state.finance.journalSequence;F.ensure(state);
  const row=F.journal(state,'group','next after archive',[{account:'A',debit:2},{account:'B',credit:2}],'SEQ-TEST');
  assert.strictEqual(row.id,'JE-00005001');assert.strictEqual(state.finance.journalSequence,5001);
}

// Project finance capitalizes construction interest and starts amortization only
// after commercial operation. The fields are additive under Save Schema 2.0.0.
{
  const state=fundedState(['power']);state.customHubs.push({id:'POWER-BUILD-305',company:'power',kind:'power',owned:true,energyKind:'solar',capacityAmount:120,name:'Build 305 Solar',city:'الرياض',country:'السعودية',coords:[24.7,46.7],commissioned:false,cost:80_000_000});
  const site=E.ensure(state).sites[0],facility=E.execute({state},'finance-project',{siteId:site.id,amount:36_500_000,rate:.073,termDays:365,lender:'Project Lender'}),cashBefore=F.operating(state,'power'),debtBefore=F.book(state,'power').debt;
  state.simSeconds=86400;const construction=E.tickDay(state,{day:1}),live=state.energy.projectFinance.find(row=>row.id===facility.id);
  assert.strictEqual(construction.debtPrincipalPaid,0);assert(construction.constructionInterestCapitalized>0);assert(live.outstanding>36_500_000);assert(F.book(state,'power').debt>debtBefore);assert.strictEqual(F.operating(state,'power'),cashBefore);assert(state.finance.journalEntries.some(row=>row.sourceRef===`PF-CAPINT-${facility.id}-1`));
  state.customHubs[0].commissioned=true;state.simSeconds=2*86400;E.ensure(state);const commissioningDay=E.tickDay(state,{day:2});assert.strictEqual(commissioningDay.debtPrincipalPaid,0,'principal cannot be due on the commissioning day');
  state.simSeconds=3*86400;const operatingDay=E.tickDay(state,{day:3}),closed=X.sectorEconomics(state,{day:3,preferDailyReport:true});assert(operatingDay.debtPrincipalPaid>0);assert(live.outstanding<36_500_000+construction.constructionInterestCapitalized);assert.strictEqual(closed.detail.powerRevenue,operatingDay.powerRevenue);assert.strictEqual(closed.detail.powerDebtInterest,operatingDay.debtInterest);
}

// An unresolved street route has a finite lifecycle and releases all three
// linked records (request, vehicle and driver) without phantom revenue.
{
  const state={...minimal(),simSeconds:0,mobility:{routeSchemaVersion:3,status:'active',sequence:3,vehicles:[{id:'MOB-V-1',assetClass:'eco-ev',name:'Car 1',status:'moving',centerId:'RUH',zoneId:'KAFD',tripId:'TRIP-1',battery:100,totalTrips:0,totalKm:0}],drivers:[{id:'DRV-1',status:'on-trip',centerId:'RUH',zoneId:'KAFD',tripId:'TRIP-1',assetId:'MOB-V-1',earnings:0,totalTrips:0}],rideRequests:[{id:'RIDE-1',status:'active',centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',vehicleId:'MOB-V-1',driverId:'DRV-1',tripId:'TRIP-1'}],activeTrips:[{id:'TRIP-1',requestId:'RIDE-1',vehicleId:'MOB-V-1',driverId:'DRV-1',centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',acceptedAt:0,startedAt:0,routingDeadlineAt:900,dueAt:null,duration:900,distanceKm:5,fare:20,progress:0,route:[[24.767,46.643],[24.767,46.643]],routeVerified:false}],tripArchive:[],events:[],capitalCenters:[],streetRoutes:{},lastDemandAtByCenter:{},kpis:{requests:1,accepted:1,completed:0,cancelled:0}}};
  M.onSimulationTime({state},901);const mobility=state.mobility;
  assert.strictEqual(mobility.activeTrips.length,0);assert.strictEqual(mobility.vehicles[0].status,'available');assert.strictEqual(mobility.vehicles[0].tripId,null);assert.strictEqual(mobility.drivers[0].status,'online');assert.strictEqual(mobility.drivers[0].tripId,null);assert.strictEqual(mobility.rideRequests[0].status,'cancelled');assert.strictEqual(mobility.kpis.cancelled,1);assert(mobility.tripArchive.some(row=>row.id==='TRIP-1'&&row.status==='cancelled'));
}

// Render caps may replace moving cars with clusters, but never drop ownership.
{
  const vehicles=[],drivers=[],requests=[],trips=[];for(let i=1;i<=30;i++){const id=`MOB-V-${i}`,tripId=`TRIP-${i}`;vehicles.push({id,assetClass:'eco-ev',name:id,status:'moving',centerId:'RUH',zoneId:'KAFD',tripId,battery:100,totalTrips:0,totalKm:0});drivers.push({id:`DRV-${i}`,status:'on-trip',centerId:'RUH',zoneId:'KAFD',tripId,assetId:id});requests.push({id:`RIDE-${i}`,status:'active',centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',vehicleId:id,driverId:`DRV-${i}`,tripId});trips.push({id:tripId,requestId:`RIDE-${i}`,vehicleId:id,driverId:`DRV-${i}`,centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',acceptedAt:0,startedAt:0,dueAt:999999,duration:999999,distanceKm:5,fare:20,progress:i/31,route:[[24.767,46.643],[24.711,46.674]],routeVerified:true});}
  const state={...minimal(),mobility:{routeSchemaVersion:3,sequence:100,status:'active',vehicles,drivers,rideRequests:requests,activeTrips:trips,tripArchive:[],events:[],capitalCenters:[],streetRoutes:{},lastDemandAtByCenter:{},kpis:{requests:30,accepted:30,completed:0,cancelled:0}}};M.ensure(state);
  const shown=M.liveVehicles(state,18,{movingOnly:true}),clusters=M.movingClusters(state,shown.map(row=>row.id));assert.strictEqual(shown.length,18);assert.strictEqual(clusters.reduce((sum,row)=>sum+row.count,0),12);assert.strictEqual(shown.length+clusters.reduce((sum,row)=>sum+row.count,0),30);
}

// Corporate bank draws now have a real repayment schedule; prudential values use
// actual cash/securities/equity, and expired off-balance instruments leave exposure.
{
  const state=fundedState(['bank']);const bank=B.ensure(state);bank.corporateClients.group.creditLimit=20_000_000;
  const amount=B.execute({state},'draw-facility',{company:'group',amount:3_650_000,termDays:365,rate:.06});assert.strictEqual(amount,3_650_000);assert.strictEqual(bank.corporateFacilities.length,1);assert.strictEqual(F.book(state,'group').debt,3_650_000);
  state.simSeconds=86400;const report=B.execute({state},'tick-day',{day:1});assert(report.corporatePrincipalRepaid>0);assert(report.corporateInterestIncome>0);assert(bank.corporateFacilities[0].outstanding<amount);assert(F.book(state,'group').debt<amount);assert(bank.corporateClients.group.drawn<amount);
  const instrument=B.execute({state},'trade-instrument',{company:'group',kind:'guarantee',amount:100_000,counterparty:'Supplier'});instrument.expiryDay=2;state.simSeconds=2*86400;const dayTwo=B.execute({state},'tick-day',{day:2}),closed=X.sectorEconomics(state,{day:2,preferDailyReport:true});assert.strictEqual(instrument.status,'منتهي');assert.strictEqual(bank.offBalance,0);assert.strictEqual(closed.detail.interestIncome,dayTwo.interestIncome);assert.strictEqual(closed.bank,dayTwo.netBankingIncome);
  const prudential=B.reconcilePrudential(state);assert.strictEqual(prudential.hqla,Math.round(F.operating(state,'bank')));assert(prudential.rwa>0);assert(Number.isFinite(prudential.cet1)&&prudential.cet1Capital>=0);
}

// The performance governor measures clone/create and atomic finish work as well
// as runChunk, so slow closes cannot remain invisible.
{
  const simulation=require('../WebApp/simulation-core.js');let wall=0,simTime=0;
  const engine=simulation.create({getSpeed:()=>30,setSpeed:()=>{},getSimTime:()=>simTime,setSimTime:value=>{simTime=value;},createSliceJob:()=>{wall+=7;return {runChunk(){wall+=4;return true;},finish(){wall+=9;return {committed:true};},cancel(){}};}},{nowMs:()=>wall,allowedSpeeds:[0,30],fallbackSpeed:30,frameBudgetMs:100,longTaskWarnMs:50,hardTaskMs:120});
  engine.reset(0,'build305-metrics');wall=1000;engine.frame(wall);const health=engine.snapshot();assert.strictEqual(health.lastCreateMs,7);assert.strictEqual(health.lastChunkMs,4);assert.strictEqual(health.lastFinishMs,9);assert.strictEqual(health.lastCycleMs,20);assert.strictEqual(health.maxCycleMs,20);
}

const app=fs.readFileSync('WebApp/app.js','utf8'),finance=fs.readFileSync('WebApp/finance-core.js','utf8'),mobility=fs.readFileSync('WebApp/mobility-core.js','utf8');
const close=app.slice(app.indexOf('function processFinancialDay('),app.indexOf('function runOperationsCycle('));assert(close.indexOf('GH_ADVANCED.onFinancialDay')<close.indexOf('GH_ECONOMICS_CORE?.sectorEconomics'),'bank/energy tick must precede same-day accounting read');
assert(app.includes('movingMobilityClusters')&&app.includes('GH_MOBILITY_CORE?.movingClusters?.'),'map must render the moving remainder as clusters');assert(finance.includes('journalSequence'));assert(mobility.includes('ROUTE_WAIT_TIMEOUT_SECONDS=900'));assert.strictEqual(minimal().saveVersion,'2.0.0');

console.log('BUILD305 financial/mobility integrity: PASS');
