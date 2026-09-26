'use strict';
const assert=require('node:assert/strict'),{scenario}=require('./helpers/business-scenario');
const results=[];
function test(name,fn){try{fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:String(e.stack||e)});}}
function spyFleet(assets){const stats={maps:0,iterations:0};Object.defineProperty(assets,'map',{configurable:true,value:function(...args){stats.maps++;return Array.prototype.map.apply(this,args);}});Object.defineProperty(assets,Symbol.iterator,{configurable:true,value:function(){stats.iterations++;return Array.prototype[Symbol.iterator].call(this);}});return stats;}
test('future-only delivery polls do not index or iterate the owned fleet, but still publish the pipeline',()=>{
 const e=scenario();e.manualPurchase(1);e.s.GH_REALISM.onSimulationTime(e.state,60);e.manualPurchase(3);for(const d of e.state.realism.procurement.deliveries)if(d.status==='pending')d.dueAtSeconds=7200;
 const stats=spyFleet(e.state.assets);for(let i=0;i<30;i++)assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,100+i),0);
 assert.equal(stats.maps,0);assert.equal(stats.iterations,0);assert.equal(e.state.assets.length,1);assert.equal(e.state.realism.procurement.pendingDeliveryCount,3);
 const pendingIds=e.state.realism.procurement.deliveries.filter(d=>d.status==='pending').map(d=>d.id);for(const id of pendingIds)assert.equal(e.state.realism.procurement.pipeline.find(p=>p.sourceId===id)?.stage,'Paid / Delivery');
});
test('due polling keeps future reservations and blocked destinations, then delivers exactly once after capacity opens',()=>{
 const e=scenario();e.manualPurchase(3);const rows=e.state.realism.procurement.deliveries;rows[0].dueAtSeconds=60;rows[1].dueAtSeconds=rows[2].dueAtSeconds=120;
 e.state.globalBases.find(b=>b.id==='B1').deliveryCapacity=2;assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,60),0);assert.equal(rows[0].blockedReason,'approved-destination-missing-or-full');
 e.state.globalBases.find(b=>b.id==='B1').deliveryCapacity=3;assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,60),1);assert.equal(e.state.assets.length,1);assert.equal(e.state.realism.procurement.pendingDeliveryCount,2);
 assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,120),2);assert.equal(e.state.assets.length,3);assert.equal(e.state.realism.procurement.pendingDeliveryCount,0);assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,120),0);assert(e.state.assets.every(a=>a.staffing?.ready===true));
});
test('legacy clock normalization remains inside rollback even before an index is needed',()=>{
 const e=scenario();e.manualPurchase(1);const d=e.state.realism.procurement.deliveries[0];delete d.dueAtSeconds;delete d.orderedAtSeconds;e.s.GH_REALISM.migrate(e.state);const before=JSON.stringify(e.state);
 assert.throws(()=>e.s.GH_TRANSACTION_CORE.execute(e.state,{scope:['simSeconds'],apply(){assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,0),0);throw Error('outer future-poll fault');}}),/outer future-poll fault/);assert.deepEqual(JSON.parse(JSON.stringify(e.state)),JSON.parse(before));
 assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,0),0);assert(Number.isFinite(e.state.realism.procurement.deliveries[0].dueAtSeconds));
});
console.log(JSON.stringify({suite:'build334-r2-delivery-lazy-index',scope:'real procurement, facility capacity, delivery, fleet and HR owners with fleet traversal counters',passed:results.filter(x=>x.ok).length,total:results.length,results},null,2));if(results.some(x=>!x.ok))process.exitCode=1;
