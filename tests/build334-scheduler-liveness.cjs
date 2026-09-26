'use strict';
// Regression: the configured fallback rate must remain able to commit work.
// Stage durations below are simulated with an injected clock, not benchmarks.
const assert=require('node:assert/strict');
const path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=path.resolve(__dirname,'..');
const {harness}=require('./helpers/core-harness');
const {s}=harness(['simulation-core']);
function scenario({createMs=1,chunkMs=1,finishMs=1,startSpeed=30,manual=false,reject=false,faultStage=''}={}){
  let wall=0,time=0,speed=startSpeed,created=0,finished=0,cancels=0,throttles=0;
  const commits=[],events=[],advanceEvents=[];
  const engine=s.GH_SIMULATION_CORE.create({
    getSimTime:()=>time,setSimTime:t=>{time=t;},getSpeed:()=>speed,
    setSpeed:(value,meta)=>{speed=value;events.push(meta.reason);},
    createSliceJob:(_slice,meta)=>{created++;wall+=createMs;if(faultStage==='create')throw new Error('regression-create-failure');if(faultStage==='invalid-create')return null;return {
      runChunk(){wall+=chunkMs;if(faultStage==='chunk')throw new Error('regression-chunk-failure');return true;},
      finish(){wall+=finishMs;finished++;if(faultStage==='finish')throw new Error('regression-finish-failure');if(reject)return {committed:false,reason:'regression-intentional-reject',retry:true};
        assert.equal(time,meta.from,'only a committed slice may advance time');
        time=meta.to;commits.push({from:meta.from,to:meta.to});return {committed:true};},
      cancel(){cancels++;}
    };},onThrottle:()=>{throttles++;},onAdvance:e=>advanceEvents.push({...e})
  },{nowMs:()=>wall,minRealSliceSeconds:.5,allowedSpeeds:[0,30,120,300,600],fallbackSpeed:30,manualBatchSeconds:3600,manualMinBatchSeconds:300,manualRetryLimit:3});
  if(manual)assert.equal(engine.advanceTo(180,{speed:30,batchSeconds:3600}).accepted,true);
  for(let frame=0;frame<400;frame++){wall+=16;engine.frame(wall);if(manual&&!engine.snapshot().manualAdvance)break;}
  for(let i=1;i<commits.length;i++)assert.equal(commits[i].from,commits[i-1].to,'no skipped or repeated committed interval');
  return {time,speed,created,finished,cancels,throttles,events,advanceEvents,commits:commits.length,kernel:engine.snapshot()};
}
const results=[];
function test(name,options,verify){const outcome=scenario(options);verify(outcome);results.push({name,...outcome});}
for(const stage of ['createMs','chunkMs','finishMs'])for(const speed of [30,600]){
  test(`slow ${stage} from rate ${speed}`,{[stage]:130,startSpeed:speed},out=>{
    assert(out.time>0&&out.commits>0,`${stage}/${speed}: scheduler starved without a committed slice`);
    assert.equal(out.speed,speed,'performance pressure must not rewrite the player-selected speed');assert(out.kernel.hardTasks>0,'slow work must stay visible in health metrics');
    assert.deepEqual(out.events,[],'governor must not call setSpeed for performance pressure');
  });
}
test('manual target still completes under create pressure',{createMs:130,startSpeed:0,manual:true},out=>{
  assert.equal(out.time,180);assert.equal(out.kernel.manualAdvance,null);assert.equal(out.throttles,1);
});
test('paused state does not advance',{startSpeed:0,createMs:130},out=>{assert.equal(out.time,0);assert.equal(out.created,0);});
test('rejected real-time commit never advances time',{reject:true},out=>{assert.equal(out.time,0);assert.equal(out.commits,0);});
test('rejected manual commit exits after retry budget',{reject:true,manual:true,startSpeed:0},out=>{assert.equal(out.time,0);assert.equal(out.kernel.manualAdvance,null);assert.equal(out.kernel.manualFailures,1);assert.equal(out.kernel.lastAdvanceFailure.reason,'regression-intentional-reject');assert(out.advanceEvents.some(e=>e.failed));});
for(const [faultStage,reason] of [['invalid-create','create-job-invalid'],['create','create-error'],['chunk','chunk-error'],['finish','finish-error']]){
  test(`manual ${faultStage} failure stops at last committed state`,{faultStage,manual:true,startSpeed:0},out=>{
    assert.equal(out.time,0,`${faultStage}: no failed interval may publish time`);
    assert.equal(out.commits,0,`${faultStage}: no failed interval may publish state`);
    assert.equal(out.kernel.manualAdvance,null,`${faultStage}: calendar advance must not remain active`);
    assert.equal(out.kernel.manualFailures,1,`${faultStage}: failure must be recorded once`);
    assert.equal(out.kernel.lastAdvanceFailure.reason,reason);
    assert(out.advanceEvents.some(e=>e.failed&&e.reason===reason),`${faultStage}: UI owner must receive an explicit failed advance event`);
  });
}
console.log(JSON.stringify({suite:'scheduler-liveness',passed:results.length,scope:'scheduler only; synthetic stage durations; not an iPhone benchmark',results},null,2));
