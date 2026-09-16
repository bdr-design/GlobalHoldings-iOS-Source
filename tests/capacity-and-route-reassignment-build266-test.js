'use strict';
const assert = require('assert');
const fs = require('fs');
const {scenario} = require('./helpers/business-scenario.js');

// 1) توحيد حساب سعة المنشأة: aiFacilityCapacity في advanced-core.js يجب أن يفوّض لنفس
// المصدر الوحيد المستخدم فعليًا لفحص سعة استقبال التسليم (realism-core.js)، لا نسخة منفصلة.
(function facilityCapacityUnified(){
  const adv = fs.readFileSync(require('path').join(__dirname,'..','WebApp','advanced-core.js'),'utf8');
  const realism = fs.readFileSync(require('path').join(__dirname,'..','WebApp','realism-core.js'),'utf8');
  assert(adv.includes('globalThis.GH_REALISM?.deliveryCapacity?.(state,f)'),'aiFacilityCapacity must delegate to the single canonical capacity source');
  assert(!/aiFacilityCapacity[\s\S]{0,10}const modeled=Number\(state\.advanced\?\.facilities/.test(adv),'the old independent duplicate capacity formula must not reappear in advanced-core.js');
  assert(realism.includes('deliveryCapacity}') || realism.includes('deliveryCapacity,') || /deliveryCapacity[,}]/.test(realism),'realism-core.js must actually export deliveryCapacity for other modules to reuse');
})();

// 2) إعادة تعيين أصل مرتبط سابقًا بمسار: يجب أن تعمل بدقة تامة (بلا بقايا) عند التحويل
// اليدوي لمسار مختلف تمامًا، وعند إزالة تكرار مسارات تعيد ربط الأصول للمسار الباقي.
(function routeReassignmentIntegrity(){
  const {s,state,ctx,command,item}=scenario();
  const orderId=ctx.buyAsset('air','new',item.id,'cash',1,'B1',false,true,'MANUAL-REASSIGN-REGRESSION');
  state.simSeconds=200; s.GH_REALISM.onSimulationTime(state,200);
  const asset=state.assets[0];
  const routeA={id:'R-A',type:'air',route:[[24.7,46.6],[25.2,55.3]],fromFacility:'B1',toFacility:'B1',distanceKm:900,tripSeconds:3600,effectiveSpeedKmh:750,dwellHours:1};
  const routeB={id:'R-B',type:'air',route:[[24.7,46.6],[30.0,31.2]],fromFacility:'B1',toFacility:'B1',distanceKm:1200,tripSeconds:4200,effectiveSpeedKmh:750,dwellHours:1};
  command('routes','create',{route:routeA});command('routes','create',{route:routeB});
  command('fleet','assign-route',{id:asset.id,routeId:'R-A',baseFacility:asset.baseFacility,phase:'turnaround',route:routeA});
  command('fleet','assign-route',{id:asset.id,routeId:'R-B',baseFacility:asset.baseFacility,phase:'turnaround',route:routeB});
  assert.strictEqual(state.assets[0].routeId,'R-B','reassigning an already-routed asset to a different route must fully take effect, no leftover from the old route');
  assert.strictEqual(state.assets[0].to,routeB.to,'the asset destination must match the newly assigned route');
  command('hr','hire',{company:'air',source:'test'});
  command('fleet','depart',{id:asset.id,route:routeB,load:'cargo'});
  assert.strictEqual(state.assets[0].phase,'moving','the reassigned asset must actually be able to depart on its new route');

  // إزالة تكرار مسارات يجب أن تعيد ربط أي أصل من مسار محذوف للمسار الباقي، لا بقايا معلّقة.
  const s2=scenario();
  const asset2Order=s2.ctx.buyAsset('air','new',s2.item.id,'cash',1,'B1',false,true,'MANUAL-DEDUPE-REGRESSION');
  s2.state.simSeconds=200; s2.s.GH_REALISM.onSimulationTime(s2.state,200);
  const asset2=s2.state.assets[0];
  const route1={id:'R-ORIG',type:'air',route:[[24.7,46.6],[25.2,55.3]],fromFacility:'B1',toFacility:'B1',distanceKm:900,tripSeconds:3600,effectiveSpeedKmh:750,dwellHours:1};
  s2.command('routes','create',{route:route1});
  s2.command('fleet','assign-route',{id:asset2.id,routeId:'R-ORIG',baseFacility:asset2.baseFacility,phase:'turnaround',route:route1});
  s2.state.customRoutes.push({...route1,id:'R-DUP'});
  const dedupe=s2.command('routes','dedupe',{});
  assert.strictEqual(dedupe.removed,1,'the injected duplicate route must be detected and removed');
  assert(s2.state.customRoutes.some(r=>r.id===s2.state.assets[0].routeId),'after dedupe, the asset must point to a route that still actually exists - no dangling reference');
})();

console.log('Unified facility capacity + route reassignment integrity BUILD266: PASS');
