'use strict';
const assert=require('assert');
const fs=require('fs');
const {harness,minimal}=require('./helpers/core-harness');

const {s}=harness(['transaction-core','domain-command-core','finance-core','energy-core','facility-core','banking-core','mobility-core','economics-core']);
const state={
  ...minimal(),
  profile:{name:'Build 303 Group',founder:'المؤسس',hq:'الرياض، المملكة العربية السعودية'},
  groupValue:2_000_000_000,
  openedCompanies:['power','bank'],
  unlockedSectors:['power','bank'],
  companyRegistry:{power:{legalName:'Build 303 Energy'},bank:{legalName:'Build 303 Bank'}},
  advanced:{economy:{electricityPriceMWh:92,gasCostMWh:39,carbonPriceTon:45,depositRate:.03,loanYield:.075},labor:{employmentContracts:[],hiringLog:[]}},
  customHubs:[],globalBases:[],assets:[]
};
const F=s.GH_FINANCE_CORE,E=s.GH_ENERGY_CORE,B=s.GH_BANKING_CORE,FC=s.GH_FACILITY_CORE,X=s.GH_ECONOMICS_CORE;
F.ensure(state);
for(const [company,balance] of [['group',500_000_000],['power',500_000_000],['bank',500_000_000]])F.book(state,company).accounts[0].balance=balance;
F.reconcile(state);

// Energy starts at an actual zero. A project under construction owns a site,
// but contributes no capacity, generation or income before commissioning.
assert.strictEqual(E.economics(state).powerRevenue,0);
state.customHubs.push({id:'POWER-DXB-SOLAR',company:'power',kind:'power',owned:true,energyKind:'solar',capacityAmount:100,name:'Dubai Solar 100MW',city:'دبي',country:'الإمارات',coords:[25.2,55.3],commissioned:false});
let energy=E.ensure(state),sites=E.siteEconomics(state);
assert.strictEqual(energy.sites.length,1);assert.strictEqual(sites[0].commissioned,false);assert.strictEqual(sites[0].dailyRevenue,0);assert.strictEqual(E.economics(state).generation,0);

// Commissioning turns the purchased capacity on, creates commercial PPA
// offers and separates contracted revenue from the spot market.
state.customHubs[0].commissioned=true;state.energy.solarMW=100;energy=E.ensure(state);sites=E.siteEconomics(state);
assert.strictEqual(energy.ppaOffers.filter(row=>row.status==='متاح').length,3);
const beforePpa=E.economics(state);assert(beforePpa.generation>0&&beforePpa.spotRevenue>0&&beforePpa.powerRevenue>beforePpa.powerExpense);
const contract=E.acceptPpa(state,{id:energy.ppaOffers.find(row=>row.status==='متاح').id});
const afterPpa=E.economics(state);assert(contract.capacityMW>0);assert(afterPpa.ppaRevenue>0);assert(afterPpa.ppaMWh>0);assert(afterPpa.spotMWh<beforePpa.spotMWh);assert(Math.abs(afterPpa.generation-(afterPpa.ppaMWh+afterPpa.spotMWh))<1e-8);
const energyDay=E.tickDay(state,{day:1}),energyRows=state.energy.dailyHistory.length;assert(energyDay.powerRevenue>0);E.tickDay(state,{day:1});assert.strictEqual(state.energy.dailyHistory.length,energyRows,'energy daily close must be idempotent');

