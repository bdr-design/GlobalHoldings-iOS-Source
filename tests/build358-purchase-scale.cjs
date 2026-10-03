'use strict';
// Build 358 (million-asset): a purchase no longer walks every asset view. Crew totals are summed per class of rows
// with the same staffing (per-asset loop when a role count is not an integer), base occupancy is counted per class
// (GH_FLEET_DATA.countByFields), delivered assets are looked up through the id index, and the integrity check no
// longer builds an unused set of every id. This proves the totals equal a per-asset reference (integer and
// non-integer counts, staffing overridden per row) and that the assets a purchase visits no longer grow with the fleet.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,1600)});}}

const e=scenario(),s=e.s,state=e.state,FLEET=s.GH_FLEET_DATA,STORE=s.GH_FLEET_STORE,TX=s.GH_TRANSACTION_CORE;
e.load('migration-core');e.load('state-codec-core');e.load('persistence-core');
const P=s.GH_PERSISTENCE;s.GH_PERSISTENCE={...P,fleetRecordLimit:()=>Infinity};
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e9;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e9;const item=e.item;let order=0;
function purchase(qty){const total=item.price*qty;order++;return TX.execute(state,{label:`scale-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{const r=e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty,manual:true,requestRef:`SCALE-${order}`,upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});s.GH_REALISM.onSimulationTime(state,state.simSeconds);return r;})});}
// The reference: the former per-asset loop, in row order, with the same arithmetic.
function referenceCrew(){
  const counts=new Map((state.crew||[]).map(role=>[role.id,0]));
  FLEET.forEach(state,asset=>{const st=asset.staffing;if(st?.mode!=='automatic-fixed'||st.ready!==true)return;for(const role of st.roles||[])if(counts.has(role.id))counts.set(role.id,counts.get(role.id)+(Number(role.count)||0));});
  return Object.fromEntries(counts);
}
const crewNow=()=>Object.fromEntries((state.crew||[]).map(role=>[role.id,role.count]));
const referenceOccupancy=()=>{const out=new Map();FLEET.forEach(state,asset=>out.set(asset.baseFacility,(out.get(asset.baseFacility)||0)+1));return out;};

test('crew totals equal the per-asset reference after purchases',()=>{
  for(const qty of [1500,900])assert.equal(purchase(qty).committed,true);
  if(FLEET.mode(state)!=='store')s.GH_MIGRATION_CORE.migrateFleet(state);
  assert.equal(purchase(600).committed,true);
  assert.deepEqual(crewNow(),referenceCrew());return crewNow();
});
test('per-row staffing overrides and non-integer role counts still equal the reference',()=>{
  const staffing=FLEET.plain(state,FLEET.list(state)[0].id).staffing;
  TX.execute(state,{label:'overrides',scope:['fleet'],apply:()=>{
    for(let row=0;row<40;row++)STORE.set(state.fleet,row*17,'staffing',{...staffing,roles:(staffing.roles||[]).map(role=>({...role,count:Number(role.count)+1}))});
    for(let row=0;row<5;row++)STORE.set(state.fleet,row*31+3,'staffing',{...staffing,roles:(staffing.roles||[]).map(role=>({...role,count:0.1}))});
  }});
  assert.equal(purchase(10).committed,true,'a purchase recomputes the crew');
  assert.deepEqual(crewNow(),referenceCrew(),'non-integer counts fall back to the per-asset loop');
  // Integer counts again, so the next measure takes the per-class path a real game takes.
  TX.execute(state,{label:'integer again',scope:['fleet'],apply:()=>{for(let row=0;row<5;row++)STORE.set(state.fleet,row*31+3,'staffing',staffing);}});
  return crewNow();
});
test('base occupancy per class equals a per-asset count',()=>{
  const counted=FLEET.countByFields(state,['baseFacility'],asset=>asset.baseFacility),reference=referenceOccupancy();
  // Maps from the game's realm and this one: compare their entries as data.
  assert.equal(JSON.stringify([...counted].sort()),JSON.stringify([...reference].sort()));return Object.fromEntries(counted);
});
// Walks through GH_FLEET_DATA (every owner reaches it as globalThis.GH_FLEET_DATA) are counted per asset visited: a
// deterministic measure of per-asset work, unlike wall time, which also carries garbage collection of a larger heap.
const API=s.GH_FLEET_DATA,WALKS=['forEach','forEachFields','some','every','find','filter','count','sum','map','removeWhere'],LISTS=['list','ids','indexById'];let visits=0;
const counting={...API};
for(const name of WALKS)counting[name]=(state,fn,...rest)=>API[name](state,typeof fn==='function'?(...args)=>{visits++;return fn(...args);}:fn,...rest);
for(const name of LISTS)counting[name]=(...args)=>{const out=API[name](...args);visits+=out?.length??out?.size??0;return out;};
test('the per-asset work of a purchase no longer grows with the fleet',()=>{
  const measure=()=>{s.GH_FLEET_DATA=counting;visits=0;const t=performance.now();try{assert.equal(purchase(1000).committed,true);}finally{s.GH_FLEET_DATA=API;}return {visits,ms:performance.now()-t};};
  const small=measure(),smallFleet=FLEET.size(state);
  TX.execute(state,{label:'grow',scope:['fleet'],apply:()=>{const template=FLEET.plain(state,FLEET.list(state)[0].id);for(let i=0;i<40000;i++)FLEET.add(state,{...template,id:`N-AIR-BULK-${String(i).padStart(6,'0')}`,name:`GH AIR BULK ${i}`});}});
  const large=measure(),largeFleet=FLEET.size(state);
  assert(large.visits<=small.visits+100,`a purchase of 1,000 visits ${large.visits} assets at ${largeFleet} vs ${small.visits} at ${smallFleet}`);
  assert(large.visits<largeFleet/10,`a purchase visits ${large.visits} of ${largeFleet} assets`);
  return {smallFleet,smallVisits:small.visits,smallMs:+small.ms.toFixed(0),largeFleet,largeVisits:large.visits,largeMs:+large.ms.toFixed(0)};
});

const passed=results.filter(r=>r.ok).length;
console.log(JSON.stringify({suite:'build358-purchase-scale',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;
