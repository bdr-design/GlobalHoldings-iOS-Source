'use strict';
// Build 358 (million-asset save, step 3): with the native vault, GH_PERSISTENCE saves the fleet record buffer as
// 'chunks-v1' (GH_STATE_CODEC.serializeChunked), uploads the chunks the vault has not acknowledged before the commit
// that lists them, and never mirrors a chunked save to WebStorage. A stand-in native bridge implements the vault's
// contract (store a chunk; refuse a commit that lists a missing chunk; check the save hash) with asynchronous ACKs.
// Proven here: uploads only what changed; the saved instant is the moment the save was taken even when rows change
// while the upload runs; a bootstrap from the vault (manifest + chunks) loads the exact state and then uploads
// nothing; a stale vault set is forgotten after a refusal; manual slots and resets upload before they commit.
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,FLEET=s.GH_FLEET_DATA,STORE=s.GH_FLEET_STORE,TX=s.GH_TRANSACTION_CORE;
e.load('migration-core');e.load('state-codec-core');e.load('persistence-core');
const P=s.GH_PERSISTENCE,CODEC=s.GH_STATE_CODEC,results=[];
async function test(name,fn){try{results.push({name,ok:true,detail:await fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,2000)});}}

// ---- stand-in native vault ----------------------------------------------------------------------------------------
const vault={chunks:new Map(),saves:[],slots:new Map(),messages:[],generation:0,ackDelay:0,holdChunkAcks:null,stages:null};
const sha=text=>crypto.createHash('sha256').update(text,'utf8').digest('hex');
function referenced(json){const root=JSON.parse(json),rows=root?.fleet?.rows;return [...(rows?.$ghBinary==='chunks-v1'?rows.chunks:[]),...(Array.isArray(root?.stateCodec?.chunks)?root.stateCodec.chunks:[])];}
function deliver(name,detail){setTimeout(()=>s.dispatchEvent(new s.CustomEvent(name,{detail})),vault.ackDelay);}
const bridge={postMessage(message){
  vault.messages.push({action:message.action,id:message.id,bytes:message.bytes});
  if(message.action==='storeSaveChunk'){
    const bytes=Buffer.from(message.base64,'base64');
    const ack=()=>{const prior=vault.chunks.get(message.id);if(prior&&!prior.equals(bytes))return deliver('gh-native-chunk-ack',{requestId:message.requestId,id:message.id,success:false,message:'Save chunk id reused with other bytes.'});vault.chunks.set(message.id,bytes);deliver('gh-native-chunk-ack',{requestId:message.requestId,id:message.id,success:true});};
    if(vault.holdChunkAcks)vault.holdChunkAcks.push(ack);else ack();return;
  }
  if(message.action==='commitSave'||message.action==='resetGameSave'||message.action==='saveManualSlot'){
    const missing=referenced(message.saveJSON).find(id=>!vault.chunks.has(id));
    const ok=!missing&&sha(message.saveJSON)===message.saveHash;
    if(message.action==='saveManualSlot'){if(ok)vault.slots.set(message.index,message.saveJSON);return deliver('gh-native-slot-ack',{requestId:message.requestId,action:message.action,index:message.index,success:ok,message:missing?`Missing save chunk: ${missing}`:ok?'':'bad hash'});}
    if(ok)vault.saves.push(message.saveJSON);
    const event=message.action==='resetGameSave'?'gh-native-reset-ack':'gh-native-save-ack';
    deliver(event,{requestId:message.requestId,action:message.action,saveRevision:message.saveRevision,resetEpoch:message.resetEpoch,saveSchemaVersion:message.saveSchemaVersion,saveHash:message.saveHash,success:ok,generation:ok?++vault.generation:undefined,message:missing?`Missing save chunk: ${missing}`:ok?'':'bad hash',...(vault.stages?{nativeVaultStages:vault.stages}:{})});
  }
}};
// Saves and chunks travel over saveBridge; a reset over updateBridge (GameViewController owns both).
s.webkit={messageHandlers:{saveBridge:bridge,updateBridge:bridge}};
const uploads=()=>vault.messages.filter(m=>m.action==='storeSaveChunk');
const resetLog=()=>{vault.messages.length=0;};

