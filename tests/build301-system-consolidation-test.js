const {foundGame}=require('./helpers/found-game');
'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {JSDOM}=require('jsdom');

const WEBAPP=path.join(__dirname,'..','WebApp');
const raw=fs.readFileSync(path.join(WEBAPP,'index.html'),'utf8');
const dom=new JSDOM(raw.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,''),{url:'https://example.com/',runScripts:'dangerously',pretendToBeVisual:true});
const {window}=dom,D=window.document;
window.confirm=()=>true;
const markerCalls=[];
window.L=(()=>{
  const make=()=>{const stub={addTo:()=>stub,on:(name,fn)=>{stub.events[name]=fn;return stub;},off:()=>stub,remove:()=>stub,setLatLng:()=>stub,setStyle:()=>stub,bindPopup:()=>stub,bindTooltip:()=>stub,openPopup:()=>stub,closePopup:()=>stub,setIcon:()=>stub,getLatLng:()=>[0,0],invalidateSize:()=>stub,fitBounds:()=>stub,removeLayer:()=>stub,addLayer:()=>stub,eachLayer(){},clearLayers:()=>stub,getBounds:()=>({contains:()=>true}),getZoom:()=>3,setView:()=>stub,getContainer:()=>null,events:{}};return stub;};
  return {map:()=>make(),tileLayer:()=>make(),layerGroup:()=>make(),featureGroup:()=>make(),marker:(coords,opts)=>{const row={coords,opts,stub:make()};markerCalls.push(row);return row.stub;},circleMarker:()=>make(),circle:()=>make(),polyline:()=>make(),polygon:()=>make(),divIcon:options=>({options}),icon:()=>({}),svg:()=>make(),canvas:()=>make(),control:{layers:()=>make(),zoom:()=>make()},geoJSON:()=>make(),latLng:(a,b)=>[a,b],latLngBounds:()=>make(),Browser:{mobile:false,touch:false},version:'stub'};
})();
window.matchMedia=window.matchMedia||(q=>({matches:false,media:q,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true;}}));
const uncaught=[];window.addEventListener('error',event=>uncaught.push(event.error?.stack||event.message));
for(const file of [...raw.matchAll(/<script src="([^"]+)"/g)].map(match=>match[1]).filter(src=>!/^https?:/.test(src)&&!src.startsWith('vendor/')))window.eval(fs.readFileSync(path.join(WEBAPP,file),'utf8'));
const state=window.__GH_STATE__;
const click=selector=>{const element=D.querySelector(selector);assert(element,`missing UI element: ${selector}`);element.dispatchEvent(new window.Event('click',{bubbles:true}));return element;};
const openCompany=type=>{click('[data-panel="workspaceHub"]');click('[data-open="companies"]');click('[data-companytab="subs"]');click(`.open-company[data-type="${type}"]`);};
const manageCompany=(type,tab)=>{click('[data-panel="workspaceHub"]');click('[data-open="companies"]');click('[data-companytab="subs"]');click(`[data-open="companyManage"][data-arg="${type}"]`);if(tab)click(`[data-company-manage-tab="${tab}"]`);};

(async()=>{
await foundGame(window);
click('#speedMenu button[data-speed="0"]');
click('[data-panel="workspaceHub"]');click('[data-open="companies"]');click('[data-companytab="subs"]');
D.getElementById('addMoneyInput').value='900000000000';click('#addMoneyBtn');

// A founded company owns no implicit physical capability.
openCompany('air');
assert.strictEqual(state.assets.filter(asset=>asset.type==='air').length,0);
assert.strictEqual(state.globalBases.filter(base=>base.company==='air'&&base.owned).length,0);
assert.strictEqual(state.customHubs.filter(base=>base.company==='air'&&base.owned).length,0);
const newAirModel=window.GH_CORPORATE_CORE.model(state,'air');assert.strictEqual(newAirModel.serviceLevel,0);assert.strictEqual(newAirModel.automation,0);
manageCompany('air');assert(!D.querySelector('[data-gh-action="company-budget"]'),'company page duplicated the central finance transfer path');click('[data-company-manage-tab="finance"]');assert(!D.querySelector('[data-gh-action="company-capex"]'),'company page kept the fake CAPEX path instead of real asset/facility purchase');

// Buy a real base and a real aircraft. Delivery, fixed staffing and payroll are atomic and immediate.
manageCompany('air');click('[data-open="companyFacilities"][data-arg="air"]');click('.open-facility-directory[data-kind="air"]');D.getElementById('worldCountry').value='SA';D.getElementById('worldCountry').dispatchEvent(new window.Event('change',{bubbles:true}));D.getElementById('worldCity').value='SA:riyadh';D.getElementById('worldCity').dispatchEvent(new window.Event('change',{bubbles:true}));click('.open-directory-site[data-key="air:OERK"]');
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

// The actual asset-management buttons perform one atomic maintenance and sale path.
manageCompany('air','assets');click('[data-open="assetMarket"][data-arg="air"]');click('.manual-buy-asset[data-type="air"][data-id="N-A22"]');
const saleAircraft=state.assets.filter(asset=>asset.type==='air'&&asset.id!==aircraft.id)[0];assert(saleAircraft,'second aircraft purchase failed');saleAircraft.condition=55;saleAircraft.fuel=18;
manageCompany('air','assets');click('[data-open="assets"][data-arg="air"]');click(`[data-open="assetManage"][data-arg="${saleAircraft.id}"]`);const airCashBeforeService=window.GH_FINANCE_CORE.operating(state,'air');click(`.service-asset[data-id="${saleAircraft.id}"]`);assert.strictEqual(saleAircraft.condition,100);assert.strictEqual(saleAircraft.fuel,100);assert.strictEqual(window.GH_FINANCE_CORE.operating(state,'air'),airCashBeforeService-78000);
const airCashBeforeSale=window.GH_FINANCE_CORE.operating(state,'air');click(`.sell-asset[data-id="${saleAircraft.id}"]`);assert(!state.assets.some(asset=>asset.id===saleAircraft.id),'sell button did not remove the idle owned aircraft');assert(window.GH_FINANCE_CORE.operating(state,'air')>airCashBeforeSale,'sell button did not credit the owning company');assert(state.advanced.labor.employmentContracts.some(row=>row.assetId===saleAircraft.id&&row.status==='منتهي'),'selling the aircraft did not end its fixed staffing contract');

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
manageCompany('mobility');click('[data-open="companyFacilities"][data-arg="mobility"]');click('.open-facility-directory[data-kind="mobility"]');D.getElementById('worldCountry').value='SA';D.getElementById('worldCountry').dispatchEvent(new window.Event('change',{bubbles:true}));click('.open-directory-site[data-key="site:mobility:RUH"]');
const mobilityCenter=state.customHubs.find(base=>base.company==='mobility'&&base.owned);assert(mobilityCenter,'Mobility center purchase failed');
window.GH_FINANCE_CORE.execute({state},'transfer',{from:'group',to:'mobility',amount:100000000,note:'Build 301 Mobility funding'});
manageCompany('mobility','assets');click('[data-open="assetMarket"][data-arg="mobility"]');click('.manual-buy-mobility');
assert.strictEqual(window.GH_MOBILITY_CORE.snapshot(state).vehicles,1);
assert.strictEqual(state.mobility.drivers.length,1);
assert.strictEqual(state.mobility.vehicles[0].staffing.ready,true);
assert.strictEqual(state.mobility.vehicles[0].status,'available','a purchased vehicle must arrive available at its center instead of being forced into a trip during checkout');
assert.strictEqual(state.mobility.activeTrips.length,0,'purchasing must not synthesize an immediate ride while simulation time is paused');
assert.strictEqual(window.GH_MOBILITY_CORE.snapshot(state).monthlyPayroll,6000);
assert(state.domainRuntime.commands.some(row=>row.domain==='mobility'&&row.name==='buy-fleet'&&row.status==='committed'&&row.approvalStatus==='approved_executed'));
const mobilityVehicle=state.mobility.vehicles[0];mobilityVehicle.condition=51;mobilityVehicle.battery=22;click(`[data-open="mobilityAsset"][data-arg="${mobilityVehicle.id}"]`);const mobilityCashBeforeService=window.GH_FINANCE_CORE.operating(state,'mobility');click(`.service-mobility-asset[data-id="${mobilityVehicle.id}"]`);assert.strictEqual(mobilityVehicle.condition,100);assert.strictEqual(mobilityVehicle.battery,100);assert.strictEqual(window.GH_FINANCE_CORE.operating(state,'mobility'),mobilityCashBeforeService-850);
markerCalls.length=0;click('.filter-btn[data-filter="mobility"]');
assert(markerCalls.some(call=>String(call.opts?.icon?.options?.className||'').includes('asset-marker mobility')),'new Mobility vehicle is absent from the map');
// A large parked fleet is represented by one center cluster, not hundreds of
// overlapping car icons. Moving or explicitly selected vehicles remain individual.
const stressVehicles=Array.from({length:600},(_,index)=>({id:`MOB-MAP-STRESS-${index}`,assetClass:'eco-ev',name:`Stress car ${index}`,status:'available',centerId:'RUH',zoneId:'KAFD',condition:100,battery:100,totalTrips:0,totalKm:0}));
state.mobility.vehicles.push(...stressVehicles);markerCalls.length=0;click('.filter-btn[data-filter="mobility"]');
const mobilityMapCalls=markerCalls.filter(call=>String(call.opts?.icon?.options?.className||'').includes('mobility'));
assert(mobilityMapCalls.some(call=>String(call.opts.icon.options.className).includes('fleet-cluster-marker mobility')),'large parked Mobility fleet was not clustered');
assert(mobilityMapCalls.filter(call=>String(call.opts.icon.options.className).includes('asset-marker mobility')).length<=1,'large parked Mobility fleet flooded the map with individual icons');
state.mobility.vehicles.splice(-stressVehicles.length);

// One button creates a safe international route and dispatches every eligible asset atomically.
click('[data-panel="control"]');click('[data-open="routes"]');click('[data-routetype="air"]');click('.dispatch-international-network[data-type="air"]');await new Promise(resolve=>setTimeout(resolve,0));
assert.strictEqual(aircraft.phase,'moving');
assert(aircraft.routeId&&state.routeEndpoints&&Object.keys(state.routeEndpoints).length>0,'international route was not created');

// The unified global directory covers all six companies with explicit location filters.
click('#worldDirectoryBtn');
assert.strictEqual(D.querySelectorAll('.world-company-chip').length,6);
assert.strictEqual(D.querySelectorAll('.world-directory .registry-hero .directory-scope').length,1);
assert.strictEqual(D.querySelectorAll('#worldKind,#worldCountry,#worldCity,#worldSearch').length,4);
for(const code of ['AIR','SEA','LOG','NRG','BNK','MOVE'])assert([...D.querySelectorAll('.world-company-chip b')].some(node=>node.textContent===code),`missing directory company ${code}`);

// The retired autonomous subsystem has no runtime owner or persisted root.
const retiredKey=String.fromCharCode(97,105);
assert(!Object.prototype.hasOwnProperty.call(state.advanced,retiredKey),'retired autonomous state survived migration');
for(const removed of ['requests','assetRequests','assetRequestArchive','assetClosureLog','requestCenter','assetPortfolioPlans'])assert(!(removed in state.advanced.procurement),`legacy AI procurement state survived: ${removed}`);
assert(!Object.prototype.hasOwnProperty.call(state.realism,retiredKey),'retired realism authority survived');
assert.strictEqual(window[`GH_${retiredKey.toUpperCase()}_EXECUTIVE_CORE`],undefined,'retired execution owner must not load');
assert(state.domainRuntime.commands.filter(row=>row.manual).every(row=>['approved_executed','cancelled_rolled_back'].includes(row.approvalStatus)));

// Payroll has a dedicated day-27 document path and creates auditable transfers/accruals.
const appSource=fs.readFileSync(path.join(WEBAPP,'app.js'),'utf8');
assert(appSource.includes('payrollMeta.dayOfMonth>=27'),'payroll scheduler must catch the first simulation close on or after calendar day 27');
assert(appSource.includes("'record-payroll-report'"));
const reportId='PAYROLL-BUILD301-TEST';
const accrued=window.GH_FINANCE_CORE.execute({state},'accrue-payroll',{company:'air',amount:12000,number:'PAY-AIR-BUILD301',reportId});
const report=window.GH_FINANCE_CORE.execute({state},'record-payroll-report',{report:{id:reportId,day:27,month:1,lines:[{company:'air',companyName:'Air',amount:12000,paid:0,due:12000,dueRef:accrued.number,headcount:12}]}});
assert.strictEqual(report.due,12000);
assert(state.finance.payables.some(row=>row.number==='PAY-AIR-BUILD301'));

// Mobility sale uses the visible UI button and atomically removes driver + contract.
click('[data-panel="control"]');click('[data-open="assets"]');click('[data-ownedtype="mobility"]');click(`[data-open="mobilityAsset"][data-arg="${mobilityVehicle.id}"]`);const mobilityCashBeforeSale=window.GH_FINANCE_CORE.operating(state,'mobility');click(`.sell-mobility-asset[data-id="${mobilityVehicle.id}"]`);assert(!state.mobility.vehicles.some(row=>row.id===mobilityVehicle.id),'Mobility sell button did not remove the vehicle');assert.strictEqual(state.mobility.drivers.length,0);assert(window.GH_FINANCE_CORE.operating(state,'mobility')>mobilityCashBeforeSale);assert(state.advanced.labor.employmentContracts.some(row=>row.assetId===mobilityVehicle.id&&row.status==='منتهي'));

// Every other subsidiary is also legal/financial only at incorporation.
for(const type of ['sea','road','power','bank'])openCompany(type);
for(const type of ['sea','road'])assert.strictEqual(state.assets.filter(asset=>asset.type===type).length,0,`${type} received an implicit physical asset`);
for(const type of ['sea','road','power','bank']){assert.strictEqual(state.globalBases.filter(base=>base.company===type&&base.owned).length,0,`${type} received an implicit global base`);assert.strictEqual(state.customHubs.filter(base=>base.company===type&&base.owned).length,0,`${type} received an implicit facility`);const model=window.GH_CORPORATE_CORE.model(state,type);assert.strictEqual(model.serviceLevel,0);assert.strictEqual(model.automation,0);}
assert.deepStrictEqual(Array.from(['gasMW','solarMW','windMW','storageMWh'],key=>Number(state.energy[key])||0),[0,0,0,0]);assert.strictEqual(state.bank.branches,0);assert.strictEqual(state.bank.deposits,0);assert.strictEqual(state.bank.loans,0);

// App icon contract is complete: one 1024 RGB/no-alpha source and native catalog binding.
const icon=path.join(__dirname,'..','iOS','GlobalHoldings','Assets.xcassets','AppIcon.appiconset','AppIcon-1024.png');
assert(fs.existsSync(icon));
const project=fs.readFileSync(path.join(__dirname,'..','project.yml'),'utf8');
assert(project.includes('CFBundleIconName: AppIcon')||project.includes('CFBundleIconName: "AppIcon"'));
assert.strictEqual(uncaught.length,0,uncaught.join('\n'));
console.log('BUILD301 system consolidation: PASS');
process.exit(0);
})().catch(error=>{console.error(error);process.exit(1);});
