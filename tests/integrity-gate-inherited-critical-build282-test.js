'use strict';
// BUILD282: يمنع رجوع نوعين من عيب "بوابة تكامل ترفض على عطل موروث لا علاقة له بالإجراء":
//
//  1) interaction-core.js: مسار executeAsync.verify كان يرفض أي إجراء واجهة (فتح لوحة، إلخ)
//     بمجرد وجود عطل حرج بأي مكان في اللعبة، حتى لو الإجراء نفسه مجرد تنقّل لا علاقة له بالعطل.
//     النتيجة: الإجراء ينفّذ فعليًا (handler() يعمل أولًا) لكن الواجهة تُبلغ المستخدم أنه "فشل" -
//     رسالة مضللة على كل نقرة [data-open] في اللعبة بمجرد وجود عطل حرج واحد بأي نطاق.
//
//  2) app.js persistStateNow(): كان يفحص integrity?.critical?.length، وهذه الخاصية غير موجودة
//     إطلاقًا في مخرجات GH_INTEGRITY_CORE.check() (الموجود فقط .issues و.counts.critical)،
//     فالشرط كان دائمًا false - شبكة أمان معطوبة بصمت منذ البداية لا عطلًا نشطًا يمنع حفظًا
//     فعليًا. الإصلاح صحّح الخاصية وأضاف نمط الفارق: يرفض فقط لو الحفظ نفسه أحدث عطلًا حرجًا جديدًا.
//
// ملاحظة مهمة: workflow-core.js postCheck() **لم يُعدَّل عمدًا**. اختبار قائم
// (workflow-delta-postcheck-build243-test.js) يُثبِّت أن postCheck يجب أن يُبلغ ok:false على أي
// حالة حرجة حتى لو موروثة - وهو سلوك مقصود، إذ postCheck ينفّذ بعد نجاح الإجراء فعليًا وهو مجرد
// إشعار/تحذير غير حاجز ("ضوء تحذير محرك")، بخلاف البوابتين أدناه اللتين ترفضان الإجراء فعليًا.
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
const click = sel => { const el = window.document.querySelector(sel); if (el) el.dispatchEvent(new window.Event('click', { bubbles: true })); return !!el; };

click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
const moneyInput = window.document.getElementById('addMoneyInput');
moneyInput.value = '500000000000';
click('#addMoneyBtn');
for (const f of [...window.document.querySelectorAll('.open-company')]) f.dispatchEvent(new window.Event('click', { bubbles: true }));

// حالة حرجة قائمة لا علاقة لها بالإجراءات القادمة
S().bank.branches = Math.max(1, Number(S().bank.branches) || 0);
S().realism.banking.cet1 = 1;
S().realism.banking.dormant = false;
const criticalIds = () => {
  const r = window.GH_INTEGRITY_CORE.check(S());
  const crit = r.critical || (r.issues || []).filter(x => x.severity === 'critical');
  return Array.from(crit, x => String(x.id || x.code || x.title));
};
assert.ok(criticalIds().includes('BANK_CET1_REGULATORY_MIN'), 'setup must actually seed a critical issue');

(async () => {
  // ---- 1) executeAsync.verify: إجراء واجهة غير متعلق يجب ألا يُبلَّغ كفاشل ----
  const btn = window.document.createElement('button');
  const result = await window.GH_INTERACTION.run(btn, () => true, { action: 'unrelated-noop', panel: 'workspaceHub', state: S() });
  assert.strictEqual(result.ok, true,
    `a real button click must not be rejected by an inherited critical it did not cause: ${JSON.stringify(result)}`);
  // ملاحظة: postCheck يُبلغ ok:false عمدًا (سلوك BUILD243 المقصود)، فلا نتحقق من result.integrity هنا.

  // ---- 2) persistStateNow: يجب أن يحفظ فعليًا رغم العطل الحرج الموروث ----
  const revBefore = S().saveRevision;
  const failBefore = (S().diagnostics?.events || []).filter(e => e.type === 'SAVE_FAILED').length;
  moneyInput.value = '1000';
  click('#addMoneyBtn'); // مسار حقيقي يستدعي save() مباشرة
  const revAfter = S().saveRevision;
  const failAfter = (S().diagnostics?.events || []).filter(e => e.type === 'SAVE_FAILED').length;
  assert.ok(revAfter > revBefore,
    `save must succeed despite an inherited critical: revision stuck at ${revBefore}`);
  assert.strictEqual(failAfter, failBefore, 'no SAVE_FAILED diagnostic expected for an inherited, unrelated critical');

  assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
  console.log('integrity-gate-inherited-critical-build282-test: ok');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
