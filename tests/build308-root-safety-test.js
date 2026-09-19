'use strict';
const assert=require('assert'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const {ROOT,harness,minimal}=require('./helpers/core-harness');

const route=(id,type='air',offset=0)=>({
  id,type,company:type,name:id,from:`From ${id}`,to:`To ${id}`,
  fromFacility:`FROM-${id}`,toFacility:`TO-${id}`,
  route:[[20+offset,30+offset],[21+offset,31+offset]],distanceKm:150,
  effectiveSpeedKmh:100,tripSeconds:5400,dwellHours:1
});
const asset=(id,type='air',baseFacility='BASE-AIR')=>({id,type,name:id,baseFacility,phase:'idle',progress:0,fuel:100,condition:100,deliveryStatus:'delivered'});

(async()=>{
  let passed=0;
  const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};

  await test('route owner rejects exact, reverse, near and cross-company corruption',()=>{
    const {s}=harness(['route-core']);const state={customRoutes:[],routeEndpoints:{},routeCache:{},assets:[]},R=s.GH_ROUTE_CORE,first=route('R1');
    R.execute({state},'create',{route:first});
    assert.throws(()=>R.execute({state},'create',{route:{...route('R2'),route:first.route}}),/duplicate-route/);
    assert.throws(()=>R.execute({state},'create',{route:{...route('R3'),route:[...first.route].reverse()}}),/duplicate-route/);
    assert.throws(()=>R.execute({state},'create',{route:{...route('R4'),route:[[20.004,30.004],[21.004,31.004]]}}),/near-duplicate-route/);
    assert.throws(()=>R.execute({state},'create',{route:{...route('BAD'),company:'sea'}}),/route-company-isolation/);
    const sea=route('SEA-1','sea');assert.doesNotThrow(()=>R.execute({state},'create',{route:sea}));
    assert.strictEqual(R.corridorMetrics(first,sea).comparable,false,'companies must never share the route conflict namespace');
  });

  await test('route capacity is fail-closed while exclusive replacement remains available',()=>{
    const {s}=harness(['route-core']),R=s.GH_ROUTE_CORE,state={customRoutes:[],routeEndpoints:{},routeCache:{},assets:[asset('A1')]};
    for(let i=0;i<R.LIMITS.routes;i++)state.customRoutes.push(route(`CAP-${i}`,'road',i%20));
    assert.throws(()=>R.execute({state},'create',{route:route('OVER','road',50)}),/route-capacity/);
    state.assets[0].type='road';state.assets[0].routeId='CAP-0';
    const replacement=route('REPLACED','road',50);assert.strictEqual(R.execute({state},'replace',{replaceId:'CAP-0',assetId:'A1',route:replacement}).id,'REPLACED');
    assert.strictEqual(state.customRoutes.length,R.LIMITS.routes);assert(!state.customRoutes.some(row=>row.id==='CAP-0'));
    state.assets.push({...asset('A2','road'),routeId:'CAP-1'});
    assert.throws(()=>R.execute({state},'replace',{replaceId:'CAP-1',assetId:'A1',route:route('DENIED','road',60)}),/route-replace-in-use/);
  });

  await test('every delivered asset receives the preserved fixed crew exactly once',()=>{
    const {s}=harness(['route-core','facility-core','fleet-core']),F=s.GH_FLEET_CORE;
    const state={simSeconds:0,assets:[],crew:[],advanced:{labor:{}},sequences:{},globalBases:[{id:'BASE-AIR',name:'Air Base',owned:true,company:'air',kind:'airport-base'}],customHubs:[],realism:{procurement:{deliveries:[]}},finance:{invoices:[],cheques:[]}};
    for(let i=1;i<=2;i++){
      const delivered=asset(`AIR-${i}`),deliveryId=`D-${i}`,invoice=`INV-${i}`;
      state.realism.procurement.deliveries.push({id:deliveryId,status:'pending',asset:{id:delivered.id},baseId:'BASE-AIR',payment:{kind:'invoice',ref:invoice,amount:10}});
      state.finance.invoices.push({number:invoice,status:'مدفوعة',company:'air',amount:10});
      const out=F.execute({state},'record-delivery',{asset:delivered,baseId:'BASE-AIR',deliveryId,deliveredDay:0,deliveredAtSeconds:0});
      assert.strictEqual(out.staffing.mode,'automatic-fixed');assert.strictEqual(out.staffing.ready,true);assert.strictEqual(out.staffing.total,12);
      assert.deepStrictEqual(Array.from(out.staffing.roles,row=>[row.id,row.count]),[['pilots',4],['cabin',6],['aeng',2]]);
    }
    assert.strictEqual(F.headcount(state,'air'),24);assert.strictEqual(state.crew.find(row=>row.id==='pilots').count,8);assert.strictEqual(state.advanced.labor.employmentContracts.length,2);
    const contracts=state.advanced.labor.employmentContracts.length;F.provisionStaffing(state,state.assets[0],state.globalBases[0]);assert.strictEqual(state.advanced.labor.employmentContracts.length,contracts,'staffing must be idempotent');
    F.execute({state},'finalize-sale',{id:'AIR-1'});assert.strictEqual(F.headcount(state,'air'),12);assert.strictEqual(state.advanced.labor.employmentContracts.find(row=>row.assetId==='AIR-1').status,'منتهي');
  });

  await test('fleet owner shares one air route but rejects duplicate corridor IDs',()=>{
    const {s}=harness(['route-core','fleet-core']),F=s.GH_FLEET_CORE,one=route('A-ONE'),near={...route('A-NEAR'),route:[[20.004,30.004],[21.004,31.004]]},far=route('A-FAR', 'air',10);
    const state={customRoutes:[one,near,far],assets:[asset('A1'),asset('A2'),asset('A3')],advanced:{},crew:[],sequences:{}};for(const row of state.assets)F.provisionStaffing(state,row,{name:'Base'});
    state.assets[0].baseFacility=one.fromFacility;state.assets[1].baseFacility=one.fromFacility;state.assets[2].baseFacility=near.fromFacility;
    F.execute({state},'assign-route',{id:'A1',routeId:one.id,baseFacility:one.fromFacility,phase:'turnaround',route:one});
    assert.doesNotThrow(()=>F.execute({state},'assign-route',{id:'A2',routeId:one.id,baseFacility:one.fromFacility,phase:'turnaround',route:one}));
    assert.deepStrictEqual(state.assets.slice(0,2).map(row=>row.routeSlot),[0,1]);
    assert.throws(()=>F.execute({state},'assign-route',{id:'A3',routeId:near.id,baseFacility:near.fromFacility,phase:'turnaround',route:near}),/asset-route-capacity-or-corridor/);
    state.assets[2].baseFacility=far.fromFacility;assert.doesNotThrow(()=>F.execute({state},'assign-route',{id:'A3',routeId:far.id,baseFacility:far.fromFacility,phase:'turnaround',route:far}));
  });

  await test('save schema migrates retired state and rejects unbounded route growth',()=>{
    const {s}=harness(['save-schema']),S=s.GH_SAVE_SCHEMA,state=minimal(),retired=String.fromCharCode(97,105),retiredVehicleOption=String.fromCharCode(97,117,116,111,110,111,109,111,117,115);
    state.advanced[retired]={requests:[1]};state.settings={[`${retired}Brief`]:true};state.lastPanel=String.fromCharCode(105,110,116,101,108,108,105,103,101,110,99,101);
    state.assets=[{...asset('OLD-TRUCK','road','DEPOT-1'),catalogId:'N-T4',model:'Autonomous Ready 24T',specs:{[retiredVehicleOption]:true,drivetrain:'L4-ready'}}];
    state.controlPlane={events:Array.from({length:300},(_,id)=>({id})),commands:Array.from({length:200},(_,id)=>({id})),incidents:[],outbox:[],blackBox:[]};
    const migrated=S.migrateLegacy(state),truck=migrated.state.assets[0];assert(migrated.changed);assert(!Object.prototype.hasOwnProperty.call(migrated.state.advanced,retired));assert.strictEqual(migrated.state.lastPanel,'leadershipHub');assert.strictEqual(migrated.state.controlPlane.events.length,S.STATE_LIMITS.controlEvents);assert.strictEqual(migrated.state.controlPlane.commands.length,S.STATE_LIMITS.controlCommands);assert.strictEqual(truck.model,'Hybrid Safety 24T · هجينة آمنة');assert(!Object.prototype.hasOwnProperty.call(truck.specs,retiredVehicleOption));
    const oversized=minimal();oversized.customRoutes=Array.from({length:S.STATE_LIMITS.customRoutes+1},(_,index)=>route(`LIMIT-${index}`,'road',index/10));
    const result=S.validate(oversized);assert(!result.ok);assert(result.errors.includes('route-capacity'));
  });

  await test('legacy duplicate air corridors consolidate into one bounded shared route',()=>{
    const {s}=harness(['save-schema']),S=s.GH_SAVE_SCHEMA,state=minimal(),one=route('LEGACY-1'),two={...one,id:'LEGACY-2',name:'LEGACY-2'},three={...one,id:'LEGACY-3',name:'LEGACY-3'};
    state.customRoutes=[one,two,three];state.routeCache=Object.fromEntries([[one.id,{route:one.route,distanceKm:150}],...Array.from({length:170},(_,index)=>[`CACHE-${index}`,{distanceKm:index}])]);state.assets=[
      {...asset('KEEP','air',one.fromFacility),phase:'moving',routeId:one.id,progress:.4},
      {...asset('KEEP-2','air',one.fromFacility),phase:'turnaround',routeId:one.id,progress:0},
      {...asset('MIGRATE-MOVING','air',two.fromFacility),phase:'moving',routeId:two.id,progress:.6},
      {...asset('MIGRATE-READY','air',three.fromFacility),phase:'turnaround',routeId:three.id,progress:0}
    ];
    const migrated=S.migrateLegacy(state);assert(migrated.changed);const users=migrated.state.assets.filter(row=>row.type==='air');
    assert(users.every(row=>row.routeId===one.id&&!row.releaseExclusiveRouteOnArrival),'duplicate air route IDs with identical endpoints must consolidate to the canonical shared route');
    assert.strictEqual(new Set(users.map(row=>row.routeSlot)).size,4,'migrated shared-air users need unique route slots');
    assert(!migrated.state.customRoutes.some(row=>row.id===two.id||row.id===three.id),'duplicate air route records survived migration');
    assert.strictEqual(migrated.state.routeCache[one.id].canonicalRouteId,one.id);assert(!migrated.state.routeCache[one.id].route);assert(Object.keys(migrated.state.routeCache).length<=S.STATE_LIMITS.routeCache);assert(S.validate(migrated.state).ok,S.validate(migrated.state).errors.join(','));
  });

  await test('durable save ACK commits, NACK rolls back, and timeout locks for reconciliation',async()=>{
    const setup=()=>{const h=harness(['save-schema','persistence-core']);h.s.GH_CONTROL_PLANE={sha256:value=>crypto.createHash('sha256').update(value).digest('hex')};return h;};
    const acknowledge=(h,envelope,generation,success=true)=>h.s.GH_PERSISTENCE.receiveAck({...envelope,generation,success,message:success?'':'rejected'});
    {
      const h=setup(),old=minimal(),next={...minimal(),saveRevision:2,notes:'committed'};h.data.set('main',JSON.stringify(old));h.s.webkit={messageHandlers:{saveBridge:{postMessage:envelope=>acknowledge(h,envelope,1,true)}}};
      const out=await h.s.GH_PERSISTENCE.commitDurableState(next,{storageKey:'main',timeoutMs:20});assert(out.ok&&out.durable);assert.strictEqual(JSON.parse(h.data.get('main')).notes,'committed');assert(!h.s.GH_PERSISTENCE.isLocked());
    }
    {
      const h=setup(),old=minimal(),next={...minimal(),saveRevision:2,notes:'rejected'};const checkpoint=JSON.stringify(old);h.data.set('main',checkpoint);h.s.webkit={messageHandlers:{saveBridge:{postMessage:envelope=>acknowledge(h,envelope,1,false)}}};
      await assert.rejects(h.s.GH_PERSISTENCE.commitDurableState(next,{storageKey:'main',timeoutMs:20}),/rejected/);assert.strictEqual(h.data.get('main'),checkpoint);assert(!h.s.GH_PERSISTENCE.isLocked());
    }
    {
      const h=setup(),old=minimal(),next={...minimal(),saveRevision:2,notes:'uncertain'};const checkpoint=JSON.stringify(old),events=[];h.data.set('main',checkpoint);h.s.addEventListener('gh-persistence-status',event=>events.push(event.detail));h.s.webkit={messageHandlers:{saveBridge:{postMessage:()=>{}}}};
      await assert.rejects(h.s.GH_PERSISTENCE.commitDurableState(next,{storageKey:'main',timeoutMs:5}),/timeout/);assert.strictEqual(h.data.get('main'),checkpoint);assert(h.s.GH_PERSISTENCE.isLocked());assert(events.some(row=>row.requiresNativeReconciliation===true));h.s.GH_PERSISTENCE.acknowledgeRecovery();assert(!h.s.GH_PERSISTENCE.isLocked());
    }
  });

  await test('BUILD308 source contract keeps one route UI, bounded motion and local map runtime',()=>{
    const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8'),app=read('WebApp/app.js'),html=read('WebApp/index.html'),runtime=read('WebApp/runtime-required.json'),advanced=read('WebApp/advanced-core.js'),catalog=read('WebApp/catalog.js');
    assert(app.includes('توزيع وتشغيل الشبكة الجوية'));assert(app.includes("async function dispatchInternationalNetwork(type)"));assert(app.includes("async function dispatchSharedInternationalNetwork(type)"));assert(app.includes("runDurableStateCommand(`bulk-shared-departure:${type}`"));
    assert(!app.includes('function renderAssignRoute'));assert(!advanced.includes('renderIntelligence'));assert(!html.includes('unpkg.com/leaflet'));assert(html.includes('vendor/leaflet/leaflet.js'));assert(runtime.includes('vendor/leaflet/leaflet.js'));
    assert(!runtime.includes('ai-executive-core.js'));assert(!fs.existsSync(path.join(ROOT,'WebApp','ai-executive-core.js')));assert(app.includes('MAX_FRAME_MS:50'));assert(app.includes('maxPixelsPerSecond:8'));assert(app.includes("draft.simulationFault={code:'ASSET_SIMULATION_ISOLATED'"));
    assert(!catalog.toLowerCase().includes('autonomous'));assert(!runtime.includes('truck-autonomous'));assert(!fs.existsSync(path.join(ROOT,'WebApp','assets','images','truck-autonomous.webp')));
    assert(app.includes("GLOBAL_HALT_IDS=Object.freeze(['CONTROL_JOURNAL_CHAIN_BREAK'"));assert(app.includes("if(asset.staffing?.mode!=='automatic-fixed'||asset.staffing.ready!==true)"));
  });

  console.log(JSON.stringify({suite:'build308-root-safety',passed,total:8}));
})().catch(error=>{console.error(error);process.exitCode=1;});
