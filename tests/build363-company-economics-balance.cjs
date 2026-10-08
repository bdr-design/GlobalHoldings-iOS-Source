'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','finance-core','facility-core','hr-core','banking-core','energy-core','realestate-core','save-schema']);

function baseState(){
  const openedCompanies=['bank','power','mobility','realestate'],companyRegistry=Object.fromEntries(openedCompanies.map(id=>{const definition=s.GH_COMPANY_DEFINITIONS.get(id);return [id,{id,definitionId:definition.definitionId,definitionVersion:definition.definitionVersion,status:'active'}];}));
  const state={...minimal(),profile:{name:'Build 363 balance'},companyRegistry,openedCompanies,branches:[],bank:{},energy:{},mobility:{vehicles:[],drivers:[]},realEstate:{},advanced:{facilities:{},labor:{employmentContracts:[]},economy:{baseRate:.046,electricityPriceMWh:90,gasCostMWh:39}}};
  const F=s.GH_FINANCE_CORE;F.ensure(state);for(const company of state.openedCompanies)F.book(state,company).accounts[0].balance=250000000;F.reconcile(state);return {state,F};
}

// Old saves are repriced once, while deliberate custom tariffs survive the migration.
{
  const {state}=baseState();state.customHubs.push(
    {id:'POWER',kind:'power',ownerCompanyId:'power',owned:true,dailyCost:38000,plannedDailyCost:38000},
    {id:'BANK',kind:'bank',ownerCompanyId:'bank',owned:true,dailyCost:18500},
    {id:'MOB',kind:'mobility-center',ownerCompanyId:'mobility',owned:true,dailyCost:9800},
    {id:'RE',kind:'realestate',ownerCompanyId:'realestate',owned:true,dailyCost:8000},
    {id:'CUSTOM',kind:'bank',ownerCompanyId:'bank',owned:true,dailyCost:7777}
  );
  assert.equal(s.GH_FACILITY_CORE.migrateOperatingCosts(state),5);
  assert.deepEqual(state.customHubs.map(row=>row.dailyCost),[12000,5500,2200,1800,7777]);
  assert.equal(state.customHubs[0].plannedDailyCost,12000);assert.equal(s.GH_FACILITY_CORE.migrateOperatingCosts(state),0);
}

// Mobility staffing follows occupied vehicles, not the 3,000-car ceiling, and legacy excess contracts are closed safely.
{
  const {state}=baseState(),facility={id:'MOB-RUH',name:'مركز التنقل · الرياض',kind:'mobility-center',ownerCompanyId:'mobility',owned:true,capitalId:'RUH',bays:3000,dailyCost:2200};state.customHubs.push(facility);
  state.mobility.vehicles=Array.from({length:80},(_,index)=>({id:`V-${index}`,centerId:'RUH'}));state.advanced.facilities[facility.id]={staff:168};state.advanced.labor.employmentContracts=[{id:'EMP-OLD',company:'mobility',ownerCompanyId:'mobility',name:'168 × فريق المركز',role:'تشغيل منشأة',count:168,center:facility.name,salary:5200,status:'ساري'}];
  assert.equal(s.GH_HR_CORE.facilityNeed(facility,state),22);const migrated=s.GH_HR_CORE.migrateFacilityStaffing(state);assert.equal(migrated.reduced,146);assert.equal(state.advanced.facilities[facility.id].staff,22);assert.equal(state.advanced.labor.employmentContracts[0].count,22);assert.equal(s.GH_HR_CORE.migrateFacilityStaffing(state).changed,0);
}

// A prudently capitalised one-branch bank earns a conservative overnight return and is no longer structurally negative.
{
  const {state,F}=baseState();state.customHubs.push({id:'BANK-RUH',kind:'bank',ownerCompanyId:'bank',owned:true,dailyCost:5500});
  const bank=s.GH_BANKING_CORE.ensure(state);bank.branchNetwork.push({id:'BR-RUH',facilityId:'BANK-RUH',servicesActive:true,city:'الرياض',country:'السعودية',lastProcessedDay:0});s.GH_BANKING_CORE.ensure(state);state.simSeconds=86400;
  const report=s.GH_BANKING_CORE.execute({state},'tick-day',{day:1});assert(report.reserveIncome>10000);assert.equal(report.serviceOpex,4300);assert.equal(report.facilityOpex,5500);assert(report.netBankingIncome>0,`normal bank day should be viable: ${report.netBankingIncome}`);assert.equal(F.operating(state,'bank')>=250000000,true,'daily engine has not directly spent reported opex');
}

// Normal commissioned energy and occupied rental property cover their own operating charges; construction can still lose.
{
  const {state}=baseState();state.customHubs.push({id:'SOLAR',kind:'power',ownerCompanyId:'power',owned:true,dailyCost:12000,energyKind:'solar',capacityAmount:100,capacity:'100 MW',commissioned:true,cost:82000000,city:'الرياض',country:'السعودية'});s.GH_ENERGY_CORE.ensure(state);state.simSeconds=86400;
  const energy=s.GH_ENERGY_CORE.execute({state},'tick-day',{day:1});assert(energy.ebitda>30000,`solar operating day should cover fixed and variable cost: ${energy.ebitda}`);
}
{
  const {state}=baseState();state.customHubs.push({id:'RE-RUH',kind:'realestate',ownerCompanyId:'realestate',owned:true,dailyCost:1800,city:'الرياض',country:'السعودية'});const re=s.GH_REALESTATE_CORE.ensure(state),office=re.offices[0];
  re.projects.push({id:'LEASED',officeId:office.id,city:'الرياض',country:'السعودية',type:'residential',name:'برج مؤجر',mode:'lease',units:200,unitCost:212400,landCost:6480000,buildCost:36000000,priceLevel:1,startDay:0,completeDay:0,status:'مكتمل',milestonesPaid:3,sold:0,presold:0,leased:200,handedOver:0,salesRevenue:0,rentRevenue:0,leases:[]});state.simSeconds=86400;
  const property=s.GH_REALESTATE_CORE.execute({state},'tick-day',{day:1});assert(property.net-1800>0,`occupied property should cover office opex: ${property.net-1800}`);
}

console.log(JSON.stringify({suite:'build363-company-economics-balance',passed:5,total:5,scope:'facility migration + HR occupancy + bank liquidity + energy and real-estate break-even'}));
