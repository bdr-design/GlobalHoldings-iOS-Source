process.env.GH_TEST_SOURCE_DIR=require('path').resolve(__dirname,'..');
'use strict';
const assert=require('assert');
const {scenario}=require('./helpers/business-scenario');
const results=[];
for(const qty of [10,100,500,1000]){
  const {s,state,ctx,item}=scenario();
  const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1100;
  s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=1e15;
  const payload={type:'air',assetMode:'air',assetClass:'aircraft',tab:'new',item,base,supplier:ctx.supplierFor(),mode:'cash',qty,manual:true,requestRef:`MANUAL-PRESSURE-${qty}`,upfront:Number(item.price)*qty,totalPrice:Number(item.price)*qty,documentLeadDays:1,leadSeconds:60,immediateDelivery:false};
  const beforeCash=s.GH_FINANCE_CORE.operating(state,'air'), beforeDeliveries=state.realism.procurement.deliveries.length;
  const start=performance.now();
  const out=s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',payload,{actor:'pressure-test',idempotencyKey:`PRESSURE-${qty}`});
  const ms=performance.now()-start;
  assert(out.ok&&out.result.count===qty);
  assert.strictEqual(state.realism.procurement.deliveries.length-beforeDeliveries,1,'one receipt is created for the purchase batch');
  assert.strictEqual(beforeCash-s.GH_FINANCE_CORE.operating(state,'air'),Number(item.price)*qty);
  assert.strictEqual(new Set(out.result.assetIds).size,qty);
  assert.strictEqual(out.result.deliveryOrderIds.length,1);
  const receipt=state.realism.procurement.deliveries.at(-1);assert.strictEqual(receipt.assets.length,qty);assert.strictEqual(receipt.count,qty);assert(receipt.assets.every(asset=>asset.deliveryOrderId===receipt.id));assert.strictEqual(new Set(receipt.assets.map(asset=>asset.id)).size,qty);
  const retryStart=performance.now();
  const retry=s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',payload,{actor:'pressure-test',idempotencyKey:`PRESSURE-${qty}`});
  const retryMs=performance.now()-retryStart;
  assert.strictEqual(retry.commandId,out.commandId);
  assert.strictEqual(state.realism.procurement.deliveries.length-beforeDeliveries,1,'idempotent replay keeps one complete batch receipt');
  results.push({qty,ms:Number(ms.toFixed(2)),retryMs:Number(retryMs.toFixed(2)),stateBytes:Buffer.byteLength(JSON.stringify(state))});
}
console.log(JSON.stringify({suite:'procurement-pressure',environment:`node ${process.version}`,results},null,2));
