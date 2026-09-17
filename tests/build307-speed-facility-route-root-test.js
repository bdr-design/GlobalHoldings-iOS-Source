'use strict';
const assert=require('assert'),fs=require('fs');
const {harness,minimal}=require('./helpers/core-harness');

const app=fs.readFileSync('WebApp/app.js','utf8'),html=fs.readFileSync('WebApp/index.html','utf8'),fleetSource=fs.readFileSync('WebApp/fleet-core.js','utf8');

// The simulation transaction cadence is unchanged. Five running rates are
// adapter inputs only, and the three persisted legacy levels retain their rates.
assert(app.includes('const SAFE_SPEED_VALUES=[0,1,2,3,4,5]'));
assert(app.includes('SIMULATION_RATE_BY_LEVEL=Object.freeze({0:0,1:30,2:120,3:300,4:600,5:60})'));
assert(app.includes('minRealSliceSeconds:.5'));
assert(app.includes('allowedSpeeds:[0,30,60,120,300,600]'));
for(const level of ['1','5','2','3','4'])assert(html.includes(`data-speed="${level}"`));
const motion=app.slice(app.indexOf('function markerPoint'),app.indexOf('function simDate'));
assert(!/state\.simSeconds\s*=|\.progress\s*=/.test(motion),'presentation smoothing must not mutate logical time or progress');
assert(motion.includes('maxPixelsPerSecond:36')&&motion.includes('Math.min(50,elapsed)')&&motion.includes('boundedStepRatio(distance,maxPixels)'),'maximum simulation speed must be visually rate-limited independently of game time and frame stalls');
assert(app.includes('markerMotionStates.clear();'),'a rebuilt map must not retain stale visual motion state');
assert(app.includes('simulationEngine.frame(now);\n    // Presentation sampling is independent'));

const simulation=require('../WebApp/simulation-core.js');
function simulate(rate,allowedSpeeds){let wall=0,simTime=0,slices=0;const boundaries=[];const engine=simulation.create({getSpeed:()=>rate,setSpeed:()=>{},getSimTime:()=>simTime,setSimTime:value=>{simTime=value;},createSliceJob:(slice,meta)=>({runChunk:()=>true,finish:()=>{slices++;if(meta.boundary.hour!==null||meta.boundary.day!==null)boundaries.push({...meta.boundary});return {committed:true};},cancel(){}})},{nowMs:()=>wall,minRealSliceSeconds:.5,allowedSpeeds,fallbackSpeed:30,frameBudgetMs:1000});engine.reset(0,'determinism');for(let frame=1;frame<=360;frame++){wall+=frame%3===0?41:frame%2===0?17:23;engine.frame(wall);}return {simTime,slices,boundaries};}
for(const rate of [30,120,600])assert.deepStrictEqual(simulate(rate,[0,30,120,600]),simulate(rate,[0,30,60,120,300,600]),`legacy rate ${rate} changed after adding intermediate levels`);
for(const rate of [60,300])assert(simulate(rate,[0,30,60,120,300,600]).simTime>0,`new rate ${rate} did not advance`);

const {s}=harness(['transaction-core','domain-command-core','finance-core','facility-core','banking-core','mobility-core','fleet-core','route-core']);
const state={...minimal(),openedCompanies:['road','power','bank'],unlockedSectors:['road','power','bank'],bank:{},advanced:{},customHubs:[],globalBases:[],assets:[],customRoutes:[],routeCache:{},routeEndpoints:{}};
s.GH_FINANCE_CORE.ensure(state);
const command=(domain,name,payload)=>s.GH_DOMAIN_COMMANDS.dispatch({state},domain,name,payload,{actor:'build307-test'}).result;
const site=(company,capitalId='RUH')=>{const capital=s.GH_MOBILITY_CORE.capitalMeta(capitalId);return {key:`site:${company}:${capitalId}`,kind:'company-site',company,...capital};};
const facility=(company,kind,id,capitalId='RUH')=>{const canonical=site(company,capitalId);return {id,sourceKey:canonical.key,company,kind,owned:true,capitalId:canonical.capitalId,city:canonical.city,country:canonical.country,coords:[...canonical.coords]};};

// Directory identity is checked by the facility owner, not just by the UI.
const road=command('facilities','create',{facility:facility('road','logistics','ROAD-RUH'),bucket:'customHubs'});
assert.strictEqual(road.sourceKey,'site:road:RUH');
const beforeForged=state.customHubs.length,forged=facility('power','power','POWER-FORGED');forged.coords[0]+=.2;
assert.throws(()=>command('facilities','create',{facility:forged,bucket:'customHubs'}),/directory-site-coordinates-invalid/);
assert.strictEqual(state.customHubs.length,beforeForged,'forged site left a partial facility');
command('facilities','create',{facility:facility('power','power','POWER-RUH'),bucket:'customHubs'});
assert.throws(()=>command('facilities','create',{facility:facility('road','logistics','ROAD-RUH-2'),bucket:'customHubs'}),/directory-facility-already-open/);

