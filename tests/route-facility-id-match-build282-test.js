'use strict';
// BUILD282: يمنع رجوع عطل خطير - كل المسارات الجاهزة المقترحة كانت غير قابلة للاستخدام لأي قاعدة
// يفتحها اللاعب فعليًا، وكانت تُسقط حلقة المحاكاة بخطأ قاتل عند محاولة المغادرة التلقائية.
//
// الجذر: المسارات الثابتة الجاهزة (routeTemplates، مثل AIR_RUH_LHR) تشير لمرجع ثابت عام
// ('AP-RUH')، بينما القاعدة التي يفتحها اللاعب فعليًا عبر openGlobalBase() تحصل على معرّف مبني
// مختلف تمامًا ('BASE-AIR-RUH-1') - نفس المطار جغرافيًا وبنفس كود IATA، لكن معرّفان مختلفان.
// أربعة مواضع كانت تقارن هذين المعرّفين بالتساوي الحرفي فقط:
//  1) assignRoute() - بوابة الفحص الأولى، ترفض بإشعار "الأصل ليس موجودًا في إحدى نقطتي هذا المسار"
//  2) إرسال أمر 'fleet','assign-route' نفسه - يرفض بـ route-assignment-contract حتى لو تجاوزت (1)
//  3) processAssetDraft داخل حلقة المحاكاة - المغادرة التلقائية تُلقي route-departure-contract غير
//     مُمسوكة، فتُسقط حلقة المحاكاة بالكامل (هذا الأخطر: يوقف اللعبة عن العمل لا يرفض عملية واحدة)
//  4) زرا المغادرة اليدوية
//
// الإصلاح: مطابقة عبر كود المطار/الميناء الحقيقي (IATA/ICAO/code) بدل المعرّف الخام، مع نسخة غير
// معدِّلة للقالب المشترك (routeTemplates تبقى كما هي لكل اللاعبين/الأصول الأخرى التي قد تستخدم
// نفس المسار من قاعدة مختلفة).
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
const vc = { t: 1000 };
Object.defineProperty(window, 'performance', { configurable: true, value: { now: () => vc.t, timeOrigin: 0, mark(){}, measure(){}, getEntriesByType: () => [] } });
window.Date.now = () => 1700000000000 + Math.round(vc.t);
const rafQ = [];
window.requestAnimationFrame = cb => { rafQ.push(cb); return rafQ.length; };
window.cancelAnimationFrame = () => {};
window.__pump = (ms = 16, n = 1) => { for (let i = 0; i < n; i++) { vc.t += ms; const q = rafQ.splice(0, rafQ.length); for (const cb of q) { try { cb(vc.t); } catch (e) { uncaught.push('rAF: ' + (e.stack || e.message)); } } } };
for (const f of [...raw.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s))) {
  window.eval(fs.readFileSync(path.join(WEBAPP, f), 'utf8'));
}
const S = () => window.__GH_STATE__;
const D = window.document;
const click = sel => { const el = D.querySelector(sel); if (el) el.dispatchEvent(new window.Event('click', { bubbles: true })); return !!el; };

click('#skipFounder');
click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
const moneyInput = D.getElementById('addMoneyInput'); moneyInput.value = '500000000000'; click('#addMoneyBtn');
for (const f of [...D.querySelectorAll('.open-company')]) f.dispatchEvent(new window.Event('click', { bubbles: true }));
const st = S();

click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
click('[data-open="companyManage"][data-arg="air"]'); click('[data-company-manage-tab="assets"]');
click('[data-open="companyFacilities"][data-arg="air"]');
click('.open-global-base');
const base = st.globalBases[0];
assert.strictEqual(base.iata, 'RUH', 'the opened base must be Riyadh (matching the static AIR_RUH_LHR route origin)');
assert.notStrictEqual(base.id, 'AP-RUH', 'a player-opened base must have its own constructed id, distinct from the static reference facility');

