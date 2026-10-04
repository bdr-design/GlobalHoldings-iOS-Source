'use strict';
// Build 358, second iPhone diagnostic: calendar slices cost 13-14 ms a frame, about 40% of it a full copy of finance.
// Any pending delivery (even one due days later) put every slice on the delivery path: the full scope with no row
// snapshots, and 600-second slices. A slice now takes that path only when a pending delivery is due by its end.
// Checks: the due time and slice limit follow the earliest pending delivery; a far delivery leaves slices on the cheap
// scope; the delivery still lands in the slice that reaches its due time; a row with an unnormalized clock counts as due.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');
const DAY=86400;
const e=scenario(),{s,state,command,item}=e,R=s.GH_REALISM,TX=s.GH_TRANSACTION_CORE,F=s.GH_FLEET_DATA;
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e6;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e6;
assert.equal(R.nextDeliveryDueAt(state),Infinity);assert.equal(R.deliveryDueBy(state,1e9),false);assert.equal(R.simulationSliceLimit(state),3600);

state.simSeconds=2*DAY;const lead=3*DAY,total=item.price*2;
TX.execute(state,{label:'qa-delivery-order',apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty:2,manual:true,requestRef:'QA-DUE-1',upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:3,leadSeconds:lead}))});
const due=2*DAY+lead;
assert.equal(R.hasPendingDeliveries(state),true,'the order is pending');assert.equal(R.nextDeliveryDueAt(state),due,'earliest due time');
assert.equal(R.deliveryDueBy(state,due-1),false,'a slice ending before the due time has no delivery work');assert.equal(R.deliveryDueBy(state,due),true);
assert.equal(R.simulationSliceLimit(state),3600,'wide slices while the delivery is days away');
state.simSeconds=due-1800;assert.equal(R.simulationSliceLimit(state),600,'600-second slices within the hour before it');
const assetsBefore=F.size(state);
state.simSeconds=due-600;R.onSimulationTime(state,due-1);assert.equal(F.size(state),assetsBefore,'nothing delivered before the due time');
state.simSeconds=due;R.onSimulationTime(state,due);assert.equal(F.size(state),assetsBefore+2,'delivered at the due time');
assert.equal(R.hasPendingDeliveries(state),false);assert.equal(R.nextDeliveryDueAt(state),Infinity);
// A legacy row with no normalized clock is treated as due now (handled on the next slice), never skipped.
state.realism.procurement.deliveries.push({id:'QA-LEGACY',status:'pending',dueDay:9});state.realism.procurement.pendingDeliveryCount=1;
assert.equal(R.nextDeliveryDueAt(state),-Infinity);assert.equal(R.deliveryDueBy(state,0),true);
console.log('PASS delivery due time, slice limit and delivery path follow the earliest pending delivery');

// The slice owner (app.js) picks the scope from deliveryDueBy(state, slice end).
const source=require('node:fs').readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR,'WebApp/app.js'),'utf8');
assert.match(source,/deliveryWorkPending=typeof window\.GH_REALISM\?\.deliveryDueBy==='function'\?window\.GH_REALISM\.deliveryDueBy\(state,to\)/,'slices ask for delivery work due by their end');
console.log('BUILD358_DELIVERY_DUE_SLICES_PASS');
