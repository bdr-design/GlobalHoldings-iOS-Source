'use strict';
// Build 358 (lighter commands): a player command's save is taken in slices. GH_STATE_CODEC.serializeChunkedSteps and a
// piecewise UTF-8 encoding run in steps; commitDurableState awaits the caller's frame scheduler (yieldToFrame) whenever
// a slice has run 10 ms. Proven here, with a stand-in native vault and a real fleet store:
// - the sliced save posts exactly the bytes, hash and chunks of the one-shot save (and of GH_STATE_CODEC.serialize);
// - it really yields to the frame scheduler after every step that passes the slice budget (a clock the test moves makes
//   every step pass it: one yield per step), and records its busy time and slice count;
// - the UTF-8 pieces never split a surrogate pair (one straddles a piece boundary here; the posted hash is the SHA-256
//   of the text's UTF-8 bytes);
// - if the fleet records change while the slices run, the save is retaken in one go (one consistent instant);
// - serializeSteps run to the end is serialize().
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,FLEET=s.GH_FLEET_DATA,TX=s.GH_TRANSACTION_CORE;
e.load('migration-core');e.load('state-codec-core');e.load('persistence-core');
const P=s.GH_PERSISTENCE,CODEC=s.GH_STATE_CODEC,results=[];
// WebCrypto as on the device: a large save is hashed from its encoded UTF-8 bytes (saveHash), so the bytes are checked.
if(!s.crypto?.subtle)s.crypto=require('node:crypto').webcrypto;assert.ok(s.crypto.subtle);
async function test(name,fn){try{results.push({name,ok:true,detail:await fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,2000)});}}
const sha=text=>crypto.createHash('sha256').update(text,'utf8').digest('hex');
const vault={chunks:new Map(),saves:[]};
function deliver(name,detail){setTimeout(()=>s.dispatchEvent(new s.CustomEvent(name,{detail})),0);}
s.webkit={messageHandlers:{saveBridge:{postMessage(m){
  if(m.action==='storeSaveChunk'){vault.chunks.set(m.id,Buffer.from(m.base64,'base64'));return deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:true});}
  if(m.action==='commitSave'){vault.saves.push({json:m.saveJSON,hash:m.saveHash});return deliver('gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:true,generation:vault.saves.length});}
}}}};s.GH_NATIVE_BUILD=358;s.GH_CONTROL_PLANE=s.GH_CONTROL_PLANE||{};

// A real fleet store and a large text with surrogate pairs.
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e7;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e7;const item=e.item;
assert.equal(TX.execute(state,{label:'slices-fleet',apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{const r=e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty:2000,manual:true,requestRef:'SL-1',upfront:item.price*2000,totalPrice:item.price*2000,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});s.GH_REALISM.onSimulationTime(state,state.simSeconds);return r;})}).committed,true);
if(FLEET.mode(state)!=='store')s.GH_MIGRATION_CORE.migrateFleet(state);
assert.ok(FLEET.size(state)>=2000&&FLEET.mode(state)==='store','a fleet store of 2,000 assets');
// Pick a padding so that a surrogate pair straddles a 1M-unit piece boundary of the save text.
const PIECE=1<<20;let pad=0;
for(;pad<2;pad++){state.qaNotes=`${'ع'.repeat(pad)}${'😀'.repeat(1200000)}`;const text=CODEC.serializeChunked(state).text;let straddle=false;for(let at=PIECE-1;at<text.length;at+=PIECE){const c=text.charCodeAt(at);if(c>=0xD800&&c<=0xDBFF){straddle=true;break;}}if(straddle)break;}
assert.ok(pad<2,'a surrogate pair straddles a piece boundary');

