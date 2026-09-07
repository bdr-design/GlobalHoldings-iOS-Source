'use strict';
const assert=require('assert');
const {scenario}=require('./helpers/business-scenario');

{
  const {s,state,ctx}=scenario();state.advanced.facilities.B1.capacity=30;
  const plan=s.GH_REQUEST_CORE.preparePortfolio(ctx);
  assert.strictEqual(plan.status,'awaiting_authorization');
  assert(plan.summary.assetCount>=12,'AI portfolio must be large when center capacity allows');
  assert(plan.summary.models>=4,'AI portfolio must diversify catalog models');
  assert(plan.market.some(x=>x.company==='air'),'market evidence must be persisted');
  assert(plan.centers.some(x=>x.id==='B1'&&x.planned===plan.summary.assetCount),'center capacity decision must be explicit');
  const cashBefore=s.GH_FINANCE_CORE.operating(state,'air');
  const execution=s.GH_REQUEST_CORE.approvePortfolio(ctx,plan.id);
  assert.strictEqual(execution.assetIds.length,plan.summary.assetCount,'one approval must deliver every approved asset');
  assert.strictEqual(new Set(execution.assetIds).size,execution.assetIds.length,'asset ids must be unique');
  assert(state.realism.procurement.deliveries.filter(x=>execution.assetIds.includes(x.asset.id)).every(x=>x.status==='delivered'&&x.expeditedBy==='approved-ai-portfolio'),'every delivery needs immediate verified evidence');
  assert(s.GH_HR_CORE.snapshot(state,ctx,'air').total===0,'crew and center staffing must be complete');
  for(const id of execution.assetIds){const asset=state.assets.find(x=>x.id===id);asset.routeId='AI-ROUTE';asset.phase='moving';}
  const verified=s.GH_REQUEST_CORE.verifyPortfolioActivation(ctx,plan.id);assert(verified.ok&&verified.moving===plan.summary.assetCount);
  const done=s.GH_REQUEST_CORE.completePortfolio(ctx,plan.id);assert.strictEqual(done.status,'completed');
  assert(state.advanced.procurement.assetPortfolioArchive.some(x=>x.id===plan.id));
  assert(s.GH_FINANCE_CORE.operating(state,'air')<cashBefore,'approved portfolio must record its financial commitment');
}

{
  const {s,state,ctx}=scenario();state.advanced.facilities.B1.capacity=24;
  const plan=s.GH_REQUEST_CORE.preparePortfolio(ctx),before=structuredClone(state);
  let calls=0,real=ctx.buyAsset;ctx.buyAsset=(...args)=>{calls++;if(calls===2)return null;return real(...args);};
  assert.throws(()=>s.GH_REQUEST_CORE.approvePortfolio(ctx,plan.id),/تعذر إصدار أمر الخط/);
  assert.strictEqual(JSON.stringify(state.assets),JSON.stringify(before.assets),'failed multi-line execution must not leave assets');
  assert.strictEqual(JSON.stringify(state.realism.procurement.deliveries),JSON.stringify(before.realism.procurement.deliveries),'failed multi-line execution must not leave deliveries');
  assert.strictEqual(s.GH_FINANCE_CORE.operating(state,'air'),s.GH_FINANCE_CORE.operating(before,'air'),'failed multi-line execution must restore cash');
  assert.strictEqual(state.advanced.procurement.assetPortfolioPlans[0].status,'awaiting_authorization','plan must remain approvable after rollback');
}

console.log('AI Asset Orchestrator Build251: PASS');
