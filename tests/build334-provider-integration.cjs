'use strict';

const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

function hotelDefinition(adapterId){return {
  schema:'gh-company-definition/v1',id:'gh-hotels',definitionId:'gh-hotels-v1',definitionVersion:1,order:70,kind:'subsidiary',lifecycle:'active',
  identity:{legalDefault:{ar:'شركة فنادق جي إتش',en:'GH Hotels Company'},trade:{ar:'جي إتش للفنادق',en:'GH HOTELS'},short:'GH HOTELS',legacyLegalNames:[],marks:{default:'assets/identity/group-default.svg',symbol:'assets/identity/group-default.svg',horizontal:'assets/identity/group-default.svg',seal:'assets/identity/group-default.svg',mono:'assets/identity/group-default.svg'},palette:{accent:'#2d72df',secondary:'#0d3b57',route:'#2d72df',onAccent:'#ffffff'},hero:'assets/images/company-hq-v2.webp'},
  classification:{primarySectorId:'hospitality',sectorIds:['hospitality'],operationProfileId:'hospitality-operations-v1',assetClasses:[],routeModes:[]},
  capabilities:['company.core','finance.book','finance.budget','finance.tax','hr.management','documents.identity','documents.signature','map.company','conference.participant','hospitality.operations'],
  founding:{defaultCapital:10000000,minimumCapital:10000000,legalForm:'شركة تابعة مملوكة للمجموعة',checklistIds:['commercial-registration']},
  finance:{accountPrefix:'HTL',documentPrefix:'HTL',collectionProfileId:'hospitality-revenue-v1',currency:'USD',vatEnabled:true,internalBankEligible:true},
  hr:{managerRoleProfileId:'ceo-hospitality-v1',staffingProfileId:'hospitality-site-v1'},
  facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['hotel'],primaryKind:'hotel',siteTemplate:{label:'فندق',facilityKind:'hotel',cost:6000000,dailyCost:9500,capacity:'220 غرفة',deliveryCapacity:0,photo:'assets/images/company-hq-v2.webp',iconKey:'hq',groupValueFactor:.72}},
  ui:{shell:'generic-company-v1',tabs:['overview','management','operations','people','finance'],extensions:[]},map:{layerProviderIds:['company-facilities'],filterGroup:'services',markerProfileId:'hotel'},conference:{providerId:'generic-company-v1',order:70},
  adapters:{lifecycle:'generic-company-v1',operations:adapterId,finance:'standard-company-finance-v1',hr:'standard-company-hr-v1',facilities:'standard-company-facilities-v1',map:'company-map-v1',conference:'generic-company-v1',documents:'legal-documents-v1'},
  legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
};}

const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','company-adapters-core']);
const R=s.GH_CAPABILITY_REGISTRY,P=s.GH_COMPANY_PLATFORM,A=s.GH_COMPANY_ADAPTERS;
R.registerCapability({schema:R.CAPABILITY_SCHEMA,id:'hospitality.operations',domain:'hospitality',description:'تشغيل الضيافة والفنادق'});

const staged={schema:A.PROVIDER_SCHEMA,version:1,kind:'operations',id:'staged-hospitality-v1',capabilityId:'hospitality.operations',engineNames:['GH_STAGED_HOSPITALITY'],methods:['quote']};
const invalid={...staged,id:'invalid provider id'};
const countBefore=A.snapshot().count;
assert.throws(()=>A.registerProviders([staged,invalid]),/company-adapter-provider-id/);
assert.equal(A.snapshot().count,countBefore);assert.equal(A.getProvider('operations',staged.id),null);assert.equal(R.getAdapter('operations',staged.id),null);
console.log('PASS provider batch preflight is atomic before capability-registry mutation');

const provider={schema:A.PROVIDER_SCHEMA,version:1,kind:'operations',id:'hospitality-extension-v1',capabilityId:'hospitality.operations',engineNames:['GH_HOSPITALITY_EXTENSION'],methods:['quote','reenter']};
const registered=A.registerProvider(provider);assert.equal(registered.id,provider.id);assert.equal(A.validateProvider(registered).ok,true);assert(Object.isFrozen(registered));assert(Object.isFrozen(registered.engineNames));
assert.throws(()=>A.registerProvider(provider),/company-adapter-provider-duplicate:operations:hospitality-extension-v1/);
assert.throws(()=>A.registerProvider({...provider,engineNames:['GH_DIFFERENT_EXTENSION']}),/company-adapter-provider-conflict:operations:hospitality-extension-v1/);
assert.throws(()=>A.registerProvider({...provider,id:'wildcard-provider-v1',methods:['*']}),/company-adapter-provider-methods:operations:wildcard-provider-v1/);
assert.throws(()=>A.resolveProvider('operations','missing-provider-v1',{}),/company-adapter-provider-unknown:operations:missing-provider-v1/);
console.log('PASS explicit provider ids reject duplicate, conflict, and unknown resolution fail-closed');

P.installDefinition(hotelDefinition(provider.id),{source:'future-provider-fixture'});
const migrated=P.migrateState({...minimal(),onboardingComplete:true,profile:{name:'مجموعة الاختبار'},companyRegistry:{group:{definitionId:'gh-holding-v1'},'gh-hotels':{definitionId:'gh-hotels-v1'}},openedCompanies:['gh-hotels'],unlockedSectors:['hospitality']});
assert.equal(migrated.errors.length,0,migrated.errors.join(','));const state=migrated.state,calls=[];
const runtime={};runtime.GH_HOSPITALITY_EXTENSION={
  quote(context,payload){calls.push({companyId:context.companyId,payload});context.state.companyModules[context.companyId]??={};context.state.companyModules[context.companyId].operations={lastQuote:payload};return {provider:'hospitality-extension-v1',companyId:context.companyId,total:Number(payload.rooms)*Number(payload.nights)*375};},
  reenter(context){return A.invokeAdapter(context.state,context.companyId,'operations','reenter',[],{runtime,operational:true,capability:'hospitality.operations'});}
};

const direct=A.resolveProvider('operations',provider.id,runtime),binding=A.resolveAdapter(state,'gh-hotels','operations',{runtime,operational:true,capability:'hospitality.operations'});
assert.equal(direct.id,provider.id);assert.equal(binding.id,provider.id);assert.equal(binding.companyId,'gh-hotels');assert.equal(binding.capabilityId,'hospitality.operations');
const quote=A.invokeAdapter(state,'gh-hotels','operations','quote',[{rooms:4,nights:3}],{runtime,operational:true,capability:'hospitality.operations'});
assert.equal(quote.provider,provider.id);assert.equal(quote.companyId,'gh-hotels');assert.equal(quote.total,4500);assert.equal(calls.length,1);assert.equal(state.companyModules['gh-hotels'].operations.lastQuote.rooms,4);
assert.throws(()=>A.invokeAdapter(state,'gh-hotels','operations','unregisteredMethod',[],{runtime,operational:true}),/company-adapter-method-not-allowed/);
assert.throws(()=>A.invokeAdapter(state,'gh-hotels','operations','reenter',[],{runtime,operational:true,capability:'hospitality.operations'}),/company-adapter-recursion:gh-hotels:operations:hospitality-extension-v1:reenter/);
assert.equal(calls.length,1);
console.log('PASS future definition invokes its extension engine through controlled company context without core switches or recursion');
