'use strict';
const assert=require('assert'),fs=require('fs');
const {scenario}=require('./helpers/business-scenario');

// Investor cash has one auditable transfer identity across finance, treasury and journal.
{
  const {s,state}=scenario(),before=s.GH_FINANCE_CORE.operating(state,'air'),ref='FND-IDEMPOTENT-001';
  const first=s.GH_FINANCE_CORE.execute({state},'founder-investment',{company:'air',amount:25000000,ref,note:'اختبار استثمار وارد'});
  const second=s.GH_FINANCE_CORE.execute({state},'founder-investment',{company:'air',amount:25000000,ref,note:'إعادة شبكة'});
  assert.strictEqual(first.amount,25000000);assert.strictEqual(second.idempotent,true);assert.strictEqual(second.amount,0);
  assert.strictEqual(s.GH_FINANCE_CORE.operating(state,'air'),before+25000000);
  assert.strictEqual(state.finance.transfers.filter(x=>x.id===ref).length,1);
  const bankWire=state.treasury.ledger.filter(x=>x.reference===ref);assert.strictEqual(bankWire.length,1);assert.strictEqual(bankWire[0].kind,'founder-investment');assert.strictEqual(bankWire[0].to,state.companyFinance.air.accounts[0].id);
  assert.strictEqual(state.finance.journalEntries.filter(x=>x.sourceRef===ref).length,1);
}

// A routing fault never deletes already paid and received assets; retry is idempotent.
{
  const {s,state,ctx}=scenario();state.advanced.facilities.B1.capacity=24;
  const plan=s.GH_REQUEST_CORE.preparePortfolio(ctx),execution=s.GH_REQUEST_CORE.approvePortfolio(ctx,plan.id),assetCount=state.assets.length,deliveryCount=state.realism.procurement.deliveries.length,cash=state.cash;
  const first=state.assets.find(x=>x.id===execution.assetIds[0]);first.routeId='R-OK';first.phase='moving';
  const health=s.GH_REQUEST_CORE.verifyPortfolioActivation(ctx,plan.id);assert.strictEqual(health.ok,false);assert.strictEqual(plan.status,'activation_blocked');assert.strictEqual(health.moving,1);
  const retry=s.GH_REQUEST_CORE.approvePortfolio(ctx,plan.id);assert.deepStrictEqual(retry.assetIds,execution.assetIds);assert.strictEqual(state.assets.length,assetCount);assert.strictEqual(state.realism.procurement.deliveries.length,deliveryCount);assert.strictEqual(state.cash,cash);
}

// Mobility starts an actual trip on approval and exposes live map positions.
{
  const {s,state,ctx,command,load}=scenario();load('mobility-core');command('corporate','open-company',{type:'mobility',capital:18000000,legalName:'GH Mobility'});
  const launched=s.GH_MOBILITY_CORE.launch(ctx),live=s.GH_MOBILITY_CORE.liveVehicles(state);
  assert(launched.activeTrips>0&&launched.moving>0,'approval must dispatch immediately');assert(live.some(x=>x.phase==='moving'&&x.route.length===2&&x.tripId));
  const app=fs.readFileSync('WebApp/app.js','utf8'),html=fs.readFileSync('WebApp/index.html','utf8');assert(app.includes("filter==='all'||filter==='mobility'"));assert(app.includes('GH_MOBILITY_CORE?.liveVehicles'));assert(html.includes('data-filter="mobility"'));
}

// Cheques retain a visible security-paper treatment with no remote image dependency.
{
  const css=fs.readFileSync('WebApp/styles.css','utf8');assert(css.includes('.cheque-paper.authority-inspired::before'));assert(css.includes('repeating-radial-gradient'));assert(css.includes('data:image/svg+xml'));
}

console.log('Root Recovery Build254: PASS');
