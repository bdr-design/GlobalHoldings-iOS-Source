'use strict';
// Build 359, iPhone diagnostics (24,000 assets, day 346): the frames that dropped during play and calendar advance were
// (1) the fault recorder's own sample passing over the whole fleet (28-46 ms every quarter second), (2) the fleet engine
// thread receiving the whole store again after the daily fleet pass rewrote three columns (67 ms), (3) the maintenance
// pass every 12 game hours in one frame (60 ms, its proof passes deep-copying the 25 MB proof store for rollback) and
// the full schema pass it asked of the next hourly slice (83 ms in one frame). Checked here:
// - the recorder takes the fleet signal once per rate window, not on every sample;
// - a column rewrite reaches the thread's replica as columns (no full sync) and leaves it equal to the main store,
//   presence bits included, also after a rolled-back column write;
// - the engine runs the host's deferred work one part per frame, before any new slice, also while paused, and gives
//   the frame after a heavy one no simulation work (cooldown);
// - a proof maintenance pass with the containers rollback policy, failed mid-way, leaves the proof store exactly as it
//   was, and committed, keeps every document verifying;
// - app.js queues the maintenance parts, validates after a compaction in sections, and passes the rollback policy.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),WEB=path.join(ROOT,'WebApp');
const app=fs.readFileSync(path.join(WEB,'app.js'),'utf8');

// ---------------------------------------------------------------- recorder ---
{
  const access=require(path.join(WEB,'fleet-access-core.js'));let scans=0;
  globalThis.GH_FLEET_DATA={...access,scan:(...args)=>{scans++;return access.scan(...args);},forEach:(...args)=>{scans++;return access.forEach(...args);}};
  const D=require(path.join(WEB,'diagnostics-core.js')),FIX=require(path.join(ROOT,'tests/helpers/fleet-fixture.js'));
  const state={simSeconds:1000,assets:FIX.fleet()};let now=1_000_000;const sim={frames:1,speed:600};
  D.recorderStart(state,sim,{nowMs:now});const atStart=scans;assert.ok(atStart>=1,'the start takes the fleet signal');
  for(let k=1;k<=11;k++){now+=250;sim.frames++;state.simSeconds+=150;D.recorderSample(state,sim,{nowMs:now});}
  assert.equal(scans,atStart,`samples inside the rate window do not pass over the fleet (${scans-atStart} passes)`);
  now+=250;sim.frames++;state.simSeconds+=150;D.recorderSample(state,sim,{nowMs:now});
  assert.equal(scans,atStart+1,'the window closing takes the fleet signal once');
  D.recorderStop(state,sim,{nowMs:now+10});assert.equal(scans,atStart+2,'the stop takes it once');
  delete globalThis.GH_FLEET_DATA;
}

// ------------------------------------------------------- thread columns ---
{
  const STORE=require(path.join(WEB,'fleet-store-core.js'));globalThis.GH_FLEET_STORE=STORE;
  require(path.join(WEB,'simulation-asset-core.js'));require(path.join(WEB,'fleet-event-core.js'));
  const THREAD=require(path.join(WEB,'fleet-engine-thread.js')),FIX=require(path.join(ROOT,'tests/helpers/fleet-fixture.js'));
  // The worker script in this realm: importScripts is satisfied (its cores are loaded), self is a message pair.
  const src=fs.readFileSync(path.join(WEB,'fleet-engine-worker.js'),'utf8');let listener=null,client=null;
  const self={GH_FLEET_STORE:STORE,GH_FLEET_EVENTS:globalThis.GH_FLEET_EVENTS,addEventListener:(type,fn)=>{if(type==='message')listener=fn;},postMessage:message=>{replies.push(message);worker.onmessage?.({data:structuredClone(message)});}};
  const replies=[];const replicaOf=new Function('self','importScripts',`${src}\nreturn ()=>store;`)(self,()=>{});
  const worker={postMessage:(message,transfer)=>listener({data:structuredClone(message,{transfer:transfer||[]})}),terminate(){}};
  client=THREAD.create({workerFactory:()=>worker,resolveRoute:FIX.resolveRoute,catalogSpecs:()=>({}),timeoutMs:60000});
  const store=STORE.fromAssets(FIX.fleet());
  const same=label=>{
    const replica=replicaOf();assert.ok(replica,'the replica exists');assert.equal(replica.length,store.length,`${label}: length`);
    const a=new Uint8Array(store.rows,0,store.length*STORE.STRIDE),b=new Uint8Array(replica.rows,0,replica.length*STORE.STRIDE);
    assert.ok(Buffer.compare(Buffer.from(a),Buffer.from(b))===0,`${label}: every record (presence bits included) equals the main store's`);
  };
  const step=at=>{const ticket=client.request(store,{from:at,to:at,context:FIX.context?.()||{},contextKey:'k',order:'events'});assert.ok(ticket,'the thread takes the step');client.discard(ticket);};
  step(0);const first=client.stats();assert.equal(first.fullSyncs,1,'the first exchange sends the store');same('after the first exchange');
  const fields=['flightHours','flightCycles','nextCheckHours'],write=STORE.columnWriter(store,fields);
  for(let index=0;index<store.length;index++)if(STORE.isAlive(store,index)){write(index,'flightHours',100+index);write(index,'flightCycles',index%7);write(index,'nextCheckHours',600-index%50);}
  step(0);const second=client.stats();
  assert.equal(second.fullSyncs,first.fullSyncs,`a column rewrite does not resend the store (${JSON.stringify(second.fullSyncReasons)})`);
  assert.equal(second.columnSyncs,1,'it travels as columns');same('after the column rewrite');
  // A column rewrite inside a transaction that rolls back: the rollback reports the columns again.
  const journal=STORE.beginJournal(store),again=STORE.columnWriter(store,fields);
  for(let index=0;index<store.length;index++)if(STORE.isAlive(store,index))again(index,'flightHours',9999);
  STORE.rollbackJournal(journal);step(0);const third=client.stats();
  assert.equal(third.fullSyncs,first.fullSyncs,'a rolled-back column rewrite does not resend the store');same('after the rolled-back rewrite');
  assert.ok(!replies.some(row=>row.type==='error'),`the worker reports no error: ${JSON.stringify(replies.filter(row=>row.type==='error'))}`);
}

