'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp/app.js'),'utf8');
const start=app.indexOf('    onPersist:()=>'),end=app.indexOf('\n',start);
assert(start>=0&&end>start,'onPersist callback not found');
const callback=app.slice(start,end).trim().replace(/^onPersist:/,'').replace(/,$/,'');
const schedulerStart=app.indexOf('  let simulationPersistenceTask=');
const schedulerCode=schedulerStart>=0?app.slice(schedulerStart,app.indexOf('  function persistStateNow(',schedulerStart)):'';
const results=[];
for(const scheduler of ['idle','timer'])for(const lock of ['none','reset','durable','native']){
 const queued=[],calls=[];let nativeLocked=false;
 const s={state:{resetEpoch:0},hardResetInProgress:false,durableCommandInProgress:false,compactSimulationState:()=>calls.push('compact'),save:()=>calls.push('save'),setTimeout:f=>queued.push(f),console,window:{GH_PERSISTENCE:{isLocked:()=>nativeLocked}}};
 if(scheduler==='idle')s.window.requestIdleCallback=f=>queued.push(f);
 vm.runInNewContext(schedulerCode+'\nglobalThis.onPersist='+callback,s);s.onPersist();assert.equal(queued.length,1);
 if(lock==='reset')s.hardResetInProgress=true;if(lock==='durable')s.durableCommandInProgress=true;if(lock==='native')nativeLocked=true;
 queued.shift()();const expected=lock==='none'?['compact','save']:[],passed=JSON.stringify(calls)===JSON.stringify(expected);
 results.push({scheduler,lock,passed,calls:[...calls]});
 // Suppressing the conflicting callback must not disable future autosaves.
 s.hardResetInProgress=false;s.durableCommandInProgress=false;nativeLocked=false;calls.length=0;s.onPersist();queued.shift()();assert.deepEqual(calls,['compact','save']);
}
console.log(JSON.stringify({suite:'deferred-save-lifecycle',passed:results.filter(x=>x.passed).length,total:results.length,results},null,2));
if(results.some(x=>!x.passed))process.exitCode=1;
