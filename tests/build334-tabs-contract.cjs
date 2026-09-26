'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const web=path.resolve(__dirname,'../WebApp'),source=fs.readFileSync(path.join(web,'advanced-core.js'),'utf8'),app=fs.readFileSync(path.join(web,'app.js'),'utf8');
// Execute the original private renderer and encoder, without exposing a new runtime API.
const encoder=source.match(/^  const text=.*;$/m)?.[0];
const renderer=source.match(/^  const tabs = .*;$/m)?.[0];
assert(encoder&&renderer,'original renderer and encoder must remain identifiable');
const registry=source.match(/^  const TAB_ATTRIBUTES=.*;$/m)?.[0]||'';
const tabs=vm.runInNewContext(`${encoder}\n${registry}\n${renderer}\ntabs`,{});
const used=[...new Set([...source.matchAll(/tabs\([^\n]*?,'(data-[a-z-]+)'\)/g)].map(m=>m[1]))];
assert(used.includes('data-companytab')&&used.includes('data-labortab'));
const allowed=['data-advanced-tab','data-company-manage-tab','data-facility-tab','data-energy-tab','data-bank-tab','data-treasury-tab','data-news-tab','data-business-tab','data-companytab','data-labortab'];
for(const name of allowed){
 const html=tabs([['one','الأول'],['two','الثاني']],'two',name);
 assert(html.includes(`${name}="one"`)&&html.includes(`${name}="two"`),`registered tab attribute lost: ${name}`);
 assert(html.includes(`class="tab-btn active" ${name}="two"`),'selected tab must remain selected');
}
for(const name of used)assert(allowed.includes(name),`unreviewed tab consumer: ${name}`);
for(const name of ['data-companytab','data-labortab'])assert(app.includes(`querySelectorAll('[${name}]')`),`matching click owner missing: ${name}`);
for(const name of ['onclick','data-unregistered-tab','data-companytab onclick="alert(1)"','data-labortab\n','data-company-tab','data-labor-tab']){
 const html=tabs([['safe','Safe']],'safe',name);
 assert(html.includes('data-advanced-tab="safe"'),'unknown attribute must keep the restricted fallback');
 assert(!html.includes('onclick='),'attribute name injection must not execute');
}
const payload='"><img src=x onerror="alert(1)">';
const html=tabs([[payload,payload]],payload,'data-companytab');
assert(!html.includes('<img'),'tab IDs and labels must be escaped');
assert(html.includes('&lt;img')&&html.includes('&quot;'),'encoder must remain active');
console.log(JSON.stringify({result:'passed',registeredAttributes:allowed.length,observedConsumers:used,restrictedFallback:true,escapedLabelsAndIds:true}));

// Catalogue entries are definitions, not funded operating companies. Rendering
// them must not enter finance or create a registry/book merely to show a card.
{
 const start=source.indexOf('  function renderCompanies('),end=source.indexOf('  function renderLeadershipHub(',start);
 assert(start>=0&&end>start);
 let instances=[],calls=[];
 const render=vm.runInNewContext(source.slice(start,end)+'\nrenderCompanies',{
  companyInstances:()=>instances,identityName:(_s,id)=>id,assetOwnerCompanyId:a=>a.ownerCompanyId,
  tabs,metrics:rows=>JSON.stringify(rows),text:value=>String(value??''),findPhoto:()=>'',
  nextStepButton:()=>'',platform:()=>null
 });
 const state={hired:[],crew:[],assets:[],cash:90000000,companyRegistry:{},openedCompanies:[],companyFinance:{group:{balance:90000000}}};
 const ctx={state,fmtMoney:n=>String(n),companyPerformance:(id,days)=>{calls.push({id,days});if(!state.openedCompanies.includes(id))throw new Error('unfunded-finance-read:'+id);return {currentNet:17,lastDayNet:8};}};
 const definition={capabilities:['finance.book'],classification:{primarySectorId:'test-sector'},identity:{trade:{ar:'اختبار'}},founding:{defaultCapital:10000000}};
 instances=['air','air-two','future-hotel'].map(id=>({id,definition,opened:false,operational:false}));
 const before=JSON.stringify(state),pending=render('subs',ctx);
 assert.deepEqual(calls,[],'unfounded company cards must not request any financial performance');
 assert.equal(JSON.stringify(state),before,'catalogue rendering must not create a company, account, asset or funding');
 for(const instance of instances)assert(pending.includes(`data-type="${instance.id}"`),'definition must keep its actual founding entry');
 state.openedCompanies.push('air-two');state.companyRegistry['air-two']={taxId:'test'};
 instances[1]={...instances[1],opened:true,operational:true};
 const openedBefore=JSON.stringify(state);render('subs',ctx);
 assert.deepEqual(calls,[{id:'air-two',days:30}],'only the opened operating owner may read its own finance');
 assert.equal(JSON.stringify(state),openedBefore);
 calls=[];instances[1]={...instances[1],operational:false};render('subs',ctx);assert.deepEqual(calls,[],'compatibility-held owners must not enter operational finance');
 calls=[];instances[1]={...instances[1],operational:true,definition:{...definition,capabilities:[]}};render('subs',ctx);assert.deepEqual(calls,[],'financial reads require the centrally declared finance.book capability');
 console.log('PASS subsidiaries catalogue: no unfunded finance reads or phantom ownership; owner and capability boundaries retained');
}
