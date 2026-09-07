'use strict';
const assert=require('assert'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
// interaction busy state must not be reported as unexplained disabled
const interaction=require(path.join(ROOT,'WebApp','interaction-core.js'));
function fakeButton({disabled=false,busy=false,title='',reason=''}){return {disabled,title,dataset:{disabledReason:reason},classList:{contains:x=>busy&&x==='is-busy'},getAttribute:k=>k==='aria-busy'&&busy?'true':null,textContent:'Export',onclick:null};}
let root={querySelectorAll:()=>[fakeButton({disabled:true,busy:true})]};
assert.equal(interaction.validate(root).length,0,'busy disabled button must not be flagged');
root={querySelectorAll:()=>[fakeButton({disabled:true,busy:false})]};
assert(interaction.validate(root).some(x=>x.id==='DISABLED_WITHOUT_REASON'),'unexplained disabled button must still be flagged');

// department startup grace
const dept=require(path.join(ROOT,'WebApp','department-core.js'));
const s0={simSeconds:183,advanced:{}};
assert.equal(dept.due('air',s0),false,'daily department must not be overdue during startup grace');
s0.simSeconds=86400;
assert.equal(dept.due('air',s0),true,'daily department becomes due after one full cadence');
const s7={simSeconds:0,advanced:{}};
assert.equal(dept.due('audit',s7),false);s7.simSeconds=7*86400;assert.equal(dept.due('audit',s7),true,'weekly department becomes due after seven days');

// control plane must dedupe same invariant from diagnostics/integrity
require(path.join(ROOT,'WebApp','transaction-core.js'));
globalThis.GH_SAVE_SCHEMA={validate:()=>({ok:true})};
globalThis.GH_EVENT_LEDGER={append:()=>({})};
globalThis.GH_DEPENDENCY_CORE={detectCycles:()=>[]};
globalThis.GH_DIAGNOSTICS={runHealthCheck:()=>({issues:[{id:'BIZ_POWER_RESERVE_MARGIN_LOW',severity:'warning',domain:'energy',title:'low',detail:'diag',evidence:{a:1}}]})};
globalThis.GH_INTEGRITY_CORE={check:()=>({issues:[{id:'POWER_RESERVE_MARGIN_LOW',severity:'warning',domain:'energy',title:'low',detail:'int',evidence:{b:2}}]})};
const CP=require(path.join(ROOT,'WebApp','control-plane-core.js'));
const state={saveVersion:'2.0.0',saveRevision:1,simSeconds:0,assets:[],customRoutes:[],globalBases:[],customHubs:[],companyFinance:{},advanced:{ai:{requests:[]}},realism:{procurement:{deliveries:[]}}};
CP.bootstrap(state,{});
const health=CP.check(state);
const power=health.issues.filter(x=>x.id==='POWER_RESERVE_MARGIN_LOW');
assert.equal(power.length,1,'same invariant from two engines must be merged once');
assert(power[0].sources.includes('diagnostics')&&power[0].sources.includes('integrity'),'merged issue must preserve both evidence sources');
console.log('guardian-noise-reduction-build243-test: PASS');
