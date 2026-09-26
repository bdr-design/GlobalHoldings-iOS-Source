'use strict';
const assert=require('node:assert/strict');const {scenario}=require('./helpers/business-scenario');
const results=[];
function test(name,fn){fn();results.push({name,ok:true});}
test('cold reload does not trust a persisted zero pending counter',()=>{
 const e=scenario();e.manualPurchase(2);const restored=JSON.parse(JSON.stringify(e.state));restored.realism.procurement.pendingDeliveryCount=0;
 const fresh=scenario();assert.equal(fresh.s.GH_REALISM.onSimulationTime(restored,60),2);assert.equal(restored.assets.length,2);assert.equal(restored.realism.procurement.pendingDeliveryCount,0);
});
test('cache detects an owner purchase and reconciles explicit in-place publication',()=>{
 const e=scenario();assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,0),0);e.manualPurchase(1);
 assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,60),1);const delivered=JSON.parse(JSON.stringify(e.state));
 e.manualPurchase(1);const pending=JSON.parse(JSON.stringify(e.state));pending.realism.procurement.pendingDeliveryCount=0;
 e.s.GH_TRANSACTION_CORE.restoreObject(e.state,delivered);e.s.GH_REALISM.reconcilePendingDeliveryCount(e.state,true);
 e.s.GH_TRANSACTION_CORE.restoreObject(e.state,pending);assert.equal(e.s.GH_REALISM.reconcilePendingDeliveryCount(e.state,true),1);assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,60),1);
});
test('a failure during final pipeline publication rolls back fleet, HR, value, count, documents and status',()=>{
 const e=scenario();e.manualPurchase(1);e.s.GH_REALISM.migrate(e.state);
 const procurement=e.state.realism.procurement;let pipeline=procurement.pipeline,armed=true;
 Object.defineProperty(procurement,'pipeline',{enumerable:true,configurable:true,get(){if(armed&&e.state.assets.length){armed=false;throw new Error('audit-final-pipeline-failure');}return pipeline;},set(value){pipeline=value;}});
 const before=JSON.stringify(e.state);
 assert.throws(()=>e.s.GH_REALISM.onSimulationTime(e.state,60),/audit-final-pipeline-failure/);
 assert.equal(JSON.stringify(e.state),before,'no post-delivery work may escape the transaction');
 assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,60),1,'retry after real rollback must deliver once');
 assert.equal(e.state.assets.length,1);assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,60),0);
});
test('outer transaction rollback restores delivery and its runtime counter cache remains recoverable',()=>{
 const e=scenario();e.manualPurchase(2);e.s.GH_REALISM.migrate(e.state);const before=JSON.stringify(e.state);
 assert.throws(()=>e.s.GH_TRANSACTION_CORE.execute(e.state,{apply(){assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,60),2);throw new Error('audit-outer-failure');}}),/audit-outer-failure/);
 assert.equal(JSON.stringify(e.state),before);assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,60),2);assert.equal(e.state.assets.length,2);
});
test('no-pending polling reconciles once instead of rescanning unchanged history',()=>{
 const e=scenario();const deliveries=e.state.realism.procurement.deliveries;let scans=0;
 Object.defineProperty(deliveries,'reduce',{configurable:true,value:function(...args){scans++;return Array.prototype.reduce.apply(this,args);}});
 e.s.GH_REALISM.reconcilePendingDeliveryCount(e.state,true);const before=scans;
 for(let i=0;i<1000;i++)assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,i),0);
 assert.equal(scans,before);
});
console.log(JSON.stringify({suite:'build334-delivery-atomic-reconciliation',scope:'actual delivery, procurement, finance, fleet, HR and transaction owners; no device claim',passed:results.length,total:results.length,results},null,2));
