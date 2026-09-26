'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const app=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8'),start=app.indexOf('  let routeCenterFleetCache=null;'),end=app.indexOf('\n  function renderRouteCenter(arg)',start);
assert(start>=0&&end>start,'the route-center revision cache is present');
const assets=Array.from({length:20000},(_,index)=>({id:`ASSET-${String(index).padStart(5,'0')}`,ownerCompanyId:`company-${index%5}`,type:index%3===0?'air':index%3===1?'sea':'road',baseFacility:`BASE-${index%100}`,routeId:index%4===0?`ROUTE-${index%900}`:null,phase:index%7===0?'moving':index%3===0?'turnaround':'idle',departureScheduled:index%11===0,salePending:index%37===0,deliveryStatus:index%43===0?'pending':'delivered',lastTrip:index%5===0?{margin:index,revenue:index*10}:null}));
let sourcePasses=0,revision=1;const facilities=new Map(Array.from({length:100},(_,index)=>[`BASE-${index}`,{id:`BASE-${index}`,iata:`A${index%16}`,icao:`ICAO-${index%16}`,code:`C${index%16}`}]));
const watchedAssets=new Proxy(assets,{get(target,key,receiver){if(key===Symbol.iterator){sourcePasses++;return Reflect.get(target,key,receiver);}return Reflect.get(target,key,receiver);}});
const context={
  state:{saveRevision:7,assets:watchedAssets},
  window:{GH_TRANSACTION_CORE:{revision:()=>revision},GH_MAP_STRUCTURE_REVISION:12},
  assetOwnerCompanyId:asset=>asset.ownerCompanyId,
  assetModeOf:asset=>asset.type,
  routeFacilityFor:(_state,id)=>facilities.get(String(id))||null,
};
const api=vm.runInNewContext(`(()=>{${app.slice(start,end)};return {routeCenterFleetSnapshot,routeCenterAssignableCandidates};})()`,context,{filename:'route-center-fleet-index.js'});
const first=api.routeCenterFleetSnapshot(),second=api.routeCenterFleetSnapshot();
assert.strictEqual(first,second,'a stable transaction revision reuses the read model');assert.equal(sourcePasses,1,'five company summaries and route buckets share one fleet pass');
for(const company of ['company-0','company-1','company-2','company-3','company-4']){
  const expected=assets.filter(asset=>asset.ownerCompanyId===company),summary=first.summaryByCompany.get(company);
  assert.equal(first.byCompany.get(company).length,expected.length);
  assert.equal(summary.total,expected.length);
  assert.equal(summary.assigned,expected.filter(asset=>asset.routeId).length);
  assert.equal(summary.idle,expected.filter(asset=>!asset.routeId).length);
  assert.equal(summary.moving,expected.filter(asset=>asset.phase==='moving'||asset.status==='moving').length);
  assert.equal(summary.movingPhase,expected.filter(asset=>asset.phase==='moving').length);
  assert.equal(summary.ready,expected.filter(asset=>asset.routeId&&asset.phase==='turnaround'&&!asset.departureScheduled).length);
  assert.deepEqual(JSON.parse(JSON.stringify(summary.idleAssets.map(asset=>asset.id))),expected.filter(asset=>!asset.routeId).slice(0,60).map(asset=>asset.id));
}
const route={fromFacility:'BASE-1',toFacility:'BASE-2'},candidateRows=api.routeCenterAssignableCandidates(first,'company-0',route);
const sameUnderlying=(a,b)=>{if(a===b)return true;const left=facilities.get(a),right=facilities.get(b);return Boolean((left?.iata&&left.iata===right?.iata)||(left?.icao&&left.icao===right?.icao)||(left?.code&&left.code===right?.code));};
const expectedRows=assets.filter(asset=>asset.ownerCompanyId==='company-0'&&!asset.routeId&&asset.phase!=='moving'&&!asset.salePending&&asset.deliveryStatus!=='pending'&&asset.baseFacility&&['BASE-1','BASE-2'].some(endpoint=>sameUnderlying(asset.baseFacility,endpoint)));
assert.deepEqual(JSON.parse(JSON.stringify(candidateRows.map(asset=>asset.id))),expectedRows.map(asset=>asset.id),'facility index retains source order and exact endpoint aliases');
revision++;const rebuilt=api.routeCenterFleetSnapshot();assert.notStrictEqual(rebuilt,first);assert.equal(sourcePasses,2,'a committed domain revision invalidates the read model once');
console.log(JSON.stringify({suite:'build340-route-center-index',assets:assets.length,companies:5,sourcePasses,routeBuckets:rebuilt.byCompanyRoute.size,environment:`Node ${process.version}; synthetic route-center DTOs; not iPhone performance`}));
console.log('PASS route center reuses a single revision-keyed fleet index for owner summaries, route assets, idle lists, and facility assignment candidates');
