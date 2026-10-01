'use strict';
// Fleet data access (Build 355): one API over the legacy `assets` array and the
// columnar `fleet` store. Both representations must present the same assets,
// reject every mutation through a view, and produce the same fleet for the
// same sequence of writes; store writes checkpoint at the current time and
// roll back inside the real Transaction Core.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),EVENTS=require(path.join(ROOT,'WebApp/fleet-event-core.js')),FLEET=require(path.join(ROOT,'WebApp/fleet-access-core.js'));
const {fleet,context,resolveRoute,oldSlice,compareValue}=require('./helpers/fleet-fixture.js');
const TX=global.GH_TRANSACTION_CORE;
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,1500)});}}
const json=value=>JSON.parse(JSON.stringify(value));
const canon=value=>{const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;return JSON.stringify(sort(json(value)));};
// One legacy slice so every asset carries the slice-engine defaults, then both
// representations start from the same values at the same time.
function pair(t0=1000){
 const assets=fleet();oldSlice(assets,t0-1,t0);
 return {array:{assets,simSeconds:t0},store:{fleet:STORE.fromAssets(json(assets),{at:t0}),simSeconds:t0}};
}
function sameFleet(label,a,b,tol=1e-9){
 assert.equal(FLEET.size(a),FLEET.size(b),`${label}: size`);
 for(let i=0;i<FLEET.size(a);i++){const x=json(FLEET.viewAt(a,i)),y=json(FLEET.viewAt(b,i));assert.deepEqual(Object.keys(x).sort(),Object.keys(y).sort(),`${label}: keys of ${x.id}`);compareValue(`${label} ${x.id}`,x,y,tol);}
}

test('store views equal legacy array views asset by asset while the fleet runs',()=>{
 const {array,store}=pair();let t=array.simSeconds,checks=0;
 const pattern=[600,3600,45,1800,3600,777.7,3600];
 for(let slice=0;slice<pattern.length*3;slice++){
  const to=t+pattern[slice%pattern.length];oldSlice(array.assets,t,to);EVENTS.advance(store.fleet,{from:t,to,context:context(t),resolveRoute});
  array.simSeconds=store.simSeconds=to;t=to;sameFleet(`slice ${slice}`,array,store,1e-7);checks++;
 }
 // Between slices a store view derives the current position from its checkpoint.
 const index=FLEET.find(store,view=>view.phase==='moving'&&!view.simulationFault&&view.progress<0.5)?.id;assert(index,'a moving asset exists');
 const before=FLEET.get(store,index).progress;store.simSeconds+=60;const after=FLEET.get(store,index).progress;
 assert(after>before,'progress advances with time without any write');
 assert.equal(after,EVENTS.currentAsset(store.fleet,FLEET.indexOf(store,index),store.simSeconds,{resolveRoute}).progress);
 return {slices:checks,assets:FLEET.size(array)};
});

test('views are read-only in both representations but behave like plain objects for reads',()=>{
 const {array,store}=pair();
 for(const [label,state] of [['array',array],['store',store]]){
  const view=FLEET.viewAt(state,0);
  assert.throws(()=>{view.progress=1;},/fleet-view-read-only/,`${label}: assign`);
  assert.throws(()=>{delete view.name;},/fleet-view-read-only/,`${label}: delete`);
  assert.throws(()=>{view.specs.capacity=1;},/fleet-view-read-only/,`${label}: nested assign`);
  assert.throws(()=>{view.staffing.roles.push({id:'x'});},/fleet-view-read-only/,`${label}: nested array push`);
  assert.throws(()=>Object.defineProperty(view,'x',{value:1}),/fleet-view-read-only/,`${label}: define`);
  assert.throws(()=>structuredClone(view),`${label}: a view is never cloned by accident`);
  assert.equal(Object.prototype.hasOwnProperty.call(view,'specs'),true);assert.equal('routeId' in view,true);assert.equal('nope' in view,false);
  assert.equal(typeof view.hasOwnProperty,'function');assert.equal(view.nope,undefined);
  const spread={...view};assert.equal(spread.id,view.id);assert.equal(JSON.stringify(view),JSON.stringify(spread));
  assert.deepEqual(view.staffing.roles.map(role=>role.id),json(view.staffing.roles).map(role=>role.id));
  const copy=FLEET.plain(view);copy.specs.capacity=999;assert.notEqual(FLEET.viewAt(state,0).specs.capacity,999,`${label}: plain() is an independent copy`);
  assert.equal(FLEET.isView(view),true);assert.equal(FLEET.isView(copy),false);
 }
 return {ok:true};
});

test('the same writes produce the same fleet in both representations',()=>{
 const {array,store}=pair(),states=[array,store],first=FLEET.viewAt(array,0).id,third=FLEET.viewAt(array,2).id,last=FLEET.viewAt(array,FLEET.size(array)-1).id;
 for(const state of states){
  FLEET.update(state,first,{routeId:null,phase:'idle',note:'parked',specs:{capacity:7},departureScheduledAt:undefined});
  const draft=FLEET.plain(state,third);draft.name='Renamed';draft.condition=100;delete draft.lastTrip;FLEET.put(state,draft);
  FLEET.add(state,{...FLEET.plain(state,first),id:'N-ROAD-99999999',name:'Added'});
  assert.equal(FLEET.remove(state,last),true);assert.equal(FLEET.remove(state,'missing'),false);
  assert.equal(FLEET.removeMany(state,[FLEET.viewAt(state,5),FLEET.viewAt(state,6).id]),2);
  const removed=FLEET.removeWhere(state,view=>view.assetMode==='sea'&&view.salePending===true);assert(removed>0);
 }
 sameFleet('after writes',array,store);
 assert.equal(FLEET.get(store,first).note,'parked');assert.equal(FLEET.get(store,first).departureScheduledAt,undefined);assert(!('departureScheduledAt' in FLEET.get(store,first)));
 assert.equal(FLEET.get(store,third).name,'Renamed');assert.equal(FLEET.get(store,third).lastTrip,undefined);
 assert.equal(FLEET.ids(store).join(),FLEET.ids(array).join(),'order is preserved identically');
 return {size:FLEET.size(store)};
});

