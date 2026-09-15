'use strict';
// BUILD282: يعيد هيكلة صفحة الدليل العالمي (GLO) - كانت 5 أقسام متراكمة قبل أي نتيجة بحث فعلية.
//
// المشكلة: بطاقة تعريفية بمقياس 4 عناصر (اثنان منها فقط - قواعد المجموعة ونقاط التسليم - أرقام
// تخص تقدّم اللاعب؛ الاثنان الآخران حجم قاعدة بيانات ثابتة عالميًا لا علاقة لهما بتقدّمه)، ثم مربع
// بحث، ثم شريط 4 شركات (AIR/SEA/LOG/MOVE تذهب لصفحة الشركة العامة)، ثم صف 4 أزرار إضافية منفصل
// (قواعد AIR/LOG، مركز المسارات، القواعد البحرية) تتداخل وظيفيًا مع الشريط السابق لثلاث من
// الأربع شركات، ثم أخيرًا سطر تلميح - كل هذا قبل ظهور أي نتيجة بحث مفيدة واحدة.
//
// الإصلاح: بطاقة المقاييس صارت عنصرين (الأرقام التي تخص تقدّم اللاعب فقط؛ حجم قاعدة البيانات
// الثابتة انتقل لنص الوصف). شريط الشركات صار 5 رقائق موحّدة تدمج الوجهتين معًا - AIR/LOG تذهب
// مباشرة لقوائم القواعد (بدل صفحة الشركة العامة)، SEA تذهب لشبكة الموانئ، MOVE تبقى على صفحة
// الشركة (لا وجهة قواعد منفصلة كانت أصلًا)، ورقاقة خامسة لمركز المسارات - فحُذف صف الأزرار
// المنفصل بالكامل.
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
const D = window.document;
const click = sel => { const el = D.querySelector(sel); if (el) el.dispatchEvent(new window.Event('click', { bubbles: true })); return !!el; };

click('#skipFounder');
click('#worldDirectoryBtn');
assert.strictEqual(D.getElementById('drawerTitle')?.textContent, 'الدليل العالمي',
  'the world directory drawer must open');

// ---- 1) صف الأزرار المنفصل والمتداخل وظيفيًا حُذف بالكامل ----
assert.strictEqual(D.querySelector('.infrastructure-actions'), null,
  'the separate infrastructure-actions row must be removed - its destinations are now merged into the chips');

// ---- 2) بطاقة المقاييس صارت عنصرين فقط، هما ما يخص تقدّم اللاعب ----
const metricLabels = [...D.querySelectorAll('.registry-hero .metric-row > div span')].map(s => s.textContent);
assert.strictEqual(metricLabels.length, 2, 'the hero metric row must show exactly 2 player-relevant numbers, not 4');
assert.ok(metricLabels.some(l => l.includes('قواعد')), 'opened-bases count must remain visible');

// ---- 3) 5 رقائق موحّدة، كل واحدة تصل فعليًا لوجهتها الصحيحة ----
const chips = [...D.querySelectorAll('.world-company-chip')];
assert.strictEqual(chips.length, 5, 'exactly 5 unified chips (AIR, SEA, LOG, MOVE, route center)');
const expectedTitles = {
  AIR: 'قواعد ومراكز الشركة',
  SEA: 'شبكة الموانئ',
  LOG: 'قواعد ومراكز الشركة',
  MOVE: 'القيادة · GH Mobility للتنقل الذكي',
  '⇄': 'مركز المسارات المستقل',
};
for (const [label, expectedTitle] of Object.entries(expectedTitles)) {
  click('#worldDirectoryBtn');
  const chip = [...D.querySelectorAll('.world-company-chip')].find(b => b.querySelector('b')?.textContent === label);
  assert.ok(chip, `a chip labeled ${label} must exist`);
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.strictEqual(D.getElementById('drawerTitle')?.textContent, expectedTitle,
    `clicking the ${label} chip must navigate to "${expectedTitle}", got "${D.getElementById('drawerTitle')?.textContent}"`);
}

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('global-directory-restructure-build282-test: ok');
process.exit(0);
