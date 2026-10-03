'use strict';
// Route center read model (Build 340, reworked for Build 358's million-asset fleet): per company counts come from
// classes of rows, cached per fleet/transaction revision; the lists it shows (first idle assets, the cards' linked
// counters, manual-route candidates, facility-matched assignable candidates) come from row passes in row order.
// Every figure is checked against a brute-force pass over the plain assets, for a record store and a plain array fleet.

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),start=app.indexOf('  let routeCenterFleetCache=null;'),end=app.indexOf('\n  function renderRouteCenter(arg)',start);
assert(start>=0&&end>start,'the route-center revision cache is present');
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),FLEET=require(path.join(ROOT,'WebApp/fleet-access-core.js'));
const assets=Array.from({length:20000},(_,index)=>({id:`ASSET-${String(index).padStart(5,'0')}`,name:`GH ${index%250===0?'Falcon':'Unit'} ${index}`,catalogId:`CAT-${index%9}`,ownerCompanyId:`company-${index%5}`,type:index%3===0?'air':index%3===1?'sea':'road',baseFacility:`BASE-${index%100}`,routeId:index%4===0?`ROUTE-${index%900}`:null,phase:index%7===0?'moving':index%3===0?'turnaround':'idle',departureScheduled:index%11===0,salePending:index%37===0,deliveryStatus:index%43===0?'pending':'delivered',lastTrip:index%5===0?{margin:index*1.1,revenue:index*10.3}:null}));
const facilities=new Map(Array.from({length:100},(_,index)=>[`BASE-${index}`,{id:`BASE-${index}`,iata:`A${index%16}`,icao:`ICAO-${index%16}`,code:`C${index%16}`}]));
const sameUnderlying=(a,b)=>{if(a===b)return true;const left=facilities.get(a),right=facilities.get(b);return Boolean((left?.iata&&left.iata===right?.iata)||(left?.icao&&left.icao===right?.icao)||(left?.code&&left.code===right?.code));};
const normalizeSearch=value=>String(value||'').toLowerCase();
const ids=list=>JSON.parse(JSON.stringify(list.map(asset=>asset.id)));

