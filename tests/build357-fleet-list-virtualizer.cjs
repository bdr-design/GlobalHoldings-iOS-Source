'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {create}=require('../WebApp/fleet-list-virtualizer.js');
function naive(values,end){let sum=0;for(let i=0;i<end;i++)sum+=values[i];return sum;}
const small=create(100,{estimate:100,overscan:2}),values=Array(100).fill(100);
for(const [index,height] of [[0,140],[9,80],[54,260],[99,120]]){small.measure(index,height);values[index]=height;}
for(let i=0;i<values.length;i++)assert.equal(small.prefix(i),naive(values,i));
const visible=small.range(900,400);assert.equal(visible.start,6);assert.equal(visible.top,naive(values,visible.start));assert.equal(visible.bottom,naive(values,100)-naive(values,visible.end));
assert.equal(small.range(1e9,400).start,98);assert.equal(small.range(1e9,400).end,100);
const start=Date.now(),million=create(1_000_000,{estimate:280}),middle=million.range(140_000_000,900);assert(middle.start>499_000&&middle.start<501_000);assert(middle.end-middle.start<20);million.measure(middle.start,420);const after=million.range(140_000_000,900);assert.equal(after.top,million.prefix(after.start));assert.equal(million.total(),280_000_140);const elapsedMs=Date.now()-start;
const app=fs.readFileSync(require.resolve('../WebApp/app.js'),'utf8'),html=fs.readFileSync(require.resolve('../WebApp/index.html'),'utf8');assert(html.includes('fleet-list-virtualizer.js'));assert(app.includes('ownedVirtualList'));assert(app.includes('aria-setsize'));assert(!app.includes('standard.slice(0,80)')&&!app.includes('mobility.slice(0,80)'));
console.log(JSON.stringify({suite:'build357-fleet-list-virtualizer',passed:11,total:11,millionEntries:true,visible:middle.end-middle.start,elapsedMs}));
