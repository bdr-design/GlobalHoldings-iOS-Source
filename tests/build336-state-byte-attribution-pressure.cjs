'use strict';
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario');
const {s,state,ctx,item}=scenario();
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1200;s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=1e15;
function buy(qty,requestRef){
  const payload={type:'air',assetMode:'air',assetClass:'aircraft',tab:'new',item,base,supplier:ctx.supplierFor(),mode:'cash',qty,manual:true,requestRef,upfront:Number(item.price)*qty,totalPrice:Number(item.price)*qty,documentLeadDays:1,leadSeconds:0,immediateDelivery:true};
  const out=s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',payload,{actor:'build336-byte-attribution',idempotencyKey:requestRef});assert.equal(out.ok,true);assert.equal(out.result.count,qty);assert.equal(s.GH_REALISM.onSimulationTime(state,state.simSeconds),qty);
}
buy(1000,'B336-BYTE-1000');buy(20,'B336-BYTE-20');
assert.equal(state.assets.length,1020);assert.equal(state.realism.procurement.deliveries.filter(row=>row.status==='delivered').length,1020);assert(state.realism.procurement.deliveries.every(row=>row.status!=='delivered'||(row.assetId&&!row.asset)),'completed delivery history must not duplicate full assets');assert.equal(state.businessLedger.events.length,240,'business ledger must remain on its hard ring-buffer limit');assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
const bytes=value=>Buffer.byteLength(JSON.stringify(value)),top=Object.entries(state).map(([key,value])=>({key,bytes:bytes(value)})).sort((a,b)=>b.bytes-a.bytes),subtrees={};
for(const [root,value] of Object.entries(state))if(value&&typeof value==='object'&&!Array.isArray(value)){const rows=Object.entries(value).map(([key,subValue])=>({key,bytes:bytes(subValue)})).sort((a,b)=>b.bytes-a.bytes).filter(row=>row.bytes>=20*1024).slice(0,16);if(rows.length)subtrees[root]=rows;}
const totalBytes=bytes(state),assetsBytes=bytes(state.assets),realismBytes=bytes(state.realism),eventLedgerBytes=bytes(state.businessLedger),deliveriesBytes=bytes(state.realism.procurement.deliveries);
assert(assetsBytes>deliveriesBytes,'1020 delivered assets should remain larger than compact delivery evidence');assert(eventLedgerBytes<256*1024,'240-event ring buffer must not become a multi-megabyte save root');
console.log(JSON.stringify({suite:'build336-state-byte-attribution-pressure',passed:true,totalBytes,assets:1020,deliveries:1020,businessEvents:state.businessLedger.events.length,proofRecords:Object.keys(state.documentProofs?.recordsById||{}).length,measured:{assetsBytes,realismBytes,deliveriesBytes,eventLedgerBytes},top:top.slice(0,12),subtrees},null,2));
