'use strict';

const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const results=[];
function test(name,run){run();results.push(name);console.log('PASS',name);}
const {s,storage}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','company-adapters-core','save-schema','migration-core']);
const P=s.GH_COMPANY_PLATFORM,S=s.GH_SAVE_SCHEMA,M=s.GH_MIGRATION_CORE;

function hospitalityDefinition(id,definitionId,prefix,order){
  return {
    schema:'gh-company-definition/v1',id,definitionId,definitionVersion:1,order,kind:'subsidiary',lifecycle:'active',
    identity:{legalDefault:{ar:`شركة ${id}`,en:`${id} Company`},trade:{ar:id,en:id.toUpperCase()},short:id.toUpperCase(),legacyLegalNames:[],marks:{default:'assets/identity/group-default.svg',symbol:'assets/identity/group-default.svg',horizontal:'assets/identity/group-default.svg',seal:'assets/identity/group-default.svg',mono:'assets/identity/group-default.svg'},palette:{accent:'#2d72df',secondary:'#0d3b57',route:'#2d72df',onAccent:'#ffffff'},hero:'assets/images/company-hq-v2.webp'},
    classification:{primarySectorId:'hospitality',sectorIds:['hospitality'],operationProfileId:'hospitality-operations-v1',assetClasses:[],routeModes:[]},
    capabilities:['company.core','finance.book','finance.budget','finance.tax','hr.management','documents.identity','documents.signature','map.company','conference.participant'],
    founding:{defaultCapital:10000000,minimumCapital:10000000,legalForm:'شركة تابعة مملوكة للمجموعة',checklistIds:['commercial-registration'],documentPrefix:prefix},
    finance:{accountPrefix:prefix,documentPrefix:prefix,collectionProfileId:'hospitality-revenue-v1',currency:'USD',vatEnabled:true,internalBankEligible:true},
    hr:{managerRoleProfileId:'ceo-hospitality-v1',staffingProfileId:'hospitality-site-v1'},
    facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['hotel'],primaryKind:'hotel',siteTemplate:{label:'فندق',facilityKind:'hotel',cost:6000000,dailyCost:9500,capacity:'220 غرفة',deliveryCapacity:0,photo:'assets/images/company-hq-v2.webp',iconKey:'hq',groupValueFactor:.72}},
    ui:{shell:'generic-company-v1',tabs:['overview','management','operations','people','finance'],extensions:[]},
    map:{layerProviderIds:['company-facilities'],filterGroup:'services',markerProfileId:'hotel'},conference:{providerId:'generic-company-v1',order},
    adapters:{lifecycle:'generic-company-v1',operations:'standard-company-operations-v1',finance:'standard-company-finance-v1',hr:'standard-company-hr-v1',facilities:'standard-company-facilities-v1',map:'company-map-v1',conference:'generic-company-v1',documents:'legal-documents-v1'},
    legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}
  };
}

test('built-in definitions are centralized, valid, and separated by dimensions',()=>{
  assert.equal(JSON.stringify(P.companyIds({includeGroup:false})),JSON.stringify(['air','sea','road','power','bank','mobility']));
  assert.equal(P.validateRegistry().ok,true);const air=P.getDefinition('air');
  assert.equal(air.classification.primarySectorId,'air');assert.equal(air.classification.operationProfileId,'fleet-route-air-v1');assert.equal(JSON.stringify(air.classification.assetClasses),JSON.stringify(['aircraft']));assert.equal(JSON.stringify(air.classification.routeModes),JSON.stringify(['air']));
  assert.equal(P.listByCapability('conference.participant',{includeGroup:false}).length,6);
});

