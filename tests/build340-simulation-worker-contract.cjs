'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Core=require('../WebApp/simulation-asset-core.js');

async function run(){
  const outputs=[],listeners={},scope={GH_SIMULATION_ASSET_CORE:Core,addEventListener:(name,callback)=>{listeners[name]=callback;},postMessage:message=>outputs.push(message)};scope.self=scope;
  const source=fs.readFileSync(path.join(__dirname,'../WebApp/simulation-asset-worker.js'),'utf8');
  vm.runInNewContext(source,{self:scope,importScripts:()=>{},setTimeout,Map,Error,String,Number,Array,Math,Object,JSON});
  const row={id:'A-WORKER',asset:{id:'A-WORKER',type:'air',assetMode:'air',ownerCompanyId:'air',phase:'idle',routeId:null,progress:0,fuel:100,condition:100,specs:{capacity:1}},route:null,catalogSpecs:null,departureDelay:0};
  const request=requestId=>({type:'process',requestId,rows:[row],context:{companies:{},research:{},sustainability:{},economy:{},market:{},reputation:{},ownedFacilities:[],simSeconds:0},simAdvance:30,simMeta:{from:0,to:30}});
  listeners.message({data:request(1)});await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(outputs.length,1);assert.equal(outputs[0].type,'result');assert.equal(outputs[0].requestId,1);assert.equal(outputs[0].coreVersion,Core.VERSION);assert.equal(outputs[0].records[0].id,row.id);assert(Core.validateResults([row],outputs[0].records));
  listeners.message({data:request(2)});listeners.message({data:{type:'cancel',requestId:2}});await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(outputs.length,1,'cancelled worker work returns no stale plan');
  listeners.message({data:{...request(3),rows:[]}});await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(outputs.at(-1).type,'error');assert.equal(outputs.at(-1).requestId,3,'invalid plans are correlated to the rejected request');
  console.log('PASS worker message contract, bounded result validation, cancellation, stale suppression and invalid input rejection');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
