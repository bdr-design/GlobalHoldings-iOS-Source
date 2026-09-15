'use strict';
// BUILD282: توظيف تلقائي فور استلام أي أصل - إلغاء فعلي لحاجة تدخل HR اليدوي (البند 5).
//
// الطلب: "عند شراء أي أصول يتم توصيلها على طول إلى المركز أو القاعدة، وعدد الوظائف يتم آليًا دون
// تدخل مني... حدد لكل سفينة طاقم ولكل طائرة ولكل شاحنة، ألغِ دور قسم الموارد البشرية بذلك."
//
// التنفيذ: لا يخترع أرقامًا جديدة - يستخدم CREW_STANDARDS الموجودة أصلًا في hr-core.js
// (air: 4 طيارين+6 مضيفين+2 مهندس · sea: 2 قبطان+14 بحار+4 مهندس · road: 2 سائق+0.25 فني لكل
// شاحنة) عبر استدعاء GH_HR_CORE.executeHiring() نفسها المستخدمة للتوظيف اليدوي - بمعدلاتها
// ورواتبها وسجل عقودها الحقيقي - لكن يُستدعى تلقائيًا في اللحظة التي يصل فيها الأصل فعليًا إلى
// القاعدة (realism-core.js deliverDueAssetsAt)، لا عند تقديم طلب الشراء (الذي يسبق الوصول
// الفعلي بفترة زمنية واقعية realism يحاكيها المستودع أصلًا).
//
// الأثر: تغطية الطاقم تصل 100٪ فور التسليم، فلا يُحجب أي أصل عن المغادرة لنقص طاقم (departureBlockReason
// يعتمد بالضبط على نفس hr.snapshot المستخدم هنا)، والرواتب تُحسب تلقائيًا من العقود الحقيقية
// المُنشأة (لا حاجة لأي ضغطة توظيف يدوية من اللاعب على الإطلاق).
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
const click = sel => { const el = D.querySelector(sel); if (el) el.dispatchEvent(new window.Event('click', { bubbles: true })); return !!el; };

click('#skipFounder');
click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
const moneyInput = D.getElementById('addMoneyInput');
moneyInput.value = '500000000000';
click('#addMoneyBtn');
for (const f of [...D.querySelectorAll('.open-company')]) f.dispatchEvent(new window.Event('click', { bubbles: true }));
const st = S();

function deliverOneAsset(type, catalogId) {
  let base;
  if (type === 'road') {
    base = { id: `HUB-TEST-${type}`, company: 'road', kind: 'logistics', owned: true, name: 'Test Depot', coords: [24.7, 46.6] };
    if (!st.customHubs.some(h => h.id === base.id)) st.customHubs.push(base);
  } else {
    click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
    click(`[data-open="companyManage"][data-arg="${type}"]`); click('[data-company-manage-tab="assets"]');
    click(`[data-open="companyFacilities"][data-arg="${type}"]`);
    click('.open-global-base');
    base = S().globalBases.find(b => b.company === type);
  }
  assert.ok(base, `a ${type} base must exist for delivery`);
  window.GH_FINANCE_CORE.execute({ state: st }, 'transfer', { from: 'group', to: type, amount: 500000000, note: 'test funding' });
  const item = window.GH_ASSET_CATALOG[type].new.find(x => x.id === catalogId);
  assert.ok(item, `catalog item ${catalogId} must exist`);
  const before = st.assets.length;
  window.GH_DOMAIN_COMMANDS.dispatch({ state: st }, 'procurement', 'purchase-assets', {
    type, tab: 'new', item, mode: 'cash', qty: 1, base, supplier: { legalName: 'Test Supplier' }, manual: true,
    upfront: item.price, totalPrice: item.price, paymentMethod: 'شيك مصدق', documentLeadDays: 1, leadSeconds: 60, companyName: 'test'
  });
  assert.strictEqual(st.assets.length, before, 'the asset must not join the fleet immediately - only after delivery lead time');
  const delivery = st.realism.procurement.deliveries.find(d => d.status === 'pending' && d.type === type);
  assert.ok(delivery, 'a pending delivery must exist');
  window.GH_REALISM.onSimulationTime(st, delivery.dueAtSeconds + 10);
  assert.strictEqual(st.assets.length, before + 1, 'the asset must join the fleet once its delivery is due');
}

// ---- 1) طائرة: 4 طيارين + 6 مضيفين + 2 مهندس، تلقائيًا، بلا أي ضغطة توظيف ----
{
  const crewBefore = Object.fromEntries(st.crew.filter(c => c.sector === 'air').map(c => [c.id, c.count]));
  assert.deepStrictEqual(crewBefore, { pilots: 0, cabin: 0, aeng: 0 }, 'air crew must start at zero');
  deliverOneAsset('air', 'N-A4');
  const crewAfter = Object.fromEntries(st.crew.filter(c => c.sector === 'air').map(c => [c.id, c.count]));
  assert.deepStrictEqual(crewAfter, { pilots: 4, cabin: 6, aeng: 2 }, 'exactly CREW_STANDARDS.air for 1 aircraft');
  const need = window.GH_HR_CORE.snapshot(st, {}, 'air');
  assert.strictEqual(need.crewMissing, 0, 'the delivered aircraft must not be crew-blocked for departure');
  const hireLogEntry = st.advanced.labor.hiringLog[0];
  assert.strictEqual(hireLogEntry.total, 12, 'a real hiring log entry (4+6+2=12) must be recorded, not just a silent state mutation');
}

// ---- 2) سفينة: 2 قبطان + 14 بحار + 4 مهندس ----
{
  deliverOneAsset('sea', 'N-S1');
  const crewAfter = Object.fromEntries(st.crew.filter(c => c.sector === 'sea').map(c => [c.id, c.count]));
  assert.deepStrictEqual(crewAfter, { captains: 2, sailors: 14, seng: 4 }, 'exactly CREW_STANDARDS.sea for 1 vessel');
}

// ---- 3) شاحنة: 2 سائق + فني كسري (ceil(1*.25)=1)، والشاحنة الثانية لا تحتاج فنيًا إضافيًا ----
{
  deliverOneAsset('road', 'N-T1');
  let crewAfter = Object.fromEntries(st.crew.filter(c => c.sector === 'road').map(c => [c.id, c.count]));
  assert.deepStrictEqual(crewAfter, { drivers: 2, mech: 1 }, 'first truck: ceil(1*0.25)=1 mechanic');
  deliverOneAsset('road', 'N-T2');
  crewAfter = Object.fromEntries(st.crew.filter(c => c.sector === 'road').map(c => [c.id, c.count]));
  assert.deepStrictEqual(crewAfter, { drivers: 4, mech: 1 },
    'second truck: drivers double to 4, but ceil(2*0.25)=1 - mechanic count correctly does not over-hire');
}

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('auto-crew-on-delivery-build282-test: ok');
process.exit(0);
