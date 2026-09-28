'use strict';
const assert=require('node:assert/strict');
const operations=require('../WebApp/operations-core.js');

for(const existing of [0,39,398,400,430])for(const count of [0,1,2,40,401,3380]){
  const initial={simSeconds:7200,alerts:Array.from({length:Math.min(existing,45)},(_,i)=>`older alert ${i}`),eventLog:Array.from({length:existing},(_,i)=>({id:`old-${i}`,at:0,type:'older',text:`older ${i}`})),operations:{dailyBriefs:[],riskIndex:7}};
  const legacy=structuredClone(initial),batched=structuredClone(initial),items=Array.from({length:count},(_,i)=>i%23===0?' ':`flight ${i}`);
  for(const text of items)operations.execute({state:legacy},'record-alert',{text,type:'simulation'});
  if(items.length)operations.execute({state:batched},'record-alerts',{items,type:'simulation'});
  assert.deepEqual(batched,legacy,`batched alerts preserve exact Save Schema and event IDs: existing=${existing},count=${count}`);
}

for(const count of [400,401,3380]){
  const initial={simSeconds:7200,alerts:['older alert'],eventLog:Array.from({length:398},(_,i)=>({id:`old-${i}`,at:0,type:'older',text:`older ${i}`})),operations:{dailyBriefs:[],riskIndex:7}},items=[];
  for(let i=0;i<count;i++){
    if(i%19===0)items.push({text:' ',id:`ignored-${i}`,type:'ignored'});
    items.push({text:` flight ${i} `,...(i%37===0?{id:`flight-id-${i}`}:{}),...(i%41===0?{type:'priority'}:{})});
  }
  const oracle=structuredClone(initial),compacted=structuredClone(initial),accepted=items.filter(item=>String(item?.text??item??'').trim()),tail=accepted.slice(-400),ordinalOffset=accepted.length-tail.length;
  operations.execute({state:oracle},'record-alerts',{items,type:'simulation'});
  operations.execute({state:compacted},'record-alerts',{items:tail,type:'simulation',ordinalOffset});
  assert.equal(JSON.stringify(compacted),JSON.stringify(oracle),`compacted alert tail preserves byte-exact state: accepted=${count},offset=${ordinalOffset}`);
}
console.log('Build342 batched alert owner matches every sequential alert and event ID across 30 retained-history cases PASS');
