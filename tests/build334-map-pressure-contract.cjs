'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const app=fs.readFileSync(path.resolve(__dirname,'../WebApp/app.js'),'utf8');
const r0=app.indexOf('function renderMap()'),r1=app.indexOf('function updateMarkerPositions',r0),block=app.slice(r0,r1);
// Build 359: owned fleet, Mobility and competitor vehicles first become candidates, then one allocator spends one
// adaptive budget and one Canvas layer enforces the absolute 300-proxy ceiling. This is presentation-only.
const a0=app.indexOf('function renderAllocatedVehicles('),allocator=app.slice(a0,app.indexOf('\n  function ',a0+10));
assert(a0>0&&allocator.includes("Math.min(300,MAP_VIEW.budget('vehicles',zoom))")&&allocator.includes('allocator.allocate(unique,')&&allocator.includes('declutterRadius:18'));
assert(block.includes('vehicleCandidates.push(...operationVehicleCandidates(')&&block.includes('vehicleCandidates.push(...mobilityVehicleCandidates())')&&block.includes('vehicleCandidates.push(competitorMapCandidate(a))'));
assert.equal((block.match(/renderAllocatedVehicles\(vehicleCandidates,zoom\)/g)||[]).length,1,'all vehicle sources share one allocation call');
assert(app.includes("map.createPane('vehicleCanvas')")&&app.includes("vehiclePane.style.zIndex='450'")&&app.includes('GH_MAP_VEHICLE_CANVAS?.create?.({map,container:vehiclePane,hardLimit:300')&&app.includes('mapVehicleCanvas.add(candidate.id,')&&app.includes('mapVehicleCanvas?.clear?.()'));
const l0=app.indexOf('function renderRouteLines('),lines=app.slice(l0,app.indexOf('\n  function ',l0+10)),markerPass=app.slice(r1,app.indexOf('\n  function ',r1+10));
assert(l0>0&&lines.includes("MAP_VIEW.busiestRoutes(inView,MAP_VIEW.budget('routes',zoom))")&&!markerPass.includes('L.polyline'));
assert(!/fleetClusterHtml|flushFleetClusters|movingFleetClusters|compactFleetMarker/.test(app));
// One lookup per marker pass; Build 358 resolves through the id index instead of a map of every asset once the map
// aggregates the fleet (20,000 assets and more).
assert(/const assetIndex=(mapAggregateMode\(\)\?\{get:id=>window\.GH_FLEET_DATA\.get\(state,id\)\}:)?presentationAssetLookup\(\);/.test(app));
assert(block.includes("The selected asset's route is drawn on top"));
assert(app.includes('routeLayers.forEach'));
console.log(JSON.stringify({suite:'map-pressure-contract',passed:9,total:9},null,2));
