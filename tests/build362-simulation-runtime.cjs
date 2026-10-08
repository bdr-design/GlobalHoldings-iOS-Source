'use strict';
const assert=require('assert');
const Runtime=require('../WebApp/simulation-runtime-core.js');

let now=0,nextId=0,manual=false,speed=0,frameCost=2;
const timers=new Map(),cleared=[];
const engine={
  frame(){now+=frameCost;},
  snapshot(){return {manualAdvance:manual?{}:null,jobActive:false};}
};
const runtime=Runtime.create({engine,getSpeed:()=>speed,isHidden:()=>false,hasDeferredWork:()=>false},{
  nowMs:()=>now,
  setTimer:(fn,delay)=>{const id=++nextId;timers.set(id,{fn,delay});return id;},
  clearTimer:id=>{cleared.push(id);timers.delete(id);},
  manualIntervalMs:8,liveIntervalMs:16,pausedIntervalMs:250
});
const fire=()=>{assert.equal(timers.size,1,'exactly one simulation wake-up may be pending');const [id,row]=timers.entries().next().value;timers.delete(id);row.fn();return row.delay;};

assert.equal(runtime.wake(),false,'a wake signal cannot start the lifecycle owner implicitly');assert.equal(timers.size,0);
assert.equal(runtime.start(),true);assert.equal(timers.size,1);assert.equal(fire(),0);assert.equal(timers.size,1);
assert.equal([...timers.values()][0].delay,250,'paused runtime must not poll at display cadence');
speed=30;runtime.wake();assert.equal(timers.size,1,'wake replaces, rather than stacks, a timer');assert(cleared.length>=1);fire();assert.equal([...timers.values()][0].delay,16);
manual=true;runtime.wake();fire();assert.equal([...timers.values()][0].delay,8);
const drained=runtime.drainWork();assert.deepEqual(drained,{totalMs:6,maxTaskMs:2,taskCount:3,firstTaskStartedAtMs:0,lastTaskEndedAtMs:6});
assert.equal(runtime.drainWorkMs(),0,'drained task metrics cannot accumulate forever');
runtime.stop();assert.equal(timers.size,0,'stop releases the last scheduled task');assert.equal(runtime.snapshot().pending,false);assert.equal(runtime.snapshot().inTick,false);
assert.equal(runtime.wake(),false,'a signal after pagehide cannot resurrect the stopped scheduler');assert.equal(timers.size,0);
assert.equal(runtime.start(),true,'pageshow can explicitly restart the same owner');assert.equal(timers.size,1);runtime.stop();
runtime.dispose();
console.log(JSON.stringify({suite:'build362-simulation-runtime',ticks:runtime.snapshot().ticks,wakes:runtime.snapshot().wakes,pending:runtime.snapshot().pending,singleOwner:true}));
