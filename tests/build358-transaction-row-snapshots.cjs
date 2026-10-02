'use strict';
// Build 358 Transaction Core: row-level snapshots (rowRoots), scope extension and scoped joins.
// Every rollback must restore the target exactly (same JSON, same key order, same object identities for roots).
const assert=require('node:assert/strict');
const path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const TX=require(path.join(ROOT,'WebApp/transaction-core.js'));

let seed=358;
const rand=()=>{seed=(seed*1103515245+12345)>>>0;return seed/4294967296;};
const pick=list=>list[Math.floor(rand()*list.length)];
const json=value=>JSON.stringify(value);
function fixture(){
  const row=i=>({id:`R${i}`,status:pick(['queued','active','done']),value:i,tags:[i,i+1],nested:{a:i}});
  return {
    mobility:{
      schema:'v4',sequence:10,status:'active',
      vehicles:Array.from({length:12},(_,i)=>row(i)),
      archive:Array.from({length:8},(_,i)=>Object.freeze({id:`A${i}`,route:[[1,2],[3,4]]})),
      byCenter:{RUH:{completed:1,gross:2},JED:{completed:3,gross:4}},
      cache:{k1:{route:[[0,0],[1,1]]},k2:{route:[[2,2]]}},
      kpis:{requests:5,completed:3}
    },
    market:Array.from({length:6},(_,i)=>({sym:`S${i}`,price:10+i,history:[1,2,3]})),
    finance:{pending:{air:1,sea:2},invoices:Array.from({length:5},(_,i)=>({id:`I${i}`,total:i})),sequence:4},
    other:{count:1},
    scalar:7
  };
}
// Writes allowed by a 'rows' policy: root fields, collection membership, member fields (members of immutable
// collections are only added or removed, never edited).
function mutateRows(m){
  const ops=[
    ()=>{m.sequence++;},()=>{m.status=pick(['active','paused']);},()=>{m.added=rand();},()=>{delete m.kpis;},
    ()=>{m.vehicles.push({id:`N${rand()}`,value:1});},()=>{m.vehicles.splice(Math.floor(rand()*m.vehicles.length),1);},
    ()=>{m.vehicles=m.vehicles.filter(v=>v.value%2===0);},
    ()=>{const v=pick(m.vehicles);if(v){v.status='moved';v.value+=1;}},()=>{const v=pick(m.vehicles);if(v){delete v.status;}},
    ()=>{const v=pick(m.vehicles);if(v){v.extra=1;}},()=>{const v=pick(m.vehicles);if(v){v.tags=[9,9];}},
    ()=>{m.archive.unshift(Object.freeze({id:`A${rand()}`}));},()=>{m.archive=m.archive.slice(0,3);},
    ()=>{m.byCenter.RUH.completed++;},()=>{m.byCenter.DMM={completed:0};},()=>{delete m.byCenter.JED;},
    ()=>{m.cache.k3={route:[[5,5]]};},()=>{delete m.cache.k1;},()=>{if(m.kpis)m.kpis.requests++;}
  ];
  for(let i=0,n=1+Math.floor(rand()*8);i<n;i++)pick(ops)();
}

// 1. rows policy: random row-level writes, rollback is exact
for(let round=0;round<400;round++){
  const state=fixture(),before=json(state),mobility=state.mobility,vehicles=state.mobility.vehicles,firstVehicle=vehicles[0];
  assert.throws(()=>TX.execute(state,{label:'rows',scope:['mobility','scalar'],rowRoots:{mobility:{level:'rows',immutable:['archive','cache']}},apply:()=>{mutateRows(state.mobility);state.scalar++;throw new Error('fail');}}),/fail/);
  assert.equal(json(state),before,`rows rollback round ${round}`);
  assert.equal(state.mobility,mobility,'root identity kept');assert.equal(state.mobility.vehicles,vehicles,'collection identity restored');assert.equal(state.mobility.vehicles[0],firstVehicle,'member identity kept');
}
// a replaced root comes back as the original object
{
  const state=fixture(),before=json(state),mobility=state.mobility;
  assert.throws(()=>TX.execute(state,{scope:['mobility'],rowRoots:{mobility:{level:'rows'}},apply:()=>{state.mobility={replaced:true};throw new Error('fail');}}),/fail/);
  assert.equal(state.mobility,mobility);assert.equal(json(state),before);
}
// committed writes stay
{
  const state=fixture();
  TX.execute(state,{scope:['mobility'],rowRoots:{mobility:{level:'rows'}},apply:()=>{state.mobility.vehicles[0].value=999;}});
  assert.equal(state.mobility.vehicles[0].value,999);
}