window.GH_FINANCE_CORE.execute({ state: st }, 'transfer', { from: 'group', to: 'air', amount: 500000000, note: 'test' });
const item = window.GH_ASSET_CATALOG.air.new.find(x => x.id === 'N-A22'); // long-range widebody, fits the 4,940km route
window.GH_DOMAIN_COMMANDS.dispatch({ state: st }, 'procurement', 'purchase-assets', {
  type: 'air', tab: 'new', item, mode: 'cash', qty: 1, base, supplier: { legalName: 'Test' }, manual: true,
  upfront: item.price, totalPrice: item.price, paymentMethod: 'شيك مصدق', documentLeadDays: 1, leadSeconds: 60, companyName: 'test'
});
window.GH_REALISM.onSimulationTime(st, st.realism.procurement.deliveries[0].dueAtSeconds + 10);
const asset = st.assets[0];
assert.strictEqual(asset.baseFacility, base.id, 'the delivered asset must be based at the player-opened facility id');

// ---- 1) تعيين مسار جاهز ثابت (AIR_RUH_LHR) لأصل قاعدته معرّفها مختلف عن fromFacility الثابت ----
click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
click('[data-open="companyManage"][data-arg="air"]'); click('[data-company-manage-tab="assets"]');
click(`[data-open="assetManage"][data-arg="${asset.id}"]`);
click('[data-open="routes"]') || [...D.querySelectorAll('[data-open]')].find(e => e.textContent?.includes('فتح مركز المسارات'))?.dispatchEvent(new window.Event('click', { bubbles: true }));
const chooseBtn = [...D.querySelectorAll('button')].find(e => e.textContent?.trim() === 'اختيار مسار');
assert.ok(chooseBtn, 'a route-choice entry point must exist for the delivered asset');
chooseBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
const assignBtn = [...D.querySelectorAll('button.choose-route')].find(b => b.dataset.route === 'AIR_RUH_LHR');
assert.ok(assignBtn, 'the pre-baked Riyadh -> London route must be offered as a suggestion');
assignBtn.dispatchEvent(new window.Event('click', { bubbles: true }));

assert.strictEqual(asset.routeId, 'AIR_RUH_LHR', 'the route must actually be assigned despite the facility-id mismatch');
assert.strictEqual(asset.phase, 'turnaround', 'the asset must be ready to depart, not silently rejected');

// ---- 2) المحاكاة التلقائية يجب ألا تُسقط بخطأ قاتل عند المغادرة - هذا كان يوقف اللعبة بالكامل ----
st.speed = 4;
assert.doesNotThrow(() => { for (let i = 0; i < 50; i++) window.__pump(2000, 1); },
  'automatic departure inside the simulation loop must not throw route-departure-contract');
assert.strictEqual(asset.phase, 'moving', 'the asset must actually depart automatically once assigned and crewed');
assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);

// ---- 3) لا مطابقة زائفة: مطاران مختلفان فعليًا يجب ألا يُعتبَرا نفس المنشأة ----
const secondBase = { id: 'BASE-AIR-TEST-2', kind: 'airport-base', iata: 'DXB', icao: 'OMDB', code: 'DXB' };
st.globalBases.push(secondBase);
const fakeAssetAtDXB = { ...asset, id: 'FAKE-ASSET-DXB', baseFacility: secondBase.id, routeId: null, phase: 'idle' };
st.assets.push(fakeAssetAtDXB);
click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
click('[data-open="companyManage"][data-arg="air"]'); click('[data-company-manage-tab="assets"]');
click(`[data-open="assetManage"][data-arg="${fakeAssetAtDXB.id}"]`);
[...D.querySelectorAll('[data-open]')].find(e => e.textContent?.includes('فتح مركز المسارات'))?.dispatchEvent(new window.Event('click', { bubbles: true }));
const chooseBtn2 = [...D.querySelectorAll('button')].find(e => e.textContent?.trim() === 'اختيار مسار');
if (chooseBtn2) {
  chooseBtn2.dispatchEvent(new window.Event('click', { bubbles: true }));
  const wrongAssign = [...D.querySelectorAll('button.choose-route')].find(b => b.dataset.route === 'AIR_RUH_LHR');
  if (wrongAssign) wrongAssign.dispatchEvent(new window.Event('click', { bubbles: true }));
}
assert.strictEqual(fakeAssetAtDXB.routeId, null,
  'an asset based at Dubai must NOT be allowed onto the Riyadh->London route - the fix must not create false-positive matches');

console.log('route-facility-id-match-build282-test: ok');
process.exit(0);
