'use strict';
const assert=require('assert');
const fs=require('fs');
const {harness,minimal}=require('./helpers/core-harness');

const {s}=harness(['transaction-core','domain-command-core','finance-core','procurement-core','corporate-core','facility-core','governance-core','banking-core','energy-core']);
const F=s.GH_FINANCE_CORE,P=s.GH_PROCUREMENT_CORE,C=s.GH_CORPORATE_CORE,FC=s.GH_FACILITY_CORE,G=s.GH_GOVERNANCE_CORE,B=s.GH_BANKING_CORE,E=s.GH_ENERGY_CORE;

function fundedState(){
  const state={...minimal(),profile:{name:'Build 304 Group',founder:'المؤسس',hq:'الرياض'},openedCompanies:['bank','power'],unlockedSectors:['bank','power'],companyRegistry:{bank:{legalName:'Build 304 Bank'},power:{legalName:'Build 304 Energy'}},advanced:{economy:{electricityPriceMWh:95,gasCostMWh:41,carbonPriceTon:38,depositRate:.03,loanYield:.075}},customHubs:[],globalBases:[],assets:[]};
  F.ensure(state);for(const company of ['group','bank','power'])F.book(state,company).accounts[0].balance=500_000_000;F.reconcile(state);return state;
}

// Other player-facing purchases use the same cheque owner: acquisitions,
// facility CAPEX expansion and insurance policy purchases. Internal capital
// transfers and lending remain transfers because they are not supplier purchases.
{
  const state=fundedState();C.ensure(state);
  const acquisition=C.execute({state},'acquire-stake',{id:'TARGET-304',name:'Target Logistics',stake:10,amount:10_000_000,synergy:1_000_000});
  assert(state.finance.cheques.some(row=>row.id===acquisition.paymentRef&&row.status==='مصروف'));
  state.customHubs.push({id:'POWER-HUB-304',company:'power',kind:'power',owned:true,name:'محطة اختبار',capacity:'100 MW'});
  const expansion=FC.execute({state},'expand',{id:'POWER-HUB-304',company:'power',cost:12_000_000});
  assert(state.finance.cheques.some(row=>row.id===expansion.paymentRef&&row.status==='مصروف'));
  const policy=G.execute({state},'insurance-policy',{sector:'power',premium:1_500_000,insurer:'Global Risk Underwriters'});
  assert(state.finance.cheques.some(row=>row.id===policy.paymentRef&&row.status==='مصروف'));
}

// Every external supplier purchase is an actual issued-and-cleared cheque linked
// to a payable. A label saying "cheque" on a cash invoice is not sufficient.
{
  const state=fundedState(),before=F.operating(state,'group');
  const out=s.GH_DOMAIN_COMMANDS.dispatch({state},'procurement','supplier-payment',{company:'group',amount:12_500_000,supplier:{id:'SUP-1',legalName:'Global Equipment Supplier'},note:'شراء معدات',budgetLine:'capex'}).result;
  assert(out.cheque&&out.cheque.id,'supplier payment must return a real cheque');
  assert.strictEqual(out.cheque.status,'مصروف');
  assert.strictEqual(out.invoice.status,'مسددة');
  assert.strictEqual(out.reference,out.cheque.id);
  assert.strictEqual(out.transaction.method,'شيك مصرفي');
  assert.strictEqual(F.operating(state,'group'),before-12_500_000,'cheque purchase must deduct cash exactly once');
  assert(!state.finance.payables.some(row=>row.number===out.invoice.number),'cleared cheque must close its linked payable');
  const journal=state.finance.journalEntries.find(row=>row.sourceRef===out.cheque.id);
  assert(journal,'cheque clearing journal missing');
  assert.strictEqual(journal.lines.reduce((n,row)=>n+row.debit,0),journal.lines.reduce((n,row)=>n+row.credit,0),'cheque clearing journal must balance');
}

// An unaffordable cheque purchase rolls the entire payable/cheque/document cycle back.
{
  const state=fundedState();F.book(state,'group').accounts[0].balance=1_000_000;F.reconcile(state);
  const before={cash:F.operating(state,'group'),cheques:state.finance.cheques.length,invoices:state.finance.invoices.length,payables:state.finance.payables.length,suppliers:state.supplierTransactions?.length||0};
  assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatch({state},'procurement','supplier-payment',{company:'group',amount:9_000_000,supplier:{name:'Unaffordable Supplier'},note:'شراء غير ممول',budgetLine:'capex'}));
  assert.deepStrictEqual({cash:F.operating(state,'group'),cheques:state.finance.cheques.length,invoices:state.finance.invoices.length,payables:state.finance.payables.length,suppliers:state.supplierTransactions?.length||0},before,'failed cheque purchase left partial financial state');
}

