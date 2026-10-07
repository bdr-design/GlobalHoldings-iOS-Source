'use strict';
// Independent acceptance gate for GH_MAP_PROXY_CORE. No browser, Leaflet or game state is involved.
const assert=require('node:assert/strict'),path=require('node:path');
const P=require(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp/map-proxy-core.js'));
const ids=rows=>rows.map(row=>row.id),counts=rows=>rows.reduce((map,row)=>(map.set(row.countryId,(map.get(row.countryId)||0)+1),map),new Map());

// A shared hard cap of 300 represents all 60 active countries; equal activity receives equal quotas.
const world=[];
for(let country=0;country<60;country++)for(let asset=0;asset<12;asset++)world.push({id:`C${String(country).padStart(2,'0')}-A${String(asset).padStart(2,'0')}`,countryId:`C${String(country).padStart(2,'0')}`,facilityId:`F${asset%3}`,ownerCompanyId:`O${asset%2}`,mode:asset%2?'air':'sea',routeId:`R${asset%4}`,lat:-70+country*2,lng:-170+asset*2,x:country*40+(asset%3)*8,y:asset*30});
const allocated=P.allocate(world,{limit:300,zoom:2,globalZoom:4,declutterRadius:0});
assert.equal(allocated.length,300);assert.equal(new Set(allocated.map(row=>row.countryId)).size,60);assert.deepEqual([...counts(allocated).values()].sort((a,b)=>a-b),Array(60).fill(5));

// Nested round-robin prevents one facility from consuming a country's prefix.
const local=[];for(const facilityId of ['A','B','C'])for(let i=0;i<5;i++)local.push({id:`${facilityId}-${i}`,countryId:'SA',facilityId,ownerCompanyId:`O${i%2}`,mode:i%2?'road':'air',routeId:`R${i%3}`,x:i*100+(facilityId.charCodeAt(0)-65)*10,y:i*80});
assert.deepEqual(P.allocate(local,{limit:6,declutterRadius:0}).map(row=>row.facilityId),['A','B','C','A','B','C']);

// The selected proxy is pinned even outside the padded viewport; padding admits a nearby edge candidate.
const viewportRows=[
  {id:'inside',countryId:'SA',lat:20,lng:40,x:0,y:0},{id:'padded',countryId:'SA',lat:20,lng:51,x:30,y:0},
  {id:'outside',countryId:'AE',lat:20,lng:80,x:60,y:0},{id:'selected',countryId:'US',lat:50,lng:-100,x:90,y:0}
];
const viewport=P.allocate(viewportRows,{limit:10,selectedId:'selected',viewport:{south:10,north:30,west:30,east:50},viewportPadding:2,declutterRadius:0});
assert.deepEqual(new Set(ids(viewport)),new Set(['selected','inside','padded']));assert.equal(viewport[0].id,'selected');
// App candidates expose geographic coordinates through `position`; absent direct lat/lng fields must not become 0,0.
const positionOnly=P.allocate([{id:'position-only',position:[20,40],countryId:'SA'}],{limit:1,viewport:{south:10,north:30,west:30,east:50},declutterRadius:0});
assert.deepEqual(ids(positionOnly),['position-only']);

// Dateline-crossing bounds include both +175 and -175, not Greenwich.
const dateline=[{id:'east',countryId:'KI',lat:0,lng:175},{id:'west',countryId:'FJ',lat:0,lng:-175},{id:'middle',countryId:'GH',lat:0,lng:0}];
assert.deepEqual(new Set(ids(P.allocate(dateline,{limit:10,viewport:{south:-10,north:10,west:170,east:-170}}))),new Set(['east','west']));

// Countryless international assets are represented by screen cells (and geographic cells when screen points do not
// exist), so open water and cross-border corridors cannot collapse into one unknown bucket.
const countryless=[{id:'s0',x:10,y:10},{id:'s1',x:150,y:10},{id:'g0',lat:0,lng:0},{id:'g1',lat:40,lng:80}];
assert.equal(P.allocate(countryless,{limit:4,screenCellSize:100,geographicCellSize:10,declutterRadius:0}).length,4);

// Stable IDs and all tie-breaks are independent of source-array order.
const forward=ids(P.allocate(world,{limit:137,declutterRadius:0})),reverse=ids(P.allocate(world.slice().reverse(),{limit:137,declutterRadius:0}));assert.deepEqual(reverse,forward);

// Decluttering scans past overlapping high-priority proxies and backfills up to the limit when space exists.
const crowded=[
  {id:'a',countryId:'SA',facilityId:'F',x:0,y:0},{id:'b',countryId:'SA',facilityId:'F',x:1,y:1},
  {id:'c',countryId:'SA',facilityId:'F',x:2,y:2},{id:'d',countryId:'SA',facilityId:'F',x:3,y:3},
  {id:'e',countryId:'SA',facilityId:'F',x:30,y:0},{id:'f',countryId:'SA',facilityId:'F',x:60,y:0},
  {id:'g',countryId:'SA',facilityId:'F',x:90,y:0},{id:'h',countryId:'SA',facilityId:'F',x:120,y:0}
];
assert.deepEqual(ids(P.allocate(crowded,{limit:4,declutterRadius:10})),['a','e','f','g']);

// A country's first-ranked point may overlap an earlier country; its next point becomes the representative.
const countryCollision=[
  {id:'A-0',countryId:'A',x:0,y:0},{id:'A-1',countryId:'A',x:60,y:0},
  {id:'B-0',countryId:'B',x:1,y:1},{id:'B-1',countryId:'B',x:30,y:0}
];
const represented=P.allocate(countryCollision,{limit:2,zoom:2,declutterRadius:10});assert.deepEqual(new Set(represented.map(row=>row.countryId)),new Set(['A','B']));assert.ok(ids(represented).includes('B-1'));

// Sqrt(activity) apportionment is fair: larger fleets gain seats sublinearly, not in direct proportion to size.
const uneven=[];for(const [country,total] of [['A',1],['B',4],['C',16]])for(let i=0;i<total;i++)uneven.push({id:`${country}-${i}`,countryId:country,facilityId:`F${i%2}`,x:i*20,y:country.charCodeAt(0)*20});
const fair=counts(P.allocate(uneven,{limit:12,declutterRadius:0}));assert.equal(fair.get('A'),1);assert.ok(fair.get('C')>fair.get('B')&&fair.get('B')>fair.get('A'));assert.ok(fair.get('C')<9,'the 16-asset country does not receive a linear share');
// Below global zoom there is no mandatory one-per-country reservation; the local viewport can spend both slots on the
// dense country. This also proves that the global-zoom switch is functional rather than documentary.
const localWeighted=P.allocate(uneven,{limit:2,zoom:10,globalZoom:4,declutterRadius:0});assert.deepEqual(new Set(localWeighted.map(row=>row.countryId)),new Set(['B','C']));

// Allocation is observational only.
const frozen=JSON.stringify(world);P.allocate(world,{limit:300,declutterRadius:5});assert.equal(JSON.stringify(world),frozen);
console.log(JSON.stringify({suite:'build359-map-geographic-budget',version:P.VERSION,cap:allocated.length,countries:60,selected:'pinned',viewport:'padded',dateline:'pass',stable:'pass',backfill:'pass',fairness:Object.fromEntries(fair)},null,2));
console.log('BUILD359_MAP_GEOGRAPHIC_BUDGET_PASS');
