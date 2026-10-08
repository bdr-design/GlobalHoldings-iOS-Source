'use strict';
// Regression for the physical-iPhone Build 358 stop: Energy Core paid a project loan every day without naming its
// Finance debt id. Finance then amended the oldest protected debt contract on every payment until proof depth 64.
// The financing contract must stay immutable; current principal belongs to the operational balance register and each
// payment is its own protected settlement.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const h=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','procurement-core','facility-core','energy-core','economics-core','game-lifecycle-core']);
const {s}=h,d={...minimal(),profile:{name:'Debt Recovery'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
const state=s.GH_GAME_LIFECYCLE.pristine(d,1);
s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Debt Recovery Group',founder:'Founder',locationId:'RUH'},d,{nextId:()=> 'FOUND-DEBT-RECOVERY',simYear:()=>2026});
s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'power',capital:500000000,legalName:'Debt Recovery Power'});
const F=s.GH_FINANCE_CORE,P=s.GH_DOCUMENT_PROOF;

// Recreate a legacy debt document already at the maximum supported amendment depth.
const raised=F.execute({state},'raise-debt',{company:'power',amount:1000000,liabilityAccount:'تمويل مشاريع طاقة',lender:'اتحاد بنوك تمويل المشاريع',ref:'PF-LEGACY-DEPTH-64'}),contract=state.finance.debtRecords.find(row=>row.id===raised.ref);
for(let i=1;i<=64;i++)P.amendDocument(state,contract,{transition:'debt-balance-adjusted',mutate:row=>{row.outstanding=1000000-i;}});
assert.equal(P.record(state,contract.documentProofId).chainDepth,64);
const immutableContract=JSON.stringify(contract),immutableProofId=contract.documentProofId;

// Simulate loading an old save: migration derives the first operational balance without amending the contract.
delete state.finance.debtBalancesById;delete state.finance.debtBalanceMigrationVersion;F.ensure(state);
for(let day=1;day<=70;day++){
  state.simSeconds=day*86400;
  const paid=F.execute({state},'repay-debt',{company:'power',debtId:contract.id,amount:1000,liabilityAccount:'تمويل مشاريع طاقة',lender:contract.lender,ref:`PF-PAY-LEGACY-${day}`});
  assert.equal(paid.amount,1000);assert.equal(paid.settlement.allocations.length,1);assert.equal(paid.settlement.allocations[0].debtId,contract.id);
}
assert.equal(contract.documentProofId,immutableProofId);assert.equal(JSON.stringify(contract),immutableContract,'repayments never rewrite the signed financing contract');
assert.equal(P.record(state,contract.documentProofId).chainDepth,64,'repayment does not extend an exhausted proof chain');
assert.equal(F.debtOutstanding(state,contract),999936-70000);
assert.equal(F.debtView(state,contract).status,'مسدد جزئيًا');
assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);

// Energy must name the matching project debt even when an older Power debt is open.
state.customHubs.push({id:'PWR-SOLAR-DEBT',name:'Solar Debt',city:'الرياض',country:'السعودية',kind:'power',company:'power',ownerCompanyId:'power',owned:true,energyKind:'solar',capacityAmount:10,capacity:'10 MW',commissioned:true,openedAt:state.simSeconds,dailyCost:1000,cost:10000000});
const E=s.GH_ENERGY_CORE,energy=E.ensure(state),site=energy.sites.find(row=>row.facilityId==='PWR-SOLAR-DEBT');site.commissionedDay=70;
const project=s.GH_DOMAIN_COMMANDS.dispatch({state},'energy','finance-project',{siteId:site.id,amount:1000000}).result,otherBefore=F.debtOutstanding(state,contract),projectBefore=F.debtOutstanding(state,state.finance.debtRecords.find(row=>row.id===project.id));
state.simSeconds=72*86400;s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'energy','tick-day',{day:72,ownerCompanyId:'power'},{actor:'simulation-scheduler'});
const projectRecord=state.finance.debtRecords.find(row=>row.id===project.id),lastProjectSettlement=state.finance.debtSettlements.find(row=>row.reference===`PF-PAY-${project.id}-72`);
assert(lastProjectSettlement);assert.equal(lastProjectSettlement.debtId,project.id);assert.equal(lastProjectSettlement.allocations.length,1);assert.equal(lastProjectSettlement.allocations[0].debtId,project.id);
assert.equal(F.debtOutstanding(state,contract),otherBefore,'an older Power debt is untouched');assert(F.debtOutstanding(state,projectRecord)<projectBefore,'the matching project balance is reduced');
const immutableProjectContract=JSON.stringify(projectRecord),projectProofId=projectRecord.documentProofId;
for(let day=73;day<=142;day++){state.simSeconds=day*86400;s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'energy','tick-day',{day,ownerCompanyId:'power'},{actor:'simulation-scheduler'});}
assert.equal(JSON.stringify(projectRecord),immutableProjectContract,'seventy additional Energy days keep the financing contract immutable');assert.equal(P.record(state,projectProofId).chainDepth,0);assert.equal(state.finance.debtSettlements.filter(row=>row.debtId===project.id).length,71);

// A legacy save may already contain the old oldest-debt allocation. Migration restores the facility's exact balance
// without changing the company's book total, assigning the inverse correction to the other Power debts.
const companyDebt=F.book(state,'power').debt,facility=energy.projectFinance.find(row=>row.id===project.id),shift=50000;
state.finance.debtBalancesById[contract.id].outstanding-=shift;state.finance.debtBalancesById[project.id].outstanding+=shift;energy.debtBalanceMigrationVersion=0;E.ensure(state);
assert.ok(Math.abs(F.debtOutstanding(state,projectRecord)-facility.outstanding)<.01);assert.ok(Math.abs(state.finance.debtRecords.filter(row=>row.company==='power').reduce((sum,row)=>sum+F.debtOutstanding(state,row),0)-companyDebt)<.01);assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);

console.log('BUILD360_ENERGY_DEBT_PROOF_RECOVERY_PASS',JSON.stringify({legacyDepth:64,directRepayments:70,energyRepayments:71,legacyOutstanding:Math.round(F.debtOutstanding(state,contract)*100)/100,projectDebtId:project.id}));
