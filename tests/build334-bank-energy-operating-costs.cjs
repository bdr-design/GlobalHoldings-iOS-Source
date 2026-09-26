'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness,minimal}=require('./helpers/core-harness');
const results=[];
function check(name,fn){try{fn();results.push({name,ok:true});console.log('PASS',name);}catch(e){results.push({name,ok:false,error:e.message});console.error('FAIL',name,e.message);}}
const closeEnough=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function environment(){
 const {s}=harness(['finance-core','facility-core','banking-core','energy-core','economics-core','transaction-core','save-schema']);
 const state={...minimal(),profile:{name:'Stage cost contract'},openedCompanies:['bank','power','road'],branches:[],bank:{},energy:{},advanced:{economy:{electricityPriceMWh:90,gasCostMWh:39}}};
 const F=s.GH_FINANCE_CORE;F.ensure(state);for(const id of state.openedCompanies)F.book(state,id).accounts[0].balance=100000000;F.reconcile(state);
 state.customHubs.push({id:'BRANCH-F',ownerCompanyId:'bank',company:'bank',kind:'bank',owned:true,dailyCost:18500},
  {id:'SOLAR-F',ownerCompanyId:'power',company:'power',kind:'power',owned:true,dailyCost:38000,energyKind:'solar',capacityAmount:100,capacity:'100 MW',commissioned:true,cost:10000000,city:'Riyadh',country:'Saudi Arabia'},
  {id:'ROAD-F',ownerCompanyId:'road',kind:'logistics',owned:true,dailyCost:12500});
 s.GH_BANKING_CORE.ensure(state).branchNetwork.push({id:'BR-TEST',facilityId:'BRANCH-F',servicesActive:true,city:'Riyadh',country:'Saudi Arabia',lastProcessedDay:0});
 s.GH_BANKING_CORE.ensure(state);s.GH_ENERGY_CORE.ensure(state);return {s,state,F};
}
function reports(e,day=1){e.state.simSeconds=day*86400;return {bank:e.s.GH_BANKING_CORE.execute({state:e.state},'tick-day',{day}),power:e.s.GH_ENERGY_CORE.execute({state:e.state},'tick-day',{day})};}
function appExpenseBlock(e,day){
 const app=fs.readFileSync(path.resolve(__dirname,'../WebApp/app.js'),'utf8'),start=app.indexOf('      const baseByCompany=zeroCompanyMap(state)'),end=app.indexOf('      // Corporate facility interest',start);assert(start>=0&&end>start);
 const state=e.state,companyIds=['bank','power','road'],box={window:e.s,state,phase:(_name,fn)=>fn(),companyIds,companyIdSet:new Set(companyIds),zeroCompanyMap:()=>Object.fromEntries(companyIds.map(id=>[id,0])),getDynamicFacilities:()=>[...state.globalBases,...state.customHubs],facilityOwnerCompanyId:r=>r.ownerCompanyId||r.companyId||r.company||'group',companyContractRevenue:{},companyContractCost:{},leaseByCompany:{},uniqueOperationalCompanyForCapability:(_state,cap)=>({'operations.energy':'power','operations.bank':'bank'}[cap])};
 state.lastFinancialDay=day;vm.createContext(box);vm.runInContext(app.slice(start,end)+'\nthis.actual={operatingRevenue,operatingExpense,ed,baseByCompany};',box);return box.actual;
}
check('facility daily-cost read model is canonical, read-only and duplicate-safe',()=>{
 const e=environment(),foreign={id:'FOREIGN',ownerCompanyId:'road',company:'bank',kind:'bank',owned:true,dailyCost:7};e.state.customHubs.push(foreign,{id:'UNOWNED',ownerCompanyId:'bank',owned:false,dailyCost:999});
 const before=JSON.stringify(e.state),rows=[...e.state.customHubs,{...foreign}],cost=e.s.GH_FACILITY_CORE.dailyOperatingCosts(e.state,{facilities:rows});
 assert.equal(cost.byCompany.bank,18500);assert.equal(cost.byCompany.power,38000);assert.equal(cost.byCompany.road,12507);assert.equal(cost.total,69007);assert.equal(JSON.stringify(e.state),before);
 assert.throws(()=>e.s.GH_FACILITY_CORE.dailyOperatingCosts(e.state,{facilities:[foreign,{...foreign,dailyCost:8}]}),/facility-daily-cost-conflict/);
 assert.throws(()=>e.s.GH_FACILITY_CORE.dailyOperatingCosts(e.state,{facilities:[{...foreign,dailyCost:Infinity}]}),/facility-daily-cost-invalid/);
});
check('bank report splits service and premises expense without directly spending it',()=>{
 const e=environment(),before=e.F.operating(e.state,'bank'),r=reports(e).bank;
 assert.equal(r.serviceOpex,11800);assert.equal(r.facilityOpex,18500);assert.equal(r.opex,30300);
 closeEnough(r.netBankingIncome,r.interestIncome+r.securityIncome+r.feeIncome-r.depositInterestExpense-r.wholesaleInterestExpense-r.creditLossExpense-r.opex);
 closeEnough(e.F.operating(e.state,'bank')-before,r.newDeposits+r.principalRepaid+r.securitiesMatured);
 const branch=e.state.bank.branchNetwork[0];assert.equal(branch.incomeStatement.facilityOpex,18500);assert.equal(branch.incomeStatement.serviceOpex,11800);assert.equal(branch.incomeStatement.opex,30300);
 e.s.GH_BANKING_CORE.ensure(e.state);assert.equal(e.state.bank.branchNetwork[0].incomeStatement.facilityOpex,18500);
});
check('inactive bank services do not erase the existing premises charge',()=>{
 const e=environment();e.state.bank.branchNetwork[0].servicesActive=false;const r=reports(e).bank;
 assert.equal(r.serviceOpex,0);assert.equal(r.facilityOpex,18500);assert.equal(r.opex,18500);assert.equal(r.netBankingIncome,-18500);
});
check('solar site and total expense include the existing fixed charge exactly once',()=>{
 const e=environment(),r=reports(e).power,site=e.s.GH_ENERGY_CORE.siteEconomics(e.state)[0];
 assert.equal(site.facilityOpex,38000);closeEnough(site.dailyExpense,site.variableOpex+38000);assert.equal(r.facilityOpex,38000);closeEnough(r.powerExpense,r.variableOpex+38000);closeEnough(r.powerExpense,r.sites[0].expense);closeEnough(r.ebitda,r.powerRevenue-r.powerExpense);
});
check('storage, construction and regional office keep separate existing costs',()=>{
 const e=environment();const f=e.state.customHubs.find(x=>x.id==='SOLAR-F');f.energyKind='storage';f.capacityAmount=100;f.capacity='100 MWh';e.state.energy.sites=[];e.state.energy.regionalOffices=[{id:'OFFICE',status:'نشط',dailyOpex:12000}];let r=reports(e).power;
 assert.equal(r.facilityOpex,38000);assert.equal(r.regionalOfficeOpex,12000);closeEnough(r.powerExpense,r.sites[0].expense+12000);
 const c=environment();c.state.customHubs.find(x=>x.id==='SOLAR-F').commissioned=false;c.state.customHubs.find(x=>x.id==='SOLAR-F').dailyCost=0;c.state.energy.sites=[];r=reports(c).power;assert.equal(r.powerRevenue,0);assert.equal(r.powerExpense,0);
});
check('canonical energy owner is used, not a conflicting legacy company alias',()=>{
 const e=environment();const facility=e.state.customHubs.find(x=>x.id==='SOLAR-F');delete facility.company;e.state.energy.sites=[];e.s.GH_ENERGY_CORE.ensure(e.state);assert.equal(e.state.energy.sites.length,1);
 const other=environment();const f=other.state.customHubs.find(x=>x.id==='SOLAR-F');f.ownerCompanyId='road';other.state.energy.sites=[];other.s.GH_ENERGY_CORE.ensure(other.state);assert.equal(other.state.energy.sites.length,0);
});
check('actual application close block matches full section expense; road charge is unchanged',()=>{
 const e=environment(),r=reports(e),a=appExpenseBlock(e,1);
 closeEnough(a.operatingExpense.bank,r.bank.depositInterestExpense+r.bank.wholesaleInterestExpense+r.bank.creditLossExpense+11800+18500);
 closeEnough(a.operatingExpense.power,r.power.variableOpex+38000+r.power.debtInterest);
 closeEnough(a.operatingExpense.bank,a.ed.bankExpense);closeEnough(a.operatingExpense.power,a.ed.powerExpense+a.ed.powerDebtInterest);
 assert.equal(a.ed.bankFacilityExpense,18500);assert.equal(a.ed.powerFacilityExpense,38000);assert.equal(a.operatingExpense.road,12500);
 closeEnough(a.ed.bankExpenseToPost+18500,a.ed.bankExpense);closeEnough(a.ed.powerExpenseToPost+38000,a.ed.powerExpense);
});
check('legacy same-day reports remain readable without rewriting or repricing their variable cost',()=>{
 const e=environment();reports(e);const b=e.state.bank.dailyHistory[0],p=e.state.energy.dailyHistory[0];b.opex=11800;delete b.facilityOpex;delete b.serviceOpex;p.powerExpense=1699.6;delete p.facilityOpex;delete p.variableOpex;
 const before=JSON.stringify({b,p}),d=e.s.GH_ECONOMICS_CORE.sectorEconomics(e.state,{day:1,preferDailyReport:true}).detail;
 closeEnough(d.powerExpense,39699.6);closeEnough(d.powerExpenseToPost,1699.6);assert.equal(d.bankOpex,30300);assert.equal(JSON.stringify({b,p}),before);
});
check('repeat day and save/reload keep exact cost reports and schema 2.0.0',()=>{
 const e=environment();reports(e);const before=JSON.stringify(e.state);reports(e);assert.equal(JSON.stringify(e.state),before);e.state=JSON.parse(before);reports(e);assert.equal(JSON.stringify(e.state),before);assert.equal(e.state.saveVersion,'2.0.0');assert.equal(e.s.GH_SAVE_SCHEMA.validate(e.state).ok,true);
});
check('late failure rolls back cash, reports, contracts and the simulation day together',()=>{
 const e=environment(),before=JSON.stringify(e.state);
 assert.throws(()=>e.s.GH_TRANSACTION_CORE.execute(e.state,{label:'cost-contract-rollback',apply(){reports(e);e.F.execute({state:e.state},'spend',{company:'bank',amount:30300,note:'Test day cost',taxable:false});throw new Error('intentional-late-failure');}}),/intentional-late-failure/);
 assert.equal(JSON.stringify(e.state),before);
});
console.log(JSON.stringify({suite:'bank-energy-operating-costs',scope:'Node + actual extracted application close block; no browser/native device',passed:results.filter(r=>r.ok).length,total:results.length,results},null,2));if(results.some(r=>!r.ok))process.exitCode=1;