// ------------------------------------------------ deferred work, cooldown ---
{
  const CORE=require(path.join(WEB,'simulation-core.js'));
  let t=0,sim=0,speed=600,created=0,finishCost=1;const ran=[],queue=[];
  const engine=CORE.create({
    getSimTime:()=>sim,setSimTime:v=>{sim=v;},getSpeed:()=>speed,setSpeed:v=>{speed=v;},
    createSliceJob:slice=>{created++;return {runChunk:()=>({done:true}),finish:()=>{t+=finishCost;return {committed:true};},cancel(){}};},
    onMaintenance:()=>{queue.push('a','b','c');},
    runDeferredWork:()=>{if(!queue.length)return false;ran.push({task:queue.shift(),created});return true;},
    hasDeferredWork:()=>queue.length>0
  },{nowMs:()=>t,allowedSpeeds:[0,30,600],fallbackSpeed:30,maintenanceEveryHours:1,frameBudgetMs:4,manualFrameBudgetMs:10,minRealSliceSeconds:0,cooldownAfterMs:24});
  const frame=()=>{t+=16;engine.frame(t);};
  for(let k=0;k<3000&&!ran.length;k++)frame();
  assert.ok(ran.length===1,'the maintenance boundary queues deferred work and the next frame runs one part');
  const createdAtFirst=ran[0].created;frame();frame();
  assert.deepEqual(ran.map(row=>row.task),['a','b','c'],'one part per frame');
  assert.ok(ran.every(row=>row.created===createdAtFirst),'no slice starts while parts wait');
  frame();assert.ok(created>createdAtFirst,'slices resume once the queue is empty');
  // While paused, a queued part still runs.
  speed=0;frame();queue.push('paused');frame();assert.equal(ran.at(-1).task,'paused','a part runs while paused');
  // Cooldown: a heavy finish leaves the next frame without simulation work.
  speed=600;frame();frame();finishCost=30;const before=engine.snapshot().cooldownFrames;
  for(let k=0;k<200&&engine.snapshot().cooldownFrames===before;k++)frame();
  assert.ok(engine.snapshot().cooldownFrames>before,'a heavy frame is followed by a cooldown frame');
  const heavy=engine.snapshot().maxFrame;assert.ok(heavy.finishMs>=30,`the frame stages name the heavy finish: ${JSON.stringify(heavy)}`);
  finishCost=1;const slicesBefore=engine.snapshot().slices;for(let k=0;k<60;k++)frame();
  assert.ok(engine.snapshot().slices>slicesBefore,'slices continue after the cooldown');
  engine.advanceTo(sim+3600,{speed:600,batchSeconds:3600});engine.noteFrameInterval(50);frame();assert.ok(engine.snapshot().activeFrameBudgetMs<10,'a delayed display frame reduces the manual simulation budget before the next slice');
  assert.equal(CORE.create({getSimTime:()=>0,setSimTime(){},createSliceJob(){}},{cooldownAfterMs:0}).config().cooldownAfterMs,0,'0 disables the cooldown');
}

