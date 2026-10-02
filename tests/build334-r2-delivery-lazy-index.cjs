'use strict';
const assert=require('node:assert/strict'),{scenario}=require('./helpers/business-scenario');
const results=[];
function test(name,fn){try{fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:String(e.stack||e)});}}
function spyFleetAccess(s){const stats={iterations:0},api=s.GH_FLEET_DATA,iterators=new Set(['forEach','forEachFields','some','every','find','filter','count','sum','map','list','indexById','ids']);s.GH_FLEET_DATA=new Proxy(api,{get(target,key,receiver){const value=Reflect.get(target,key,receiver);return iterators.has(key)&&typeof value==='function'?(...args)=>{stats.iterations++;return value(...args);}:value;}});return stats;}
test('future-only delivery polls do not index or iterate the owned fleet, but still publish the pipeline',()=>{
 const e=scenario();e.manualPurchase(1);e.s.GH_REALISM.onSimulationTime(e.state,60);e.manualPurchase(3);for(const d of e.state.realism.procurement.deliveries)if(d.status==='pending')d.dueAtSeconds=7200;
 const stats=spyFleetAccess(e.s);for(let i=0;i<30;i++)assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,100+i),0);
 assert.equal(stats.iterations,0);assert.equal(e.s.GH_FLEET_DATA.size(e.state),1);assert.equal(e.state.realism.procurement.pendingDeliveryCount,1);
 const pendingIds=e.state.realism.procurement.deliveries.filter(d=>d.status==='pending').map(d=>d.id);for(const id of pendingIds)assert.equal(e.state.realism.procurement.pipeline.find(p=>p.sourceId===id)?.stage,'Paid / Delivery');
});
test('due polling keeps future reservations and blocked destinations, then delivers exactly once after capacity opens',()=>{
 const e=scenario();e.manualPurchase(3);const rows=e.state.realism.procurement.deliveries;assert.equal(rows.length,1,'one purchase batch has one delivery record');rows[0].dueAtSeconds=60;
 e.state.globalBases.find(b=>b.id==='B1').deliveryCapacity=2;assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,60),0);assert.equal(rows[0].blockedReason,'approved-destination-missing-or-full');
 e.state.globalBases.find(b=>b.id==='B1').deliveryCapacity=3;assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,60),3);assert.equal(e.s.GH_FLEET_DATA.size(e.state),3);assert.equal(e.state.realism.procurement.pendingDeliveryCount,0);
 assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,120),0);assert(e.s.GH_FLEET_DATA.every(e.state,a=>a.staffing?.ready===true));
});
test('legacy clock normalization remains inside rollback even before an index is needed',()=>{
 const e=scenario();e.manualPurchase(1);const d=e.state.realism.procurement.deliveries[0];delete d.dueAtSeconds;delete d.orderedAtSeconds;e.s.GH_REALISM.migrate(e.state);const before=JSON.stringify(e.state);
 assert.throws(()=>e.s.GH_TRANSACTION_CORE.execute(e.state,{scope:['simSeconds'],apply(){assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,0),0);throw Error('outer future-poll fault');}}),/outer future-poll fault/);assert.deepEqual(JSON.parse(JSON.stringify(e.state)),JSON.parse(before));
 assert.equal(e.s.GH_REALISM.onSimulationTime(e.state,0),0);assert(Number.isFinite(e.state.realism.procurement.deliveries[0].dueAtSeconds));
});
console.log(JSON.stringify({suite:'build334-r2-delivery-lazy-index',scope:'real procurement, grouped purchase-order delivery, facility capacity, Fleet Data traversal counters and HR owners',passed:results.filter(x=>x.ok).length,total:results.length,results},null,2));if(results.some(x=>!x.ok))process.exitCode=1;
