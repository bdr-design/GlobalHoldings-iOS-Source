'use strict';
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario');

function addLargeIdempotency(state,count=2400){
  state.domainRuntime.idempotency=Object.fromEntries(Array.from({length:count},(_,index)=>[
    `fixture:${index}`,
    {at:0,permanent:true,fingerprint:`fingerprint-${index}`,result:{payload:'x'.repeat(1100)}}
  ]));
}

function makeIntegrityFailureAfterApply(s){
  const original=s.GH_INTEGRITY_CORE;let calls=0;
  s.GH_INTEGRITY_CORE={...original,check(){throw new Error('full-integrity-scan-must-not-run-for-record-alert');},checkCommandDelta(state,command){calls++;if(calls===1)return {ok:false,critical:[{id:'build342-injected-post-commit-failure',severity:'critical'}]};return original.checkCommandDelta(state,command);}};
  return ()=>{s.GH_INTEGRITY_CORE=original;};
}

function runAlert(state,ctx,s,text='Build342 journal probe',id='EV-B342-1'){
  return s.GH_DOMAIN_COMMANDS.dispatchSystem(ctx,'operations','record-alert',{id,text,type:'diagnostic'},{actor:'system-ui-notification'});
}

{
  const {s,state,ctx}=scenario();addLargeIdempotency(state);
  const before=JSON.stringify(state),oldCommands=state.domainRuntime.commands,oldIdempotency=state.domainRuntime.idempotency;
  const restore=makeIntegrityFailureAfterApply(s);
  try{assert.throws(()=>runAlert(state,ctx,s),/Integrity critical after operations:record-alert/);}finally{restore();}
  assert.equal(JSON.stringify(state),before,'critical post-commit failure restores every serialized state field');
  assert.equal(state.domainRuntime.commands,oldCommands,'journal rollback restores the original command-array reference');
  assert.equal(state.domainRuntime.idempotency,oldIdempotency,'unmodified idempotency archive stays shared through rollback');
  const timing=s.GH_TRANSACTION_CORE.telemetry().last;
  assert.equal(timing.rollbackStorage,'journal');
  assert.equal(timing.fullSnapshot,false);
}

{
  const {s,state,ctx}=scenario();addLargeIdempotency(state);
  let deltaCalls=0;
  const original=s.GH_INTEGRITY_CORE;
  s.GH_INTEGRITY_CORE={...original,check(){throw new Error('record-alert must use bounded delta validation');},checkCommandDelta(state,command){deltaCalls++;return original.checkCommandDelta(state,command);}};
  const samples=[];let result;
  for(let index=0;index<120;index++){
    const started=performance.now();result=runAlert(state,ctx,s,`Build342 bounded write ${index}`,`EV-B342-${index}`);samples.push(performance.now()-started);
  }
  s.GH_INTEGRITY_CORE=original;
  const ordered=[...samples].sort((a,b)=>a-b),p95=ordered[Math.ceil(ordered.length*.95)-1],max=ordered.at(-1);
  assert.equal(result?.ok,true);
  assert.equal(deltaCalls,samples.length,'one bounded delta validator runs per dispatch');
  assert.equal(state.alerts[0],'Build342 bounded write 119');
  assert.equal(state.eventLog[0].id,'EV-B342-119');
  assert.equal(state.domainRuntime.commands[0].name,'record-alert');
  const timing=s.GH_TRANSACTION_CORE.telemetry().last;
  assert.equal(timing.rollbackStorage,'journal');
  assert.equal(timing.scopeSize,4);
  assert.ok(timing.snapshotMs<5,`scoped journal snapshot took ${timing.snapshotMs}ms`);
  assert.ok(p95<5,`record-alert p95 over ${samples.length} dispatches took ${p95.toFixed(3)}ms`);
  assert.ok(max<10,`record-alert maximum over ${samples.length} dispatches took ${max.toFixed(3)}ms`);
  console.log(`record-alert benchmark: p95=${p95.toFixed(3)}ms max=${max.toFixed(3)}ms samples=${samples.length} large idempotency rows=${Object.keys(state.domainRuntime.idempotency).length}`);
}

{
  const {s,state,ctx}=scenario();
  const delta=s.GH_INTEGRITY_CORE.checkCommandDelta;
  const result=delta(state,{domain:'operations',name:'record-alert',commandId:'DOM-000000001',expectedAlert:'x',expectedEventId:'OP-0-1',expectedEventAt:0,expectedEventType:'operation'});
  assert.equal(result.ok,false,'delta checker rejects a command before it is committed');
  assert.equal(result.critical[0].severity,'critical');
}

console.log('Build342 record-alert journal: bounded integrity delta, scoped rollback, retained idempotency archive PASS');
