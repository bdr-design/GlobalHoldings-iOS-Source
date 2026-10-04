'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const app=fs.readFileSync(path.resolve(__dirname,'../WebApp/app.js'),'utf8');
const r0=app.indexOf('function renderMap()'),r1=app.indexOf('function updateMarkerPositions',r0),block=app.slice(r0,r1);
assert(block.includes('movingAssetRenderGroups(nonHeroMoving'));
// Build 358: fleet clusters are queued while renderMap builds the layers and drawn, merged and registered for motion by
// flushFleetClusters, which renderMap calls once after the fleet and car layers.
const f0=app.indexOf('function flushFleetClusters()'),flush=app.slice(f0,app.indexOf('\n  function ',f0+10));
assert(f0>0&&block.includes('flushFleetClusters();')&&flush.includes('movingFleetClusters.set(')&&flush.includes('movingMobilityClusters.set('));
assert(!/for\(const asset of movingAssets\)\{if\(movingHeroIds\.has\(asset\.id\)\)continue;[^}]*compactFleetMarker/.test(block));
// One lookup per marker pass; Build 358 resolves through the id index instead of a map of every asset once the map
// aggregates the fleet (20,000 assets and more).
assert(/const assetIndex=(mapAggregateMode\(\)\?\{get:id=>window\.GH_FLEET_DATA\.get\(state,id\)\}:)?presentationAssetLookup\(\);/.test(app));
assert(app.includes('Only the explicitly selected asset'));
assert(app.includes('routeLayers.forEach'));
console.log(JSON.stringify({suite:'map-pressure-contract',passed:6,total:6},null,2));
