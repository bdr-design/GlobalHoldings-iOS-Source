'use strict';
// BUILD282: يمنع رجوع عدم اتساق "الأموال اللانهائية" في لوحة Good Mode.
//
// الجذر: من أصل 10 دوال تحريك مال في finance-core.js، فقط spend() وissueCheque() كانتا تحترمان
// تجاوز godMoney&&infiniteMoney. الست الباقية (transfer, bulkTransfer, transferReserve,
// settlePayable, payTaxes, settleCheque) تفحص operating(s,t)<a أو src.balance<a مباشرة بلا أي
// علم بوضع الإله - فيرفضن العملية رغم أن اللاعب فعّل "أموال لا نهائية" صراحة. بما أن تأسيس شركة
// (corporate:open-company) يمر عبر transfer()، فحتى تأسيس أول شركة بنقود حقيقية = 0 تحت وضع الإله
// كان يفشل - العطل يضرب أول خطوة ممكنة في اللعبة عند استخدام الوضع كما هو مصمَّم.
//
// الإصلاح: hasFunds(s,t,a) تكرر operating(s,t)>=a بالضبط + تجاوز وضع الإله فقط - بلا فحص
// remaining() الإضافي الذي تفرضه canSpend()، حتى لا يتغير سلوك هذه الدوال حين الوضع مطفأ.
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
const F = window.GH_FINANCE_CORE;

// ---- 1) وضع الإله مطفأ: الرفض الطبيعي عند نقص السيولة يبقى كما هو (لا انحدار) ----
{
  const st = S();
  assert.throws(() => F.execute({ state: st }, 'transfer', { from: 'group', to: 'air', amount: 999999999 }),
    /insufficient-cash/, 'transfer with insufficient cash must still be rejected when god mode is off');
}

// ---- 2) وضع الإله مفعَّل: كل الدوال الست يجب أن تنجح بسيولة حقيقية صفر ----
{
  const st = S();
  st.godMoney = true; st.infiniteMoney = true;

  assert.doesNotThrow(() => F.execute({ state: st }, 'transfer', { from: 'group', to: 'air', amount: 999999999 }),
    'transfer must succeed under infinite money regardless of real balance');

  assert.doesNotThrow(() => F.execute({ state: st }, 'bulk-transfer', { rows: [{ company: 'sea', amount: 5000000 }] }),
    'bulk-transfer must succeed under infinite money');

  assert.doesNotThrow(() => F.execute({ state: st }, 'transfer-reserve', { company: 'group', amount: 1000000, toReserve: false }),
    'transfer-reserve must succeed under infinite money');

  st.finance.periods.push({ company: 'group', status: 'مستحق', amount: 500000 });
  assert.doesNotThrow(() => F.execute({ state: st }, 'pay-taxes', { company: 'group' }),
    'pay-taxes must succeed under infinite money');

  st.finance.payables.push({ number: 'PAY-TEST-1', company: 'group', total: 5000000, amount: 5000000 });
  assert.doesNotThrow(() => F.execute({ state: st }, 'settle-payable', { number: 'PAY-TEST-1' }),
    'settle-payable must succeed under infinite money');

  st.finance.cheques.push({ id: 'CHQ-TEST-1', company: 'group', amount: 3000000, status: 'قيد الصرف', beneficiary: 'x' });
  const chequeResult = F.execute({ state: st }, 'settle-cheque', { id: 'CHQ-TEST-1' });
  assert.strictEqual(chequeResult.settled, true, 'settle-cheque must succeed under infinite money');
}

// ---- 3) السيناريو الحقيقي: تأسيس شركة بسيولة صفر تحت وضع الإله، ثم أمر نطاق حقيقي يعتمد على transfer ----
{
  const st = S();
  st.godMoney = true; st.infiniteMoney = true;
  const dispatch = (d, n, p) => window.GH_DOMAIN_COMMANDS.dispatch({ state: st }, d, n, p);
  assert.doesNotThrow(() => dispatch('corporate', 'open-company', {
    type: 'air', capital: 25000000, legalName: 'Test Air', owner: 'x', authorizedSignatory: 'x'
  }), 'founding a company with zero real cash must succeed under infinite money (open-company uses transfer internally)');
  assert.ok(st.openedCompanies.includes('air'), 'the company must actually be founded, not silently skipped');
}

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('good-mode-infinite-money-consistency-build282-test: ok');
process.exit(0);
