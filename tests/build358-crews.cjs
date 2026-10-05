'use strict';
// Build 358, step 3 (operations): the conference salary raise only raised costs. Pay is now a decision per company:
// payroll scales with its level, and against the market wage (rising ~3% a year) it sets how many crews quit and how
// fast they are replaced. The staffed share of the fleet's crews is the share of trips that fly.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario');

const {s,state,command}=scenario(),R=s.GH_REALISM,HR=s.GH_HR_CORE,S=s.GH_SIMULATION_ASSET_CORE;
const days=(from,count)=>{for(let day=from;day<from+count;day++)R.updateCrews(state,day,['air']);return from+count;};

// 1. At market pay the fleet stays crewed (quits replaced within weeks).
let day=days(1,120);const market={...state.realism.crews.air};
assert.ok(market.staffing>.985,`market pay keeps crews: ${market.staffing}`);assert.ok(Math.abs(state.realism.economy.wageIndex-Math.pow(1.03,120/365))<1e-4,'wages rise ~3% a year');
assert.equal(R.updateCrews(state,day-1,['air']),undefined);assert.equal(state.realism.crewsDay,day-1,'one update per day');

// 2. Underpaying: payroll falls, quits rise, the shortage settles where hiring matches quits, and trips are cancelled.
assert.throws(()=>command('hr','set-salary-index',{company:'air',index:.8}),/salary-index-invalid/);
command('hr','set-salary-index',{company:'air',index:.9});assert.equal(HR.salaryMultiplier(state,'air'),.9,'payroll scales with the level');
day=days(day,365);const low={...state.realism.crews.air};
assert.ok(low.payRatio<.9&&low.annualQuitRate>.12,`underpaid: ${JSON.stringify(low)}`);
assert.ok(low.staffing<.985&&low.staffing>.95,`a lasting shortage: ${low.staffing}`);
const shortage=R.crewShortage(state,'air');assert.ok(Math.abs(shortage-(1-low.staffing))<1e-12);

// 3. The shortage reaches every trip: that share does not fly, earning and burning nothing.
const route={id:'R',distanceKm:1000,tripSeconds:7200},asset={id:'QA',type:'air',assetMode:'air',ownerCompanyId:'air',specs:{capacity:180,fuelBurnKgPerKm:3},staffing:{monthlyPayroll:0},tripSeconds:7200};
const ctxFor=crewShortage=>({economy:{jetFuel:.86,airDemand:100},companies:{air:{serviceLevel:85,automation:0,crewShortage}},research:{},sustainability:{},market:{},reputation:{},fuelHedges:{}});
const full=S.computeTripEconomics(asset,route,ctxFor(0)),short=S.computeTripEconomics(asset,route,ctxFor(shortage));
assert.ok(Math.abs(short.revenue/full.revenue-(1-shortage))<1e-12);assert.ok(Math.abs(short.fuelCost/full.fuelCost-(1-shortage))<1e-12);

// 4. Paying above the market brings the crews back.
command('hr','set-salary-index',{company:'air',index:1.2});day=days(day,150);
assert.ok(state.realism.crews.air.staffing>.99,`overpaid: ${state.realism.crews.air.staffing}`);assert.ok(state.realism.crews.air.annualQuitRate<.08);

// 5. The appointed manager: none costs 3% of revenue; a skilled one sells and runs better (+0.2% per point above 80).
assert.equal(HR.managerSkill(state,'air'),0);
command('hr','appoint-official-manager',{company:'air',candidateId:'M-AIR-01'});assert.equal(HR.managerSkill(state,'air'),96);
const managed=skill=>S.computeTripEconomics(asset,route,{...ctxFor(0),companies:{air:{serviceLevel:85,automation:0,managerSkill:skill}}}).revenue;
assert.ok(Math.abs(managed(96)/managed(0)-(1+16*.002)/.97)<1e-12,'a 96 manager against none');

assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
console.log('BUILD358_CREWS_PASS',JSON.stringify({market:market.staffing,underpaid:low,recovered:state.realism.crews.air.staffing}));
