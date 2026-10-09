'use strict';
// News and conference must use the same frozen customer-rating source and must explain low-sample confidence.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');
const env=scenario(),{s,state,command}=env;
env.load('business-world-core');env.load('arabic-copy-core');env.load('conference-model');env.load('conference-core');
const readOnlyState=structuredClone(state);delete readOnlyState.businessWorld;s.GH_BUSINESS_WORLD.customerRatings(readOnlyState);s.GH_BUSINESS_WORLD.snapshot(readOnlyState);assert.equal(Object.prototype.hasOwnProperty.call(readOnlyState,'businessWorld'),false,'news and rating reads must not create persistent state');
state.simSeconds=365*86400;state.profile.reputation=78;
state.advanced.companies.air=state.advanced.companies.air||{};state.advanced.companies.air.serviceLevel=91;
for(const name of ['عميل ألفا','عميل بيتا']){
 const party=s.GH_BUSINESS_WORLD.upsertParty(state,{name,role:'customer',industry:'سفر وشحن'});
 s.GH_BUSINESS_WORLD.touchRelationship(state,{partyId:party.id,company:'air',role:'customer',reference:`REL-${name}`});
 command('finance','credit',{company:'air',amount:11500,note:`خدمة مكتملة — ${name}`,counterparty:name,reference:`RATING-${party.id}`,termsDays:7});
}
s.GH_BUSINESS_WORLD.recordEvent(state,{kind:'service',company:'air',title:'تحسن الالتزام بمواعيد الخدمة',reference:'RATING-EVENT-1',severity:'positive'});
const live=s.GH_BUSINESS_WORLD.companyCustomerRating(state,'air');
assert.equal(live.customers,2,'the source records two explicit customer relationships');assert.equal(live.contracts,0);
const snapshot=s.GH_CONFERENCE.buildSnapshot(state,2026),air=snapshot.companies.find(row=>row.type==='air');
assert(air);assert.equal(air.customerRating.customers,2);assert.equal(air.customerRating.contracts,0,'the frozen conference row retains factual relationship and contract counts');
const voice=air.conferenceContributions.find(row=>row.id==='customer-voice');
assert(voice);assert.equal(voice.headline,'قاعدة العملاء والعقود');assert(voice.metrics.some(row=>row.id==='customers'&&row.value==='2'),'the conference presents the actual relationship count');assert(voice.metrics.some(row=>row.id==='contracts'&&row.value==='0'),'the conference preserves the actual contract count');assert(!voice.metrics.some(row=>['rating','responses'].includes(row.id)),'a modeled score and derived response estimate are not survey evidence');assert.match(voice.caption,/لا تمثل نتائج استبيان/);
assert.equal(snapshot.validation.ok,true);
const plan=s.GH_CONF_MODEL.buildScenePlan(snapshot,{mode:'full'}),scene=plan.find(row=>row.id==='air-customer-voice');
assert(scene);assert.equal(scene.templateId,'customer-scorecard');assert(scene.metrics.some(row=>row.id==='customers'&&row.value==='2'));assert(scene.metrics.some(row=>row.id==='contracts'&&row.value==='0'));assert(!scene.metrics.some(row=>['rating','responses'].includes(row.id)));assert.match(scene.caption,/لا تمثل نتائج استبيان/);
const monthly=s.GH_CONFERENCE.render({state,esc:value=>String(value??''),fmtNumber:value=>Number(value||0).toLocaleString('en-US'),fmtMoney:value=>`$${Number(value||0).toLocaleString('en-US')}`},'monthly');
assert(monthly.includes('قاعدة العملاء المسجلة عبر الشركات'));assert(monthly.includes('العملاء المسجلون 2 · العقود المسجلة 0'),'monthly company rows preserve relationship counts');assert(!/تقييم العملاء|\d\.\d \/ 5|استجابة مسجلة|عينة أولية/.test(monthly),'monthly executive report does not present modeled score/responses as a survey');
const frozen=structuredClone(snapshot);state.advanced.companies.air.serviceLevel=35;s.GH_BUSINESS_WORLD.recordEvent(state,{kind:'service',company:'air',title:'شكوى لاحقة',reference:'RATING-EVENT-2',severity:'critical'});
assert.equal(JSON.stringify(snapshot),JSON.stringify(frozen),'conference snapshot cannot change after live customer data changes');
console.log('BUILD360_CUSTOMER_RATINGS_CONFERENCE_PASS',JSON.stringify({customers:live.customers,contracts:live.contracts,scene:scene.id,monthlyCustomerCount:2}));
