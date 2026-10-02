'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const {performance}=require('node:perf_hooks');
const e=scenario(),s=e.s,state=e.state,STORE=s.GH_FLEET_STORE,FLEET=s.GH_FLEET_DATA,TX=s.GH_TRANSACTION_CORE;
e.load('migration-core');e.load('state-codec-core');e.load('persistence-core');
const limit=s.GH_PERSISTENCE.fleetRecordLimit(),targetAssets=limit/2;
assert.equal(Number.isInteger(targetAssets),true,'the record ceiling reserves one live row and one full receipt snapshot per purchased asset');
const nativeMessages=[],previousWebkit=s.webkit;s.webkit={messageHandlers:{saveBridge:{postMessage:message=>nativeMessages.push(message)}}};
assert.equal(s.GH_PERSISTENCE.fleetRecordLimit(),limit,'native and browser saves use the same temporary fleet ceiling while validation is full-scan');
s.webkit=previousWebkit;
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e7;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e7;
const item=e.item;
function purchase(qty,order){
  const total=item.price*qty;
  return TX.execute(state,{label:`build357-cap-seed-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{
    const result=e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty,manual:true,requestRef:`MANUAL-CAP-${order}`,upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});
    s.GH_REALISM.onSimulationTime(state,state.simSeconds);
    return result;
  })});
}

let remaining=targetAssets,order=0;
while(remaining){const qty=Math.min(1000,remaining),result=purchase(qty,order++);assert.equal(result.committed,true,`purchase batch of ${qty} fits below the temporary save ceiling`);remaining-=qty;}
const migrated=s.GH_MIGRATION_CORE.migrateFleet(state);assert.equal(migrated.changed,true);assert.equal(FLEET.size(state),targetAssets);assert.equal(Object.hasOwn(state,'assets'),false);
const receipts=state.realism.procurement.deliveries;assert.equal(receipts.reduce((count,row)=>count+(row.assets?.length||0),0),targetAssets);
assert.equal(FLEET.persistenceRecordCount(state,receipts),limit,'live assets and complete retained receipt snapshots reach the exact record ceiling');
assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true,'the exact ceiling is accepted by Save Schema');

const saveStarted=performance.now(),saved=s.GH_PERSISTENCE.writeState('build357-fleet-cap',state),saveMs=performance.now()-saveStarted;
assert.equal(saved.ok,true,`save at the ceiling succeeds: ${saved.reason||''}`);
const loaded=s.GH_PERSISTENCE.recoverBrowserState('build357-fleet-cap');assert.equal(loaded.ok,true,`load at the ceiling succeeds: ${loaded.reason||''}`);
const before=state.fleet,after=loaded.state.fleet;
assert.ok(STORE.isStore(after));
for(const key of ['schema','version','length','live','capacity','structure','revision'])assert.equal(after[key],before[key],`saved fleet ${key} is exact`);
assert.deepEqual(Array.from(new Uint8Array(after.rows)),Array.from(new Uint8Array(before.rows)),'the row buffer round-trips byte for byte');
assert.deepEqual(after.values,before.values,'the immutable value table round-trips exactly');
assert.deepEqual(after.extras,before.extras,'per-row extras round-trip exactly');
assert.equal(s.GH_STATE_CODEC.serialize(loaded.state),s.GH_STATE_CODEC.serialize(state),'the full save is stable after load');

const previousRaw=s.localStorage.getItem('build357-fleet-cap'),beforeRejected= s.GH_STATE_CODEC.serialize(state);
assert.throws(()=>purchase(1,order),/fleet-persistence-record-cap/,'the first purchase above the ceiling is refused before payment or receipt creation');
assert.equal(s.GH_STATE_CODEC.serialize(state),beforeRejected,'rejected over-cap purchase changes no saved state');
assert.equal(s.localStorage.getItem('build357-fleet-cap'),previousRaw,'the last accepted save remains intact');

const validationMs=Number(s.GH_SAVE_SCHEMA.telemetry().lastValidation?.totalMs)||0;
console.log(JSON.stringify({suite:'build357-fleet-save-cap',passed:1,total:1,assets:FLEET.size(state),persistenceRecords:FLEET.persistenceRecordCount(state,receipts),recordLimit:limit,saveBytes:saved.utf8Bytes,saveMs:+saveMs.toFixed(1),validationMs:+validationMs.toFixed(1),overCapRejected:true,exactStoreRoundTrip:true,environment:`node ${process.version}; browser persistence limits; synthetic real procurement receipts; no iPhone`}));
