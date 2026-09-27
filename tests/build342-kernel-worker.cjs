'use strict';
const assert=require('node:assert/strict');
const GH_KERNEL=require('../WebApp/kernel-core.js');
const PROTOCOL=require('../WebApp/kernel-worker-core.js');

class LoopbackWorker{
  constructor(host){this.host=host;this.listeners=new Set();}
  addEventListener(name,fn){if(name==='message')this.listeners.add(fn);}
  removeEventListener(name,fn){if(name==='message')this.listeners.delete(fn);}
  postMessage(message){const delay=message.type==='frame'&&message.generation===1?15:0;setTimeout(()=>{const result=this.host.handle(message);for(const listener of this.listeners)listener({data:result.message});},delay);}
}

(async()=>{
  const state={saveVersion:'2.0.0',saveRevision:0,assets:Array.from({length:20000},(_,index)=>({id:`A-${index}`,lat:index%180-90,lng:index%360-180,progress:0,fuel:100,phase:'moving',name:`asset-${index}`})),eventLog:[]};
  const contracts=[
    {name:'assets',path:'assets',owner:'simulation-asset',kind:'columns',columns:{lat:'f64',lng:'f64',progress:'f64',fuel:'f64',phase:'u8'},enumValues:{phase:['idle','moving','turnaround']}},
    {name:'eventLog',path:'eventLog',owner:'operations',kind:'append-only',cap:400,legacyOrder:'newest-first'}
  ];
  const host=PROTOCOL.createHost(GH_KERNEL),worker=new LoopbackWorker(host),client=PROTOCOL.createClient(worker,{timeoutMs:1000});
  const initialized=await client.initialize(state,contracts);assert.equal(initialized.schemaVersion,'2.0.0');assert.deepEqual(initialized.sections.map(row=>row.name),['assets','eventLog']);assert.equal(initialized.sections[0].value,undefined,'worker init acknowledgement never serializes 20,000 asset DTOs back to the UI');
  assert.equal(host.metrics().typedArrayBytes,760000,'20,000-asset Float64Array/F64 plus enum columns use bounded raw column buffers');
  const command={owner:'simulation-asset',writes:['assets'],reads:{assets:0},idempotencyKey:'SIM-SLICE-1',operations:[{type:'column-set',section:'assets',column:'progress',index:12,value:.5}]};
  const first=await client.command(command);assert.equal(first.committed,true);assert.equal(first.sectionRevisions.assets,1);
  const duplicate=await client.command(command);assert.equal(duplicate.idempotent,true);assert.equal(host.snapshot().sections.assets.revision,1,'worker retry is idempotent');
  await assert.rejects(()=>client.command({...command,operations:[{type:'column-set',section:'assets',column:'progress',index:12,value:.6}]}),/idempotency-conflict/);
  await assert.rejects(()=>client.command({...command,idempotencyKey:'SIM-SLICE-2'}),/revision-conflict/);
  const query=await client.query({section:'assets'});assert.equal(query.revision,1);assert.equal(typeof query.fingerprint,'string');
  const frame=await client.frame({generation:2,section:'assets',viewport:{south:0,north:10,west:-90,east:-80}});
  assert.equal(frame.generation,2);assert.ok(frame.indices instanceof Uint32Array);assert.ok(frame.coordinates instanceof Float64Array);assert.ok(frame.indices.length>0);assert.equal(frame.coordinates.length,frame.indices.length*2);
  const allAssets=await client.frame({generation:3,section:'assets',viewport:{south:-90,north:90,west:-180,east:180}});assert.equal(allAssets.indices.length,20000);assert.ok(allAssets.indices.byteLength+allAssets.coordinates.byteLength<500000,'UI receives compact transferable visible buffers instead of asset objects');
  const stale=client.frame({generation:1,section:'assets',viewport:{south:-90,north:90,west:-180,east:180}});
  const fresh=client.frame({generation:4,section:'assets',viewport:{south:-90,north:90,west:-180,east:180}});
  await assert.rejects(()=>stale,/stale-frame/);assert.equal((await fresh).generation,4);
  client.close();
  console.log('Build342 kernel worker: worker-owned typed state, revision conflict, command idempotency, bounded query and transferable frame buffers PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
