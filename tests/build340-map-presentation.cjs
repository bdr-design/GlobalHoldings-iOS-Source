'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../WebApp/map-presentation-core.js');

function makeInput(count,zoom=5,limit=48){
  const assetIds=[],owners=[],modes=[],routeKeys=[],routes=[[[12,179.4],[18,-179.8],[25,-170]],[[30,-120],[33,-80],[42,-15]],[[5,35],[-2,80],[-12,125]],[[55,10],[45,80],[35,150]]],routeIndexes=new Int32Array(count),progress=new Float32Array(count),baseCoordinates=new Float32Array(count*2);
  for(let i=0;i<count;i++){
    assetIds.push(`asset-${String(i).padStart(6,'0')}`);owners.push(i%37===0?'':`company-${i%6}`);modes.push(['air','sea','road'][i%3]);routeKeys.push(`route-${i%4}`);routeIndexes[i]=i%4;progress[i]=((i*7919)%10000)/10000;baseCoordinates[i*2]=NaN;baseCoordinates[i*2+1]=NaN;
  }
  return {key:`test:${count}:${zoom}:${limit}`,assetIds,owners,modes,routeKeys,routeIndexes,progress,baseCoordinates,routes,zoom,limit,groupLimit:limit,selectedId:count?assetIds[Math.floor(count*.61)]:''};
}

function referenceHeroIndices(input){
  const reps=new Map();for(let i=0;i<input.assetIds.length;i++){const owner=input.owners[i],key=`${owner}:${input.routeKeys[i]}`;if(input.assetIds[i]===input.selectedId||!reps.has(key))reps.set(key,i);}
  const values=[...reps.values()],pinned=values.find(i=>input.assetIds[i]===input.selectedId),queues=new Map();
  for(const index of values){if(input.assetIds[index]===input.selectedId)continue;const key=input.owners[index]||`unknown:${input.modes[index]}`,queue=queues.get(key)||[];queue.push(index);queues.set(key,queue);}
  const ordered=[...queues].sort((a,b)=>a[0].localeCompare(b[0])).map(([,rows])=>rows.sort((a,b)=>input.assetIds[a].localeCompare(input.assetIds[b]))),picked=pinned===undefined?[]:[pinned];let cursor=0;
  while(picked.length<input.limit&&ordered.some(queue=>queue.length)){const queue=ordered[cursor%ordered.length];if(queue.length)picked.push(queue.shift());cursor++;}
  return picked;
}

function referencePlan(input){
  const heroes=referenceHeroIndices(input),heroSet=new Set(heroes),position=index=>core.interpolateRoute(input.routes[input.routeIndexes[index]],input.progress[index]);
  let cell=input.zoom<4?28:input.zoom<6?12:input.zoom<9?4:1.2,groups=[];
  const build=()=>{const out=new Map();for(let i=0;i<input.assetIds.length;i++){if(heroSet.has(i))continue;const point=position(i),owner=input.owners[i]||'unknown',mode=input.modes[i],key=`${owner}:${mode}:${Math.floor((point[0]+90)/cell)}:${Math.floor((point[1]+180)/cell)}`;let row=out.get(key);if(!row){row={key,owner,mode,indices:[],lat:0,lng:0};out.set(key,row);}row.indices.push(i);row.lat+=point[0];row.lng+=point[1];}return [...out.values()];};
  groups=build();while(groups.length>Math.max(4,input.limit-heroes.length)&&cell<180){cell*=1.7;groups=build();}
  return {heroes,groups:groups.map(group=>({key:group.key,owner:group.owner,mode:group.mode,coords:[group.lat/group.indices.length,group.lng/group.indices.length],indices:group.indices}))};
}

function assertPlanParity(input,plan){
  const expected=referencePlan(input);assert.deepEqual([...plan.heroIndices],expected.heroes,'selected and fair representative order matches the prior map algorithm');
  assert.equal(plan.groups.length,expected.groups.length,'adaptive cell coarsening gives the same group count');
  const actualByKey=new Map(plan.groups.map(group=>[group.key,group]));
  for(const expectedGroup of expected.groups){const actual=actualByKey.get(expectedGroup.key);assert.ok(actual,`group ${expectedGroup.key} exists`);assert.equal(actual.owner,expectedGroup.owner);assert.equal(actual.mode,expectedGroup.mode);assert.deepEqual(actual.coords,expectedGroup.coords,'cluster arithmetic centroid matches the prior map algorithm');assert.deepEqual([...plan.members.slice(actual.start,actual.start+actual.count)],expectedGroup.indices,'cluster membership and source ordering match');}
}

async function testLoadAndParity(){
  for(const count of [4300,20000]){
    const input=makeInput(count),plan=core.buildPlan(input);assert.equal(plan.assetCount,count);assert.ok(plan.groups.length<=input.limit,'cluster count stays within the marker budget after hero representatives');assertPlanParity(input,plan);
    const updated=input.progress.slice();for(let i=0;i<updated.length;i++)updated[i]=Math.fround((updated[i]+.173)%1);
    const snapshot={assetCount:count,routeIndexes:input.routeIndexes,baseCoordinates:input.baseCoordinates,routes:input.routes,members:plan.members,groups:plan.groups};
    const centers=core.updateGroupCenters(snapshot,updated),expected=plan.groups.map(group=>{let lat=0,lng=0;for(let j=group.start;j<group.start+group.count;j++){const point=core.interpolateRoute(input.routes[input.routeIndexes[plan.members[j]]],updated[plan.members[j]]);lat+=point[0];lng+=point[1];}return {key:group.key,coords:[lat/group.count,lng/group.count]};});
    assert.deepEqual(centers,expected,`${count} moving-asset centroids update from a compact progress vector`);
  }
}

