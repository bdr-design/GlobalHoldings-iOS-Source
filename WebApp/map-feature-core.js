(()=>{'use strict';
const VERSION='GH-MAP-FEATURE-334.0.0',FILTER_STATE_VERSION=1;
const ID_PATTERN=/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,159}$/;
const GEOMETRY_TYPES=Object.freeze(['Point','LineString','MultiLineString']);
const BASE_CATEGORIES=Object.freeze(['assets','routes','facilities','infrastructure']);

function deepFreeze(value,seen=new Set()){
  if(!value||typeof value!=='object'||seen.has(value))return value;seen.add(value);
  for(const child of Object.values(value))deepFreeze(child,seen);return Object.freeze(value);
}
function uniqueStrings(value){return [...new Set((Array.isArray(value)?value:[]).map(item=>String(item||'').trim()).filter(Boolean))].sort();}
function finite(value){return typeof value==='number'&&Number.isFinite(value);}
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}
function safeId(value,label='id'){const id=String(value||'').trim();if(!ID_PATTERN.test(id))throw new Error(`map-feature-${label}-invalid`);return id;}
function normalizeLongitude(value){const number=Number(value);if(!Number.isFinite(number))return NaN;return ((number+180)%360+360)%360-180;}
function point(value){
  if(!Array.isArray(value)||value.length<2)return null;const longitude=normalizeLongitude(value[0]),latitude=Number(value[1]);
  return Number.isFinite(longitude)&&Number.isFinite(latitude)&&latitude>=-90&&latitude<=90?[longitude,latitude]:null;
}
function normalizeGeometry(input){
  if(!input||typeof input!=='object'||!GEOMETRY_TYPES.includes(input.type))throw new Error('map-feature-geometry-type-invalid');
  if(input.type==='Point'){const coordinates=point(input.coordinates);if(!coordinates)throw new Error('map-feature-point-invalid');return Object.freeze({type:'Point',coordinates:Object.freeze(coordinates)});}
  if(input.type==='LineString'){
    const coordinates=(Array.isArray(input.coordinates)?input.coordinates:[]).map(point);if(coordinates.length<2||coordinates.some(row=>!row))throw new Error('map-feature-line-invalid');
    return Object.freeze({type:'LineString',coordinates:Object.freeze(coordinates.map(row=>Object.freeze(row)))});
  }
  const coordinates=(Array.isArray(input.coordinates)?input.coordinates:[]).map(line=>(Array.isArray(line)?line:[]).map(point));
  if(!coordinates.length||coordinates.some(line=>line.length<2||line.some(row=>!row)))throw new Error('map-feature-multiline-invalid');
  return Object.freeze({type:'MultiLineString',coordinates:Object.freeze(coordinates.map(line=>Object.freeze(line.map(row=>Object.freeze(row)))))});
}

const MARKER_GEOMETRY=deepFreeze({
  hitSize:44,selectedVisualSize:28,canvasHitRadius:22,
  bands:[
    {id:'strategic',minZoom:0,maxZoom:3,point:6,vehicle:6,facility:6,cluster:20,routeWeight:1},
    {id:'regional',minZoom:4,maxZoom:5,point:8,vehicle:6,facility:20,cluster:22,routeWeight:1.25},
    {id:'network',minZoom:6,maxZoom:8,point:12,vehicle:18,facility:20,cluster:24,routeWeight:1.5},
    {id:'operational',minZoom:9,maxZoom:12,point:16,vehicle:20,facility:22,cluster:24,routeWeight:1.8},
    {id:'street',minZoom:13,maxZoom:24,point:18,vehicle:20,facility:22,cluster:24,routeWeight:2}
  ]
});
function zoomBand(zoom){const value=clamp(Math.floor(Number(zoom)||0),0,24);return MARKER_GEOMETRY.bands.find(row=>value>=row.minZoom&&value<=row.maxZoom)||MARKER_GEOMETRY.bands[MARKER_GEOMETRY.bands.length-1];}
function markerGeometry(zoom,options={}){
  const band=zoomBand(zoom),kind=['point','vehicle','facility','cluster'].includes(options.kind)?options.kind:'point',hitSize=MARKER_GEOMETRY.hitSize;
  const visualSize=options.selected?MARKER_GEOMETRY.selectedVisualSize:band[kind],offset=(hitSize-visualSize)/2;
  return deepFreeze({band:band.id,kind,hitSize,visualSize,visualOffset:[offset,offset],visualAnchor:[visualSize/2,visualSize/2],visualBounds:[offset,offset,offset+visualSize,offset+visualSize],iconSize:[hitSize,hitSize],iconAnchor:[hitSize/2,hitSize/2],canvasHitRadius:MARKER_GEOMETRY.canvasHitRadius,routeWeight:band.routeWeight,cssTokens:{'--marker-hit-size':`${hitSize}px`,'--marker-visual-size':`${visualSize}px`,'--marker-visual-offset':`${offset}px`}});
}

