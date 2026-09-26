(()=>{'use strict';
const VERSION='GH-MAP-LAYER-REGISTRY-334.0.0',FEATURE=globalThis.GH_MAP_FEATURE_CORE;
if(!FEATURE)throw new Error('map-feature-core-required-before-map-layer-registry');
const ID_PATTERN=/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,159}$/;
const DEFAULT_RENDER_BUDGET=150;

function safeId(value,label='id'){const id=String(value||'').trim();if(!ID_PATTERN.test(id))throw new Error(`map-registry-${label}-invalid`);return id;}
function finite(value,fallback){const number=Number(value);return Number.isFinite(number)?number:fallback;}
function freeze(value){return Object.freeze(value);}
function normalizeSource(input){
  if(!input||typeof input!=='object')throw new Error('map-source-required');const id=safeId(input.id,'source-id');
  if(typeof input.select!=='function'&&typeof input.query!=='function')throw new Error(`map-source-reader-required:${id}`);
  return freeze({id,select:typeof input.select==='function'?input.select:null,query:typeof input.query==='function'?input.query:null,toFeatures:typeof input.toFeatures==='function'?input.toFeatures:null,count:typeof input.count==='function'?input.count:null,revision:typeof input.revision==='function'?input.revision:null,spatial:Boolean(input.spatial)});
}
function normalizeRenderer(input){
  if(!input||typeof input!=='object')throw new Error('map-renderer-required');const id=safeId(input.id,'renderer-id'),geometryTypes=[...new Set(Array.isArray(input.geometryTypes)?input.geometryTypes:FEATURE.GEOMETRY_TYPES)];
  if(!geometryTypes.length||geometryTypes.some(type=>!FEATURE.GEOMETRY_TYPES.includes(type)))throw new Error(`map-renderer-geometry-invalid:${id}`);
  if(typeof input.create!=='function')throw new Error(`map-renderer-create-required:${id}`);
  return freeze({id,geometryTypes:freeze(geometryTypes),create:typeof input.create==='function'?input.create:null,update:typeof input.update==='function'?input.update:null,remove:typeof input.remove==='function'?input.remove:null,legendSample:typeof input.legendSample==='function'?input.legendSample:null});
}
function normalizeLayer(input){
  if(!input||typeof input!=='object')throw new Error('map-layer-required');const id=safeId(input.id,'layer-id'),sourceId=safeId(input.sourceId,'source-id'),rendererId=safeId(input.rendererId,'renderer-id'),category=safeId(input.category||'infrastructure','category');
  const minZoom=Math.max(0,Math.floor(finite(input.minZoom,0))),maxZoom=Math.min(24,Math.floor(finite(input.maxZoom,24)));if(minZoom>maxZoom)throw new Error(`map-layer-zoom-invalid:${id}`);
  const budgetInput=input.budget&&typeof input.budget==='object'?input.budget:{},minimum=Math.max(0,Math.floor(finite(budgetInput.min,0))),maximum=Math.max(minimum,Math.floor(finite(budgetInput.max,DEFAULT_RENDER_BUDGET))),weight=Math.max(.01,finite(budgetInput.weight,1));
  const legendInput=input.legend&&typeof input.legend==='object'?input.legend:{label:input.legend};
  return freeze({
    id,sourceId,rendererId,category,companyId:input.companyId==null?null:String(input.companyId).trim()||null,capability:String(input.capability||''),filterGroup:String(input.filterGroup||category),order:finite(input.order,1000),priority:finite(input.priority,0),defaultVisible:input.defaultVisible!==false,market:input.market==='competitor'?'competitor':'',minZoom,maxZoom,budget:freeze({min:minimum,max:maximum,weight}),
    legend:freeze({label:String(legendInput.label||''),short:String(legendInput.short||''),glyph:String(legendInput.glyph||''),description:String(legendInput.description||'')})
  });
}
function stableFeatureSort(a,b){return Number(b.selected)-Number(a.selected)||b.priority-a.priority||a.key.localeCompare(b.key);}
function ensureRows(value,sourceId){if(value==null)return[];if(Array.isArray(value))return value;if(typeof value!=='string'&&typeof value?.[Symbol.iterator]==='function')return [...value];throw new Error(`map-source-result-invalid:${sourceId}`);}
function countInto(record,key,amount=1){if(!key)return;record[key]=(record[key]||0)+amount;}
function allocateFeatures(rows,totalBudget){
  const requestedTotal=Math.max(1,Math.floor(finite(totalBudget,DEFAULT_RENDER_BUDGET))),allocations=new Map(),selectedTotal=rows.reduce((sum,row)=>sum+row.selected.length,0),total=Math.max(requestedTotal,selectedTotal);let remaining=Math.max(0,total-selectedTotal);
  for(const row of rows){const capacity=Math.max(0,Math.min(row.normal.length,row.layer.budget.max-row.selected.length)),initial=Math.min(capacity,row.layer.budget.min,remaining);allocations.set(row.layer.id,initial);remaining-=initial;row.capacity=capacity;}
  while(remaining>0){let best=null,bestScore=-Infinity;for(const row of rows){const allocated=allocations.get(row.layer.id)||0;if(allocated>=row.capacity)continue;const score=row.layer.priority+row.layer.budget.weight/(allocated+1);if(score>bestScore){best=row;bestScore=score;}}if(!best)break;allocations.set(best.layer.id,(allocations.get(best.layer.id)||0)+1);remaining--;}
  const features=[],stats=[];for(const row of rows){const normalLimit=allocations.get(row.layer.id)||0,selected=row.selected,chosen=[...selected,...row.normal.slice(0,normalLimit)];features.push(...chosen);stats.push(freeze({layerId:row.layer.id,available:row.features.length,rendered:chosen.length,selected:selected.length,budget:normalLimit+selected.length}));}
  return {features,stats,totalBudget:total,requestedBudget:requestedTotal};
}

function createRegistry(options={}){
  const sources=new Map(),renderers=new Map(),layers=new Map();let sealed=false,registryRevision=0;
  function assertMutable(){if(sealed)throw new Error('map-registry-sealed');}
  function registerBundle(bundle={}){
    assertMutable();const nextSources=(Array.isArray(bundle.sources)?bundle.sources:[]).map(normalizeSource),nextRenderers=(Array.isArray(bundle.renderers)?bundle.renderers:[]).map(normalizeRenderer),nextLayers=(Array.isArray(bundle.layers)?bundle.layers:[]).map(normalizeLayer),sourceIds=new Set(),rendererIds=new Set(),layerIds=new Set();
    for(const source of nextSources){if(sources.has(source.id)||sourceIds.has(source.id))throw new Error(`map-source-duplicate:${source.id}`);sourceIds.add(source.id);}
    for(const renderer of nextRenderers){if(renderers.has(renderer.id)||rendererIds.has(renderer.id))throw new Error(`map-renderer-duplicate:${renderer.id}`);rendererIds.add(renderer.id);}
    for(const layer of nextLayers){if(layers.has(layer.id)||layerIds.has(layer.id))throw new Error(`map-layer-duplicate:${layer.id}`);layerIds.add(layer.id);if(!sources.has(layer.sourceId)&&!sourceIds.has(layer.sourceId))throw new Error(`map-layer-source-missing:${layer.id}`);if(!renderers.has(layer.rendererId)&&!rendererIds.has(layer.rendererId))throw new Error(`map-layer-renderer-missing:${layer.id}`);}
    for(const row of nextSources)sources.set(row.id,row);for(const row of nextRenderers)renderers.set(row.id,row);for(const row of nextLayers)layers.set(row.id,row);registryRevision++;
    return freeze({sources:freeze(nextSources),renderers:freeze(nextRenderers),layers:freeze(nextLayers),revision:registryRevision});
  }
  function registerSource(source){return registerBundle({sources:[source]}).sources[0];}
  function registerRenderer(renderer){return registerBundle({renderers:[renderer]}).renderers[0];}
  function registerLayer(layer){return registerBundle({layers:[layer]}).layers[0];}
  function seal(){for(const layer of layers.values()){if(!sources.has(layer.sourceId))throw new Error(`map-layer-source-missing:${layer.id}`);if(!renderers.has(layer.rendererId))throw new Error(`map-layer-renderer-missing:${layer.id}`);}sealed=true;return diagnostics();}
  function source(id){return sources.get(String(id||''))||null;}
  function renderer(id){return renderers.get(String(id||''))||null;}
  function layer(id){return layers.get(String(id||''))||null;}
  function listLayers(query={}){const category=String(query.category||''),companyId=String(query.companyId||'');return [...layers.values()].filter(row=>(!category||row.category===category)&&(!companyId||row.companyId===companyId)).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));}
  function filterOptions(context={}){return {state:context.state,companyIds:context.companyIds,companyRegistry:context.companyRegistry,companyPlatform:context.companyPlatform};}
  function filterStateFor(context={}){const input=context.filterState||FEATURE.DEFAULT_FILTER_STATE,registeredCategories={};for(const row of listLayers())registeredCategories[row.category]=Boolean(registeredCategories[row.category]||row.defaultVisible!==false);return FEATURE.normalizeFilterState({...input,categories:{...registeredCategories,...input.categories}},filterOptions(context));}
  function capabilityAllowed(layerDescriptor,companyId,context={}){if(!layerDescriptor.capability||!companyId)return true;const registry=context.companyRegistry||globalThis.GH_COMPANY_REGISTRY;if(registry?.hasCapability)return Boolean(registry.hasCapability(companyId,layerDescriptor.capability,context.state));const platform=context.companyPlatform||globalThis.GH_COMPANY_PLATFORM;if(platform?.hasCapability)return context.state?Boolean(platform.hasCapability(context.state,companyId,layerDescriptor.capability)):Boolean(platform.hasCapability(companyId,layerDescriptor.capability));return false;}
  function activeLayers(context={}){const zoom=Math.max(0,Math.min(24,Math.floor(finite(context.zoom,3)))),filterState=filterStateFor(context),visibilityOptions=filterOptions(context);return listLayers().filter(row=>zoom>=row.minZoom&&zoom<=row.maxZoom&&capabilityAllowed(row,row.companyId,context)&&FEATURE.layerVisible(filterState,row,visibilityOptions));}
  function sourceRows(descriptor,context){if(descriptor.query&&context.bounds)return descriptor.query(context.bounds,context);return descriptor.select?descriptor.select(context):[];}
  function layerFeatures(layerDescriptor,context,filterState){
    const sourceDescriptor=source(layerDescriptor.sourceId),rendererDescriptor=renderer(layerDescriptor.rendererId);if(!sourceDescriptor||!rendererDescriptor)throw new Error(`map-layer-dependency-missing:${layerDescriptor.id}`);
    const rows=ensureRows(sourceRows(sourceDescriptor,context),sourceDescriptor.id),features=[];
    for(const row of rows){let produced=sourceDescriptor.toFeatures?sourceDescriptor.toFeatures(row,{...context,layer:layerDescriptor,source:sourceDescriptor}):row;produced=Array.isArray(produced)?produced:[produced];for(const input of produced){if(!input)continue;const feature=FEATURE.createFeature({...input,layerId:layerDescriptor.id,category:input.category||layerDescriptor.category,companyId:input.companyId??layerDescriptor.companyId},{layerId:layerDescriptor.id,category:layerDescriptor.category,revision:sourceDescriptor.revision?sourceDescriptor.revision(row,context):'0'});if(!rendererDescriptor.geometryTypes.includes(feature.geometry.type))throw new Error(`map-renderer-geometry-mismatch:${layerDescriptor.id}:${feature.geometry.type}`);if(capabilityAllowed(layerDescriptor,feature.companyId,context)&&FEATURE.featureVisible(filterState,feature,layerDescriptor,filterOptions(context)))features.push(feature);}}
    return features.sort(stableFeatureSort);
  }
  function snapshot(context={}){
    const filterState=filterStateFor(context),rows=[],companyCounts={},categoryCounts={},layerCounts={};
    for(const layerDescriptor of activeLayers({...context,filterState}))try{const features=layerFeatures(layerDescriptor,context,filterState),selected=features.filter(row=>row.selected),normal=features.filter(row=>!row.selected);rows.push({layer:layerDescriptor,features,selected,normal,capacity:0});layerCounts[layerDescriptor.id]=features.length;for(const feature of features){countInto(companyCounts,feature.companyId||layerDescriptor.companyId);countInto(categoryCounts,feature.category);}}catch(error){throw new Error(`map-layer-snapshot-failed:${layerDescriptor.id}:${String(error?.message||error)}`);}
    const allocation=allocateFeatures(rows,context.renderBudget??options.renderBudget??DEFAULT_RENDER_BUDGET),features=allocation.features.sort((a,b)=>{const layerA=layer(a.layerId),layerB=layer(b.layerId);return (layerA?.order||0)-(layerB?.order||0)||stableFeatureSort(a,b);}),index=FEATURE.featureIndex(features);
    return freeze({version:VERSION,registryRevision,zoom:Math.max(0,Math.min(24,Math.floor(finite(context.zoom,3)))),filterState,features:freeze(features),index,layerStats:freeze(allocation.stats),counts:freeze({companies:freeze(companyCounts),categories:freeze(categoryCounts),layers:freeze(layerCounts)}),renderBudget:allocation.totalBudget,requestedRenderBudget:allocation.requestedBudget});
  }
  function reconcile(previous,next){const before=previous?.index||previous?.features||previous||[],after=next?.index||next?.features||next||[];return FEATURE.diffFeatures(before,after);}
  function legend(snapshotValue,context={}){
    const stats=new Map((snapshotValue?.layerStats||[]).map(row=>[row.layerId,row]));return freeze(listLayers().filter(row=>stats.has(row.id)&&stats.get(row.id).rendered>0).map(row=>{const identity=row.companyId&&globalThis.GH_IDENTITY?.resolve?.(context.state,row.companyId,{usage:'symbol'}),label=row.legend.label||identity?.mapLabel||row.id,rendererDescriptor=renderer(row.rendererId);return freeze({id:row.id,category:row.category,companyId:row.companyId,label,short:row.legend.short||identity?.short||'',glyph:row.legend.glyph,description:row.legend.description,count:stats.get(row.id).available,rendered:stats.get(row.id).rendered,sample:rendererDescriptor?.legendSample?.(row,context)||null});}));
  }
  function filterModel(snapshotValue,context={}){
    const filterState=snapshotValue?.filterState||FEATURE.normalizeFilterState(context.filterState||FEATURE.DEFAULT_FILTER_STATE),counts=snapshotValue?.counts||{companies:{},categories:{},layers:{}},registry=context.companyRegistry||globalThis.GH_COMPANY_REGISTRY,opened=new Set(Array.isArray(context.state?.openedCompanies)?context.state.openedCompanies:[]),companyIds=new Set([...opened,...Object.keys(counts.companies||{}),...filterState.companies.included,...filterState.companies.excluded]);
    const definitions=registry?.list?.({state:context.state,kind:'subsidiary'})||[];for(const row of definitions)if(opened.has(row.id)||(counts.companies?.[row.id]||0)>0)companyIds.add(row.id);
    const visibilityOptions=filterOptions(context),companies=[...companyIds].map(id=>{const identity=globalThis.GH_IDENTITY?.resolve?.(context.state,id,{usage:'symbol'}),enabled=FEATURE.companyVisible(filterState,id,visibilityOptions);return freeze({id,label:identity?.mapLabel||identity?.legal||id,short:identity?.short||id.toUpperCase(),logo:identity?.logo||null,known:identity?.known!==false,count:counts.companies?.[id]||0,enabled});}).sort((a,b)=>{const da=registry?.definition?.(a.id,context.state),db=registry?.definition?.(b.id,context.state);return (da?.order||9999)-(db?.order||9999)||a.id.localeCompare(b.id);});
    const categoryLabels={assets:'الأصول',routes:'المسارات',facilities:'المنشآت',infrastructure:'البنية العالمية'},categories=Object.keys(filterState.categories).map(id=>freeze({id,label:categoryLabels[id]||id,count:counts.categories?.[id]||0,enabled:filterState.categories[id]}));
    const optional=listLayers().filter(row=>row.defaultVisible===false||Object.prototype.hasOwnProperty.call(filterState.optionalLayers,row.id)).map(row=>freeze({id:row.id,label:row.legend.label||row.id,count:counts.layers?.[row.id]||0,enabled:FEATURE.layerVisible(filterState,row,visibilityOptions)}));
    return freeze({version:FEATURE.FILTER_STATE_VERSION,companies:freeze(companies),categories:freeze(categories),optional:freeze(optional),market:freeze({competitors:filterState.market.competitors}),activeCount:companies.filter(row=>row.enabled).length+categories.filter(row=>row.enabled).length+optional.filter(row=>row.enabled).length+Number(filterState.market.competitors)});
  }
  function diagnostics(){return freeze({version:VERSION,sealed,revision:registryRevision,sources:sources.size,renderers:renderers.size,layers:layers.size,sourceIds:freeze([...sources.keys()].sort()),rendererIds:freeze([...renderers.keys()].sort()),layerIds:freeze([...layers.keys()].sort())});}
  return freeze({VERSION,registerBundle,registerSource,registerRenderer,registerLayer,seal,source,renderer,layer,listLayers,activeLayers,snapshot,reconcile,legend,filterModel,diagnostics});
}

const defaultRegistry=createRegistry(),API=freeze({VERSION,DEFAULT_RENDER_BUDGET,createRegistry,defaultRegistry,registerBundle:defaultRegistry.registerBundle,registerSource:defaultRegistry.registerSource,registerRenderer:defaultRegistry.registerRenderer,registerLayer:defaultRegistry.registerLayer,seal:defaultRegistry.seal,source:defaultRegistry.source,renderer:defaultRegistry.renderer,layer:defaultRegistry.layer,listLayers:defaultRegistry.listLayers,activeLayers:defaultRegistry.activeLayers,snapshot:defaultRegistry.snapshot,reconcile:defaultRegistry.reconcile,legend:defaultRegistry.legend,filterModel:defaultRegistry.filterModel,diagnostics:defaultRegistry.diagnostics});
globalThis.GH_MAP_LAYER_REGISTRY=API;if(globalThis.window&&window!==globalThis)window.GH_MAP_LAYER_REGISTRY=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