// Institutional banking controls are explicit decisions, not decorative metrics.
{
  const state=fundedState();
  const branch=B.execute({state},'open-branch',{branchId:'BR-RUH',facilityId:'BANK-RUH',city:'الرياض',country:'السعودية'});
  const pricing=B.execute({state},'set-deposit-pricing',{sight:.018,savings:.031,term:.046});
  assert.strictEqual(pricing.term,.046);
  const policy=B.execute({state},'set-risk-policy',{maxLdr:88,minLcr:115,minCet1:12.5,sectorConcentration:24});
  assert.strictEqual(policy.maxLdr,88);
  const wholesale=B.execute({state},'raise-wholesale-funding',{amount:50_000_000,rate:.052,termDays:365,lender:'سوق الصكوك المؤسسي'});
  assert.strictEqual(wholesale.amount,50_000_000);
  const security=B.execute({state},'invest-liquidity',{amount:20_000_000,kind:'sovereign',yieldRate:.041,termDays:730});
  assert.strictEqual(security.amount,20_000_000);
  const loan=B.execute({state},'originate-loan',{branchId:branch.id,product:'corporate',amount:15_000_000,riskGrade:'A',collateralCoverage:1.35});
  assert.strictEqual(loan.riskGrade,'A');assert(Number(loan.expectedLoss)>=0);assert(loan.stage===1);
  state.simSeconds=86400;const report=B.execute({state},'tick-day',{day:1});
  for(const key of ['interestIncome','depositInterestExpense','feeIncome','creditLossExpense','netBankingIncome'])assert(Number.isFinite(Number(report[key])),`bank daily report missing ${key}`);
  const prudential=B.reconcilePrudential(state);for(const key of ['lcr','nsfr','cet1','loanDepositRatio'])assert(Number.isFinite(Number(prudential[key])),`prudential metric missing ${key}`);

  // Maturities are balance-sheet events: treasury principal returns to cash and
  // wholesale principal is repaid once, with no phantom HQLA or stale liability.
  const heldSecurity=state.bank.treasurySecurities.find(row=>row.id===security.id),wholesaleFacility=state.bank.wholesaleFacilities.find(row=>row.id===wholesale.id);heldSecurity.maturityDay=2;wholesaleFacility.maturityDay=2;const cashBeforeMaturity=F.operating(state,'bank');state.simSeconds=2*86400;const maturity=B.execute({state},'tick-day',{day:2});
  assert.strictEqual(maturity.securitiesMatured,20_000_000);assert.strictEqual(maturity.wholesalePrincipalRepaid,50_000_000);assert.strictEqual(heldSecurity.status,'مستردة');assert.strictEqual(wholesaleFacility.status,'مسدد');assert.strictEqual(wholesaleFacility.outstanding,0);assert.strictEqual(state.bank.wholesaleFunding,0);assert(Math.abs(F.operating(state,'bank')-(cashBeforeMaturity+20_000_000-50_000_000+maturity.newDeposits+maturity.principalRepaid))<1e-6,'maturity principals must move cash exactly once');
  assert(state.finance.journalEntries.some(row=>row.sourceRef===`MATURITY-${security.id}`));assert(state.finance.journalEntries.some(row=>row.sourceRef===`REPAY-${wholesale.id}`));
}

// Institutional energy decisions operate per site and feed deterministic economics.
{
  const state=fundedState();state.customHubs.push({id:'POWER-GAS-RUH',company:'power',kind:'power',owned:true,energyKind:'gas',capacityAmount:220,name:'محطة الرياض المرنة',city:'الرياض',country:'السعودية',coords:[24.7,46.7],commissioned:true});state.energy={gasMW:220,solarMW:0,windMW:0,storageMWh:0,availability:94};
  const site=E.ensure(state).sites[0];
  const dispatch=E.execute({state},'set-dispatch-policy',{siteId:site.id,mode:'follow-market',reserveMargin:12});assert.strictEqual(dispatch.dispatchMode,'follow-market');
  const grid=E.execute({state},'set-grid-connection',{siteId:site.id,exportLimitMW:175,lossRate:.025,gridOperator:'مشغل الشبكة الوطني'});assert.strictEqual(grid.gridExportLimitMW,175);
  const fuel=E.execute({state},'sign-fuel-contract',{siteId:site.id,supplier:'شركة الغاز الوطنية',priceMWh:36,volumeMWh:240000,termDays:365,takeOrPay:.75});assert.strictEqual(fuel.status,'ساري');
  const maintenance=E.execute({state},'schedule-maintenance',{siteId:site.id,startDay:15,durationDays:4,cost:2_000_000,availabilityDuring:.2});assert.strictEqual(maintenance.status,'مجدولة');
  const financing=E.execute({state},'finance-project',{siteId:site.id,amount:36_500_000,rate:.065,termDays:365,lender:'اتحاد بنوك المشاريع'});const debtBefore=F.book(state,'power').debt;
  const economics=E.siteEconomics(state)[0];assert(economics.generationMWh>0&&economics.gridExportMWh<=175*24+1e-8);for(const key of ['ebitda','debtPrincipal','debtInterest','debtService','freeCashFlow','lcoe'])assert(Number.isFinite(Number(economics[key])),`site economics missing ${key}`);assert(economics.fuelContractMWh>0&&economics.spotFuelMWh===0);
  state.simSeconds=86400;const report=E.tickDay(state,{day:1});assert(Number.isFinite(Number(report.powerRevenue))&&Number.isFinite(Number(report.net)));assert.strictEqual(report.debtPrincipalPaid,100_000);assert.strictEqual(F.book(state,'power').debt,debtBefore-100_000);assert.strictEqual(state.energy.projectFinance.find(row=>row.id===financing.id).outstanding,36_400_000);assert(state.energy.fuelContracts.find(row=>row.id===fuel.id).remainingMWh<fuel.remainingMWh);assert(state.finance.journalEntries.some(row=>row.sourceRef===`PF-PAY-${financing.id}-1`));
}