// 2. containers policy and array roots
for(let round=0;round<200;round++){
  const state=fixture(),before=json(state);
  assert.throws(()=>TX.execute(state,{scope:['finance','market'],rowRoots:{finance:{level:'containers'},market:{level:'rows'}},apply:()=>{
    state.finance.pending.air+=rand();state.finance.sequence++;state.finance.invoices.push({id:'NEW'});delete state.finance.pending.sea;
    for(const row of state.market){row.price*=1+rand();if(rand()<.3)row.change=rand();}
    if(rand()<.5)state.market.push({sym:'NEW'});if(rand()<.5)state.market.reverse();
    throw new Error('fail');
  }}),/fail/);
  assert.equal(json(state),before,`containers/array rollback round ${round}`);
}

// 3. scope extension captures roots before their first write
{
  const state=fixture(),before=json(state);
  assert.throws(()=>TX.execute(state,{label:'extend',scope:['scalar'],writeRoots:['scalar'],auditWrites:true,enforceWriteRoots:true,apply:()=>{
    state.scalar=1;
    assert.equal(TX.extendScope(state,['other','scalar']),true);assert.equal(TX.extendScope(state,['other']),false);
    state.other.count=99;state.other.added=true;
    TX.extendScope(state,['mobility'],{mobility:{level:'rows'}});mutateRows(state.mobility);
    throw new Error('fail');
  }}),/fail/);
  assert.equal(json(state),before);
  // extended roots count as declared for write-set enforcement
  TX.execute(state,{scope:['scalar'],writeRoots:['scalar'],auditWrites:true,enforceWriteRoots:true,apply:()=>{TX.extendScope(state,['other']);state.other.count=5;}});
  assert.equal(state.other.count,5);
  // enforcement (a test-time proof tool) detects a write outside the snapshot; it cannot restore what it never captured
  assert.throws(()=>TX.execute(state,{scope:['scalar'],writeRoots:['scalar'],auditWrites:true,enforceWriteRoots:true,apply:()=>{state.other.count=6;}}),/transaction-write-set-violation:other/);
  state.other.count=5;
  assert.throws(()=>TX.extendScope(state,['other']),/requires-active-transaction/);
  // full snapshots already cover every root
  TX.execute(state,{apply:()=>{assert.equal(TX.extendScope(state,['other']),false);}});
}

// 4. scoped join: no promotion when the scope certifies its joined writers
{
  const state=fixture(),before=json(state);
  assert.throws(()=>TX.execute(state,{label:'scoped-join',scope:['finance','mobility'],scopedJoin:true,rowRoots:{mobility:{level:'rows'}},apply:()=>{
    TX.join(state,{apply:()=>{state.finance.pending.air=50;}});
    assert.equal(TX.telemetry().active.rollbackStorage,'legacy-scoped','scoped join keeps the scoped snapshot');
    mutateRows(state.mobility);throw new Error('fail');
  }}),/fail/);
  assert.equal(json(state),before);
  assert.equal(TX.telemetry().last.fallbackReason,null);
}
// without the certification a join promotes, and row-level roots still restore exactly after promotion
for(let round=0;round<100;round++){
  const state=fixture(),before=json(state),mobility=state.mobility;
  assert.throws(()=>TX.execute(state,{label:'promoted',scope:['mobility','scalar'],rowRoots:{mobility:{level:'rows',immutable:['archive','cache']}},apply:()=>{
    mutateRows(state.mobility);
    TX.join(state,{apply:()=>{state.other.count=rand();state.finance.invoices.length=0;}});
    assert.equal(TX.telemetry().active.rollbackStorage,'full-snapshot');
    mutateRows(state.mobility);if(rand()<.2)state.mobility={replaced:true};
    throw new Error('fail');
  }}),/fail/);
  assert.equal(json(state),before,`promoted rollback round ${round}`);assert.equal(state.mobility,mobility);
  assert.equal(TX.telemetry().last.fallbackReason,'joined-writer');
}
// a scope that is not legacy-scoped ignores scopedJoin
{
  const state=fixture();
  TX.execute(state,{scopedJoin:true,apply:()=>{TX.join(state,{apply:()=>{state.scalar=1;}});}});
  assert.equal(state.scalar,1);
}
console.log('BUILD358_TRANSACTION_ROW_SNAPSHOTS_PASS');
