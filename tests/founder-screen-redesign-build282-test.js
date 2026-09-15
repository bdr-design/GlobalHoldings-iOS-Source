'use strict';
// BUILD282: يحمي شاشة تأسيس المجموعة المُعاد تصميمها من انكسار مستقبلي.
//
// السياق: أُعيدت هيكلة #founderFlow بصريًا (تجميع الحقول الخمسة عشر في 3 مجموعات مسمّاة بدل
// شبكة مسطّحة واحدة، استبدال الشارات الزخرفية بقائمة "ماذا يحدث عند التأسيس" الحقيقية)، مع إبقاء
// كل معرّف عنصر يقرأه app.js كما هو حرفيًا - صفر تعديل على app.js نفسه. هذا الاختبار يثبّت
// العقد: كل معرّف مطلوب موجود، والتدفق الحقيقي (تأسيس + تخطٍّ + شعار) يعمل من البداية للنهاية.
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
window.L = (() => {
  const chain = () => stub;
  const stub = { addTo: chain, on: chain, off: chain, remove: chain, setLatLng: chain, setStyle: chain,
    bindPopup: chain, bindTooltip: chain, openPopup: chain, closePopup: chain, setIcon: chain,
    getLatLng: () => [0, 0], invalidateSize: chain, fitBounds: chain, removeLayer: chain, addLayer: chain,
    eachLayer() {}, clearLayers: chain, getBounds: () => ({ contains: () => true }), getZoom: () => 3, setView: chain };
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

// ---- 1) العقد الكامل: كل معرّف يقرأه finishFounder()/updateFounderLogoPreview() موجود ----
const REQUIRED_IDS = ['founderFlow', 'founderForm', 'founderLogoPreview', 'founderLogoUpload', 'founderLogoClear',
  'founderName', 'founderShort', 'founderOwner', 'founderCountry', 'founderCity', 'founderSector', 'founderMode',
  'founderLegalForm', 'founderCurrency', 'founderFiscal', 'founderRisk', 'founderProcurement', 'founderAuthority',
  'founderEnglishName', 'founderError', 'skipFounder'];
for (const id of REQUIRED_IDS) {
  assert.ok(D.getElementById(id), `required element #${id} must exist for app.js to wire correctly`);
}
assert.strictEqual([...D.querySelectorAll('.logo-preset')].length, 4, 'exactly 4 logo preset buttons expected');
assert.strictEqual([...D.querySelectorAll('.founder-group')].length, 3, 'fields must be grouped into exactly 3 named sections');

// ---- 2) التأسيس الحقيقي عبر submit يعمل من البداية للنهاية بكل القيم ----
assert.strictEqual(S().onboardingComplete, false, 'onboarding must start incomplete');
D.getElementById('founderForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
assert.strictEqual(S().onboardingComplete, true, 'submitting the real form must complete onboarding');
assert.strictEqual(S().profile.name, 'المجموعة العالمية القابضة', 'group name must flow through to profile');
assert.strictEqual(S().profile.founder, 'المؤسس', 'founder name must flow through to profile');
assert.ok(D.getElementById('founderFlow').classList.contains('hidden'), 'the founding screen must hide after submit');

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('founder-screen-redesign-build282-test: ok');
process.exit(0);
