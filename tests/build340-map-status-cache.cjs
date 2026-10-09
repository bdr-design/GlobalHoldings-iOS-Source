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
let assetScans=0,mobilityScans=0,routeScans=0,facilityScans=0,mobilityRevisionReads=0;
const assetRows=new Proxy(assets,{get(target,key,receiver){if(key===Symbol.iterator||key==='0'){assetScans++;return Reflect.get(target,key,receiver);}return Reflect.get(target,key,receiver);}});
const vehicles=new Proxy([{status:'moving'},{status:'available'},{status:'moving'}],{get(target,key,receiver){if(key===Symbol.iterator){mobilityScans++;return Reflect.get(target,key,receiver);}return Reflect.get(target,key,receiver);}});
const state={saveRevision:7,activeFilter:'all',assets:assetRows,mobility:{vehicles}};
const window={GH_MAP_STRUCTURE_REVISION:3,GH_MOBILITY_CORE:{mapStructureRevision:()=>{mobilityRevisionReads++;return 11;}},GH_FLEET_DATA:require('../WebApp/fleet-access-core.js')};
const dom={mapStatus:{textContent:'',title:''}};
let fakeNow=1000000;
const context={state,window,Date:{now:()=>fakeNow},mapTilesOffline:false,mapCategoryVisible:()=>false,operationalRoutes:()=>{routeScans++;return [{routingSource:'OSRM'}];},getDynamicFacilities:()=>{facilityScans++;return [{owned:true},{owned:false}];},$:id=>dom[id]};
const update=vm.runInNewContext(`(()=>{${source};return updateMapStatus;})()`,context,{filename:'map-status-cache.js'});

update();
assert.equal(assetScans,1,'initial summary is built once');
assert.equal(mobilityScans,0,'map HUD never scans mobility vehicles');
assert.equal(mobilityRevisionReads,0,'map HUD never consults the mobility vehicle revision');
assert.equal(routeScans,1);
assert.equal(facilityScans,1);
assert.equal(dom.mapStatus.textContent,'5000 في الحركة · 5000 في المحطات · 20000 أصل');
const counts=[assetScans,mobilityScans,routeScans,facilityScans,mobilityRevisionReads];
for(let i=0;i<20;i++)update();
assert.deepEqual([assetScans,mobilityScans,routeScans,facilityScans,mobilityRevisionReads],counts,'500ms HUD refreshes do not rescan assets, mobility vehicles, routes, or facilities');

assets[0].phase='idle';
window.GH_MAP_STRUCTURE_REVISION++;
update();
assert.equal(assetScans,1,'a slice within 2 s of the last count does not rescan the fleet');
assert.equal(dom.mapStatus.textContent,'5000 في الحركة · 5000 في المحطات · 20000 أصل','the last fleet counts stay');
assert.equal(routeScans,2,'route counts refresh when simulation retires or replaces map structure');
assert.equal(facilityScans,2);
fakeNow+=2500;update();
assert.equal(assetScans,2,'after 2 s the fleet is recounted once');
assert.equal(dom.mapStatus.textContent,'4999 في الحركة · 5000 في المحطات · 20000 أصل');
for(let i=0;i<5;i++)update();assert.equal(assetScans,2,'and HUD refreshes stay O(1) after it');

state.saveRevision++;
update();
assert.equal(assetScans,3,'a durable state revision rebuilds the read cache once');
assert.equal(mobilityScans,0,'durable replacement still does not scan or display mobility vehicles');
assert.equal(routeScans,3);
assert.equal(facilityScans,3);

assert.doesNotMatch(dom.mapStatus.textContent,/NaN|undefined/);
assert.doesNotMatch(app,/GH_MAP_ASSET_STATUS_SUMMARY/,'the former engine summary (no phase counts; printed NaN/undefined) is gone');
assert.doesNotMatch(source,/GH_MOBILITY_CORE|mobilityVehicles|mobilityMoving/,'mobility fleet has no map-HUD hot path');
console.log('PASS map status cache: fleet HUD is cached and O(1); mobility vehicles are not scanned or drawn on the map');
