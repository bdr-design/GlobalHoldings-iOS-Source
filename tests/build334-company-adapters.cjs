'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

function runtimeFor(adapterCore){
  const runtime={};
  for(const profiles of Object.values(adapterCore.PROFILES))for(const engineNames of Object.values(profiles))for(const name of engineNames)runtime[name]??={VERSION:`fixture:${name}`,execute:(...args)=>({engine:name,args}),ping:()=>name};
  return runtime;
}
function futureDefinition(){return {
  schema:'gh-company-definition/v1',id:'gh-hotels',definitionId:'gh-hotels-v1',definitionVersion:1,order:70,kind:'subsidiary',lifecycle:'active',
  identity:{legalDefault:{ar:'شركة فنادق جي إتش',en:'GH Hotels Company'},trade:{ar:'جي إتش للفنادق',en:'GH HOTELS'},short:'GH HOTELS',legacyLegalNames:[],marks:{default:'assets/identity/group-default.svg',symbol:'assets/identity/group-default.svg',horizontal:'assets/identity/group-default.svg',seal:'assets/identity/group-default.svg',mono:'assets/identity/group-default.svg'},palette:{accent:'#2d72df',secondary:'#0d3b57',route:'#2d72df',onAccent:'#ffffff'},hero:'assets/images/company-hq-v2.webp'},
  classification:{primarySectorId:'hospitality',sectorIds:['hospitality'],operationProfileId:'hospitality-operations-v1',assetClasses:[],routeModes:[]},
  capabilities:['company.core','finance.book','finance.budget','finance.tax','hr.management','documents.identity','documents.signature','map.company','conference.participant','hospitality.operations'],
  founding:{defaultCapital:10000000,minimumCapital:10000000,legalForm:'شركة تابعة مملوكة للمجموعة',checklistIds:['commercial-registration']},
  finance:{accountPrefix:'HTL',documentPrefix:'HTL',collectionProfileId:'hospitality-revenue-v1',currency:'USD',vatEnabled:true,internalBankEligible:true},
  hr:{managerRoleProfileId:'ceo-hospitality-v1',staffingProfileId:'hospitality-site-v1'},facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['hotel'],primaryKind:'hotel',siteTemplate:{label:'فندق',facilityKind:'hotel',cost:6000000,dailyCost:9500,capacity:'220 غرفة',deliveryCapacity:0,photo:'assets/images/company-hq-v2.webp',iconKey:'hq',groupValueFactor:.72}},
  ui:{shell:'generic-company-v1',tabs:['overview','management','operations','people','finance'],extensions:[]},map:{layerProviderIds:['company-facilities'],filterGroup:'services',markerProfileId:'hotel'},conference:{providerId:'generic-company-v1',order:70},
  adapters:{lifecycle:'generic-company-v1',operations:'standard-company-operations-v1',finance:'standard-company-finance-v1',hr:'standard-company-hr-v1',facilities:'standard-company-facilities-v1',map:'company-map-v1',conference:'generic-company-v1',documents:'legal-documents-v1'},
  legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
};}

const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','company-adapters-core']);
const P=s.GH_COMPANY_PLATFORM,R=s.GH_CAPABILITY_REGISTRY,A=s.GH_COMPANY_ADAPTERS,runtime=runtimeFor(A);
let refs=0;
for(const definition of P.listDefinitions())for(const [kind,id] of Object.entries(definition.adapters)){
  refs++;const adapter=R.getAdapter(kind,id,{required:true});assert.equal(adapter.supports(definition),true);assert.equal(adapter.assertAvailable(runtime),true);const resolved=adapter.resolve(runtime);assert.equal(resolved.kind,kind);assert.equal(typeof resolved.call,'function');assert.equal(typeof resolved.execute,'function');
}
assert.equal(refs,56);assert.equal(P.validateRegistry().ok,true);console.log('PASS all 56 built-in adapter references resolve to executable descriptors');

assert(Object.isFrozen(R.BUILTIN_CAPABILITIES));assert(R.BUILTIN_CAPABILITIES.every(Object.isFrozen));assert.throws(()=>P.installDefinition(futureDefinition(),{source:'future-fixture'}),/capability-unknown:hospitality\.operations/);
const extensionCapability={schema:R.CAPABILITY_SCHEMA,id:'hospitality.operations',domain:'hospitality',description:'تشغيل الضيافة والفنادق'};R.registerCapability(extensionCapability);assert.equal(R.has('hospitality.operations'),true);assert.equal(R.get('hospitality.operations').domain,'hospitality');assert.throws(()=>R.registerCapability(extensionCapability),/capability-duplicate:hospitality\.operations/);assert.throws(()=>R.registerCapability({...extensionCapability,description:'وصف متعارض'}),/capability-conflict:hospitality\.operations/);assert.throws(()=>R.registerCapability({schema:'wrong',id:'bad id',domain:'',description:'<bad>'}),/capability-schema|capability-id|capability-domain|capability-description/);
P.installDefinition(futureDefinition(),{source:'future-fixture'});const state={...minimal(),onboardingComplete:true,profile:{name:'Fixture Group'},companyRegistry:{group:{definitionId:'gh-holding-v1'},'gh-hotels':{definitionId:'gh-hotels-v1'}},openedCompanies:['gh-hotels']};
const operations=P.adapterFor(state,'gh-hotels','operations',{resolve:true,runtime}),result=operations.execute({state},'fixture-command',{ok:true});
assert.equal(result.engine,'GH_CORPORATE_CORE');assert.equal(P.adapterFor(state,'gh-hotels','facilities').id,'standard-company-facilities-v1');console.log('PASS future company reuses registered generic profiles without a consumer switch');

assert.throws(()=>P.seal({runtime:{}}),/company-adapter-runtime-unavailable/);assert.equal(P.isSealed(),false);P.seal({runtime});assert.equal(P.isSealed(),true);assert.equal(R.isSealed(),true);assert.throws(()=>R.registerCapability({schema:R.CAPABILITY_SCHEMA,id:'late.capability',domain:'late',description:'Late'}),/capability-registry-sealed/);assert.throws(()=>R.registerAdapter('operations','late-adapter-v1',{}),/capability-registry-sealed/);console.log('PASS platform seal fails closed on missing engines and seals capability and adapter registration');