function createFeature(input={},defaults={}){
  const id=safeId(input.id,'id'),layerId=safeId(input.layerId||defaults.layerId,'layer-id'),category=String(input.category||defaults.category||'').trim();
  if(!category||!ID_PATTERN.test(category))throw new Error('map-feature-category-invalid');
  const geometry=normalizeGeometry(input.geometry),companyId=input.companyId==null?null:String(input.companyId).trim()||null,revision=String(input.revision??defaults.revision??'0');
  const feature={id,layerId,key:`${layerId}:${id}`,category,companyId,geometry,revision,status:String(input.status||''),selected:Boolean(input.selected),priority:Number.isFinite(Number(input.priority))?Number(input.priority):0,label:String(input.label||''),a11yLabel:String(input.a11yLabel||input.label||''),styleToken:String(input.styleToken||''),dataRef:input.dataRef==null?null:String(input.dataRef)};
  return Object.freeze(feature);
}
function featureKey(feature){return `${safeId(feature?.layerId,'layer-id')}:${safeId(feature?.id,'id')}`;}
function featureIndex(features){
  const index=new Map();for(const input of Array.isArray(features)?features:[]){const feature=input?.key?input:createFeature(input);if(index.has(feature.key))throw new Error(`map-feature-duplicate:${feature.key}`);index.set(feature.key,feature);}return index;
}
function diffFeatures(previous,next){
  const before=previous instanceof Map?previous:featureIndex(previous),after=next instanceof Map?next:featureIndex(next),added=[],updated=[],removed=[],unchanged=[];
  for(const [key,feature] of after){const old=before.get(key);if(!old)added.push(feature);else if(old.revision!==feature.revision||old.selected!==feature.selected||old.styleToken!==feature.styleToken)updated.push({before:old,after:feature});else unchanged.push(feature);}
  for(const [key,feature] of before)if(!after.has(key))removed.push(feature);
  return Object.freeze({added:Object.freeze(added),updated:Object.freeze(updated),removed:Object.freeze(removed),unchanged:Object.freeze(unchanged),next:after});
}

