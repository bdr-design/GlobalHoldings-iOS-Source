'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const app=fs.readFileSync(path.resolve(__dirname,'../WebApp/app.js'),'utf8');
const r0=app.indexOf('function renderMap()'),r1=app.indexOf('function updateMarkerPositions',r0),block=app.slice(r0,r1);
// Build 359 (map modes): no layer is built per moving asset. Operations draws one vehicle per owner and route, at most
// the zoom's vehicle budget, decluttered; route lines are the busiest routes in view, at most the zoom's route budget,
// on the map's canvas renderer and only from renderMap (never from the per-frame marker pass).
assert(block.includes('renderOperationVehicles(filterState,zoom,presentation,visibleAssets)')&&!/for\(const asset of (movingAssets|visibleAssets)\)\{[^}]*L\.(marker|circleMarker)/.test(block));
const v0=app.indexOf('function renderOperationVehicles('),vehicles=app.slice(v0,app.indexOf('\n  function ',v0+10));
assert(v0>0&&vehicles.includes("MAP_VIEW.budget('vehicles',zoom)")&&vehicles.includes('addIndividualAssetMarkers(declutterVehicles(heroes))'));
const l0=app.indexOf('function renderRouteLines('),lines=app.slice(l0,app.indexOf('\n  function ',l0+10)),markerPass=app.slice(r1,app.indexOf('\n  function ',r1+10));
assert(l0>0&&lines.includes("MAP_VIEW.busiestRoutes(inView,MAP_VIEW.budget('routes',zoom))")&&!markerPass.includes('L.polyline'));
assert(!/fleetClusterHtml|flushFleetClusters|movingFleetClusters|compactFleetMarker/.test(app));
// One lookup per marker pass; Build 358 resolves through the id index instead of a map of every asset once the map
// aggregates the fleet (20,000 assets and more).
assert(/const assetIndex=(mapAggregateMode\(\)\?\{get:id=>window\.GH_FLEET_DATA\.get\(state,id\)\}:)?presentationAssetLookup\(\);/.test(app));
assert(block.includes("The selected asset's route is drawn on top"));
assert(app.includes('routeLayers.forEach'));
console.log(JSON.stringify({suite:'map-pressure-contract',passed:6,total:6},null,2));
