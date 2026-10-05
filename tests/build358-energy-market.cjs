'use strict';
// Build 358, step 2 (markets): the energy company no longer types its own prices. A gas contract is offered for 1, 2
// or 3 years at the expected average gas price plus the supplier margin, for the fuel the plant burns; project
// finance is priced at the market base rate, the group's rating spread and a project premium, up to 75% of the
// plant's cost; the grid connection is the plant's own (the typed limit, loss and operator are gone). An overhaul's
// length and cost follow the plant type, and it now does something: it recovers part of the wear since the last one
// and resets the growth of forced outages.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const h=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','procurement-core','facility-core','energy-core','economics-core','game-lifecycle-core']);
const {s}=h,d={...minimal(),profile:{name:'Energy Market'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
const state=s.GH_GAME_LIFECYCLE.pristine(d,1);
s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Energy Group',founder:'Founder',locationId:'RUH'},d,{nextId:()=> 'FOUND-EM',simYear:()=>2026});
const E=s.GH_ENERGY_CORE,F=s.GH_FINANCE_CORE,R=s.GH_REALISM,run=(name,p)=>s.GH_DOMAIN_COMMANDS.dispatch({state},'energy',name,p).result;
s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'power',capital:400000000,legalName:'Energy Market Power'});
state.customHubs.push({id:'PWR-GAS-M',name:'Gas Market',city:'الرياض',country:'السعودية',kind:'power',company:'power',ownerCompanyId:'power',owned:true,energyKind:'gas',capacityAmount:100,capacity:'100 MW',commissioned:true,openedAt:0,dailyCost:38000,cost:200000000});
state.simSeconds=100*86400;R.migrate(state).economy.gas=50;R.migrate(state).economy.baseRate=.05;state.profile.creditRating='BBB';
const energy=E.ensure(state),site=energy.sites.find(row=>row.facilityId==='PWR-GAS-M');site.commissionedDay=0;

// 1. Gas: offered at the forward for the term, for the fuel the plant burns; typed prices are ignored.
const offer=E.fuelOffer(state,site,730);
assert.equal(offer.priceMWh,Math.round(R.gasForward(state,730)*(1+.02+.01)*100)/100);
assert.ok(offer.priceMWh<50*1.03&&offer.priceMWh>39,'above the mean, a two-year contract is priced between spot and the mean');
assert.equal(offer.volumeMWh,Math.round(100*24*730*.56/1000)*1000);
const contract=run('sign-fuel-contract',{siteId:site.id,termDays:730,priceMWh:1,volumeMWh:1});
assert.equal(contract.priceMWh,offer.priceMWh);assert.equal(contract.volumeMWh,offer.volumeMWh);assert.equal(contract.takeOrPay,.75);assert.equal(contract.endDay,100+730);
assert.throws(()=>run('sign-fuel-contract',{siteId:site.id,termDays:400}),/energy-fuel-term-invalid/);

// 2. The grid connection is the plant's own.
assert.throws(()=>run('set-grid-connection',{siteId:site.id,exportLimitMW:1}),/Unknown energy command/);
site.gridExportLimitMW=1;site.gridLossRate=.2;state.energy.gridAgreements=[{id:'GRID-OLD'}];E.ensure(state);
assert.equal(site.gridExportLimitMW,100);assert.equal(site.gridLossRate,.02);assert.equal(state.energy.gridAgreements,undefined,'an old save loses the typed limits');

// 3. Project finance: market rate + rating spread + 1.5% premium, up to 75% of cost, tenor by plant type.
assert.equal(E.projectFinanceRate(state),Math.round((.05+.017+.015)*1e5)/1e5);
assert.throws(()=>run('finance-project',{siteId:site.id,amount:150000001}),/energy-project-finance-above-leverage/);
const loan=run('finance-project',{siteId:site.id,amount:100000000,rate:.001,termDays:99999});
assert.equal(loan.rate,E.projectFinanceRate(state),'the typed rate is ignored');assert.equal(loan.termDays,10*365);
assert.equal(E.projectFinanceRoom(state.energy,site),50000000);

// 4. Overhaul: length and cost by type; on completion it recovers 70% of a gas plant's wear and resets outage growth.
const quote=E.maintenanceQuote(site);assert.deepEqual([quote.days,quote.cost,quote.availabilityDuring,quote.recovery],[12,1500000,0,.7]);
assert.ok(Math.abs(E.outageAging(site,100)-(1+100/365))<1e-12,'outages grow with the time since commissioning');
const before=E.siteEconomics(state).find(row=>row.id===site.id);
const plan=run('schedule-maintenance',{siteId:site.id,startDay:100,durationDays:1,cost:1});
assert.equal(plan.cost,1500000);assert.equal(plan.durationDays,12);assert.ok(plan.chequeId,'paid by cheque');
const tick=day=>{state.simSeconds=day*86400;s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'energy','tick-day',{day,ownerCompanyId:'power'},{actor:'simulation-scheduler'});};
tick(100);assert.equal(state.energy.maintenancePlans[0].status,'قيد التنفيذ');
tick(112);assert.equal(state.energy.maintenancePlans[0].status,'مكتملة');
const done=state.energy.sites.find(row=>row.id===site.id);
assert.ok(Math.abs(done.recoveredWearDays-112*.7)<1e-9,`recovered ${done.recoveredWearDays}`);assert.equal(done.lastMaintenanceDay,112);
assert.equal(E.outageAging(done,112),1,'outage growth starts again');
state.simSeconds=113*86400;const after=E.siteEconomics(state).find(row=>row.id===site.id);
assert.ok(after.availability>before.availability,`availability ${before.availability} -> ${after.availability}`);

assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
console.log('BUILD358_ENERGY_MARKET_PASS',JSON.stringify({gas2y:offer.priceMWh,volume:offer.volumeMWh,projectRate:loan.rate,overhaul:quote.cost,availability:[before.availability,after.availability]}));
