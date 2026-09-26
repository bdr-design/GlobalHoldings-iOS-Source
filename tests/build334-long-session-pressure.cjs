process.env.GH_TEST_SOURCE_DIR=require('path').resolve(__dirname,'..');
'use strict';
const assert=require('assert');
const {scenario}=require('./helpers/business-scenario');
const {s,state,ctx,item}=scenario();
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=6000;
s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=1e16;
const batches=[];
for(let batch=1;batch<=5;batch++){
 const qty=1000,payload={type:'air',assetMode:'air',assetClass:'aircraft',tab:'new',item,base,supplier:ctx.supplierFor(),mode:'cash',qty,manual:true,requestRef:`MANUAL-LONG-${batch}`,upfront:Number(item.price)*qty,totalPrice:Number(item.price)*qty,documentLeadDays:1,leadSeconds:0,immediateDelivery:true};
 const t=performance.now();s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',payload,{actor:'long-session',idempotencyKey:`LONG-${batch}`});const pms=performance.now()-t;
 const d=performance.now();const count=s.GH_REALISM.onSimulationTime(state,state.simSeconds);const dms=performance.now()-d;assert.strictEqual(count,qty);
 batches.push({batch,procurementMs:+pms.toFixed(2),deliveryMs:+dms.toFixed(2),assets:state.assets.length});
}
const bytes=Buffer.byteLength(JSON.stringify(state));
let t=performance.now();const copy=s.GH_TRANSACTION_CORE.deepClone(state);const cloneMs=performance.now()-t;
t=performance.now();const json=JSON.stringify(copy);const stringifyMs=performance.now()-t;
t=performance.now();JSON.parse(json);const parseMs=performance.now()-t;
assert.strictEqual(state.assets.length,5000);assert.strictEqual(state.realism.procurement.pendingDeliveryCount,0);assert.strictEqual(s.GH_SAVE_SCHEMA.validate(state).ok,true);assert.strictEqual((s.GH_INTEGRITY_CORE.check(state).critical||[]).length,0);t=performance.now();for(let i=0;i<1000;i++)assert.strictEqual(s.GH_REALISM.onSimulationTime(state,state.simSeconds+i),0);const idleDeliveryPoll1000Ms=performance.now()-t;
console.log(JSON.stringify({suite:'long-session-pressure',environment:`node ${process.version}; no DOM/native bridge/iPhone`,batches,stateBytes:bytes,cloneMs:+cloneMs.toFixed(2),stringifyMs:+stringifyMs.toFixed(2),parseMs:+parseMs.toFixed(2),idleDeliveryPoll1000Ms:+idleDeliveryPoll1000Ms.toFixed(2)},null,2));