const customLogo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const legacy={...minimal(),speed:5,onboardingComplete:true,profile:{name:'مجموعة اللاعب',shortName:'PLY',logo:customLogo,founder:'المؤسس'},companyRegistry:{group:{legalName:'مجموعة اللاعب'},air:{legalName:'طيران اللاعب',shortName:'SKY',logo:customLogo}},openedCompanies:['air'],unlockedSectors:['air'],customRoutes:[{id:'R-AIR',type:'air',company:'air',name:'R-AIR',fromFacility:'BASE-A',toFacility:'BASE-B',route:[[24.7,46.7],[25.1,47.2]]}],assets:[{id:'A-1',name:'A-1',type:'air',company:'طيران اللاعب',baseFacility:'BASE-A',phase:'idle',progress:0,fuel:100,condition:100,routeId:'R-AIR'}],customHubs:[{id:'BASE-A',kind:'airport-base',company:'air',owned:true}]};
const originalBytes=JSON.stringify(legacy),first=S.migrateLegacy(legacy),second=S.migrateLegacy(first.state);

test('migration is pure, byte-stable, schema-compatible, and removes speed level five',()=>{
  assert.equal(JSON.stringify(legacy),originalBytes);assert.equal(first.state.saveVersion,'2.0.0');assert.equal(first.state.speed,1);assert.equal(first.changed,true);assert.equal(second.changed,false);assert.equal(JSON.stringify(second.state),JSON.stringify(first.state));
  assert.equal(first.state.companyPlatform.schema,'gh-company-platform-state/v1');assert.equal(JSON.stringify(first.state.companyPlatform.components),JSON.stringify({registry:1,ownership:1,modules:1}));
});

test('migration preserves player identity and writes canonical ownership without rewriting legacy aliases',()=>{
  assert.equal(first.state.companyRegistry.air.legalName,'طيران اللاعب');assert.equal(first.state.companyRegistry.air.shortName,'SKY');assert.equal(first.state.companyRegistry.air.logo,customLogo);
  assert.equal(first.state.assets[0].ownerCompanyId,'air');assert.equal(first.state.assets[0].assetClass,'aircraft');assert.equal(first.state.assets[0].operationProfileId,'fleet-route-air-v1');assert.equal(first.state.assets[0].company,'طيران اللاعب');
  assert.equal(first.state.customRoutes[0].ownerCompanyId,'air');assert.equal(first.state.customRoutes[0].routeMode,'air');assert.equal(first.state.customRoutes[0].company,'air');assert.equal(first.state.customRoutes[0].type,'air');assert.equal(S.validate(first.state).ok,true);
  assert.equal(first.state.customHubs[0].ownerCompanyId,'air');assert.equal(first.state.customHubs[0].company,'air');
});

test('canonical migration never recreates legacy route or facility aliases',()=>{
  const canonical={...minimal(),companyRegistry:{air:{definitionId:'gh-air-v1'}},openedCompanies:['air'],unlockedSectors:['air'],customRoutes:[{id:'CANONICAL-ROUTE',ownerCompanyId:'air',routeMode:'air',fromFacility:'A',toFacility:'B',route:[[24,46],[25,47]]}],customHubs:[{id:'CANONICAL-BASE',ownerCompanyId:'air',kind:'airport-base',owned:true}]},out=P.migrateState(canonical).state;
  assert.equal(out.customRoutes[0].ownerCompanyId,'air');assert.equal(out.customRoutes[0].routeMode,'air');assert.equal(Object.prototype.hasOwnProperty.call(out.customRoutes[0],'type'),false);assert.equal(Object.prototype.hasOwnProperty.call(out.customRoutes[0],'company'),false);assert.equal(Object.prototype.hasOwnProperty.call(out.customRoutes[0],'companyId'),false);
  assert.equal(out.customHubs[0].ownerCompanyId,'air');assert.equal(Object.prototype.hasOwnProperty.call(out.customHubs[0],'company'),false);assert.equal(Object.prototype.hasOwnProperty.call(out.customHubs[0],'companyId'),false);
});

