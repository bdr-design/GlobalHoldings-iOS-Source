'use strict';
// Build 358, step 3 (operations): an asset's condition fell with every trip and nothing read it. Each fleet company
// now has a maintenance policy (preventive 90%, standard 80%, deferred 65%). The daily close checks every asset
// below its company's line, restores it to 100% through the fleet owner and bills the work (MNT-<company>-<day>,
// 7-day terms, maintenance line). The fleet's average condition after the checks is the company's wear on the next
// day's trips: more fuel and delay losses, in the slice engine and on the main thread alike.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario');

const {s,state,ctx,item,command}=scenario(),R=s.GH_REALISM,S=s.GH_SIMULATION_ASSET_CORE,FLEET=s.GH_FLEET_DATA;
state.globalBases.find(row=>row.id==='B1').deliveryCapacity=100;s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=1e12;
const out=s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',{type:'air',assetMode:'air',assetClass:'aircraft',tab:'new',item,base:state.globalBases.find(row=>row.id==='B1'),supplier:ctx.supplierFor(),mode:'cash',qty:10,manual:true,requestRef:'MAINT-QA',upfront:item.price*10,totalPrice:item.price*10,documentLeadDays:1,leadSeconds:0,immediateDelivery:true},{actor:'maintenance-qa',idempotencyKey:'MAINT-QA'});
assert.ok(out.ok);assert.equal(R.onSimulationTime(state,state.simSeconds),10);
const ids=[];FLEET.scan(state,['id'],row=>{ids.push(row.id);});
const setCondition=(list,value)=>{for(const id of list)FLEET.update(state,id,{condition:value});};
const conditions=()=>{const map={};FLEET.scan(state,['id','condition'],row=>{map[row.id]=row.condition;});return map;};
setCondition(ids.slice(0,4),70);setCondition(ids.slice(4),95);
const DAY=86400;let day=Math.floor(state.simSeconds/DAY)+1;
const close=()=>{state.simSeconds=day*DAY;R.onDay(state,day);return day++;};

// 1. Standard policy: the four assets under 80% are checked and billed; the fleet average after the checks is 97%.
assert.equal(R.maintenancePolicy(state,'air'),'standard');
const first=close(),after=conditions();
assert.deepEqual(ids.slice(0,4).map(id=>after[id]),[100,100,100,100]);assert.deepEqual(ids.slice(4).map(id=>after[id]),Array(6).fill(95));
const row=state.realism.maintenance.companies.air;assert.equal(row.checks,4);assert.equal(row.threshold,80);assert.ok(Math.abs(row.avgCondition-97)<1e-9);
const bill=state.finance.payables.find(doc=>doc.number===`MNT-AIR-${first}`);
assert.ok(bill&&bill.autoSettle===true&&bill.dueDay===first+7,'a maintenance invoice on 7-day terms');assert.equal(row.cost,Math.round(4*item.price*.004));

// 2. Wear reaches every trip: +0.6% fuel and -0.45% revenue at 97%, the same on both engines.
assert.ok(Math.abs(R.fleetWear(state,'air')-.03)<1e-12);
const route={id:'R',distanceKm:1000,tripSeconds:7200},asset={id:'QA',type:'air',assetMode:'air',ownerCompanyId:'air',specs:{capacity:180,fuelBurnKgPerKm:3},staffing:{monthlyPayroll:0},tripSeconds:7200};
const ctxFor=wear=>({economy:{jetFuel:.86,airDemand:100},companies:{air:{serviceLevel:85,automation:0,fleetWear:wear}},research:{},sustainability:{},market:{},reputation:{},fuelHedges:{}});
const fresh=S.computeTripEconomics(asset,route,ctxFor(0)),worn=S.computeTripEconomics(asset,route,ctxFor(R.fleetWear(state,'air')));
assert.ok(Math.abs(worn.fuelCost/fresh.fuelCost-1.006)<1e-12);assert.ok(Math.abs(worn.revenue/fresh.revenue-.9955)<1e-12);

// 3. The policy decides: deferred leaves 70% assets alone; preventive checks 85% ones.
assert.throws(()=>command('corporate','set-maintenance-policy',{companyId:'air',policy:'never'}),/maintenance-policy-invalid/);
command('corporate','set-maintenance-policy',{companyId:'air',policy:'deferred'});setCondition(ids.slice(0,2),70);
close();assert.equal(state.realism.maintenance.companies.air.checks,0);assert.equal(conditions()[ids[0]],70);
command('corporate','set-maintenance-policy',{companyId:'air',policy:'preventive'});setCondition(ids.slice(2,5),85);
close();assert.equal(state.realism.maintenance.companies.air.checks,5,'everything under 90% is checked (two at 70%, three at 85%)');assert.ok(Math.abs(state.realism.maintenance.companies.air.avgCondition-97.5)<1e-9);
assert.ok(Math.abs(R.fleetWear(state,'air')-.025)<1e-12);

