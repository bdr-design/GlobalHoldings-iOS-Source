'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Core=require('../WebApp/simulation-asset-core.js');
const Kernel=require('../WebApp/kernel-core.js');

async function run(){
  const outputs=[],listeners={},scope={GH_SIMULATION_ASSET_CORE:Core,GH_KERNEL:Kernel,addEventListener:(name,callback)=>{listeners[name]=callback;},postMessage:message=>outputs.push(message)};scope.self=scope;
  const source=fs.readFileSync(path.join(__dirname,'../WebApp/simulation-asset-worker.js'),'utf8');
  vm.runInNewContext(source,{self:scope,importScripts:()=>{},setTimeout,Map,Error,String,Number,Array,Math,Object,JSON});
  const assetCount=3380,row={id:'A-WORKER-12',assetIndex:12,asset:{id:'A-WORKER-12',type:'air',assetMode:'air',ownerCompanyId:'air',phase:'idle',routeId:null,progress:0,fuel:100,condition:100,specs:{capacity:1}},route:null,catalogSpecs:null,departureDelay:0};
  const assets=Array.from({length:assetCount},(_,index)=>index===12?row.asset:{id:`A-WORKER-${index}`,type:'air',assetMode:'air',ownerCompanyId:'air',phase:'idle',routeId:null,progress:0,fuel:100,condition:100,name:`asset-${index}`});
  const request=requestId=>({type:'process',requestId,assetCount,rows:[row],context:{companies:{},research:{},sustainability:{},economy:{},market:{},reputation:{},ownedFacilities:[],simSeconds:0},simAdvance:30,simMeta:{from:0,to:30}});
  listeners.message({data:{type:'init',requestId:0,assets}});assert.equal(outputs[0].type,'initialized');assert.equal(outputs[0].assets,3380);assert.equal(outputs[0].typedArrayBytes,3380*9*9,'all 3,380 live assets initialize nine hot numeric fields in Float64Array columns plus presence bytes');const initialFingerprint=outputs[0].fingerprint;
  listeners.message({data:request(1)});await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(outputs.length,2);assert.equal(outputs[1].type,'result');assert.equal(outputs[1].requestId,1);assert.equal(outputs[1].coreVersion,Core.VERSION);assert.equal(outputs[1].records[0].id,row.id);assert(Core.validateResults([row],outputs[1].records));assert.equal(JSON.stringify(outputs[1].records),JSON.stringify(Core.processBatch(request(1))),'published patches are read back from the committed typed kernel');assert.equal(outputs[1].kernelState.revision,1);assert.equal(typeof outputs[1].kernelState.fingerprint,'string');assert.equal(outputs[1].kernelState.undoRecords,undefined,'internal rollback closures stay in the worker');
  assert.notEqual(outputs[1].kernelState.fingerprint,initialFingerprint,'the Worker kernel commits the live simulation patch into its typed state');
  listeners.message({data:{type:'rollback',requestId:10,requestIds:[1]}});assert.equal(outputs.at(-1).type,'settled');assert.equal(outputs.at(-1).kernelState.fingerprint,initialFingerprint,'failed outer publication can restore the Worker state exactly');assert.equal(outputs.at(-1).pendingTransactions,0);
  listeners.message({data:request(2)});listeners.message({data:{type:'cancel',requestId:2}});await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(outputs.length,3,'cancelled worker work returns no stale plan');
  listeners.message({data:{...request(3),rows:[]}});await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(outputs.at(-1).type,'error');assert.equal(outputs.at(-1).requestId,3,'invalid plans are correlated to the rejected request');
  const movedA=assets[13],movedB=assets[12],swappedRows=[{id:movedA.id,assetIndex:12,asset:movedA,route:null,catalogSpecs:null,departureDelay:0},{id:movedB.id,assetIndex:13,asset:movedB,route:null,catalogSpecs:null,departureDelay:0}];
  listeners.message({data:{...request(4),rows:swappedRows}});await new Promise(resolve=>setTimeout(resolve,15));assert.equal(outputs.at(-1).type,'result','same-count array reordering resynchronizes the worker kernel by current app row');assert.equal(JSON.stringify(outputs.at(-1).records.map(record=>record.id)),JSON.stringify(swappedRows.map(row=>row.id)));
  listeners.message({data:{type:'rollback',requestId:11,requestIds:[4]}});assert.equal(outputs.at(-1).type,'settled');assert.equal(outputs.at(-1).pendingTransactions,0);
  const streamed=Array.from({length:8},(_,index)=>({id:`STREAM-${index}`,progress:index/10,fuel:100,condition:100}));listeners.message({data:{type:'init-start',requestId:20,assetCount:streamed.length}});listeners.message({data:{type:'init-chunk',requestId:20,offset:0,assets:streamed.slice(0,3)}});listeners.message({data:{type:'init-chunk',requestId:20,offset:3,assets:streamed.slice(3)}});listeners.message({data:{type:'init-end',requestId:20,assetCount:streamed.length}});assert.equal(outputs.at(-1).type,'initialized');assert.equal(outputs.at(-1).assets,8,'streamed bootstrap assembles the complete bounded asset set before publishing the kernel');
  listeners.message({data:{type:'init-start',requestId:21,assetCount:2}});listeners.message({data:{type:'init-chunk',requestId:21,offset:1,assets:[{id:'BAD'}]}});assert.equal(outputs.at(-1).type,'error','out-of-order bootstrap chunks fail closed');
  console.log('PASS worker message contract, bounded result validation, cancellation, stale suppression and invalid input rejection');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
