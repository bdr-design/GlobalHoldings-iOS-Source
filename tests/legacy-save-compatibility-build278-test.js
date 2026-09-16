'use strict';
// اختبار توافق حفظة قديمة (ما قبل BUILD255) فعليًا: نبني حفظة بشكلها القديم (بدون كل الحقول التي
// أُضيفت هذه الجلسة، وببنية Mobility أحادية المركز v2، وطلبات AI قديمة من نوع procurement، وتسليمات
// بـ dueDay فقط)، نضعها في localStorage، ثم نُقلع اللعبة كاملة عليها ونتحقق أن كل الترحيلات تعمل
// بلا أي خطأ وأن كل الأقسام والتدفقات الأساسية تشتغل فوقها.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const WEBAPP = path.join(__dirname, '..', 'WebApp');
const html = fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
const scripts = [...fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
function boot(preloadSave) {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const calls = { markers: 0, vehicles: 0 };
  window.L = (() => { const chain = () => stub; const stub = { addTo: chain, on: chain, off: chain, remove: chain, setLatLng: chain, setStyle: chain, bindPopup: chain, bindTooltip: chain, openPopup: chain, closePopup: chain, setIcon: chain, getLatLng: () => [0, 0], invalidateSize: chain, fitBounds: chain, removeLayer: chain, addLayer: chain, eachLayer() {}, clearLayers: chain, getBounds: () => ({ contains: () => true }), getZoom: () => 3, setView: () => stub }; return { map: () => stub, tileLayer: () => stub, layerGroup: () => stub, featureGroup: () => stub, marker: () => { calls.markers++; return stub; }, circleMarker: () => { calls.vehicles++; return stub; }, circle: () => stub, polyline: () => stub, polygon: () => stub, divIcon: () => ({}), icon: () => ({}), svg: () => stub, canvas: () => stub, control: { layers: () => stub, zoom: () => stub }, geoJSON: () => stub, latLng: (a, b) => [a, b], latLngBounds: () => stub, Browser: { mobile: false, touch: false }, version: 'stub' }; })();
  window.matchMedia = window.matchMedia || (q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }));
  const uncaught = []; window.addEventListener('error', e => uncaught.push(e.error?.message || e.message));
  if (preloadSave) window.localStorage.setItem('global-holdings-world-v2.0.0', preloadSave);
  for (const f of scripts) window.eval(fs.readFileSync(path.join(WEBAPP, f), 'utf8'));
  const click = sel => { const el = window.document.querySelector(sel); if (!el) return false; el.dispatchEvent(new window.Event('click', { bubbles: true })); return true; };
  return { window, S: window.__GH_STATE__, click, uncaught, calls };
}

// 1) لعبة حديثة نبني منها حفظة واقعية فيها أصول وقاعدة وMobility مطلق
const a = boot(null);
a.click('[data-panel="workspaceHub"]'); a.click('[data-open="companies"]'); a.click('[data-companytab="subs"]');
a.window.document.getElementById('addMoneyInput').value = '1000000000000'; a.click('#addMoneyBtn');
a.click('.open-company[data-type="air"]'); a.click('[data-companytab="subs"]'); a.click('.open-company[data-type="mobility"]');
a.click('[data-companytab="subs"]'); a.click('[data-gh-action="mobility-launch"]');
a.click('[data-panel="workspaceHub"]'); a.click('[data-open="companies"]'); a.click('[data-companytab="subs"]');
a.click('[data-open="companyManage"][data-arg="air"]'); a.click('[data-open="companyFacilities"][data-arg="air"]'); a.click('.open-global-base');
assert.strictEqual(a.uncaught.length, 0, 'baseline boot must be clean');
const modern = JSON.parse(JSON.stringify(a.S));

