const assert=require('assert');
global.GH_EVENT_LEDGER=require('../WebApp/event-ledger-core.js');
global.GH_DEPENDENCY_CORE=require('../WebApp/dependency-core.js');
global.GH_POLICY_CORE=require('../WebApp/policy-core.js');
global.GH_LIFECYCLE_CORE=require('../WebApp/lifecycle-core.js');
global.GH_DELIVERY_MONITOR=require('../WebApp/delivery-monitor-core.js');
global.GH_INTEGRITY_CORE=require('../WebApp/integrity-core.js');

const state={simSeconds:100,realism:{procurement:{deliveries:[{id:'DEL-1',status:'pending',baseId:'B1',dueAtSeconds:200,asset:{id:'A1'}}]}},assets:[]};
const policy=GH_POLICY_CORE.procurement({item:{id:'CAT-1'},base:{id:'B1'},qty:1,freeCapacity:2,fundingGap:0});
assert.strictEqual(policy.approved,true,'manual purchase policy must not depend on an AI study or authorization');
let closure=GH_DELIVERY_MONITOR.reconcile(state);assert.strictEqual(closure.open,1);assert.strictEqual(closure.closed,0);

const delivery=state.realism.procurement.deliveries[0];
GH_LIFECYCLE_CORE.transition(state,delivery,'deliveryOrder','delivered',{event:'ASSET_DELIVERED'});
assert.throws(()=>GH_LIFECYCLE_CORE.transition(state,delivery,'deliveryOrder','pending',{}),/rejected/,'a completed delivery cannot return to pending');
closure=GH_DELIVERY_MONITOR.reconcile(state);assert.strictEqual(closure.open,0);assert.strictEqual(closure.closed,1);assert.strictEqual(closure.closureRate,100);
assert(GH_EVENT_LEDGER.summary(state).count>=1,'delivery lifecycle transition was not journaled');
assert.strictEqual(GH_INTEGRITY_CORE.check(state).counts.critical,0,'healthy delivery lifecycle produced a critical integrity issue');
assert(!state.advanced?.ai?.requests&&!state.advanced?.procurement?.assetRequests,'legacy AI purchase queues returned');
console.log('Core Business Lifecycle 3.0.0 manual delivery: PASS');
