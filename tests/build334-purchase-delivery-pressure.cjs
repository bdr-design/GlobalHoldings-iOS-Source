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
  const activeCrewContracts=state.advanced.labor.employmentContracts.filter(c=>c.automaticAssetStaffing&&c.status==='ساري');assert.strictEqual(activeCrewContracts.length,1,'one crew contract is retained for the purchase batch');assert.strictEqual(s.GH_FLEET_DATA.idLists.length(activeCrewContracts[0].assetIds),qty);assert.strictEqual(activeCrewContracts[0].assetCount,qty);
  const completed=state.realism.procurement.deliveries.filter(d=>d.status==='delivered');assert.strictEqual(completed.length,1,'one complete receipt is retained for the purchase batch');const receiptRows=s.GH_FLEET_DATA.receiptAssets(completed[0]);assert.strictEqual(s.GH_FLEET_DATA.isCompactReceipt(completed[0]),true,'delivered receipts are stored compactly');assert.strictEqual(receiptRows.length,qty);assert.strictEqual(s.GH_FLEET_DATA.idLists.length(completed[0].assetIds),qty);assert(receiptRows.every(asset=>asset.id&&asset.name&&asset.specs&&Number(asset.purchasePrice)>0),'full purchased asset snapshots remain in the receipt');assert.deepStrictEqual(receiptRows.map(asset=>asset.id),s.GH_FLEET_DATA.idLists.toArray(completed[0].assetIds));assert(!Object.prototype.hasOwnProperty.call(completed[0],'asset'),'the batch receipt is one compact receipt, not single-asset rows');assert.strictEqual(s.GH_SAVE_SCHEMA.validate(state).ok,true);assert.strictEqual((s.GH_INTEGRITY_CORE.check(state).critical||[]).length,0);
  if(qty>1){const sold=state.assets[0],contract=activeCrewContracts[0],beforeSalary=contract.salary,beforeCount=contract.count,sale=s.GH_DOMAIN_COMMANDS.dispatch(ctx,'fleet','finalize-sale',{id:sold.id},{actor:'batch-crew-release-test'});assert.equal(sale.ok,true);assert.equal(s.GH_FLEET_DATA.idLists.length(contract.assetIds),qty-1);assert.equal(s.GH_FLEET_DATA.idLists.indexOf(contract.assetIds,sold.id),-1);assert.equal(contract.count,beforeCount-sold.staffing.total);assert.equal(contract.salary,beforeSalary-sold.staffing.monthlyPayroll);assert.equal(s.GH_FLEET_DATA.receiptAssets(completed[0]).length,qty,'the full purchase receipt survives a later sale');assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);}
  results.push({qty,procurementMs:+procurementMs.toFixed(2),deliveryMs:+deliveryMs.toFixed(2),totalMs:+(procurementMs+deliveryMs).toFixed(2),stateBytes:Buffer.byteLength(JSON.stringify(state)),headcount:state.crew.reduce((n,r)=>n+(Number(r.count)||0),0)});
}
console.log(JSON.stringify({suite:'purchase-delivery-pressure',environment:`node ${process.version}; synchronous core only; no persistence/DOM/iPhone`,results},null,2));