// 2) تخفيض الحفظة لشكلها القديم (ما قبل هذه الجلسة)
const old = modern;
old.mobility = { schema: 'gh-mobility-v2', status: 'active', vehicles: (modern.mobility.vehicles || []).slice(0, 60).map(v => { const { centerId, ...rest } = v; return rest; }), drivers: (modern.mobility.drivers || []).slice(0, 80).map(d => { const { centerId, ...rest } = d; return rest; }), rideRequests: [], activeTrips: [], tripArchive: [], kpis: { requests: 0, completed: 0, cancelled: 0, grossBookings: 0, driverPayouts: 0, platformRevenue: 0, avgRating: 4.9, acceptanceRate: 100, completionRate: 100 }, lastDemandAt: 0 };
delete old.mobility.capitalCenters; delete old.mobility.kpisByCenter; delete old.mobility.lastDemandAtByCenter;
old.customHubs = (old.customHubs || []).filter(f => f.kind !== 'mobility-center'); // الحفظات القديمة لم يكن لديها منشأة الرياض
if (old.hr) delete old.hr.hiringLog;
delete old.domainRuntime;
old.advanced = old.advanced || {};
old.advanced.procurement = { assetRequests: [{ id: 'AR-LEGACY-1', status: 'awaiting_authorization', company: 'air', catalogId: 'x', qty: 1, baseId: 'B1' }], assetPortfolioPlans: [{ id: 'PF-LEGACY' }] };
old.advanced.ai = old.advanced.ai || {}; old.advanced.ai.requests = [{ id: 'RQ-LEGACY-PROC', kind: 'procurement', company: 'air', title: 'طلب شراء قديم', status: 'بانتظار التفويض', priority: 'high', cost: 1000000, submittedAt: 0 }];
if (old.realism?.procurement?.deliveries) old.realism.procurement.deliveries = old.realism.procurement.deliveries.map(d => { const { dueAtSeconds, ...rest } = d; return rest; });
const legacyJson = JSON.stringify(old);

// 3) إقلاع كامل على الحفظة القديمة
const b = boot(legacyJson);
assert(!b.window.document.getElementById('saveRecovery'), 'legacy save must load normally, not trigger the recovery screen');
assert.strictEqual(b.uncaught.length, 0, `legacy boot must be clean: ${b.uncaught.join(' | ')}`);
const S = b.S;
assert.strictEqual(S.mobility.schema, 'gh-mobility-v3', 'single-center v2 Mobility must be migrated to v3');
assert(Array.isArray(S.mobility.capitalCenters) && S.mobility.kpisByCenter && S.mobility.lastDemandAtByCenter, 'v3 multi-center fields must be created');
assert(S.mobility.vehicles.every(v => v.centerId === 'RUH'), 'legacy vehicles without centerId must be assigned to Riyadh');
assert(!Object.prototype.hasOwnProperty.call(S.advanced.procurement,'assetRequests'), 'legacy AI asset-request queue must be deleted');
assert(!Object.prototype.hasOwnProperty.call(S.advanced.procurement,'assetPortfolioPlans'), 'legacy AI portfolio plans must be deleted');
assert(S.realism.procurement.deliveries.every(d => Number.isFinite(d.dueAtSeconds)), 'legacy dueDay-only deliveries must gain dueAtSeconds');

// 4) المحاكاة تعمل على الحفظة المرحّلة، والمركبات تُرسم، ولوحة Mobility لا تكسر
let at = S.simSeconds; for (let i = 0; i < 20; i++) { at += 30; S.simSeconds = at; b.window.GH_MOBILITY_CORE.onSimulationTime({ state: S }, at); }
b.calls.vehicles = 0; b.click('.filter-btn[data-filter="mobility"]');
assert(b.calls.vehicles > 0, 'migrated legacy Mobility fleet must render on the map');

// 5) طلب AI قديم من نوع procurement (شراء أصول عبر AI - مبدأ ملغى): الترحيل يحذفه عمدًا لا يبقيه،
// لأن الشراء يدوي بالكامل الآن، ولوحة الاعتمادات تُفتح فوق الحفظة القديمة بلا خطأ.
assert(!Object.prototype.hasOwnProperty.call(S.advanced.ai,'requests'), 'legacy AI procurement requests must be deleted by migration (manual-only purchasing)');
b.click('[data-panel="workspaceHub"]'); b.click('[data-open="aiApprovals"]');
assert.strictEqual(b.uncaught.length, 0, `approvals panel must open clean on a legacy save: ${b.uncaught.join(' | ')}`);

// 6) كل الأقسام تُفتح على الحفظة القديمة بلا NaN/undefined/خطأ
for (const p of ['control','assets','routes','labor','finance','aiApprovals','companies','leadershipHub','governanceHub','systemHub']) {
  const btn = b.window.document.createElement('button'); btn.setAttribute('data-open', p); b.window.document.body.appendChild(btn);
  b.click('[data-panel="workspaceHub"]'); btn.dispatchEvent(new b.window.Event('click', { bubbles: true })); btn.remove();
  const h = b.window.document.getElementById('drawerBody').innerHTML;
  assert(!/\bNaN\b|>undefined</.test(h), `panel ${p} renders corrupt values on a legacy save`);
}
assert.strictEqual(b.uncaught.length, 0, b.uncaught.join(' | '));
console.log('Legacy (pre-BUILD255-shaped) save: loads, migrates (Mobility v2->v3, legacy AI queues cleared, deliveries gain dueAtSeconds), simulates, renders, and every core panel opens clean - BUILD278: PASS');
process.exit(0);