// Banking reads never synthesize a branch from a facility. One verified command
// links the canonical facility and branch inside the caller's transaction.
const bankSite=site('bank'),bankFacility=facility('bank','bank','BANK-RUH');
command('facilities','create',{facility:bankFacility,bucket:'customHubs'});
assert.strictEqual(s.GH_BANKING_CORE.ensure(state).branches,0,'banking ensure fabricated a branch');
assert.throws(()=>command('banking','open-branch',{branchId:'BR-RAW',facilityId:'MISSING',city:'الرياض'}),/directory-site-key-invalid|bank-branch-facility-required/);
const branch=command('banking','open-branch',{branchId:'BR-RUH',facilityId:bankFacility.id,site:bankSite});
assert.strictEqual(branch.capitalId,'RUH');assert.strictEqual(state.bank.branches,1);
const facilityCount=state.customHubs.length,branchCount=state.bank.branchNetwork.length;
assert.throws(()=>s.GH_TRANSACTION_CORE.execute(state,{label:'injected-bank-opening-failure',apply(){const auh=site('bank','AUH'),row=facility('bank','bank','BANK-AUH','AUH');command('facilities','create',{facility:row,bucket:'customHubs'});command('banking','open-branch',{branchId:'BR-AUH',facilityId:row.id,site:auh});throw new Error('injected-after-branch');}}),/injected-after-branch/);
assert.strictEqual(state.customHubs.length,facilityCount);assert.strictEqual(state.bank.branchNetwork.length,branchCount,'failed bank opening was not atomic');

// A route and its complete geometry belong to one asset only. Both exact
// route-id reuse and a different id carrying the same shape are rejected.
const staffing={mode:'automatic-fixed',ready:true,roles:[],total:1,monthlyPayroll:1};
state.assets.push({id:'AIR-A',name:'A',type:'air',phase:'idle',baseFacility:'BASE-A',staffing},{id:'AIR-B',name:'B',type:'air',phase:'idle',baseFacility:'BASE-A',staffing},{id:'AIR-C',name:'C',type:'air',phase:'idle',baseFacility:'BASE-A',staffing});
const routeA={id:'ROUTE-A',type:'air',fromFacility:'BASE-A',toFacility:'PUBLIC-A',from:'Base',to:'A',route:[[24,46],[35,10]],tripSeconds:1000,dwellHours:1,effectiveSpeedKmh:700};
const routeB={...routeA,id:'ROUTE-B',toFacility:'PUBLIC-B',to:'B',route:[[24,46],[51,-.1]]};
const routeC={...routeA,id:'ROUTE-C',route:[[24,46],[30,32],[35,10]]};
command('routes','create',{route:routeA});command('fleet','assign-route',{id:'AIR-A',routeId:routeA.id,route:routeA});
assert.throws(()=>command('fleet','assign-route',{id:'AIR-B',routeId:routeA.id,route:routeA}),/asset-route-exclusive/);
assert.throws(()=>command('fleet','assign-route',{id:'AIR-B',routeId:'ROUTE-CLONE',route:{...routeA,id:'ROUTE-CLONE'}}),/asset-route-exclusive/);
command('routes','create',{route:routeB});command('fleet','assign-route',{id:'AIR-B',routeId:routeB.id,route:routeB});
command('routes','create',{route:routeC});command('fleet','assign-route',{id:'AIR-C',routeId:routeC.id,route:routeC});
assert.strictEqual(new Set(state.assets.map(asset=>asset.routeId)).size,state.assets.length);
assert.strictEqual(new Set(state.assets.map(asset=>asset.routeSignature)).size,state.assets.length);
assert(app.includes('releaseExclusiveRouteOnArrival'),'legacy moving duplicates must finish safely and then release their shared route');
assert(app.includes("const keeper=rows.find(asset=>asset.phase==='moving')||rows[0]"),'legacy exclusivity migration must retain one canonical assignment instead of clearing every asset');
assert(!fleetSource.includes("cmd==='remap-routes'")&&!app.includes('roadHubCandidates:'),'shared-route remapping and raw logistics-site context must not survive as dormant bypasses');

// Mobility keeps one active vehicle per directed street path. A second request
// for the same path remains queued until the first vehicle releases it.
const mobilityState={...minimal(),openedCompanies:['mobility'],customHubs:[{id:'MOB-CENTER-RUH',owned:true,company:'mobility',kind:'mobility-center',capitalId:'RUH',city:'الرياض',country:'السعودية',coords:[24.7136,46.6753],bays:20}],mobility:{capitalCenters:[{id:'MOB-CENTER-RUH',facilityId:'MOB-CENTER-RUH',capitalId:'RUH',city:'الرياض',country:'السعودية',coords:[24.7136,46.6753]}],vehicles:[],drivers:[],rideRequests:[],activeTrips:[],tripArchive:[],events:[],sequence:0,lastDemandAtByCenter:{RUH:0},streetRoutes:{},status:'active'}};
const mobility=s.GH_MOBILITY_CORE.ensure(mobilityState),zones=s.GH_MOBILITY_CORE.zonesFor(mobilityState,'RUH'),from=zones[0],to=zones[1];
for(let index=1;index<=2;index++){const vehicle={id:`MOB-V-${index}`,assetClass:'eco-ev',name:`Vehicle ${index}`,status:'available',centerId:'RUH',zoneId:from.id,driverId:`DRV-${index}`,battery:100,condition:100,totalTrips:0,totalKm:0};mobility.vehicles.push(vehicle);mobility.drivers.push({id:`DRV-${index}`,assetId:vehicle.id,status:'online',centerId:'RUH',zoneId:from.id,totalTrips:0,earnings:0});mobility.rideRequests.push({id:`RIDE-${index}`,requestedAt:0,status:'queued',centerId:'RUH',fromZone:from.id,toZone:to.id,distanceKm:10,service:'eco-ev',fare:50});}
s.GH_MOBILITY_CORE.onSimulationTime({state:mobilityState},1);
assert.strictEqual(mobility.activeTrips.length,1,'two Mobility assets were allowed onto the same active street path');
assert.strictEqual(mobility.rideRequests.filter(request=>request.status==='queued').length,1,'the duplicate Mobility path must wait instead of overlapping');

console.log('BUILD307 speed/facility/route root contracts: PASS');