(async()=>{
  let codecSteps=0;
  await test('serializeSteps run to the end is serialize()',()=>{const steps=CODEC.serializeChunkedSteps(state);let n=0,step;while(!(step=steps.next()).done)n++;assert.equal(step.value.text,CODEC.serializeChunked(state).text);assert.ok(n>2);codecSteps=n;return {steps:n};});
  // Build 359 (the yield check depended on one step passing 10 ms, so a fast machine could see none): with a clock that
  // moves 11 ms on every read, every step passes the slice budget, so the save must yield after each serialization step
  // and each UTF-8 piece: exactly that many yields, whatever the machine.
  await test('the save yields after every step that passes the slice budget',async()=>{
    const realPerformance=s.performance;let fake=0,yields=0;s.performance={now:()=>(fake+=11)};
    try{await P.commitDurableState(state,{storageKey:'slices',yieldToFrame:()=>{yields++;return new Promise(resolve=>setTimeout(resolve,0));}});}finally{s.performance=realPerformance;}
    const saved=vault.saves.at(-1),timing=P.telemetry().timings.samples.filter(row=>row.kind==='durable-save').at(-1),pieces=Math.ceil(saved.json.length/(1<<20));
    assert.ok(yields>=codecSteps+pieces-1&&yields<=codecSteps+pieces+1,`one yield per step: ${yields} yields for ${codecSteps} codec steps and ${pieces} UTF-8 pieces`);
    assert.equal(timing.slices,yields,'every yield is a recorded slice');assert.equal(saved.json,CODEC.serializeChunked(state).text,'and the same text');assert.equal(saved.hash,sha(saved.json));
    return {yields,codecSteps,pieces};
  });
  await test('the sliced save posts the bytes, hash and chunks of the one-shot save',async()=>{
    let yields=0;const yieldToFrame=()=>{yields++;return new Promise(resolve=>setTimeout(resolve,0));};
    await P.commitDurableState(state,{storageKey:'slices',yieldToFrame});const sliced=vault.saves.at(-1),timing=P.telemetry().timings.samples.filter(row=>row.kind==='durable-save').at(-1);
    await P.commitDurableState(state,{storageKey:'slices'});const once=vault.saves.at(-1);
    assert.equal(sliced.json,once.json,'the same text');assert.equal(sliced.hash,once.hash,'the same hash');assert.equal(sliced.json,CODEC.serializeChunked(state).text,'the codec text');
    assert.equal(sliced.hash,sha(sliced.json),'the hash covers the UTF-8 bytes of the text (no pair split between pieces)');
    assert.equal(timing.slices,yields,`the recorded slices are the yields (${yields} yields, ${timing.slices} slices)`);assert.equal(timing.retakes,0);
    assert.ok(timing.wallMs>=timing.totalSyncMs,'busy time is recorded apart from the wall time');
    const root=JSON.parse(sliced.json),listed=[...root.fleet.rows.chunks,...(root.stateCodec?.chunks||[])];assert.ok(listed.every(id=>vault.chunks.has(id)),'every listed chunk was uploaded');
    return {yields,slices:timing.slices,busyMs:Math.round(timing.totalSyncMs),wallMs:Math.round(timing.wallMs),bytes:timing.utf8Bytes};
  });
  await test('a fleet write during the slices retakes the save in one go',async()=>{
    const id=FLEET.list(state)[0].id;let wrote=false;
    const yieldToFrame=()=>{if(!wrote){wrote=true;TX.execute(state,{label:'slices-write',scope:['fleet'],apply:()=>FLEET.update(state,id,{condition:77.5})});}return new Promise(resolve=>setTimeout(resolve,0));};
    await P.commitDurableState(state,{storageKey:'slices',yieldToFrame});const saved=vault.saves.at(-1),timing=P.telemetry().timings.samples.filter(row=>row.kind==='durable-save').at(-1);
    assert.equal(wrote,true);assert.equal(timing.retakes,1,'the save was retaken');assert.equal(saved.json,CODEC.serializeChunked(state).text,'and holds the state after the write');assert.equal(saved.hash,sha(saved.json));
    const rows=JSON.parse(saved.json).fleet.rows.chunks;assert.ok(rows.every(id=>vault.chunks.has(id)),'with its chunks');
    return {retakes:timing.retakes};
  });
  const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build359-command-slices',pad,passed,total:results.length,results},null,1));
  if(passed!==results.length)process.exitCode=1;else console.log('BUILD359_COMMAND_SLICES_PASS');
})();
