'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const app=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8'),start=app.indexOf('  function mapStructureSignature(){'),end=app.indexOf('\n',start),source=app.slice(start,end).trim();
assert(start>=0&&end>start);assert.doesNotMatch(source,/\.map\(|\.filter\(|for\s*\(/,'structural polling must not scan the fleet, mobility vehicles, or facilities');
const state={saveRevision:7,assets:new Proxy({length:20000},{get(target,key){if(key===Symbol.iterator||key==='map'||key==='filter')throw new Error('map-structure-poll-scanned-20k-assets');return Reflect.get(target,key);}}),mobility:{vehicles:new Proxy({length:0},{get(target,key){if(key==='length')throw new Error('map-structure-poll-read-mobility-vehicles');return Reflect.get(target,key);}})}};
const window={GH_MAP_STRUCTURE_REVISION:3,GH_MOBILITY_CORE:{mapStructureRevision:()=>11}},context={state,map:{getZoom:()=>6},window,currentMapFilter:()=>({companies:{mode:'all',included:[],excluded:[]}}),selectedAssetId:null,selectedMobilityId:null,selectedFacilityId:null};
const signature=vm.runInNewContext(`(()=>{${source};return mapStructureSignature;})()`,context,{filename:'map-structure-revision.js'});
const initial=signature();assert.equal(signature(),initial,'same state and revisions produce a stable structural key');
state.saveRevision++;assert.notEqual(signature(),initial,'a committed durable command invalidates the structure key');
const afterDurable=signature();window.GH_MAP_STRUCTURE_REVISION++;assert.notEqual(signature(),afterDurable,'simulation route, phase, base, delivery, or fleet-count transitions invalidate the key');
const afterFleet=signature();window.GH_MOBILITY_CORE.mapStructureRevision=()=>12;assert.equal(signature(),afterFleet,'mobility dispatch and completion transitions do not invalidate the map key');
context.selectedMobilityId='MOB-1';assert.equal(signature(),afterFleet,'a selected mobility vehicle does not invalidate the map key');
const intervalSource=app.match(/  function presentationFrameInterval\(\)\{[^\n]+/)[0],intervalContext={window:{GH_FLEET_DATA:{size:()=>0}},state,document:{hidden:false},activeDrawerPanel:null,simulationEngine:{snapshot:()=>({manualAdvance:false})}},frameInterval=vm.runInNewContext(`(()=>{${intervalSource};return presentationFrameInterval;})()`,intervalContext);
assert.equal(frameInterval(),55,'a large Mobility fleet does not reduce map presentation cadence when its vehicles are hidden');
console.log('PASS map structure polling is O(1), ignores mobility movement, and follows displayed structure revisions');
