'use strict';
// Build 340 large-fleet purchase pipeline: (1) restoreObject fast path is behaviour-identical to the original
// delete/re-add implementation, (2) a durable command's private draft no longer takes a second full snapshot,
// (3) a failure can never publish, (4) real procurement cores produce byte-identical state on both paths.
// Node-only contract/parity test. It proves logic, not iPhone speed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const TX=require(path.join(ROOT,'WebApp/transaction-core.js'));

// ---- reference: the exact pre-optimisation implementation (kept here as the oracle) ----
function referenceRestore(target,snapshot){
  const clone=v=>structuredClone(v);
  if(Array.isArray(snapshot)){if(!Array.isArray(target))return clone(snapshot);target.length=snapshot.length;for(let i=0;i<snapshot.length;i++){const sv=snapshot[i],tv=target[i];target[i]=sv&&typeof sv==='object'?referenceRestore(tv,sv):sv;}return target;}
  if(snapshot&&typeof snapshot==='object'){if(!target||typeof target!=='object'||Array.isArray(target))target={};const existing=new Map(Object.keys(target).map(key=>[key,target[key]]));for(const key of Object.keys(target))delete target[key];for(const [key,sv] of Object.entries(snapshot)){const tv=existing.get(key);target[key]=sv&&typeof sv==='object'?referenceRestore(tv,sv):sv;}return target;}
  return snapshot;
}
// deterministic PRNG so failures are reproducible
let seed=0x9e3779b9;const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return ((seed>>>0)%1e6)/1e6;};
const pick=a=>a[Math.floor(rnd()*a.length)];
const KEYS=['id','name','phase','fuel','specs','staffing','tags','list','x','y','z','note'];
function randomValue(depth=0){
  const r=rnd();
  if(depth>3||r<.35)return pick([0,1,-1,3.5,NaN,'a','b','',true,false,null]);
  if(r<.6)return Array.from({length:Math.floor(rnd()*6)},()=>randomValue(depth+1));
  const o={};const n=Math.floor(rnd()*6);for(let i=0;i<n;i++)o[pick(KEYS)]=randomValue(depth+1);return o;
}
function mutate(v,depth=0){
  if(Array.isArray(v)){const a=v.map(x=>rnd()<.6?mutate(x,depth+1):x);if(rnd()<.2)a.push(randomValue(depth+1));if(rnd()<.2)a.length=Math.max(0,a.length-1);return a;}
  if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v))if(rnd()>.12)o[k]=rnd()<.6?mutate(v[k],depth+1):v[k];if(rnd()<.25)o[pick(KEYS)]=randomValue(depth+1);return o;}
  return rnd()<.4?randomValue(depth+1):v;
}
const same=(a,b)=>{const enc=v=>JSON.stringify(v,(k,x)=>typeof x==='number'&&Number.isNaN(x)?'__NaN__':x);return enc(a)===enc(b);};

// 1) differential test: optimised restore === reference restore (structure AND key order)
let checked=0;
for(let n=0;n<600;n++){
  const base={root:randomValue(),arr:Array.from({length:Math.floor(rnd()*30)},()=>randomValue()),assets:Array.from({length:Math.floor(rnd()*20)},(_,i)=>({id:`A${i}`,phase:pick(['idle','moving']),specs:{capacity:i,tags:[1,2]},staffing:{ready:true}}))};
  const snap=structuredClone(mutate(base));
  const a=structuredClone(base),b=structuredClone(base);
  const outA=TX.restoreObject(a,snap),outB=referenceRestore(b,structuredClone(snap));
  assert.equal(outA,a,'restoreObject returns the same root object');
  assert.ok(same(outA,outB),`case ${n}: optimised restore must equal reference`);
  assert.ok(same(outA,snap),`case ${n}: restored graph equals snapshot`);
  assert.deepEqual(Object.keys(outA),Object.keys(snap),`case ${n}: root key order`);
  checked++;
}
// identity of unchanged nested containers is preserved (other modules hold references to them)
{const target={advanced:{facilities:{B1:{level:1,history:[1,2]}}},assets:[{id:'A',specs:{c:1}}]};const facilities=target.advanced.facilities,b1=facilities.B1,a0=target.assets[0],specs=a0.specs,arr=target.assets;
 const snap=structuredClone(target);snap.advanced.facilities.B1.level=7;snap.assets[0].specs.c=9;TX.restoreObject(target,snap);
 assert.equal(target.advanced.facilities,facilities);assert.equal(target.advanced.facilities.B1,b1);assert.equal(target.assets,arr);assert.equal(target.assets[0],a0);assert.equal(target.assets[0].specs,specs);
 assert.equal(b1.level,7);assert.equal(specs.c,9);}
