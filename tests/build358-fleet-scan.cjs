'use strict';
// Build 358 (million-asset): the read and write primitives that replace one view per asset on recurring paths.
//  - GH_FLEET_DATA.scan / scanStages: one reused row per asset with exactly what a view presents (derived phase,
//    progress, fuel, condition, dwell at the state's time; stored values otherwise), STOP and row ranges.
//  - distinctRefs, countByPhase / presentedPhase, idAtRow: equal to their per-view definitions.
//  - GH_FLEET_STORE.columnWriter: leaves rows exactly as set() would, journals each column once (lazily), rolls back.
//  - null in i32 slots (routeSlot:null no longer puts every purchased asset in extras).
//  - forEachClass per-chunk tables and the idCollisions cache: equal to a fresh scan after every kind of write.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),EVENTS=require(path.join(ROOT,'WebApp/fleet-event-core.js'));
const FLEET=require(path.join(ROOT,'WebApp/fleet-access-core.js')),TX=global.GH_TRANSACTION_CORE;
const {fleet,context,resolveRoute}=require('./helpers/fleet-fixture.js');
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,1600)});}}

const CHUNK=STORE.CHUNK_ROWS,template=fleet(),ordinary=template.filter(a=>['A1','S1','R1'].includes(a.routeId)&&!a.salePending&&!a.simulationFault&&a.phase);
function build(count){
  const assets=template.slice();
  for(let i=0;assets.length<count;i++){
    const a=structuredClone(ordinary[Math.floor(i/700)%ordinary.length]);a.id=`SC-${String(i).padStart(7,'0')}`;a.name=`GH SC ${i}`;a.progress=(i%89)/89;a.condition=60+(i%40);
    if(i%13===0)a.routeSlot=null;if(i%997===0)a.note=`x${i}`;if(i%1499===0)a.flightHours=0.1*i;if(i%31===0)delete a.dwellRemaining;
    assets.push(a);
  }
  return assets;
}
FLEET.configure({resolveRoute:id=>resolveRoute(id)});
const ALL_FIELDS=[...new Set([...STORE.HOT_FIELDS.map(([name])=>name),...STORE.PROFILE_FIELDS,...STORE.BINDING_FIELDS,'simulationFault','salePending','note','status','companyId','missingField'])];
const canonical=value=>JSON.stringify(value===undefined?'<undefined>':value);
function compareScanToViews(state,label){
  const viewRows=[];FLEET.forEach(state,(view,index)=>{const row={};for(const field of ALL_FIELDS)row[field]=canonical(view[field]);viewRows.push([index,row]);});
  const scanned=[];FLEET.scan(state,ALL_FIELDS,(row,index)=>{const copy={};for(const field of ALL_FIELDS)copy[field]=canonical(row[field]);scanned.push([index,copy]);});
  assert.equal(scanned.length,viewRows.length,`${label}: rows`);
  for(let k=0;k<viewRows.length;k++){assert.equal(scanned[k][0],viewRows[k][0],`${label}: row order`);for(const field of ALL_FIELDS)assert.equal(scanned[k][1][field],viewRows[k][1][field],`${label}: row ${viewRows[k][0]} ${field}`);}
  return viewRows.length;
}

