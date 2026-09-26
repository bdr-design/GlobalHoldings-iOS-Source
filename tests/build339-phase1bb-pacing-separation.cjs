'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {harness,minimal}=require('./helpers/core-harness');
const ROOT=path.resolve(__dirname,'..');
const pacingSource=fs.readFileSync(path.join(ROOT,'WebApp/simulation-pacing-core.js'),'utf8');
const simSource=fs.readFileSync(path.join(ROOT,'WebApp/simulation-core.js'),'utf8');
const appSource=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');

function fakeClock(start=0){let now=start;return {now:()=>now,set:v=>{now=Number(v);},advance:v=>{now+=Number(v);}};}
function makeEngine({start=0,speed=30,clock=fakeClock(),options={}}={}){
  const e=harness(['simulation-core']);let sim=start,currentSpeed=speed;const commits=[];
  const engine=e.s.GH_SIMULATION_CORE.create({
    getSimTime:()=>sim,setSimTime:v=>{sim=v;},getSpeed:()=>currentSpeed,setSpeed:v=>{currentSpeed=v;},
    createSliceJob:(slice,meta)=>({runChunk(){return true;},finish(info){commits.push({from:info.from,to:info.to,boundary:{...info.boundary}});return {committed:true};}})
  },{nowMs:clock.now,allowedSpeeds:[0,30,120,300,600],fallbackSpeed:30,frameBudgetMs:100,manualFrameBudgetMs:100,maxBacklogFast:5000,minRealSliceSeconds:0,...options});
  engine.reset(clock.now(),'phase1bb-test');
  return {engine,clock,commits,get sim(){return sim;},get speed(){return currentSpeed;}};
}

// 1. The pacing owner is runtime-only and has no authoritative simulation-time concept.
assert(!/\bsimSeconds\b/.test(pacingSource),'pacing core must not own simSeconds');
assert(!/\bstate\s*\./.test(pacingSource),'pacing core must not mutate game state');
assert.match(simSource,/GH_SIMULATION_PACING_CORE/);
assert.doesNotMatch(simSource,/let\s+lastReal\s*=/,'wall-clock anchor must live in pacing core');
assert.doesNotMatch(simSource,/let\s+lastRender\s*=/,'render cadence must live in pacing core');

// 2. Wall-clock backlog math is isolated and deterministic.
{
  const sandbox={console,Math,Date};sandbox.globalThis=sandbox;sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(pacingSource,sandbox,{filename:'simulation-pacing-core.js'});
  const clock=fakeClock(0),p=sandbox.GH_SIMULATION_PACING_CORE.create({nowMs:clock.now,isFast:s=>s>30,maxRealDelta:3,maxBacklogNormal:1000,maxBacklogFast:5000,frameBudgetMs:7,manualFrameBudgetMs:11,renderEveryNormalMs:180,renderEveryFastMs:450,persistEveryNormalMs:12000,persistEveryFastMs:30000});
  p.reset(0);assert.equal(p.observeLiveFrame(1000,30).backlog,30);assert.equal(p.consume(10),20);
  const stalled=p.observeLiveFrame(6000,30);assert.equal(stalled.stalled,true);assert.equal(stalled.droppedRealSeconds,5);assert.equal(p.backlog(),20,'stall must not manufacture simulation backlog');
  p.setManualBacklog(90000,7000);assert.equal(p.backlog(),90000);assert.equal(p.consume(3600),86400);
  p.limitBacklog(12);assert.equal(p.backlog(),12);
  clock.set(100);assert.equal(p.executionDeadline(false),107);assert.equal(p.executionDeadline(true),111);
}

// 3. Existing live rates remain exact.
const rates={};
for(const rate of [30,120,300,600]){
  const x=makeEngine({speed:rate});x.clock.set(1000);x.engine.frame(1000);rates[rate]=x.sim;assert.equal(x.sim,rate,`${rate}x drifted`);
}

// 4. A large but valid live backlog is consumed through variable slices without changing economic time semantics.
{
  const x=makeEngine({speed:600});x.clock.set(2500);x.engine.frame(2500);
  assert.equal(x.sim,1500);assert.deepEqual(x.commits.map(r=>r.to-r.from),[600,600,300]);
}

// 5. Background/resume never replays hidden wall-clock time.
{
  const x=makeEngine({speed:30});x.clock.set(1000);x.engine.frame(1000);assert.equal(x.sim,30);
  x.engine.setHidden(true);x.clock.set(61000);x.engine.setHidden(false);x.clock.set(62000);x.engine.frame(62000);
  assert.equal(x.sim,60,'hidden duration was incorrectly converted into economic catch-up');
}

// 6. Manual advance is target-driven and its own wall duration cannot leak into later live play.
{
  const x=makeEngine({speed:30,options:{manualBatchSeconds:3600,manualMinBatchSeconds:300}});
  const accepted=x.engine.advanceTo(7200,{speed:600,batchSeconds:3600});assert.equal(accepted.accepted,true);
  x.clock.set(5000);x.engine.frame(5000);x.clock.set(10000);x.engine.frame(10000);assert.equal(x.sim,7200);assert.equal(x.engine.snapshot().manualAdvance,null);
  x.clock.set(11000);x.engine.frame(11000);assert.equal(x.sim,7230,'manual wall duration leaked into live backlog');
}

// 7. Runtime scheduler snapshots are no longer copied into persisted state by render cadence.
assert.doesNotMatch(appSource,/state\.simulationKernel\s*=\s*\{[^\n]*simulationEngine\.snapshot/s,'render callback persists runtime scheduler snapshot');
assert.doesNotMatch(appSource,/state\.simulationKernel\s*=\s*\{\.\.\.\(state\.simulationKernel\|\|\{\}\),\.\.\.simulationEngine\.snapshot\(\)/s,'legacy runtime snapshot persistence returned');

// 8. Save normalization strips old runtime pacing residue while retaining semantic audit fields.
{
  const e=harness(['save-schema']),state=minimal();state.simulationKernel={
    backlog:321,hidden:true,pacing:{backlog:321,lastReal:99},config:{frameBudgetMs:5.5},coreVersion:'3.0.0',transactionVersion:'3.0.0',
    lastAtomicCommit:{from:0,to:30},lastAtomicCancel:{reason:'test'},lastAdvanceFailure:{reason:'test'},lastCompactDay:7,boundaryRecovery:{hour:83}
  };
  e.s.GH_SAVE_SCHEMA.normalize(state,{});
  for(const key of ['backlog','hidden','pacing','config','coreVersion','transactionVersion'])assert.equal(Object.prototype.hasOwnProperty.call(state.simulationKernel,key),false,`runtime key persisted: ${key}`);
  assert.deepEqual(JSON.parse(JSON.stringify(state.simulationKernel.lastAtomicCommit)),{from:0,to:30});
  assert.equal(state.simulationKernel.lastCompactDay,7);assert.equal(state.simulationKernel.boundaryRecovery.hour,83);
}

console.log(JSON.stringify({suite:'build339-phase1bb-pacing-separation',passed:true,rates,contracts:['runtime-pacing-owner','variable-slices','background-resume','manual-anchor','non-persistence','legacy-runtime-cleanup']},null,2));
