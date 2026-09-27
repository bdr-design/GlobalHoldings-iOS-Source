'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const map= require('../WebApp/map-presentation-core');
const app=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8');

assert.equal(map.minimumWorldZoom(256),0);
assert(Math.abs(map.minimumWorldZoom(430)-Math.log2(430/256))<1e-12,'phone width determines the fractional world-fit zoom');
assert.equal(map.minimumWorldZoom(1024),2);
assert.equal(map.minimumWorldZoom(1920),2,'wide viewports retain the supported cap while showing the full world');
assert.equal(map.minimumWorldZoom(0),0);
assert(app.includes("minimumWorldZoom=window.GH_MAP_PRESENTATION_CORE.minimumWorldZoom($('map').clientWidth"));
assert(app.includes('minZoom:minimumWorldZoom,maxZoom:19'));
assert(app.includes('maxBounds:[[-85.05112878,-180],[85.05112878,180]],maxBoundsViscosity:1'));
assert(app.includes('localTerrainLayer.options.minZoom=minimumWorldZoom'));
console.log('Build342 map bounds: viewport-derived full-world minimum zoom and hard geographic limits PASS');
