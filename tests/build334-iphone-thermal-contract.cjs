'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const app=fs.readFileSync(path.resolve(__dirname,'../WebApp/app.js'),'utf8');
assert(app.includes('frameBudgetMs:4,manualFrameBudgetMs:10,chunkItems:32,manualChunkItems:64'));
// Build 358 (save policy): the engine has no save cadence; checkpoints are owned by GH_SAVE_POLICY.
assert(!app.includes('persistEvery')&&app.includes('maybeSaveCheckpoint(now);'));
assert(app.includes('maintenanceEveryHours:12'));
assert(app.includes('fleetSize>3000)return 220'));
assert(app.includes('mapStructureInterval=fleetSizeForMap>3000?30000'));
// One shared Canvas/pool is redrawn from no more than 300 geographically allocated proxies; the simulation still owns
// every logical asset and the presentation pass only updates the bounded adapters.
assert(app.includes("map.createPane('vehicleCanvas')")&&app.includes('GH_MAP_VEHICLE_CANVAS?.create?.({map,container:vehiclePane,hardLimit:300,dprCap:2'));
assert(app.includes('const limit=Math.min(300,MAP_VIEW.budget(\'vehicles\',zoom))'));
assert(app.includes('allocator=window.GH_MAP_PROXY_CORE')&&app.includes('allocator.allocate(unique,'));
assert(app.includes('renderAllocatedVehicles(vehicleCandidates,zoom)'));
assert(app.includes('mapVehicleCanvas.add(candidate.id,')&&app.includes('mapVehicleCanvas?.draw?.()'));
assert(app.includes('presentationAssetLookup()'));
assert(app.includes('let mapStatusCache={assetKey:'));
assert(app.includes('if(mapStatusCache.assetKey!==assetKey)'));
console.log(JSON.stringify({suite:'iphone-thermal-contract',passed:13,total:13},null,2));
