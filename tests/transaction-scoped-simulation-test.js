const assert=require('assert');
const tx=require('../WebApp/transaction-core.js');

// A large unrelated branch models AI/history/documents. Scoped simulation commits must not
// replace or clone/restore it during normal ticks.
const huge={payload:'x'.repeat(4_000_000),rows:Array.from({length:2000},(_,i)=>({i,text:'y'.repeat(256)}))};
const state={simSeconds:10,assets:[{id:'A',progress:.2}],cash:100,finance:{invoices:[]},huge};
const hugeRef=state.huge;
const assetRef=state.assets[0];
let result=tx.execute(state,{label:'scoped-ok',scope:['simSeconds','assets','cash','finance'],apply(){state.simSeconds=11;state.assets[0].progress=.3;state.cash=120;return true;}});
assert(result.committed);
assert.strictEqual(state.huge,hugeRef,'unrelated large branch reference changed');
assert.strictEqual(state.assets[0],assetRef,'scoped commit replaced existing asset reference');

try{
  tx.execute(state,{label:'scoped-rollback',scope:['simSeconds','assets','cash','finance'],apply(){state.simSeconds=99;state.assets[0].progress=.9;state.cash=0;state.finance.invoices.push({id:1});throw new Error('forced');}});
  assert.fail('expected forced rollback');
}catch(error){assert.strictEqual(error.message,'forced');}
assert.strictEqual(state.simSeconds,11);
assert.strictEqual(state.assets[0],assetRef,'scoped rollback broke asset reference');
assert.strictEqual(state.assets[0].progress,.3);
assert.strictEqual(state.cash,120);
assert.deepStrictEqual(state.finance.invoices,[]);
assert.strictEqual(state.huge,hugeRef,'rollback touched unrelated large branch');
console.log('Scoped simulation transaction memory guard: PASS');
