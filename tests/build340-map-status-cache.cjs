'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const app=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8');
const start=app.indexOf("  let mapStatusCache={assetKey:");
const end=app.indexOf('\n  function markerPoint',start);
assert(start>=0&&end>start,'map status cache implementation exists');
const source=app.slice(start,end);
const phases=['moving','idle','turnaround','delivery'];
const assets=Array.from({length:20000},(_,i)=>({phase:phases[i%phases.length]}));
let assetScans=0,mobilityScans=0,routeScans=0,facilityScans=0;
// Fleet Data Access scans by index: one full fleet pass reads element 0 exactly once.
const assetRows=new Proxy(assets,{get(target,key,receiver){if(key===Symbol.iterator||key==='0'){assetScans++;return Reflect.get(target,key,receiver);}return Reflect.get(target,key,receiver);}});
const vehicles=new Proxy([{status:'moving'},{status:'available'},{status:'moving'}],{get(target,key,receiver){if(key===Symbol.iterator){mobilityScans++;return Reflect.get(target,key,receiver);}return Reflect.get(target,key,receiver);}});
const state={saveRevision:7,activeFilter:'all',assets:assetRows,mobility:{vehicles}};
const window={GH_MAP_STRUCTURE_REVISION:3,GH_MOBILITY_CORE:{mapStructureRevision:()=>11},GH_FLEET_DATA:require('../WebApp/fleet-access-core.js')};
const dom={mapStatus:{textContent:'',title:''}};
let fakeNow=1000000;
const context={state,window,Date:{now:()=>fakeNow},mapTilesOffline:false,mapCategoryVisible:()=>false,operationalRoutes:()=>{routeScans++;return [{routingSource:'OSRM'}];},getDynamicFacilities:()=>{facilityScans++;return [{owned:true},{owned:false}];},$:id=>dom[id]};
const update=vm.runInNewContext(`(()=>{${source};return updateMapStatus;})()`,context,{filename:'map-status-cache.js'});

update();
assert.equal(assetScans,1,'initial summary is built once');
assert.equal(mobilityScans,1,'mobility counts are built once');
assert.equal(routeScans,1);
assert.equal(facilityScans,1);
assert.equal(dom.mapStatus.textContent,'5002 في الحركة · 5000 في المحطات · 20000 أصل · 3 سيارة');
const counts=[assetScans,mobilityScans,routeScans,facilityScans];
for(let i=0;i<20;i++)update();
assert.deepEqual([assetScans,mobilityScans,routeScans,facilityScans],counts,'500ms HUD refreshes do not rescan assets, vehicles, routes, or facilities');

// A simulation slice (map structure revision only): the fleet is recounted at most every 2 s; in between the last
// counts stay (no 20k pass after every slice), and the line never shows NaN or undefined.
assets[0].phase='idle';
window.GH_MAP_STRUCTURE_REVISION++;
update();
assert.equal(assetScans,1,'a slice within 2 s of the last count does not rescan the fleet');
assert.equal(dom.mapStatus.textContent,'5002 في الحركة · 5000 في المحطات · 20000 أصل · 3 سيارة','the last counts stay');
assert.equal(routeScans,2,'route counts refresh when simulation retires or replaces map structure');
assert.equal(facilityScans,2);
fakeNow+=2500;update();
assert.equal(assetScans,2,'after 2 s the slice is counted once');
assert.equal(dom.mapStatus.textContent,'5001 في الحركة · 5000 في المحطات · 20000 أصل · 3 سيارة');
for(let i=0;i<5;i++)update();assert.equal(assetScans,2,'and HUD refreshes stay O(1) after it');

state.saveRevision++;
update();
assert.equal(assetScans,3,'a durable state revision rebuilds the read cache once');
assert.equal(mobilityScans,2,'durable replacement refreshes mobility status once');
assert.equal(routeScans,3);
assert.equal(facilityScans,3);

window.GH_MOBILITY_CORE.mapStructureRevision=()=>12;
update();
assert.equal(assetScans,3,'mobility-only changes do not scan the main fleet');
assert.equal(mobilityScans,3,'mobility owner revision refreshes its own cached count');

assert.doesNotMatch(dom.mapStatus.textContent,/NaN|undefined/);
assert.doesNotMatch(app,/GH_MAP_ASSET_STATUS_SUMMARY/,'the former engine summary (no phase counts; printed NaN/undefined) is gone');
console.log('PASS map status cache: repeated HUD refreshes are O(1); slices recount the fleet at most every 2 s; never NaN/undefined');
