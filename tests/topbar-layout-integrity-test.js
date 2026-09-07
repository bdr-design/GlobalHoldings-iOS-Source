const fs=require('fs');
const assert=require('assert');
const css=fs.readFileSync('WebApp/styles.css','utf8');
assert(css.includes('grid-template-columns:repeat(4,40px)!important'),'Desktop top actions must reserve four columns');
assert(css.includes('grid-template-columns:178px minmax(360px,560px) minmax(190px,1fr)!important'),'Topbar parent action track must fit the four-button action group');
assert(css.includes('grid-template-columns:repeat(4,36px)!important'),'Compact landscape top actions must reserve four columns');
assert(css.includes('grid-template-columns:repeat(4,34px)!important'),'Narrow landscape top actions must reserve four columns');
assert(css.includes('width:178px!important;min-width:178px!important'),'Desktop action group width must fit four 40px controls plus gaps');
assert(css.includes('width:159px!important;min-width:159px!important'),'Compact action group width must fit four 36px controls plus gaps');
assert(css.includes('width:151px!important;min-width:151px!important'),'Narrow action group width must fit four 34px controls plus gaps');

const rect=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height,width,height});
const el=(r,children=[])=>({getBoundingClientRect:()=>r,querySelectorAll:()=>children});
const button=(id,r)=>({id,getBoundingClientRect:()=>r});
function installLayout(bad=false){
  const topbar=el(rect(100,5,1300,60));
  const brand=el(rect(1130,15,250,40));
  const kpis=el(rect(460,15,560,40));
  const buttons=[
    button('aiRequestsBtn',rect(120,15,40,40)),
    button('alertsBtn',rect(166,15,40,40)),
    button('healthBtn',rect(212,15,40,40)),
    button('settingsBtn',bad?rect(120,61,40,40):rect(258,15,40,40)),
  ];
  const actions=el(bad?rect(115,10,178,91):rect(115,15,178,40),buttons);
  const mapActions=el(rect(115,82,260,44));
  global.document={documentElement:{clientWidth:1536,clientHeight:720},querySelector:(sel)=>({
    '.topbar':topbar,'.topbar .brand':brand,'.topbar .top-kpis':kpis,'.topbar .top-actions':actions,'.map-actions':mapActions
  }[sel]||null)};
  global.innerWidth=1536;global.innerHeight=720;global.getComputedStyle=()=>({display:'block',visibility:'visible'});
}
const d=require('../WebApp/diagnostics-core.js');
for(const k of ['GH_TRANSACTION_CORE','GH_SIMULATION_CORE','GH_SAVE_SCHEMA','GH_DETERMINISM'])global[k]={VERSION:'2.9.0',execute(){},create(){},normalize(){}};
for(const k of ['GH_REQUEST_CORE','GH_LIFECYCLE_CORE','GH_POLICY_CORE','GH_DEPENDENCY_CORE','GH_EVENT_LEDGER','GH_DEMAND_CLOSURE','GH_INTEGRITY_CORE'])global[k]={VERSION:'2.9.0',check(){return {issues:[]}},detectCycles(){return []},reconcile(){return {}},summary(){return {}}};
const state=()=>({simSeconds:10,speed:1,cash:50e6,debt:0,groupValue:50e6,saveVersion:'2.0.0',assets:[],finance:{receivables:[],payables:[],invoices:[],cheques:[],companyBooks:{}},diagnostics:{events:[],counters:{}}});
installLayout(false);let report=d.runHealthCheck(state(),{});assert(!report.issues.some(x=>x.id.startsWith('UI_')),'Healthy four-button topbar should not trigger UI issue');assert(report.layout&&report.layout.actionButtons.length===4,'Diagnostic layout snapshot must contain all four actions');
installLayout(true);report=d.runHealthCheck(state(),{});assert(report.issues.some(x=>x.id==='UI_TOPBAR_ACTION_WRAP'),'Wrapped action row must be diagnosed');assert(report.issues.some(x=>x.id==='UI_TOPBAR_ACTION_OVERFLOW'),'Action outside topbar must be diagnosed');
console.log('Topbar layout integrity + diagnostics: PASS');
