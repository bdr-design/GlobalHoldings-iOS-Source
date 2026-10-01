'use strict';
// Fleet Core v4.2 store (gh-fleet-store-v3, one 128-byte record per asset):
// exact ingest/materialize, write semantics, dead-row removal with stable rows,
// row-log rollback inside the real Transaction Core (scoped and full-snapshot,
// fuzzed against a plain reference model), row compaction, value reclamation,
// dirty-chunk tracking and 100k-row compactness.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),TX=global.GH_TRANSACTION_CORE;
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,1500)});}}
const json=value=>JSON.parse(JSON.stringify(value));
const canon=value=>{const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;return JSON.stringify(sort(json(value)));};
const live=store=>STORE.toAssets(store);
function truck(i,extra={}){return {id:`N-ROAD-${String(i).padStart(8,'0')}`,ownerCompanyId:'road',assetMode:'road',assetClass:'truck',operationProfileId:'fleet-route-road-v1',type:'road',icon:'🚛',name:`GH LOGISTICS ${100+i}`,catalogId:'U-T1',routeId:'ROAD-AUTO-00000001',baseFacility:'QA-PERF-ROAD-RUH',progress:i%7/7,fuel:100,phase:i%2?'moving':'turnaround',model:'Long Haul 24T',year:2021,condition:68,specs:{rangeKm:1800,speedKmh:90,capacity:24,capacityUnit:'طن'},ownership:'lease',monthlyLease:2177,leaseTermMonths:60,leaseStartSeconds:0,purchasePrice:92400,companyName:'QA Logistics',deliveryOrderId:'DEL-ROAD-1',requestRef:'R-1',paymentRef:'P-1',routeSignature:'road:sig',routeSlot:i%5,departureScheduled:i%2===0,deliveryStatus:'delivered',deliveredDay:0,deliveredAtSeconds:0,staffing:{mode:'automatic-fixed',ready:true,roles:[{id:'drivers',count:2}],total:2,monthlyPayroll:9000,contractId:'EMP-BATCH-1',provisionedAt:0,center:'RUH'},crewBlocked:false,releaseExclusiveRouteOnArrival:false,dwellRemaining:75+i,reverse:i%3===0,from:'A',to:'B',distanceKm:199.01,tripSeconds:10474.31,effectiveSpeedKmh:68.4,dwellHours:2.5,departureScheduledAt:75+i,load:'٢١ / ٢٤ طن',...extra};}

test('ingest -> materialize preserves every JSON value of real-shaped and adversarial assets',()=>{
 const assets=[truck(1),truck(2),truck(3,{name:'Custom name',id:'odd-id',salePending:true,saleStatus:'returning',simulationFault:{code:'X',at:5},lastMaintenanceAt:9}),
  truck(4,{progress:'0.5',routeSlot:1.5,reverse:'yes',phase:null,lastTrip:{revenue:1,margin:-0}}),truck(5,{specs:{...truck(5).specs,capacity:30}}),
  {id:'BARE-7'},{id:'007',name:'0',progress:-0,fuel:Infinity,condition:NaN},{id:'X-1',routeId:null,baseFacility:'',lastTransitionGuardDay:-3,departureScheduledAt:undefined},
  truck(8,{id:'N-ROAD-12345678901',flightHours:4,flightCycles:2.5,nextCheckHours:0.1,simCarrySeconds:12.25}),truck(9,{flightHours:1e9+0.5,name:'GH 4294967296'})];
 const store=STORE.fromAssets(assets,{at:100});
 for(let i=0;i<assets.length;i++){
  const expected=assets[i],got=STORE.materialize(store,i);
  for(const key of Object.keys(expected)){if(expected[key]===undefined){assert(!(key in got),`undefined ${key} must be absent`);continue;}if(typeof expected[key]==='number'&&!Number.isFinite(expected[key])){assert(Object.is(got[key],expected[key]),`${key} non-finite kept`);continue;}assert.equal(canon(got[key]),canon(expected[key]),`asset ${i} field ${key}`);}
  assert.equal(Object.keys(got).length,Object.keys(expected).filter(k=>expected[k]!==undefined).length,`asset ${i} has no extra fields`);
  assert.deepEqual(STORE.keys(store,i),Object.keys(got),`keys() order for asset ${i}`);
 }
 assert(Object.is(STORE.materialize(store,6).progress,-0),'-0 kept');
 assert.equal(STORE.indexOf(store,'N-ROAD-12345678901'),8,'an id beyond uint32 is found through extras');assert.equal(STORE.indexOf(store,'007'),6);
 const stats=STORE.stats(store);assert(stats.values<24,`profiles are shared: ${stats.values} values`);return stats;
});

