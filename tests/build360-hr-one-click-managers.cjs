'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');
const {s,state,command}=scenario(),H=s.GH_HR_CORE;

const targetIds=s.GH_AUTHORIZATION.commandCompanyIds(state,{domain:'hr',name:'appoint-all-official-managers',payload:{termMonths:12}});
assert.deepEqual(JSON.parse(JSON.stringify(targetIds)),['group','air'],'the authorization envelope resolves the group and every operational company for the one-click command');

const first=command('hr','appoint-all-official-managers',{termMonths:12,source:'QA one click managers'});
assert.equal(first.appointed,1);assert.deepEqual(JSON.parse(JSON.stringify(first.companies)),['air']);
const manager=H.officialManager(state,'air');assert.ok(manager);const managerContract=state.advanced.labor.employmentContracts.find(row=>row.id===manager.contractId);assert.equal(managerContract.autoRenew,true);
const best=H.officialManagerCandidates(state,'air').slice().sort((a,b)=>b.skill-a.skill||b.experience-a.experience||a.salary-b.salary||String(a.id).localeCompare(String(b.id)))[0];assert.equal(manager.candidateId,best.id,'one click selects the strongest available candidate');
const again=command('hr','appoint-all-official-managers');assert.equal(again.appointed,0);assert.equal(again.skipped,1);assert.equal(H.officialManager(state,'air').id,manager.id,'repeat does not replace an appointed manager');

const hired=command('hr','hire',{company:'air',source:'QA facility staffing'});assert.ok(hired.total>0);const facilityContract=state.advanced.labor.employmentContracts.find(row=>row.role==='تشغيل منشأة'&&row.status==='ساري');assert.ok(facilityContract);assert.equal(facilityContract.autoRenew,true);
const expiry=Math.max(managerContract.startDay+managerContract.termMonths*30,facilityContract.startDay+facilityContract.termMonths*30);const renewed=command('hr','tick-day',{day:expiry+1});assert.ok(renewed.renewed>=2);assert.equal(managerContract.status,'ساري');assert.equal(facilityContract.status,'ساري');assert.equal(H.officialManager(state,'air').id,manager.id);assert.ok(managerContract.renewalCount>=1&&facilityContract.renewalCount>=1);
assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
console.log(JSON.stringify({suite:'build360-hr-one-click-managers',appointed:first.appointed,renewed:renewed.renewed,manager:manager.name}));
console.log('BUILD360_HR_ONE_CLICK_MANAGERS_PASS');
