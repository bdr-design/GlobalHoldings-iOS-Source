'use strict';
// BUILD282: يجعل المركبات تظهر فعليًا على الخريطة بلا حاجة لأي ضغطة من اللاعب.
//
// الاكتشاف: عدّدت كل الـ22 استدعاءً لـrenderMap() في المستودع - كلها مربوطة بإجراء محدد من اللاعب
// (فتح قاعدة، شراء مسار، تبديل فلتر، تأسيس المجموعة...). لا استدعاء واحد دوري مرتبط بحلقة
// المحاكاة نفسها. معنى هذا: لاعب يشتري طائرة ويتركها تعمل بالخلفية (بالضبط الاستخدام الطبيعي
// للعبة محاكاة) لن يرى أي تحديث بصري على الخريطة أبدًا - لا ظهور الأصل الجديد، ولا تحرّك أي مركبة
// على مسارها - إلا لو صادف وضغط أحد الإجراءات الـ22 لسبب آخر تمامًا.
//
// الإصلاح: renderMap() دورية مقيّدة بثانية واحدة داخل حلقة الإطارات loop()، بدون أي إجراء مطلوب
// من اللاعب. مقيّدة (لا كل إطار) لتفادي كلفة مسح وإعادة رسم كل العلامات 60 مرة/ثانية.
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
const calls = { markers: [] };
window.L = (() => {
  const chain = () => stub;
  const stub = { addTo: chain, on: chain, off: chain, remove: chain, setLatLng: chain, setStyle: chain,
    bindPopup: chain, bindTooltip: chain, openPopup: chain, closePopup: chain, setIcon: chain,
    getLatLng: () => [0, 0], invalidateSize: chain, fitBounds: chain, removeLayer: chain, addLayer: chain,
    eachLayer() {}, clearLayers: chain, getBounds: () => ({ contains: () => true }), getZoom: () => 3, setView: chain };
  return { map: () => stub, tileLayer: () => stub, layerGroup: () => stub, featureGroup: () => stub,
    marker: (c, o) => { calls.markers.push({ coords: c, cls: o?.icon?.options?.className || '' }); return stub; },
    circleMarker: () => stub, circle: () => stub, polyline: () => stub, polygon: () => stub,
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
for (const f of [...raw.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s) && !s.startsWith('vendor/'))) {
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

window.GH_FINANCE_CORE.execute({ state: st }, 'transfer', { from: 'group', to: 'air', amount: 500000000, note: 'test' });
const item = window.GH_ASSET_CATALOG.air.new.find(x => x.id === 'N-A22');
window.GH_DOMAIN_COMMANDS.dispatch({ state: st }, 'procurement', 'purchase-assets', {
  type: 'air', tab: 'new', item, mode: 'cash', qty: 1, base, supplier: { legalName: 'Test' }, manual: true,
  upfront: item.price, totalPrice: item.price, paymentMethod: 'شيك مصدق', documentLeadDays: 1, leadSeconds: 60, companyName: 'test'
});
// التسليم يحدث عبر realism-core.js مباشرة - وحدة منفصلة تمامًا لا تستدعي renderMap() في app.js إطلاقًا
window.GH_REALISM.onSimulationTime(st, st.realism.procurement.deliveries[0].dueAtSeconds + 10);
const asset = st.assets[0];
assert.ok(asset, 'the asset must be delivered');
assert.strictEqual(asset.phase, 'idle', 'freshly delivered, no route assigned yet - sitting at its base');

// ---- بلا أي ضغطة من اللاعب: تقدُّم زمن حقيقي فقط عبر حلقة الإطارات ----
calls.markers.length = 0;
window.__pump(1200, 1); // إطار واحد يتجاوز عتبة الثانية الواحدة، بلا أي تفاعل واجهة
const assetMarkers = calls.markers.filter(m => /asset-marker/.test(m.cls));
assert.ok(assetMarkers.length >= 1,
  'the delivered aircraft must appear as a real marker after the periodic re-render, with zero clicks');
assert.deepStrictEqual(assetMarkers[0].coords, base.coords,
  'the marker must be positioned exactly at the base the aircraft was delivered to');

// ---- التقييد فعّال فعليًا: لا إعادة رسم كاملة عند كل إطار متتالٍ فورًا ----
const countAfterFirstRender = calls.markers.length;
calls.markers.length = 0;
window.__pump(50, 1); // إطار تالٍ بعد 50ms فقط - أقل بكثير من عتبة الألف مللي ثانية
assert.strictEqual(calls.markers.length, 0,
  'a frame arriving well under the 1-second throttle must not trigger a full marker redraw');

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log(`periodic-map-render-build282-test: ok (${countAfterFirstRender} markers on the throttled render)`);
process.exit(0);
