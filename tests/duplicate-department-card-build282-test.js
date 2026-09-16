'use strict';
// BUILD282/303: يمنع رجوع بطاقة القسم أو مركز التشغيل المكرر في power/bank.
// تبويب عمليات الشركة يعرض رابطًا واحدًا إلى المالك التشغيلي الموحد، بينما تبقى دورة القسم
// للأقسام التي لا تملك مركزًا مستقلًا. هذا الحارس يفحص الهيكل النهائي بدل فرض الواجهة القديمة.
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
const click = sel => { const el = window.document.querySelector(sel); if (el) el.dispatchEvent(new window.Event('click', { bubbles: true })); return !!el; };
const sel = s => [...window.document.querySelectorAll(s)];

click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
const moneyInput = window.document.getElementById('addMoneyInput');
moneyInput.value = '500000000000';
click('#addMoneyBtn');
for (const f of sel('.open-company')) f.dispatchEvent(new window.Event('click', { bubbles: true }));

// ---- power/bank: لا نسخة تشغيل مضمّنة؛ رابط واحد فقط إلى المركز الموحد ----
for (const type of ['power', 'bank']) {
  click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
  click(`[data-open="companyManage"][data-arg="${type}"]`); click('[data-company-manage-tab="operations"]');
  const reviewCount = sel('[data-gh-action="department-review"]').length;
  const escalateCount = sel('[data-gh-action="department-escalate"]').length;
  const unifiedCount = sel(`[data-open="${type === 'power' ? 'energy' : 'bank'}"]`).length;
  assert.strictEqual(reviewCount, 0, `${type} operations tab must not embed a second department-review, found ${reviewCount}`);
  assert.strictEqual(escalateCount, 0, `${type} operations tab must not embed a second department-escalate, found ${escalateCount}`);
  assert.strictEqual(unifiedCount, 1, `${type} operations tab must show one unified-center link, found ${unifiedCount}`);
}

// ---- air/sea/road: لم يتأثروا، ما زالوا يعرضون البطاقة مرة واحدة كما قبل الإصلاح ----
for (const type of ['air', 'sea', 'road']) {
  click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
  click(`[data-open="companyManage"][data-arg="${type}"]`); click('[data-company-manage-tab="operations"]');
  const reviewCount = sel('[data-gh-action="department-review"]').length;
  assert.strictEqual(reviewCount, 1, `${type} operations tab must still show department-review exactly once (untouched path), found ${reviewCount}`);
}

// ---- التحقق أن المركزين الموحدين ما زالا يعرضان المحتوى التشغيلي الحقيقي ----
{
  click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
  click('[data-open="companyManage"][data-arg="bank"]'); click('[data-company-manage-tab="operations"]');
  click('[data-open="bank"]');
  assert.strictEqual(sel('[data-gh-action="bank-stress"]').length, 1, 'the unified bank center must retain its stress-test action exactly once');
}
{
  click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
  click('[data-open="companyManage"][data-arg="power"]'); click('[data-company-manage-tab="operations"]');
  click('[data-open="energy"]');
  assert.strictEqual(sel('.energy-build').length, 4, 'the unified energy center must retain the four project choices exactly once');
}

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('duplicate-department-card-build282-test: ok');
process.exit(0);