// shape changes still go through the delete/re-add path
{const target={o:{a:1,b:2,c:3}};const snap={o:{c:30,a:10}};TX.restoreObject(target,snap);assert.deepEqual(Object.keys(target.o),['c','a']);assert.equal(target.o.c,30);assert.equal(target.o.a,10);assert.equal('b' in target.o,false);}
// NaN survives (NaN!==NaN must still be written)
{const target={v:1};TX.restoreObject(target,{v:NaN});assert.ok(Number.isNaN(target.v));}
// frozen targets keep failing loudly exactly like the delete path did
{const target={o:Object.freeze({a:1})};assert.throws(()=>TX.restoreObject(target,{o:{a:2}}),TypeError);}

// 2) discardable durable draft semantics
const liveStub={saveRevision:1,simSeconds:0,assets:[{id:'a1'}],ledger:[]};
const lastTiming=()=>TX.telemetry().last;
function withDurable(draft,fn){const previous=globalThis.__GH_DURABLE_COMMAND_CONTEXT__;const context={name:'test',liveState:liveStub,draft};globalThis.__GH_DURABLE_COMMAND_CONTEXT__=context;try{return fn(context);}finally{if(previous===undefined)delete globalThis.__GH_DURABLE_COMMAND_CONTEXT__;else globalThis.__GH_DURABLE_COMMAND_CONTEXT__=previous;}}
{ // outside a durable context the option is ignored: full snapshot, exact rollback
  const live={n:1,rows:[1,2,3]};
  assert.throws(()=>TX.execute(live,{label:'ignored-outside-durable',discardableDraft:true,apply:()=>{live.n=99;live.rows.push(4);throw new Error('boom');}}),/boom/);
  assert.equal(live.n,1);assert.deepEqual(live.rows,[1,2,3],'no durable context => normal full rollback');assert.equal(lastTiming().rollbackStorage,'full-snapshot');
}
{ // durable draft: success takes no snapshot
  const draft={n:1,rows:[1,2,3]};
  withDurable(draft,context=>{const out=TX.execute(draft,{label:'durable-success',discardableDraft:true,apply:()=>{draft.n=2;return 'ok';}});
    assert.equal(out.committed,true);assert.equal(out.value,'ok');assert.equal(draft.n,2);assert.equal(context.poisoned,undefined);assert.equal(lastTiming().rollbackStorage,'discardable-draft');assert.equal(lastTiming().fullSnapshot,false);assert.ok(lastTiming().snapshotMs<1,'no state clone is taken');});
}
{ // durable draft: failure poisons the command and does not pretend to restore
  const draft={n:1,rows:[1,2,3]};
  withDurable(draft,context=>{assert.throws(()=>TX.execute(draft,{label:'durable-failure',discardableDraft:true,apply:()=>{draft.n=99;throw new Error('boom');}}),/boom/);
    assert.equal(context.poisoned,true,'a failed discardable transaction must poison the durable command');});
}
{ // validation rejection also poisons
  const draft={n:1};
  withDurable(draft,context=>{const out=TX.execute(draft,{label:'durable-validation',discardableDraft:true,validate:()=>({ok:false,reason:'nope'}),apply:()=>{draft.n=5;return true;}});assert.equal(out.committed,false);assert.equal(context.poisoned,true);});
}
{ // the option is honoured only for the exact durable draft, never for another object (e.g. live state)
  const draft={n:1},other={n:1,rows:[1]};
  withDurable(draft,context=>{assert.throws(()=>TX.execute(other,{label:'wrong-target',discardableDraft:true,apply:()=>{other.n=2;other.rows.push(2);throw new Error('boom');}}),/boom/);
    assert.equal(other.n,1);assert.deepEqual(other.rows,[1],'non-draft target keeps full rollback');assert.equal(context.poisoned,undefined);assert.equal(lastTiming().rollbackStorage,'full-snapshot');});
}
{ // scoped and journal modes keep their own rollback even if the flag is passed
  const draft={a:{v:1},b:{v:1}};
  withDurable(draft,()=>{assert.throws(()=>TX.execute(draft,{label:'scoped',scope:['a'],discardableDraft:true,apply:()=>{draft.a.v=2;throw new Error('boom');}}),/boom/);assert.equal(draft.a.v,1);assert.equal(lastTiming().rollbackStorage,'legacy-scoped');});
}

// 3) source contracts in the game owner
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
assert.match(app,/label:'asset-purchase-composite',discardableDraft:true,/,'purchase opts into the discardable durable draft');
assert.match(app,/__GH_DURABLE_COMMAND_CONTEXT__\?\.poisoned===true\)throw new Error\(`\$\{name\}-draft-poisoned`\)/,'runDurableStateCommand refuses to publish a poisoned draft');
const poisonIndex=app.indexOf('-draft-poisoned'),schemaIndex=app.indexOf('GH_SAVE_SCHEMA.validate(draft',poisonIndex);
assert.ok(poisonIndex>0&&schemaIndex>poisonIndex,'poison check runs before schema validation, integrity and storage commit');