// The bank also begins at zero. A real international branch acquires customers
// and deposits deterministically; deposits remain a liability rather than fee income.
let bank=B.ensure(state);assert.strictEqual(bank.branches,0);assert.strictEqual(bank.deposits,0);assert.strictEqual(bank.loans,0);
const bankCapital=s.GH_MOBILITY_CORE.capitalMeta('AUH'),bankSite={key:'site:bank:AUH',kind:'company-site',company:'bank',...bankCapital};
FC.execute({state},'create',{facility:{id:'BANK-AUH',sourceKey:bankSite.key,company:'bank',kind:'bank',owned:true,...bankCapital}});
const branch=B.execute({state},'open-branch',{branchId:'BR-AUH',facilityId:'BANK-AUH',site:bankSite});
assert.strictEqual(branch.retailCustomers,0);assert.strictEqual(branch.deposits,0);assert(branch.services.includes('تمويل أفراد')&&branch.services.includes('تمويل شركات'));
const bankCashBeforeDeposits=F.operating(state,'bank');
for(let day=1;day<=20;day++){state.simSeconds=day*86400;B.execute({state},'tick-day',{day});}
bank=B.ensure(state);assert(bank.retailCustomers>0&&bank.businessCustomers>0);assert(bank.deposits>0);assert(bank.dailyServiceFeeRevenue>0);assert.strictEqual(Math.round(F.operating(state,'bank')-bankCashBeforeDeposits),Math.round(bank.deposits));

// Retail and corporate products are explicit. Loan origination creates a loan
// asset, retains only the origination fee and observes the liquidity/LDR guards.
for(const product of ['consumer','mortgage','sme','corporate','project','green'])assert(B.PRODUCTS[product],`missing banking product ${product}`);
const bankCashBeforeLoan=F.operating(state,'bank'),loan=B.execute({state},'originate-loan',{product:'consumer',branchId:'BR-AUH',amount:2_000_000,borrowers:12});
assert.strictEqual(loan.principal,2_000_000);assert.strictEqual(bank.loans,2_000_000);assert.strictEqual(F.operating(state,'bank'),bankCashBeforeLoan-(loan.principal-loan.originationFee));assert.strictEqual(bank.branchNetwork[0].loans,2_000_000);
const journal=state.finance.journalEntries.find(row=>row.sourceRef===loan.id);assert(journal);assert.strictEqual(journal.lines.reduce((sum,row)=>sum+row.debit,0),journal.lines.reduce((sum,row)=>sum+row.credit,0),'loan origination journal must balance');
const outstandingBefore=loan.outstanding;state.simSeconds=21*86400;B.execute({state},'tick-day',{day:21});const liveLoan=bank.loanPortfolios.find(row=>row.id===loan.id);assert(liveLoan.outstanding<outstandingBefore);const bankEconomics=X.sectorEconomics(state);assert(bankEconomics.detail.interestIncome>0);assert(bankEconomics.detail.feeIncome>0);

// Reserve liquidity accepts exact player-entered million-scale values. It is an
// internal balance transfer and therefore does not alter consolidated cash.
const groupTotalBefore=F.total(state,'group');F.execute({state},'transfer-reserve',{company:'group',amount:125_000_000,toReserve:true});assert.strictEqual(F.book(state,'group').accounts[1].balance,125_000_000);assert.strictEqual(F.total(state,'group'),groupTotalBefore);F.execute({state},'transfer-reserve',{company:'group',amount:25_000_000,toReserve:false});assert.strictEqual(F.book(state,'group').accounts[1].balance,100_000_000);

// A cash-short payroll becomes a linked payable, then automatically settles as
// a payroll transfer once funds exist and updates the same report line.
F.book(state,'power').accounts[0].balance=0;const payrollId='PAYROLL-2026-01',payable=F.execute({state},'accrue-payroll',{company:'power',amount:250_000,number:'PAY-POWER-2026-01',reportId:payrollId,dueDay:26});F.execute({state},'record-payroll-report',{report:{id:payrollId,day:26,monthKey:'2026-01',lines:[{company:'power',companyName:'Build 303 Energy',amount:250_000,paid:0,due:250_000,dueRef:payable.number,headcount:10}]}});F.book(state,'power').accounts[0].balance=250_000;const settled=F.execute({state},'settle-payable',{number:payable.number});const payrollReport=state.finance.payrollReports.find(row=>row.id===payrollId);assert.strictEqual(settled.payroll,true);assert.strictEqual(payrollReport.paid,250_000);assert.strictEqual(payrollReport.due,0);assert.strictEqual(payrollReport.status,'مصروف بالكامل');assert(state.treasury.ledger.some(row=>row.kind==='payroll-transfer'&&row.payrollReportId===payrollId));

