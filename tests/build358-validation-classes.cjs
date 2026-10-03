'use strict';
// Build 358 (million-asset validation): Save Schema and Company Platform check assets once per class of rows that read
// identically (GH_FLEET_STORE.forEachClass), with progress/fuel/condition at each class's extremes, and find duplicate
// or missing ids without one string per row (GH_FLEET_STORE.idCollisions). The result must be exactly the per-row
// result: validate(state) is compared with validate(state,{assetScan:'rows'}) (the former scan, same predicates) on a
// real fleet and on seeded random corruptions of every field the asset checks read.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,FLEET=s.GH_FLEET_DATA,STORE=s.GH_FLEET_STORE,TX=s.GH_TRANSACTION_CORE,SCHEMA=s.GH_SAVE_SCHEMA;
e.load('migration-core');e.load('state-codec-core');e.load('persistence-core');
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,2000)});}}

// A real fleet: three purchases (three profiles), then routes and phases as the dispatcher would leave them.
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e7;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e7;const item=e.item;let order=0;
function purchase(qty){const total=item.price*qty;order++;return TX.execute(state,{label:`classes-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{const r=e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty,manual:true,requestRef:`CLASSES-${order}`,upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});s.GH_REALISM.onSimulationTime(state,state.simSeconds);return r;})});}
for(const qty of [1200,900,600])assert.equal(purchase(qty).committed,true);
if(FLEET.mode(state)!=='store')s.GH_MIGRATION_CORE.migrateFleet(state);
const store=()=>state.fleet;
// Two built-in air routes take 24 aircraft each; the rest stay idle at the base with varied fuel and condition.
TX.execute(state,{label:'classes-dispatch',scope:['fleet'],apply:()=>{
  let routed=0;
  for(let row=0;row<store().length;row++){
    if(routed<48&&row%7===1){const route=routed%2?'AIR_DXB_SIN':'AIR_RUH_LHR';STORE.patch(store(),row,{routeId:route,phase:routed%5?'moving':'turnaround',progress:(row%97)/97,fuel:20+(row%80),condition:55+(row%45)});routed++;}
    else STORE.patch(store(),row,{fuel:30+(row%70),condition:60+(row%40)});
  }
}});

// Seeded PRNG (mulberry32) so every failure reproduces.
let seed=0x358;const rand=()=>{seed|=0;seed=(seed+0x6D2B79F5)|0;let x=Math.imul(seed^(seed>>>15),1|seed);x=(x+Math.imul(x^(x>>>7),61|x))^x;return ((x^(x>>>14))>>>0)/4294967296;};
const pick=list=>list[Math.floor(rand()*list.length)];
const liveRows=()=>{const rows=[];STORE.forEachLive(store(),row=>rows.push(row));return rows;};
const idOf=row=>STORE.peek(store(),row,'id');
const MUTATIONS=[
  ['fuel NaN',row=>STORE.set(store(),row,'fuel',NaN)],['fuel 101',row=>STORE.set(store(),row,'fuel',101)],['fuel -1',row=>STORE.set(store(),row,'fuel',-1)],['fuel Infinity',row=>STORE.set(store(),row,'fuel',Infinity)],
  ['progress 2',row=>STORE.set(store(),row,'progress',2)],['progress -0.1',row=>STORE.set(store(),row,'progress',-0.1)],['progress text',row=>STORE.set(store(),row,'progress','0.5')],
  ['condition 150',row=>STORE.set(store(),row,'condition',150)],['condition NaN',row=>STORE.set(store(),row,'condition',NaN)],['condition deleted',row=>STORE.set(store(),row,'condition',undefined)],
  ['phase invalid',row=>STORE.set(store(),row,'phase','flying')],['phase deleted',row=>STORE.set(store(),row,'phase',undefined)],
  ['route unknown',row=>STORE.set(store(),row,'routeId','AIR_NOWHERE')],['route blank',row=>STORE.set(store(),row,'routeId',' ')],['moving without route',row=>STORE.patch(store(),row,{phase:'moving',routeId:null})],
  ['route transitional',row=>STORE.patch(store(),row,{phase:'moving',routeId:'AIR_DXB_SIN',releaseExclusiveRouteOnArrival:true})],
  ['duplicate id',row=>{const rows=liveRows();STORE.set(store(),row,'id',idOf(pick(rows)));}],
  ['duplicate id via extras',row=>{const rows=liveRows();STORE.set(store(),row,'id',idOf(pick(rows)));STORE.set(store(),row,'simulationFault',{code:'X',at:1});}],
  ['id deleted',row=>STORE.set(store(),row,'id',undefined)],['numeric id',row=>STORE.set(store(),row,'id',7)],['string id 7',row=>STORE.set(store(),row,'id','7')],
  ['long digit id',row=>STORE.set(store(),row,'id','N-AIR-12345678901')],['zero-padded id',row=>STORE.set(store(),row,'id',idOf(row).replace(/(\d+)$/,d=>d.padStart(d.length+2,'0')))],
  ['name markup',row=>STORE.set(store(),row,'name','GH <b>AIR</b> 1')],['name long',row=>STORE.set(store(),row,'name','GH '+'A'.repeat(185)+' 1')],['name quote',row=>STORE.set(store(),row,'name','GH "AIR" 9')],['name blank',row=>STORE.set(store(),row,'name','')],
  ['owner unknown',row=>STORE.set(store(),row,'ownerCompanyId','ghost')],['owner invalid',row=>STORE.set(store(),row,'ownerCompanyId','bad id!')],['class invalid',row=>STORE.set(store(),row,'assetClass','<x>')],['mode unknown',row=>STORE.set(store(),row,'assetMode','zeppelin')],
  ['base blank',row=>STORE.set(store(),row,'baseFacility','')],['photo bad',row=>STORE.set(store(),row,'photo','javascript:alert(1)')],
  ['route over capacity',()=>{const rows=liveRows();for(let k=0;k<40;k++)STORE.patch(store(),rows[k*7%rows.length],{routeId:'AIR_RUH_LHR',phase:'turnaround',releaseExclusiveRouteOnArrival:false});}],
  ['row removed',row=>STORE.remove(store(),row)]
];
const outcome=(options)=>{const out=SCHEMA.validate(state,options);return {ok:out.ok,errors:[...out.errors].sort()};};
function compare(label){
  const classes=outcome(),rows=outcome({assetScan:'rows'});
  assert.deepEqual(classes,rows,`${label}: class validation must equal the per-row scan`);
  const company=[s.GH_COMPANY_PLATFORM.validateState(state),s.GH_COMPANY_PLATFORM.validateState(state,{assetScan:'rows'})].map(r=>({ok:r.ok,errors:[...r.errors].sort()}));
  assert.deepEqual(company[0],company[1],`${label}: company platform class validation must equal the per-row scan`);
  return classes;
}

test('a real fleet validates identically, with a handful of classes',()=>{
  const out=compare('real fleet');assert.equal(out.ok,true,JSON.stringify(out.errors));
  let classes=0,rows=0;FLEET.forEachFieldClasses(state,['id','name','phase','routeId','progress','fuel','condition','ownerCompanyId'],(row,count)=>{if(count>0){classes++;rows+=count;}},{numeric:['progress','fuel','condition']});
  assert.equal(rows,FLEET.size(state),'class sizes add up to the live fleet');assert(classes<=24,`expected few classes, got ${classes}`);
  return {assets:FLEET.size(state),classes};
});

test('seeded corruptions of every checked field validate identically',()=>{
  // Each round corrupts inside a transaction, compares, and rolls back through the fleet journal.
  const seen=new Map(),failures=new Set(),pristine=new Uint8Array(state.fleet.rows.slice(0));let rounds=0;
  for(let round=0;round<160;round++){
    const applied=[],n=1+Math.floor(rand()*4);
    assert.throws(()=>TX.execute(state,{label:`classes-round-${round}`,scope:['fleet'],apply:()=>{
      for(let k=0;k<n;k++){const [name,mutate]=pick(MUTATIONS),rows=liveRows();if(!rows.length)break;mutate(pick(rows));applied.push(name);seen.set(name,(seen.get(name)||0)+1);}
      const out=compare(`round ${round} [${applied.join(', ')}]`);for(const error of out.errors)failures.add(error);rounds++;
      throw new Error('round-rollback');
    }}),/round-rollback/);
    assert.deepEqual(new Uint8Array(state.fleet.rows).subarray(0,pristine.length),pristine,`round ${round}: the fleet is restored`);
  }
  for(const [name] of MUTATIONS)assert(seen.has(name),`mutation never drawn: ${name}`);
  for(const code of ['asset-fuel','asset-progress','asset-condition','asset-phase','asset-route-reference','asset-route-required','asset-id','asset-shape','asset-route-capacity'])assert(failures.has(code),`corruptions must exercise ${code}`);
  return {rounds,errors:[...failures].sort()};
});

test('id collisions: every form of duplicate and missing id',()=>{
  let idStore=null;
  const fresh=()=>{idStore=STORE.fromAssets([{id:'N-AIR-0001'},{id:'N-AIR-0002'},{id:'X-9'},{id:'Y'}].map(a=>({...a,assetMode:'air',ownerCompanyId:'air',baseFacility:'B1',phase:'idle',progress:0,fuel:100,condition:100})));};
  const store=()=>idStore;
  const cases=[
    ['distinct',()=>{},false],
    ['same pattern id',()=>STORE.set(store(),1,'id','N-AIR-0001'),true],
    ['padding differs',()=>STORE.set(store(),1,'id','N-AIR-001'),false],
    ['pattern vs extras',()=>{STORE.set(store(),1,'id','N-AIR-0001');STORE.set(store(),1,'simulationFault',{code:'X'});},true],
    ['digits split differently',()=>{STORE.set(store(),0,'id','A12');STORE.set(store(),1,'id','A12');},true],
    ['number vs string',()=>{STORE.set(store(),0,'id',7);STORE.set(store(),1,'id','7');},false],
    ['two numbers',()=>{STORE.set(store(),0,'id',7);STORE.set(store(),1,'id',7);},true],
    ['no trailing digits',()=>{STORE.set(store(),2,'id','Y');},true],
    ['long digit run',()=>{STORE.set(store(),0,'id','Z12345678901');STORE.set(store(),1,'id','Z12345678901');},true],
    ['missing',()=>STORE.set(store(),3,'id',undefined),true]
  ];
  const out=[];
  for(const [name,apply,expected] of cases){fresh();apply();const got=STORE.idCollisions(store());const reference=new Set();let dup=false;STORE.forEachLive(store(),row=>{const id=STORE.peek(store(),row,'id');if(id===undefined||reference.has(id))dup=true;else reference.add(id);});assert.equal(got.duplicate||got.missing,dup,`${name}: matches the reference`);assert.equal(dup,expected,`${name}: expected ${expected}`);out.push(name);}
  return out;
});

test('class validation is much cheaper than the per-row scan',()=>{
  assert.equal(purchase(3000).committed,true);
  const time=options=>{const t=performance.now();SCHEMA.validate(state,options);return performance.now()-t;};
  time();time({assetScan:'rows'});
  const classes=Math.min(time(),time()),rows=Math.min(time({assetScan:'rows'}),time({assetScan:'rows'}));
  assert(classes<rows,`classes ${classes.toFixed(1)} ms vs rows ${rows.toFixed(1)} ms`);
  compare('timed fleet');
  return {assets:FLEET.size(state),classesMs:+classes.toFixed(1),rowsMs:+rows.toFixed(1)};
});

const passed=results.filter(r=>r.ok).length;
console.log(JSON.stringify({suite:'build358-validation-classes',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;