test('materialized objects are independent copies of shared values',()=>{
 const store=STORE.fromAssets([truck(1),truck(2)]),a=STORE.materialize(store,0);a.specs.capacity=999;a.staffing.ready=false;
 assert.equal(STORE.materialize(store,1).specs.capacity,24);assert.equal(STORE.materialize(store,0).staffing.ready,true);
 return {independent:true};
});

test('set/get follow plain-object semantics and re-intern only the written asset',()=>{
 const store=STORE.fromAssets([truck(1),truck(2)]),shared=STORE.slot(store,'profile',0);assert.equal(STORE.slot(store,'profile',1),shared);
 STORE.set(store,0,'specs',{...truck(1).specs,capacity:50});assert.notEqual(STORE.slot(store,'profile',0),shared);assert.equal(STORE.slot(store,'profile',1),shared);assert.equal(STORE.get(store,1,'specs').capacity,24);
 STORE.set(store,0,'progress',0.75);assert.equal(STORE.get(store,0,'progress'),0.75);
 STORE.set(store,0,'progress','bad');assert.equal(STORE.get(store,0,'progress'),'bad');STORE.set(store,0,'progress',0.5);assert.equal(STORE.get(store,0,'progress'),0.5);assert.equal(STORE.materialize(store,0).progress,0.5);
 STORE.set(store,0,'flightHours',0.1);assert.equal(STORE.get(store,0,'flightHours'),0.1,'a value not exact in float32 is kept verbatim');STORE.set(store,0,'flightHours',4);assert.equal(STORE.get(store,0,'flightHours'),4);
 STORE.set(store,0,'departureScheduledAt',undefined);assert(!('departureScheduledAt' in STORE.materialize(store,0)));
 STORE.set(store,0,'saleStatus','returning');assert.equal(STORE.get(store,0,'saleStatus'),'returning');STORE.set(store,0,'saleStatus',undefined);assert.equal(STORE.get(store,0,'saleStatus'),undefined);
 STORE.set(store,0,'id','N-ROAD-00009999');assert.equal(STORE.indexOf(store,'N-ROAD-00009999'),0);assert.equal(STORE.indexOf(store,truck(1).id),-1);
 return {ok:true};
});

test('removal marks rows dead: rows never move, live order is array order, lookups skip them',()=>{
 const assets=Array.from({length:12},(_,i)=>truck(i,i%3===0?{saleStatus:`s${i}`}:{})),store=STORE.fromAssets(assets);
 const row5=STORE.indexOf(store,assets[5].id);
 assert.equal(STORE.removeMany(store,[7,2,2,11,5]),4);assert.equal(store.length,12);assert.equal(store.live,8);
 const expected=assets.filter((_,i)=>![2,5,7,11].includes(i));
 assert.equal(canon(live(store)),canon(expected));
 assert.equal(STORE.indexOf(store,assets[5].id),-1);assert.equal(STORE.isAlive(store,row5),false);
 assert.equal(STORE.indexOf(store,assets[6].id),6,'surviving rows keep their row');
 assert.throws(()=>STORE.remove(store,5),RangeError,'a dead row cannot be removed twice');assert.throws(()=>STORE.set(store,5,'note',1),RangeError);
 assert.equal(STORE.remove(store,0),true);assert.equal(store.live,7);
 const compacted=STORE.compactRows(store);assert.equal(compacted.removed,5);assert.equal(store.length,7);assert.equal(canon(live(store)),canon(expected.slice(1)));
 for(let i=0;i<7;i++)assert.equal(STORE.indexOf(store,expected[i+1].id),i,'ids are found at their compacted rows');
 return {length:store.length};
});

