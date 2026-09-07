const assert=require('assert');
const sim=require('../WebApp/simulation-core.js');
function harness(finishResult={committed:true},initialSpeed=1,options={}){
  let now=0,time=0,speed=initialSpeed,cancelled=0,finishes=0,lastFinish=null,fatal=0;
  const engine=sim.create({
    getSpeed:()=>speed,setSpeed:v=>{speed=v},getSimTime:()=>time,setSimTime:v=>{time=v},
    createSliceJob:(slice,meta)=>({runChunk:()=>true,finish:info=>{finishes++;lastFinish={slice,meta,info};return typeof finishResult==='function'?finishResult(info):finishResult;},cancel:()=>{cancelled++;}}),
    onFatal:()=>{fatal++;}
  },{nowMs:()=>now,frameBudgetMs:1000,...options});
  return {engine,step(ms){now+=ms;engine.frame(now);},get time(){return time},set speed(v){speed=v},get speed(){return speed},get cancelled(){return cancelled},get finishes(){return finishes},get lastFinish(){return lastFinish},get fatal(){return fatal}};
}

// x1 must preserve a legitimate one-second frame delay. V221 incorrectly truncated it to 0.25 s.
let h=harness({committed:true},1);h.step(1000);assert.strictEqual(h.time,1,'x1 lost legitimate real time');
// Multipliers change only the rate: one real second at x1/x2/x4.
for(const multiplier of [2,4]){h=harness({committed:true},multiplier);h.step(1000);assert.strictEqual(h.time,multiplier,`x${multiplier} multiplier mismatch`);}
// A large unexplained stall is discarded completely, never partially advanced.
h=harness({committed:true},1);h.step(4000);assert.strictEqual(h.time,0,'large stall partially advanced simulation');assert.strictEqual(h.engine.health().stallGaps,1);
// Rejected/failed transactions must not advance time.
h=harness({committed:false,retry:true,reason:'asset-conflict'},4);h.step(1000);assert.strictEqual(h.time,0,'Rejected transaction advanced time');assert.strictEqual(h.cancelled,1);
h=harness(()=>{throw new Error('commit exploded')},4);h.step(1000);assert.strictEqual(h.time,0,'Failed transaction advanced time');assert.strictEqual(h.fatal,1);
// Speed changes cancel active work and reset the wall-clock anchor: no old-rate carryover.
h=harness({committed:true},4,{frameBudgetMs:0.000001});h.step(100);h.speed=2;h.step(10);assert.strictEqual(h.engine.snapshot().jobActive,false,'Speed change left an active job');const afterChange=h.time;h.step(1000);assert.strictEqual(h.time-afterChange,2,'Speed change carried old-rate time into new speed');
// Exact hour boundary at x4.
h=harness({committed:true},4);for(let i=0;i<900;i++)h.step(1000);assert.strictEqual(h.time,3600);assert.strictEqual(h.lastFinish.info.boundary.hour,1);assert.strictEqual(h.engine.health().hours,1);
// Hidden wall time never catches up on resume.
h=harness({committed:true},4);h.engine.setHidden(true);h.step(10000);assert.strictEqual(h.time,0);h.engine.setHidden(false);h.step(1);assert.strictEqual(h.time,0.004,'Visible resume incorrectly caught up hidden wall time');
console.log('Simulation Core 2.3.9 multiplier/atomic timing: PASS');
