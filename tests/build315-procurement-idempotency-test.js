'use strict';
const assert=require('assert');
const {scenario}=require('./helpers/business-scenario');

(function procurementRetryIsExactlyOnce(){
  const {s,state,ctx,item}=scenario();
  const base=state.globalBases.find(row=>row.id==='B1');
  assert(base,'scenario must expose the real air delivery base');
  const supplier=ctx.supplierFor();
  const qty=2,totalPrice=Number(item.price)*qty;
  const payload={
    type:'air',tab:'new',item,base,supplier,mode:'cash',qty,
    manual:true,requestRef:'MANUAL-IDEMPOTENCY-001',
    upfront:totalPrice,totalPrice,documentLeadDays:1,leadSeconds:0,
    immediateDelivery:true,companyName:'air'
  };
  const key='PURCHASE-IDEMPOTENCY-001';
  const operatingBefore=s.GH_FINANCE_CORE.operating(state,'air');
  const deliveriesBefore=state.realism.procurement.deliveries.length;
  const suppliersBefore=state.supplierTransactions.length;

  const first=s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',payload,{actor:'idempotency-regression',idempotencyKey:key});
  assert(first.ok&&first.result?.count===qty,'first purchase must commit the requested quantity');
  const operatingAfterFirst=s.GH_FINANCE_CORE.operating(state,'air');
  const deliveriesAfterFirst=state.realism.procurement.deliveries.length;
  const suppliersAfterFirst=state.supplierTransactions.length;
  assert.strictEqual(operatingBefore-operatingAfterFirst,totalPrice,'first purchase must debit exactly once');
  assert.strictEqual(deliveriesAfterFirst-deliveriesBefore,qty,'first purchase must create exactly the requested delivery rows');
  assert.strictEqual(suppliersAfterFirst-suppliersBefore,1,'first purchase must create one supplier settlement');

  const retry=s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',payload,{actor:'idempotency-regression',idempotencyKey:key});
  assert.strictEqual(retry.commandId,first.commandId,'same key + same payload must return the cached command result');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(retry.result)),JSON.parse(JSON.stringify(first.result)),'retry result must be identical to the committed result');
  assert.strictEqual(s.GH_FINANCE_CORE.operating(state,'air'),operatingAfterFirst,'retry must not debit company cash again');
  assert.strictEqual(state.realism.procurement.deliveries.length,deliveriesAfterFirst,'retry must not duplicate assets/deliveries');
  assert.strictEqual(state.supplierTransactions.length,suppliersAfterFirst,'retry must not create a second supplier settlement');

  const conflicting={...payload,qty:1,upfront:Number(item.price),totalPrice:Number(item.price)};
  assert.throws(
    ()=>s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',conflicting,{actor:'idempotency-regression',idempotencyKey:key}),
    /Idempotency payload conflict/,
    'same key with a different payload must fail closed'
  );
  assert.strictEqual(s.GH_FINANCE_CORE.operating(state,'air'),operatingAfterFirst,'conflicting retry must not debit cash');
  assert.strictEqual(state.realism.procurement.deliveries.length,deliveriesAfterFirst,'conflicting retry must not create deliveries');
  assert.strictEqual(state.supplierTransactions.length,suppliersAfterFirst,'conflicting retry must not create a settlement');

  const committed=(state.domainRuntime?.commands||[]).filter(row=>row.domain==='procurement'&&row.name==='purchase-assets'&&row.status==='committed');
  assert.strictEqual(committed.length,1,'exactly one procurement purchase command may commit for an idempotency key');
})();

console.log('BUILD315 procurement idempotency: PASS (same retry is exactly-once; conflicting payload rejected)');