const app=fs.readFileSync('WebApp/app.js','utf8'),html=fs.readFileSync('WebApp/index.html','utf8'),css=fs.readFileSync('WebApp/styles.css','utf8'),advanced=fs.readFileSync('WebApp/advanced-core.js','utf8');

// Four UI levels remain save-compatible, while their effective simulation rates
// deliver one day in 48m / 12m / 2m24s. Business rules still read one clock only.
assert(app.includes('const SAFE_SPEED_VALUES=[0,1,2,4]'));
assert(app.includes('SIMULATION_RATE_BY_LEVEL=Object.freeze({0:0,1:30,2:120,4:600})'));
assert(app.includes('ed.powerDebtInterest'));
assert(app.includes('getSpeed:()=>effectiveSimulationRate(state.speed)'));
assert(app.includes('allowedSpeeds:[0,30,120,600]'));
assert(html.includes('data-speed="0"')&&html.includes('data-speed="1"')&&html.includes('data-speed="2"')&&html.includes('data-speed="4"'));
assert(html.includes('id="simClockChip"')&&html.includes('id="simDay"'),'date/day must be visible independently of hidden brand copy');
assert(css.includes('.sim-clock-chip'));
{
  const simulation=require('../WebApp/simulation-core.js');let wall=0,simTime=0;
  const engine=simulation.create({getSpeed:()=>600,setSpeed:()=>{},getSimTime:()=>simTime,setSimTime:value=>{simTime=value;},createSliceJob:()=>({runChunk:()=>true,finish:()=>({committed:true}),cancel(){}})},{nowMs:()=>wall,minRealSliceSeconds:.5,allowedSpeeds:[0,30,120,600],fallbackSpeed:30,frameBudgetMs:1000});
  engine.reset(0,'build304-ultra-test');for(let frame=1;frame<=288;frame++){wall=frame*500;engine.frame(wall);}
  assert(Math.abs(simTime-86400)<1e-6,`ultra speed must advance exactly one simulation day in 144 seconds, got ${simTime}`);
}

// Map representation may aggregate but cannot silently drop owned ships/facilities.
assert(app.includes('movingFleetClusters'));
assert(app.includes('movingAssetGroups'));
assert(app.includes('facilityRenderGroups'));
assert(!app.includes("}).slice(0,mapRenderBudget(zoom,'facilities')).forEach(f=>"),'owned facilities are still blindly truncated');
assert(app.includes('function cancelRoadRoutePlacement('));
assert(app.includes('id="cancelMapPlacement"'));
assert(!app.includes('id="changeMapPlacement"')&&!app.includes('confirmMapPlacement'));
assert(app.includes("cancelRoadRoutePlacement('تم إلغاء وضع رسم المسار.')"));

// Bases/centres have one discoverable owner, while bank/energy depth is separated
// into focused institutional workspaces rather than one overlong legacy page.
assert(app.includes('function renderFacilitiesHub('));
assert(app.includes('data-facilitysector='));
assert(app.includes('data-focus-facility='));
assert(advanced.includes('data-bank-tab=')&&advanced.includes('data-energy-tab='));
for(const label of ['الفروع والخدمات','الودائع والتسعير','الائتمان','الخزينة وALM','المخاطر والقوائم'])assert(advanced.includes(label),`bank workspace missing ${label}`);
for(const label of ['المشروعات','التشغيل والصيانة','العقود والسوق','الشبكة والوقود','التمويل والمخاطر'])assert(advanced.includes(label),`energy workspace missing ${label}`);

console.log('BUILD304 institutional network/time/cheque: PASS');
