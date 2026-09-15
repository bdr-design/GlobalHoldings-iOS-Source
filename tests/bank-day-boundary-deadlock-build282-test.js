'use strict';
// BUILD282: يمنع رجوع القفل التام للعبة عند أول حدود يوم.
//
// الجذر كان ثلاثة أخطاء متراكبة:
//  1. لا شيء في المستودع كله يكتب bank.hqla أو bank.stableFunding، بينما deposits/loans تنمو
//     (open-branch, cash-sweep, issue-loans, draw-facility). فتبقى LCR وNSFR صفرًا للأبد.
//  2. بنك بلا ميزانية إطلاقًا كان يُبلَّغ عنه بصفر بدل "غير قابل للتطبيق".
//  3. مُوزّع الأوامر كان يرمي على أي عطل حرج بعد commit، بما فيه الموروث من حالة سابقة،
//     فيرفض كل أمر في اللعبة بلا مخرج.
//
// قبل الإصلاح: لعبة جديدة تمامًا + onDay(1) => BANK_LCR_BELOW_100 و BANK_NSFR_BELOW_100 حرجان،
// ثم كل dispatch يفشل بـ "Integrity critical". هذا الاختبار يفشل على ذلك الكود.
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
const criticalIds = () => {
  const r = window.GH_INTEGRITY_CORE.check(S());
  const crit = r.critical || (r.issues || []).filter(x => x.severity === 'critical');
  return Array.from(crit, x => String(x.id || x.code || x.title));
};
const dispatch = (domain, name, payload) => window.GH_DOMAIN_COMMANDS.dispatch({ state: S() }, domain, name, payload);

// ---- 1) لعبة جديدة تمامًا: عبور أول حدود يوم لا يجوز أن ينتج عطلًا حرجًا في البنك ----
window.GH_REALISM.onDay(S(), 1);
let crit = criticalIds();
assert.ok(!crit.includes('BANK_LCR_BELOW_100'),
  `a brand-new game must not breach LCR at the first day boundary (got ${JSON.stringify(crit)})`);
assert.ok(!crit.includes('BANK_NSFR_BELOW_100'),
  `a brand-new game must not breach NSFR at the first day boundary (got ${JSON.stringify(crit)})`);
assert.strictEqual(crit.length, 0, `no critical integrity issue is expected on day 1, got ${JSON.stringify(crit)}`);

// ---- 2) القفل نفسه: الأوامر يجب أن تبقى قابلة للتنفيذ بعد حدود اليوم ----
{
  const out = dispatch('hr', 'hire', { role: 'driver', count: 1 });
  assert.ok(out && out.ok === true, 'a domain command must still commit after crossing a day boundary');
}

// ---- 3) البنك الخامد: نسبه غير قابلة للتطبيق، لا صفر، ومعلَّم بـ dormant ----
{
  const b = S().realism.banking;
  assert.strictEqual(b.dormant, true, 'a bank with no branches, deposits or loans must be reported dormant');
  assert.ok(Number.isFinite(Number(b.lcr)) && Number(b.lcr) >= 100,
    `a dormant bank has no stressed outflows, so LCR must not read as a breach (got ${b.lcr})`);
  assert.ok(Number.isFinite(Number(b.nsfr)) && Number(b.nsfr) >= 100,
    `a dormant bank must not read as an NSFR breach (got ${b.nsfr})`);
  // القيم يجب أن تبقى أرقامًا: مستهلكون في advanced-core و app.js و department-core و updateRisk
  // ينادون toFixed() عليها مباشرة، فـ null يسقطهم.
  assert.doesNotThrow(() => Number(b.lcr).toFixed(0) + Number(b.nsfr).toFixed(0),
    'ratios must stay numeric for the downstream consumers that call toFixed on them');
}