class FakeWorker{
  constructor(delay=2){this.delay=delay;this.active=null;this.terminated=false;}
  postMessage(message){if(this.terminated)return;setTimeout(()=>{if(this.terminated)return;try{
    if(message.type==='plan'){const result=core.buildPlan(message);this.active={assetCount:result.assetCount,routeIndexes:message.routeIndexes,baseCoordinates:message.baseCoordinates,routes:message.routes,members:result.members.slice(),groups:result.groups};this.onmessage?.({data:{type:'plan-result',requestId:message.requestId,generation:message.generation,key:message.key,version:result.version,assetCount:result.assetCount,heroIndices:result.heroIndices,members:result.members,groups:result.groups}});}
    else if(message.type==='positions'){const groups=core.updateGroupCenters(this.active,message.progress);this.onmessage?.({data:{type:'positions-result',requestId:message.requestId,generation:message.generation,groups}});}
  }catch(error){this.onmessage?.({data:{type:'error',error:error.message}});}},this.delay);}
  terminate(){this.terminated=true;}
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function testAsyncLifecycle(){
  const staleInput=makeInput(4300),input=makeInput(120),workers=[],completed=[],positions=[];
  const engine=core.create({workerFactory:()=>{const worker=new FakeWorker();workers.push(worker);return worker;},timeoutMs:1000,onPlan:plan=>completed.push(plan),onPositions:result=>positions.push(result)});
  assert.equal(engine.requestPlan(staleInput).ready,false);assert.equal(engine.requestPlan(input).ready,false);assert.equal(engine.requestPlan(input).pending,true,'duplicate plans coalesce while one plan is in flight');
  assert.equal(workers.length,2);assert.equal(workers[0].terminated,true,'superseded 4.3k plan is terminated rather than queued');await wait(20);assert.equal(completed.length,1);assert.equal(completed[0].key,input.key,'late result cannot replace the latest plan');
  const ready=engine.requestPlan(input);assert.equal(ready.ready,true);assertPlanParity(input,ready.plan);
  const ids=engine.getAssetIds();assert.equal(ids.length,120,'active generation retains stable row identity for progress updates');
  const progress=input.progress.slice();for(let i=0;i<progress.length;i++)progress[i]=Math.fround((progress[i]+.2)%1);assert.equal(engine.requestPositions(progress),true);
  await wait(20);assert.equal(positions.length,1);assert.equal(positions[0].groups.length,ready.plan.groups.length);
  engine.disable();assert.equal(workers[1].terminated,true,'worker lifecycle supports explicit shutdown');
}

async function testFallbackAndWorkerContract(){
  let failures=0;const failed=core.create({workerFactory:()=>{throw new Error('worker-disabled');},onFailure:()=>failures++});
  assert.equal(failed.requestPlan(makeInput(4)).worker,false);assert.equal(failed.isDisabled(),true);assert.equal(failures,1);
  const workerPath=path.join(__dirname,'../WebApp/map-presentation-worker.js'),source=fs.readFileSync(workerPath,'utf8'),sent=[],input=makeInput(8),context={Uint8Array,Uint32Array,Int32Array,Float32Array,Float64Array,Array,Map,Set,Number,String,TypeError,Error,Math,Promise,console};
  context.self=context;context.globalThis=context;context.importScripts=()=>{context.GH_MAP_PRESENTATION_CORE=core;};context.addEventListener=(type,listener)=>{if(type==='message')context.receive=listener;};context.postMessage=(message,transfer=[])=>sent.push({message,transfer});
  vm.runInNewContext(source,context,{filename:workerPath});context.receive({data:{...input,type:'plan',requestId:1,generation:1}});assert.equal(sent[0].message.type,'plan-result');assert.equal(sent[0].message.assetCount,8);
  context.receive({data:{type:'positions',requestId:2,generation:1,progress:input.progress}});assert.equal(sent[1].message.type,'positions-result');assert.equal(sent[1].message.groups.length,sent[0].message.groups.length);
  context.receive({data:{type:'positions',requestId:3,generation:0,progress:input.progress}});assert.equal(sent[2].message.type,'error','stale generation cannot be read as current map state');
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'WebApp/index.html'),'utf8'),app=fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8'),runtime=JSON.parse(fs.readFileSync(path.join(root,'WebApp/runtime-required.json'),'utf8'));
  assert.match(html,/map-presentation-core\.js/);assert.ok(html.indexOf('map-presentation-core.js')<html.indexOf('app.js'));assert.match(app,/new Worker\('map-presentation-worker\.js'\)/);assert.match(app,/mapPresentationEngine\.requestPlan\(/);assert.match(app,/mapPresentationEngine\.requestPositions\(/);assert.ok(runtime.files.includes('map-presentation-worker.js'));
}

(async()=>{await testLoadAndParity();await testAsyncLifecycle();await testFallbackAndWorkerContract();console.log('Build 340 map presentation engine: 4.3k/20k parity, fair hero selection, route interpolation, centroid updates, bounded async lifecycle and fallback PASS');})().catch(error=>{console.error(error);process.exitCode=1;});