function check(label,fleetState){
  let revision=1;
  const context={
    state:{saveRevision:7,simSeconds:0,...fleetState},
    window:{GH_TRANSACTION_CORE:{revision:()=>revision},GH_MAP_STRUCTURE_REVISION:12,GH_FLEET_DATA:FLEET},
    assetOwnerCompanyId:asset=>asset.ownerCompanyId,
    assetModeOf:asset=>asset.type,
    normalizeSearch,
    routeFacilityFor:(_state,id)=>facilities.get(String(id))||null,
  };
  const api=vm.runInNewContext(`(()=>{${app.slice(start,end)};return {routeCenterFleetSnapshot,routeCenterLinkedSummary,routeCenterManualAssets,routeCenterFillAssignable};})()`,context,{filename:'route-center-fleet-index.js'});
  const first=api.routeCenterFleetSnapshot(),second=api.routeCenterFleetSnapshot();
  assert.strictEqual(first,second,`${label}: a stable revision reuses the read model`);
  for(const company of ['company-0','company-1','company-2','company-3','company-4']){
    const expected=assets.filter(asset=>asset.ownerCompanyId===company),summary=first.summaryByCompany.get(company);
    const ready=asset=>asset.deliveryStatus!=='pending'&&asset.phase!=='moving'&&!asset.departureScheduled&&!asset.salePending;
    assert.equal(summary.total,expected.length);
    assert.equal(summary.assigned,expected.filter(asset=>asset.routeId).length);
    assert.equal(summary.idle,expected.filter(asset=>!asset.routeId).length);
    assert.equal(summary.moving,expected.filter(asset=>asset.phase==='moving'||asset.status==='moving').length);
    assert.equal(summary.movingPhase,expected.filter(asset=>asset.phase==='moving').length);
    assert.equal(summary.ready,expected.filter(asset=>asset.routeId&&asset.phase==='turnaround'&&!asset.departureScheduled).length);
    assert.equal(summary.internationalReady,expected.filter(asset=>['air','sea'].includes(asset.type)&&ready(asset)).length);
    assert.equal(summary.manualReady,expected.filter(ready).length);
    assert.deepEqual(ids(summary.idleAssets),expected.filter(asset=>!asset.routeId).slice(0,60).map(asset=>asset.id),`${label}: first idle assets in row order`);
    // Route cards: counters per route equal the former per-card filters and reduces over the linked assets.
    const routeIds=[...new Set(expected.filter(asset=>asset.routeId).map(asset=>asset.routeId))].slice(0,80),cards=api.routeCenterLinkedSummary(company,routeIds);
    for(const routeId of routeIds){
      const linked=expected.filter(asset=>asset.routeId===routeId),scored=linked.filter(asset=>asset.lastTrip),card=cards.get(routeId);
      assert.equal(card.count,linked.length);assert.equal(card.primaryId,linked[0].id);
      assert.equal(card.turn,linked.filter(asset=>asset.phase==='turnaround'&&!asset.departureScheduled).length);
      assert.equal(card.scheduled,linked.filter(asset=>asset.phase==='turnaround'&&asset.departureScheduled).length);
      assert.equal(card.inMotion,linked.filter(asset=>asset.phase==='moving').length);
      assert.equal(card.scored,scored.length);
      assert.equal(card.margin,scored.reduce((n,asset)=>n+(Number(asset.lastTrip.margin)||0),0),`${label}: margin sum in row order`);
      assert.equal(card.revenue,scored.reduce((n,asset)=>n+(Number(asset.lastTrip.revenue)||0),0),`${label}: revenue sum in row order`);
    }
    assert.equal(api.routeCenterLinkedSummary(company,[]).size,0);
    // Manual route candidates: ready assets matching the search, in row order, up to the limit.
    for(const [needle,limit] of [['',40],['falcon',5],['cat-3',12],['nothing',10]])
      assert.deepEqual(ids(api.routeCenterManualAssets(company,needle,limit)),expected.filter(asset=>ready(asset)&&(!needle||normalizeSearch(`${asset.name} ${asset.id} ${asset.catalogId}`).includes(needle))).slice(0,limit).map(asset=>asset.id),`${label}: manual candidates ${needle}`);
  }
  // Assignable candidates: facility aliases match either route end, source order, a limit and a "more" flag per card.
  const idle=asset=>asset.ownerCompanyId==='company-0'&&!asset.routeId&&asset.phase!=='moving'&&!asset.salePending&&asset.deliveryStatus!=='pending'&&asset.baseFacility;
  const cards=[{r:{fromFacility:'BASE-1',toFacility:'BASE-2'},wantsAssignable:true,assignable:[],assignableMore:false},{r:{fromFacility:'BASE-40',toFacility:'BASE-77'},wantsAssignable:true,assignable:[],assignableMore:false},{r:{fromFacility:'BASE-3',toFacility:'BASE-3'},wantsAssignable:false,assignable:[],assignableMore:false}];
  const accept=(asset,card)=>card.r.fromFacility!=='BASE-40'||asset.type!=='sea';
  api.routeCenterFillAssignable(first,'company-0',cards,accept,25);
  for(const card of cards.slice(0,2)){
    const all=assets.filter(asset=>idle(asset)&&[card.r.fromFacility,card.r.toFacility].some(endpoint=>sameUnderlying(asset.baseFacility,endpoint))&&accept(asset,card));
    assert.deepEqual(ids(card.assignable),all.slice(0,25).map(asset=>asset.id),`${label}: facility index retains source order and exact endpoint aliases`);
    assert.equal(card.assignableMore,all.length>25);
  }
  assert.equal(cards[2].assignable.length,0,'a card that does not want candidates gets none');
  revision++;const rebuilt=api.routeCenterFleetSnapshot();assert.notStrictEqual(rebuilt,first,`${label}: a committed domain revision invalidates the read model`);
  const plainSummaries=snapshot=>JSON.parse(JSON.stringify([...snapshot.summaryByCompany].map(([k,v])=>[k,{...v,idleAssets:ids(v.idleAssets)}])));
  assert.deepEqual(plainSummaries(rebuilt),plainSummaries(first));
}

check('record store',{fleet:STORE.fromAssets(assets,{at:0})});
check('plain array',{assets:assets.map(asset=>({...asset}))});
console.log(JSON.stringify({suite:'build340-route-center-index',assets:assets.length,companies:5,environment:`Node ${process.version}; synthetic route-center DTOs; not iPhone performance`}));
console.log('PASS route center counts per class of rows and lists rows in row order (record store and plain array): owner summaries, idle lists, route card counters, manual and facility-matched candidates');
