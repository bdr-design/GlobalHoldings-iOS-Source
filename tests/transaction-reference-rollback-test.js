const assert=require('assert');const tx=require('../WebApp/transaction-core.js');
const state={nested:{arr:[{x:1},{x:2}]}};const nested=state.nested,arr=state.nested.arr,first=arr[0];
assert.throws(()=>tx.execute(state,{apply(){state.nested.arr[0].x=99;state.nested.arr.push({x:3});state.nested.extra=true;throw new Error('boom')}}));
assert.strictEqual(state.nested,nested);assert.strictEqual(state.nested.arr,arr);assert.strictEqual(state.nested.arr[0],first);assert.deepStrictEqual(state,{nested:{arr:[{x:1},{x:2}]}});
console.log('Transaction reference-preserving rollback: PASS');
