'use strict';
// Build 359 (a million assets): the fault recorder's asset signal summed every asset's progress (40 ms on iPhone at
// 24,000 assets, once every 3 s while recording). With a fleet store it is now the moving count by row class and the
// store's revision (every fleet write advances it). Checked here:
// - with a store the signal never passes over the fleet (no scan, no forEach), on start, samples, window and stop;
// - assets moving while the revision stays still raise ASSET_REVENUE_PROGRESS_STALLED once;
// - a fleet write in the window (the revision moves) is progress: no stall;
// - the signal counts the moving assets.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),WEB=path.join(ROOT,'WebApp');
global.window=global;require(path.join(WEB,'transaction-core.js'));
const STORE=require(path.join(WEB,'fleet-store-core.js')),access=require(path.join(WEB,'fleet-access-core.js')),FIX=require(path.join(ROOT,'tests/helpers/fleet-fixture.js'));
let passes=0;globalThis.GH_FLEET_DATA={...access,scan:(...args)=>{passes++;return access.scan(...args);},forEach:(...args)=>{passes++;return access.forEach(...args);}};
const D=require(path.join(WEB,'diagnostics-core.js')),results=[];
const test=(name,fn)=>{try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error?.stack||error).slice(0,2000)});}};
const assets=FIX.fleet();FIX.oldSlice(assets,999,1000);
const fresh=()=>({simSeconds:1000,fleet:STORE.fromAssets(JSON.parse(JSON.stringify(assets)),{at:1000})});
const moving=assets.filter(a=>a.phase==='moving').length;

test('with a store the signal never passes over the fleet',()=>{
  const state=fresh(),sim={frames:1,speed:600};let now=2_000_000;passes=0;
  D.recorderStart(state,sim,{nowMs:now});for(let k=0;k<30;k++){now+=250;sim.frames++;state.simSeconds+=150;D.recorderSample(state,sim,{nowMs:now});}D.recorderStop(state,sim,{nowMs:now+10});
  assert.equal(passes,0,`no pass over the fleet (${passes})`);
  const sample=D.recorderSnapshot(state,{includeHistory:true}).samples[0];assert.equal(sample.asset.moving,moving,'moving assets are counted');assert.equal(sample.asset.assets,assets.length);
  return {moving,assets:assets.length};
});

test('moving assets and a still revision raise one stall; a write in the window does not',()=>{
  assert.ok(moving>0,'the fixture has moving assets');
  const still=fresh(),sim={frames:1,speed:600};let now=3_000_000;D.recorderStart(still,sim,{nowMs:now});
  for(let k=0;k<30;k++){now+=250;sim.frames++;still.simSeconds+=150;D.recorderSample(still,sim,{nowMs:now});}
  const stalls=D.recorderSnapshot(still,{includeHistory:true}).events.filter(e=>e.type==='ASSET_REVENUE_PROGRESS_STALLED').length;D.recorderStop(still,sim,{nowMs:now+10});
  assert.equal(stalls,1,`one stall (${stalls})`);
  const live=fresh(),sim2={frames:1,speed:600};now=4_000_000;D.recorderStart(live,sim2,{nowMs:now});const id=access.list(live).find(a=>a.phase==='moving').id;
  for(let k=0;k<30;k++){now+=250;sim2.frames++;live.simSeconds+=150;access.update(live,id,{progress:Math.min(.99,.01+k/40)});D.recorderSample(live,sim2,{nowMs:now});}
  const none=D.recorderSnapshot(live,{includeHistory:true}).events.filter(e=>e.type==='ASSET_REVENUE_PROGRESS_STALLED').length;D.recorderStop(live,sim2,{nowMs:now+10});
  assert.equal(none,0,'a fleet write is progress');
  return {stalls,none};
});

delete globalThis.GH_FLEET_DATA;
const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build359-recorder-signal',passed,total:results.length,results},null,1));
if(passed!==results.length)process.exitCode=1;else console.log('BUILD359_RECORDER_SIGNAL_PASS');
