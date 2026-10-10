'use strict';
const assert=require('node:assert/strict');
const Core=require('../WebApp/air-sea-network-core.js');

for(const size of [0,1,36,37,41,43,899,900,901,1800,1801,37*41,37*41*43]){
  const start=size?Math.floor(size*.63):0,cursor=Core.createDestinationWindowCursor(size,start),seen=[],windows=[];
  while(!cursor.isDone()){const window=cursor.next(900);assert.ok(window.length<=900);windows.push(window);seen.push(...window);}
  assert.equal(cursor.visited(),size,`every row counted for pool ${size}`);
  assert.equal(seen.length,size,`all rows returned for pool ${size}`);
  assert.equal(new Set(seen).size,size,`no row repeats for pool ${size}`);
  assert.deepEqual([...seen].sort((a,b)=>a-b),Array.from({length:size},(_,index)=>index),`the permutation covers pool ${size}`);
  assert.ok(windows.every(window=>window.length>0));
}

const size=901,cursor=Core.createDestinationWindowCursor(size,0),first=cursor.next(900),last=cursor.next(900);
assert.equal(first.length,900);assert.equal(last.length,1);
const validPosition=last[0];
let found=null,windowsExamined=0;
for(const window of [first,last]){windowsExamined++;if(window.includes(validPosition)){found=validPosition;break;}}
assert.equal(found,validPosition,'a valid destination in the second window remains reachable after the first window fails');
assert.equal(windowsExamined,2);
assert.equal(cursor.isDone(),true);
console.log(JSON.stringify({suite:'build371-destination-window',poolSizes:[0,1,36,37,41,43,899,900,901,1800,1801,37*41,37*41*43],maxWindow:900,secondWindowReached:true}));
console.log('BUILD371_DESTINATION_WINDOW_PASS');
