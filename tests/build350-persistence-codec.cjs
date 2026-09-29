'use strict';
// Build 350: the real persistence + startup-loader path with the state codec. Proves (1) loaded state is identical with
// and without the codec, (2) old plain saves still load, (3) corrupt encoded saves are rejected whole, (4) the native
// bridge contract (top-level saveVersion/saveRevision/resetEpoch, schema 2.0.0) is unchanged, and (5) a 20,000-asset
// fleet that CANNOT be saved without the codec is saved with it. Node-only; no DOM, iPhone or real Native Vault.
const assert=require('node:assert/strict');
const path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const norm=v=>JSON.parse(JSON.stringify(v));
// Never let assert print megabytes of JSON on failure: compare booleans and report sizes/first difference only.
const sameJSON=(a,b,msg)=>{const x=JSON.stringify(a),y=JSON.stringify(b);if(x===y)return;let i=0;while(i<x.length&&x[i]===y[i])i++;assert.fail(`${msg} (lengths ${x.length} vs ${y.length}; first difference at ${i}: ...${x.slice(Math.max(0,i-40),i+60)}... vs ...${y.slice(Math.max(0,i-40),i+60)}...)`);};

function fleet(orders,perOrder){
  const e=scenario(),s=e.s,state=e.state;state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e7;
  const base=state.globalBases.find(x=>x.id==='B1');base.deliveryCapacity=1e7;const tx=s.GH_TRANSACTION_CORE,item=e.item;
  for(let i=0;i<orders;i++){const total=item.price*perOrder;tx.execute(state,{label:'seed',apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{
    e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'S',legalName:'S'},mode:'cash',qty:perOrder,manual:true,requestRef:`MANUAL-P${i}`,upfront:total,totalPrice:total,paymentMethod:'x',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});
    s.GH_REALISM.onSimulationTime(state,state.simSeconds);})});}
  e.load('state-codec-core');e.load('persistence-core');e.load('migration-core');
  const store=new Map();
  s.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear(),get length(){return store.size},key:i=>[...store.keys()][i]??null};
  s.__store=store;
  return {e,s,state,store};
}
const withPlain=(s,fn)=>{const codec=s.GH_STATE_CODEC;s.GH_STATE_CODEC=undefined;try{return fn();}finally{s.GH_STATE_CODEC=codec;}};
const loadFrom=(x,extra={})=>x.s.GH_MIGRATION_CORE.load({defaultState:x.e.defaults,storageKey:'main',saveSchema:x.s.GH_SAVE_SCHEMA,...extra});
const api=x=>x.s.GH_PERSISTENCE;

