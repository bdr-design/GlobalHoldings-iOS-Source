'use strict';
// BUILD282: يحفظ اختيار طبقة الخريطة (ليلي/قياسي/فاتح/أقمار صناعية) بدل رجوعه لـ"ليلي تشغيلي"
// افتراضيًا عند كل إعادة فتح.
//
// السبب: setMapLayer(name) كانت تبدّل الطبقة المرئية وتحدّث تنسيق الأزرار، لكن لا تكتب الاختيار في
// state إطلاقًا - متغيّر جلسة مؤقت بالكامل. وinitMap() كانت تستدعي setMapLayer('dark') بقيمة ثابتة
// عند كل إقلاع، بغض النظر عمّا اختاره اللاعب سابقًا. النتيجة: أي اختيار لطبقة "أقمار صناعية" أو
// "قياسي" أو "فاتح" يُفقَد فور إغلاق التطبيق وإعادة فتحه.
//
// الإصلاح: state.mapLayer تُكتب في كل استدعاء حقيقي لـsetMapLayer، وinitMap() تستعيدها عند الإقلاع
// (بفحص أنها قيمة طبقة صالحة فعليًا، دفاعًا عن حفظة قديمة أو تالفة).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WEBAPP = path.join(__dirname, '..', 'WebApp');
const raw = fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8');

function bootFresh(preseed) {
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
  if (preseed) preseed(window);
  for (const f of [...raw.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s))) {
    window.eval(fs.readFileSync(path.join(WEBAPP, f), 'utf8'));
  }
  const click = sel => { const el = window.document.querySelector(sel); if (el) el.dispatchEvent(new window.Event('click', { bubbles: true })); return !!el; };
  return { window, uncaught, click };
}

const storageKey = 'global-holdings-world-v2.0.0';

// ---- 1) لعبة جديدة تبدأ بقياسي بدل فرض الطبقة الليلية ----
{
  const { window: w, click: c } = bootFresh();
  c('#skipFounder');
  assert.strictEqual(w.__GH_STATE__.mapLayer, 'standard', 'a brand-new game must default to the standard layer, not force night mode');
}

// ---- 2) دورة كاملة حقيقية: اختيار طبقة → حفظ حقيقي → إقلاع نافذة جديدة تمامًا → استعادة صحيحة ----
{
  const first = bootFresh();
  const { window: w1, click: c1 } = first;
  c1('#skipFounder');
  c1('#layerBtn');
  c1('[data-layer="satellite"]');
  assert.strictEqual(w1.__GH_STATE__.mapLayer, 'satellite', 'choosing satellite via the real UI must update state immediately');

  const commit = w1.GH_PERSISTENCE.commitState(w1.__GH_STATE__, { storageKey });
  assert.ok(commit.ok, 'commitState must succeed');
  const savedRaw = w1.localStorage.getItem(storageKey);
  assert.ok(savedRaw, 'a save must exist after commitState');

  const second = bootFresh(win => win.localStorage.setItem(storageKey, savedRaw));
  assert.strictEqual(second.window.__GH_STATE__.mapLayer, 'satellite',
    'a genuinely fresh relaunch (new JSDOM window, localStorage pre-seeded before any script runs) must restore the chosen layer, not reset to dark');
  const activeBtn = [...second.window.document.querySelectorAll('#layerMenu button')].find(b => b.classList.contains('active'));
  assert.strictEqual(activeBtn?.dataset.layer, 'satellite', 'the restored UI must visually highlight the correct layer button');
  assert.strictEqual(second.uncaught.length, 0, `no uncaught errors expected: ${second.uncaught.join(' | ')}`);
}

// ---- 3) قيمة طبقة غير صالحة داخل حفظة صحيحة وكاملة لا تعطّل الإقلاع - ترجع افتراضيًا بأمان ----
{
  const first3 = bootFresh();
  const { window: w3, click: c3 } = first3;
  c3('#skipFounder');
  const commit3 = w3.GH_PERSISTENCE.commitState(w3.__GH_STATE__, { storageKey });
  assert.ok(commit3.ok, 'baseline commit must succeed');
  const corrupted = JSON.parse(w3.localStorage.getItem(storageKey));
  corrupted.mapLayer = 'not-a-real-layer';
  const corruptedRaw = JSON.stringify(corrupted);

  const third = bootFresh(win => win.localStorage.setItem(storageKey, corruptedRaw));
  assert.strictEqual(third.uncaught.length, 0, `an invalid saved mapLayer must not crash boot: ${third.uncaught.join(' | ')}`);
  assert.strictEqual(third.window.__GH_STATE__.mapLayer, 'standard',
    'an unrecognized saved layer name must fall back to standard, not stay as garbage or force night mode');
}

console.log('map-layer-persistence-build282-test: ok');
process.exit(0);
