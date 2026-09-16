'use strict';
const assert = require('assert');
const fs = require('fs');
const {scenario} = require('./helpers/business-scenario.js');

// 1) ربحية كل مدينة في Mobility يجب أن تُحسب بدقة وتطابق الإجمالي العالمي تمامًا.
(function mobilityCityProfitability(){
  const s = scenario();
  s.load('mobility-core');
  const {state, ctx, s: sandbox} = s;
  s.command('corporate','open-company',{type:'mobility',capital:500000000,legalName:'Test Mobility'});
  sandbox.GH_MOBILITY_CORE.launch(ctx);
  state.mobility.capitalCenters.unshift({id:'MOB-CENTER-LON',capitalId:'LON',city:'لندن',country:'UK',coords:[51.5074,-0.1278],facilityId:'MOB-CENTER-LON',openedAt:state.simSeconds});
  sandbox.GH_MOBILITY_CORE.buyFleet(ctx,{quantity:60,centerId:'LON'});

  let at=state.simSeconds;
  for(let i=0;i<3000;i+=30){at+=30;state.simSeconds=at;sandbox.GH_MOBILITY_CORE.onSimulationTime(ctx,at);}

  const ruh=sandbox.GH_MOBILITY_CORE.centerSnapshot(state,'RUH');
  const lon=sandbox.GH_MOBILITY_CORE.centerSnapshot(state,'LON');
  const global=sandbox.GH_MOBILITY_CORE.snapshot(state);
  assert(ruh.completed>0&&lon.completed>0,'both cities must complete real trips in this window');
  assert.strictEqual(ruh.completed+lon.completed,global.completed,'sum of per-city completed trips must exactly match the global total');
  assert(Math.abs((ruh.platformRevenue+lon.platformRevenue)-global.platformRevenue)<0.01,'sum of per-city profit must exactly match the global platform revenue - no leak, no double count');
})();

// 2) لوحة HR يجب أن تعرض سجل قرارات التوظيف الفعلي (hr.hiringLog) بدل تجاهله.
(function hrHiringLogSurfaced(){
  const adv = fs.readFileSync(require('path').join(__dirname,'..','WebApp','advanced-core.js'),'utf8');
  assert(adv.includes('hr.hiringLog'),'HR dashboard must read and surface hr.hiringLog');
  assert(adv.includes('سجل قرارات التوظيف الأخيرة'),'HR dashboard must render a recent hiring decisions section');
})();

// 3) مركز المسارات يجب أن يرتب المسارات حسب متوسط الهامش الفعلي، لا حسب الترتيب العشوائي فقط.
(function routeCenterProfitabilityRanking(){
  const app = fs.readFileSync(require('path').join(__dirname,'..','WebApp','app.js'),'utf8');
  assert(app.includes('avgMargin'),'route center must compute an average real trip margin per route');
  assert(/\.sort\(\(a,b\)=>\(b\.avgMargin/.test(app),'route cards must be sorted by that real profitability, not just insertion order');
})();

console.log('Mobility city profit + HR hiring log + route profitability ranking BUILD262: PASS');
