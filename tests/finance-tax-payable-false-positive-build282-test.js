'use strict';
// BUILD282: يمنع رجوع رفض كاذب لأوامر بنكية سليمة بسبب مقارنة خاطئة في فحص التكامل.
//
// الجذر: FINANCE_TAX_PAYABLE_MISMATCH_<company> يقارن book.taxPayable (تراكم VAT حي يُحسب فور كل
// معاملة دخل/مصروف خاضعة، من finance-core.js invoice()) مع مجموع state.finance.periods (سجلات لا
// تُنشأ إلا عند إغلاق اليوم عبر closeFinancials). قبل أول إغلاق يوم لأي شركة، هذان مصدران مختلفان
// بالتصميم - لا عطل. لكن الفحص كان يقارنهما دائمًا، فأول إيراد خاضع لأي شركة (مثل عمولة
// banking:draw-facility أو banking:trade-instrument التي تُدخل bank عبر credit()) يُنتج عطلاً حرجًا
// جديدًا فورًا، والمُوزّع المركزي يرفض الأمر بالكامل (rollback) - رغم أن لا شيء خاطئ فعليًا.
//
// الإصلاح: تخطي المقارنة فقط حين لا توجد أي فترة مسجَّلة بعد لتلك الشركة (لا أساس تُقارن به أصلاً)،
// مع إبقاء الفحص فعّالاً بمجرد وجود فترة حقيقية - انحراف فعلي عن فترة موجودة يبقى يُكتشف.
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
const criticalIds = () => {
  const r = window.GH_INTEGRITY_CORE.check(S());
  const crit = r.critical || (r.issues || []).filter(x => x.severity === 'critical');
  return Array.from(crit, x => String(x.id || x.code || x.title));
};

click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
const moneyInput = window.document.getElementById('addMoneyInput');
moneyInput.value = '500000000000';
click('#addMoneyBtn');
for (const f of [...window.document.querySelectorAll('.open-company')]) f.dispatchEvent(new window.Event('click', { bubbles: true }));

assert.strictEqual(criticalIds().length, 0, 'a freshly funded, freshly founded game must start with no critical issues');

// ---- 1) أول عمولة بنكية حقيقية في اليوم الأول يجب ألا تُرفض ----
{
  const before = criticalIds();
  let result = null;
  assert.doesNotThrow(() => {
    result = window.GH_DOMAIN_COMMANDS.dispatch({ state: S() }, 'banking', 'draw-facility', { company: 'air', amount: 1000000 });
  }, 'the very first taxable bank fee of the game must not be rejected as a business-integrity violation');
  assert.ok(result && result.ok === true, 'draw-facility must actually commit, not silently no-op');
  const introduced = criticalIds().filter(x => !before.includes(x));
  assert.deepStrictEqual(introduced, [],
    `drawing a credit facility must not introduce a new critical: ${JSON.stringify(introduced)}`);
}

// ---- 2) وكذلك رسوم اعتماد مستندي / ضمان (trade-instrument) ----
{
  const before = criticalIds();
  assert.doesNotThrow(() => {
    window.GH_DOMAIN_COMMANDS.dispatch({ state: S() }, 'banking', 'trade-instrument', { company: 'air', kind: 'lc', amount: 200000 });
  }, 'a documentary-credit fee must not be rejected as a business-integrity violation');
  const introduced = criticalIds().filter(x => !before.includes(x));
  assert.deepStrictEqual(introduced, [], `trade-instrument must not introduce a new critical: ${JSON.stringify(introduced)}`);
}

// ---- 3) لكن انحرافًا فعليًا بعد وجود فترة حقيقية يجب أن يبقى مكتشَفًا ----
{
  S().finance.periods.unshift({ company: 'bank', amount: 5000, status: 'مستحق', dueDay: 30 });
  S().companyFinance.bank.taxPayable = 12345; // لا يطابق الفترة أعلاه عمدًا
  assert.ok(criticalIds().includes('FINANCE_TAX_PAYABLE_MISMATCH_bank'),
    'a genuine mismatch against an existing period must still be detected');
  S().companyFinance.bank.taxPayable = 5000; // يطابق الآن
  assert.ok(!criticalIds().includes('FINANCE_TAX_PAYABLE_MISMATCH_bank'),
    'once taxPayable matches its open period, the issue must clear');
}

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('finance-tax-payable-false-positive-build282-test: ok');
process.exit(0);
