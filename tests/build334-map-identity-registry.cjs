'use strict';
const assert=require('assert/strict'),path=require('path'),{performance}=require('perf_hooks');
const root=path.resolve(__dirname,'..'),web=path.join(root,'WebApp');
for(const key of ['GH_CAPABILITY_REGISTRY','GH_COMPANY_DEFINITIONS','GH_COMPANY_PLATFORM','GH_COMPANY_REGISTRY','GH_IDENTITY','GH_MAP_FEATURE_CORE','GH_MAP_LAYER_REGISTRY'])delete globalThis[key];
const capability=require(path.join(web,'capability-registry-core.js'));
const definitions=require(path.join(web,'company-definitions.js'));
const platform=require(path.join(web,'company-platform-core.js'));

const rail=JSON.parse(JSON.stringify(definitions.get('air')));
Object.assign(rail,{id:'rail',definitionId:'gh-rail-v1',order:70});
rail.identity={legalDefault:{ar:'شركة جلوبال هولدينغز للسكك الحديدية',en:'Global Holdings Rail Company'},trade:{ar:'جي إتش ريل',en:'GH RAIL'},short:'GH RAIL',legacyLegalNames:['الشركة العالمية للقطارات'],marks:{default:'assets/identity/gh-logistics.svg',symbol:'assets/identity/gh-logistics.svg',horizontal:'assets/identity/gh-logistics.svg',seal:'assets/identity/gh-logistics.svg',mono:'assets/identity/gh-logistics.svg'},palette:{accent:'#b54d38',secondary:'#5f2b23',route:'#b54d38',onAccent:'#ffffff'},hero:'assets/images/facility-logistics-v2.webp'};
rail.classification={primarySectorId:'rail',sectorIds:['rail'],operationProfileId:'rail-network-v1',assetClasses:['locomotive'],routeModes:['rail']};
rail.capabilities=rail.capabilities.filter(id=>!id.startsWith('asset.')&&!id.startsWith('route.')&&!id.startsWith('facility.'));
rail.founding={...rail.founding,defaultCapital:40000000,minimumCapital:40000000,documentPrefix:'RAIL'};
rail.finance={...rail.finance,accountPrefix:'RAIL',documentPrefix:'RAIL',collectionProfileId:'rail-revenue-v1'};
rail.hr={managerRoleProfileId:'ceo-rail-v1',staffingProfileId:'rail-network-v1'};
rail.facilities={directoryProviderIds:['world-capitals'],allowedKinds:['rail-terminal'],primaryKind:'rail-terminal',siteTemplate:{label:'محطة قطارات',facilityKind:'rail-terminal',cost:32000000,dailyCost:24000,capacity:'12 رصيف قطارات',deliveryCapacity:80,photo:'assets/images/facility-logistics-v2.webp',iconKey:'logistics',groupValueFactor:.72}};
rail.map={layerProviderIds:['rail-assets','rail-routes','company-facilities'],filterGroup:'transport',markerProfileId:'rail'};
rail.conference={providerId:'fleet-company-v1',order:70};
rail.adapters={...rail.adapters,operations:'rail-network-v1',facilities:'rail-network-v1',map:'rail-map-v1'};
rail.legacy={companyAliases:[],sectorAliases:[],assetOwnerModes:['rail'],routeOwnerModes:['rail'],assetClassByMode:{rail:'locomotive'}};
assert.equal(capability.validate(rail.capabilities).ok,true);
platform.installDefinition(rail,{source:'build334-map-identity-test'});

const identity=require(path.join(web,'identity-system.js'));
assert.equal(identity.VERSION,'GH-IDENTITY-334.2.0');
assert.equal(identity.definition('rail').source,platform.getDefinition('rail'),'identity must adapt the central platform definition, not a duplicate');
assert.equal(identity.shortName({},'rail'),'GH RAIL');
assert.equal(identity.legalName({},'rail'),'شركة جلوبال هولدينغز للسكك الحديدية');
assert.equal(identity.legalName({},'rail',{language:'en'}),'Global Holdings Rail Company');
assert(globalThis.GH_COMPANY_REGISTRY.list({kind:'subsidiary'}).some(row=>row.id==='rail'),'seventh company must appear without editing identity arrays');
assert.equal(globalThis.GH_COMPANY_REGISTRY.companyOf({routeMode:'rail'}),'rail');
assert.equal(globalThis.GH_COMPANY_REGISTRY.companyOf({ownerCompanyId:'rail',routeMode:'air'}),'rail','canonical owner must override shared operation mode');
assert.equal(globalThis.GH_COMPANY_REGISTRY.companyOf({ownerCompanyId:'ghost',routeMode:'rail'}),null,'unknown canonical owner must fail closed instead of falling back to a mode');
assert.equal(globalThis.GH_COMPANY_REGISTRY.companyOf({companyId:'ghost'}),null,'unknown explicit owner fails closed');