// ---- a real fleet over two chunks ---------------------------------------------------------------------------------
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e7;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e7;const item=e.item;let order=0;
function purchase(qty){const total=item.price*qty;order++;return TX.execute(state,{label:`chunked-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{const r=e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty,manual:true,requestRef:`CHUNKED-${order}`,upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});s.GH_REALISM.onSimulationTime(state,state.simSeconds);return r;})});}
assert.equal(purchase(3000).committed,true);if(FLEET.mode(state)!=='store')s.GH_MIGRATION_CORE.migrateFleet(state);
// Grow past one chunk by direct store adds (the record ceiling guards purchases, not this test fleet).
TX.execute(state,{label:'chunked-grow',scope:['fleet'],apply:()=>{const template=FLEET.plain(state,FLEET.list(state)[0].id);for(let i=0;i<STORE.CHUNK_ROWS+2000;i++)FLEET.add(state,{...template,id:`N-AIR-GROW-${String(i).padStart(6,'0')}`,name:`GH AIR GROW ${i}`});}});
const key='build358-chunked-save';
const rowsOf=json=>JSON.parse(json).fleet.rows;

(async()=>{
  await test('a native save lists chunks, uploads them first and is not mirrored to WebStorage',async()=>{
    resetLog();const out=P.commitState(state,{storageKey:key});assert.equal(out.ok,true,out.reason);await out.native;
    const order=vault.messages.map(m=>m.action),commitAt=order.indexOf('commitSave');
    assert(commitAt>0&&order.slice(0,commitAt).every(a=>a==='storeSaveChunk'),`uploads precede the commit: ${order.join(',')}`);
    const json=vault.saves.at(-1),rows=rowsOf(json);assert.equal(rows.$ghBinary,'chunks-v1');assert.equal(rows.chunks.length,Math.ceil(state.fleet.rows.byteLength/(STORE.CHUNK_ROWS*STORE.STRIDE)));
    assert(!json.includes('"base64"'),'no base64 rows in the native save');assert.equal(s.localStorage.getItem(key),null,'a chunked save is never mirrored');
    return {chunks:rows.chunks.length,saveBytes:json.length,uploaded:uploads().length};
  });
  await test('an unchanged save uploads nothing; one written row uploads one chunk',async()=>{
    resetLog();await P.commitState(state,{storageKey:key}).native;assert.equal(uploads().length,0);
    resetLog();TX.execute(state,{label:'one-row',scope:['fleet'],apply:()=>STORE.set(state.fleet,STORE.CHUNK_ROWS+5,'fuel',33.5)});await P.commitState(state,{storageKey:key}).native;
    assert.equal(uploads().length,1);return {uploaded:uploads().length};
  });
  await test('cold finance history uploads as immutable bytes and stays out of the save JSON',async()=>{
    const archived=[{id:'OLD-AUDIT-1',number:'INV-OLD-1',at:1,amount:125.5,note:'cold-native-audit-row'}],page=CODEC.createColdArchivePage('invoices',archived,{firstAt:1,lastAt:1,createdAtSim:state.simSeconds});
    state.coldArchive={schema:'gh-cold-archive-v1',pages:[page]};resetLog();const out=P.commitState(state,{storageKey:key});await out.native;
    const saved=vault.saves.at(-1),tree=JSON.parse(saved),coldId=tree.coldArchive.pages[0].id;
    assert.equal(saved.includes('cold-native-audit-row'),false);assert(tree.stateCodec.chunks.includes(coldId));
    assert.deepEqual(uploads().map(row=>row.id),[coldId],'only the newly created cold page uploads');
    const loaded=CODEC.deserialize(saved,{resolveChunk:id=>vault.chunks.get(id)});assert.equal(JSON.stringify(CODEC.coldArchiveRows(loaded.coldArchive.pages[0])),JSON.stringify(archived));
    resetLog();await P.commitState(state,{storageKey:key}).native;assert.equal(uploads().length,0,'the immutable page is acknowledged once');
    return {coldBytes:vault.chunks.get(coldId).byteLength};
  });
  await test('a sliced save draft retains cold-page ownership across its structured clone',async()=>{
    resetLog();let yields=0;const out=await P.commitStateSliced(state,{storageKey:key,yieldToFrame:async()=>{yields++;}});assert.equal(out.ok,true,out.reason);
    const saved=vault.saves.at(-1),loaded=CODEC.deserialize(saved,{resolveChunk:id=>vault.chunks.get(id)});
    assert.equal(CODEC.validateColdArchive(loaded).ok,true);assert.equal(CODEC.coldArchiveRows(loaded.coldArchive.pages[0])[0].id,'OLD-AUDIT-1');
    return {yields,saveRevision:out.saveRevision};
  });
  await test('the save is the instant it was taken, even when rows change during the upload',async()=>{
    TX.execute(state,{label:'dirty',scope:['fleet'],apply:()=>{STORE.set(state.fleet,7,'fuel',11);STORE.set(state.fleet,STORE.CHUNK_ROWS+9,'fuel',12);}});
    const expected=new Uint8Array(state.fleet.rows.slice(0));vault.holdChunkAcks=[];resetLog();
    const out=P.commitState(state,{storageKey:key});
    // The simulation keeps writing while the vault has not answered yet.
    TX.execute(state,{label:'later',scope:['fleet'],apply:()=>{STORE.set(state.fleet,7,'fuel',99);STORE.set(state.fleet,STORE.CHUNK_ROWS+9,'fuel',98);}});
    for(let i=0;i<20&&vault.holdChunkAcks.length;i++){const held=vault.holdChunkAcks;vault.holdChunkAcks=[];held.forEach(f=>f());await new Promise(r=>setTimeout(r,5));}
    vault.holdChunkAcks=null;await out.native;
    const json=vault.saves.at(-1),loaded=CODEC.deserialize(json,{resolveChunk:id=>vault.chunks.get(id)});
    assert.deepEqual(new Uint8Array(loaded.fleet.rows),expected,'the vault holds the rows of the moment the save was taken');
    return {uploads:uploads().length};
  });
  await test('a bootstrap from the vault loads the exact state, then the next save uploads nothing',async()=>{
    await P.commitState(state,{storageKey:key}).native;const json=vault.saves.at(-1);
    s.__GH_NATIVE_SAVE_JSON__=json;s.__GH_NATIVE_SAVE_CHUNKS__=new Map(referenced(json).map(id=>[id,new Uint8Array(vault.chunks.get(id)).buffer]));
    P.forgetVaultChunks();
    const loaded=s.GH_MIGRATION_CORE.load({defaultState:e.defaultState||structuredClone(state),storageKey:key,saveSchema:s.GH_SAVE_SCHEMA});
    assert.equal(loaded.source,'native');assert.deepEqual(new Uint8Array(loaded.state.fleet.rows),new Uint8Array(state.fleet.rows),'rows are exact');
    assert.equal(s.__GH_NATIVE_SAVE_CHUNKS__,undefined,'the chunk map is released after the load');
    assert.equal(P.vaultChunkCount(),referenced(json).length,'the loaded chunks are known to be in the vault');
    resetLog();const out=P.commitState(loaded.state,{storageKey:key});await out.native;assert.equal(uploads().length,0,'the first save of the session uploads nothing');
    return {chunks:rowsOf(json).chunks.length};
  });
  await test('a missing chunk refuses the durable commit, the vault set is forgotten and the retry uploads',async()=>{
    // A committed save first: the vault set then holds every chunk of the current state.
    await P.commitState(state,{storageKey:key}).native;
    const json=vault.saves.at(-1),victim=rowsOf(json).chunks[0];vault.chunks.delete(victim);
    state.saveRevision=(Number(state.saveRevision)||0)+1;
    await assert.rejects(()=>P.commitDurableState(state,{storageKey:key,prevalidated:true}),/Missing save chunk/);
    assert.equal(P.vaultChunkCount(),0,'the stale vault set is forgotten');
    resetLog();const out=await P.commitDurableState(state,{storageKey:key,prevalidated:true});assert.equal(out.ok,true);
    assert(uploads().some(m=>m.id===victim),'the retry uploads the missing chunk');return {reuploaded:uploads().length};
  });
  await test('manual slots and resets upload their chunks before they commit',async()=>{
    resetLog();P.forgetVaultChunks();await P.saveSlot(1,state,{label:'slot'});
    const slotOrder=vault.messages.map(m=>m.action);assert(slotOrder.indexOf('saveManualSlot')>0&&slotOrder.slice(0,slotOrder.indexOf('saveManualSlot')).every(a=>a==='storeSaveChunk'));
    assert(referenced(vault.slots.get(1)).every(id=>vault.chunks.has(id)),'every chunk the slot lists is in the vault');
    const previous=state,next=TX.deepClone(state);next.saveRevision=(Number(state.saveRevision)||0)+1;
    TX.execute(next,{label:'next-world',scope:['fleet'],apply:()=>STORE.set(next.fleet,1,'fuel',1)});
    resetLog();await P.replaceState(next,previous,{storageKey:key});
    const resetAt=vault.messages.findIndex(m=>m.action==='resetGameSave');assert(resetAt>0&&vault.messages.slice(0,resetAt).every(m=>m.action==='storeSaveChunk'));
    assert(referenced(vault.saves.at(-1)).every(id=>vault.chunks.has(id)),'the reset world is complete in the vault');
    assert.equal(P.vaultChunkCount(),0,'the vault set is forgotten after a reset');
    return {slotUploads:slotOrder.filter(a=>a==='storeSaveChunk').length,resetUploads:resetAt};
  });
  await test('chunks travel as raw fetch POST bodies to gh://app; a runtime without the route falls back to the bridge',async()=>{
    // The page runs on gh://app in the app; the vault route answers {ok,id,sha256}.
    const posted=[],previousFetch=s.fetch,previousLocation=s.location;let routeMissing=false;
    s.location={protocol:'gh:'};
    s.fetch=async(url,init)=>{
      const id=decodeURIComponent(String(url).split('/save-chunk/')[1]||'');posted.push({url:String(url),method:init?.method,bytes:init?.body?.byteLength,isView:ArrayBuffer.isView(init?.body)});
      if(routeMissing)return {status:404,ok:false,json:async()=>({})};
      vault.chunks.set(id,Buffer.from(init.body.buffer,init.body.byteOffset,init.body.byteLength));
      return {status:200,ok:true,json:async()=>({ok:true,id,sha256:crypto.createHash('sha256').update(init.body).digest('hex')})};
    };
    try{
      P.forgetVaultChunks();resetLog();posted.length=0;await P.commitState(state,{storageKey:key}).native;
      assert(posted.length>0&&posted.every(row=>row.method==='POST'&&row.isView&&row.url.startsWith('gh://app/save-chunk/')),'chunks posted as raw bytes');
      assert.equal(uploads().length,0,'no base64 bridge upload when the route exists');
      const loaded=CODEC.deserialize(vault.saves.at(-1),{resolveChunk:id=>vault.chunks.get(id)});
      assert.deepEqual(new Uint8Array(loaded.fleet.rows),new Uint8Array(state.fleet.rows),'the posted chunks rebuild the saved rows');
      routeMissing=true;P.forgetVaultChunks();resetLog();posted.length=0;await P.commitState(state,{storageKey:key}).native;
      assert(posted.length>0&&uploads().length===posted.length,'a 404 sends each chunk over the bridge instead');
      return {posted:posted.length};
    }finally{s.fetch=previousFetch;s.location=previousLocation;}
  });
  // Build 358 (iPhone diagnostic: 3.4-5.3 s per native commit): GlobalSaveVault reports where a commit's time went and the
  // diagnostics keep it next to the ACK latency. Only short names with finite numbers are kept, rounded to 0.1 ms.
  await test('the native ACK carries the vault commit stages into the save telemetry',async()=>{
    vault.stages={parseMs:182.456,currentSlotMs:0.04,encodeMs:96.21,writeMs:41,verifyMs:22.5,chunkGcMs:0,chunkGcDeferred:1,backgroundChunkGcMs:7813.82,backgroundChunkGcDeleted:56,payloadBytes:21634300,envelopeBytes:24100000,'bad key':5,dropped:'NaN',nested:{x:1}};
    try{
      await P.commitState(state,{storageKey:key}).native;
      const ack=P.telemetry().timings.lastNativeAck;
      assert.equal(ack.kind,'native-ack');assert.equal(ack.success,true);
      assert.deepEqual(ack.nativeVaultStages,{parseMs:182.5,currentSlotMs:0,encodeMs:96.2,writeMs:41,verifyMs:22.5,chunkGcMs:0,chunkGcDeferred:1,backgroundChunkGcMs:7813.8,backgroundChunkGcDeleted:56,payloadBytes:21634300,envelopeBytes:24100000});
      vault.stages=null;await P.commitState(state,{storageKey:key}).native;
      assert.equal(P.telemetry().timings.lastNativeAck.nativeVaultStages,null,'an ACK without stages (an older app) records none');
      return {stages:Object.keys(ack.nativeVaultStages).length};
    }finally{vault.stages=null;}
  });
  const passed=results.filter(r=>r.ok).length;
  console.log(JSON.stringify({suite:'build358-native-chunked-save',passed,total:results.length,results},null,2));
  if(passed!==results.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