test('scan presents exactly what views present (store and plain assets, before and after time moves)',()=>{
  const assets=build(4000),store={simSeconds:0,fleet:STORE.fromAssets(assets,{at:0})},plain={simSeconds:0,assets:structuredClone(assets)};
  let rows=compareScanToViews(store,'store t=0')+compareScanToViews(plain,'plain');
  for(const t of [700,5000,30000]){store.simSeconds=t;rows+=compareScanToViews(store,`store t=${t}`);}
  EVENTS.advance(store.fleet,{from:0,to:30000,context:context(0),resolveRoute,order:'sweep'});store.simSeconds=41000;rows+=compareScanToViews(store,'after advance');
  return {rows};
});
test('STOP, row ranges and scanStages',()=>{
  const state={simSeconds:0,fleet:STORE.fromAssets(build(CHUNK+500),{at:0})},seen=[];
  const next=FLEET.scan(state,['id'],(row,index)=>{seen.push(index);if(seen.length===10)return FLEET.STOP;});assert.equal(seen.length,10);assert.equal(next,seen[9]+1);
  const ranged=[];FLEET.scan(state,['id'],(row,index)=>{ranged.push(index);},{from:100,to:200});assert.equal(ranged[0],100);assert(ranged.every(index=>index>=100&&index<200));
  let labels=0,visited=0;const stages=FLEET.scanStages(state,['id'],()=>{visited++;},1000,'slice');for(let step=stages.next();!step.done;step=stages.next())labels++;
  assert.equal(visited,FLEET.size(state));assert.equal(labels,Math.ceil(state.fleet.length/1000)-1);
  let stopped=0;const stopping=FLEET.scanStages(state,['id'],()=>{stopped++;if(stopped===1500)return FLEET.STOP;},1000);while(!stopping.next().done){}assert.equal(stopped,1500,'STOP ends a staged scan');
  return {labels,visited};
});
test('distinctRefs, countByPhase, presentedPhase and idAtRow equal their per-view definitions',()=>{
  const assets=build(9000),states=[{simSeconds:0,fleet:STORE.fromAssets(assets,{at:0})},{simSeconds:0,assets:structuredClone(assets)}];
  for(const state of states){
    for(const where of [null,['type','air'],['type','sea']]){const expected=new Set();FLEET.forEach(state,a=>{if(a.routeId&&(!where||a[where[0]]===where[1]))expected.add(a.routeId);});assert.deepEqual([...FLEET.distinctRefs(state,'routeId',where)],[...expected],`routes ${where}`);}
    const bases=new Set();FLEET.forEach(state,a=>{if(a.baseFacility)bases.add(a.baseFacility);});assert.deepEqual([...FLEET.distinctRefs(state,'baseFacility')],[...bases]);
    const phases=new Map();FLEET.forEach(state,a=>phases.set(a.phase,(phases.get(a.phase)||0)+1));assert.deepEqual([...FLEET.countByPhase(state)].sort(),[...phases].sort());
    FLEET.forEach(state,(a,index)=>{if(index%97===0)assert.equal(FLEET.idAtRow(state,index),a.id);});
  }
  return {routes:FLEET.distinctRefs(states[0],'routeId').size};
});
test('null routeSlot lives in the slot; the integer INT32_MIN still round-trips through extras',()=>{
  const assets=build(200);assets[150].routeSlot=-2147483648;assets[151].routeSlot=null;assets[152].routeSlot=5;
  const store=STORE.fromAssets(assets,{at:0});
  assert.equal(STORE.extrasOf(store,151),null,'null routeSlot needs no extras');
  assert.deepEqual(STORE.extrasOf(store,150),{routeSlot:-2147483648},'INT32_MIN is kept exactly in extras');
  const back=STORE.toAssets(store);for(const k of [150,151,152])assert.equal(back[k].routeSlot,assets[k].routeSlot);
  STORE.set(store,152,'routeSlot',null);assert.equal(STORE.peek(store,152,'routeSlot'),null);assert.equal(STORE.extrasOf(store,152),null);
  return {extrasRows:assets.filter((a,i)=>STORE.extrasOf(store,i)).length};
});
test('columnWriter leaves rows as set() would, journals lazily and rolls back exactly',()=>{
  const assets=build(CHUNK+300),viaSet=STORE.fromAssets(assets,{at:0}),viaColumn=STORE.fromAssets(assets,{at:0});
  const values=index=>[(index%7)*1.5,index%11===0?0.1:index%5,index%3===0?undefined:600];
  for(let index=0;index<viaSet.length;index+=3){const [h,c,n]=values(index);STORE.set(viaSet,index,'flightHours',h);STORE.set(viaSet,index,'flightCycles',c);if(n!==undefined)STORE.set(viaSet,index,'nextCheckHours',n);}
  const write=STORE.columnWriter(viaColumn,['flightHours','flightCycles','nextCheckHours']);
  for(let index=0;index<viaColumn.length;index+=3){const [h,c,n]=values(index);write(index,'flightHours',h);write(index,'flightCycles',c);if(n!==undefined)write(index,'nextCheckHours',n);}
  assert.equal(JSON.stringify(STORE.toAssets(viaColumn)),JSON.stringify(STORE.toAssets(viaSet)),'same assets');
  for(let index=0;index<viaSet.length;index+=101)assert.deepEqual(STORE.extrasOf(viaColumn,index),STORE.extrasOf(viaSet,index));
  // Rollback inside a transaction restores every row; a writer that writes nothing changes nothing.
  const state={simSeconds:0,fleet:STORE.fromAssets(assets,{at:0})},before=JSON.stringify(STORE.toAssets(state.fleet));
  assert.throws(()=>TX.execute(state,{label:'columns',scope:['fleet'],apply:()=>{const put=FLEET.columnWriter(state,['flightHours','flightCycles']);for(let index=0;index<state.fleet.length;index++)put(index,'flightHours',index*2);throw new Error('rollback');}}),/rollback/);
  assert.equal(JSON.stringify(STORE.toAssets(state.fleet)),before,'rolled back exactly');
  const revision=state.fleet.revision;FLEET.columnWriter(state,['flightHours']);assert.equal(state.fleet.revision,revision,'an unused writer journals nothing');
  // Presence bits set through the column (not reported to the engine) leave the engine exactly where set() would.
  const a={simSeconds:0,fleet:STORE.fromAssets(assets,{at:0})},b={simSeconds:0,fleet:STORE.fromAssets(assets,{at:0})};
  EVENTS.advance(a.fleet,{from:0,to:3000,context:context(0),resolveRoute,order:'sweep'});EVENTS.advance(b.fleet,{from:0,to:3000,context:context(0),resolveRoute,order:'sweep'});
  TX.execute(a,{label:'set',scope:['fleet'],apply:()=>{for(let index=0;index<a.fleet.length;index+=2)STORE.set(a.fleet,index,'flightCycles',index%9);}});
  TX.execute(b,{label:'column',scope:['fleet'],apply:()=>{const put=FLEET.columnWriter(b,['flightCycles']);for(let index=0;index<b.fleet.length;index+=2)put(index,'flightCycles',index%9);}});
  for(const s of [a,b])EVENTS.advance(s.fleet,{from:3000,to:90000,context:context(3000),resolveRoute,order:'sweep'});
  assert.equal(JSON.stringify(STORE.toAssets(b.fleet)),JSON.stringify(STORE.toAssets(a.fleet)),'the engine continues identically');
  return {rows:viaSet.length};
});
test('class tables per chunk and the id check stay equal to a fresh scan after every kind of write',()=>{
  const state={simSeconds:0,fleet:STORE.fromAssets(build(CHUNK*3+777),{at:0})},store=state.fleet;
  const SETS=[[['id','ownerCompanyId','companyId','assetMode','type','assetClass'],[]],[['baseFacility'],[]],[['phase','routeId','simulationFault'],[]],[['id','name','assetMode','type','ownerCompanyId','companyId','baseFacility','phase','progress','fuel','condition','routeId','releaseExclusiveRouteOnArrival','note'],['progress','fuel','condition']]];
  const emit=(s,[fields,numeric])=>{const out=[];STORE.forEachClass(s,fields,(row,count,info)=>out.push([JSON.stringify(row),count,info.index,info.members]),{numeric});return JSON.stringify(out);};
  let checks=0,freedTotal=0;
  const DISTINCT=[['routeId',null],['baseFacility',null],['routeId','type','road'],['baseFacility','ownerCompanyId','sea']];
  const check=label=>{
    const fresh=structuredClone(store);for(const set of SETS){assert.equal(emit(store,set),emit(fresh,set),`${label}: ${set[0].join(',')}`);checks++;}assert.deepEqual(STORE.idCollisions(store),STORE.idCollisions(fresh),`${label}: ids`);
    for(const [field,whereField,whereValue] of DISTINCT)assert.deepEqual(STORE.distinctRefs(store,field,whereField,whereValue),STORE.distinctRefs(fresh,field,whereField,whereValue),`${label}: distinct ${field} ${whereField}`);
    for(let row=0;row<store.length;row+=997)if(STORE.isAlive(store,row)){const id=STORE.idAt(store,row);assert.equal(STORE.indexOf(store,id),STORE.indexOf(fresh,id),`${label}: id lookup ${id}`);}
  };
  const rnd=(()=>{let x=12345;return n=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)%n;};})();
  check('initial');
  for(let round=0;round<8;round++){
    EVENTS.advance(store,{from:state.simSeconds,to:state.simSeconds+1800+rnd(4000),context:context(state.simSeconds),resolveRoute,order:'sweep'});state.simSeconds+=6000;check(`advance ${round}`);
    for(let k=0;k<5;k++){const row=rnd(store.length);if(STORE.isAlive(store,row))STORE.set(store,row,['baseFacility','ownerCompanyId','phase','type','routeId'][k],k===2?'idle':k===0?'B2':k===1?'sea':k===3?'road':null);}check(`set ${round}`);
    if(round%3===0){STORE.rememberColumn(store,'condition');for(let r=0;r<store.length;r+=7)STORE.setSlot(store,'condition',r,50+(r%50));check(`column ${round}`);}
    try{TX.execute(state,{label:'rb',scope:['fleet'],apply:()=>{for(let k=0;k<50;k++)STORE.set(store,rnd(store.length),'baseFacility','B9');throw new Error('rollback');}});}catch{}check(`rollback ${round}`);
    // Daily maintenance frees values no live row holds (old lastTrip objects, ids of removed rows): caches stay valid.
    const gc=STORE.collectValues(store);freedTotal+=gc.freed;check(`gc ${round} (${gc.freed} freed)`);
    for(let k=0;k<3;k++){const row=rnd(store.length);if(STORE.isAlive(store,row))STORE.set(store,row,'routeId',`R-NEW-${round}-${k}`);}check(`reuse after gc ${round}`);
    if(round%4===1){for(let k=0;k<300;k++){const a=structuredClone(ordinary[k%ordinary.length]);a.id=`ADD-${round}-${k}`;STORE.add(store,a);}check(`add ${round}`);STORE.removeMany(store,Array.from({length:200},(_,k)=>k*37%store.length));check(`remove ${round}`);STORE.compactRows(store);check(`compact ${round}`);}
    if(round===5){const row=rnd(store.length),other=(row+1)%store.length;STORE.set(store,row,'id',STORE.idAt(store,other));assert.equal(STORE.idCollisions(store).duplicate,true,'a duplicated id is found');check('duplicate id');STORE.set(store,row,'id',`FIXED-${row}`);check('id fixed');}
  }
  assert.ok(freedTotal>0,'maintenance freed values during the run');
  return {checks,rows:store.length,freedTotal};
});

