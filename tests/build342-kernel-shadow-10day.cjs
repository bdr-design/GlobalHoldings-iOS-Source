'use strict';
const assert=require('node:assert/strict');
const GH_KERNEL=require('../WebApp/kernel-core.js');

const speed=600,assetCount=3380,hours=10*24,simSecondsPerSlice=3600;
const initial={saveVersion:'2.0.0',simSeconds:0,assets:Array.from({length:assetCount},(_,index)=>({
  id:`A-${String(index).padStart(5,'0')}`,progress:(index%97)/97,fuel:50+(index%50),lat:-70+(index%140),lng:-170+(index%340),
  phase:index%3===0?'idle':'moving',routeSeconds:86400*(1+(index%3)),fuelPerSecond:.00001+(index%7)*.000001
}))};
const legacy=structuredClone(initial),kernel=GH_KERNEL.fromLegacyState(initial,[
  {name:'assets',path:'assets',owner:'simulation-asset',kind:'columns',columns:{progress:'f64',fuel:'f64',lat:'f64',lng:'f64',phase:'u8'},enumValues:{phase:['idle','moving','turnaround']}},
  {name:'simSeconds',path:'simSeconds',owner:'simulation',kind:'object'}
]);
const phaseFromCode=['idle','moving','turnaround'];
function nextValues(asset,simDelta,nextSimSeconds){
  const total=Number(asset.progress)+simDelta/Number(asset.routeSeconds),arrived=total>=1,progress=arrived?total-Math.floor(total):total;
  return {progress,fuel:Math.max(0,Number(asset.fuel)-simDelta*Number(asset.fuelPerSecond)-(arrived?4:0)),lat:Math.max(-85,Math.min(85,Number(asset.lat)+Math.sin((nextSimSeconds/3600+Number(asset.id.slice(2)))%Math.PI)*.0001)),lng:((Number(asset.lng)+Math.cos((nextSimSeconds/3600+Number(asset.id.slice(2)))%Math.PI)*.0001+540)%360)-180,phase:arrived?'turnaround':'moving'};
}

for(let hour=0;hour<hours;hour++){
  const wallSeconds=simSecondsPerSlice/speed,simDelta=wallSeconds*speed,nextSimSeconds=legacy.simSeconds+simDelta;
  for(const asset of legacy.assets)Object.assign(asset,nextValues(asset,simDelta,nextSimSeconds));
  legacy.simSeconds=nextSimSeconds;
  const reads={assets:kernel.revision('assets'),simSeconds:kernel.revision('simSeconds')};
  const kernelAssets=kernel.read('assets');
  kernel.tx({label:`simulation:600x:hour:${hour+1}`,owners:['simulation-asset','simulation'],writes:['assets','simSeconds'],reads},writer=>{
    const progress=writer.col('assets','progress'),fuel=writer.col('assets','fuel'),lat=writer.col('assets','lat'),lng=writer.col('assets','lng'),phase=writer.col('assets','phase');
    for(let index=0;index<assetCount;index++){
      const values=nextValues(kernelAssets[index],simDelta,nextSimSeconds);
      progress.set(index,values.progress);fuel.set(index,values.fuel);lat.set(index,values.lat);lng.set(index,values.lng);phase.set(index,values.phase);
    }
    writer.set('simSeconds',nextSimSeconds);
  });
  const shadow=kernel.legacyState(),difference=GH_KERNEL.firstDifference(legacy,shadow);
  assert.equal(difference,null,`shadow mismatch at simulated hour ${hour+1}: ${difference}`);
}

assert.equal(legacy.simSeconds,10*86400);
assert.equal(kernel.revision('assets'),hours);
assert.equal(kernel.revision('simSeconds'),hours);
assert.equal(kernel.fingerprint('assets'),GH_KERNEL.fingerprint(legacy.assets));
console.log(`Build342 synthetic shadow parity: ${hours} hourly commits, ${assetCount} assets, 10 simulated days at 600x, 100% state parity PASS`);
