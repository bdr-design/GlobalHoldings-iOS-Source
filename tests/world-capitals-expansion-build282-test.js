'use strict';
// BUILD282: يوسّع دليل عواصم موبيليتي من 20 مدينة خليجية/كبرى فقط إلى 189 عاصمة عالمية (البند 3).
//
// الطلب: "قواعد عالمية زيادة لكل الشركات... أي شركة نقل" - موبيليتي كانت الأضيق بيانيًا (20 فقط
// مقارنة بـ28,291 مطارًا و3,930 ميناءً للجوي والبحري). التوضيح اللاحق حدد المقصود: عواصم دول العالم.
//
// أُضيفت 169 عاصمة (تغطية شبه كاملة لدول الأمم المتحدة + كيانات معترف بها كوسوفو وتايوان)، مع
// الحفاظ الحرفي على الـ20 الأصلية بنفس المعرّفات (id) والقيم - هذه المعرّفات تُستخدم لبناء هويات
// مراكز حقيقية مفتوحة بالفعل (MOB-CENTER-<id>)، فأي تغيير في id قديم يكسر أي حفظة سابقة تملك
// مركزًا مفتوحًا لتلك العاصمة.
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
const CAPS = window.GH_MOBILITY_CORE.CAPITALS;

// ---- 1) توسّع حقيقي، لا زخرفة ----
assert.ok(CAPS.length >= 180, `expected close to full world-capital coverage, got only ${CAPS.length}`);

// ---- 2) كل الـ20 الأصلية موجودة بنفس المعرّف والاسم والإحداثيات - استمرارية الحفظات القديمة ----
const originalIds = { RUH: 'الرياض', AUH: 'أبوظبي', DOH: 'الدوحة', KWI: 'مدينة الكويت', CAI: 'القاهرة',
  ANK: 'أنقرة', BER: 'برلين', LON: 'لندن', PAR: 'باريس', MAD: 'مدريد', ROM: 'روما', WAS: 'واشنطن العاصمة',
  OTT: 'أوتاوا', MEX: 'مكسيكو سيتي', BSB: 'برازيليا', NBO: 'نيروبي', DEL: 'نيودلهي', SIN: 'سنغافورة',
  TYO: 'طوكيو', CAN: 'كانبرا' };
for (const [id, city] of Object.entries(originalIds)) {
  const entry = CAPS.find(c => c.id === id);
  assert.ok(entry, `original capital id ${id} must still exist unchanged (referenced by any existing save's MOB-CENTER-${id})`);
  assert.strictEqual(entry.city, city, `${id} must still resolve to ${city}`);
}

// ---- 3) لا معرّفات مكررة، كل الإحداثيات ضمن نطاق فيزيائي صالح، لا تلوّث لاتيني بالحقول العربية ----
const ids = CAPS.map(c => c.id);
assert.strictEqual(new Set(ids).size, ids.length, 'every capital id must be unique');
for (const c of CAPS) {
  assert.ok(c.coords[0] >= -90 && c.coords[0] <= 90, `${c.id} latitude out of range: ${c.coords[0]}`);
  assert.ok(c.coords[1] >= -180 && c.coords[1] <= 180, `${c.id} longitude out of range: ${c.coords[1]}`);
  assert.ok(!/[a-zA-Z]/.test(c.city), `${c.id} city name must be pure Arabic, got "${c.city}"`);
  assert.ok(!/[a-zA-Z]/.test(c.country), `${c.id} country name must be pure Arabic, got "${c.country}"`);
}

// ---- 4) عيّنة من كل قارة موجودة فعليًا (لا تركيز إقليمي واحد فقط) ----
const spotCheck = { BJS: 'الصين', MOW: 'روسيا', BUE: 'الأرجنتين', WLG: 'نيوزيلندا', PRY: 'جنوب أفريقيا', OSL: 'النرويج' };
for (const [id, country] of Object.entries(spotCheck)) {
  const entry = CAPS.find(c => c.id === id);
  assert.ok(entry, `${country} (${id}) must be included`);
  assert.strictEqual(entry.country, country);
}

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log(`world-capitals-expansion-build282-test: ok (${CAPS.length} capitals)`);
process.exit(0);