// 4) real-core parity: byte-identical state whether the purchase used the old full snapshot or the new draft path
process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
{
  const e=scenario(),s=e.s,live=e.state;live.godMoney=true;live.infiniteMoney=true;live.advanced.facilities.B1.capacity=1e6;live.globalBases.find(x=>x.id==='B1').deliveryCapacity=1e6;
  const tx=s.GH_TRANSACTION_CORE,item=e.item;
  // pre-existing fleet so publish/clone paths are exercised on a non-trivial state
  for(let i=0;i<3;i++){const total=item.price*200,b=live.globalBases.find(x=>x.id==='B1');tx.execute(live,{label:'seed',apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(live,()=>{e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base:b,supplier:{id:'S1',name:'S',legalName:'S'},mode:'cash',qty:200,manual:true,requestRef:`MANUAL-SEED${i}`,upfront:total,totalPrice:total,paymentMethod:'x',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});s.GH_REALISM.onSimulationTime(live,live.simSeconds);})});}
  const before=tx.deepClone(live);
  const order=(target,ref,qty=150)=>{const total=item.price*qty,b=target.globalBases.find(x=>x.id==='B1');return tx.execute(target,{label:'asset-purchase-composite',discardableDraft:true,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(target,()=>{const r=s.GH_DOMAIN_COMMANDS.dispatch({state:target,assetCatalog:s.GH_ASSET_CATALOG,supplierFor:()=>({id:'S1',name:'S'}),getDynamicFacilities:()=>[...target.globalBases,...target.customHubs],candidates:[]},'procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base:b,supplier:{id:'S1',name:'S',legalName:'S'},mode:'cash',qty,manual:true,requestRef:ref,upfront:total,totalPrice:total,paymentMethod:'x',documentLeadDays:1,leadSeconds:0,immediateDelivery:true}).result;s.GH_REALISM.onSimulationTime(target,target.simSeconds);return r.orderId;})});};
  // A: legacy path (no durable context => full snapshot). B: durable draft path (discardable) + restoreObject publish.
  const A=tx.deepClone(before);const outA=order(A,'MANUAL-PARITY-1');
  const liveB=tx.deepClone(before),draftB=tx.deepClone(liveB);
  s.__GH_DURABLE_COMMAND_CONTEXT__={name:'authorized:asset-purchase',liveState:liveB,draft:draftB};
  const outB=order(draftB,'MANUAL-PARITY-1');delete s.__GH_DURABLE_COMMAND_CONTEXT__;
  assert.equal(outA.committed,true);assert.equal(outB.committed,true);assert.equal(outA.value,outB.value);
  assert.equal(tx.telemetry().last.rollbackStorage,'discardable-draft');
  tx.restoreObject(liveB,draftB);
  assert.equal(JSON.stringify(A),JSON.stringify(liveB),'purchase result and publication are byte-identical to the legacy full-snapshot path');
  assert.equal(liveB.assets.length,A.assets.length);assert.equal(A.assets.length,before.assets.length+150);
  // failure path: capacity error must poison the draft and leave the live object untouched
  const live2=tx.deepClone(before),draft2=tx.deepClone(live2),liveJson=JSON.stringify(live2);
  s.__GH_DURABLE_COMMAND_CONTEXT__={name:'authorized:asset-purchase',liveState:live2,draft:draft2};
  live2.globalBases.find(x=>x.id==='B1').deliveryCapacity=1;draft2.globalBases.find(x=>x.id==='B1').deliveryCapacity=1;
  const failing=(()=>{try{return order(draft2,'MANUAL-PARITY-FAIL',150);}catch(error){return {threw:true,message:String(error.message)};}})();
  const poisoned=s.__GH_DURABLE_COMMAND_CONTEXT__.poisoned===true;delete s.__GH_DURABLE_COMMAND_CONTEXT__;
  assert.equal(failing.threw,true);assert.equal(poisoned,true,'failed purchase poisons the durable command');
  const liveNow=JSON.parse(liveJson);liveNow.globalBases.find(x=>x.id==='B1').deliveryCapacity=1;assert.equal(JSON.stringify(live2),JSON.stringify(liveNow),'live state is never touched by a failed draft');
}
console.log(JSON.stringify({suite:'build340-durable-draft-restore',restoreDifferentialCases:checked,contracts:'discardable-draft, poison, source, real-core parity',environment:`node ${process.version}; synthetic state; not iPhone performance`}));
