'use strict';
// BUILD282: يمنع رجوع بطاقة القسم المكررة في تبويب عمليات power/bank.
//
// الجذر: قالب تبويب operations في companyView() يعرض departmentLifeCard(type,ctx) مرة واحدة
// صراحة، ثم - لـpower وbank تحديدًا - يستدعي renderEnergy(ctx)/renderBank(ctx) اللتان تعرضان
// نفس departmentLifeCard(type,ctx) داخليًا مرة أخرى في نهاية جسمهما. النتيجة: بطاقة "دورة القسم"
// بزريها "تشغيل دورة القسم" و"رفع التقرير للإدارة" تظهر مرتين متتاليتين على نفس الصفحة، لنفس
// dept، بلا أي فرق بين النسختين - أعطل من زر mobility-buy-fleet المكرر لأنه تكرار محتوى كامل
// لا زر واحد.
//
// الإصلاح: تخطي الاستدعاء الصريح فقط لـpower/bank (يستقبلانها داخليًا أصلًا)، مع إبقائه لـ
// air/sea/road كما هو. renderBank/renderEnergy أنفسهما لم يُمسّا - القسم المستقل bank/energy
// (الذي يستدعيهما مباشرة بلا استدعاء خارجي سابق) يبقى يعرض البطاقة مرة واحدة كما كان.
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

// ---- power/bank: البطاقة تظهر مرة واحدة فقط في تبويب عمليات كل منهما ----
for (const type of ['power', 'bank']) {
  click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
  click(`[data-open="companyManage"][data-arg="${type}"]`); click('[data-company-manage-tab="operations"]');
  const reviewCount = sel('[data-gh-action="department-review"]').length;
  const escalateCount = sel('[data-gh-action="department-escalate"]').length;
  assert.strictEqual(reviewCount, 1, `${type} operations tab must show department-review exactly once, found ${reviewCount}`);
  assert.strictEqual(escalateCount, 1, `${type} operations tab must show department-escalate exactly once, found ${escalateCount}`);
}

// ---- air/sea/road: لم يتأثروا، ما زالوا يعرضون البطاقة مرة واحدة كما قبل الإصلاح ----
for (const type of ['air', 'sea', 'road']) {
  click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
  click(`[data-open="companyManage"][data-arg="${type}"]`); click('[data-company-manage-tab="operations"]');
  const reviewCount = sel('[data-gh-action="department-review"]').length;
  assert.strictEqual(reviewCount, 1, `${type} operations tab must still show department-review exactly once (untouched path), found ${reviewCount}`);
}

// ---- التحقق أن المحتوى الحقيقي لـrenderEnergy/renderBank لم يُفقد بالخطأ ----
{
  click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
  click('[data-open="companyManage"][data-arg="bank"]'); click('[data-company-manage-tab="operations"]');
  assert.ok(sel('[data-gh-action="bank-stress"]').length > 0, 'renderBank real content (bank-stress action) must still render');
}
{
  click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
  click('[data-open="companyManage"][data-arg="power"]'); click('[data-company-manage-tab="operations"]');
  assert.ok((window.document.getElementById('drawerBody')?.textContent || '').length > 100,
    'renderEnergy content must still render for power');
}

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('duplicate-department-card-build282-test: ok');
process.exit(0);
