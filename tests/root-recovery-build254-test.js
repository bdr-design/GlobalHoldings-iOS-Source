'use strict';
const assert=require('assert'),fs=require('fs');
const {scenario}=require('./helpers/business-scenario');
{
 const {s,state}=scenario(),before=s.GH_FINANCE_CORE.operating(state,'air'),ref='FND-IDEMPOTENT-001';
 const first=s.GH_FINANCE_CORE.execute({state},'founder-investment',{company:'air',amount:25000000,ref,note:'اختبار استثمار وارد'});
 const second=s.GH_FINANCE_CORE.execute({state},'founder-investment',{company:'air',amount:25000000,ref,note:'إعادة شبكة'});
 assert.strictEqual(first.amount,25000000);assert.strictEqual(second.idempotent,true);assert.strictEqual(second.amount,0);assert.strictEqual(s.GH_FINANCE_CORE.operating(state,'air'),before+25000000);assert.strictEqual(state.finance.transfers.filter(x=>x.id===ref).length,1);assert.strictEqual(state.finance.journalEntries.filter(x=>x.sourceRef===ref).length,1);
}
{
 const {s,state,ctx,command,load}=scenario();load('mobility-core');command('corporate','open-company',{type:'mobility',capital:120000000,legalName:'GH Mobility'});
 const launched=s.GH_MOBILITY_CORE.launch(ctx),live=s.GH_MOBILITY_CORE.liveVehicles(state,120);
 assert(launched.activeTrips>0&&launched.moving>0);assert(live.some(x=>x.phase==='moving'&&x.route.length>=5&&x.tripId));
}
{
 const app=fs.readFileSync('WebApp/app.js','utf8'),html=fs.readFileSync('WebApp/index.html','utf8'),css=fs.readFileSync('WebApp/styles.css','utf8');
 assert(app.includes('filter===\'all\'||filter===\'mobility\'')&&app.includes('GH_MOBILITY_CORE?.liveVehicles'));assert(html.includes('data-filter="mobility"'));assert(css.includes('.cheque-paper.authority-inspired::before')&&css.includes('repeating-radial-gradient'));
}
console.log('Root Recovery BUILD255: PASS');
