const assert=require('assert');
const sim=require('../WebApp/simulation-core.js');
for(const speed of [1,2,4]){
  let now=0,time=0,slices=0,speedValue=speed;
  const engine=sim.create({
    getSpeed:()=>speedValue,setSpeed:v=>{speedValue=v},getSimTime:()=>time,setSimTime:v=>{time=v},
    createSliceJob:(slice)=>({runChunk:()=>true,finish:()=>{slices++;return {committed:true}},cancel(){}})
  },{nowMs:()=>now,frameBudgetMs:1000});
  for(let i=0;i<10;i++){now+=1000;engine.frame(now);}
  assert.strictEqual(time,10*speed,`x${speed} time mismatch`);
  assert(slices<=11,`x${speed} created ${slices} transactions in 10 seconds; multiplier must not multiply commit frequency`);
}
console.log('Simulation multiplier transaction-rate guard: PASS');
