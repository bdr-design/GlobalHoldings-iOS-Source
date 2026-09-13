const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const WEBAPP = path.join(__dirname, '..', 'WebApp');
const html = fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom;
window.L = (() => { const chain=()=>stub; const stub={addTo:chain,on:chain,off:chain,remove:chain,setLatLng:chain,setStyle:chain,bindPopup:chain,bindTooltip:chain,openPopup:chain,closePopup:chain,setIcon:chain,getLatLng:()=>[0,0],invalidateSize:chain,fitBounds:chain,removeLayer:chain,addLayer:chain,eachLayer(){},clearLayers:chain,getBounds:()=>({contains:()=>true}),getZoom:()=>3,setView:()=>stub}; return {map:()=>stub,tileLayer:()=>stub,layerGroup:()=>stub,featureGroup:()=>stub,marker:()=>stub,circleMarker:()=>stub,circle:()=>stub,polyline:()=>stub,polygon:()=>stub,divIcon:()=>({}),icon:()=>({}),svg:()=>stub,canvas:()=>stub,control:{layers:()=>stub,zoom:()=>stub},geoJSON:()=>stub,latLng:(a,b)=>[a,b],latLngBounds:()=>stub,Browser:{mobile:false,touch:false},version:'stub'}; })();
window.matchMedia = window.matchMedia || (q=>({matches:false,media:q,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true;}}));
const uncaughtByPanel = {};
let currentPanel = 'BOOT';
window.addEventListener('error', e=>{ (uncaughtByPanel[currentPanel] ||= []).push(e.error?.message||e.message); });
const scripts=[...fs.readFileSync(path.join(WEBAPP,'index.html'),'utf8').matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]).filter(s=>!/^https?:/.test(s));
for(const file of scripts) window.eval(fs.readFileSync(path.join(WEBAPP,file),'utf8'));

const S = window.__GH_STATE__;
const click=sel=>{const el=window.document.querySelector(sel); if(!el)return false; el.dispatchEvent(new window.Event('click',{bubbles:true})); return true;};

// تمويل ضخم وفتح كل الشركات لضمان أوسع تغطية ممكنة عند زيارة كل قسم
click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
window.document.getElementById('addMoneyInput').value = '5000000000000'; click('#addMoneyBtn');
for (const type of ['air','sea','road','power','bank']) {
  click('[data-companytab="subs"]');
  click(`.open-company[data-type="${type}"]`);
}
click('[data-companytab="subs"]'); click('.open-company[data-type="mobility"]');

const panels = ['actionCenter','aiApprovals','audit','bank','career','companies','controlPlane','cyber','diagnostics','energy','esg','governance','governanceHub','insurance','intelligence','labor','leadershipHub','legal','ma','news','peopleHub','procurement','programs','realism','research','safety','settings','systemHub','treasury','updates',
  'control','network','routes','market','finance','assets','invoices','expansion','ports'];
const withArg = { companyManage:['air','sea','road','power','bank','mobility'] };

const results = {};
function openDrawerDirect(panel, arg) {
  currentPanel = panel + (arg?`(${arg})`:'');
  // openDrawer دالة داخلية مغلقة لا يمكن الوصول لها عبر window.eval بعد الإقلاع؛ نحقن زرًا مؤقتًا
  // بنفس السمات الحقيقية (data-open/data-arg) ونضغطه فعليًا، بعد إعادة ربط عامة حقيقية.
  const btn = window.document.createElement('button');
  btn.setAttribute('data-open', panel);
  if (arg) btn.setAttribute('data-arg', arg);
  window.document.body.appendChild(btn);
  click('[data-panel="workspaceHub"]'); // يشغّل bindDrawerActions فيربط الزر المحقون أيضًا
  try {
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  } catch(e) {
    (uncaughtByPanel[currentPanel] ||= []).push('THROWN: ' + e.message);
  }
  btn.remove();
  const bodyHtml = window.document.getElementById('drawerBody')?.innerHTML || '';
  const flags = [];
  if (/\bNaN\b/.test(bodyHtml)) flags.push('NaN visible in rendered HTML');
  if (/>undefined</.test(bodyHtml) || />undefined%/.test(bodyHtml)) flags.push('literal "undefined" visible in rendered HTML');
  if (/\$NaN|NaNM|NaNK|NaNT/.test(bodyHtml)) flags.push('NaN inside a formatted money/number value');
  if (bodyHtml.length < 80) flags.push(`suspiciously short output (${bodyHtml.length} chars) - possibly blank/broken panel`);
  const title = window.document.getElementById('drawerTitle')?.textContent || '';
  results[currentPanel] = { len: bodyHtml.length, title, flags, errors: uncaughtByPanel[currentPanel] || [] };
}

for (const p of panels) openDrawerDirect(p);
for (const [p, args] of Object.entries(withArg)) for (const a of args) openDrawerDirect(p, a);

const assert = require('assert');
let totalFlags = 0;
for (const [panel, r] of Object.entries(results)) {
  if (r.flags.length || r.errors.length) {
    totalFlags++;
    console.log(`FLAGGED ${panel}:`, r.flags.concat(r.errors).join(' | '));
  }
}
assert.strictEqual(Object.keys(results).length, 45, 'this sweep must actually visit all 45 known panel instances (39 base panels + 6 companyManage types) - if this number changes, a panel was added/removed and this test must be updated to match, not silently skip coverage');
assert.strictEqual(totalFlags, 0, `${totalFlags} panel(s) showed NaN, undefined, a suspiciously-empty render, or a runtime error - see output above`);
for (const [panel, r] of Object.entries(results)) {
  assert(r.title && r.title !== 'لوحة', `panel "${panel}" has no real title configured anywhere (falls back to the generic default) - add one to panelMeta/meta()`);
}
console.log('Full-game panel sweep (45 real click-throughs, zero NaN/undefined/errors, every panel has a real title) BUILD276: PASS');
process.exit(0);
