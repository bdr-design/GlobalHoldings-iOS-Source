'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// يتحقق من طلب صريح: هل Mobility (الشركة المضافة حديثًا) تظهر فعليًا على الخريطة مع بقية
// الشركات (مراكزها كعلامات منشآت، ومركباتها كنقاط)، وهل لها تبويب أصول/سيارات فعلي؟
const WEBAPP = path.join(__dirname, '..', 'WebApp');
const html = fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom;

const calls = { facilityMarkers: [], vehicleMarkers: 0 };
window.L = (() => {
  const chain = () => stub;
  const stub = { addTo: chain, on: chain, off: chain, remove: chain, setLatLng: chain, setStyle: chain, bindPopup: chain, bindTooltip: chain, openPopup: chain, closePopup: chain, setIcon: chain, getLatLng: () => [0, 0], invalidateSize: chain, fitBounds: chain, removeLayer: chain, addLayer: chain, eachLayer() {}, clearLayers: chain, getBounds: () => ({ contains: () => true }), getZoom: () => 3, setView: () => stub };
  return {
    map: () => stub, tileLayer: () => stub, layerGroup: () => stub, featureGroup: () => stub,
    marker: (coords, opts) => { calls.facilityMarkers.push({ coords, className: opts?.icon?.options?.className }); return stub; },
    circleMarker: () => { calls.vehicleMarkers++; return stub; },
    circle: () => stub, polyline: () => stub, polygon: () => stub,
    divIcon: opts => ({ options: opts }), icon: () => ({}), svg: () => stub, canvas: () => stub,
    control: { layers: () => stub, zoom: () => stub }, geoJSON: () => stub,
    latLng: (a, b) => [a, b], latLngBounds: () => stub, Browser: { mobile: false, touch: false }, version: 'stub',
  };
})();
window.matchMedia = window.matchMedia || (q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }));
const uncaught = [];
window.addEventListener('error', e => uncaught.push(e.error?.message || e.message));

const scripts = [...fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
for (const file of scripts) window.eval(fs.readFileSync(path.join(WEBAPP, file), 'utf8'));
assert.strictEqual(uncaught.length, 0, 'boot must be clean');

const click = sel => { const el = window.document.querySelector(sel); assert(el, `expected element: ${sel}`); el.dispatchEvent(new window.Event('click', { bubbles: true })); };
const S = window.__GH_STATE__;

click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
window.document.getElementById('addMoneyInput').value = '1000000000000';
click('#addMoneyBtn');
click('.open-company[data-type="mobility"]');
click('[data-companytab="subs"]');
click('[data-open="companyManage"][data-arg="mobility"]');

// 1) تبويب الأصول لشركة Mobility يجب أن يعرض سجل الأسطول الفعلي (سيارات)، بنفس بنية تبويب
// الأصول المشتركة مع كل الشركات الأخرى - لا مسارًا منفصلًا أو ناقصًا.
click('[data-company-manage-tab="assets"]');
const assetsHtml = window.document.getElementById('drawerBody').innerHTML;
assert(assetsHtml.includes('سجل أسطول GH Mobility'), 'Mobility must show its real vehicle fleet under the shared Assets tab');

// 2) إطلاق الأسطول ثم التأكد من ظهور المركبات على الخريطة تحت فلتر Mobility، وظهور مركز
// عاصمة مفتوح كعلامة منشأة تحت فلتر "الكل" تمامًا مثل أي شركة أخرى.
click('[data-company-manage-tab="operations"]');
click('[data-gh-action="mobility-launch"]');
assert.strictEqual(S.mobility.status, 'active');

S.mobility.capitalCenters.push({ id: 'MOB-CENTER-LON', capitalId: 'LON', city: 'لندن', country: 'UK', coords: [51.5074, -0.1278], facilityId: 'MOB-CENTER-LON', openedAt: S.simSeconds });
S.customHubs.push({ id: 'MOB-CENTER-LON', sourceKey: 'MOB-CENTER-LON', company: 'mobility', kind: 'mobility-center', owned: true, name: 'مركز لندن', city: 'لندن', country: 'UK', coords: [51.5074, -0.1278] });

calls.facilityMarkers = [];
click('.filter-btn[data-filter="all"]');
assert(calls.facilityMarkers.some(m => Math.abs(m.coords[0] - 51.5074) < 0.01), 'an opened Mobility capital center must render a facility marker on the map exactly like any other company\u2019s facility');

calls.vehicleMarkers = 0;
click('.filter-btn[data-filter="mobility"]');
assert(calls.vehicleMarkers > 0, 'Mobility vehicles must render on the map under the dedicated GH Mobility filter');

console.log('Mobility parity on map + assets tab BUILD270: PASS');
process.exit(0);