test('idLists: a run list equals the array it stands for, read for read',()=>{
  const L=FLEET.idLists;let seed=7;const rand=n=>{seed=(seed*1103515245+12345)%2147483648;return seed%n;};
  const series=(p,from,n,w=0)=>Array.from({length:n},(_,k)=>p+(w?String(from+k).padStart(w,'0'):String(from+k)));
  const cases=[
    series('N-AIR-',1,500,8),series('X',1,300),series('A-',90,40,4).concat(series('A-',990,30,4),series('A-',1000,40)),
    series('Z',4294967200,96).concat(['alpha','beta'],series('Q',7,80)),series('X1',2345678901,70),
    [...series('R',1,40),'R40','solo',...series('R',41,60)],[...series('D',1,70),'',...series('D',70,10)],
    Array.from({length:200},(_,k)=>k%3?`L${rand(50)}`:`free-${k}`),series('N-',0,64,2).concat(series('N-',100,20)),
  ];
  for(let k=0;k<6;k++){const out=[];let n=0;while(out.length<300){const len=1+rand(40),w=rand(3)?0:3+rand(4);out.push(...series(`P${rand(3)}-`,n,len,w));n+=len+rand(3);if(!rand(5))out.push(`lit-${rand(9)}`);}cases.push(out);}
  let compact=0;
  for(const ids of cases){
    const list=L.of(ids);if(!Array.isArray(list))compact++;
    assert.ok(L.is(list)&&L.valid(list),'a written list is valid');assert.deepEqual(L.toArray(list),ids);assert.equal(L.length(list),ids.length);
    const seen=[];L.forEach(list,(id,index)=>seen.push([id,index]));assert.deepEqual(seen,ids.map((id,index)=>[id,index]));
    for(let i=0;i<ids.length;i++){assert.equal(L.at(list,i),ids[i]);assert.equal(L.indexOf(list,ids[i]),ids.indexOf(ids[i]),`indexOf ${ids[i]}`);}
    for(const probe of ['N-AIR-00000000','N-AIR-501','A-0089','A-999','A-1070','Z4294967296','R0','nope','X0',''])assert.equal(L.indexOf(list,probe),ids.indexOf(probe),`absent ${probe}`);
    assert.equal(L.at(list,ids.length),undefined);assert.equal(L.at(list,-1),undefined);
    assert.equal(L.hasDuplicate(list),new Set(ids).size!==ids.length);assert.equal(L.hasEmpty(list),ids.some(id=>!id));
    for(const index of [0,1,Math.floor(ids.length/2),ids.length-2,ids.length-1]){const fewer=L.without(list,index),expected=ids.slice();expected.splice(index,1);assert.ok(L.valid(fewer));assert.deepEqual(L.toArray(fewer),expected);assert.deepEqual(L.toArray(list),ids,'without leaves the list as it was');}
    assert.deepEqual(JSON.parse(JSON.stringify(list)),list,'a list is plain JSON');
  }
  assert.ok(compact>=8,`numbered lists become runs (${compact}/${cases.length})`);
  assert.equal(L.of(series('S',1,63)).length,63,'short lists stay arrays');
  for(const bad of [{$ids:[['N-',0,1,1]]},{$ids:[['N-',11,1,5]]},{$ids:[['N-AIR-',3,1,2000]]},{$ids:[['N-',4,9998,5]]},{$ids:[['N-',0,4294967290,10]]},{$ids:[7]},{$ids:[['N-',0,-1,3]]},{$ids:[],extra:1},{ids:[]}])assert.equal(L.valid(bad),false,JSON.stringify(bad));
  assert.equal(L.hasDuplicate({$ids:[['N-',0,1,10],['N-',0,10,5]]}),true,'overlapping runs');
  assert.equal(L.hasDuplicate({$ids:[['N-',0,1,10],'N-7']}),true,'a literal inside a run');
  assert.equal(L.hasDuplicate({$ids:[['N-',3,1,10],'N-7']}),false,'a padded run does not hold the unpadded id');
  return {cases:cases.length,compact};
});
test('a crew contract kept as a run releases its assets through a new run, saves and loads exactly',()=>{
  const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
  const e=scenario(),s=e.s,state=e.state,F=s.GH_FLEET_DATA,L=F.idLists;e.load('migration-core');e.load('state-codec-core');e.load('persistence-core');
  state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e7;const base=state.globalBases.find(r=>r.id==='B1');base.deliveryCapacity=1e7;const item=e.item;
  const buy=(qty,order)=>s.GH_TRANSACTION_CORE.execute(state,{label:`crew-runs-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{const r=e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty,manual:true,requestRef:`CREW-RUNS-${order}`,upfront:item.price*qty,totalPrice:item.price*qty,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});s.GH_REALISM.onSimulationTime(state,state.simSeconds);return r;})});
  assert.equal(buy(120,1).committed,true);
  const contract=state.advanced.labor.employmentContracts.find(c=>c.automaticAssetStaffing&&c.assetCount===120),hire=state.advanced.labor.hiringLog.find(h=>h.deliveryOrderId===contract.deliveryOrderId),delivery=state.realism.procurement.deliveries.find(d=>d.id===contract.deliveryOrderId);
  for(const list of [contract.assetIds,hire.assetIds,delivery.assetIds])assert.equal(list.$ids.length,1,'one purchase is one run');
  const ids=L.toArray(contract.assetIds),perAsset=contract.count/120,victims=[ids[0],ids[60],ids[61],ids[119]];
  for(const id of victims){const committed=s.GH_TRANSACTION_CORE.execute(state,{label:`crew-runs-sell-${id}`,apply:()=>e.command('fleet','sell',{id,proceeds:1000})});assert.equal(committed.committed,true,String(committed.reason||committed.error));}
  const left=ids.filter(id=>!victims.includes(id));
  assert.deepEqual(L.toArray(contract.assetIds),left);assert.equal(contract.assetCount,116);assert.equal(contract.assetId,left[0]);assert.equal(contract.count,perAsset*116);assert.equal(contract.status,'ساري');
  assert.ok(L.valid(contract.assetIds)&&contract.assetIds.$ids.length===2,'the run splits where assets left');
  assert.deepEqual(L.toArray(delivery.assetIds),ids,'the receipt keeps every delivered id');
  s.GH_FLEET_CORE.execute({state},'reconcile-staffing',{});assert.deepEqual(L.toArray(contract.assetIds),left,'reconcile keeps the members');
  assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true,(s.GH_SAVE_SCHEMA.validate(state).errors||[]).join(','));
  const saved=s.GH_PERSISTENCE.writeState('crew-runs',state);assert.equal(saved.ok,true,saved.reason);
  const loaded=s.GH_PERSISTENCE.recoverBrowserState('crew-runs');assert.equal(loaded.ok,true,loaded.reason);
  assert.equal(JSON.stringify(loaded.state.advanced.labor),JSON.stringify(state.advanced.labor),'crew lists load exactly');
  assert.equal(JSON.stringify(loaded.state.realism.procurement.deliveries),JSON.stringify(state.realism.procurement.deliveries),'receipts load exactly');
  const migrated=s.GH_MIGRATION_CORE.migrateFleet(loaded.state);assert.equal(JSON.stringify(migrated.state.advanced.labor),JSON.stringify(state.advanced.labor),'migration leaves run lists as they are');
  // Corrupt lists are refused by the save check.
  const bad=JSON.parse(JSON.stringify(state.realism.procurement.deliveries));
  const corrupt=(mutate)=>{const copy={...state,realism:{...state.realism,procurement:{...state.realism.procurement,deliveries:JSON.parse(JSON.stringify(bad))}}};mutate(copy.realism.procurement.deliveries.find(d=>d.id===delivery.id));return s.GH_SAVE_SCHEMA.validate(copy);};
  for(const [label,mutate] of [['overlap',d=>{d.assetIds={$ids:[...d.assetIds.$ids,['N-AIR-',8,5,2]]};}],['bad split',d=>{d.assetIds={$ids:[['N-AIR-',3,d.assetIds.$ids[0][2],120]]};}],['short',d=>{d.assetIds={$ids:[[...d.assetIds.$ids[0].slice(0,3),119]]};}]]){const v=corrupt(mutate);assert.equal(v.ok,false,label);assert.ok(v.errors.some(x=>/delivery/.test(x)),`${label}: ${v.errors}`);}
  return {runs:contract.assetIds.$ids.length};
});
const passed=results.filter(r=>r.ok).length;
console.log(JSON.stringify({suite:'build358-fleet-scan',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;
