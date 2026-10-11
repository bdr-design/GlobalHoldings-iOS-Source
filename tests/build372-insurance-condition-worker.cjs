'use strict';
// Build 372: the daily close's insurance stage reads the insured fleet's condition total. The day's maintenance and
// incidents rewrite conditions after the fleet pass, so its memo no longer holds and the stage read every row on the
// main thread (169 ms at a million assets). A staged close now asks the fleet engine's worker
// (GH_FLEET_QUERY_PROVIDER, fleet-query-core conditionSum) and waits for it one stage at a time ('realism.insurance-wait').
// This gate runs the real daily close (business scenario, maintenance due) and holds:
//   - staged, with a provider answering the store's own total after a few waits: the insurance results equal the plain
//     close's exactly, the stage waited, and the provider was asked once;
//   - the provider's total is what the stage uses (a different total that claims to be current changes the results);
//   - a total that no longer describes the store (current() false), or no answer (null), is not used: the results equal
//     the plain close's;
//   - outside a staged transaction the provider is not asked.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const QUERY_SOURCE=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR,'WebApp','fleet-query-core.js'),'utf8');

const DAY=86400;
function setup(){
  const sc=scenario(),{s,state,ctx,item}=sc,FLEET=s.GH_FLEET_DATA;
  // The worker's pass (fleet-query-core), loaded beside the scenario's owners.
  if(!s.GH_FLEET_QUERY)vm.runInContext(QUERY_SOURCE,s,{filename:'fleet-query-core.js'});
  state.globalBases.find(row=>row.id==='B1').deliveryCapacity=100;s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=1e12;
  const out=s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',{type:'air',assetMode:'air',assetClass:'aircraft',tab:'new',item,base:state.globalBases.find(row=>row.id==='B1'),supplier:ctx.supplierFor(),mode:'cash',qty:12,manual:true,requestRef:'INS-QA',upfront:item.price*12,totalPrice:item.price*12,documentLeadDays:1,leadSeconds:0,immediateDelivery:true},{actor:'insurance-qa',idempotencyKey:'INS-QA-1'});
  assert.ok(out.ok,JSON.stringify(out).slice(0,200));s.GH_REALISM.onSimulationTime(state,state.simSeconds);
  // The game's fleet is a store (the scenario starts with an asset list).
  state.fleet=s.GH_FLEET_STORE.fromAssets(state.assets,{at:state.simSeconds});delete state.assets;assert.ok(s.GH_FLEET_STORE.isStore(state.fleet),'a fleet store');
  const ids=[];FLEET.scan(state,['id'],row=>{ids.push(row.id);});
  // Below the standard policy's line, so the close's maintenance restores them after its fleet pass.
  ids.forEach((id,k)=>FLEET.update(state,id,{condition:k<5?60+k:k===5?0:91.5+k/7}));
  const day=Math.floor(state.simSeconds/DAY)+1;state.simSeconds=day*DAY;
  return {...sc,day,FLEET};
}
const insuranceOf=state=>JSON.stringify({claimsTrend:state.realism.insurance.claimsTrend,renewalIndex:state.realism.insurance.renewalIndex});

// The plain close (no provider, not staged).
const plain=(()=>{const {s,state,day}=setup();let asked=0;s.GH_FLEET_QUERY_PROVIDER=()=>{asked++;return null;};s.GH_REALISM.onDay(state,day);return {insurance:insuranceOf(state),asked};})();
assert.equal(plain.asked,0,'not asked outside a staged transaction');

// A staged close whose provider answers after `after` calls of step(): {result,current} built by `answer`.
async function staged(answer,after=3){
  const {s,state,day,FLEET}=setup(),TX=s.GH_TRANSACTION_CORE;let asked=0,resolveAnswer=null;
  s.GH_FLEET_QUERY_PROVIDER=(st,name,params)=>{
    asked++;assert.equal(name,'conditionSum');
    const result=s.GH_FLEET_QUERY.run(name,st,FLEET,params),revision=st.fleet.revision;
    return new Promise(resolve=>{resolveAnswer=()=>resolve(answer({result,fresh:()=>st.fleet.revision===revision}));});
  };
  const handle=TX.beginStaged(state,{label:'qa-insurance-day',apply:function*(){return yield* s.GH_REALISM.onDayStages(state,day);}});
  const stages=[];
  for(let call=0;call<5000&&!handle.done;call++){
    if(resolveAnswer&&stages.filter(stage=>stage==='realism.insurance-wait').length>=after){resolveAnswer();resolveAnswer=null;}
    handle.step((globalThis.performance?.now?.()??Date.now())+30);stages.push(handle.stage);
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(handle.done,true);assert.equal(handle.error,null,String(handle.error?.stack||handle.error));assert.equal(handle.result.committed,true);
  return {insurance:insuranceOf(state),asked,waits:stages.filter(stage=>stage==='realism.insurance-wait').length};
}

(async()=>{
  const used=await staged(({result,fresh})=>({result,current:fresh}));
  assert.equal(used.asked,1,'the staged close asked the worker once');assert.ok(used.waits>=3,`waited ${used.waits}`);
  assert.equal(used.insurance,plain.insurance,'the worker total gives the plain close\'s insurance results');

  const planted=await staged(({result})=>({result:{...result,sum:result.sum*0.5},current:()=>true}));
  assert.notEqual(planted.insurance,plain.insurance,'the stage uses the provider\'s total');

  const stale=await staged(({result})=>({result:{...result,sum:result.sum*0.5},current:()=>false}));
  assert.equal(stale.insurance,plain.insurance,'a total that no longer describes the store is not used');

  const none=await staged(()=>null,1);
  assert.equal(none.insurance,plain.insurance,'without an answer the stage reads the store itself');

  console.log(JSON.stringify({ok:true,insurance:JSON.parse(plain.insurance),waits:used.waits}));
})().catch(error=>{console.error(error);process.exitCode=1;});
