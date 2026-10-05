'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp/app.js'),'utf8');
function range(start,end){const a=app.indexOf(start),b=app.indexOf(end,a+start.length);assert(a>=0&&b>a,`missing source range ${start}`);return app.slice(a,b);}
const results=[];function test(name,fn){try{const details=fn();results.push({name,passed:true,details});}catch(error){results.push({name,passed:false,error:error.message});}}
test('scalar JSON clone semantics with no serialization work',()=>{
 let stringifyCalls=0,parseCalls=0;
 const context={JSON:{stringify:v=>{stringifyCalls++;return JSON.stringify(v);},parse:v=>{parseCalls++;return JSON.parse(v);}}};
 vm.runInNewContext(range('  const clone =','  const fmtMoney =')+'\nglobalThis.copy=clone;',context);
 const primitives=[undefined,null,true,false,0,-0,12,-7,1e100,NaN,Infinity,-Infinity,'','عربية 😀'];
 for(const value of primitives){const expected=value===undefined?undefined:JSON.parse(JSON.stringify(value));assert(Object.is(context.copy(value),expected));}
 const primitiveCalls={stringifyCalls,parseCalls};
 for(const value of [{a:1,b:undefined,c:[3,null,NaN]},[1,{x:'م'}],new Date(0),{toJSON:()=>({ok:true})}])assert.deepEqual(context.copy(value),JSON.parse(JSON.stringify(value)));
 assert.throws(()=>context.copy(1n));assert.throws(()=>context.copy(()=>{}));
 assert.equal(primitiveCalls.stringifyCalls,0,'primitive clones still allocate JSON strings');assert.equal(primitiveCalls.parseCalls,0);
 return {primitiveValues:primitives.length,primitiveCalls};
});
test('vehicle decluttering computes each vehicle position once and never stacks two vehicles',()=>{
 const rows=Array.from({length:2000},(_,i)=>({id:'A'+i,coords:[(i%40)*3,(Math.floor(i/40)%50)*3]}));let calls=0;
 const context={MAP_VIEW:require('../WebApp/map-view-core.js'),selectedAssetId:'A7',map:{latLngToContainerPoint:([lat,lng])=>({x:lng*10,y:lat*10})},assetPosition:a=>{calls++;return a.coords;}};
 vm.runInNewContext(range('  function declutterVehicles(','  function addIndividualAssetMarkers(')+'\nglobalThis.declutter=declutterVehicles;',context);
 const kept=context.declutter(rows);
 assert.equal(calls,rows.length,'decluttering repeated vehicle position calculations');assert.equal(kept[0].id,'A7','the selected asset is kept first');
 for(let i=0;i<kept.length;i++)for(let j=i+1;j<kept.length;j++){const a=kept[i].coords,b=kept[j].coords;assert(Math.hypot((a[0]-b[0])*10,(a[1]-b[1])*10)>=18,'two kept vehicles overlap');}
 return {assets:rows.length,positionReads:calls,kept:kept.length};
});
test('asset lookup follows collection replacement without relying on save revision',()=>{
 const {harness}=require('./helpers/core-harness'),{s}=harness(['fleet-store-core','fleet-access-core']);
 const state={saveRevision:9,simSeconds:0,fleet:s.GH_FLEET_STORE.fromAssets([{id:'A',type:'air',progress:0}],{at:0})};s.state=state;
 vm.runInContext(range('  let map, currentTile, layers = {}','  const mapAssetQueryEngine=')+'\nglobalThis.readFleetRows=fleetPresentationRows;',s);
 vm.runInContext(range('  function presentationAssetLookup()','  function updateMarkerPositions(')+'\nglobalThis.lookup=presentationAssetLookup;',s);
 const previous=s.lookup();for(let i=1;i<=50;i++){state.fleet=s.GH_FLEET_STORE.fromAssets([{id:'A',type:'air',progress:i/100}],{at:0});const next=s.lookup();assert.equal(next.get('A').progress,i/100);assert.equal(next.size,1);assert.equal(s.readFleetRows()[0].progress,i/100);}assert.notEqual(s.lookup(),previous);return {replacements:50,source:'Fleet Store + Fleet Data Access'};
});
function motion(interval,target=1000){
 let writes=0;const row={lastAt:1,current:[0,0],target:[target,0],marker:{_map:true,setLatLng:()=>{writes++;}},routeBridge:[]};
 const context={markerMotionStates:new Map([['own:A',row]]),mapInteractionActive:false,document:{hidden:false},state:{speed:1},markerMotionProfile:()=>({maxPixelsPerSecond:12}),effectiveSimulationRate:x=>x,fadeResyncMarker:()=>{},advanceRouteMotion:()=>null,markerScreenDistance:(a,b)=>Math.abs(a[0]-b[0]),boundedStepRatio:(d,m)=>d<=m||d===0?1:m/d,interpolateMarkerPoint:(a,b,t)=>[a[0]+(b[0]-a[0])*t,0],refreshVehicleMarker:()=>{},bearingBetween:()=>0,nonCritical:(_where,error)=>{throw error;},visualResyncRequested:false,presentationFrameInterval:()=>interval};
 vm.runInNewContext(range('  function animateMapMarkerPositions(','  window.GH_VISUAL_MOTION=')+'\nglobalThis.animate=animateMapMarkerPositions;',context);
 return {context,row,writes:()=>writes};
}
test('stationary marker does not emit redundant Leaflet writes',()=>{const m=motion(220,0);m.context.animate(221);assert.equal(m.writes(),0);m.row.target=[100,0];m.context.animate(441);assert.equal(m.writes(),1);return {idleWrites:0,movingWrites:1};});
test('scheduled map cadence does not silently divide motion speed',()=>{
 const measurements=[55,110,220].map(interval=>{const m=motion(interval);for(let t=interval;t<=2200;t+=interval)m.context.animate(t+1);assert(Math.abs(m.row.current[0]-26.4)<1e-8,`cadence ${interval}: moved ${m.row.current[0]} instead of 26.4`);return {intervalMs:interval,displacement:m.row.current[0]};});
 const stalled=motion(220);stalled.context.animate(60001);assert(stalled.row.current[0]<=3.6,'long stall must not cause unbounded catch-up');return measurements;
});
console.log(JSON.stringify({suite:'presentation-work-contract',results,passed:results.filter(r=>r.passed).length,total:results.length},null,2));if(results.some(r=>!r.passed))process.exitCode=1;
