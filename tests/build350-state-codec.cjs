'use strict';
// Build 350 state codec: exact round trip, no aliasing, input immutability, corruption/prototype hardening, and a
// hard size budget at 20,000 purchased assets. Node-only; proves logic and size, not device speed.
const assert=require('node:assert/strict');
const path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const Codec=require(path.join(ROOT,'WebApp/state-codec-core.js'));
const norm=v=>JSON.parse(JSON.stringify(v));
const same=(a,b,msg)=>assert.equal(JSON.stringify(a),JSON.stringify(b),msg);   // also proves key ORDER equality
const roundTrip=state=>Codec.decodeState(JSON.parse(JSON.stringify(Codec.encodeState(state))));

// ---- 1) randomized differential test against JSON semantics ----
let seed=0x1badcafe;const rnd=()=>{seed^=seed<<13;seed>>>=0;seed^=seed>>>17;seed^=seed<<5;seed>>>=0;return seed/4294967296;};
const pick=a=>a[Math.floor(rnd()*a.length)];
// JSON.parse-like: '__proto__' becomes an OWN data property, never a prototype change
const put=(o,k,v)=>Object.defineProperty(o,k,{value:v,writable:true,enumerable:true,configurable:true});
const KEYS=['id','name','phase','fuel','specs','staffing','roles','tags','x','y','note','0','7','__proto__','constructor','toString','ünï','a b','','$gh','stateCodec'];
const SCALARS=[0,1,-1,3.5,-0,NaN,Infinity,1e21,'a','',' ','ü','\u2028','\ud800',true,false,null,undefined];
function value(depth=0){
  const r=rnd();
  if(depth>3||r<.4)return pick(SCALARS);
  if(r<.62)return Array.from({length:Math.floor(rnd()*5)},()=>value(depth+1));
  const o={};for(let i=0,n=Math.floor(rnd()*6);i<n;i++)put(o,pick(KEYS),value(depth+1));return o;
}
const sharedRoles=[{id:'pilots',count:4},{id:'cabin',count:6}];
function row(i){
  const o={id:`R${i}`,phase:pick(['idle','moving']),fuel:Math.floor(rnd()*100)};
  if(rnd()<.8)o.specs={capacity:100,unit:'x',tags:['a','b','c']};       // repeated sub-value -> pool
  if(rnd()<.8)o.staffing={contract:`C${i}`,roles:structuredClone(sharedRoles),total:12};
  if(rnd()<.3)put(o,pick(KEYS),value(1));
  if(rnd()<.1)o.gone=undefined;                                          // JSON drops it
  return o;
}
let cases=0,collections=0;
for(let n=0;n<160;n++){
  const state={saveVersion:'2.0.0',saveRevision:n,resetEpoch:0,simSeconds:n*60,
    assets:Array.from({length:Codec.MIN_ROWS+Math.floor(rnd()*80)},(_,i)=>row(i)),
    small:Array.from({length:5},(_,i)=>row(i)),
    realism:{procurement:{deliveries:Array.from({length:Codec.MIN_ROWS+3},(_,i)=>row(i)),pendingDeliveryCount:0}},
    byId:Object.fromEntries(Array.from({length:Codec.MIN_ROWS+2},(_,i)=>[`K${i}`,row(i)])),
    misc:value(0),note:'x'};
  if(rnd()<.3)state.mixed=[...Array.from({length:Codec.MIN_ROWS},(_,i)=>row(i)),1];   // not eligible: stays raw
  const before=JSON.stringify(state);
  const encoded=Codec.encodeState(state);
  assert.equal(JSON.stringify(state),before,`case ${n}: encode must not mutate its input`);
  same(roundTrip(state),norm(state),`case ${n}: decode(encode(x)) must equal JSON semantics of x`);
  assert.ok(Codec.isEncoded(encoded)&&Codec.selectPaths(state).length>=3);
  collections+=Codec.selectPaths(state).length;cases++;
}
// ---- 2) passthrough when nothing qualifies; deterministic output ----
{const tiny={saveVersion:'2.0.0',assets:[{id:'a'}],x:{y:[1,2,3]}};assert.equal(Codec.encodeState(tiny),tiny);assert.equal(Codec.decodeState(tiny),tiny);
 const big={assets:Array.from({length:100},(_,i)=>row(i))};assert.equal(Codec.serialize(big),Codec.serialize(big),'encoding is deterministic');}
// ---- 3) no aliasing between decoded rows that shared a pooled value ----
{const state={assets:Array.from({length:100},(_,i)=>({id:i,staffing:{contract:`C${i}`,roles:structuredClone(sharedRoles)}}))};
 const out=roundTrip(state);assert.notEqual(out.assets[1].staffing.roles,out.assets[2].staffing.roles);out.assets[1].staffing.roles[0].count=999;
 assert.equal(out.assets[2].staffing.roles[0].count,4,'mutating one decoded asset must not change another');}