test('a failed transaction restores writes, adds, replacements, removals and mass column writes exactly',()=>{
 const state={fleet:STORE.fromAssets(Array.from({length:40},(_,i)=>truck(i,i%4===0?{note:`n${i}`}:{}))),cash:1},store=state.fleet;
 const before=canon(live(store)),at=Array.from({length:store.length},(_,i)=>STORE.slot(store,'at',i)),meta=[store.length,store.live,store.values.length];let seen=null;
 assert.throws(()=>TX.execute(state,{label:'fleet-rollback',scope:['cash'],apply:()=>{
  state.cash=2;STORE.set(store,30,'progress',0.11);STORE.add(store,truck(900));STORE.replace(store,8,truck(800,{note:'replaced'}),{at:5});
  STORE.removeMany(store,[0,3,4,39]);STORE.set(store,1,'specs',{capacity:7});
  STORE.rememberColumn(store,'fuel');for(let row=0;row<store.length;row++)STORE.setSlot(store,'fuel',row,1);
  for(let i=0;i<60;i++)STORE.add(store,truck(2000+i));STORE.replace(store,1,truck(801));seen={structure:store.structure,revision:store.revision};throw new Error('late');}}),/late/);
 assert.equal(state.cash,1);assert.deepEqual([store.length,store.live,store.values.length],meta);
 // Revision and structure only grow: no value seen inside the transaction is reused.
 assert(store.revision>seen.revision&&store.structure>seen.structure,'counters stay monotonic across a rollback');
 assert.equal(canon(live(store)),before);assert.deepEqual(Array.from({length:store.length},(_,i)=>STORE.slot(store,'at',i)),at);
 for(let i=0;i<40;i++)assert.equal(STORE.indexOf(store,truck(i).id),i);
 assert.equal(STORE.indexOf(store,truck(800).id),-1);assert.equal(STORE.indexOf(store,truck(900).id),-1);
 TX.execute(state,{label:'fleet-commit',scope:['cash'],apply:()=>{STORE.replace(store,5,truck(700,{saleStatus:'returning'}),{at:9});STORE.removeMany(store,[1]);}});
 assert.equal(STORE.indexOf(store,truck(700).id),5);assert.equal(STORE.get(store,5,'saleStatus'),'returning');assert.equal(STORE.slot(store,'at',5),9);assert.equal(STORE.indexOf(store,truck(1).id),-1);assert.equal(store.live,39);
 return {live:store.live};
});

test('a full-snapshot transaction restores the records, and the store and its lookups keep working',()=>{
 // No scope: Transaction Core restores a structured clone of the whole state
 // before the store's own undo runs; the records come back in a new buffer.
 const state={fleet:STORE.fromAssets(Array.from({length:30},(_,i)=>truck(i,i%3===0?{note:`n${i}`}:{}))),cash:1},store=state.fleet;
 STORE.indexOf(store,truck(3).id);const before=canon(live(store)),meta=[store.length,store.live,store.values.length];let seen=null;
 assert.throws(()=>TX.execute(state,{label:'fleet-full-snapshot',apply:()=>{
  state.cash=2;STORE.set(store,4,'progress',0.5);STORE.set(store,5,'specs',{capacity:3});STORE.add(store,truck(900));STORE.removeMany(store,[1]);
  STORE.rememberColumn(store,'fuel');for(let row=0;row<store.length;row++)STORE.setSlot(store,'fuel',row,1);
  for(let i=0;i<40;i++)STORE.add(store,truck(1000+i));seen={revision:store.revision,structure:store.structure};throw new Error('full-late');}}),/full-late/);
 assert.equal(state.fleet,store,'the store object keeps its identity');assert.equal(state.cash,1);
 assert.deepEqual([store.length,store.live,store.values.length],meta);assert.equal(canon(live(store)),before);
 assert(store.revision>seen.revision&&store.structure>seen.structure,'counters stay monotonic');
 for(let i=0;i<30;i++)assert.equal(STORE.indexOf(store,truck(i).id),i);
 assert.equal(STORE.indexOf(store,truck(900).id),-1);assert.equal(STORE.indexOf(store,truck(1005).id),-1);
 // Interning, writes and a scoped transaction work on the restored store.
 const ref=STORE.intern(store,'after-restore');assert.equal(STORE.value(store,ref),'after-restore');
 STORE.set(store,2,'note','after');assert.equal(STORE.get(store,2,'note'),'after');
 TX.execute(state,{label:'fleet-after-restore',scope:['cash'],apply:()=>{STORE.add(store,truck(950));state.cash=3;}});
 assert.equal(STORE.indexOf(store,truck(950).id),30);assert.equal(store.live,31);
 return {revision:store.revision,structure:store.structure};
});

