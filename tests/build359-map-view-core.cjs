'use strict';
// Build 359 map rules (GH_MAP_VIEW_CORE): one numeral style, groups that stand on a real place, decluttering that drops
// instead of stacking, route weight by traffic, budgets and modes.
const assert=require('node:assert/strict'),path=require('node:path');
const V=require(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp/map-view-core.js'));
// Western digits, compact above 999.
assert.deepEqual([0,7,12,999,1000,3400,12000,1250000,-3,NaN].map(V.countLabel),['0','7','12','999','1K','3.4K','12K','1.3M','0','0']);
// Modes: three, unknown values fall back to operations.
assert.deepEqual(V.MODES.map(m=>m.id),['operations','network','expansion']);assert.equal(V.normalizeMode('x'),'operations');assert.equal(V.normalizeMode('expansion'),'expansion');
// Groups: closer than the radius share one group standing on the heaviest member; weights add up.
const groups=V.groupPoints([{id:'a',x:0,y:0,weight:1},{id:'b',x:10,y:5,weight:5},{id:'c',x:200,y:0},{id:'d',x:30,y:30,weight:2}],{radius:44});
assert.equal(groups.length,2);const g=groups.find(row=>row.members.length===3);assert.equal(g.id,'b');assert.deepEqual([g.x,g.y],[10,5]);assert.equal(g.count,8);
// Declutter: priority first, nothing closer than the radius, the limit holds.
const points=Array.from({length:400},(_,i)=>({id:`p${i}`,x:(i%20)*7,y:Math.floor(i/20)*7,weight:i===399?Infinity:1}));
const kept=V.declutter(points,{radius:18});assert.equal(kept[0].id,'p399');
for(let i=0;i<kept.length;i++)for(let j=i+1;j<kept.length;j++)assert.ok(Math.hypot(kept[i].x-kept[j].x,kept[i].y-kept[j].y)>=18);
assert.equal(V.declutter(points,{radius:1,limit:5}).length,5);
// Route lines: hairline for one asset, about 3 px for the busiest; busiest first within the budget.
assert.deepEqual(V.routeStyle(1,500),{weight:1.1,opacity:.32});assert.deepEqual(V.routeStyle(500,500),{weight:3.2,opacity:.75});
assert.deepEqual(V.busiestRoutes([{key:'a',count:2},{key:'b',count:9},{key:'c',count:0},{key:'d',count:9}],2).map(r=>r.key),['b','d']);
assert.ok(V.budget('routes',2)<V.budget('routes',10)&&V.budget('places',3)<=V.budget('places',8));
assert.deepEqual([2,4,6,9].map(zoom=>V.budget('vehicles',zoom)),[72,120,200,300],'the shared vehicle budget grows to the one-canvas hard cap');
console.log('build359 map view core: Western counts, real-place groups, no stacking, route weights, budgets');
