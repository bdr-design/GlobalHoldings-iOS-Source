process.env.GH_TEST_SOURCE_DIR=require('path').resolve(__dirname,'..');
'use strict';
const assert=require('assert');
const {scenario}=require('./helpers/business-scenario');
const results=[];
for(const qty of [10,100,500,1000]){
  const {s,state,ctx,item}=scenario();
  const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1100;
  s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=1e15;
  const payload={type:'air',assetMode:'air',assetClass:'aircraft',tab:'new',item,base,supplier:ctx.supplierFor(),mode:'cash',qty,manual:true,requestRef:`MANUAL-DELIVERY-${qty}`,upfront:Number(item.price)*qty,totalPrice:Number(item.price)*qty,documentLeadDays:1,leadSeconds:0,immediateDelivery:true};
  const start=performance.now();
  const out=s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',payload,{actor:'delivery-pressure',idempotencyKey:`DELIVERY-${qty}`});
  const procurementMs=performance.now()-start;
  const deliveryStart=performance.now();
  const delivered=s.GH_REALISM.onSimulationTime(state,state.simSeconds);
  const deliveryMs=performance.now()-deliveryStart;
  assert(out.ok&&out.result.count===qty);assert.strictEqual(delivered,qty);
  assert.strictEqual(state.assets.length,qty);
  assert.strictEqual(state.assets.filter(a=>a.deliveryStatus==='delivered'&&a.staffing?.ready===true).length,qty);
  assert.strictEqual(state.advanced.labor.employmentContracts.filter(c=>c.automaticAssetStaffing&&c.status==='ساري').length,qty);
  assert.strictEqual(state.realism.procurement.deliveries.filter(d=>d.status==='delivered').length,qty);assert(state.realism.procurement.deliveries.filter(d=>d.status==='delivered').every(d=>d.assetId&&!d.asset),'completed delivery history must retain evidence without duplicating the full asset snapshot');assert.strictEqual(s.GH_SAVE_SCHEMA.validate(state).ok,true);assert.strictEqual((s.GH_INTEGRITY_CORE.check(state).critical||[]).length,0);
  results.push({qty,procurementMs:+procurementMs.toFixed(2),deliveryMs:+deliveryMs.toFixed(2),totalMs:+(procurementMs+deliveryMs).toFixed(2),stateBytes:Buffer.byteLength(JSON.stringify(state)),headcount:state.crew.reduce((n,r)=>n+(Number(r.count)||0),0)});
}
console.log(JSON.stringify({suite:'purchase-delivery-pressure',environment:`node ${process.version}; synchronous core only; no persistence/DOM/iPhone`,results},null,2));
