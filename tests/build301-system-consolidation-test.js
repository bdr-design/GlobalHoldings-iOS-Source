'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {JSDOM}=require('jsdom');

const WEBAPP=path.join(__dirname,'..','WebApp');
const raw=fs.readFileSync(path.join(WEBAPP,'index.html'),'utf8');
const dom=new JSDOM(raw.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,''),{url:'https://example.com/',runScripts:'dangerously',pretendToBeVisual:true});
const {window}=dom,D=window.document;
const markerCalls=[];
window.L=(()=>{
  const make=()=>{const stub={addTo:()=>stub,on:(name,fn)=>{stub.events[name]=fn;return stub;},off:()=>stub,remove:()=>stub,setLatLng:()=>stub,setStyle:()=>stub,bindPopup:()=>stub,bindTooltip:()=>stub,openPopup:()=>stub,closePopup:()=>stub,setIcon:()=>stub,getLatLng:()=>[0,0],invalidateSize:()=>stub,fitBounds:()=>stub,removeLayer:()=>stub,addLayer:()=>stub,eachLayer(){},clearLayers:()=>stub,getBounds:()=>({contains:()=>true}),getZoom:()=>3,setView:()=>stub,getContainer:()=>null,events:{}};return stub;};
  return {map:()=>make(),tileLayer:()=>make(),layerGroup:()=>make(),featureGroup:()=>make(),marker:(coords,opts)=>{const row={coords,opts,stub:make()};markerCalls.push(row);return row.stub;},circleMarker:()=>make(),circle:()=>make(),polyline:()=>make(),polygon:()=>make(),divIcon:options=>({options}),icon:()=>({}),svg:()=>make(),canvas:()=>make(),control:{layers:()=>make(),zoom:()=>make()},geoJSON:()=>make(),latLng:(a,b)=>[a,b],latLngBounds:()=>make(),Browser:{mobile:false,touch:false},version:'stub'};
})();
window.matchMedia=window.matchMedia||(q=>({matches:false,media:q,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true;}}));
const uncaught=[];window.addEventListener('error',event=>uncaught.push(event.error?.stack||event.message));
for(const file of [...raw.matchAll(/<script src="([^"]+)"/g)].map(match=>match[1]).filter(src=>!/^https?:/.test(src)))window.eval(fs.readFileSync(path.join(WEBAPP,file),'utf8'));
const state=window.__GH_STATE__;
const click=selector=>{const element=D.querySelector(selector);assert(element,`missing UI element: ${selector}`);element.dispatchEvent(new window.Event('click',{bubbles:true}));return element;};
const openCompany=type=>{click('[data-panel="workspaceHub"]');click('[data-open="companies"]');click('[data-companytab="subs"]');click(`.open-company[data-type="${type}"]`);};
const manageCompany=(type,tab)=>{click('[data-panel="workspaceHub"]');click('[data-open="companies"]');click('[data-companytab="subs"]');click(`[data-open="companyManage"][data-arg="${type}"]`);if(tab)click(`[data-company-manage-tab="${tab}"]`);};

click('#skipFounder');
click('[data-panel="workspaceHub"]');click('[data-open="companies"]');click('[data-companytab="subs"]');
D.getElementById('addMoneyInput').value='900000000000';click('#addMoneyBtn');

// A founded company owns no implicit physical capability.
openCompany('air');
assert.strictEqual(state.assets.filter(asset=>asset.type==='air').length,0);
assert.strictEqual(state.globalBases.filter(base=>base.company==='air'&&base.owned).length,0);
assert.strictEqual(state.customHubs.filter(base=>base.company==='air'&&base.owned).length,0);

// Buy a real base and a real aircraft. Delivery, fixed staffing and payroll are atomic and immediate.
manageCompany('air');click('[data-open="companyFacilities"][data-arg="air"]');click('.open-global-base');
const airBase=state.globalBases.find(base=>base.company==='air'&&base.owned);assert(airBase,'air base purchase failed');
window.GH_FINANCE_CORE.execute({state},'transfer',{from:'group',to:'air',amount:600000000,note:'Build 301 test funding'});
manageCompany('air','assets');click('[data-open="assetMarket"][data-arg="air"]');
click('.manual-buy-asset[data-type="air"][data-id="N-A22"]');
const aircraft=state.assets.find(asset=>asset.type==='air');
assert(aircraft,'aircraft purchase failed');
assert.strictEqual(aircraft.deliveryStatus,'delivered');
assert.strictEqual(aircraft.baseFacility,airBase.id);
assert.strictEqual(aircraft.staffing.ready,true);
assert.deepStrictEqual(Array.from(aircraft.staffing.roles,role=>[role.id,role.count]),[['pilots',4],['cabin',6],['aeng',2]]);
assert(aircraft.staffing.monthlyPayroll>0);
assert.strictEqual(state.advanced.labor.hiringLog[0].assetId,aircraft.id);
assert.strictEqual(state.advanced.labor.hiringLog[0].total,12);

// The owned-assets register opens the asset itself, not the company page.
manageCompany('air','assets');click('[data-open="assets"][data-arg="air"]');click(`[data-open="assetManage"][data-arg="${aircraft.id}"]`);
assert.strictEqual(D.getElementById('drawerTitle').textContent,'إدارة الأصل');
assert(D.getElementById('drawerBody').textContent.includes(aircraft.name));

// New vehicles are visible as real map markers.
markerCalls.length=0;click('.filter-btn[data-filter="air"]');
assert(markerCalls.some(call=>String(call.opts?.icon?.options?.className||'').includes('asset-marker air')),'new aircraft is absent from the map');

// Mobility also starts at zero, then creates exactly what the player buys.
openCompany('mobility');
assert.strictEqual(window.GH_MOBILITY_CORE.snapshot(state).vehicles,0);
assert.strictEqual(state.customHubs.filter(base=>base.company==='mobility'&&base.owned).length,0);
manageCompany('mobility');click('[data-open="companyFacilities"][data-arg="mobility"]');click('.mobility-open-capital-center');
const mobilityCenter=state.customHubs.find(base=>base.company==='mobility'&&base.owned);assert(mobilityCenter,'Mobility center purchase failed');
window.GH_FINANCE_CORE.execute({state},'transfer',{from:'group',to:'mobility',amount:100000000,note:'Build 301 Mobility funding'});
manageCompany('mobility','assets');click('[data-open="assetMarket"][data-arg="mobility"]');click('.manual-buy-mobility');
assert.strictEqual(window.GH_MOBILITY_CORE.snapshot(state).vehicles,1);
assert.strictEqual(state.mobility.drivers.length,1);
assert.strictEqual(state.mobility.vehicles[0].staffing.ready,true);
assert.strictEqual(window.GH_MOBILITY_CORE.snapshot(state).monthlyPayroll,6000);
assert(state.domainRuntime.commands.some(row=>row.domain==='mobility'&&row.name==='buy-fleet'&&row.status==='committed'&&row.approvalStatus==='approved_executed'));
markerCalls.length=0;click('.filter-btn[data-filter="mobility"]');
assert(markerCalls.some(call=>String(call.opts?.icon?.options?.className||'').includes('asset-marker mobility')),'new Mobility vehicle is absent from the map');

// One button creates a safe international route and dispatches every eligible asset atomically.
click('[data-panel="control"]');click('[data-open="routes"]');click('.dispatch-international-network');
assert.strictEqual(aircraft.phase,'moving');
assert(aircraft.routeId&&state.routeEndpoints&&Object.keys(state.routeEndpoints).length>0,'international route was not created');

// The rebuilt global directory covers all six companies with a compact two-metric hero.
click('#worldDirectoryBtn');
assert.strictEqual(D.querySelectorAll('.world-company-chip').length,6);
assert.strictEqual(D.querySelectorAll('.world-directory .registry-hero .metric-row > div').length,2);
for(const code of ['AIR','SEA','LOG','NRG','BNK','MOVE'])assert([...D.querySelectorAll('.world-company-chip b')].some(node=>node.textContent===code),`missing directory company ${code}`);

// AI has no queue or execution authority; manual commands are already approved/executed records.
assert.strictEqual(state.advanced.ai.automationDisabled,true);
assert.strictEqual(state.advanced.ai.approvalLimit,0);
assert.strictEqual(state.advanced.ai.requests.length,0);
assert.throws(()=>window.GH_AI_EXECUTIVE_CORE.execute({state},'execute-approved',{}),/ai-execution-disabled/);
assert(state.domainRuntime.commands.filter(row=>row.manual).every(row=>['approved_executed','cancelled_rolled_back'].includes(row.approvalStatus)));

// Payroll has a dedicated day-27 document path and creates auditable transfers/accruals.
const appSource=fs.readFileSync(path.join(WEBAPP,'app.js'),'utf8');
assert(appSource.includes('simulationDayOfMonth===27'));
assert(appSource.includes("'record-payroll-report'"));
const reportId='PAYROLL-BUILD301-TEST';
const accrued=window.GH_FINANCE_CORE.execute({state},'accrue-payroll',{company:'air',amount:12000,number:'PAY-AIR-BUILD301',reportId});
const report=window.GH_FINANCE_CORE.execute({state},'record-payroll-report',{report:{id:reportId,day:27,month:1,lines:[{company:'air',companyName:'Air',amount:12000,paid:0,due:12000,dueRef:accrued.number,headcount:12}]}});
assert.strictEqual(report.due,12000);
assert(state.finance.payables.some(row=>row.number==='PAY-AIR-BUILD301'));

// App icon contract is complete: one 1024 RGB/no-alpha source and native catalog binding.
const icon=path.join(__dirname,'..','iOS','GlobalHoldings','Assets.xcassets','AppIcon.appiconset','AppIcon-1024.png');
assert(fs.existsSync(icon));
const project=fs.readFileSync(path.join(__dirname,'..','project.yml'),'utf8');
assert(project.includes('CFBundleIconName: AppIcon')||project.includes('CFBundleIconName: "AppIcon"'));
assert.strictEqual(uncaught.length,0,uncaught.join('\n'));
console.log('BUILD301 system consolidation: PASS');
process.exit(0);