test('fuzz: 400 random transactions (one in three fails) always equal a plain reference model',()=>{
 let seed=12345;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x80000000;};const pick=n=>Math.floor(rnd()*n);
 const base=Array.from({length:120},(_,i)=>truck(i,i%5===0?{note:`n${i}`}:{}));
 const state={fleet:STORE.fromAssets(base,{at:0}),cash:0},store=state.fleet;let model=json(base);
 const fields=['progress','fuel','condition','phase','routeId','note','specs','from','load','name','flightHours','salePending','routeSlot','id'];
 const valueFor=field=>{switch(field){case 'progress':case 'fuel':case 'condition':return rnd()<.1?'odd':rnd()*100;case 'phase':return ['moving','turnaround','idle',null][pick(4)];case 'routeId':return rnd()<.2?null:`R-${pick(9)}`;case 'note':return rnd()<.3?undefined:`x${pick(50)}`;case 'specs':return {capacity:pick(40),unit:'t'};case 'from':return `F${pick(7)}`;case 'load':return `${pick(30)} t`;case 'name':return `GH ${pick(1e6)}`;case 'flightHours':return rnd()<.5?pick(1000)*4:rnd();case 'salePending':return rnd()<.5?true:undefined;case 'routeSlot':return rnd()<.2?1.5:pick(64);default:return `N-ROAD-${String(100000+pick(1e6)).padStart(8,'0')}`;}};
 let failures=0,commits=0,maxRows=0;
 for(let tx=0;tx<400;tx++){
  const draft=json(model),liveRows=()=>{const rows=[];STORE.forEachLive(store,row=>rows.push(row));return rows;};
  const willFail=rnd()<1/3,ops=1+pick(25);
  try{TX.execute(state,{label:`fuzz-${tx}`,scope:['cash'],apply:()=>{
   for(let op=0;op<ops;op++){
    const rows=liveRows(),kind=pick(10);
    if(kind<5&&rows.length){const k=pick(rows.length),field=fields[pick(fields.length)],value=valueFor(field);STORE.set(store,rows[k],field,value);if(value===undefined)delete draft[k][field];else draft[k][field]=json(value);}
    else if(kind<7){const asset=truck(5000+tx*40+op,{note:`t${tx}`});STORE.add(store,asset,{at:tx});draft.push(json(asset));}
    else if(kind<8&&rows.length){const k=pick(rows.length);STORE.remove(store,rows[k]);draft.splice(k,1);}
    else if(kind<9&&rows.length){const k=pick(rows.length),asset=truck(9000+tx*40+op,{tag:tx});STORE.replace(store,rows[k],asset,{at:tx});draft[k]=json(asset);}
    else{STORE.rememberColumn(store,'condition');for(const row of rows){STORE.setSlot(store,'condition',row,tx);STORE.setSlot(store,'present',row,STORE.slot(store,'present',row)|STORE.HOT_BIT.condition);}for(const [k,row] of rows.entries()){if(STORE.slot(store,'flags',row)&STORE.EXTRAS&&STORE.extrasOf(store,row)?.condition!==undefined){draft[k].condition=STORE.get(store,row,'condition');}else draft[k].condition=tx;}}
    if(willFail&&op===ops-1)throw new Error('fuzz-fail');
   }}});commits++;model=draft;}
  catch(error){if(!/fuzz-fail/.test(String(error)))throw error;failures++;}
  assert.equal(canon(live(store)),canon(model),`transaction ${tx} (${willFail?'failed':'committed'})`);
  maxRows=Math.max(maxRows,store.length);
  if(tx%50===49){STORE.collectValues(store);STORE.compactRows(store);assert.equal(canon(live(store)),canon(model),`after maintenance ${tx}`);}
  for(let k=0;k<model.length;k+=17)if(typeof model[k].id==='string'&&model.findIndex(a=>a.id===model[k].id)===k){const row=STORE.indexOf(store,model[k].id);assert(row>=0&&STORE.idAt(store,row)===model[k].id,`lookup ${model[k].id}`);}
 }
 assert(failures>80&&commits>200);return {commits,failures,live:store.live,maxRows,values:store.values.length};
});

