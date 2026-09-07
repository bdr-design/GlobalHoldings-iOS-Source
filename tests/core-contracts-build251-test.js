'use strict';
const assert=require('assert'),{scenario}=require('./helpers/business-scenario');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
test('Finance → Request → Procurement → Fleet → Facilities → HR → Route',()=>{
 const {s,state,ctx,command,item,request}=scenario(),r=request(3),cash=state.cash;
 assert.strictEqual(s.GH_REQUEST_CORE.authorize(ctx,r.id),true);
 const ch=command('finance','issue-cheque',{company:'air',amount:item.price*3,beneficiary:'Supplier',requestRef:r.id});
 const settled=command('finance','settle-cheque',{id:ch.id});assert.strictEqual(settled.settled,true);
 assert.strictEqual(s.GH_REQUEST_CORE.paymentCleared(ctx,settled).status,'payment-cleared');
 s.GH_REQUEST_CORE.tick(ctx);assert.strictEqual(r.status,'delivering');assert.strictEqual(r.deliveryOrderIds.length,3);assert.strictEqual(state.cash,cash-item.price*3);
 s.GH_REQUEST_CORE.tick(ctx);assert.strictEqual(state.realism.procurement.deliveries.length,3);assert.strictEqual(state.cash,cash-item.price*3);
 state.simSeconds=61;s.GH_REQUEST_CORE.tick(ctx);assert.strictEqual(state.assets.length,3);assert(state.assets.every(a=>a.baseFacility==='B1'&&a.paymentRef===ch.id));assert.strictEqual(r.status,'readiness');
 const hr=command('hr','hire',{company:'air'});assert.strictEqual(hr.missingAfter,0);assert.strictEqual(s.GH_HR_CORE.snapshot(state,ctx,'air').total,0);
 s.GH_REQUEST_CORE.tick(ctx);assert.strictEqual(r.status,'completed');assert.strictEqual(state.advanced.procurement.assetRequests.length,0);
 const route=command('routes','create',{route:{id:'R1',name:'Test route',type:'air',from:'RUH',to:'DMM',fromFacility:'B1',toFacility:'PUBLIC-DMM',route:[[24.7,46.6],[26.4,50.1]],distanceKm:400,tripSeconds:3600}});
 const a=state.assets[0];assert.strictEqual(command('fleet','assign-route',{id:a.id,routeId:route.id,route}).phase,'turnaround');
 assert.strictEqual(command('fleet','depart',{id:a.id,route}).phase,'moving');assert.strictEqual(a.from,'RUH');assert.strictEqual(a.reverse,false);
 a.phase='turnaround';a.baseFacility='PUBLIC-DMM';command('fleet','depart',{id:a.id,route});assert.strictEqual(a.from,'DMM');assert.strictEqual(a.reverse,true);
 const before=state.cash;command('finance','credit',{company:'air',amount:1000,taxable:false});command('finance','spend',{company:'air',amount:200,taxable:false});assert.strictEqual(state.cash,before+800);
 assert(s.GH_SAVE_SCHEMA.validate(state).ok,JSON.stringify(s.GH_SAVE_SCHEMA.validate(state).errors));
 assert(state.finance.journalEntries.every(j=>Math.abs(j.lines.reduce((n,x)=>n+x.debit-x.credit,0))<.01));
});
test('bounced/unrelated/unauthorized cheque cannot unlock a request',()=>{
 const {s,state,ctx,command,item,request}=scenario(),r=request();s.GH_REQUEST_CORE.authorize(ctx,r.id);
 command('finance','transfer',{from:'air',to:'group',amount:500000000-item.price*3});
 const ch=command('finance','issue-cheque',{company:'air',amount:item.price*3,beneficiary:'Supplier',requestRef:r.id});
 command('finance','transfer',{from:'air',to:'group',amount:item.price*3});
 const result=command('finance','settle-cheque',{id:ch.id});assert(!result.settled);assert(!s.GH_REQUEST_CORE.paymentCleared(ctx,result).ok);assert(!r.prepaidUpfront);
 s.GH_REQUEST_CORE.tick(ctx);assert.strictEqual(r.status,'blocked_funding');assert.strictEqual(state.realism.procurement.deliveries.length,0);
});
test('full base blocks the complete order before any payment',()=>{
 const {s,state,ctx,request}=scenario(),r=request();state.advanced.facilities.B1.capacity=2;s.GH_REQUEST_CORE.authorize(ctx,r.id);const cash=state.cash;
 s.GH_REQUEST_CORE.tick(ctx);assert.strictEqual(r.status,'blocked_capacity');assert.strictEqual(state.cash,cash);assert.strictEqual(state.realism.procurement.deliveries.length,0);
});
test('missing delivery order rolls back payment and all generated assets',()=>{
 const {s,state,ctx,request}=scenario(),r=request(),buy=ctx.buyAsset;s.GH_REQUEST_CORE.authorize(ctx,r.id);
 ctx.buyAsset=(...args)=>{const out=buy(...args);state.realism.procurement.deliveries.pop();return out;};const cash=state.cash;
 assert.throws(()=>s.GH_REQUEST_CORE.tick(ctx),/أُلغي الشراء/);assert.strictEqual(state.cash,cash);assert.strictEqual(state.realism.procurement.deliveries.length,0);assert.strictEqual(r.status,'authorized');
});
test('payment bypass, wrong base and fractional quantity are rejected',()=>{
 const {s,state,ctx,command,item,request}=scenario(),r=request();s.GH_REQUEST_CORE.authorize(ctx,r.id);const cash=state.cash;
 command('facilities','create',{facility:{id:'B2',kind:'airport-base',company:'air',owned:true}});
 const p={type:'air',item,base:state.globalBases[1],qty:3,mode:'cash',prepaid:true,upfront:item.price*3,requestRef:r.id};
 assert.throws(()=>command('procurement','purchase-assets',p),/request-contract/);
 assert.throws(()=>command('procurement','purchase-assets',{...p,base:state.globalBases[0]}),/prepayment-evidence/);
 assert.throws(()=>command('procurement','purchase-assets',{...p,qty:1.5}),/invalid-asset-purchase/);assert.strictEqual(state.cash,cash);
});
test('unverified and wrong-destination asset delivery is rejected',()=>{
 const {s,state,ctx,command,request}=scenario(),r=request();s.GH_REQUEST_CORE.authorize(ctx,r.id);s.GH_REQUEST_CORE.tick(ctx);const d=state.realism.procurement.deliveries[0];
 assert.throws(()=>command('fleet','record-delivery',{deliveryId:d.id,asset:d.asset,baseId:'WRONG'}));
 const invoice=state.finance.invoices.find(i=>i.number===d.payment.ref);invoice.status='مستحقة';assert.throws(()=>command('fleet','record-delivery',{deliveryId:d.id,asset:d.asset,baseId:'B1'}),/payment/);assert.strictEqual(state.assets.length,0);
});
test('Market cannot acquire without Corporate and failure keeps finance unchanged',()=>{
 const {s,state,command}=scenario(),cash=state.cash;const c=s.GH_CORPORATE_CORE;s.GH_CORPORATE_CORE=undefined;
 assert.throws(()=>command('market','acquire-stake',{id:'M1',name:'Target',amount:10000,stake:51}),/corporate/);assert.strictEqual(state.cash,cash);assert.deepStrictEqual([...state.ownedCompanies],[]);
 s.GH_CORPORATE_CORE=c;const acquired=command('market','acquire-stake',{id:'M1',name:'Target',amount:10000,stake:51});assert.strictEqual(acquired.stake,51);assert(state.ownedCompanies.includes('M1'));assert.strictEqual(state.cash,cash-10000);
});
test('founding failure rolls back identity, capital and financial posting together',()=>{
 const {s,defaults}=scenario(),state=s.GH_GAME_LIFECYCLE.pristine(defaults,7),before=JSON.stringify(state);
 assert.throws(()=>s.GH_GAME_LIFECYCLE.foundGroup(state,{name:'Fail',mode:'balanced'},defaults,{onCommit:()=>{throw new Error('quota');}}),/quota/);assert.strictEqual(JSON.stringify(state),before);
 const out=s.GH_GAME_LIFECYCLE.foundGroup(state,{name:'Pass',mode:'balanced'},defaults);assert.strictEqual(out.capital,50000000);assert.strictEqual(state.cash,50000000);assert.strictEqual(state.finance.journalEntries.length,1);
 assert.throws(()=>s.GH_GAME_LIFECYCLE.foundGroup(state,{name:'Duplicate'},defaults),/already-founded/);assert.strictEqual(state.cash,50000000);
});
console.log(JSON.stringify({suite:'real-core-contracts',passed:count,total:count}));
