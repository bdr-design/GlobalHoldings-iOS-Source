'use strict';
// Build 359 (owner: no work in a command may pass over every document or record). Each command on the draft of a player
// command (one settled payable of a bulk action, or the one command of a single action) copied the whole draft for its
// rollback and ran the integrity check (every finance row) twice; the player command itself checks integrity once
// against the live state before and once on the draft after, and drops the draft whole if anything fails. Checked here:
// - a command on the durable draft takes no copy (rollback storage 'discardable-draft') and runs no integrity check;
// - a failing command poisons the draft, so it can never be published, and its error still reaches the caller;
// - outside a player command a command still takes its snapshot and checks integrity before and after;
// - within one check a company id is resolved once; a cheque whose invoice is archived is still checked against it.
const assert=require('node:assert/strict'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,results=[];
const test=(name,fn)=>{try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error?.stack||error).slice(0,2500)});}};
state.godMoney=true;state.infiniteMoney=true;
const real=s.GH_INTEGRITY_CORE;assert.ok(real?.check,'the integrity owner is loaded');
let checks=0;s.GH_INTEGRITY_CORE={...real,check:target=>{checks++;return real.check(target);}};
const issue=(target,ref)=>s.GH_DOMAIN_COMMANDS.dispatch({...e.ctx,state:target},'finance','issue-cheque',{company:'air',amount:700,beneficiary:'Supplier LLC',note:'cost',requestRef:ref}).result;
const withDurable=(draft,fn)=>{s.__GH_DURABLE_COMMAND_CONTEXT__={name:'cost',liveState:state,draft};try{return fn(s.__GH_DURABLE_COMMAND_CONTEXT__);}finally{delete s.__GH_DURABLE_COMMAND_CONTEXT__;}};
for(let i=0;i<40;i++)issue(state,`COST-SEED-${i}`);

test('a command on the durable draft takes no copy and runs no integrity check',()=>{
  const draft=TX.deepClone(state,{shareJournaledRoots:true});checks=0;
  const out=withDurable(draft,()=>{const rows=[];for(let i=0;i<5;i++){rows.push(issue(draft,`COST-D-${i}`));assert.equal(TX.telemetry().last.rollbackStorage,'discardable-draft','no copy of the draft');}return rows;});
  assert.equal(checks,0,'no integrity check per command');assert.equal(out.length,5);assert.ok(draft.finance.cheques.some(row=>row.requestRef==='COST-D-4'));
  assert.ok(!state.finance.cheques.some(row=>row.requestRef==='COST-D-0'),'the live state is untouched');
  return {commands:5};
});

test('a failing command poisons the draft and its error reaches the caller',()=>{
  const draft=TX.deepClone(state,{shareJournaledRoots:true});
  const context=withDurable(draft,context=>{assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatch({...e.ctx,state:draft},'finance','issue-cheque',{company:'air',amount:-5,beneficiary:'Supplier LLC',note:'bad'}),/invalid-cheque-amount/);return context;});
  assert.equal(context.poisoned,true,'the draft can never be published');
  return {poisoned:context.poisoned};
});

test('outside a player command a command keeps its snapshot and its two checks',()=>{
  checks=0;issue(state,'COST-LIVE-1');
  assert.equal(TX.telemetry().last.rollbackStorage,'full-snapshot');assert.equal(checks,2,'before and after');
  return {checks};
});

test('one check resolves each company once; an archived invoice still backs its cheque',()=>{
  const platform=s.GH_COMPANY_PLATFORM;let calls=0;s.GH_COMPANY_PLATFORM={...platform,resolveCompany:(...args)=>{calls++;return platform.resolveCompany(...args);}};
  try{real.check(state);}finally{s.GH_COMPANY_PLATFORM=platform;}
  const companies=new Set([...state.finance.cheques,...state.finance.invoices].map(row=>String(row.ownerCompanyId||row.companyId||row.company||'group')));
  assert.ok(calls<=companies.size+Object.keys(state.companyFinance||{}).length*2+8,`company resolutions per check (${calls}) stay near the number of companies, not rows (${state.finance.cheques.length})`);
  // A live cheque whose invoice moved to the audit archive.
  const copy=JSON.parse(JSON.stringify(state)),invoice={number:'ARCH-INV-1',company:'air',total:700,amount:700,counterparty:'Supplier LLC',status:'شيك صادر',kind:'مصروف'};
  copy.finance.auditArchive={records:{invoices:[invoice]},digests:[]};copy.finance.payables.push({number:'ARCH-INV-1',company:'air',total:700});
  copy.finance.cheques.unshift({id:'ARCH-CHQ-1',company:'air',accountId:copy.companyFinance.air.accounts[0].id,amount:700,beneficiary:'Supplier LLC',invoiceNumber:'ARCH-INV-1',status:'صادر'});
  const ids=out=>out.issues.map(row=>row.id);assert.ok(!ids(real.check(copy)).some(id=>id.includes('ARCH-CHQ-1')),'the archived invoice backs the cheque');
  copy.finance.auditArchive.records.invoices=[{...invoice,total:701,amount:701}];assert.ok(ids(real.check(copy)).includes('FINANCE_CHEQUE_LINK_MISMATCH_ARCH-CHQ-1'),'a mismatch with the archived invoice is reported');
  return {calls};
});

s.GH_INTEGRITY_CORE=real;
const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build359-durable-command-cost',passed,total:results.length,results},null,1));
if(passed!==results.length)process.exitCode=1;else console.log('BUILD359_DURABLE_COMMAND_COST_PASS');
