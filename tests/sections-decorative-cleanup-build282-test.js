'use strict';
// BUILD282: يزيل زرًا مكررًا وتبويبًا فارغًا اكتُشفا أثناء مراجعة عمق الأقسام والخيارات.
//
// 1) mobility-core.js render(): كان يعرض زرين منفصلين بنفس data-gh-action="mobility-buy-fleet"
//    (نفس الكمية 48 مركبة، نفس المدينة) في نفس صفحة تبويب operations - أحدهما في ترويسة الملخص
//    والآخر داخل قائمة الأسطول. تكرار بلا داعٍ لنفس الفعل بالضبط.
//
// 2) advanced-core.js companyView(): شريط تبويبات إدارة الشركة كان يعرض تبويب "AI الشركة" لكل
//    الأنواع الستة دون شرط، لكن جسم التبويب لا يحوي أي فعل أو تنقّل إطلاقًا لـpower وbank تحديدًا -
//    تبويب فارغ تمامًا يظهر ويُنقر عليه بلا أي نتيجة. أُخفي التبويب لهذين النوعين فقط، مع سقوط آمن
//    لو وصل إليه طلب قديم بتبويب "ai" نشط (active كان جزءًا من إعلان const مشترك مع type/m، فصلته
//    إلى let منفصل حتى يقبل إعادة التعيين - نفس فخ let/const المذكور في ملف التسليم).
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
click('[data-companytab="subs"]'); click('[data-gh-action="mobility-launch"]');

// ---- 1) لا زر مكرر لنفس الفعل في تبويب عمليات موبيليتي ----
{
  click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
  click('[data-open="companyManage"][data-arg="mobility"]'); click('[data-company-manage-tab="operations"]');
  const buyButtons = sel('[data-gh-action="mobility-buy-fleet"]');
  assert.strictEqual(buyButtons.length, 1,
    `expected exactly one mobility-buy-fleet button, found ${buyButtons.length}`);
}

// ---- 2) تبويب AI مخفي لـpower وbank، وموجود لبقية الأنواع ----
{
  const expectAi = { air: true, sea: true, road: true, power: false, bank: false, mobility: true };
  for (const [type, shouldHaveAi] of Object.entries(expectAi)) {
    click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
    click(`[data-open="companyManage"][data-arg="${type}"]`);
    const aiTab = window.document.querySelector('[data-company-manage-tab="ai"]');
    assert.strictEqual(!!aiTab, shouldHaveAi,
      `company type "${type}": AI tab presence should be ${shouldHaveAi}, got ${!!aiTab}`);
  }
}

// ---- 3) الأنواع التي تحتفظ بتبويب AI ما زالت تعرضه بمحتوى فعلي (لم يُكسر التصفية بالخطأ) ----
{
  click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
  click('[data-open="companyManage"][data-arg="air"]'); click('[data-company-manage-tab="ai"]');
  const hasAction = !!window.document.querySelector('[data-gh-action="ai-company-route-review"]');
  assert.ok(hasAction, 'air company AI tab must still render its real action after the filter');
}

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('sections-decorative-cleanup-build282-test: ok');
process.exit(0);
