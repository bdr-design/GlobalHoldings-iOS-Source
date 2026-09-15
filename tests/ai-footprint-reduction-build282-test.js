'use strict';
// BUILD282: يقلّص بصمة AI في اللعبة - تنفيذًا لطلب صريح بتقليص AI، بعد تشخيص سابق في هذي الجلسة
// وجد أن state.advanced.ai كانت تستهلك 90٪ من حجم ملف الحفظ بعد 300 دورة طلب فقط، بلا أي سقف،
// ومسار حقيقي نحو فشل حفظ صلب (save-size-hard-limit عند تجاوز 4MB) في أي لعبة طويلة.
//
// الإصلاح:
//  1) requestArchive وexecutionLog وdelegations - الثلاث مصفوفات الوحيدة بلا سقف من أصل 7 - صارت
//     مقيّدة بـ200 عنصر لكل منها، بنفس نمط messages(30)/observations(120) المستخدم أصلًا في نفس
//     الملف، لا نمطًا جديدًا.
//  2) resolveDependency() حُذفت بالكامل - صفر مستدعٍ لها في كل المستودع، وفرعاها لـkind='funding'/
//     'capacity' كانا يرجعان صراحة reason:'asset-request-lifecycle-removed' - كود ميت يشير لنظام
//     محذوف أصلًا.
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
const S = () => window.__GH_STATE__;
const ai = window.GH_AI_EXECUTIVE_CORE;
const st = S();

// ---- 1) 400 دورة طلب→اعتماد→تفويض→تنفيذ يجب ألا تتجاوز أي مصفوفة 200 عنصر ----
for (let i = 0; i < 400; i++) {
  const r = ai.submit(st, { company: 'group', kind: 'general', title: `req ${i}`, cost: 1000 + i, reason: 'x'.repeat(80) });
  ai.authorize(st, r.id, {});
  ai.delegate(st, r.id, {});
  ai.recordExecution(st, r.id, { ok: true, quantity: 1, verification: { note: 'y'.repeat(60) } });
}
assert.strictEqual(st.advanced.ai.requestArchive.length, 200, 'requestArchive must be capped at 200 after 400 cycles');
assert.strictEqual(st.advanced.ai.executionLog.length, 200, 'executionLog must be capped at 200 after 400 cycles');
assert.strictEqual(st.advanced.ai.delegations.length, 200, 'delegations must be capped at 200 after 400 cycles');

// ---- 2) الأحدث يبقى دائمًا في المقدمة (لا يُفقَد التاريخ الحديث عند القطع) ----
assert.strictEqual(st.advanced.ai.requestArchive[0].title, 'req 399', 'the most recent archived request must remain at the front after trimming');
assert.strictEqual(st.advanced.ai.executionLog[0].title, 'req 399', 'the most recent execution log entry must remain at the front after trimming');

// ---- 3) resolve-dependency لم تعد موجودة ----
assert.throws(() => ai.execute({ state: st }, 'resolve-dependency', { id: 'x' }),
  /Unknown AI command/, 'resolve-dependency must no longer be a recognized command');

// ---- 4) الحجم الإجمالي يستقر تحت سقف معقول حتى مع دورات أكثر (لا ينمو للأبد) ----
for (let i = 400; i < 800; i++) {
  const r = ai.submit(st, { company: 'group', kind: 'general', title: `req ${i}`, cost: 1000 + i, reason: 'x'.repeat(80) });
  ai.authorize(st, r.id, {});
  ai.delegate(st, r.id, {});
  ai.recordExecution(st, r.id, { ok: true, quantity: 1, verification: { note: 'y'.repeat(60) } });
}
const bytes = x => Buffer.byteLength(JSON.stringify(x), 'utf8');
assert.strictEqual(st.advanced.ai.requestArchive.length, 200, 'cap must hold at 800 cycles too, not just 400');
assert.ok(bytes(st.advanced.ai) < 250000,
  `state.advanced.ai must stay bounded regardless of session length, got ${bytes(st.advanced.ai)} bytes`);

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('ai-footprint-reduction-build282-test: ok');
process.exit(0);
