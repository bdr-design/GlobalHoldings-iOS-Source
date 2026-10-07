'use strict';
// Build 358 (save size, from the iPhone diagnostic of 2026-10-05): the save was 21 MB, ~20 MB of it sealed document and
// authorization proofs written again by every commit (1.6-1.8 s of bridge per player command). With the native vault,
// GH_STATE_CODEC.serializeChunked keeps every sealed segment of TEXT_CHUNK_MIN+ characters out of the save text as a
// vault chunk ({"$ghText":"chunk-v1",id,bytes}); stateCodec.chunks lists them for the vault. Proven here with a
// stand-in vault (stores chunks, refuses a commit that lists a missing one, checks the hash): the native save is a
// fraction of the full text; it decodes to exactly the state; an unchanged save uploads nothing and a new document
// uploads only its segment; a bootstrap from the vault reuses the vault's chunk ids (nothing uploaded again); a
// missing, unlisted or altered chunk is a corrupt save; serialize/exports stay self-contained.
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE;
e.load('migration-core');e.load('state-codec-core');e.load('persistence-core');
const P=s.GH_PERSISTENCE,CODEC=s.GH_STATE_CODEC,results=[];
async function test(name,fn){try{results.push({name,ok:true,detail:await fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,2000)});}}

// ---- stand-in native vault (GlobalSaveVault's contract: fleet.rows.chunks and stateCodec.chunks) -------------------
const vault={chunks:new Map(),saves:[],messages:[],generation:0};
const sha=text=>crypto.createHash('sha256').update(text,'utf8').digest('hex');
function referenced(json){const root=JSON.parse(json),rows=root?.fleet?.rows;return [...(rows?.$ghBinary==='chunks-v1'?rows.chunks:[]),...(Array.isArray(root?.stateCodec?.chunks)?root.stateCodec.chunks:[])];}
function deliver(name,detail){setTimeout(()=>s.dispatchEvent(new s.CustomEvent(name,{detail})),0);}
const bridge={postMessage(message){
  vault.messages.push({action:message.action,id:message.id,bytes:message.bytes});
  if(message.action==='storeSaveChunk'){const bytes=Buffer.from(message.base64,'base64'),prior=vault.chunks.get(message.id);if(prior&&!prior.equals(bytes))return deliver('gh-native-chunk-ack',{requestId:message.requestId,id:message.id,success:false,message:'Save chunk id reused with other bytes.'});vault.chunks.set(message.id,bytes);return deliver('gh-native-chunk-ack',{requestId:message.requestId,id:message.id,success:true});}
  if(message.action==='commitSave'){
    const missing=referenced(message.saveJSON).find(id=>!vault.chunks.has(id)),ok=!missing&&sha(message.saveJSON)===message.saveHash;if(ok)vault.saves.push(message.saveJSON);
    deliver('gh-native-save-ack',{requestId:message.requestId,action:message.action,saveRevision:message.saveRevision,resetEpoch:message.resetEpoch,saveSchemaVersion:message.saveSchemaVersion,saveHash:message.saveHash,success:ok,generation:ok?++vault.generation:undefined,message:missing?`Missing save chunk: ${missing}`:ok?'':'bad hash'});
  }
}};
s.webkit={messageHandlers:{saveBridge:bridge,updateBridge:bridge}};
const textUploads=()=>vault.messages.filter(m=>m.action==='storeSaveChunk'&&/\.t\./.test(m.id||''));
const resetLog=()=>{vault.messages.length=0;};
const key='build358-proof-chunks';
const resolver=id=>{const bytes=vault.chunks.get(id);return bytes?new Uint8Array(bytes).buffer:undefined;};
const plainCopy=value=>JSON.parse(JSON.stringify(value,(k,v)=>Object.prototype.toString.call(v)==='[object ArrayBuffer]'?Buffer.from(v).toString('base64'):v));

// ---- a game with many signed documents: each invoice seals a document proof ------------------------------------------
let invoiceSeq=0;
function issueInvoices(count){TX.execute(state,{label:`invoices-${invoiceSeq}`,apply:()=>{for(let i=0;i<count;i++)e.command('finance','issue-invoice',{kind:'دخل',amount:100000+(++invoiceSeq),note:`خدمات شحن جوي ${invoiceSeq}`,method:'تحويل عميل',taxable:true,status:'مستحقة',company:'air',counterparty:'شركة أطلس للخدمات اللوجستية'});}});TX.sealCollections?.(state);}
issueInvoices(700);
if(s.GH_FLEET_DATA.mode(state)!=='store')s.GH_MIGRATION_CORE.migrateFleet(state);