test('unknown company is quarantined read-only without group fallback',()=>{
  const unknown={...minimal(),companyRegistry:{'future-co':{legalName:'Future Player Company',logo:customLogo}},openedCompanies:['future-co'],unlockedSectors:['future'],customRoutes:[],assets:[]},migration=P.migrateState(unknown),record=migration.state.companyRegistry['future-co'],resolved=P.resolveCompany(migration.state,'future-co');
  assert.equal(JSON.stringify(record.quarantine),JSON.stringify({readOnly:true,reason:'definition-missing'}));assert.equal(record.legalName,'Future Player Company');assert.equal(record.logo,customLogo);assert.equal(resolved.orphan,true);assert.equal(resolved.operational,false);assert.equal(P.hasCapability(migration.state,'future-co','finance.book'),false);assert.throws(()=>P.requireCompany(migration.state,'future-co'),/company-definition-unavailable:future-co/);assert.equal(migration.state.companyRegistry.group,undefined);
});

test('unknown explicit definition never falls back to the built-in company id across save reload',()=>{
  const future={...minimal(),companyRegistry:{air:{definitionId:'future-air-v9',definitionVersion:9,legalName:'Future Air'}},openedCompanies:['air'],unlockedSectors:['air']},migration=P.migrateState(future),record=migration.state.companyRegistry.air,resolved=P.resolveCompany(migration.state,'air');
  assert.equal(P.definitionFor(migration.state,'air'),null);assert.equal(resolved.known,false);assert.equal(resolved.orphan,true);assert.equal(resolved.operational,false);assert.equal(resolved.status,'compatibility-hold');assert.equal(record.definitionId,'future-air-v9');assert.equal(record.quarantine.reason,'definition-missing');assert.equal(S.validate(migration.state).ok,true,S.validate(migration.state).errors.join(','));
  storage.setItem('GH_FUTURE_DEFINITION',JSON.stringify(migration.state));const loaded=M.load({defaultState:minimal(),storageKey:'GH_FUTURE_DEFINITION',legacyStorageKeys:[],saveSchema:S}).state,after=P.resolveCompany(loaded,'air');
  assert.equal(P.definitionFor(loaded,'air'),null);assert.equal(after.known,false);assert.equal(after.orphan,true);assert.equal(after.operational,false);assert.equal(loaded.companyRegistry.air.definitionId,'future-air-v9');assert.equal(loaded.companyRegistry.air.quarantine.reason,'definition-missing');
});

test('root-singleton operation profiles fail closed while company-scoped fleet profiles remain multi-instance',()=>{
  const state={companyRegistry:{},openedCompanies:[]};assert.equal(P.getInstancePolicy('air').mode,'multi');assert.equal(P.planInstance(state,{companyId:'air-east',definitionId:'gh-air-v1'}).companyId,'air-east');
  for(const [companyId,definitionId] of [['energy-east','gh-energy-v1'],['bank-two','gh-bank-v1'],['mobility-two','gh-mobility-v1']])assert.throws(()=>P.planInstance(state,{companyId,definitionId}),new RegExp(`company-definition-canonical-instance-only:${definitionId}:${companyId}`));
  const invalid=P.migrateState({...minimal(),companyRegistry:{'mobility-two':{definitionId:'gh-mobility-v1'}},openedCompanies:['mobility-two'],unlockedSectors:['mobility']});assert(invalid.errors.includes('company-instance-policy:mobility-two:gh-mobility-v1'));assert.equal(P.resolveCompany(invalid.state,'mobility-two').operational,false);
});

