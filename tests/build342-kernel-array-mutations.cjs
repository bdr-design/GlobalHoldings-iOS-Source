'use strict';
// Build342: in-place array mutators on object sections run as one logged
// kernel operation (not O(length) element-wise patch+clone), with exact
// rollback, legacy-equivalent results, no aliasing and live self-assignment.
const assert=require('node:assert/strict');
require('../WebApp/kernel-core.js');
const K=globalThis.GH_KERNEL;
const make=legacy=>K.fromLegacyState(legacy,[{name:'log',owner:'transaction-core',kind:'object',path:['log']}]);
const plain=value=>JSON.parse(JSON.stringify(value));

// 1. Every optimized mutator matches plain-array semantics.
const ops=[
  ['push',[{id:9},{id:10}]],['pop',[]],['shift',[]],['unshift',[{id:0}]],
  ['splice',[1,2,{id:'a'},{id:'b'}]],['splice',[0]],['reverse',[]],['sort',[(a,b)=>String(b.id).localeCompare(String(a.id))]]
];
for(const [method,args] of ops){
  const seed={log:{events:[{id:1},{id:2},{id:3},{id:4}]}},kernel=make(plain(seed)),view=kernel.stateView(),reference=plain(seed.log.events);
  const expected=Array.prototype[method].apply(reference,plain(args.filter(a=>typeof a!=='function')).concat(args.filter(a=>typeof a==='function')));
  const actual=view.log.events[method](...args);
  assert.deepEqual(kernel.read('log').events,reference,`${method} state`);
  if(method==='reverse'||method==='sort')assert.equal(actual,view.log.events,`${method} returns receiver`);
  else assert.deepEqual(plain(actual),plain(expected),`${method} return value`);
}

// 2. Rollback restores contents and element identity exactly.
{
  const kernel=make({log:{events:[{id:1,n:{x:1}},{id:2}]}}),view=kernel.stateView();
  const before=kernel.read('log');
  assert.throws(()=>kernel.tx({label:'fail',owner:'transaction-core',writes:['log']},writer=>{
    writer.arrayOp('log',['events'],'unshift',[{id:0}]);
    writer.arrayOp('log',['events'],'splice',[1,1]);
    writer.arrayOp('log',['events'],'reverse',[]);
    throw new Error('qa-array-rollback');
  }),/qa-array-rollback/);
  assert.deepEqual(kernel.read('log'),before);
  assert.equal(view.log.events.length,2);assert.equal(view.log.events[0].n.x,1);
}

// 3. Inserted values are cloned: no aliasing with caller objects or other paths.
{
  const kernel=make({log:{events:[],other:{id:'o'}}}),view=kernel.stateView(),external={id:'e'};
  view.log.events.push(external,view.log.other);external.id='mutated';view.log.other.id='changed';
  assert.deepEqual(kernel.read('log').events,[{id:'e'},{id:'o'}]);
}

// 4. `const x=state.x=state.x` stays a no-op; the caller proxy keeps reading live data.
{
  const kernel=make({log:{a:[1]}}),view=kernel.stateView(),log=view.log=view.log;
  log.feeEvents=[];log.feeEvents.unshift({id:1});
  assert.deepEqual(plain(log.feeEvents),[{id:1}]);assert.deepEqual(kernel.read('log').feeEvents,[{id:1}]);
}

// 5. Arrays rebuilt from proxied elements are stored as plain data.
{
  const kernel=make({log:{commands:[{id:1,d:{v:1}},{id:2}]}}),view=kernel.stateView();
  view.log.commands=[{id:0},...view.log.commands].slice(0,2);
  assert.deepEqual(kernel.read('log').commands,[{id:0},{id:1,d:{v:1}}]);
  view.log.commands[1].d.v=5;assert.equal(kernel.read('log').commands[1].d.v,5);
}

// 6. Cost is one undo record per call, independent of array length.
{
  const events=Array.from({length:240},(_,id)=>({id,detail:{a:[1,2,3],b:'x'.repeat(64)}})),kernel=make({log:{events}});
  const result=kernel.tx({label:'one',owner:'transaction-core',writes:['log']},writer=>{writer.arrayOp('log',['events'],'unshift',[{id:-1}]);});
  assert.equal(result.undoRecords,1);
  const view=kernel.stateView(),started=Date.now();for(let i=0;i<500;i++){view.log.events.unshift({id:i});view.log.events.length=240;}
  assert(Date.now()-started<2000,'500 bounded unshifts must not scale with retained history');
}

// 7. State views are identifiable (proof locking must not freeze them).
{
  const view=make({log:{x:{}}}).stateView();
  assert.equal(K.isStateView(view.log.x),true);assert.equal(K.isStateView({}),false);assert.equal(K.isStateView(null),false);
}

// 8. Mutation versions: a nested write bumps the object and every ancestor at
// once (inside the open transaction), rollback bumps again, siblings untouched.
{
  const kernel=make({log:{proofs:{a:{seal:{strokes:[[1,2]]}},b:{x:1}}}}),view=kernel.stateView();
  const root=view.log,a=view.log.proofs.a,b=view.log.proofs.b,seal=view.log.proofs.a.seal;
  const before={root:K.versionOf(root),a:K.versionOf(a),b:K.versionOf(b),seal:K.versionOf(seal),stamp:K.stampOf(root)};
  let inside;
  assert.throws(()=>kernel.tx({label:'v',owner:'transaction-core',writes:['log']},()=>{
    view.log.proofs.a.seal.strokes[0][0]=9;
    inside={root:K.versionOf(root),a:K.versionOf(a),b:K.versionOf(b),seal:K.versionOf(seal),stamp:K.stampOf(root)};
    throw new Error('qa-version-rollback');
  }),/qa-version-rollback/);
  assert(inside.root>before.root&&inside.a>before.a&&inside.seal>before.seal,'ancestors bump before commit');
  assert.equal(inside.b,before.b,'siblings keep their version');
  assert.notEqual(inside.stamp,before.stamp,'root stamp changes inside the open transaction');
  assert.equal(view.log.proofs.a.seal.strokes[0][0],1,'rollback restored content');
  assert(K.versionOf(a)>inside.a,'rollback bumps again (never reverts to a verified version)');
  assert.equal(K.identityOf(a),K.identityOf(view.log.proofs.a),'identity is stable across views of one stored object');
}
// 9. Replacing an object yields a new identity: stamps never collide.
{
  const kernel=make({log:{p:{x:1}}}),view=kernel.stateView(),old=K.stampOf(view.log.p);
  view.log.p={x:1};assert.notEqual(K.stampOf(view.log.p),old);
}
// 10. sort comparators receive state views, so they cannot write raw rows.
{
  const kernel=make({log:{rows:[{n:2},{n:1}]}}),view=kernel.stateView();let sawView=true;
  view.log.rows.sort((x,y)=>{sawView=sawView&&K.isStateView(x)&&K.isStateView(y);return x.n-y.n;});
  assert.equal(sawView,true);assert.deepEqual(kernel.read('log').rows,[{n:1},{n:2}]);
}
console.log('PASS Build342 kernel array mutations + mutation versions: legacy semantics, single-record rollback, no aliasing, live self-assignment, bounded cost; ancestor versions/stamps bump inside transactions and on rollback');
