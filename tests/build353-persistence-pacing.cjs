'use strict';
// Build 353 persistence pacing: one UTF-8 encoding per native save, coalesced
// preference saves, and a host-widened (never shortened) recurring cadence.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
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

 await test('pacing host minimum widens but never shortens the recurring save cadence',()=>{
  const pacing=require(path.join(ROOT,'WebApp/simulation-pacing-core.js')).create({persistEveryNormalMs:1000,persistEveryFastMs:1000});
  const fire=(minimum)=>{let count=0;const p=require(path.join(ROOT,'WebApp/simulation-pacing-core.js')).create({persistEveryNormalMs:1000,persistEveryFastMs:1000});for(let now=1;now<=10000;now+=50)if(p.shouldPersist(now,1,minimum))count++;return count;};
  assert.equal(fire(0),fire(200),'a smaller minimum keeps the configured cadence');assert(fire(5000)<fire(0),'a larger minimum spaces saves out');void pacing;
  const Simulation=require(path.join(ROOT,'WebApp/simulation-core.js'));let sim=0,persisted=0,clock=0;
  const engine=Simulation.create({getSimTime:()=>sim,setSimTime:v=>{sim=v;},getSpeed:()=>30,createSliceJob:()=>({runChunk:()=>true,finish:()=>({committed:true})}),onPersist:()=>persisted++,persistMinIntervalMs:()=>60000},{nowMs:()=>clock,persistEveryNormalMs:1000,persistEveryFastMs:1000});
  for(clock=0;clock<=30000;clock+=16)engine.frame(clock);assert(persisted<=1,`host minimum must hold: ${persisted}`);return {withMinimum:persisted};
 });

 await test('preference saves are coalesced into one deferred persistence task',()=>{
  const start=app.indexOf('  let simulationPersistenceTask='),end=app.indexOf('  function persistStateNow(',start);assert(start>=0&&end>start);
  const timers=[],calls=[];const s=vm.createContext({state:{resetEpoch:0},hardResetInProgress:false,durableCommandInProgress:false,compactSimulationState:()=>calls.push('compact'),save:()=>calls.push('save'),setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{},console,Math,Number,Date,JSON,Object,globalThis:{},window:{GH_PERSISTENCE:{isLocked:()=>false}}});
  vm.runInContext(app.slice(start,end),s);
  for(let i=0;i<5;i++)s.scheduleDeferredPersistence();assert.equal(timers.length,1,'five preference changes schedule one timer');assert(timers[0].ms>=1000,'the deferred save is not immediate');
  assert.deepEqual(calls,[]);timers.shift().fn();while(timers.length)timers.shift().fn();assert.deepEqual(calls,['compact','save']);
  assert.equal(s.recurringSaveMinIntervalMs(),0,'no measured save keeps the configured cadence');vm.runInContext('runtimeInstrumentation.lastSavePreparation={totalMs:400}',s);assert.equal(s.recurringSaveMinIntervalMs(),60000,'a 400 ms save spaces recurring saves 60 s apart');vm.runInContext('runtimeInstrumentation.lastSavePreparation.totalMs=5000',s);assert.equal(s.recurringSaveMinIntervalMs(),120000,'capped at two minutes');
  return {calls};
 });

 await test('interactive and derived-data paths no longer save synchronously',()=>{
  const speed=app.slice(app.indexOf('  function setSpeed('),app.indexOf('\n',app.indexOf('  function setSpeed(')));assert(/scheduleDeferredPersistence\(\)/.test(speed));assert(!/[^A-Za-z_.]save\(\)/.test(speed));
  const street=app.slice(app.indexOf('  async function hydrateMobilityStreetRoutes('),app.indexOf('  function setMapLayer('));assert(/scheduleDeferredPersistence\(\)/.test(street));assert(!/[^A-Za-z_.]save\(\)/.test(street));
  return {checked:2};
 });

 const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build353-persistence-pacing',passed,total:results.length,results},null,2));if(passed!==results.length)process.exitCode=1;
})();
