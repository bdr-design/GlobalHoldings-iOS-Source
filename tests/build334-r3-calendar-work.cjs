'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const core=require(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp/simulation-core.js'));
const results=[];
const RATES=[0,30,120,300,600],FALLBACK=30,CALENDAR_BATCH=3600,CALENDAR_MIN_BATCH=300;
function run({stage='finish',cost=0.1,from=0,target=86400,playerSpeed=0,manual=true,rejectOnce=false,rejectAlways=false,maxFrames=12000,costs=null}={}){
 let wall=0,time=from,speed=playerSpeed,creates=0,cancels=0,rejections=0;const commits=[],throttles=[],fatals=[],selectedSpeedWrites=[],advanceEvents=[];
 const engine=core.create({getSimTime:()=>time,setSimTime:v=>{time=v;},getSpeed:()=>speed,setSpeed:(v,m)=>{selectedSpeedWrites.push({v,m});speed=v;},
  createSliceJob:(slice,meta)=>{creates++;wall+=costs?.create??(stage==='create'?cost:.1);return {
   runChunk(){wall+=costs?.chunk??(stage==='chunk'?cost:.1);return true;},
   finish(){wall+=costs?.finish??(stage==='finish'?cost:.1);if(rejectAlways||rejectOnce&&!rejections++){rejections++;return {committed:false,reason:'asset-conflict',retry:true};}assert.equal(time,meta.from);time=meta.to;commits.push({from:meta.from,to:meta.to,boundary:meta.boundary});return {committed:true};},cancel(){cancels++;}};},onThrottle:x=>throttles.push(x),onFatal:e=>fatals.push(String(e)),onAdvance:e=>advanceEvents.push({...e})},
  {nowMs:()=>wall,allowedSpeeds:RATES,fallbackSpeed:FALLBACK,frameBudgetMs:4,minRealSliceSeconds:.5,manualBatchSeconds:CALENDAR_BATCH,manualMinBatchSeconds:CALENDAR_MIN_BATCH,manualRetryLimit:3});
 if(manual)assert(engine.advanceTo(target,{speed:30,batchSeconds:CALENDAR_BATCH}).accepted);
 let frames=0;for(;frames<maxFrames;frames++){wall+=16;engine.frame(wall);if(manual&&!engine.snapshot().manualAdvance)break;}
 for(let i=0;i<commits.length;i++){assert.equal(commits[i].from,i?commits[i-1].to:from);assert(commits[i].to>commits[i].from);assert(commits[i].to-commits[i].from<=CALENDAR_BATCH+1e-8);}
 assert.deepEqual(fatals,[]);
 return {engine,time,speed,creates,cancels,rejections,commits,throttles,selectedSpeedWrites,advanceEvents,frames};
}
function test(name,fn){try{const details=fn();results.push({name,ok:true,details});}catch(e){results.push({name,ok:false,error:String(e.stack||e)});}}
for(const stage of ['create','finish'])for(const window of [{from:0,target:86400},{from:3501.25,target:93637.5}])test(`fixed ${stage} pressure preserves hourly calendar batching (${window.from} to ${window.target})`,()=>{
 const reference=run({stage,cost:.1,...window}),pressured=run({stage,cost:130,...window});
 assert.equal(pressured.time,window.target);assert.equal(pressured.engine.snapshot().manualAdvance,null);
 assert.equal(pressured.commits.length,reference.commits.length,'fixed snapshot/commit overhead must not multiply full-state transaction count');
 assert.deepEqual(pressured.commits,reference.commits,'same target intervals and exact boundary order');assert.deepEqual(pressured.selectedSpeedWrites,[]);assert.equal(pressured.throttles.length,1,'pressure protection is still active');
 assert(pressured.commits.every(row=>row.to-row.from<=3600+1e-8));
 return {commits:pressured.commits.length,referenceCommits:reference.commits.length,throttles:pressured.throttles.length,frames:pressured.frames};
});
test('per-asset chunk pressure cooperatively yields without shrinking the atomic calendar interval',()=>{const r=run({stage:'chunk',cost:130});assert.equal(r.time,86400);assert.equal(r.commits.length,24,'performance pressure must preserve hourly atomic calendar batching');assert(r.throttles.length>=1);assert.deepEqual(r.selectedSpeedWrites,[]);return {commits:r.commits.length,throttles:r.throttles.length};});
test('chunk pressure after fixed-cost pressure preserves the same hourly transaction boundary',()=>{const r=run({costs:{create:130,chunk:130,finish:.1}});assert.equal(r.time,86400);assert.equal(r.commits.length,24);assert(r.throttles.length>=1);assert.deepEqual(r.selectedSpeedWrites,[]);return {commits:r.commits.length,throttles:r.throttles.length};});
test('calendar preserves the player-selected live speed',()=>{const r=run({stage:'finish',cost:130,playerSpeed:120});assert.equal(r.time,86400);assert.equal(r.speed,120);assert.deepEqual(r.selectedSpeedWrites,[]);});
test('one rejected interval is retried without duplicate time or boundary posting',()=>{const r=run({cost:130,rejectOnce:true});assert.equal(r.time,86400);assert.equal(r.commits.length,24);assert.equal(r.commits.filter(x=>x.boundary.day===1).length,1);assert.equal(r.commits.filter(x=>x.boundary.hour!==null).length,24);assert(r.cancels>=1);});
test('persistent rejected interval fails closed after bounded retries',()=>{const r=run({rejectAlways:true,target:3600});const snap=r.engine.snapshot();assert.equal(r.time,0);assert.equal(snap.manualAdvance,null);assert.equal(snap.manualFailures,1);assert.equal(snap.lastAdvanceFailure.reason,'asset-conflict');assert.equal(r.rejections,3);assert(r.advanceEvents.some(e=>e.failed===true&&e.reason==='asset-conflict'));return {rejections:r.rejections,failure:snap.lastAdvanceFailure};});
test('real-time performance pressure preserves the selected 30x speed and only yields work',()=>{const r=run({manual:false,playerSpeed:30,cost:130,maxFrames:400});assert.equal(r.speed,30);assert.deepEqual(r.selectedSpeedWrites,[]);assert(r.time>0);assert(r.engine.snapshot().hardTasks>0);});
for(const action of ['cancel','hidden','reset'])test(`interrupted calendar cannot continue after ${action}`,()=>{
 let wall=0,time=0,cancelled=0;const engine=core.create({getSimTime:()=>time,setSimTime:t=>{time=t;},getSpeed:()=>0,createSliceJob:()=>({runChunk(){wall+=10;return false;},finish(){throw Error('must not commit');},cancel(){cancelled++;}})}, {nowMs:()=>wall,allowedSpeeds:RATES,fallbackSpeed:FALLBACK,frameBudgetMs:4,manualBatchSeconds:CALENDAR_BATCH,manualMinBatchSeconds:CALENDAR_MIN_BATCH});
 engine.advanceTo(86400,{speed:30,batchSeconds:CALENDAR_BATCH});wall+=16;engine.frame(wall);if(action==='cancel')engine.cancelAdvance('test');else if(action==='hidden')engine.setHidden(true);else engine.reset(wall,'test');for(let i=0;i<10;i++){wall+=16;engine.frame(wall);}assert.equal(time,0);assert.equal(engine.snapshot().manualAdvance,null);assert(cancelled>0);
});
console.log(JSON.stringify({suite:'build334-r3-calendar-work',environment:'deterministic scheduler with injected stage costs; not wall-clock/device performance; one-hour calendar batching with bounded chunk fallback',passed:results.filter(x=>x.ok).length,total:results.length,results},null,2));if(results.some(x=>!x.ok))process.exitCode=1;
