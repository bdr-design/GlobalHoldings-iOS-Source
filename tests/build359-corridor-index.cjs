'use strict';
// Build 359 (a million assets): a 3,000-aircraft dispatch ran in blocks of 2 s and 0.5 s on the desktop. Every new
// route was compared with every route for a duplicate corridor (route-core conflict, fleet-core assign-routes-batch,
// depart-batch and the route centre's conflict check), and the assignment and departure of all aircraft ran in one
// command step each. Checked here:
// - GH_ROUTE_CORE.corridorIndex names every route a route may duplicate (exact or near, same or reverse direction),
//   including routes that share a hub, and conflict() returns what a full pass over the list returns;
// - routes leaving the same hubs are compared with far fewer routes than all of them;
// - the dispatch assigns and departs DISPATCH_CHUNK aircraft at a time, yielding the frame between chunks, and yields
//   after each new route.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness,ROOT}=require('./helpers/core-harness');
const {s}=harness(['route-core']);
const R=s.GH_ROUTE_CORE,results=[];
const test=(name,fn)=>{try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error?.stack||error).slice(0,2500)});}};
let seed=0x2468ace1;const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
// Hubs, destinations and a route between them (a few intermediate points), owned by one air company.
const hubs=[[25.25,55.36],[51.47,-.45],[40.64,-73.78],[1.36,103.99],[-33.94,151.18],[69.68,18.92],[64.13,-21.94],[-.2,179.9]];
const near=(point,km)=>[point[0]+(rnd()-.5)*km/55.6,point[1]+(rnd()-.5)*km/(55.6*Math.max(.05,Math.cos(point[0]*Math.PI/180)))];
let serial=0;
function route(from,to,{company='air',mode='air',jitterKm=0}={}){const a=jitterKm?near(from,jitterKm):from,b=jitterKm?near(to,jitterKm):to,mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];return {id:`R-${serial++}`,routeMode:mode,ownerCompanyId:company,route:[a,mid,b]};}
const routes=[];
for(let i=0;i<260;i++){const hub=hubs[i%hubs.length],dest=[(rnd()-.5)*150,(rnd()-.5)*350];routes.push(route(hub,dest));
  if(i%5===0)routes.push(route(hub,dest,{jitterKm:2}));                      // near duplicates
  if(i%7===0)routes.push(route(dest,hub,{jitterKm:1.5}));                    // reversed near duplicates
  if(i%11===0)routes.push({...route(hub,dest),route:routes.at(-1).route});    // exact geometry
}
const fullPass=(list,candidate,{ignoreId=null}={})=>{const exact=R.signature(candidate);for(const existing of list){if(!existing||existing.id===ignoreId)continue;if(existing.id===candidate.id)return {code:'duplicate-route-id',route:existing};if(exact&&R.signature(existing)===exact)return {code:'duplicate-route',route:existing};const metrics=R.corridorMetrics(existing,candidate);if(metrics.duplicate)return {code:'near-duplicate-route',route:existing,metrics};}return null;};

test('the index names every duplicate, and conflict() is the full pass',()=>{
  const index=R.corridorIndex(routes);let duplicates=0,compared=0;
  for(const a of routes){const named=new Set(index.candidates(a));compared+=named.size;for(const b of routes){if(a===b)continue;const m=R.corridorMetrics(b,a);if(m.duplicate||R.signature(a)===R.signature(b)){duplicates++;assert.ok(named.has(b),`${b.id} duplicates ${a.id} and is named`);}}}
  assert.ok(duplicates>40,`the set has duplicates (${duplicates})`);
  for(let i=0;i<routes.length;i++){const list=routes.slice(0,i),candidate=routes[i],want=fullPass(list,candidate),got=R.conflict(list,candidate);assert.equal(got?.code??null,want?.code??null,`code for ${candidate.id}`);assert.equal(got?.route?.id??null,want?.route?.id??null,`route for ${candidate.id}`);}
  const probe={...routes[3],id:routes[9].id};assert.equal(R.conflict(routes,probe).code,fullPass(routes,probe).code,'a reused id');
  assert.equal(R.conflict(routes,routes[4],{ignoreId:routes[4].id})?.route?.id??null,fullPass(routes,routes[4],{ignoreId:routes[4].id})?.route?.id??null,'ignoreId');
  return {routes:routes.length,duplicates,averageNamed:+(compared/routes.length).toFixed(1)};
});

test('routes from the same hubs are compared with few routes',()=>{
  const index=R.corridorIndex(routes),named=routes.map(r=>index.candidates(r).length),average=named.reduce((a,b)=>a+b,0)/named.length;
  assert.ok(average<routes.length/20,`on average ${average.toFixed(1)} of ${routes.length} routes are compared`);
  return {average:+average.toFixed(1),max:Math.max(...named)};
});

test('a list changed in place is indexed again',()=>{
  const list=routes.slice(0,50),extra=route(hubs[0],[10,10]);assert.equal(R.conflict(list,extra),null);
  list.push({...extra,id:'R-EXTRA'});assert.equal(R.conflict(list,extra)?.code,'duplicate-route','an appended route is seen');
  list[list.length-1]={...list[list.length-1],route:[[0,0],[0,1]]};assert.equal(R.conflict(list,extra),null,'a replaced geometry is seen');
  return {length:list.length};
});

test('the dispatch runs in chunks and yields after each new route',()=>{
  const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
  assert.match(app,/yieldFleetPlanning=\(\)=>new Promise\(resolve=>setTimeout\(resolve,0\)\),DISPATCH_CHUNK=500;/);
  assert.match(app,/for\(let from=0;from<batch\.length;from\+=DISPATCH_CHUNK\)\{\s*await yieldFleetPlanning\(\);const rows=batch\.slice\(from,from\+DISPATCH_CHUNK\),out=dispatch\('fleet','assign-routes-batch',\{assignments:rows,routes:chunkRoutes\(rows\)\}\)/);
  assert.match(app,/for\(let from=0;from<departures\.length;from\+=DISPATCH_CHUNK\)\{\s*await yieldFleetPlanning\(\);const rows=departures\.slice\(from,from\+DISPATCH_CHUNK\),out=dispatch\('fleet','depart-batch',\{departures:rows,routes:chunkRoutes\(rows\)\}\)/);
  assert.match(app,/for\(const asset of members\)assignments\.push\(\{asset,route\}\);\s*await yieldFleetPlanning\(\);/);
  assert.doesNotMatch(app,/dispatch\('fleet','assign-routes-batch',\{assignments:batch,routes:routeTable\}\)/,'no single assignment of the whole batch');
  return {chunk:500};
});

const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build359-corridor-index',passed,total:results.length,results},null,1));
if(passed!==results.length)process.exitCode=1;else console.log('BUILD359_CORRIDOR_INDEX_PASS');
