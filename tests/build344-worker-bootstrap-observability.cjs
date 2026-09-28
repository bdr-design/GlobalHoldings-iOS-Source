'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {scenario}=require('./helpers/business-scenario');
const Core=require('../WebApp/simulation-asset-core.js');

const app=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8');
const first=app.indexOf('  const SIMULATION_ASSET_ENGINE='),last=app.indexOf('  function makeSimulationEffects(){',first);
assert(first>=0&&last>first,'Worker bootstrap fragment must exist');

function setup(){
  const e=scenario(),s=e.s;e.load('kernel-core');
  const owner=s.GH_TRANSACTION_CORE.enableKernelOwner(e.state);
  s.state=owner;s.window=s;s.GH_SIMULATION_ASSET_CORE=Core;
  s.clone=value=>JSON.parse(JSON.stringify(value));
  const assets=Array.from({length:512},(_,i)=>({id:`BOOT-${i}`,phase:'idle',progress:0,fuel:100,condition:100}));
  owner.assets=assets;
  const messages=[];
  s.Worker=class{
    postMessage(message){
      messages.push(message);
      if(message.type==='init-end')setTimeout(()=>this.onmessage?.({data:{type:'initialized',version:'GH-SIMULATION-ASSET-WORKER-340.1.0',assets:message.assetCount,typedArrayBytes:message.assetCount*8,fingerprint:'test-worker'}}),0);
    }
    terminate(){}
  };
  vm.runInContext(app.slice(first,last),s,{filename:'app-worker-bootstrap.js'});
  return {s,owner,messages};
}

async function waitFor(predicate){
  for(let attempt=0;attempt<200;attempt++){
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,2));
  }
  throw new Error('Worker bootstrap did not reach the expected phase');
}

async function run(){
  {
    const {s,owner,messages}=setup(),tx=s.GH_TRANSACTION_CORE;
    s.ensureSimulationAssetWorker();
    await waitFor(()=>messages.some(message=>message.type==='init-chunk'));
    const before={revision:tx.revision(owner),input:tx.inputRevision(owner)};
    owner.saveRevision=(Number(owner.saveRevision)||0)+1;
    assert.equal(tx.revision(owner),before.revision+1,'ordinary save advances the total revision');
    assert.equal(tx.inputRevision(owner),before.input,'saveRevision does not change simulation input');
    await waitFor(()=>messages.some(message=>message.type==='init-end'));
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(messages.filter(message=>message.type==='init-start').length,1,'an ordinary save cannot restart an otherwise valid Worker seed');
    assert.equal(messages.filter(message=>message.type==='init-chunk').length,4,'each of 512 assets is seeded exactly once in bounded chunks');
    console.log('PASS saveRevision-only activity does not restart an in-progress Worker bootstrap');
  }
  {
    const {s,owner,messages}=setup(),tx=s.GH_TRANSACTION_CORE;
    s.ensureSimulationAssetWorker();
    await waitFor(()=>messages.some(message=>message.type==='init-chunk'));
    const before=tx.inputRevision(owner);
    owner.assets[0].progress=.25;
    assert(tx.inputRevision(owner)>before,'a real asset change advances simulation input revision');
    await waitFor(()=>messages.filter(message=>message.type==='init-start').length>=2);
    await waitFor(()=>messages.some(message=>message.type==='init-end'));
    assert(messages.filter(message=>message.type==='init-start').length>=2,'a gameplay input change restarts the Worker seed');
    console.log('PASS gameplay asset changes still restart an in-progress Worker bootstrap');
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