// ------------------------------------------- staged fleet value collection ---
{
  const STORE=require(path.join(WEB,'fleet-store-core.js')),assets=[];
  for(let index=0;index<12_000;index++)assets.push({id:`GC-${index}`,name:`Asset ${index}`,assetMode:'road',type:'truck',ownerCompanyId:'road',baseFacility:'B1',phase:'idle',progress:0,fuel:100,condition:100,status:'متاح'});
  const store=STORE.fromAssets(assets),orphan=STORE.intern(store,{qa:'orphan'}),steps=STORE.collectValuesStages(store,{rowSlice:1024});let yields=0,step=steps.next();
  while(!step.done){yields++;step=steps.next();}
  assert.ok(yields>=10,`the read-only mark phase is split (${yields} yields)`);assert.equal(step.value.stale,false);assert.equal(store.values[orphan],null,'the final sweep reclaims the orphan');
  const later=STORE.intern(store,{qa:'retry'}),mixed=STORE.collectValuesStages(store,{rowSlice:1024});assert.equal(mixed.next().done,false);STORE.set(store,0,'condition',99);let result;while(!(result=mixed.next()).done){}
  assert.equal(result.value.stale,true,'a write between mark slices invalidates the snapshot');assert.notEqual(store.values[later],null,'an invalidated mark never sweeps');
  const retry=STORE.collectValuesStages(store,{rowSlice:1024});while(!(result=retry.next()).done){}assert.equal(result.value.stale,false);assert.equal(store.values[later],null,'a clean retry performs the sweep');
}

// --------------------------------------------- proof pass rollback policy ---
{
  const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
  const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Proof=s.GH_DOCUMENT_PROOF;
  state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e9;
  const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e9;const item=e.item;
  for(let order=0;order<40;order++){
    state.simSeconds+=1800;const total=item.price;
    const out=TX.execute(state,{label:`smooth-seed-${order}`,apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty:1,manual:true,requestRef:`SM-${order}`,upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:0})),validate:()=>true});
    assert.equal(out.committed,true);
  }
  state.simSeconds+=40*86400;
  const policy=(app.match(/const PROOF_MAINTENANCE_ROLLBACK=Object\.freeze\((\{documentProofs:Object\.freeze\(\{level:'containers'\}\)\})\)/)||[])[1];
  assert.ok(policy,'app.js declares the proof maintenance rollback policy');
  const rowRoots={documentProofs:{level:'containers'}},before=JSON.stringify(state.documentProofs),root=state.documentProofs;
  const failed=(()=>{try{return TX.execute(state,{label:'proof-history-checkpoints',scope:['documentProofs'],writeRoots:['documentProofs'],rowRoots,apply:()=>{const out=Proof.checkpointAncestors(state);assert.ok(out.checkpointed>0,'the pass has work');Proof.compactArchivedRecords(state);throw new Error('injected-after-publish');}});}catch(error){return {threw:error.message};}})();
  assert.ok(failed.threw?.includes('injected')||failed.committed===false,`the pass fails: ${JSON.stringify(failed)}`);
  assert.equal(state.documentProofs,root,'the proof store keeps its identity');
  assert.equal(JSON.stringify(state.documentProofs),before,'a failed pass leaves the proof store exactly as it was');
  const ok=TX.execute(state,{label:'proof-history-checkpoints',scope:['documentProofs'],writeRoots:['documentProofs'],rowRoots,apply:()=>Proof.checkpointAncestors(state)});
  assert.equal(ok.committed,true);assert.ok(Object.keys(state.documentProofs.checkpointsById||{}).length>0,'committed, the pass converts versions');
  assert.ok(Proof.stateDocuments(state).filter(row=>row?.documentProofId).every(document=>Proof.verifyDocument(state,document).ok===true),'every document still verifies');
}

// ------------------------------------------------------------- app wiring ---
{
  assert.match(app,/onMaintenance:hour=>\{[^\n]*queueMaintenance\(\);\},/,'the maintenance boundary only queues its parts');
  assert.match(app,/runDeferredWork:\(\)=>runDeferredMaintenance\(\)/,'the engine runs the queued parts');
  assert.match(app,/compactSimulationState\(false,\{schemaDue:false\}\)/,'the maintenance compaction does not ask the next hourly slice for a full schema pass');
  assert.match(app,/validationSteps\(state,\{trustVerified:true\}\)/,'after a compaction the schema is validated in sections');
  assert.match(app,/rowRoots:PROOF_MAINTENANCE_ROLLBACK/,'the proof passes use the containers rollback policy');
  assert.match(app,/GH_FLEET_DATA\.maintainStages\?\.\(state\)/,'fleet value collection is resumed across maintenance frames');
  assert.match(app,/function recordGuardedDiagnosticFrame\([^\n]*simulationProgressExpected:false/,'guarded frames tell diagnostics that simulation progress is intentionally paused');
  assert.ok(!/checkpointProofHistory\(\);window\.GH_FLEET_DATA\.maintain\(state\);const health/.test(app),'the one-frame maintenance pass is gone');
}
console.log(JSON.stringify({suite:'build359-sim-smoothness',checks:['recorder-window','thread-columns','deferred-work','cooldown','proof-rollback-policy','conference-pause-wiring','app-wiring']}));
console.log('BUILD359_SIM_SMOOTHNESS_PASS');