// ---- 4) structural sharing: only the path spine is copied ----
{const state={keep:{a:1},assets:Array.from({length:100},(_,i)=>({id:i}))};const enc=Codec.encodeState(state);assert.equal(enc.keep,state.keep);assert.notEqual(enc,state);}
// ---- 4b) shape constants: stored once, key order kept, decoded as fresh independent copies ----
{
  const rows=Array.from({length:100},(_,i)=>({id:`E${i}`,kind:'crew',specs:{cap:100,tags:['a','b']},n:i,status:'active',tail:i%2}));
  const enc=Codec.encodeState({items:rows}),coll=enc.items;
  const shape=coll.s.find(entry=>!Array.isArray(entry)&&entry.c&&entry.k.join()==='id,kind,specs,n,status,tail');
  assert.ok(shape,'the homogeneous shape stores constants');
  assert.deepEqual(shape.c.map(pair=>pair[0]),[1,2,4],'kind, specs and status are constant; id, n, tail vary');
  assert.equal(coll.r[0].length,1+3,'rows carry only the variable cells');
  const out=Codec.decodeState(JSON.parse(JSON.stringify(enc)));
  assert.deepEqual(Object.keys(out.items[0]),['id','kind','specs','n','status','tail'],'key order survives constant extraction');
  assert.notEqual(out.items[0].specs,out.items[1].specs);out.items[0].specs.tags.push('mut');assert.equal(out.items[1].specs.tags.length,2,'constants decode to independent copies');
  // fewer than MIN rows of a shape: no constants
  const few=Codec.encodeState({items:[...rows.slice(0,63),...Array.from({length:3},(_,i)=>({odd:i,kind:'x'}))]});
  const oddShape=few.items.s.find(entry=>(Array.isArray(entry)?entry:entry.k).join()==='odd,kind');assert.ok(Array.isArray(oddShape),'a 3-row shape keeps a plain key list');
  // a row whose value differs from the rest prevents the constant
  const mixed=Codec.encodeState({items:rows.map((row,i)=>i===50?{...row,status:'other'}:row)});
  const mixedShape=mixed.items.s.find(entry=>!Array.isArray(entry));assert.deepEqual(mixedShape.c.map(pair=>pair[0]),[1,2],'status is no longer constant');
  same(Codec.decodeState(JSON.parse(JSON.stringify(mixed))).items[50],{...rows[50],status:'other'});
}
// ---- 5) corruption and hostile input is rejected, never half-decoded ----
{
  const good=JSON.parse(JSON.stringify(Codec.encodeState({assets:Array.from({length:100},(_,i)=>({id:i,staffing:{roles:structuredClone(sharedRoles),c:i}}))})));
  const attempt=(mutate,label)=>{const t=structuredClone(good);mutate(t);assert.throws(()=>Codec.decodeState(t),e=>e.code==='STATE_CODEC_CORRUPT',label);};
  attempt(t=>{t.stateCodec.version='other';},'unknown version');
  attempt(t=>{t.stateCodec.paths=[['nope']];},'missing path');
  attempt(t=>{t.stateCodec.paths=[[]];},'empty path');
  attempt(t=>{t.assets.r[0][0]=999;},'unknown shape id');
  attempt(t=>{t.assets.r[0].push(1);},'row arity');
  attempt(t=>{t.assets.r[0]=5;},'row not an array');
  attempt(t=>{t.assets.p=[[-2,0]];t.assets.r[0]=[0,1,[-2,0]];},'cyclic pool');
  attempt(t=>{t.assets.r[0][1]=[-2,1e9];},'pool index out of range');
  attempt(t=>{t.assets.r[0][1]=[7.5,1];},'non-integer tag');
  attempt(t=>{t.assets.s[0]=[1];},'non-string shape key');
  attempt(t=>{t.assets.$gh=9;},'collection marker');
  {const constGood=JSON.parse(JSON.stringify(Codec.encodeState({assets:Array.from({length:100},(_,i)=>({id:i,kind:'crew',status:'ok'}))})));
   const tryConst=(mutate,label)=>{const t=structuredClone(constGood);mutate(t);assert.throws(()=>Codec.decodeState(t),e=>e.code==='STATE_CODEC_CORRUPT',label);};
   const withC=t=>t.assets.s.find(entry=>!Array.isArray(entry));
   tryConst(t=>{withC(t).c[0][0]=99;},'constant position out of range');
   tryConst(t=>{withC(t).c[0][0]=-1;},'negative constant position');
   tryConst(t=>{withC(t).c.push([withC(t).c[0][0],'dup']);},'duplicate constant position');
   tryConst(t=>{withC(t).c=[[0]];},'malformed constant pair');
   tryConst(t=>{withC(t).c='x';},'constants not an array');
   tryConst(t=>{t.assets.r[0].push('extra');},'row arity with constants');}
}
// ---- 6) prototype pollution ----
{
  const hostile=JSON.parse('{"stateCodec":{"version":"gh-shape-1","paths":[["assets"]]},"assets":{"$gh":1,"s":[["__proto__","id"]],"p":[],"r":[[0,{"polluted":1},"x"]]}}');
  assert.throws(()=>Codec.decodeState(hostile),e=>e.code==='STATE_CODEC_CORRUPT'&&/untagged-object/.test(e.message),'untagged objects are rejected');assert.equal(({}).polluted,undefined);
  const okTree=JSON.parse('{"stateCodec":{"version":"gh-shape-1","paths":[["assets"]]},"assets":{"$gh":1,"s":[["__proto__","id"]],"p":[],"r":[[0,[-1,1,2],"x"]]}}');
  const out=Codec.decodeState(okTree);assert.equal(({}).polluted,undefined);assert.equal(Object.getPrototypeOf(out.assets[0]),Object.prototype,'__proto__ key must stay an own data property');
  assert.deepEqual(Object.keys(out.assets[0]),['__proto__','id']);
}
// ---- 7) real game state: exact round trip, schema-valid, and the size budget at 20,000 assets ----
process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
function fleet(orders,perOrder){
  const e=scenario(),s=e.s,state=e.state;state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e7;
  const base=state.globalBases.find(x=>x.id==='B1');base.deliveryCapacity=1e7;const tx=s.GH_TRANSACTION_CORE,item=e.item;
  for(let i=0;i<orders;i++){const total=item.price*perOrder;tx.execute(state,{label:'seed',apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{
    e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'S',legalName:'S'},mode:'cash',qty:perOrder,manual:true,requestRef:`MANUAL-C${i}`,upfront:total,totalPrice:total,paymentMethod:'x',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});
    s.GH_REALISM.onSimulationTime(state,state.simSeconds);})});}
  return {e,s,state};
}
const mid=fleet(3,1000);
{
  const raw=JSON.stringify(mid.state),enc=Codec.serialize(mid.state);
  same(Codec.deserialize(enc),norm(mid.state),'real 3,000-asset state round-trips exactly');
  const decoded=Codec.deserialize(enc),schema=mid.s.GH_SAVE_SCHEMA.validate(decoded);assert.equal(schema.ok,true,`decoded state passes Save Schema: ${(schema.errors||[]).join(',')}`);
  assert.ok(enc.length<raw.length*.35,`3,000 assets must shrink below 35% (got ${(100*enc.length/raw.length).toFixed(1)}%)`);
}
const t0=performance.now(),big=fleet(20,1000);
const rawBytes=Buffer.byteLength(JSON.stringify(big.state));
const te=performance.now(),encoded=Codec.serialize(big.state),encodeMs=performance.now()-te;
const encBytes=Buffer.byteLength(encoded),td=performance.now(),decoded=Codec.deserialize(encoded),decodeMs=performance.now()-td;
same(decoded,norm(big.state),'real 20,000-asset state round-trips exactly');
const LIMIT=30*1024*1024,BUDGET_BYTES_PER_ASSET=450;
assert.equal(big.state.assets.length,20000);
// Build 358 stores delivered receipts compactly; the precondition is measured on the Build 357 equivalent with every
// receipt expanded to full asset copies, which is what the codec had to fit under the native limit.
const fleetAccess=big.s.GH_FLEET_DATA,expandedReceipts=big.state.realism.procurement.deliveries.map(row=>{if(!fleetAccess.isCompactReceipt(row))return row;const {assetReceipt,...rest}=row;void assetReceipt;return {...rest,assets:fleetAccess.receiptAssets(row)};});
const legacyRawBytes=Buffer.byteLength(JSON.stringify({...big.state,realism:{...big.state.realism,procurement:{...big.state.realism.procurement,deliveries:expandedReceipts}}}));
assert.ok(legacyRawBytes>LIMIT,'the uncompressed 20k fleet with full receipts really exceeds the native limit (proves the test is meaningful)');
assert.ok(rawBytes<legacyRawBytes,'compact receipts shrink the raw 20k state');
assert.ok(encBytes<LIMIT*.4,`encoded 20k save must stay under 40% of the native hard limit (got ${(encBytes/1048576).toFixed(1)} MB)`);
assert.ok(encBytes/20000<=BUDGET_BYTES_PER_ASSET,`per-asset budget ${BUDGET_BYTES_PER_ASSET} B exceeded: ${(encBytes/20000).toFixed(0)} B`);
console.log(JSON.stringify({suite:'build350-state-codec',randomCases:cases,collectionsChecked:collections,assets:20000,rawMB:+(rawBytes/1048576).toFixed(2),encodedMB:+(encBytes/1048576).toFixed(2),bytesPerAsset:Math.round(encBytes/20000),ratio:+(encBytes/rawBytes).toFixed(3),encodeMs:Math.round(encodeMs),decodeMs:Math.round(decodeMs),environment:`node ${process.version}; synthetic fleet; not iPhone`}));
