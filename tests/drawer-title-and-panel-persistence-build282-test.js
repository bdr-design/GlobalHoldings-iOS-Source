'use strict';
// BUILD282: يمنع رجوع فقدان آخر شاشة يفتحها المستخدم، ويحمي عنوان الدرج التابع للتبويب النشط.
//
// 1) activeDrawerPanel/activeDrawerArg كانا متغيّرين بالذاكرة فقط - أي إغلاق حقيقي للتطبيق يفقدهما
//    تمامًا، فتفتح اللعبة دائمًا على نفس الحالة الافتراضية بغض النظر عمّا كان يفعله المستخدم. صارا
//    state.lastPanel/lastPanelArg: تُكتب في openDrawer()، تُمسح في closeDrawer() (إغلاق الدرج
//    قصدًا هو نفسه خيار يُتذكَّر)، وتُستعاد بعد initMap() عند الإقلاع - محميّة بـtry/catch حتى لا
//    يعطّل حفظ قديم أو تالف الإقلاع بالكامل.
//
// 2) meta() كانت تُرجع نفس العنوان الثابت "مركز إدارة الشركة" لكل تبويبات companyManage السبعة
//    ولكل الشركات الست، فيبدو الانتقال بين "الأصول" و"القيادة" وكأنه "نفس صفحة الشركة" دائمًا. صارت
//    tab-aware عبر COMPANY_TAB_LABELS/COMPANY_DISPLAY_NAMES مشتركة مع companyView() نفسها (بدل
//    نسخة ثانية من نفس التسميات) فتُنتج مثلًا "المالية · الشركة العالمية للطيران".
//
// الإثبات أدناه يمر بدورة حفظ/تحميل حقيقية كاملة: تأسيس فعلي، تنقّل حقيقي، commitState حقيقي إلى
// localStorage، ثم إقلاع نافذة جديدة تمامًا ببيانات محلية مزروعة قبل أي سكربت - لا اختصارات.
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
  if (preseed) preseed(window); // localStorage exists on `window` الآن، لكن لم يُشغَّل أي سكربت بعد
  for (const f of [...raw.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s))) {
    window.eval(fs.readFileSync(path.join(WEBAPP, f), 'utf8'));
  }
  const click = sel => { const el = window.document.querySelector(sel); if (el) el.dispatchEvent(new window.Event('click', { bubbles: true })); return !!el; };
  return { window, uncaught, click };
}

const storageKey = 'global-holdings-world-v2.0.0';

// ---- 1) دورة كاملة: تأسيس → تنقّل → حفظ حقيقي → إقلاع نافذة جديدة من الصفر → استعادة تلقائية ----
{
  const first = bootFresh();
  const { window: w1, click: c1 } = first;
  c1('#skipFounder');
  assert.strictEqual(w1.__GH_STATE__.onboardingComplete, true, 'skipFounder must complete onboarding');
  c1('[data-panel="workspaceHub"]'); c1('[data-open="companies"]'); c1('[data-companytab="subs"]');
  const moneyInput = w1.document.getElementById('addMoneyInput');
  moneyInput.value = '500000000000';
  c1('#addMoneyBtn');
  for (const f of [...w1.document.querySelectorAll('.open-company')]) f.dispatchEvent(new w1.Event('click', { bubbles: true }));
  c1('[data-panel="workspaceHub"]'); c1('[data-open="companies"]'); c1('[data-companytab="subs"]');
  c1('[data-open="companyManage"][data-arg="air"]'); c1('[data-company-manage-tab="finance"]');
  assert.strictEqual(w1.__GH_STATE__.lastPanel, 'companyManage', 'lastPanel must be set after navigating');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w1.__GH_STATE__.lastPanelArg)), { type: 'air', tab: 'finance' },
    'lastPanelArg must capture the exact type and tab');

  const commit = w1.GH_PERSISTENCE.commitState(w1.__GH_STATE__, { storageKey });
  assert.ok(commit.ok, `commitState must succeed: ${JSON.stringify(commit)}`);
  const savedRaw = w1.localStorage.getItem(storageKey);
  assert.ok(savedRaw, 'a save must exist in localStorage after commitState');

  const second = bootFresh(win => win.localStorage.setItem(storageKey, savedRaw));
  assert.strictEqual(second.window.__GH_STATE__.onboardingComplete, true, 'restored save must already be past onboarding');
  assert.strictEqual(second.window.__GH_STATE__.lastPanel, 'companyManage', 'restored state must carry lastPanel');
  const drawer = second.window.document.getElementById('drawer');
  assert.ok(drawer.classList.contains('open'), 'the drawer must auto-reopen on boot when the save has lastPanel set');
  assert.strictEqual(second.window.document.getElementById('drawerTitle').textContent, 'المالية · الشركة العالمية للطيران',
    'the exact tab-specific title must render immediately on restore');
  assert.strictEqual(second.uncaught.length, 0, `no uncaught errors expected on restore: ${second.uncaught.join(' | ')}`);
}