const DEFAULT_FILTER_STATE=deepFreeze({
  version:FILTER_STATE_VERSION,
  companies:{mode:'all',included:[],excluded:[]},
  categories:{assets:true,routes:true,facilities:true,infrastructure:false},
  optionalLayers:{},market:{competitors:false}
});
function copyBooleanRecord(value,defaults={}){const output={...defaults};if(value&&typeof value==='object')for(const [key,enabled] of Object.entries(value))if(ID_PATTERN.test(key))output[key]=Boolean(enabled);return output;}
function configuredCompanyIds(options={}){
  const explicit=options.companyIds??options.knownCompanyIds;if(explicit){const rows=typeof explicit==='function'?explicit(options.state):explicit;return new Set(uniqueStrings(rows instanceof Set?[...rows]:rows));}
  const registry=options.companyRegistry||globalThis.GH_COMPANY_REGISTRY;if(registry?.list){const rows=registry.list({state:options.state,includeGroup:true});return new Set(rows.map(row=>String(row?.id||'')).filter(Boolean));}
  const platform=options.companyPlatform||globalThis.GH_COMPANY_PLATFORM;if(platform?.companyIds){const ids=platform.companyIds({includeGroup:true});if(options.state&&platform.listInstances)for(const row of platform.listInstances(options.state,{includeGroup:true}))ids.push(row.id);return new Set(uniqueStrings(ids));}
  const definitions=globalThis.GH_COMPANY_DEFINITIONS;if(definitions?.list)return new Set(definitions.list().map(row=>String(row?.id||'')).filter(Boolean));
  return new Set();
}
function knownCompany(companyId,options={}){const id=String(companyId||'').trim();if(!id)return false;if(Object.prototype.hasOwnProperty.call(options,'companyIds')||Object.prototype.hasOwnProperty.call(options,'knownCompanyIds'))return configuredCompanyIds(options).has(id);const registry=options.companyRegistry||globalThis.GH_COMPANY_REGISTRY;if(registry?.has)return Boolean(registry.has(id,options.state));const platform=options.companyPlatform||globalThis.GH_COMPANY_PLATFORM;if(platform?.isKnownCompany)return Boolean(platform.isKnownCompany(id,options.state));return configuredCompanyIds(options).has(id);}
function normalizeFilterState(input={},options={}){
  if(!input||typeof input!=='object')input={};
  if(!input.companies&&options.legacyActiveFilter!==undefined)return legacyFilterState(options.legacyActiveFilter,options.legacyShowCompetitors,options);
  const sourceCompanies=input.companies&&typeof input.companies==='object'?input.companies:{},mode=sourceCompanies.mode==='include'?'include':'all',included=uniqueStrings(sourceCompanies.included),excluded=uniqueStrings(sourceCompanies.excluded).filter(id=>!included.includes(id));
  return deepFreeze({
    version:FILTER_STATE_VERSION,companies:{mode,included,excluded},categories:copyBooleanRecord(input.categories,DEFAULT_FILTER_STATE.categories),optionalLayers:copyBooleanRecord(input.optionalLayers),market:{competitors:Boolean(input.market?.competitors)}
  });
}
function legacyFilterState(activeFilter='all',showCompetitors=false,options={}){
  const filter=String(activeFilter||'all'),companies={mode:'all',included:[],excluded:[]},categories={assets:true,routes:true,facilities:true,infrastructure:false},optionalLayers={};
  if(filter==='facility'){categories.assets=false;categories.routes=false;}
  else if(filter==='airport'||filter==='port'){categories.assets=false;categories.routes=false;categories.facilities=true;categories.infrastructure=true;optionalLayers[`infrastructure:${filter}`]=true;}
  else if(configuredCompanyIds(options).has(filter)){companies.mode='include';companies.included=[filter];categories.facilities=false;}
  else if(filter!=='all'){companies.mode='include';categories.assets=false;categories.routes=false;categories.facilities=false;categories.infrastructure=false;}
  return normalizeFilterState({companies,categories,optionalLayers,market:{competitors:Boolean(showCompetitors)}});
}
function companyVisible(filterState,companyId,options={}){
  const filter=normalizeFilterState(filterState),id=String(companyId||'');if(!id)return true;
  if(!knownCompany(id,options))return false;
  if(filter.companies.mode==='include')return filter.companies.included.includes(id);return !filter.companies.excluded.includes(id);
}
function categoryVisible(filterState,category){const filter=normalizeFilterState(filterState),key=String(category||'');return Object.prototype.hasOwnProperty.call(filter.categories,key)?filter.categories[key]:false;}
function layerVisible(filterState,layer={},options={}){
  const filter=normalizeFilterState(filterState),id=String(layer.id||layer.layerId||'');
  const hasOverride=Object.prototype.hasOwnProperty.call(filter.optionalLayers,id);if(hasOverride&&!filter.optionalLayers[id])return false;
  if(layer.market==='competitor'&&!filter.market.competitors)return false;
  return (layer.defaultVisible!==false||hasOverride)&&categoryVisible(filter,layer.category)&&companyVisible(filter,layer.companyId,options);
}
function featureVisible(filterState,feature,layer={},options={}){return layerVisible(filterState,{...layer,category:feature?.category||layer.category,companyId:feature?.companyId||layer.companyId},options);}