// Monthly P&L is based on calendar months and retains an explicit deficit.
F.execute({state},'record-daily-close',{day:5,sectors:{power:-2_000_000,bank:3_000_000},companies:{power:{grossRevenue:10_000_000,expenses:12_000_000,net:-2_000_000},bank:{grossRevenue:4_000_000,expenses:1_000_000,net:3_000_000}},net:-3_000_000});
F.execute({state},'record-daily-close',{day:31,sectors:{bank:12_000_000},companies:{bank:{grossRevenue:20_000_000,expenses:8_000_000,net:12_000_000}},net:11_000_000});
state.simSeconds=31*86400;const statements=F.monthlyStatement(state,{months:12}),january=statements.find(row=>row.monthKey==='2026-01'),february=statements.find(row=>row.monthKey==='2026-02');assert(january&&february);assert.strictEqual(january.income,14_000_000);assert.strictEqual(january.net,-3_000_000);assert.strictEqual(january.deficit,3_000_000);assert.strictEqual(february.surplus,11_000_000);

// Issued cheques preserve all legally/materially relevant display data.
const cheque=F.execute({state},'issue-cheque',{company:'group',amount:12_345_678,beneficiary:'مورد المعدات العالمي',note:'دفعة معدات',draweeBank:'Global Holdings Treasury Bank',issuePlace:'الرياض، المملكة العربية السعودية',paymentPlace:'المركز المالي الرئيسي',authorizedSignatory:'المؤسس'});for(const key of ['chequeNumber','drawer','draweeBank','accountId','currency','beneficiary','issuePlace','paymentPlace','authorizedSignatory','dueDay'])assert(cheque[key]!==undefined&&cheque[key]!=='' ,`cheque field missing: ${key}`);

// UI/source contracts: Mobility is a compact white sedan; real street geometry is
// cached with bounded exponential retry; approvals remain a paper review log.
const app=fs.readFileSync('WebApp/app.js','utf8'),css=fs.readFileSync('WebApp/styles.css','utf8'),advanced=fs.readFileSync('WebApp/advanced-core.js','utf8');
assert(app.includes('assets/images/map-mobility-sedan-topdown.webp'));assert(!app.includes('mobility-street-dot'));assert(app.includes('iconSize:[44,44],iconAnchor:[22,22]'));assert(app.includes('pendingStreetRoutes?.(state,8)'));assert(app.includes('Math.min(120000,2500*(2**Math.min(5,attempts-1)))'));
assert(/\.vehicle-pin\.mobility \.vehicle-sprite\{[^}]*width:12px[^}]*height:24px/.test(css));assert(!css.includes('.mobility-street-dot'));
assert(advanced.includes('approval-log-paper'));assert(app.includes('cheque-instrument'));assert(css.includes('.financial-paper.authority-inspired.cheque-instrument')&&css.includes('aspect-ratio:2.12/1')&&css.includes('.drawer:has(.cheque-grid-wide)'));assert(app.includes("panel==='monthlyFinance'"));
assert(!advanced.includes('function renderEnergy(ctx)')&&!advanced.includes('function renderBank(ctx)'),'legacy duplicate energy/bank renderers survived BUILD303');assert(advanced.includes('فتح المركز التشغيلي الموحد'));assert(advanced.includes('بدل تشغيل واجهة طاقة قديمة')&&advanced.includes('بدل تشغيل واجهة بنك قديمة'));
assert(!app.includes("querySelectorAll('.bank-loan')"),'the removed fixed-size legacy bank-loan control must not retain a dead event binding');assert(!app.includes('function issueBankLoans()'),'the superseded fixed $50M loan path must be removed instead of accumulated beside Banking Core');

console.log('BUILD303 energy/bank/payroll/map: PASS');
