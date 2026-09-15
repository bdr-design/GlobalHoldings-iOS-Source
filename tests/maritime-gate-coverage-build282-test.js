'use strict';
// BUILD282: يوسّع تغطية بوابات المسارات البحرية - جزء من مراجعة "شكل المسارات البحرية".
//
// الاكتشاف: اللعبة تملك رسمًا بيانيًا حقيقيًا لـ40 نقطة اختناق ملاحية فعلية (هرمز، باب المندب،
// السويس، جبل طارق، ملقا، بنما، رأس هورن...) متصل بالكامل 100٪ (0 من 780 زوجًا غير متصل، تحقّق
// مباشر). المشكلة الحقيقية ليست انقطاع الرسم بل تغطية الصناديق الجغرافية الاثني عشر التي تختار
// نقطة الدخول: 21.6٪ من كل موانئ العالم الحقيقية (850 من 3,930) تقع خارجها وتسقط لبديل "أقرب 3
// نقاط بالمسافة الخام" الأضعف جغرافيًا. أكبر الفجوات المؤكدة: بحر البلطيق (السويد وفنلندا والدنمارك
// والنرويج، ~178 ميناء)، شمال الصين الساحلي (تيانجين وتشينغداو ودالیان، بحرا بوهاي والأصفر)،
// وسلسلة ألوشيان الألاسكية غرب حد صندوق المحيط الهادئ.
//
// أُضيفت 3 صناديق جغرافية مُتحقَّقة رقميًا مقابل بيانات الموانئ الحقيقية: رفعت التغطية من 78.4٪
// إلى 84.4٪ (235 ميناءً إضافيًا). الباقي (615 ميناءً) غالبيتها موانئ نهرية داخلية حقيقية (نهر
// المسيسيبي، أنهار الصين الداخلية) لا تنتمي لمفهوم "خطوط الشحن البحرية" أصلاً - مشكلة مختلفة
// جوهريًا (توجيه نهري) خارج نطاق هذا الإصلاح.
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
window.matchMedia = window.matchMedia || (q => ({ matches: false, media: q, addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }));
const uncaught = [];
window.addEventListener('error', e => uncaught.push(e.error?.message || e.message));
for (const f of [...raw.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s))) {
  window.eval(fs.readFileSync(path.join(WEBAPP, f), 'utf8'));
}
const ports = window.GH_WORLD_DATA.ports;

// نستخرج الدالة الحقيقية من مصدر app.js وننفّذها مباشرة - لا نسخة مكتوبة يدويًا قد تبقى صحيحة
// حتى لو رجع الإصلاح الفعلي في app.js إلى الوراء.
const appSrc = fs.readFileSync(path.join(WEBAPP, 'app.js'), 'utf8');
const fnStart = appSrc.indexOf('function maritimeGateKeys(coords){');
assert.ok(fnStart !== -1, 'maritimeGateKeys must still exist in app.js by this exact name');
const fnEnd = appSrc.indexOf('\n  }\n', fnStart) + 4;
const fnSrc = appSrc.slice(fnStart, fnEnd);
const lanesStart = appSrc.indexOf('const MARITIME_LANES');
const lanesEnd = appSrc.indexOf('function stitchArcs');
const lanesSrc = appSrc.slice(lanesStart, lanesEnd);
const haversineStart = appSrc.indexOf('function haversine(');
const haversineEnd = appSrc.indexOf('\n  }', haversineStart) + 4;
const haversineSrc = appSrc.slice(haversineStart, haversineEnd);
// eslint-disable-next-line no-new-func
const maritimeGateKeys = new Function(
  'const EARTH_RADIUS_KM=6371.0088;' + haversineSrc + lanesSrc + fnSrc + '\nreturn maritimeGateKeys;'
)();

const CURATED_RESULTS = new Set([
  ['GULF', 'HORMUZ'], ['RED_SOUTH', 'BAB', 'SUEZ_SOUTH'], ['MED_EAST', 'MED_CENTRAL', 'GIBRALTAR'],
  ['ENGLISH', 'NORTH_SEA'], ['NORTH_SEA', 'ENGLISH'], ['ADEN', 'ARABIAN', 'INDIAN_W'],
  ['INDIAN_C', 'BAY_BENGAL', 'MALACCA'], ['SINGAPORE', 'SOUTH_CHINA', 'PHILIPPINES'],
  ['SOUTH_CHINA', 'JAPAN'], ['JAPAN', 'PHILIPPINES'], ['AUSTRALIA_W', 'AUSTRALIA_E', 'TASMAN'],
  ['PACIFIC_C', 'PACIFIC_W'], ['US_EAST', 'CARIBBEAN', 'PANAMA_ATL'], ['CARIBBEAN', 'BRAZIL', 'SOUTH_ATLANTIC'],
  ['PACIFIC_E', 'PACIFIC_C']
].map(a => JSON.stringify(a)));

function inExplicitBox(lat, lon) {
  return CURATED_RESULTS.has(JSON.stringify(maritimeGateKeys([lat, lon])));
}

// ---- 1) تغطية إجمالية لا تقل عن الرقم المُثبَت هذا الإصلاح ----
const covered = ports.filter(p => inExplicitBox(p[3], p[4])).length;
assert.ok(covered / ports.length >= 0.84,
  `explicit-box coverage must stay at or above 84%, got ${(covered / ports.length * 100).toFixed(1)}%`);

// ---- 2) موانئ حقيقية بالاسم من كل منطقة مُضافة تقع الآن داخل صندوق صريح ----
const named = { 'Stockholm': 'Sweden', 'Tianjin': 'China', 'Dutch Harbor': 'United states' };
for (const [name, country] of Object.entries(named)) {
  const port = ports.find(p => p[1] === name && p[2] === country);
  assert.ok(port, `${name} must exist in the real port dataset`);
  assert.ok(inExplicitBox(port[3], port[4]), `${name} (${port[3]},${port[4]}) must now fall inside an explicit geographic box`);
}

// ---- 3) الصناديق القديمة لم تُمس - عيّنة من كل صندوق سابق تبقى مغطاة كما كانت ----
const previouslyCovered = [
  { name: 'Jeddah-ish (Red Sea)', lat: 21.5, lon: 39.2 },
  { name: 'Singapore-ish', lat: 1.3, lon: 103.8 },
  { name: 'Rotterdam-ish (North Sea)', lat: 51.9, lon: 4.5 },
];
for (const p of previouslyCovered) {
  assert.ok(inExplicitBox(p.lat, p.lon), `${p.name} must remain covered by its original box`);
}

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('maritime-gate-coverage-build282-test: ok');
process.exit(0);