test('a store write checkpoints the row at the current time first',()=>{
 const {store}=pair(),id=FLEET.find(store,view=>view.phase==='moving'&&!view.simulationFault&&view.progress<0.3&&view.tripSeconds>3000)?.id;assert(id);
 const index=FLEET.indexOf(store,id),t0=store.simSeconds;
 store.simSeconds=t0+600;const moved=json(FLEET.get(store,id));
 FLEET.update(store,id,{condition:100});
 assert.equal(store.fleet.columns.at[index],t0+600,'checkpoint moved to now');
 assert.equal(STORE.get(store.fleet,index,'progress'),moved.progress,'derived progress written at the checkpoint');
 assert.equal(FLEET.get(store,id).condition,100);
 store.simSeconds=t0+1200;const later=FLEET.get(store,id);
 assert(later.progress>moved.progress);assert(later.condition<100,'condition wears from the new value, not from the old checkpoint');
 return {progress:later.progress,condition:later.condition};
});

test('store writes roll back inside Transaction Core and views follow their asset',()=>{
 const {store}=pair(),before=canon(STORE.toAssets(store.fleet)),at=Array.from(store.fleet.columns.at.subarray(0,store.fleet.length));
 store.cash=1;const keep=FLEET.viewAt(store,10),keepId=keep.id;
 assert.throws(()=>TX.execute(store,{label:'fleet-access-rollback',scope:['cash','simSeconds'],apply:()=>{
  store.cash=2;store.simSeconds+=900;FLEET.update(store,FLEET.viewAt(store,3),{condition:100,note:'x'});FLEET.remove(store,FLEET.viewAt(store,0));
  assert.equal(keep.id,keepId,'a view re-resolves its asset after a removal');
  FLEET.update(store,keep,{name:'Seen'});assert.equal(keep.name,'Seen','a view sees writes to its asset');
  FLEET.add(store,{id:'N-ROAD-77777777',type:'road'});FLEET.removeWhere(store,view=>view.assetMode==='air');throw new Error('late');}}),/late/);
 assert.equal(store.cash,1);assert.equal(canon(STORE.toAssets(store.fleet)),before);assert.deepEqual(Array.from(store.fleet.columns.at.subarray(0,store.fleet.length)),at);
 assert.equal(keep.id,keepId);assert.notEqual(keep.name,'Seen');
 return {ok:true};
});

test('a view from one state writes the same asset in another state (command drafts)',()=>{
 const {array,store}=pair();
 for(const state of [array,store]){
  const draft=structuredClone(state),view=FLEET.viewAt(state,4);
  FLEET.update(draft,view,{note:'draft-only'});
  assert.equal(FLEET.get(draft,view.id).note,'draft-only');assert.equal(FLEET.get(state,view.id).note,undefined,'the live state is untouched');
 }
 return {ok:true};
});

test('drafts let an in-place algorithm run unchanged and commit identically in both representations',()=>{
 const {array,store}=pair();
 for(const state of [array,store]){
  const rows=FLEET.drafts(state);
  // A legacy-style repair: reassign slots per route, park overflow, rename one.
  const byRoute=new Map();for(const asset of rows)if(asset.routeId){const list=byRoute.get(asset.routeId)||[];list.push(asset);byRoute.set(asset.routeId,list);}
  const parked=[];for(const list of byRoute.values()){list.sort((a,b)=>String(a.id).localeCompare(String(b.id)));list.forEach((asset,slot)=>{if(slot>=40){asset.routeId=null;asset.phase='idle';delete asset.departureScheduledAt;parked.push(asset);}else asset.routeSlot=slot;});}
  rows[0].name='Draft rename';assert.equal(rows[0].name,'Draft rename','a draft reads its own writes');
  assert.notEqual(FLEET.viewAt(state,0).name,'Draft rename','nothing is written before commit');
  assert.throws(()=>{rows[1].specs.capacity=1;},/fleet-view-read-only/,'nested values stay read-only');
  assert(parked.length>0);for(const asset of parked){assert.equal('departureScheduledAt' in asset,false,'a deleted field is absent from the draft');assert.equal(Object.keys(asset).includes('departureScheduledAt'),false);}
  const untouched=rows.findIndex((row,index)=>index>0&&!row.routeId&&!parked.includes(row));assert(untouched>0);
  assert.equal(JSON.stringify(rows[untouched]),JSON.stringify(FLEET.viewAt(state,untouched)),'an untouched draft serializes like its asset');
  const changed=FLEET.commit(state,rows);assert(changed>10);assert.equal(FLEET.commit(state,rows),0,'overlays are consumed by commit');
 }
 sameFleet('after draft commit',array,store);assert.equal(FLEET.viewAt(store,0).name,'Draft rename');
 return {routes:FLEET.size(store)};
});

const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build355-fleet-access',passed,total:results.length,results},null,2));if(passed!==results.length)process.exitCode=1;
