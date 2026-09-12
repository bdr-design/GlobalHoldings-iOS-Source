'use strict';
// اختبار تدفق واجهة حقيقي: يحمّل كل ملفات WebApp بنفس ترتيب index.html داخل DOM محاكى (jsdom)
// ويضغط الأزرار الفعلية كما يفعل اللاعب. هذا هو الاختبار الوحيد الذي يمرّ عبر طبقة app.js
// الحقيقية (وليس أوامر النطاق فقط)، وقد كشف خللين لم تلتقطهما اختبارات Node السابقة.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WEBAPP = path.join(__dirname, '..', 'WebApp');
const html = fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom;

// محاكاة Leaflet (يُحمَّل من CDN في التطبيق الحقيقي) مع تسجيل ما يهمنا: العلامات وانتقال العرض
const calls = { markers: 0, setView: [] };
window.L = (() => {
  const chain = () => stub;
  const stub = { addTo: chain, on: chain, off: chain, remove: chain, setLatLng: chain, setStyle: chain, bindPopup: chain, bindTooltip: chain, openPopup: chain, closePopup: chain, setIcon: chain, getLatLng: () => [0, 0], invalidateSize: chain, fitBounds: chain, removeLayer: chain, addLayer: chain, eachLayer() {}, clearLayers: chain, getBounds: () => ({ contains: () => true }), getZoom: () => 3, setView: (c, z) => { calls.setView.push([c, z]); return stub; } };
  return { map: () => stub, tileLayer: () => stub, layerGroup: () => stub, featureGroup: () => stub, marker: () => stub, circleMarker: () => { calls.markers++; return stub; }, circle: () => stub, polyline: () => stub, polygon: () => stub, divIcon: () => ({}), icon: () => ({}), svg: () => stub, canvas: () => stub, control: { layers: () => stub, zoom: () => stub }, geoJSON: () => stub, latLng: (a, b) => [a, b], latLngBounds: () => stub, Browser: { mobile: false, touch: false }, version: 'stub' };
})();
window.matchMedia = window.matchMedia || (q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }));
const uncaught = [];
window.addEventListener('error', e => uncaught.push(e.error?.message || e.message));

const scripts = [...fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
for (const file of scripts) window.eval(fs.readFileSync(path.join(WEBAPP, file), 'utf8'));
assert.strictEqual(uncaught.length, 0, `boot must not raise uncaught errors: ${uncaught.join(' | ')}`);

const click = sel => { const el = window.document.querySelector(sel); assert(el, `expected element to exist: ${sel}`); el.dispatchEvent(new window.Event('click', { bubbles: true })); };
const S = window.__GH_STATE__;

// 1) تمويل ثم فتح شركة الطيران وMobility عبر الأزرار الحقيقية
click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
window.document.getElementById('addMoneyInput').value = '1000000000'; click('#addMoneyBtn');
click('.open-company[data-type="air"]');
click('[data-companytab="subs"]'); click('.open-company[data-type="mobility"]');
assert(S.openedCompanies.includes('air') && S.openedCompanies.includes('mobility'), 'companies must open through the real UI');

// 2) فتح قاعدة مطار حقيقية من دليل منشآت الشركة: كانت تُرفض دائمًا لأن رأس مال الشركة التابعة
//    ($25M) أقل من عرض المناقصة (~$44M) ولا يوجد سد تلقائي للعجز من القابضة.
click('[data-companytab="subs"]'); click('[data-open="companyManage"][data-arg="air"]'); click('[data-open="companyFacilities"][data-arg="air"]');
assert(window.document.querySelector('.open-global-base'), 'a real "open base" button must be rendered');
const groupBefore = window.GH_FINANCE_CORE.book(S, 'group').accounts[0].balance;
click('.open-global-base');
assert.strictEqual(S.globalBases.length, 1, 'clicking the real open-base button must actually create the base');
assert.strictEqual((S.constructionContracts || []).length, 1, 'a construction contract must be recorded');
assert(window.GH_FINANCE_CORE.book(S, 'group').accounts[0].balance < groupBefore, 'the holding must have funded the subsidiary shortfall automatically');
assert.strictEqual(window.document.getElementById('drawerTitle').textContent, 'إدارة المنشأة', 'UI must navigate to the new facility');

// 3) إطلاق Mobility من تبويب التشغيل: يجب أن تُنشأ علامات على الخريطة وتنتقل الخريطة للرياض بمستوى مدينة
click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
click('[data-open="companyManage"][data-arg="mobility"]'); click('[data-company-manage-tab="operations"]');
calls.markers = 0; calls.setView = [];
click('[data-gh-action="mobility-launch"]');
assert.strictEqual(S.mobility.status, 'active', 'launch must activate the network');
assert(calls.markers >= 100, `vehicle markers must be drawn after launch (got ${calls.markers})`);
assert(calls.setView.some(([c, z]) => Math.abs(c[0] - 24.71) < .1 && z >= 10), 'map must pan to Riyadh at city zoom after launch (fleet is sub-pixel at world zoom)');

// 4) فلتر "GH Mobility" على الخريطة يجب أن يقفز لأكثر مدينة نشاطًا
calls.setView = [];
click('.filter-btn[data-filter="mobility"]');
assert(calls.setView.some(([c, z]) => z >= 10), 'the GH Mobility map filter must pan to the busiest active city');

// 5) النقاط سوداء (حسب المواصفة) لكن بحدّ فاتح لتُرى على الطبقة الداكنة الافتراضية
const app = fs.readFileSync(path.join(WEBAPP, 'app.js'), 'utf8');
assert(app.includes("mobility-point',radius:2.6,color:'#dfe9f7'"), 'mobility dots must keep a light stroke so they are visible on the default dark basemap');

assert.strictEqual(uncaught.length, 0, `no uncaught errors during the whole flow: ${uncaught.join(' | ')}`);
console.log('Real DOM UI flow (open company, open base, launch Mobility, map pan) BUILD267: PASS');
process.exit(0);
