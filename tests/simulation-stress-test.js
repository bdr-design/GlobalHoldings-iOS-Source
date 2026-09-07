const assert=require('assert');
const sim=require('../WebApp/simulation-core.js');
const tx=require('../WebApp/transaction-core.js');
const {performance}=require('perf_hooks');

function runCase(assetCount){
  let now=0,speed=4;
  const state={simSeconds:0,cash:0,profit:0,assets:Array.from({length:assetCount},(_,i)=>({id:i,progress:0,profit:0}))};
  const adapter={
    getSpeed:()=>speed,setSpeed:v=>{speed=v},getSimTime:()=>state.simSeconds,setSimTime:v=>{state.simSeconds=v},
    createSliceJob:(slice,meta)=>{
      const seeds=state.assets.map(a=>({...a})),drafts=[];let index=0,cancelled=false;
      return {
        runChunk(max){let n=0;while(index<seeds.length&&n++<max){const a={...seeds[index++]};a.progress=(a.progress+slice/3600)%1;a.profit+=slice;drafts.push(a);}return index>=seeds.length;},
        finish(){
          if(cancelled)return {committed:false};
          if(state.assets.some((a,i)=>a.id!==seeds[i].id||a.progress!==seeds[i].progress||a.profit!==seeds[i].profit))return {committed:false,retry:true,reason:'asset-conflict'};
          return tx.execute(state,{label:'stress',validate:()=>state.simSeconds===meta.from,apply:()=>{state.simSeconds=meta.to;state.assets=drafts;state.profit+=drafts.length*slice;state.cash+=drafts.length*slice*10;}});
        },
        cancel(){cancelled=true;}
      };
    }
  };
  const engine=sim.create(adapter,{nowMs:()=>now,frameBudgetMs:1000,chunkItems:64,fastQuantum:2,maxRealDelta:3,maxBacklogFast:96});
  const start=performance.now();
  for(let i=0;i<60;i++){now+=1000;engine.frame(now);} // 60 real s * x4 = 240 simulated s
  const ms=performance.now()-start;
  assert.strictEqual(state.simSeconds,240,`${assetCount}: time mismatch`);
  assert.strictEqual(state.profit,assetCount*240,`${assetCount}: duplicated/missing simulated work`);
  assert.strictEqual(state.cash,assetCount*2400,`${assetCount}: duplicated/missing cash commits`);
  return {assetCount,ms:Number(ms.toFixed(2)),chunks:engine.health().chunks,slices:engine.health().slices};
}
const results=[100,500,1000,2000].map(runCase);
console.log('Simulation stress 2.3.9 x4: PASS',JSON.stringify(results));
