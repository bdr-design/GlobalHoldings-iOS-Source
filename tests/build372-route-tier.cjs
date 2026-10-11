'use strict';
// Build 372: route fields (routeId, releaseExclusiveRouteOnArrival) written in place move the store's routedVersions, not
// its identityVersions, so class tables over owner, id, mode, type or class survive the route releases of arriving
// aircraft. Every cached result must stay exactly what a fresh store computes: over 60 rounds of random writes (route
// fields in place and through extras, identity fields, engine fields, extras, adds, removals, a rolled-back journal),
// forEachClass over identity fields, over route fields and over both, distinctRefs and refRowTables of routeId and
// idCollisions equal the same calls on an uncached copy of the store; and a round of route writes alone leaves the
// identity class scan cached (its tables are not rebuilt).
const assert=require('node:assert/strict'),path=require('node:path');
const STORE=require(path.join(__dirname,'../WebApp/fleet-store-core.js')),FIX=require('./helpers/fleet-fixture');
const fleet=FIX.fleet(),assets=[];for(let i=0;i<70000;i++){const a=structuredClone(fleet[i%fleet.length]);a.id=`QA-${String(i).padStart(7,'0')}`;assets.push(a);}
const store=STORE.fromAssets(assets,{at:0});
const IDENTITY=['id','ownerCompanyId','companyId','assetMode','type','assetClass'],ROUTE=['ownerCompanyId','routeId','releaseExclusiveRouteOnArrival'],BOTH=[...IDENTITY,'routeId'];
const classes=(s,fields)=>{const out=[];STORE.forEachClass(s,fields,(row,count,info)=>out.push([row,count,info.index,info.members]));return JSON.stringify(out);};
const fresh=()=>STORE.importReplica(structuredClone(STORE.exportReplica(store)));
const tables=s=>JSON.stringify(STORE.refRowTables(s,'routeId').map(t=>({values:t.values,rows:t.rows.map(r=>[...r])})));
const all=s=>({identity:classes(s,IDENTITY),route:classes(s,ROUTE),both:classes(s,BOTH),distinct:JSON.stringify(STORE.distinctRefs(s,'routeId')),distinctWhere:JSON.stringify(STORE.distinctRefs(s,'routeId','type','air')),tables:tables(s),ids:JSON.stringify(STORE.idCollisions(s))});
let seed=11;const random=n=>{seed=(seed*1103515245+12345)>>>0;return seed%n;};
const live=()=>{const out=[];for(let i=0;i<store.length;i++)if(STORE.isAlive(store,i))out.push(i);return out;};
const routeIds=['R1','R2','A1','S1',null,'R-NEW-1'];
all(store);
for(let round=0;round<60;round++){
  const rows=live(),journal=round%7===3?STORE.beginJournal(store):null;
  for(let k=0;k<300;k++){const index=rows[random(rows.length)];STORE.set(store,index,'routeId',routeIds[random(routeIds.length)]);if(k%3===0)STORE.set(store,index,'releaseExclusiveRouteOnArrival',random(2)===1);}
  if(round%4===0){const index=rows[random(rows.length)];STORE.set(store,index,'routeId',{odd:'object route id'});}       // into extras
  if(round%5===0){const index=rows[random(rows.length)];STORE.set(store,index,'ownerCompanyId',['road','air','sea'][random(3)]);STORE.set(store,index,'assetClass','QA-CLASS');}
  if(round%6===0)STORE.set(store,rows[random(rows.length)],'id',STORE.idAt(store,rows[random(rows.length)]));
  for(let k=0;k<200;k++)STORE.set(store,rows[random(rows.length)],'condition',40+random(60));
  if(round%8===0)STORE.add(store,{...structuredClone(fleet[random(fleet.length)]),id:`QA-ADD-${round}`});
  if(round%9===0)STORE.removeMany(store,[rows[random(rows.length)]]);
  if(journal)STORE.rollbackJournal(journal);
  assert.deepEqual(all(store),all(fresh()),`round ${round}: every cached result equals a fresh store's`);
}
// Route writes alone: the identity class scan keeps its tables (a cached call returns at once).
{const rows=live();STORE.forEachClass(store,IDENTITY,()=>{});const before=STORE.staticSnapshot(store);
 for(let k=0;k<5000;k++)STORE.set(store,rows[random(rows.length)],'routeId',routeIds[random(4)]);
 const after=STORE.staticSnapshot(store);assert.deepEqual([...after.identity],[...before.identity],'identityVersions do not move with route writes');assert.notDeepEqual([...after.routed],[...before.routed]);
 const started=performance.now();const again=classes(store,IDENTITY),ms=performance.now()-started;assert.equal(again,classes(fresh(),IDENTITY));
 console.log(JSON.stringify({ok:true,rounds:60,identityScanAfterRouteWritesMs:+ms.toFixed(2)}));}
