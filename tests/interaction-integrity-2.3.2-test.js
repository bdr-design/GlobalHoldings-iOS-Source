const assert=require('assert');
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'WebApp','interaction-core.js'),'utf8');
const sandbox={console,module:{exports:{}},exports:{},globalThis:null};sandbox.globalThis=sandbox;sandbox.window=sandbox;vm.runInNewContext(src,sandbox);
const core=sandbox.module.exports||sandbox.GH_INTERACTION;assert(core&&core.VERSION==='2.9.1');
const events=[];sandbox.GH_DIAGNOSTICS={record(_s,t,d,sev){events.push({t,d,sev})}};
const state={simSeconds:0};
function button(extra={}){return {disabled:false,dataset:{ghAction:'demo',...extra},textContent:'تنفيذ',classList:{add(){},remove(){}},setAttribute(){},removeAttribute(){},getAttribute(){return null;}};}
(async()=>{
 const b=button();let calls=0;
 const p1=core.run(b,async()=>{calls++;await new Promise(r=>setTimeout(r,10));return 1;},{state});
 const p2=await core.run(b,async()=>{calls++;},{state});
 assert.strictEqual(p2.busy,true,'duplicate click must be blocked');await p1;assert.strictEqual(calls,1);
 const d=button({disabledReason:'شرط غير مكتمل'});d.disabled=true;const dr=await core.run(d,()=>{}, {state});assert.strictEqual(dr.disabled,true);
 assert(events.some(x=>x.t==='BUTTON_ACTION_OK'));assert(events.some(x=>x.t==='BUTTON_DUPLICATE_BLOCKED'));assert(events.some(x=>x.t==='BUTTON_DISABLED'));
 const css=fs.readFileSync(path.join(root,'WebApp','styles.css'),'utf8');assert(css.includes('.drawer .finance-domain-nav{grid-template-columns:repeat(2'));assert(css.includes('.workflow-stepper'));
 const adv=fs.readFileSync(path.join(root,'WebApp','advanced-core.js'),'utf8');assert(adv.includes('workflow-stepper ma-workflow'));assert(!adv.includes('request-financial-summary'),'the dead AI asset-request/portfolio panels (removed BUILD259) must not resurface');
 console.log('Interaction integrity 2.3.9: PASS');
})().catch(e=>{console.error(e);process.exit(1)});
