'use strict';
// BUILD282: يمنع رجوع "القاعدة الجديدة لا تظهر على الخريطة" - السبب الجذري الفعلي.
//
// المُعلَّم/العلامة كانت تُرسم بشكل صحيح دائمًا (belongsToPlayer تُقيَّم صحيحة لأي قاعدة مفتوحة
// فعليًا، تحقّقنا من هذا مباشرة). المشكلة الحقيقية: الكاميرا لا تتحرك أبدًا لموقع القاعدة الجديدة -
// موبيليتي فقط كانت تحصل على panMapTo() عند فتح مركز. الجوي والبحري (openGlobalBase) والبري
// (openLogisticsHubAI) كانا بلا أي تحريك كاميرا، فالعلامة الصحيحة تُرسم بعيدة تمامًا عن الشاشة وسط
// 28,291 مطارًا و3,930 ميناءً مرجعيًا - عمليًا غير قابلة للاكتشاف دون معرفة مسبقة بموقعها بالضبط.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WEBAPP = path.join(__dirname, '..', 'WebApp');
const raw = fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8');
const dom = new JSDOM(raw.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, ''), {
  url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true
});
const { window } = dom;
const setViewCalls = [];
window.L = (() => {
  const chain = () => stub;
  const stub = { addTo: chain, on: chain, off: chain, remove: chain, setLatLng: chain, setStyle: chain,
    bindPopup: chain, bindTooltip: chain, openPopup: chain, closePopup: chain, setIcon: chain,
    getLatLng: () => [0, 0], invalidateSize: chain, fitBounds: chain, removeLayer: chain, addLayer: chain,
    eachLayer() {}, clearLayers: chain, getBounds: () => ({ contains: () => true }), getZoom: () => 3,
    setView: (coords, zoom) => { setViewCalls.push([coords, zoom]); return stub; } };
  return { map: () => stub, tileLayer: () => stub, layerGroup: () => stub, featureGroup: () => stub,
    marker: () => stub, circleMarker: () => stub, circle: () => stub, polyline: () => stub, polygon: () => stub,
    divIcon: o => ({ options: o }), icon: () => ({}), svg: () => stub, canvas: () => stub,
    control: { layers: () => stub, zoom: () => stub }, geoJSON: () => stub, latLng: (a, b) => [a, b],
    latLngBounds: () => stub, Browser: { mobile: false, touch: false }, version: 'stub' };
})();
window.matchMedia = window.matchMedia || (q => ({ matches: false, media: q, addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }));
const uncaught = [];
window.addEventListener('error', e => uncaught.push(e.error?.message || e.message));
for (const f of [...raw.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s))) {
  window.eval(fs.readFileSync(path.join(WEBAPP, f), 'utf8'));
}
const S = () => window.__GH_STATE__;
const D = window.document;
const click = sel => { const el = D.querySelector(sel); if (el) el.dispatchEvent(new window.Event('click', { bubbles: true })); return !!el; };

click('#skipFounder');
click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
const moneyInput = D.getElementById('addMoneyInput');
moneyInput.value = '500000000000';
click('#addMoneyBtn');
for (const f of [...D.querySelectorAll('.open-company')]) f.dispatchEvent(new window.Event('click', { bubbles: true }));

// ---- فتح قاعدة جوية يجب أن يحرّك الكاميرا لموقعها بالضبط ----
click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
click('[data-open="companyManage"][data-arg="air"]'); click('[data-company-manage-tab="assets"]');
click('[data-open="companyFacilities"][data-arg="air"]');
setViewCalls.length = 0;
click('.open-global-base');
const base = S().globalBases[0];
assert.ok(base, 'a base must actually be opened');
assert.strictEqual(setViewCalls.length, 1, `opening an air base must move the camera exactly once, got ${setViewCalls.length}`);
assert.deepStrictEqual(setViewCalls[0][0], base.coords,
  `the camera must move to the exact coordinates of the newly opened base: expected ${JSON.stringify(base.coords)}, got ${JSON.stringify(setViewCalls[0][0])}`);

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('map-camera-follow-new-base-build282-test: ok');
process.exit(0);
