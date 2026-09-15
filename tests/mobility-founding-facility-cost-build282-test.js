'use strict';
// BUILD282: يمنع رجوع منشأة مجانية عند تأسيس GH Mobility.
//
// الجذر: تأسيس شركة mobility كان يُنشئ فورًا مركز GH Mobility بالرياض (480 موقفًا، تكلفة تشغيل
// يومية $9,800) بـ cost:0 وgroupValueAdd:0 صراحة، متجاوزًا awardConstruction() الذي تمر منه كل
// نقاط إنشاء المنشآت الأخرى في المستودع (تحقق من كفاية الرصيد، مناقصة، مقاول، عقد، دفعة مورد).
// النتيجة: أصل حقيقي بلا أي أثر مالي - لا فاتورة، لا عقد إنشاء، لا خصم من رأس المال المؤسِّس.
//
// الإصلاح: تمريرها عبر نفس awardConstruction('mobility','mobility-center',...) المستخدم لبقية
// مراكز موبيليتي (بسعر أساس 4 أضعاف مركز عادي 120 موقفًا، تناسبًا مع سعة الرياض 480 موقفًا)،
// وgroupValueAdd:build.amount*.72 مطابقًا لنفس نمط الأنماط الثلاثة الأخرى في المستودع.
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

const groupValueBefore = S().groupValue;
const mobilityFounder = sel('.open-company').find(e => e.dataset.type === 'mobility');
assert.ok(mobilityFounder, 'mobility founder card must exist');
mobilityFounder.dispatchEvent(new window.Event('click', { bubbles: true }));

// ---- 1) المنشأة موجودة وتحمل تكلفة حقيقية، لا صفر ----
const facility = S().customHubs.find(f => f.id === 'MOB-CENTER-RUH');
assert.ok(facility, 'the Riyadh mobility center must still be created automatically on founding');
assert.ok(Number(facility.cost) > 0, `facility cost must be a real positive number, got ${facility.cost}`);
assert.ok(facility.constructionContractId, 'facility must reference a real construction contract id');
assert.ok(facility.contractor, 'facility must have a real contractor assigned');

// ---- 2) عقد إنشاء حقيقي مسجَّل في constructionContracts ----
const contract = S().constructionContracts.find(c => c.id === facility.constructionContractId);
assert.ok(contract, 'a matching construction contract must exist in state.constructionContracts');
assert.strictEqual(contract.company, 'mobility', 'contract must belong to the mobility company');
assert.strictEqual(Number(contract.amount), Number(facility.cost), 'contract amount must match facility cost');

// ---- 3) معاملة مورد حقيقية (دفعة فعلية) ----
const payment = S().supplierTransactions.find(t => t.company === 'mobility' && t.reference === contract.paymentRef);
assert.ok(payment, 'a real supplier payment transaction must be recorded for the RUH facility');
assert.strictEqual(Number(payment.amount), Number(facility.cost), 'payment amount must match facility cost');

// ---- 4) رأس مال الشركة انخفض فعليًا بمقدار التكلفة (لا معاملة مجانية) ----
const mobilityBalance = Number(S().companyFinance?.mobility?.accounts?.[0]?.balance || 0);
const expectedBalance = 120000000 - Number(facility.cost); // 120M = رأس مال تأسيس mobility
assert.strictEqual(mobilityBalance, expectedBalance,
  `mobility operating balance must reflect founding capital minus the real facility cost: expected ${expectedBalance}, got ${mobilityBalance}`);

// ---- 5) قيمة المجموعة اعتُمدت تناسبيًا مع التكلفة الفعلية، لا صفرًا ثابتًا ----
const groupValueDelta = Number(S().groupValue) - groupValueBefore;
const expectedGroupValueDelta = 120000000 * .82 + Number(facility.cost) * .72;
assert.strictEqual(groupValueDelta, expectedGroupValueDelta,
  `groupValue credit must include both founding capital and facility cost shares: expected ${expectedGroupValueDelta}, got ${groupValueDelta}`);

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('mobility-founding-facility-cost-build282-test: ok');
process.exit(0);
