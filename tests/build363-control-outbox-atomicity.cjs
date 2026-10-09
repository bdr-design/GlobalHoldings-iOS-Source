'use strict';

const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

const {s}=harness(['transaction-core','control-plane-core']);
const TX=s.GH_TRANSACTION_CORE,C=s.GH_CONTROL_PLANE,state=minimal(),delivered=[];
state.cash=250000;
state.qaControlMutation=0;
s.addEventListener('gh-control-event',event=>delivered.push(structuredClone(event.detail)));

const baseline=Buffer.from(JSON.stringify(state));

assert.throws(()=>TX.execute(state,{
  label:'qa-control-outbox-rollback',
  apply:()=>{
    const command=C.execute(state,{name:'QA_ATOMIC_OUTBOX',domain:'qa',actor:'acceptance'},()=>{
      state.cash-=1250;
      state.qaControlMutation+=1;
      return {charged:1250};
    },{atomic:false,integrity:false});
    assert.equal(command.committed,true);
    assert.equal(delivered.length,0,'the committed command event escaped before its outer transaction committed');
    throw new Error('qa-fault-after-control-command');
  }
}),/qa-fault-after-control-command/);

assert.equal(delivered.length,0,'a rolled-back outer transaction emitted an external control event');
assert.equal(Buffer.from(JSON.stringify(state)).equals(baseline),true,'outer rollback did not restore byte-exact state');

let committedCommand;
const committed=TX.execute(state,{
  label:'qa-control-outbox-commit',
  apply:()=>{
    committedCommand=C.execute(state,{name:'QA_ATOMIC_OUTBOX',domain:'qa',actor:'acceptance'},()=>{
      state.cash-=1250;
      state.qaControlMutation+=1;
      return {charged:1250};
    },{atomic:false,integrity:false});
    assert.equal(committedCommand.committed,true);
    assert.equal(delivered.length,0,'the external event must remain deferred while the outer transaction is active');
    return committedCommand.value;
  }
});

assert.equal(committed.committed,true);
assert.deepEqual(committed.value,{charged:1250});
assert.equal(state.cash,248750);
assert.equal(state.qaControlMutation,1,'the failed attempt leaked its business mutation into the successful retry');
assert.equal(delivered.length,1,'the successful retry must emit exactly one external event');
assert.equal(delivered[0].id,committedCommand.event.id);
assert.equal(delivered[0].type,'COMMAND_COMMITTED');
assert.equal(delivered[0].commandId,committedCommand.command.id);

const outbox=state.controlPlane.outbox;
assert.equal(outbox.length,1,'the failed attempt leaked an outbox row');
assert.equal(outbox[0].eventId,committedCommand.event.id);
assert.equal(outbox[0].delivered,true);
assert.equal(outbox[0].attempts,1);
assert.equal(Object.hasOwn(outbox[0],'payload'),false,'a delivered outbox row retained its transient payload');
C.dispatchOutbox(state);
assert.equal(delivered.length,1,'re-dispatch duplicated an already delivered event');

console.log('build363 control outbox atomicity: PASS');