test('unknown canonical asset, delivery, route, and facility owners fail validation closed',()=>{
  const invalid={...minimal(),companyRegistry:{group:{id:'group',companyId:'group',definitionId:'gh-holding-v1'}},openedCompanies:[],assets:[{id:'BAD-ASSET',ownerCompanyId:'ghost',assetClass:'aircraft',assetMode:'air'}],customRoutes:[{id:'BAD-ROUTE',ownerCompanyId:'ghost',routeMode:'air'}],customHubs:[{id:'BAD-FACILITY',ownerCompanyId:'ghost',kind:'airport-base'}],realism:{procurement:{deliveries:[{id:'BAD-DELIVERY',asset:{id:'BAD-DELIVERY-ASSET',ownerCompanyId:'ghost',assetClass:'aircraft',assetMode:'air'}}]}}};
  const validation=P.validateState(invalid);
  assert(validation.errors.includes('asset-company-reference:BAD-ASSET'));
  assert(validation.errors.includes('delivery-asset-company-reference:BAD-DELIVERY-ASSET'));
  assert(validation.errors.includes('route-company-reference:BAD-ROUTE'));
  assert(validation.errors.includes('facility-company-reference:BAD-FACILITY'));
});

test('invalid aliases and failed manifest batches leave the registry unchanged',()=>{
  const before=P.snapshot(),selfAlias=hospitalityDefinition('alias-poison','alias-poison-v1','ALP',67);
  selfAlias.legacy.companyAliases=['alias-poison'];
  assert.throws(()=>P.installDefinition(selfAlias,{source:'fixture'}),/company-definition-invalid:definition-legacy:alias-poison/);
  assert.equal(P.getDefinition('alias-poison'),null);
  const batchOne=hospitalityDefinition('batch-one','batch-one-v1','BTO',68),batchTwo=hospitalityDefinition('batch-two','batch-two-v1','BTT',69);batchOne.legacy.sectorAliases=['batch-sector'];
  batchTwo.legacy.companyAliases=['batch-two'];
  assert.throws(()=>P.installDefinitions([batchOne,batchTwo],{source:'fixture'}),/company-definition-invalid:definition-legacy:batch-two/);
  assert.equal(P.getDefinition('batch-one'),null);assert.equal(P.getDefinition('batch-two'),null);assert.equal(P.normalizeSectorId('batch-sector'),'batch-sector');assert.equal(P.snapshot().definitions,before.definitions);
  const ownerCollision=hospitalityDefinition('owner-poison','owner-poison-v1','OWN',69);ownerCollision.classification.assetClasses=['hotel'];ownerCollision.legacy.assetOwnerModes=['air'];ownerCollision.legacy.assetClassByMode={air:'hotel'};
  assert.throws(()=>P.installDefinition(ownerCollision,{source:'fixture'}),/legacy-owner-mode-duplicate:asset:air/);assert.equal(P.getDefinition('owner-poison'),null);assert.equal(P.ownerForLegacyAssetMode('air'),'air');
});

test('gh-hotels and a same-sector variant install from definitions only',()=>{
  const hotelsDefinition=hospitalityDefinition('gh-hotels','gh-hotels-v1','HTL',70);hotelsDefinition.legacy.sectorAliases=['lodging'];P.installDefinition(hotelsDefinition,{source:'fixture'});P.installDefinition(hospitalityDefinition('gh-resorts','gh-resorts-v1','RST',71),{source:'fixture'});
  const hotels=P.getDefinition('gh-hotels'),resorts=P.getDefinition('gh-resorts');assert.equal(hotels.classification.primarySectorId,'hospitality');assert.equal(resorts.classification.primarySectorId,'hospitality');assert.equal(hotels.classification.operationProfileId,resorts.classification.operationProfileId);assert.notEqual(hotels.id,resorts.id);assert(P.listByCapability('finance.book').some(row=>row.id==='gh-hotels'));
  assert.equal(P.normalizeSectorId('lodging'),'hospitality');assert.equal(P.isKnownSector('lodging'),true);assert.equal(JSON.stringify(P.migrateState({...minimal(),unlockedSectors:['lodging','hospitality']}).state.unlockedSectors),JSON.stringify(['hospitality']));
});

