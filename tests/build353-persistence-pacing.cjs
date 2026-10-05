'use strict';
// Build 353 persistence pacing: one UTF-8 encoding per native save. Build 358 (save policy): the engine never
// saves on a cadence and preferences never save on their own (GH_SAVE_POLICY owns the checkpoints).
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {harness,minimal,ROOT}=require('./helpers/core-harness');
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),results=[];
async function test(name,fn){try{results.push({name,ok:true,detail:await fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}

(async()=>{
 await test('a native ordinary save encodes its JSON once and hashes exactly those bytes',async()=>{
  const h=harness(['save-schema','persistence-core']),s=h.s,sha=text=>crypto.createHash('sha256').update(text).digest('hex');
  s.GH_CONTROL_PLANE={sha256:sha};let encodes=0;const Real=s.TextEncoder||TextEncoder;
  s.TextEncoder=class extends Real{encode(text){encodes++;return super.encode(text);}};
  let envelope=null;s.webkit={messageHandlers:{saveBridge:{postMessage:e=>{envelope=e;}}}};
  const state=minimal();state.notes='ع'.repeat(200000);
  const out=s.GH_PERSISTENCE.commitState(state,{storageKey:'main'});assert.equal(out.ok,true);
  for(let i=0;i<50&&!envelope;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert(envelope,'native envelope posted');assert.equal(envelope.saveHash,sha(envelope.saveJSON),'hash covers the exact posted JSON');
  assert.equal(out.utf8Bytes,Buffer.byteLength(envelope.saveJSON),'measured bytes are exact');assert.equal(encodes,1,'one UTF-8 encoding shared by size, mirror and hash');
  assert.equal(Object.hasOwn(envelope,'encoded'),false,'encoded bytes never leak into the bridge envelope');
  s.GH_PERSISTENCE.receiveAck({requestId:envelope.requestId,action:envelope.action,saveRevision:envelope.saveRevision,resetEpoch:envelope.resetEpoch,saveHash:envelope.saveHash,saveSchemaVersion:envelope.saveSchemaVersion,generation:1,success:true});
  return {utf8Bytes:out.utf8Bytes,encodes};
 });

 await test('a native-mode mirror warning is flagged as mirror-only',async()=>{
  const h=harness(['save-schema','persistence-core']),s=h.s,events=[];s.GH_CONTROL_PLANE={sha256:x=>crypto.createHash('sha256').update(x).digest('hex')};
  s.addEventListener('gh-persistence-status',event=>events.push(event.detail));s.webkit={messageHandlers:{saveBridge:{postMessage:()=>{}}}};
  const state=minimal();state.notes='a'.repeat(1100000);assert.equal(s.GH_PERSISTENCE.commitState(state,{storageKey:'main'}).ok,true);
  const warnings=events.filter(row=>row.warning);assert(warnings.length>=1);assert(warnings.every(row=>row.mirror===true),JSON.stringify(warnings));return {warnings:warnings.map(row=>row.reason)};
 });

 await test('the simulation engine never saves on a cadence: hiding the app is its only save request',()=>{
  const Simulation=require(path.join(ROOT,'WebApp/simulation-core.js'));let sim=0,clock=0;const persisted=[];
  const engine=Simulation.create({getSimTime:()=>sim,setSimTime:v=>{sim=v;},getSpeed:()=>30,createSliceJob:()=>({runChunk:()=>true,finish:()=>({committed:true})}),onPersist:detail=>persisted.push(detail?.reason||'cadence')},{nowMs:()=>clock});
  for(clock=0;clock<=600000;clock+=16)engine.frame(clock);assert.deepEqual(persisted,[],'ten minutes of frames request no save');
  engine.setHidden(true);assert.deepEqual(persisted,['hidden'],'hiding the app requests one save');
  const pacing=require(path.join(ROOT,'WebApp/simulation-pacing-core.js')).create({});assert.equal(typeof pacing.shouldPersist,'undefined','the pacing core has no save cadence');
  assert.equal(/persistEvery|persistMinIntervalMs|scheduleDeferredPersistence|recurringSaveMinIntervalMs/.test(app),false,'no timer-driven save remains in the app');
  return {persisted};
 });

 await test('interactive and derived-data paths never save on their own',()=>{
  const speed=app.slice(app.indexOf('  function setSpeed('),app.indexOf('\n',app.indexOf('  function setSpeed(')));assert(!/save\(|Persistence\(/.test(speed));
  const street=app.slice(app.indexOf('  async function hydrateMobilityStreetRoutes('),app.indexOf('  function setMapLayer('));assert(!/[^A-Za-z_.]save\(\)|Persistence\(/.test(street));
  const mode=app.slice(app.indexOf('state.mapMode=next;'),app.indexOf('\n',app.indexOf('state.mapMode=next;')));assert(!/save\(|Persistence\(/.test(mode));
  return {checked:3};
 });

 const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build353-persistence-pacing',passed,total:results.length,results},null,2));if(passed!==results.length)process.exitCode=1;
})();
