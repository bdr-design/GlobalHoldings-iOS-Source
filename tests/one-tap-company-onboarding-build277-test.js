'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const WEBAPP = path.join(__dirname, '..', 'WebApp');
const html = fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom;
const calls = { facilityMarkers: [], setView: [], vehicleMarkers: 0 };
window.L = (() => { const chain=()=>stub; const stub={addTo:chain,on:chain,off:chain,remove:chain,setLatLng:chain,setStyle:chain,bindPopup:chain,bindTooltip:chain,openPopup:chain,closePopup:chain,setIcon:chain,getLatLng:()=>[0,0],invalidateSize:chain,fitBounds:chain,removeLayer:chain,addLayer:chain,eachLayer(){},clearLayers:chain,getBounds:()=>({contains:()=>true}),getZoom:()=>3,setView:(c,z)=>{calls.setView.push([c,z]);return stub;}};
  return {map:()=>stub,tileLayer:()=>stub,layerGroup:()=>stub,featureGroup:()=>stub,marker:(coords,opts)=>{calls.facilityMarkers.push({coords,cls:opts?.icon?.options?.className});return stub;},circleMarker:()=>{calls.vehicleMarkers++;return stub;},circle:()=>stub,polyline:()=>stub,polygon:()=>stub,divIcon:o=>({options:o}),icon:()=>({}),svg:()=>stub,canvas:()=>stub,control:{layers:()=>stub,zoom:()=>stub},geoJSON:()=>stub,latLng:(a,b)=>[a,b],latLngBounds:()=>stub,Browser:{mobile:false,touch:false},version:'stub'}; })();
window.matchMedia = window.matchMedia || (q=>({matches:false,media:q,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true;}}));
const uncaught=[]; window.addEventListener('error', e=>uncaught.push(e.error?.message||e.message));
for(const f of [...fs.readFileSync(path.join(WEBAPP,'index.html'),'utf8').matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]).filter(s=>!/^https?:/.test(s))) window.eval(fs.readFileSync(path.join(WEBAPP,f),'utf8'));
const click=sel=>{const el=window.document.querySelector(sel); assert(el,`expected: ${sel}`); el.dispatchEvent(new window.Event('click',{bubbles:true}));};
const S=window.__GH_STATE__;

click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
window.document.getElementById('addMoneyInput').value='1000000000000'; click('#addMoneyBtn');

// 1) مجرد تأسيس Mobility من قائمة الشركات (بلا أي خطوة إضافية) يجب أن يضعها على الخريطة فورًا
calls.facilityMarkers=[]; calls.setView=[];
click('.open-company[data-type="mobility"]');
assert(S.customHubs.some(f=>f.id==='MOB-CENTER-RUH'),'founding Mobility alone must create its Riyadh center facility - no hidden extra step');
assert(calls.facilityMarkers.some(m=>Math.abs(m.coords[0]-24.7136)<0.01),'the Riyadh Mobility marker must be drawn on the map immediately on founding');
assert(calls.setView.some(([c,z])=>Math.abs(c[0]-24.71)<.1&&z>=10),'the map must pan to Riyadh at city zoom the moment the company is founded');

// 2) بطاقة الشركة المؤسَّسة تعرض زر خطوة تالية واحد يوصل مباشرة لأول إجراء حقيقي
click('[data-companytab="subs"]');
assert(window.document.querySelector('[data-gh-action="mobility-launch"]'),'the Mobility card must offer a one-tap launch button directly, not buried 4 levels deep');
calls.vehicleMarkers=0;
click('[data-gh-action="mobility-launch"]');
assert.strictEqual(S.mobility.status,'active','one tap from the company card must launch the fleet');
assert(calls.vehicleMarkers>0,'vehicles must be drawn after that single tap');

// 3) نفس المبدأ للطيران: زر يوصل مباشرة لصفحة فيها زر "فتح قاعدة" حقيقي
click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
click('.open-company[data-type="air"]'); click('[data-companytab="subs"]');
const airNext=[...window.document.querySelectorAll('[data-open="companyFacilities"][data-arg="air"]')].find(b=>b.textContent.includes('افتح أول قاعدة'));
assert(airNext,'an unopened-base air company must show a one-tap "open first base" button on its card');
airNext.dispatchEvent(new window.Event('click',{bubbles:true}));
assert(window.document.querySelector('.open-global-base'),'that one tap must land on a page with real open-base buttons');

// 4) شريط حالة الخريطة يعرض صراحة سيارات Mobility والمنشآت المملوكة (حتى تكشف لقطة شاشة ما يراه المحرك)
const status=window.document.getElementById('mapStatus')?.textContent||'';
assert(/سيارة Mobility/.test(status)&&/منشأة مملوكة/.test(status),'the map status bar must explicitly report Mobility vehicles and owned facilities');

// 5) BUILD281: الطاقة والبنك تتبعان نفس نمط Mobility - محرك الشركة داخل تبويب التشغيل في صفحتها،
// وزر الخطوة التالية يفتح ذلك التبويب مباشرة (data-arg="power:operations") بدل لوحة منفصلة.
click('[data-panel="workspaceHub"]'); click('[data-open="companies"]'); click('[data-companytab="subs"]');
click('.open-company[data-type="power"]'); click('[data-companytab="subs"]');
const powerNext=[...window.document.querySelectorAll('[data-open="companyManage"]')].find(b=>b.dataset.arg==='power:operations');
assert(powerNext,'power card must route straight to its operations tab');
powerNext.dispatchEvent(new window.Event('click',{bubbles:true}));
assert(window.document.getElementById('drawerBody').innerHTML.includes('company-company-engine'),'power operations tab must embed the energy engine, same pattern as Mobility');
click('[data-company-manage-tab="finance"]');
assert.strictEqual(uncaught.length,0,'switching tabs from a string "type:tab" arg must not break');

assert.strictEqual(uncaught.length,0,uncaught.join(' | '));
console.log('One-tap company onboarding (found Mobility -> on map instantly; one-tap next-step per company) BUILD277: PASS');
process.exit(0);