test('business metric migration uses company instance ids and never creates sector books',()=>{
  const defaults={...minimal(),profile:{},bank:{},energy:{},operations:{},finance:{...minimal().finance},treasury:structuredClone(minimal().treasury)};
  const complete=state=>M.completeBusinessState(state,{defaultState:defaults,initialStocks:[],crewRolesSeed:[]});
  const empty=P.migrateState({...minimal(),profile:{},bank:{},energy:{},operations:{},sectorProfitToday:{hospitality:0}}).state;
  complete(empty);assert.equal(Object.prototype.hasOwnProperty.call(empty.sectorProfitToday,'hospitality'),false,'an installed sector definition is not a company account');

  const legacy=P.migrateState({...minimal(),profile:{},bank:{},energy:{},operations:{},companyRegistry:{'hotel-one':{definitionId:'gh-hotels-v1'}},openedCompanies:['hotel-one'],sectorProfitToday:{hospitality:175},tripProfitAccrued:{lodging:25},tripRevenueAccrued:{hospitality:300}}).state;
  complete(legacy);assert.deepEqual(Object.keys(legacy.sectorProfitToday),['hotel-one']);assert.equal(legacy.sectorProfitToday['hotel-one'],175);assert.equal(legacy.tripProfitAccrued['hotel-one'],25);assert.equal(legacy.tripRevenueAccrued['hotel-one'],300);

  const isolated=P.migrateState({...minimal(),profile:{},bank:{},energy:{},operations:{},companyRegistry:{'hotel-one':{definitionId:'gh-hotels-v1'},'hotel-two':{definitionId:'gh-resorts-v1'}},openedCompanies:['hotel-one','hotel-two'],sectorProfitToday:{'hotel-one':11,'hotel-two':22}}).state;
  complete(isolated);assert.equal(isolated.sectorProfitToday['hotel-one'],11);assert.equal(isolated.sectorProfitToday['hotel-two'],22);assert.equal(Object.prototype.hasOwnProperty.call(isolated.sectorProfitToday,'hospitality'),false);

  const ambiguous=P.migrateState({...minimal(),profile:{},bank:{},energy:{},operations:{},companyRegistry:{'hotel-one':{definitionId:'gh-hotels-v1'},'hotel-two':{definitionId:'gh-resorts-v1'}},openedCompanies:['hotel-one','hotel-two'],sectorProfitToday:{hospitality:99}}).state,before=JSON.stringify(ambiguous.sectorProfitToday);
  assert.throws(()=>complete(ambiguous),/MIGRATION_COMPANY_METRIC_AMBIGUOUS:sectorProfitToday:hospitality:hotel-one,hotel-two/);assert.equal(JSON.stringify(ambiguous.sectorProfitToday),before,'ambiguous legacy data must fail before publishing a partial metric map');
});

test('two company instances can share one air sector and operation profile without route collision',()=>{
  const base={...minimal(),companyRegistry:{'air-one':{definitionId:'gh-air-v1',legalName:'Air One'},'air-two':{definitionId:'gh-air-v1',legalName:'Air Two'}},openedCompanies:['air-one','air-two'],unlockedSectors:['air'],customRoutes:[
    {id:'R-ONE',type:'air',company:'air-one',ownerCompanyId:'air-one',routeMode:'air',fromFacility:'A1',toFacility:'B1',route:[[24,46],[25,47]]},
    {id:'R-TWO',type:'air',company:'air-two',ownerCompanyId:'air-two',routeMode:'air',fromFacility:'A2',toFacility:'B2',route:[[24,46],[25,47]]}
  ],assets:[
    {id:'AIR-ONE-1',name:'One',type:'air',ownerCompanyId:'air-one',assetClass:'aircraft',baseFacility:'A1',phase:'idle',progress:0,fuel:100,condition:100,routeId:'R-ONE'},
    {id:'AIR-TWO-1',name:'Two',type:'air',ownerCompanyId:'air-two',assetClass:'aircraft',baseFacility:'A2',phase:'idle',progress:0,fuel:100,condition:100,routeId:'R-TWO'}
  ]},migration=S.migrateLegacy(base);
  assert.equal(migration.state.companyRegistry['air-one'].sectorId,'air');assert.equal(migration.state.companyRegistry['air-two'].sectorId,'air');assert.equal(migration.state.companyRegistry['air-one'].operationProfileId,'fleet-route-air-v1');assert.equal(migration.state.companyPlatform.minimumReaderBuild,334);assert.equal(migration.state.customRoutes[0].company,'air-one');assert.equal(migration.state.customRoutes[1].company,'air-two');assert.equal(S.validate(migration.state).ok,true);
});