const customPrimary='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',customSeal=customPrimary;
const state={openedCompanies:['rail'],companyRegistry:{rail:{id:'rail',definitionId:'gh-rail-v1',legalName:'شركة قطارات اللاعب',shortName:'PLAYER RAIL',logo:customPrimary,identity:{logos:{documentSeal:customSeal}}}}};
assert.equal(identity.legalName(state,'rail'),'شركة قطارات اللاعب');
assert.equal(identity.shortName(state,'rail'),'PLAYER RAIL');
assert.equal(identity.logo(state,'rail','documentSeal'),customSeal,'requested custom variant has priority');
assert.equal(identity.logo(state,'rail','horizontal'),customPrimary,'primary custom mark is the safe variant fallback');
const modernMarkup=identity.logoMarkup(state,'rail',{usage:'horizontal',className:'company-mark'});
assert.match(modernMarkup,/^<img\b/);assert(!modernMarkup.includes('<div'),'modern logo API must not nest an extra badge');assert.match(modernMarkup,/class="company-mark"/);
assert.match(identity.logoMarkup(state,'rail'),/^<div\b/,'legacy positional logo API remains compatible');
const unknown=identity.resolve({companyRegistry:{}},'ghost');
assert.equal(unknown.known,false);assert.equal(unknown.logo,identity.UNKNOWN_LOGO);assert.notEqual(unknown.logo,identity.logo({},'group'),'unknown identity must never impersonate the group');

const feature=require(path.join(web,'map-feature-core.js'));
const railFilter=feature.legacyFilterState('rail',false);
assert.deepEqual(railFilter.companies,{mode:'include',included:['rail'],excluded:[]});
assert.equal(feature.companyVisible(railFilter,'rail'),true);
assert.equal(feature.companyVisible(feature.DEFAULT_FILTER_STATE,'ghost'),false,'unknown company fails closed in all mode');
const unknownLegacy=feature.legacyFilterState('not-installed',true);
assert.deepEqual(unknownLegacy.companies,{mode:'include',included:[],excluded:[]});
assert(Object.values(unknownLegacy.categories).every(value=>value===false),'unknown legacy filter exposes no categories');
const camera={center:[24.7136,46.6753],zoom:7,bearing:19},cameraBefore=JSON.stringify(camera),normalizedWithCamera=feature.normalizeFilterState({...feature.DEFAULT_FILTER_STATE,camera});
assert.equal(JSON.stringify(camera),cameraBefore);assert.equal(Object.prototype.hasOwnProperty.call(normalizedWithCamera,'camera'),false,'filter normalization must not own or change camera');

for(let zoom=0;zoom<=24;zoom++)for(const kind of ['point','vehicle','facility','cluster'])for(const selected of [false,true]){
  const geometry=feature.markerGeometry(zoom,{kind,selected});
  assert.deepEqual(geometry.iconSize,[44,44]);assert.deepEqual(geometry.iconAnchor,[22,22]);assert.equal(geometry.canvasHitRadius,22);
  assert(geometry.visualSize<=geometry.hitSize);assert.equal(geometry.visualOffset[0]*2+geometry.visualSize,geometry.hitSize);assert.equal(geometry.visualOffset[1]*2+geometry.visualSize,geometry.hitSize);
  assert.deepEqual(geometry.visualAnchor,[geometry.visualSize/2,geometry.visualSize/2]);assert.equal(geometry.cssTokens['--marker-hit-size'],'44px');
}
const accessible=feature.createFeature({id:'accessible',layerId:'rail-layer',category:'assets',companyId:'rail',geometry:{type:'Point',coordinates:[46.67,24.71]},label:'قطار 1'});
assert.equal(accessible.a11yLabel,'قطار 1');
assert.throws(()=>feature.createSpatialIndex().query({south:undefined,west:0,north:2,east:2}),/map-spatial-bounds-invalid/);
const dateline=feature.createSpatialIndex([
  feature.createFeature({id:'west',layerId:'geo',category:'facilities',geometry:{type:'Point',coordinates:[-179,0]}}),
  feature.createFeature({id:'east',layerId:'geo',category:'facilities',geometry:{type:'Point',coordinates:[179,0]}})
]);
assert.equal(dateline.query({south:-2,west:170,north:2,east:-170}).length,2);assert.equal(dateline.query({south:-90,west:-180,north:90,east:180}).length,2);

const spatialRows=[];for(let latitude=0;latitude<160;latitude++)for(let longitude=0;longitude<200;longitude++)spatialRows.push(feature.createFeature({id:`p${latitude}-${longitude}`,layerId:'world-grid',category:'infrastructure',geometry:{type:'Point',coordinates:[-179.1+longitude*1.79,-79.5+latitude]}}));
const spatialStart=performance.now(),spatial=feature.createSpatialIndex(spatialRows,{cellDegrees:2}),indexMilliseconds=performance.now()-spatialStart,queryStart=performance.now(),local=spatial.query({south:-1,west:-1,north:1,east:1}),queryMilliseconds=performance.now()-queryStart,spatialStats=spatial.stats();
assert(local.length>0);assert(spatialStats.lastQuery.visitedCandidates<spatialRows.length/100,'bounded query must not scan the world');

