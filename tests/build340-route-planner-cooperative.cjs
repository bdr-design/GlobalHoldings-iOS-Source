'use strict';

const assert=require('node:assert/strict');
require('../WebApp/route-core.js');
require('../WebApp/road-planner.js');
const planner=globalThis.GH_ROAD_PLANNER;

function fixtures(count){
  const origin={id:'BASE-1',company:'road',coords:[24.7,46.7],city:'الرياض',country:'السعودية'},route={id:'ROUTE-1',type:'road',company:'road',fromFacility:origin.id,toFacility:'BASE-2',route:[[24.7,46.7],[25.1,47.2]]};
  const assets=Array.from({length:count},(_,index)=>({id:`truck-${String(index).padStart(6,'0')}`,name:`truck-${index}`,specs:{rangeKm:700+(index%5)},staffing:{mode:'automatic-fixed',ready:true}}));return {origin,route,assets};
}

async function testBoundedPlanning(count){
  const {origin,route,assets}=fixtures(count);let yields=0;
  const result=await planner.plan({assets,routes:[route],originFor:()=>origin,usable:()=>true,routeCount:1,routeCapacity:()=>count+1,targetRouteLoad:count+1,initialLoad:()=>0,yieldEvery:32,yieldControl:async()=>{yields++;},intervalMs:0});
  assert.equal(result.length,count,`all ${count} assets are assigned by the route planner`);assert.ok(yields>=Math.floor((count-1)/32),`planner yields while traversing ${count} assets`);assert.ok(result.every(row=>row.created===false&&row.route.id===route.id),'existing route assignment semantics are unchanged');
}

async function testCancellationBetweenChunks(){
  const {origin,route,assets}=fixtures(256),controller=new AbortController();let yields=0;
  await assert.rejects(planner.plan({assets,routes:[route],originFor:()=>origin,usable:()=>true,routeCount:1,routeCapacity:()=>1000,targetRouteLoad:1000,signal:controller.signal,yieldEvery:16,yieldControl:async()=>{if(++yields===2)controller.abort();},intervalMs:0}),/أُلغي حساب المسارات/);
  assert.equal(yields,2,'route planning observes cancellation at a cooperative boundary');
}

(async()=>{await testBoundedPlanning(4300);await testBoundedPlanning(20000);await testCancellationBetweenChunks();console.log('Build 340 route engine: cooperative 4.3k/20k assignment, exact existing-route semantics and cancellation boundaries PASS');})().catch(error=>{console.error(error);process.exitCode=1;});