test('corporate provisioning uses dynamic company id and fails closed for unknown definitions',()=>{
  const finance={TYPES:['group','gh-hotels','gh-resorts'],supportsCompany:id=>['group','gh-hotels','gh-resorts'].includes(id),book:(state,id)=>state.companyFinance[id],execute:({state},command,payload)=>{assert.equal(command,'transfer');assert.equal(payload.from,'group');assert.equal(payload.to,'gh-hotels');state.companyFinance.group.accounts[0].balance-=payload.amount;state.companyFinance[payload.to].accounts[0].balance+=payload.amount;return {transferred:true,from:payload.from,to:payload.to,amount:payload.amount};}};
  s.GH_FINANCE_CORE=finance;s.window.GH_FINANCE_CORE=finance;s.eval=undefined;s.globalThis=s;const corporateSource=require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../WebApp/corporate-core.js'),'utf8');require('node:vm').runInContext(corporateSource,s,{filename:'corporate-core.js'});const C=s.GH_CORPORATE_CORE;
  const state={simSeconds:100,onboardingComplete:true,profile:{name:'Player Group',founder:'Player'},companyRegistry:{group:{id:'group',companyId:'group',definitionId:'gh-holding-v1',definitionVersion:1,legalName:'Player Group'}},openedCompanies:[],unlockedSectors:[],stakes:{},maDeals:{},advanced:{},companyFinance:{group:{accounts:[{id:'GH-OPER-001',balance:50000000}]},'gh-hotels':{accounts:[{id:'HTL-OPER-001',balance:0}]},'gh-resorts':{accounts:[{id:'RST-OPER-001',balance:0}]}}};
  const record=C.execute({state},'open-company',{companyId:'gh-hotels',capital:10000000,legalName:'فنادق اللاعب'});assert.equal(record.companyId,'gh-hotels');assert.equal(record.sectorId,'hospitality');assert.equal(record.operationProfileId,'hospitality-operations-v1');assert.equal(JSON.stringify(state.openedCompanies),JSON.stringify(['gh-hotels']));assert.equal(JSON.stringify(state.unlockedSectors),JSON.stringify(['hospitality']));assert.equal(state.companyFinance.group.accounts[0].balance,40000000);assert.equal(state.companyFinance['gh-hotels'].accounts[0].balance,10000000);
  state.unlockedSectors=[];C.execute({state},'unlock-sector',{sectorId:'lodging'});assert.equal(JSON.stringify(state.unlockedSectors),JSON.stringify(['hospitality']));
  const before=JSON.stringify(state),validation=C.validate({state},'open-company',{companyId:'not-installed',capital:10000000});assert.equal(validation.ok,false);assert.match(validation.reason,/company-definition-unavailable/);assert.equal(JSON.stringify(state),before);
});

P.seal({runtimeCheck:false});
test('sealed platform rejects late definitions and exposes deterministic snapshot',()=>{assert.equal(P.isSealed(),true);assert.throws(()=>P.installDefinition(hospitalityDefinition('late-company','late-company-v1','LATE',99)),/company-platform-sealed/);assert.equal(P.snapshot().definitions,9);});

console.log(`PASS company platform ${results.length}/${results.length}`);
