const assert=require('assert');const crypto=require('crypto');const sim=require('../WebApp/simulation-core.js');
function run(speed,targetSim=160){let now=0,time=0,value=0,events=[];const engine=sim.create({getSpeed:()=>speed,setSpeed:()=>{},getSimTime:()=>time,setSimTime:v=>{time=v},createSliceJob:(slice,meta)=>({runChunk:()=>true,finish:({to,boundary})=>{value+=slice*37;events.push([Number(to.toFixed(6)),boundary.hour,boundary.day]);return {committed:true}},cancel:()=>{}})},{nowMs:()=>now,frameBudgetMs:1000});
  while(time<targetSim-1e-9){now+=1000;engine.frame(now);if(now>targetSim*2000)throw new Error('timeout');}
  return crypto.createHash('sha256').update(JSON.stringify({time:Number(time.toFixed(9)),value:Number(value.toFixed(9))})).digest('hex');}
const hashes=[1,2,4].map(s=>run(s));assert.strictEqual(new Set(hashes).size,1,`same sim time diverged across speed multipliers: ${hashes.join(',')}`);console.log('Cross-speed determinism 2.3.9: PASS');
