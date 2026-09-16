'use strict';
// BUILD282: يضيف اعتمادًا جماعيًا حقيقيًا لطلبات AI المعلّقة - تنفيذًا لطلب تقليل انتظار الاعتماد.
//
// الموجود أصلًا: زر "ai-request-delegate" ينفّذ طلبًا واحدًا بضغطة (تفويض + تنفيذ الأثر الفعلي حسب
// نوعه: تحويل مالي، توظيف، توسعة سعة، فتح منشأة، صيانة، تدقيق...)، وزر "ai-reject-all-pending"
// يرفض كل المعلّق دفعة واحدة - لكن لا يوجد نظير للاعتماد الجماعي، فقط الرفض الجماعي. اللاعب مضطر
// يفتح كل طلب على حدة ليعتمده.
//
// الإصلاح: استُخرج منطق التفويض+التنفيذ المشترك بين الأنواع السبعة (كان مكررًا داخل معالج الزر
// الفردي فقط) إلى executeApprovedAiRequest(r,ctx)، ويستدعيه الآن كل من الزر الفردي (سلوكه
// الملاحظ يبقى مطابقًا تمامًا لما كان عليه) وزر "ai-approve-all-pending" الجديد الذي يمر على كل
// طلب معلّق، يطبّق نفس حد الجودة الصارم 60/100 (aiEnsureRequestStudy، الدالة نفسها لا نسخة
// جديدة)، وينفّذ فعليًا (لا يكتفي بتغيير الحالة) عبر نفس معاملة GH_TRANSACTION_CORE الذرية.
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
for (let i = 0; i < 5; i++) {
  window.GH_AI_EXECUTIVE_CORE.submit(st, { id: `TEST-REQ-${i}`, company: 'air', kind: 'funding', title: `طلب ${i}`, cost: 1000000, reason: 'x'.repeat(60) });
}
const pendingBefore = st.advanced.ai.requests.filter(r => r.status === 'بانتظار التفويض').length;
assert.strictEqual(pendingBefore, 5, 'setup must produce 5 pending requests');
const airBalanceBefore = st.companyFinance.air.accounts[0].balance;

// ---- 1) الزر يظهر فقط عندما يتجاوز المعلّق 3، بنفس شرط نظيره الرافض ----
click('[data-panel="leadershipHub"]'); click('[data-open="aiApprovals"]');
const approveAllBtn = D.querySelector('[data-gh-action="ai-approve-all-pending"]');
const rejectAllBtn = D.querySelector('[data-gh-action="ai-reject-all-pending"]');
assert.ok(approveAllBtn, 'the bulk-approve button must render when pending count exceeds 3');
assert.ok(rejectAllBtn, 'the existing bulk-reject button must still render unchanged');

// ---- 2) الضغط عليه يعتمد وينفّذ فعليًا كل الطلبات المعلّقة، لا يغيّر الحالة فقط ----
approveAllBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
const pendingAfter = st.advanced.ai.requests.filter(r => r.status === 'بانتظار التفويض').length;
assert.strictEqual(pendingAfter, 0, 'all 5 pending requests must be resolved after bulk approval');
const archived = st.advanced.ai.requestArchive.filter(r => r.id.startsWith('TEST-REQ'));
assert.strictEqual(archived.length, 5, 'all 5 must be archived as executed, not just status-flipped');
const airBalanceAfter = st.companyFinance.air.accounts[0].balance;
assert.strictEqual(airBalanceAfter, airBalanceBefore + 5000000,
  `the real funding transfer must have executed for all 5 requests: expected ${airBalanceBefore + 5000000}, got ${airBalanceAfter}`);

// ---- 3) مسار الطلب الفردي يبقى يعمل كما كان تمامًا (لم يتأثر باستخراج الدالة المشتركة) ----
window.GH_AI_EXECUTIVE_CORE.submit(st, { id: 'TEST-REQ-SINGLE', company: 'air', kind: 'funding', title: 'طلب فردي', cost: 2000000, reason: 'y'.repeat(60) });
click('[data-panel="leadershipHub"]'); click('[data-open="aiApprovals"]');
const singleBtn = D.querySelector('[data-gh-action="ai-request-delegate"][data-request="TEST-REQ-SINGLE"]');
assert.ok(singleBtn, 'the single-request approval button must still render for a specific pending request');
const balanceBeforeSingle = st.companyFinance.air.accounts[0].balance;
singleBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
assert.strictEqual(st.companyFinance.air.accounts[0].balance, balanceBeforeSingle + 2000000,
  'the single-request path must still execute the real transfer exactly as before');

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('ai-bulk-approval-build282-test: ok');
process.exit(0);