const layerRegistry=require(path.join(web,'map-layer-registry.js'));
const atomic=layerRegistry.createRegistry();
assert.throws(()=>atomic.registerBundle({sources:[{id:'will-not-commit',select:()=>[]}],layers:[{id:'invalid-layer',sourceId:'will-not-commit',rendererId:'missing',category:'assets'}]}),/map-layer-renderer-missing/);
assert.equal(atomic.diagnostics().sources,0,'invalid bundle is all-or-nothing');
assert.throws(()=>atomic.registerRenderer({id:'no-create',geometryTypes:['Point']}),/map-renderer-create-required/);

let sourceRows=Array.from({length:12},(_,index)=>({id:`rail-${index}`,revision:1,selected:index<7,priority:12-index,longitude:40+index/10,latitude:20+index/10}));
const registry=layerRegistry.createRegistry({renderBudget:4});
registry.registerBundle({
  sources:[
    {id:'rail-source',select:()=>sourceRows,toFeatures:row=>({id:row.id,companyId:'rail',selected:row.selected,priority:row.priority,label:`قطار ${row.id}`,geometry:{type:'Point',coordinates:[row.longitude,row.latitude]}}),revision:row=>row.revision},
    {id:'orphan-source',select:()=>[{id:'orphan',geometry:{type:'Point',coordinates:[10,10]},companyId:'ghost'}]}
  ],
  renderers:[{id:'point-renderer',geometryTypes:['Point'],create:()=>({}),legendSample:()=>({shape:'dot'})}],
  layers:[
    {id:'rail-live',sourceId:'rail-source',rendererId:'point-renderer',category:'rail-network',companyId:'rail',capability:'operations.fleet',minZoom:4,maxZoom:14,budget:{min:1,max:5,weight:2},legend:{label:'شبكة السكك الحديدية'}},
    {id:'rail-capability-blocked',sourceId:'rail-source',rendererId:'point-renderer',category:'rail-network',companyId:'rail',capability:'operations.bank',minZoom:4,maxZoom:14,legend:{label:'طبقة غير مدعومة'}},
    {id:'orphan-live',sourceId:'orphan-source',rendererId:'point-renderer',category:'rail-network',minZoom:4,maxZoom:14,legend:{label:'مجهول'}}
  ]
});
const snapshotCamera={center:[25,45],zoom:6},snapshotCameraBefore=JSON.stringify(snapshotCamera),snapshot=registry.snapshot({zoom:6,camera:snapshotCamera,state,renderBudget:4});
assert.equal(JSON.stringify(snapshotCamera),snapshotCameraBefore,'snapshot/filter changes must not mutate camera');
assert.equal(snapshot.requestedRenderBudget,4);assert.equal(snapshot.renderBudget,7,'selected features are pinned even when they exceed the normal budget');assert.equal(snapshot.features.length,7);assert(snapshot.features.every(row=>row.companyId==='rail'&&row.selected));
assert.equal(snapshot.counts.companies.ghost,undefined,'unknown feature is excluded before render/count');assert.equal(snapshot.counts.layers['rail-capability-blocked'],undefined,'company capability gates unsupported future layers');assert.equal(snapshot.filterState.categories['rail-network'],true,'registered category extends filter schema dynamically');
const legend=registry.legend(snapshot,{state});assert.equal(legend.length,1);assert.equal(legend[0].id,'rail-live');
const filterModel=registry.filterModel(snapshot,{state});assert(filterModel.companies.some(row=>row.id==='rail'&&row.known&&row.enabled));assert(filterModel.categories.some(row=>row.id==='rail-network'));
sourceRows=sourceRows.map((row,index)=>index===0?{...row,revision:2}:row);
const nextSnapshot=registry.snapshot({zoom:6,state,renderBudget:4}),diff=registry.reconcile(snapshot,nextSnapshot);
assert.equal(diff.updated.length,1);assert.equal(diff.added.length,0);assert.equal(diff.removed.length,0);

console.log(JSON.stringify({pass:true,fixtureCompany:'rail',markerZooms:25,spatialFeatures:spatialRows.length,spatialReturned:local.length,visitedCandidates:spatialStats.lastQuery.visitedCandidates,indexMilliseconds:Number(indexMilliseconds.toFixed(2)),queryMilliseconds:Number(queryMilliseconds.toFixed(2)),rendered:snapshot.features.length,requestedBudget:snapshot.requestedRenderBudget,effectiveBudget:snapshot.renderBudget}));
