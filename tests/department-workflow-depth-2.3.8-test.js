const assert=require('assert');
const core=require('../WebApp/department-core.js');
function base(){return {simSeconds:86400,cash:30000000,debt:120000000,assets:[{id:'A1',condition:62}],finance:{journal:[],invoices:[]},advanced:{ai:{requests:[]},treasury:{fxExposure:25000000},legal:{cases:[{id:'L1',status:'مفتوح'}]},insurance:{claims:[{id:'C1',status:'مفتوحة'}]},cyber:{score:55,coverage:65,incidents:2},safety:{score:62,incidents:1},sustainability:{programs:{solar:{cost:2e6,maturity:10}}}},insurancePolicies:['air'],research:{efficiency:10},realism:{aviation:{dispatchReliability:91,otp:82,healthMonitoringScore:70,maintenanceReserveCoverage:55,aog:2},maritime:{cii:'D',eexiReadiness:65,waitingHours:30,dryDockDue:2,correctiveAction:true},logistics:{onTime:78,lpiProxy:2.4,emptyMiles:30,damageRate:2,warehouseUtilization:96},energy:{reserveMargin:-3,storageHealth:55,curtailment:15,availableMW:300},banking:{cet1:6.5,cet1Headroom:-1,lcr:85,lcrHeadroom:-15,nsfr:92,nsfrHeadroom:-8,npl:7},financial:{consolidated:{net:-1000000}},board:{resolutions:[{id:'B1',status:'مفتوح'}],meetings:[]},controls:{issues:[{id:'F1',severity:'critical',title:'قيد غير متوازن',value:'1'}]}}};}
const s=base();core.ensure(s);
for(const dept of Object.keys(core.definitions)){
  const r=core.review(dept,s,'test');
  const snap=core.snapshot(dept,s);
  assert(r.owner,'each report must have accountable owner');
  assert(Number.isFinite(r.nextReviewDay),'each report must schedule next review');
  assert(Array.isArray(snap.openWorkItems),'each department exposes actual work queue');
  assert(core.procedures[dept].length>=5,'procedure must include lifecycle through closure');
}
assert(core.snapshot('air',s).openWorkItems.some(x=>x.signature==='air|aog'),'AOG must open a real work item');
assert(core.snapshot('bank',s).openWorkItems.some(x=>x.signature==='bank|lcr'),'LCR breach must open bank work item');
assert(core.snapshot('road',s).openWorkItems.some(x=>x.signature==='road|lpi'),'low logistics quality must open work item');
const cap=core.snapshot('power',s).openWorkItems.find(x=>x.requiresApproval);assert(cap,'capacity/reliability issue must require management approval');
const result=core.actOnWorkItem(cap.id,s,s.advanced.ai.requests,'test');assert.equal(result.status,'escalated');assert(s.advanced.ai.requests.some(x=>x.departmentEscalationId===result.escalation.id),'management escalation must use existing AI approval center');
const aog=core.snapshot('air',s).openWorkItems.find(x=>x.signature==='air|aog');assert.equal(core.actOnWorkItem(aog.id,s,s.advanced.ai.requests,'test').status,'in-progress','non-capital corrective work starts but cannot fake-close');
s.realism.aviation.aog=0;core.syncWork('air',s);assert.equal(s.advanced.departmentLife.workItems.find(x=>x.id===aog.id).status,'مغلق','work item closes only after source condition clears');
console.log('Department workflow depth 2.3.9: PASS');
