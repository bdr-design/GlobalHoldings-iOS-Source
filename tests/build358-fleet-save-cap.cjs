'use strict';
// Build 358 fleet save policy:
// - an airport base takes 3,000 new aircraft and one purchase can deliver all of them;
// - a delivered batch keeps every asset in a compact receipt (template + columns + assetIds) that rebuilds the complete
//   rows exactly, so receipts no longer double the saved fleet;
// - purchases may take the fleet to the record ceiling (live assets plus pending snapshots) and not past it: 6,000 for
//   the browser save (one localStorage string), 1,000,000 for the native save (records in vault chunks);
// - the ceiling is an admission rule only: a state above it (written directly) still validates, saves and loads.
const assert=require('node:assert/strict'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const {performance}=require('node:perf_hooks');
const e=scenario(),s=e.s,state=e.state,STORE=s.GH_FLEET_STORE,FLEET=s.GH_FLEET_DATA,TX=s.GH_TRANSACTION_CORE;
e.load('migration-core');e.load('state-codec-core');e.load('persistence-core');
const limit=s.GH_PERSISTENCE.fleetRecordLimit();
assert.equal(limit,6000,'browser fleet ceiling');
const nativeMessages=[],previousWebkit=s.webkit;s.webkit={messageHandlers:{saveBridge:{postMessage:message=>nativeMessages.push(message)}}};
assert.equal(s.GH_PERSISTENCE.fleetRecordLimit(),1000000,'native fleet ceiling: the million-asset game (records in vault chunks)');
s.webkit=previousWebkit;
assert.equal(s.GH_FACILITY_CORE.DEFAULT_ASSET_CAPACITY['airport-base'],3000,'an airport base takes 3,000 aircraft');
assert.equal(s.GH_PROCUREMENT_CORE.MAX_ASSET_PURCHASE_QUANTITY,3000,'one purchase may fill an airport');
assert.equal(s.GH_PROCUREMENT_CORE.MAX_ASSET_PURCHASE_REQUEST,1000000,'the public guarded request ceiling is one million');
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e7;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e7;
const item=e.item;
function purchase(qty,order){
  const total=item.price*qty;
  return TX.execute(state,{label:`build358-cap-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{
    const result=e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty,manual:true,requestRef:`MANUAL-CAP-${order}`,upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});
    s.GH_REALISM.onSimulationTime(state,state.simSeconds);
    return result;
  })});
}

// Base capacity migration: every asset base takes 3,000 (one purchase). Old bases (airport 300, port 120, depot 80,
// mobility center 120 bays) and upgraded ones (345, 150) are lifted on load keeping their upgrades, idempotently.
{
  const legacy={globalBases:[{id:'OLD-AIR',kind:'airport-base',deliveryCapacity:300,capacity:'300 طائرة · تشغيل جوي وشحن'},{id:'UPGRADED-AIR',kind:'airport-base',deliveryCapacity:345},{id:'NEW-AIR',kind:'airport-base',deliveryCapacity:3000},{id:'PORT',kind:'port-base',deliveryCapacity:120},{id:'DEPOT',kind:'depot'}],customHubs:[{id:'MOB',kind:'mobility-center',deliveryCapacity:120,bays:150,capacity:'تشغيل حضري محلي · 120 سيارة'}],advanced:{facilities:{'OLD-AIR':{assetCapacity:300}}}};
  assert.equal(s.GH_FACILITY_CORE.migrateAssetCapacity(legacy),5);
  assert.deepEqual(legacy.globalBases.map(row=>row.deliveryCapacity),[3000,3045,3000,3000,3000]);
  assert.equal(legacy.customHubs[0].bays,3030,'a mobility center keeps its 30 extra bays');assert.equal(legacy.customHubs[0].deliveryCapacity,3030);assert.equal(legacy.customHubs[0].capacity,'تشغيل حضري محلي · 3,030 سيارة');
  assert.equal(legacy.globalBases[0].capacity,'3,000 طائرة · تشغيل جوي وشحن');assert.equal(legacy.advanced.facilities['OLD-AIR'].assetCapacity,3000);
  assert.equal(s.GH_FACILITY_CORE.migrateAssetCapacity(legacy),0,'the migration runs once');
}

const buyStarted=performance.now(),first=purchase(3000,0),buyMs=performance.now()-buyStarted;
assert.equal(first.committed,true,'one purchase delivers 3,000 aircraft');
const migrated=s.GH_MIGRATION_CORE.migrateFleet(state);assert.equal(Object.hasOwn(state,'assets'),false);assert.equal(FLEET.size(state),3000);void migrated;
for(let order=1;FLEET.size(state)<limit;order++)assert.equal(purchase(Math.min(3000,limit-FLEET.size(state)),order).committed,true,'purchases fill the fleet up to the ceiling');
assert.equal(FLEET.size(state),limit);

const receipts=state.realism.procurement.deliveries;
assert.equal(receipts.length,2);
for(const receipt of receipts){
  assert.equal(FLEET.isCompactReceipt(receipt),true,'delivered receipts are compact');assert.equal(Object.hasOwn(receipt,'assets'),false);
  const rows=FLEET.receiptAssets(receipt);
  assert.equal(rows.length,3000);assert.deepEqual(rows.map(row=>row.id),FLEET.idLists.toArray(receipt.assetIds),'receipt rows carry the delivered ids in order');
  assert.equal(receipt.assetIds.$ids.length,1,'a numbered batch keeps its ids as one run');
  assert.equal(new Set(rows.map(row=>row.name)).size,3000,'every delivered asset keeps its own name');
  for(const index of [0,1,1499,2999]){const live=FLEET.get(state,rows[index].id);assert.ok(live,'receipt asset is live');assert.equal(rows[index].name,live.name);assert.equal(rows[index].catalogId,live.catalogId);assert.equal(rows[index].deliveryOrderId,receipt.id);}
  assert.notEqual(rows[0].specs,rows[1].specs,'rebuilt rows are fresh objects');
  assert.ok(JSON.stringify(receipt).length<80000,`a 3,000-asset receipt is compact (${JSON.stringify(receipt).length} bytes)`);
}
assert.equal(FLEET.persistenceRecordCount(state,receipts),limit,'compact receipts hold no asset copies');
let started=performance.now();const validation=s.GH_SAVE_SCHEMA.validate(state);const validationMs=performance.now()-started;
assert.equal(validation.ok,true,`state at the ceiling validates: ${(validation.errors||[]).join(',')}`);

started=performance.now();const saved=s.GH_PERSISTENCE.writeState('build358-fleet-cap',state);const saveMs=performance.now()-started;
assert.equal(saved.ok,true,`save at the ceiling succeeds: ${saved.reason||''}`);
const loaded=s.GH_PERSISTENCE.recoverBrowserState('build358-fleet-cap');assert.equal(loaded.ok,true,`load at the ceiling succeeds: ${loaded.reason||''}`);
const before=state.fleet,after=loaded.state.fleet;
assert.ok(STORE.isStore(after));
for(const key of ['schema','version','length','live','capacity','structure','revision'])assert.equal(after[key],before[key],`saved fleet ${key} is exact`);
assert.deepEqual(Array.from(new Uint8Array(after.rows)),Array.from(new Uint8Array(before.rows)),'the row buffer round-trips byte for byte');
assert.deepEqual(after.values,before.values,'the immutable value table round-trips exactly');
assert.equal(JSON.stringify(loaded.state.realism.procurement.deliveries),JSON.stringify(receipts),'compact receipts round-trip exactly');
assert.equal(s.GH_STATE_CODEC.serialize(loaded.state),s.GH_STATE_CODEC.serialize(state),'the full save is stable after load');

// A Build 357 save with full receipt copies is compacted on load, losslessly.
{
  const legacy=loaded.state,expected=JSON.stringify(legacy.realism.procurement.deliveries);
  for(const receipt of legacy.realism.procurement.deliveries){receipt.assets=FLEET.receiptAssets(receipt);delete receipt.assetReceipt;}
  assert.equal(FLEET.persistenceRecordCount(legacy,legacy.realism.procurement.deliveries),limit*2,'full receipts count their copies');
  s.GH_SAVE_SCHEMA.normalize(legacy,{});
  assert.equal(JSON.stringify(legacy.realism.procurement.deliveries),expected,'load compacts full receipts to the same compact form');
}

const previousRaw=s.localStorage.getItem('build358-fleet-cap'),beforeRejected=s.GH_STATE_CODEC.serialize(state);
assert.throws(()=>purchase(1,99),/fleet-persistence-record-cap/,'the first purchase above the ceiling is refused before payment or receipt creation');
assert.equal(s.GH_STATE_CODEC.serialize(state),beforeRejected,'a refused purchase changes nothing');
assert.equal(s.localStorage.getItem('build358-fleet-cap'),previousRaw,'the last accepted save remains intact');

// Above the ceiling by a direct write: never a load-time lockout.
const extra={...FLEET.plain(state,FLEET.list(state)[0].id),id:'OVER-CEILING-PROBE',name:'GH AIR OVER'};
assert.equal(TX.execute(state,{label:'over-ceiling-probe',scope:['fleet'],apply:()=>FLEET.add(state,extra)}).committed,true);
assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true,'a state above the ceiling still validates');
const overSaved=s.GH_PERSISTENCE.writeState('build358-fleet-cap',state);assert.equal(overSaved.ok,true,overSaved.reason);
const overLoaded=s.GH_PERSISTENCE.recoverBrowserState('build358-fleet-cap');assert.equal(overLoaded.ok,true,overLoaded.reason);assert.equal(FLEET.size(overLoaded.state),limit+1);

console.log(JSON.stringify({suite:'build358-fleet-save-cap',passed:1,total:1,assets:limit,recordLimit:limit,receiptBytes:receipts.map(row=>JSON.stringify(row).length),buy3000Ms:+buyMs.toFixed(0),saveBytes:saved.utf8Bytes,saveMs:+saveMs.toFixed(1),validationMs:+validationMs.toFixed(1),aboveCeilingLoads:true,environment:`node ${process.version}; browser persistence limits; real procurement receipts; no iPhone`}));