(async()=>{
  await test('the native save keeps the sealed proofs in vault chunks and lists them for the vault',async()=>{
    resetLog();const out=P.commitState(state,{storageKey:key});assert.equal(out.ok,true,out.reason);await out.native;
    const json=vault.saves.at(-1),root=JSON.parse(json),full=CODEC.serialize(state);
    assert.equal(root.stateCodec.version,'gh-shape-4');assert(Array.isArray(root.stateCodec.chunks)&&root.stateCodec.chunks.length>0,'stateCodec.chunks lists the text chunks');
    assert(referenced(json).every(id=>vault.chunks.has(id)),'every listed chunk is in the vault before the commit');
    assert.equal((json.match(/"\$ghText":"chunk-v1"/g)||[]).length,root.stateCodec.chunks.length,'one marker per listed chunk');
    assert(!full.includes('$ghText'),'serialize (exports, WebStorage) stays self-contained');
    // Build 359: records are issued compact (about a fifth of a whole record), so they are no longer most of the save
    // text: what leaves it is the sealed proof records themselves, every one of their segments a vault chunk.
    const fullRecords=JSON.stringify(JSON.parse(full).documentProofs.recordsById),nativeRecords=JSON.stringify(root.documentProofs.recordsById),inline=nativeRecords.replace(/\{"\$ghText":"chunk-v1","id":"[^"]+","bytes":\d+\}/g,'');
    assert(!/DOCP-|compact-document/.test(inline)&&inline.length<200,`the sealed proof records are all in vault chunks (${inline})`);
    assert(full.length-json.length>=fullRecords.length*.9,`the native save leaves their text out (${json.length} of ${full.length}; records ${fullRecords.length})`);
    return {nativeBytes:json.length,fullBytes:full.length,recordText:fullRecords.length,textChunks:root.stateCodec.chunks.length,uploaded:textUploads().length};
  });
  await test('the chunked save decodes to exactly the state',async()=>{
    const json=vault.saves.at(-1),decoded=CODEC.deserialize(json,{resolveChunk:resolver});
    assert.deepEqual(plainCopy(decoded),plainCopy(CODEC.deserialize(CODEC.serialize(state))));
    return {proofs:Object.keys(decoded.documentProofs.recordsById).length};
  });
  await test('an unchanged save uploads nothing; a new document uploads only the segment it changed',async()=>{
    resetLog();await P.commitState(state,{storageKey:key}).native;assert.equal(textUploads().length,0,'unchanged: no upload');
    issueInvoices(1);resetLog();await P.commitState(state,{storageKey:key}).native;
    const uploaded=textUploads().length,total=JSON.parse(vault.saves.at(-1)).stateCodec.chunks.length;
    assert(uploaded>=1&&uploaded<=3&&uploaded<total,`one new document uploads its segment(s) only: ${uploaded} of ${total}`);
    return {uploaded,total};
  });
  await test('a bootstrap from the vault loads the exact state and the next save uploads no text chunk',async()=>{
    await P.commitState(state,{storageKey:key}).native;const json=vault.saves.at(-1);
    s.__GH_NATIVE_SAVE_JSON__=json;s.__GH_NATIVE_SAVE_CHUNKS__=new Map(referenced(json).map(id=>[id,resolver(id)]));P.forgetVaultChunks();
    const loaded=s.GH_MIGRATION_CORE.load({defaultState:structuredClone(state),storageKey:key,saveSchema:s.GH_SAVE_SCHEMA});
    assert.equal(loaded.source,'native');
    assert.deepEqual(plainCopy(loaded.state.documentProofs),plainCopy(state.documentProofs),'the proofs are exact');
    TX.sealCollections?.(loaded.state);resetLog();const out=P.commitState(loaded.state,{storageKey:key});assert.equal(out.ok,true,out.reason);await out.native;
    assert.equal(textUploads().length,0,'the loaded text chunks are reused by id, not uploaded again');
    assert.deepEqual(JSON.parse(vault.saves.at(-1)).stateCodec.chunks,JSON.parse(json).stateCodec.chunks,'the same ids');
    return {chunks:JSON.parse(json).stateCodec.chunks.length,stats:CODEC.cacheStats().text};
  });
  await test('a missing, unlisted, short or altered text chunk is a corrupt save',async()=>{
    const json=vault.saves.at(-1),root=JSON.parse(json),victim=root.stateCodec.chunks[0];
    assert.throws(()=>CODEC.deserialize(json,{resolveChunk:id=>id===victim?undefined:resolver(id)}),/state-codec-corrupt:text-chunk-missing/);
    assert.throws(()=>CODEC.deserialize(json,{resolveChunk:id=>id===victim?resolver(id).slice(1):resolver(id)}),/state-codec-corrupt:text-chunk-length/);
    assert.throws(()=>CODEC.deserialize(json,{resolveChunk:id=>{const b=new Uint8Array(resolver(id));if(id===victim)b[0]=0x5b;return b.buffer;}}),/state-codec-corrupt:text-chunk-collection|state-codec-corrupt:text-chunk-json/);
    const unlisted=JSON.parse(json);unlisted.stateCodec.chunks=unlisted.stateCodec.chunks.slice(1);
    assert.throws(()=>CODEC.decodeState(unlisted,{resolveChunk:resolver}),/state-codec-corrupt:text-chunk-unlisted/);
    const extra=JSON.parse(json);extra.stateCodec.chunks.push('never.used.1');
    assert.throws(()=>CODEC.decodeState(extra,{resolveChunk:resolver}),/state-codec-corrupt:text-chunk-unused/);
    return {victim};
  });
  await test('a commit whose text chunk the vault lost is refused, and the retry uploads it',async()=>{
    const json=vault.saves.at(-1),victim=JSON.parse(json).stateCodec.chunks[0];vault.chunks.delete(victim);
    state.saveRevision=(Number(state.saveRevision)||0)+1;
    await assert.rejects(()=>P.commitDurableState(state,{storageKey:key,prevalidated:true}),/Missing save chunk/);
    resetLog();const out=await P.commitDurableState(state,{storageKey:key,prevalidated:true});assert.equal(out.ok,true);
    assert(textUploads().some(m=>m.id===victim),'the retry uploads the missing text chunk');
    return {reuploaded:textUploads().length};
  });
  const passed=results.filter(r=>r.ok).length;
  console.log(JSON.stringify({suite:'build358-proof-chunks',passed,total:results.length,results},null,2));
  if(passed!==results.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
