'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
require(root+'/WebApp/control-plane-core.js');
require(root+'/WebApp/capability-registry-core.js');
require(root+'/WebApp/company-definitions.js');
require(root+'/WebApp/company-platform-core.js');
const Formation=require(root+'/WebApp/formation-engine.js');

function input(overrides={}){return {entityKind:'company',companyId:'air',founder:'المؤسس',location:{id:'ruh',city:'الرياض',country:'السعودية',coords:[24.7136,46.6753]},signatureRef:'SIG-FOUNDER-7',signatureVersion:7,createdAt:1234,...overrides};}
function atomicHarness(state,{save}={}){return {applyEffect:async effect=>{state.company={id:effect.payload.companyId,capital:effect.payload.capital.amount};return {ok:true,effect:effect.type};},durableSave:save|| (async()=>({ok:true,ack:true,generation:2})),runAtomic:async operation=>{const before=structuredClone(state);try{return {committed:true,value:await operation.apply()};}catch(error){for(const key of Object.keys(state))delete state[key];Object.assign(state,before);throw error;}}};}

(async()=>{
 const source=input(),before=structuredClone(source),plan=Formation.prepare(source);assert.deepEqual(source,before,'prepare must be pure');assert.equal(plan.companyId,'air');assert.equal(plan.definitionId,'gh-air-v1');assert.deepEqual(plan.signature,{signatureRef:'SIG-FOUNDER-7',version:7});assert.equal('signerName' in plan.signature,false);assert.deepEqual(plan.openingAssets,[]);assert.deepEqual(plan.openingFacilities,[]);assert.deepEqual(plan.openingRoutes,[]);assert(Object.isFrozen(plan));
 assert.throws(()=>Formation.prepare(input({companyId:'future-unknown'})),/formation-company-unknown/);
 const tampered=structuredClone(plan);tampered.capital.amount+=1;assert.throws(()=>Formation.validatePlan(tampered),/formation-plan-hash-mismatch/);
 const entitled=structuredClone(plan);entitled.openingAssets.push({id:'FREE'});entitled.planHash=Formation.hash((({planHash:_,planId:__,...row})=>row)(entitled));assert.throws(()=>Formation.validatePlan(entitled),/formation-opening-entitlements-forbidden/);

 const state={balance:100},success=await Formation.commit(plan,{hooks:atomicHarness(state)});assert.equal(success.ok,true);assert.equal(state.company.id,'air');assert.equal(success.saved.ack,true);

 const nackState={balance:100},nackBefore=structuredClone(nackState);await assert.rejects(Formation.commit(plan,{hooks:atomicHarness(nackState,{save:async()=>({ok:false,ack:false})})}),/formation-durable-save-nack/);assert.deepEqual(nackState,nackBefore,'NACK must roll back every mutation');

 const timeoutState={balance:100},timeoutBefore=structuredClone(timeoutState),timeoutSave=({signal})=>new Promise((resolve,reject)=>signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));await assert.rejects(Formation.commit(plan,{timeoutMs:250,hooks:atomicHarness(timeoutState,{save:timeoutSave})}),/formation-durable-save-timeout/);assert.deepEqual(timeoutState,timeoutBefore,'timeout must roll back every mutation');

 let release,settled=false;const ack=new Promise(resolve=>{release=resolve;}),pendingState={balance:100},pending=Formation.commit(plan,{hooks:atomicHarness(pendingState,{save:()=>ack})}).then(value=>{settled=true;return value;});await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false,'commit must wait for durable ACK');release({ok:true,ack:true});await pending;assert.equal(settled,true);
 console.log(JSON.stringify({ok:true,planId:plan.planId,nackRollback:true,timeoutRollback:true,durableAckGate:true},null,2));
})().catch(error=>{console.error(error);process.exit(1);});
