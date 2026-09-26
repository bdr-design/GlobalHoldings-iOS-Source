'use strict';

const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

function hospitalityDefinition(id,definitionId,prefix,order){
  return {
    schema:'gh-company-definition/v1',id,definitionId,definitionVersion:1,order,kind:'subsidiary',lifecycle:'active',
    identity:{legalDefault:{ar:`شركة ${id}`,en:`${id} Company`},trade:{ar:id==='gh-hotels'?'جي إتش للفنادق':'جي إتش للمنتجعات',en:id.toUpperCase()},short:id.toUpperCase(),legacyLegalNames:[],marks:{default:'assets/identity/group-default.svg',symbol:'assets/identity/group-default.svg',horizontal:'assets/identity/group-default.svg',seal:'assets/identity/group-default.svg',mono:'assets/identity/group-default.svg'},palette:{accent:'#2d72df',secondary:'#0d3b57',route:'#2d72df',onAccent:'#ffffff'},hero:'assets/images/company-hq-v2.webp'},
    classification:{primarySectorId:'hospitality',sectorIds:['hospitality'],operationProfileId:'hospitality-operations-v1',assetClasses:[],routeModes:[]},
    capabilities:['company.core','finance.book','finance.budget','finance.tax','hr.management','documents.identity','documents.signature','map.company','conference.participant'],
    founding:{defaultCapital:10000000,minimumCapital:10000000,legalForm:'شركة تابعة مملوكة للمجموعة',checklistIds:['commercial-registration']},
    finance:{accountPrefix:prefix,documentPrefix:prefix,collectionProfileId:'hospitality-revenue-v1',currency:'USD',vatEnabled:true,internalBankEligible:true},
    hr:{managerRoleProfileId:'ceo-hospitality-v1',staffingProfileId:'hospitality-site-v1'},
    facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['hotel'],primaryKind:'hotel',siteTemplate:{label:'فندق',facilityKind:'hotel',cost:6000000,dailyCost:9500,capacity:'220 غرفة',deliveryCapacity:0,photo:'assets/images/company-hq-v2.webp',iconKey:'hq',groupValueFactor:.72}},
    ui:{shell:'generic-company-v1',tabs:['overview','management','operations','people','finance'],extensions:[]},
    map:{layerProviderIds:['company-facilities'],filterGroup:'services',markerProfileId:'hotel'},conference:{providerId:'generic-company-v1',order},
    adapters:{lifecycle:'generic-company-v1',operations:'standard-company-operations-v1',finance:'standard-company-finance-v1',hr:'standard-company-hr-v1',facilities:'standard-company-facilities-v1',map:'company-map-v1',conference:'generic-company-v1',documents:'legal-documents-v1'},
    legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
  };
}

const {s,storage}=harness(['capability-registry-core','company-definitions','company-platform-core','company-adapters-core','save-schema','migration-core','hr-core']);
const P=s.GH_COMPANY_PLATFORM,H=s.GH_HR_CORE,S=s.GH_SAVE_SCHEMA,M=s.GH_MIGRATION_CORE;
P.installDefinition(hospitalityDefinition('gh-hotels','gh-hotels-v1','HTL',70),{source:'future-hr-fixture'});
P.installDefinition(hospitalityDefinition('gh-resorts','gh-resorts-v1','RST',71),{source:'future-hr-fixture'});

const migrated=P.migrateState({...minimal(),onboardingComplete:true,profile:{name:'مجموعة الاختبار',founder:'المؤسس'},companyRegistry:{group:{definitionId:'gh-holding-v1'},'gh-hotels':{definitionId:'gh-hotels-v1'},'gh-resorts':{definitionId:'gh-resorts-v1'}},companyModules:{},openedCompanies:['gh-hotels','gh-resorts'],unlockedSectors:['hospitality']});
assert.equal(migrated.errors.length,0,migrated.errors.join(','));
const state=migrated.state;

const first=H.officialManagerCandidates(state,'gh-hotels'),second=H.officialManagerCandidates(state,'gh-hotels'),resortCandidates=H.officialManagerCandidates(state,'gh-resorts');
assert.equal(first.length,2);assert.deepEqual(second,first);assert.equal(new Set(first.map(row=>row.name)).size,2);
assert(first.every(row=>row.company==='gh-hotels'&&row.ownerCompanyId==='gh-hotels'&&row.definitionId==='gh-hotels-v1'&&row.managerRoleProfileId==='ceo-hospitality-v1'));
assert(first.every(row=>row.candidateSource==='definition-manager-profile'&&row.specialty.includes('الضيافة')));
assert(resortCandidates.every(row=>row.ownerCompanyId==='gh-resorts'));assert.notDeepEqual(resortCandidates.map(row=>row.id),first.map(row=>row.id));
console.log('PASS managerRoleProfileId creates stable realistic fallback candidates with isolated instance ownership');

const hired=H.appointOfficialManager(state,{company:'gh-hotels',candidateId:first[0].id,source:'future-company-hr-test'});
assert.equal(hired.appointment.ownerCompanyId,'gh-hotels');assert.equal(hired.appointment.definitionId,'gh-hotels-v1');assert.equal(hired.appointment.managerRoleProfileId,'ceo-hospitality-v1');assert.equal(hired.contract.ownerCompanyId,'gh-hotels');
assert.equal(S.validate(state).ok,true,S.validate(state).errors.join(','));

const key='GH_BUILD334_FUTURE_HR';storage.setItem(key,JSON.stringify(state));
const loaded=M.load({defaultState:minimal(),storageKey:key,legacyStorageKeys:[],saveSchema:S}).state,manager=H.officialManager(loaded,'gh-hotels');
assert.equal(manager.id,hired.appointment.id);assert.equal(manager.candidateId,first[0].id);assert.equal(manager.ownerCompanyId,'gh-hotels');assert.equal(manager.managerRoleProfileId,'ceo-hospitality-v1');
assert.equal(loaded.advanced.labor.employmentContracts.find(row=>row.id===manager.contractId)?.ownerCompanyId,'gh-hotels');
assert.deepEqual(H.officialManagerCandidates(loaded,'gh-hotels').map(row=>row.id),first.map(row=>row.id));
assert.equal(S.validate(loaded).ok,true,S.validate(loaded).errors.join(','));
console.log('PASS gh-hotels CEO appointment and contract survive Schema 2.0.0 save reload without identity drift');
