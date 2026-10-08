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
assert.equal(live.responses,40);assert.equal(live.provisional,false);assert.equal(live.confidence,'متوسطة');assert(live.rating>=1&&live.rating<=5);
const snapshot=s.GH_CONFERENCE.buildSnapshot(state,2026),air=snapshot.companies.find(row=>row.type==='air');
assert(air);assert.equal(JSON.stringify(air.customerRating),JSON.stringify(live));assert.equal(snapshot.group.customerRating.rating,s.GH_BUSINESS_WORLD.customerRatings(state).group.rating);
const voice=air.conferenceContributions.find(row=>row.id==='customer-voice');
assert(voice);assert.match(voice.headline,/\/ 5/);assert(voice.metrics.some(row=>row.id==='responses'&&row.value==='40'));
assert.equal(snapshot.validation.ok,true);
const plan=s.GH_CONF_MODEL.buildScenePlan(snapshot,{mode:'full'}),scene=plan.find(row=>row.id==='air-customer-voice');
assert(scene);assert.equal(scene.templateId,'customer-scorecard');
const frozen=structuredClone(snapshot);state.advanced.companies.air.serviceLevel=35;s.GH_BUSINESS_WORLD.recordEvent(state,{kind:'service',company:'air',title:'شكوى لاحقة',reference:'RATING-EVENT-2',severity:'critical'});
assert.equal(JSON.stringify(snapshot),JSON.stringify(frozen),'conference snapshot cannot change after live customer data changes');
console.log('BUILD360_CUSTOMER_RATINGS_CONFERENCE_PASS',JSON.stringify({rating:live.rating,responses:live.responses,scene:scene.id}));