// ---- 4) بنك نشط: الأصول السائلة والتمويل المستقر يتبعان الميزانية فعلًا ----
// الأقسام 1-3 تعمل على لعبة نقية تمامًا بلا مال. من هنا نحتاج سيولة حقيقية حتى
// تتمكن أوامر البنك من التنفيذ، فنمنحها بنفس مسار الواجهة الذي يستخدمه اللاعب.
{
  click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
  const moneyInput = window.document.getElementById('addMoneyInput');
  assert.ok(moneyInput, 'the funding input used to seed liquidity must exist');
  moneyInput.value = '500000000000';
  click('#addMoneyBtn');
  assert.ok(Number(S().cash) > 0, 'seeding liquidity through the UI must actually credit cash');
  // أوامر البنك تسحب من حساب شركة البنك التابعة (F.operating(state,'bank'))، وهو منفصل
  // عن نقد المجموعة، فلا بد من تأسيس الشركة حتى تُرسمل.
  click('[data-companytab="subs"]');
  const bankFounder = window.document.querySelector('.open-company[data-type="bank"]');
  assert.ok(bankFounder, 'the bank company must be foundable from the subsidiaries list');
  bankFounder.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok((S().openedCompanies || []).includes('bank'), 'founding the bank company must register it');
}

{
  const before = Number(S().bank.hqla) || 0;
  dispatch('banking', 'open-branch', { city: 'Riyadh' });
  const k = S().bank;
  assert.ok(Number(k.deposits) > 0, 'open-branch must seed deposits');
  assert.ok(Number(k.hqla) > before,
    'HQLA must grow with the deposit base - nothing in the repo used to write it at all');
  assert.ok(Number(k.stableFunding) > 0,
    'available stable funding must grow with the deposit base');

  window.GH_REALISM.onDay(S(), 2);
  const b = S().realism.banking;
  assert.strictEqual(b.dormant, false, 'a bank holding deposits is no longer dormant');
  assert.ok(Number(b.lcr) >= 100, `an operating bank must stay LCR compliant (got ${b.lcr})`);
  assert.ok(Number(b.nsfr) >= 100, `an operating bank must stay NSFR compliant (got ${b.nsfr})`);
  assert.strictEqual(criticalIds().length, 0, `opening a branch must not create a critical breach: ${JSON.stringify(criticalIds())}`);
}

// ---- 5) إصدار القروض يرفع التمويل المستقر المطلوب ويبقى ملتزمًا ----
{
  dispatch('banking', 'issue-loans', { amount: 50000000 });
  window.GH_REALISM.onDay(S(), 3);
  const b = S().realism.banking;
  assert.ok(Number(S().bank.loans) > 0, 'issue-loans must book loans');
  assert.ok(Number(b.nsfr) >= 100, `NSFR must stay compliant after lending (got ${b.nsfr})`);
  assert.strictEqual(criticalIds().length, 0, `lending must not create a critical breach: ${JSON.stringify(criticalIds())}`);
}

// ---- 6) تحصين المُوزّع: عطل حرج موروث لا يجوز أن يرفض كل أمر ----
// نزرع عطلًا حرجًا قائمًا (CET1 دون الحد) ثم نتأكد أن الأوامر ما زالت تمر، وأن المُوزّع
// يرفض فقط ما يُحدثه الأمر نفسه. بدون هذا التحصين، أي عطل حرج = لعبة مقفلة بلا مخرج.
{
  const restoreCet1 = S().realism.banking.cet1;
  const restoreDormant = S().realism.banking.dormant;
  S().bank.branches = Math.max(1, Number(S().bank.branches) || 0);
  S().realism.banking.cet1 = 1;
  S().realism.banking.dormant = false;
  const pre = criticalIds();
  assert.ok(pre.includes('BANK_CET1_REGULATORY_MIN'),
    `the seeded pre-existing critical must be visible, got ${JSON.stringify(pre)}`);
  let out = null;
  assert.doesNotThrow(() => { out = dispatch('hr', 'hire', { role: 'driver', count: 1 }); },
    'a critical inherited from earlier state must not reject every command in the game');
  assert.ok(out && out.ok === true, 'the command must actually commit, not silently no-op');
  // نعيد الحالة سليمة: إجراءات الواجهة غير المتزامنة قد تكون معلّقة، وتحققها يعمل بعد
  // هذا القسم، فترك عطل حرج مزروع يجعلها ترفض بحق ويُسقط الاختبار لسبب مصطنع.
  S().realism.banking.cet1 = restoreCet1;
  S().realism.banking.dormant = restoreDormant;
  assert.strictEqual(criticalIds().length, 0, `state must be restored clean: ${JSON.stringify(criticalIds())}`);
}

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('bank-day-boundary-deadlock-build282-test: ok');
process.exit(0);
