'use strict';

const assert=require('node:assert/strict');
require('../WebApp/route-core.js');
require('../WebApp/road-planner.js');
const workerCore=require('../WebApp/road-planner-worker-core.js');

function fixtures(count){
  const origin={id:'BASE-1',company:'road',coords:[24.7,46.7],city:'الرياض',country:'السعودية'},route={id:'ROUTE-1',type:'road',routeMode:'road',ownerCompanyId:'road',fromFacility:origin.id,toFacility:'BASE-2',route:[[24.7,46.7],[25.1,47.2]],distanceKm:66};
  const assets=Array.from({length:count},(_,index)=>({id:`truck-${String(index).padStart(6,'0')}`,name:`truck-${index}`,type:'road',assetMode:'road',ownerCompanyId:'road',baseFacility:'BASE-1',specs:{rangeKm:700+(index%5)},staffing:{mode:'automatic-fixed',ready:true}}));
  return {origin,route,assets};
}

async function compareAtScale(count){
  const {origin,route,assets}=fixtures(count),input={assets,routes:[route],origins:assets.map(()=>origin),assetOwners:assets.map(()=> 'road'),routeOwners:['road'],facilities:[{id:'BASE-1'},{id:'BASE-2'}],initialLoads:{},routeCount:1,seed:7,targetRouteLoad:count+1,routeCapacity:count+1,yieldEvery:512,intervalMs:0};
  const provider={roadBatch:async()=>{throw new Error('existing route must avoid external routing');}},options={provider,yieldControl:async()=>{}};
  const workerResult=await workerCore.plan(input,options);
  const mainResult=await globalThis.GH_ROAD_PLANNER.plan({assets,routes:[route],originFor:()=>origin,usable:()=>true,provider,routeCount:1,seed:7,targetRouteLoad:count+1,routeCapacity:()=>count+1,initialLoad:()=>0,yieldEvery:512,intervalMs:0,yieldControl:async()=>{}});
  assert.deepEqual(workerResult,mainResult,`worker route plan retains exact ordered assignment semantics at ${count} assets`);
  assert.equal(workerResult.length,count);assert.ok(workerResult.every(row=>row.route.id==='ROUTE-1'&&!row.created));
}

async function testValidationAndCancellation(){
  assert.throws(()=>workerCore.validate({assets:[],routes:[],origins:[{}],facilities:[]}),/road-worker-input-invalid/);
  const {origin,route,assets}=fixtures(256),controller=new AbortController(),input={assets,routes:[route],origins:assets.map(()=>origin),assetOwners:assets.map(()=> 'road'),routeOwners:['road'],facilities:[{id:'BASE-1'},{id:'BASE-2'}],initialLoads:{},routeCount:1,seed:1,targetRouteLoad:300,routeCapacity:300,yieldEvery:16,intervalMs:0};let yields=0;
  await assert.rejects(workerCore.plan(input,{provider:{roadBatch:async()=>{throw new Error('unexpected network call');}},signal:controller.signal,yieldControl:async()=>{if(++yields===2)controller.abort();}}),/أُلغي حساب المسارات/);
  assert.equal(yields,2);
}

function testIntegration(){
  const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..'),app=fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8'),worker=fs.readFileSync(path.join(root,'WebApp/road-planner-worker.js'),'utf8'),runtime=JSON.parse(fs.readFileSync(path.join(root,'WebApp/runtime-required.json'),'utf8'));
  assert.match(app,/new Worker\('road-planner-worker\.js'\)/);assert.match(app,/GH_ROAD_PLANNER\.plan\(/,'cooperative main-thread fallback remains wired');
  assert.match(worker,/GH_ROAD_PLANNER_WORKER_CORE\.plan/);for(const file of ['road-planner-worker.js','road-planner-worker-core.js'])assert.ok(runtime.files.includes(file),`${file} is required by the iOS package`);
}

(async()=>{await compareAtScale(4300);await compareAtScale(20000);await testValidationAndCancellation();testIntegration();console.log('Build 340 route worker: exact 4.3k/20k assignment parity, worker validation, cancellation, CSP-compatible runtime wiring and cooperative fallback PASS');})().catch(error=>{console.error(error);process.exitCode=1;});