test('row compaction and value reclamation run only between transactions and keep every asset',()=>{
 const state={fleet:STORE.fromAssets(Array.from({length:30},(_,i)=>truck(i))),cash:0},store=state.fleet;
 for(let i=0;i<30;i++)STORE.set(store,i,'lastTrip',{revenue:i,margin:i/2});for(let i=0;i<30;i++)STORE.set(store,i,'lastTrip',{revenue:1,margin:2});
 STORE.removeMany(store,[3,4,5]);
 assert.throws(()=>TX.execute(state,{label:'gc-in-tx',scope:['cash'],apply:()=>{STORE.set(store,0,'note',1);STORE.collectValues(store);}}),/gc-inside-transaction/);
 assert.throws(()=>TX.execute(state,{label:'compact-in-tx',scope:['cash'],apply:()=>{STORE.set(store,0,'note',1);STORE.compactRows(store);}}),/compact-inside-transaction/);
 const before=canon(live(store)),gc=STORE.collectValues(store);assert(gc.freed>=30,`freed ${gc.freed}`);assert.equal(canon(live(store)),before);
 const valuesBefore=store.values.length;STORE.set(store,0,'lastTrip',{revenue:5});assert.equal(store.values.length,valuesBefore,'a reclaimed slot is reused');assert.equal(STORE.get(store,0,'lastTrip').revenue,5);
 // A transaction that reuses reclaimed slots and fails returns them to the free list.
 const snapshot=canon(live(store));
 assert.throws(()=>TX.execute(state,{label:'reuse-rollback',scope:['cash'],apply:()=>{let i=0;STORE.forEachLive(store,row=>{if(i<10)STORE.set(store,row,'lastTrip',{revenue:100+i++});});throw new Error('reuse-fail');}}),/reuse-fail/);
 assert.equal(canon(live(store)),snapshot);STORE.set(store,1,'lastTrip',{revenue:101});assert.equal(STORE.get(store,1,'lastTrip').revenue,101);
 const compacted=STORE.compactRows(store);assert.equal(compacted.removed,3);assert.equal(store.length,27);
 return {gc,compacted};
});

test('dirty chunks track exactly the rows written since the last checkpoint',()=>{
 const store=STORE.create();for(let i=0;i<STORE.CHUNK_ROWS*2+10;i++)STORE.add(store,{id:`N-AIR-${String(i).padStart(8,'0')}`,type:'air',ownerCompanyId:'air'});
 STORE.clearDirtyChunks(store);assert.deepEqual(STORE.dirtyChunks(store),[]);
 STORE.set(store,5,'progress',0.5);STORE.set(store,STORE.CHUNK_ROWS*2+3,'fuel',50);assert.deepEqual(STORE.dirtyChunks(store),[0,2]);
 STORE.clearDirtyChunks(store);STORE.rememberColumn(store,'condition');assert.deepEqual(STORE.dirtyChunks(store),[0,1,2],'a mass column write dirties every chunk');
 return {chunks:3};
});

test('100k rows stay compact and index lookups are fast',()=>{
 const base=truck(1),t0=performance.now(),store=STORE.create();for(let i=0;i<100000;i++)STORE.add(store,{...base,id:`N-ROAD-${String(i).padStart(8,'0')}`,name:`GH LOGISTICS ${100+i}`,progress:(i%100)/100});
 const built=performance.now()-t0,stats=STORE.stats(STORE.trimCapacity(store));const t1=performance.now();for(let i=0;i<1000;i++)assert.equal(STORE.indexOf(store,`N-ROAD-${String(i*97).padStart(8,'0')}`),i*97);
 assert(stats.bytesPerAsset<=130,`compact rows: ${stats.bytesPerAsset}`);assert(stats.values<10);return {buildMs:Math.round(built),lookupMs:Math.round(performance.now()-t1),...stats};
});

const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build356-fleet-store',passed,total:results.length,results},null,2));if(passed!==results.length)process.exitCode=1;