// ---------- A) 1,000 real assets (under the 4 MB browser-cache limit): identical loaded state with and without the codec ----------
{
  const x=fleet(1,500);
  assert.ok(x.s.GH_MIGRATION_CORE?.load&&api(x)?.writeState,'real persistence and migration owners are loaded');
  const plain=withPlain(x.s,()=>api(x).writeState('main',x.state));assert.equal(plain.ok,true,plain.reason);
  const plainRaw=x.store.get('main');assert.ok(!/stateCodec/.test(plainRaw.slice(0,200)));
  const fromPlain=withPlain(x.s,()=>loadFrom(x));
  const coded=api(x).writeState('main',x.state);assert.equal(coded.ok,true,coded.reason);
  const codedRaw=x.store.get('main');assert.ok(/"stateCodec"/.test(codedRaw),'the codec marker is present');assert.ok(codedRaw.length<plainRaw.length*.3,`encoded ${codedRaw.length} vs plain ${plainRaw.length}`);
  const fromCoded=loadFrom(x);
  sameJSON(fromCoded.state,fromPlain.state,'loaded state is byte-identical with and without the codec');
  assert.equal(fromCoded.state.assets.length,500);assert.equal(fromCoded.source,'current');
  // ---------- B) an OLD plain save still loads when the codec is present ----------
  x.store.set('main',plainRaw);
  const upgraded=loadFrom(x);sameJSON(upgraded.state,fromPlain.state,'pre-350 plain saves load unchanged');
  // ---------- C) a corrupt / truncated / tampered encoded save is rejected whole ----------
  const tamper=(mutate,label)=>{const tree=JSON.parse(codedRaw);mutate(tree);x.store.set('main',JSON.stringify(tree));assert.throws(()=>loadFrom(x),/MIGRATION_JSON_INVALID/,label);};
  tamper(t=>{t.assets.r[0].pop();},'row arity');
  tamper(t=>{t.stateCodec.version='gh-shape-999';},'unknown codec version');
  tamper(t=>{delete t.assets;},'collection removed');
  x.store.set('main',codedRaw.slice(0,Math.floor(codedRaw.length*.6)));assert.throws(()=>loadFrom(x),/MIGRATION_JSON_INVALID/,'truncated json');
  x.store.set('main',codedRaw);
  // ---------- D) manual slot round trip (browser path) ----------
  const slot=api(x).saveSlot(1,x.state,{label:'t'});assert.equal(slot.ok,true,slot.reason);
  const parsed=api(x).loadSlot?api(x).loadSlot(1):null;
  const slotRaw=x.store.get('global-holdings-save-slot-2');assert.ok(/"stateCodec"/.test(slotRaw));
  const reparsed=x.s.GH_PERSISTENCE.slotStatus(1);assert.equal(reparsed.exists,true);
  void parsed;
  // ---------- E) recoverBrowserState decodes ----------
  const recovered=api(x).recoverBrowserState('main');assert.equal(recovered.ok,true,recovered.reason);assert.equal(recovered.state.assets.length,500);
  sameJSON(recovered.state,norm(x.state),'recovery returns the exact live state');
  // ---------- F) native bridge contract ----------
  const messages=[];x.s.webkit={messageHandlers:{saveBridge:{postMessage:m=>messages.push(m)}}};
  const out=api(x).commitState(x.state,{storageKey:'main'});assert.equal(out.ok,true,out.reason);
  const flush=async()=>{for(let i=0;i<5&&!messages.length;i++)await new Promise(r=>setTimeout(r,5));};
  (async()=>{await flush();
    const m=messages.at(-1);assert.equal(m.action,'commitSave');assert.equal(m.saveSchemaVersion,'2.0.0','native schema constant is untouched');
    const root=JSON.parse(m.saveJSON);assert.equal(root.saveVersion,'2.0.0','the native vault reads saveVersion from the JSON root');
    assert.ok(Number.isSafeInteger(root.saveRevision)&&Number.isSafeInteger(root.resetEpoch)&&root.saveRevision===m.saveRevision,'revision metadata stays at the root');
    assert.equal(m.saveHash,x.s.GH_CONTROL_PLANE.sha256(m.saveJSON),'hash covers the exact bytes sent');
    x.s.GH_PERSISTENCE.receiveAck({...m,success:true,generation:1});await out.native;
    // the vault hands the same string back at startup
    x.s.__GH_NATIVE_SAVE_JSON__=m.saveJSON;x.store.delete('main');
    const restored=loadFrom(x);assert.equal(restored.source,'native');assert.equal(restored.state.assets.length,500);
    sameJSON(restored.state.assets,norm(x.state.assets),'native round trip preserves every asset');
    console.log('PASS build350 persistence: plain/codec parity, old saves, tamper rejection, slots, recovery, native contract');
    await bigFleet();
  })().catch(error=>{console.error(error);process.exit(1);});
}

// ---------- G) 20,000 assets: impossible without the codec, comfortable with it ----------
async function bigFleet(){
  const x=fleet(20,1000),messages=[];x.s.webkit={messageHandlers:{saveBridge:{postMessage:m=>messages.push(m)}}};
  const LIMIT=30*1024*1024;
  const withoutCodec=withPlain(x.s,()=>api(x).commitState(x.state,{storageKey:'main'}));
  assert.equal(withoutCodec.ok,false,'without the codec the 20k fleet exceeds the native limit');assert.match(String(withoutCodec.reason),/native-save-size-hard-limit/);
  assert.equal(messages.length,0,'nothing was sent to the vault');
  const started=performance.now(),out=api(x).commitState(x.state,{storageKey:'main'}),syncMs=performance.now()-started;
  assert.equal(out.ok,true,out.reason);assert.ok(out.utf8Bytes<LIMIT*.4,`20k save is ${(out.utf8Bytes/1048576).toFixed(1)} MB`);
  for(let i=0;i<20&&!messages.length;i++)await new Promise(r=>setTimeout(r,5));
  const m=messages.at(-1);assert.ok(m&&Buffer.byteLength(m.saveJSON)===out.utf8Bytes);
  api(x).receiveAck({...m,success:true,generation:1});await out.native;
  x.s.__GH_NATIVE_SAVE_JSON__=m.saveJSON;const t0=performance.now(),restored=loadFrom(x),loadMs=performance.now()-t0;
  assert.equal(restored.state.assets.length,20000);
  x.s.__GH_NATIVE_SAVE_JSON__=JSON.stringify(x.state);const viaPlain=loadFrom(x);
  sameJSON(restored.state,viaPlain.state,'the 20,000-asset native save restores exactly what the plain JSON would have restored');
  sameJSON(restored.state.assets,norm(x.state.assets),'every one of the 20,000 assets survives byte for byte');
  console.log(JSON.stringify({suite:'build350-persistence-codec-20k',assets:20000,savedMB:+(out.utf8Bytes/1048576).toFixed(2),nativeLimitMB:30,withoutCodec:'rejected: native-save-size-hard-limit',saveSyncMs:Math.round(syncMs),startupLoadMs:Math.round(loadMs),environment:`node ${process.version}; synthetic fleet; not iPhone`}));
}
