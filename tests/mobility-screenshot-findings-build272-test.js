'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const app = fs.readFileSync(path.join(__dirname, '..', 'WebApp', 'app.js'), 'utf8');
const adv = fs.readFileSync(path.join(__dirname, '..', 'WebApp', 'advanced-core.js'), 'utf8');

// 1) نص مربك ذاتيًا: صفحة إدارة مركز الرياض كانت تقول "منفصلة عن أي مركز آخر (بما في ذلك
// الرياض)" أثناء عرضها لمركز الرياض نفسه.
assert(!adv.includes('(بما في ذلك الرياض)'), 'the confusing self-referential "(including Riyadh)" example must be removed');

// 2) إحصاء "الاستغلال" في صفحة مركز Mobility كان يعرض دائمًا m.utilization (حقل عام لا
// يُحسب لمراكز Mobility، فيظهر 0% حتى مع مركبات نشطة فعليًا) بدل نسبة حقيقية من بيانات المركز.
assert(adv.includes("centerStats.vehicles?Math.round(centerStats.moving/centerStats.vehicles*100):0"), 'Mobility center utilization must be computed from its own real vehicle/moving counts, not the generic unrelated facility field');

// 3) جدول عناوين ثالث منفصل في app.js (panelMeta) كان لا يزال يحمل مفتاحي 'competitors'
// و'more' بعد حذف لوحتيهما فعليًا في BUILD270 - بقايا تنظيف غير مكتمل.
assert(!/competitors:\['القيادة التنفيذية','المنافسة'\]/.test(app), 'the stale competitors title entry (dead since BUILD270) must be removed from this second title table too');
assert(!/more:\['النظام والسلامة','الصحة والصيانة'\],contracts/.test(app), 'the stale more title entry (dead since BUILD270) must be removed from this second title table too');

// 4) لوحة "الأساطيل والأصول" (سوق الأصول) لم تكن تذكر Mobility إطلاقًا رغم أنها الشركة
// المضافة حديثًا - أضيف تبويب رابع يوجّه صراحة لمكانها الحقيقي بدل تجاهلها بصمت.
assert(app.includes('data-open="companyManage" data-arg="mobility">MOBILITY'), 'the asset market must at least point Mobility to its real operations page instead of omitting it silently');

// 5) تحقق فعلي (jsdom): إطلاق Mobility لأول مرة يجب أن يُنشئ سجل منشأة حقيقي لمركز الرياض
// الافتراضي الضمني، ليحصل على علامة على الخريطة تمامًا مثل أي مركز يُفتح لاحقًا - لم يكن
// يحدث هذا سابقًا لأن الرياض لا تمر بمسار "فتح مركز عاصمة" العادي.
(function riyadhHubGetsRealFacilityMarker(){
  const WEBAPP = path.join(__dirname, '..', 'WebApp');
  const html = fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const calls = { facilityMarkers: [] };
  window.L = (() => {
    const chain = () => stub;
    const stub = { addTo: chain, on: chain, off: chain, remove: chain, setLatLng: chain, setStyle: chain, bindPopup: chain, bindTooltip: chain, openPopup: chain, closePopup: chain, setIcon: chain, getLatLng: () => [0, 0], invalidateSize: chain, fitBounds: chain, removeLayer: chain, addLayer: chain, eachLayer() {}, clearLayers: chain, getBounds: () => ({ contains: () => true }), getZoom: () => 3, setView: () => stub };
    return { map: () => stub, tileLayer: () => stub, layerGroup: () => stub, featureGroup: () => stub,
      marker: (coords, opts) => { calls.facilityMarkers.push({ coords, className: opts?.icon?.options?.className }); return stub; },
      circleMarker: () => stub, circle: () => stub, polyline: () => stub, polygon: () => stub,
      divIcon: opts => ({ options: opts }), icon: () => ({}), svg: () => stub, canvas: () => stub,
      control: { layers: () => stub, zoom: () => stub }, geoJSON: () => stub,
      latLng: (a, b) => [a, b], latLngBounds: () => stub, Browser: { mobile: false, touch: false }, version: 'stub' };
  })();
  window.matchMedia = window.matchMedia || (q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }));
  const uncaught = [];
  window.addEventListener('error', e => uncaught.push(e.error?.message || e.message));
  const scripts = [...fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
  for (const file of scripts) window.eval(fs.readFileSync(path.join(WEBAPP, file), 'utf8'));
  const click = sel => { const el = window.document.querySelector(sel); assert(el, `expected: ${sel}`); el.dispatchEvent(new window.Event('click', { bubbles: true })); };
  const S = window.__GH_STATE__;
  click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
  window.document.getElementById('addMoneyInput').value = '1000000000000'; click('#addMoneyBtn');
  click('.open-company[data-type="mobility"]'); click('[data-companytab="subs"]');
  click('[data-open="companyManage"][data-arg="mobility"]'); click('[data-company-manage-tab="operations"]');
  click('[data-gh-action="mobility-launch"]');
  assert(S.customHubs.some(f => f.id === 'MOB-CENTER-RUH'), 'launching Mobility must create a real facility record for the implicit Riyadh hub');
  calls.facilityMarkers = [];
  click('.filter-btn[data-filter="all"]');
  assert(calls.facilityMarkers.some(m => Math.abs(m.coords[0] - 24.7136) < 0.01), 'the Riyadh Mobility hub must now render a real facility marker on the map immediately after launch, exactly like any other company\u2019s first base');
  assert.strictEqual(uncaught.length, 0);
})();

console.log('Mobility screenshot findings (self-referential text, fake utilization, stale titles, missing map marker, missing market tab) BUILD272: PASS');
process.exit(0);