function featurePoint(feature){return feature?.geometry?.type==='Point'?feature.geometry.coordinates:null;}
function normalizeBounds(bounds={}){
  const rawSouth=Number(bounds.south),rawNorth=Number(bounds.north),rawWest=Number(bounds.west),rawEast=Number(bounds.east);if(![rawSouth,rawNorth,rawWest,rawEast].every(Number.isFinite))throw new Error('map-spatial-bounds-invalid');
  const south=clamp(rawSouth,-90,90),north=clamp(rawNorth,-90,90),west=rawWest===180?180:normalizeLongitude(rawWest),east=rawEast===180?180:normalizeLongitude(rawEast);
  if(south>north)throw new Error('map-spatial-bounds-invalid');return {south,west,north,east};
}
class SpatialGridIndex{
  constructor(options={}){this.cellDegrees=clamp(options.cellDegrees||5,.25,30);this.cells=new Map();this.features=new Map();this.lastQuery=Object.freeze({visitedCells:0,visitedCandidates:0,returned:0});}
  _cell(latitude,longitude){const y=Math.floor((clamp(latitude,-90,90)+90)/this.cellDegrees),x=Math.floor((normalizeLongitude(longitude)+180)/this.cellDegrees);return `${x}:${y}`;}
  insert(input){const feature=input?.key?input:createFeature(input),coordinates=featurePoint(feature);if(!coordinates)throw new Error('map-spatial-point-required');if(this.features.has(feature.key))throw new Error(`map-spatial-duplicate:${feature.key}`);const key=this._cell(coordinates[1],coordinates[0]),bucket=this.cells.get(key)||[];bucket.push(feature);this.cells.set(key,bucket);this.features.set(feature.key,feature);return feature;}
  load(features){const replacement=new SpatialGridIndex({cellDegrees:this.cellDegrees});for(const feature of Array.isArray(features)?features:[])replacement.insert(feature);this.cells=replacement.cells;this.features=replacement.features;this.lastQuery=replacement.lastQuery;return this;}
  clear(){this.cells.clear();this.features.clear();this.lastQuery=Object.freeze({visitedCells:0,visitedCandidates:0,returned:0});}
  query(rawBounds,options={}){
    const bounds=normalizeBounds(rawBounds),rawLimit=options.limit===undefined?this.features.size:Number(options.limit),limit=Math.max(0,Math.floor(Number.isFinite(rawLimit)?rawLimit:0)),predicate=typeof options.filter==='function'?options.filter:()=>true,ranges=bounds.east>=bounds.west?[[bounds.west,bounds.east]]:[[bounds.west,180],[-180,bounds.east]],seen=new Set(),result=[];let visitedCells=0,visitedCandidates=0;
    const minY=Math.floor((bounds.south+90)/this.cellDegrees),maxY=Math.floor((bounds.north+90)/this.cellDegrees);
    for(const [west,east] of ranges){const minX=Math.floor((west+180)/this.cellDegrees),maxX=Math.floor((east+180)/this.cellDegrees);for(let x=minX;x<=maxX&&result.length<limit;x++)for(let y=minY;y<=maxY&&result.length<limit;y++){
      visitedCells++;for(const feature of this.cells.get(`${x}:${y}`)||[]){visitedCandidates++;if(seen.has(feature.key))continue;seen.add(feature.key);const coordinates=featurePoint(feature),longitude=coordinates[0],latitude=coordinates[1],insideLongitude=bounds.east>=bounds.west?longitude>=bounds.west&&longitude<=bounds.east:longitude>=bounds.west||longitude<=bounds.east;if(latitude<bounds.south||latitude>bounds.north||!insideLongitude||!predicate(feature))continue;result.push(feature);if(result.length>=limit)break;}
    }}
    this.lastQuery=Object.freeze({visitedCells,visitedCandidates,returned:result.length});return Object.freeze(result);
  }
  stats(){return Object.freeze({features:this.features.size,cells:this.cells.size,cellDegrees:this.cellDegrees,lastQuery:this.lastQuery});}
}
function createSpatialIndex(features=[],options={}){return new SpatialGridIndex(options).load(features);}

const API=Object.freeze({VERSION,FILTER_STATE_VERSION,GEOMETRY_TYPES,BASE_CATEGORIES,MARKER_GEOMETRY,DEFAULT_FILTER_STATE,normalizeLongitude,normalizeGeometry,zoomBand,markerGeometry,createFeature,featureKey,featureIndex,diffFeatures,configuredCompanyIds,knownCompany,normalizeFilterState,legacyFilterState,companyVisible,categoryVisible,layerVisible,featureVisible,SpatialGridIndex,createSpatialIndex});
globalThis.GH_MAP_FEATURE_CORE=API;if(globalThis.window&&window!==globalThis)window.GH_MAP_FEATURE_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