// 4. Incidents: risk by mode raised by wear; the repair is billed in full and the cover pays above its deductible.
const drain=gen=>{let step;while(!(step=gen.next()).done){}};
const fleetOf=(risk,conditionSum,unsafe=0)=>({companies:new Map([['air',{count:10,conditionSum,value:10*item.price,risk,premium:10*item.price*.0035,sample:ids.map(id=>({id,price:item.price})),due:[],cost:0,restored:0,threshold:80,licence:10*25000,unsafe,fine:unsafe*40000}]])});
assert.equal(R.insuranceCover(state,'air'),'standard');
command('corporate','open-company',{type:'insurance',capital:200000000,legalName:'Test Group Insurer'});
state.advanced.insurance.fleetPolicies=[{id:'POLICY-INT-QA',day:0,company:'air',insurerCompanyId:'insurance',cover:'standard',assetCount:10,insuredValue:10*item.price,premium:0,status:'سارية',transferReference:'POLICY-PREMIUM-QA'}];
let incidentDay=0;for(let d=1000;d<1400;d++){state.simSeconds=d*DAY;drain(R.runIncidents(state,fleetOf(2,950),d));if(state.realism.incidents[0]?.day===d){incidentDay=d;break;}}
const incident=state.realism.incidents[0];assert.ok(incidentDay&&[2,3].includes(incident.count),`2.6 expected incidents a day: ${incident?.count}`);
assert.equal(incident.loss,Math.round(incident.count*item.price*.15));assert.equal(incident.deductible,Math.max(250000,incident.loss*.10));assert.equal(incident.covered,incident.loss-incident.deductible);
assert.ok(state.finance.payables.some(doc=>doc.number===`INC-AIR-${incidentDay}`),'the repair is billed in full');
const claim=state.advanced.insurance.claims.find(row=>row.id===incident.claimId);assert.ok(claim&&claim.status==='قيد الفحص'&&claim.covered===incident.covered);assert.equal(claim.insurerCompanyId,'insurance');assert.equal(claim.policyReference,'POLICY-INT-QA','the claim stays bound to its internal fleet policy');
assert.ok(incident.assets.every(id=>conditions()[id]===55),'the damaged assets are left at 55%');
const cashBefore=s.GH_FINANCE_CORE.operating(state,'air'),insurerCashBefore=s.GH_FINANCE_CORE.operating(state,'insurance');state.simSeconds=(incidentDay+3)*DAY;R.onDay(state,incidentDay+3);
const paidClaim=state.advanced.insurance.claims.find(row=>row.id===incident.claimId),claimTransfer=state.finance.transfers.find(row=>row.reference===paidClaim.transferReference);
assert.equal(paidClaim.status,'مدفوعة','the insurer pays after its review');assert.equal(paidClaim.provider,'شركة التأمين التابعة');assert.ok(paidClaim.transferReference);assert.equal(claimTransfer?.kind,'intercompany-service');assert.equal(claimTransfer.fromCompany,'insurance');assert.equal(claimTransfer.toCompany,'air');assert.equal(claimTransfer.amount,incident.covered);assert.equal(s.GH_FINANCE_CORE.operating(state,'insurance'),insurerCashBefore-incident.covered);assert.equal(s.GH_FINANCE_CORE.operating(state,'air'),cashBefore+incident.covered);
command('corporate','set-insurance-cover',{companyId:'air',cover:'none'});state.simSeconds=2000*DAY;drain(R.runIncidents(state,fleetOf(3,1000),2000));
const bare=state.realism.incidents[0];assert.equal(bare.day,2000);assert.equal(bare.covered,0);assert.equal(bare.claimId,null,'without cover the company bears it all');
assert.throws(()=>command('corporate','set-insurance-cover',{companyId:'air',cover:'gold'}),/insurance-cover-invalid/);
command('corporate','set-insurance-cover',{companyId:'air',cover:'full'});state.simSeconds=2010*DAY;drain(R.runIncidents(state,fleetOf(0,1000),2010));
const renewedPolicy=state.advanced.insurance.fleetPolicies.find(row=>row.id==='FLEET-POLICY-AIR-2010');assert.ok(renewedPolicy&&renewedPolicy.insurerCompanyId==='insurance'&&renewedPolicy.transferReference,'the premium renews by documented intercompany transfer every 30 days');

// 5. The regulator: a yearly licence per asset, and a monthly inspection fine when the fleet averages under 75%.
state.simSeconds=2190*DAY;drain(R.runIncidents(state,fleetOf(0,1000),2190));
assert.equal(state.finance.payables.find(doc=>doc.number==='LIC-AIR-2190')?.amount,250000,'licences renew every 365 days');
state.simSeconds=2205*DAY;drain(R.runIncidents(state,fleetOf(0,800,3),2205));assert.equal(state.realism.inspections?.length||0,0,'no fine at an 80% average');
state.simSeconds=2235*DAY;drain(R.runIncidents(state,fleetOf(0,700,3),2235));
assert.deepEqual(JSON.parse(JSON.stringify(state.realism.inspections[0])),{day:2235,company:'air',unsafe:3,fine:120000,avgCondition:70});
assert.ok(state.finance.payables.some(doc=>doc.number==='FINE-AIR-2235'));

assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
console.log('BUILD358_MAINTENANCE_PASS',JSON.stringify({firstChecks:row.checks,cost:row.cost,avgCondition:row.avgCondition}));
