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
  const host=PROTOCOL.createHost(GH_KERNEL),worker=new LoopbackWorker(host),client=PROTOCOL.createClient(worker,{timeoutMs:8000});
  const initialized=await client.initialize(state,contracts);assert.equal(initialized.schemaVersion,'2.0.0');assert.deepEqual(initialized.sections.map(row=>row.name),['assets','eventLog']);assert.equal(initialized.sections[0].value,undefined,'worker init acknowledgement never serializes 20,000 asset DTOs back to the UI');
  assert.equal(host.metrics().typedArrayBytes,760000,'20,000-asset Float64Array/F64 plus enum columns use bounded raw column buffers');
  assert.ok(host.metrics().baseStorageBytes<1024,'registered asset rows must not remain duplicated in the kernel base snapshot');
  const command={owner:'simulation-asset',writes:['assets'],reads:{assets:0},idempotencyKey:'SIM-SLICE-1',operations:[{type:'row-patch',section:'assets',index:12,value:{progress:.5,phase:'turnaround',lastTrip:{revenue:100}}}]};
  const first=await client.command(command);assert.equal(first.committed,true);assert.equal(first.sectionRevisions.assets,1);
  const patched=host.legacyState().assets[12];assert.equal(patched.progress,.5);assert.equal(patched.phase,'turnaround');assert.deepEqual(patched.lastTrip,{revenue:100});assert.equal(patched.name,'asset-12','worker patch preserves non-hot legacy asset fields');
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
  const bulkStarted=performance.now(),bulkOperations=Array.from({length:1000},(_,index)=>({type:'row-patch',section:'assets',index:index*19,value:{progress:(index%10)/10,fuel:80+index%20,lastTrip:{sequence:index}}}));
  const bulk=await client.command({owner:'simulation-asset',writes:['assets'],reads:{assets:1},idempotencyKey:'SIM-SLICE-BULK',operations:bulkOperations});
  assert.equal(bulk.sectionRevisions.assets,2);assert.equal(bulk.undoRecords,3000);
  assert.deepEqual(host.legacyState().assets[19].lastTrip,{sequence:1});
  assert.ok(performance.now()-bulkStarted<8000,'1,000 row patches against 20,000 assets must avoid rematerializing every row per patch');
  const rawCommand={protocol:PROTOCOL.PROTOCOL,requestId:'RAW-RETRY-1',type:'command',owner:'simulation-asset',writes:['assets'],reads:{assets:2},idempotencyKey:'SIM-RAW-RETRY',operations:[{type:'column-set',section:'assets',column:'progress',index:42,value:.7}]};
  const rawFirst=host.handle(rawCommand);assert.equal(rawFirst.message.ok,true);assert.equal(rawFirst.message.sectionRevisions.assets,3);
  assert.deepEqual(host.handle(rawCommand).message,rawFirst.message,'identical request ID and payload replay the same acknowledgement');
  const rawConflict=host.handle({...rawCommand,operations:[{type:'column-set',section:'assets',column:'progress',index:42,value:.9}]});
  assert.equal(rawConflict.message.ok,false);assert.match(rawConflict.message.error,/request-id-conflict/);
  assert.equal(host.snapshot().sections.assets.revision,3,'conflicting request ID cannot commit another write');
  assert.equal(host.legacyState().assets[42].progress,.7);
  client.close();
  const replayHost=PROTOCOL.createHost(GH_KERNEL);
  const init=replayHost.handle({protocol:PROTOCOL.PROTOCOL,requestId:'REPLAY-INIT',type:'init',state:{saveVersion:'2.0.0',counter:0},contracts:[{name:'counter',path:'counter',owner:'player',kind:'object'}]});
  assert.equal(init.message.ok,true);
  let oldest=null;
  for(let index=0;index<520;index++){
    const row={protocol:PROTOCOL.PROTOCOL,requestId:`REPLAY-${index}`,type:'command',owner:'player',writes:['counter'],reads:{counter:index},idempotencyKey:`COUNTER-${index}`,operations:[{type:'set',section:'counter',value:index+1}]};
    if(index===0)oldest=row;
    const ack=replayHost.handle(row);assert.equal(ack.message.ok,true,`command ${index} committed`);
  }
  assert.equal(replayHost.snapshot().sections.counter.revision,520);
  assert.equal(replayHost.handle(oldest).message.idempotent,true,'a delayed command remains idempotent after 512 later acknowledgements');
  assert.equal(replayHost.handle({...oldest,requestId:'REPLAY-OLD-KEY'}).message.idempotent,true,'idempotency key survives reply cache eviction');
  const reusedId=replayHost.handle({...oldest,idempotencyKey:'ANOTHER-KEY',reads:{counter:520},operations:[{type:'set',section:'counter',value:999}]});
  assert.equal(reusedId.message.ok,false);assert.match(reusedId.message.error,/request-id-conflict/);
  assert.equal(replayHost.snapshot().sections.counter.revision,520,'no delayed retry or changed request ID can apply twice');
  assert.equal(replayHost.legacyState().counter,520);
  console.log('Build342 kernel worker: worker-owned typed state, 1,000 row patches across 20,000 assets, stale replay after 512 acknowledgements, bounded query and transferable frame buffers PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
