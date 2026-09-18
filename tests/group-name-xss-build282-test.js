const {foundGame}=require('./helpers/found-game');
(async()=>{
'use strict';
// BUILD282: يمنع رجوع ثغرة XSS مخزَّنة عبر اسم المجموعة (أول حقل نص يكتبه أي لاعب في اللعبة).
//
// الجذر: hero() في advanced-core.js تُدرج title في alt="${title}" و<h3>${title}</h3> بلا أي
// تهريب - تثق بأن المستدعي يهرّب القيمة قبل التمرير. كل استدعاء آخر لـhero() في المستودع (33
// موضعًا فُحصت جميعًا) إما يمرر نصًا ثابتًا أو قيمة مُهرَّبة مسبقًا، ما عدا هذا الموضع الوحيد في
// renderCompanies('holding'): hero(photos.hq, s.profile.name, ...) - وs.profile.name هو حرفيًا
// حقل "اسم المجموعة" في شاشة التأسيس، بلا أي قيد على المحتوى غير maxlength=42.
//
// الإثبات: اسم مجموعة = <img src=x onerror="..."> يصبح عنصر <img> حقيقيًا بخاصية onerror حية
// داخل <h3> فعلي في الـDOM بعد فتح تبويب "الشركة القابضة" - ينفّذ فورًا في متصفح حقيقي (onerror
// يُطلَق عند فشل تحميل src="x"، بخلاف <script> عبر innerHTML التي تبقى خاملة).
//
// الإصلاح: تهريب s.profile.name (والمدينة/الدولة دفاعًا في العمق، رغم أنهما من <select> ثابتة
// حاليًا) قبل تمريرها إلى hero().
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

const PAYLOAD = '<img src=x onerror="window.__XSS_FIRED=true">';
await foundGame(window);
// Older saves and later rename commands still require output escaping.
window.GH_CORPORATE_CORE.execute({state:window.__GH_STATE__},'rename-company',{type:'group',legalName:PAYLOAD});
assert.strictEqual(window.__GH_STATE__.profile.name, PAYLOAD, 'the raw payload must be stored as-is (escaping happens at render time, not input time)');

click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="holding"]');

const h3 = D.querySelector('.visual-hero-copy h3');
assert.ok(h3, 'the holding-company hero heading must render');
assert.strictEqual(h3.querySelector('img'), null,
  'a malicious <img onerror> element must NOT exist as a real DOM node inside the heading');
assert.ok(h3.textContent.includes('<img'), 'the payload must appear as inert text, not be silently dropped');

const heroImg = D.querySelector('.visual-hero > img[data-gh-image]');
assert.ok(heroImg, 'the hero background image must render with its expected marker attribute intact');
assert.strictEqual(heroImg.getAttribute('src'), 'assets/images/company-hq-v2.webp',
  'the image src must be exactly the app asset, not corrupted by an attribute-breakout from the payload');

assert.strictEqual(uncaught.length, 0, `no uncaught errors expected: ${uncaught.join(' | ')}`);
console.log('group-name-xss-build282-test: ok');
process.exit(0);

})().catch(error=>{console.error(error);process.exitCode=1;});