// ---- 2) إغلاق الدرج قصدًا يُمسح ويُحترَم عند الإقلاع التالي (لا يُفرض عليه فتح شاشة قديمة) ----
{
  const first = bootFresh();
  const { window: w1, click: c1 } = first;
  c1('#skipFounder');
  c1('[data-panel="leadershipHub"]');
  assert.strictEqual(w1.__GH_STATE__.lastPanel, 'leadershipHub', 'opening a panel must record it');
  w1.document.getElementById('drawer').querySelector('.drawer-close, [aria-label="إغلاق"], button')?.click();
  // استدعاء closeDrawer المباشر عبر الزر الحقيقي غير مضمون الوجود بهذا الشكل؛ التحقق الأهم أن
  // closeDrawer نفسها (مُستدعاة من عدة أزرار حقيقية) تصفّر الحقلين - نتحقق من ذلك عبر backdrop click
  // الذي يستدعي نفس closeDrawer في هذا الكود.
  w1.document.getElementById('backdrop')?.dispatchEvent(new w1.Event('click', { bubbles: true }));
  assert.strictEqual(w1.__GH_STATE__.lastPanel, null, 'closing the drawer must clear lastPanel, not leave a stale value');
}

// ---- 3) عنوان الدرج يتبع كل تبويب من السبعة، لكل الشركات الست ----
{
  const { window: w, click: c } = bootFresh();
  c('#skipFounder');
  c('[data-panel="workspaceHub"]'); c('[data-open="companies"]'); c('[data-companytab="subs"]');
  const inp = w.document.getElementById('addMoneyInput'); inp.value = '500000000000'; c('#addMoneyBtn');
  for (const f of [...w.document.querySelectorAll('.open-company')]) f.dispatchEvent(new w.Event('click', { bubbles: true }));
  const expectedNames = { air: 'الشركة العالمية للطيران', sea: 'الشركة العالمية للشحن البحري', road: 'اللوجستيات العالمية',
    power: 'شركة الطاقة العالمية', bank: 'بنك المجموعة', mobility: 'GH Mobility للتنقل الذكي' };
  const expectedTabs = { overview: 'القيادة', operations: 'التشغيل', assets: 'الأصول', people: 'الأفراد', finance: 'المالية', risk: 'المخاطر' };
  for (const [type, name] of Object.entries(expectedNames)) {
    c('[data-panel="workspaceHub"]'); c('[data-open="companies"]'); c('[data-companytab="subs"]');
    c(`[data-open="companyManage"][data-arg="${type}"]`);
    for (const [tab, label] of Object.entries(expectedTabs)) {
      c(`[data-company-manage-tab="${tab}"]`);
      assert.strictEqual(w.document.getElementById('drawerTitle').textContent, `${label} · ${name}`,
        `${type}/${tab} must show a tab-specific title`);
    }
  }
  // اللوحات الأخرى غير المتأثرة
  c('[data-panel="leadershipHub"]');
  assert.strictEqual(w.document.getElementById('drawerTitle').textContent, 'مركز القيادة والقرار',
    'unrelated panels must keep their original static title');
}

console.log('drawer-title-and-panel-persistence-build282-test: ok');
process.exit(0);
