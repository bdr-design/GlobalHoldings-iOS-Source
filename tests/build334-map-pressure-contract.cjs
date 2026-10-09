'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const app=fs.readFileSync(path.resolve(__dirname,'../WebApp/app.js'),'utf8');
const r0=app.indexOf('function renderMap()'),r1=app.indexOf('function updateMarkerPositions',r0),block=app.slice(r0,r1);
// Mobility operates through company panels. The map may display its branches, but never materializes vehicle rows.
const a0=app.indexOf('function renderAllocatedVehicles('),allocator=app.slice(a0,app.indexOf('\n  function ',a0+10));
assert(a0>0&&allocator.includes("Math.min(300,MAP_VIEW.budget('vehicles',zoom))")&&allocator.includes('allocator.allocate(unique,')&&allocator.includes('declutterRadius:18'));
assert(block.includes('vehicleCandidates.push(...operationVehicleCandidates(')&&block.includes('vehicleCandidates.push(competitorMapCandidate(a))'));
assert.equal((block.match(/renderAllocatedVehicles\(vehicleCandidates,zoom\)/g)||[]).length,1,'owned fleet and competitors share one bounded allocation call');
assert(app.includes("map.createPane('vehicleCanvas')")&&app.includes("vehiclePane.style.zIndex='450'")&&app.includes('GH_MAP_VEHICLE_CANVAS?.create?.({map,container:vehiclePane,hardLimit:300')&&app.includes('mapVehicleCanvas.add(candidate.id,')&&app.includes('mapVehicleCanvas?.clear?.()'));
assert.doesNotMatch(app,/function mobilityVehicleCandidates\s*\(/,'map must not materialize Mobility vehicle candidates');
assert.doesNotMatch(app,/function mobilityMapCandidate\s*\(/,'map must not adapt Mobility vehicles to markers');
assert.doesNotMatch(block,/liveVehicles\s*\(/,'map render must never query Mobility live vehicles');
const facilities=app.slice(app.indexOf('function mapOwnedFacilities('),app.indexOf('\n  function addFacilityMarker(',app.indexOf('function mapOwnedFacilities(')));
assert(facilities.includes('getDynamicFacilities()')&&facilities.includes('f.owned===true'),'owned company branches remain available as facility markers');
// Owner review (Build 358): no route network on the map; only the tapped main-fleet asset can show its route.
const markerPass=app.slice(r1,app.indexOf('\n  function ',r1+10));
assert(!app.includes('function renderRouteLines(')&&!block.includes('busiestRoutes(')&&!markerPass.includes('L.polyline'));
assert(!/fleetClusterHtml|flushFleetClusters|movingFleetClusters|compactFleetMarker/.test(app));
assert(/const assetIndex=(mapAggregateMode\(\)\?\{get:id=>window\.GH_FLEET_DATA\.get\(state,id\)\}:)?presentationAssetLookup\(\);/.test(app));
assert(block.includes("The selected asset's route is drawn on top"));
assert(app.includes('routeLayers.forEach'));
console.log(JSON.stringify({suite:'map-pressure-contract',passed:10,total:10,mobilityVehicleMarkers:0,ownedBranches:'retained'},null,2));
